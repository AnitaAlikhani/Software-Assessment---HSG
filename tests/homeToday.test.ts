import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { appointmentFromRequest } from '../src/appointmentActions';
import { aiSummary, bookedShare, latestAiBookings, todayOverview, weekDates } from '../src/dashboard';
import { formatMoney } from '../src/format';
import { HOME_DAY_VIEW_KEY } from '../src/homeVisit';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import type { CalendarEvent, Conversation } from '../src/types';
import { HomeView } from '../src/views/HomeView';
import { demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { render } from './renderHelpers';

// Home opens with today: the day's appointments in the order of their start, the next one
// marked, a sentence for a day that is closed, empty or over, what the day is worth and how full
// it is. The owner can look at her own day instead of the team's. Below the inbox stands what
// the AI receptionist brought in. Every test fixes its moment; none reads the clock.

const ZONE = 'Europe/Zurich';
const nothing = () => {};

/** An appointment on Tuesday 6 October 2026, for a customer of its own. */
const at = (id: string, startTime: string, endTime: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  ...demoEvents[0], id, customerId: `customer-${id}`, customerName: `Customer ${id}`, conversationId: undefined, serviceName: 'Haircut',
  staffName: 'Anna Weber', employeeId: 'emp-1', date: '2026-10-06', startTime, endTime, isAiBooked: false, ...extra,
});
const TUESDAY: CalendarEvent[] = [
  at('late', '15:00', '15:30'),
  at('early', '09:00', '09:30'),
  at('long', '12:00', '13:00'),
  at('short', '12:30', '13:00', { staffName: 'Selina Keller', employeeId: 'emp-2' }),
  at('one', '13:00', '13:30'),
  at('other', '13:00', '14:00', { staffName: 'Luca Frei', employeeId: 'emp-3' }),
  at('wednesday', '08:30', '09:00', { date: '2026-10-07' }),
  at('monday', '10:00', '10:30', { date: '2026-10-05' }),
];
/** A moment on Tuesday 6 October 2026, given as the time the salon's clock shows (Zurich is two hours ahead of UTC then). */
const tuesday = (time: string) => new Date(`2026-10-06T${String(Number(time.slice(0, 2)) - 2).padStart(2, '0')}:${time.slice(3)}:00Z`);
const overview = (events: CalendarEvent[], now: Date, extra: Partial<Parameters<typeof todayOverview>[0]> = {}) =>
  todayOverview({ events, bookingHours: initialBookingHours, timeZone: ZONE, ...extra }, now);
const states = (events: CalendarEvent[], now: Date) => overview(events, now).appointments.map(({ event, state }) => `${event.id} ${state}`);

test('today\'s appointments come in the order of their start, each with where it stands', () => {
  // 12:40: one is over, two are going on, the two that start at 13:00 are both next.
  assert.deepEqual(states(TUESDAY, tuesday('12:40')), ['early done', 'long now', 'short now', 'one next', 'other next', 'late later']);
  // 13:00 sharp: what ends now is over, what starts now is going on.
  assert.deepEqual(states(TUESDAY, tuesday('13:00')), ['early done', 'long done', 'short done', 'one now', 'other now', 'late next']);
  assert.deepEqual(states(TUESDAY, tuesday('08:00')), ['early next', 'long later', 'short later', 'one later', 'other later', 'late later']);
  assert.deepEqual(states(TUESDAY, tuesday('15:30')).at(-1), 'late done');
  // Only the appointments of the salon's day: 00:30 in Zurich on Wednesday is still Tuesday evening in UTC.
  const wednesday = overview(TUESDAY, new Date('2026-10-06T22:30:00Z'));
  assert.equal(wednesday.date, '2026-10-07');
  assert.deepEqual(wednesday.appointments.map(({ event }) => event.id), ['wednesday']);
});

