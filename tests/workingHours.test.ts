import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getAvailableSlots, validateCalendarEvent, type AvailabilityContext } from '../src/availability';
import { validateDayHours, validateWeeklyHours } from '../src/managementValidation';
import { initialBookingHours, initialEmployees } from '../src/mockData';
import type { CalendarEvent, Employee, ShiftEntry } from '../src/types';
import {
  bookingsLeftOutside, copyOfWeekBefore, dayChangesSummary, enteredWorkingDays, formatHoursTotal, hasRegularHours, isValidDayChange, isValidHours, minutesInWeek,
  timeChoices, undoDayChanges, weekCopySource, weeklyHoursFromOpeningHours, withDayChanges, withoutRegularDays, workingDayOn, workingTimeOn,
  type DayChange, type WeeklyHours,
} from '../src/workingHours';

// Who works when: every person has regular hours per weekday, and the week plan stores only the
// single days that differ. These tests pin the rule itself, the changes to single days, and the
// copy of a week. The week of the examples is Monday 5 to Sunday 11 October 2026.

const MONDAY = '2026-10-05';
const TUESDAY = '2026-10-06';
const WEDNESDAY = '2026-10-07';
const FRIDAY = '2026-10-09';
const SATURDAY = '2026-10-10';

const week = (days: Partial<WeeklyHours>): WeeklyHours => ({ mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null, ...days });
const person = (id: string, name: string, weeklyHours?: WeeklyHours): Employee => ({
  id, name, firstName: name.split(' ')[0], lastName: name.split(' ')[1] ?? '', initials: name[0], email: '', phone: '',
  status: 'Active', location: 'Salon', canBookOnline: true, hidden: false, ...(weeklyHours ? { weeklyHours } : {}),
});
// Mira works Tuesday to Friday; Jonas has no regular hours at all.
const MIRA = person('mira', 'Mira Probst', week({
  tue: { start: '09:00', end: '17:00' }, wed: { start: '09:00', end: '17:00' }, thu: { start: '12:00', end: '18:00' }, fri: { start: '09:00', end: '15:00' },
}));
const JONAS = person('jonas', 'Jonas Frei');
const plan = (employeeId: string, shifts: ShiftEntry['shifts']): ShiftEntry => ({ employeeId, employeeName: employeeId, initials: 'X', avatarColor: '', shifts });
const salon = (shiftOverview: ShiftEntry[] = []) => ({ employees: [MIRA, JONAS], shiftOverview });

// ---------- the rule ----------

test('regular hours apply on every date of their weekday, with no first and no last day', () => {
  assert.deepEqual(workingTimeOn(salon(), 'mira', TUESDAY), { start: '09:00', end: '17:00' });
  assert.deepEqual(workingTimeOn(salon(), 'mira', '2026-10-08'), { start: '12:00', end: '18:00' });
  assert.equal(workingTimeOn(salon(), 'mira', MONDAY), null);
  assert.equal(workingTimeOn(salon(), 'mira', SATURDAY), null);
  // Years back and years ahead: the regular week needs no plan that could run out.
  assert.deepEqual(workingTimeOn(salon(), 'mira', '2021-03-09'), { start: '09:00', end: '17:00' }); // a Tuesday
  assert.deepEqual(workingTimeOn(salon(), 'mira', '2031-10-10'), { start: '09:00', end: '15:00' }); // a Friday
  // An empty list for a person changes nothing: it holds no day that differs.
  assert.deepEqual(workingTimeOn(salon([plan('mira', {})]), 'mira', TUESDAY), { start: '09:00', end: '17:00' });
  // The answer is a copy: changing it does not change the person's regular week.
  workingTimeOn(salon(), 'mira', TUESDAY)!.start = '00:00';
  assert.equal(MIRA.weeklyHours!.tue!.start, '09:00');
});

