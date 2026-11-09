const { AgendaService } = require('./agendaService');

/**
 * Fábrica de producción: Firestore por defecto; todo es inyectable para pruebas.
 */
function createAgendaService(options = {}) {
  const env = options.env || process.env;
  const settingsStore = options.settingsStore
    || new (require('./settingsStore').FirestoreSettingsStore)(options.firebaseService);
  const appointmentsStore = options.appointmentsStore
    || new (require('./appointmentsStore').FirestoreAppointmentsStore)(options.firebaseService);
  const google = options.google
    || new (require('../../googleCalendar/client').GoogleCalendarClient)(env);
  return new AgendaService({
    settingsStore,
    appointmentsStore,
    google,
    now: options.now,
    env,
    tokenOverride: options.tokenOverride || ''
  });
}

module.exports = { createAgendaService };
