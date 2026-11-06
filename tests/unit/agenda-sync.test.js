const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');
const { MemorySettingsStore } = require('../../src/services/configuracion/agenda/settingsStore');
const { SYNC_BACKOFF_MS } = require('../../src/services/configuracion/agenda/constants');
const {
  syncOneAppointment,
  processClientSyncQueue,
  processSyncQueue,
  nextSyncBackoffMs,
  MAX_SYNC_ATTEMPTS
} = require('../../src/services/configuracion/agenda/syncWorker');

function baseApt(overrides = {}) {
  return {
    id: 'apt_1', serviceId: 'svc_a', start: '2026-11-09T15:00:00.000Z', end: '2026-11-09T15:30:00.000Z',
    customerName: 'Ana', status: 'confirmed', sync: 'pending', eventId: '', syncAttempts: 0, nextRetryAt: 0,
    ...overrides
  };
}

async function seed(store, apt, clientId = 'C1') {
  await store.runTransaction(clientId, async (tx) => { tx.set(apt.id, apt); });
}

function args(store, apt, google, extra = {}) {
  return {
    google,
    token: 't',
    calendarId: 'primary',
    timeZone: 'America/Mexico_City',
    clientId: 'C1',
    service: { id: 'svc_a', name: 'Consulta', durationMinutes: 30 },
    appointment: apt,
    appointmentsStore: store,
    ...extra
  };
}

