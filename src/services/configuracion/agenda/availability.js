const {
  addDays,
  formatLocal,
  formatDayLabel,
  formatSlotLabel,
  rangesOverlap,
  weekdayKeyFromDate,
  zonedToUtc,
  dayWindows
} = require('./time');

function appointmentBusyMs(appointments) {
  return (appointments || [])
    .filter((item) => item && item.status === 'confirmed')
    .map((item) => ({
      start: Date.parse(item.start),
      end: Date.parse(item.end),
      eventId: item.eventId || ''
    }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end));
}

function googleBusyMs(raw, { ownEventIds = new Set(), ownRanges = [] } = {}) {
  return (raw || [])
    .map((item) => ({
      start: Date.parse(item.start),
      end: Date.parse(item.end),
      eventId: item.id || item.eventId || ''
    }))
    .filter((item) => {
      if (!Number.isFinite(item.start) || !Number.isFinite(item.end)) return false;
      if (item.eventId && ownEventIds.has(item.eventId)) return false;
      // freeBusy no trae eventId: evita doble conteo de citas ya sincronizadas
      if (ownRanges.some((range) => range.start === item.start && range.end === item.end)) return false;
      return true;
    });
}

function countOccupancy({
  startMs,
  endMs,
  appointments = [],
  googleBusy = [],
  ownEventIds = new Set(),
  bufferMs = 0,
  excludeAppointmentId = null
}) {
  let occupied = 0;
  const ownRanges = [];
  for (const item of appointments || []) {
    if (!item || item.status !== 'confirmed') continue;
    if (excludeAppointmentId && item.id === excludeAppointmentId) continue;
    const start = Date.parse(item.start);
    const end = Date.parse(item.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    ownRanges.push({ start, end });
    if (rangesOverlap(startMs, endMs, start, end, bufferMs)) occupied += 1;
  }
  for (const item of googleBusyMs(googleBusy, { ownEventIds, ownRanges })) {
    if (rangesOverlap(startMs, endMs, item.start, item.end, bufferMs)) occupied += 1;
  }
  return occupied;
}

function buildAvailableSlots({
  now,
  timeZone,
  hours,
  exceptions = [],
  service,
  rules,
  fromDate,
  toDate,
  appointments = [],
  googleBusy = [],
  limit = 8,
  onePerDay = false,
  excludeAppointmentId = null
}) {
  const capacity = Math.max(1, Number(service.capacity) || 1);
  const interval = Math.max(5, Number(rules.slotIntervalMinutes) || 30);
  const bufferMs = Math.max(0, Number(rules.bufferMinutes) || 0) * 60000;
  const durationMs = service.durationMinutes * 60000;
  const minStart = now.getTime() + (Number(rules.minNoticeMinutes) || 0) * 60000;
  const maxStart = now.getTime() + (Number(rules.maxDaysAhead) || 30) * 86400000;
  const ownEventIds = new Set(
    (appointments || [])
      .map((item) => item.eventId)
      .filter((id) => typeof id === 'string' && id)
  );

  const slots = [];
  let date = fromDate;
  while (date <= toDate && slots.length < limit) {
    const windows = dayWindows(date, hours, exceptions);
    let foundDay = false;
    if (!windows.closed && windows.intervals.length) {
      const ordered = [...windows.intervals].sort((a, b) => a.start.localeCompare(b.start));
      for (const window of ordered) {
        if (foundDay) break;
        let cursor = zonedToUtc(date, window.start, timeZone);
        const close = zonedToUtc(date, window.end, timeZone);
        while (cursor.getTime() + durationMs <= close.getTime() && slots.length < limit) {
          const startMs = cursor.getTime();
          const endMs = startMs + durationMs;
          const allowed = startMs >= minStart && startMs <= maxStart;
          const occupied = countOccupancy({
            startMs,
            endMs,
            appointments,
            googleBusy,
            ownEventIds,
            bufferMs,
            excludeAppointmentId
          });
          if (allowed && occupied < capacity) {
            const start = new Date(startMs);
            const end = new Date(endMs);
            slots.push({
              start: start.toISOString(),
              end: end.toISOString(),
              startLocal: formatLocal(start, timeZone),
              endLocal: formatLocal(end, timeZone),
              dayLabel: formatDayLabel(start, timeZone),
              label: formatSlotLabel(start, end, timeZone),
              remaining: capacity - occupied
            });
            if (onePerDay) {
              foundDay = true;
              break;
            }
          }
          cursor = new Date(startMs + interval * 60000);
        }
      }
    }
    date = addDays(date, 1);
  }
  return slots;
}

function isSlotOpen({
  start,
  end,
  service,
  rules,
  appointments,
  googleBusy,
  excludeAppointmentId = null
}) {
  const capacity = Math.max(1, Number(service.capacity) || 1);
  const bufferMs = Math.max(0, Number(rules.bufferMinutes) || 0) * 60000;
  const ownEventIds = new Set(
    (appointments || [])
      .map((item) => item.eventId)
      .filter((id) => typeof id === 'string' && id)
  );
  const occupied = countOccupancy({
    startMs: start.getTime(),
    endMs: end.getTime(),
    appointments,
    googleBusy,
    ownEventIds,
    bufferMs,
    excludeAppointmentId
  });
  return occupied < capacity;
}

module.exports = {
  appointmentBusyMs,
  googleBusyMs,
  countOccupancy,
  buildAvailableSlots,
  isSlotOpen,
  weekdayKeyFromDate
};
