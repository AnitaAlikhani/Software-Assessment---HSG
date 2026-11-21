import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { getAvailableSlots, validateCalendarEvent, type AvailabilityContext } from '../src/availability';
import { freeSlots, type Span } from '../src/calendarLayout';
import { initialServices } from '../src/mockData';
import { planChatBooking, requestRefusal } from '../src/requestAnswers';
import { STANDALONE_PARTS, storedShapeProblem } from '../src/storedShapes';
import { blockAt, blockReasonText, timeBlockProblem } from '../src/timeBlocks';
import type { AppointmentRequest, TimeBlock } from '../src/types';
import { CalendarView } from '../src/views/CalendarView';
import { ANNA, FRI, HOURS, LUCA, SAT, SELINA, SHIFTS, SUN, TEAM, THU, WED, appointment, moment } from './calendarFixture';
import { render } from './renderHelpers';

// Time the owner keeps free for a stylist: the rule that counts it, the checks for making one,
// the words for it on Home, how it is stored, and how the calendar draws it.
//
// The salon is the small one of tests/calendarFixture.ts. It is Thursday 8 October 2026, 13:10;
// on Friday Selina Keller works 08:30–17:00 and has lunch blocked 12:00–13:00.

const NOW = moment(THU, '13:10');
const LUNCH: TimeBlock = { id: 'block-lunch', employeeId: SELINA.id, date: FRI, startTime: '12:00', endTime: '13:00', reason: 'Lunch' };

const salon = (partial: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  services: initialServices, employees: TEAM, bookingHours: HOURS, shiftOverview: SHIFTS, events: [], requests: [],
  timeBlocks: [LUNCH], timeZone: 'Europe/Zurich', now: NOW, ...partial,
});
const haircut = (employeeId: string, date = FRI, mode?: 'owner') => getAvailableSlots(salon(), { date, serviceId: 'srv-2', employeeId, mode });

// ---------- the rule ----------

test('the booking page offers no time inside a block, and the times right before and after it', () => {
  const slots = haircut(SELINA.id);
  assert.ok(!slots.includes('12:00') && !slots.includes('12:30'), slots.join(' '));
  // 11:30–12:00 ends as the block starts; 13:00 starts as it ends: a block has no time to prepare around it.
  assert.ok(slots.includes('11:30') && slots.includes('13:00'), slots.join(' '));
  // An hour-long cut from 11:30 would run into it.
  assert.ok(!getAvailableSlots(salon(), { date: FRI, serviceId: 'srv-4', employeeId: SELINA.id }).includes('11:30'));
  // The owner's own rules count it too.
  assert.ok(!haircut(SELINA.id, FRI, 'owner').includes('12:30'));
  // Without the block the times are free: it is the block that takes them.
  assert.ok(getAvailableSlots(salon({ timeBlocks: [] }), { date: FRI, serviceId: 'srv-2', employeeId: SELINA.id }).includes('12:00'));
});

test('a block keeps nobody else and no other day', () => {
  assert.ok(haircut(ANNA.id).includes('12:00'));
  assert.ok(haircut(LUCA.id).includes('12:30'));
  assert.ok(haircut(SELINA.id, SAT).includes('12:00'));
});

test('an appointment cannot be written into a block, also not by the owner', () => {
  const into = appointment('new', SELINA, FRI, '12:30', '13:00', { customerName: 'Mara Steiner' });
  const { id: _id, ...event } = into;
  assert.match(validateCalendarEvent(salon(), event) ?? '', /not available/);
  const before = { ...event, startTime: '11:30', endTime: '12:00' };
  assert.equal(validateCalendarEvent(salon(), before), null);
});

test('Home names the block when a request cannot be accepted', () => {
  const request: AppointmentRequest = {
    id: 'req-lunch', serviceId: 'srv-2', serviceName: 'Haircut', employeeId: SELINA.id, staffName: SELINA.name, customerName: 'Mara Steiner',
    date: FRI, dateStr: '', timeStr: '12:00 - 12:30', timeAgo: '', status: 'pending',
  };
  const refusal = requestRefusal(salon({ requests: [request] }), request) ?? '';
  assert.match(refusal, /^Selina Keller is not available 12:00–13:00 on Fri, 09\.10\.2026 \(lunch\)\./);
  // An "Other" block says its note instead of a reason.
  const course = { ...LUNCH, reason: 'Other' as const, note: 'Course' };
  assert.match(requestRefusal(salon({ requests: [request], timeBlocks: [course] }), request) ?? '', /\(Course\)\./);
  assert.equal(requestRefusal(salon({ requests: [request], timeBlocks: [] }), request), null);
});