describe('agenda sync', () => {
  it('marks synced with eventId on create', async () => {
    const store = new MemoryAppointmentsStore();
    const apt = baseApt();
    await seed(store, apt);
    const google = { createEvent: jest.fn().mockResolvedValue({ id: 'g_evt' }) };
    const result = await syncOneAppointment(args(store, apt, google));
    expect(result.ok).toBe(true);
    const saved = await store.get('C1', 'apt_1');
    expect(saved.sync).toBe('synced');
    expect(saved.eventId).toBe('g_evt');
    const [token, calendarId, body] = google.createEvent.mock.calls[0];
    expect(token).toBe('t');
    expect(calendarId).toBe('primary');
    expect(body.summary).toContain('Consulta');
    expect(body.extendedProperties.private.appointmentId).toBe('apt_1');
  });

  it('keeps reservation and schedules retry on google error', async () => {
    const store = new MemoryAppointmentsStore();
    const apt = baseApt({ id: 'apt_2' });
    await seed(store, apt);
    const google = { createEvent: jest.fn().mockRejectedValue(new Error('boom')) };
    const nowMs = Date.parse('2026-11-09T10:00:00.000Z');
    await syncOneAppointment(args(store, apt, google, { nowMs }));
    const saved = await store.get('C1', 'apt_2');
    expect(saved.status).toBe('confirmed');
    expect(saved.sync).toBe('retry');
    expect(saved.syncAttempts).toBe(1);
    expect(saved.lastSyncError).toBeTruthy();
    expect(Date.parse(saved.nextRetryAt)).toBe(nowMs + nextSyncBackoffMs(0));
  });

  it('updates existing event for a rescheduled appointment', async () => {
    const store = new MemoryAppointmentsStore();
    const apt = baseApt({ id: 'apt_3', eventId: 'g_old' });
    await seed(store, apt);
    const google = { createEvent: jest.fn(), updateEvent: jest.fn().mockResolvedValue({ id: 'g_old' }) };
    const result = await syncOneAppointment(args(store, apt, google));
    expect(result.ok).toBe(true);
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.updateEvent.mock.calls[0][2]).toBe('g_old');
    const saved = await store.get('C1', 'apt_3');
    expect(saved.sync).toBe('synced');
    expect(saved.eventId).toBe('g_old');
  });

  it('deletes the google event of a cancelled appointment and clears eventId', async () => {
    const store = new MemoryAppointmentsStore();
    const apt = baseApt({ id: 'apt_4', status: 'cancelled', eventId: 'g_del' });
    await seed(store, apt);
    const google = { deleteEvent: jest.fn().mockResolvedValue(undefined) };
    const result = await syncOneAppointment(args(store, apt, google));
    expect(result.ok).toBe(true);
    expect(google.deleteEvent).toHaveBeenCalledWith('t', 'primary', 'g_del');
    const saved = await store.get('C1', 'apt_4');
    expect(saved.status).toBe('cancelled');
    expect(saved.sync).toBe('synced');
    expect(saved.eventId).toBe('');
  });

  it('keeps eventId and retries when delete fails', async () => {
    const store = new MemoryAppointmentsStore();
    const apt = baseApt({ id: 'apt_5', status: 'cancelled', eventId: 'g_del' });
    await seed(store, apt);
    const google = { deleteEvent: jest.fn().mockRejectedValue(new Error('down')) };
    await syncOneAppointment(args(store, apt, google));
    const saved = await store.get('C1', 'apt_5');
    expect(saved.sync).toBe('retry');
    expect(saved.eventId).toBe('g_del');
    expect(saved.syncAttempts).toBe(1);
  });

  it('treats cancelled with empty eventId as already synced without calling google', async () => {
    const store = new MemoryAppointmentsStore();
    const apt = baseApt({ id: 'apt_6', status: 'cancelled', eventId: '' });
    await seed(store, apt);
    const google = { createEvent: jest.fn(), deleteEvent: jest.fn() };
    const result = await syncOneAppointment(args(store, apt, google));
    expect(result.ok).toBe(true);
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.deleteEvent).not.toHaveBeenCalled();
    expect((await store.get('C1', 'apt_6')).sync).toBe('synced');
  });

  it('does not mark synced if the appointment was cancelled while creating the event', async () => {
    const store = new MemoryAppointmentsStore();
    const apt = baseApt({ id: 'apt_7' });
    await seed(store, apt);
    const google = {
      createEvent: jest.fn().mockImplementation(async () => {
        await store.update('C1', 'apt_7', { status: 'cancelled', sync: 'pending' });
        return { id: 'g_late' };
      })
    };
    await syncOneAppointment(args(store, apt, google));
    const saved = await store.get('C1', 'apt_7');
    expect(saved.status).toBe('cancelled');
    expect(saved.eventId).toBe('g_late');
    expect(saved.sync).toBe('pending');
  });

  it('stops retrying after MAX_SYNC_ATTEMPTS', async () => {
    const store = new MemoryAppointmentsStore();
    const apt = baseApt({ id: 'apt_8', sync: 'retry', syncAttempts: MAX_SYNC_ATTEMPTS - 1 });
    await seed(store, apt);
    const google = { createEvent: jest.fn().mockRejectedValue(new Error('boom')) };
    await syncOneAppointment(args(store, apt, google));
    const saved = await store.get('C1', 'apt_8');
    expect(saved.sync).toBe('failed');
    expect(saved.status).toBe('confirmed');
    expect(saved.syncAttempts).toBe(MAX_SYNC_ATTEMPTS);
  });

  it('backoff follows constants and caps at the last step', () => {
    expect(MAX_SYNC_ATTEMPTS).toBe(12);
    expect(nextSyncBackoffMs(0)).toBe(SYNC_BACKOFF_MS[0]);
    expect(nextSyncBackoffMs(999)).toBe(SYNC_BACKOFF_MS[SYNC_BACKOFF_MS.length - 1]);
    expect(nextSyncBackoffMs(-1)).toBe(SYNC_BACKOFF_MS[0]);
  });
});

