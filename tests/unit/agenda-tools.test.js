const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');
const { MemorySettingsStore } = require('../../src/services/configuracion/agenda/settingsStore');
const { AgendaService } = require('../../src/services/configuracion/agenda/agendaService');
const { createAgendaService } = require('../../src/services/configuracion/agenda/createAgendaService');
const { signState, verifyState } = require('../../src/services/configuracion/agenda/oauthState');
const {
  toolDefinitions, isAgendaTool, mergeTools, buildInstructions
} = require('../../src/services/configuracion/agenda/tools');

const CLIENT = 'C1';
// Lunes 2026-11-09 06:00 hora de México (UTC-6)
const NOW = new Date('2026-11-09T12:00:00.000Z');
const SLOT_10 = '2026-11-09T10:00';
const SLOT_10_START = '2026-11-09T16:00:00.000Z';
const SLOT_10_END = '2026-11-09T16:30:00.000Z';

function fakeGoogle(overrides = {}) {
  return {
    configured: () => true,
    freeBusy: jest.fn().mockResolvedValue([]),
    createEvent: jest.fn().mockResolvedValue({ id: 'g_evt' }),
    updateEvent: jest.fn().mockResolvedValue({ id: 'g_evt' }),
    deleteEvent: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

async function setup({ google = fakeGoogle(), capacity = 1, docPatch = {} } = {}) {
  const settingsStore = new MemorySettingsStore();
  const appointmentsStore = new MemoryAppointmentsStore();
  await settingsStore.transaction(CLIENT, (doc) => ({
    ...doc,
    enabled: true,
    connection: {
      ...doc.connection,
      status: 'connected',
      email: 'owner@example.com',
      calendarId: 'primary',
      calendarSummary: 'Principal'
    },
    services: [
      { id: 'svc_a', name: 'Consulta', description: '', durationMinutes: 30, capacity, active: true },
      { id: 'svc_off', name: 'Inactivo', description: '', durationMinutes: 30, capacity: 1, active: false }
    ],
    ...docPatch
  }));
  const service = new AgendaService({
    settingsStore, appointmentsStore, google, now: () => NOW, env: {}, tokenOverride: 'tok'
  });
  return { service, settingsStore, appointmentsStore, google };
}

const create = (service, context = { clientId: CLIENT, origin: 'meta', userId: '5215512345678@c.us' }, extra = {}) => (
  service.execute('createAppointment', {
    serviceId: 'svc_a', start: SLOT_10, customerName: 'Ana', notes: null, ...extra
  }, context)
);

describe('agenda tools definitions', () => {
  it('exposes the five bot tools and merges without duplicates', () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.name)).toEqual([
      'listBookingServices', 'getAvailableSlots', 'createAppointment', 'rescheduleAppointment', 'cancelAppointment'
    ]);
    expect(isAgendaTool('createAppointment')).toBe(true);
    expect(isAgendaTool('other')).toBe(false);
    const merged = mergeTools([{ type: 'function', name: 'createAppointment' }, { name: 'x' }], defs);
    expect(merged.filter((t) => t.name === 'createAppointment')).toHaveLength(1);
    expect(merged).toHaveLength(6);
  });

  it('builds instructions with active services only', () => {
    const text = buildInstructions({
      today: '2026-11-09',
      timezone: 'America/Mexico_City',
      rules: { minNoticeMinutes: 60, maxDaysAhead: 30, slotIntervalMinutes: 30, bufferMinutes: 0, allowCancel: true, allowReschedule: true },
      services: [
        { id: 'svc_a', name: 'Consulta', durationMinutes: 30, active: true },
        { id: 'svc_off', name: 'Inactivo', durationMinutes: 30, active: false }
      ]
    });
    expect(text).toContain('svc_a');
    expect(text).not.toContain('svc_off');
  });
});

describe('oauth state', () => {
  it('signs and verifies, rejecting tampering and expiry', () => {
    const exp = Date.now() + 60000;
    const state = signState({ clientId: 'C1', nonce: 'n', exp }, 'secret');
    expect(verifyState(state, 'secret')).toMatchObject({ clientId: 'C1', nonce: 'n' });
    expect(verifyState(`${state}x`, 'secret')).toBeNull();
    expect(verifyState(state, 'other')).toBeNull();
    expect(verifyState(signState({ clientId: 'C1', nonce: 'n', exp: 1 }, 'secret'), 'secret')).toBeNull();
  });
});

