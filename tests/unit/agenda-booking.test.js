const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');
const { bookAppointment } = require('../../src/services/configuracion/agenda/booking');

const start = new Date('2026-11-09T15:00:00.000Z');
const end = new Date('2026-11-09T15:30:00.000Z');
const rules = { bufferMinutes: 0 };

describe('bookAppointment', () => {
  it('reserva cuando hay cupo', async () => {
    const store = new MemoryAppointmentsStore();
    const result = await bookAppointment({
      appointmentsStore: store,
      clientId: 'C1',
      service: { id: 'svc_a', capacity: 1 },
      start,
      end,
      customerName: 'Ana',
      rules,
      googleBusy: []
    });
    expect(result.ok).toBe(true);
    expect(result.appointment.status).toBe('confirmed');
    expect(result.appointment.sync).toBe('pending');
    const saved = await store.get('C1', result.appointment.id);
    expect(saved.customerName).toBe('Ana');
  });

  it('rechaza cuando capacity 1 ya está llena', async () => {
    const store = new MemoryAppointmentsStore();
    const first = await bookAppointment({
      appointmentsStore: store,
      clientId: 'C1',
      service: { id: 'svc_a', capacity: 1 },
      start,
      end,
      customerName: 'Ana',
      rules,
      googleBusy: []
    });
    expect(first.ok).toBe(true);
    const second = await bookAppointment({
      appointmentsStore: store,
      clientId: 'C1',
      service: { id: 'svc_a', capacity: 1 },
      start,
      end,
      customerName: 'Luis',
      rules,
      googleBusy: []
    });
    expect(second).toEqual({ ok: false, code: 'slot_full' });
  });

  it('permite dos reservas con capacity 2', async () => {
    const store = new MemoryAppointmentsStore();
    const service = { id: 'svc_a', capacity: 2 };
    const a = await bookAppointment({
      appointmentsStore: store,
      clientId: 'C1',
      service,
      start,
      end,
      customerName: 'Ana',
      rules,
      googleBusy: []
    });
    const b = await bookAppointment({
      appointmentsStore: store,
      clientId: 'C1',
      service,
      start,
      end,
      customerName: 'Luis',
      rules,
      googleBusy: []
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});