test('a day that is closed is named as such, and a day with nothing more to come leads to the next appointment', () => {
  // Monday: the salon does not open. A closure by date carries its name.
  assert.deepEqual(overview(TUESDAY, FIXED_NOW).closed, { name: '' });
  assert.equal(overview(TUESDAY, tuesday('10:00')).closed, null);
  const closure = [{ id: 'c-1', name: ' Team day ', start: '2026-10-06', end: '2026-10-07' }];
  assert.deepEqual(overview(TUESDAY, tuesday('10:00'), { closedDates: closure }).closed, { name: 'Team day' });
  assert.equal(overview(TUESDAY, tuesday('10:00'), { closedDates: [{ ...closure[0], start: '2026-10-07' }] }).closed, null);
  // While something is still to come today, nothing points further ahead.
  assert.equal(overview(TUESDAY, tuesday('15:00')).following, null);
  // After the last appointment, and on a day without any, the next one is the first of the days to come.
  assert.equal(overview(TUESDAY, tuesday('15:30')).following?.id, 'wednesday');
  assert.equal(overview(TUESDAY, new Date('2026-10-04T10:00:00Z')).following?.id, 'monday');
  assert.equal(overview(TUESDAY, new Date('2026-10-08T10:00:00Z')).following, null);
  assert.equal(overview([], FIXED_NOW).following, null);
});

test('the AI\'s latest bookings come newest first, a handful of them', () => {
  const latest = latestAiBookings(demoEvents);
  assert.equal(latest.length, 5);
  assert.ok(latest.every((event) => event.isAiBooked));
  // The three requests the AI took in the salon's chats and the owner confirmed, this morning and last evening.
  assert.deepEqual(latest.slice(0, 3).map((event) => event.id), ['cal-2', 'cal-3', 'cal-john']);
  const moments = latest.map((event) => event.createdAt!);
  assert.deepEqual(moments, [...moments].sort().reverse());
  // A booking made just now, wherever it stands in the list, comes first; one without a time stamp comes last.
  const fresh = at('fresh', '10:00', '10:30', { isAiBooked: true, createdAt: FIXED_NOW.toISOString() });
  const undated = at('undated', '11:00', '11:30', { isAiBooked: true, createdAt: undefined });
  const byHand = at('by-hand', '12:00', '12:30', { createdAt: FIXED_NOW.toISOString() });
  assert.deepEqual(latestAiBookings([undated, ...demoEvents.slice(0, 40), byHand, fresh], 3).map((event) => event.id), ['fresh', 'cal-2', 'cal-3']);
  assert.deepEqual(latestAiBookings([undated, byHand]).map((event) => event.id), ['undated']);
  assert.deepEqual(latestAiBookings([]), []);
  // A request from the booking page that the owner accepts is the owner's booking: it is not listed here.
  const accepted = { ...appointmentFromRequest(demoRequests[0], initialServices, initialEmployees), createdAt: FIXED_NOW.toISOString() };
  assert.deepEqual(latestAiBookings([accepted, ...demoEvents]).map((event) => event.id), latest.map((event) => event.id));
});

// ---------- on the screen ----------

const home = (events: CalendarEvent[], now: Date, partial: Partial<React.ComponentProps<typeof HomeView>> = {}) => render(React.createElement(HomeView, {
  requests: [], selectedRequestId: null, now, conversations: [],
  availabilityContext: { requests: [], events, services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts, now, timeZone: ZONE },
  onAcceptRequest: nothing, onRejectRequest: nothing, onMoveRequest: () => null, onSimulateNewRequest: nothing,
  onOpenAppointment: nothing, onOpenCalendar: nothing, onOpenConversations: nothing, ...partial,
}));
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
/** One card of the page, by the id of its heading. */
const cardOf = (html: string, title: string) => {
  const start = html.indexOf(`<section aria-labelledby="${title}"`);
  assert.ok(start >= 0, title);
  return html.slice(start, html.indexOf('</section>', start));
};
const todayCard = (html: string) => cardOf(html, 'home-today-title');
const rows = (card: string) => Array.from(card.matchAll(/<li class="([^"]*)">(.*?)<\/li>/g), ([, classes, row]) => ({ hidden: classes.includes('hidden'), text: words(row) }));

