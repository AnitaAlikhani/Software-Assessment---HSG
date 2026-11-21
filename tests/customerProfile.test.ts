import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { customerHistory, customerStatsFromCalendar } from '../src/customerStats';
import { deletionDependency } from '../src/managementDependencies';
import { formatDate, formatTimeRange } from '../src/format';
import type { CalendarEvent, Customer } from '../src/types';
import { CustomersView } from '../src/views/CustomersView';
import { PROFILE_LIST_LIMIT } from '../src/views/CustomerProfile';
import { demoCustomers, demoEvents, demoRequests, FIXED_NOW } from './fixedClock';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// The customer profile: `#/customers?customerId=<id>` opens it in place of the list. Everything
// it counts comes from the calendar at the fixed moment (Monday 5 October 2026, 12:00 in Zurich).

const ZONE = 'Europe/Zurich';
const nothing = () => {};
const count = (html: string, part: string) => html.split(part).length - 1;
/** Nicole Graf: a regular with eight visits and four appointments still to come. */
const NICOLE = 'cust-002';

const profile = (customerId: string, partial: Partial<React.ComponentProps<typeof CustomersView>> = {}) => render(React.createElement(CustomersView, {
  customers: demoCustomers, events: demoEvents, now: FIXED_NOW, timeZone: ZONE, selectedCustomerId: customerId,
  customersWithChat: new Set(['cust-camille', 'cust-marie']),
  onClearSelection: nothing, onAddCustomer: nothing, onUpdateCustomer: nothing, onDeleteCustomer: nothing,
  onOpenChat: nothing, onOpenAppointment: nothing, onNewAppointment: nothing,
  cannotDelete: (customer) => deletionDependency('customer', customer.id, customer.name, demoEvents, demoRequests),
  ...partial,
}));
/** The appointments a list shows, as "date time service", in the order shown. */
const rows = (html: string, listId: string) => {
  const list = new RegExp(`<ul id="${listId}"[^>]*>(.*?)</ul>`).exec(html)?.[1] ?? '';
  return Array.from(list.matchAll(/<li>(.*?)<\/li>/g), (match) => readableText(match[1]).split(' ').filter(Boolean).slice(0, 3).join(' '));
};
const shownAs = (event: CalendarEvent) => `${formatDate(event.date)} ${formatTimeRange(event.startTime, event.endTime)}`;

test('a customer\'s appointments split at the current moment: the soonest first to come, the latest first gone', () => {
  const history = customerHistory(NICOLE, demoCustomers, demoEvents, FIXED_NOW, ZONE);
  const own = demoEvents.filter((event) => event.customerId === NICOLE);
  assert.equal(history.upcoming.length + history.past.length, own.length);
  assert.equal(history.upcoming.length, 4);
  assert.equal(history.past.length, 8);
  const at = (event: CalendarEvent) => `${event.date} ${event.startTime}`;
  for (const event of history.upcoming) assert.ok(at(event) >= '2026-10-05 12:00');
  for (const event of history.past) assert.ok(at(event) < '2026-10-05 12:00');
  assert.deepEqual(history.upcoming.map(at), [...history.upcoming.map(at)].sort());
  assert.deepEqual(history.past.map(at), [...history.past.map(at)].sort().reverse());

  // The profile's figures are the list's figures, for every customer of the salon.
  const stats = customerStatsFromCalendar(demoCustomers, demoEvents, FIXED_NOW, ZONE);
  for (const customer of demoCustomers) {
    const one = customerHistory(customer.id, demoCustomers, demoEvents, FIXED_NOW, ZONE);
    const listed = stats.get(customer.id)!;
    assert.equal(one.visits, listed.visits, customer.name);
    assert.equal(one.lastVisit?.id, listed.lastVisit?.id, customer.name);
    assert.equal(one.nextAppointment?.id, listed.nextAppointment?.id, customer.name);
  }

  // An appointment saved with a name only counts where exactly one customer has that name.
  const anna: Customer = { id: 'a1', name: 'Anna Muster', initials: 'AM', email: '', phone: '', language: 'DE' };
  const legacy: CalendarEvent = { ...demoEvents[0], id: 'old', customerId: undefined, customerName: 'anna  muster', date: '2026-09-01' };
  assert.equal(customerHistory('a1', [anna], [legacy], FIXED_NOW, ZONE).past.length, 1);
  assert.equal(customerHistory('a1', [anna, { ...anna, id: 'a2' }], [legacy], FIXED_NOW, ZONE).past.length, 0);
});

