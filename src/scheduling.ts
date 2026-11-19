import type { BookingHoursDay, CalendarEvent } from './types.js';
import { DEFAULT_TIME_ZONE, openingHoursDay, timeZoneId, zonedDateTime } from './format.js';

// How dates are written is decided in format.ts. The two names below stay here for the many
// files that import them from this module: "Thu, 19.11.2026" and the short "Thu 19.11.".
export { formatDate, formatDateShort as formatCalendarDate } from './format.js';

// Date-only values are parsed in UTC so browser time zones cannot
// move an appointment onto the previous or following day.
const parseDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const dayKeys: CalendarEvent['day'][] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const DEFAULT_SALON_TIME_ZONE = DEFAULT_TIME_ZONE;

/** The salon's time zone as a plain id ("Europe/Zurich"), whatever a stored setting looks like. */
export const salonTimeZone = (timeZone = DEFAULT_SALON_TIME_ZONE): string => timeZoneId(timeZone);

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
    const weekday = openingHoursDay(date);
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

/**
 * Calendar date and clock time at the salon, independent of the browser zone. A setting saved
 * earlier may carry a display suffix ("(GMT+01:00)"), and a name that is no zone counts as Zurich.
 */
export const getSalonNow = (timeZone = DEFAULT_SALON_TIME_ZONE, now = new Date()): { date: string; time: string } =>
  zonedDateTime(now, timeZone);

export const addMinutes = (time: string, minutes: number): string => {
  const [hours, mins] = time.split(':').map(Number);
  const total = ((hours * 60 + mins + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
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
