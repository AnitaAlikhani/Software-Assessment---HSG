import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { bookedShare, dayPart, monthCurve, monthPace, openState, weekLoad } from '../src/dashboard';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { STAFF_COLORS } from '../src/staffColors';
import type { CalendarEvent, Conversation } from '../src/types';
import { WIDE_SCREEN } from '../src/useWideScreen';
import { HomeView } from '../src/views/HomeView';
import { demoConversations, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { HOME_DAY_VIEW_KEY } from '../src/homeVisit';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// Home as a dashboard: whether the salon is open, the week day by day, the month as a line, and
// the two ways the cards are arranged (one column on a phone; a greeting, the month first and two
// columns on a wide screen). The figures themselves are in tests/figures.test.ts and
// tests/homeFigures.test.ts, today's card in tests/homeToday.test.ts, the inbox in
// tests/homeInbox.test.ts. Every test fixes its moment; none reads the clock.

const ZONE = 'Europe/Zurich';
const nothing = () => {};

/** An appointment on Tuesday 6 October 2026, a haircut at CHF 55 for a customer of its own. */
const at = (id: string, startTime: string, endTime: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  ...demoEvents[0], id, customerId: `customer-${id}`, customerName: `Customer ${id}`, conversationId: undefined, serviceName: 'Haircut',
  staffName: 'Anna Weber', employeeId: 'emp-1', date: '2026-10-06', startTime, endTime, isAiBooked: false, ...extra,
});
// The week of Monday 5 October: one appointment on the closed Monday, six on Tuesday (four of
// them Anna's), one on Wednesday.
const WEEK: CalendarEvent[] = [
  at('monday', '10:00', '10:30', { date: '2026-10-05' }),
  at('early', '09:00', '09:30'),
  at('long', '12:00', '13:00'),
  at('short', '12:30', '13:00', { staffName: 'Selina Keller', employeeId: 'emp-2' }),
  at('one', '13:00', '13:30'),
  at('other', '13:00', '14:00', { staffName: 'Luca Frei', employeeId: 'emp-3' }),
  at('late', '15:00', '15:30'),
  at('wednesday', '08:30', '09:00', { date: '2026-10-07' }),
];
/** A moment on Tuesday 6 October 2026, given as the time the salon's clock shows (Zurich is two hours ahead of UTC then). */
const tuesday = (time: string) => new Date(`2026-10-06T${String(Number(time.slice(0, 2)) - 2).padStart(2, '0')}:${time.slice(3)}:00Z`);
const salon = (events: CalendarEvent[]) => ({ employees: initialEmployees, shiftOverview: demoShifts, bookingHours: initialBookingHours, events, timeZone: ZONE });

// ---------- whether the salon is open ----------

test('the salon is open from its opening time up to its closing time, and a closed day carries the name of its closure', () => {
  const hours = { bookingHours: initialBookingHours, timeZone: ZONE };
  // Tuesday: 08:30 to 18:30.
  assert.deepEqual(openState(hours, tuesday('08:29')), { state: 'before', opens: '08:30' });
  assert.deepEqual(openState(hours, tuesday('08:30')), { state: 'open', closes: '18:30' });
  assert.deepEqual(openState(hours, tuesday('18:29')), { state: 'open', closes: '18:30' });
  assert.deepEqual(openState(hours, tuesday('18:30')), { state: 'after' });
  // Monday is a weekday the salon never opens; a closure by date has a name.
  assert.deepEqual(openState(hours, FIXED_NOW), { state: 'closed', name: '' });
  const closure = { ...hours, closedDates: [{ id: 'c-1', name: ' Team day ', start: '2026-10-06', end: '2026-10-06' }] };
  assert.deepEqual(openState(closure, tuesday('10:00')), { state: 'closed', name: 'Team day' });
  // The salon's clock decides, not the browser's: 23:30 in UTC on Monday is 01:30 on Tuesday in Zurich, before opening.
  assert.deepEqual(openState(hours, new Date('2026-10-05T23:30:00Z')), { state: 'before', opens: '08:30' });
});

