import type { BookingHoursDay, CalendarEvent } from './types';

// Date-only values are parsed and formatted in UTC so browser time zones cannot
// move an appointment onto the previous or following day.
const parseDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const dayKeys: CalendarEvent['day'][] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const DEFAULT_SALON_TIME_ZONE = 'Europe/Zurich';

export const salonTimeZone = (timeZone = DEFAULT_SALON_TIME_ZONE): string => {
  const zone = timeZone.trim().split(/\s+/)[0] || DEFAULT_SALON_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_SALON_TIME_ZONE;
  }
};

/** Show the offset for the displayed date, including winter/summer changes. */
export const calendarTimeZoneOffset = (date: string, timeZone = DEFAULT_SALON_TIME_ZONE): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: salonTimeZone(timeZone), timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`)).find(part => part.type === 'timeZoneName')?.value ?? '';

/** Include the whole opening window and any existing appointments outside it. */
export const calendarHours = (dates: string[], bookingHours: BookingHoursDay[], events: CalendarEvent[]): string[] => {
  const intervals: Array<{ start: number; end: number }> = [];
  const minutes = (time: string): number | null => {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
  };
  const include = (startTime: string, endTime: string) => {
    const start = minutes(startTime);
    const end = minutes(endTime);
    if (start !== null && end !== null && end > start) intervals.push({ start, end });
  };
  for (const date of dates) {
    const weekday = parseDate(date).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    const opening = bookingHours.find(day => day.day === weekday && day.isOpen);
    if (opening) include(opening.from, opening.to);
  }
  for (const event of events) {
    if (dates.includes(event.date)) include(event.startTime, event.endTime);
  }
  const first = intervals.length ? Math.floor(Math.min(...intervals.map(interval => interval.start)) / 60) : 9;
  const last = intervals.length ? Math.ceil(Math.max(...intervals.map(interval => interval.end)) / 60) : 18;
  return Array.from({ length: Math.max(1, last - first) }, (_, index) => `${String(first + index).padStart(2, '0')}:00`);
};

/** Calendar date and clock time at the salon, independent of the browser zone. */
export const getSalonNow = (timeZone = DEFAULT_SALON_TIME_ZONE, now = new Date()): { date: string; time: string } => {
  // Older settings include a display suffix, such as "(GMT+01:00)".
  const zone = timeZone.trim().split(/\s+/)[0] || DEFAULT_SALON_TIME_ZONE;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_SALON_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

export const addMinutes = (time: string, minutes: number): string => {
  const [hours, mins] = time.split(':').map(Number);
  const total = ((hours * 60 + mins + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export const formatDate = (date: string): string =>
  parseDate(date).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

export const formatCalendarDate = (date: string): string => {
  const value = parseDate(date);
  const weekday = value.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday} ${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const dayKeyForDate = (date: string): CalendarEvent['day'] => dayKeys[parseDate(date).getUTCDay()];

export const addDays = (date: string, delta: number): string => {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
};

export const startOfWeek = (date: string): string => {
  const weekday = parseDate(date).getUTCDay();
  return addDays(date, -(weekday === 0 ? 6 : weekday - 1));
};

export const currentSalonWeek = (timeZone = DEFAULT_SALON_TIME_ZONE, now = new Date()): string =>
  startOfWeek(getSalonNow(timeZone, now).date);
