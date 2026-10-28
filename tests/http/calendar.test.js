const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');
const { createCalendarService } = require('../../src/services/calendar/createCalendarService');
const { MemoryCalendarStore } = require('../../src/services/calendar/memoryStore');

function calendarApp() {
  const calendarService = createCalendarService({
    store: new MemoryCalendarStore(),
    google: { configured: () => false },
    env: {}
  });
  const { app } = createTestApp({
    commandManager: {
      getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
    },
    calendarService
  });
  return { app, calendarService };
}

describe('API de Google Calendar por bot', () => {
  it('empieza desactivada y el switch se guarda sin borrar la configuración', async () => {
    const { app } = calendarApp();
    const first = await request(app).get('/clients/C1/calendar').set(authHeader());
    expect(first.status).toBe(200);
    expect(first.body.calendar.enabled).toBe(false);
    expect(first.body.calendar.phase).toBe('disabled');
    expect(first.body.calendar.ready).toBe(false);

    const enabled = await request(app)
      .put('/clients/C1/calendar/enabled')
      .set(authHeader())
      .send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.calendar.enabled).toBe(true);
    expect(enabled.body.calendar.phase).toBe('disconnected');

    const saved = await request(app)
      .put('/clients/C1/calendar')
      .set(authHeader())
      .send({
        timezone: 'America/Mexico_City',
        hours: {
          monday: { enabled: true, intervals: [{ start: '09:00', end: '14:00' }, { start: '16:00', end: '19:00' }] },
          tuesday: { enabled: false, intervals: [] },
          wednesday: { enabled: false, intervals: [] },
          thursday: { enabled: false, intervals: [] },
          friday: { enabled: false, intervals: [] },
          saturday: { enabled: false, intervals: [] },
          sunday: { enabled: false, intervals: [] }
        },
        services: [{ name: 'Servicio premium', description: 'Sesión larga', durationMinutes: 180, active: true }],
        rules: {
          minNoticeMinutes: 60,
          maxDaysAhead: 30,
          slotIntervalMinutes: 30,
          bufferMinutes: 15,
          allowCancel: true,
          allowReschedule: false
        }
      });
    expect(saved.status).toBe(200);
    expect(saved.body.calendar.ready).toBe(false);
    expect(saved.body.calendar.phase).toBe('disconnected');
    expect(saved.body.calendar.services[0].durationMinutes).toBe(180);
    expect(saved.body.calendar.services[0].id).toMatch(/^svc_/);

    const disabled = await request(app)
      .put('/clients/C1/calendar/enabled')
      .set(authHeader())
      .send({ enabled: false });
    expect(disabled.body.calendar.enabled).toBe(false);
    expect(disabled.body.calendar.services).toHaveLength(1);

    const again = await request(app)
      .put('/clients/C1/calendar/enabled')
      .set(authHeader())
      .send({ enabled: true });
    expect(again.body.calendar.services[0].name).toBe('Servicio premium');
    expect(again.body.calendar.phase).not.toBe('ready');
  });

  it('rechaza una duración inválida y no inicia OAuth sin credenciales', async () => {
    const { app } = calendarApp();
    const invalid = await request(app)
      .put('/clients/C1/calendar')
      .set(authHeader())
      .send({
        timezone: 'America/Mexico_City',
        hours: {},
        services: [{ name: 'Consulta', durationMinutes: 1, active: true }],
        rules: {}
      });
    expect(invalid.status).toBe(400);

    const oauth = await request(app)
      .post('/clients/C1/calendar/oauth/start')
      .set(authHeader())
      .send({});
    expect(oauth.status).toBe(503);
  });
});

