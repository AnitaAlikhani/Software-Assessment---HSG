import type { CalendarEvent } from './types';

// Date-only values are parsed and formatted in UTC so browser time zones cannot
// move an appointment onto the previous or following day.
const parseDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const dayKeys: CalendarEvent['day'][] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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
