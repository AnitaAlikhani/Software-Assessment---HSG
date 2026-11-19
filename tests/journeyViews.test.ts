import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomeView } from '../src/views/HomeView';
import { POSModal } from '../src/components/POSModal';
import { initialServices as services, initialEmployees as employees, initialBookingHours as bookingHours } from '../src/mockData';
import { demoEvents as events, demoRequests as requests, demoShifts as shiftOverview, FIXED_NOW } from './fixedClock';

const homeProps: React.ComponentProps<typeof HomeView> = {
  requests, selectedRequestId: null, onSelectRequest: () => {}, now: FIXED_NOW,
  availabilityContext: { requests, events, services, employees, bookingHours, shiftOverview, now: FIXED_NOW, timeZone: 'Europe/Zurich' },
  onAcceptRequest: () => {}, onRejectRequest: () => {}, onMoveRequest: () => null,
  onSimulateNewRequest: () => {}, nextAppointment: null, onOpenAppointment: () => {},
  onExportReport: () => {}, conversations: [], onOpenConversations: () => {},
};

test('request selection exposes the selected request channel and actions', () => {
  const html = renderToStaticMarkup(React.createElement(HomeView, { ...homeProps, selectedRequestId: 'req-2' }));
  assert.match(html, />Via Web</);
  // A request never names a channel the salon has not connected.
  assert.doesNotMatch(html, /WhatsApp|Instagram/);
  assert.match(html, new RegExp(requests[1].customerName));
  assert.match(html, /Staff: Anna Weber/);
  assert.match(html, /47 minutes ago/);
  assert.match(html, />Accept</);
  assert.match(html, new RegExp(`aria-pressed="true"[^>]*>[\\s\\S]*?${requests[1].customerName}`));
});

test('a stale request link never exposes actions for another customer', () => {
  const html = renderToStaticMarkup(React.createElement(HomeView, { ...homeProps, selectedRequestId: 'missing', requests: requests.slice(0, 1) }));
  assert.match(html, /This request is no longer available/);
  assert.doesNotMatch(html, />Accept</);
  assert.doesNotMatch(html, /Simulate incoming booking/);
  assert.match(html, new RegExp(requests[0].customerName)); // Still reachable through the request selector.
});

test('an empty upcoming calendar has no invented confirmed appointment or resource', () => {
  const html = renderToStaticMarkup(React.createElement(HomeView, homeProps));
  assert.match(html, /No upcoming appointments/);
  assert.doesNotMatch(html, />Confirmed</);
  assert.doesNotMatch(html, /Room 1/);
});

test('a request whose time has passed offers to move it instead of an Accept that would fail', () => {
  // Two days later the first request (Wednesday 7 October, 10:00) lies in the past, the second (Thursday 14:30) does not.
  const later = new Date('2026-10-07T10:00:00Z'); // 12:00 in Zurich
  const render = (selectedRequestId: string) => renderToStaticMarkup(React.createElement(HomeView, {
    ...homeProps, now: later, selectedRequestId, availabilityContext: { ...homeProps.availabilityContext, now: later },
  }));
  const passed = render('req-1');
  assert.match(passed, /This time has passed\. Move the request to a new time, or reject it\./);
  assert.doesNotMatch(passed, />Accept</);
  assert.match(passed, />Move</);
  assert.match(passed, />Reject</);
  assert.match(passed, /2 days ago/);
  const upcoming = render('req-2');
  assert.doesNotMatch(upcoming, /This time has passed/);
  assert.match(upcoming, />Accept</);
});

test('empty services disable simulated checkout and expose a useful empty state', () => {
  const html = renderToStaticMarkup(React.createElement(POSModal, { isOpen: true, onClose: () => {}, services: [], customers: [], onCompleteSale: () => {} }));
  assert.match(html, /No services available/);
  assert.match(html, /Add a service in Services/);
  assert.match(html, /<button type="submit" disabled=""/);
  assert.match(html, /No real payment will be taken/);
});
