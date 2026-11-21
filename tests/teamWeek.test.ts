import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { initialEmployees } from '../src/mockData';
import type { Employee, ShiftEntry } from '../src/types';
import { ShiftPlanView } from '../src/views/ShiftPlanView';
import { TeamView } from '../src/views/TeamView';
import { workingTimeOn } from '../src/workingHours';
import { demoEvents, demoShifts, FIXED_NOW } from './fixedClock';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// "This week" in Team: for each person and day the hours that apply. Regular hours look regular,
// a day that was changed is marked, today is marked, and each person's hours of the week are
// summed. Phones get one card per person with the days as rows; wide screens get one table.
// The moment is fixed: Monday 5 October 2026, so the week shown is 5 to 11 October.

const nothing = () => {};
const ZONE = 'Europe/Zurich';
const TUESDAY = '2026-10-06';
const FRIDAY = '2026-10-09';
const count = (html: string, part: string) => html.split(part).length - 1;
/** The text between the tags only: what stands on the screen, without labels for screen readers. */
const onScreen = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const week = (partial: Partial<React.ComponentProps<typeof ShiftPlanView>> = {}) => render(React.createElement(ShiftPlanView, {
  employees: initialEmployees, shiftOverview: demoShifts, timeZone: ZONE, onUpdateShift: nothing, now: FIXED_NOW, ...partial,
}));
/** The week plan with single days changed for the sample stylists. */
const changedDays = (days: Record<string, ShiftEntry['shifts']>): ShiftEntry[] =>
  demoShifts.map((entry) => ({ ...entry, shifts: { ...entry.shifts, ...(days[entry.employeeId] ?? {}) } }));
// Luca is off on Tuesday and starts later on Friday; Selina works an extra Tuesday morning.
const CHANGED = changedDays({
  'emp-3': { [TUESDAY]: null, [FRIDAY]: { start: '12:00', end: '18:30' } },
  'emp-2': { [TUESDAY]: { start: '09:00', end: '13:00' } },
});
/** The two layouts of the same week: the cards for phones and tablets, the table for wide screens. */
const layouts = (html: string) => {
  const cards = /<div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:hidden">(.*?)<div class="hidden xl:block">/s.exec(html)?.[1] ?? '';
  const table = /<table[^>]*>(.*?)<\/table>/s.exec(html)?.[1] ?? '';
  return { cards, table };
};
/** The names of the controls that change one day: "Luca Frei, Tuesday, 06.10.2026: …". */
const dayControls = (html: string) => Array.from(html.matchAll(/aria-label="([^"]*?)\. Change this day"/g), (match) => match[1]);

test('every day shows the hours that apply, and the regular week needs no entry in the plan', () => {
  // The sample salon's plan holds no day: everything on the screen comes from the regular hours.
  assert.deepEqual(demoShifts.map((entry) => Object.keys(entry.shifts).length), [0, 0, 0]);
  const html = week();
  const { cards, table } = layouts(html);
  assert.ok(cards && table);
  // A control per person and day, in both layouts, named with the day and what applies.
  const controls = dayControls(table);
  assert.equal(controls.length, 21);
  assert.deepEqual(dayControls(cards), controls);
  assert.deepEqual(controls.slice(0, 7), [
    'Anna Weber, Monday, 05.10.2026: off, regular day off',
    'Anna Weber, Tuesday, 06.10.2026: 08:30–17:00, regular hours',
    'Anna Weber, Wednesday, 07.10.2026: 08:30–17:00, regular hours',
    'Anna Weber, Thursday, 08.10.2026: 10:00–18:30, regular hours',
    'Anna Weber, Friday, 09.10.2026: 10:00–18:30, regular hours',
    'Anna Weber, Saturday, 10.10.2026: 08:00–14:00, regular hours',
    'Anna Weber, Sunday, 11.10.2026: off, regular day off',
  ]);
  // The same hours the booking rules use for those days.
  const salon = { employees: initialEmployees, shiftOverview: demoShifts };
  assert.deepEqual(workingTimeOn(salon, 'emp-2', '2026-10-10'), { start: '08:00', end: '16:00' });
  assert.ok(controls.includes('Selina Keller, Saturday, 10.10.2026: 08:00–16:00, regular hours'));
  // Nothing is marked as changed, and no day offers "Back to regular hours".
  assert.doesNotMatch(html, /changed for this day|bg-amber-50 border-amber-300|instead of|extra day/);
  assert.match(onScreen(table), /Employee Mon 05\.10\. Today Tue 06\.10\. Wed 07\.10\. Thu 08\.10\. Fri 09\.10\. Sat 10\.10\. Sun 11\.10\./);
  assert.match(onScreen(table), /Anna Weber 40 h this week Off 08:30–17:00 08:30–17:00 10:00–18:30 10:00–18:30 08:00–14:00 Off/);
});

