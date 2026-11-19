import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBridgedRequest, isBridgedRequest, readBridgedRequest, type BridgedRequest } from '../src/requestBridge';
import type { AppointmentRequest } from '../src/types';
import { demoCustomers, demoRequests } from './fixedClock';

// A request as the customers' page in another tab made it: with that tab's own customer id.
const fromOtherTab: AppointmentRequest = {
  id: 'req-other-tab-1', customerName: 'Sandra Keller', customerId: 'cust-from-the-other-tab', customerPhone: '+41791234567',
  serviceId: 'srv-2', serviceName: 'Haircut', employeeId: 'emp-1', staffName: 'Anna Weber',
  date: '2026-10-08', dateStr: 'Thu, 08.10.2026', timeStr: '10:00 - 10:30', timeAgo: '', createdAt: '2026-10-05T09:58:00.000Z',
  channel: 'Web', isAiBooked: false, status: 'pending',
};
const lists = { requests: demoRequests, customers: demoCustomers };

test('a request sent in another tab of this browser arrives once, with a customer from the owner\'s own list', () => {
  const after = applyBridgedRequest(lists, { kind: 'new', request: fromOtherTab })!;
  assert.equal(after.requests.length, demoRequests.length + 1);
  const arrived = after.requests[0];
  assert.equal(arrived.id, 'req-other-tab-1');
  assert.equal(arrived.status, 'pending');
  // The other tab's customer id means nothing here: a new record is made in the owner's list.
  assert.notEqual(arrived.customerId, 'cust-from-the-other-tab');
  const customer = after.customers.find(item => item.id === arrived.customerId)!;
  assert.equal(customer.name, 'Sandra Keller');
  assert.equal(customer.phone, '+41791234567');
  assert.equal(after.customers.length, demoCustomers.length + 1);
  // The same message again (two owner tabs, a repeated delivery) changes nothing.
  assert.equal(applyBridgedRequest(after, { kind: 'new', request: fromOtherTab }), null);
});

test('a customer the salon already knows is matched by the digits of the phone number', () => {
  const known = demoCustomers.find(customer => customer.phone)!;
  const spelled = `0${known.phone.slice(3, 5)} ${known.phone.slice(5, 8)} ${known.phone.slice(8, 10)} ${known.phone.slice(10)}`;
  const after = applyBridgedRequest(lists, { kind: 'new', request: { ...fromOtherTab, customerName: known.name, customerPhone: spelled } })!;
  assert.equal(after.requests[0].customerId, known.id);
  assert.equal(after.customers.length, demoCustomers.length);
  assert.equal(after.requests[0].customerPhone, known.phone);
});

test('while a request waits the customer can change or withdraw it; an answered one stays as the owner left it', () => {
  const waiting = applyBridgedRequest(lists, { kind: 'new', request: fromOtherTab })!;
  const moved = applyBridgedRequest(waiting, { kind: 'updated', request: { ...fromOtherTab, timeStr: '11:00 - 11:30' } })!;
  assert.equal(moved.requests.length, waiting.requests.length);
  assert.equal(moved.requests.find(item => item.id === fromOtherTab.id)!.timeStr, '11:00 - 11:30');
  // The customer record is the same one, not a second.
  assert.equal(moved.customers.length, waiting.customers.length);
  const withdrawn = applyBridgedRequest(moved, { kind: 'cancelled', id: fromOtherTab.id })!;
  assert.equal(withdrawn.requests.some(item => item.id === fromOtherTab.id), false);
  // Nothing to withdraw: no change.
  assert.equal(applyBridgedRequest(withdrawn, { kind: 'cancelled', id: fromOtherTab.id }), null);

  // The owner answered meanwhile. Accepting and rejecting both take the request off the list, and
  // the customer's page, which does not learn the answer, may still send a change: it is dropped.
  // An answered request must never come back as an open one.
  const answered = { ...waiting, requests: waiting.requests.filter(item => item.id !== fromOtherTab.id) };
  assert.equal(applyBridgedRequest(answered, { kind: 'updated', request: { ...fromOtherTab, timeStr: '12:00 - 12:30' } }), null);
  assert.equal(applyBridgedRequest(answered, { kind: 'cancelled', id: fromOtherTab.id }), null);
  // The same holds while a request is still listed with an answer, and for a "new" that arrives
  // again after the tab has handed the request over once.
  const listed = { ...waiting, requests: waiting.requests.map(item => item.id === fromOtherTab.id ? { ...item, status: 'accepted' as const } : item) };
  assert.equal(applyBridgedRequest(listed, { kind: 'updated', request: { ...fromOtherTab, timeStr: '12:00 - 12:30' } }), null);
  assert.equal(applyBridgedRequest(answered, { kind: 'new', request: fromOtherTab }, id => id === fromOtherTab.id), null);
});

