import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarPeople, columnPlan, countByDate, dayColumns, freeSlots, gridSpan, hoursFromTop, isOver, layOutLanes, minutesOf, pastSpan,
  personKeyOf, placeInGrid, shadedSpans, spanOf, timeOf, weekColumns, type Laned,
} from '../src/calendarLayout';
import { calendarHours } from '../src/scheduling';
import type { CalendarEvent } from '../src/types';
import { ANNA, FRI, HOURS, LUCA, MON, SALON, SAT, SELINA, SUN, TEAM, THU, TUE, WED, WEEK, appointment, shifts, span } from './calendarFixture';
import { demoEvents } from './fixedClock';

// The arithmetic behind the calendar's time grid: positions to scale, lanes for appointments at
// the same time, and what is free, shaded or past in a column. The drawing is in
// tests/calendarView.test.ts.

/** The grid of the fixture's week: 08:00 to 19:00. */
const GRID = gridSpan(calendarHours(WEEK, HOURS, []));
const event = appointment;
const at = (date: string, time: string) => ({ date, time });

// ---------- minutes and positions ----------

test('times become minutes and back, and anything else is no time', () => {
  assert.equal(minutesOf('00:00'), 0);
  assert.equal(minutesOf('10:30'), 630);
  assert.equal(minutesOf('23:59'), 1439);
  for (const text of ['', '24:00', '9:00', '10:60', '10.30', 'noon']) assert.equal(minutesOf(text), null, text);
  assert.equal(timeOf(630), '10:30');
  assert.equal(timeOf(485), '08:05');
  assert.deepEqual(spanOf('10:00', '10:30'), { start: 600, end: 630 });
  // No span: the end is not after the start, or one of the two is no time.
  assert.equal(spanOf('10:30', '10:30'), null);
  assert.equal(spanOf('11:00', '10:00'), null);
  assert.equal(spanOf('10:00', ''), null);
});

test('the grid runs from the first hour line to the end of the last hour', () => {
  assert.deepEqual(GRID, { start: 8 * 60, end: 19 * 60 });
  assert.deepEqual(gridSpan(['06:00', '07:00']), { start: 360, end: 480 });
  // An appointment before the opening hours and one after them stretch the grid, as calendarHours says.
  const early = gridSpan(calendarHours(WEEK, HOURS, [event('early', ANNA, TUE, '06:30', '07:00'), event('late', ANNA, FRI, '19:30', '20:15')]));
  assert.deepEqual(early, { start: 6 * 60, end: 21 * 60 });
  // No hours at all: nine o'clock and one hour, rather than nothing.
  assert.deepEqual(gridSpan([]), { start: 540, end: 600 });
});

test('an appointment is as tall as it is long: 90 minutes are three times 30 minutes', () => {
  const cut = placeInGrid(span('10:00', '10:30'), GRID)!;
  const colouring = placeInGrid(span('13:00', '14:30'), GRID)!;
  assert.equal(cut.height, 0.5);
  assert.equal(colouring.height, 1.5);
  assert.equal(colouring.height, 3 * cut.height);
  // Positions are hours from the top of the grid, which starts at 08:00.
  assert.equal(cut.top, 2);
  assert.equal(colouring.top, 5);
  assert.equal(hoursFromTop(minutesOf('08:00')!, GRID), 0);
  assert.equal(hoursFromTop(minutesOf('16:42')!, GRID), 8.7);
  // Three hours of balayage: six times the cut, and it ends where the next appointment starts.
  const balayage = placeInGrid(span('14:30', '17:30'), GRID)!;
  assert.equal(balayage.height, 6 * cut.height);
  assert.equal(colouring.top + colouring.height, balayage.top);
});

test('what lies outside the grid is cut off', () => {
  // 07:30 to 08:30 in a grid that starts at 08:00: the half hour inside is drawn.
  assert.deepEqual(placeInGrid(span('07:30', '08:30'), GRID), { top: 0, height: 0.5 });
  assert.deepEqual(placeInGrid(span('18:30', '19:30'), GRID), { top: 10.5, height: 0.5 });
  assert.equal(placeInGrid(span('06:00', '08:00'), GRID), null);
  assert.equal(placeInGrid(span('19:00', '20:00'), GRID), null);
});