test('a day that was changed is marked: other hours, a day off, an extra day', () => {
  const html = week({ shiftOverview: CHANGED });
  const { cards, table } = layouts(html);
  const controls = dayControls(table);
  assert.ok(controls.includes('Luca Frei, Tuesday, 06.10.2026: off, changed for this day, instead of 10:00–18:30'));
  assert.ok(controls.includes('Luca Frei, Friday, 09.10.2026: 12:00–18:30, changed for this day, instead of 10:00–18:30'));
  assert.ok(controls.includes('Selina Keller, Tuesday, 06.10.2026: 09:00–13:00, changed for this day, usually off'));
  // The days around them stay regular.
  assert.ok(controls.includes('Luca Frei, Saturday, 10.10.2026: 09:00–16:00, regular hours'));
  assert.ok(controls.includes('Selina Keller, Monday, 05.10.2026: off, regular day off'));
  assert.deepEqual(dayControls(cards), controls);
  // On screen: the new hours, and what they replace struck through (read out as "instead of").
  for (const part of [cards, table]) {
    assert.match(onScreen(part), /Off instead of 10:00–18:30/);
    assert.match(onScreen(part), /12:00–18:30 instead of 10:00–18:30/);
    assert.match(onScreen(part), /09:00–13:00 extra day/);
    assert.equal(count(part, '<s>10:00–18:30</s>'), 2);
    assert.equal(count(part, '<span class="sr-only">instead of </span>'), 2);
  }
  // Three marked cells in the table, three marked rows in the cards; a regular day off is plain grey.
  assert.equal(count(table, 'bg-amber-50 border-amber-300'), 3);
  assert.equal(count(cards, 'bg-amber-50/80'), 3);
  // (Monday and Sunday for all three, Wednesday and Thursday for Luca: eight in all.)
  assert.equal(count(table, '<span class="text-slate-500">Off</span>'), 8);
  // The legend says what the mark means.
  assert.match(onScreen(html), /Regular hours Changed for this day/);
});

test('today is marked, and each person\'s hours of the week are summed', () => {
  const html = week({ shiftOverview: CHANGED });
  const { cards, table } = layouts(html);
  // Today is Monday 5 October: its column in the table, its row in every card.
  assert.equal(count(table, 'aria-current="date"'), 1);
  assert.match(table, /<th scope="col" aria-current="date"[^>]*><span class="block">Mon 05\.10\.<\/span><span[^>]*>Today<\/span><\/th>/);
  assert.equal(count(table, 'bg-indigo-50/60'), 3);
  assert.equal(count(cards, 'aria-current="date"'), 3);
  assert.equal(count(onScreen(cards), 'Today'), 3);
  // The sums: Anna's regular 40 hours; Selina 33.5 + 4; Luca 24 - 8.5 - 2.
  assert.match(onScreen(table), /Anna Weber 40 h this week/);
  assert.match(onScreen(table), /Selina Keller 37\.5 h this week/);
  assert.match(onScreen(table), /Luca Frei 13\.5 h this week/);
  assert.match(onScreen(cards), /Anna Weber 40 h this week .*Selina Keller 37\.5 h this week .*Luca Frei 13\.5 h this week/);
  // Opened on another moment, another day is today and the week is the one around it.
  const later = week({ now: new Date('2026-10-15T10:00:00Z') });
  assert.match(layouts(later).table, /<th scope="col" aria-current="date"[^>]*><span class="block">Thu 15\.10\.<\/span>/);
  assert.match(onScreen(later), /12\.–18\.10\.2026/);
  assert.match(onScreen(layouts(later).table), /Luca Frei 24 h this week/);
});

