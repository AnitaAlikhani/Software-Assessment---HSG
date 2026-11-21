import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { appointmentFromRequest } from '../src/appointmentActions';
import { latestAiBookings, todayOverview } from '../src/dashboard';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import type { CalendarEvent } from '../src/types';
import { HomeView } from '../src/views/HomeView';
import { demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { render } from './renderHelpers';

// Home opens with today: the day's appointments in the order of their start, the next one
// marked, and a sentence for a day that is closed, empty or over. Below the inbox it lists what
// the AI booked last. Every test fixes its moment; none reads the clock.

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
  assert.match(card, /<li class="hidden xl:block">/);
  assert.match(card, /<button type="button" aria-expanded="false" aria-controls="home-today-list"[^>]*>Show all 6 appointments</);
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
  assert.match(monday, /^Today Open calendar Monday, 05\.10\.2026 The salon is closed today\. No appointments\. Next appointment Tue, 06\.10\.2026, 09:00–09:30 Customer early · Haircut · Anna Weber$/);
  // Closed, but somebody is booked all the same.
  assert.match(words(todayCard(home(TUESDAY, FIXED_NOW))), /The salon is closed today\. One appointment is in the calendar all the same\. 10:00–10:30/);
  const closure = { closedDates: [{ id: 'c-1', name: 'Team day', start: '2026-10-06', end: '2026-10-06' }] };
  const teamDay = home(TUESDAY, tuesday('10:00'), { availabilityContext: { requests: [], events: TUESDAY, services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts, timeZone: ZONE, ...closure } });
  assert.match(words(todayCard(teamDay)), /The salon is closed today \(Team day\)\. 6 appointments are in the calendar all the same\./);
  // An open day without appointments.
  const empty = words(todayCard(home([], tuesday('10:00'))));
  assert.equal(empty, 'Today Open calendar Tuesday, 06.10.2026 No appointments today.');
  // The day is over: all rows are folded on a phone, and the card leads to tomorrow.
  const over = todayCard(home(TUESDAY, tuesday('16:00')));
  assert.match(words(over), /All 6 appointments of today are over\./);
  assert.ok(rows(over).slice(0, 6).every((row) => row.hidden));
  assert.match(words(over), /Show all 6 appointments Next appointment Wed, 07\.10\.2026, 08:30–09:00 Customer wednesday · Haircut · Anna Weber$/);
  assert.match(words(todayCard(home(TUESDAY.filter((event) => event.id === 'early'), tuesday('16:00')))), /Today’s appointment is over\./);
  // The link to the calendar is offered only when it leads somewhere.
  assert.doesNotMatch(todayCard(home(TUESDAY, tuesday('10:00'), { onOpenCalendar: undefined })), /Open calendar/);
});

test('Home lists what the AI booked last, each a way to its appointment', () => {
  const card = cardOf(home(demoEvents, FIXED_NOW), 'home-ai-title');
  assert.match(words(card), /^Booked by the AI The newest bookings first\. Marie Dupont Booked 3 hours ago Haircut · Thu, 08\.10\.2026, 13:30–14:00 Lara Rüegg Booked 14 hours ago Colouring · Fri, 09\.10\.2026, 11:00–12:30 John Bennett Booked 18 hours ago Haircut · Wed, 07\.10\.2026, 15:00–15:30/);
  assert.equal(card.match(/<button/g)?.length, 5);
  assert.match(card, /Booked 2 days ago/);
  // Without a booking by the AI the card says so.
  assert.equal(words(cardOf(home(TUESDAY, FIXED_NOW), 'home-ai-title')), 'Booked by the AI The AI has not booked an appointment yet.');
});