// ---------- lanes ----------

const lanes = (items: [string, string, string][], options?: Parameters<typeof layOutLanes<[string, string, string]>>[2]) =>
  layOutLanes(items, ([, start, end]) => spanOf(start, end), options);
const laneOf = (laid: Laned<[string, string, string]>[], name: string) => laid.find((entry) => entry.item[0] === name)!;
/** True when two laid-out items would be drawn over each other: they share time and lanes. */
const drawnOverEachOther = <T>(a: Laned<T>, b: Laned<T>) =>
  a.span.start < b.span.end && b.span.start < a.span.end && a.lane < b.lane + b.width && b.lane < a.lane + a.width;
const noneOverlap = <T>(laid: Laned<T>[]) => laid.every((a, i) => laid.slice(i + 1).every((b) => !drawnOverEachOther(a, b)));

test('two appointments back to back do not overlap: they share the full width', () => {
  const laid = lanes([['first', '10:00', '10:30'], ['second', '10:30', '11:00']]);
  for (const entry of laid) assert.deepEqual([entry.lane, entry.lanes, entry.width], [0, 1, 1], entry.item[0]);
  // A whole morning back to back stays one lane.
  const morning = lanes([['a', '08:30', '09:30'], ['b', '09:30', '10:00'], ['c', '10:00', '11:30'], ['d', '11:30', '12:00']]);
  assert.ok(morning.every((entry) => entry.lanes === 1 && entry.lane === 0));
});

test('appointments at the same time stand side by side', () => {
  const two = lanes([['anna', '10:00', '11:00'], ['selina', '10:30', '11:30']]);
  assert.deepEqual([laneOf(two, 'anna').lane, laneOf(two, 'selina').lane], [0, 1]);
  assert.ok(two.every((entry) => entry.lanes === 2 && entry.width === 1));
  const three = lanes([['a', '10:00', '11:00'], ['b', '10:00', '11:00'], ['c', '10:00', '11:00']]);
  assert.deepEqual(three.map((entry) => entry.lane), [0, 1, 2]);
  assert.ok(three.every((entry) => entry.lanes === 3));
  assert.ok(noneOverlap(two) && noneOverlap(three));
});

test('a run of overlapping appointments needs no more lanes than overlap at one moment', () => {
  // a overlaps b, b overlaps c, but a and c do not: two lanes are enough, and c takes a's lane.
  const chain = lanes([['a', '10:00', '11:00'], ['b', '10:30', '11:30'], ['c', '11:00', '12:00']]);
  assert.ok(chain.every((entry) => entry.lanes === 2));
  assert.equal(laneOf(chain, 'a').lane, laneOf(chain, 'c').lane);
  assert.notEqual(laneOf(chain, 'a').lane, laneOf(chain, 'b').lane);
  assert.ok(noneOverlap(chain));
  // After a gap a new run starts: the appointment at 14:00 is alone again and takes the full width.
  const withGap = lanes([['a', '10:00', '11:00'], ['b', '10:30', '11:30'], ['later', '14:00', '15:00']]);
  assert.deepEqual([laneOf(withGap, 'later').lane, laneOf(withGap, 'later').lanes], [0, 1]);
});

test('an appointment spreads over the lanes to its right that stay empty while it lasts', () => {
  // Three at 10:00; at 11:00 only two are left: the one in the middle lane also takes the right one.
  const laid = lanes([['a', '10:00', '12:00'], ['b', '10:00', '11:00'], ['c', '10:00', '11:00'], ['d', '11:00', '12:00']]);
  assert.deepEqual([laneOf(laid, 'a').lane, laneOf(laid, 'a').width], [0, 1]);
  assert.deepEqual([laneOf(laid, 'd').lane, laneOf(laid, 'd').width, laneOf(laid, 'd').lanes], [1, 2, 3]);
  assert.ok(noneOverlap(laid));
});

