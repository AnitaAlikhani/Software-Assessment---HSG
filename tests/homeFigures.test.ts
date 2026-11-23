import assert from 'node:assert/strict';
import test from 'node:test';
import { appointmentAnalytics } from '../src/analytics';
import { aiSummary, bookedShare, bookedValue, changeInCount, changeInPercent, chatSummary, homeFigures, monthPace, wasClosedAt, weekDates } from '../src/dashboard';
import { smsLink, whatsAppLink } from '../src/format';
import { HOME_VISIT_KEY, isNewSince, lastHomeVisit, noteHomeVisit } from '../src/homeVisit';
import { inboxCounts, inboxItems, waitedMinutes, waitingLabel, waitingLevel, waitingWords, WAITING_LIMITS } from '../src/inbox';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import type { CalendarEvent, Employee, ShiftEntry } from '../src/types';
import { demoConversations, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';

// What Home says about money, about how full the day is and about the AI receptionist. Every
// figure is counted from the calendar, the price list and the working hours; these tests count
// the same by hand. The moment is fixed (Monday 5 October 2026, 12:00 in Zurich).

const ZONE = 'Europe/Zurich';
// Haircut CHF 55 (30 minutes), Wash & blow-dry CHF 45, Colouring CHF 120.
const HAIRCUT = 'srv-2';
const WASH = 'srv-1';
const COLOURING = 'srv-3';

/** An appointment with Anna Weber, for a customer of its own. */
const appointment = (id: string, date: string, startTime: string, endTime: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  ...demoEvents[0], id, customerId: `customer-${id}`, customerName: `Customer ${id}`, conversationId: undefined, createdAt: undefined,
  serviceId: HAIRCUT, serviceName: 'Haircut', employeeId: 'emp-1', staffName: 'Anna Weber', date, startTime, endTime, isAiBooked: false, ...extra,
});

// ---------- what the appointments are worth ----------

test('the booked value is the list price of every appointment, added up', () => {
  const three = [
    appointment('a', '2026-10-06', '09:00', '09:30'),
    appointment('b', '2026-10-06', '10:00', '10:30', { serviceId: WASH, serviceName: 'Wash & blow-dry' }),
    appointment('c', '2026-10-06', '11:00', '12:30', { serviceId: COLOURING, serviceName: 'Colouring' }),
  ];
  assert.deepEqual(bookedValue(three, initialServices), { value: 220, unpriced: 0 });
  assert.deepEqual(bookedValue([], initialServices), { value: 0, unpriced: 0 });
  // The id decides, also after the service was renamed; an older appointment without an id is found by its name.
  assert.equal(bookedValue([appointment('renamed', '2026-10-06', '09:00', '09:30', { serviceName: 'Cut (old name)' })], initialServices).value, 55);
  assert.equal(bookedValue([appointment('old', '2026-10-06', '09:00', '09:30', { serviceId: undefined, serviceName: 'Colouring' })], initialServices).value, 120);
  // A service that is no longer in the list has no price: it is left out and counted apart, never guessed.
  assert.deepEqual(bookedValue([...three, appointment('gone', '2026-10-06', '13:00', '13:30', { serviceId: 'srv-deleted' })], initialServices), { value: 220, unpriced: 1 });
  assert.deepEqual(bookedValue([appointment('unknown', '2026-10-06', '13:00', '13:30', { serviceId: undefined, serviceName: 'Something else' })], initialServices), { value: 0, unpriced: 1 });
  // Prices with cents add up exactly.
  const cents = [{ id: 'x', name: 'X', priceCHF: 89.1 }, { id: 'y', name: 'Y', priceCHF: 0.2 }];
  assert.equal(bookedValue([appointment('x', '2026-10-06', '09:00', '09:30', { serviceId: 'x' }), appointment('y', '2026-10-06', '10:00', '10:30', { serviceId: 'y' })], cents).value, 89.3);
  // Every appointment of the seeded salon has a price.
  assert.equal(bookedValue(demoEvents, initialServices).unpriced, 0);
});

