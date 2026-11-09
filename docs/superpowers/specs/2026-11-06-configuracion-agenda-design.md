# Configuración → Agendar citas (rediseño)

## Objetivo

Nuevo módulo **Configuración** por bot en el panel. La primera opción es **Agendar citas**: agenda completa según el diagrama (configuración, disponibilidad, reserva transaccional, sync Google con reintentos).

Reemplaza el módulo Calendar actual. Arranque limpio: sin migrar datos ni OAuth previos.

## Decisiones

| Tema | Elección |
| --- | --- |
| Estrategia | Rediseño nuevo; reemplaza Calendar |
| Alcance | Diagrama completo en una entrega |
| Datos Calendar viejos | No migrar; cada bot reconecta y reconfigura |
| Cupo | Varias citas en el mismo horario (p. ej. cupo 3 = hasta 3 a las 10:00) |
| Calendar en panel/runtime | Corte duro: fuera del panel y de las tools |
| Implementación | Reescribir agenda desde cero bajo Configuración; del Calendar solo reutilizar cliente Google (OAuth / freeBusy / eventos) |
| Borrador actual `configuracion/agenda` | Descartar y reescribir limpio según este spec |

## Arquitectura

**Configuración (hub)** por bot: lista de ajustes. Primer ítem: Agendar citas. Otras configs futuras no tocan la agenda.

**Agenda** en `src/services/configuracion/agenda/` (código nuevo):

| Pieza | Rol |
| --- | --- |
| Settings | Horarios, TZ, servicios (duración + cupo), reglas, excepciones |
| Availability | Slots: jornada → excepciones/buffer/intervalo → cupos; cruza citas propias + busy Google sin duplicar eventos ya sync |
| Booking | Revalida cupo y guarda en Firestore en transacción; si lleno → rechazo |
| Sync | Tras reservar: `sync=pending` → evento Google → `synced` o `retry` con backoff |
| Tools bot | `listBookingServices`, `getAvailableSlots`, `createAppointment`, reagendar/cancelar |
| Google client | Extraer/reutilizar solo OAuth + API a helper compartido (p. ej. `src/services/googleCalendar/`); no reutilizar `calendarService`, holds ni panel viejo |

Fuente de verdad: Firestore (settings + citas). Google Calendar es espejo y fuente de bloqueos externos.

## Datos

Colecciones nuevas (no leer `calendar_settings`):

### `agenda_settings/{clientId}`

- `enabled`
- `connection`: status, email, calendarId, calendarSummary, timezone, connectedAt, lastError
- `encryptedTokens`, oauth nonce (mismo patrón de cifrado)
- `hours`: por día `{ enabled, intervals: [{ start, end }] }`
- `services[]`: `{ id, name, description, durationMinutes, active }`
- `exceptions[]`: fecha `YYYY-MM-DD` → cerrado o intervalos distintos ese día
- `rules`: minNoticeMinutes, maxDaysAhead, slotIntervalMinutes, bufferMinutes, appointmentsPerBlock, allowCancel, allowReschedule — `appointmentsPerBlock` = cupo global por bloque de duración del servicio
- *(Superseded for capacity: see `2026-11-06-agenda-citas-por-bloque-design.md`.)*
- `playgroundWriteEnabled`, `adminNotice`

### `agenda_appointments/{clientId}/items/{appointmentId}`

- `serviceId`, `start`, `end` (ISO UTC)
- `customerName`, `customerPhone`, `notes`
- `status`: `confirmed` | `cancelled`
- `sync`: `pending` | `synced` | `retry`
- `eventId`, `syncAttempts`, `nextRetryAt`, `lastSyncError`
- `createdAt`, `updatedAt`

Reservas concurrentes: transacción Firestore (releer confirmadas del rango, ocupación vs `capacity`, escribir o rechazar).

Docs viejos de Calendar quedan huérfanos; el runtime no los usa. Limpieza opcional después.

## Flujos

### Configuración (panel)