test('a day entered for a date decides: other hours, or off that day; without it the regular hours are back', () => {
  const changed = salon([plan('mira', { [TUESDAY]: { start: '13:00', end: '19:00' }, [WEDNESDAY]: null, [SATURDAY]: { start: '08:00', end: '12:00' } })]);
  // Other hours on a working day, off on a working day, and an extra day on a regular day off.
  assert.deepEqual(workingTimeOn(changed, 'mira', TUESDAY), { start: '13:00', end: '19:00' });
  assert.equal(workingTimeOn(changed, 'mira', WEDNESDAY), null);
  assert.deepEqual(workingTimeOn(changed, 'mira', SATURDAY), { start: '08:00', end: '12:00' });
  // Only that date: the Tuesday before and the Tuesday after are regular.
  assert.deepEqual(workingTimeOn(changed, 'mira', '2026-09-29'), { start: '09:00', end: '17:00' });
  assert.deepEqual(workingTimeOn(changed, 'mira', '2026-10-13'), { start: '09:00', end: '17:00' });
  // Somebody else's entry is not hers.
  assert.deepEqual(workingTimeOn(salon([plan('jonas', { [TUESDAY]: null })]), 'mira', TUESDAY), { start: '09:00', end: '17:00' });
  // An entry carries only its times, whatever else an older record held.
  const labelled = salon([plan('mira', { [TUESDAY]: { start: '10:00', end: '11:00', label: 'Course', type: 'shift' } })]);
  assert.deepEqual(workingTimeOn(labelled, 'mira', TUESDAY), { start: '10:00', end: '11:00' });
});

test('a person without regular hours works only on days entered for them: nothing falls back to the opening hours', () => {
  assert.equal(hasRegularHours(JONAS), false);
  assert.equal(hasRegularHours(MIRA), true);
  assert.equal(hasRegularHours(person('off', 'All Off', week({}))), false);
  for (const date of [MONDAY, TUESDAY, WEDNESDAY, FRIDAY, SATURDAY]) assert.equal(workingTimeOn(salon(), 'jonas', date), null, date);
  const entered = salon([plan('jonas', { [FRIDAY]: { start: '10:00', end: '14:00' } })]);
  assert.deepEqual(workingTimeOn(entered, 'jonas', FRIDAY), { start: '10:00', end: '14:00' });
  assert.equal(workingTimeOn(entered, 'jonas', '2026-10-16'), null);
  // Somebody who is not in the team, and a date that is none.
  assert.equal(workingTimeOn(salon(), 'nobody', TUESDAY), null);
  assert.equal(workingTimeOn(salon(), 'mira', 'not-a-date'), null);
});

test('the slot rules give the times of the same answer: regular hours, other hours, a day off, no hours', () => {
  const context = (shiftOverview: ShiftEntry[] = []): AvailabilityContext => ({
    employees: [MIRA, JONAS],
    services: [{ id: 'cut', name: 'Cut', durationMinutes: 30, priceCHF: 50, onlineBooking: true, assignedEmployeesCount: 2, assignedEmployeeIds: ['mira', 'jonas'] }],
    bookingHours: initialBookingHours, shiftOverview, events: [], requests: [],
    now: new Date('2026-10-01T10:00:00Z'), timeZone: 'Europe/Zurich',
  });
  const slots = (shiftOverview: ShiftEntry[], employeeId: string, date: string) => getAvailableSlots(context(shiftOverview), { date, serviceId: 'cut', employeeId });
  // Regular hours, as a customer on the booking page gets them (no owner mode).
  const regular = slots([], 'mira', TUESDAY);
  assert.equal(regular[0], '09:00');
  assert.equal(regular.at(-1), '16:30');
  // Other hours that day.
  const other = slots([plan('mira', { [TUESDAY]: { start: '13:00', end: '15:00' } })], 'mira', TUESDAY);
  assert.deepEqual(other, ['13:00', '13:30', '14:00', '14:30']);
  // Off that day, and a person without hours: nothing, though the salon is open from 08:30 to 18:30.
  assert.deepEqual(slots([plan('mira', { [TUESDAY]: null })], 'mira', TUESDAY), []);
  assert.deepEqual(slots([], 'jonas', TUESDAY), []);
  // The calendar's own check says why, in the words the rules have for it.
  const appointment: Omit<CalendarEvent, 'id'> = {
    customerName: 'Customer', serviceId: 'cut', serviceName: 'Cut', employeeId: 'jonas', staffName: 'Jonas Frei',
    date: TUESDAY, day: 'tue', dateDisplay: '', startTime: '10:00', endTime: '10:30', colorTheme: 'blue',
  };
  assert.match(validateCalendarEvent(context(), appointment)!, /does not work on this date/);
  assert.equal(validateCalendarEvent(context([plan('jonas', { [TUESDAY]: { start: '10:00', end: '12:00' } })]), appointment), null);
});

