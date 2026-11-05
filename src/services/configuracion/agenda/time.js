const calendarTime = require('../../calendar/time');
const { WEEKDAYS } = require('./constants');

const weekdayKeys = WEEKDAYS.map(([key]) => key);

function dayWindows(date, hours, exceptions = []) {
  const exception = (exceptions || []).find((item) => item.date === date);
  if (exception) {
    if (exception.closed) return { closed: true, intervals: [] };
    return {
      closed: false,
      intervals: Array.isArray(exception.intervals) ? exception.intervals : []
    };
  }
  const key = calendarTime.weekdayKeyFromDate(date);
  const day = hours?.[key];
  if (!day?.enabled || !Array.isArray(day.intervals) || !day.intervals.length) {
    return { closed: true, intervals: [] };
  }
  return { closed: false, intervals: day.intervals };
}

function fitsDayWindows(start, end, timeZone, hours, exceptions) {
  const date = calendarTime.localDate(start, timeZone);
  const windows = dayWindows(date, hours, exceptions);
  if (windows.closed || !windows.intervals.length) return false;
  const startLocal = calendarTime.formatLocal(start, timeZone).slice(11, 16);
  const endLocal = calendarTime.formatLocal(end, timeZone).slice(11, 16);
  const endDate = calendarTime.localDate(end, timeZone);
  if (endDate !== date && endLocal !== '00:00') return false;
  return windows.intervals.some((interval) => startLocal >= interval.start && endLocal <= interval.end);
}

module.exports = {
  ...calendarTime,
  weekdayKeys,
  dayWindows,
  fitsDayWindows
};
