# Configuración → Agendar citas (rediseño de agenda)

## Objetivo

Crear el módulo **Configuración** por bot (navegación Assistant → Configuración) con la primera config **Agendar citas**: agenda con cupos, excepciones, reserva transaccional en BD y sync 1:1 con Google Calendar (reintentos). Reemplaza el motor/panel Calendar actual tras migrar datos.

## Decisiones acordadas

| Tema | Decisión |
| --- | --- |
| Enfoque | Módulo nuevo `configuracion/agenda` + cutover (no rewrite in-place ni strangler largo) |
| Entrega | Diagrama completo en v1 (config + disponibilidad + reserva + sync + UI Configuración) |
| Legacy | Migrar OAuth, horarios, servicios y citas desde Calendar |
| Cupos | Varios cupos en el mismo horario; `capacity` **por servicio** (migración default `1`) |
| Google | Un evento por cita; no doble contar eventos propios al calcular disponibilidad |
| Excepciones | Día cerrado **o** horarios especiales esa fecha (sin descansos recurrentes tipo comida en v1) |
| UI | Assistant → Configuración (hub) → Agendar citas |
| Confirmación al cliente | Tras reserva en BD; no esperar éxito de Google |
| Sync fallido | Mantener reserva; `retry` + backoff |

## Arquitectura

Paquete nuevo: `src/services/configuracion/agenda/`.

| Pieza | Rol |
| --- | --- |
| Config store | Settings por bot (horarios, servicios+cupo, excepciones, reglas, OAuth) |
| Appointments store | Citas propias con estado de sync |
| Availability engine | Slots del día → excepciones → cupos BD → bloques Google externos |
| Booking service | Transacción: revalidar cupo → crear cita `pending_sync` → OK al bot |
| Sync worker | Crear/actualizar/cancelar evento Google; reintentos. Corre en-process vía el scheduler existente del servicio (tick periódico), no cola externa en v1 |
| Bot tools | Mismos nombres que hoy (`listBookingServices`, `getAvailableSlots`, `createAppointment`, `rescheduleAppointment`, `cancelAppointment`) contra el motor nuevo |
| Panel | Hub Configuración + pantalla Agendar citas |

El Calendar viejo (`src/services/calendar/` + panel) deja de escribir tras cutover; se puede mantener lectura legacy breve si hace falta rollback.

## Datos

### `agenda_settings/{clientId}`

Migrado desde `calendar_settings`.

| Campo | Notas |
| --- | --- |
| `enabled` | Agenda activa |
| `connection` | status, email, calendarId, calendarSummary, timezone, connectedAt, lastError |
| `hours` | Jornada semanal (días + intervals) |
| `services[]` | `{ id, name, durationMinutes, active, capacity }` — `capacity` entero ≥ 1 |
| `exceptions[]` | `{ date, closed: true }` **o** `{ date, closed: false, intervals: [{ start, end }] }` |
| `rules` | minNoticeMinutes, maxDaysAhead, slotIntervalMinutes, bufferMinutes, allowCancel, allowReschedule |
| OAuth | encryptedTokens, oauthNonce, oauthVia, adminNotice (paridad con Calendar) |

### `agenda_appointments/{clientId}/items/{appointmentId}`

| Campo | Notas |
| --- | --- |
| `serviceId`, `start`, `end` | Guardar instantes en UTC ISO; exponer al bot/panel `startLocal` en timezone del calendario (misma regla que Calendar actual) |
| `customerName`, `customerPhone`, `notes` | Datos del cliente |
| `status` | `confirmed` \| `cancelled` |
| `sync` | `pending` \| `synced` \| `retry` |
| `eventId` | Google event id si existe |
| `syncAttempts`, `nextRetryAt`, `lastSyncError` | Reintentos |
| `createdAt`, `updatedAt` | Auditoría |

### Conteo de disponibilidad

Para un candidate slot del servicio S:

`ocupados = citas confirmed que solapan el rango + bloques Google cuyo eventId no está en citas propias`

Libre si `ocupados < S.capacity`.

### Migración

1. Copiar settings + OAuth `calendar_settings` → `agenda_settings` (`capacity: 1` por servicio, `exceptions: []`).
2. Cada entrada `busy` confirmed → appointment (`synced` si hay `eventId`, si no `pending`).
3. Marcar el documento del cliente/assistant con `agendaEngine: 'v2'` cuando la migración de ese `clientId` sea OK (default ausente/`v1` = path Calendar viejo hasta migrar).
4. Script/job **idempotente** por `clientId`. No borrar legacy en el primer deploy.

