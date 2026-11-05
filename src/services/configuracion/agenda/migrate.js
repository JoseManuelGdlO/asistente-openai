const { clone } = require('./constants');
const { normalizeSettings } = require('./settingsStore');

function mapBusyToAppointment(item) {
  if (!item || item.status !== 'confirmed') return null;
  const id = item.id || `apt_migrated_${Date.now()}`;
  return {
    id,
    serviceId: item.serviceId || '',
    start: item.start,
    end: item.end,
    customerName: item.customerName || '',
    customerPhone: '',
    notes: '',
    status: 'confirmed',
    sync: item.eventId ? 'synced' : 'pending',
    eventId: item.eventId || '',
    syncAttempts: 0,
    nextRetryAt: 0,
    lastSyncError: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function mapCalendarSettings(doc) {
  const base = normalizeSettings(doc);
  const services = (base.services || []).map((service) => ({
    ...service,
    capacity: Math.max(1, Number(service.capacity) || 1)
  }));
  return {
    ...base,
    services,
    exceptions: Array.isArray(doc?.exceptions) ? clone(doc.exceptions) : [],
    // strip legacy busy from settings doc
  };
}

async function migrateClient({
  clientId,
  calendarStore,
  settingsStore,
  appointmentsStore,
  setAgendaEngine
}) {
  const legacy = await calendarStore.getRaw(clientId);
  const existing = await settingsStore.getRaw(clientId);
  const alreadyMigrated = existing.connection?.status === 'connected'
    || (Array.isArray(existing.services) && existing.services.length > 0)
    || existing.enabled === true;

  if (!alreadyMigrated || legacy.enabled || legacy.connection?.status === 'connected') {
    const mapped = mapCalendarSettings(legacy);
    await settingsStore.transaction(clientId, () => mapped);
  }

  const busy = Array.isArray(legacy.busy) ? legacy.busy : [];
  for (const item of busy) {
    const appointment = mapBusyToAppointment(item);
    if (!appointment) continue;
    const current = await appointmentsStore.get(clientId, appointment.id);
    if (current) continue;
    await appointmentsStore.runTransaction(clientId, async (tx) => {
      await tx.set(appointment.id, appointment);
    });
  }

  if (typeof setAgendaEngine === 'function') {
    await setAgendaEngine(clientId, 'v2');
  }
  return { clientId, appointments: busy.filter((item) => item?.status === 'confirmed').length };
}

module.exports = {
  mapBusyToAppointment,
  mapCalendarSettings,
  migrateClient
};
