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