describe('agenda service execute', () => {
  it('tells the bot not to invent slots when agenda is not ready', async () => {
    const settingsStore = new MemorySettingsStore();
    const service = new AgendaService({
      settingsStore, appointmentsStore: new MemoryAppointmentsStore(), google: fakeGoogle(), now: () => NOW, env: {}
    });
    const result = await service.execute('getAvailableSlots', { serviceId: 'svc_a', date: null, preferredStart: null }, { clientId: 'X' });
    expect(result.success).toBe(false);
    expect(result.instruction).toMatch(/No ofrezcas horarios/);
  });

  it('lists only active services', async () => {
    const { service } = await setup();
    const result = await service.execute('listBookingServices', {}, { clientId: CLIENT });
    expect(result.success).toBe(true);
    expect(result.services.map((s) => s.id)).toEqual(['svc_a']);
  });

  it('returns slots for a date and excludes taken ones', async () => {
    const { service } = await setup();
    await create(service);
    const result = await service.execute('getAvailableSlots', { serviceId: 'svc_a', date: '2026-11-09', preferredStart: null }, { clientId: CLIENT });
    expect(result.success).toBe(true);
    expect(result.mode).toBe('times');
    const starts = result.slots.map((s) => s.startLocal);
    expect(starts).not.toContain(SLOT_10);
    expect(starts.length).toBeGreaterThan(0);
  });

  it('does not double count the own google mirror of a confirmed appointment', async () => {
    const google = fakeGoogle();
    const { service } = await setup({ google, capacity: 2 });
    const booked = await create(service);
    expect(booked.success).toBe(true);
    // Google devuelve el espejo de la cita propia (eventId g_evt, ya sincronizada)
    google.freeBusy.mockResolvedValue([{ start: SLOT_10_START, end: SLOT_10_END }]);
    const result = await service.execute('getAvailableSlots', { serviceId: 'svc_a', date: '2026-11-09', preferredStart: SLOT_10 }, { clientId: CLIENT });
    expect(result.success).toBe(true);
    expect(result.exact).toBe(true);
    // Y una segunda reserva sigue cabiendo (capacidad 2)
    const second = await create(service, undefined, { customerName: 'Luis' });
    expect(second.success).toBe(true);
  });

  it('offers days when date is null', async () => {
    const { service } = await setup();
    const result = await service.execute('getAvailableSlots', { serviceId: 'svc_a', date: null, preferredStart: null }, { clientId: CLIENT });
    expect(result.mode).toBe('days');
    expect(result.slots[0]).toHaveProperty('date');
  });

  it('rejects unknown or inactive service', async () => {
    const { service } = await setup();
    const result = await service.execute('getAvailableSlots', { serviceId: 'svc_off', date: null, preferredStart: null }, { clientId: CLIENT });
    expect(result.success).toBe(false);
  });
});