## Flujos

### Configuración (dueño)

Panel guarda hours, timezone, services+capacity, exceptions, rules, enabled y conexión Google vía capa de agenda → Firestore.

### Consulta de disponibilidad (cliente vía bot)

1. Tool `getAvailableSlots` (servicio + fecha, o fechas libres).
2. Leer settings + citas del rango.
3. Aplicar jornada; si excepción: cerrado → sin slots; si no cerrado → intervals especiales.
4. freeBusy Google; excluir eventIds propios.
5. Filtrar por cupo; ofrecer slots o pedir otra fecha.

### Reserva

1. `createAppointment` tras confirmación del cliente.
2. Transacción Firestore: revalidar cupo → si lleno, rechazar (bot vuelve a ofrecer).
3. Crear cita `confirmed` + `sync: pending`.
4. Responder OK al bot (fecha, hora, servicio) **sin** esperar Google.

### Sync async

1. Worker procesa `pending` / `retry` con `nextRetryAt <= now`.
2. Crear/actualizar/cancelar **un evento por cita**.
3. Éxito → `synced` + `eventId`. Error → `retry`, `syncAttempts++`, backoff en `nextRetryAt`; la reserva permanece.
4. Reschedule/cancel: mutación transaccional en BD + sync refleja el cambio (o reintento).

## UI

### Navegación

- Ficha bot → pestaña **Assistant**.
- Entrada **Configuración** (hub; en v1 solo lista Agendar citas; preparado para más ítems).
- **Agendar citas** → pantalla de esa config.
- Tras cutover: quitar montaje del Calendar panel actual en Assistant.

### Pantalla Agendar citas

1. Estado / readiness (disabled, disconnected, incomplete, ready, revoked, error).
2. Conexión Google (invite, conectar, elegir calendario, desconectar).
3. Jornada + timezone.
4. Servicios: nombre, duración, activo, cupo.
5. Excepciones: fecha cerrada o intervals especiales.
6. Reglas.
7. Activar agenda cuando `ready`.

Escrituras con edit-lock (`X-Editor-Id`). Sin lock → solo lectura.

Listado rico de citas en panel: **fuera de alcance v1** (salvo lo mínimo operativo si se necesita diagnosticar sync).

## API panel

`requireAdminAuth`. Prefijo: `/clients/:clientId/configuracion/agenda`.

| Método | Ruta (orientativa) | Lock | Efecto |
| --- | --- | --- | --- |
| GET | `/` | no | Estado panel (settings + readiness + connection) |
| PUT | `/` o `/settings` | sí | Guardar hours, services, exceptions, rules, enabled |
| POST | invite / OAuth / select-calendar / disconnect / notice dismiss | según mutación | Paridad con flujos Calendar migrados |

Validar assistant existente (404). Errores: `401` auth · `409` lock · `400` validación (cupo &lt; 1, excepción inválida, horarios) · `500` genérico.

El bot no usa estas rutas: tools → booking/sync.

Reutilizar cliente Google OAuth existente donde sea posible (tokens/migrados), no duplicar apps OAuth.

## Errores

- Cupo agotado en reserva → rechazo; bot refresca slots.
- Google caído en consulta → no inventar disponibilidad.
- Google caído en sync → reserva + retry.
- OAuth revocado → tools no agendan; fase `revoked` en panel.
- Validación panel → `400`.
- Sin edit-lock → `409`.

## Cutover

1. Desplegar motor v2 + rutas/UI Configuración + migración.
2. Bots con `agendaEngine: 'v2'` usan solo path nuevo (tools + panel).
3. Dejar de montar Calendar panel viejo; opcional lectura legacy corta.
4. Migración idempotente; cleanup de `calendar_settings` / código viejo en un paso posterior explícito.

## Tests

- Unit: generación de slots + excepciones + cupos + exclusión de eventIds propios.
- Unit: reserva concurrente (éxito vs cupo lleno).
- Unit: sync success / retry / backoff.
- HTTP: auth, lock, CRUD settings/excepciones, readiness.
- Migración: `calendar_settings` + `busy` → `agenda_settings` + appointments.
- Regresión tools: mismos nombres y contrato estable para el asistente.

## Fuera de alcance (v1)

- Otros ítems del hub Configuración además de Agendar citas.
- Cupos por profesional / sala / recurso.
- Descansos recurrentes diarios (comida) como tipo de excepción aparte.
- Listado/gestión rica de citas en el panel.
- Confirmación al cliente condicionada al éxito de Google.
- Borrar datos legacy en el primer deploy.