test('two requests that arrive one right after the other are both kept', () => {
  const second = { ...fromOtherTab, id: 'req-other-tab-2', customerName: 'Petra Muster', customerPhone: '+41791112233' };
  const afterFirst = applyBridgedRequest(lists, { kind: 'new', request: fromOtherTab })!;
  const afterBoth = applyBridgedRequest(afterFirst, { kind: 'new', request: second })!;
  assert.deepEqual(afterBoth.requests.slice(0, 2).map(item => item.id), ['req-other-tab-2', 'req-other-tab-1']);
  assert.equal(afterBoth.customers.length, demoCustomers.length + 2);
});

test('only a complete, waiting request is taken from another tab, and it is built again from checked fields', () => {
  const good: BridgedRequest = { kind: 'new', request: fromOtherTab };
  assert.equal(isBridgedRequest(good), true);
  assert.deepEqual(readBridgedRequest({ kind: 'cancelled', id: 'req-1', extra: true }), { kind: 'cancelled', id: 'req-1' });
  for (const bad of [
    null, 'new', 42, {}, { kind: 'new' }, { kind: 'cancelled' }, { kind: 'cancelled', id: '' }, { kind: 'accepted', request: fromOtherTab },
    { kind: 'new', request: { ...fromOtherTab, status: 'accepted' } },
    { kind: 'new', request: { ...fromOtherTab, date: '08.10.2026' } },
    { kind: 'new', request: { ...fromOtherTab, date: '2026-13-40' } },
    { kind: 'new', request: { ...fromOtherTab, timeStr: '10 to half past' } },
    { kind: 'new', request: { ...fromOtherTab, timeStr: 1000 } },
    { kind: 'new', request: { ...fromOtherTab, customerName: 'A' } },
    { kind: 'new', request: { ...fromOtherTab, customerPhone: '12' } },
    { kind: 'new', request: { ...fromOtherTab, id: 'x'.repeat(300) } },
    { kind: 'updated', request: { ...fromOtherTab, serviceName: '' } },
  ]) assert.equal(isBridgedRequest(bad), false, JSON.stringify(bad)?.slice(0, 80));

  // Fields of the wrong kind and fields the app does not know are not taken over.
  const odd = readBridgedRequest({ kind: 'new', request: { ...fromOtherTab, createdAt: 1790000000000, serviceId: 42, employeeId: { id: 1 }, staffName: 'x'.repeat(400), isAiBooked: true, channel: 'WhatsApp', timeAgo: 'now', injected: '<b>' } });
  assert.ok(odd && odd.kind === 'new');
  const rebuilt = odd.request as unknown as Record<string, unknown>;
  assert.equal(rebuilt.createdAt, undefined);
  assert.equal(rebuilt.serviceId, undefined);
  assert.equal(rebuilt.employeeId, undefined);
  assert.equal(rebuilt.staffName, undefined);
  assert.equal(rebuilt.isAiBooked, false);
  assert.equal(rebuilt.channel, 'Web');
  assert.equal(rebuilt.timeAgo, '');
  assert.equal('injected' in rebuilt, false);
  // A proper request keeps what it said.
  const kept = readBridgedRequest(good);
  assert.ok(kept && kept.kind === 'new');
  // (The other tab's customer id is not among them: the owner's tab looks the customer up itself.)
  const { customerId: _otherTabsId, ...said } = fromOtherTab;
  assert.deepEqual(kept.request, { ...said, timeAgo: '', channel: 'Web', isAiBooked: false });
});