test('Home opens with the date and the day\'s appointments: time, customer, service and staff, the next one marked', () => {
  const html = home(TUESDAY, tuesday('12:40'));
  const card = todayCard(html);
  assert.match(words(card), /^Today Open calendar Tuesday, 06\.10\.2026 6 appointments /);
  assert.deepEqual(rows(card).map((row) => row.text), [
    '09:00–09:30 Over Customer early Haircut · Anna Weber',
    '12:00–13:00 Now Customer long Haircut · Anna Weber',
    '12:30–13:00 Now Customer short Haircut · Selina Keller',
    '13:00–13:30 Next Customer one Haircut · Anna Weber',
    '13:00–14:00 Next Customer other Haircut · Luca Frei',
    '15:00–15:30 Customer late Haircut · Anna Weber',
  ]);
  // Every appointment is a button that opens it, a full tap target.
  assert.equal(card.match(/<li class="[^"]*"><button type="button" class="[^"]*\bmin-h-11\b/g)?.length, 6);
  // Past appointments are quieter: their time and name are not set in bold.
  assert.match(card, /<span class="block text-sm tabular-nums text-slate-500">09:00–09:30<\/span>/);
  assert.match(card, /<span class="block text-sm tabular-nums font-semibold text-slate-900">12:00–13:00<\/span>/);
  // Nothing of the old single card is left.
  assert.doesNotMatch(html, />Confirmed<|No upcoming appointments/);
});

test('on a phone the card starts at what is going on now and shows three rows, with the whole day one tap away', () => {
  const card = todayCard(home(TUESDAY, tuesday('12:40')));
  // The row that is over is folded away below the width of two columns; the three from "now" on are shown.
  assert.deepEqual(rows(card).map((row) => row.hidden), [true, false, false, false, true, true]);
  // Two columns, and with them the whole day, begin at 1024 px: a tablet on its side shows every appointment.
  assert.match(card, /<li class="hidden lg:block">/);
  assert.doesNotMatch(card, /\bxl:/);
  // The way to the rest of the day is a full tap target at the foot of the card, and a phone's only.
  const showAll = /<button type="button" aria-expanded="false" aria-controls="home-today-list" class="([^"]*)">Show all 6<span class="sr-only"> appointments<\/span>/.exec(card);
  assert.ok(showAll, 'the card offers the whole day');
  assert.match(showAll[1], /\bmin-h-11\b.*\blg:hidden\b/);
  assert.match(card, /<ul id="home-today-list"/);
  // Late in the day the last rows are shown, so the card never opens on an empty list while something is to come.
  assert.deepEqual(rows(todayCard(home(TUESDAY, tuesday('14:30')))).map((row) => row.hidden), [true, true, true, false, false, false]);
  // Up to three appointments need no folding.
  const few = todayCard(home(TUESDAY.slice(0, 3), tuesday('12:40')));
  assert.ok(rows(few).every((row) => !row.hidden));
  assert.doesNotMatch(few, /Show all/);
});

test('a closed day, an empty day and a day that is over each say so in a sentence', () => {
  // Monday 5 October: the salon is closed, and the first appointment of the week is on Tuesday.
  const monday = words(todayCard(home(TUESDAY.filter((event) => event.id !== 'monday'), FIXED_NOW)));
  assert.match(monday, /^Today Open calendar Monday, 05\.10\.2026 The salon is closed today\. No appointments\. Next appointment Tue, 06\.10\.2026, 09:00–09:30 Customer early · Haircut · Anna Weber Working hours booked \d+% this week$/);
  // Closed, but somebody is booked all the same: the sentence is followed by what that is worth.
  assert.match(words(todayCard(home(TUESDAY, FIXED_NOW))), /The salon is closed today\. One appointment is in the calendar all the same\. CHF 55\.00 booked\. 10:00–10:30/);
  const closure = { closedDates: [{ id: 'c-1', name: 'Team day', start: '2026-10-06', end: '2026-10-06' }] };
  const teamDay = home(TUESDAY, tuesday('10:00'), { availabilityContext: { requests: [], events: TUESDAY, services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts, timeZone: ZONE, ...closure } });
  assert.match(words(todayCard(teamDay)), /The salon is closed today \(Team day\)\. 6 appointments are in the calendar all the same\./);
  // An open day without appointments.
  const empty = words(todayCard(home([], tuesday('10:00'))));
  assert.equal(empty, 'Today Open calendar Tuesday, 06.10.2026 No appointments today.');
  // The day is over: all rows are folded on a phone, and the card leads to tomorrow.
  const over = todayCard(home(TUESDAY, tuesday('16:00')));
  assert.match(words(over), /All 6 appointments of today are over\. CHF 330\.00 booked\./);
  assert.ok(rows(over).slice(0, 6).every((row) => row.hidden));
  assert.match(words(over), /Next appointment Wed, 07\.10\.2026, 08:30–09:00 Customer wednesday · Haircut · Anna Weber Working hours booked \d+% today · \d+% this week Show all 6 appointments$/);
  assert.match(words(todayCard(home(TUESDAY.filter((event) => event.id === 'early'), tuesday('16:00')))), /Today’s appointment is over\./);
  // The link to the calendar is offered only when it leads somewhere.
  assert.doesNotMatch(todayCard(home(TUESDAY, tuesday('10:00'), { onOpenCalendar: undefined })), /Open calendar/);
});

