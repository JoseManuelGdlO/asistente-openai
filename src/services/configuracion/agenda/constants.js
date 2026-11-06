const DEFAULT_TIMEZONE = 'America/Mexico_City';

const WEEKDAYS = Object.freeze([
  ['monday', 'Lunes'],
  ['tuesday', 'Martes'],
  ['wednesday', 'Miércoles'],
  ['thursday', 'Jueves'],
  ['friday', 'Viernes'],
  ['saturday', 'Sábado'],
  ['sunday', 'Domingo']
]);

const TIMEZONES = Object.freeze([
  'America/Mexico_City',
  'America/Cancun',
  'America/Tijuana',
  'America/Hermosillo',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Sao_Paulo',
  'Europe/Madrid',
  'UTC'
]);

const CAPACITY_MIN = 1;
const CAPACITY_MAX = 100;
const MAX_SERVICES = 40;
const MAX_EXCEPTIONS = 366;

/** Estados de cita que ya no ocupan lugar en la agenda. */
const NON_BLOCKING_STATUSES = Object.freeze(['cancelled', 'canceled', 'rescheduled', 'expired']);

function defaultRules() {
  return {
    minNoticeMinutes: 60,
    maxDaysAhead: 30,
    slotIntervalMinutes: 30,
    bufferMinutes: 0,
    allowCancel: true,
    allowReschedule: true
  };
}

function defaultHours() {
  const hours = {};
  for (const [key] of WEEKDAYS) {
    const weekday = key !== 'saturday' && key !== 'sunday';
    hours[key] = {
      enabled: weekday,
      intervals: [{ start: '09:00', end: '18:00' }]
    };
  }
  return hours;
}

module.exports = {
  DEFAULT_TIMEZONE,
  WEEKDAYS,
  TIMEZONES,
  CAPACITY_MIN,
  CAPACITY_MAX,
  MAX_SERVICES,
  MAX_EXCEPTIONS,
  NON_BLOCKING_STATUSES,
  defaultRules,
  defaultHours
};
