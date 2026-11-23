import type { BookingHoursDay, CalendarEvent, ClosedDate, Conversation, Employee, ServiceItem, ShiftEntry, StaffAbsence, TimeBlock } from './types';
import { analyticsPeriods, appointmentAnalytics, type Period, type SalonClock } from './analytics';
import { openingHoursDay, zonedDateTime } from './format';
import { addDays, getSalonNow } from './scheduling';
import { workingTimeOn } from './workingHours';

/**
 * The appointments the AI booked most recently, newest booking first: what Home's "AI
 * receptionist" card lists as its latest bookings. The time of booking decides; where it is
 * missing, the order of the list does, which holds new bookings at the top.
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

// ---------- what the appointments are worth ----------

/**
 * What a list of appointments is worth at the salon's list prices. The app records no payment,
 * so this is no takings: it is the price of each appointment's service, as the Services screen
 * holds it today, added up. An appointment whose service is no longer in that list has no price;
 * it is left out of the sum and counted in `unpriced`.
 */
export function bookedValue(events: CalendarEvent[], services: Pick<ServiceItem, 'id' | 'name' | 'priceCHF'>[]): { value: number; unpriced: number } {
  const byId = new Map(services.map((service) => [service.id, service.priceCHF]));
  const byName = new Map(services.map((service) => [service.name, service.priceCHF]));
  let cents = 0;
  let unpriced = 0;
  for (const event of events) {
    // Stable ids decide; only an older record without one is looked up by name, as the slot rules do.
    const price = event.serviceId !== undefined ? byId.get(event.serviceId) : byName.get(event.serviceName);
    if (price === undefined || !Number.isFinite(price)) unpriced += 1;
    else cents += Math.round(price * 100);
  }
  return { value: cents / 100, unpriced };
}

/** A number of appointments and what they are worth at list prices. */
export interface Booked { appointments: number; value: number }

export interface MonthPace {
  /** The current calendar month. */
  month: Period;
  /** Every appointment of the month, past and upcoming: the number Analytics opens with. */
  appointments: number;
  /** The appointments that have started by now. */
  soFar: Booked;
  /** The appointments that start now or later: the rule of "still to come" in Analytics. */
  stillToCome: Booked;
  /**
   * The month before at the same point: its appointments that had started by the same day of
   * the month and the same time of day. Null while that month holds no appointment at all, so a
   * salon in its first month is not compared with nothing.
   */
  before: (Booked & { month: Period; until: SalonClock }) | null;
  /** Appointments of the month whose service has no price in the list any more. */
  unpriced: number;
}

/** The month before the one a date lies in. */
const monthBefore = (date: string): Period => {
  const to = addDays(`${date.slice(0, 8)}01`, -1);
  return { from: `${to.slice(0, 8)}01`, to };
};

/**
 * How the month is going: what has taken place so far, what is still booked, and where the
 * month before stood at the same point. Comparing the month so far with the whole of the month
 * before would always look like a loss; comparing like with like does not.
 *
 * "So far" and "still to come" split the month exactly as Analytics does, so the two screens
 * cannot disagree (tests/homeFigures.test.ts).
 */
export function monthPace(events: CalendarEvent[], services: Pick<ServiceItem, 'id' | 'name' | 'priceCHF'>[], now: Date, timeZone?: string): MonthPace {
  const clock = getSalonNow(timeZone, now);
  const { month } = analyticsPeriods(clock.date);
  const inPeriod = (period: Period) => events.filter((event) => event.date >= period.from && event.date <= period.to);
  const startedBy = (point: SalonClock) => (event: CalendarEvent) => `${event.date} ${event.startTime}` < `${point.date} ${point.time}`;
  const booked = (list: CalendarEvent[]): Booked => ({ appointments: list.length, value: bookedValue(list, services).value });

  const thisMonth = inPeriod(month);
  const started = thisMonth.filter(startedBy(clock));
  const previous = monthBefore(clock.date);
  const lastMonth = inPeriod(previous);
  // The same day of the month, or its last day when the month before is shorter (31 October: 30 September).
  const sameDay = `${previous.from.slice(0, 8)}${clock.date.slice(8)}`;
  const until: SalonClock = { date: sameDay > previous.to ? previous.to : sameDay, time: clock.time };
  return {
    month,
    appointments: thisMonth.length,
    soFar: booked(started),
    stillToCome: booked(thisMonth.filter((event) => !startedBy(clock)(event))),
    before: lastMonth.length > 0 ? { ...booked(lastMonth.filter(startedBy(until))), month: previous, until } : null,
    unpriced: bookedValue(thisMonth, services).unpriced,
  };
}

