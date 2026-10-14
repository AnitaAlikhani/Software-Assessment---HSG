import type { CalendarEvent } from './types';

// Date-only values are parsed and formatted in UTC so browser time zones cannot
// move an appointment onto the previous or following day.
const parseDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const dayKeys: CalendarEvent['day'][] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const DEFAULT_SALON_TIME_ZONE = 'Europe/Zurich';

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