describe('agenda createAppointment', () => {
  it('books, syncs to google and returns success with appointmentId', async () => {
    const { service, appointmentsStore, google } = await setup();
    const result = await create(service);
    expect(result.success).toBe(true);
    expect(result.appointmentId).toMatch(/^apt_/);
    expect(result.start).toBe(SLOT_10_START);
    expect(result.syncPending).toBe(false);
    expect(google.createEvent).toHaveBeenCalledTimes(1);
    const saved = await appointmentsStore.get(CLIENT, result.appointmentId);
    expect(saved).toMatchObject({ status: 'confirmed', sync: 'synced', eventId: 'g_evt', customerPhone: '5215512345678' });
  });

  it('still returns success when google sync fails', async () => {
    const google = fakeGoogle({ createEvent: jest.fn().mockRejectedValue(new Error('boom')) });
    const { service, appointmentsStore } = await setup({ google });
    const result = await create(service);
    expect(result.success).toBe(true);
    expect(result.syncPending).toBe(true);
    const saved = await appointmentsStore.get(CLIENT, result.appointmentId);
    expect(saved.status).toBe('confirmed');
    expect(saved.sync).toBe('retry');
  });

  it('still returns success when the token cannot be obtained for sync', async () => {
    const { service, appointmentsStore } = await setup();
    service.ensureAccessToken = jest.fn()
      .mockResolvedValueOnce('tok') // freeBusy
      .mockRejectedValueOnce(new Error('sin token'));
    const result = await create(service);
    expect(result.success).toBe(true);
    expect(result.syncPending).toBe(true);
    const saved = await appointmentsStore.get(CLIENT, result.appointmentId);
    expect(saved.sync).toBe('pending');
  });

  it('capacity race: only one concurrent booking wins and loser gets fresh offerList', async () => {
    const { service, appointmentsStore } = await setup();
    const context = { clientId: CLIENT, origin: 'meta', userId: '1@c.us' };
    const [a, b] = await Promise.all([
      create(service, context, { customerName: 'Ana' }),
      create(service, context, { customerName: 'Luis' })
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.success)).toHaveLength(1);
    const loser = results.find((r) => !r.success);
    expect(loser.code).toBe('slot_full');
    expect(loser.error).toMatch(/ocup/i);
    expect(Array.isArray(loser.offerList)).toBe(true);
    expect(loser.offerList.length).toBeGreaterThan(0);
    expect(loser.offerList.map((s) => s.startLocal)).not.toContain(SLOT_10);
    const rows = await appointmentsStore.listConfirmedInRange(CLIENT, 0, Date.now() + 9e12);
    expect(rows).toHaveLength(1);
  });

  it('respects capacity greater than one', async () => {
    const { service } = await setup({ capacity: 2 });
    const r1 = await create(service);
    const r2 = await create(service, undefined, { customerName: 'Luis' });
    const r3 = await create(service, undefined, { customerName: 'Eva' });
    expect([r1.success, r2.success, r3.success]).toEqual([true, true, false]);
  });

  it('treats google busy blocks as occupancy', async () => {
    const google = fakeGoogle({ freeBusy: jest.fn().mockResolvedValue([{ start: SLOT_10_START, end: SLOT_10_END }]) });
    const { service, appointmentsStore } = await setup({ google });
    const result = await create(service);
    expect(result.success).toBe(false);
    expect(result.code).toBe('slot_full');
    expect(await appointmentsStore.listConfirmedInRange(CLIENT, 0, Date.now() + 9e12)).toHaveLength(0);
  });

  it('requires a customer name and a valid slot', async () => {
    const { service } = await setup();
    expect((await create(service, undefined, { customerName: ' ' })).success).toBe(false);
    expect((await create(service, undefined, { start: 'mañana' })).success).toBe(false);
    // Fuera de horario (sábado)
    expect((await create(service, undefined, { start: '2026-11-14T10:00' })).success).toBe(false);
    // Sin anticipación mínima
    expect((await create(service, undefined, { start: '2026-11-09T06:30' })).success).toBe(false);
  });

  it('honors closed exceptions', async () => {
    const { service } = await setup({
      docPatch: { exceptions: [{ date: '2026-11-09', closed: true, intervals: [], note: '' }] }
    });
    const result = await create(service);
    expect(result.success).toBe(false);
  });

  it('fails without booking when availability cannot be verified', async () => {
    const google = fakeGoogle({ freeBusy: jest.fn().mockRejectedValue(new Error('google caído')) });
    const { service, appointmentsStore } = await setup({ google });
    const result = await create(service);
    expect(result.success).toBe(false);
    expect(await appointmentsStore.listConfirmedInRange(CLIENT, 0, Date.now() + 9e12)).toHaveLength(0);
  });

  it('marks the connection revoked when google reports revoked access', async () => {
    const error = Object.assign(new Error('revocado'), { code: 'revoked' });
    const google = fakeGoogle({ freeBusy: jest.fn().mockRejectedValue(error) });
    const { service, settingsStore } = await setup({ google });
    const result = await create(service);
    expect(result.success).toBe(false);
    expect(result.phase).toBe('revoked');
    expect((await settingsStore.getRaw(CLIENT)).connection.status).toBe('revoked');
  });
});