test('the day has three parts to greet by', () => {
  assert.deepEqual(['00:00', '09:41', '11:59'].map(dayPart), ['morning', 'morning', 'morning']);
  assert.deepEqual(['12:00', '17:59'].map(dayPart), ['afternoon', 'afternoon']);
  assert.deepEqual(['18:00', '23:59'].map(dayPart), ['evening', 'evening']);
});

// ---------- the week, day by day ----------

test('the week is seven days from Monday, each with its appointments, how full it is and whether the salon opens', () => {
  const week = weekLoad(salon(WEEK), tuesday('12:40'));
  assert.deepEqual(week.map((day) => day.date), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  assert.deepEqual(week.map((day) => day.when), ['past', 'today', 'ahead', 'ahead', 'ahead', 'ahead', 'ahead']);
  assert.deepEqual(week.map((day) => day.appointments), [1, 6, 1, 0, 0, 0, 0]);
  // Monday and Sunday are closed: no working hours, so no share, also where somebody is booked all the same.
  assert.deepEqual(week.map((day) => day.closed), [{ name: '' }, null, null, null, null, null, { name: '' }]);
  assert.deepEqual([week[0].share, week[6].share], [null, null]);
  // Every other day carries the share Home's "Today" names for it (three and a half of Tuesday's seventeen hours).
  assert.equal(week[1].share, 21);
  for (const day of week.slice(1, 6)) assert.equal(day.share, bookedShare(salon(WEEK), [day.date]).share, day.date);
  assert.ok(week[2].share! > 0 && week[3].share === 0);
  // The owner's own week: her appointments against her own working hours.
  const own = weekLoad(salon(WEEK), tuesday('12:40'), ['emp-1']);
  assert.deepEqual(own.map((day) => day.appointments), [1, 4, 1, 0, 0, 0, 0]);
  assert.equal(own[1].share, bookedShare(salon(WEEK), ['2026-10-06'], ['emp-1']).share);
  // A closure by date closes its days and names them.
  const closed = weekLoad({ ...salon(WEEK), closedDates: [{ id: 'c-1', name: 'Team day', start: '2026-10-08', end: '2026-10-09' }] }, tuesday('12:40'));
  assert.deepEqual(closed.map((day) => day.closed?.name ?? null), ['', null, null, 'Team day', 'Team day', null, '']);
  assert.deepEqual([closed[3].share, closed[4].share], [null, null]);
  // On Sunday evening the week is still the one that began six days earlier, and all of it but today is over.
  assert.deepEqual(weekLoad(salon(WEEK), new Date('2026-10-11T18:00:00Z')).map((day) => day.when), ['past', 'past', 'past', 'past', 'past', 'past', 'today']);
});

// ---------- the month as a line ----------

/** A haircut at 09:00 unless said otherwise: CHF 55 at list prices. */
const on = (id: string, date: string, startTime = '09:00') => at(id, startTime, `${startTime.slice(0, 2)}:30`, { date });
// By Monday 5 October, 12:00: three appointments have taken place, one is to come on the 20th.
// By Saturday 5 September, 12:00: two had; a third began that minute.
const MONTHS: CalendarEvent[] = [
  on('sep-a', '2026-09-01'), on('sep-b', '2026-09-05', '11:30'), on('sep-late', '2026-09-05', '12:00'),
  on('oct-a', '2026-10-01'), on('oct-b', '2026-10-02'), on('oct-c', '2026-10-05'), on('oct-later', '2026-10-20'),
];

test('the month\'s line adds up what its appointments are worth, day by day, and knows where the month stands now', () => {
  const curve = monthCurve(MONTHS, initialServices, FIXED_NOW, ZONE);
  const pace = monthPace(MONTHS, initialServices, FIXED_NOW, ZONE);
  // One point per day of October. The line steps up on the days with an appointment, the one still to come included.
  assert.equal(curve.days.length, 31);
  assert.deepEqual(curve.days.slice(0, 6), [1, 2, 3, 4, 5, 6].map((day) => ({ day, value: [55, 110, 110, 110, 165, 165][day - 1] })));
  assert.deepEqual([curve.days[18].value, curve.days[19].value, curve.days[30].value], [165, 220, 220]);
  // "Now" is noon on the 5th, four and a half days into the month, at the figure "Booked value so far".
  assert.deepEqual(curve.now, { at: 4.5, value: pace.soFar.value });
  assert.equal(curve.now.value, 165);
  // The line ends at what has taken place plus what is still to come.
  assert.equal(curve.days[30].value, pace.soFar.value + pace.stillToCome.value);
  // September beside it: thirty days, and the same point: noon on the 5th, when two appointments had begun.
  assert.equal(curve.before?.days.length, 30);
  assert.deepEqual(curve.before?.month, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual([curve.before?.days[0].value, curve.before?.days[4].value, curve.before?.days[29].value], [55, 165, 165]);
  assert.deepEqual(curve.before?.then, { at: 4.5, value: 110 });
  assert.equal(curve.before?.then.value, pace.before?.value);
  // A salon in its first month has no line to set beside its own.
  assert.equal(monthCurve(MONTHS.filter((event) => event.date >= '2026-10-01'), initialServices, FIXED_NOW, ZONE).before, null);
  // An appointment whose service has gone from the price list adds nothing to the line.
  const unpriced = monthCurve([...MONTHS, { ...on('gone', '2026-10-03'), serviceId: 'srv-deleted' }], initialServices, FIXED_NOW, ZONE);
  assert.deepEqual(unpriced.days.map((point) => point.value), curve.days.map((point) => point.value));
  // On the 31st the month before is read at its last day, as the figures do.
  const endOfOctober = monthCurve(MONTHS, initialServices, new Date('2026-10-31T11:00:00Z'), ZONE);
  assert.equal(endOfOctober.now.at, 30.5);
  assert.equal(endOfOctober.before?.then.at, 29.5);
});

// ---------- on the screen ----------

type Props = React.ComponentProps<typeof HomeView>;
const props = (events: CalendarEvent[], now: Date, partial: Partial<Props> = {}): Props => ({
  requests: [], selectedRequestId: null, now, conversations: [],
  availabilityContext: { requests: [], events, services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts, now, timeZone: ZONE },
  onAcceptRequest: nothing, onRejectRequest: nothing, onMoveRequest: () => null, onSimulateNewRequest: nothing,
  onOpenAppointment: nothing, onOpenCalendar: nothing, onOpenAnalytics: nothing, onOpenConversations: nothing, ...partial,
});
const home = (events: CalendarEvent[], now: Date, partial: Partial<Props> = {}) => render(React.createElement(HomeView, props(events, now, partial)));

/** Runs with a browser's globals standing in: here a window as wide as a laptop's, or what the browser has stored. */
const inBrowser = <T,>(globals: Record<string, unknown>, run: () => T): T => {
  const previous = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value });
  try { return run(); } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
};
/** The same page as a laptop draws it: the browser answers yes to the one question Home asks about its width. */
const wideHome = (events: CalendarEvent[], now: Date, partial: Partial<Props> = {}) => inBrowser({
  window: {
    matchMedia: (query: string) => ({ matches: query === WIDE_SCREEN, addEventListener: nothing, removeEventListener: nothing }),
    location: { pathname: '/', search: '' },
  },
}, () => home(events, now, partial));

