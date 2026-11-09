const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');
const { createAgendaService } = require('../../src/services/configuracion/agenda/createAgendaService');
const { MemorySettingsStore } = require('../../src/services/configuracion/agenda/settingsStore');
const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');
const { signState, stateSecret } = require('../../src/services/configuracion/agenda/oauthState');

const BASE = '/clients/C1/configuracion/agenda';

const HOURS = {
  monday: { enabled: true, intervals: [{ start: '09:00', end: '12:00' }] },
  tuesday: { enabled: false, intervals: [] },
  wednesday: { enabled: false, intervals: [] },
  thursday: { enabled: false, intervals: [] },
  friday: { enabled: false, intervals: [] },
  saturday: { enabled: false, intervals: [] },
  sunday: { enabled: false, intervals: [] }
};

function agendaApp({ google = { configured: () => false }, firebaseService, commandManager } = {}) {
  const agendaService = createAgendaService({
    settingsStore: new MemorySettingsStore(),
    appointmentsStore: new MemoryAppointmentsStore(),
    google,
    env: {}
  });
  const { app, deps } = createTestApp({
    commandManager: {
      getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' }),
      ...commandManager
    },
    firebaseService,
    agendaService
  });
  return { app, deps, agendaService };
}

describe('API configuracion agenda', () => {
  it('starts disabled and saves settings with appointmentsPerBlock', async () => {
    const { app } = agendaApp();
    const first = await request(app).get(BASE).set(authHeader());
    expect(first.status).toBe(200);
    expect(first.body.agenda.enabled).toBe(false);

    const enabled = await request(app).put(`${BASE}/enabled`).set(authHeader()).send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.agenda.enabled).toBe(true);

    const saved = await request(app)
      .put(`${BASE}/settings`)
      .set(authHeader())
      .send({
        timezone: 'America/Mexico_City',
        hours: HOURS,
        services: [{ name: 'Consulta', durationMinutes: 30, capacity: 9, active: true }],
        exceptions: [],
        rules: {
          minNoticeMinutes: 60,
          maxDaysAhead: 30,
          slotIntervalMinutes: 30,
          bufferMinutes: 0,
          appointmentsPerBlock: 3,
          allowCancel: true,
          allowReschedule: true
        }
      });
    expect(saved.status).toBe(200);
    expect(saved.body.agenda.services[0]).not.toHaveProperty('capacity');
    expect(saved.body.agenda.rules.appointmentsPerBlock).toBe(3);
    expect(saved.body.agenda.hours.monday.intervals).toEqual([{ start: '09:00', end: '12:00' }]);
  });

  it('returns a read-only week preview with open hours, appointments and Google events', async () => {
    const listEvents = jest.fn().mockResolvedValue([
      {
        id: 'g_own',
        summary: 'Espejo de Ana',
        start: '2026-11-09T15:00:00.000Z',
        end: '2026-11-09T15:30:00.000Z'
      },
      {
        id: 'g_ext',
        summary: 'Junta externa',
        start: '2026-11-09T17:00:00.000Z',
        end: '2026-11-09T18:00:00.000Z'
      }
    ]);
    const { app, agendaService } = agendaApp({
      google: {
        configured: () => true,
        listEvents,
        refresh: jest.fn()
      }
    });
    await agendaService.settingsStore.transaction('C1', (doc) => ({
      ...doc,
      connection: {
        ...doc.connection,
        status: 'connected',
        email: 'owner@example.com',
        calendarId: 'primary',
        calendarSummary: 'Principal'
      },
      encryptedTokens: 'tok-placeholder'
    }));
    // bypass ensureAccessToken crypto: force tokenOverride on service
    agendaService.tokenOverride = 'access-tok';
    await request(app).put(`${BASE}/settings`).set(authHeader()).send({
      timezone: 'America/Mexico_City',
      hours: HOURS,
      services: [{ name: 'Consulta', durationMinutes: 30, active: true }],
      exceptions: [],
      rules: { appointmentsPerBlock: 1 }
    });
    // settings save may wipe connection — re-apply connection after save
    await agendaService.settingsStore.transaction('C1', (doc) => ({
      ...doc,
      connection: {
        ...doc.connection,
        status: 'connected',
        email: 'owner@example.com',
        calendarId: 'primary',
        calendarSummary: 'Principal'
      }
    }));
    await agendaService.appointmentsStore.runTransaction('C1', async (tx) => {
      tx.set('apt_1', {
        id: 'apt_1',
        serviceName: 'Consulta',
        customerName: 'Ana',
        start: '2026-11-09T15:00:00.000Z',
        end: '2026-11-09T15:30:00.000Z',
        status: 'confirmed',
        sync: 'synced',
        eventId: 'g_own'
      });
      tx.set('apt_x', {
        id: 'apt_x',
        serviceName: 'Consulta',
        customerName: 'Cancelada',
        start: '2026-11-09T16:00:00.000Z',
        end: '2026-11-09T16:30:00.000Z',
        status: 'cancelled',
        sync: 'pending'
      });
    });
    const res = await request(app)
      .get(`${BASE}/preview`)
      .query({ weekStart: '2026-11-12' }) // miércoles → normaliza a lunes 9
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.preview.weekStart).toBe('2026-11-09');
    expect(res.body.preview.weekEnd).toBe('2026-11-15');
    expect(res.body.preview.days).toHaveLength(7);
    expect(res.body.preview.days[0]).toMatchObject({
      date: '2026-11-09',
      weekday: 'monday',
      closed: false,
      intervals: [{ start: '09:00', end: '12:00' }]
    });
    expect(res.body.preview.appointments).toHaveLength(1);
    expect(res.body.preview.appointments[0]).toMatchObject({
      id: 'apt_1',
      serviceName: 'Consulta',
      customerName: 'Ana',
      startLocal: '2026-11-09T09:00',
      endLocal: '2026-11-09T09:30',
      sync: 'synced'
    });
    expect(listEvents).toHaveBeenCalled();
    expect(res.body.preview.google).toEqual({ connected: true, ok: true, error: '' });
    expect(res.body.preview.googleEvents).toEqual([
      expect.objectContaining({
        id: 'g_ext',
        summary: 'Junta externa',
        startLocal: '2026-11-09T11:00',
        endLocal: '2026-11-09T12:00'
      })
    ]);
    expect(res.body.preview.serviceId).toBeTruthy();
    expect(res.body.preview.durationMinutes).toBe(30);
    expect(res.body.preview.slotIntervalMinutes).toBe(30);
    expect(res.body.preview.appointmentsPerBlock).toBe(1);
    expect(res.body.preview.calendarColumns).toBe(1);
    expect(res.body.preview.blocks.length).toBeGreaterThan(0);
    const mondayBlocks = res.body.preview.blocks.filter((b) => b.date === '2026-11-09');
    expect(mondayBlocks.map((b) => b.startLocal)).toEqual([
      '2026-11-09T09:00',
      '2026-11-09T09:30',
      '2026-11-09T10:00',
      '2026-11-09T10:30',
      '2026-11-09T11:00',
      '2026-11-09T11:30',
      '2026-11-09T12:00'
    ]);
    const nine = mondayBlocks.find((b) => b.startLocal === '2026-11-09T09:00');
    expect(nine).toMatchObject({
      endLocal: '2026-11-09T09:30',
      occupied: 1,
      capacity: 1,
      bookable: true,
      full: true
    });
    expect(mondayBlocks.find((b) => b.startLocal === '2026-11-09T12:00')).toMatchObject({
      bookable: false,
      full: false
    });
  });

  it('exposes sync errors of failed appointments on the panel payload', async () => {
    const { app, agendaService } = agendaApp();
    await agendaService.appointmentsStore.runTransaction('C1', async (tx) => {
      tx.set('apt_f', {
        id: 'apt_f', serviceId: 'svc', start: '2026-11-09T15:00:00.000Z', end: '2026-11-09T15:30:00.000Z',
        status: 'confirmed', sync: 'failed', eventId: '', syncAttempts: 12, lastSyncError: 'Google 500',
        updatedAt: '2026-11-09T10:00:00.000Z'
      });
    });
    const res = await request(app).get(BASE).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.agenda.lastSyncError).toBe('Google 500');
    expect(res.body.agenda.syncIssues).toEqual({ retryCount: 0, failedCount: 1, lastError: 'Google 500' });
  });

  it('rejects invalid settings with 400', async () => {
    const { app } = agendaApp();
    const res = await request(app)
      .put(`${BASE}/settings`)
      .set(authHeader())
      .send({ timezone: 'No/Existe', hours: HOURS, services: [], exceptions: [], rules: {} });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('requires admin auth', async () => {
    const { app } = agendaApp();
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown assistant', async () => {
    const { app } = agendaApp({ commandManager: { getAssistantConfig: jest.fn().mockResolvedValue(null) } });
    const res = await request(app).get(BASE).set(authHeader());
    expect(res.status).toBe(404);
  });

  it('blocks mutations when the edit-lock is held by someone else', async () => {
    const { app, deps } = agendaApp();
    deps.firebaseService.assertEditLockHolder.mockRejectedValue(
      Object.assign(new Error('Otro admin está editando'), { status: 423, code: 'EDIT_LOCK_HELD' })
    );
    const res = await request(app).put(`${BASE}/enabled`).set(authHeader()).send({ enabled: true });
    expect(res.status).not.toBe(200);
    const after = await request(app).get(BASE).set(authHeader());
    expect(after.body.agenda.enabled).toBe(false);
  });

  it('toggles playground write, dismisses the notice and rejects select-calendar when disconnected', async () => {
    const { app } = agendaApp();
    const pg = await request(app).put(`${BASE}/playground-write`).set(authHeader()).send({ enabled: true });
    expect(pg.status).toBe(200);
    expect(pg.body.agenda.playgroundWriteEnabled).toBe(true);

    const dismiss = await request(app).post(`${BASE}/notice/dismiss`).set(authHeader());
    expect(dismiss.status).toBe(200);
    expect(dismiss.body.agenda.adminNotice).toBeNull();

    const select = await request(app)
      .post(`${BASE}/select-calendar`)
      .set(authHeader())
      .send({ calendarId: 'cal-1', calendarSummary: 'Principal' });
    expect(select.status).toBe(409);

    const calendars = await request(app).get(`${BASE}/calendars`).set(authHeader());
    expect(calendars.status).toBe(409);

    const disconnect = await request(app).post(`${BASE}/disconnect`).set(authHeader());
    expect(disconnect.status).toBe(200);
    expect(disconnect.body.agenda.connection.status).toBe('disconnected');
  });

  it('oauth/start reports 503 when Google is not configured and returns a url when it is', async () => {
    const off = agendaApp();
    const failed = await request(off.app).post(`${BASE}/oauth/start`).set(authHeader());
    expect(failed.status).toBe(503);

    const google = {
      configured: () => true,
      authorizationUrl: jest.fn(({ redirectUri, state }) => `https://accounts.example/auth?redirect=${encodeURIComponent(redirectUri)}&state=${state}`)
    };
    const previous = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
    delete process.env.GOOGLE_CALENDAR_REDIRECT_URI;
    const agendaService = createAgendaService({
      settingsStore: new MemorySettingsStore(),
      appointmentsStore: new MemoryAppointmentsStore(),
      google,
      env: { ADMIN_API_TOKEN: 'test-admin-token' }
    });
    const { app } = createTestApp({
      commandManager: { getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' }) },
      agendaService
    });
    const ok = await request(app).post(`${BASE}/oauth/start`).set(authHeader());
    if (previous !== undefined) process.env.GOOGLE_CALENDAR_REDIRECT_URI = previous;
    expect(ok.status).toBe(200);
    expect(ok.body.url).toContain(encodeURIComponent('/configuracion/agenda/oauth/callback'));
  });

  it('generates an invite link and stores the hash on the assistant', async () => {
    const { app, deps } = agendaApp();
    const res = await request(app).post(`${BASE}/invite`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.calendarInviteUrl).toMatch(/\/calendar\/conectar\/[0-9a-f]{64}$/);
    expect(res.body.calendarInviteExpiresAt).toBeTruthy();
    expect(deps.commandManager.updateClient).toHaveBeenCalledWith(
      'C1',
      expect.objectContaining({ CALENDAR_INVITE_TOKEN_HASH: expect.any(String), CALENDAR_INVITE_EXPIRES_AT: expect.any(String) })
    );
  });

  describe('public invite link', () => {
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
      const agendaService = createAgendaService({
        settingsStore: new MemorySettingsStore(),
        appointmentsStore: new MemoryAppointmentsStore(),
        google: googleReady(),
        env: process.env
      });
      const { app, deps } = createTestApp({
        commandManager: {
          getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' }),
          updateClient: jest.fn().mockResolvedValue({ id: 'C1', name: 'Clínica' })
        },
        firebaseService: {
          getClientById: jest.fn().mockResolvedValue({ id: 'C1', name: 'Clínica' }),
          getClientByCalendarInviteToken: jest.fn(async (token) => (token && client ? client : null))
        },
        agendaService
      });
      return { app, deps, agendaService };
    }

    const future = new Date(Date.now() + 86400000).toISOString();
    const pendingClient = {
      id: 'C1',
      name: 'Clínica',
      CALENDAR_INVITE_TOKEN_HASH: 'hash',
      CALENDAR_INVITE_EXPIRES_AT: future
    };

    it('serves the tutorial, connects via invite and leaves an admin notice', async () => {
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
      const done = await request(app)
        .get('/configuracion/agenda/oauth/callback')
        .query({ code: 'code', state });
      expect(done.status).toBe(302);
      expect(done.headers.location).toMatch(/\/calendar\/conectar\/listo\?r=/);
      expect(done.headers.location).not.toMatch(/#\/clients/);

      const resultToken = new URL(done.headers.location).searchParams.get('r');
      const result = await request(app).get('/public/calendar/result').query({ r: resultToken });
      expect(result.body.kind).toBe('connected');
      expect(result.body.email).toBe('ana@example.com');
      expect(result.body.botName).toBe('Clínica');

      const panel = await request(app).get(BASE).set(authHeader());
      expect(panel.body.agenda.enabled).toBe(false);
      expect(panel.body.agenda.connection.email).toBe('ana@example.com');
      expect(panel.body.agenda.adminNotice.email).toBe('ana@example.com');

      const dismissed = await request(app).post(`${BASE}/notice/dismiss`).set(authHeader()).send({});
      expect(dismissed.status).toBe(200);
      expect(dismissed.body.agenda.adminNotice).toBeNull();
      expect(dismissed.body.agenda.connection.email).toBe('ana@example.com');
    });

    it('panel OAuth leaves no notice; connected link blocks restart; expired link is 410', async () => {
      const { app } = inviteApp(pendingClient);
      const start = await request(app).post(`${BASE}/oauth/start`).set(authHeader()).send({});
      expect(start.status).toBe(200);
      const state = new URL(start.body.url).searchParams.get('state');
      const done = await request(app)
        .get('/configuracion/agenda/oauth/callback')
        .query({ code: 'code', state });
      expect(done.status).toBe(302);
      expect(done.headers.location).toMatch(/calendar=connected/);
      const panel = await request(app).get(BASE).set(authHeader());
      expect(panel.body.agenda.adminNotice).toBeNull();

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

    it('rejects an unknown link with 404 and an invalid result with 400', async () => {
      const { app } = inviteApp(null);
      const missing = await request(app).get('/public/calendar/invite/no-existe');
      expect(missing.status).toBe(404);
      const bad = await request(app).get('/public/calendar/result').query({ r: 'garbage' });
      expect(bad.status).toBe(400);
    });
  });

  describe('public OAuth callback', () => {
    const CALLBACK = '/configuracion/agenda/oauth/callback';

    it('400 on invalid state', async () => {
      const { app } = agendaApp();
      const res = await request(app).get(`${CALLBACK}?state=bad&code=x`);
      expect(res.status).toBe(400);
    });

    it('serves the legacy /calendar/oauth/callback alias with the same handler', async () => {
      const { app } = agendaApp();
      const bad = await request(app).get('/calendar/oauth/callback?state=bad&code=x');
      expect(bad.status).toBe(400);
      const state = signState(
        { clientId: 'C1', nonce: 'n1', exp: Date.now() + 60000, via: 'panel' },
        stateSecret(process.env)
      );
      const res = await request(app).get(`/calendar/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/#/clients/C1/assistant?calendar=denied');
    });

    it('redirects to the panel with denied when the user refuses (panel flow)', async () => {
      const { app } = agendaApp();
      const state = signState(
        { clientId: 'C1', nonce: 'n1', exp: Date.now() + 60000, via: 'panel' },
        stateSecret(process.env)
      );
      const res = await request(app).get(`${CALLBACK}?error=access_denied&state=${encodeURIComponent(state)}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/#/clients/C1/assistant?calendar=denied');
    });

    it('redirects invited users to the result page with a signed result', async () => {
      const { app } = agendaApp({
        firebaseService: { getClientById: jest.fn().mockResolvedValue({ id: 'C1', name: 'Bot Uno' }) }
      });
      const state = signState(
        { clientId: 'C1', nonce: 'n1', exp: Date.now() + 60000, via: 'invite' },
        stateSecret(process.env)
      );
      const res = await request(app).get(`${CALLBACK}?error=access_denied&state=${encodeURIComponent(state)}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/calendar\/conectar\/listo\?r=/);
    });

    it('redirects with error when the nonce does not match', async () => {
      const { app } = agendaApp();
      const state = signState(
        { clientId: 'C1', nonce: 'unknown', exp: Date.now() + 60000, via: 'panel' },
        stateSecret(process.env)
      );
      const res = await request(app).get(`${CALLBACK}?code=abc&state=${encodeURIComponent(state)}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('calendar=error');
    });
  });
});