test('a stylist keeps a lane, and the lanes follow the order of the team', () => {
  type Row = [string, string, string];
  const rank: Record<string, number> = { anna: 0, selina: 1, luca: 2 };
  const who = (row: Row) => row[0].split(' ')[0];
  const options = { groupOf: who, rankOf: (row: Row) => rank[who(row)] };
  // Luca starts first, Anna and Selina join: left to right they still stand Anna, Selina, Luca.
  const friday = lanes([['luca 1', '10:00', '12:00'], ['selina 1', '10:30', '12:00'], ['anna 1', '11:00', '12:00']], options);
  assert.deepEqual(['anna 1', 'selina 1', 'luca 1'].map((name) => laneOf(friday, name).lane), [0, 1, 2]);
  // Selina has a break while Anna and Luca go on. Her next customer comes back to her own lane,
  // not to the first free one.
  const busy = lanes([
    ['anna 1', '09:00', '10:00'], ['selina 1', '09:00', '09:30'], ['luca 1', '09:00', '10:30'],
    ['anna 2', '10:00', '11:00'], ['selina 2', '10:30', '11:00'], ['luca 2', '10:30', '11:00'],
  ], options);
  for (const name of ['anna 1', 'anna 2']) assert.equal(laneOf(busy, name).lane, 0, name);
  for (const name of ['selina 1', 'selina 2']) assert.equal(laneOf(busy, name).lane, 1, name);
  for (const name of ['luca 1', 'luca 2']) assert.equal(laneOf(busy, name).lane, 2, name);
  assert.ok(noneOverlap(busy));
});

test('what is no span is left out, and a very short appointment is drawn as a quarter of an hour', () => {
  const laid = lanes([['broken', '10:00', '10:00'], ['backwards', '11:00', '10:00'], ['no time', '', '10:00'], ['fine', '10:00', '10:30']]);
  assert.deepEqual(laid.map((entry) => entry.item[0]), ['fine']);
  // Five minutes would be a line nobody can tap: drawn 15 minutes long, so the appointment that
  // follows at once stands beside it instead of under it.
  const short = lanes([['five minutes', '10:00', '10:05'], ['next', '10:05', '10:35']]);
  assert.deepEqual(laneOf(short, 'five minutes').span, { start: 600, end: 615 });
  assert.notEqual(laneOf(short, 'five minutes').lane, laneOf(short, 'next').lane);
  assert.ok(noneOverlap(short));
  assert.deepEqual(layOutLanes([], () => null), []);
});

test('the salon as it starts: no day draws two appointments over each other, and three stylists need at most three lanes', () => {
  const employees = [ANNA, SELINA, LUCA];
  const days = [...new Set(demoEvents.map((item) => item.date))];
  assert.ok(days.length > 40);
  let widest = 0;
  for (const day of days) {
    const laid = layOutLanes(demoEvents.filter((item) => item.date === day), (item) => spanOf(item.startTime, item.endTime), {
      groupOf: (item) => personKeyOf(item, employees),
      rankOf: (item) => employees.findIndex((employee) => employee.id === item.employeeId),
    });
    assert.equal(laid.length, demoEvents.filter((item) => item.date === day).length, day);
    assert.ok(noneOverlap(laid), day);
    // Nobody is in two places at once, so a day never needs more lanes than the salon has stylists.
    for (const entry of laid) assert.ok(entry.lanes <= 3, day);
    widest = Math.max(widest, ...laid.map((entry) => entry.lanes));
  }
  // And stylists do work at the same time: some days need lanes.
  assert.ok(widest >= 2);
});

// ---------- what a column offers ----------

test('a day is open inside the opening hours; a closed weekday and a closed date are closed all day', () => {
  assert.deepEqual(columnPlan(SALON, TUE), { open: span('08:30', '18:30') });
  assert.deepEqual(columnPlan(SALON, SAT), { open: span('08:00', '16:00') });
  assert.deepEqual(columnPlan(SALON, MON), { open: null, reason: 'closed' });
  assert.deepEqual(columnPlan(SALON, SUN), { open: null, reason: 'closed' });
  // A closed date carries its name. It also closes the day for every stylist.
  const teamDay = { ...SALON, closedDates: [{ id: 'c-1', name: 'Team day', start: WED, end: THU }] };
  assert.deepEqual(columnPlan(teamDay, WED), { open: null, reason: 'closed', note: 'Team day' });
  assert.deepEqual(columnPlan(teamDay, THU, ANNA.id), { open: null, reason: 'closed', note: 'Team day' });
  assert.deepEqual(columnPlan(teamDay, FRI), { open: span('08:30', '18:30') });
  assert.deepEqual(columnPlan({ ...SALON, closedDates: [{ id: 'c-2', name: ' ', start: WED, end: WED }] }, WED), { open: null, reason: 'closed' });
});

