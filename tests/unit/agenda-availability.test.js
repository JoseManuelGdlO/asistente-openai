const { normalizeAgenda, normalizeExceptions } = require('../../src/services/configuracion/agenda/normalize');
const { dayWindows } = require('../../src/services/configuracion/agenda/time');
const {
  countOccupancy,
  buildAvailableSlots,
  googleBusyMs
} = require('../../src/services/configuracion/agenda/availability');

function mondayHours() {
  return {
    monday: { enabled: true, intervals: [{ start: '09:00', end: '12:00' }] },
    tuesday: { enabled: false, intervals: [] },
    wednesday: { enabled: false, intervals: [] },
    thursday: { enabled: false, intervals: [] },
    friday: { enabled: false, intervals: [] },
    saturday: { enabled: false, intervals: [] },
    sunday: { enabled: false, intervals: [] }
  };
}

describe('agenda normalize exceptions', () => {
  it('acepta día cerrado y horario especial', () => {
    const result = normalizeExceptions([
      { date: '2026-11-20', closed: true },
      { date: '2026-11-21', closed: false, intervals: [{ start: '09:00', end: '13:00' }] }
    ]);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([
      { date: '2026-11-20', closed: true },
      { date: '2026-11-21', closed: false, intervals: [{ start: '09:00', end: '13:00' }] }
    ]);
  });

  it('exige capacity >= 1 en servicios', () => {
    const result = normalizeAgenda({
      timezone: 'America/Mexico_City',
      hours: mondayHours(),
      services: [{ name: 'Consulta', durationMinutes: 30, capacity: 0 }],
      rules: {}
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cupo/i);
  });
});

describe('dayWindows', () => {
  it('cierra el día con excepción closed', () => {
    const windows = dayWindows('2026-11-09', mondayHours(), [
      { date: '2026-11-09', closed: true }
    ]);
    expect(windows).toEqual({ closed: true, intervals: [] });
  });

  it('usa intervals especiales sobre la jornada', () => {
    const windows = dayWindows('2026-11-09', mondayHours(), [
      { date: '2026-11-09', closed: false, intervals: [{ start: '10:00', end: '11:00' }] }
    ]);
    expect(windows.closed).toBe(false);
    expect(windows.intervals).toEqual([{ start: '10:00', end: '11:00' }]);
  });
});

describe('countOccupancy / googleBusyMs', () => {
  it('no cuenta bloques Google que coinciden con citas propias', () => {
    const start = Date.parse('2026-11-09T15:00:00.000Z');
    const end = Date.parse('2026-11-09T15:30:00.000Z');
    const appointments = [{
      id: 'apt_1',
      status: 'confirmed',
      start: '2026-11-09T15:00:00.000Z',
      end: '2026-11-09T15:30:00.000Z',
      eventId: 'evt_1'
    }];
    const occupied = countOccupancy({
      startMs: start,
      endMs: end,
      appointments,
      googleBusy: [{ start: '2026-11-09T15:00:00.000Z', end: '2026-11-09T15:30:00.000Z' }],
      ownEventIds: new Set(['evt_1'])
    });
    expect(occupied).toBe(1);
  });

  it('excluye eventId propio si freeBusy lo trae', () => {
    const filtered = googleBusyMs(
      [{ start: '2026-11-09T15:00:00.000Z', end: '2026-11-09T15:30:00.000Z', id: 'evt_1' }],
      { ownEventIds: new Set(['evt_1']) }
    );
    expect(filtered).toHaveLength(0);
  });
});

describe('buildAvailableSlots capacity', () => {
  const now = new Date('2026-11-08T12:00:00.000Z');
  const service = { id: 'svc_a', durationMinutes: 30, capacity: 2 };
  const rules = {
    minNoticeMinutes: 0,
    maxDaysAhead: 30,
    slotIntervalMinutes: 30,
    bufferMinutes: 0
  };

  it('deja el slot libre con capacity 2 y una cita confirmada', () => {
    const slots = buildAvailableSlots({
      now,
      timeZone: 'America/Mexico_City',
      hours: mondayHours(),
      service,
      rules,
      fromDate: '2026-11-09',
      toDate: '2026-11-09',
      appointments: [{
        id: 'apt_1',
        status: 'confirmed',
        start: '2026-11-09T15:00:00.000Z',
        end: '2026-11-09T15:30:00.000Z'
      }],
      googleBusy: [],
      limit: 20
    });
    const ten = slots.find((slot) => slot.startLocal === '2026-11-09T09:00');
    expect(ten).toBeTruthy();
    expect(ten.remaining).toBe(1);
  });

  it('oculta el slot cuando capacity se agota', () => {
    const slots = buildAvailableSlots({
      now,
      timeZone: 'America/Mexico_City',
      hours: mondayHours(),
      service: { ...service, capacity: 1 },
      rules,
      fromDate: '2026-11-09',
      toDate: '2026-11-09',
      appointments: [{
        id: 'apt_1',
        status: 'confirmed',
        start: '2026-11-09T15:00:00.000Z',
        end: '2026-11-09T15:30:00.000Z'
      }],
      googleBusy: [],
      limit: 20
    });
    expect(slots.some((slot) => slot.startLocal === '2026-11-09T09:00')).toBe(false);
  });

  it('no genera slots en día cerrado por excepción', () => {
    const slots = buildAvailableSlots({
      now,
      timeZone: 'America/Mexico_City',
      hours: mondayHours(),
      exceptions: [{ date: '2026-11-09', closed: true }],
      service,
      rules,
      fromDate: '2026-11-09',
      toDate: '2026-11-09',
      appointments: [],
      googleBusy: [],
      limit: 20
    });
    expect(slots).toEqual([]);
  });

  it('respeta maxSlotsPerDay', () => {
    const slots = buildAvailableSlots({
      now,
      timeZone: 'America/Mexico_City',
      hours: mondayHours(),
      service,
      rules: { ...rules, maxSlotsPerDay: 2 },
      fromDate: '2026-11-09',
      toDate: '2026-11-09',
      appointments: [],
      googleBusy: [],
      limit: 20
    });
    expect(slots).toHaveLength(2);
  });
});
