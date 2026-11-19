import type { CalendarEvent } from './types';
import { analyticsPeriods, appointmentAnalytics, type Period } from './analytics';
import { getSalonNow } from './scheduling';

// New bookings are prepended by upsertAppointment; retain that creation order.
export const mostRecentAiAppointment = (events: CalendarEvent[]): CalendarEvent | null =>
  events.find(event => event.isAiBooked) ?? null;

/** Compare salon-local dates and times, never a browser-dependent UTC conversion. */
export function nextUpcomingAppointment(events: CalendarEvent[], now = new Date(), timeZone = 'Europe/Zurich'): CalendarEvent | null {
  const clock = getSalonNow(timeZone, now);
  const cutoff = `${clock.date} ${clock.time}`;
  return events.filter(event => `${event.date} ${event.startTime}` >= cutoff)
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`) || a.id.localeCompare(b.id))[0] ?? null;
}

export interface HomeFigures {
  /** The current calendar month, the period the block is about. */
  month: Period;
  appointments: number;
  /** Of these, the appointments of today and of this week (Monday to Sunday; a week can reach into the next month). */
  today: number;
  week: number;
  aiBookings: number;
  /** Whole per cent; null while the month has no appointment. */
  aiShare: number | null;
  customers: number;
  stillToCome: number;
}

/**
 * The figures of "This month" on Home. They are counted by the functions Analytics uses, for
 * the periods Analytics offers, so both screens show the same numbers; and they are counted
 * from the calendar each time, so accepting, adding or cancelling an appointment shows at once.
 */
export function homeFigures(events: CalendarEvent[], now: Date, timeZone?: string): HomeFigures {
  const clock = getSalonNow(timeZone, now);
  const periods = analyticsPeriods(clock.date);
  const month = appointmentAnalytics(events, periods.month.from, periods.month.to, clock);
  return {
    month: periods.month,
    appointments: month.total,
    today: appointmentAnalytics(events, periods.today.from, periods.today.to).total,
    week: appointmentAnalytics(events, periods.week.from, periods.week.to).total,
    aiBookings: month.aiBookings,
    aiShare: month.aiShare,
    customers: month.customers,
    stillToCome: month.stillToCome ?? 0,
  };
}
