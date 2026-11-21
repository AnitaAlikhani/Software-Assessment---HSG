import type { BookingHoursDay, Employee, ShiftEntry } from './types.js';
import { formatDate, formatDateRange, formatTime, formatTimeRange, openingHoursDay } from './format.js';
import { addDays, dayKeyForDate } from './scheduling.js';

/**
 * Who works when.
 *
 * Every person has regular working hours for each weekday (Employee.weeklyHours). A single day
 * can differ: other hours on that date, or off that day. Those exceptions are all that the week
 * plan stores (ShiftEntry.shifts). A person without regular hours does not work, except on days
 * that are entered for them: nothing falls back to the salon's opening hours.
 *
 * This file is the one place that puts the two together. It only reads and builds data; the
 * screens (Team) and the app's handlers call it.
 */

/** The hours of one day, both on the same day: "08:30" to "17:00". */
export interface Hours { start: string; end: string }

/** A person's regular week, and the keys of its days. */
export type WeeklyHours = NonNullable<Employee['weeklyHours']>;
export type WeekdayKey = keyof WeeklyHours;

/** The days of a week in the order the screens show them: Monday first. */
export const WEEKDAY_KEYS: readonly WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// A Monday, for the functions that name a weekday from a date. Which Monday it is does not matter.
const SOME_MONDAY = '2024-01-01';
/** A date that falls on the given weekday, for weekdayName() and openingHoursDay() in src/format.ts. */
export const dateOfWeekday = (day: WeekdayKey): string => addDays(SOME_MONDAY, WEEKDAY_KEYS.indexOf(day));

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
/** True for hours that can be worked: two 24-hour times on the same day, the end after the start. */
export const isValidHours = (hours: Hours | null | undefined): hours is Hours =>
  hours != null && TIME.test(hours.start) && TIME.test(hours.end) && hours.end > hours.start;

/** True when two days hold the same: the same hours, or both no work. */
export const sameHours = (a: Hours | null | undefined, b: Hours | null | undefined): boolean =>
  a && b ? a.start === b.start && a.end === b.end : !a && !b;

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** How long the hours of a day are, in minutes. Nothing for a day off or for hours that are not valid. */
export const minutesWorked = (hours: Hours | null | undefined): number =>
  isValidHours(hours) ? minutesOf(hours.end) - minutesOf(hours.start) : 0;

/** What a person's working time is looked up in. Every availability context carries these. */
export interface WorkingHoursSource {
  employees: Employee[];
  shiftOverview: ShiftEntry[];
}

/** What the week plan stores for a person on a date: other hours, null for "off", undefined for nothing. */
function storedDay(shiftOverview: ShiftEntry[], employeeId: string, date: string): Hours | null | undefined {
  const days = shiftOverview.find((item) => item.employeeId === employeeId)?.shifts;
  if (!days || !Object.hasOwn(days, date)) return undefined;
  const entry = days[date];
  // A date that holds nothing at all (it would not survive being saved either) counts as not entered.
  if (entry === undefined) return undefined;
  return entry ? { start: entry.start, end: entry.end } : null;
}

/** A booking as the check below needs it: an appointment, or a request that waits. */
export interface BookedTime { date: string; startTime: string; endTime: string }

/**
 * The bookings of a person, from `today` on, that a new regular week would leave outside their
 * working time, the next one first. A day entered for one date still decides for that date. A
 * booking that lies outside the hours already is not counted: the change is not what puts it there.
 */
export function bookingsLeftOutside(salon: WorkingHoursSource, employeeId: string, week: WeeklyHours, bookings: BookedTime[], today: string): BookedTime[] {
  const after: WorkingHoursSource = { ...salon, employees: salon.employees.map((item) => item.id === employeeId ? { ...item, weeklyHours: week } : item) };
  const outside = (source: WorkingHoursSource, booking: BookedTime): boolean => {
    const hours = workingTimeOn(source, employeeId, booking.date);
    return !hours || booking.startTime < hours.start || booking.endTime > hours.end;
  };
  return bookings.filter((booking) => booking.date >= today && outside(after, booking) && !outside(salon, booking))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
}

/** The regular hours of the weekday a date falls on, or null when the person does not work on that weekday. */
export function regularHoursOn(employee: Pick<Employee, 'weeklyHours'> | undefined, date: string): Hours | null {
  const regular = employee?.weeklyHours?.[dayKeyForDate(date)];
  return regular ? { start: regular.start, end: regular.end } : null;
}

/**
 * The hours a person works on a date, or null when they do not work that day.
 *
 * The one place that answers this question. The slot rules, the reasons a request cannot be
 * accepted, the calendar and the team's week all ask here, so they cannot disagree about who
 * works when. A day entered for that date decides; otherwise the regular hours of the weekday do.
 */
export function workingTimeOn(salon: WorkingHoursSource, employeeId: string, date: string): Hours | null {
  const entered = storedDay(salon.shiftOverview, employeeId, date);
  if (entered !== undefined) return entered;
  return regularHoursOn(salon.employees.find((item) => item.id === employeeId), date);
}

