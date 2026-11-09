# Agenda: previsualizador semanal (solo lectura)

## Objetivo

En **Configuración → Agendar citas**, mostrar una vista previa semanal de **nuestra agenda**: franjas de horario abierto y citas confirmadas. Lo vacío dentro del horario abierto se lee como libre (sin calcular bloques por duración de servicio).

## Decisiones

| Tema | Elección |
| --- | --- |
| Contenido | Ocupados (citas) + franjas de horario de atención / excepciones |
| Libres por servicio | No: sin selector de servicio ni `buildAvailableSlots` |
| Vista | Semana (Lun–Dom) |
| Interacción | Solo lectura (navegar semanas; sin cancelar/reprogramar) |
| Fuente | Firestore (settings + citas) + eventos del Google Calendar conectado (listEvents); se omiten espejos ya sync (`eventId`) |
| UI | Grid HTML/CSS propio en el panel; sin FullCalendar |

## API

`GET /api/configuracion/:clientId/agenda/preview?weekStart=YYYY-MM-DD`

- Auth: mismo admin que el resto de agenda.
- `weekStart`: lunes de la semana en la TZ de la agenda. Si falta o es inválido → lunes de la semana actual.
- Si `weekStart` no es lunes, normalizar al lunes de esa semana local.

### Respuesta

```json
{
  "timezone": "America/Mexico_City",
  "weekStart": "2026-11-03",
  "weekEnd": "2026-11-09",
  "days": [
    {
      "date": "2026-11-03",
      "weekday": "monday",
      "label": "lunes, 3 de noviembre",
      "closed": false,
      "intervals": [{ "start": "09:00", "end": "15:00" }]
    }
  ],
  "appointments": [
    {
      "id": "apt_…",
      "serviceName": "Esencial",
      "customerName": "Ana",
      "start": "…Z",
      "end": "…Z",
      "startLocal": "2026-11-03T09:00",
      "endLocal": "2026-11-03T11:00",
      "sync": "synced"
    }
  ]
}
```

- `days`: 7 entradas; `intervals` vía `dayWindows` (hours + exceptions).
- `appointments`: confirmadas que **solapan** `[weekStart 00:00, weekEnd+1 00:00)` en la TZ de la agenda.
- No incluir canceladas.
- `googleEvents`: eventos del calendario conectado en el mismo rango (vía `listEvents`), excluyendo ids que ya son `eventId` de una cita local.
- `google`: `{ connected, ok, error }` — si no hay conexión o falla la API, el preview local sigue.

## UI

- Sección **Vista previa** en `agenda-panel.js` (visible con settings cargados; si no hay días abiertos en la semana, grid vacío + mensaje).
- Controles: anterior / siguiente / Hoy; título con rango de fechas.
- Grid: columnas Lun–Dom; filas de hora desde el mínimo `start` al máximo `end` de los intervalos de esa semana (fallback 09:00–18:00 si la semana está cerrada).
- Franjas abiertas con fondo suave; cerrado atenuado.
- Bloques de cita posicionados por `startLocal`/`endLocal` (servicio + nombre truncado; `title` con detalle + sync).
- Varias citas solapadas: apilar con offset mínimo o mostrar conteo en el bloque (v1: apilar con z-index / left offset ligero).
- Leyenda: abierto / cerrado / cita.
- Recargar preview al entrar al panel y al cambiar de semana; opcionalmente tras guardar settings (horarios cambian).

## Alcance de código

- `agendaService.getWeekPreview(clientId, weekStart?)`
- Ruta en `routes.js`
- `appointmentsStore`: listado confirmadas en rango (reutilizar o añadir helper si falta)
- `public/js/agenda-panel.js` + CSS del panel admin si hace falta
- Tests HTTP/unit del preview

## Fuera de alcance

- Crear / cancelar / reprogramar desde el preview
- Huecos libres calculados por servicio / `appointmentsPerBlock`
- Vista mes / día
- Editar eventos de Google desde el preview
