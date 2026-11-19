import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarView } from '../src/views/CalendarView';
import { ShiftPlanView } from '../src/views/ShiftPlanView';
import { bookingProfileUrl } from '../src/views/BookingPageView';
import { calendarHours, currentSalonWeek } from '../src/scheduling';
import type { CalendarEvent } from '../src/types';
import { initialBookingHours as bookingHours, initialEmployees as employees, initialServices as services } from '../src/mockData';

const event = (id: string, startTime: string, endTime: string): CalendarEvent => ({
  id, customerName: id, serviceId: 'srv-2', serviceName: 'Haircut',
  employeeId: 'emp-1', staffName: 'Anna Weber',
  date: '2030-10-07', day: 'mon', dateDisplay: 'Mon 07/10',
  startTime, endTime, colorTheme: 'blue',
});
const calendarProps: React.ComponentProps<typeof CalendarView> = {
  events: [], services, employees, bookingHours, shiftOverview: [], requests: [],
  date: '2030-10-07', selectedEventId: null,
  onSelectEvent: () => {}, onDateChange: () => {}, onAddEvent: () => null,
  onUpdateEvent: () => null, onDeleteEvent: () => {}, timeZone: 'Europe/Zurich',
};

test('calendar hours cover opening hours and complete early/late appointments', () => {
  const events = [event('early', '06:30', '07:00'), event('late', '22:30', '23:15')];
  const hours = calendarHours(['2030-10-07'], bookingHours, events);
  assert.equal(hours[0], '06:00');
  assert.equal(hours.at(-1), '23:00');
  assert.ok(hours.includes('18:00'));
  assert.deepEqual(calendarHours(['2030-10-07'], [], [event('other-date', '00:00', '01:00')]
    .map(item => ({ ...item, date: '2030-10-08' }))),
  ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
});

test('week grid renders actual early and evening appointments even on closed days', () => {
  const html = renderToStaticMarkup(React.createElement(CalendarView, {
    ...calendarProps,
    bookingHours: bookingHours.map(day => ({ ...day, isOpen: false })),
    events: [event('Early appointment', '07:30', '08:00'), event('Evening appointment', '18:00', '18:30')],
  }));
  assert.match(html, /Open appointment for Early appointment/);
  assert.match(html, /Open appointment for Evening appointment/);
  assert.match(html, />07:00</);
  assert.match(html, />18:00</);
});

test('the calendar is shown as a list, a day or a week; there is no 3-day view', () => {
  const html = renderToStaticMarkup(React.createElement(CalendarView, calendarProps));
  const views = Array.from(html.matchAll(/<button aria-pressed="(true|false)"[^>]*>([^<]+)<\/button>/g), (match) => [match[2], match[1]]);
  assert.deepEqual(views, [['List', 'false'], ['Day', 'false'], ['Week', 'true']]);
  assert.doesNotMatch(html, /3-day/);
  // The page opens with the week: seven columns, Monday first.
  assert.equal(html.split('data-date="').length - 1, 7);
  // Three views share the switcher's width on a phone.
  assert.match(html, /<div class="grid w-full grid-cols-3 [^"]*"><button aria-pressed/);
});

test('missing services or active staff explain why appointment creation is disabled', () => {
  const noServices = renderToStaticMarkup(React.createElement(CalendarView, { ...calendarProps, services: [] }));
  assert.match(noServices, /aria-label="Add appointment" disabled=""/);
  assert.match(noServices, /Add a service in Services before creating an appointment/);
  const noStaff = renderToStaticMarkup(React.createElement(CalendarView, { ...calendarProps, employees: [] }));
  assert.match(noStaff, /aria-label="Add appointment" disabled=""/);
  assert.match(noStaff, /Add an active employee and assign them to a service/);
});

test('confirmed appointment details expose an edit action alongside cancellation', () => {
  const appointment = event('confirmed', '11:00', '11:30');
  const html = renderToStaticMarkup(React.createElement(CalendarView, {
    ...calendarProps, events: [appointment], selectedEventId: appointment.id,
  }));
  assert.match(html, />Edit appointment</);
  assert.match(html, /Cancel Appointment/);
});

test('the calendar names its month and week and carries no time zone labels', () => {
  // Tuesday 15 December 2026: the week from Monday 14 to Sunday 20 December, calendar week 51.
  const html = renderToStaticMarkup(React.createElement(CalendarView, { ...calendarProps, date: '2026-12-15', timeZone: 'Europe/London' }));
  assert.match(html, />December 2026</);
  assert.match(html, />Week 51</);
  assert.match(html, />14\.–20\.12\.2026</);
  // Seven columns, Monday first, each with its short date.
  const columns = Array.from(html.matchAll(/data-date="([^"]+)"[^>]*><span class="font-semibold">([^<]+)</g), (match) => match.slice(1));
  assert.deepEqual(columns.map(([date]) => date), ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20']);
  assert.deepEqual(columns.map(([, label]) => label), ['Mon 14.12.', 'Tue 15.12.', 'Wed 16.12.', 'Thu 17.12.', 'Fri 18.12.', 'Sat 19.12.', 'Sun 20.12.']);
  // No offset under the days and no zone id in a sentence: whose clock the times follow is said
  // once for the whole app, and only when it is in doubt (tests/format.test.ts).
  assert.doesNotMatch(html, /GMT|Europe\/|London|Appointment times are in/);

  // The week across the turn of the year belongs to 2026: week 53, under both months.
  const turn = renderToStaticMarkup(React.createElement(CalendarView, { ...calendarProps, date: '2026-12-30' }));
  assert.match(turn, />December 2026–January 2027</);
  assert.match(turn, />Week 53</);
  assert.match(turn, />28\.12\.2026–03\.01\.2027</);
  assert.doesNotMatch(turn, />2027</);
});

test('current shift week follows salon date across a local week boundary', () => {
  const now = new Date('2026-11-02T00:30:00Z');
  assert.equal(currentSalonWeek('Europe/London', now), '2026-11-02');
  assert.equal(currentSalonWeek('America/New_York', now), '2026-10-26');
  // The view reads the clock itself. Read it before and after, so the test also holds
  // when the week changes at this very moment.
  const before = currentSalonWeek('Europe/London');
  const html = renderToStaticMarkup(React.createElement(ShiftPlanView, {
    employees, shiftOverview: [], timeZone: 'Europe/London', onUpdateShift: () => {},
  }));
  const after = currentSalonWeek('Europe/London');
  assert.match(html, new RegExp(`value="(${before}|${after})"`));
});

test('booking profile links accept normal domains but reject executable protocols', () => {
  assert.equal(bookingProfileUrl('salon.example/services'), 'https://salon.example/services');
  assert.equal(bookingProfileUrl('https://salon.example'), 'https://salon.example/');
  assert.equal(bookingProfileUrl('javascript:alert(1)'), null);
  assert.equal(bookingProfileUrl('data:text/html,hello'), null);
  assert.equal(bookingProfileUrl('Our salon terms and conditions'), null);
  assert.equal(bookingProfileUrl(''), null);
});
