const { WEEKDAYS } = require('./constants');
const { TIME_RE } = require('./normalize');

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

/**
 * Fases: disabled | disconnected | revoked | error | incomplete | ready.
 */
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

module.exports = { hasOpenHours, describePhase };
