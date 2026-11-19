import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { appointmentFromRequest, upsertAppointment } from '../src/appointmentActions';
import { customerForAppointment, upsertCustomer } from '../src/bookingData';
import { CUSTOMER_SORT_OPTIONS } from '../src/customerSort';
import { customerStatsFromCalendar } from '../src/customerStats';
import { initialEmployees, initialServices } from '../src/mockData';
import type { CalendarEvent, Customer } from '../src/types';
import { CustomersView } from '../src/views/CustomersView';
import { demoCustomers, demoEvents, demoRequests, FIXED_NOW } from './fixedClock';

const ZONE = 'Europe/Zurich';
const statsOf = (customerId: string, events: CalendarEvent[], now = FIXED_NOW, customers: Customer[] = demoCustomers) =>
  customerStatsFromCalendar(customers, events, now, ZONE).get(customerId)!;

test('a customer\'s visits, last visit and next appointment follow the calendar through a booking, a move and a cancellation', () => {
  // The person behind the first request: a regular with earlier visits and nothing booked.
  const request = demoRequests[0]; // wash and blow-dry on Wednesday 7 October 2026, 10:00
  const before = statsOf(request.customerId!, demoEvents);
  assert.ok(before.visits >= 1);
  assert.ok(before.lastVisit && before.lastVisit.date < '2026-10-05');
  assert.equal(before.nextAppointment, null);

  // The owner accepts the request: the appointment is in the calendar and is the customer's next one.
  const accepted = appointmentFromRequest(request, initialServices, initialEmployees);
  const { customer } = customerForAppointment(demoCustomers, accepted);
  assert.equal(customer.id, request.customerId);
  assert.deepEqual(customer, demoCustomers.find((item) => item.id === request.customerId)); // the record itself does not change
  const booked = upsertAppointment(demoEvents, { ...accepted, customerId: customer.id });
  assert.equal(statsOf(customer.id, booked).nextAppointment?.id, accepted.id);
  assert.equal(statsOf(customer.id, booked).visits, before.visits);
  assert.equal(statsOf(customer.id, booked).lastVisit?.id, before.lastVisit.id);

  // Moved to Friday: still one appointment, now on the new day.
  const moved = upsertAppointment(booked, { ...accepted, customerId: customer.id, date: '2026-10-09', startTime: '09:00', endTime: '09:30' });
  assert.equal(moved.length, booked.length);
  assert.equal(statsOf(customer.id, moved).nextAppointment?.date, '2026-10-09');
  assert.equal(statsOf(customer.id, moved).visits, before.visits);

  // Once it has started it is a visit, and nothing is "next" any more.
  const afterwards = statsOf(customer.id, moved, new Date('2026-10-09T07:00:00Z')); // 09:00 in Zurich: starting now
  assert.equal(afterwards.nextAppointment?.id, accepted.id);
  const later = statsOf(customer.id, moved, new Date('2026-10-09T07:01:00Z'));
  assert.equal(later.nextAppointment, null);
  assert.equal(later.visits, before.visits + 1);
  assert.equal(later.lastVisit?.id, accepted.id);

  // Cancelled before it took place: everything is as it was.
  const cancelled = moved.filter((event) => event.id !== accepted.id);
  assert.deepEqual(statsOf(customer.id, cancelled), before);
});

test('a first booking makes a customer with no visits yet; cancelling it leaves the contact with none', () => {
  const event: CalendarEvent = { ...demoEvents[0], id: 'cal-new', customerId: undefined, customerPhone: undefined, customerName: 'Vera Neu', date: '2026-10-13', startTime: '09:00', endTime: '09:30' };
  const { customer } = customerForAppointment(demoCustomers, event);
  const customers = upsertCustomer(demoCustomers, customer);
  assert.equal(customers.length, demoCustomers.length + 1);
  const events = upsertAppointment(demoEvents, { ...event, customerId: customer.id });
  assert.deepEqual(statsOf(customer.id, events, FIXED_NOW, customers), { visits: 0, lastVisit: null, nextAppointment: events[0] });
  assert.deepEqual(statsOf(customer.id, demoEvents, FIXED_NOW, customers), { visits: 0, lastVisit: null, nextAppointment: null });
});