test('for one stylist a day is open only inside their working hours', () => {
  // Anna on Thursday: 10:00 to 18:30, the whole rest of the opening hours.
  assert.deepEqual(columnPlan(SALON, THU, ANNA.id), { open: span('10:00', '18:30') });
  // Selina works part of Thursday.
  assert.deepEqual(columnPlan(SALON, THU, SELINA.id), { open: span('12:00', '15:30') });
  // Saturday closes at 16:00 whatever the working hours say, and opens at 08:00 though Luca comes at 09:00.
  assert.deepEqual(columnPlan(SALON, SAT, LUCA.id), { open: span('09:00', '16:00') });
  // A day off, a day without an entry, and working hours that miss the opening hours altogether.
  assert.deepEqual(columnPlan(SALON, THU, LUCA.id), { open: null, reason: 'off' });
  assert.deepEqual(columnPlan(SALON, '2026-10-13', ANNA.id), { open: null, reason: 'off' });
  const night = { ...SALON, shiftOverview: [shifts(ANNA, { [TUE]: ['19:00', '22:00'] })] };
  assert.deepEqual(columnPlan(night, TUE, ANNA.id), { open: null, reason: 'off' });
  // Somebody who is away is away all day, with the reason that was given.
  const away = { ...SALON, absences: [{ id: 'a-1', employeeId: SELINA.id, start: THU, end: FRI, reason: 'Course' }, { id: 'a-2', employeeId: LUCA.id, start: FRI, end: FRI }] };
  assert.deepEqual(columnPlan(away, THU, SELINA.id), { open: null, reason: 'away', note: 'Course' });
  assert.deepEqual(columnPlan(away, FRI, LUCA.id), { open: null, reason: 'away' });
  // The others, and the salon as a whole, are not touched by it.
  assert.deepEqual(columnPlan(away, THU, ANNA.id), { open: span('10:00', '18:30') });
  assert.deepEqual(columnPlan(away, THU), { open: span('08:30', '18:30') });
});

