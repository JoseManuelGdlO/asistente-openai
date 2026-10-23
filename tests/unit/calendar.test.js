const { generateSlots, zonedToUtc, weekdayKeyFromDate } = require('../../src/services/calendar/time');
const { describePhase } = require('../../src/services/calendar/readiness');
const { signState, verifyState } = require('../../src/services/calendar/oauthState');
const { mergeTools, toolDefinitions, buildInstructions, isCalendarTool } = require('../../src/services/calendar/tools');
const { CalendarService } = require('../../src/services/calendar/calendarService');
const { MemoryCalendarStore } = require('../../src/services/calendar/memoryStore');
const { defaultDocument, defaultRules } = require('../../src/services/calendar/constants');
const OpenAIManager = require('../../src/managers/openAIManager');

const NOW = new Date('2026-10-26T15:00:00.000Z');

function openMonday() {
  return {
    monday: { enabled: true, intervals: [{ start: '09:00', end: '14:00' }, { start: '16:00', end: '19:00' }] },
    tuesday: { enabled: true, intervals: [{ start: '09:00', end: '18:00' }] },
    wednesday: { enabled: false, intervals: [] },
    thursday: { enabled: false, intervals: [] },
    friday: { enabled: false, intervals: [] },
    saturday: { enabled: false, intervals: [] },
    sunday: { enabled: false, intervals: [] }
  };
}

function readyDoc() {
  const doc = defaultDocument();
  doc.enabled = true;
  doc.connection = {
    status: 'connected',
    email: 'ana@example.com',
    calendarId: 'primary',
    calendarSummary: 'Principal',
    timezone: 'America/Mexico_City',
    connectedAt: '2026-10-23T00:00:00.000Z',
    lastError: ''
  };
  doc.hours = openMonday();
  doc.services = [{
    id: 'svc_premium01',
    name: 'Servicio premium',
    description: 'Sesión larga',
    durationMinutes: 180,
    active: true
  }];
  doc.rules = {
    ...defaultRules(),
    minNoticeMinutes: 0,
    slotIntervalMinutes: 60,
    bufferMinutes: 0,
    maxDaysAhead: 30
  };
  return doc;
}