test('a day is told with what it would regularly be, so the week can mark the days that differ', () => {
  const changed = salon([plan('mira', {
    [TUESDAY]: { start: '13:00', end: '19:00' }, [WEDNESDAY]: null, [SATURDAY]: { start: '08:00', end: '12:00' },
    // Entered, but with exactly the regular hours (the regular week was changed to match later): no change to show.
    [FRIDAY]: { start: '09:00', end: '15:00' }, [MONDAY]: null,
  })]);
  assert.deepEqual(workingDayOn(salon(), 'mira', TUESDAY), { hours: { start: '09:00', end: '17:00' }, regular: { start: '09:00', end: '17:00' }, kind: 'regular', entered: false });
  assert.deepEqual(workingDayOn(salon(), 'mira', MONDAY), { hours: null, regular: null, kind: 'regular', entered: false });
  assert.deepEqual(workingDayOn(changed, 'mira', TUESDAY), { hours: { start: '13:00', end: '19:00' }, regular: { start: '09:00', end: '17:00' }, kind: 'other', entered: true });
  assert.deepEqual(workingDayOn(changed, 'mira', WEDNESDAY), { hours: null, regular: { start: '09:00', end: '17:00' }, kind: 'off', entered: true });
  assert.deepEqual(workingDayOn(changed, 'mira', SATURDAY), { hours: { start: '08:00', end: '12:00' }, regular: null, kind: 'other', entered: true });
  assert.equal(workingDayOn(changed, 'mira', FRIDAY).kind, 'regular');
  assert.equal(workingDayOn(changed, 'mira', FRIDAY).entered, true);
  assert.equal(workingDayOn(changed, 'mira', MONDAY).kind, 'regular');
  // What the day view says is what the rule says, for every case.
  for (const date of [MONDAY, TUESDAY, WEDNESDAY, FRIDAY, SATURDAY]) {
    assert.deepEqual(workingDayOn(changed, 'mira', date).hours, workingTimeOn(changed, 'mira', date), date);
  }
});

test('the days entered for somebody are listed from a date on, with hours only', () => {
  const entered = [plan('jonas', {
    '2026-10-02': { start: '10:00', end: '14:00' },  // over
    [FRIDAY]: { start: '10:00', end: '14:00' },
    [TUESDAY]: { start: '09:00', end: '12:00' },
    [WEDNESDAY]: null,                               // a day off is no working day
    [SATURDAY]: { start: '18:00', end: '09:00' },    // hours that cannot be worked
  })];
  assert.deepEqual(enteredWorkingDays(entered, 'jonas', MONDAY), [
    { date: TUESDAY, hours: { start: '09:00', end: '12:00' } },
    { date: FRIDAY, hours: { start: '10:00', end: '14:00' } },
  ]);
  assert.deepEqual(enteredWorkingDays(entered, 'jonas', SATURDAY), []);
  assert.deepEqual(enteredWorkingDays(entered, 'mira', MONDAY), []);
  assert.deepEqual(enteredWorkingDays([], 'jonas', MONDAY), []);
});

test('no other file reads the stored days by date: who works when is asked from workingTimeOn', () => {
  // A screen or a rule that looked a date up in the week plan itself would miss the regular week
  // and see only the days that differ. Everything asks src/workingHours.ts instead.
  const root = path.resolve(import.meta.dirname, '../src');
  const files = (folder: string): string[] => readdirSync(folder).flatMap((name) => {
    const file = path.join(folder, name);
    return statSync(file).isDirectory() ? files(file) : /\.tsx?$/.test(name) ? [file] : [];
  });
  const direct = files(root)
    .filter((file) => path.relative(root, file) !== 'workingHours.ts')
    .filter((file) => /\.shifts\s*(\?\.)?\[/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file));
  assert.deepEqual(direct, []);
});