test('a chat booking cannot be confirmed into a block', () => {
  const chat = { id: 'conv-1', bookingRequest: { service: 'Haircut', serviceId: 'srv-2', date: FRI, time: '12:00', customerName: 'Mara Steiner', status: 'requested' as const } };
  // Selina is blocked, so somebody who is free takes it.
  assert.notEqual(planChatBooking(salon(), chat)?.employee?.id, SELINA.id);
  const everybody = TEAM.map((employee) => ({ ...LUNCH, id: `b-${employee.id}`, employeeId: employee.id }));
  const plan = planChatBooking(salon({ timeBlocks: everybody }), chat);
  assert.equal(plan?.action, null);
  assert.match(plan?.refusal ?? '', /Nobody who offers Haircut is free/);
});

test('blockAt finds the block that lies over a time, and only that one', () => {
  assert.equal(blockAt([LUNCH], SELINA.id, FRI, '12:45', '13:15')?.id, 'block-lunch');
  assert.equal(blockAt([LUNCH], SELINA.id, FRI, '13:00', '13:30'), undefined);
  assert.equal(blockAt([LUNCH], ANNA.id, FRI, '12:00', '12:30'), undefined);
  assert.equal(blockReasonText({ reason: 'Other' }), '');
});

// ---------- making a block ----------

test('a block needs a stylist, a later end on the quarter hour, and a date from today on', () => {
  const draft = { employeeId: SELINA.id, date: FRI, startTime: '12:00', endTime: '13:00', reason: 'Lunch' as const };
  const plain = salon({ timeBlocks: [] });
  assert.equal(timeBlockProblem(plain, draft), null);
  assert.equal(timeBlockProblem(plain, { ...draft, employeeId: 'emp-x' }), 'Choose a stylist.');
  assert.equal(timeBlockProblem(plain, { ...draft, endTime: '12:00' }), 'The end must be after the start.');
  assert.equal(timeBlockProblem(plain, { ...draft, endTime: '11:00' }), 'The end must be after the start.');
  assert.match(timeBlockProblem(plain, { ...draft, startTime: '12:10' }) ?? '', /quarter hour/);
  assert.equal(timeBlockProblem(plain, { ...draft, startTime: '12:15', endTime: '12:45' }), null);
  // Yesterday: not for a new block. A block that is changed may keep the day it has.
  assert.equal(timeBlockProblem(plain, { ...draft, date: WED }), 'Choose today or a later date.');
  assert.equal(timeBlockProblem(plain, { ...draft, date: WED, note: 'Kept' }, { ...LUNCH, date: WED }), null);
  // Today is fine, and so is a day the stylist does not work (it keeps nothing free there, but harms nothing).
  assert.equal(timeBlockProblem(plain, { ...draft, date: THU }), null);
  assert.equal(timeBlockProblem(plain, { ...draft, date: SUN }), null);
  assert.match(timeBlockProblem(plain, { ...draft, note: 'x'.repeat(81) }) ?? '', /80 characters/);
});

