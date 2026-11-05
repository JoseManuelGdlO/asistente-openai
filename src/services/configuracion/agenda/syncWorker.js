const { nextSyncBackoffMs, MAX_SYNC_ATTEMPTS } = require('./constants');

function eventBody({ service, appointment, timeZone, clientId }) {
  return {
    summary: `${service?.name || 'Cita'} · ${appointment.customerName}`,
    description: [
      'Cita creada por Intelekia.',
      service ? `Servicio: ${service.name} (${service.durationMinutes} min)` : '',
      `Cliente: ${appointment.customerName}`,
      appointment.customerPhone ? `WhatsApp: ${appointment.customerPhone}` : '',
      appointment.notes ? `Notas: ${appointment.notes}` : ''
    ].filter(Boolean).join('\n'),
    start: { dateTime: appointment.start, timeZone },
    end: { dateTime: appointment.end, timeZone },
    extendedProperties: {
      private: {
        intelekiaClientId: String(clientId),
        appointmentId: String(appointment.id),
        serviceId: String(appointment.serviceId || '')
      }
    }
  };
}

async function syncOneAppointment({
  google,
  token,
  calendarId,
  timeZone,
  clientId,
  service,
  appointment,
  appointmentsStore,
  nowMs = Date.now()
}) {
  try {
    if (appointment.status === 'cancelled') {
      if (appointment.eventId) {
        await google.deleteEvent(token, calendarId, appointment.eventId);
      }
      await appointmentsStore.runTransaction(clientId, async (tx) => {
        const current = await tx.get(appointment.id);
        if (!current) return;
        await tx.set(appointment.id, {
          ...current,
          eventId: '',
          sync: 'synced',
          lastSyncError: '',
          updatedAt: new Date(nowMs).toISOString()
        });
      });
      return { ok: true, action: 'deleted' };
    }

    if (appointment.eventId) {
      const updated = await google.updateEvent(
        token,
        calendarId,
        appointment.eventId,
        eventBody({ service, appointment, timeZone, clientId })
      );
      await appointmentsStore.runTransaction(clientId, async (tx) => {
        const current = await tx.get(appointment.id);
        if (!current) return;
        await tx.set(appointment.id, {
          ...current,
          eventId: updated.id || current.eventId,
          sync: 'synced',
          lastSyncError: '',
          updatedAt: new Date(nowMs).toISOString()
        });
      });
      return { ok: true, action: 'updated' };
    }

    const created = await google.createEvent(
      token,
      calendarId,
      eventBody({ service, appointment, timeZone, clientId })
    );
    await appointmentsStore.runTransaction(clientId, async (tx) => {
      const current = await tx.get(appointment.id);
      if (!current) return;
      await tx.set(appointment.id, {
        ...current,
        eventId: created.id || '',
        sync: 'synced',
        lastSyncError: '',
        syncAttempts: 0,
        nextRetryAt: 0,
        updatedAt: new Date(nowMs).toISOString()
      });
    });
    return { ok: true, action: 'created', eventId: created.id || '' };
  } catch (error) {
    const attempts = (Number(appointment.syncAttempts) || 0) + 1;
    const retryAt = nowMs + nextSyncBackoffMs(attempts - 1);
    await appointmentsStore.runTransaction(clientId, async (tx) => {
      const current = await tx.get(appointment.id);
      if (!current) return;
      await tx.set(appointment.id, {
        ...current,
        sync: attempts >= MAX_SYNC_ATTEMPTS ? 'retry' : 'retry',
        syncAttempts: attempts,
        nextRetryAt: retryAt,
        lastSyncError: error.message || 'Error de sync',
        updatedAt: new Date(nowMs).toISOString()
      });
    });
    return { ok: false, error, attempts };
  }
}

async function processClientSyncQueue({
  clientId,
  settings,
  appointmentsStore,
  google,
  ensureAccessToken,
  nowMs = Date.now(),
  limit = 20
}) {
  if (!settings?.connection?.calendarId) return { processed: 0, results: [] };
  const due = await appointmentsStore.listSyncDue(clientId, nowMs, limit);
  if (!due.length) return { processed: 0, results: [] };
  const token = await ensureAccessToken(clientId);
  const timeZone = settings.connection.timezone || 'America/Mexico_City';
  const results = [];
  for (const appointment of due) {
    const service = (settings.services || []).find((item) => item.id === appointment.serviceId) || null;
    const result = await syncOneAppointment({
      google,
      token,
      calendarId: settings.connection.calendarId,
      timeZone,
      clientId,
      service,
      appointment,
      appointmentsStore,
      nowMs
    });
    results.push({ appointmentId: appointment.id, ...result });
  }
  return { processed: results.length, results };
}

module.exports = {
  eventBody,
  syncOneAppointment,
  processClientSyncQueue
};
