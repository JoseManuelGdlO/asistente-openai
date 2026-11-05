const { createAgendaService } = require('../../src/services/configuracion/agenda/createAgendaService');
const { MemorySettingsStore } = require('../../src/services/configuracion/agenda/settingsStore');
const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');

describe('AgendaService createAppointment', () => {
  it('confirma en BD con sync pending sin llamar a Google createEvent', async () => {
    const settingsStore = new MemorySettingsStore();
    const appointmentsStore = new MemoryAppointmentsStore();
    await settingsStore.transaction('C1', (doc) => ({
      ...doc,
      enabled: true,
      hours: {
        monday: { enabled: true, intervals: [{ start: '09:00', end: '18:00' }] },
        tuesday: { enabled: false, intervals: [] },
        wednesday: { enabled: false, intervals: [] },
        thursday: { enabled: false, intervals: [] },
        friday: { enabled: false, intervals: [] },
        saturday: { enabled: false, intervals: [] },
        sunday: { enabled: false, intervals: [] }
      },
      services: [{ id: 'svc_aaaaaa', name: 'Consulta', durationMinutes: 30, capacity: 2, active: true }],
      connection: {
        status: 'connected',
        email: 'a@b.com',
        calendarId: 'cal',
        calendarSummary: 'Cal',
        timezone: 'America/Mexico_City',
        connectedAt: '2026-11-01T00:00:00.000Z',
        lastError: ''
      }
    }));

    const google = {
      configured: () => true,
      freeBusy: jest.fn().mockResolvedValue([]),
      createEvent: jest.fn()
    };

    const service = createAgendaService({
      settingsStore,
      appointmentsStore,
      google,
      tokenOverride: 'tok',
      now: () => new Date('2026-11-08T12:00:00.000Z')
    });

    const result = await service.execute('createAppointment', {
      serviceId: 'svc_aaaaaa',
      start: '2026-11-09T10:00',
      customerName: 'Ana',
      notes: null
    }, { clientId: 'C1', origin: 'meta', userId: '521111' });

    expect(result.success).toBe(true);
    expect(result.sync).toBe('pending');
    expect(google.createEvent).not.toHaveBeenCalled();
    const saved = await appointmentsStore.get('C1', result.appointmentId);
    expect(saved.status).toBe('confirmed');
    expect(saved.sync).toBe('pending');
  });
});
