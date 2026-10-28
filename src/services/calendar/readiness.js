const { WEEKDAYS, DEFAULT_TIMEZONE, defaultRules } = require('./constants');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
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

function hasOpenHours(hours) {
  return WEEKDAYS.some(([key]) => {
    const day = hours?.[key];
    if (!day?.enabled || !Array.isArray(day.intervals) || !day.intervals.length) return false;
    return day.intervals.every((interval) => (
      TIME_RE.test(interval.start)
      && TIME_RE.test(interval.end)
      && interval.start < interval.end
    ));
  });
}

function describePhase(doc) {
  if (!doc?.enabled) {
    return { phase: 'disabled', label: 'Agenda desactivada', ready: false, missing: [] };
  }
  const status = doc.connection?.status || 'disconnected';
  if (status === 'revoked') {
    return {
      phase: 'revoked',
      label: 'Autorización vencida o revocada',
      ready: false,
      missing: ['connection'],
      detail: doc.connection?.lastError || ''
    };
  }
  if (status === 'error') {
    return {
      phase: 'error',
      label: 'Error de conexión',
      ready: false,
      missing: ['connection'],
      detail: doc.connection?.lastError || ''
    };
  }
  if (status !== 'connected' || !doc.connection?.email) {
    return {
      phase: 'disconnected',
      label: 'Google Calendar no conectado',
      ready: false,
      missing: ['connection']
    };
  }
  const missing = [];
  if (!doc.connection.calendarId) missing.push('calendar');
  if (!hasOpenHours(doc.hours)) missing.push('hours');
  const active = Array.isArray(doc.services) && doc.services.some((service) => service.active);
  if (!active) missing.push('services');
  if (missing.length) {
    return { phase: 'incomplete', label: 'Configuración incompleta', ready: false, missing };
  }
  return { phase: 'ready', label: 'Agenda lista', ready: true, missing: [] };
}

function readInt(value, fallback, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    return { ok: false, error: `${label} debe ser un entero entre ${min} y ${max}` };
  }
  return { ok: true, value: number === 0 ? 0 : (number || fallback) };
}

function normalizeHours(input) {
  const source = input && typeof input === 'object' ? input : {};
  const hours = {};
  for (const [key, label] of WEEKDAYS) {
    const day = source[key] && typeof source[key] === 'object' ? source[key] : {};
    const enabled = Boolean(day.enabled);
    const raw = Array.isArray(day.intervals) ? day.intervals : [];
    const intervals = [];
    for (const interval of raw) {
      const start = typeof interval?.start === 'string' ? interval.start : '';
      const end = typeof interval?.end === 'string' ? interval.end : '';
      if (!start && !end && !enabled) continue;
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
    if (enabled && !intervals.length) {
      return { ok: false, error: `${label} está abierto y no tiene horario.` };
    }
    hours[key] = { enabled, intervals };
  }
  return { ok: true, value: hours };
}

function normalizeServices(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'Los servicios deben ser una lista' };
  if (input.length > 40) return { ok: false, error: 'Máximo 40 servicios por bot' };
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
    if (!id) id = `svc_${require('crypto').randomBytes(6).toString('hex')}`;
    if (ids.has(id)) return { ok: false, error: 'Hay servicios con el mismo identificador' };
    ids.add(id);
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

function normalizeRules(input) {
  const source = input && typeof input === 'object' ? input : {};
  const defaults = defaultRules();
  const minNotice = readInt(source.minNoticeMinutes ?? defaults.minNoticeMinutes, defaults.minNoticeMinutes, 0, 10080, 'La anticipación mínima');
  if (!minNotice.ok) return minNotice;
  const maxDays = readInt(source.maxDaysAhead ?? defaults.maxDaysAhead, defaults.maxDaysAhead, 1, 365, 'El máximo de días a futuro');
  if (!maxDays.ok) return maxDays;
  const interval = readInt(source.slotIntervalMinutes ?? defaults.slotIntervalMinutes, defaults.slotIntervalMinutes, 5, 240, 'El intervalo de horarios');
  if (!interval.ok) return interval;
  const buffer = readInt(source.bufferMinutes ?? defaults.bufferMinutes, defaults.bufferMinutes, 0, 240, 'El tiempo de preparación');
  if (!buffer.ok) return buffer;
  return {
    ok: true,
    value: {
      minNoticeMinutes: minNotice.value,
      maxDaysAhead: maxDays.value,
      slotIntervalMinutes: interval.value,
      bufferMinutes: buffer.value,
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
  const rules = normalizeRules(input?.rules);
  if (!rules.ok) return rules;
  const calendarId = typeof input?.calendarId === 'string' ? input.calendarId.trim() : '';
  const calendarSummary = typeof input?.calendarSummary === 'string' ? input.calendarSummary.trim() : '';
  if (calendarId.length > 512 || calendarSummary.length > 180) {
    return { ok: false, error: 'El calendario seleccionado no es válido' };
  }
  return {
    ok: true,
    value: { timezone, hours: hours.value, services: services.value, rules: rules.value, calendarId, calendarSummary }
  };
}

module.exports = {
  isValidTimeZone,
  hasOpenHours,
  describePhase,
  normalizeAgenda
};