export interface WorkingDay {
  /** The hours that apply on the date, or null when the person does not work then. */
  hours: Hours | null;
  /** The regular hours of that weekday, or null for a weekday the person does not work. */
  regular: Hours | null;
  /**
   * 'regular': the regular hours apply. 'other': other hours on this date. 'off': off on this
   * date although it is a regular working day.
   */
  kind: 'regular' | 'other' | 'off';
  /** True when something is stored for the date, also when it holds exactly the regular hours. */
  entered: boolean;
}

/** A person's day with what it would regularly be, for the screens that mark the days that differ. */
export function workingDayOn(salon: WorkingHoursSource, employeeId: string, date: string): WorkingDay {
  const regular = regularHoursOn(salon.employees.find((item) => item.id === employeeId), date);
  const entered = storedDay(salon.shiftOverview, employeeId, date);
  if (entered === undefined) return { hours: regular, regular, kind: 'regular', entered: false };
  // A day that was entered with exactly the regular hours is not shown as a change.
  return { hours: entered, regular, kind: sameHours(entered, regular) ? 'regular' : entered ? 'other' : 'off', entered: true };
}

/**
 * The single days from `from` on that are entered for a person with hours: other hours on a
 * working day, or an extra day. For the question whether somebody without a regular week has
 * any working time ahead.
 */
export function enteredWorkingDays(shiftOverview: ShiftEntry[], employeeId: string, from: string): { date: string; hours: Hours }[] {
  const days = shiftOverview.find((item) => item.employeeId === employeeId)?.shifts ?? {};
  return Object.keys(days).filter((date) => date >= from).sort().flatMap((date) => {
    const hours = storedDay(shiftOverview, employeeId, date);
    return isValidHours(hours) ? [{ date, hours }] : [];
  });
}

/** The minutes a person works in the seven days from `weekStart`. `skip` leaves days out (days the person is away). */
export function minutesInWeek(salon: WorkingHoursSource, employeeId: string, weekStart: string, skip?: (date: string) => boolean): number {
  let minutes = 0;
  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(weekStart, offset);
    if (!skip?.(date)) minutes += minutesWorked(workingTimeOn(salon, employeeId, date));
  }
  return minutes;
}

/** "33.5 h" for the minutes of a week, without a trailing ".0". */
export const formatHoursTotal = (minutes: number): string => `${Math.round(minutes / 6) / 10} h`;

/** True when the person works on at least one weekday of their regular week. */
export const hasRegularHours = (employee: Pick<Employee, 'weeklyHours'>): boolean =>
  WEEKDAY_KEYS.some((day) => isValidHours(employee.weeklyHours?.[day]));

/**
 * The regular week a new person's form starts with: the salon's opening hours. They are copied
 * onto the person when the form is saved, so a later change of the opening hours does not move
 * anybody's working hours.
 */
export function weeklyHoursFromOpeningHours(bookingHours: BookingHoursDay[]): WeeklyHours {
  const week = {} as WeeklyHours;
  for (const day of WEEKDAY_KEYS) {
    const opening = bookingHours.find((item) => item.day === openingHoursDay(dateOfWeekday(day)));
    const hours = opening?.isOpen ? { start: opening.from, end: opening.to } : null;
    week[day] = isValidHours(hours) ? hours : null;
  }
  return week;
}

/** Start and end times are chosen on the half hour, the step appointments start on. */
const HALF_HOURS = Array.from({ length: 48 }, (_, index) => formatTime(index * 30));
/**
 * The times one field offers: the half hours, plus the field's own time when it is not one of
 * them. A time saved earlier (09:07) then still shows and is kept until another one is picked.
 */
export const timeChoices = (time: string): string[] =>
  HALF_HOURS.includes(time) || !TIME.test(time) ? HALF_HOURS : [...HALF_HOURS, time].sort();

// ---------- changing single days ----------

/**
 * A change to one day of one person: other hours, null for a day off, or 'regular' to take the
 * day back to the regular hours.
 */
export interface DayChange {
  employeeId: string;
  date: string;
  hours: Hours | null | 'regular';
}

/** True for a real calendar day written as YYYY-MM-DD: 30 February is none, although a Date would roll it over into March. */
const isDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** True for a change that can be stored: a real date and, where hours are given, hours that can be worked. */
export const isValidDayChange = (change: DayChange): boolean =>
  isDate(change.date) && (change.hours === null || change.hours === 'regular' || isValidHours(change.hours));

/**
 * The week plan after the changes. Only days that differ from the person's regular hours are
 * kept: a day that is set to exactly its regular hours is taken out again, like 'regular'.
 * Changes for somebody who is not in the team, and changes that cannot be stored, are left out.
 */