// ---------- how the month is going ----------

// September and October around the fixed moment. By Monday 5 October, 12:00, two October
// appointments have started (CHF 55 + CHF 45); two are still to come (CHF 120 + CHF 55). By
// 5 September, 12:00, two September appointments had started (CHF 55 + CHF 45).
const TWO_MONTHS: CalendarEvent[] = [
  appointment('sep-1', '2026-09-01', '09:00', '09:30'),
  appointment('sep-5-before', '2026-09-05', '11:30', '12:00', { serviceId: WASH, serviceName: 'Wash & blow-dry' }),
  appointment('sep-5-noon', '2026-09-05', '12:00', '13:30', { serviceId: COLOURING, serviceName: 'Colouring' }),
  appointment('sep-20', '2026-09-20', '10:00', '10:30'),
  appointment('oct-1', '2026-10-01', '09:00', '09:30'),
  appointment('oct-5-morning', '2026-10-05', '09:00', '09:30', { serviceId: WASH, serviceName: 'Wash & blow-dry' }),
  appointment('oct-5-noon', '2026-10-05', '12:00', '13:30', { serviceId: COLOURING, serviceName: 'Colouring' }),
  appointment('oct-10', '2026-10-10', '11:00', '11:30'),
  appointment('nov-1', '2026-11-01', '09:00', '09:30'),
];

test('the month so far is compared with the month before at the same point', () => {
  assert.deepEqual(monthPace(TWO_MONTHS, initialServices, FIXED_NOW, ZONE), {
    month: { from: '2026-10-01', to: '2026-10-31' },
    appointments: 4,
    soFar: { appointments: 2, value: 100 },
    stillToCome: { appointments: 2, value: 175 },
    before: { month: { from: '2026-09-01', to: '2026-09-30' }, until: { date: '2026-09-05', time: '12:00' }, appointments: 2, value: 100 },
    unpriced: 0,
  });
  // One minute later the appointment that began at 12:00 has started, in both months.
  const later = monthPace(TWO_MONTHS, initialServices, new Date(FIXED_NOW.getTime() + 60_000), ZONE);
  assert.deepEqual([later.soFar, later.stillToCome], [{ appointments: 3, value: 220 }, { appointments: 1, value: 55 }]);
  assert.deepEqual({ appointments: later.before?.appointments, value: later.before?.value }, { appointments: 3, value: 220 });
});

test('a salon in its first month is compared with nothing', () => {
  const october = TWO_MONTHS.filter((event) => event.date >= '2026-10-01');
  assert.equal(monthPace(october, initialServices, FIXED_NOW, ZONE).before, null);
  assert.deepEqual(monthPace([], initialServices, FIXED_NOW, ZONE), {
    month: { from: '2026-10-01', to: '2026-10-31' }, appointments: 0,
    soFar: { appointments: 0, value: 0 }, stillToCome: { appointments: 0, value: 0 }, before: null, unpriced: 0,
  });
  // The month before had appointments, but none by this point: the comparison stands, with nothing in it.
  const lateSeptember = TWO_MONTHS.filter((event) => event.date >= '2026-09-20');
  assert.deepEqual(monthPace(lateSeptember, initialServices, FIXED_NOW, ZONE).before, {
    month: { from: '2026-09-01', to: '2026-09-30' }, until: { date: '2026-09-05', time: '12:00' }, appointments: 0, value: 0,
  });
});

