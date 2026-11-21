import type { CalendarEvent, Customer, Employee, ServiceItem } from './types';
import { requestTimes } from './appointmentActions';
import { getAvailableSlots, isEmployeeAssignedToService, validateCalendarEvent, type AvailabilityContext } from './availability';
import { phoneAdvice, searchForms } from './bookingData';
import { formatDate, formatStoredTimeRange, formatTime, formatTimeRange, normalizePhone, openingHoursDay, phoneMatches, samePhone, weekdayName } from './format';
import { validatePersonName } from './managementValidation';
import { addDays, addMinutes, dayKeyForDate, formatCalendarDate, getSalonNow } from './scheduling';
import { isValidHours, workingTimeOn } from './workingHours';

/**
 * The rules of the appointment form (src/components/AppointmentForm.tsx): what it opens with,
 * which times it offers, what it says when nothing can be booked, and what saving stores.
 *
 * Everything here only reads the salon and builds values, so it can be tested without a browser.
 * Whether a time is free is never decided here: the slot rules (src/availability.ts) are asked,
 * the same ones that check the appointment again when it is saved.
 */

// ---------- what the form is opened with and what it holds ----------

/**
 * What opens the form. A new appointment brings whatever is known already: a place in the
 * calendar (day, half hour, maybe a stylist or a service) or a customer. An existing one is named
 * by its id.
 */
export type AppointmentFormRequest =
  | { kind: 'new'; date?: string; time?: string; employeeId?: string; serviceId?: string; customerId?: string }
  | { kind: 'edit'; appointmentId: string };

/** The stylist choice "Anyone free": whoever offers the service and is free at the chosen time. */
export const ANYONE = 'anyone';

/** How a booking by hand came in. Stored on the appointment as the owner chose it. */
export type AppointmentSource = NonNullable<CalendarEvent['source']>;
export const APPOINTMENT_SOURCES: readonly { id: AppointmentSource; label: string }[] = [
  { id: 'phone', label: 'Phone' },
  { id: 'walk-in', label: 'Walk-in' },
  { id: 'other', label: 'Other' },
];
const isSource = (value: unknown): value is AppointmentSource => APPOINTMENT_SOURCES.some((source) => source.id === value);

/** Whose appointment it is, as far as the form has got. */
export type CustomerDraft =
  /** Nobody is chosen yet: the owner searches by name or number. */
  | { kind: 'search'; query: string }
  /** A customer from the list. `phone` is a number typed for somebody who has none ('' while nothing is typed). */
  | { kind: 'existing'; customerId: string; phone: string }
  /** Somebody new, who becomes a customer record when the appointment is saved. */
  | { kind: 'new'; name: string; phone: string; language: Customer['language'] }
  /** An appointment that is being changed and names somebody who has no record: the name stays as it is. */
  | { kind: 'kept'; name: string };

export interface AppointmentDraft {
  /** The appointment that is being changed, or null for a new one. */
  appointmentId: string | null;
  customer: CustomerDraft;
  /** '' while no service is chosen. */
  serviceId: string;
  /** A stylist's id, or ANYONE. */
  employeeId: string;
  date: string;
  /** The start, "10:30". '' while the day offers no time. */
  time: string;
  /**
   * True once the time is a wish: it came with the place in the calendar, belongs to the
   * appointment, or was picked. A wish is kept through every change, and the form says so when it
   * is not free. While false the time is only the form's suggestion (the next free time) and
   * follows the service, the stylist and the day.
   */
  timeChosen: boolean;
  /** "Book outside opening hours" is switched on. */
  outsideHours: boolean;
  /** Where the booking came from. Null where the owner has chosen none (an appointment from a chat that is being changed). */
  source: AppointmentSource | null;
  /** Why the form did not open on today, in a sentence. Null once the owner has chosen a day herself. */
  startNote: string | null;
}

