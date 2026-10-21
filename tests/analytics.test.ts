import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsRangeError, appointmentAnalytics, conversationAnalytics } from '../src/analytics';
import { initialCalendarEvents } from '../src/mockData';
import { initialConversations } from '../src/conversationData';

test('analytics filters appointments by inclusive date boundaries and derives actual counts', () => {
  const template = initialCalendarEvents[0];
  const events = [
    { ...template, id: 'a', date: '2026-10-01', customerId: 'one', isAiBooked: true },
    { ...template, id: 'b', date: '2026-10-03', customerId: 'one', isAiBooked: false },
    { ...template, id: 'c', date: '2026-10-04', customerId: 'two' },
  ];
  const result = appointmentAnalytics(events, '2026-10-01', '2026-10-03');
  assert.equal(result.total, 2);
  assert.equal(result.customers, 1);
  assert.equal(result.aiBookings, 1);
  assert.deepEqual(result.series.map(point => point.count), [1, 0, 1]);
  assert.equal(appointmentAnalytics(events, '2026-11-01', '2026-11-01').total, 0);
});

test('analytics rejects impossible, reversed or unbounded date ranges', () => {
  for (const [from, to] of [['2026-02-30', '2026-03-01'], ['', '2026-10-01'], ['2026-10-02', '2026-10-01'], ['2020-01-01', '2026-01-01']]) {
    assert.ok(analyticsRangeError(from, to));
    assert.deepEqual(appointmentAnalytics(initialCalendarEvents, from, to).series, []);
  }
  assert.equal(analyticsRangeError('2026-10-01', '2026-10-01'), null);
});

test('customer totals reconcile legacy names with unique IDs without merging distinct contacts', () => {
  const template = { ...initialCalendarEvents[0], date: '2026-10-01', customerName: 'Test Customer' };
  const legacy = { ...template, id: 'legacy', customerId: undefined };
  const linked = { ...template, id: 'linked', customerId: 'customer-one' };
  assert.equal(appointmentAnalytics([legacy, linked], template.date, template.date).customers, 1);
  assert.equal(appointmentAnalytics([linked, { ...linked, id: 'other', customerId: 'customer-two' }], template.date, template.date).customers, 2);
});

test('conversation analytics counts real messages and customer languages separately', () => {
  const conversations = initialConversations.slice(0, 2);
  const result = conversationAnalytics(conversations);
  assert.equal(result.total, conversations.reduce((total, item) => total + item.messages.length, 0));
  assert.equal(result.customer + result.ai + result.owner, result.total);
  assert.equal(result.languages.reduce((total, item) => total + item.count, 0), conversations.length);
  assert.equal(conversationAnalytics([]).total, 0);
});
