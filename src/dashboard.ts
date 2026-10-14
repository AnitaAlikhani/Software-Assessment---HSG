import type { CalendarEvent } from './types';

// New bookings are prepended by upsertAppointment; retain that creation order.
export const mostRecentAiAppointment = (events: CalendarEvent[]): CalendarEvent | null =>
  events.find(event => event.isAiBooked) ?? null;

/** Compare salon-local dates and times, never a browser-dependent UTC conversion. */
export function nextUpcomingAppointment(events: CalendarEvent[], now = new Date(), timeZone = 'Europe/Zurich'): CalendarEvent | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  }
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const cutoff = `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
  return events.filter(event => `${event.date} ${event.startTime}` >= cutoff)
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`) || a.id.localeCompare(b.id))[0] ?? null;
}