test('the figures add up to the calendar, and appointments without a customer id count only where the name is unambiguous', () => {
  const stats = customerStatsFromCalendar(demoCustomers, demoEvents, FIXED_NOW, ZONE);
  assert.equal(stats.size, demoCustomers.length);
  const visits = [...stats.values()].reduce((sum, entry) => sum + entry.visits, 0);
  const upcoming = demoEvents.filter((event) => `${event.date} ${event.startTime}` >= '2026-10-05 12:00').length;
  assert.equal(visits + upcoming, demoEvents.length);
  // Marie's chat booked Thursday 8 October, 13:30; she was last in six weeks earlier.
  assert.equal(stats.get('cust-marie')!.nextAppointment?.id, 'cal-2');
  assert.equal(stats.get('cust-marie')!.lastVisit?.id, 'cal-marie-earlier');
  assert.equal(stats.get('cust-marie')!.visits, 1);
  // Camille has never been to the salon and has nothing booked yet.
  assert.deepEqual(stats.get('cust-camille'), { visits: 0, lastVisit: null, nextAppointment: null });

  const anna: Customer = { id: 'a1', name: 'Anna Muster', initials: 'AM', email: '', phone: '', language: 'DE' };
  const legacy: CalendarEvent = { ...demoEvents[0], id: 'legacy', customerId: undefined, customerName: ' anna  MUSTER ', date: '2026-09-01', startTime: '10:00', endTime: '10:30' };
  assert.equal(customerStatsFromCalendar([anna], [legacy], FIXED_NOW, ZONE).get('a1')!.visits, 1);
  const namesake = { ...anna, id: 'a2' };
  const both = customerStatsFromCalendar([anna, namesake], [legacy], FIXED_NOW, ZONE);
  assert.equal(both.get('a1')!.visits + both.get('a2')!.visits, 0);
  // An appointment of somebody who is not in the list changes nobody's figures.
  assert.equal(customerStatsFromCalendar([anna], [{ ...legacy, customerId: 'unknown' }], FIXED_NOW, ZONE).get('a1')!.visits, 0);
});

const viewProps: React.ComponentProps<typeof CustomersView> = {
  customers: demoCustomers, events: demoEvents, now: FIXED_NOW, timeZone: ZONE,
  customersWithChat: new Set(['cust-camille', 'cust-marie']), selectedCustomerId: null,
  onClearSelection: () => {}, onAddCustomer: () => {}, onUpdateCustomer: () => {}, onDeleteCustomer: () => {}, onOpenChat: () => {},
};
const count = (html: string, text: string) => html.split(text).length - 1;

test('the customer list shows the calendar\'s figures, 25 customers at a time', () => {
  const html = renderToStaticMarkup(React.createElement(CustomersView, viewProps));
  assert.match(html, />Last visit</);
  assert.match(html, />Next appointment</);
  assert.match(html, />Visits</);
  assert.doesNotMatch(html, /Last booking|Bookings|Actions/);
  // The phone cards and the table each show the first 25; the name of each opens its edit form.
  assert.equal(count(html, 'aria-label="Edit '), 50);
  assert.equal(count(html, `Showing 25 of ${demoCustomers.length} customers`), 2);
  assert.equal(count(html, '>Show 25 more<'), 2);
  // Marie: last visit and next appointment as in the calendar.
  assert.match(html, />Thu, 27\.08\.2026</);
  assert.match(html, />Thu, 08\.10\.2026, 13:30</);
  // Her number is stored without spaces and shown grouped, in the list's own font.
  assert.match(html, />\+41 79 555 61 12</);
  assert.doesNotMatch(html, /font-mono|\+41795556112/);
  // "Open conversation" only for customers who have a chat.
  assert.equal(count(html, 'aria-label="Open conversation with '), 4);
  assert.match(html, /aria-label="Open conversation with Camille Bernard"/);
  assert.match(html, /aria-label="Open conversation with Marie Dupont"/);
});