// ---------- changing single days ----------

test('changing a day stores an exception; a day set to its regular hours stores nothing', () => {
  const start = [plan('mira', {})];
  // Other hours and a day off are stored for that date only.
  const changed = withDayChanges(start, [MIRA, JONAS], [
    { employeeId: 'mira', date: TUESDAY, hours: { start: '13:00', end: '19:00' } },
    { employeeId: 'mira', date: WEDNESDAY, hours: null },
  ]);
  assert.deepEqual(changed, [plan('mira', { [TUESDAY]: { start: '13:00', end: '19:00' }, [WEDNESDAY]: null })]);
  // What was passed in is not changed.
  assert.deepEqual(start, [plan('mira', {})]);
  // The regular hours again, or 'regular': the day is taken out, and the rule answers from the regular week.
  const back = withDayChanges(changed, [MIRA, JONAS], [
    { employeeId: 'mira', date: TUESDAY, hours: { start: '09:00', end: '17:00' } },
    { employeeId: 'mira', date: WEDNESDAY, hours: 'regular' },
  ]);
  assert.deepEqual(back, [plan('mira', {})]);
  assert.deepEqual(workingTimeOn({ employees: [MIRA], shiftOverview: back }, 'mira', WEDNESDAY), { start: '09:00', end: '17:00' });
  // "Off" on a regular day off is nothing to store either, and taking back a day that was never changed changes nothing.
  assert.equal(withDayChanges(start, [MIRA], [{ employeeId: 'mira', date: MONDAY, hours: null }]), start);
  assert.equal(withDayChanges(start, [MIRA], [{ employeeId: 'mira', date: TUESDAY, hours: 'regular' }]), start);
  // A person who has no list yet gets one, with their name and initials.
  const first = withDayChanges([], [MIRA, JONAS], [{ employeeId: 'jonas', date: FRIDAY, hours: { start: '10:00', end: '14:00' } }]);
  assert.equal(first.length, 1);
  assert.deepEqual([first[0].employeeId, first[0].employeeName, first[0].initials, first[0].shifts], ['jonas', 'Jonas Frei', 'J', { [FRIDAY]: { start: '10:00', end: '14:00' } }]);
});

test('a change that cannot be stored is left out: nobody in the team, no real date, an end before the start', () => {
  const start = [plan('mira', {})];
  const wrong: DayChange[] = [
    { employeeId: 'nobody', date: TUESDAY, hours: null },
    { employeeId: 'mira', date: '2026-02-31', hours: null },
    { employeeId: 'mira', date: '', hours: { start: '09:00', end: '17:00' } },
    { employeeId: 'mira', date: TUESDAY, hours: { start: '17:00', end: '09:00' } },
    { employeeId: 'mira', date: TUESDAY, hours: { start: '09:00', end: '09:00' } },
    { employeeId: 'mira', date: TUESDAY, hours: { start: '9:00', end: '25:00' } },
  ];
  assert.equal(withDayChanges(start, [MIRA], wrong), start);
  assert.deepEqual(wrong.map(isValidDayChange), [true, false, false, false, false, false]);
  assert.equal(isValidHours({ start: '09:00', end: '17:00' }), true);
  for (const hours of [null, undefined, { start: '17:00', end: '09:00' }, { start: '09:00', end: '09:00' }, { start: '', end: '17:00' }, { start: '09:60', end: '17:00' }]) assert.equal(isValidHours(hours), false, JSON.stringify(hours));
  // A valid change among them still goes through.
  const mixed = withDayChanges(start, [MIRA], [...wrong, { employeeId: 'mira', date: FRIDAY, hours: null }]);
  assert.deepEqual(mixed, [plan('mira', { [FRIDAY]: null })]);
});