export function withDayChanges(shiftOverview: ShiftEntry[], employees: Employee[], changes: DayChange[]): ShiftEntry[] {
  let next = shiftOverview;
  for (const change of changes) {
    const employee = employees.find((item) => item.id === change.employeeId);
    if (!employee || !isValidDayChange(change)) continue;
    const hours = change.hours === 'regular' ? regularHoursOn(employee, change.date) : change.hours;
    const entry = next.find((item) => item.employeeId === employee.id);
    if (change.hours === 'regular' || sameHours(hours, regularHoursOn(employee, change.date))) {
      if (!entry || !Object.hasOwn(entry.shifts, change.date)) continue;
      const { [change.date]: _removed, ...days } = entry.shifts;
      next = next.map((item) => item === entry ? { ...item, shifts: days } : item);
      continue;
    }
    const day = hours ? { start: hours.start, end: hours.end } : null;
    next = entry
      ? next.map((item) => item === entry ? { ...item, shifts: { ...item.shifts, [change.date]: day } } : item)
      : [...next, {
        employeeId: employee.id, employeeName: employee.name, initials: employee.initials,
        avatarColor: 'bg-indigo-100 text-indigo-700', shifts: { [change.date]: day },
      }];
  }
  return next;
}

/**
 * The week plan after a person's regular week was changed: days of theirs that now hold exactly
 * the regular hours are taken out, so the plan keeps holding only the days that differ. Without
 * this, such a day would stay pinned to its old hours when the regular week changes again.
 */
export function withoutRegularDays(shiftOverview: ShiftEntry[], employee: Employee): ShiftEntry[] {
  return shiftOverview.map((entry) => {
    if (entry.employeeId !== employee.id) return entry;
    const differing = Object.entries(entry.shifts).filter(([date, hours]) => hours !== undefined && !sameHours(hours, regularHoursOn(employee, date)));
    return differing.length === Object.keys(entry.shifts).length ? entry : { ...entry, shifts: Object.fromEntries(differing) };
  });
}

/** The changes that bring back what the week plan held for the same days before `changes`. For "Undo". */
export function undoDayChanges(shiftOverview: ShiftEntry[], changes: DayChange[]): DayChange[] {
  return changes.map(({ employeeId, date }) => {
    const before = storedDay(shiftOverview, employeeId, date);
    return { employeeId, date, hours: before === undefined ? 'regular' : before };
  });
}

/** What a change did, in a few words for the owner: "Luca Frei is off on Tuesday, 06.10.2026". */
export function dayChangesSummary(changes: DayChange[], employees: Employee[]): string {
  if (changes.length !== 1) {
    const people = new Set(changes.map((change) => change.employeeId)).size;
    return `${changes.length} days changed for ${people} ${people === 1 ? 'person' : 'people'}`;
  }
  const [{ employeeId, date, hours }] = changes;
  const employee = employees.find((item) => item.id === employeeId);
  const name = employee?.name ?? 'This person';
  const day = formatDate(date, { weekday: 'long' });
  const regular = regularHoursOn(employee, date);
  if (hours === 'regular' || sameHours(hours, regular)) {
    return regular
      ? `${name} works the regular hours on ${day}: ${formatTimeRange(regular.start, regular.end)}`
      : `${name} has the regular day off on ${day}`;
  }
  return hours ? `${name} works ${formatTimeRange(hours.start, hours.end)} on ${day}` : `${name} is off on ${day}`;
}

// ---------- copying a week ----------

export interface WeekCopy {
  /** The first and the last day of the week that is copied from. */
  from: { start: string; end: string };
  /** The days of the target week that change. Empty when the week before holds nothing to copy. */
  changes: DayChange[];
  /** Of those, the days that are changed in the target week already, with what they hold now. */
  overwrites: DayChange[];
}

/**
 * "Copy last week": the days that were changed in the week before `weekStart`, each moved seven
 * days on. A day of the target week that is not touched by the copy stays as it is. Days that
 * already hold the same are left out, so `changes` counts what really changes.
 */
export function copyOfWeekBefore(salon: WorkingHoursSource, weekStart: string): WeekCopy {
  const copy: WeekCopy = { from: { start: addDays(weekStart, -7), end: addDays(weekStart, -1) }, changes: [], overwrites: [] };
  for (const employee of salon.employees) {
    for (let offset = 0; offset < 7; offset++) {
      const target = addDays(weekStart, offset);
      const source = workingDayOn(salon, employee.id, addDays(target, -7));
      // Only days that differed from the regular week are copied; the rest of the week stays regular.
      if (source.kind === 'regular') continue;
      const now = workingDayOn(salon, employee.id, target);
      if (sameHours(now.hours, source.hours)) continue;
      copy.changes.push({ employeeId: employee.id, date: target, hours: source.hours });
      if (now.kind !== 'regular') copy.overwrites.push({ employeeId: employee.id, date: target, hours: now.hours });
    }
  }
  return copy;
}

/** The week a copy comes from, as the screens write a span of days: "28.09.–04.10.2026". */
export const weekCopySource = (copy: WeekCopy): string => formatDateRange(copy.from.start, copy.from.end);
