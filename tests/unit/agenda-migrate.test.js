const { MemoryCalendarStore } = require('../../src/services/calendar/memoryStore');
const { MemorySettingsStore } = require('../../src/services/configuracion/agenda/settingsStore');
const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');
const { migrateClient } = require('../../src/services/configuracion/agenda/migrate');

describe('migrateClient', () => {
  it('copia settings y busy confirmed a appointments', async () => {
    const calendarStore = new MemoryCalendarStore();
    const settingsStore = new MemorySettingsStore();
    const appointmentsStore = new MemoryAppointmentsStore();
    await calendarStore.transaction('C1', (doc) => ({
      ...doc,
      enabled: true,
      services: [{ id: 'svc_aaaaaa', name: 'Consulta', durationMinutes: 30, active: true }],
      connection: {
        status: 'connected',
        email: 'a@b.com',
        calendarId: 'cal',
        calendarSummary: 'Cal',
        timezone: 'America/Mexico_City',
        connectedAt: '2026-11-01T00:00:00.000Z',
        lastError: ''
      },
      busy: [{
        id: 'apt_old',
        status: 'confirmed',
        start: '2026-11-09T15:00:00.000Z',
        end: '2026-11-09T15:30:00.000Z',
        serviceId: 'svc_aaaaaa',
        customerName: 'Ana',
        eventId: 'evt_1'
      }]
    }));

    const setAgendaEngine = jest.fn().mockResolvedValue(undefined);
    await migrateClient({
      clientId: 'C1',
      calendarStore,
      settingsStore,
      appointmentsStore,
      setAgendaEngine
    });

    const settings = await settingsStore.getRaw('C1');
    expect(settings.enabled).toBe(true);
    expect(settings.services[0].capacity).toBe(1);
    const apt = await appointmentsStore.get('C1', 'apt_old');
    expect(apt.sync).toBe('synced');
    expect(apt.eventId).toBe('evt_1');
    expect(setAgendaEngine).toHaveBeenCalledWith('C1', 'v2');
  });
});