test('a block does not cover an appointment or a waiting request, and says which one is in the way', () => {
  const draft = { employeeId: SELINA.id, date: FRI, startTime: '12:00', endTime: '13:00', reason: 'Lunch' as const };
  const booked = appointment('cal-1', SELINA, FRI, '12:30', '13:00', { customerName: 'Jasmin Stucki' });
  assert.equal(timeBlockProblem(salon({ timeBlocks: [], events: [booked] }), draft),
    'Selina Keller has an appointment with Jasmin Stucki at 12:30–13:00 on Fri, 09.10.2026. Choose another time, or move the appointment first.');
  // Right after an appointment is fine; inside its time to clear up is not.
  const before = appointment('cal-2', SELINA, FRI, '11:30', '12:00', { customerName: 'Roger Manser', prepMinutes: 0, postMinutes: 0 });
  assert.equal(timeBlockProblem(salon({ timeBlocks: [], events: [before] }), draft), null);
  assert.match(timeBlockProblem(salon({ timeBlocks: [], events: [{ ...before, postMinutes: 15 }] }), draft) ?? '', /Roger Manser .*prepare and clear up/);
  // Somebody else's appointment is not in the way.
  assert.equal(timeBlockProblem(salon({ timeBlocks: [], events: [appointment('cal-3', ANNA, FRI, '12:00', '13:00')] }), draft), null);
  const asked: AppointmentRequest = {
    id: 'req-1', serviceId: 'srv-2', serviceName: 'Haircut', employeeId: SELINA.id, staffName: SELINA.name, customerName: 'Mara Steiner',
    date: FRI, dateStr: '', timeStr: '12:00 - 12:30', timeAgo: '', status: 'pending',
  };
  assert.match(timeBlockProblem(salon({ timeBlocks: [], requests: [asked] }), draft) ?? '', /^Mara Steiner has asked for Selina Keller at 12:00–12:30 on Fri, 09\.10\.2026\./);
  assert.equal(timeBlockProblem(salon({ timeBlocks: [], requests: [{ ...asked, status: 'rejected' }] }), draft), null);
  // Another block of the same stylist; the block itself when it is changed is not.
  assert.match(timeBlockProblem(salon(), { ...draft, startTime: '12:30', endTime: '13:30' }) ?? '', /already has 12:00–13:00 blocked .*\(lunch\)/);
  assert.equal(timeBlockProblem(salon(), { ...draft, startTime: '12:30', endTime: '13:30' }, LUNCH), null);
});

// ---------- stored ----------

test('stored blocks are checked for their shape and belong to the linked parts', () => {
  assert.equal(storedShapeProblem('timeBlocks', [LUNCH, { ...LUNCH, id: 'b-2', reason: 'Other', note: 'Course' }]), null);
  assert.equal(storedShapeProblem('timeBlocks', JSON.parse(JSON.stringify([{ ...LUNCH, note: undefined }]))), null);
  assert.equal(storedShapeProblem('timeBlocks', [{ ...LUNCH, reason: 'Holiday' }]), 'timeBlocks[0].reason is none of Break, Lunch, Private, Other');
  assert.equal(storedShapeProblem('timeBlocks', [{ ...LUNCH, startTime: '12' }]), 'timeBlocks[0].startTime is not a time');
  assert.equal(storedShapeProblem('timeBlocks', [{ ...LUNCH, date: 'Friday' }]), 'timeBlocks[0].date is not a date');
  assert.equal(storedShapeProblem('timeBlocks', [{ ...LUNCH, employeeId: undefined }]), 'timeBlocks[0].employeeId is not a text');
  assert.equal(storedShapeProblem('timeBlocks', {}), 'timeBlocks is not a list');
  // A block names a stylist: it stands or falls with the team.
  assert.equal(STANDALONE_PARTS.has('timeBlocks'), false);
});

// ---------- the calendar ----------

test('the grid offers no half hour that touches a block', () => {
  const clock = { date: THU, time: '13:10' };
  const open: Span = { start: 10 * 60, end: 14 * 60 };
  assert.deepEqual(freeSlots(open, FRI, clock, [{ start: 12 * 60, end: 13 * 60 }]).map(String), ['600', '630', '660', '690', '780', '810']);
  assert.deepEqual(freeSlots(open, FRI, clock, [{ start: 12 * 60 + 15, end: 12 * 60 + 30 }]).length, 7);
});