test('phones get one card per person with the days as rows, wide screens one table', () => {
  const html = week({ shiftOverview: CHANGED });
  const { cards, table } = layouts(html);
  // The cards are shown below the wide breakpoint and the table from it on: never both.
  assert.match(html, /<div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:hidden">/);
  assert.match(html, /<div class="hidden xl:block">/);
  // One card per person: their name, their sum, and seven rows that are buttons a thumb can hit.
  const people = Array.from(cards.matchAll(/<section aria-label="([^"]*)"/g), (match) => match[1]);
  assert.deepEqual(people, ['Anna Weber, 05.–11.10.2026', 'Selina Keller, 05.–11.10.2026', 'Luca Frei, 05.–11.10.2026']);
  assert.equal(count(cards, '<li'), 21);
  const rows = cards.match(/<li[^>]*><button[^>]*>/g) ?? [];
  assert.equal(rows.length, 21);
  for (const row of rows) { assert.match(row, /\bmin-h-11\b/); assert.match(row, /\bw-full\b/); }
  // A row reads date first, then the hours: no table to scroll sideways.
  assert.match(onScreen(cards), /Luca Frei 13\.5 h this week Mon 05\.10\. Today Off Tue 06\.10\. Off instead of 10:00–18:30 Wed 07\.10\. Off Thu 08\.10\. Off Fri 09\.10\. 12:00–18:30 instead of 10:00–18:30 Sat 10\.10\. 09:00–16:00 Sun 11\.10\. Off/);
  assert.doesNotMatch(cards, /<table|min-w-\[/);
  // The table keeps its seven day columns and a row per person.
  assert.equal(count(table, '<th scope="col"'), 8);
  assert.equal(count(table, '<th scope="row"'), 3);
  // Every control in both layouts is at least 44 px high.
  for (const button of [...cards.matchAll(/<button[^>]*class="([^"]*)"/g), ...table.matchAll(/<button[^>]*class="([^"]*)"/g)]) assert.match(button[1], /\bmin-h-11\b/);
});

test('"Change a day" and "Copy last week" stand above the week, and nothing is called a shift any more', () => {
  const html = week();
  const text = onScreen(html);
  assert.deepEqual(Array.from(html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g), (match) => match[1]), ['Working hours']);
  assert.match(text, /Working hours Change a day Today 05\.–11\.10\.2026 Copy last week/);
  assert.match(html, /title="Copy the changed days of 28\.09\.–04\.10\.2026 into the week shown"/);
  assert.match(text, /Everybody works their regular hours, set in People\. Select a day to change that one day: other hours, or a day off\./);
  const all = readableText(html);
  assert.doesNotMatch(all, /shift|Unavailable|New shift/i);
  assert.doesNotMatch(all, TELL_WORDS);
  // Nothing is asked and nothing is announced before a copy was tried.
  assert.doesNotMatch(html, /already changed\?|Nothing to copy|role="dialog"/);
  // The old address of the plan still leads here: the tab keeps its name.
  const team = render(React.createElement(TeamView, {
    tab: 'week', employees: initialEmployees, onAddEmployee: nothing, onUpdateEmployee: nothing, onDeleteEmployee: nothing,
    shiftOverview: demoShifts, onUpdateShift: nothing, absences: [], onSaveAbsences: nothing, timeZone: ZONE, now: FIXED_NOW,
  }));
  assert.match(onScreen(team), /Team People This week Absences Working hours Change a day/);
});

test('people who are inactive, away, or without regular hours are shown for what they are', () => {
  // Inactive: not planned, and the page says that somebody is left out.
  const withInactive = initialEmployees.map((employee): Employee => employee.id === 'emp-3' ? { ...employee, status: 'Inactive' } : employee);
  const twoPeople = week({ employees: withInactive });
  assert.equal(dayControls(layouts(twoPeople).table).length, 14);
  assert.doesNotMatch(layouts(twoPeople).table, /Luca Frei/);
  assert.match(onScreen(twoPeople), /One inactive person is not shown here\. They are listed in People\./);
  assert.doesNotMatch(week(), /inactive/i);
  // Nobody active, and nobody at all: the page says what to do first.
  assert.match(onScreen(week({ employees: initialEmployees.map((employee): Employee => ({ ...employee, status: 'Inactive' })) })), /Nobody in the team is active\. Set a person to active in People to plan their week\./);
  assert.match(onScreen(week({ employees: [] })), /Add an employee in People before planning the week\./);
  assert.match(week({ employees: [] }), /<button disabled=""[^>]*>.*?Change a day<\/button>/);

  // Away (Absences): the day says so, and its hours are not counted. Selina is away Thursday and Friday.
  const away = week({ absences: [{ id: 'a-1', employeeId: 'emp-2', start: '2026-10-08', end: '2026-10-09', reason: 'Course' }] });
  const controls = dayControls(layouts(away).table);
  assert.ok(controls.includes('Selina Keller, Thursday, 08.10.2026: away, would work 08:30–17:00'));
  assert.ok(controls.includes('Selina Keller, Saturday, 10.10.2026: 08:00–16:00, regular hours'));
  assert.match(onScreen(layouts(away).table), /Selina Keller 16\.5 h this week Off Off 10:00–18:30 Away would work 08:30–17:00 Away would work 08:30–17:00 08:00–16:00 Off/);
  assert.match(onScreen(away), /Regular hours Changed for this day Away/);
  assert.doesNotMatch(onScreen(week()), /Away/);

  // No regular hours (a person stored before they existed): only entered days count, and the page says so.
  const noWeek = initialEmployees.map((employee): Employee => employee.id === 'emp-3' ? { ...employee, weeklyHours: undefined } : employee);
  const entered = week({ employees: noWeek, shiftOverview: changedDays({ 'emp-3': { [FRIDAY]: { start: '10:00', end: '14:00' } } }) });
  assert.match(onScreen(layouts(entered).table), /Luca Frei 4 h this week No regular working hours Off Off Off Off 10:00–14:00 extra day Off Off/);
  assert.match(onScreen(layouts(entered).cards), /Luca Frei 4 h this week No regular working hours: only days entered here count\./);
});

test('the week the sample salon starts with is the regular week of its three stylists', () => {
  // What the plan showed when every date was stored: the same hours, now without a line per date.
  const html = week({ events: demoEvents });
  const table = onScreen(layouts(html).table);
  assert.match(table, /Selina Keller 33\.5 h this week Off Off 10:00–18:30 08:30–17:00 08:30–17:00 08:00–16:00 Off/);
  assert.match(table, /Luca Frei 24 h this week Off 10:00–18:30 Off Off 10:00–18:30 09:00–16:00 Off/);
  // Any other week reads the same: eight weeks back and half a year ahead.
  for (const now of [new Date('2026-08-12T10:00:00Z'), new Date('2027-04-14T10:00:00Z')]) {
    const other = onScreen(layouts(week({ now })).table);
    assert.match(other, /Anna Weber 40 h this week Off 08:30–17:00 08:30–17:00 10:00–18:30 10:00–18:30 08:00–14:00 Off/);
    assert.match(other, /Luca Frei 24 h this week Off 10:00–18:30 Off Off 10:00–18:30 09:00–16:00 Off/);
  }
});