const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
/** One card of the page, by the id of its heading. */
const cardOf = (html: string, title: string) => {
  const start = html.indexOf(`<section aria-labelledby="${title}"`);
  assert.ok(start >= 0, title);
  return html.slice(start, html.indexOf('</section>', start));
};
const CARDS = ['home-today-title', 'home-inbox-title', 'home-ai-title', 'home-week-title', 'home-month-title'];
/** The cards in the order they stand in the page, which is the order a keyboard and a screen reader meet them in. */
const order = (html: string) => CARDS.filter((id) => html.includes(`id="${id}"`)).sort((a, b) => html.indexOf(`id="${a}"`) - html.indexOf(`id="${b}"`)).map((id) => id.slice(5, -6));

test('"This week" shows each day with the share of its working hours that is booked, and a day leads to itself in the calendar', () => {
  const opened: (string | undefined)[] = [];
  const html = home(WEEK, tuesday('12:40'), { onOpenCalendar: (date) => opened.push(date) });
  const card = cardOf(html, 'home-week-title');
  assert.match(words(card), /^This week 05\.–11\.10\.2026 · 8 appointments /);
  // Seven days, each a button with a full tap target. What is drawn is also said, with the date in full.
  const days = Array.from(card.matchAll(/<button type="button" class="([^"]*)">(.*?)<\/button>/g), ([, classes, day]) => ({ classes, text: words(day) }));
  assert.deepEqual(days.map((day) => day.text), [
    'Closed Mon 05.10. Monday, 05.10.2026: closed, 1 appointment all the same. Open the day in the calendar.',
    '21% Tue Today Tuesday, 06.10.2026: 21% of working hours booked, 6 appointments. Open the day in the calendar.',
    `${bookedShare(salon(WEEK), ['2026-10-07']).share}% Wed 07.10. Wednesday, 07.10.2026: ${bookedShare(salon(WEEK), ['2026-10-07']).share}% of working hours booked, 1 appointment. Open the day in the calendar.`,
    '0% Thu 08.10. Thursday, 08.10.2026: 0% of working hours booked, no appointments. Open the day in the calendar.',
    '0% Fri 09.10. Friday, 09.10.2026: 0% of working hours booked, no appointments. Open the day in the calendar.',
    '0% Sat 10.10. Saturday, 10.10.2026: 0% of working hours booked, no appointments. Open the day in the calendar.',
    'Closed Sun 11.10. Sunday, 11.10.2026: closed. Open the day in the calendar.',
  ]);
  for (const day of days) assert.match(day.classes, /\bmin-h-11\b/);
  // The bars are a picture of the percentages beside them: a screen reader is given the sentence, not the bar.
  assert.equal(card.match(/<span aria-hidden="true" class="flex h-24 /g)?.length, 7);
  assert.match(card, /style="height:21%"/);
  // A closed day has no bar, and a day without a booking an empty one.
  assert.equal(card.match(/style="height:/g)?.length, 2);
  assert.match(words(card), /Share of working hours booked, day by day$/);
  // Without a way to the calendar the days are no buttons.
  assert.doesNotMatch(cardOf(home(WEEK, tuesday('12:40'), { onOpenCalendar: undefined }), 'home-week-title'), /<button/);
  // "Open calendar" still leads to today: it hands no date on.
  assert.match(cardOf(html, 'home-today-title'), />Open calendar</);
  assert.deepEqual(opened, []);
});

test('with "My day" chosen the week is the owner\'s own, and a closure is named', () => {
  const mine = inBrowser({ localStorage: { getItem: (key: string) => (key === HOME_DAY_VIEW_KEY ? 'mine' : null), setItem: nothing } },
    () => words(cardOf(home(WEEK, tuesday('12:40'), { me: { id: 'emp-1', name: 'Anna Weber' } }), 'home-week-title')));
  const own = bookedShare(salon(WEEK), ['2026-10-06'], ['emp-1']).share;
  assert.match(mine, /^This week 05\.–11\.10\.2026 · 6 appointments with you /);
  assert.ok(mine.includes(`Tuesday, 06.10.2026: ${own}% of your working hours booked, 4 appointments.`), mine);
  assert.match(mine, /Share of your working hours booked, day by day$/);
  const closure = { closedDates: [{ id: 'c-1', name: 'Team day', start: '2026-10-08', end: '2026-10-08' }] };
  const teamDay = home(WEEK, tuesday('12:40'), { availabilityContext: { ...props(WEEK, tuesday('12:40')).availabilityContext, ...closure } });
  assert.match(words(cardOf(teamDay, 'home-week-title')), /Closed Thu 08\.10\. Thursday, 08\.10\.2026: closed \(Team day\)\./);
});

test('the month is also drawn as a line, with its lines named and a sentence that says what it shows', () => {
  const chart = (events: CalendarEvent[]) => /Booked value by day .*$/.exec(words(cardOf(home(events, FIXED_NOW), 'home-month-title')))?.[0];
  assert.equal(chart(MONTHS), 'Booked value by day October September Booked ahead A line chart: what the appointments of October 2026 are worth at list prices, added up day by day, beside September. Use the left and right arrow keys to read a day.');
  // A first month is drawn alone.
  assert.equal(chart(MONTHS.filter((event) => event.date >= '2026-10-01')), 'Booked value by day October Booked ahead A line chart: what the appointments of October 2026 are worth at list prices, added up day by day. Use the left and right arrow keys to read a day.');
  // The chart can be reached and read with the keyboard, and what it reads out has a place to stand.
  const card = cardOf(home(MONTHS, FIXED_NOW), 'home-month-title');
  assert.match(card, /<div role="group" aria-labelledby="[^"]+" aria-describedby="[^"]+" tabindex="0"/);
  assert.match(card, /<p aria-live="polite" class="sr-only"><\/p>/);
  // Its scale is drawn, not written: the page's text holds no loose numbers, and no amount without its name.
  assert.match(card, /data-tick="31\."/);
  assert.doesNotMatch(words(card), /\b31\.(?!10\.)/);
  // Nothing of worth in the month and no month before: there is no line to draw, and the figures stand alone.
  const nothingToDraw = [{ ...on('gone', '2026-10-03'), serviceId: 'srv-deleted' }];
  assert.equal(chart(nothingToDraw), undefined);
  assert.match(words(cardOf(home(nothingToDraw, FIXED_NOW), 'home-month-title')), /Still to come 0 CHF 0\.00 booked, until 31\.10\.$/);
});

test('in the team\'s day every appointment wears its stylist\'s colour, as in the calendar', () => {
  const [anna, selina, luca] = STAFF_COLORS;
  const bars = (html: string) => Array.from(cardOf(html, 'home-today-title').matchAll(/<span aria-hidden="true" class="mt-0\.5 h-9 w-1 [^"]*" style="background-color:(#[0-9a-f]{6})"/g), ([, colour]) => colour);
  // 12:40 on Tuesday: the first appointment is over and wears the paler colour.
  assert.deepEqual(bars(home(WEEK, tuesday('12:40'))), [anna.pastAccent, anna.accent, selina.accent, anna.accent, luca.accent, anna.accent]);
  // Her own day is one person's: no colour is needed to tell anybody apart.
  const mine = inBrowser({ localStorage: { getItem: (key: string) => (key === HOME_DAY_VIEW_KEY ? 'mine' : null), setItem: nothing } },
    () => home(WEEK, tuesday('12:40'), { me: { id: 'emp-1', name: 'Anna Weber' } }));
  assert.deepEqual(bars(mine), []);
});

test('the AI\'s share of the month is drawn under its figure', () => {
  const card = cardOf(home(demoEvents, FIXED_NOW), 'home-ai-title');
  const share = /Bookings (\d+)% of appointments/.exec(words(card))?.[1];
  assert.ok(share);
  assert.match(card, new RegExp(`<span aria-hidden="true" class="block h-1\\.5 [^"]*bg-amber-100[^"]*"><span class="[^"]*bg-amber-500[^"]*" style="width:${share}%">`));
});

// ---------- one column, or a greeting and two columns ----------

test('a narrow screen sets the cards one below the other, in the order of what is needed first', () => {
  const html = home(demoEvents, FIXED_NOW, { requests: demoRequests, conversations: demoConversations, bookingLink: React.createElement('p', null, 'the booking link') });
  assert.deepEqual(order(html), ['today', 'inbox', 'ai', 'week', 'month']);
  // The greeting belongs to the wide screen: a phone names the page in its top bar and starts with today.
  assert.doesNotMatch(html, /Good (morning|afternoon|evening)/);
  assert.ok(html.indexOf('the booking link') > html.indexOf('home-month-title'));
});

test('a wide screen greets the owner, says whether the salon is open and puts the month first', () => {
  const anna = { id: 'emp-1', name: 'Anna Weber' };
  const html = wideHome(demoEvents, FIXED_NOW, { requests: demoRequests, conversations: demoConversations, me: anna, bookingLink: React.createElement('p', null, 'the booking link') });
  // Monday 5 October, 12:00: the afternoon of a day the salon does not open.
  assert.match(words(html), /^Home Good afternoon, Anna Closed today This month October 2026 · /);
  assert.match(html, /<h1 tabindex="-1" class="sr-only">Home<\/h1>/);
  // The same cards, in the order they stand on the screen: the month, the left column, then the inbox.
  assert.deepEqual(order(html), ['month', 'today', 'week', 'ai', 'inbox']);
  // Given the booking link as a card alone, the page keeps it: at the end of the left column, once.
  assert.equal(html.match(/the booking link/g)?.length, 1);
  assert.ok(html.indexOf('home-ai-title') < html.indexOf('the booking link') && html.indexOf('the booking link') < html.indexOf('home-inbox-title'));
  // Every card says what it says on a phone.
  const narrow = home(demoEvents, FIXED_NOW, { requests: demoRequests, conversations: demoConversations, me: anna, bookingLink: React.createElement('p', null, 'the booking link') });
  for (const id of CARDS) assert.equal(words(cardOf(html, id)), words(cardOf(narrow, id)), id);
  assert.doesNotMatch(readableText(html), TELL_WORDS);

  // The words beside the greeting follow the salon's clock.
  const chip = (now: Date, partial: Partial<Props> = {}) => /Good \w+(?:, \w+)? (.+?) This month/.exec(words(wideHome(demoEvents, now, { me: anna, ...partial })))?.[1];
  assert.equal(chip(tuesday('08:00')), 'Opens at 08:30');
  assert.equal(chip(tuesday('10:00')), 'Open until 18:30');
  assert.equal(chip(tuesday('19:00')), 'Closed for today');
  const closure = { closedDates: [{ id: 'c-1', name: 'Team day', start: '2026-10-06', end: '2026-10-06' }] };
  assert.equal(chip(tuesday('10:00'), { availabilityContext: { ...props(demoEvents, tuesday('10:00')).availabilityContext, ...closure } }), 'Closed today (Team day)');
  // Only while the salon is open is the dot green; the words say it either way.
  assert.match(wideHome(demoEvents, tuesday('10:00')), /bg-emerald-500"><\/span><span class="[^"]*">Open until 18:30</);
  assert.match(wideHome(demoEvents, tuesday('19:00')), /bg-slate-300"><\/span><span class="[^"]*">Closed for today</);
  // Nobody is signed in as one of the team: the greeting names nobody.
  assert.match(words(wideHome(demoEvents, tuesday('08:00'))), /^Home Good morning Opens at 08:30 /);
  assert.match(words(wideHome(demoEvents, tuesday('19:00'))), /^Home Good evening Closed for today /);
});

test('on a wide screen the booking link is two buttons beside the greeting, and takes no card', () => {
  const link = { bookingLink: React.createElement('p', null, 'the link card'), bookingLinkButtons: React.createElement('p', null, 'the link buttons') };
  const html = wideHome(demoEvents, FIXED_NOW, { requests: demoRequests, conversations: demoConversations, ...link });
  // In the row of the greeting: after the words about the salon being open, before the first card.
  assert.match(words(html), /^Home Good afternoon Closed today the link buttons This month October 2026 · /);
  assert.equal(html.match(/the link buttons/g)?.length, 1);
  // The buttons take the card's place: the left column ends with a card of the salon's own figures.
  assert.doesNotMatch(html, /the link card/);
  assert.deepEqual(order(html), ['month', 'today', 'week', 'ai', 'inbox']);
  // A phone has no such row: it keeps the card, at the end of the page.
  const narrow = home(demoEvents, FIXED_NOW, { requests: demoRequests, conversations: demoConversations, ...link });
  assert.doesNotMatch(narrow, /the link buttons/);
  assert.equal(narrow.match(/the link card/g)?.length, 1);
  assert.ok(narrow.indexOf('the link card') > narrow.indexOf('home-month-title'));
  // A salon that has not begun is told to pass its link on, and finds it there: the card under "Getting started", and no second copy.
  const start = wideHome([], tuesday('10:00'), link);
  assert.doesNotMatch(start, /the link buttons/);
  assert.equal(start.match(/the link card/g)?.length, 1);
  assert.ok(start.indexOf('home-start-title') < start.indexOf('the link card') && start.indexOf('the link card') < start.indexOf('home-today-title'));
});

test('on a wide screen the AI\'s card stands in the shorter column: beside a long inbox, under a short one', () => {
  const chat = (id: string, status: Conversation['status']): Conversation => ({
    id, customerName: `Chat ${id}`, initials: 'C', avatarColor: 'bg-rose-100 text-rose-700', language: 'DE', phone: '', channel: 'Website', status, lastTime: '11:00', messages: [],
  });
  const left = ['month', 'today', 'week', 'ai', 'inbox'];
  const right = ['month', 'today', 'week', 'inbox', 'ai'];
  // Monday, with the salon closed: Today is a few lines. Six entries wait (three of them requests from chats, each
  // with what was checked): the inbox is by far the longer column, and the AI's card stands on the left, under the week.
  assert.deepEqual(order(wideHome(demoEvents, FIXED_NOW, { requests: demoRequests, conversations: demoConversations })), left);
  // Two requests, one chat, nothing: the inbox is the shorter column, and the AI's card stands under it.
  for (const short of [
    wideHome(demoEvents, FIXED_NOW, { requests: demoRequests }),
    wideHome(demoEvents, FIXED_NOW, { conversations: [chat('a', 'needs-attention')] }),
    wideHome(demoEvents, FIXED_NOW),
  ]) assert.deepEqual(order(short), right);
  // What decides is how long the two columns are, not how many entries wait. Two requests and two chats are
  // longer than the Today of a closed Monday, and shorter than the Today of a Tuesday with six appointments.
  const four = { requests: demoRequests, conversations: [chat('a', 'needs-attention'), chat('b', 'needs-attention')] };
  assert.deepEqual(order(wideHome(demoEvents, FIXED_NOW, four)), left);
  assert.deepEqual(order(wideHome(WEEK, tuesday('12:40'), four)), right);
});

test('a salon that has not begun is greeted and shown how to start, on a wide screen too', () => {
  const html = wideHome([], tuesday('10:00'), { bookingLink: React.createElement('p', null, 'the booking link') });
  assert.match(words(html), /^Home Good morning Open until 18:30 Getting started Your calendar is still empty\./);
  // No figures, no week and no line: each would be a row of zeros.
  assert.deepEqual(order(html), ['today', 'inbox']);
  assert.equal(html.match(/the booking link/g)?.length, 1);
});
