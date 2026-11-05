const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');
const { createAgendaService } = require('../../src/services/configuracion/agenda/createAgendaService');
const { MemorySettingsStore } = require('../../src/services/configuracion/agenda/settingsStore');
const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');

function editorHeaders(id = 'editor-a') {
  return { ...authHeader(), 'X-Editor-Id': id };
}

describe('API configuracion/agenda', () => {
  function build() {
    const settingsStore = new MemorySettingsStore();
    const appointmentsStore = new MemoryAppointmentsStore();
    const agendaService = createAgendaService({
      settingsStore,
      appointmentsStore,
      google: { configured: () => true }
    });
    const { app } = createTestApp({
      agendaService,
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active', agendaEngine: 'v2' })
      }
    });
    return { app, agendaService, settingsStore };
  }

  it('GET panel sin auth → 401', async () => {
    const { app } = build();
    const res = await request(app).get('/clients/C1/configuracion/agenda');
    expect(res.status).toBe(401);
  });

  it('GET panel ok', async () => {
    const { app } = build();
    const res = await request(app).get('/clients/C1/configuracion/agenda').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.agenda).toBeTruthy();
    expect(res.body.agendaEngine).toBe('v2');
  });

  it('PUT settings con lock guarda cupo y excepciones', async () => {
    const { app, settingsStore } = build();
    const res = await request(app)
      .put('/clients/C1/configuracion/agenda/settings')
      .set(editorHeaders())
      .send({
        timezone: 'America/Mexico_City',
        hours: {
          monday: { enabled: true, intervals: [{ start: '09:00', end: '18:00' }] },
          tuesday: { enabled: false, intervals: [] },
          wednesday: { enabled: false, intervals: [] },
          thursday: { enabled: false, intervals: [] },
          friday: { enabled: false, intervals: [] },
          saturday: { enabled: false, intervals: [] },
          sunday: { enabled: false, intervals: [] }
        },
        services: [{ name: 'Consulta', durationMinutes: 30, capacity: 3, active: true }],
        exceptions: [{ date: '2026-12-25', closed: true }],
        rules: {}
      });
    expect(res.status).toBe(200);
    expect(res.body.agenda.services[0].capacity).toBe(3);
    expect(res.body.agenda.exceptions[0].date).toBe('2026-12-25');
    const saved = await settingsStore.getRaw('C1');
    expect(saved.services[0].capacity).toBe(3);
  });

  it('GET 404 si assistant no existe', async () => {
    const { app } = createTestApp({
      agendaService: createAgendaService({
        settingsStore: new MemorySettingsStore(),
        appointmentsStore: new MemoryAppointmentsStore(),
        google: { configured: () => true }
      }),
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue(null)
      }
    });
    const res = await request(app).get('/clients/MISSING/configuracion/agenda').set(authHeader());
    expect(res.status).toBe(404);
  });
});