function googleFake(overrides = {}) {
  return {
    configured: () => true,
    authorizationUrl: ({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`,
    exchangeCode: jest.fn(async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })),
    userEmail: jest.fn(async () => 'ana@example.com'),
    listCalendars: jest.fn(async () => [{ id: 'primary', summary: 'Principal', primary: true, timeZone: 'America/Bogota' }]),
    freeBusy: jest.fn(async () => []),
    createEvent: jest.fn(async () => ({ id: 'evt_1', htmlLink: 'https://calendar.google.com/event?eid=evt_1' })),
    updateEvent: jest.fn(async () => ({ id: 'evt_1' })),
    deleteEvent: jest.fn(async () => {}),
    revoke: jest.fn(async () => {}),
    refresh: jest.fn(async () => ({ access_token: 'access-2', expires_in: 3600 })),
    ...overrides
  };
}

function serviceWith(doc, google) {
  const store = new MemoryCalendarStore();
  store.docs.set('bot-1', doc);
  return new CalendarService({
    store,
    google,
    now: () => NOW,
    env: { ADMIN_API_TOKEN: 'test-secret' },
    tokenOverride: 'token'
  });
}

describe('horarios de Google Calendar', () => {
  it('convierte la hora local de México a UTC', () => {
    expect(zonedToUtc('2026-10-26', '09:00', 'America/Mexico_City').toISOString()).toBe('2026-10-26T15:00:00.000Z');
    expect(weekdayKeyFromDate('2026-10-26')).toBe('monday');
    expect(weekdayKeyFromDate('2026-10-25')).toBe('sunday');
  });

  it('ofrece los dos tramos del lunes y deja el domingo cerrado', () => {
    const slots = generateSlots({
      now: NOW,
      timeZone: 'America/Mexico_City',
      hours: openMonday(),
      durationMinutes: 60,
      rules: { minNoticeMinutes: 0, maxDaysAhead: 2, slotIntervalMinutes: 60, bufferMinutes: 0 },
      fromDate: '2026-10-26',
      toDate: '2026-10-26',
      busy: [],
      limit: 12
    });
    expect(slots.map((slot) => slot.startLocal.slice(11))).toEqual([
      '09:00', '10:00', '11:00', '12:00', '13:00', '16:00', '17:00', '18:00'
    ]);

    const sunday = generateSlots({
      now: NOW,
      timeZone: 'America/Mexico_City',
      hours: openMonday(),
      durationMinutes: 60,
      rules: { minNoticeMinutes: 0, maxDaysAhead: 2, slotIntervalMinutes: 60, bufferMinutes: 0 },
      fromDate: '2026-10-25',
      toDate: '2026-10-25',
      busy: [],
      limit: 12
    });
    expect(sunday).toEqual([]);
  });

  it('deja un tiempo de preparación entre citas', () => {
    const slots = generateSlots({
      now: NOW,
      timeZone: 'America/Mexico_City',
      hours: { monday: { enabled: true, intervals: [{ start: '09:00', end: '18:00' }] } },
      durationMinutes: 60,
      rules: { minNoticeMinutes: 0, maxDaysAhead: 2, slotIntervalMinutes: 60, bufferMinutes: 15 },
      fromDate: '2026-10-26',
      toDate: '2026-10-26',
      busy: [{ start: Date.parse('2026-10-26T15:00:00.000Z'), end: Date.parse('2026-10-26T16:00:00.000Z') }],
      limit: 4
    });
    expect(slots[0].startLocal).toBe('2026-10-26T11:00');
  });
});

describe('estado de la agenda', () => {
  it('empieza desactivada y no se ve lista si falta conexión, calendario o servicios', () => {
    expect(describePhase(defaultDocument()).phase).toBe('disabled');
    const connected = readyDoc();
    connected.services = [];
    expect(describePhase(connected)).toMatchObject({ phase: 'incomplete', ready: false });
    expect(describePhase(connected).missing).toContain('services');
    connected.connection.calendarId = '';
    expect(describePhase(connected).missing).toEqual(expect.arrayContaining(['calendar', 'services']));
    const revoked = readyDoc();
    revoked.connection.status = 'revoked';
    expect(describePhase(revoked).phase).toBe('revoked');
    expect(describePhase(readyDoc())).toMatchObject({ phase: 'ready', ready: true });
  });
});

describe('tools de agenda', () => {
  it('agrega las herramientas sin tocar el JSON guardado ni duplicar nombres', () => {
    const stored = [{ type: 'function', name: 'enviar_pdf' }, { type: 'function', name: 'getAvailableSlots' }];
    const snapshot = JSON.parse(JSON.stringify(stored));
    const merged = mergeTools(stored, toolDefinitions());
    expect(stored).toEqual(snapshot);
    expect(merged.filter((tool) => tool.name === 'getAvailableSlots')).toHaveLength(1);
    expect(merged.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'enviar_pdf',
      'listBookingServices',
      'createAppointment',
      'rescheduleAppointment',
      'cancelAppointment'
    ]));
    expect(isCalendarTool('createAppointment')).toBe(true);
    expect(isCalendarTool('enviar_pdf')).toBe(false);
  });

  it('el bloque de instrucciones prohibe inventar horarios y no sustituye el prompt', () => {
    const text = buildInstructions({
      timezone: 'America/Mexico_City',
      services: [{ id: 'svc_premium01', name: 'Servicio premium', description: '', durationMinutes: 180, active: true }],
      rules: defaultRules()
    });
    expect(text).toMatch(/No inventes horarios/);
    expect(text).toMatch(/180 minutos/);
    expect(text).toMatch(/campo reply/);
    expect(text).toMatch(/Hoy es \d{4}-\d{2}-\d{2} en America\/Mexico_City/);
    expect(text).toMatch(/año siguiente si ese día ya pasó/);
    expect(text).toMatch(/Copia startLocal/);
    expect(text).toMatch(/No envíes Z/);
  });

  it('usa la fecha de hoy que trae el runtime', () => {
    const text = buildInstructions({
      timezone: 'America/Mexico_City',
      today: '2026-10-23',
      services: [],
      rules: defaultRules()
    });
    expect(text).toContain('Hoy es 2026-10-23 en America/Mexico_City');
    expect(text).toContain('El año en curso es 2026');
    expect(text).toContain('usa 2026, o el año siguiente si ese día ya pasó');
  });
});

describe('OAuth de Google Calendar', () => {
  it('firma y rechaza un state vencido', () => {
    const state = signState({ clientId: 'bot-1', nonce: 'abc', exp: 1000 }, 'secret');
    expect(verifyState(state, 'secret', 1000)).toMatchObject({ clientId: 'bot-1', nonce: 'abc' });
    expect(verifyState(state, 'secret', 1001)).toBeNull();
    expect(verifyState(state, 'otro', 1000)).toBeNull();
  });

  it('guarda la cuenta sin exponer el token', async () => {
    const google = googleFake();
    const service = new CalendarService({
      store: new MemoryCalendarStore(),
      google,
      now: () => NOW,
      env: { ADMIN_API_TOKEN: 'test-secret' }
    });
    const started = await service.beginOAuth('bot-1', 'http://localhost/calendar/oauth/callback');
    const state = new URL(started.url).searchParams.get('state');
    const done = await service.completeOAuth('code', state, 'http://localhost/calendar/oauth/callback');
    expect(done.clientId).toBe('bot-1');
    const panel = await service.getPanel('bot-1');
    expect(panel.connection.email).toBe('ana@example.com');
    expect(panel.connection.timezone).toBe('America/Bogota');
    expect(panel.encryptedTokens).toBeUndefined();
    const raw = await service.store.getRaw('bot-1');
    expect(typeof raw.encryptedTokens).toBe('string');
    expect(raw.encryptedTokens).not.toContain('refresh');
  });
});

describe('agendamiento', () => {
  it('en modo de prueba consulta disponibilidad y no crea eventos', async () => {
    const google = googleFake();
    const service = serviceWith(readyDoc(), google);
    const slots = await service.execute('getAvailableSlots', {
      serviceId: 'svc_premium01',
      date: '2026-10-26',
      preferredStart: '2026-10-26T10:00'
    }, { clientId: 'bot-1', origin: 'playground', userId: 'playground_bot-1' });
    expect(slots.exact).toBe(true);
    expect(slots.slots[0].startLocal).toBe('2026-10-26T10:00');
    expect(slots.today).toBe('2026-10-26');

    const rolled = await service.execute('getAvailableSlots', {
      serviceId: 'svc_premium01',
      date: '2023-10-26',
      preferredStart: null
    }, { clientId: 'bot-1', origin: 'playground', userId: 'playground_bot-1' });
    expect(rolled.correctedFrom).toBe('2023-10-26');
    expect(rolled.today).toBe('2026-10-26');
    expect(rolled.slots.some((slot) => slot.startLocal.startsWith('2026-10-26'))).toBe(true);
    expect(rolled.instruction).toMatch(/El año es 2026/);
    expect(rolled.instruction).toMatch(/No digas 2023/);

    const preview = await service.execute('createAppointment', {
      serviceId: 'svc_premium01',
      start: '2026-10-26T10:00',
      customerName: 'Ana',
      notes: null
    }, { clientId: 'bot-1', origin: 'playground', userId: 'playground_bot-1' });
    expect(preview.dryRun).toBe(true);
    expect(preview.success).toBe(false);
    expect(google.createEvent).not.toHaveBeenCalled();

    const withSeconds = await service.execute('createAppointment', {
      serviceId: 'svc_premium01',
      start: '2026-10-26T10:00:00',
      customerName: 'Ana',
      notes: null
    }, { clientId: 'bot-1', origin: 'playground', userId: 'playground_bot-1' });
    expect(withSeconds.dryRun).toBe(true);
    expect(withSeconds.label).toMatch(/10:00/);

    const fromUtcStart = await service.execute('createAppointment', {
      serviceId: 'svc_premium01',
      start: '2026-10-26T16:00:00.000Z',
      customerName: 'Ana',
      notes: null
    }, { clientId: 'bot-1', origin: 'playground', userId: 'playground_bot-1' });
    expect(fromUtcStart.dryRun).toBe(true);
    expect(fromUtcStart.label).toMatch(/10:00/);
  });

  it('crea una sola cita real y rechaza el horario ocupado', async () => {
    const google = googleFake();
    const service = serviceWith(readyDoc(), google);
    const created = await service.execute('createAppointment', {
      serviceId: 'svc_premium01',
      start: '2026-10-26T10:00',
      customerName: 'Ana',
      notes: null
    }, { clientId: 'bot-1', origin: 'meta', userId: '5215555555555' });
    expect(created.success).toBe(true);
    expect(created.eventId).toBe('evt_1');
    expect(google.createEvent).toHaveBeenCalledTimes(1);

    const duplicated = await service.execute('createAppointment', {
      serviceId: 'svc_premium01',
      start: '2026-10-26T10:00',
      customerName: 'Luis',
      notes: null
    }, { clientId: 'bot-1', origin: 'meta', userId: '5215555555556' });
    expect(duplicated.success).toBe(false);
    expect(google.createEvent).toHaveBeenCalledTimes(1);
  });

  it('no ofrece las herramientas cuando el switch está apagado', async () => {
    const doc = readyDoc();
    doc.enabled = false;
    const google = googleFake();
    const service = serviceWith(doc, google);
    const result = await service.execute('createAppointment', {
      serviceId: 'svc_premium01',
      start: '2026-10-26T10:00',
      customerName: 'Ana',
      notes: null
    }, { clientId: 'bot-1', origin: 'meta', userId: '521' });
    expect(result.success).toBe(false);
    expect(result.phase).toBe('disabled');
    expect(google.createEvent).not.toHaveBeenCalled();
  });

  it('desconectar no borra servicios ni el switch', async () => {
    const doc = readyDoc();
    const service = serviceWith(doc, googleFake());
    const panel = await service.disconnect('bot-1');
    expect(panel.enabled).toBe(true);
    expect(panel.connection.email).toBe('');
    expect(panel.services).toHaveLength(1);
    expect(panel.phase).toBe('disconnected');
    const raw = await service.store.getRaw('bot-1');
    expect(raw.encryptedTokens).toBeNull();
  });
});

describe('OpenAIManager y Google Calendar', () => {
  function managerWith(booking, tools) {
    const firebase = {
      getAssistantByClientId: jest.fn().mockResolvedValue({
        prompt: 'PROMPT ORIGINAL',
        tools,
        status: 'active'
      }),
      tryLockBotSession: jest.fn().mockResolvedValue(true),
      getOrCreateBotSession: jest.fn().mockResolvedValue({ items: [] }),
      refreshBotSessionLock: jest.fn(),
      saveBotSession: jest.fn(),
      unlockBotSession: jest.fn()
    };
    const manager = new OpenAIManager(firebase);
    manager.calendarBooking = booking;
    manager.openai = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: '{"reply":"listo"}',
          output: [{ type: 'message', role: 'assistant', content: [] }]
        })
      }
    };
    return manager;
  }

  it('inyecta instrucciones y tools sin modificar el prompt ni el JSON guardado', async () => {
    const tools = [{ type: 'function', name: 'enviar_pdf' }];
    const manager = managerWith({
      loadRuntime: jest.fn().mockResolvedValue({
        ready: true,
        timezone: 'America/Mexico_City',
        services: [{ id: 'svc_premium01', name: 'Servicio premium', description: '', durationMinutes: 180, active: true }],
        rules: defaultRules()
      }),
      buildInstructions,
      toolDefinitions,
      mergeTools,
      isCalendarTool,
      execute: jest.fn()
    }, tools);

    await manager.processMessage('521', 'hola', 'bot-1', { origin: 'meta' });
    const request = manager.openai.responses.create.mock.calls[0][0];
    expect(request.instructions).toContain('PROMPT ORIGINAL');
    expect(request.instructions).toContain('No inventes horarios');
    expect(request.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['listBookingServices', 'createAppointment']));
    expect(request.tools.find((tool) => tool.name === 'enviar_pdf')).toBeUndefined();
    expect(tools).toEqual([{ type: 'function', name: 'enviar_pdf' }]);
  });

  it('con la agenda apagada no manda las tools de calendario', async () => {
    const stored = [
      { type: 'function', name: 'getAvailableSlots' },
      { type: 'function', name: 'enviar_pdf' }
    ];
    const manager = managerWith({
      loadRuntime: jest.fn().mockResolvedValue({ ready: false, phase: 'disabled' }),
      buildInstructions,
      toolDefinitions,
      mergeTools,
      isCalendarTool,
      execute: jest.fn()
    }, stored);
    await manager.processMessage('521', 'hola', 'bot-1', { origin: 'meta' });
    const request = manager.openai.responses.create.mock.calls[0][0];
    expect(request.instructions).not.toContain('No inventes horarios');
    expect(request.tools || []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'getAvailableSlots' })
    ]));
    expect(stored).toEqual([
      { type: 'function', name: 'getAvailableSlots' },
      { type: 'function', name: 'enviar_pdf' }
    ]);
  });
});