describe('agenda sync queue', () => {
  async function setup({ connected = true } = {}) {
    const settingsStore = new MemorySettingsStore();
    await settingsStore.transaction('C1', (doc) => ({
      ...doc,
      enabled: true,
      timezone: 'America/Mexico_City',
      connection: { ...doc.connection, status: connected ? 'connected' : 'revoked', email: 'a@b.c', calendarId: 'cal1' },
      services: [{ id: 'svc_a', name: 'Consulta', durationMinutes: 30 }]
    }));
    const appointmentsStore = new MemoryAppointmentsStore();
    return { settingsStore, appointmentsStore };
  }

  it('processes due rows for a client and skips rows not yet due', async () => {
    const { settingsStore, appointmentsStore } = await setup();
    const nowMs = Date.parse('2026-11-09T10:00:00.000Z');
    await seed(appointmentsStore, baseApt({ id: 'a1' }));
    await seed(appointmentsStore, baseApt({
      id: 'a2', sync: 'retry', syncAttempts: 1, nextRetryAt: new Date(nowMs + 60000).toISOString()
    }));
    const google = { createEvent: jest.fn().mockResolvedValue({ id: 'g1' }) };
    const ensureAccessToken = jest.fn().mockResolvedValue('tok');
    const res = await processClientSyncQueue({
      clientId: 'C1', settingsStore, appointmentsStore, google, ensureAccessToken, nowMs
    });
    expect(res.processed).toBe(1);
    expect(google.createEvent).toHaveBeenCalledTimes(1);
    expect(google.createEvent.mock.calls[0][1]).toBe('cal1');
    expect((await appointmentsStore.get('C1', 'a1')).sync).toBe('synced');
    expect((await appointmentsStore.get('C1', 'a2')).sync).toBe('retry');
  });

  it('does not touch the google token when nothing is due', async () => {
    const { settingsStore, appointmentsStore } = await setup();
    const ensureAccessToken = jest.fn();
    const res = await processClientSyncQueue({
      clientId: 'C1', settingsStore, appointmentsStore, google: {}, ensureAccessToken
    });
    expect(res.processed).toBe(0);
    expect(ensureAccessToken).not.toHaveBeenCalled();
  });

  it('on token failure schedules retry without burning attempts', async () => {
    const { settingsStore, appointmentsStore } = await setup();
    await seed(appointmentsStore, baseApt({ id: 'a1' }));
    const nowMs = Date.parse('2026-11-09T10:00:00.000Z');
    const ensureAccessToken = jest.fn().mockRejectedValue(new Error('revoked'));
    await processClientSyncQueue({
      clientId: 'C1', settingsStore, appointmentsStore, google: {}, ensureAccessToken, nowMs
    });
    const saved = await appointmentsStore.get('C1', 'a1');
    expect(saved.sync).toBe('retry');
    expect(saved.syncAttempts).toBe(0);
    expect(saved.lastSyncError).toContain('revoked');
    expect(Date.parse(saved.nextRetryAt)).toBeGreaterThan(nowMs);
  });

  it('skips clients whose calendar is not connected', async () => {
    const { settingsStore, appointmentsStore } = await setup({ connected: false });
    await seed(appointmentsStore, baseApt({ id: 'a1' }));
    const google = { createEvent: jest.fn() };
    const ensureAccessToken = jest.fn();
    const res = await processClientSyncQueue({
      clientId: 'C1', settingsStore, appointmentsStore, google, ensureAccessToken
    });
    expect(res.skipped).toBe(true);
    expect(google.createEvent).not.toHaveBeenCalled();
    expect((await appointmentsStore.get('C1', 'a1')).sync).toBe('pending');
  });

  it('processSyncQueue iterates all clients and survives one client failing', async () => {
    const { settingsStore, appointmentsStore } = await setup();
    await seed(appointmentsStore, baseApt({ id: 'a1' }), 'BAD');
    await seed(appointmentsStore, baseApt({ id: 'a1' }), 'C1');
    const google = { createEvent: jest.fn().mockResolvedValue({ id: 'g1' }) };
    const origGetRaw = settingsStore.getRaw.bind(settingsStore);
    settingsStore.getRaw = async (id) => {
      if (id === 'BAD') throw new Error('settings down');
      return origGetRaw(id);
    };
    const res = await processSyncQueue({
      settingsStore, appointmentsStore, google, ensureAccessToken: async () => 'tok'
    });
    expect(res.clients).toBe(2);
    expect(res.errors).toBe(1);
    expect((await appointmentsStore.get('C1', 'a1')).sync).toBe('synced');
  });
});
