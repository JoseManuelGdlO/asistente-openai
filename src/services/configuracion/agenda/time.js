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

/** Hora de pared del calendario, sin Z: 2026-11-16T10:00:00 en `timeZone`. */
function calendarDateTime(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatLocal(date, timeZone)}:00`;
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

/** Lunes de la semana civil de `dateStr` (AAAA-MM-DD). */
function mondayOfWeek(dateStr) {
  const index = WEEKDAY_KEYS.indexOf(weekdayKeyFromDate(dateStr));
  const daysFromMonday = index < 0 ? 0 : (index + 6) % 7;
  return addDays(dateStr, -daysFromMonday);
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
 * Una fecha anterior a hoy con otro año se mueve al mismo mes y día de este año
 * (o del siguiente si ya pasó). El mismo año se deja como pasado para que el llamador lo rechace.
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
 * Acepta la hora local con o sin segundos, y también un ISO con Z o desfase
 * (instante real). Sin zona, la hora del reloj se lee en la zona de la agenda.
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

/**
 * Candidatos de instante para un `start` de tool: el parseo principal más
 * alternativas típicas del modelo (pegar Z a startLocal, o copiar la hora
 * del ISO UTC como si fuera local, p. ej. 15:00 en vez de 09:00 CDMX).
 */
function slotStartCandidates(value, timeZone) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return [];
  const seen = new Set();
  const out = [];
  const push = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return;
    const key = date.getTime();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(date);
  };
  push(interpretSlotStart(text, timeZone));
  if (hasExplicitZone(text)) {
    const stripped = text.replace(EXPLICIT_ZONE_RE, '');
    push(interpretSlotStart(stripped, timeZone));
    return out;
  }
  const wall = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!wall) return out;
  const hour = Number(wall[2]);
  const minute = wall[3];
  const isoUtc = `${wall[1]}T${wall[2]}:${minute}:00.000Z`;
  // Con segundos (ISO truncado) o hora ≥ 14: suele ser el UTC de un startLocal matutino en MX.
  if (text.includes(':') && (/\d{2}:\d{2}:\d{2}/.test(text) || hour >= 14)) {
    push(new Date(isoUtc));
  }
  return out;
}

function clockMinutes(value) {
  const [hour, minute] = String(value || '').split(':');
  return (Number(hour) * 60) + Number(minute);
}

/** ¿[startUtc, endUtc] cabe completo en una ventana de atención de ese día (excepciones incluidas)? */
function fitsHours(startUtc, endUtc, { hours, exceptions = [], timeZone }) {
  const date = localDate(startUtc, timeZone);
  if (date !== localDate(endUtc, timeZone)) return false;
  const { intervals } = dayWindows({ date, hours, exceptions });
  const startParts = formatParts(startUtc, timeZone);
  const endParts = formatParts(endUtc, timeZone);
  const startMin = (Number(startParts.hour) * 60) + Number(startParts.minute);
  const endMin = (Number(endParts.hour) * 60) + Number(endParts.minute);
  return intervals.some((interval) => (
    startMin >= clockMinutes(interval.start) && endMin <= clockMinutes(interval.end)
  ));
}

module.exports = {
  hasExplicitZone,
  rollPastDate,
  parseLocalDateTime,
  interpretSlotStart,
  slotStartCandidates,
  fitsHours,
  WEEKDAY_KEYS,
  formatParts,
  zonedToUtc,
  formatLocal,
  calendarDateTime,
  localDate,
  addDays,
  weekdayKeyFromDate,
  mondayOfWeek,
  rangesOverlap,
  formatDayLabel,
  formatSlotLabel,
  dayWindows
};