test('a stylist who works part of the day: everything before and after is shaded, and only the hours between take a click', () => {
  // Selina on Thursday 8 October, 12:00 to 15:30, in a grid from 08:00 to 19:00.
  const plan = columnPlan(SALON, THU, SELINA.id);
  assert.deepEqual(shadedSpans(plan.open, GRID), [span('08:00', '12:00'), span('15:30', '19:00')]);
  const tomorrow = at(WED, '09:00');
  assert.deepEqual(freeSlots(plan.open, THU, tomorrow).map(timeOf), ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00']);
  // The salon as a whole on that day: shaded before 08:30 and after 18:30 only.
  assert.deepEqual(shadedSpans(columnPlan(SALON, THU).open, GRID), [span('08:00', '08:30'), span('18:30', '19:00')]);
  assert.equal(freeSlots(columnPlan(SALON, THU).open, THU, tomorrow).length, 20);
  // Working hours that fill the grid shade nothing; a day off shades all of it.
  assert.deepEqual(shadedSpans(GRID, GRID), []);
  assert.deepEqual(shadedSpans(columnPlan(SALON, THU, LUCA.id).open, GRID), [GRID]);
  assert.deepEqual(freeSlots(columnPlan(SALON, THU, LUCA.id).open, THU, tomorrow), []);
});

test('a half hour takes a click only while it has not begun', () => {
  const open = columnPlan(SALON, THU, SELINA.id).open;   // 12:00 to 15:30
  // Thursday at 13:10: 13:00 has begun, 13:30 is the first free half hour.
  assert.deepEqual(freeSlots(open, THU, at(THU, '13:10')).map(timeOf), ['13:30', '14:00', '14:30', '15:00']);
  // On the minute a half hour starts it is gone: the slot rules offer no time that has started.
  assert.deepEqual(freeSlots(open, THU, at(THU, '13:30')).map(timeOf), ['14:00', '14:30', '15:00']);
  assert.deepEqual(freeSlots(open, THU, at(THU, '15:01')), []);
  // A day that is over takes no click at all; a day to come takes all of them.
  assert.deepEqual(freeSlots(open, THU, at(FRI, '00:05')), []);
  assert.equal(freeSlots(open, THU, at(WED, '23:59')).length, 7);
  // Working hours that start off the half hour: the first full half hour counts, and the last one must fit.
  assert.deepEqual(freeSlots(span('09:15', '10:45'), THU, at(WED, '12:00')).map(timeOf), ['09:30', '10:00']);
});

test('the past of a column: all of an earlier day, today up to now, nothing of a day to come', () => {
  assert.deepEqual(pastSpan(WED, at(THU, '13:10'), GRID), GRID);
  assert.deepEqual(pastSpan(THU, at(THU, '13:10'), GRID), { start: GRID.start, end: 13 * 60 + 10 });
  assert.equal(pastSpan(FRI, at(THU, '13:10'), GRID), null);
  // Before the grid starts nothing of today is past yet; after it ends, all of it is.
  assert.equal(pastSpan(THU, at(THU, '07:00'), GRID), null);
  assert.deepEqual(pastSpan(THU, at(THU, '21:00'), GRID), GRID);
  // An appointment is over once its end has passed.
  const cut = event('cut', ANNA, THU, '12:30', '13:00');
  assert.equal(isOver(cut, at(THU, '12:59')), false);
  assert.equal(isOver(cut, at(THU, '13:00')), true);
  assert.equal(isOver(cut, at(FRI, '08:00')), true);
  assert.equal(isOver(cut, at(WED, '18:00')), false);
});

// ---------- the columns of a day and of a week ----------

test('everybody with a colour: the team in its order, then names on appointments that match nobody', () => {
  const events = [event('a', ANNA, THU, '10:00', '10:30'), event('old', 'Unassigned', THU, '11:00', '11:30'), event('gone', 'Maria Rossi', THU, '12:00', '12:30')];
  const people = calendarPeople(TEAM, events);
  assert.deepEqual(people.map((entry) => [entry.key, entry.name, entry.index]), [
    ['emp-1', 'Anna Weber', 0], ['emp-2', 'Selina Keller', 1], ['emp-3', 'Luca Frei', 2],
    ['name:Unassigned', 'Unassigned', -1], ['name:Maria Rossi', 'Maria Rossi', -1],
  ]);
  // The id decides. A record without an id is matched by name; an id that nobody has belongs to nobody.
  assert.equal(personKeyOf({ employeeId: 'emp-2', staffName: 'Renamed since' }, TEAM), 'emp-2');
  assert.equal(personKeyOf({ staffName: 'Luca Frei' }, TEAM), 'emp-3');
  assert.equal(personKeyOf({ employeeId: 'emp-9', staffName: 'Anna Weber' }, TEAM), 'name:Anna Weber');
});

test('the day view has one column per stylist who works that day, and one for anybody with an appointment', () => {
  const people = calendarPeople(TEAM, []);
  const keys = (date: string, events: CalendarEvent[] = [], chosen?: string) => dayColumns(SALON, date, calendarPeople(TEAM, events), events, chosen).map((column) => column.key);
  // Friday: all three. Thursday: Anna and Selina. Tuesday: Anna and Luca.
  assert.deepEqual(keys(FRI), ['emp-1', 'emp-2', 'emp-3']);
  assert.deepEqual(keys(THU), ['emp-1', 'emp-2']);
  assert.deepEqual(keys(TUE), ['emp-1', 'emp-3']);
  // Luca has an appointment on Thursday although he does not work then: he gets a column, shaded all day.
  const lucasThursday = [event('a', ANNA, THU, '10:00', '10:30'), event('l', LUCA, THU, '11:00', '11:30'), event('other day', LUCA, FRI, '11:00', '11:30')];
  const thursday = dayColumns(SALON, THU, people, lucasThursday);
  assert.deepEqual(thursday.map((column) => [column.key, column.plan.reason ?? 'open', column.events.map((item) => item.id)]), [
    ['emp-1', 'open', ['a']], ['emp-2', 'open', []], ['emp-3', 'off', ['l']],
  ]);
  // So does a name that matches nobody in the team; the opening hours apply to it.
  const unassigned = [event('u', 'Unassigned', THU, '11:00', '11:30')];
  assert.deepEqual(keys(THU, unassigned), ['emp-1', 'emp-2', 'name:Unassigned']);
  assert.deepEqual(dayColumns(SALON, THU, calendarPeople(TEAM, unassigned), unassigned)[2].plan, { open: span('08:30', '18:30') });
  // Somebody who is away would have worked: the column stays and says so.
  const away = { ...SALON, absences: [{ id: 'a-1', employeeId: SELINA.id, start: THU, end: THU, reason: 'Course' }] };
  assert.deepEqual(dayColumns(away, THU, people, []).map((column) => [column.key, column.plan.reason ?? 'open']), [['emp-1', 'open'], ['emp-2', 'away']]);
  // Somebody who no longer works at the salon has a column only for an appointment.
  const former = { ...SALON, employees: [ANNA, { ...SELINA, status: 'Inactive' as const }, LUCA] };
  assert.deepEqual(dayColumns(former, FRI, calendarPeople(former.employees, []), []).map((column) => column.key), ['emp-1', 'emp-3']);
  const kept = [event('s', SELINA, FRI, '09:00', '09:30')];
  assert.deepEqual(dayColumns(former, FRI, calendarPeople(former.employees, kept), kept).map((column) => column.key), ['emp-1', 'emp-2', 'emp-3']);
  // With one stylist chosen there is only that column, also on their day off.
  assert.deepEqual(keys(FRI, [], 'emp-2'), ['emp-2']);
  assert.deepEqual(dayColumns(SALON, THU, people, [], 'emp-3').map((column) => [column.key, column.plan.reason]), [['emp-3', 'off']]);
});

test('a closed day is one column for everybody, and so is a day on which nobody works', () => {
  const people = calendarPeople(TEAM, []);
  const monday = [event('m1', ANNA, MON, '10:00', '10:30'), event('m2', LUCA, MON, '10:00', '10:30')];
  const closed = dayColumns(SALON, MON, people, monday);
  assert.equal(closed.length, 1);
  assert.deepEqual([closed[0].key, closed[0].person, closed[0].plan, closed[0].events.map((item) => item.id)], [MON, undefined, { open: null, reason: 'closed' }, ['m1', 'm2']]);
  // The same on a closed date, also with a stylist chosen.
  const teamDay = { ...SALON, closedDates: [{ id: 'c-1', name: 'Team day', start: FRI, end: FRI }] };
  assert.deepEqual(dayColumns(teamDay, FRI, people, [], 'emp-1').map((column) => [column.key, column.plan]), [[FRI, { open: null, reason: 'closed', note: 'Team day' }]]);
  // Open, but nobody has working hours: one shaded column that says so.
  const nobody = dayColumns({ ...SALON, shiftOverview: [] }, TUE, people, []);
  assert.deepEqual(nobody.map((column) => [column.key, column.plan]), [[TUE, { open: null, reason: 'nobody' }]]);
});

test('the week has one column per day, and with one stylist chosen each day follows their working hours', () => {
  const events = [event('a', ANNA, TUE, '10:00', '10:30'), event('b', LUCA, TUE, '10:00', '10:30'), event('c', ANNA, SAT, '09:00', '09:30')];
  const everybody = weekColumns(SALON, WEEK, events);
  assert.deepEqual(everybody.map((column) => column.key), WEEK);
  assert.deepEqual(everybody.map((column) => column.plan.reason ?? 'open'), ['closed', 'open', 'open', 'open', 'open', 'open', 'closed']);
  assert.deepEqual(everybody.map((column) => column.events.length), [0, 2, 0, 0, 0, 1, 0]);
  assert.deepEqual(everybody[1].plan.open, span('08:30', '18:30'));
  // Luca alone: Tuesday and Friday from 10:00, Saturday from 09:00, the other days off or closed.
  const luca = weekColumns(SALON, WEEK, events, LUCA.id);
  assert.deepEqual(luca.map((column) => column.plan.reason ?? timeOf(column.plan.open!.start)), ['closed', '10:00', 'off', 'off', '10:00', '09:00', 'closed']);
  assert.deepEqual(countByDate(events), new Map([[TUE, 2], [SAT, 1]]));
});
