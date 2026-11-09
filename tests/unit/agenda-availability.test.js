const { normalizeAgenda } = require('../../src/services/configuracion/agenda/normalize');
const { describePhase } = require('../../src/services/configuracion/agenda/readiness');
const { zonedToUtc, dayWindows } = require('../../src/services/configuracion/agenda/time');
const { buildAvailableSlots, countOccupancy } = require('../../src/services/configuracion/agenda/availability');

const TZ = 'America/Mexico_City';

function baseHours() {
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

function baseRules() {
  return {
    minNoticeMinutes: 0,
    maxDaysAhead: 14,
    slotIntervalMinutes: 30,
    bufferMinutes: 0,
    appointmentsPerBlock: 1
  };
}

function mondayNineUtc() {
  return zonedToUtc('2026-11-09', '09:00', TZ);
}

function slotArgs(overrides = {}) {
  return {
    now: new Date('2026-11-08T12:00:00.000Z'),
    timeZone: TZ,
    hours: baseHours(),
    exceptions: [],
    service: { id: 'svc_1', durationMinutes: 30, active: true },
    rules: baseRules(),
    fromDate: '2026-11-09',
    toDate: '2026-11-09',
    appointments: [],
    googleBusy: [],
    limit: 20,
    ...overrides
  };
}

describe('agenda availability', () => {
  it('normalizeAgenda validates appointmentsPerBlock and drops service capacity', () => {
    const bad = normalizeAgenda({
      timezone: TZ,
      hours: baseHours(),
      services: [{ name: 'X', durationMinutes: 30, active: true }],
      rules: { appointmentsPerBlock: 0 }
    });
    expect(bad.ok).toBe(false);
    const tooBig = normalizeAgenda({
      timezone: TZ,
      hours: baseHours(),
      services: [{ name: 'X', durationMinutes: 30, active: true }],
      rules: { appointmentsPerBlock: 101 }
    });
    expect(tooBig.ok).toBe(false);
    const good = normalizeAgenda({
      timezone: TZ,
      hours: baseHours(),
      services: [
        { name: 'X', durationMinutes: 30, capacity: 99, active: true },
        { name: 'Y', durationMinutes: 30 }
      ],
      rules: { appointmentsPerBlock: 3 }
    });
    expect(good.ok).toBe(true);
    expect(good.value.services[0]).not.toHaveProperty('capacity');
    expect(good.value.services[1]).not.toHaveProperty('capacity');
    expect(good.value.rules.appointmentsPerBlock).toBe(3);
    expect(good.value.rules.calendarColumns).toBe(3);
    // calendarColumns se unifica con appointmentsPerBlock (columnas = cupo).
    const cols = normalizeAgenda({
      timezone: TZ,
      hours: baseHours(),
      services: [{ name: 'X', durationMinutes: 30, active: true }],
      rules: { appointmentsPerBlock: 2, calendarColumns: 4 }
    });
    expect(cols.ok).toBe(true);
    expect(cols.value.rules.appointmentsPerBlock).toBe(2);
    expect(cols.value.rules.calendarColumns).toBe(2);
    expect(normalizeAgenda({
      timezone: TZ,
      hours: baseHours(),
      services: [{ name: 'X', durationMinutes: 30, active: true }],
      rules: { calendarColumns: 0 }
    }).ok).toBe(false);
    expect(good.value.exceptions).toEqual([]);
  });

  it('normalizeAgenda validates exceptions', () => {
    const base = { timezone: TZ, hours: baseHours(), services: [], rules: {} };
    const closed = normalizeAgenda({ ...base, exceptions: [{ date: '2026-11-09', closed: true }] });
    expect(closed.ok).toBe(true);
    expect(closed.value.exceptions).toEqual([{ date: '2026-11-09', closed: true, intervals: [], note: '' }]);
    const special = normalizeAgenda({
      ...base,
      exceptions: [{ date: '2026-11-10', closed: false, intervals: [{ start: '10:00', end: '14:00' }] }]
    });
    expect(special.ok).toBe(true);
    expect(special.value.exceptions[0].intervals).toEqual([{ start: '10:00', end: '14:00' }]);
    expect(normalizeAgenda({ ...base, exceptions: [{ date: 'nope', closed: true }] }).ok).toBe(false);
    expect(normalizeAgenda({ ...base, exceptions: [{ date: '2026-11-10', closed: false }] }).ok).toBe(false);
    expect(normalizeAgenda({
      ...base,
      exceptions: [{ date: '2026-11-10', closed: true }, { date: '2026-11-10', closed: true }]
    }).ok).toBe(false);
  });

  it('describePhase covers disabled, disconnected, revoked, incomplete and ready', () => {
    const connected = {
      enabled: true,
      connection: { status: 'connected', email: 'a@b.com', calendarId: 'cal' },
      hours: baseHours(),
      services: [{ id: 'svc_1', active: true }]
    };
    expect(describePhase({ ...connected, enabled: false }).phase).toBe('disabled');
    expect(describePhase({ ...connected, connection: { status: 'disconnected' } }).phase).toBe('disconnected');
    expect(describePhase({ ...connected, connection: { status: 'revoked' } }).phase).toBe('revoked');
    const incomplete = describePhase({ ...connected, services: [] });
    expect(incomplete.phase).toBe('incomplete');
    expect(incomplete.missing).toEqual(['services']);
    const ready = describePhase(connected);
    expect(ready).toMatchObject({ phase: 'ready', ready: true, missing: [] });
  });

  it('dayWindows prefers exceptions over weekly hours', () => {
    const hours = baseHours();
    expect(dayWindows({ date: '2026-11-09', hours, exceptions: [], timeZone: TZ }))
      .toEqual({ closed: false, intervals: [{ start: '09:00', end: '12:00' }] });
    expect(dayWindows({ date: '2026-11-10', hours, exceptions: [], timeZone: TZ }))
      .toEqual({ closed: true, intervals: [] });
    expect(dayWindows({
      date: '2026-11-09', hours, exceptions: [{ date: '2026-11-09', closed: true }], timeZone: TZ
    })).toEqual({ closed: true, intervals: [] });
    expect(dayWindows({
      date: '2026-11-10',
      hours,
      exceptions: [{ date: '2026-11-10', closed: false, intervals: [{ start: '10:00', end: '11:00' }] }],
      timeZone: TZ
    })).toEqual({ closed: false, intervals: [{ start: '10:00', end: '11:00' }] });
  });

  it('zonedToUtc anchors Monday 09:00 Mexico City at 15:00Z', () => {
    expect(mondayNineUtc().toISOString()).toBe('2026-11-09T15:00:00.000Z');
  });

  it('does not let a full morning block fill the next block via buffer', () => {
    const nine = mondayNineUtc().getTime();
    const eleven = nine + 120 * 60000;
    const thirteen = eleven + 120 * 60000;
    const appointments = [1, 2, 3].map((n) => ({
      id: `a${n}`,
      status: 'confirmed',
      start: new Date(nine).toISOString(),
      end: new Date(eleven).toISOString()
    }));
    expect(countOccupancy({
      startMs: eleven,
      endMs: thirteen,
      appointments,
      googleBusy: [],
      bufferMs: 20 * 60000
    })).toBe(0);
    const result = buildAvailableSlots(slotArgs({
      appointments,
      service: { id: 'svc_1', durationMinutes: 120, active: true },
      hours: {
        ...baseHours(),
        monday: { enabled: true, intervals: [{ start: '09:00', end: '15:00' }] }
      },
      rules: { ...baseRules(), bufferMinutes: 20, appointmentsPerBlock: 3 },
      limit: 20
    }));
    expect(result.slots.map((s) => s.startLocal)).toEqual([
      '2026-11-09T11:00',
      '2026-11-09T11:30',
      '2026-11-09T12:00',
      '2026-11-09T12:30',
      '2026-11-09T13:00'
    ]);
  });

  it('allows two bookings when appointmentsPerBlock is 2', () => {
    const start = mondayNineUtc().getTime();
    const end = start + 30 * 60 * 1000;
    const appointments = [
      { id: 'a1', status: 'confirmed', start: new Date(start).toISOString(), end: new Date(end).toISOString() }
    ];
    const occupied = countOccupancy({
      startMs: start, endMs: end, appointments, googleBusy: [], bufferMs: 0
    });
    expect(occupied).toBe(1);
    const cap1 = buildAvailableSlots(slotArgs({ appointments }));
    expect(cap1.slots.map((s) => s.start)).not.toContain(new Date(start).toISOString());
    const cap2 = buildAvailableSlots(slotArgs({
      appointments,
      rules: { ...baseRules(), appointmentsPerBlock: 2 }
    }));
    expect(cap2.slots.map((s) => s.start)).toContain(new Date(start).toISOString());
    const full = buildAvailableSlots(slotArgs({
      appointments: [...appointments, { ...appointments[0], id: 'a2' }],
      rules: { ...baseRules(), appointmentsPerBlock: 2 }
    }));
    expect(full.slots.map((s) => s.start)).not.toContain(new Date(start).toISOString());
  });

  it('ignores cancelled appointments and excludeAppointmentId', () => {
    const start = mondayNineUtc().getTime();
    const end = start + 30 * 60 * 1000;
    const base = { startMs: start, endMs: end, googleBusy: [], bufferMs: 0 };
    const row = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    expect(countOccupancy({ ...base, appointments: [{ id: 'a1', status: 'cancelled', ...row }] })).toBe(0);
    expect(countOccupancy({
      ...base, appointments: [{ id: 'a1', status: 'confirmed', ...row }], excludeAppointmentId: 'a1'
    })).toBe(0);
  });

  it('closed exception yields no slots that day', () => {
    const open = buildAvailableSlots(slotArgs());
    expect(open.slots.length).toBe(6);
    const result = buildAvailableSlots(slotArgs({ exceptions: [{ date: '2026-11-09', closed: true }] }));
    expect((result.slots || []).length).toBe(0);
  });

  it('special-interval exception replaces weekly hours', () => {
    const result = buildAvailableSlots(slotArgs({
      fromDate: '2026-11-10',
      toDate: '2026-11-10',
      exceptions: [{ date: '2026-11-10', closed: false, intervals: [{ start: '10:00', end: '11:00' }] }]
    }));
    expect(result.slots.map((s) => s.startLocal)).toEqual(['2026-11-10T10:00', '2026-11-10T10:30']);
  });

  it('onePerDay returns dates', () => {
    const result = buildAvailableSlots(slotArgs({ toDate: '2026-11-16', onePerDay: true }));
    expect(result.dates.map((d) => d.date)).toEqual(['2026-11-09', '2026-11-16']);
    expect(result.dates[0].slot.startLocal).toBe('2026-11-09T09:00');
  });

  it('respects min notice and google busy', () => {
    const start = mondayNineUtc().getTime();
    const result = buildAvailableSlots(slotArgs({
      now: new Date(start - 30 * 60000),
      rules: { ...baseRules(), minNoticeMinutes: 60 },
      googleBusy: [{ start: new Date(start + 60 * 60000).toISOString(), end: new Date(start + 90 * 60000).toISOString() }]
    }));
    const starts = result.slots.map((s) => s.startLocal);
    expect(starts).not.toContain('2026-11-09T09:00');
    expect(starts).not.toContain('2026-11-09T10:00');
    expect(starts).toContain('2026-11-09T10:30');
  });

  it('does not double-count google busy matching own synced event range', () => {
    const startIso = '2026-11-09T15:00:00.000Z';
    const endIso = '2026-11-09T15:30:00.000Z';
    const n = countOccupancy({
      startMs: Date.parse(startIso),
      endMs: Date.parse(endIso),
      appointments: [{
        id: 'a1', status: 'confirmed', start: startIso, end: endIso, eventId: 'g1'
      }],
      googleBusy: [{ start: startIso, end: endIso }],
      ownEventIds: new Set(['g1']),
      bufferMs: 0
    });
    expect(n).toBe(1);
  });

  it('counts at most one google busy cupo per candidate slot even with many short busy blocks', () => {
    const start = mondayNineUtc().getTime();
    // Ventana de 2 horas con 4 bloques de 30 min en Google (como un servicio de 120 min)
    const googleBusy = [0, 1, 2, 3].map((i) => ({
      start: new Date(start + i * 30 * 60000).toISOString(),
      end: new Date(start + (i + 1) * 30 * 60000).toISOString()
    }));
    const occupied = countOccupancy({
      startMs: start,
      endMs: start + 120 * 60000,
      appointments: [],
      googleBusy,
      ownEventIds: new Set(),
      bufferMs: 0
    });
    expect(occupied).toBe(1);

    const result = buildAvailableSlots(slotArgs({
      service: { id: 'svc_1', durationMinutes: 120, active: true },
      hours: {
        ...baseHours(),
        monday: { enabled: true, intervals: [{ start: '09:00', end: '15:00' }] }
      },
      // Inicios cada 30 min; duración de cada cita = 120; Google cuenta 1 cupo (capacity 3).
      rules: { ...baseRules(), slotIntervalMinutes: 30, appointmentsPerBlock: 3 },
      googleBusy,
      limit: 20
    }));
    expect(result.slots.map((s) => s.startLocal)).toEqual([
      '2026-11-09T09:00',
      '2026-11-09T09:30',
      '2026-11-09T10:00',
      '2026-11-09T10:30',
      '2026-11-09T11:00',
      '2026-11-09T11:30',
      '2026-11-09T12:00',
      '2026-11-09T12:30',
      '2026-11-09T13:00'
    ]);
    expect(result.slots.every((s) => {
      const mins = (Date.parse(s.end) - Date.parse(s.start)) / 60000;
      return mins === 120;
    })).toBe(true);
  });

  it('offers starts every slotIntervalMinutes while each slot lasts service duration', () => {
    const result = buildAvailableSlots(slotArgs({
      service: { id: 'svc_1', durationMinutes: 120, active: true },
      hours: {
        ...baseHours(),
        monday: { enabled: true, intervals: [{ start: '09:00', end: '15:00' }] }
      },
      rules: { ...baseRules(), slotIntervalMinutes: 30 },
      limit: 20
    }));
    expect(result.slots.map((s) => s.startLocal)).toEqual([
      '2026-11-09T09:00',
      '2026-11-09T09:30',
      '2026-11-09T10:00',
      '2026-11-09T10:30',
      '2026-11-09T11:00',
      '2026-11-09T11:30',
      '2026-11-09T12:00',
      '2026-11-09T12:30',
      '2026-11-09T13:00'
    ]);
    expect(result.slots.map((s) => s.endLocal)).toEqual([
      '2026-11-09T11:00',
      '2026-11-09T11:30',
      '2026-11-09T12:00',
      '2026-11-09T12:30',
      '2026-11-09T13:00',
      '2026-11-09T13:30',
      '2026-11-09T14:00',
      '2026-11-09T14:30',
      '2026-11-09T15:00'
    ]);
  });

  it('ignores google freeBusy merged across consecutive own appointments', () => {
    // Citas propias 09:00 y 09:30; Google a veces las fusiona en un solo busy 09:00–10:00
    const a1Start = mondayNineUtc().getTime();
    const a1End = a1Start + 30 * 60000;
    const a2Start = a1End;
    const a2End = a2Start + 30 * 60000;
    const freeStart = a2End; // 10:00
    const freeEnd = freeStart + 30 * 60000;
    const appointments = [
      {
        id: 'a1', status: 'confirmed', eventId: 'g1',
        start: new Date(a1Start).toISOString(), end: new Date(a1End).toISOString()
      },
      {
        id: 'a2', status: 'confirmed', eventId: 'g2',
        start: new Date(a2Start).toISOString(), end: new Date(a2End).toISOString()
      }
    ];
    const googleBusy = [{
      start: new Date(a1Start).toISOString(),
      end: new Date(a2End).toISOString()
    }];
    const ownEventIds = new Set(['g1', 'g2']);

    expect(countOccupancy({
      startMs: freeStart, endMs: freeEnd, appointments, googleBusy, ownEventIds, bufferMs: 0
    })).toBe(0);

    const result = buildAvailableSlots(slotArgs({
      appointments,
      googleBusy,
      ownEventIds,
      limit: 20
    }));
    const starts = result.slots.map((s) => s.startLocal);
    expect(starts).toContain('2026-11-09T10:00');
    expect(starts).toContain('2026-11-09T10:30');
    expect(starts).toContain('2026-11-09T11:00');
    expect(starts).toContain('2026-11-09T11:30');
    expect(starts).not.toContain('2026-11-09T09:00');
    expect(starts).not.toContain('2026-11-09T09:30');
  });
});