test('when the regular week changes, days that now hold the regular hours leave the plan', () => {
  const stored = [
    plan('mira', { [TUESDAY]: { start: '13:00', end: '19:00' }, [WEDNESDAY]: null, [FRIDAY]: { start: '10:00', end: '12:00' }, [MONDAY]: null }),
    plan('jonas', { [FRIDAY]: { start: '10:00', end: '14:00' } }),
  ];
  // Mira's regular Tuesday becomes 13:00 to 19:00, and Wednesday becomes a day off.
  const changed: Employee = { ...MIRA, weeklyHours: { ...MIRA.weeklyHours!, tue: { start: '13:00', end: '19:00' }, wed: null } };
  const pruned = withoutRegularDays(stored, changed);
  // Tuesday and Wednesday now hold what is regular anyway, and so did Monday (off on a day off): they go.
  assert.deepEqual(pruned[0].shifts, { [FRIDAY]: { start: '10:00', end: '12:00' } });
  // Nobody else's days are touched, and nothing of the argument is changed.
  assert.equal(pruned[1], stored[1]);
  assert.equal(Object.keys(stored[0].shifts).length, 4);
  // What applies on each day is the same before and after: only what is stored got smaller.
  for (const date of [MONDAY, TUESDAY, WEDNESDAY, FRIDAY, SATURDAY]) {
    assert.deepEqual(workingTimeOn({ employees: [changed], shiftOverview: pruned }, 'mira', date), workingTimeOn({ employees: [changed], shiftOverview: stored }, 'mira', date), date);
  }
  // A plan that holds only days that differ comes back as it is.
  assert.equal(withoutRegularDays(pruned, changed)[0], pruned[0]);
  // A person stored before regular weeks existed, with a line for every date: once they get a
  // regular week, only the days that really differ stay.
  const everyDate = [plan('mira', { [MONDAY]: null, [TUESDAY]: { start: '09:00', end: '17:00' }, [WEDNESDAY]: { start: '09:00', end: '17:00' }, '2026-10-08': { start: '12:00', end: '18:00' }, [FRIDAY]: { start: '09:00', end: '13:00' }, [SATURDAY]: null })];
  assert.deepEqual(withoutRegularDays(everyDate, MIRA)[0].shifts, { [FRIDAY]: { start: '09:00', end: '13:00' } });
});

test('a change can be taken back to exactly what was stored before', () => {
  const before = [plan('mira', { [TUESDAY]: { start: '13:00', end: '19:00' } })];
  const changes: DayChange[] = [
    { employeeId: 'mira', date: TUESDAY, hours: null },
    { employeeId: 'mira', date: WEDNESDAY, hours: { start: '10:00', end: '12:00' } },
    { employeeId: 'jonas', date: FRIDAY, hours: { start: '10:00', end: '14:00' } },
  ];
  const undo = undoDayChanges(before, changes);
  assert.deepEqual(undo, [
    { employeeId: 'mira', date: TUESDAY, hours: { start: '13:00', end: '19:00' } },
    { employeeId: 'mira', date: WEDNESDAY, hours: 'regular' },
    { employeeId: 'jonas', date: FRIDAY, hours: 'regular' },
  ]);
  const after = withDayChanges(before, [MIRA, JONAS], changes);
  const restored = withDayChanges(after, [MIRA, JONAS], undo);
  for (const [id, date] of [['mira', TUESDAY], ['mira', WEDNESDAY], ['jonas', FRIDAY]]) {
    assert.deepEqual(workingTimeOn({ employees: [MIRA, JONAS], shiftOverview: restored }, id, date), workingTimeOn({ employees: [MIRA, JONAS], shiftOverview: before }, id, date), `${id} ${date}`);
  }
  assert.deepEqual(restored[0], before[0]);
});