/** How a figure stands against the one it is compared with, as Home writes it beside the figure. */
export interface Change {
  direction: 'up' | 'down' | 'same';
  /** The difference as a whole number: per cent, or a number of things. Negative for less. */
  difference: number;
  /** "+4%", "−3", "±0": a real minus sign, never a hyphen. */
  label: string;
}

const signed = (difference: number, unit: string): Change => ({
  direction: difference > 0 ? 'up' : difference < 0 ? 'down' : 'same',
  // Rounding can leave a negative zero behind: it is no difference.
  difference: difference === 0 ? 0 : difference,
  label: `${difference > 0 ? '+' : difference < 0 ? '−' : '±'}${Math.abs(difference)}${unit}`,
});

/** A change in whole per cent. Null when there was nothing before: a rise from nothing has no percentage. */
export const changeInPercent = (now: number, before: number): Change | null =>
  before > 0 ? signed(Math.round((now - before) / before * 100), '%') : null;

/** A change as a number of things: three more, one fewer. Small numbers say more this way than a percentage does. */
export const changeInCount = (now: number, before: number): Change => signed(now - before, '');

// ---------- how full the day is ----------

/** What the team's working time is looked up in: the salon as the slot rules see it. */
export interface StaffedSalon {
  employees: Employee[];
  shiftOverview: ShiftEntry[];
  bookingHours: BookingHoursDay[];
  events: CalendarEvent[];
  closedDates?: ClosedDate[];
  absences?: StaffAbsence[];
  timeBlocks?: TimeBlock[];
}

type Span = { start: number; end: number };
const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const spanOf = (start: string, end: string): Span | null => {
  const span = { start: minutesOf(start), end: minutesOf(end) };
  return Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start ? span : null;
};
/** The minutes a list of spans covers together inside `within`; spans that overlap are counted once. */
const covered = (spans: Span[], within: Span): number => {
  const clipped = spans.map((span) => ({ start: Math.max(span.start, within.start), end: Math.min(span.end, within.end) }))
    .filter((span) => span.end > span.start).sort((a, b) => a.start - b.start);
  let minutes = 0;
  let reached = within.start;
  for (const span of clipped) {
    if (span.end <= reached) continue;
    minutes += span.end - Math.max(span.start, reached);
    reached = span.end;
  }
  return minutes;
};

/** True for an appointment or a block of this person. Ids decide; an older appointment without one is matched by name. */
const isOf = (employee: Employee) => (record: { employeeId?: string; staffName?: string }): boolean =>
  record.employeeId !== undefined ? record.employeeId === employee.id : record.staffName === employee.name;

/** The people whose time counts: everybody who is active, or only those named. */
const staffOf = (salon: StaffedSalon, employeeIds?: readonly string[]): Employee[] =>
  salon.employees.filter((employee) => employee.status === 'Active' && (employeeIds === undefined || employeeIds.includes(employee.id)));

/**
 * The time of a person that can be booked on a date, as the slot rules open it: their working
 * hours of that day as far as they lie inside the opening hours. Nothing on a date the salon is
 * closed or the person is away.
 */
function workingSpan(salon: StaffedSalon, employee: Employee, date: string): Span | null {
  if (salon.closedDates?.some((closure) => date >= closure.start && date <= closure.end)) return null;
  if (salon.absences?.some((absence) => absence.employeeId === employee.id && date >= absence.start && date <= absence.end)) return null;
  const opening = salon.bookingHours.find((day) => day.day === openingHoursDay(date));
  const open = opening?.isOpen ? spanOf(opening.from, opening.to) : null;
  const shift = workingTimeOn(salon, employee.id, date);
  const works = shift ? spanOf(shift.start, shift.end) : null;
  if (!open || !works) return null;
  const span = { start: Math.max(open.start, works.start), end: Math.min(open.end, works.end) };
  return span.end > span.start ? span : null;
}

export interface BookedShare {
  /** Minutes of appointments inside the working time. */
  booked: number;
  /** Minutes the team works on those days, less the time kept free for breaks. */
  working: number;
  /** Whole per cent of the working time that is booked. Null when nobody works on those days. */
  share: number | null;
}

