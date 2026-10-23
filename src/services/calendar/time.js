const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

function zonedToUtc(dateStr, timeStr, timeZone) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let corrected = new Date(utcGuess);
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = formatParts(corrected, timeZone);
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const offset = asUtc - corrected.getTime();
    corrected = new Date(utcGuess - offset);
  }
  return corrected;
}

function formatLocal(date, timeZone) {
  const parts = formatParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function localDate(date, timeZone) {
  const parts = formatParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function weekdayKeyFromDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return WEEKDAY_KEYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function toMinutes(hour, minute) {
  return (Number(hour) * 60) + Number(minute);
}

function clockToMinutes(value) {
  const [hour, minute] = String(value || '').split(':');
  return toMinutes(hour, minute);
}

function rangesOverlap(start, end, otherStart, otherEnd, bufferMs) {
  const gap = Math.max(0, bufferMs || 0);
  return start < otherEnd + gap && otherStart < end + gap;
}

function fitsHours(startUtc, endUtc, hours, timeZone) {
  const startDate = localDate(startUtc, timeZone);
  const endDate = localDate(endUtc, timeZone);
  if (startDate !== endDate) return false;
  const day = hours?.[weekdayKeyFromDate(startDate)];
  if (!day?.enabled || !Array.isArray(day.intervals)) return false;
  const startParts = formatParts(startUtc, timeZone);
  const endParts = formatParts(endUtc, timeZone);
  const startMin = toMinutes(startParts.hour, startParts.minute);
  const endMin = toMinutes(endParts.hour, endParts.minute);
  return day.intervals.some((interval) => {
    const open = clockToMinutes(interval.start);
    const close = clockToMinutes(interval.end);
    return startMin >= open && endMin <= close;
  });
}

const LOCAL_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
const EXPLICIT_ZONE_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function hasExplicitZone(value) {
  return typeof value === 'string' && EXPLICIT_ZONE_RE.test(value.trim());
}

function sameMonthDayInYear(dateStr, year) {
  const match = String(dateStr).match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const candidate = `${year}-${match[1]}-${match[2]}`;
  const [y, m, d] = candidate.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return candidate;
}

/**
 * Una fecha anterior a hoy con otro año se mueve al mismo mes y día
 * de este año, o del siguiente si ese día ya pasó.
 * El mismo año se deja como pasado para que el llamador lo rechace.
 */
function rollPastDate(dateStr, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  if (dateStr >= today) return { date: dateStr, correctedFrom: null, past: false };
  if (dateStr.slice(0, 4) === today.slice(0, 4)) {
    return { date: dateStr, correctedFrom: null, past: true };
  }
  const year = Number(today.slice(0, 4));
  let rolled = sameMonthDayInYear(dateStr, year);
  if (!rolled || rolled < today) rolled = sameMonthDayInYear(dateStr, year + 1);
  if (!rolled) return { date: dateStr, correctedFrom: null, past: true };
  return { date: rolled, correctedFrom: dateStr, past: false };
}

function parseLocalDateTime(value, timeZone) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const local = value.trim().match(LOCAL_DATETIME_RE);
  if (!local) return null;
  return zonedToUtc(local[1], local[2], timeZone);
}

/**
 * Acepta la hora local con o sin segundos, y también un ISO con Z o desfase.
 * El ISO con zona es un instante real (el campo start del horario).
 * Sin zona, la hora del reloj se lee en la zona del calendario.
 */
function interpretSlotStart(value, timeZone) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (hasExplicitZone(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const wall = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!wall) return null;
  return zonedToUtc(wall[1], wall[2], timeZone);
}

function formatSlotLabel(start, end, timeZone) {
  const day = new Intl.DateTimeFormat('es-MX', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'short'
  }).format(start);
  const clock = new Intl.DateTimeFormat('es-MX', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  return `${day}, ${clock.format(start)}–${clock.format(end)}`;
}

function generateSlots({
  now,
  timeZone,
  hours,
  durationMinutes,
  rules,
  fromDate,
  toDate,
  busy = [],
  limit = 8
}) {
  const interval = Math.max(5, Number(rules.slotIntervalMinutes) || 30);
  const bufferMs = Math.max(0, Number(rules.bufferMinutes) || 0) * 60000;
  const durationMs = durationMinutes * 60000;
  const minStart = now.getTime() + (Number(rules.minNoticeMinutes) || 0) * 60000;
  const maxStart = now.getTime() + (Number(rules.maxDaysAhead) || 30) * 86400000;
  const slots = [];
  let date = fromDate;
  while (date <= toDate && slots.length < limit) {
    const day = hours?.[weekdayKeyFromDate(date)];
    if (day?.enabled && Array.isArray(day.intervals)) {
      const windows = [...day.intervals].sort((a, b) => a.start.localeCompare(b.start));
      for (const window of windows) {
        let cursor = zonedToUtc(date, window.start, timeZone);
        const close = zonedToUtc(date, window.end, timeZone);
        while (cursor.getTime() + durationMs <= close.getTime() && slots.length < limit) {
          const startMs = cursor.getTime();
          const endMs = startMs + durationMs;
          const allowed = startMs >= minStart && startMs <= maxStart;
          const conflict = busy.some((item) => rangesOverlap(
            startMs,
            endMs,
            item.start,
            item.end,
            bufferMs
          ));
          if (allowed && !conflict) {
            const start = new Date(startMs);
            const end = new Date(endMs);
            slots.push({
              start: start.toISOString(),
              end: end.toISOString(),
              startLocal: formatLocal(start, timeZone),
              endLocal: formatLocal(end, timeZone),
              label: formatSlotLabel(start, end, timeZone)
            });
          }
          cursor = new Date(startMs + interval * 60000);
        }
      }
    }
    date = addDays(date, 1);
  }
  return slots;
}

module.exports = {
  formatParts,
  zonedToUtc,
  formatLocal,
  localDate,
  addDays,
  weekdayKeyFromDate,
  rangesOverlap,
  fitsHours,
  hasExplicitZone,
  rollPastDate,
  parseLocalDateTime,
  interpretSlotStart,
  formatSlotLabel,
  generateSlots
};
