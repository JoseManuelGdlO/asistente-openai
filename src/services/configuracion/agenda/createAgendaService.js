const { AgendaService } = require('./agendaService');
const { FirestoreSettingsStore, MemorySettingsStore } = require('./settingsStore');
const { FirestoreAppointmentsStore, MemoryAppointmentsStore } = require('./appointmentsStore');
const { GoogleCalendarClient } = require('../../calendar/googleCalendarClient');

function createAgendaService(options = {}) {
  const settingsStore = options.settingsStore
    || (options.firebaseService
      ? new FirestoreSettingsStore(options.firebaseService)
      : new MemorySettingsStore());
  const appointmentsStore = options.appointmentsStore
    || (options.firebaseService
      ? new FirestoreAppointmentsStore(options.firebaseService)
      : new MemoryAppointmentsStore());
  const google = options.google || new GoogleCalendarClient(options.env || process.env);
  return new AgendaService({
    settingsStore,
    appointmentsStore,
    google,
    now: options.now,
    env: options.env || process.env,
    tokenOverride: options.tokenOverride || ''
  });
}

module.exports = { createAgendaService };