1. Configuración → Agendar citas.
2. Conectar Google (OAuth / invite).
3. Calendario, TZ, horarios, servicios (duración + cupo), excepciones, reglas.
4. Guardar en `agenda_settings`. Lista solo si: conectado + calendario + ≥1 día abierto + ≥1 servicio activo.

### Disponibilidad (bot)

1. Identificar servicio y fecha.
2. Leer settings + citas confirmadas en rango.
3. freeBusy de Google.
4. Generar slots; aplicar excepciones/buffer/intervalo; ocupación (propias + externo, sin doble conteo sync) vs capacity.
5. Ofrecer horarios o sugerir otra fecha.

### Confirmación

1. Cliente confirma horario.
2. Transacción: revalidar cupo; si lleno → rechazo y slots frescos.
3. Si ok → `confirmed` + `sync=pending`.
4. Intento sync Google: ok → `eventId` + `synced`; error → mantener reserva + `retry`.
5. Confirmar al cliente aunque Google falle.

### Reintentos

Worker/scheduler: citas `pending`/`retry` debidas → create/update/delete en Google → `synced` o nuevo retry (tope + `lastSyncError`).

### Reagendar / cancelar

Mutación en BD (transacción + cupo) → sync pendiente → espejo Google (intento inmediato y/o worker).

## Panel y API

### Panel

- Hub Configuración en ficha del assistant.
- Agendar citas: enable, OAuth/invite, calendario, horarios, servicios+cupo, excepciones, reglas, playground write, errores de sync si aplica.
- Sin botón migrar ni flag motor v1/v2.
- Quitar montaje del Calendar panel.

### API

Auth admin; edit-lock en mutaciones. Prefijo `/clients/:clientId/configuracion/agenda`:

| Método | Ruta | Notas |
| --- | --- | --- |
| GET | `/` | Estado panel |
| PUT | `/settings` | Horarios, servicios, excepciones, rules, TZ |
| PUT | `/enabled` | |
| PUT | `/playground-write` | |
| GET | `/calendars` | |
| POST | `/select-calendar` | |
| POST | `/oauth/start` | |
| POST | `/disconnect` | |
| POST | `/notice/dismiss` | |

Invite/callback OAuth: rutas públicas equivalentes a Calendar, store nuevo. **Sin** `/migrate`.

### Runtime

- Tools solo del motor nuevo; playground igual.
- Sync worker en scheduler existente.
- Sin dual path `agendaEngine` / `calendarService` en `app.js`.

## Corte del Calendar

- Desmontar `mountCalendarRoutes`, `calendar-panel`, tools/runtime de `calendarService`.
- Extraer cliente Google a helper compartido; eliminar o dejar fuera el resto de `src/services/calendar/*`.
- Sustituir tests de calendar por agenda nueva (excepto tests del cliente Google si se mueve).
- Reescribir `configuracion/agenda` desde cero (no “arreglar” el borrador).

## Errores

- Agenda incompleta/desconectada → no inventar horarios.
- `slot_full` → bot reconsulta disponibilidad.
- Bloqueo solo en Google → slot no ofrecido; si aparece entre oferta y reserva, rechazo en revalidación.
- Fallo sync → cita sigue confirmada; retry; tras tope, error visible sin borrar reserva.
- OAuth revocado → no agendar hasta reconectar.
- API: `401` / `404` / `409` lock / `400` validación.

## Tests

- Unit: slots, cupos, excepciones, no doble-conteo sync, booking concurrente.
- Unit: sync worker (éxito, retry, cancel+delete).
- HTTP: settings/enabled/oauth/disconnect/select-calendar (auth + lock).
- HTTP/runtime: tools con store en memoria.
- Smoke: hub Configuración; Calendar ausente del panel.

## Fuera de alcance

- Otras opciones de Configuración además de Agendar citas.
- Migración desde Calendar.
- Multi-recurso (doctor / silla / sala).
- Import masivo de citas.
- Pantalla global de agenda (no por bot).
