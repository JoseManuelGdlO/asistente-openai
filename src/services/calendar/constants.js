const CALENDAR_TOOL_NAMES = Object.freeze([
  'listBookingServices',
  'getAvailableSlots',
  'createAppointment',
  'rescheduleAppointment',
  'cancelAppointment'
]);

const LIVE_ORIGINS = new Set(['meta', 'ultramsg', 'own']);
const HOLD_MS = 2 * 60 * 1000;
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

function defaultFormats() {
  return {
    date: 'YYYY-MM-DD',
    dateTime: 'YYYY-MM-DDTHH:mm',
    availability: 'times',
    notes: ''
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

function defaultDocument() {
  return {
    enabled: false,
    connection: {
      status: 'disconnected',
      email: '',
      calendarId: '',
      calendarSummary: '',
      timezone: DEFAULT_TIMEZONE,
      connectedAt: null,
      lastError: ''
    },
    encryptedTokens: null,
    oauthNonce: null,
    oauthNonceExpiresAt: null,
    hours: defaultHours(),
    services: [],
    rules: defaultRules(),
    playgroundWriteEnabled: false,
    busy: []
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  CALENDAR_TOOL_NAMES,
  LIVE_ORIGINS,
  HOLD_MS,
  DEFAULT_TIMEZONE,
  WEEKDAYS,
  TIMEZONES,
  defaultRules,
  defaultFormats,
  defaultHours,
  defaultDocument,
  clone
};
