# Agenda: citas por bloque (global) y quitar capacidad por servicio

## Objetivo

Reemplazar la **capacidad por servicio** por un cupo global **citas por bloque** en reglas. El tamaño del bloque sigue siendo la duración del servicio; el número de citas que caben en cada bloque es uno solo para todo el bot.

## Decisiones

| Tema | Elección |
| --- | --- |
| Dónde vive el cupo | `rules.appointmentsPerBlock` (global) |
| Capacidad por servicio | Eliminada del panel, normalizer, disponibilidad y reserva |
| Datos viejos `services[].capacity` | Se ignoran; no se migran ni se usan en runtime |
| Default | `appointmentsPerBlock = 1` |
| Definición de bloque | `[start, start + durationMinutes)` del servicio ofrecido |
| Disponibilidad | Sigue siendo solo agenda local (Firestore); Google no filtra oferta |

## Datos

### `agenda_settings/{clientId}.rules`

Agregar:

- `appointmentsPerBlock`: entero ≥ 1 (default 1). Máximo razonable alineado al cupo anterior (p. ej. 100).

Resto de reglas sin cambio (`minNoticeMinutes`, `maxDaysAhead`, `bufferMinutes`, `allowCancel`, `allowReschedule`, etc.). `slotIntervalMinutes` sigue oculto/derivado de la duración del servicio si aplica.

### `services[]`

Dejar de persistir y validar `capacity`. Forma del servicio:

- `{ id, name, description, durationMinutes, active }`

Si el cliente envía `capacity` al guardar, el normalizer lo descarta.

## Comportamiento

### Disponibilidad (`getAvailableSlots` / `findSlots`)

1. Generar candidatos por jornada: pasos de `service.durationMinutes` dentro de horarios/excepciones/buffer/anticipación.
2. Un candidato (bloque) está libre si la ocupación local en ese intervalo es **&lt; `rules.appointmentsPerBlock`**.
3. Ejemplo: duración 120, `appointmentsPerBlock = 3`, horario 09:00–15:00 → bloques 09:00–11:00, 11:00–13:00, 13:00–15:00; cada uno admite hasta 3 citas confirmadas que solapen ese intervalo.

### Reserva / reagendar

- Misma regla de ocupación vs `appointmentsPerBlock` en la transacción.
- Si el bloque está lleno → rechazo + oferta fresca del día (comportamiento actual de slot lleno).

### Sync Google

Sin cambio: espejo post-reserva; no define cupos.

## Panel

- Servicios: quitar input “Capacidad” / “citas simultáneas”.
- Reglas: campo **“Citas por bloque”** (`appointmentsPerBlock`) con ayuda breve: cuántas citas caben en cada bloque según la duración del servicio.

## Tools / instrucciones del bot

- Sustituir menciones a “cupos por servicio / capacidad” por cupo global de citas por bloque.
- No inventar capacidad distinta por servicio.

## Alcance de código

- `normalize.js`: reglas + servicios sin `capacity`; validar `appointmentsPerBlock`.
- `availability.js`, `booking.js`, `agendaService.js`: leer cupo desde `rules`, no desde `service`.
- `public/js/agenda-panel.js`: UI.
- Tests unitarios de normalize / availability / booking / tools / panel si aplica.
- Actualizar copy del spec padre de agenda donde aún diga capacity por servicio (referencia cruzada).

## Fuera de alcance

- Overrides por servicio.
- Migración automática de `capacity` antigua a `appointmentsPerBlock`.
- Cambiar la fuente de verdad de disponibilidad (sigue siendo Firestore).