test('what a change did is said in a few plain words, with the day in the Swiss form', () => {
  const said = (hours: DayChange['hours'], date = TUESDAY, employeeId = 'mira') => dayChangesSummary([{ employeeId, date, hours }], [MIRA, JONAS]);
  assert.equal(said({ start: '13:00', end: '19:00' }), 'Mira Probst works 13:00–19:00 on Tuesday, 06.10.2026');
  assert.equal(said(null), 'Mira Probst is off on Tuesday, 06.10.2026');
  assert.equal(said('regular'), 'Mira Probst works the regular hours on Tuesday, 06.10.2026: 09:00–17:00');
  assert.equal(said({ start: '09:00', end: '17:00' }), 'Mira Probst works the regular hours on Tuesday, 06.10.2026: 09:00–17:00');
  assert.equal(said('regular', MONDAY), 'Mira Probst has the regular day off on Monday, 05.10.2026');
  assert.equal(said({ start: '10:00', end: '14:00' }, FRIDAY, 'jonas'), 'Jonas Frei works 10:00–14:00 on Friday, 09.10.2026');
  assert.equal(dayChangesSummary([
    { employeeId: 'mira', date: TUESDAY, hours: null }, { employeeId: 'mira', date: WEDNESDAY, hours: null }, { employeeId: 'jonas', date: FRIDAY, hours: null },
  ], [MIRA, JONAS]), '3 days changed for 2 people');
  assert.equal(dayChangesSummary([{ employeeId: 'mira', date: TUESDAY, hours: null }, { employeeId: 'mira', date: WEDNESDAY, hours: null }], [MIRA]), '2 days changed for 1 person');
});

// ---------- the hours of a week ----------

test('the hours of a week are summed from what applies on each day', () => {
  const none = { employees: initialEmployees, shiftOverview: [] };
  // The sample stylists' regular week: Anna 40 h, Selina 33.5 h, Luca 24 h.
  assert.deepEqual(initialEmployees.map((employee) => formatHoursTotal(minutesInWeek(none, employee.id, MONDAY))), ['40 h', '33.5 h', '24 h']);
  // Mira: 8 + 8 + 6 + 6 hours.
  assert.equal(minutesInWeek(salon(), 'mira', MONDAY), 28 * 60);
  // Other hours, a day off and an extra day change the sum of that week only.
  const changed = salon([plan('mira', { [TUESDAY]: { start: '13:00', end: '19:00' }, [WEDNESDAY]: null, [SATURDAY]: { start: '08:00', end: '12:30' } })]);
  assert.equal(minutesInWeek(changed, 'mira', MONDAY), (6 + 0 + 6 + 6 + 4.5) * 60);
  assert.equal(formatHoursTotal(minutesInWeek(changed, 'mira', MONDAY)), '22.5 h');
  assert.equal(minutesInWeek(changed, 'mira', '2026-10-12'), 28 * 60);
  // Days somebody is away are left out by the caller.
  assert.equal(minutesInWeek(salon(), 'mira', MONDAY, (date) => date === TUESDAY || date === WEDNESDAY), 12 * 60);
  // Nobody, no hours, and hours entered the wrong way round count as nothing.
  assert.equal(minutesInWeek(salon(), 'jonas', MONDAY), 0);
  assert.equal(minutesInWeek(salon([plan('mira', { [TUESDAY]: { start: '18:00', end: '09:00' } })]), 'mira', MONDAY), 20 * 60);
  assert.equal(formatHoursTotal(0), '0 h');
  assert.equal(formatHoursTotal(15), '0.3 h');
});

test('a new person starts with the opening hours as working hours, copied onto the person', () => {
  const fromBella = weeklyHoursFromOpeningHours(initialBookingHours);
  assert.deepEqual(fromBella, week({
    tue: { start: '08:30', end: '18:30' }, wed: { start: '08:30', end: '18:30' }, thu: { start: '08:30', end: '18:30' },
    fri: { start: '08:30', end: '18:30' }, sat: { start: '08:00', end: '16:00' },
  }));
  // A closed day, a day that is missing and a day with times that cannot be worked are days off.
  assert.deepEqual(weeklyHoursFromOpeningHours([
    { day: 'Monday', isOpen: true, from: '09:00', to: '12:00' }, { day: 'Tuesday', isOpen: false, from: '09:00', to: '18:00' },
    { day: 'Wednesday', isOpen: true, from: '18:00', to: '09:00' },
  ]), week({ mon: { start: '09:00', end: '12:00' } }));
  assert.deepEqual(weeklyHoursFromOpeningHours([]), week({}));
  // The hours are the person's own from then on: changing the opening hours later moves nobody.
  const opening = initialBookingHours.map((day) => ({ ...day }));
  const copied = weeklyHoursFromOpeningHours(opening);
  opening.find((day) => day.day === 'Tuesday')!.from = '11:00';
  assert.equal(copied.tue!.start, '08:30');
});

