const AGENDA_TOOL_NAMES = Object.freeze([
  'listBookingServices',
  'getAvailableSlots',
  'createAppointment',
  'rescheduleAppointment',
  'cancelAppointment'
]);

const LIVE_ORIGINS = new Set(['meta', 'ultramsg', 'own']);
const DEFAULT_TIMEZONE = 'America/Mexico_City';
const SYNC_BACKOFF_MS = Object.freeze([60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]);
const MAX_SYNC_ATTEMPTS = 12;

const WEEKDAYS = Object.freeze([
  ['monday', 'Lunes'],
  ['tuesday', 'Martes'],
  ['wednesday', 'Miércoles'],
  ['thursday', 'Jueves'],
  ['friday', 'Viernes'],
  ['saturday', 'Sábado'],
  ['sunday', 'Domingo']
]);

function defaultRules() {
  return {
    minNoticeMinutes: 60,
    maxDaysAhead: 30,
    slotIntervalMinutes: 30,
    bufferMinutes: 0,
    maxSlotsPerDay: 16,
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

function defaultSettings() {
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
    oauthVia: null,
    adminNotice: null,
    hours: defaultHours(),
    services: [],
    exceptions: [],
    rules: defaultRules(),
    playgroundWriteEnabled: false
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nextSyncBackoffMs(attempts) {
  const index = Math.max(0, Math.min(SYNC_BACKOFF_MS.length - 1, Number(attempts) || 0));
  return SYNC_BACKOFF_MS[index];
}

module.exports = {
  AGENDA_TOOL_NAMES,
  LIVE_ORIGINS,
  DEFAULT_TIMEZONE,
  SYNC_BACKOFF_MS,
  MAX_SYNC_ATTEMPTS,
  WEEKDAYS,
  defaultRules,
  defaultFormats,
  defaultHours,
  defaultSettings,
  clone,
  nextSyncBackoffMs
};
