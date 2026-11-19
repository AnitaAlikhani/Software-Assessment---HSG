import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUSTOMER_SORT_OPTIONS, FIRST_DIRECTION, customerSortValue, nextCustomerSort, sortCustomers,
  type CustomerSort, type CustomerSortKey,
} from '../src/customerSort';
import { customerStatsFromCalendar, emptyCustomerStats, type CustomerStats } from '../src/customerStats';
import type { CalendarEvent, Customer } from '../src/types';
import { demoCustomers, demoEvents, FIXED_NOW } from './fixedClock';

// The order of the customer list: set by the column headers on wide screens and by "Sort by" on
// phones. The moment is fixed (Monday 5 October 2026, 12:00 in Zurich); nothing reads the clock.

const person = (id: string, name: string): Customer => ({ id, name, initials: '', email: '', phone: '', language: 'DE' });
const visit = (id: string, customerId: string, date: string, startTime: string): CalendarEvent =>
  ({ ...demoEvents[0], id, customerId, customerName: customerId, conversationId: undefined, date, startTime, endTime: startTime });

// Five customers, counted by hand. Urs comes twice: his last visit is the newest, his next
// appointment the latest. Zoé has never been in and has nothing booked.
const PEOPLE = [person('zoe', 'Zoé Zürcher'), person('anna', 'Anna Äbi'), person('urs', 'Urs Ott'), person('aebi', 'Äbi Keller'), person('bea', 'bea Meier')];
const EVENTS = [
  visit('a1', 'anna', '2026-09-01', '10:00'), visit('a2', 'anna', '2026-10-06', '09:00'),
  visit('u1', 'urs', '2026-09-20', '14:00'), visit('u2', 'urs', '2026-10-02', '08:30'), visit('u3', 'urs', '2026-10-20', '11:00'),
  visit('b1', 'bea', '2026-10-02', '08:00'),
  visit('k1', 'aebi', '2026-10-05', '12:00'), // starts this minute: still "next", not yet a visit
];
const stats = customerStatsFromCalendar(PEOPLE, EVENTS, FIXED_NOW, 'Europe/Zurich');
const statsOf = (customer: Customer): CustomerStats => stats.get(customer.id) ?? emptyCustomerStats;
const order = (sort: CustomerSort) => sortCustomers(PEOPLE, statsOf, sort).map((customer) => customer.id);

test('without a chosen order the list stays as it is kept, and sorting never changes the list it is given', () => {
  const before = PEOPLE.map((customer) => customer.id);
  assert.deepEqual(order(null), before);
  assert.notEqual(sortCustomers(PEOPLE, statsOf, null), PEOPLE);
  for (const option of CUSTOMER_SORT_OPTIONS) order(option.sort);
  assert.deepEqual(PEOPLE.map((customer) => customer.id), before);
});

test('names sort the German way: umlauts beside their letter, capitals ignored', () => {
  // "Äbi Keller" stands with the A's, not after "Zoé"; "bea" is not sent to the end for its small letter.
  assert.deepEqual(order({ key: 'name', direction: 'ascending' }), ['aebi', 'anna', 'bea', 'urs', 'zoe']);
  assert.deepEqual(order({ key: 'name', direction: 'descending' }), ['zoe', 'urs', 'bea', 'anna', 'aebi']);
  // Namesakes keep the order they were given in, in both directions.
  const twins = [person('second', 'Lea Brunner'), person('first', 'Lea Brunner'), person('other', 'Ida Arn')];
  const none = () => emptyCustomerStats;
  assert.deepEqual(sortCustomers(twins, none, { key: 'name', direction: 'ascending' }).map((customer) => customer.id), ['other', 'second', 'first']);
  assert.deepEqual(sortCustomers(twins, none, { key: 'name', direction: 'descending' }).map((customer) => customer.id), ['second', 'first', 'other']);
});

test('last visit and next appointment sort by day and time; a customer without one comes last in both directions', () => {
  // Last visits: Urs 02.10. 08:30, Bea 02.10. 08:00, Anna 01.09.; Äbi and Zoé have none.
  assert.deepEqual(order({ key: 'lastVisit', direction: 'descending' }), ['urs', 'bea', 'anna', 'aebi', 'zoe']);
  assert.deepEqual(order({ key: 'lastVisit', direction: 'ascending' }), ['anna', 'bea', 'urs', 'aebi', 'zoe']);
  // Next appointments: Äbi today 12:00, Anna 06.10., Urs 20.10.; Bea and Zoé have none.
  assert.deepEqual(order({ key: 'nextAppointment', direction: 'ascending' }), ['aebi', 'anna', 'urs', 'bea', 'zoe']);
  assert.deepEqual(order({ key: 'nextAppointment', direction: 'descending' }), ['urs', 'anna', 'aebi', 'bea', 'zoe']);
});