test('working hours are checked before they are saved: every working day ends after it starts', () => {
  assert.equal(validateWeeklyHours(MIRA.weeklyHours), null);
  assert.equal(validateWeeklyHours(week({})), null);
  assert.equal(validateWeeklyHours(undefined), null);
  assert.equal(validateWeeklyHours(week({ tue: { start: '09:00', end: '17:00' }, thu: { start: '18:00', end: '12:00' } })), 'Thursday: working hours must end after they start, on the same day.');
  assert.equal(validateWeeklyHours(week({ mon: { start: '09:00', end: '09:00' }, thu: { start: '18:00', end: '12:00' } })), 'Monday: working hours must end after they start, on the same day.');
  assert.equal(validateWeeklyHours(week({ sun: { start: '', end: '12:00' } })), 'Sunday: working hours must end after they start, on the same day.');
  assert.equal(validateDayHours({ start: '09:00', end: '17:00' }), null);
  assert.equal(validateDayHours({ start: '17:00', end: '09:00' }), 'Working hours must end after they start, on the same day.');
});

test('times are chosen from 24-hour lists in half-hour steps; a time saved off the half hour stays offered', () => {
  const list = timeChoices('09:00');
  assert.equal(list.length, 48);
  assert.deepEqual([list[0], list[1], list.at(-1)], ['00:00', '00:30', '23:30']);
  assert.deepEqual(timeChoices('09:07').slice(18, 21), ['09:00', '09:07', '09:30']);
  assert.equal(timeChoices('').length, 48);
  assert.equal(timeChoices('nonsense').length, 48);
});

// ---------- copying a week ----------

test('"Copy last week" copies the days that were changed, seven days on, and leaves every other day alone', () => {
  const lastWeek = salon([
    plan('mira', { '2026-09-29': null, '2026-10-03': { start: '08:00', end: '12:00' } }), // Tuesday off, an extra Saturday
    plan('jonas', { '2026-10-02': { start: '10:00', end: '14:00' } }),                     // a Friday
  ]);
  const copy = copyOfWeekBefore(lastWeek, MONDAY);
  assert.deepEqual(copy.from, { start: '2026-09-28', end: '2026-10-04' });
  assert.equal(weekCopySource(copy), '28.09.–04.10.2026');
  assert.deepEqual(copy.changes, [
    { employeeId: 'mira', date: TUESDAY, hours: null },
    { employeeId: 'mira', date: SATURDAY, hours: { start: '08:00', end: '12:00' } },
    { employeeId: 'jonas', date: FRIDAY, hours: { start: '10:00', end: '14:00' } },
  ]);
  assert.deepEqual(copy.overwrites, []);
  // Applied, this week holds the same changed days and nothing else; last week keeps its own.
  const after = { employees: [MIRA, JONAS], shiftOverview: withDayChanges(lastWeek.shiftOverview, [MIRA, JONAS], copy.changes) };
  assert.equal(workingTimeOn(after, 'mira', TUESDAY), null);
  assert.deepEqual(workingTimeOn(after, 'mira', SATURDAY), { start: '08:00', end: '12:00' });
  assert.deepEqual(workingTimeOn(after, 'mira', WEDNESDAY), { start: '09:00', end: '17:00' });
  assert.equal(workingTimeOn(after, 'mira', '2026-09-29'), null);
  // A second copy finds nothing left to change.
  assert.deepEqual(copyOfWeekBefore(after, MONDAY).changes, []);
  // A week before which nothing was changed has nothing to copy.
  assert.deepEqual(copyOfWeekBefore(salon(), MONDAY).changes, []);
  assert.deepEqual(copyOfWeekBefore(lastWeek, '2026-10-19').changes, []);
});

