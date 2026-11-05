const crypto = require('crypto');
const { isSlotOpen } = require('./availability');

function newAppointmentId() {
  return `apt_${crypto.randomBytes(8).toString('hex')}`;
}

async function bookAppointment({
  appointmentsStore,
  clientId,
  service,
  start,
  end,
  customerName,
  customerPhone = '',
  notes = '',
  googleBusy = [],
  rules,
  excludeAppointmentId = null
}) {
  const startIso = start instanceof Date ? start.toISOString() : String(start);
  const endIso = end instanceof Date ? end.toISOString() : String(end);
  const appointmentId = newAppointmentId();

  return appointmentsStore.runTransaction(clientId, async (tx) => {
    const confirmed = await tx.listConfirmed();
    const open = isSlotOpen({
      start: new Date(startIso),
      end: new Date(endIso),
      service,
      rules,
      appointments: confirmed,
      googleBusy,
      excludeAppointmentId
    });
    if (!open) {
      return { ok: false, code: 'slot_full' };
    }
    const nowIso = new Date().toISOString();
    const appointment = {
      id: appointmentId,
      serviceId: service.id,
      start: startIso,
      end: endIso,
      customerName,
      customerPhone,
      notes,
      status: 'confirmed',
      sync: 'pending',
      eventId: '',
      syncAttempts: 0,
      nextRetryAt: 0,
      lastSyncError: '',
      createdAt: nowIso,
      updatedAt: nowIso
    };
    await tx.set(appointmentId, appointment);
    return { ok: true, appointment };
  });
}

async function rescheduleAppointmentRecord({
  appointmentsStore,
  clientId,
  appointmentId,
  service,
  start,
  end,
  googleBusy = [],
  rules
}) {
  const startIso = start instanceof Date ? start.toISOString() : String(start);
  const endIso = end instanceof Date ? end.toISOString() : String(end);

  return appointmentsStore.runTransaction(clientId, async (tx) => {
    const current = await tx.get(appointmentId);
    if (!current || current.status !== 'confirmed') {
      return { ok: false, code: 'not_found' };
    }
    const confirmed = await tx.listConfirmed();
    const open = isSlotOpen({
      start: new Date(startIso),
      end: new Date(endIso),
      service,
      rules,
      appointments: confirmed,
      googleBusy,
      excludeAppointmentId: appointmentId
    });
    if (!open) return { ok: false, code: 'slot_full' };
    const updated = {
      ...current,
      start: startIso,
      end: endIso,
      sync: 'pending',
      lastSyncError: '',
      updatedAt: new Date().toISOString()
    };
    await tx.set(appointmentId, updated);
    return { ok: true, appointment: updated };
  });
}

async function cancelAppointmentRecord({ appointmentsStore, clientId, appointmentId }) {
  return appointmentsStore.runTransaction(clientId, async (tx) => {
    const current = await tx.get(appointmentId);
    if (!current || current.status !== 'confirmed') {
      return { ok: false, code: 'not_found' };
    }
    const updated = {
      ...current,
      status: 'cancelled',
      sync: current.eventId ? 'pending' : 'synced',
      updatedAt: new Date().toISOString()
    };
    await tx.set(appointmentId, updated);
    return { ok: true, appointment: updated };
  });
}

module.exports = {
  newAppointmentId,
  bookAppointment,
  rescheduleAppointmentRecord,
  cancelAppointmentRecord
};