type Props = React.ComponentProps<typeof CalendarView>;
const nothing = () => {};
const calendar = (partial: Partial<Props> = {}): string => render(React.createElement(CalendarView, {
  events: [appointment('cal-fri-a', ANNA, FRI, '11:00', '12:00', { customerName: 'Roger Manser' })],
  services: initialServices, employees: TEAM, bookingHours: HOURS, shiftOverview: SHIFTS, requests: [],
  timeBlocks: [LUNCH], onSaveTimeBlock: () => null, onRemoveTimeBlock: nothing,
  timeZone: 'Europe/Zurich', date: FRI, now: NOW, selectedEventId: null, phone: false,
  onSelectEvent: nothing, onDateChange: nothing, onOpenAppointmentForm: () => {}, onDeleteEvent: nothing, ...partial,
}));
const columnsOf = (html: string): Map<string, string> => {
  const grid = html.slice(html.indexOf('data-calendar-grid='));
  return new Map(grid.split('data-column="').slice(1).map((part) => [part.slice(0, part.indexOf('"')), part.split('data-scroll-anchor')[0]]));
};
const slotsIn = (column: string) => Array.from(column.matchAll(/data-slot="([^"]+)"/g), (match) => match[1]);
const placeOfBlock = (html: string, id: string) => {
  const style = new RegExp(`data-block="${id}"[^>]*style="([^"]*)"`).exec(html)?.[1] ?? '';
  return {
    top: Number(/top:calc\(calc\(var\(--cal-hour\) \* ([\d.]+)\) \+ 1px\)/.exec(style)?.[1]),
    height: Number(/height:calc\(calc\(var\(--cal-hour\) \* ([\d.]+)\) - 2px\)/.exec(style)?.[1]),
    striped: style.includes('repeating-linear-gradient'),
  };
};

test('the day view draws a block to scale in the stylist’s column, and takes no click for an appointment there', () => {
  const html = calendar({ view: 'day' });
  const columns = columnsOf(html);
  const selina = columns.get(SELINA.id) ?? '';
  assert.ok(selina.includes('data-block="block-lunch"'));
  assert.ok(!(columns.get(ANNA.id) ?? '').includes('data-block='));
  // The grid starts at 08:00: four hours down, one hour tall, striped.
  assert.deepEqual(placeOfBlock(html, 'block-lunch'), { top: 4, height: 1, striped: true });
  assert.match(html, /aria-label="Change blocked time: Lunch, Selina Keller, Friday, 09\.10\.2026, 12:00–13:00"/);
  const selinaSlots = slotsIn(selina);
  assert.ok(!selinaSlots.includes('12:00') && !selinaSlots.includes('12:30'));
  assert.ok(selinaSlots.includes('11:30') && selinaSlots.includes('13:00'));
  assert.ok(slotsIn(columns.get(ANNA.id) ?? '').includes('12:30'));
  // The action beside "Add".
  assert.match(html, />Block time<\/span>/);
});

test('the week view draws the block in Friday’s column; with Selina chosen her blocked half hours take no click', () => {
  const html = calendar({ view: 'week' });
  const columns = columnsOf(html);
  assert.ok((columns.get(FRI) ?? '').includes('data-block="block-lunch"'));
  assert.ok(!(columns.get(THU) ?? '').includes('data-block='));
  assert.deepEqual(placeOfBlock(html, 'block-lunch'), { top: 4, height: 1, striped: true });
  // For everybody a place in the week belongs to nobody: Anna can still be booked at 12:00.
  assert.ok(slotsIn(columns.get(FRI) ?? '').includes('12:00'));
  const selinaOnly = columnsOf(calendar({ view: 'week', staffFilter: SELINA.id }));
  assert.ok(!slotsIn(selinaOnly.get(FRI) ?? '').includes('12:00'));
  // Another stylist chosen: Selina's block is not in view.
  assert.ok(!calendar({ view: 'week', staffFilter: ANNA.id }).includes('data-block='));
  // The week on a phone draws it as a striped bar.
  assert.match(calendar({ view: 'week', phone: true }), /data-bar-block="block-lunch"/);
});

test('the list shows a block as a muted line between the appointments', () => {
  const html = calendar({ view: 'list' });
  assert.match(html, /data-event="cal-fri-a"[\s\S]*data-block="block-lunch"/);
  assert.match(html, /data-block="block-lunch"[^>]*>[\s\S]*?12:00–13:00[\s\S]*?Lunch[\s\S]*?Blocked/);
});

test('without a way to keep blocks the calendar offers no "Block time"', () => {
  assert.doesNotMatch(calendar({ view: 'day', onSaveTimeBlock: undefined }), />Block time</);
});