test('a short list has no "Show more", and a customer known only from a chat shows how they reached the salon', () => {
  const chatOnly: Customer = { id: 'cust-live', name: 'Tom', initials: 'T', email: '', phone: '', language: 'DE', channel: 'Website', conversationId: 'live-web-1' };
  const html = renderToStaticMarkup(React.createElement(CustomersView, {
    ...viewProps, customers: [chatOnly, ...demoCustomers.slice(0, 3)], customersWithChat: new Set(['cust-live']),
  }));
  assert.match(html, /Showing 4 of 4 customers/);
  assert.doesNotMatch(html, /Show \d+ more/);
  assert.equal(count(html, 'via web chat'), 2);
  assert.doesNotMatch(html, /Test visitor|Testvisitor/);
  assert.match(html, /aria-label="Open conversation with Tom"/);
  // A link from the search opens one customer.
  const one = renderToStaticMarkup(React.createElement(CustomersView, { ...viewProps, selectedCustomerId: 'cust-marie' }));
  assert.match(one, /Showing Marie Dupont/);
  assert.equal(count(one, 'aria-label="Edit '), 2);
  assert.equal(count(one, 'aria-label="Edit Marie Dupont"'), 2);
  // One customer needs no order: the phones' "Sort by" is left out.
  assert.doesNotMatch(one, /customer-sort/);
});

test('no row of the list deletes: the bin is gone, and so is the Options panel', () => {
  const html = renderToStaticMarkup(React.createElement(CustomersView, viewProps));
  // Deleting is in the customer's edit form, behind a question (tests/deleteQuestion.test.ts).
  assert.doesNotMatch(html, /Delete|lucide-trash/i);
  assert.doesNotMatch(html, /Options|customer-options|All languages|Reset filters/);
  // What stays above the list: the filter field, the export and "Add Customer".
  assert.match(html, /aria-label="Filter customers"/);
  assert.match(html, /aria-label="Export customers CSV"/);
  assert.match(html, />Add Customer</);
  // A list without customers says so, in the cards and in the table.
  const empty = renderToStaticMarkup(React.createElement(CustomersView, { ...viewProps, customers: [] }));
  assert.equal(count(empty, '>No customers yet.<'), 2);
});

test('the headers of name, last visit, next appointment and visits sort the table; phones get one "Sort by" list', () => {
  const html = renderToStaticMarkup(React.createElement(CustomersView, viewProps));
  // A table for screen readers: one header row of eight, and a row of eight cells per customer.
  assert.match(html, /<div role="table" aria-label="Customers"/);
  assert.equal(count(html, 'role="columnheader"'), 8);
  assert.equal(count(html, 'role="row"'), 26);
  assert.equal(count(html, 'role="cell"'), 25 * 8);
  // Four headers are buttons with an arrow; the others are plain text.
  const sortable = Array.from(html.matchAll(/<div role="columnheader"[^>]*><button type="button"[^>]*>([^<]+)<svg[^>]*aria-hidden="true"/g), match => match[1]);
  assert.deepEqual(sortable, ['Name', 'Last visit', 'Next appointment', 'Visits']);
  for (const plain of ['Email', 'Phone', 'Language']) assert.match(html, new RegExp(`<div role="columnheader"[^>]*>${plain}</div>`));
  // The list opens as it is kept (most recent contact first): no header claims an order yet.
  assert.doesNotMatch(html, /aria-sort/);
  assert.match(html, /lucide-arrow-up-down/);
  assert.ok(html.indexOf('>Camille Bernard<') < html.indexOf('>Marie Dupont<'));

  // Phones show cards without headers: one labelled list holds every column in both directions.
  const select = /<label for="customer-sort"[^>]*>Sort by<\/label><select id="customer-sort"[^>]*>(.*?)<\/select>/.exec(html)?.[1] ?? '';
  const options = Array.from(select.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g), match => [match[1], match[3], Boolean(match[2])]);
  assert.deepEqual(options, CUSTOMER_SORT_OPTIONS.map((option) => [option.value, option.label, option.value === '']));
  assert.deepEqual(options.map((option) => option[1]), [
    'Default order', 'Name A–Z', 'Name Z–A', 'Last visit, newest first', 'Last visit, oldest first',
    'Next appointment, soonest first', 'Next appointment, latest first', 'Most visits', 'Fewest visits',
  ]);
  assert.equal(count(html, '<select'), 1);
  // A list on a phone must not zoom the page: 16 px text, and a tap target of 44 px.
  const classes = /<select id="customer-sort"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';
  assert.match(classes, /\btext-base\b/);
  assert.match(classes, /\bmin-h-11\b/);
});