/**
 * How much of the working time on the given days is booked: for the whole team, or for the
 * people named. Working time is what the slot rules open (see workingSpan), less the time blocks.
 * An appointment counts with the part of it that lies in its stylist's working time, so one that
 * was booked outside the usual hours on purpose cannot push the share above everything there is.
 */
export function bookedShare(salon: StaffedSalon, dates: readonly string[], employeeIds?: readonly string[]): BookedShare {
  let booked = 0;
  let working = 0;
  for (const employee of staffOf(salon, employeeIds)) {
    const own = isOf(employee);
    for (const date of dates) {
      const span = workingSpan(salon, employee, date);
      if (!span) continue;
      const spansOf = (records: readonly { date: string; startTime: string; endTime: string; employeeId?: string; staffName?: string }[]) =>
        records.filter((record) => record.date === date && own(record)).flatMap((record) => spanOf(record.startTime, record.endTime) ?? []);
      const kept = covered(spansOf(salon.timeBlocks ?? []), span);
      working += span.end - span.start - kept;
      booked += Math.min(covered(spansOf(salon.events), span), span.end - span.start - kept);
    }
  }
  return { booked, working, share: working > 0 ? Math.round(booked / working * 100) : null };
}

/** The seven days of the week a date lies in, Monday first, as Analytics counts a week. */
export const weekDates = (date: string): string[] => {
  const { week } = analyticsPeriods(date);
  return Array.from({ length: 7 }, (_, offset) => addDays(week.from, offset));
};

// ---------- what the AI receptionist did ----------

export interface AiSummary {
  /** The month the figures are for. */
  month: Period;
  /** The month's appointments that the AI booked, and their share of all of the month's (as Analytics counts both). */
  bookings: number;
  share: number | null;
  /** What they are worth at list prices. */
  value: number;
  /**
   * Of them, the ones that were booked while the salon was closed. Null when none of the month's
   * AI bookings carries the time it was made: then there is nothing to say about it.
   */
  whileClosed: number | null;
}

/**
 * True when the salon was closed at that moment: outside the opening hours of the weekday, or
 * on a closed date. The opening hours are the ones in Settings today; earlier ones are not kept.
 */
export function wasClosedAt(moment: string, salon: { bookingHours: BookingHoursDay[]; closedDates?: ClosedDate[]; timeZone?: string }): boolean | null {
  const time = Date.parse(moment);
  if (!Number.isFinite(time)) return null;
  const clock = zonedDateTime(new Date(time), salon.timeZone);
  if (salon.closedDates?.some((closure) => clock.date >= closure.start && clock.date <= closure.end)) return true;
  const opening = salon.bookingHours.find((day) => day.day === openingHoursDay(clock.date));
  return !opening?.isOpen || clock.time < opening.from || clock.time >= opening.to;
}

/**
 * Home's "AI receptionist": what the AI brought in this month. An appointment counts for the
 * month it takes place in, as everywhere in the figures.
 */
export function aiSummary(
  salon: { events: CalendarEvent[]; services: Pick<ServiceItem, 'id' | 'name' | 'priceCHF'>[]; bookingHours: BookingHoursDay[]; closedDates?: ClosedDate[]; timeZone?: string },
  now: Date,
): AiSummary {
  const clock = getSalonNow(salon.timeZone, now);
  const { month } = analyticsPeriods(clock.date);
  const figures = appointmentAnalytics(salon.events, month.from, month.to);
  const byAi = salon.events.filter((event) => event.isAiBooked && event.date >= month.from && event.date <= month.to);
  const judged = byAi.flatMap((event) => (event.createdAt ? [wasClosedAt(event.createdAt, salon)] : [])).filter((closed): closed is boolean => closed !== null);
  return {
    month,
    bookings: figures.aiBookings,
    share: figures.aiShare,
    value: bookedValue(byAi, salon.services).value,
    whileClosed: judged.length > 0 ? judged.filter(Boolean).length : null,
  };
}

/**
 * The chats the owner sees, by who dealt with them. Chats carry no period (not every message
 * has a date), so these count all of them, as Analytics says of its own chat figures.
 */
export function chatSummary(conversations: Pick<Conversation, 'status'>[]): { total: number; aiHandled: number; booked: number; waiting: number } {
  const count = (status: Conversation['status']) => conversations.filter((conversation) => conversation.status === status).length;
  return { total: conversations.length, aiHandled: count('ai-handled'), booked: count('booked'), waiting: count('needs-attention') };
}
