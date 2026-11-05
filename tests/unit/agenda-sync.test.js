const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');
const { syncOneAppointment } = require('../../src/services/configuracion/agenda/syncWorker');

describe('syncOneAppointment', () => {
  it('marca synced y guarda eventId al crear', async () => {
    const store = new MemoryAppointmentsStore();
    const appointment = {
      id: 'apt_1',
      status: 'confirmed',
      sync: 'pending',
      start: '2026-11-09T15:00:00.000Z',
      end: '2026-11-09T15:30:00.000Z',
      customerName: 'Ana',
      serviceId: 'svc_a',
      eventId: '',
      syncAttempts: 0
    };
    await store.runTransaction('C1', async (tx) => tx.set('apt_1', appointment));
    const google = {
      createEvent: jest.fn().mockResolvedValue({ id: 'evt_99' })
    };
    const result = await syncOneAppointment({
      google,
      token: 'tok',
      calendarId: 'cal',
      timeZone: 'America/Mexico_City',
      clientId: 'C1',
      service: { id: 'svc_a', name: 'Consulta', durationMinutes: 30 },
      appointment,
      appointmentsStore: store,
      nowMs: Date.parse('2026-11-08T12:00:00.000Z')
    });
    expect(result.ok).toBe(true);
    const saved = await store.get('C1', 'apt_1');
    expect(saved.sync).toBe('synced');
    expect(saved.eventId).toBe('evt_99');
  });

  it('mantiene la cita y agenda retry si Google falla', async () => {
    const store = new MemoryAppointmentsStore();
    const appointment = {
      id: 'apt_2',
      status: 'confirmed',
      sync: 'pending',
      start: '2026-11-09T15:00:00.000Z',
      end: '2026-11-09T15:30:00.000Z',
      customerName: 'Ana',
      serviceId: 'svc_a',
      eventId: '',
      syncAttempts: 0
    };
    await store.runTransaction('C1', async (tx) => tx.set('apt_2', appointment));
    const google = {
      createEvent: jest.fn().mockRejectedValue(new Error('timeout'))
    };
    const nowMs = Date.parse('2026-11-08T12:00:00.000Z');
    const result = await syncOneAppointment({
      google,
      token: 'tok',
      calendarId: 'cal',
      timeZone: 'America/Mexico_City',
      clientId: 'C1',
      service: { id: 'svc_a', name: 'Consulta', durationMinutes: 30 },
      appointment,
      appointmentsStore: store,
      nowMs
    });
    expect(result.ok).toBe(false);
    const saved = await store.get('C1', 'apt_2');
    expect(saved.status).toBe('confirmed');
    expect(saved.sync).toBe('retry');
    expect(saved.syncAttempts).toBe(1);
    expect(saved.nextRetryAt).toBeGreaterThan(nowMs);
    expect(saved.lastSyncError).toMatch(/timeout/);
  });
});