test('a copy names the days it would overwrite, so the owner is asked first', () => {
  const both = salon([plan('mira', {
    '2026-09-29': null,                                   // last Tuesday: off
    '2026-09-30': { start: '10:00', end: '12:00' },       // last Wednesday: other hours
    '2026-10-02': null,                                   // last Friday: off
    [TUESDAY]: { start: '13:00', end: '19:00' },          // this Tuesday is changed already, to something else
    [WEDNESDAY]: { start: '10:00', end: '12:00' },        // this Wednesday already holds the same
    [SATURDAY]: { start: '08:00', end: '12:00' },         // this Saturday is changed, last Saturday was regular: not touched
  })]);
  const copy = copyOfWeekBefore(both, MONDAY);
  assert.deepEqual(copy.changes, [
    { employeeId: 'mira', date: TUESDAY, hours: null },
    { employeeId: 'mira', date: FRIDAY, hours: null },
  ]);
  // Only Tuesday is overwritten: the question shows what it holds now.
  assert.deepEqual(copy.overwrites, [{ employeeId: 'mira', date: TUESDAY, hours: { start: '13:00', end: '19:00' } }]);
  const after = { employees: [MIRA, JONAS], shiftOverview: withDayChanges(both.shiftOverview, [MIRA, JONAS], copy.changes) };
  assert.equal(workingTimeOn(after, 'mira', TUESDAY), null);
  assert.deepEqual(workingTimeOn(after, 'mira', SATURDAY), { start: '08:00', end: '12:00' });
  // The copy is made for the people it is asked for: somebody who is left out keeps their week.
  const onlyJonas = copyOfWeekBefore({ employees: [JONAS], shiftOverview: both.shiftOverview }, MONDAY);
  assert.deepEqual(onlyJonas.changes, []);
});

test('a new regular week says which upcoming bookings it leaves outside the hours, and only those', () => {
  const booked = (date: string, startTime: string, endTime: string) => ({ date, startTime, endTime });
  const bookings = [
    booked('2026-10-13', '10:00', '11:00'), // a Tuesday inside Mira's hours
    booked('2026-10-06', '16:00', '17:00'), // this Tuesday, late
    booked('2026-10-07', '10:00', '10:30'), // a Wednesday
    booked('2026-09-29', '10:00', '11:00'), // a Tuesday in the past
    booked('2026-10-10', '10:00', '10:30'), // a Saturday: outside her hours already
  ];
  // Tuesdays off: both coming Tuesdays are left outside, the next one first. The past one and the
  // Saturday that was outside before are not the change's doing.
  const noTuesday = week({ ...MIRA.weeklyHours, tue: null });
  assert.deepEqual(bookingsLeftOutside(salon(), MIRA.id, noTuesday, bookings, MONDAY).map((item) => item.date), ['2026-10-06', '2026-10-13']);
  // Tuesdays end at 16:00: only the late appointment is cut off.
  const shortTuesday = week({ ...MIRA.weeklyHours, tue: { start: '09:00', end: '16:00' } });
  assert.deepEqual(bookingsLeftOutside(salon(), MIRA.id, shortTuesday, bookings, MONDAY).map((item) => item.date), ['2026-10-06']);
  // A day entered for one date still decides for that date: Tuesday 6 October was entered by hand, so the regular week does not touch it.
  const entered = salon([plan(MIRA.id, { [TUESDAY]: { start: '09:00', end: '17:00' } })]);
  assert.deepEqual(bookingsLeftOutside(entered, MIRA.id, noTuesday, bookings, MONDAY).map((item) => item.date), ['2026-10-13']);
  // The same week again changes nothing.
  assert.deepEqual(bookingsLeftOutside(salon(), MIRA.id, MIRA.weeklyHours!, bookings, MONDAY), []);
});
