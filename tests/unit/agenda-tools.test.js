const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');
const { MemorySettingsStore } = require('../../src/services/configuracion/agenda/settingsStore');
const { AgendaService } = require('../../src/services/configuracion/agenda/agendaService');
const { createAgendaService } = require('../../src/services/configuracion/agenda/createAgendaService');
const { signState, verifyState } = require('../../src/services/configuracion/agenda/oauthState');
const {
  toolDefinitions, isAgendaTool, mergeTools, buildInstructions, planAgendaToolRound
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

async function setup({ google = fakeGoogle(), appointmentsPerBlock = 1, docPatch = {} } = {}) {
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
      { id: 'svc_a', name: 'Consulta', description: '', durationMinutes: 30, active: true },
      { id: 'svc_off', name: 'Inactivo', description: '', durationMinutes: 30, active: false }
    ],
    rules: { ...doc.rules, appointmentsPerBlock },
    ...docPatch
  }));
  const service = new AgendaService({
    settingsStore, appointmentsStore, google, now: () => NOW, env: {}, tokenOverride: 'tok'
  });
  return { service, settingsStore, appointmentsStore, google };
}

const create = (service, context = { clientId: CLIENT, origin: 'meta', userId: '5215512345678@c.us' }, extra = {}) => (
  service.execute('createAppointment', {
    serviceId: 'svc_a',
    start: SLOT_10,
    customerName: 'Ana',
    customerAddress: 'Av. Reforma 120, Col. Centro',
    notes: null,
    ...extra
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
    expect(text).toMatch(/no vuelvas a llamar getAvailableSlots en ese turno/i);
  });

  it('keeps the first reply on dates when the model also asks for one day', () => {
    const calls = [
      { name: 'listBookingServices', arguments: '{}' },
      { name: 'getAvailableSlots', arguments: '{"serviceId":"svc_a","date":null,"preferredStart":null}' },
      { name: 'getAvailableSlots', arguments: '{"serviceId":"svc_a","date":"2026-11-12","preferredStart":null}' }
    ];
    const round = planAgendaToolRound(calls);
    expect(round.map((step) => step.action)).toEqual(['run', 'run', 'skip-for-days']);
    const chosenDay = planAgendaToolRound([
      { name: 'getAvailableSlots', arguments: '{"serviceId":"svc_a","date":"2026-11-13","preferredStart":null}' }
    ]);
    expect(chosenDay.map((step) => step.action)).toEqual(['run']);
  });

  it('does not book when the person only named the day', () => {
    const calls = [
      { name: 'getAvailableSlots', arguments: '{"serviceId":"svc_a","date":"2026-11-13","preferredStart":null}' },
      { name: 'createAppointment', arguments: '{"start":"2026-11-13T09:00","customerName":"Cliente"}' },
      { name: 'createAppointment', arguments: '{"start":"2026-11-13T09:30","customerName":"Cliente"}' }
    ];
    const waiting = planAgendaToolRound(calls, { userNamedTime: false });
    expect(waiting.map((step) => step.action)).toEqual(['run', 'skip-until-choice', 'skip-until-choice']);
    const chosen = planAgendaToolRound(calls, { userNamedTime: true });
    expect(chosen.map((step) => step.action)).toEqual(['run', 'run', 'skip-extra-booking']);
    const pickedByNumber = planAgendaToolRound([
      { name: 'createAppointment', arguments: '{"start":"2026-11-14T09:00","customerName":"Mario Molina","customerAddress":"prueba 222"}' }
    ], { userNamedTime: false });
    expect(pickedByNumber.map((step) => step.action)).toEqual(['run']);
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

  it('returns every free slot in the workday, not a short list', async () => {
    const { service } = await setup({
      docPatch: {
        rules: {
          minNoticeMinutes: 0,
          maxDaysAhead: 30,
          slotIntervalMinutes: 30,
          bufferMinutes: 0,
          allowCancel: true,
          allowReschedule: true
        }
      }
    });
    const result = await service.execute('getAvailableSlots', {
      serviceId: 'svc_a', date: '2026-11-09', preferredStart: null
    }, { clientId: CLIENT });
    expect(result.success).toBe(true);
    expect(result.mode).toBe('times');
    // 09:00–18:00 cada 30 min → 18 inicios (último 17:30)
    expect(result.slots).toHaveLength(18);
    expect(result.slotCount).toBe(18);
    expect(result.offerText.split('\n')).toHaveLength(18);
    expect(result.instruction).toMatch(/18 horarios/);
    expect(result.instruction).toMatch(/TODOS/);
    expect(result.slots[0].startLocal).toBe('2026-11-09T09:00');
    expect(result.slots[result.slots.length - 1].startLocal).toBe('2026-11-09T17:30');
  });

  it('still returns all remaining free slots when the day already has bookings', async () => {
    const { service, google } = await setup({
      docPatch: {
        rules: {
          minNoticeMinutes: 0,
          maxDaysAhead: 30,
          slotIntervalMinutes: 30,
          bufferMinutes: 0,
          allowCancel: true,
          allowReschedule: true
        }
      }
    });
    await create(service); // 10:00 tomada en nuestra agenda
    // Aunque Google diga busy, la oferta sale solo de citas locales
    google.freeBusy.mockResolvedValue([{ start: SLOT_10_START, end: SLOT_10_END }]);
    const result = await service.execute('getAvailableSlots', {
      serviceId: 'svc_a', date: '2026-11-09', preferredStart: null
    }, { clientId: CLIENT });
    expect(result.success).toBe(true);
    expect(result.slotCount).toBe(17);
    expect(result.slots.map((s) => s.startLocal)).not.toContain(SLOT_10);
    expect(result.offerText).toContain('09:00');
    expect(result.offerText).toContain('17:30');
    expect(result.instruction).toMatch(/17 horarios/);
    expect(google.freeBusy).not.toHaveBeenCalled();
  });

  it('offers remaining capacity from our agenda even if Google freeBusy looks full', async () => {
    const google = fakeGoogle();
    const { service } = await setup({ google, appointmentsPerBlock: 2 });
    const booked = await create(service);
    expect(booked.success).toBe(true);
    google.freeBusy.mockResolvedValue([{ start: SLOT_10_START, end: SLOT_10_END }]);
    const result = await service.execute('getAvailableSlots', { serviceId: 'svc_a', date: '2026-11-09', preferredStart: SLOT_10 }, { clientId: CLIENT });
    expect(result.success).toBe(true);
    expect(result.exact).toBe(true);
    const second = await create(service, undefined, { customerName: 'Luis' });
    expect(second.success).toBe(true);
    expect(google.freeBusy).not.toHaveBeenCalled();
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
    service.ensureAccessToken = jest.fn().mockRejectedValue(new Error('sin token'));
    const result = await create(service);
    expect(result.success).toBe(true);
    expect(result.syncPending).toBe(true);
    const saved = await appointmentsStore.get(CLIENT, result.appointmentId);
    expect(saved.sync).toBe('pending');
  });

  it('block race: only one concurrent booking wins and loser gets fresh offerList', async () => {
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

  it('respects appointmentsPerBlock greater than one', async () => {
    const { service } = await setup({ appointmentsPerBlock: 2 });
    const r1 = await create(service);
    const r2 = await create(service, undefined, { customerName: 'Luis' });
    const r3 = await create(service, undefined, { customerName: 'Eva' });
    expect([r1.success, r2.success, r3.success]).toEqual([true, true, false]);
  });

  it('does not block booking based on Google freeBusy; only our agenda matters', async () => {
    const google = fakeGoogle({ freeBusy: jest.fn().mockResolvedValue([{ start: SLOT_10_START, end: SLOT_10_END }]) });
    const { service, appointmentsStore } = await setup({ google });
    const result = await create(service);
    expect(result.success).toBe(true);
    expect(await appointmentsStore.listConfirmedInRange(CLIENT, 0, Date.now() + 9e12)).toHaveLength(1);
    expect(google.freeBusy).not.toHaveBeenCalled();
  });

  it('books the local clock even if the model appends Z, and snaps a UTC clock only when it is not a real start', async () => {
    const { service } = await setup({
      docPatch: {
        hours: {
          monday: { enabled: true, intervals: [{ start: '09:00', end: '12:00' }] },
          tuesday: { enabled: false, intervals: [] },
          wednesday: { enabled: false, intervals: [] },
          thursday: { enabled: false, intervals: [] },
          friday: { enabled: false, intervals: [] },
          saturday: { enabled: false, intervals: [] },
          sunday: { enabled: false, intervals: [] }
        }
      }
    });
    // 10:00Z se lee como hora local 10:00 (la que está en startLocal), no como 04:00
    const withZ = await create(service, undefined, { start: `${SLOT_10}Z`, customerName: 'Zeta' });
    expect(withZ.success).toBe(true);
    expect(withZ.startLocal).toBe(SLOT_10);
    expect(withZ.start).toBe(SLOT_10_START);
    // 16:00 no cabe en 09:00–12:00; 16:00 UTC sí es el inicio local 10:00, que ya está ocupado
    const utcAsLocal = await create(service, undefined, {
      start: '2026-11-09T16:00',
      customerName: 'UtcLocal'
    });
    expect(utcAsLocal.error || '').not.toMatch(/horario de atención/i);
    expect(utcAsLocal.code).toBe('slot_full');
  });

  it('getAvailableSlots exposes only local clocks to the model', async () => {
    const { service } = await setup({
      docPatch: {
        rules: {
          minNoticeMinutes: 0,
          maxDaysAhead: 30,
          slotIntervalMinutes: 30,
          bufferMinutes: 0,
          allowCancel: true,
          allowReschedule: true
        }
      }
    });
    const result = await service.execute('getAvailableSlots', {
      serviceId: 'svc_a', date: '2026-11-09', preferredStart: null
    }, { clientId: CLIENT });
    expect(result.success).toBe(true);
    expect(result.slots[0]).toEqual(expect.objectContaining({
      startLocal: '2026-11-09T09:00',
      endLocal: '2026-11-09T09:30'
    }));
    expect(result.slots[0]).not.toHaveProperty('start');
    expect(result.slots[0]).not.toHaveProperty('end');
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

  it('refuses to book until the person wrote their name and address', async () => {
    const { service } = await setup();
    const onlyTime = {
      clientId: CLIENT,
      origin: 'meta',
      userId: '5215512345678@c.us',
      userMessages: ['9:00']
    };
    const missing = await create(service, onlyTime, { customerName: '.', customerAddress: 'calle' });
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/nombre/);
    expect(missing.error).toMatch(/dirección/);
    const invented = await create(service, onlyTime);
    expect(invented.success).toBe(false);
    const said = await create(service, {
      ...onlyTime,
      userMessages: ['Soy Ana Gómez y la dirección es Av. Reforma 120, Col. Centro. Quiero las 10:00']
    }, {
      customerName: 'Ana Gómez',
      customerAddress: 'Av. Reforma 120, Col. Centro'
    });
    expect(said.success).toBe(true);
    expect(said.customerAddress).toBe('Av. Reforma 120, Col. Centro');
  });

  it('honors closed exceptions', async () => {
    const { service } = await setup({
      docPatch: { exceptions: [{ date: '2026-11-09', closed: true, intervals: [], note: '' }] }
    });
    const result = await create(service);
    expect(result.success).toBe(false);
  });

  it('still books from local availability when freeBusy is temporarily down', async () => {
    const google = fakeGoogle({ freeBusy: jest.fn().mockRejectedValue(new Error('google caído')) });
    const { service, appointmentsStore } = await setup({ google });
    const result = await create(service);
    expect(result.success).toBe(true);
    expect(await appointmentsStore.listConfirmedInRange(CLIENT, 0, Date.now() + 9e12)).toHaveLength(1);
  });

  it('keeps the local reservation if Google sync fails after booking', async () => {
    const google = fakeGoogle({
      createEvent: jest.fn().mockRejectedValue(new Error('google caído'))
    });
    const { service, appointmentsStore } = await setup({ google });
    const result = await create(service);
    expect(result.success).toBe(true);
    expect(result.syncPending).toBe(true);
    expect(await appointmentsStore.listConfirmedInRange(CLIENT, 0, Date.now() + 9e12)).toHaveLength(1);
  });

  it('marks the connection revoked when listing calendars gets a revoked token', async () => {
    const error = Object.assign(new Error('revocado'), { code: 'revoked' });
    const google = fakeGoogle({
      listCalendars: jest.fn().mockRejectedValue(error)
    });
    const { service, settingsStore } = await setup({ google });
    await expect(service.listCalendars(CLIENT)).rejects.toMatchObject({ code: 'revoked' });
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

  it('getPanel exposes sync issues from retry and failed appointments', async () => {
    const { service, appointmentsStore } = await setup();
    const clean = await service.getPanel(CLIENT);
    expect(clean.syncIssues).toEqual({ retryCount: 0, failedCount: 0, lastError: '' });
    expect(clean.lastSyncError).toBe('');

    const row = (id, sync, lastSyncError, updatedAt) => ({
      id, serviceId: 'svc_a', start: SLOT_10_START, end: SLOT_10_END, status: 'confirmed',
      sync, eventId: '', syncAttempts: 3, lastSyncError, updatedAt
    });
    await appointmentsStore.runTransaction(CLIENT, async (tx) => {
      tx.set('a1', row('a1', 'retry', 'Google timeout', '2026-11-09T10:00:00.000Z'));
      tx.set('a2', row('a2', 'failed', 'Sin permiso', '2026-11-09T11:00:00.000Z'));
      tx.set('a3', row('a3', 'synced', '', '2026-11-09T11:30:00.000Z'));
    });
    const panel = await service.getPanel(CLIENT);
    expect(panel.syncIssues).toEqual({ retryCount: 1, failedCount: 1, lastError: 'Sin permiso' });
    expect(panel.lastSyncError).toBe('Sin permiso');
    // las respuestas de mutación también lo incluyen
    expect((await service.setEnabled(CLIENT, true)).lastSyncError).toBe('Sin permiso');
  });

  it('saveAgenda validates and persists, toPanel hides secrets', async () => {
    const { service } = await setup();
    const panel = await service.saveAgenda(CLIENT, {
      timezone: 'America/Bogota',
      services: [{ name: 'Corte', durationMinutes: 45, capacity: 9 }],
      rules: { appointmentsPerBlock: 3 }
    });
    expect(panel.timezone).toBe('America/Bogota');
    expect(panel.services[0]).not.toHaveProperty('capacity');
    expect(panel.rules.appointmentsPerBlock).toBe(3);
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
