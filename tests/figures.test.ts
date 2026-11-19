import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {
  analyticsPeriods, analyticsReport, appointmentAnalytics, appointmentBuckets, axisTicks,
  conversationAnalytics, conversationsWaiting, periodLabel,
} from '../src/analytics';
import { appointmentFromRequest, upsertAppointment } from '../src/appointmentActions';
import { createCsv, fileSlug } from '../src/csv';
import { homeFigures } from '../src/dashboard';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { getSalonNow } from '../src/scheduling';
import type { CalendarEvent, Conversation } from '../src/types';
import { AnalyticsView } from '../src/views/AnalyticsView';
import { HomeView } from '../src/views/HomeView';
import { demoConversations, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// The figures on Home and in Analytics are counted from the calendar and the chats, by the same
// functions, for the same periods. These tests fix the moment (Monday 5 October 2026, 12:00 in
// Zurich) and never read the clock.

const ZONE = 'Europe/Zurich';
const SALON = 'Bella Hair Salon';
const nothing = () => {};

/** An appointment for a customer of its own, so every figure can be counted by hand. */
const appointment = (id: string, date: string, startTime: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  ...demoEvents[0], id, customerId: `customer-${id}`, customerName: `Customer ${id}`, conversationId: undefined,
  date, startTime, endTime: `${startTime.slice(0, 2)}:30`, isAiBooked: false, ...extra,
});

// Eight appointments around the fixed moment. Counted by hand: six in October, three today
// (one at 09:00 is over, one starts this minute, one at 15:00), four this week, two booked by
// the AI in October, five different customers, four still to come.
const HAND_COUNTED: CalendarEvent[] = [
  appointment('september', '2026-09-30', '10:00'),
  appointment('first', '2026-10-01', '09:00', { isAiBooked: true }),
  appointment('morning', '2026-10-05', '09:00'),
  appointment('now', '2026-10-05', '12:00', { isAiBooked: true }),
  appointment('afternoon', '2026-10-05', '15:00', { customerId: 'customer-morning', customerName: 'Customer morning' }),
  appointment('saturday', '2026-10-10', '11:00'),
  appointment('last', '2026-10-31', '15:00'),
  appointment('november', '2026-11-01', '09:00', { isAiBooked: true }),
];

test('the periods are the salon\'s day, its week from Monday to Sunday and its calendar month', () => {
  assert.deepEqual(analyticsPeriods('2026-10-05'), {
    today: { from: '2026-10-05', to: '2026-10-05' },
    week: { from: '2026-10-05', to: '2026-10-11' },
    month: { from: '2026-10-01', to: '2026-10-31' },
  });
  // A Sunday belongs to the week that began six days earlier; February of a leap year has 29 days.
  assert.deepEqual(analyticsPeriods('2028-02-27').week, { from: '2028-02-21', to: '2028-02-27' });
  assert.deepEqual(analyticsPeriods('2028-02-27').month, { from: '2028-02-01', to: '2028-02-29' });
  // A period in words, in the Swiss forms: one day, a whole month, and spans that say what both ends share once.
  assert.equal(periodLabel({ from: '2026-10-05', to: '2026-10-05' }), 'Mon, 05.10.2026');
  assert.equal(periodLabel({ from: '2026-10-01', to: '2026-10-31' }), 'October 2026');
  assert.equal(periodLabel({ from: '2026-10-05', to: '2026-10-11' }), '05.–11.10.2026');
  assert.equal(periodLabel({ from: '2026-09-28', to: '2026-10-04' }), '28.09.–04.10.2026');
  assert.equal(periodLabel({ from: '2026-12-28', to: '2027-01-03' }), '28.12.2026–03.01.2027');
});

test('Home\'s figures for a fixed moment are the appointments of today, this week and this month', () => {
  assert.deepEqual(homeFigures(HAND_COUNTED, FIXED_NOW, ZONE), {
    month: { from: '2026-10-01', to: '2026-10-31' },
    appointments: 6, today: 3, week: 4, aiBookings: 2, aiShare: 33, customers: 5, stillToCome: 4,
  });
  // One minute later the appointment that began at 12:00 is no longer "still to come".
  assert.equal(homeFigures(HAND_COUNTED, new Date(FIXED_NOW.getTime() + 60_000), ZONE).stillToCome, 3);
  // An empty calendar gives zeros and no share, not a percentage of nothing.
  assert.deepEqual(homeFigures([], FIXED_NOW, ZONE), {
    month: { from: '2026-10-01', to: '2026-10-31' },
    appointments: 0, today: 0, week: 0, aiBookings: 0, aiShare: null, customers: 0, stillToCome: 0,
  });
});