// ---------- small helpers ----------

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const isTime = (value: string | undefined): value is string => value !== undefined && TIME.test(value);
/** True for a real calendar day written as YYYY-MM-DD. */
const isDate = (value: string | undefined): value is string => {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const nameKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();
const initialsOf = (name: string): string => name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

/** The salon's date today, by the clock the form was given. */
export const salonToday = (salon: AvailabilityContext): string => getSalonNow(salon.timeZone, salon.now ?? new Date()).date;

/** The opening hours of the weekday a date falls on. Null on a weekday the salon does not open. */
const openDayOn = (salon: AvailabilityContext, date: string) => {
  const day = salon.bookingHours.find((item) => item.day === openingHoursDay(date));
  return day?.isOpen ? day : null;
};
const closureOn = (salon: AvailabilityContext, date: string) =>
  salon.closedDates?.find((closure) => date >= closure.start && date <= closure.end) ?? null;
const awayOn = (salon: AvailabilityContext, employeeId: string, date: string): boolean =>
  salon.absences?.some((absence) => absence.employeeId === employeeId && date >= absence.start && date <= absence.end) ?? false;
const sameEmployee = (record: { employeeId?: string; staffName?: string }, employee: Employee): boolean =>
  record.employeeId !== undefined ? record.employeeId === employee.id : record.staffName === employee.name;

/** The stylists who can take a service: active, and assigned to it. In the order of the team. */
export const stylistsFor = (salon: Pick<AvailabilityContext, 'employees'>, service: ServiceItem): Employee[] =>
  salon.employees.filter((employee) => employee.status === 'Active' && isEmployeeAssignedToService(service, employee));

// ---------- finding a customer ----------

/**
 * The customers a search text finds, the best first. A text that reads like a phone number is
 * compared with the numbers, in any spelling. Anything else is compared with the names, without
 * regard to accents: every word typed has to be in the name, and names in which the words begin
 * that way come first ("pet mei" finds Petra Meier before Margrit Petermann). Customers that
 * match equally well keep the order of the list, which holds the most recent contact first.
 * `more` says how many further customers match beyond `limit`.
 */
export function findCustomers(customers: Customer[], query: string, limit = 6): { matches: Customer[]; more: number } {
  const typed = query.trim();
  if (!typed) return { matches: [], more: 0 };
  const words = searchForms(typed)[0].split(/[\s-]+/).filter(Boolean);
  const found: { customer: Customer; score: number }[] = [];
  for (const customer of customers) {
    if (phoneMatches(customer.phone, typed)) { found.push({ customer, score: 0 }); continue; }
    const forms = searchForms(customer.name);
    if (words.length === 0 || !words.every((word) => forms.some((form) => form.includes(word)))) continue;
    const parts = forms.map((form) => form.split(/[\s-]+/));
    // Every typed word that only occurs inside a word of the name, not at its start, counts against the match.
    const inside = words.filter((word) => !parts.some((list) => list.some((part) => part.startsWith(word)))).length;
    found.push({ customer, score: 1 + inside });
  }
  // The sort keeps customers with the same score in the order they came in.
  found.sort((a, b) => a.score - b.score);
  return { matches: found.slice(0, limit).map((item) => item.customer), more: Math.max(0, found.length - limit) };
}

/**
 * A customer the salon already has who may be the person being entered as new: the same number,
 * or exactly the same name. The form offers that record instead; it never decides by itself.
 */
export function knownCustomerLike(customers: Customer[], name: string, phone: string): Customer | null {
  const number = phone.trim() ? normalizePhone(phone) : '';
  const plainName = (text: string) => searchForms(nameKey(text))[0];
  return (number ? customers.find((customer) => samePhone(customer.phone, number)) : undefined)
    ?? (nameKey(name).length > 1 ? customers.find((customer) => plainName(customer.name) === plainName(name)) : undefined)
    ?? null;
}

// ---------- the times of a day ----------

export interface TimeOption {
  /** The start, "10:30". */
  time: string;
  end: string;
  /** Who takes it: the stylist that was chosen, or with "Anyone free" the first one who is free then. */
  employeeId: string;
  /** True when the appointment does not lie completely inside the opening hours of that day. */
  outside: boolean;
  /**
   * True when it does not lie completely inside the stylist's working hours of that day. Such a
   * time is booked outside the usual hours on purpose; the working hours stay as they are.
   */
  offShift: boolean;
}

/** What the times of a day are asked for. */
export interface TimeSelection {
  serviceId: string;
  /** A stylist's id, or ANYONE. */
  employeeId: string;
  date: string;
  /** The appointment that is being changed: it never stands in its own way, and it keeps its own time. */
  appointmentId: string | null;
  /** "Book outside opening hours" is switched on. */
  outsideHours: boolean;
}

/** A time with how well it suits: one inside the usual hours comes before one outside them. */
interface RankedOption extends TimeOption { rank: number }

function optionsOf(salon: AvailabilityContext, service: ServiceItem, employee: Employee, selection: TimeSelection): RankedOption[] {
  const ask = {
    date: selection.date, serviceId: service.id, employeeId: employee.id, mode: 'owner' as const,
    excludeEventId: selection.appointmentId ?? undefined,
  };
  const prep = service.prepMinutes ?? 0;
  const post = service.postMinutes ?? 0;
  const stored = workingTimeOn(salon, employee.id, selection.date);
  const working = isValidHours(stored) ? { start: minutesOf(stored.start), end: minutesOf(stored.end) } : null;
  const openDay = openDayOn(salon, selection.date);
  const opening = openDay && openDay.from < openDay.to ? { start: minutesOf(openDay.from), end: minutesOf(openDay.to) } : null;
  // Where a time lies is worked out for every time, also one of the usual list: an appointment
  // that keeps its own place may lie outside today's hours (they were changed after it was booked).
  const option = (time: string, beyondHours: boolean): RankedOption => {
    const from = minutesOf(time) - prep;
    const to = minutesOf(time) + service.durationMinutes + post;
    const outside = !opening || from < opening.start || to > opening.end;
    const offShift = !working || from < working.start || to > working.end;
    return {
      time, end: addMinutes(time, service.durationMinutes), employeeId: employee.id, outside, offShift,
      rank: !beyondHours ? 0 : !offShift ? 1 : working ? 2 : 3,
    };
  };
  const inHours = getAvailableSlots(salon, ask).map((time) => option(time, false));
  if (!selection.outsideHours) return inHours;

  // Any time of the day (OUTSIDE_HOURS_WINDOW) at which the stylist has no other booking: the
  // slot rules need neither the opening hours nor the working hours for a time the owner books
  // outside them, so nobody's working hours change with it.
  const known = new Set(inHours.map((item) => item.time));
  const beyond = getAvailableSlots(salon, { ...ask, outsideHoursApproved: true }).filter((time) => !known.has(time)).map((time) => option(time, true));
  return [...inHours, ...beyond];
}

/**
 * The free starts of a day for a service and a stylist choice, in the order of the clock.
 * With "Anyone free" each time names who would take it: somebody who works then before
 * somebody who does not, and among equals the first in the team.
 */
export function timeOptions(salon: AvailabilityContext, selection: TimeSelection): TimeOption[] {
  const service = salon.services.find((item) => item.id === selection.serviceId);
  if (!service || !isDate(selection.date)) return [];
  const best = new Map<string, RankedOption>();
  for (const employee of stylistsFor(salon, service)) {
    if (selection.employeeId !== ANYONE && employee.id !== selection.employeeId) continue;
    for (const option of optionsOf(salon, service, employee, selection)) {
      const known = best.get(option.time);
      if (!known || option.rank < known.rank) best.set(option.time, option);
    }
  }
  return [...best.values()].sort((a, b) => a.time.localeCompare(b.time)).map(({ rank: _rank, ...option }) => option);
}

/** The first day from `from` on, within 90 days, that has a free time for the service and the stylist choice. */
export function nextFreeDay(salon: AvailabilityContext, selection: Omit<TimeSelection, 'date'>, from: string): string | null {
  if (!isDate(from)) return null;
  // One clock for the whole search, so that every day is judged at the same moment.
  const snapshot = { ...salon, now: salon.now ?? new Date() };
  for (let offset = 0; offset < 90; offset++) {
    const date = addDays(from, offset);
    if (timeOptions(snapshot, { ...selection, date }).length > 0) return date;
  }
  return null;
}

/**
 * The free times closest to a wish, in the order of the clock: as many before it as after it,
 * so that "a little earlier or a little later?" can be answered at a glance. Where one side has
 * fewer, the other side fills up.
 */
export function nearestTimes(options: TimeOption[], wanted: string, count = 4): TimeOption[] {
  if (!isTime(wanted)) return options.slice(0, count);
  const earlier = options.filter((option) => option.time < wanted);
  const later = options.filter((option) => option.time > wanted);
  const before = Math.min(earlier.length, Math.max(Math.floor(count / 2), count - later.length));
  return [...earlier.slice(earlier.length - before), ...later.slice(0, count - before)];
}

/** The times of a day under short headings, so that the eye finds a part of the day at once. */
export interface TimeGroup { label: string; options: TimeOption[] }

function groupTimes(salon: AvailabilityContext, date: string, options: TimeOption[], outsideHours: boolean): TimeGroup[] {
  const openDay = openDayOn(salon, date);
  const labelOf = (option: TimeOption): string => {
    // Outside the opening hours, what matters is on which side of them a time lies.
    if (outsideHours && openDay && openDay.from < openDay.to) {
      return option.time < openDay.from ? 'Before opening' : option.end > openDay.to ? 'After closing' : 'During opening hours';
    }
    return option.time < '12:00' ? 'Morning' : option.time < '17:00' ? 'Afternoon' : 'Evening';
  };
  const groups: TimeGroup[] = [];
  for (const option of options) {
    const label = labelOf(option);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.options.push(option);
    else groups.push({ label, options: [option] });
  }
  return groups;
}

// ---------- what the form says when a time or a whole day cannot be booked ----------

/** Why a wish for a time cannot be met, as a sentence. */
function whyNotFree(salon: AvailabilityContext, service: ServiceItem, selection: TimeSelection, time: string): string {
  const clock = getSalonNow(salon.timeZone, salon.now ?? new Date());
  // An appointment that is being changed may keep a start that has passed: for that one, another reason is in the way.
  const own = selection.appointmentId ? salon.events.find((event) => event.id === selection.appointmentId) : undefined;
  const ownStart = own?.date === selection.date && own.startTime === time;
  if (!ownStart && selection.date === clock.date && time <= clock.time) return `${time} has passed.`;
  const employee = selection.employeeId === ANYONE ? null : salon.employees.find((item) => item.id === selection.employeeId);
  if (!employee) return `Nobody who offers ${service.name} is free at ${time}.`;
  const end = addMinutes(time, service.durationMinutes);
  const span = formatTimeRange(time, end);
  if (!selection.outsideHours) {
    const working = workingTimeOn(salon, employee.id, selection.date);
    if (working && (time < working.start || end > working.end)) {
      return `${span} is not free: ${employee.name} works ${formatTimeRange(working.start, working.end)} that day.`;
    }
    const openDay = openDayOn(salon, selection.date);
    if (openDay && (time < openDay.from || end > openDay.to)) {
      return `${span} is not free: the salon is open ${formatTimeRange(openDay.from, openDay.to)} that day.`;
    }
  }
  const booked = salon.events.find((event) => event.id !== selection.appointmentId && event.date === selection.date
    && sameEmployee(event, employee) && event.startTime < end && event.endTime > time);
  if (booked) return `${span} is not free: ${employee.name} has ${booked.customerName} at ${formatTimeRange(booked.startTime, booked.endTime)}.`;
  const asked = salon.requests.find((request) => {
    const times = requestTimes(request);
    return request.status === 'pending' && request.date === selection.date && sameEmployee(request, employee)
      && times !== null && times.start < end && times.end > time;
  });
  if (asked) return `${span} is not free: a booking request from ${asked.customerName} holds ${formatStoredTimeRange(asked.timeStr)}.`;
  // What is left: the time a neighbouring booking needs before or after, or a start off the half hour.
  return `${span} is not free with ${employee.name}.`;
}

/** Nothing can be booked on the day as the form stands: what is in the way, and the ways out. */
export interface DayProblem {
  /** What is in the way, as a sentence. */
  text: string;
  /** What the owner can do besides the offers below, as a sentence. '' when the offers say it all. */
  advice: string;
  /** The next day with a free time for the same service and stylist choice. Null when the next 90 days hold none. */
  nextDay: string | null;
  /** True when a stylist is chosen and somebody else who offers the service has a free time on this day. */
  othersFree: boolean;
  /** True when switching on "Book outside opening hours" opens times on this day. */
  outsideHelps: boolean;
  /** The day of the appointment that is being changed, when the form has left it: a way back. */
  ownDay: string | null;
}

function dayProblemOf(
  salon: AvailabilityContext, service: ServiceItem, selection: TimeSelection, editing: CalendarEvent | null,
): DayProblem {
  const today = salonToday(salon);
  const { date } = selection;
  const day = formatDate(date);
  const candidates = stylistsFor(salon, service).filter((employee) => selection.employeeId === ANYONE || employee.id === selection.employeeId);
  const who = selection.employeeId === ANYONE ? null : candidates[0] ?? null;
  const forWhat = `${service.name}${who ? ` with ${who.name}` : ''}`;
  const ownDay = editing && editing.date !== date ? editing.date : null;
  const without = { serviceId: selection.serviceId, employeeId: selection.employeeId, appointmentId: selection.appointmentId, outsideHours: selection.outsideHours };

  // The appointment that is being changed, on its own day with its own stylist: whatever was
  // entered for that day afterwards (a closed date, an absence, other hours) does not take its
  // place away. When even its own time does not fit, another booking is in the way of the service.
  const ownPlace = editing !== null && editing.date === date && candidates.some((employee) => sameEmployee(editing, employee));
  const ownTimeProblem = (): DayProblem => {
    const span = formatTimeRange(editing!.startTime, addMinutes(editing!.startTime, service.durationMinutes));
    return date < today
      ? problem(`This appointment was on ${day}. Its time, ${span}, is not free for ${forWhat}.`,
        'Choose another stylist or service, or move the appointment to today or a later day.', false)
      : problem(`This appointment is on ${day}. Its time, ${span}, is not free for ${forWhat}.`,
        'Choose another service, or move the appointment to another day.', false);
  };

  const problem = (text: string, advice: string, switchMayHelp: boolean): DayProblem => {
    const outsideHelps = switchMayHelp && !selection.outsideHours && timeOptions(salon, { ...selection, outsideHours: true }).length > 0;
    return {
      text,
      // The switch is only named where it would open a time on this day.
      advice: !outsideHelps ? advice
        : advice ? `${advice.replace(/\.$/, '')}, or switch on “Book outside opening hours”.`
          : 'For a time outside the usual hours, switch on “Book outside opening hours”.',
      nextDay: nextFreeDay(salon, without, date < today ? today : addDays(date, 1)),
      othersFree: who !== null && timeOptions(salon, { ...selection, employeeId: ANYONE }).length > 0,
      outsideHelps,
      ownDay,
    };
  };

  // A new appointment cannot lie in the past; one that is being changed keeps its own day only.
  if (date < today && editing?.date !== date) {
    return problem(`${day} is over.`, editing ? 'The appointment can stay on its own day, or move to today or a later day.' : 'Choose today or a later day.', false);
  }
  if (ownPlace) return ownTimeProblem();
  const closure = closureOn(salon, date);
  if (closure) {
    const name = closure.name.trim();
    return problem(`The salon is closed on ${day}${name ? ` (${name})` : ''}.`, 'To book on this day, remove the closed date in Settings first.', false);
  }
  const present = candidates.filter((employee) => !awayOn(salon, employee.id, date));
  if (present.length === 0) {
    return problem(who ? `${who.name} is away on ${day}.` : `Everybody who offers ${service.name} is away on ${day}.`,
      who ? 'Choose another stylist or another day.' : 'Choose another day.', false);
  }
  if (!selection.outsideHours) {
    const openDay = openDayOn(salon, date);
    if (!openDay) return problem(`The salon is closed on ${weekdayName(date)}s.`, 'Choose another day.', true);
    const working = present.map((employee) => workingTimeOn(salon, employee.id, date));
    if (working.every((hours) => hours === null)) {
      return problem(who ? `${who.name} does not work on ${day}.` : `Nobody who offers ${service.name} works on ${day}.`,
        who ? 'Choose another stylist or another day.' : 'Choose another day.', true);
    }
    if (openDay.from < openDay.to && working.every((hours) => hours === null || !isValidHours(hours) || hours.end <= openDay.from || hours.start >= openDay.to)) {
      return problem(who ? `${who.name}’s working hours on ${day} lie outside the opening hours.` : `Nobody who offers ${service.name} works during the opening hours on ${day}.`,
        who ? 'Choose another stylist or another day.' : 'Choose another day.', true);
    }
  }
  // Something the slot rules refuse for the whole day (a service without a valid length, hours
  // with invalid times): their own sentence says what to put right.
  const refusals = present.map((employee) => validateCalendarEvent(salon, {
    customerName: 'Customer', serviceId: service.id, serviceName: service.name, employeeId: employee.id, staffName: employee.name,
    date, day: dayKeyForDate(date), dateDisplay: formatCalendarDate(date), startTime: '12:00', endTime: addMinutes('12:00', service.durationMinutes),
    colorTheme: 'blue', outsideHoursApproved: selection.outsideHours,
  }, selection.appointmentId ?? undefined));
  const wholeDay = (refusal: string | null): refusal is string => refusal !== null
    && !refusal.startsWith('This time is not available') && !/^Choose a valid \d+-minute slot/.test(refusal)
    // These have the owner's words above. With the switch on the slot rules do not give them.
    && !/does not work on this date|no working time during|salon is closed on this date/.test(refusal);
  if (refusals.every(wholeDay)) return problem(refusals[0] as string, '', false);

  // The appointment that is being changed lies in the past: its own time is the only one, and it does not fit.
  if (editing && editing.date === date && date < today) return ownTimeProblem();
  // Times that would be free if none of them had passed: the day is over, not full.
  const anyClock = { ...salon, now: new Date(0) };
  if (date === today && timeOptions(anyClock, selection).length > 0) return problem(`No time is left today for ${forWhat}.`, '', true);
  return problem(`No free time is left on ${day} for ${forWhat}.`, '', true);
}

// ---------- the form as it is shown ----------

export interface StylistOption { employee: Employee; /** Whether the stylist has a free time on the chosen day. */ free: boolean }

export interface DayOption {
  date: string;
  /** "Today", "Tomorrow", or '' for a day that is named by its weekday. */
  name: 'Today' | 'Tomorrow' | '';
  /** Whether the day has a free time for the service and the stylist choice. */
  free: boolean;
}

/** How many days the quick choice of the day shows, from today on. Any other day is picked in the date field. */
export const DAYS_SHOWN = 14;

export interface AppointmentFormView {
  today: string;
  /** The appointment that is being changed. Null for a new one. */
  editing: CalendarEvent | null;
  /**
   * Why no appointment can be saved at all, and the screen where that is put right: the salon has
   * no service, nobody in the team can be booked, or the appointment is gone. Null when the form can be filled in.
   */
  blocked: { text: string; screen: 'services' | 'team' | null } | null;
  service: ServiceItem | null;
  /** Said under the service: the appointment's own service is gone, or nobody offers the one chosen. */
  serviceNote: string | null;
  stylists: StylistOption[];
  /** The stylist choice in force: ANYONE or a stylist's id. '' when the one the draft names cannot take the service. */
  employeeId: string;
  /** Said under the stylists: why the stylist of the draft cannot take it. */
  stylistNote: string | null;
  days: DayOption[];
  /** The free starts of the day. */
  times: TimeOption[];
  groups: TimeGroup[];
  /** The draft's time, when it is free. */
  chosen: TimeOption | null;
  /** The draft's time is a wish that is not free: why, and the free times closest to it. */
  timeProblem: { text: string; nearest: TimeOption[] } | null;
  /** The day has no free time at all. */
  dayProblem: DayProblem | null;
  /** Who takes the appointment at the chosen time. */
  employee: Employee | null;
  /**
   * An appointment that has taken place is being moved to another day or time: what that does to
   * the record of the visit, as a sentence. A note only; it does not stop the saving.
   */
  pastMoveNote: string | null;
}

/** "The visit on Thu, 19.11.2026 will no longer be in the calendar or in Petra Meier’s history." */
function pastMoveNoteOf(salon: AvailabilityContext, editing: CalendarEvent | null, date: string, chosen: TimeOption | null): string | null {
  if (!editing || !chosen || (editing.date === date && editing.startTime === chosen.time)) return null;
  // A visit counts once it has started (src/customerStats.ts): the same moment decides here.
  const clock = getSalonNow(salon.timeZone, salon.now ?? new Date());
  if (`${editing.date} ${editing.startTime}` > `${clock.date} ${clock.time}`) return null;
  return `The visit on ${formatDate(editing.date)} will no longer be in the calendar or in ${editing.customerName}’s history.`;
}

const selectionOf = (draft: AppointmentDraft, employeeId = draft.employeeId): TimeSelection =>
  ({ serviceId: draft.serviceId, employeeId, date: draft.date, appointmentId: draft.appointmentId, outsideHours: draft.outsideHours });

/** Everything the form shows that follows from the salon and the draft. */
export function appointmentFormView(salon: AvailabilityContext, draft: AppointmentDraft): AppointmentFormView {
  const today = salonToday(salon);
  const editing = draft.appointmentId ? salon.events.find((event) => event.id === draft.appointmentId) ?? null : null;
  const empty: AppointmentFormView = {
    today, editing, blocked: null, service: null, serviceNote: null, stylists: [], employeeId: '', stylistNote: null,
    days: [], times: [], groups: [], chosen: null, timeProblem: null, dayProblem: null, employee: null, pastMoveNote: null,
  };
  if (draft.appointmentId && !editing) {
    return { ...empty, blocked: { text: 'This appointment is no longer in the calendar. It may have been cancelled in the meantime.', screen: null } };
  }
  if (salon.services.length === 0) {
    return { ...empty, blocked: { text: 'You have no services yet. Add a service first: then you can book appointments.', screen: 'services' } };
  }
  if (!salon.employees.some((employee) => employee.status === 'Active')) {
    return { ...empty, blocked: { text: 'Nobody in your team is active. Add a person in Team, or set somebody to active: then you can book appointments.', screen: 'team' } };
  }
  if (!salon.services.some((service) => stylistsFor(salon, service).length > 0)) {
    return { ...empty, blocked: { text: 'Nobody in your team offers a service yet. Choose in Team who offers which service: then you can book appointments.', screen: 'team' } };
  }

  const service = salon.services.find((item) => item.id === draft.serviceId) ?? null;
  const eligible = service ? stylistsFor(salon, service) : [];
  const days: DayOption[] = Array.from({ length: DAYS_SHOWN }, (_, index) => {
    const date = addDays(today, index);
    return { date, name: index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : '', free: false };
  });
  if (!service) {
    return {
      ...empty, days,
      serviceNote: editing ? `“${editing.serviceName}” is no longer one of your services. Choose the service this appointment is for.` : null,
    };
  }
  if (eligible.length === 0) {
    return { ...empty, service, days, serviceNote: `Nobody in your team offers ${service.name}. Choose another service, or choose in Team who offers it.` };
  }

  // A stylist the draft names who cannot take the service: set to inactive, or no longer assigned to it.
  const named = draft.employeeId === ANYONE ? null : salon.employees.find((employee) => employee.id === draft.employeeId) ?? null;
  const employeeId = draft.employeeId === ANYONE || eligible.some((employee) => employee.id === draft.employeeId) ? draft.employeeId : '';
  const stylistNote = employeeId !== '' ? null
    : !named ? 'The stylist of this appointment is no longer in your team. Choose who takes it.'
      : named.status !== 'Active' ? `${named.name} is set to inactive and takes no appointments. Choose another stylist, or set ${named.name} to active in Team.`
        : `${named.name} does not offer ${service.name}. Choose another stylist.`;

  const stylists = eligible.map((employee) => ({ employee, free: timeOptions(salon, selectionOf(draft, employee.id)).length > 0 }));
  if (employeeId === '') return { ...empty, service, stylists, stylistNote, days };

  const selection = selectionOf(draft, employeeId);
  const times = timeOptions(salon, selection);
  const chosen = times.find((option) => option.time === draft.time) ?? null;
  const employee = chosen ? salon.employees.find((item) => item.id === chosen.employeeId) ?? null : null;
  return {
    ...empty, service, stylists, employeeId, stylistNote,
    days: days.map((item) => ({ ...item, free: item.date === draft.date ? times.length > 0 : timeOptions(salon, { ...selection, date: item.date }).length > 0 })),
    times,
    groups: groupTimes(salon, draft.date, times, draft.outsideHours),
    chosen,
    timeProblem: times.length > 0 && !chosen && isTime(draft.time)
      ? { text: whyNotFree(salon, service, selection, draft.time), nearest: nearestTimes(times, draft.time) } : null,
    dayProblem: times.length === 0 ? dayProblemOf(salon, service, selection, editing) : null,
    employee,
    pastMoveNote: pastMoveNoteOf(salon, editing, draft.date, chosen),
  };
}

// ---------- opening the form and changing what it holds ----------

/**
 * A time that is only the form's suggestion follows every change: it becomes the first free time
 * of the day. Only a time inside the usual hours is ever suggested. One outside the opening hours
 * or the stylist's working hours is the owner's decision, so the form waits for her to pick it.
 */
function settled(salon: AvailabilityContext, draft: AppointmentDraft): AppointmentDraft {
  if (draft.timeChosen) return draft;
  const service = salon.services.find((item) => item.id === draft.serviceId);
  // A stylist who cannot take the service has no times; the form asks for another one first.
  const canTake = draft.employeeId === ANYONE || (service !== undefined && stylistsFor(salon, service).some((employee) => employee.id === draft.employeeId));
  const first = canTake ? timeOptions(salon, selectionOf(draft)).find((option) => !option.outside && !option.offShift) : undefined;
  return { ...draft, time: first?.time ?? '' };
}

/**
 * True once the owner has put something into the form that closing it would lose: a customer
 * picked or typed, or any other field changed from what the form opened with.
 */
export function draftTouched(opened: AppointmentDraft, draft: AppointmentDraft): boolean {
  const entered = (item: AppointmentDraft) => JSON.stringify([
    item.customer, item.serviceId, item.employeeId, item.date, item.time, item.outsideHours, item.source,
  ]);
  return entered(opened) !== entered(draft);
}

/** What the form asks before it is closed with something entered in it. */
export const discardQuestion = (draft: AppointmentDraft): string => draft.appointmentId
  ? 'Discard your changes to this appointment? They are not saved yet.'
  : 'Discard this appointment? It is not saved yet.';

/** What the form still lacks before it can be saved, as words for one sentence: "a customer", "a time". */
export function stillNeeded(draft: AppointmentDraft, view: AppointmentFormView): string[] {
  const needed: string[] = [];
  if (draft.customer.kind === 'search') needed.push('a customer');
  if (draft.customer.kind === 'new' && !draft.customer.name.trim()) needed.push('the customer’s name');
  if (!view.service) needed.push('a service');
  else if (view.stylists.length > 0 && view.employeeId === '') needed.push('a stylist');
  if (view.service && !view.chosen) needed.push('a time');
  return needed;
}

function draftForNew(salon: AvailabilityContext, customers: Customer[], request: Extract<AppointmentFormRequest, { kind: 'new' }>): AppointmentDraft {
  const today = salonToday(salon);
  // A place in the past is no place for a new appointment: the form opens as if no day had been named.
  const place = isDate(request.date) && request.date >= today ? request.date : null;
  const wish = isTime(request.time) ? request.time : null;
  const date = place ?? today;
  const takenBy = (service: ServiceItem) => stylistsFor(salon, service);
  const usable = salon.services.filter((service) => takenBy(service).length > 0);
  const askedService = salon.services.find((service) => service.id === request.serviceId) ?? null;
  const askedStylist = salon.employees.find((employee) => employee.id === request.employeeId && employee.status === 'Active') ?? null;
  // The services to look through: the one that was asked for, else those the named stylist offers, else all that somebody offers.
  const services = askedService ? [askedService]
    : askedStylist ? usable.filter((service) => isEmployeeAssignedToService(service, askedStylist)) : usable;
  const fallback = services[0] ?? usable[0] ?? salon.services[0] ?? null;
  const offers = (service: ServiceItem | null, employee: Employee | null) =>
    service !== null && employee !== null && takenBy(service).some((item) => item.id === employee.id);

  const base: AppointmentDraft = {
    appointmentId: null,
    customer: request.customerId !== undefined && customers.some((customer) => customer.id === request.customerId)
      ? { kind: 'existing', customerId: request.customerId, phone: '' } : { kind: 'search', query: '' },
    serviceId: fallback?.id ?? '',
    employeeId: offers(fallback, askedStylist) ? askedStylist!.id : ANYONE,
    date,
    time: '',
    timeChosen: false,
    outsideHours: false,
    // A booking by hand comes in by phone more often than any other way.
    source: 'phone',
    startNote: null,
  };

  if (wish) {
    // From a half hour in the calendar: a service and a stylist that are free then.
    for (const service of services) {
      const free = takenBy(service).filter((employee) => !askedStylist || employee.id === askedStylist.id)
        .find((employee) => getAvailableSlots(salon, { date, serviceId: service.id, employeeId: employee.id, mode: 'owner' }).includes(wish));
      if (free) return { ...base, serviceId: service.id, employeeId: free.id, time: wish, timeChosen: true };
    }
    // Nothing is free then: the wish stays, and the form says so and offers the nearest times.
    return { ...base, time: wish, timeChosen: true };
  }

  const first = settled(salon, base);
  if (first.time !== '' || place !== null) return first;
  // Opened without a day, and today has no free time left: the form starts on the next day that has one.
  const next = nextFreeDay(salon, selectionOf(base), addDays(today, 1));
  if (!next || !fallback) return first;
  const reason = appointmentFormView(salon, base).dayProblem?.text ?? '';
  return settled(salon, { ...base, date: next, startNote: `${reason} The next free time is on ${formatDate(next)}.`.trim() });
}

/** The customer record an appointment is for. */
function recordOf(customers: Customer[], event: CalendarEvent): Customer | undefined {
  // An appointment saved before customers had ids belongs to the one customer of that name, as the customer list counts it.
  const sameName = customers.filter((customer) => nameKey(customer.name) === nameKey(event.customerName));
  return event.customerId !== undefined
    ? customers.find((customer) => customer.id === event.customerId) : sameName.length === 1 ? sameName[0] : undefined;
}

function draftForEdit(salon: AvailabilityContext, customers: Customer[], appointmentId: string): AppointmentDraft {
  const event = salon.events.find((item) => item.id === appointmentId);
  const base: AppointmentDraft = {
    appointmentId, customer: { kind: 'search', query: '' }, serviceId: '', employeeId: ANYONE, date: salonToday(salon),
    time: '', timeChosen: false, outsideHours: false, source: null, startNote: null,
  };
  // The appointment is gone: the form says so (see `blocked`).
  if (!event) return base;
  const service = event.serviceId !== undefined
    ? salon.services.find((item) => item.id === event.serviceId) : salon.services.find((item) => item.name === event.serviceName);
  const employee = event.employeeId !== undefined
    ? salon.employees.find((item) => item.id === event.employeeId) : salon.employees.find((item) => item.name === event.staffName);
  const record = recordOf(customers, event);
  return {
    ...base,
    customer: record ? { kind: 'existing', customerId: record.id, phone: '' } : { kind: 'kept', name: event.customerName },
    serviceId: service?.id ?? '',
    // The stylist stays named also when they can no longer be booked: the form then asks for another one.
    employeeId: employee?.id ?? event.employeeId ?? '',
    date: event.date,
    time: event.startTime,
    timeChosen: true,
    // An appointment the owner approved outside the opening hours opens with the switch on, so its own time stays on offer.
    outsideHours: event.outsideHoursApproved === true,
    source: isSource(event.source) ? event.source : null,
  };
}

/** The form as it opens. `salon.now` is the clock it goes by. */
export function openDraft(salon: AvailabilityContext, customers: Customer[], request: AppointmentFormRequest): AppointmentDraft {
  return request.kind === 'edit' ? draftForEdit(salon, customers, request.appointmentId) : draftForNew(salon, customers, request);
}

export type DraftChange =
  | { customer: CustomerDraft }
  | { serviceId: string }
  | { employeeId: string }
  | { date: string }
  | { time: string }
  | { outsideHours: boolean }
  | { source: AppointmentSource };

/** The draft after one change by the owner. */
export function changeDraft(salon: AvailabilityContext, draft: AppointmentDraft, change: DraftChange): AppointmentDraft {
  if ('customer' in change) return { ...draft, customer: change.customer };
  if ('source' in change) return { ...draft, source: change.source };
  if ('time' in change) return isTime(change.time) ? { ...draft, time: change.time, timeChosen: true } : draft;
  if ('date' in change) {
    // A date field that was cleared names no day: the form keeps the one it has.
    return isDate(change.date) ? settled(salon, { ...draft, date: change.date, startNote: null }) : draft;
  }
  if ('employeeId' in change) return settled(salon, { ...draft, employeeId: change.employeeId });
  if ('outsideHours' in change) return settled(salon, { ...draft, outsideHours: change.outsideHours });
  const service = salon.services.find((item) => item.id === change.serviceId);
  if (!service) return draft;
  // A stylist who does not offer the new service makes room for whoever is free.
  const keepsStylist = draft.employeeId === ANYONE || stylistsFor(salon, service).some((employee) => employee.id === draft.employeeId);
  return settled(salon, { ...draft, serviceId: service.id, employeeId: keepsStylist ? draft.employeeId : ANYONE });
}

// ---------- saving ----------

/** What saving the form stores. The app checks the appointment once more with the slot rules before it does. */
export interface AppointmentSave {
  /** The appointment that is changed, or null for a new one. */
  appointmentId: string | null;
  event: Omit<CalendarEvent, 'id'>;
  /**
   * The customer's record as it is to be stored: the one that was picked (unchanged, or with the
   * number that was added for somebody who had none), or the new one. Null for an appointment that
   * keeps a customer without a record.
   */
  customer: Customer | null;
  /** True when `customer` is a record that gets its first phone number with this booking. */
  addsPhone: boolean;
}

export type SaveResult =
  | { save: AppointmentSave }
  /** Why the form cannot be saved yet, and the part of the form that needs the owner. */
  | { error: string; field: 'customer' | 'service' | 'stylist' | 'time' | 'form' };

function customerToSave(
  customers: Customer[], draft: CustomerDraft, newId: () => string,
): { customer: Customer | null; addsPhone: boolean } | { error: string } {
  if (draft.kind === 'search') return { error: 'Choose a customer, or add a new one.' };
  if (draft.kind === 'kept') return { customer: null, addsPhone: false };
  if (draft.kind === 'existing') {
    const record = customers.find((customer) => customer.id === draft.customerId);
    if (!record) return { error: 'This customer is no longer in your customer list. Choose another customer.' };
    const typed = draft.phone.trim();
    // A number is only ever added where the record has none: one it has is never replaced from here.
    if (record.phone || !typed) return { customer: record, addsPhone: false };
    const advice = phoneAdvice(typed);
    if (advice) return { error: `Enter a valid mobile number, or leave the field empty. ${advice}` };
    return { customer: { ...record, phone: normalizePhone(typed) }, addsPhone: true };
  }
  const nameError = validatePersonName(draft.name, 'the customer’s');
  if (nameError) return { error: nameError };
  const typed = draft.phone.trim();
  const advice = typed ? phoneAdvice(typed) : null;
  if (advice) return { error: `Enter a valid mobile number, or leave the field empty. ${advice}` };
  const phone = typed ? normalizePhone(typed) : '';
  const name = draft.name.trim().replace(/\s+/g, ' ');
  // The same name with the same number is the same person: no second record for them.
  const same = phone ? customers.find((customer) => nameKey(customer.name) === nameKey(name) && samePhone(customer.phone, phone)) : undefined;
  if (same) return { customer: same, addsPhone: false };
  return { customer: { id: newId(), name, initials: initialsOf(name), email: '', phone, language: draft.language }, addsPhone: false };
}

/**
 * True when saving gives the appointment to another customer than the one it was for: a record
 * other than its own, or a record where it named somebody who had none.
 */
function customerChanged(customers: Customer[], editing: CalendarEvent, customer: Customer | null): boolean {
  return customer !== null && recordOf(customers, editing)?.id !== customer.id;
}

/**
 * Checks the form and turns it into what is stored. `newCustomerId` gives a new customer's
 * record its id (tests pass a fixed one).
 */
export function appointmentSave(
  salon: AvailabilityContext, customers: Customer[], draft: AppointmentDraft,
  newCustomerId: () => string = () => `cust-${crypto.randomUUID()}`,
): SaveResult {
  const view = appointmentFormView(salon, draft);
  if (view.blocked) return { error: view.blocked.text, field: 'form' };
  const who = customerToSave(customers, draft.customer, newCustomerId);
  if ('error' in who) return { error: who.error, field: 'customer' };
  if (!view.service) return { error: view.serviceNote ?? 'Choose a service.', field: 'service' };
  if (view.employeeId === '' || view.stylists.length === 0) {
    return { error: view.stylistNote ?? view.serviceNote ?? 'Choose a stylist.', field: view.stylists.length === 0 ? 'service' : 'stylist' };
  }
  if (!view.chosen || !view.employee) {
    const why = view.dayProblem?.text ?? view.timeProblem?.text;
    return { error: why ? `${why} Choose another time or day.` : 'Choose a time.', field: 'time' };
  }
  const { chosen, employee, service, editing } = view;
  const { id: _id, ...previous } = editing ?? ({ id: '' } as Partial<CalendarEvent>);
  const event: Omit<CalendarEvent, 'id'> = {
    ...previous,
    customerName: who.customer?.name ?? previous.customerName ?? '',
    customerId: who.customer?.id ?? previous.customerId,
    customerPhone: who.customer ? who.customer.phone : previous.customerPhone,
    serviceId: service.id,
    serviceName: service.name,
    employeeId: employee.id,
    staffName: employee.name,
    date: draft.date,
    day: dayKeyForDate(draft.date),
    dateDisplay: formatCalendarDate(draft.date),
    startTime: chosen.time,
    endTime: chosen.end,
    colorTheme: previous.colorTheme ?? 'blue',
    isAiBooked: previous.isAiBooked ?? false,
    // Marked only where the time really lies outside the opening hours or the stylist's working
    // hours: the owner's decision, taken with the switch. The slot rules then need neither.
    outsideHoursApproved: chosen.outside || chosen.offShift,
  };
  // The source is the owner's choice. An appointment that never had one and gets none keeps none.
  if (draft.source) event.source = draft.source;
  // Given to somebody else, the appointment no longer belongs to the chat it was booked in, and
  // the AI did not book it for this person: it is the owner's booking now ("Booked by hand").
  if (editing && customerChanged(customers, editing, who.customer)) {
    delete event.conversationId;
    event.isAiBooked = false;
  }
  return {
    save: {
      appointmentId: draft.appointmentId,
      event,
      customer: who.customer,
      addsPhone: who.addsPhone,
    },
  };
}

/** What the app says once the appointment is stored: whose it is, and when. */
export function savedMessage(save: AppointmentSave, saved: Pick<CalendarEvent, 'customerName' | 'date' | 'startTime'>): string {
  return `Appointment ${save.appointmentId ? 'updated' : 'added'} for ${saved.customerName}: ${formatDate(saved.date)}, ${saved.startTime}.`;
}
