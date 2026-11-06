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
  it('starts disabled and saves settings with capacity', async () => {
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
        services: [{ name: 'Consulta', durationMinutes: 30, capacity: 3, active: true }],
        exceptions: [],
        rules: {
          minNoticeMinutes: 60,
          maxDaysAhead: 30,
          slotIntervalMinutes: 30,
          bufferMinutes: 0,
          allowCancel: true,
          allowReschedule: true
        }
      });
    expect(saved.status).toBe(200);
    expect(saved.body.agenda.services[0].capacity).toBe(3);
    expect(saved.body.agenda.hours.monday.intervals).toEqual([{ start: '09:00', end: '12:00' }]);
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

  describe('public OAuth callback', () => {
    const CALLBACK = '/configuracion/agenda/oauth/callback';

    it('400 on invalid state', async () => {
      const { app } = agendaApp();
      const res = await request(app).get(`${CALLBACK}?state=bad&code=x`);
      expect(res.status).toBe(400);
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