describe('link público de Google Calendar', () => {
  function googleReady() {
    return {
      configured: () => true,
      authorizationUrl: ({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`,
      exchangeCode: jest.fn(async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })),
      userEmail: jest.fn(async () => 'ana@example.com'),
      listCalendars: jest.fn(async () => [{ id: 'primary', summary: 'Principal', primary: true, timeZone: 'America/Mexico_City' }]),
      revoke: jest.fn(async () => {})
    };
  }

  function inviteApp(client) {
    const calendarService = createCalendarService({
      store: new MemoryCalendarStore(),
      google: googleReady(),
      env: process.env
    });
    const { app } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' }),
        updateClient: jest.fn().mockResolvedValue({ id: 'C1', name: 'Clínica' })
      },
      firebaseService: {
        getClientById: jest.fn().mockResolvedValue({ id: 'C1', name: 'Clínica' }),
        getClientByCalendarInviteToken: jest.fn(async (token) => (token && client ? client : null))
      },
      calendarService
    });
    return { app, calendarService };
  }

  const future = new Date(Date.now() + 86400000).toISOString();
  const pendingClient = {
    id: 'C1',
    name: 'Clínica',
    CALENDAR_INVITE_TOKEN_HASH: 'hash',
    CALENDAR_INVITE_EXPIRES_AT: future
  };

  it('muestra el tutorial y, al volver de Google, avisa sin abrir el panel', async () => {
    const { app } = inviteApp(pendingClient);
    const page = await request(app).get('/calendar/conectar/token-publico');
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/calendar-connect-root/);

    const invite = await request(app).get('/public/calendar/invite/token-publico');
    expect(invite.status).toBe(200);
    expect(invite.body.status).toBe('pending');
    expect(invite.body.botName).toBe('Clínica');
    expect(invite.body.oauthConfigured).toBe(true);

    const start = await request(app).post('/public/calendar/invite/token-publico/start').send({});
    expect(start.status).toBe(200);
    const state = new URL(start.body.url).searchParams.get('state');
    const done = await request(app).get('/calendar/oauth/callback').query({ code: 'code', state });
    expect(done.status).toBe(302);
    expect(done.headers.location).toMatch(/\/calendar\/conectar\/listo\?r=/);
    expect(done.headers.location).not.toMatch(/#\/clients/);

    const resultToken = new URL(done.headers.location).searchParams.get('r');
    const result = await request(app).get('/public/calendar/result').query({ r: resultToken });
    expect(result.body.kind).toBe('connected');
    expect(result.body.email).toBe('ana@example.com');
    expect(result.body.botName).toBe('Clínica');

    const panel = await request(app).get('/clients/C1/calendar').set(authHeader());
    expect(panel.body.calendar.enabled).toBe(false);
    expect(panel.body.calendar.connection.email).toBe('ana@example.com');
    expect(panel.body.calendar.adminNotice.email).toBe('ana@example.com');

    const dismissed = await request(app).post('/clients/C1/calendar/notice/dismiss').set(authHeader()).send({});
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.calendar.adminNotice).toBeNull();
    expect(dismissed.body.calendar.connection.email).toBe('ana@example.com');
  });

  it('el OAuth del panel no deja aviso de cliente y un link vencido no conecta', async () => {
    const { app } = inviteApp(pendingClient);
    const start = await request(app).post('/clients/C1/calendar/oauth/start').set(authHeader()).send({});
    const state = new URL(start.body.url).searchParams.get('state');
    const done = await request(app).get('/calendar/oauth/callback').query({ code: 'code', state });
    expect(done.status).toBe(302);
    expect(done.headers.location).toMatch(/calendar=connected/);
    const panel = await request(app).get('/clients/C1/calendar').set(authHeader());
    expect(panel.body.calendar.adminNotice).toBeNull();

    const again = await request(app).get('/public/calendar/invite/token-publico');
    expect(again.body.status).toBe('connected');
    const blocked = await request(app).post('/public/calendar/invite/token-publico/start').send({});
    expect(blocked.status).toBe(409);

    const expired = inviteApp({
      ...pendingClient,
      CALENDAR_INVITE_EXPIRES_AT: new Date(Date.now() - 1000).toISOString()
    });
    const stale = await request(expired.app).get('/public/calendar/invite/viejo');
    expect(stale.status).toBe(410);
  });

  it('rechaza un link desconocido y genera otro para el bot', async () => {
    const { app, deps } = (() => {
      const calendarService = createCalendarService({
        store: new MemoryCalendarStore(),
        google: googleReady(),
        env: process.env
      });
      return {
        ...createTestApp({
          commandManager: {
            getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' }),
            updateClient: jest.fn().mockResolvedValue({ id: 'C1' })
          },
          firebaseService: {
            getClientByCalendarInviteToken: jest.fn().mockResolvedValue(null)
          },
          calendarService
        }),
        calendarService
      };
    })();
    const missing = await request(app).get('/public/calendar/invite/no-existe');
    expect(missing.status).toBe(404);

    const created = await request(app).post('/clients/C1/calendar/invite').set(authHeader()).send({});
    expect(created.status).toBe(200);
    expect(created.body.calendarInviteUrl).toMatch(/\/calendar\/conectar\//);
    const fields = deps.commandManager.updateClient.mock.calls[0][1];
    expect(fields.CALENDAR_INVITE_TOKEN_HASH).toMatch(/^[a-f0-9]{64}$/);
  });
});