test('the day and the month follow the salon\'s clock, and a week may reach into the next month', () => {
  // 23:30 UTC on 31 October is 00:30 on 1 November in Zurich: the month is November.
  const afterMidnight = homeFigures(HAND_COUNTED, new Date('2026-10-31T23:30:00Z'), ZONE);
  assert.deepEqual(afterMidnight.month, { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual([afterMidnight.appointments, afterMidnight.today, afterMidnight.aiBookings, afterMidnight.stillToCome], [1, 1, 1, 1]);
  // Company Settings store the zone with a suffix; it is the same zone.
  assert.deepEqual(homeFigures(HAND_COUNTED, FIXED_NOW, 'Europe/Zurich (GMT+01:00)'), homeFigures(HAND_COUNTED, FIXED_NOW, ZONE));
  // Friday 30 October: the week runs to Sunday 1 November and counts the appointment of that day.
  const monthEnd = homeFigures(HAND_COUNTED, new Date('2026-10-30T10:00:00Z'), ZONE);
  assert.equal(monthEnd.week, 2);
  assert.equal(monthEnd.appointments, 6);
});

test('the seeded salon: every figure equals a plain count over the calendar', () => {
  const figures = homeFigures(demoEvents, FIXED_NOW, ZONE);
  const october = demoEvents.filter((event) => event.date.startsWith('2026-10'));
  assert.ok(october.length > 60, 'the month is filled');
  assert.equal(figures.appointments, october.length);
  assert.equal(figures.today, demoEvents.filter((event) => event.date === '2026-10-05').length);
  assert.equal(figures.week, demoEvents.filter((event) => event.date >= '2026-10-05' && event.date <= '2026-10-11').length);
  assert.equal(figures.aiBookings, october.filter((event) => event.isAiBooked).length);
  assert.equal(figures.aiShare, Math.round(figures.aiBookings / october.length * 100));
  assert.equal(figures.customers, new Set(october.map((event) => event.customerId)).size);
  assert.equal(figures.stillToCome, october.filter((event) => `${event.date} ${event.startTime}` >= '2026-10-05 12:00').length);
});

// ---------- the two screens ----------

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const home = (events: CalendarEvent[], conversations: Conversation[] = demoConversations, requests = demoRequests) =>
  render(React.createElement(HomeView, {
    requests, selectedRequestId: null, onSelectRequest: nothing, now: FIXED_NOW,
    availabilityContext: { requests, events, services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts, now: FIXED_NOW, timeZone: ZONE },
    onAcceptRequest: nothing, onRejectRequest: nothing, onMoveRequest: () => null, onSimulateNewRequest: nothing,
    nextAppointment: null, onOpenAppointment: nothing, onExportReport: nothing, onOpenAnalytics: nothing,
    conversations, onOpenConversations: nothing,
  }));

const analytics = (events: CalendarEvent[], conversations: Conversation[] = demoConversations) =>
  render(React.createElement(AnalyticsView, { events, conversations, companyName: SALON, timeZone: ZONE, now: FIXED_NOW, onExportReport: nothing }));

/** The numbers a person reads in Home's "This month" block. */
const homeNumbers = (html: string) => {
  const match = /This month (.+?) · past and upcoming appointments .*?(\d+) Appointments (\d+) today, (\d+) this week (\d+%|–) Booked by AI (\d+) of (\d+) appointments? (\d+) Customers with (?:an appointment|appointments) (\d+) Still to come (\d+) so far/.exec(text(html));
  assert.ok(match, 'Home shows the block "This month"');
  const [, period, appointments, today, week, aiShare, aiBookings, ofAppointments, customers, stillToCome, soFar] = match;
  assert.equal(ofAppointments, appointments);
  return { period, appointments: Number(appointments), today: Number(today), week: Number(week), aiShare, aiBookings: Number(aiBookings), customers: Number(customers), stillToCome: Number(stillToCome), soFar: Number(soFar) };
};

/** The numbers a person reads in Analytics, which opens on "This month". */
const analyticsNumbers = (html: string) => {
  const page = text(html);
  const headline = /(\d+) appointments? ([^·]+?)(?: · (\d+) so far, (\d+) still to come| · all still to come)? (?:0 |No appointments|Customers with)/.exec(page);
  const cards = /Customers with appointments (\d+) Booked by AI (\d+) (?:(\d+%) of appointments )?Other bookings (\d+)/.exec(page);
  assert.ok(headline && cards, 'Analytics shows its headline and its three figures');
  const appointments = Number(headline[1]);
  return {
    period: headline[2].trim(), appointments,
    soFar: headline[3] === undefined ? (page.includes('all still to come') ? 0 : appointments) : Number(headline[3]),
    stillToCome: headline[4] === undefined ? (page.includes('all still to come') ? appointments : 0) : Number(headline[4]),
    customers: Number(cards[1]), aiBookings: Number(cards[2]), aiShare: cards[3] ?? '–', otherBookings: Number(cards[4]),
  };
};

const assertScreensAgree = (events: CalendarEvent[]) => {
  const onHome = homeNumbers(home(events));
  const inAnalytics = analyticsNumbers(analytics(events));
  const figures = homeFigures(events, FIXED_NOW, ZONE);
  // Home shows what the shared calculation gives ...
  assert.deepEqual(
    [onHome.appointments, onHome.today, onHome.week, onHome.aiBookings, onHome.customers, onHome.stillToCome, onHome.aiShare],
    [figures.appointments, figures.today, figures.week, figures.aiBookings, figures.customers, figures.stillToCome, figures.aiShare === null ? '–' : `${figures.aiShare}%`],
  );
  // ... and Analytics, opened on the same month, shows the same numbers.
  for (const key of ['period', 'appointments', 'aiBookings', 'aiShare', 'customers', 'stillToCome', 'soFar'] as const) {
    assert.equal(inAnalytics[key], onHome[key], key);
  }
  assert.equal(inAnalytics.otherBookings, onHome.appointments - onHome.aiBookings);
  assert.equal(onHome.soFar + onHome.stillToCome, onHome.appointments);
  return onHome;
};

test('Home and Analytics show the same figures for the month', () => {
  const seeded = assertScreensAgree(demoEvents);
  assert.equal(seeded.period, 'October 2026');
  assert.equal(seeded.appointments, demoEvents.filter((event) => event.date.startsWith('2026-10')).length);
  assert.deepEqual(assertScreensAgree(HAND_COUNTED), {
    period: 'October 2026', appointments: 6, today: 3, week: 4, aiShare: '33%', aiBookings: 2, customers: 5, stillToCome: 4, soFar: 2,
  });
  // The presets of Analytics are the periods Home counts for.
  const periods = analyticsPeriods(getSalonNow(ZONE, FIXED_NOW).date);
  const figures = homeFigures(demoEvents, FIXED_NOW, ZONE);
  assert.equal(appointmentAnalytics(demoEvents, periods.today.from, periods.today.to).total, figures.today);
  assert.equal(appointmentAnalytics(demoEvents, periods.week.from, periods.week.to).total, figures.week);
  const page = analytics(demoEvents);
  for (const preset of ['Today', 'This week', 'This month']) assert.match(page, new RegExp(`aria-pressed="(true|false)"[^>]*>${preset}<`));
  assert.match(page, /aria-pressed="true"[^>]*>This month</);
  assert.match(page, /value="2026-10-01"/);
  assert.match(page, /value="2026-10-31"/);
});

test('a single appointment and an empty calendar are worded correctly on both screens', () => {
  const one = [appointment('only', '2026-10-06', '10:00', { isAiBooked: true })];
  assert.match(text(home(one)), /1 Appointments 0 today, 1 this week 100% Booked by AI 1 of 1 appointment 1 Customers with an appointment 1 Still to come 0 so far/);
  assert.match(text(analytics(one)), /1 appointment October 2026 · all still to come/);
  assert.match(text(home([])), /0 Appointments 0 today, 0 this week – Booked by AI 0 of 0 appointments 0 Customers with appointments 0 Still to come 0 so far/);
  const empty = analytics([]);
  assert.match(text(empty), /0 appointments October 2026 No appointments in this period\./);
  assert.doesNotMatch(empty, /aria-label="Appointment chart"/);
  assert.doesNotMatch(text(empty), /% of appointments/);
});

test('the figures follow a booking and a cancellation at once, on both screens', () => {
  const before = assertScreensAgree(demoEvents);

  // The owner accepts a pending request that the AI took: an appointment on Wednesday 7 October.
  // Date and source are set here, so the test does not depend on what the starting data hold.
  const request = { ...demoRequests[0], date: '2026-10-07', timeStr: '10:00 - 10:30', isAiBooked: true };
  const accepted = { ...appointmentFromRequest(request, initialServices, initialEmployees), createdAt: FIXED_NOW.toISOString() };
  assert.deepEqual([accepted.date, accepted.startTime, accepted.isAiBooked], ['2026-10-07', '10:00', true]);
  const booked = upsertAppointment(demoEvents, accepted);
  const afterAccept = assertScreensAgree(booked);
  const alreadyCountedCustomer = demoEvents.some((event) => event.customerId === request.customerId && event.date.startsWith('2026-10'));
  assert.deepEqual(afterAccept, {
    ...before,
    appointments: before.appointments + 1, week: before.week + 1, aiBookings: before.aiBookings + 1,
    customers: before.customers + (alreadyCountedCustomer ? 0 : 1), stillToCome: before.stillToCome + 1,
    aiShare: `${Math.round((before.aiBookings + 1) / (before.appointments + 1) * 100)}%`,
  });

  // The owner adds an appointment for this afternoon by hand: it counts for today, not for the AI.
  const walkIn = appointment('walk-in', '2026-10-05', '15:00');
  const withWalkIn = upsertAppointment(booked, walkIn);
  const afterWalkIn = assertScreensAgree(withWalkIn);
  assert.deepEqual(
    [afterWalkIn.appointments, afterWalkIn.today, afterWalkIn.week, afterWalkIn.aiBookings, afterWalkIn.customers, afterWalkIn.stillToCome],
    [afterAccept.appointments + 1, afterAccept.today + 1, afterAccept.week + 1, afterAccept.aiBookings, afterAccept.customers + 1, afterAccept.stillToCome + 1],
  );

  // Moving the accepted appointment into November takes it out of this month's figures.
  const moved = upsertAppointment(withWalkIn, { ...accepted, date: '2026-11-03' });
  assert.equal(assertScreensAgree(moved).appointments, afterWalkIn.appointments - 1);

  // Both cancelled: every figure is back where it was.
  const cancelled = moved.filter((event) => event.id !== accepted.id && event.id !== walkIn.id);
  assert.deepEqual(assertScreensAgree(cancelled), before);
});

test('Analytics counts a chosen period: the bars, their table and the three figures use the same appointments', () => {
  const result = appointmentAnalytics(HAND_COUNTED, '2026-10-01', '2026-10-31', { date: '2026-10-05', time: '12:00' });
  assert.deepEqual([result.total, result.aiBookings, result.otherBookings, result.aiShare, result.customers, result.stillToCome], [6, 2, 4, 33, 5, 4]);
  assert.equal(result.series.length, 31);
  assert.deepEqual(result.series[4], { date: '2026-10-05', count: 3, aiBookings: 1 });
  assert.equal(result.series.reduce((sum, day) => sum + day.count, 0), result.total);
  assert.equal(result.series.reduce((sum, day) => sum + day.aiBookings, 0), result.aiBookings);
  // Without a clock nothing is claimed about what is still to come.
  assert.equal(appointmentAnalytics(HAND_COUNTED, '2026-10-01', '2026-10-31').stillToCome, null);

  const page = analytics(HAND_COUNTED);
  // The table under the chart lists the days with appointments, in the Calendar's wording, without rows of zeros.
  const rows = Array.from(page.matchAll(/<tr class="border-t[^"]*"><th scope="row"[^>]*>([^<]+)<\/th><td[^>]*>(\d+)<\/td><td[^>]*>(\d+)<\/td><\/tr>/g), (row) => row.slice(1));
  assert.deepEqual(rows, [['Thu 01.10.', '1', '1'], ['Mon 05.10.', '3', '1'], ['Sat 10.10.', '1', '0'], ['Sat 31.10.', '1', '0']]);
  assert.match(page, />Appointments per day</);
  // No date in the form 2026-10-05 is shown; the date fields hold it only as their value.
  assert.doesNotMatch(readableText(page), /\d{4}-\d{2}-\d{2}/);
});

test('the chart groups a long period into weeks and months and has a round scale', () => {
  const series = (from: string, to: string) => appointmentAnalytics(HAND_COUNTED, from, to).series;
  const month = appointmentBuckets(series('2026-10-01', '2026-10-31'));
  assert.equal(month.unit, 'day');
  assert.equal(month.buckets.length, 31);
  assert.deepEqual(month.buckets[4], { from: '2026-10-05', to: '2026-10-05', count: 3, aiBookings: 1 });

  const quarter = appointmentBuckets(series('2026-09-28', '2026-11-08'));
  assert.equal(quarter.unit, 'week');
  assert.deepEqual(quarter.buckets.map((bucket) => [bucket.from, bucket.to, bucket.count, bucket.aiBookings]), [
    ['2026-09-28', '2026-10-04', 2, 1],
    ['2026-10-05', '2026-10-11', 4, 1],
    ['2026-10-12', '2026-10-18', 0, 0],
    ['2026-10-19', '2026-10-25', 0, 0],
    ['2026-10-26', '2026-11-01', 2, 1],
    ['2026-11-02', '2026-11-08', 0, 0],
  ]);
  // A period that starts or ends inside a week or month gets a shorter first or last bar.
  const partial = appointmentBuckets(series('2026-09-30', '2026-11-04'));
  assert.deepEqual([partial.buckets[0].from, partial.buckets[0].to], ['2026-09-30', '2026-10-04']);
  assert.deepEqual([partial.buckets.at(-1)!.from, partial.buckets.at(-1)!.to], ['2026-11-02', '2026-11-04']);

  const year = appointmentBuckets(series('2026-01-15', '2026-12-31'));
  assert.equal(year.unit, 'month');
  assert.equal(year.buckets.length, 12);
  assert.deepEqual(year.buckets[0], { from: '2026-01-15', to: '2026-01-31', count: 0, aiBookings: 0 });
  assert.deepEqual(year.buckets[9], { from: '2026-10-01', to: '2026-10-31', count: 6, aiBookings: 2 });
  // However the days are grouped, no appointment is lost or counted twice.
  const total = (grouped: typeof month) => grouped.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  assert.deepEqual([total(month), total(quarter), total(partial), total(year)], [6, 8, 8, 8]);

  assert.deepEqual(axisTicks(0), [0, 1]);
  assert.deepEqual(axisTicks(1), [0, 1]);
  assert.deepEqual(axisTicks(4), [0, 1, 2, 3, 4]);
  assert.deepEqual(axisTicks(9), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(axisTicks(11), [0, 5, 10, 15]);
  assert.deepEqual(axisTicks(44), [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(axisTicks(184), [0, 50, 100, 150, 200]);
});

// ---------- chats ----------

const liveChat = (id: string, partial: Partial<Conversation> = {}): Conversation => ({
  id: `live-web-${id}`, live: true, customerName: `Visitor ${id}`, initials: 'V', avatarColor: 'bg-green-100 text-green-700',
  language: 'EN', languageLabel: 'English', phone: '', channel: 'Website', status: 'ai-handled', lastTime: '11:58',
  messages: [
    { id: `${id}-1`, sender: 'customer', original: 'Hola', translation: 'Hello', time: '11:57' },
    { id: `${id}-2`, sender: 'ai', original: 'Hola, ¿en qué puedo ayudarle?', translation: 'Hello, how can I help you?', time: '11:58' },
  ],
  ...partial,
});

test('Home\'s chat card counts live chats as the header does and shows the newest that wait', () => {
  const waitingLive = liveChat('one', { status: 'needs-attention', attentionReason: 'The customer asked for a discount.', languageLabel: 'Spanish' });
  // As the app joins them: live chats first, then the others.
  const all = [waitingLive, liveChat('two'), ...demoConversations];
  const sampleWaiting = demoConversations.filter((chat) => chat.status === 'needs-attention');
  assert.ok(sampleWaiting.length >= 2, 'some sample chats wait for the owner');
  const waiting = conversationsWaiting(all);
  assert.deepEqual(waiting.map((chat) => chat.id), ['live-web-one', ...sampleWaiting.map((chat) => chat.id)]);

  // The card shows the count the header is given, and the two newest chats that wait.
  const withLive = home(demoEvents, all);
  assert.ok(withLive.includes(`>${waiting.length} need you<`));
  assert.match(withLive, />Visitor one</);
  assert.ok(withLive.includes(`>${sampleWaiting[0].customerName}<`));
  assert.ok(!withLive.includes(`>${sampleWaiting[1].customerName}<`));
  // The language the AI detected, not the code "EN" that stands in for every other language.
  assert.match(withLive, />Spanish</);
  assert.doesNotMatch(withLive, />Visitor two</);

  // Without a live key the card counts the sample chats that wait.
  const withoutLive = home(demoEvents);
  assert.ok(withoutLive.includes(`>${sampleWaiting.length} need you<`));
  assert.doesNotMatch(withoutLive, /Visitor/);
  // Nobody waiting: no count, the two newest chats are listed.
  const handled = demoConversations.map((chat) => ({ ...chat, status: 'ai-handled' as const }));
  const calm = home(demoEvents, handled);
  assert.doesNotMatch(calm, /need you/);
  assert.match(calm, new RegExp(`>${handled[0].customerName}<`));
  assert.match(home(demoEvents, []), /No conversations yet\./);
});

test('messages and languages in Analytics include live chats', () => {
  const all = [
    liveChat('one', { status: 'needs-attention', languageLabel: 'Spanish' }),
    liveChat('two', { languageLabel: 'spanish' }),
    liveChat('three', { language: 'DE', languageLabel: 'German' }),
    // A live chat stored without the detected name falls back to its language code.
    liveChat('four', { language: 'IT', languageLabel: undefined }),
    ...demoConversations,
  ];
  const sample = conversationAnalytics(demoConversations);
  const result = conversationAnalytics(all);
  assert.equal(result.conversations, demoConversations.length + 4);
  assert.equal(result.waiting, sample.waiting + 1);
  assert.equal(result.total, sample.total + 8);
  assert.equal(result.customer, sample.customer + 4);
  assert.equal(result.ai, sample.ai + 4);
  assert.equal(result.customer + result.ai + result.owner, result.total);
  const count = (list: typeof result.languages, name: string) => list.find((item) => item.name === name)?.count;
  assert.deepEqual(result.languages.map((item) => item.name), ['English', 'French', 'German', 'Italian', 'Spanish']);
  assert.equal(count(result.languages, 'Spanish'), 2);
  assert.equal(count(result.languages, 'English'), count(sample.languages, 'English'));
  assert.equal(count(result.languages, 'German'), count(sample.languages, 'German')! + 1);
  assert.equal(count(result.languages, 'Italian'), count(sample.languages, 'Italian')! + 1);
  assert.equal(result.languages.reduce((sum, item) => sum + item.count, 0), all.length);
  // The four languages the salon answers in are listed even when no chat is in them.
  assert.deepEqual(conversationAnalytics([]).languages, ['English', 'French', 'German', 'Italian'].map((name) => ({ name, count: 0 })));
});

// ---------- wording ----------

test('Home and Analytics name no sample data and show only figures the data can answer', () => {
  for (const page of [home(demoEvents), home([], [], []), analytics(demoEvents), analytics([], [])]) {
    assert.doesNotMatch(readableText(page), TELL_WORDS);
    assert.doesNotMatch(readableText(page), /participant|illustrative|this tab/i);
    // Messages per day, enquiries after hours and reply times need dated messages; revenue,
    // cancellations and no-shows are not recorded. None of them is shown.
    assert.doesNotMatch(readableText(page), /after.hours|reply time|messages today|revenue|CHF|no.show|cancell/i);
  }
  const page = home(demoEvents);
  assert.match(page, />This month</);
  assert.match(page, />View analytics</);
  assert.match(page, /aria-label="Export CSV for this month"/);
  assert.match(page, />Export CSV</);
  // The link to Analytics is offered only when it leads somewhere.
  const withoutLink = render(React.createElement(HomeView, {
    requests: [], selectedRequestId: null, onSelectRequest: nothing, now: FIXED_NOW,
    availabilityContext: { requests: [], events: [], services: [], employees: [], bookingHours: [], shiftOverview: [], now: FIXED_NOW, timeZone: ZONE },
    onAcceptRequest: nothing, onRejectRequest: nothing, onMoveRequest: () => null, onSimulateNewRequest: nothing,
    nextAppointment: null, onOpenAppointment: nothing, onExportReport: nothing, conversations: [], onOpenConversations: nothing,
  }));
  assert.doesNotMatch(withoutLink, /View analytics/);
  // Analytics names the salon as text, offers the export for the chosen period, and nothing looks like a second control.
  const inAnalytics = analytics(demoEvents);
  assert.match(inAnalytics, /Bella Hair Salon · counted from your calendar and conversations/);
  assert.equal(inAnalytics.match(/>Export CSV</g)?.length, 1);
  assert.doesNotMatch(render(React.createElement(AnalyticsView, { events: demoEvents, conversations: [], companyName: SALON, timeZone: ZONE, now: FIXED_NOW })), /Export CSV/);
});

// ---------- the export ----------

test('the export holds the figures on screen and every appointment behind them', () => {
  const clock = getSalonNow(ZONE, FIXED_NOW);
  const period = analyticsPeriods(clock.date).month;
  const report = analyticsReport({ companyName: SALON, events: demoEvents, period, clock })!;
  assert.equal(report.fileName, 'bella-hair-salon-appointments-2026-10.csv');

  const onScreen = homeNumbers(home(demoEvents));
  const october = demoEvents.filter((event) => event.date.startsWith('2026-10'));
  assert.deepEqual(report.rows.slice(0, 12), [
    ['Salon', 'Bella Hair Salon'],
    ['Period', '2026-10-01', '2026-10-31'],
    ['Exported', '2026-10-05 12:00'],
    [],
    ['Appointments', onScreen.appointments],
    ['Booked by AI', onScreen.aiBookings],
    ['Booked by AI (%)', Number(onScreen.aiShare.replace('%', ''))],
    ['Other bookings', onScreen.appointments - onScreen.aiBookings],
    ['Customers with appointments', onScreen.customers],
    ['Still to come', onScreen.stillToCome],
    [],
    ['Date', 'Start', 'End', 'Customer', 'Service', 'Staff', 'Booked by AI'],
  ]);
  const rows = report.rows.slice(12);
  assert.equal(rows.length, october.length);
  // In the order of the calendar, with the stylist and whether the AI booked it.
  const order = rows.map((row) => `${row[0]} ${row[1]}`);
  assert.deepEqual(order, [...order].sort());
  assert.ok(rows.every((row) => row.length === 7 && String(row[0]).startsWith('2026-10-') && ['Yes', 'No'].includes(String(row[6]))));
  assert.equal(rows.filter((row) => row[6] === 'Yes').length, onScreen.aiBookings);
  const sample = october.find((event) => event.isAiBooked)!;
  assert.deepEqual(rows.find((row) => row[0] === sample.date && row[1] === sample.startTime && row[3] === sample.customerName),
    [sample.date, sample.startTime, sample.endTime, sample.customerName, sample.serviceName, sample.staffName, 'Yes']);
  // No price, phone number or e-mail address leaves with the file.
  assert.doesNotMatch(JSON.stringify(report.rows), /CHF|\+41|@/);
  assert.doesNotMatch(JSON.stringify(report), /sample|demo|illustrative/i);

  // As a file: a spreadsheet opens it with umlauts intact, one line per row, an empty line between the parts.
  const csv = createCsv(report.rows);
  assert.ok(csv.startsWith('\uFEFF"Salon";"Bella Hair Salon"\r\n"Period";"2026-10-01";"2026-10-31"\r\n"Exported";"2026-10-05 12:00"\r\n\r\n"Appointments";'));
  assert.equal(csv.split('\r\n').length, report.rows.length);
  assert.ok(csv.includes('\r\n\r\n"Date";"Start";"End";"Customer";"Service";"Staff";"Booked by AI"\r\n'));
  assert.ok(csv.includes(`"${sample.date}";"${sample.startTime}";"${sample.endTime}";"${sample.customerName}";"${sample.serviceName}";"${sample.staffName}";"Yes"`));
});

test('the export follows the calendar and the chosen period, and its name follows the salon', () => {
  const clock = { date: '2026-10-05', time: '12:00' };
  const report = (period: { from: string; to: string }, events = HAND_COUNTED, companyName = SALON) =>
    analyticsReport({ companyName, events, period, clock });

  const month = report({ from: '2026-10-01', to: '2026-10-31' })!;
  assert.deepEqual(month.rows.slice(4, 10), [
    ['Appointments', 6], ['Booked by AI', 2], ['Booked by AI (%)', 33], ['Other bookings', 4], ['Customers with appointments', 5], ['Still to come', 4],
  ]);
  assert.deepEqual(month.rows.slice(12).map((row) => [row[0], row[1], row[3], row[6]]), [
    ['2026-10-01', '09:00', 'Customer first', 'Yes'],
    ['2026-10-05', '09:00', 'Customer morning', 'No'],
    ['2026-10-05', '12:00', 'Customer now', 'Yes'],
    ['2026-10-05', '15:00', 'Customer morning', 'No'],
    ['2026-10-10', '11:00', 'Customer saturday', 'No'],
    ['2026-10-31', '15:00', 'Customer last', 'No'],
  ]);
  // After a cancellation the next export has one appointment less.
  const afterCancel = report({ from: '2026-10-01', to: '2026-10-31' }, HAND_COUNTED.filter((event) => event.id !== 'now'))!;
  assert.deepEqual(afterCancel.rows.slice(4, 10), [
    ['Appointments', 5], ['Booked by AI', 1], ['Booked by AI (%)', 20], ['Other bookings', 4], ['Customers with appointments', 4], ['Still to come', 3],
  ]);
  assert.equal(afterCancel.rows.length, month.rows.length - 1);

  // A week, a day and a period without appointments.
  const week = report({ from: '2026-10-05', to: '2026-10-11' })!;
  assert.equal(week.fileName, 'bella-hair-salon-appointments-2026-10-05-to-2026-10-11.csv');
  assert.deepEqual(week.rows[4], ['Appointments', 4]);
  const day = report({ from: '2026-10-05', to: '2026-10-05' })!;
  assert.equal(day.fileName, 'bella-hair-salon-appointments-2026-10-05.csv');
  assert.equal(day.rows.length, 12 + 3);
  const none = report({ from: '2026-08-01', to: '2026-08-31' })!;
  assert.deepEqual(none.rows.slice(4), [
    ['Appointments', 0], ['Booked by AI', 0], ['Other bookings', 0], ['Customers with appointments', 0], ['Still to come', 0],
    [], ['Date', 'Start', 'End', 'Customer', 'Service', 'Staff', 'Booked by AI'],
  ]);
  // Only a whole calendar month is named by its month.
  assert.equal(report({ from: '2026-10-01', to: '2026-10-30' })!.fileName, 'bella-hair-salon-appointments-2026-10-01-to-2026-10-30.csv');
  assert.equal(report({ from: '2026-10-02', to: '2026-10-31' })!.fileName, 'bella-hair-salon-appointments-2026-10-02-to-2026-10-31.csv');
  // A period that is not valid gives no file.
  assert.equal(report({ from: '2026-10-31', to: '2026-10-01' }), null);
  assert.equal(report({ from: '', to: '2026-10-01' }), null);

  // The file is named after the salon in Company Settings, in letters every system accepts.
  assert.equal(report({ from: '2026-10-01', to: '2026-10-31' }, HAND_COUNTED, 'Coiffure Müller & Söhne')!.fileName, 'coiffure-mueller-soehne-appointments-2026-10.csv');
  assert.equal(fileSlug('  Lumière — Salon  №1 ', 'salon'), 'lumiere-salon-1');
  assert.equal(fileSlug('Straße 7', 'salon'), 'strasse-7');
  assert.equal(fileSlug('美容院', 'slotbee'), 'slotbee');
  assert.equal(analyticsReport({ companyName: '美容院', events: [], period: { from: '2026-10-05', to: '2026-10-05' }, clock, fallbackName: 'slotbee' })!.fileName, 'slotbee-appointments-2026-10-05.csv');
  // A customer name cannot become a formula in the spreadsheet, and commas stay in their cell.
  const risky = report({ from: '2026-10-05', to: '2026-10-05' }, [appointment('x', '2026-10-05', '10:00', { customerName: '=SUM(A1), "Ltd"' })])!;
  assert.ok(createCsv(risky.rows).includes('"\'=SUM(A1), ""Ltd"""'));
});
