const { SYNC_BACKOFF_MS } = require('./constants');
const { calendarDateTime } = require('./time');

const MAX_SYNC_ATTEMPTS = 12;
const MAX_ERROR_LENGTH = 300;

/** Claves clientId:appointmentId en curso dentro de este proceso (evita eventos duplicados). */
const inFlight = new Set();

const SYNCABLE = new Set(['pending', 'retry']);

function nextSyncBackoffMs(attemptIndex) {
  const last = SYNC_BACKOFF_MS.length - 1;
  const index = Math.min(Math.max(Number(attemptIndex) || 0, 0), last);
  return SYNC_BACKOFF_MS[index];
}

function toMs(value, fallback = Date.now()) {
  if (typeof value === 'function') return toMs(value(), fallback);
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function errorText(error) {
  const text = String(error?.message || error || 'Error de sincronización').trim();
  return text.slice(0, MAX_ERROR_LENGTH) || 'Error de sincronización';
}

function sameSlot(a, b) {
  return a.status === b.status
    && Date.parse(a.start) === Date.parse(b.start)
    && Date.parse(a.end) === Date.parse(b.end);
}

function eventBody({ service, appointment, timeZone, clientId }) {
  const serviceName = service?.name || appointment.serviceName || 'Cita';
  const customerName = appointment.customerName || '';
  const duration = service?.durationMinutes
    || Math.round((Date.parse(appointment.end) - Date.parse(appointment.start)) / 60000);
  return {
    summary: customerName ? `${serviceName} · ${customerName}` : serviceName,
    description: [
      'Cita creada por Intelekia.',
      `Servicio: ${serviceName} (${duration} min)`,
      customerName ? `Cliente: ${customerName}` : '',
      appointment.customerAddress ? `Dirección: ${appointment.customerAddress}` : '',
      appointment.customerPhone ? `WhatsApp: ${appointment.customerPhone}` : '',
      appointment.notes ? `Notas: ${appointment.notes}` : ''
    ].filter(Boolean).join('\n'),
    start: { dateTime: new Date(appointment.start).toISOString(), timeZone },
    end: { dateTime: new Date(appointment.end).toISOString(), timeZone },
    extendedProperties: {
      private: {
        intelekiaClientId: String(clientId),
        appointmentId: String(appointment.id),
        serviceId: String(appointment.serviceId || service?.id || '')
      }
    }
  };
}

/**
 * Persiste el resultado dentro de una transacción. Si la cita cambió mientras se hablaba con Google
 * (cancelada o reprogramada), no se marca synced: queda pending para que la siguiente pasada la reconcilie.
 *
 * Conflicto: otra sincronización ya resolvió la fila (cambió el eventId o dejó de estar pending/retry).
 * En ese caso no se escribe nada: un resultado viejo nunca pisa una fila más nueva.
 * Devuelve { row, conflict }.
 */
async function writeOutcome({ appointmentsStore, clientId, appointment, build }) {
  return appointmentsStore.runTransaction(clientId, async (tx) => {
    const current = await tx.get(appointment.id);
    if (!current) return { row: null, conflict: false };
    const conflict = (current.eventId || '') !== (appointment.eventId || '')
      || !SYNCABLE.has(current.sync);
    if (conflict) return { row: current, conflict: true };
    const changed = !sameSlot(current, appointment);
    const patch = build(current, changed);
    if (!patch) return { row: current, conflict: false };
    const next = { ...current, ...patch, id: appointment.id, updatedAt: new Date().toISOString() };
    tx.set(appointment.id, next);
    return { row: next, conflict: false };
  });
}

const PENDING_AGAIN = { sync: 'pending', syncAttempts: 0, nextRetryAt: null, lastSyncError: '' };

async function markSynced(ctx, eventId) {
  return writeOutcome({
    ...ctx,
    build: (current, changed) => {
      if (changed) return { ...PENDING_AGAIN, eventId };
      return { sync: 'synced', eventId, syncAttempts: 0, nextRetryAt: null, lastSyncError: '' };
    }
  });
}

async function markFailed(ctx, error, nowMs) {
  const message = errorText(error);
  await writeOutcome({
    ...ctx,
    build: (current, changed) => {
      if (changed) return null; // la fila ya fue re-encolada por el cambio
      const attempts = (Number(current.syncAttempts) || 0) + 1;
      if (attempts >= MAX_SYNC_ATTEMPTS) {
        return { sync: 'failed', syncAttempts: attempts, nextRetryAt: null, lastSyncError: message };
      }
      return {
        sync: 'retry',
        syncAttempts: attempts,
        nextRetryAt: new Date(nowMs + nextSyncBackoffMs(attempts - 1)).toISOString(),
        lastSyncError: message
      };
    }
  });
}

/**
 * Sincroniza una cita con Google Calendar. Nunca lanza por errores de Google:
 * la reserva local se conserva y se agenda un reintento. La confirmación al cliente no depende de esto.
 */
async function syncOneAppointment({
  google,
  token,
  calendarId,
  timeZone,
  clientId,
  service,
  appointment,
  appointmentsStore,
  nowMs
}) {
  const now = toMs(nowMs);
  const key = `${clientId}:${appointment.id}`;
  if (inFlight.has(key)) return { ok: false, skipped: true };
  inFlight.add(key);
  let ctx = { appointmentsStore, clientId, appointment };
  try {
    // El snapshot de la cola puede estar viejo (otra sincronización pudo resolver la fila): se relee.
    const fresh = await appointmentsStore.get(clientId, appointment.id);
    if (!fresh) return { ok: false, skipped: true, reason: 'missing' };
    if (!SYNCABLE.has(fresh.sync)) return { ok: false, skipped: true, reason: 'not_pending' };
    appointment = fresh;
    ctx = { appointmentsStore, clientId, appointment };
    const eventId = appointment.eventId || '';

    if (appointment.status === 'cancelled') {
      if (!eventId) {
        await writeOutcome({
          ...ctx,
          build: () => ({ sync: 'synced', syncAttempts: 0, nextRetryAt: null, lastSyncError: '' })
        });
        return { ok: true, action: 'none' };
      }
      await google.deleteEvent(token, calendarId, eventId);
      await writeOutcome({
        ...ctx,
        build: () => ({ sync: 'synced', eventId: '', syncAttempts: 0, nextRetryAt: null, lastSyncError: '' })
      });
      return { ok: true, action: 'deleted' };
    }

    const body = eventBody({ service, appointment, timeZone, clientId });
    let action = 'created';
    let savedId = eventId;
    if (eventId) {
      try {
        const updated = await google.updateEvent(token, calendarId, eventId, body);
        savedId = updated?.id || eventId;
        action = 'updated';
      } catch (error) {
        // El evento fue borrado a mano en Google: se vuelve a crear.
        if (error?.status !== 404 && error?.status !== 410) throw error;
        const created = await google.createEvent(token, calendarId, body);
        savedId = created?.id || '';
      }
    } else {
      const created = await google.createEvent(token, calendarId, body);
      savedId = created?.id || '';
    }
    if (!savedId) throw new Error('Google no devolvió el id del evento');
    const outcome = await markSynced(ctx, savedId);
    if (outcome?.conflict) {
      // Otra sincronización ya resolvió la fila: el evento recién creado quedaría huérfano.
      if (action === 'created' && savedId !== (outcome.row?.eventId || '')) {
        try {
          await google.deleteEvent(token, calendarId, savedId);
        } catch (_error) {
          // Mejor esfuerzo: no debe tumbar la sincronización.
        }
      }
      return { ok: false, skipped: true, reason: 'conflict' };
    }
    return { ok: true, action, eventId: savedId };
  } catch (error) {
    try {
      await markFailed(ctx, error, now);
    } catch (writeError) {
      return { ok: false, error: errorText(error), writeError: errorText(writeError) };
    }
    return { ok: false, error: errorText(error) };
  } finally {
    inFlight.delete(key);
  }
}

function findService(services, appointment) {
  return (services || []).find((item) => item.id === appointment.serviceId) || null;
}

/** Token no disponible: reprograma sin consumir intentos (reconectar Google no debe agotarlos). */
async function deferForToken({ appointmentsStore, clientId, rows, error, nowMs }) {
  const message = errorText(error);
  for (const row of rows) {
    const index = Math.max((Number(row.syncAttempts) || 0) - 1, 0);
    await appointmentsStore.update(clientId, row.id, {
      sync: 'retry',
      nextRetryAt: new Date(nowMs + nextSyncBackoffMs(index)).toISOString(),
      lastSyncError: message
    });
  }
}

async function processClientSyncQueue({
  clientId,
  settingsStore,
  appointmentsStore,
  google,
  ensureAccessToken,
  listServices,
  now,
  nowMs
}) {
  const at = toMs(nowMs ?? now);
  const due = await appointmentsStore.listSyncDue(clientId, at);
  const result = { clientId, processed: 0, synced: 0, failed: 0, skipped: false };
  if (!due.length) return result;

  // Canceladas sin evento ya están sincronizadas: no requieren Google.
  const needsGoogle = [];
  for (const row of due) {
    if (row.status === 'cancelled' && !row.eventId) {
      const out = await syncOneAppointment({
        google, token: null, calendarId: '', timeZone: '', clientId, service: null,
        appointment: row, appointmentsStore, nowMs: at
      });
      if (out.skipped) continue;
      result.processed += 1;
      if (out.ok) result.synced += 1;
    } else {
      needsGoogle.push(row);
    }
  }
  if (!needsGoogle.length) return result;

  const doc = await settingsStore.getRaw(clientId);
  const calendarId = doc.connection?.calendarId;
  if (doc.connection?.status !== 'connected' || !calendarId) {
    return { ...result, skipped: true };
  }

  let token;
  try {
    token = await ensureAccessToken(clientId);
  } catch (error) {
    await deferForToken({ appointmentsStore, clientId, rows: needsGoogle, error, nowMs: at });
    return { ...result, skipped: true, error: errorText(error) };
  }

  const services = typeof listServices === 'function'
    ? await listServices(clientId, doc)
    : doc.services;

  for (const row of needsGoogle) {
    const out = await syncOneAppointment({
      google,
      token,
      calendarId,
      timeZone: doc.timezone,
      clientId,
      service: findService(services, row),
      appointment: row,
      appointmentsStore,
      nowMs: at
    });
    if (out.skipped) continue;
    result.processed += 1;
    if (out.ok) result.synced += 1;
    else result.failed += 1;
  }
  return result;
}

/** Recorre todos los clientes con citas; el fallo de uno no detiene a los demás. */
async function processSyncQueue({
  settingsStore,
  appointmentsStore,
  google,
  ensureAccessToken,
  listServices,
  now,
  nowMs,
  logger = console
}) {
  const clientIds = await appointmentsStore.listAllClientIds();
  const summary = { clients: clientIds.length, processed: 0, synced: 0, failed: 0, errors: 0 };
  for (const clientId of clientIds) {
    try {
      const res = await processClientSyncQueue({
        clientId, settingsStore, appointmentsStore, google, ensureAccessToken, listServices, now, nowMs
      });
      summary.processed += res.processed;
      summary.synced += res.synced;
      summary.failed += res.failed;
    } catch (error) {
      summary.errors += 1;
      logger?.error?.(`[agenda-sync] ${clientId}: ${errorText(error)}`);
    }
  }
  return summary;
}

module.exports = {
  MAX_SYNC_ATTEMPTS,
  nextSyncBackoffMs,
  syncOneAppointment,
  processClientSyncQueue,
  processSyncQueue
};