test('Home says what the AI receptionist brought in this month, then lists its latest bookings, each a way to its appointment', () => {
  const card = cardOf(home(demoEvents, FIXED_NOW), 'home-ai-title');
  const month = aiSummary({ events: demoEvents, services: initialServices, bookingHours: initialBookingHours, timeZone: ZONE }, FIXED_NOW);
  assert.ok(month.bookings > 20 && month.share !== null && month.whileClosed !== null && month.whileClosed > 0, 'the seeded month has AI bookings, some of them made while the salon was closed');
  // The figures stand first: how many, their share, what they are worth at list prices, and how many came in while the salon was closed.
  assert.ok(words(card).startsWith(
    `AI receptionist October 2026, by the day of the appointment Bookings ${month.share}% of appointments ${month.bookings} Booked value at list prices ${formatMoney(month.value)} While closed outside opening hours ${month.whileClosed} `
    + 'Latest bookings Marie Dupont Booked 3 hours ago Haircut · Thu, 08.10.2026, 13:30–14:00 Lara Rüegg Booked 14 hours ago Colouring · Fri, 09.10.2026, 11:00–12:30 John Bennett Booked 18 hours ago Haircut · Wed, 07.10.2026, 15:00–15:30',
  ), words(card));
  assert.equal(card.match(/<button/g)?.length, 5);
  assert.match(card, /Booked 2 days ago/);
  // Each figure is a row of its own, the number at its end: an amount has the width of the card, on a phone too.
  assert.equal(card.match(/<div class="flex items-center justify-between gap-3"><div class="min-w-0"><p[^>]*>(Bookings|Booked value|While closed)<\/p>/g)?.length, 3);
  // No booking carries the time it was made: the card says nothing about closed hours.
  const undated = cardOf(home(demoEvents.map((event) => ({ ...event, createdAt: undefined })), FIXED_NOW), 'home-ai-title');
  assert.doesNotMatch(words(undated), /While closed|Booked \d+ (hours|days) ago/);
  assert.match(words(undated), /Bookings \d+% of appointments \d+ Booked value at list prices CHF [\d'.]+ Latest bookings/);
  // One booking is worded in the singular. It was made this morning, a Monday, when the salon is closed.
  const one = [at('single', '10:00', '10:30', { isAiBooked: true, createdAt: '2026-10-05T07:00:00Z', serviceId: 'srv-2' })];
  assert.match(words(cardOf(home(one, FIXED_NOW), 'home-ai-title')), /^AI receptionist October 2026, by the day of the appointment Booking 100% of appointments 1 Booked value at list prices CHF 55\.00 While closed outside opening hours 1 Latest bookings Customer single Booked 3 hours ago/);
  // Made on Friday afternoon, during opening hours: none while closed.
  const inHours = [{ ...one[0], createdAt: '2026-10-02T13:00:00Z' }];
  assert.match(words(cardOf(home(inHours, FIXED_NOW), 'home-ai-title')), / While closed outside opening hours 0 /);
  // Without a booking by the AI the card says so, and shows no row of zeros.
  assert.equal(words(cardOf(home(TUESDAY, FIXED_NOW), 'home-ai-title')), 'AI receptionist The AI has not booked an appointment yet.');
});

test('the AI card says in one sentence what became of the chats, and marks what was booked since the last visit', () => {
  const chat = (id: string, status: Conversation['status']): Conversation => ({
    id, customerName: `Chat ${id}`, initials: 'C', avatarColor: 'bg-rose-100 text-rose-700', language: 'DE', phone: '', channel: 'Website', status, lastTime: '11:00', messages: [],
  });
  const line = (conversations: Conversation[]) => /<\/h2>.*?<p class="[^"]*">(Of your [^<]*)<\/p>/.exec(cardOf(home(TUESDAY, FIXED_NOW, { conversations }), 'home-ai-title'))?.[1];
  // Chats carry no period: the sentence counts all of them, and names only what there is to say.
  assert.equal(line([chat('a', 'ai-handled'), chat('b', 'ai-handled'), chat('c', 'booked'), chat('d', 'needs-attention')]), 'Of your 4 chats, the AI answered 2 on its own, 1 ended in a booking and 1 waits for you.');
  assert.equal(line([chat('a', 'booked'), chat('b', 'needs-attention'), chat('c', 'needs-attention')]), 'Of your 3 chats, 1 ended in a booking and 2 wait for you.');
  assert.equal(line([chat('a', 'ai-handled')]), 'Of your 1 chat, the AI answered 1 on its own.');
  // Chats the owner dealt with herself are no news about the AI.
  assert.equal(line([chat('a', 'owner-handled')]), undefined);
  assert.equal(line([]), undefined);

  // Marie's haircut was booked three hours ago, the others last evening or earlier.
  const marked = (lastVisit: string | null) => Array.from(cardOf(home(demoEvents, FIXED_NOW, { lastVisit }), 'home-ai-title').matchAll(/<li>(.*?)<\/li>/g), ([, row]) => words(row)).filter((row) => / New /.test(row)).map((row) => row.split(' New ')[0]);
  assert.deepEqual(marked('2026-10-05T05:00:00Z'), ['Marie Dupont']);
  assert.deepEqual(marked('2026-10-04T12:00:00Z'), ['Marie Dupont', 'Lara Rüegg', 'John Bennett']);
  // She has looked since: nothing is new. On a first visit there is no "last time", so nothing is marked either.
  assert.deepEqual(marked(FIXED_NOW.toISOString()), []);
  assert.deepEqual(marked(null), []);
});

// ---------- whose day, what it is worth, how full it is ----------

const ANNA = { id: 'emp-1', name: 'Anna Weber' };
/** Renders with a browser that remembers the owner's choice of "My day". */
const withMyDay = <T,>(run: () => T): T => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => (key === HOME_DAY_VIEW_KEY ? 'mine' : null), setItem: nothing } });
  try { return run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
};
const pressed = (card: string) => Array.from(card.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>([^<]+)<\/button>/g), ([, state, label]) => `${label}${state === 'true' ? ' (shown)' : ''}`);

