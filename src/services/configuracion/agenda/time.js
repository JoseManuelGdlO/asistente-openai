const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

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

/** Hora de pared (fecha + HH:mm) en `timeZone` -> instante UTC (Date). */
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

function rangesOverlap(start, end, otherStart, otherEnd, bufferMs) {
  const gap = Math.max(0, bufferMs || 0);
  return start < otherEnd + gap && otherStart < end + gap;
}

function formatDayLabel(start, timeZone) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(start);
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

/**
 * Ventanas de atención de una fecha local (AAAA-MM-DD).
 * Una excepción de esa fecha manda sobre el horario semanal:
 * cerrada => sin ventanas; con intervalos => esos intervalos.
 */
function dayWindows({ date, hours, exceptions }) {
  const exception = Array.isArray(exceptions)
    ? exceptions.find((item) => item?.date === date)
    : null;
  if (exception) {
    const intervals = Array.isArray(exception.intervals) ? exception.intervals : [];
    if (exception.closed || !intervals.length) return { closed: true, intervals: [] };
    return {
      closed: false,
      intervals: intervals
        .map((interval) => ({ start: interval.start, end: interval.end }))
        .sort((a, b) => a.start.localeCompare(b.start))
    };
  }
  const day = hours?.[weekdayKeyFromDate(date)];
  if (!day?.enabled || !Array.isArray(day.intervals) || !day.intervals.length) {
    return { closed: true, intervals: [] };
  }
  return {
    closed: false,
    intervals: day.intervals
      .map((interval) => ({ start: interval.start, end: interval.end }))
      .sort((a, b) => a.start.localeCompare(b.start))
  };
}

module.exports = {
  WEEKDAY_KEYS,
  formatParts,
  zonedToUtc,
  formatLocal,
  localDate,
  addDays,
  weekdayKeyFromDate,
  rangesOverlap,
  formatDayLabel,
  formatSlotLabel,
  dayWindows
};
