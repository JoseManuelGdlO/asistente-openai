const crypto = require('crypto');
const {
  WEEKDAYS,
  DEFAULT_TIMEZONE,
  CAPACITY_MIN,
  CAPACITY_MAX,
  MAX_SERVICES,
  MAX_EXCEPTIONS,
  defaultRules
} = require('./constants');
// CAPACITY_MIN/MAX reutilizados como rango de appointmentsPerBlock.

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SERVICE_ID_RE = /^svc_[a-z0-9]{6,32}$/;

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

function readInt(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    return { ok: false, error: `${label} debe ser un entero entre ${min} y ${max}` };
  }
  return { ok: true, value: number };
}

/**
 * Valida y ordena una lista de intervalos HH:mm.
 * Devuelve { ok, value } o { ok: false, error } usando `label` en el mensaje.
 */
function normalizeIntervals(raw, label, { skipEmpty = false } = {}) {
  const intervals = [];
  for (const interval of Array.isArray(raw) ? raw : []) {
    const start = typeof interval?.start === 'string' ? interval.start : '';
    const end = typeof interval?.end === 'string' ? interval.end : '';
    if (!start && !end && skipEmpty) continue;
    if (!TIME_RE.test(start) || !TIME_RE.test(end) || start >= end) {
      return { ok: false, error: `Horario inválido en ${label}. Usa apertura menor que cierre.` };
    }
    intervals.push({ start, end });
  }
  intervals.sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index].start < intervals[index - 1].end) {
      return { ok: false, error: `Los horarios de ${label} se cruzan.` };
    }
  }
  return { ok: true, value: intervals };
}

function normalizeHours(input) {
  const source = input && typeof input === 'object' ? input : {};
  const hours = {};
  for (const [key, label] of WEEKDAYS) {
    const day = source[key] && typeof source[key] === 'object' ? source[key] : {};
    const enabled = Boolean(day.enabled);
    const parsed = normalizeIntervals(day.intervals, label, { skipEmpty: !enabled });
    if (!parsed.ok) return parsed;
    if (enabled && !parsed.value.length) {
      return { ok: false, error: `${label} está abierto y no tiene horario.` };
    }
    hours[key] = { enabled, intervals: parsed.value };
  }
  return { ok: true, value: hours };
}

function normalizeServices(input) {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'Los servicios deben ser una lista' };
  if (input.length > MAX_SERVICES) return { ok: false, error: `Máximo ${MAX_SERVICES} servicios por bot` };
  const services = [];
  const ids = new Set();
  for (const item of input) {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name || name.length > 80) {
      return { ok: false, error: 'Cada servicio necesita un nombre de hasta 80 caracteres' };
    }
    const description = typeof item?.description === 'string' ? item.description.trim() : '';
    if (description.length > 400) {
      return { ok: false, error: `La descripción de "${name}" supera 400 caracteres` };
    }
    const duration = Number(item?.durationMinutes);
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
      return { ok: false, error: `La duración de "${name}" debe estar entre 5 y 480 minutos` };
    }
    let id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (id && !SERVICE_ID_RE.test(id)) {
      return { ok: false, error: `Identificador de servicio inválido en "${name}"` };
    }
    if (!id) id = `svc_${crypto.randomBytes(6).toString('hex')}`;
    if (ids.has(id)) return { ok: false, error: 'Hay servicios con el mismo identificador' };
    ids.add(id);
    // capacity por servicio queda obsoleto; se ignora si llega en el payload.
    services.push({
      id,
      name,
      description,
      durationMinutes: duration,
      active: item?.active !== false
    });
  }
  return { ok: true, value: services };
}

