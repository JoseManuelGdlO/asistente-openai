const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');
const { MemorySettingsStore } = require('../../src/services/configuracion/agenda/settingsStore');
const {
  bookAppointment,
  rescheduleAppointmentRecord,
  cancelAppointmentRecord
} = require('../../src/services/configuracion/agenda/booking');

describe('agenda booking', () => {
  const service = { id: 'svc_a', durationMinutes: 30 };
  const start = new Date('2026-11-09T15:00:00.000Z');
  const end = new Date('2026-11-09T15:30:00.000Z');
  const base = {
    clientId: 'C1',
    service,
    start,
    end,
    googleBusy: [],
    rules: { bufferMinutes: 0, appointmentsPerBlock: 1 }
  };

  it('books first slot and rejects second when appointmentsPerBlock is 1', async () => {
    const store = new MemoryAppointmentsStore();
    const first = await bookAppointment({ ...base, appointmentsStore: store, customerName: 'Ana' });
    expect(first.ok).toBe(true);
    expect(first.appointment).toMatchObject({
      status: 'confirmed', sync: 'pending', eventId: '', syncAttempts: 0, serviceId: 'svc_a'
    });

    const second = await bookAppointment({ ...base, appointmentsStore: store, customerName: 'Luis' });
    expect(second).toEqual({ ok: false, code: 'slot_full' });
  });

  it('allows two when appointmentsPerBlock is 2 and rejects the third', async () => {
    const store = new MemoryAppointmentsStore();
    const rules = { ...base.rules, appointmentsPerBlock: 2 };
    const a = await bookAppointment({ ...base, rules, appointmentsStore: store, customerName: 'A' });
    const b = await bookAppointment({ ...base, rules, appointmentsStore: store, customerName: 'B' });
    const c = await bookAppointment({ ...base, rules, appointmentsStore: store, customerName: 'C' });
    expect(a.ok && b.ok).toBe(true);
    expect(c).toEqual({ ok: false, code: 'slot_full' });
  });

  it('concurrent bookings never exceed appointmentsPerBlock', async () => {
    const store = new MemoryAppointmentsStore();
    const results = await Promise.all(
      ['A', 'B', 'C', 'D'].map((n) => bookAppointment({ ...base, appointmentsStore: store, customerName: n }))
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('does not double-count the Google mirror of a confirmed appointment', async () => {
    const store = new MemoryAppointmentsStore();
    const rules = { ...base.rules, appointmentsPerBlock: 2 };
    const a = await bookAppointment({ ...base, rules, appointmentsStore: store, customerName: 'A' });
    await store.runTransaction('C1', async (tx) => {
      const row = await tx.get(a.appointment.id);
      tx.set(a.appointment.id, { ...row, eventId: 'g1', sync: 'synced' });
    });
    const googleBusy = [{ id: 'g1', start: start.toISOString(), end: end.toISOString() }];
    const b = await bookAppointment({
      ...base, rules, appointmentsStore: store, customerName: 'B', googleBusy
    });
    expect(b.ok).toBe(true);
  });

  it('counts foreign google busy blocks against appointmentsPerBlock', async () => {
    const store = new MemoryAppointmentsStore();
    const googleBusy = [{ id: 'other', start: start.toISOString(), end: end.toISOString() }];
    const res = await bookAppointment({ ...base, appointmentsStore: store, customerName: 'A', googleBusy });
    expect(res).toEqual({ ok: false, code: 'slot_full' });
  });

  it('cancel keeps row, marks pending, and frees the slot', async () => {
    const store = new MemoryAppointmentsStore();
    const a = await bookAppointment({ ...base, appointmentsStore: store, customerName: 'A' });
    const cancelled = await cancelAppointmentRecord({
      appointmentsStore: store, clientId: 'C1', appointmentId: a.appointment.id
    });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.appointment).toMatchObject({ status: 'cancelled', sync: 'pending' });
    expect(await store.get('C1', a.appointment.id)).toMatchObject({ status: 'cancelled' });
    const again = await bookAppointment({ ...base, appointmentsStore: store, customerName: 'B' });
    expect(again.ok).toBe(true);
  });

  it('cancelled appointment with pending-delete eventId does not block its slot via google mirror', async () => {
    const store = new MemoryAppointmentsStore();
    const a = await bookAppointment({ ...base, appointmentsStore: store, customerName: 'A' });
    await store.runTransaction('C1', async (tx) => {
      const row = await tx.get(a.appointment.id);
      tx.set(a.appointment.id, { ...row, eventId: 'g1', sync: 'synced' });
    });
    await cancelAppointmentRecord({
      appointmentsStore: store, clientId: 'C1', appointmentId: a.appointment.id
    });
    const cancelled = await store.get('C1', a.appointment.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', sync: 'pending', eventId: 'g1' });

    const googleBusy = [{ id: 'g1', start: start.toISOString(), end: end.toISOString() }];
    const again = await bookAppointment({
      ...base, appointmentsStore: store, customerName: 'B', googleBusy
    });
    expect(again.ok).toBe(true);
  });

  it('cancel on missing appointment returns not_found', async () => {
    const store = new MemoryAppointmentsStore();
    const res = await cancelAppointmentRecord({ appointmentsStore: store, clientId: 'C1', appointmentId: 'nope' });
    expect(res).toEqual({ ok: false, code: 'not_found' });
  });

  it('reschedule moves to a free slot, ignoring its own previous slot', async () => {
    const store = new MemoryAppointmentsStore();
    const a = await bookAppointment({ ...base, appointmentsStore: store, customerName: 'A' });
    const newStart = new Date('2026-11-09T15:15:00.000Z');
    const newEnd = new Date('2026-11-09T15:45:00.000Z');
    const res = await rescheduleAppointmentRecord({
      appointmentsStore: store,
      clientId: 'C1',
      appointmentId: a.appointment.id,
      service,
      start: newStart,
      end: newEnd,
      googleBusy: [],
      rules: { bufferMinutes: 0 }
    });
    expect(res.ok).toBe(true);
    expect(res.appointment).toMatchObject({
      id: a.appointment.id, status: 'confirmed', sync: 'pending', start: newStart.toISOString()
    });
  });

  it('reschedule into a full slot returns slot_full and keeps the original', async () => {
    const store = new MemoryAppointmentsStore();
    const a = await bookAppointment({ ...base, appointmentsStore: store, customerName: 'A' });
    const otherStart = new Date('2026-11-09T16:00:00.000Z');
    const otherEnd = new Date('2026-11-09T16:30:00.000Z');
    await bookAppointment({ ...base, start: otherStart, end: otherEnd, appointmentsStore: store, customerName: 'B' });
    const res = await rescheduleAppointmentRecord({
      appointmentsStore: store, clientId: 'C1', appointmentId: a.appointment.id,
      service, start: otherStart, end: otherEnd, googleBusy: [], rules: { bufferMinutes: 0 }
    });
    expect(res).toEqual({ ok: false, code: 'slot_full' });
    expect((await store.get('C1', a.appointment.id)).start).toBe(start.toISOString());
  });

  it('reschedule is not blocked by its own google mirror event', async () => {
    const store = new MemoryAppointmentsStore();
    const a = await bookAppointment({ ...base, appointmentsStore: store, customerName: 'A' });
    await store.runTransaction('C1', async (tx) => {
      const row = await tx.get(a.appointment.id);
      tx.set(a.appointment.id, { ...row, eventId: 'g1', sync: 'synced' });
    });
    const googleBusy = [{ id: 'g1', start: start.toISOString(), end: end.toISOString() }];
    const res = await rescheduleAppointmentRecord({
      appointmentsStore: store, clientId: 'C1', appointmentId: a.appointment.id,
      service, start, end, googleBusy, rules: { bufferMinutes: 0 }
    });
    expect(res.ok).toBe(true);
  });

  it('listConfirmedInRange, listSyncDue and listAllClientIds', async () => {
    const store = new MemoryAppointmentsStore();
    const a = await bookAppointment({ ...base, appointmentsStore: store, customerName: 'A' });
    await bookAppointment({ ...base, clientId: 'C2', appointmentsStore: store, customerName: 'B' });
    const inRange = await store.listConfirmedInRange('C1', start.getTime() - 1000, end.getTime() + 1000);
    expect(inRange.map((r) => r.id)).toEqual([a.appointment.id]);
    const outRange = await store.listConfirmedInRange('C1', end.getTime() + 1000, end.getTime() + 5000);
    expect(outRange).toEqual([]);
    const due = await store.listSyncDue('C1', Date.now());
    expect(due.map((r) => r.id)).toEqual([a.appointment.id]);
    expect((await store.listAllClientIds()).sort()).toEqual(['C1', 'C2']);
  });

  it('listSyncDue respects nextRetryAt for retry rows', async () => {
    const store = new MemoryAppointmentsStore();
    const a = await bookAppointment({ ...base, appointmentsStore: store, customerName: 'A' });
    const future = new Date(Date.now() + 60000).toISOString();
    await store.runTransaction('C1', async (tx) => {
      const row = await tx.get(a.appointment.id);
      tx.set(a.appointment.id, { ...row, sync: 'retry', nextRetryAt: future });
    });
    expect(await store.listSyncDue('C1', Date.now())).toEqual([]);
    expect(await store.listSyncDue('C1', Date.now() + 120000)).toHaveLength(1);
  });
});

describe('MemorySettingsStore', () => {
  it('returns default doc and applies transactions', async () => {
    const store = new MemorySettingsStore();
    const initial = await store.getRaw('C1');
    expect(initial.enabled).toBe(false);
    expect(initial.connection.status).toBe('disconnected');
    const next = await store.transaction('C1', (doc) => ({ ...doc, enabled: true }));
    expect(next.enabled).toBe(true);
    expect((await store.getRaw('C1')).enabled).toBe(true);
    expect((await store.getRaw('C2')).enabled).toBe(false);
  });
});