describe('agenda write origins', () => {
  it.each(['meta', 'ultramsg', 'own'])('writes live for origin %s', async (origin) => {
    const { service } = await setup();
    const result = await create(service, { clientId: CLIENT, origin, userId: '1@c.us' });
    expect(result.success).toBe(true);
  });

  it('playground without playgroundWriteEnabled is dry-run and writes nothing', async () => {
    const { service, appointmentsStore, google } = await setup();
    const result = await create(service, { clientId: CLIENT, origin: 'playground', userId: 'pg' });
    expect(result.success).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.testMode).toBe(true);
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(await appointmentsStore.listConfirmedInRange(CLIENT, 0, Date.now() + 9e12)).toHaveLength(0);
  });

  it('playground with playgroundWriteEnabled books for real', async () => {
    const { service } = await setup({ docPatch: { playgroundWriteEnabled: true } });
    const result = await create(service, { clientId: CLIENT, origin: 'playground', userId: 'pg' });
    expect(result.success).toBe(true);
  });

  it('blocks unknown origins', async () => {
    const { service, appointmentsStore } = await setup();
    const result = await create(service, { clientId: CLIENT, origin: 'something', userId: 'x' });
    expect(result.success).toBe(false);
    expect(result.dryRun).toBeUndefined();
    expect(await appointmentsStore.listConfirmedInRange(CLIENT, 0, Date.now() + 9e12)).toHaveLength(0);
  });

  it('dry-run reports a full slot instead of pretending it is free', async () => {
    const { service } = await setup();
    await create(service); // live booking
    const result = await create(service, { clientId: CLIENT, origin: 'playground', userId: 'pg' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('slot_full');
  });
});

describe('agenda reschedule and cancel', () => {
  it('reschedules and re-syncs', async () => {
    const { service, appointmentsStore, google } = await setup();
    const booked = await create(service);
    const moved = await service.execute('rescheduleAppointment', {
      appointmentId: booked.appointmentId, start: '2026-11-09T11:00'
    }, { clientId: CLIENT, origin: 'meta', userId: '5215512345678@c.us' });
    expect(moved.success).toBe(true);
    expect(google.updateEvent).toHaveBeenCalledTimes(1);
    const saved = await appointmentsStore.get(CLIENT, booked.appointmentId);
    expect(saved.start).toBe('2026-11-09T17:00:00.000Z');
    expect(saved.sync).toBe('synced');
  });

  it('cancels and deletes the google event', async () => {
    const { service, appointmentsStore, google } = await setup();
    const booked = await create(service);
    const out = await service.execute('cancelAppointment', { appointmentId: booked.appointmentId }, {
      clientId: CLIENT, origin: 'meta', userId: '5215512345678@c.us'
    });
    expect(out.success).toBe(true);
    expect(google.deleteEvent).toHaveBeenCalledTimes(1);
    expect((await appointmentsStore.get(CLIENT, booked.appointmentId)).status).toBe('cancelled');
  });

  it('does not let another phone cancel an appointment', async () => {
    const { service, appointmentsStore } = await setup();
    const booked = await create(service);
    const out = await service.execute('cancelAppointment', { appointmentId: booked.appointmentId }, {
      clientId: CLIENT, origin: 'meta', userId: '999@c.us'
    });
    expect(out.success).toBe(false);
    expect((await appointmentsStore.get(CLIENT, booked.appointmentId)).status).toBe('confirmed');
  });

  it('respects allowCancel=false and unknown appointment', async () => {
    const { service } = await setup({ docPatch: { rules: { minNoticeMinutes: 60, maxDaysAhead: 30, slotIntervalMinutes: 30, bufferMinutes: 0, allowCancel: false, allowReschedule: true } } });
    const out = await service.execute('cancelAppointment', { appointmentId: 'apt_x' }, { clientId: CLIENT, origin: 'meta' });
    expect(out.success).toBe(false);
    const { service: s2 } = await setup();
    const missing = await s2.execute('cancelAppointment', { appointmentId: 'apt_x' }, { clientId: CLIENT, origin: 'meta' });
    expect(missing.success).toBe(false);
  });
});

describe('agenda service panel and sync', () => {
  it('processSyncQueue syncs pending rows', async () => {
    const google = fakeGoogle({ createEvent: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ id: 'g2' }) });
    const { service, appointmentsStore } = await setup({ google });
    const booked = await create(service);
    expect(booked.syncPending).toBe(true);
    await appointmentsStore.update(CLIENT, booked.appointmentId, { nextRetryAt: new Date(0).toISOString() });
    const summary = await service.processSyncQueue();
    expect(summary.synced).toBe(1);
    expect((await appointmentsStore.get(CLIENT, booked.appointmentId)).eventId).toBe('g2');
  });

  it('saveAgenda validates and persists, toPanel hides secrets', async () => {
    const { service } = await setup();
    const panel = await service.saveAgenda(CLIENT, {
      timezone: 'America/Bogota',
      services: [{ name: 'Corte', durationMinutes: 45, capacity: 3 }]
    });
    expect(panel.timezone).toBe('America/Bogota');
    expect(panel.services[0].capacity).toBe(3);
    expect(panel).not.toHaveProperty('encryptedTokens');
    await expect(service.saveAgenda(CLIENT, { timezone: 'Nope/Zone' })).rejects.toMatchObject({ status: 400 });
  });

  it('setEnabled, setPlaygroundWrite, selectCalendar and dismissNotice update the panel', async () => {
    const { service } = await setup();
    expect((await service.setEnabled(CLIENT, false)).enabled).toBe(false);
    expect((await service.setPlaygroundWrite(CLIENT, true)).playgroundWriteEnabled).toBe(true);
    const panel = await service.selectCalendar(CLIENT, { calendarId: 'cal2', calendarSummary: 'Otro' });
    expect(panel.connection.calendarId).toBe('cal2');
    expect((await service.dismissNotice(CLIENT)).adminNotice).toBeNull();
  });

  it('runs the oauth flow, stores encrypted tokens and disconnects', async () => {
    const google = fakeGoogle({
      authorizationUrl: jest.fn(({ state }) => `https://accounts.example/auth?state=${state}`),
      exchangeCode: jest.fn().mockResolvedValue({ access_token: 'acc-secret', refresh_token: 'ref-secret', expires_in: 3600 }),
      userEmail: jest.fn().mockResolvedValue('dueno@example.com'),
      listCalendars: jest.fn().mockResolvedValue([{ id: 'cal1', summary: 'Principal', primary: true, timeZone: 'America/Bogota' }]),
      revoke: jest.fn().mockResolvedValue(undefined)
    });
    const settingsStore = new MemorySettingsStore();
    const service = new AgendaService({
      settingsStore, appointmentsStore: new MemoryAppointmentsStore(), google, now: () => NOW, env: { ADMIN_API_TOKEN: 'adm' }
    });
    const begin = await service.beginOAuth(CLIENT, 'https://app/cb', { via: 'invite' });
    const state = new URL(begin.url).searchParams.get('state');
    const done = await service.completeOAuth('code', state, 'https://app/cb');
    expect(done).toMatchObject({ clientId: CLIENT, email: 'dueno@example.com', via: 'invite' });
    const raw = await settingsStore.getRaw(CLIENT);
    expect(raw.connection).toMatchObject({ status: 'connected', calendarId: 'cal1' });
    expect(raw.timezone).toBe('America/Bogota');
    expect(raw.encryptedTokens).toBeTruthy();
    expect(raw.encryptedTokens).not.toContain('ref-secret');
    expect(raw.adminNotice).toMatchObject({ pending: true });
    // el nonce es de un solo uso
    await expect(service.completeOAuth('code', state, 'https://app/cb')).rejects.toMatchObject({ status: 400 });

    const panel = await service.disconnect(CLIENT);
    expect(panel.connection.status).toBe('disconnected');
    expect(google.revoke).toHaveBeenCalledWith('ref-secret');
    expect((await settingsStore.getRaw(CLIENT)).encryptedTokens).toBeNull();
  });

  it('createAgendaService wires injected stores and google', () => {
    const service = createAgendaService({
      settingsStore: new MemorySettingsStore(),
      appointmentsStore: new MemoryAppointmentsStore(),
      google: fakeGoogle(),
      now: () => NOW,
      env: {}
    });
    expect(service).toBeInstanceOf(AgendaService);
  });
});
