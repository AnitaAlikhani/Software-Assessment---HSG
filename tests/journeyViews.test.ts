import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomeView } from '../src/views/HomeView';
import { POSModal } from '../src/components/POSModal';
import { initialServices as services, initialEmployees as employees, initialBookingHours as bookingHours } from '../src/mockData';
import { demoEvents as events, demoRequests as requests, demoShifts as shiftOverview, FIXED_NOW } from './fixedClock';

const homeProps: React.ComponentProps<typeof HomeView> = {
  requests, selectedRequestId: null, now: FIXED_NOW,
  availabilityContext: { requests, events, services, employees, bookingHours, shiftOverview, now: FIXED_NOW, timeZone: 'Europe/Zurich' },
  onAcceptRequest: () => null, onRejectRequest: () => {}, onMoveRequest: () => null,
  onSimulateNewRequest: () => {}, onOpenAppointment: () => {},
  conversations: [], onOpenConversations: () => {},
};

/** The entry of the inbox that names this customer: one request, with its own buttons. */
const entryOf = (html: string, customerName: string): string => {
  const entry = html.split('<li').find((part) => part.includes(customerName));
  assert.ok(entry, `${customerName} is listed`);
  return entry.split('</li>')[0];
};

test('every pending request has an entry with its source, staff, age and actions; the selected one is marked', () => {
  const html = renderToStaticMarkup(React.createElement(HomeView, { ...homeProps, selectedRequestId: 'req-2' }));
  const selected = entryOf(html, requests[1].customerName);
  assert.match(selected, />Booking page</);
  // A request never names a channel the salon has not connected.
  assert.doesNotMatch(html, /WhatsApp|Instagram/);
  assert.match(selected, /with Anna Weber/);
  assert.match(selected, /47 minutes ago/);
  for (const action of ['Accept', 'Move', 'Reject']) assert.match(selected, new RegExp(`>${action}</button>`));
  // The request the owner came for is marked, and only that one.
  assert.match(selected, /^[^>]*aria-current="true"/);
  assert.equal(html.match(/aria-current="true"/g)?.length, 1);
  // The other request can be answered without selecting it first.
  const other = entryOf(html, requests[0].customerName);
  assert.doesNotMatch(other, /aria-current/);
  assert.match(other, />Accept<\/button>/);
});

test('a stale request link marks no request and says so', () => {
  const html = renderToStaticMarkup(React.createElement(HomeView, { ...homeProps, selectedRequestId: 'missing', requests: requests.slice(0, 1) }));
  assert.match(html, /This request is no longer available/);
  assert.doesNotMatch(html, /aria-current="true"/);
  assert.doesNotMatch(html, /Simulate incoming booking/);
  // The request that still waits is listed with its own actions: no button acts on another customer's request.
  assert.match(entryOf(html, requests[0].customerName), />Accept<\/button>/);
});

test('an empty calendar has no invented appointment or resource', () => {
  const html = renderToStaticMarkup(React.createElement(HomeView, { ...homeProps, availabilityContext: { ...homeProps.availabilityContext, events: [] } }));
  assert.match(html, /No appointments\./);
  assert.doesNotMatch(html, /Next appointment/);
  assert.doesNotMatch(html, />Confirmed</);
  assert.doesNotMatch(html, /Room 1/);
});

test('a request whose time has passed offers to move it instead of an Accept that would fail', () => {
  // Two days later the first request (Wednesday 7 October, 10:00) lies in the past, the second (Thursday 14:30) does not.
  const later = new Date('2026-10-07T10:00:00Z'); // 12:00 in Zurich
  const html = renderToStaticMarkup(React.createElement(HomeView, {
    ...homeProps, now: later, availabilityContext: { ...homeProps.availabilityContext, now: later },
  }));
  const passed = entryOf(html, requests[0].customerName);
  assert.match(passed, /This time has passed\. Move the request to a new time, or reject it\./);
  assert.doesNotMatch(passed, />Accept</);
  assert.match(passed, />Move<\/button>/);
  assert.match(passed, />Reject<\/button>/);
  assert.match(passed, /2 days ago/);
  const upcoming = entryOf(html, requests[1].customerName);
  assert.doesNotMatch(upcoming, /This time has passed/);
  assert.match(upcoming, />Accept<\/button>/);
  // The request that is overdue stands first: the list is in the order of the times asked for.
  assert.ok(html.indexOf(requests[0].customerName) < html.indexOf(requests[1].customerName));
});

test('empty services disable simulated checkout and expose a useful empty state', () => {
  const html = renderToStaticMarkup(React.createElement(POSModal, { isOpen: true, onClose: () => {}, services: [], customers: [], onCompleteSale: () => {} }));
  assert.match(html, /No services available/);
  assert.match(html, /Add a service in Services/);
  assert.match(html, /<button type="submit" disabled=""/);
  assert.match(html, /No real payment will be taken/);
});
