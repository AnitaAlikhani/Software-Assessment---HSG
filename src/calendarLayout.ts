import type { BookingHoursDay, CalendarEvent, ClosedDate, Employee, StaffAbsence, TimeBlock } from './types';
import { openingHoursDay } from './format';
import { workingTimeOn, type WorkingHoursSource } from './workingHours';

/**
 * The arithmetic behind the calendar's time grid, without anything that draws.
 *
 *   1. Minutes and positions: where a time lies in the grid, so that an appointment is as tall
 *      as it is long.
 *   2. Lanes: appointments at the same time stand side by side.
 *   3. What a column offers: the half hours in which an appointment can be added, what is
 *      shaded (closed, outside the opening hours, outside a stylist's working hours) and what
 *      lies in the past.
 *   4. The columns of a day (one per stylist) and of a week (one per day).
 *
 * Positions are given in hours from the top of the grid. The screen multiplies them by the
 * height it gives to one hour, so the same numbers serve a phone and a laptop.
 */

// ---------- 1. minutes and positions ----------

/** A stretch of one day in minutes since midnight: 600 to 630 is 10:00–10:30. */
export interface Span {
  start: number;
  end: number;
}

/** Appointments start on the half hour, and a click in the grid means one half hour. */
export const SLOT_MINUTES = 30;

/**
 * The shortest stretch an appointment is drawn with. A five-minute appointment would be a line
 * that nobody can read or tap, so it is drawn as a quarter of an hour.
 */
export const SHORTEST_DRAWN_MINUTES = 15;

/** "10:30" as minutes since midnight, or null for anything that is no time of day. */
export function minutesOf(time: string): number | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

