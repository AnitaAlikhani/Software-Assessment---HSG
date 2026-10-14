import assert from 'node:assert/strict';
import test from 'node:test';
import { getHeaderNotifications, getHeaderSearchResults, isHeaderNotificationUnread } from '../src/headerModels';
import { initialAppointmentRequests, initialCalendarEvents, initialCustomers } from '../src/mockData';

test('header search trims and normalizes queries and finds confirmed appointments', () => {
  const results = getHeaderSearchResults(initialCustomers, initialAppointmentRequests,
    initialCalendarEvents, '  JOHN SMITH  ');
  const john = initialCalendarEvents.find((event) => event.customerName === 'John Smith')!;
  assert.deepEqual(results, [{ kind: 'appointment', record: john }]);
  assert.equal(results[0].record, john);
  assert.deepEqual(getHeaderSearchResults(initialCustomers, initialAppointmentRequests,
    initialCalendarEvents, '   '), []);
});

test('search keeps customer, pending request and confirmed appointment results distinct', () => {
  const results = getHeaderSearchResults(initialCustomers, initialAppointmentRequests,
    initialCalendarEvents, 'Nilufar');
  assert.ok(results.some((result) => result.kind === 'customer'));
  assert.ok(results.some((result) => result.kind === 'request'));
  assert.ok(results.some((result) => result.kind === 'appointment'));
  assert.deepEqual(getHeaderSearchResults([], initialAppointmentRequests.map((request) => ({
    ...request, status: 'rejected' as const,
  })), [], 'Sample Service'), []);
});

test('notifications preserve exact request and calendar records and include every displayed card', () => {
  const appointment = initialCalendarEvents.find((event) => event.isAiBooked)!;
  const notifications = getHeaderNotifications(initialAppointmentRequests, 3,
    ['Camille', 'Chloé', 'Giulia'], appointment, 'message-revision');
  assert.equal(notifications.length, initialAppointmentRequests.length + 2);
  const secondRequest = notifications.find((item) => item.kind === 'request' && item.record.id === initialAppointmentRequests[1].id);
  assert.ok(secondRequest?.kind === 'request');
  assert.equal(secondRequest.record, initialAppointmentRequests[1]);
  const booking = notifications.find((item) => item.kind === 'appointment');
  assert.ok(booking?.kind === 'appointment');
  assert.equal(booking.record, appointment);
});

test('read revisions remain stable through renders and relative-time changes, but change for new booking details', () => {
  const first = getHeaderNotifications(initialAppointmentRequests, 0, [], null);
  const rerender = getHeaderNotifications(initialAppointmentRequests.map((request) => ({
    ...request, timeAgo: '20 minutes ago',
  })), 0, [], null);
  assert.deepEqual(first.map((item) => item.revision), rerender.map((item) => item.revision));
  const rescheduled = getHeaderNotifications(initialAppointmentRequests.map((request, index) => index === 0
    ? { ...request, timeStr: '14:00 - 14:30' } : request), 0, [], null);
  assert.notEqual(first[0].revision, rescheduled[0].revision);
  assert.equal(first[1].revision, rescheduled[1].revision);
});

test('attention notification changes for a new message, not an equivalent name ordering', () => {
  const first = getHeaderNotifications([], 2, ['Camille', 'Giulia'], null);
  const same = getHeaderNotifications([], 2, ['Giulia', 'Camille'], null);
  assert.equal(first[0].revision, same[0].revision);
  const before = getHeaderNotifications([], 1, ['Camille'], null, 'camille:m3');
  const after = getHeaderNotifications([], 1, ['Camille'], null, 'camille:m4');
  assert.notEqual(before[0].revision, after[0].revision);
});

test('resolving an already-read chat does not make the remaining group unread', () => {
  const read = { attention: ['camille:m3', 'giulia:m1'] };
  const remaining = getHeaderNotifications([], 1, ['Giulia'], null, undefined, ['giulia:m1'])[0];
  assert.equal(isHeaderNotificationUnread(remaining, read), false);
  const newMessage = getHeaderNotifications([], 1, ['Giulia'], null, undefined, ['giulia:m2'])[0];
  assert.equal(isHeaderNotificationUnread(newMessage, read), true);
});