test('the same point of the month before follows the calendar: shorter months and the turn of the year', () => {
  // 31 October, 12:00: September has no 31st, so its last day stands in.
  const endOfOctober = monthPace(TWO_MONTHS, initialServices, new Date('2026-10-31T11:00:00Z'), ZONE);
  assert.deepEqual(endOfOctober.before?.until, { date: '2026-09-30', time: '12:00' });
  assert.equal(endOfOctober.before?.appointments, 4);
  // 10 January 2027: the month before is December 2026.
  const january = monthPace([appointment('dec', '2026-12-09', '09:00', '09:30'), appointment('jan', '2027-01-08', '09:00', '09:30')], initialServices, new Date('2027-01-10T11:00:00Z'), ZONE);
  assert.deepEqual(january.month, { from: '2027-01-01', to: '2027-01-31' });
  assert.deepEqual(january.before, { month: { from: '2026-12-01', to: '2026-12-31' }, until: { date: '2026-12-10', time: '12:00' }, appointments: 1, value: 55 });
  // 23:30 UTC on 31 October is 00:30 on 1 November in Zurich: the month is November, compared with October.
  const afterMidnight = monthPace(TWO_MONTHS, initialServices, new Date('2026-10-31T23:30:00Z'), ZONE);
  assert.deepEqual(afterMidnight.month, { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(afterMidnight.before?.until, { date: '2026-10-01', time: '00:30' });
});

test('"so far" and "still to come" split the month exactly as Analytics does', () => {
  for (const [events, now] of [[demoEvents, FIXED_NOW], [TWO_MONTHS, FIXED_NOW], [demoEvents, new Date('2026-10-20T15:17:00Z')]] as const) {
    const pace = monthPace(events, initialServices, now, ZONE);
    const figures = homeFigures(events, now, ZONE);
    assert.equal(pace.appointments, figures.appointments);
    assert.equal(pace.stillToCome.appointments, figures.stillToCome);
    assert.equal(pace.soFar.appointments, figures.appointments - figures.stillToCome);
    // The two parts are worth what the whole month is worth.
    const month = events.filter((event) => event.date >= pace.month.from && event.date <= pace.month.to);
    assert.equal(Math.round((pace.soFar.value + pace.stillToCome.value) * 100), Math.round(bookedValue(month, initialServices).value * 100));
  }
  // An appointment whose service has gone from the list is counted, and named as one without a price.
  const withGone = [...TWO_MONTHS, appointment('gone', '2026-10-02', '09:00', '09:30', { serviceId: 'srv-deleted' })];
  const pace = monthPace(withGone, initialServices, FIXED_NOW, ZONE);
  assert.deepEqual([pace.soFar, pace.unpriced], [{ appointments: 3, value: 100 }, 1]);
});

test('a change is written short, with its sign, and never as a percentage of nothing', () => {
  assert.deepEqual(changeInPercent(8126, 7822), { direction: 'up', difference: 4, label: '+4%' });
  assert.deepEqual(changeInPercent(1660, 2600), { direction: 'down', difference: -36, label: '−36%' });
  assert.deepEqual(changeInPercent(500, 500), { direction: 'same', difference: 0, label: '±0%' });
  // Less than half a per cent either way is no change, and is not written as "−0%".
  assert.deepEqual(changeInPercent(999, 1000), { direction: 'same', difference: 0, label: '±0%' });
  assert.deepEqual(changeInPercent(1001, 1000), { direction: 'same', difference: 0, label: '±0%' });
  assert.deepEqual(changeInPercent(0, 400), { direction: 'down', difference: -100, label: '−100%' });
  // Nothing before: a rise from nothing has no percentage.
  assert.equal(changeInPercent(300, 0), null);
  assert.equal(changeInPercent(0, 0), null);
  // Small numbers are compared as numbers of things. The minus is a real minus sign.
  assert.deepEqual(changeInCount(107, 111), { direction: 'down', difference: -4, label: '−4' });
  assert.deepEqual(changeInCount(3, 0), { direction: 'up', difference: 3, label: '+3' });
  assert.deepEqual(changeInCount(5, 5), { direction: 'same', difference: 0, label: '±0' });
});

// ---------- how full the day is ----------

// Tuesday 6 October 2026. Anna Weber works 08:30–17:00 and Luca Frei 10:00–18:30 (510 minutes
// each); Selina Keller does not work on Tuesdays. The salon is open 08:30–18:30.
const TUESDAY = '2026-10-06';
const salon = (partial: Partial<Parameters<typeof bookedShare>[0]> = {}) => ({
  employees: initialEmployees, shiftOverview: demoShifts, bookingHours: initialBookingHours, events: [] as CalendarEvent[], ...partial,
});
const withLuca = (id: string, startTime: string, endTime: string) => appointment(id, TUESDAY, startTime, endTime, { employeeId: 'emp-3', staffName: 'Luca Frei' });

test('the share of the working time that is booked is counted from working hours and appointments', () => {
  const events = [appointment('anna', TUESDAY, '09:00', '09:30'), withLuca('luca', '13:00', '14:00')];
  assert.deepEqual(bookedShare(salon({ events }), [TUESDAY]), { booked: 90, working: 1020, share: 9 });
  // Nothing booked is 0 %, not "unknown".
  assert.deepEqual(bookedShare(salon(), [TUESDAY]), { booked: 0, working: 1020, share: 0 });
  // One person's own day.
  assert.deepEqual(bookedShare(salon({ events }), [TUESDAY], ['emp-1']), { booked: 30, working: 510, share: 6 });
  // Time the owner keeps free (lunch) is no working time.
  const lunch = [{ id: 'block-1', employeeId: 'emp-1', date: TUESDAY, startTime: '12:00', endTime: '13:00', reason: 'Lunch' as const }];
  assert.deepEqual(bookedShare(salon({ events, timeBlocks: lunch }), [TUESDAY]), { booked: 90, working: 960, share: 9 });
  // A person who is away has no working time that day, and nothing of theirs counts.
  const away = [{ id: 'abs-1', employeeId: 'emp-3', start: TUESDAY, end: TUESDAY }];
  assert.deepEqual(bookedShare(salon({ events, absences: away }), [TUESDAY]), { booked: 30, working: 510, share: 6 });
  // A fully booked day is 100 %.
  const full = [appointment('all-day', TUESDAY, '08:30', '17:00')];
  assert.deepEqual(bookedShare(salon({ events: full }), [TUESDAY], ['emp-1']), { booked: 510, working: 510, share: 100 });
});

test('a day nobody works has no share, and only time inside the working hours counts', () => {
  // Monday: the salon is closed. A closed date and a day everybody is away give the same.
  assert.deepEqual(bookedShare(salon(), ['2026-10-05']), { booked: 0, working: 0, share: null });
  const closed = [{ id: 'c-1', name: 'Team day', start: TUESDAY, end: TUESDAY }];
  assert.equal(bookedShare(salon({ closedDates: closed, events: [appointment('anna', TUESDAY, '09:00', '09:30')] }), [TUESDAY]).share, null);
  assert.equal(bookedShare(salon(), [TUESDAY], ['emp-2']).share, null);
  // An appointment after Anna's hours (booked outside the usual hours on purpose) adds nothing;
  // one that runs over their end counts with the part inside.
  assert.equal(bookedShare(salon({ events: [appointment('late', TUESDAY, '17:00', '18:00')] }), [TUESDAY], ['emp-1']).booked, 0);
  assert.equal(bookedShare(salon({ events: [appointment('over', TUESDAY, '16:30', '17:30')] }), [TUESDAY], ['emp-1']).booked, 30);
  // Two entries for the same half hour are one half hour of the day.
  const twice = [appointment('one', TUESDAY, '09:00', '09:30'), appointment('two', TUESDAY, '09:00', '09:30')];
  assert.equal(bookedShare(salon({ events: twice }), [TUESDAY], ['emp-1']).booked, 30);
  // A day entered in the week plan decides: Selina works two hours this Tuesday, Luca is off.
  const plan: ShiftEntry[] = demoShifts.map((item) => item.employeeId === 'emp-2' ? { ...item, shifts: { ...item.shifts, [TUESDAY]: { start: '13:00', end: '15:00' } } }
    : item.employeeId === 'emp-3' ? { ...item, shifts: { ...item.shifts, [TUESDAY]: null } } : item);
  assert.equal(bookedShare(salon({ shiftOverview: plan }), [TUESDAY]).working, 510 + 120);
  // Somebody who is not active does not count; an older appointment without an id is matched by the name.
  const inactive: Employee[] = initialEmployees.map((employee) => employee.id === 'emp-3' ? { ...employee, status: 'Inactive' } : employee);
  assert.equal(bookedShare(salon({ employees: inactive }), [TUESDAY]).working, 510);
  assert.equal(bookedShare(salon({ events: [appointment('by-name', TUESDAY, '09:00', '09:30', { employeeId: undefined })] }), [TUESDAY]).booked, 30);
  // Working hours that reach beyond the opening hours count as far as the salon is open.
  const early: ShiftEntry[] = demoShifts.map((item) => item.employeeId === 'emp-1' ? { ...item, shifts: { [TUESDAY]: { start: '07:00', end: '12:00' } } } : item);
  assert.equal(bookedShare(salon({ shiftOverview: early }), [TUESDAY], ['emp-1']).working, 210);
});

test('a week is its seven days from Monday, and adds up what each day gives', () => {
  assert.deepEqual(weekDates('2026-10-07'), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  assert.deepEqual(weekDates('2026-10-11'), weekDates('2026-10-05'));
  // Anna 40 h, Selina 33.5 h, Luca 24 h: 97.5 hours in a regular week.
  const week = bookedShare(salon({ events: demoEvents }), weekDates('2026-10-05'));
  assert.equal(week.working, 97.5 * 60);
  assert.equal(week.booked, weekDates('2026-10-05').reduce((minutes, date) => minutes + bookedShare(salon({ events: demoEvents }), [date]).booked, 0));
  assert.ok(week.share !== null && week.share > 0 && week.share < 100);
});

// ---------- what the AI receptionist did ----------

test('whether the salon was closed at a moment follows its opening hours, on its own clock', () => {
  const hours = { bookingHours: initialBookingHours, timeZone: ZONE };
  // Tuesday, open 08:30–18:30. 06:00 UTC is 08:00 in Zurich.
  assert.equal(wasClosedAt('2026-10-06T06:00:00Z', hours), true);
  assert.equal(wasClosedAt('2026-10-06T06:30:00Z', hours), false);
  assert.equal(wasClosedAt('2026-10-06T16:29:00Z', hours), false);
  assert.equal(wasClosedAt('2026-10-06T16:30:00Z', hours), true);
  // Monday is closed all day; so is a closed date.
  assert.equal(wasClosedAt('2026-10-05T10:00:00Z', hours), true);
  assert.equal(wasClosedAt('2026-10-06T10:00:00Z', { ...hours, closedDates: [{ id: 'c-1', name: 'Team day', start: '2026-10-06', end: '2026-10-06' }] }), true);
  // Late on Saturday evening in UTC is Sunday in Zurich.
  assert.equal(wasClosedAt('2026-10-10T22:30:00Z', hours), true);
  assert.equal(wasClosedAt('not a moment', hours), null);
});

test('the AI\'s month: its bookings, their share, what they are worth, and how many came in while the salon was closed', () => {
  const events = [
    appointment('night', '2026-10-07', '09:00', '09:30', { isAiBooked: true, createdAt: '2026-10-04T20:15:00Z' }),
    appointment('day', '2026-10-08', '11:00', '12:30', { isAiBooked: true, createdAt: '2026-10-02T09:00:00Z', serviceId: COLOURING, serviceName: 'Colouring' }),
    appointment('undated', '2026-10-09', '09:00', '09:30', { isAiBooked: true }),
    appointment('by-hand', '2026-10-09', '10:00', '10:30', { createdAt: '2026-10-04T20:15:00Z' }),
    appointment('next-month', '2026-11-02', '09:00', '09:30', { isAiBooked: true, createdAt: '2026-10-04T20:15:00Z' }),
  ];
  const context = { events, services: initialServices, bookingHours: initialBookingHours, timeZone: ZONE };
  assert.deepEqual(aiSummary(context, FIXED_NOW), { month: { from: '2026-10-01', to: '2026-10-31' }, bookings: 3, share: 75, value: 230, whileClosed: 1 });
  // No booking carries the time it was made: nothing is said about closed hours.
  assert.equal(aiSummary({ ...context, events: events.map((event) => ({ ...event, createdAt: undefined })) }, FIXED_NOW).whileClosed, null);
  assert.deepEqual(aiSummary({ ...context, events: [] }, FIXED_NOW), { month: { from: '2026-10-01', to: '2026-10-31' }, bookings: 0, share: null, value: 0, whileClosed: null });
  // The seeded salon: the same count and share as Analytics shows for the month.
  const seeded = aiSummary({ ...context, events: demoEvents }, FIXED_NOW);
  const analytics = appointmentAnalytics(demoEvents, '2026-10-01', '2026-10-31');
  assert.deepEqual([seeded.bookings, seeded.share], [analytics.aiBookings, analytics.aiShare]);
  assert.ok(seeded.value > 0 && seeded.whileClosed !== null && seeded.whileClosed <= seeded.bookings);
});

test('chats are counted by who dealt with them', () => {
  const chats = [{ status: 'ai-handled' }, { status: 'ai-handled' }, { status: 'booked' }, { status: 'needs-attention' }, { status: 'owner-handled' }] as const;
  assert.deepEqual(chatSummary([...chats]), { total: 5, aiHandled: 2, booked: 1, waiting: 1 });
  assert.deepEqual(chatSummary([]), { total: 0, aiHandled: 0, booked: 0, waiting: 0 });
  const seeded = chatSummary(demoConversations);
  assert.equal(seeded.total, demoConversations.length);
  assert.equal(seeded.waiting, demoConversations.filter((chat) => chat.status === 'needs-attention').length);
});

// ---------- the inbox: one count, and how long somebody has waited ----------

test('the inbox counts what waits, as requests and as chats', () => {
  const list = inboxItems({ requests: demoRequests, conversations: demoConversations, events: demoEvents, answers: [], timeZone: ZONE, now: FIXED_NOW });
  // Two requests from the booking page, three that wait in a chat, and Chloé's question.
  assert.deepEqual(inboxCounts(list), { waiting: 6, requests: 5, chats: 1 });
  assert.deepEqual(inboxCounts([]), { waiting: 0, requests: 0, chats: 0 });
  // An entry that only shows an answer just given is not counted.
  const answered = inboxItems({ requests: demoRequests.slice(1), conversations: [], events: demoEvents, timeZone: ZONE, now: FIXED_NOW,
    answers: [{ kind: 'request', id: demoRequests[0].id, outcome: 'rejected', at: FIXED_NOW.getTime() - 60_000, request: demoRequests[0], index: 0 }] });
  assert.equal(answered.length, 2);
  assert.deepEqual(inboxCounts(answered), { waiting: 1, requests: 1, chats: 0 });
});

test('a wait is measured in minutes and stands out once it is long', () => {
  assert.equal(waitedMinutes('2026-10-05T09:18:00Z', FIXED_NOW), 42);
  assert.equal(waitedMinutes(FIXED_NOW.toISOString(), FIXED_NOW), 0);
  // A moment in the future (a clock that runs ahead) is no negative wait; an unknown one is no wait at all.
  assert.equal(waitedMinutes('2026-10-05T10:05:00Z', FIXED_NOW), 0);
  assert.equal(waitedMinutes(undefined, FIXED_NOW), null);
  assert.equal(waitedMinutes('yesterday', FIXED_NOW), null);
  // Somebody in a chat: long after a quarter of an hour, overdue after an hour.
  assert.deepEqual([0, 14, 15, 59, 60, 600].map((minutes) => waitingLevel('chat', minutes)), ['calm', 'calm', 'long', 'long', 'overdue', 'overdue']);
  // A request from the booking page: long after two hours, overdue after a day.
  assert.deepEqual([47, 119, 120, 1439, 1440].map((minutes) => waitingLevel('page', minutes)), ['calm', 'calm', 'long', 'long', 'overdue']);
  assert.equal(waitingLevel('chat', null), 'calm');
  assert.deepEqual(WAITING_LIMITS, { chat: { long: 15, overdue: 60 }, page: { long: 120, overdue: 1440 } });
});

test('a wait is written short on the entry and in words for a screen reader', () => {
  assert.deepEqual([0, 1, 42, 59, 60, 119, 180, 1439, 1440, 4320].map(waitingLabel), ['now', '1 min', '42 min', '59 min', '1 h', '1 h', '3 h', '23 h', '1 day', '3 days']);
  assert.deepEqual([0, 1, 42, 60, 180, 1440, 4320].map(waitingWords), ['less than a minute', '1 minute', '42 minutes', '1 hour', '3 hours', '1 day', '3 days']);
});

// ---------- what is new since the last visit ----------

const storage = () => {
  const kept = new Map<string, string>();
  return { kept, getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); } };
};

test('Home remembers the last visit in the browser, and only what was made after it is new', () => {
  const browser = storage();
  // A first visit: nothing to compare with, so nothing is new.
  assert.equal(lastHomeVisit(browser), null);
  assert.equal(isNewSince('2026-10-05T09:00:00Z', null), false);
  noteHomeVisit(FIXED_NOW, browser);
  assert.deepEqual([...browser.kept], [[HOME_VISIT_KEY, '2026-10-05T10:00:00.000Z']]);
  const visit = lastHomeVisit(browser);
  assert.equal(visit, '2026-10-05T10:00:00.000Z');
  assert.equal(isNewSince('2026-10-05T10:00:01Z', visit), true);
  assert.equal(isNewSince('2026-10-05T10:00:00.000Z', visit), false);
  assert.equal(isNewSince('2026-10-04T22:00:00Z', visit), false);
  // Something without a time, or with one that is none, is never new.
  assert.equal(isNewSince(undefined, visit), false);
  assert.equal(isNewSince('soon', visit), false);
});

test('a browser that keeps nothing, or holds something else under the key, marks nothing as new', () => {
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(lastHomeVisit(blocked), null);
  assert.doesNotThrow(() => noteHomeVisit(FIXED_NOW, blocked));
  assert.equal(lastHomeVisit(null), null);
  assert.doesNotThrow(() => noteHomeVisit(FIXED_NOW, null));
  const odd = storage();
  odd.kept.set(HOME_VISIT_KEY, 'last Tuesday');
  assert.equal(lastHomeVisit(odd), null);
});

// ---------- links that open the owner's own messenger ----------

test('a message link carries the text, and a number only when it is a real one', () => {
  const text = 'Guten Tag Petra Meier, Ihr Termin ist bestätigt: Wash & blow-dry um 10:00 Uhr.';
  const written = encodeURIComponent(text);
  assert.equal(whatsAppLink('+41 79 123 45 67', text), `https://wa.me/41791234567?text=${written}`);
  assert.equal(smsLink('079 123 45 67', text), `sms:+41791234567?&body=${written}`);
  // The text is safe in an address: no space, no "&" that would end it.
  assert.doesNotMatch(written, /[ &]/);
  // One of the sample salon's invented numbers could belong to somebody: the link names nobody,
  // and the owner chooses whom the text is for.
  assert.equal(whatsAppLink('+41 76 555 62 42', text), `https://wa.me/?text=${written}`);
  assert.equal(smsLink('+41765556242', text), `sms:?&body=${written}`);
  // No number, or a label in its place.
  for (const none of [undefined, null, '', 'Telegram user', '+41 ••• ••• 67']) {
    assert.equal(whatsAppLink(none, 'Hi'), 'https://wa.me/?text=Hi');
    assert.equal(smsLink(none, 'Hi'), 'sms:?&body=Hi');
  }
});