/** Minutes since midnight as a time: 630 gives "10:30". */
export const timeOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Start and end as a span, or null when they are no times or the end is not after the start. */
export function spanOf(startTime: string, endTime: string): Span | null {
  const start = minutesOf(startTime);
  const end = minutesOf(endTime);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

/**
 * The stretch a grid shows, from the hours `calendarHours` (src/scheduling.ts) lists: from the
 * first hour line to the end of the last hour.
 */
export function gridSpan(hours: string[]): Span {
  const first = minutesOf(hours[0] ?? '') ?? 9 * 60;
  const last = minutesOf(hours[hours.length - 1] ?? '') ?? first;
  return { start: first, end: Math.max(last, first) + 60 };
}

/** How far below the top of the grid a minute lies, in hours. */
export const hoursFromTop = (minute: number, grid: Span): number => (minute - grid.start) / 60;

/**
 * Where a span lies in the grid: its top edge and its height, both in hours. The part outside
 * the grid is cut off; a span that lies outside altogether gives null.
 */
export function placeInGrid(span: Span, grid: Span): { top: number; height: number } | null {
  const start = Math.max(span.start, grid.start);
  const end = Math.min(span.end, grid.end);
  if (end <= start) return null;
  return { top: hoursFromTop(start, grid), height: (end - start) / 60 };
}

// ---------- 2. lanes ----------

export interface Laned<T> {
  item: T;
  /** The stretch the item is drawn with (at least SHORTEST_DRAWN_MINUTES long). */
  span: Span;
  /** The lane the item stands in, counted from the left, starting at 0. */
  lane: number;
  /** How many lanes its group of overlapping items needs. The item is one lane wide unless `width` says more. */
  lanes: number;
  /** How many lanes the item takes: more than one where the lanes to its right are empty while it lasts. */
  width: number;
}

export interface LaneOptions<T> {
  /**
   * Who an item belongs to (a stylist). Somebody's items keep to one lane while that lane is
   * free, so a busy day reads as one strip per stylist instead of a patchwork.
   */
  groupOf?: (item: T) => string;
  /** The order of the groups from left to right (the order of the team). */
  rankOf?: (item: T) => number;
}

/**
 * Puts items that overlap in time side by side.
 *
 * Items are taken in the order of their start. Each goes into the lane its group used last if
 * that lane is free, else into the first free lane, else into a new one, so a run of overlapping
 * items never needs more lanes than items overlap at one moment. Two items back to back
 * (10:00–10:30 and 10:30–11:00) do not overlap: they share a lane. An item whose `spanFor` is
 * null is left out.
 */
export function layOutLanes<T>(items: readonly T[], spanFor: (item: T) => Span | null, options: LaneOptions<T> = {}): Laned<T>[] {
  const { groupOf, rankOf } = options;
  interface Entry { item: T; span: Span; order: number; group: string; rank: number; lane: number }
  const entries: Entry[] = [];
  items.forEach((item, order) => {
    const span = spanFor(item);
    if (!span || span.end <= span.start) return;
    entries.push({
      item, order, lane: 0,
      span: { start: span.start, end: Math.max(span.end, span.start + SHORTEST_DRAWN_MINUTES) },
      group: groupOf?.(item) ?? '',
      rank: rankOf?.(item) ?? 0,
    });
  });
  entries.sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end || a.rank - b.rank || a.order - b.order);

  const result: Laned<T>[] = [];
  let run: Entry[] = [];
  let runEnd = -Infinity;
  let laneEnds: number[] = [];
  let lastLane = new Map<string, number>();

  /** A run of overlapping items is complete: order its lanes and work out the widths. */
  const closeRun = () => {
    if (run.length === 0) return;
    const lanes = laneEnds.length;
    // Lanes follow the order of the team where they can: the lane somebody uses most is theirs.
    const minutes = Array.from({ length: lanes }, () => new Map<string, { minutes: number; rank: number }>());
    for (const entry of run) {
      const own = minutes[entry.lane].get(entry.group) ?? { minutes: 0, rank: entry.rank };
      minutes[entry.lane].set(entry.group, { minutes: own.minutes + entry.span.end - entry.span.start, rank: Math.min(own.rank, entry.rank) });
    }
    const rankOfLane = minutes.map((groups) => [...groups.values()].sort((a, b) => b.minutes - a.minutes || a.rank - b.rank)[0]?.rank ?? 0);
    const order = rankOfLane.map((rank, lane) => ({ rank, lane })).sort((a, b) => a.rank - b.rank || a.lane - b.lane);
    const newLane = new Map(order.map((entry, position) => [entry.lane, position]));
    for (const entry of run) entry.lane = newLane.get(entry.lane)!;
    // An item spreads over the lanes to its right that stay empty while it lasts.
    for (const entry of run) {
      let width = 1;
      while (entry.lane + width < lanes
        && !run.some((other) => other.lane === entry.lane + width && other.span.start < entry.span.end && other.span.end > entry.span.start)) width += 1;
      result.push({ item: entry.item, span: entry.span, lane: entry.lane, lanes, width });
    }
    run = [];
    runEnd = -Infinity;
    laneEnds = [];
    lastLane = new Map();
  };

  for (const entry of entries) {
    // Nothing that came before still lasts: the items so far form a run of their own.
    if (entry.span.start >= runEnd) closeRun();
    const preferred = lastLane.get(entry.group);
    let lane = groupOf && preferred !== undefined && laneEnds[preferred] <= entry.span.start
      ? preferred
      : laneEnds.findIndex((end) => end <= entry.span.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = entry.span.end;
    lastLane.set(entry.group, lane);
    entry.lane = lane;
    run.push(entry);
    runEnd = Math.max(runEnd, entry.span.end);
  }
  closeRun();
  return result.sort((a, b) => a.span.start - b.span.start || a.lane - b.lane);
}

// ---------- 3. what a column offers ----------

/** What the calendar asks about the salon: who works when, when it is open, who is away. */
export interface CalendarSalon extends WorkingHoursSource {
  bookingHours: BookingHoursDay[];
  closedDates?: ClosedDate[];
  absences?: StaffAbsence[];
}

/**
 * Why nothing can be added to a column all day: the salon is closed, the stylist is away, the
 * stylist does not work that day, or nobody works that day.
 */
export type ShadeReason = 'closed' | 'away' | 'off' | 'nobody';

export interface ColumnPlan {
  /** The stretch in which an appointment can be added, or null when the whole column is shaded. */
  open: Span | null;
  /** Set when `open` is null: the one label the shaded column gets. */
  reason?: ShadeReason;
  /** The name of the closed date or the reason of the absence, where one was given. */
  note?: string;
}

const covers = (range: { start: string; end: string }, date: string): boolean => date >= range.start && date <= range.end;

/**
 * When an appointment can be added on a date: inside the opening hours, and for one stylist
 * also inside that stylist's working hours (asked from `workingTimeOn`, the one place that
 * knows them). A closed weekday, a closed date, an absence and a day off shade the whole day.
 */
export function columnPlan(salon: CalendarSalon, date: string, employeeId?: string): ColumnPlan {
  const closure = salon.closedDates?.find((item) => covers(item, date));
  if (closure) return { open: null, reason: 'closed', ...(closure.name.trim() ? { note: closure.name.trim() } : {}) };
  const weekday = openingHoursDay(date);
  const hours = salon.bookingHours.find((day) => day.day === weekday && day.isOpen);
  const opening = hours ? spanOf(hours.from, hours.to) : null;
  if (!opening) return { open: null, reason: 'closed' };
  if (employeeId === undefined) return { open: opening };

  const absence = salon.absences?.find((item) => item.employeeId === employeeId && covers(item, date));
  if (absence) return { open: null, reason: 'away', ...(absence.reason?.trim() ? { note: absence.reason.trim() } : {}) };
  const working = workingTimeOn(salon, employeeId, date);
  const shift = working ? spanOf(working.start, working.end) : null;
  if (!shift) return { open: null, reason: 'off' };
  const open = { start: Math.max(opening.start, shift.start), end: Math.min(opening.end, shift.end) };
  return open.end > open.start ? { open } : { open: null, reason: 'off' };
}

/** The parts of the grid in which nothing can be added: everything outside `open`. */
export function shadedSpans(open: Span | null, grid: Span): Span[] {
  if (!open) return [grid];
  const before = { start: grid.start, end: Math.min(open.start, grid.end) };
  const after = { start: Math.max(open.end, grid.start), end: grid.end };
  return [before, after].filter((span) => span.end > span.start);
}

/** The salon's clock: its date and its time of day. */
export interface SalonClock {
  date: string;
  time: string;
}

/**
 * The part of a day's column that lies in the past: all of an earlier day, today up to the
 * current minute, nothing of a day to come.
 */
export function pastSpan(date: string, now: SalonClock, grid: Span): Span | null {
  if (date > now.date) return null;
  if (date < now.date) return grid;
  const minute = minutesOf(now.time) ?? 0;
  const end = Math.min(Math.max(minute, grid.start), grid.end);
  return end > grid.start ? { start: grid.start, end } : null;
}

/** True for an appointment that is over: on an earlier day, or ended by now. */
export function isOver(event: Pick<CalendarEvent, 'date' | 'endTime'>, now: SalonClock): boolean {
  return event.date < now.date || (event.date === now.date && event.endTime <= now.time);
}

/**
 * The half hours of a column in which a click adds an appointment, as their start minutes.
 * A half hour counts when it lies inside `open` and has not begun yet: the slot rules offer no
 * time that has started, so the grid does not offer it either. A half hour that touches one of
 * the `blocked` spans (time the owner keeps free for the column's stylist) is not offered either.
 */
export function freeSlots(open: Span | null, date: string, now: SalonClock, blocked: readonly Span[] = []): number[] {
  if (!open || date < now.date) return [];
  const current = date === now.date ? minutesOf(now.time) ?? 0 : -1;
  const slots: number[] = [];
  for (let start = Math.ceil(open.start / SLOT_MINUTES) * SLOT_MINUTES; start + SLOT_MINUTES <= open.end; start += SLOT_MINUTES) {
    if (start > current && !blocked.some((span) => span.start < start + SLOT_MINUTES && span.end > start)) slots.push(start);
  }
  return slots;
}

// ---------- 4. the columns of a day and of a week ----------

/**
 * Somebody with appointments in the calendar: a member of the team, or a name on an
 * appointment that belongs to nobody in the team (an older record, "Unassigned").
 */
export interface CalendarPerson {
  /** The employee's id, or "name:" and the name for somebody outside the team. Also the value of the stylist filter. */
  key: string;
  employeeId?: string;
  name: string;
  /** The place in the team list, which decides the colour. -1 outside the team. */
  index: number;
}

type StaffRef = Pick<CalendarEvent, 'employeeId' | 'staffName'>;

/** Who an appointment is with. Ids decide; only a record without an id is matched by name. */
export function personKeyOf(event: StaffRef, employees: readonly Pick<Employee, 'id' | 'name'>[]): string {
  const employee = event.employeeId !== undefined
    ? employees.find((item) => item.id === event.employeeId)
    : employees.find((item) => item.name === event.staffName);
  return employee ? employee.id : `name:${event.staffName}`;
}

/**
 * Everybody the calendar can show: the team in its order, then the names on the given
 * appointments that match nobody in the team.
 */
export function calendarPeople(employees: readonly Pick<Employee, 'id' | 'name'>[], events: readonly StaffRef[]): CalendarPerson[] {
  const people: CalendarPerson[] = employees.map((employee, index) => ({ key: employee.id, employeeId: employee.id, name: employee.name, index }));
  for (const event of events) {
    const key = personKeyOf(event, employees);
    if (!people.some((person) => person.key === key)) people.push({ key, name: event.staffName || 'Unassigned', index: -1 });
  }
  return people;
}

export interface CalendarColumn<E> {
  /** Unique among the columns on screen: the date in a week, the person's key in a day. */
  key: string;
  date: string;
  /** A day's column of one stylist. Left out for a column that stands for the whole day. */
  person?: CalendarPerson;
  plan: ColumnPlan;
  events: E[];
  /** The time blocks drawn in the column: those of its stylist, or in the week those of everybody shown. */
  blocks: TimeBlock[];
}

/** The time blocks on a date, of one stylist or of everybody. */
export const blocksOn = (blocks: readonly TimeBlock[], date: string, employeeId?: string): TimeBlock[] =>
  blocks.filter((block) => block.date === date && (employeeId === undefined || block.employeeId === employeeId));

/** The week: one column per day. With one stylist chosen, each day follows that stylist's working hours. */
export function weekColumns<E extends Pick<CalendarEvent, 'date'>>(
  salon: CalendarSalon, dates: readonly string[], events: readonly E[], employeeId?: string, blocks: readonly TimeBlock[] = [],
): CalendarColumn<E>[] {
  return dates.map((date) => {
    const plan = columnPlan(salon, date, employeeId);
    return {
      key: date,
      date,
      plan,
      events: events.filter((event) => event.date === date),
      // On a day the salon is closed a block keeps nothing free: it is not drawn there.
      blocks: plan.reason === 'closed' ? [] : blocksOn(blocks, date, employeeId),
    };
  });
}

/**
 * One day as an appointment book: a column for every active stylist who works that day, and
 * for anybody who has an appointment that day. With one stylist chosen there is only that
 * column. A closed day is a single column for everybody, and so is a day on which nobody works.
 *
 * `events` are the appointments to show (already filtered); `people` comes from calendarPeople.
 */
export function dayColumns<E extends StaffRef & Pick<CalendarEvent, 'date'>>(
  salon: CalendarSalon, date: string, people: readonly CalendarPerson[], events: readonly E[], chosenKey?: string, blocks: readonly TimeBlock[] = [],
): CalendarColumn<E>[] {
  const onDay = events.filter((event) => event.date === date);
  const wholeDay = columnPlan(salon, date);
  if (!wholeDay.open) return [{ key: date, date, plan: wholeDay, events: onDay, blocks: [] }];
  const eventsOf = (person: CalendarPerson) => onDay.filter((event) => personKeyOf(event, salon.employees) === person.key);
  const works = (person: CalendarPerson) => {
    const employee = salon.employees.find((item) => item.id === person.employeeId);
    return employee?.status === 'Active' && workingTimeOn(salon, employee.id, date) !== null;
  };
  const blocksOf = (person: CalendarPerson) => person.employeeId !== undefined ? blocksOn(blocks, date, person.employeeId) : [];
  // Somebody who has time blocked on a day off keeps a column too, so the block can be found and removed.
  const shown = people.filter((person) => chosenKey ? person.key === chosenKey : works(person) || eventsOf(person).length > 0 || blocksOf(person).length > 0);
  if (shown.length === 0) return [{ key: date, date, plan: { open: null, reason: 'nobody' }, events: onDay, blocks: [] }];
  return shown.map((person) => ({
    key: person.key,
    date,
    person,
    // Somebody outside the team has no working hours of their own: the opening hours apply.
    plan: person.employeeId !== undefined ? columnPlan(salon, date, person.employeeId) : wholeDay,
    events: eventsOf(person),
    blocks: blocksOf(person),
  }));
}

/** How many of the given appointments fall on each date. */
export function countByDate(events: readonly Pick<CalendarEvent, 'date'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.date, (counts.get(event.date) ?? 0) + 1);
  return counts;
}
