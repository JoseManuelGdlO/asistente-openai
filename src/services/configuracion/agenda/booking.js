const crypto = require('crypto');
const { CAPACITY_MIN, CAPACITY_MAX } = require('./constants');
const { countOccupancy } = require('./availability');

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function capacityOf(service) {
  const number = Number(service?.capacity ?? 1);
  if (!Number.isInteger(number)) return CAPACITY_MIN;
  return Math.min(CAPACITY_MAX, Math.max(CAPACITY_MIN, number));
}

function bufferMsOf(rules) {
  return Math.max(0, Number(rules?.bufferMinutes) || 0) * 60000;
}

/** Ids de eventos de Google que pertenecen a citas propias confirmadas (evita contar el espejo dos veces). */
function ownEventIdsFrom(confirmed) {
  const ids = new Set();
  for (const row of confirmed || []) {
    if (row?.eventId) ids.add(row.eventId);
  }
  return ids;
}

function newAppointmentId() {
  return `apt_${crypto.randomBytes(8).toString('hex')}`;
}

function hasValidRange(start, end) {
  const s = toDate(start).getTime();
  const e = toDate(end).getTime();
  return Number.isFinite(s) && Number.isFinite(e) && e > s;
}

function isFull({ confirmed, googleBusy, service, rules, start, end, excludeAppointmentId }) {
  const occupied = countOccupancy({
    startMs: toDate(start).getTime(),
    endMs: toDate(end).getTime(),
    appointments: confirmed,
    googleBusy: googleBusy || [],
    ownEventIds: ownEventIdsFrom(confirmed),
    bufferMs: bufferMsOf(rules),
    excludeAppointmentId: excludeAppointmentId || null
  });
  return occupied >= capacityOf(service);
}

/**
 * Reserva transaccional: verifica capacidad dentro de la transacción y escribe la cita.
 * La cita queda confirmed + sync:'pending'; la sincronización con Google es posterior.
 */
async function bookAppointment({
  appointmentsStore,
  clientId,
  service,
  start,
  end,
  customerName = '',
  customerPhone = '',
  notes = '',
  googleBusy = [],
  rules = {},
  excludeAppointmentId = null
}) {
  if (!hasValidRange(start, end)) return { ok: false, code: 'invalid_range' };
  const id = newAppointmentId();
  const startIso = toDate(start).toISOString();
  const endIso = toDate(end).toISOString();

  return appointmentsStore.runTransaction(clientId, async (tx) => {
    const confirmed = await tx.listConfirmed();
    if (isFull({ confirmed, googleBusy, service, rules, start, end, excludeAppointmentId })) {
      return { ok: false, code: 'slot_full' };
    }
    const nowIso = new Date().toISOString();
    const appointment = {
      id,
      clientId,
      serviceId: service?.id || '',
      serviceName: service?.name || '',
      start: startIso,
      end: endIso,
      customerName: String(customerName || '').trim(),
      customerPhone: String(customerPhone || '').trim(),
      notes: String(notes || '').trim(),
      status: 'confirmed',
      sync: 'pending',
      eventId: '',
      syncAttempts: 0,
      nextRetryAt: null,
      lastSyncError: '',
      createdAt: nowIso,
      updatedAt: nowIso
    };
    tx.set(id, appointment);
    return { ok: true, appointment };
  });
}

/**
 * Mueve una cita confirmada a otro horario. Ignora su propio hueco y su evento espejo.
 * Conserva eventId (el worker actualizará el evento) y vuelve a sync:'pending'.
 */
async function rescheduleAppointmentRecord({
  appointmentsStore,
  clientId,
  appointmentId,
  service,
  start,
  end,
  googleBusy = [],
  rules = {}
}) {
  if (!hasValidRange(start, end)) return { ok: false, code: 'invalid_range' };
  const startIso = toDate(start).toISOString();
  const endIso = toDate(end).toISOString();

  return appointmentsStore.runTransaction(clientId, async (tx) => {
    const current = await tx.get(appointmentId);
    if (!current || current.status !== 'confirmed') return { ok: false, code: 'not_found' };
    const confirmed = await tx.listConfirmed();
    if (isFull({
      confirmed, googleBusy, service, rules, start, end, excludeAppointmentId: appointmentId
    })) {
      return { ok: false, code: 'slot_full' };
    }
    const appointment = {
      ...current,
      serviceId: service?.id || current.serviceId || '',
      serviceName: service?.name || current.serviceName || '',
      start: startIso,
      end: endIso,
      status: 'confirmed',
      sync: 'pending',
      syncAttempts: 0,
      nextRetryAt: null,
      lastSyncError: '',
      updatedAt: new Date().toISOString()
    };
    tx.set(appointmentId, appointment);
    return { ok: true, appointment };
  });
}

/** Cancela conservando la fila (status:'cancelled') y marca sync:'pending' para borrar el evento. */
async function cancelAppointmentRecord({ appointmentsStore, clientId, appointmentId }) {
  return appointmentsStore.runTransaction(clientId, async (tx) => {
    const current = await tx.get(appointmentId);
    if (!current) return { ok: false, code: 'not_found' };
    if (current.status === 'cancelled') return { ok: true, appointment: current };
    const appointment = {
      ...current,
      status: 'cancelled',
      sync: 'pending',
      syncAttempts: 0,
      nextRetryAt: null,
      lastSyncError: '',
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    tx.set(appointmentId, appointment);
    return { ok: true, appointment };
  });
}

module.exports = {
  bookAppointment,
  rescheduleAppointmentRecord,
  cancelAppointmentRecord,
  ownEventIdsFrom
};
