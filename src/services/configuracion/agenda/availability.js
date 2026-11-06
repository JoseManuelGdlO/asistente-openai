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
  const ownRanges = new Set();
  let count = 0;

  for (const appointment of appointments || []) {
    if (!isBlocking(appointment)) continue;
    if (excludeAppointmentId && appointment.id === excludeAppointmentId) continue;
    const aStart = toMs(appointment.start);
    const aEnd = toMs(appointment.end);
    if (!Number.isFinite(aStart) || !Number.isFinite(aEnd)) continue;
    if (appointment.eventId && own.has(appointment.eventId)) ownRanges.add(`${aStart}|${aEnd}`);
    if (rangesOverlap(startMs, endMs, aStart, aEnd, bufferMs)) count += 1;
  }

  // Las citas excluidas (p. ej. la que se reprograma) también dejan libre su evento espejo.
  const excluded = excludeAppointmentId
    ? (appointments || []).find((item) => item.id === excludeAppointmentId)
    : null;
  const excludedRange = excluded && excluded.eventId && own.has(excluded.eventId)
    ? `${toMs(excluded.start)}|${toMs(excluded.end)}`
    : null;

  for (const busy of googleBusy || []) {
    const bStart = toMs(busy.start);
    const bEnd = toMs(busy.end);
    if (!Number.isFinite(bStart) || !Number.isFinite(bEnd)) continue;
    const key = `${bStart}|${bEnd}`;
    if (key === excludedRange) continue;
    const busyId = busy.eventId || busy.id;
    if (busyId && own.has(busyId)) continue;
    if (ownRanges.has(key)) continue;
    if (rangesOverlap(startMs, endMs, bStart, bEnd, bufferMs)) count += 1;
  }
  return count;
}

function clampCapacity(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return CAPACITY_MIN;
  return Math.min(CAPACITY_MAX, Math.max(CAPACITY_MIN, number));
}

/**
 * Horarios disponibles entre fromDate y toDate (fechas locales AAAA-MM-DD).
 * Un horario está abierto si occupied < service.capacity.
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
  const interval = Math.max(5, Number(rules.slotIntervalMinutes) || 30);
  const bufferMs = Math.max(0, Number(rules.bufferMinutes) || 0) * 60000;
  const durationMs = Number(service.durationMinutes) * 60000;
  const capacity = clampCapacity(service.capacity ?? 1);
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
        cursor += interval * 60000;
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