test('the profile shows who the customer is, the next appointment, then upcoming and past as in the calendar', () => {
  const html = profile(NICOLE);
  const text = readableText(html);
  const history = customerHistory(NICOLE, demoCustomers, demoEvents, FIXED_NOW, ZONE);
  const nicole = demoCustomers.find((customer) => customer.id === NICOLE)!;

  // In place of the list, with the way back above it.
  assert.doesNotMatch(html, /role="table"|data-customer-link|Filter customers/);
  assert.ok(html.indexOf('>All customers<') < html.indexOf('<h1'));
  assert.match(html, /<h1[^>]*>Nicole Graf<\/h1>/);

  // Who: phone, email, the language in words. Her number is one of the invented ones: text, not a dialling link.
  assert.match(text, /\+41 7\d 555 \d\d \d\d/);
  assert.doesNotMatch(html, /href="tel:/);
  assert.match(html, />Language<\/dt><dd[^>]*>German</);
  if (nicole.email) assert.match(text, new RegExp(nicole.email.replace('.', '\\.')));

  // Figures from the calendar, and nothing the app does not record.
  assert.match(html, new RegExp(`>${history.visits} visits · last visit ${formatDate(history.lastVisit!.date)}<`));
  assert.doesNotMatch(text, /no-show|no show|missed/i);

  // The next appointment on its own, then the later ones in order, then the past, newest first.
  const next = history.nextAppointment!;
  const nextCard = /<section aria-labelledby="customer-next-title"[^>]*>(.*?)<\/section>/.exec(html)?.[1] ?? '';
  assert.match(readableText(nextCard).replace(/&amp;/g, '&'), new RegExp(`${formatDate(next.date)}.*${formatTimeRange(next.startTime, next.endTime)}.*${next.serviceName}.*with ${next.staffName}`));
  assert.deepEqual(rows(html, 'customer-upcoming-list'), history.upcoming.slice(1).map(shownAs));
  assert.deepEqual(rows(html, 'customer-past-list'), history.past.slice(0, PROFILE_LIST_LIMIT).map(shownAs));
  assert.match(html, /aria-expanded="false" aria-controls="customer-past-list"[^>]*>Show all 8</);
  // Upcoming has three: no "Show all" there.
  assert.equal(count(html, 'aria-controls="customer-upcoming-list"'), 0);
  // Every appointment opens in the calendar.
  assert.equal(count(html, 'title="Open in calendar"'), 1 + 3 + PROFILE_LIST_LIMIT);
  assert.doesNotMatch(text, TELL_WORDS);
});

test('the note: an empty one invites one, a saved one comes first and stands out', () => {
  const empty = profile(NICOLE);
  assert.match(empty, />No note yet\. Add one for things like an allergy or a preference\.</);
  assert.match(empty, />Add note</);

  const withNote = demoCustomers.map((customer) => customer.id === NICOLE ? { ...customer, note: 'Allergic to ammonia.\nLikes the first slot of the day.' } : customer);
  const html = profile(NICOLE, { customers: withNote });
  assert.match(html, />Allergic to ammonia\.\nLikes the first slot of the day\.</);
  assert.match(html, />Edit note</);
  assert.match(html, /border-amber-200 bg-amber-50/);
  // Right after the person, before any appointment.
  assert.ok(html.indexOf('Allergic to ammonia') < html.indexOf('Next appointment'));
  assert.ok(html.indexOf('Allergic to ammonia') > html.indexOf('<h1'));
});

test('the actions offered depend on what exists', () => {
  // Marie has a chat; deleting her is held back while appointments use her record.
  const marie = profile('cust-marie');
  assert.match(marie, />New appointment</);
  assert.match(marie, />Open conversation</);
  assert.match(marie, />Edit details</);
  assert.equal(count(marie, '>Delete customer<'), 1);

  // Nicole has no chat, and without the app's handlers there is nothing to offer for them.
  const nicole = profile(NICOLE, { onNewAppointment: undefined, onOpenAppointment: undefined });
  assert.doesNotMatch(nicole, /Open conversation|New appointment|Open in calendar/);
  assert.match(nicole, />Edit details</);

  // The edit form no longer deletes: the list has no "Delete" anywhere.
  const list = profile(null as unknown as string, { selectedCustomerId: null });
  assert.doesNotMatch(list, /Delete/);
});

test('a customer without appointments says so in plain words', () => {
  const camille = profile('cust-camille');
  assert.match(camille, />No visits yet</);
  assert.match(camille, />Nothing booked\.</);
  assert.match(camille, />No visits yet\.</);
  assert.doesNotMatch(camille, /customer-upcoming|Show all/);
  // Her number is invented too; a real one is a dialling link, an address on a real domain a mail link.
  const real = demoCustomers.map((customer) => customer.id === 'cust-camille' ? { ...customer, phone: '+41712223344', email: 'camille@bernard.ch' } : customer);
  const html = profile('cust-camille', { customers: real });
  assert.match(html, /href="tel:\+41712223344"[^>]*>.*\+41 71 222 33 44/);
  assert.match(html, /href="mailto:camille@bernard\.ch"/);
});

test('a customer who is no longer in the list gets a short message and a way back', () => {
  const html = profile('cust-gone');
  assert.match(html, /<h1[^>]*>This customer is no longer in your list<\/h1>/);
  assert.match(html, />Back to all customers</);
  assert.match(html, />All customers</);
  assert.doesNotMatch(html, /Delete|Edit details|New appointment|Next appointment/);
});
