const { CalendarService } = require('./calendarService');

function createCalendarService(options = {}) {
  const store = options.store || new (require('./firestoreStore').FirestoreCalendarStore)(options.firebaseService);
  const google = options.google || new (require('./googleCalendarClient').GoogleCalendarClient)(options.env || process.env);
  return new CalendarService({
    store,
    google,
    now: options.now,
    env: options.env || process.env,
    tokenOverride: options.tokenOverride || ''
  });
}

module.exports = { createCalendarService };
