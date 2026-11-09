const { NON_BLOCKING_STATUSES, CAPACITY_MIN, CAPACITY_MAX } = require('./constants');
const {
  zonedToUtc,
  formatLocal,
  addDays,
  rangesOverlap,
  formatDayLabel,
  formatSlotLabel,
  dayWindows
} = require('./time');

function toMs(value) {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return Date.parse(value);
}

function isBlocking(appointment) {
  const status = String(appointment?.status || 'confirmed').toLowerCase();
  return !NON_BLOCKING_STATUSES.includes(status);
}

function toIdSet(value) {
  if (value instanceof Set) return value;
  return new Set(Array.isArray(value) ? value : []);
}

/**
 * Cuántas reservas ocupan el rango [startMs, endMs) (con buffer).
 * Cuenta citas propias activas y bloques ocupados de Google; un bloque de
 * Google que coincide exactamente con una cita propia ya sincronizada
 * (eventId en ownEventIds) no se cuenta dos veces.
 */
/** Resta intervalos propios de un busy de Google (freeBusy suele fusionar eventos contiguos). */
function subtractOwnRanges(busyStart, busyEnd, ownIntervals) {
  let fragments = [[busyStart, busyEnd]];
  for (const [ownStart, ownEnd] of ownIntervals) {
    if (!Number.isFinite(ownStart) || !Number.isFinite(ownEnd) || ownEnd <= ownStart) continue;
    const next = [];
    for (const [fragStart, fragEnd] of fragments) {
      if (ownEnd <= fragStart || ownStart >= fragEnd) {
        next.push([fragStart, fragEnd]);
        continue;
      }
      if (fragStart < ownStart) next.push([fragStart, ownStart]);
      if (ownEnd < fragEnd) next.push([ownEnd, fragEnd]);
    }
    fragments = next;
    if (!fragments.length) break;
  }
  return fragments;
}

function countOccupancy({
  startMs,
  endMs,
  appointments = [],
  googleBusy = [],
  ownEventIds,
  bufferMs = 0,
  excludeAppointmentId = null
}) {
  const own = toIdSet(ownEventIds);
  const ownIntervals = [];
  let count = 0;

  // Cupo por horario: solo solape estricto (sin buffer). Si se aplicara buffer,
  // 3 citas de 09:00–11:00 llenarían también el bloque 11:00–13:00 y el cupo
  // parecería “por día” en vez de “por horario”.
  for (const appointment of appointments || []) {
    if (!isBlocking(appointment)) continue;
    if (excludeAppointmentId && appointment.id === excludeAppointmentId) continue;
    const aStart = toMs(appointment.start);
    const aEnd = toMs(appointment.end);
    if (!Number.isFinite(aStart) || !Number.isFinite(aEnd)) continue;
    ownIntervals.push([aStart, aEnd]);
    if (rangesOverlap(startMs, endMs, aStart, aEnd, 0)) count += 1;
  }

  // Reprogramación: el evento espejo de la cita excluida tampoco bloquea.
  const excluded = excludeAppointmentId
    ? (appointments || []).find((item) => item.id === excludeAppointmentId)
    : null;
  if (excluded?.eventId && own.has(excluded.eventId)) {
    const eStart = toMs(excluded.start);
    const eEnd = toMs(excluded.end);
    if (Number.isFinite(eStart) && Number.isFinite(eEnd)) ownIntervals.push([eStart, eEnd]);
  }

  // Bloqueos externos de Google: como máximo +1 cupo por horario candidato.
  // freeBusy suele devolver muchos segmentos cortos; si cada uno sumara +1,
  // un servicio largo (p. ej. 120 min) se “llenaría” el cupo aunque solo haya
  // ruido/eventos cortos y solo quedaría el último hueco del día.
  let googleBlocks = false;
  for (const busy of googleBusy || []) {
    if (googleBlocks) break;
    const bStart = toMs(busy.start);
    const bEnd = toMs(busy.end);
    if (!Number.isFinite(bStart) || !Number.isFinite(bEnd)) continue;
    const busyId = busy.eventId || busy.id;
    if (busyId && own.has(busyId)) continue;
    const external = subtractOwnRanges(bStart, bEnd, ownIntervals);
    for (const [fragStart, fragEnd] of external) {
      if (rangesOverlap(startMs, endMs, fragStart, fragEnd, bufferMs)) {
        googleBlocks = true;
        break;
      }
    }
  }
  if (googleBlocks) count += 1;
  return count;
}

function clampCapacity(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return CAPACITY_MIN;
  return Math.min(CAPACITY_MAX, Math.max(CAPACITY_MIN, number));
}

/**
 * Horarios disponibles entre fromDate y toDate (fechas locales AAAA-MM-DD).
 * Cada cita dura service.durationMinutes; los inicios se ofrecen cada
 * rules.slotIntervalMinutes (p. ej. 30). Cupo = rules.appointmentsPerBlock
 * (columnas verticales del calendario).
 * Con onePerDay devuelve { dates: [{ date, dayLabel, slot }] } (primer hueco por día);
 * si no, { slots: [...] }.
 */
function buildAvailableSlots({
  now,
  timeZone,
  hours,
  exceptions = [],
  service,
  rules = {},
  fromDate,
  toDate,
  appointments = [],
  googleBusy = [],
  ownEventIds,
  limit = 8,
  onePerDay = false,
  excludeAppointmentId = null
}) {
  const durationMinutes = Math.max(5, Number(service.durationMinutes) || 30);
  const durationMs = durationMinutes * 60000;
  const stepMinutes = Math.max(5, Number(rules.slotIntervalMinutes) || 30);
  const stepMs = stepMinutes * 60000;
  const bufferMs = Math.max(0, Number(rules.bufferMinutes) || 0) * 60000;
  const capacity = clampCapacity(rules.appointmentsPerBlock ?? 1);
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const minStart = nowMs + (Number(rules.minNoticeMinutes) || 0) * 60000;
  const maxStart = nowMs + (Number(rules.maxDaysAhead) || 30) * 86400000;
  const max = Math.max(1, Number(limit) || 8);

  const slots = [];
  const dates = [];
  let date = fromDate;
  while (date <= toDate && (onePerDay ? dates.length : slots.length) < max) {
    const { intervals } = dayWindows({ date, hours, exceptions, timeZone });
    let foundDay = false;
    for (const window of intervals) {
      if (foundDay) break;
      let cursor = zonedToUtc(date, window.start, timeZone).getTime();
      const close = zonedToUtc(date, window.end, timeZone).getTime();
      while (cursor + durationMs <= close && (onePerDay ? !foundDay : slots.length < max)) {
        const startMs = cursor;
        const endMs = startMs + durationMs;
        cursor += stepMs;
        if (startMs < minStart || startMs > maxStart) continue;
        const occupied = countOccupancy({
          startMs, endMs, appointments, googleBusy, ownEventIds, bufferMs, excludeAppointmentId
        });
        if (occupied >= capacity) continue;
        const start = new Date(startMs);
        const end = new Date(endMs);
        const slot = {
          start: start.toISOString(),
          end: end.toISOString(),
          startLocal: formatLocal(start, timeZone),
          endLocal: formatLocal(end, timeZone),
          dayLabel: formatDayLabel(start, timeZone),
          label: formatSlotLabel(start, end, timeZone)
        };
        if (onePerDay) {
          dates.push({ date, dayLabel: slot.dayLabel, slot });
          foundDay = true;
        } else {
          slots.push(slot);
        }
      }
    }
    date = addDays(date, 1);
  }
  return onePerDay ? { dates } : { slots };
}

module.exports = { countOccupancy, buildAvailableSlots };
