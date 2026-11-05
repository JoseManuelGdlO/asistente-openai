#!/usr/bin/env node
/**
 * Migra un clientId (o todos) de calendar_settings → agenda v2.
 * Uso: node scripts/migrate-agenda-v2.js [clientId]
 */
require('dotenv').config();
const FirebaseService = require('../src/services/firebaseService');
const { FirestoreCalendarStore } = require('../src/services/calendar/firestoreStore');
const { createAgendaService } = require('../src/services/configuracion/agenda/createAgendaService');
const { migrateClient } = require('../src/services/configuracion/agenda/migrate');

async function main() {
  const firebaseService = new FirebaseService();
  const calendarStore = new FirestoreCalendarStore(firebaseService);
  const agendaService = createAgendaService({ firebaseService });
  const only = process.argv[2] || '';

  let clientIds = [];
  if (only) {
    clientIds = [only];
  } else {
    const snap = await firebaseService.calendarSettingsCollection.get();
    clientIds = snap.docs.map((doc) => doc.id);
  }

  for (const clientId of clientIds) {
    const result = await migrateClient({
      clientId,
      calendarStore,
      settingsStore: agendaService.settingsStore,
      appointmentsStore: agendaService.appointmentsStore,
      setAgendaEngine: async (id, engine) => {
        await firebaseService.updateAssistant(id, { agendaEngine: engine });
      }
    });
    console.log('Migrado', result);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
