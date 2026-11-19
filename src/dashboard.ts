import type { BookingHoursDay, CalendarEvent, ClosedDate } from './types';
import { analyticsPeriods, appointmentAnalytics, type Period } from './analytics';
import { openingHoursDay } from './format';
import { getSalonNow } from './scheduling';

/**
 * The appointments the AI booked most recently, newest booking first: what Home lists under
 * "Booked by the AI". The time of booking decides; where it is missing, the order of the list
 * does, which holds new bookings at the top.
 */
export const latestAiBookings = (events: CalendarEvent[], limit = 5): CalendarEvent[] =>
  events.map((event, index) => ({ event, index }))
    .filter(({ event }) => event.isAiBooked)
    .sort((a, b) => (b.event.createdAt ?? '').localeCompare(a.event.createdAt ?? '') || a.index - b.index)
    .slice(0, limit)
    .map(({ event }) => event);

/** Where an appointment of today stands: over, going on, the next to start, or later. */
export type TodayState = 'done' | 'now' | 'next' | 'later';

export interface TodayOverview {
  /** The salon's date (YYYY-MM-DD). */
  date: string;
  /** Today's appointments in the order of their start. */
  appointments: { event: CalendarEvent; state: TodayState }[];
  /**
   * Set on a day the salon does not open: `name` is the name of the closure ("Team day"), or
   * empty on a weekday that is always closed. Null on an open day.
   */
  closed: { name: string } | null;
  /** The first appointment after today: shown when nothing more is to come today. */
  following: CalendarEvent | null;
}

/**
 * Home's "Today": the day's appointments by the salon's clock, and whether the salon is open.
 * An appointment is over once its end has passed. Of those that have not started, the earliest
 * is the next one; two stylists who start at the same minute are both next.
 */
export function todayOverview(
  salon: { events: CalendarEvent[]; bookingHours: BookingHoursDay[]; closedDates?: ClosedDate[]; timeZone?: string },
  now: Date,
): TodayOverview {
  const clock = getSalonNow(salon.timeZone, now);
  const todays = salon.events.filter(event => event.date === clock.date)
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime) || a.staffName.localeCompare(b.staffName) || a.id.localeCompare(b.id));
  const nextStart = todays.find(event => event.startTime > clock.time)?.startTime;
  const appointments = todays.map(event => ({
    event,
    state: (event.endTime <= clock.time ? 'done' : event.startTime <= clock.time ? 'now' : event.startTime === nextStart ? 'next' : 'later') as TodayState,
  }));
  const closure = salon.closedDates?.find(item => clock.date >= item.start && clock.date <= item.end);
  const hours = salon.bookingHours.find(day => day.day === openingHoursDay(clock.date));
  const stillToCome = appointments.some(item => item.state !== 'done');
  return {
    date: clock.date,
    appointments,
    closed: closure ? { name: closure.name.trim() } : hours?.isOpen ? null : { name: '' },
    following: stillToCome ? null : salon.events.filter(event => event.date > clock.date)
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`) || a.id.localeCompare(b.id))[0] ?? null,
  };
}

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
