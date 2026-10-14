import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomeView } from '../src/views/HomeView';
import { POSModal } from '../src/components/POSModal';
import { initialAppointmentRequests as requests, initialCalendarEvents as events, initialServices as services, initialEmployees as employees, initialBookingHours as bookingHours, initialShiftOverview as shiftOverview } from '../src/mockData';

const homeProps: React.ComponentProps<typeof HomeView> = {
  requests, selectedRequestId: null, onSelectRequest: () => {},
  availabilityContext: { requests, events, services, employees, bookingHours, shiftOverview },
  onAcceptRequest: () => {}, onRejectRequest: () => {}, onMoveRequest: () => null,
  onSimulateNewRequest: () => {}, nextAppointment: null, onOpenAppointment: () => {},
  activityStats: { messagesToday: 4, messagesMonth: 24, aiBookingsToday: 1, aiBookingsMonth: 3, afterHoursToday: 2, afterHoursMonth: 9, replyTimeSec: 12 },
  onExportActivity: () => {}, conversations: [], onOpenConversations: () => {},
};

test('request selection exposes the selected request channel and actions', () => {
  const html = renderToStaticMarkup(React.createElement(HomeView, { ...homeProps, selectedRequestId: 'req-2' }));
  assert.match(html, /Instagram/);
  assert.match(html, /Atilla Ismayilova/);
  assert.match(html, />Accept</);
  assert.match(html, /aria-pressed="true"[^>]*>[\s\S]*?Atilla/);
});

test('a stale request link never exposes actions for another customer', () => {
  const html = renderToStaticMarkup(React.createElement(HomeView, { ...homeProps, selectedRequestId: 'missing', requests: requests.slice(0, 1) }));
  assert.match(html, /This request is no longer available/);
  assert.doesNotMatch(html, />Accept</);
  assert.doesNotMatch(html, /Simulate incoming booking/);
  assert.match(html, /Nilufar Ismayilova/); // Still reachable through the request selector.
});

test('an empty upcoming calendar has no invented confirmed appointment or resource', () => {
  const html = renderToStaticMarkup(React.createElement(HomeView, homeProps));
  assert.match(html, /No upcoming appointments/);
  assert.doesNotMatch(html, />Confirmed</);
  assert.doesNotMatch(html, /Room 1/);
});

test('empty services disable simulated checkout and expose a useful empty state', () => {
  const html = renderToStaticMarkup(React.createElement(POSModal, { isOpen: true, onClose: () => {}, services: [], customers: [], onCompleteSale: () => {} }));
  assert.match(html, /No services available/);
  assert.match(html, /Add a service in Services/);
  assert.match(html, /<button type="submit" disabled=""/);
  assert.match(html, /No real payment will be taken/);
});
