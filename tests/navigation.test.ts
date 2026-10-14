import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRoute, routeHash } from '../src/navigation';
import { nextUpcomingAppointment } from '../src/dashboard';
import { initialCalendarEvents } from '../src/mockData';

test('search and notification routes retain exact record IDs across navigation', () => {
  for (const route of [
    { tab: 'home' as const, requestId: 'req-2' },
    { tab: 'customers' as const, customerId: 'customer & 2' },
    { tab: 'calendar' as const, appointmentId: 'cal-2' },
    { tab: 'conversations' as const, conversationId: 'conv-2' },
  ]) assert.deepEqual(parseRoute(routeHash(route)), route);
});

test('unknown routes fall back and unrelated selection IDs are ignored', () => {
  assert.deepEqual(parseRoute('#/missing'), { tab: 'home' });
  assert.deepEqual(parseRoute('#/customers?appointmentId=cal-2'), { tab: 'customers' });
  assert.deepEqual(parseRoute(''), { tab: 'home' });
});

test('next appointment is derived from the earliest upcoming calendar record', () => {
  const base = initialCalendarEvents[0];
  const events = [
    { ...base, id: 'later', date: '2026-10-15', startTime: '09:00' },
    { ...base, id: 'past', date: '2026-10-14', startTime: '10:00' },
    { ...base, id: 'next', date: '2026-10-14', startTime: '15:00' },
  ];
  const now = new Date('2026-10-14T12:00:00Z'); // 14:00 in Zurich
  assert.equal(nextUpcomingAppointment(events, now)?.id, 'next');
  assert.equal(nextUpcomingAppointment(events.filter(e => e.id !== 'next'), now)?.id, 'later');
  assert.equal(nextUpcomingAppointment(events.filter(e => e.id === 'past'), now), null);
  assert.equal(nextUpcomingAppointment([], now), null);
});

test('next appointment uses salon timezone across midnight and does not mutate calendar order', () => {
  const events = [{ ...initialCalendarEvents[0], id: 'tomorrow', date: '2026-10-15', startTime: '00:30' }];
  assert.equal(nextUpcomingAppointment(events, new Date('2026-10-14T22:45:00Z')), null);
  assert.equal(events[0].id, 'tomorrow');
});