test('visits sort by their number, and equal numbers by name', () => {
  // Urs 2, Anna 1, Bea 1, Äbi 0, Zoé 0.
  assert.deepEqual(order({ key: 'visits', direction: 'descending' }), ['urs', 'anna', 'bea', 'aebi', 'zoe']);
  assert.deepEqual(order({ key: 'visits', direction: 'ascending' }), ['aebi', 'zoe', 'anna', 'bea', 'urs']);
});

test('the seeded salon: every order holds all customers and follows the calendar\'s figures', () => {
  const seeded = customerStatsFromCalendar(demoCustomers, demoEvents, FIXED_NOW, 'Europe/Zurich');
  const of = (customer: Customer) => seeded.get(customer.id)!;
  const moment = (event: CalendarEvent | null) => event ? `${event.date} ${event.startTime}` : null;
  for (const option of CUSTOMER_SORT_OPTIONS) {
    const sorted = sortCustomers(demoCustomers, of, option.sort);
    assert.equal(sorted.length, demoCustomers.length, option.label);
    assert.equal(new Set(sorted).size, demoCustomers.length, option.label);
  }
  // Most visits first: no customer has more visits than the one before.
  const byVisits = sortCustomers(demoCustomers, of, { key: 'visits', direction: 'descending' }).map((customer) => of(customer).visits);
  assert.deepEqual(byVisits, [...byVisits].sort((a, b) => b - a));
  assert.ok(byVisits[0] > byVisits.at(-1)!);
  // Soonest appointment first: the dates rise, then come the customers with nothing booked.
  const next = sortCustomers(demoCustomers, of, { key: 'nextAppointment', direction: 'ascending' }).map((customer) => moment(of(customer).nextAppointment));
  const booked = next.filter((value): value is string => value !== null);
  assert.ok(booked.length > 0 && booked.length < next.length);
  assert.deepEqual(next, [...[...booked].sort(), ...next.slice(booked.length).map(() => null)]);
  // Newest visit first: the dates fall, then come the customers who have not been in yet.
  const last = sortCustomers(demoCustomers, of, { key: 'lastVisit', direction: 'descending' }).map((customer) => moment(of(customer).lastVisit));
  const visited = last.filter((value): value is string => value !== null);
  assert.deepEqual(last, [...[...visited].sort().reverse(), ...last.slice(visited.length).map(() => null)]);
});

test('a column header gives its most useful direction first, then the other, then the kept order again', () => {
  assert.deepEqual(FIRST_DIRECTION, { name: 'ascending', lastVisit: 'descending', nextAppointment: 'ascending', visits: 'descending' });
  for (const key of Object.keys(FIRST_DIRECTION) as CustomerSortKey[]) {
    const first = nextCustomerSort(null, key);
    assert.deepEqual(first, { key, direction: FIRST_DIRECTION[key] });
    const second = nextCustomerSort(first, key);
    assert.equal(second?.key, key);
    assert.notEqual(second?.direction, first?.direction);
    assert.equal(nextCustomerSort(second, key), null);
    // Another column starts with its own first direction, whatever was chosen before.
    for (const other of Object.keys(FIRST_DIRECTION) as CustomerSortKey[]) {
      if (other !== key) assert.deepEqual(nextCustomerSort(second, other), { key: other, direction: FIRST_DIRECTION[other] });
    }
  }
});

test('the phones\' "Sort by" list offers the kept order and every column in both directions', () => {
  assert.deepEqual(CUSTOMER_SORT_OPTIONS[0], { value: '', label: 'Default order', sort: null });
  const offered = CUSTOMER_SORT_OPTIONS.slice(1).map((option) => customerSortValue(option.sort));
  const every = (Object.keys(FIRST_DIRECTION) as CustomerSortKey[]).flatMap((key) => [`${key}:ascending`, `${key}:descending`]);
  assert.deepEqual([...offered].sort(), [...every].sort());
  // Each column lists the direction a header gives first before the other one.
  for (const key of Object.keys(FIRST_DIRECTION) as CustomerSortKey[]) {
    assert.ok(offered.indexOf(`${key}:${FIRST_DIRECTION[key]}`) < offered.indexOf(`${key}:${FIRST_DIRECTION[key] === 'ascending' ? 'descending' : 'ascending'}`), key);
  }
  // The value of a choice is the value the list selects for that order.
  for (const option of CUSTOMER_SORT_OPTIONS) assert.equal(customerSortValue(option.sort), option.value);
  assert.equal(new Set(CUSTOMER_SORT_OPTIONS.map((option) => option.label)).size, CUSTOMER_SORT_OPTIONS.length);
});
