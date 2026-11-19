import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoRequests, createIncomingRequest, timeAgoLabel } from '../src/demoRequests.ts';
import { getSalonNow, validateBookingRequest, type AvailabilityContext } from '../src/availability.ts';
import { customerForRequest, normalizePhone, upsertCustomer, validateContact } from '../src/bookingData.ts';
import { createDemoCustomers, createDemoEvents, createDemoShifts, demoNewcomers, demoPeople } from '../src/demoSeed.ts';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData.ts';
import type { AppointmentRequest, CalendarEvent } from '../src/types.ts';
import { demoConversations, demoCustomers, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock.ts';

const contextAt = (now: Date, events: CalendarEvent[], requests: AppointmentRequest[]): AvailabilityContext => ({
  services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours,
  events, shiftOverview: createDemoShifts('Europe/Zurich', now), requests, now, timeZone: 'Europe/Zurich',
});

test('pending requests are valid, never for today, on two days and with two stylists', () => {
  const instants = [
    '2026-10-14T13:45:00Z', '2027-01-02T18:00:00Z', '2027-04-18T23:30:00Z',
    // 14:10 and 17:40 on a working Wednesday: requests for the rest of today would expire while the owner looks at them.
    '2026-11-18T13:10:00Z', '2026-11-18T16:40:00Z',
    // Friday evening and Saturday: the next working days differ per stylist.
    '2026-11-20T17:00:00Z', '2026-11-21T09:00:00Z', '2026-11-22T09:00:00Z',
  ];
  for (const instant of instants) {
    const now = new Date(instant);
    const events = createDemoEvents('Europe/Zurich', now);
    const requests = createDemoRequests('Europe/Zurich', now, events);
    const context = contextAt(now, events, requests);
    const today = getSalonNow('Europe/Zurich', now).date;
    const customers = createDemoCustomers('Europe/Zurich', now, events);
    assert.deepEqual(requests.map((request) => [request.id, request.serviceId, request.employeeId]),
      [['req-1', 'srv-1', 'emp-2'], ['req-2', 'srv-2', 'emp-1']], instant);
    assert.notEqual(requests[0].date, requests[1].date, instant);
    for (const request of requests) {
      assert.equal(request.status, 'pending');
      assert.ok(request.date > today, `${instant}: ${request.id} is for ${request.date}`);
      assert.equal(validateBookingRequest(context, request, request.id), null, `${instant}: ${request.id}`);
      // The request itself holds its time: nobody else can take it.
      assert.match(validateBookingRequest(context, request)!, /no longer available/);
      // The owner and the customer both know the person: an existing customer with the same name and phone.
      const customer = customers.find((item) => item.id === request.customerId)!;
      assert.equal(customer.name, request.customerName);
      assert.equal(customer.phone, request.customerPhone);
      assert.ok(Date.parse(request.createdAt!) < now.getTime());
      // Nobody asks for an appointment while still holding another one.
      assert.ok(!events.some((event) => event.customerId === request.customerId && event.date >= today), instant);
    }
    // Mid-morning with one stylist, afternoon with the other.
    assert.ok(['09:30', '10:00'].includes(requests[0].timeStr.slice(0, 5)), `${instant}: ${requests[0].timeStr}`);
    assert.ok(['13:00', '14:30'].includes(requests[1].timeStr.slice(0, 5)), `${instant}: ${requests[1].timeStr}`);
  }
});

test('requests keep away from a calendar that already uses their planned time', () => {
  const [first] = demoRequests;
  const [start, end] = first.timeStr.split(' - ');
  const blocker: CalendarEvent = {
    ...demoEvents[0], id: 'blocker', employeeId: first.employeeId, staffName: first.staffName!, serviceId: first.serviceId,
    serviceName: first.serviceName, date: first.date, startTime: start, endTime: end,
  };
  const events = [blocker, ...demoEvents];
  const requests = createDemoRequests('Europe/Zurich', FIXED_NOW, events);
  assert.equal(requests.length, 2);
  assert.notEqual(`${requests[0].date} ${requests[0].timeStr}`, `${first.date} ${first.timeStr}`);
  for (const request of requests) assert.equal(validateBookingRequest(contextAt(FIXED_NOW, events, requests), request, request.id), null);
});

test('seeding requests does not alter appointments, conversations or the requests seeded before', () => {
  const before = JSON.stringify({ demoEvents, demoRequests, demoConversations });
  createDemoRequests('Europe/Zurich', new Date('2027-01-01T12:00:00Z'));
  createDemoRequests('Europe/Zurich', FIXED_NOW, demoEvents);
  assert.equal(JSON.stringify({ demoEvents, demoRequests, demoConversations }), before);
});

test('the age of a request is worded from its time stamp', () => {
  const now = new Date('2026-10-05T10:00:00Z');
  const ago = (minutes: number) => timeAgoLabel(new Date(now.getTime() - minutes * 60_000).toISOString(), now);
  assert.equal(ago(0), 'Just now');
  assert.equal(ago(1), '1 minute ago');
  assert.equal(ago(47), '47 minutes ago');
  assert.equal(ago(60), '1 hour ago');
  assert.equal(ago(179), '2 hours ago');
  assert.equal(ago(60 * 24), 'Yesterday');
  assert.equal(ago(60 * 24 * 3), '3 days ago');
  assert.equal(ago(-5), 'Just now'); // a clock that is slightly behind never shows a negative age
  assert.deepEqual(demoRequests.map((request) => request.timeAgo), ['12 minutes ago', '47 minutes ago']);
});

test('an incoming web request comes from a new person, for a service offered online, from tomorrow on', () => {
  const context = { ...contextAt(FIXED_NOW, demoEvents, demoRequests), shiftOverview: demoShifts };
  const request = createIncomingRequest(context, demoCustomers, 'req-new')!;
  assert.equal(request.id, 'req-new');
  assert.equal(request.channel, 'Web');
  assert.equal(request.isAiBooked, false);
  assert.ok(!demoCustomers.some((customer) => customer.name === request.customerName));
  assert.ok(initialServices.find((service) => service.id === request.serviceId)!.onlineBooking);
  assert.ok(request.date > getSalonNow('Europe/Zurich', FIXED_NOW).date);
  assert.equal(validateBookingRequest(context, request), null);
  // After a rename the helper still finds a service: it never looks for one by name.
  const renamed = { ...context, services: initialServices.map((service) => ({ ...service, name: `${service.name} (new)` })) };
  assert.match(createIncomingRequest(renamed, demoCustomers, 'req-renamed')!.serviceName, /\(new\)$/);
  // Nothing offered online, or nobody left to invent: no request.
  assert.equal(createIncomingRequest({ ...context, services: initialServices.map((service) => ({ ...service, onlineBooking: false })) }, demoCustomers, 'x'), null);
  assert.equal(createIncomingRequest(context, demoPeople(), 'x'), null);
});

test('simulated requests come one after another from different new people, each with a number of their own', () => {
  // What the app does with "Simulate incoming booking": the request waits on Home, its sender
  // becomes a customer, and the next request has to come from somebody else at another time.
  let customers = demoCustomers;
  let requests = demoRequests;
  const taken = new Set<string>();
  for (const newcomer of demoNewcomers) {
    const context = { ...contextAt(FIXED_NOW, demoEvents, requests), shiftOverview: demoShifts };
    const request = createIncomingRequest(context, customers, `req-new-${taken.size}`);
    assert.ok(request, newcomer.name);
    assert.equal(request.customerName, newcomer.name);
    assert.equal(request.customerPhone, newcomer.phone);
    // Nobody the salon knows: neither the name nor the number is in the records yet.
    assert.ok(!customers.some((customer) => customer.name === request.customerName ||
      (customer.phone && normalizePhone(customer.phone) === normalizePhone(request.customerPhone!))), newcomer.name);
    // The request passes the checks of the booking page: a full contact and a time that is free.
    assert.equal(validateContact(request.customerName, request.customerPhone ?? ''), null);
    assert.equal(validateBookingRequest(context, request), null, newcomer.name);
    assert.ok(initialServices.find((service) => service.id === request.serviceId)!.onlineBooking);
    const time = `${request.employeeId} ${request.date} ${request.timeStr}`;
    assert.ok(!taken.has(time), `${time} was given twice`);
    taken.add(time);
    customers = upsertCustomer(customers, customerForRequest(customers, request));
    requests = [request, ...requests];
  }
  assert.equal(new Set(requests.map((request) => request.customerPhone)).size, requests.length);
  // Somebody whose request is still waiting counts as known as well, also without a record.
  const waiting = [...demoCustomers, { id: '', name: demoNewcomers[0].name }];
  assert.equal(createIncomingRequest({ ...contextAt(FIXED_NOW, demoEvents, demoRequests), shiftOverview: demoShifts }, waiting, 'req-next')!.customerName, demoNewcomers[1].name);
});

test('there is somebody new on every day, also when everybody else has an appointment', () => {
  // On 3 June 2027 every regular is in the calendar: without the newcomers nobody would be left.
  for (const instant of ['2027-06-03T08:30:00Z', '2026-11-19T08:00:00Z', '2026-12-31T22:55:00Z']) {
    const now = new Date(instant);
    const events = createDemoEvents('Europe/Zurich', now);
    const customers = createDemoCustomers('Europe/Zurich', now, events);
    const request = createIncomingRequest(contextAt(now, events, createDemoRequests('Europe/Zurich', now, events)), customers, 'req-new');
    assert.equal(request?.customerName, demoNewcomers[0].name, instant);
    // Newcomers are never part of the calendar or the customer list the salon starts with.
    for (const newcomer of demoNewcomers) {
      assert.ok(!customers.some((customer) => customer.id === newcomer.id || customer.name === newcomer.name), `${instant}: ${newcomer.name}`);
      assert.ok(!events.some((event) => event.customerName === newcomer.name), `${instant}: ${newcomer.name}`);
    }
  }
});
