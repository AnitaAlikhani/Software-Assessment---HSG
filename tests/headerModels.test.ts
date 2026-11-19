import assert from 'node:assert/strict';
import test from 'node:test';
import { getHeaderSearchResults, headerAccount, headerSearchDetail } from '../src/headerModels';
import { initialEmployees } from '../src/mockData';
import { demoCustomers, demoEvents, demoRequests } from './fixedClock';

test('header search trims and normalizes queries and finds confirmed appointments', () => {
  const results = getHeaderSearchResults([], [], demoEvents, '  JOHN BENNETT  ');
  const john = demoEvents.find((event) => event.id === 'cal-john')!;
  assert.ok(results.length >= 1);
  assert.ok(results.every((result) => result.kind === 'appointment' && result.record.customerName === 'John Bennett'));
  assert.ok(results.some((result) => result.record === john));
  assert.deepEqual(getHeaderSearchResults(demoCustomers, demoRequests, demoEvents, '   '), []);
});

test('search keeps customer, pending request and confirmed appointment results distinct', () => {
  // The person behind the first request is a regular: a customer, with a request and earlier appointments.
  const results = getHeaderSearchResults(demoCustomers, demoRequests, demoEvents, demoRequests[0].customerName);
  assert.ok(results.some((result) => result.kind === 'customer'));
  assert.ok(results.some((result) => result.kind === 'request'));
  assert.ok(results.some((result) => result.kind === 'appointment'));
  assert.deepEqual(getHeaderSearchResults([], demoRequests.map((request) => ({
    ...request, status: 'rejected' as const,
  })), [], demoRequests[0].serviceName), []);
});

test('everybody in a chat, a request or the calendar can be found as a customer', () => {
  for (const name of ['Camille', 'Giulia Rossi', demoRequests[1].customerName, demoEvents[0].customerName]) {
    assert.ok(getHeaderSearchResults(demoCustomers, [], [], name).some((result) => result.kind === 'customer'), name);
  }
});

test('a search result shows only the details that exist, without a separator left over', () => {
  const customer = (phone: string, email: string) => headerSearchDetail({ kind: 'customer', record: { ...demoCustomers[0], phone, email } });
  assert.equal(customer('+41 79 555 61 12', 'marie.dupont@example.com'), '+41 79 555 61 12 · marie.dupont@example.com');
  assert.equal(customer('+41 79 555 61 12', ''), '+41 79 555 61 12');
  // A number is stored without spaces and shown grouped, like everywhere else.
  assert.equal(customer('+41795556112', ''), '+41 79 555 61 12');
  assert.equal(customer('', 'marie.dupont@example.com'), 'marie.dupont@example.com');
  // Somebody who is only known from a chat has neither: the line is left out.
  assert.equal(customer('', ''), '');
  // Most customers of the salon never gave an e-mail address: none of their lines ends in a separator.
  const results = getHeaderSearchResults(demoCustomers, demoRequests, demoEvents, 'e');
  assert.ok(results.filter((result) => result.kind === 'customer' && !result.record.email).length > 50);
  for (const result of results) assert.doesNotMatch(headerSearchDetail(result), /^\s*·|·\s*$|·\s*·/, result.record.id);
  // Requests and appointments keep their three parts. Date and time are written from the record's
  // own data, in the forms of every screen: the request is stored for 2026-10-07, "10:00 - 10:30".
  const request = demoRequests[0];
  assert.equal(headerSearchDetail({ kind: 'request', record: request }), `${request.serviceName} · Wed, 07.10.2026 · 10:00–10:30`);
  const appointment = demoEvents[0];
  const [service, date, time] = headerSearchDetail({ kind: 'appointment', record: appointment }).split(' · ');
  assert.deepEqual([service, time], [appointment.serviceName, appointment.startTime]);
  assert.match(date, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2}\.\d{2}\.\d{4}$/);
  assert.equal(date.slice(5).split('.').reverse().join('-'), appointment.date);
});

test('the account in the header is the owner from the team data', () => {
  assert.deepEqual(headerAccount(initialEmployees), { ownerName: 'Anna Weber', ownerRole: 'Owner' });
  // Renaming the owner in Team changes the header, wherever she stands in the list.
  const renamed = initialEmployees.map((employee) => employee.id === 'emp-1'
    ? { ...employee, firstName: 'Annette', lastName: 'Weber-Graf', name: 'Annette Weber-Graf' } : employee);
  assert.deepEqual(headerAccount(renamed), { ownerName: 'Annette Weber-Graf', ownerRole: 'Owner' });
  assert.deepEqual(headerAccount([...renamed].reverse()), { ownerName: 'Annette Weber-Graf', ownerRole: 'Owner' });
  // Without an owner in the team the first employee stands there, and no role is made up for them.
  assert.deepEqual(headerAccount(initialEmployees.slice(1)), { ownerName: 'Selina Keller', ownerRole: '' });
  // An empty team: the header then shows a neutral account block.
  assert.deepEqual(headerAccount([]), { ownerName: '', ownerRole: '' });
});