function normalizeExceptions(input) {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'Las excepciones deben ser una lista' };
  if (input.length > MAX_EXCEPTIONS) return { ok: false, error: `Máximo ${MAX_EXCEPTIONS} excepciones` };
  const seen = new Set();
  const exceptions = [];
  for (const item of input) {
    const date = typeof item?.date === 'string' ? item.date.trim() : '';
    if (!isValidDate(date)) return { ok: false, error: 'Cada excepción necesita una fecha válida (AAAA-MM-DD)' };
    if (seen.has(date)) return { ok: false, error: `Hay más de una excepción para ${date}` };
    seen.add(date);
    const note = typeof item?.note === 'string' ? item.note.trim() : '';
    if (note.length > 200) return { ok: false, error: `La nota de ${date} supera 200 caracteres` };
    const closed = item?.closed === true;
    if (closed) {
      exceptions.push({ date, closed: true, intervals: [], note });
      continue;
    }
    const parsed = normalizeIntervals(item?.intervals, date);
    if (!parsed.ok) return parsed;
    if (!parsed.value.length) {
      return { ok: false, error: `La excepción de ${date} debe estar cerrada o tener horario.` };
    }
    exceptions.push({ date, closed: false, intervals: parsed.value, note });
  }
  exceptions.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, value: exceptions };
}

function normalizeRules(input) {
  const source = input && typeof input === 'object' ? input : {};
  const defaults = defaultRules();
  const minNotice = readInt(source.minNoticeMinutes ?? defaults.minNoticeMinutes, 0, 10080, 'La anticipación mínima');
  if (!minNotice.ok) return minNotice;
  const maxDays = readInt(source.maxDaysAhead ?? defaults.maxDaysAhead, 1, 365, 'El máximo de días a futuro');
  if (!maxDays.ok) return maxDays;
  const interval = readInt(
    source.slotIntervalMinutes ?? defaults.slotIntervalMinutes,
    5,
    120,
    'El incremento del calendario'
  );
  if (!interval.ok) return interval;
  const buffer = readInt(source.bufferMinutes ?? defaults.bufferMinutes, 0, 240, 'El tiempo de preparación');
  if (!buffer.ok) return buffer;
  // Citas por bloque = columnas verticales del calendario (mismo valor).
  const perBlock = readInt(
    source.appointmentsPerBlock ?? source.calendarColumns ?? defaults.appointmentsPerBlock,
    CAPACITY_MIN,
    Math.min(CAPACITY_MAX, 12),
    'Las citas por bloque / columnas del calendario'
  );
  if (!perBlock.ok) return perBlock;
  return {
    ok: true,
    value: {
      minNoticeMinutes: minNotice.value,
      maxDaysAhead: maxDays.value,
      slotIntervalMinutes: interval.value,
      bufferMinutes: buffer.value,
      appointmentsPerBlock: perBlock.value,
      calendarColumns: perBlock.value,
      allowCancel: source.allowCancel !== false,
      allowReschedule: source.allowReschedule !== false
    }
  };
}

function normalizeAgenda(input) {
  const timezone = typeof input?.timezone === 'string' && input.timezone.trim()
    ? input.timezone.trim()
    : DEFAULT_TIMEZONE;
  if (!isValidTimeZone(timezone)) {
    return { ok: false, error: 'La zona horaria no es válida' };
  }
  const hours = normalizeHours(input?.hours);
  if (!hours.ok) return hours;
  const services = normalizeServices(input?.services);
  if (!services.ok) return services;
  const exceptions = normalizeExceptions(input?.exceptions);
  if (!exceptions.ok) return exceptions;
  const rules = normalizeRules(input?.rules);
  if (!rules.ok) return rules;
  const calendarId = typeof input?.calendarId === 'string' ? input.calendarId.trim() : '';
  const calendarSummary = typeof input?.calendarSummary === 'string' ? input.calendarSummary.trim() : '';
  if (calendarId.length > 512 || calendarSummary.length > 180) {
    return { ok: false, error: 'El calendario seleccionado no es válido' };
  }
  return {
    ok: true,
    value: {
      timezone,
      hours: hours.value,
      services: services.value,
      exceptions: exceptions.value,
      rules: rules.value,
      calendarId,
      calendarSummary
    }
  };
}

module.exports = {
  TIME_RE,
  isValidTimeZone,
  isValidDate,
  normalizeIntervals,
  normalizeHours,
  normalizeServices,
  normalizeExceptions,
  normalizeRules,
  normalizeAgenda
};