test('the day in a line: how many appointments, how many of them are the owner\'s, and what they are worth at list prices', () => {
  // Tuesday at 12:40. Four of the six appointments are Anna's; every one is a haircut at CHF 55.
  const card = todayCard(home(TUESDAY, tuesday('12:40'), { me: ANNA }));
  assert.match(words(card), /^Today Team My day Open calendar Tuesday, 06\.10\.2026 6 appointments · , 4 with you · , CHF 330\.00 booked 09:00–09:30 /);
  assert.deepEqual(pressed(card), ['Team (shown)', 'My day']);
  // Both halves of the switch are full tap targets, and the group has a name.
  assert.match(card, /<div role="group" aria-label="Whose day is shown"/);
  assert.equal(card.match(/aria-pressed="(true|false)" class="min-h-11 /g)?.length, 2);
  // The team's day is listed as before: every appointment with its stylist.
  assert.equal(rows(card).length, 6);
  assert.match(rows(card)[2].text, /Customer short Haircut · Selina Keller$/);
  // All of them, one of them, none of them.
  const onlyAnna = TUESDAY.filter((event) => event.staffName === 'Anna Weber');
  assert.match(words(todayCard(home(onlyAnna.filter((event) => event.date === '2026-10-06'), tuesday('12:40'), { me: ANNA }))), /4 appointments · , all with you · , CHF 220\.00 booked/);
  assert.match(words(todayCard(home(TUESDAY, tuesday('12:40'), { me: { id: 'emp-2', name: 'Selina Keller' } }))), /6 appointments · , 1 with you · , CHF 330\.00 booked/);
  assert.match(words(todayCard(home(TUESDAY.filter((event) => event.employeeId !== 'emp-1'), tuesday('12:40'), { me: ANNA }))), /2 appointments · , none with you · , CHF 110\.00 booked/);
  // An appointment whose service has gone from the list has no price: it is counted, and adds nothing to the value.
  const unpriced = [...TUESDAY.slice(0, 1), at('gone', '16:00', '16:30', { serviceId: 'srv-deleted' })];
  assert.match(words(todayCard(home(unpriced, tuesday('12:40')))), /2 appointments · , CHF 55\.00 booked/);
  assert.doesNotMatch(words(todayCard(home([at('gone', '16:00', '16:30', { serviceId: 'srv-deleted' })], tuesday('12:40')))), /CHF/);
});

test('the choice between the team\'s day and the owner\'s own is offered only where there is one', () => {
  const day = (partial: Partial<React.ComponentProps<typeof HomeView>> = {}, events = TUESDAY) => todayCard(home(events, tuesday('12:40'), partial));
  // Nobody is signed in as one of the team.
  assert.deepEqual(pressed(day()), []);
  assert.deepEqual(pressed(day({ me: { id: 'emp-9', name: 'Somebody else' } })), []);
  // A salon of one has one day.
  const alone = { requests: [], events: TUESDAY, services: initialServices, employees: initialEmployees.filter((employee) => employee.id === 'emp-1'), bookingHours: initialBookingHours, shiftOverview: demoShifts, timeZone: ZONE };
  assert.deepEqual(pressed(day({ me: ANNA, availabilityContext: alone })), []);
  assert.doesNotMatch(words(day({ me: ANNA, availabilityContext: alone })), /with you/);
  // A day without appointments is the same for everybody.
  assert.deepEqual(pressed(day({ me: ANNA }, TUESDAY.filter((event) => event.date !== '2026-10-06'))), []);
  // Somebody who has left the team is not offered a day of their own.
  const left = { ...alone, employees: initialEmployees.map((employee) => employee.id === 'emp-1' ? { ...employee, status: 'Inactive' as const } : employee) };
  assert.deepEqual(pressed(day({ me: ANNA, availabilityContext: left })), []);
});

test('"My day" shows the owner\'s own appointments, her own next one and her own working hours', () => {
  const card = withMyDay(() => todayCard(home(TUESDAY, tuesday('12:40'), { me: ANNA })));
  assert.deepEqual(pressed(card), ['Team', 'My day (shown)']);
  assert.match(words(card), /^Today Team My day Open calendar Tuesday, 06\.10\.2026 4 appointments · , the team has 6 · , CHF 220\.00 booked /);
  // Her appointments only, without her own name on every row. The next one is her next, not the salon's.
  assert.deepEqual(rows(card).map((row) => row.text), [
    '09:00–09:30 Over Customer early Haircut',
    '12:00–13:00 Now Customer long Haircut',
    '13:00–13:30 Next Customer one Haircut',
    '15:00–15:30 Customer late Haircut',
  ]);
  const own = bookedShare({ employees: initialEmployees, shiftOverview: demoShifts, bookingHours: initialBookingHours, events: TUESDAY }, ['2026-10-06'], ['emp-1']);
  const week = bookedShare({ employees: initialEmployees, shiftOverview: demoShifts, bookingHours: initialBookingHours, events: TUESDAY }, weekDates('2026-10-06'), ['emp-1']);
  assert.ok(words(card).includes(`Your working hours booked ${own.share}% today · ${week.share}% this week`), words(card));
  // After her last appointment the card leads to her own next one, on whatever day it is.
  const over = withMyDay(() => words(todayCard(home(TUESDAY, tuesday('16:00'), { me: ANNA }))));
  assert.match(over, /All 4 of your appointments of today are over\. CHF 220\.00 booked\. .* Your next appointment Wed, 07\.10\.2026, 08:30–09:00 Customer wednesday · Haircut Your working hours booked/);
  // She has none today, the team has: the card says both. A day she is the only one booked needs no word about the team.
  const none = withMyDay(() => words(todayCard(home(TUESDAY.filter((event) => event.employeeId !== 'emp-1' || event.date !== '2026-10-06'), tuesday('12:40'), { me: ANNA }))));
  assert.match(none, /Tuesday, 06\.10\.2026 You have no appointments today\. Your next appointment Wed, 07\.10\.2026/);
  const onlyHers = withMyDay(() => words(todayCard(home(TUESDAY.filter((event) => event.employeeId === 'emp-1'), tuesday('12:40'), { me: ANNA }))));
  assert.match(onlyHers, /4 appointments · , CHF 220\.00 booked/);
  assert.doesNotMatch(onlyHers, /the team has/);
  // The choice is remembered in the browser; without one the team's day is shown.
  assert.deepEqual(pressed(todayCard(home(TUESDAY, tuesday('12:40'), { me: ANNA }))), ['Team (shown)', 'My day']);
});

test('the foot of the card says how much of the working hours is booked, today and this week', () => {
  const salon = { employees: initialEmployees, shiftOverview: demoShifts, bookingHours: initialBookingHours, events: TUESDAY };
  const today = bookedShare(salon, ['2026-10-06']);
  const week = bookedShare(salon, weekDates('2026-10-06'));
  // Anna and Luca work on Tuesdays: three and a half hours of their seventeen are booked.
  assert.deepEqual([today.booked, today.working, today.share], [210, 1020, 21]);
  const card = words(todayCard(home(TUESDAY, tuesday('12:40'))));
  assert.ok(card.endsWith(`Working hours booked ${today.share}% today · ${week.share}% this week Show all 6 appointments`), card);
  // A day nobody works (Monday) has no share of its own: the week stands alone.
  assert.match(words(todayCard(home(TUESDAY, FIXED_NOW))), /Working hours booked \d+% this week$/);
  // A salon that has not begun is not told "0%" twice (see "Getting started" below).
  assert.doesNotMatch(words(todayCard(home([], tuesday('10:00')))), /Working hours/);
});

test('an appointment the AI booked is marked in the day\'s list, as in the calendar', () => {
  const day = [at('by-ai', '09:00', '09:30', { isAiBooked: true }), at('by-hand', '10:00', '10:30'), at('in-chat', '11:00', '11:30', { conversationId: 'conv-1' })];
  const html = todayCard(home(day, tuesday('08:00')));
  const marks = Array.from(html.matchAll(/<li class="[^"]*">(.*?)<\/li>/g), ([, row]) => /<span role="img" aria-label="([^"]*)"[^>]*data-source="([^"]*)"/.exec(row)?.slice(1) ?? null);
  // Only what the AI brought in carries the mark: every other booking is the salon's own.
  assert.deepEqual(marks, [['Booked by the AI', 'ai'], null, null]);
});

// ---------- a salon that has not begun ----------

test('a salon without an appointment, a request or a chat is shown what is set up and where to go on', () => {
  const opened: string[] = [];
  const empty = home([], tuesday('10:00'), { onOpenScreen: (tab) => opened.push(tab), bookingLink: React.createElement('p', null, 'the booking link') });
  const card = cardOf(empty, 'home-start-title');
  assert.match(words(card), /^Getting started Your calendar is still empty\. This is what is set up, and where to change it\. Opening hours Open on 5 days of the week Services and prices 10 services, 6 of them can be booked online Team and working hours 3 people AI receptionist How it answers, and what it hands over to you Then pass your booking link on to your customers, or add the first appointment yourself with the plus button\. the booking link$/);
  // Every line leads to its screen, as a full tap target.
  assert.equal(card.match(/<li><button type="button" class="flex min-h-11 w-full /g)?.length, 4);
  // It stands first, and takes the place of the figures: neither the AI's month nor "This month" shows a row of zeros.
  assert.ok(empty.indexOf('home-start-title') < empty.indexOf('home-today-title'));
  assert.doesNotMatch(empty, /home-ai-title|home-month-title|This month/);
  // The booking link stands in the card, once.
  assert.equal(empty.match(/the booking link/g)?.length, 1);
  // Without a way to the other screens the lines are text.
  assert.doesNotMatch(cardOf(home([], tuesday('10:00')), 'home-start-title'), /<button/);
  // What is not set up yet is said as it is.
  const bare = { requests: [], events: [], services: [], employees: [], bookingHours: initialBookingHours.map((day) => ({ ...day, isOpen: false })), shiftOverview: [], timeZone: ZONE };
  assert.match(words(cardOf(home([], tuesday('10:00'), { availabilityContext: bare }), 'home-start-title')), /Opening hours No day is open yet Services and prices No service yet Team and working hours Nobody yet/);
  // As soon as anything is there (an appointment, a request, a chat), Home is the usual one, with the link at its end.
  for (const begun of [home(TUESDAY, tuesday('10:00'), { bookingLink: React.createElement('p', null, 'the booking link') }), home([], tuesday('10:00'), { requests: demoRequests, bookingLink: React.createElement('p', null, 'the booking link') })]) {
    assert.doesNotMatch(begun, /home-start-title/);
    assert.match(begun, /home-month-title/);
    assert.ok(begun.indexOf('the booking link') > begun.indexOf('home-month-title'));
  }
  assert.deepEqual(opened, []);
});
