import test from 'node:test';
import assert from 'node:assert/strict';
import { customerForAppointment, customerForRequest, formatPhone, isPhoneNumber, normalizePhone, upsertCustomer, validateContact } from '../src/bookingData';
import { appointmentFromRequest } from '../src/appointmentActions';
import { initialServices } from '../src/mockData';
import { demoRequests } from './fixedClock';

const request = { ...demoRequests[0], id: 'contact-test', customerId: undefined, customerName: 'Test Customer', customerPhone: '+41 79 123 45 67', isAiBooked: false };

test('contact validation rejects missing names, missing phones and arbitrary text', () => {
  assert.match(validateContact('   ', '+41791234567')!, /name/);
  assert.match(validateContact('Test', '')!, /phone/);
  assert.match(validateContact('Test', 'abc')!, /valid phone/);
  assert.match(validateContact('Test', '++41791234567')!, /valid phone/);
  assert.equal(validateContact('Test', '0041 (79) 123-45-67'), null);
  assert.equal(normalizePhone('0041 (79) 123-45-67'), '+41791234567');
});

test('phone numbers are written one way, and labels are never taken for numbers', () => {
  assert.equal(formatPhone('0041 (79) 123-45-67'), '+41 79 123 45 67');
  assert.equal(formatPhone('+41791234567'), '+41 79 123 45 67');
  assert.equal(formatPhone('+41 79 123 45 67'), '+41 79 123 45 67');
  assert.equal(formatPhone('0791234567'), '+41 79 123 45 67'); // the national spelling is the same number, shown the one way
  assert.equal(formatPhone('+49 151 1234 5678'), '+49 151 123 456 78'); // another country: its code and plain groups
  assert.equal(isPhoneNumber('+41 79 123 45 67'), true);
  for (const label of ['Test visitor', 'Telegram user', '+41 ••• ••• 67', '', undefined]) assert.equal(isPhoneNumber(label), false, String(label));
});

test('pending bookings create contacts without inventing prior bookings', () => {
  const customer = customerForRequest([], request);
  // Typed "+41 79 123 45 67": stored once, in the international form.
  assert.equal(customer.phone, '+41791234567');
  assert.equal(formatPhone(customer.phone), '+41 79 123 45 67');
  // Visits are counted from the calendar (tests/customerStats.test.ts); the record stores none.
  assert.deepEqual(Object.keys(customer).sort(), ['email', 'id', 'initials', 'language', 'name', 'phone']);
  const repeat = customerForRequest([customer], { ...request, id: 'another-request' });
  assert.equal(repeat.id, customer.id);
  assert.equal(upsertCustomer([customer], repeat).length, 1);
  const otherPerson = customerForRequest([customer], { ...request, id: 'family-request', customerName: 'Another Person' });
  assert.notEqual(otherPerson.id, customer.id);
});

test('a number the record has is never rewritten; a new number is stored in the international form', () => {
  // A record saved earlier with spaces: the same number arrives without them (the booking page
  // sends it that way) and nothing is rewritten, neither by the request nor when it is accepted.
  const spaced = { ...customerForRequest([], request), phone: '+41 79 123 45 67' };
  assert.equal(customerForRequest([spaced], { ...request, customerPhone: '+41791234567' }).phone, '+41 79 123 45 67');
  const event = appointmentFromRequest({ ...request, customerId: spaced.id, customerPhone: '+41791234567' }, initialServices);
  assert.equal(customerForAppointment([spaced], event).customer.phone, '+41 79 123 45 67');
  // The same holds for a number once typed in the national form, however the booking spells it ...
  const typed = { ...spaced, phone: '079 123 45 67' };
  assert.equal(customerForRequest([typed], { ...request, customerId: typed.id, customerPhone: '0791234567' }).phone, '079 123 45 67');
  assert.equal(customerForRequest([typed], { ...request, customerId: typed.id, customerPhone: '+41 79 123 45 67' }).phone, '079 123 45 67');
  assert.equal(customerForAppointment([typed], event).customer.phone, '079 123 45 67');
  // ... and both are shown the one way.
  assert.equal(formatPhone(typed.phone), formatPhone(spaced.phone));
  // A different number replaces it, stored in the international form.
  assert.equal(customerForRequest([typed], { ...request, customerId: typed.id, customerPhone: '079 000 00 00' }).phone, '+41790000000');
});

test('contact edits keep their customer identity and details', () => {
  const customer = { ...customerForRequest([], request), email: 'kept@example.com', language: 'DE' as const };
  const edited = customerForRequest([customer], { ...request, customerId: customer.id, customerPhone: '+41790000000' });
  assert.equal(edited.id, customer.id);
  assert.equal(edited.phone, '+41790000000');
  assert.equal(edited.email, 'kept@example.com');
  assert.equal(edited.language, 'DE');
});

test('acceptance preserves contact details and never infers AI handling from a channel label', () => {
  for (const channel of ['Web', 'WhatsApp', 'Instagram'] as const) {
    const appointment = appointmentFromRequest({ ...request, channel, customerId: 'cust-test' }, initialServices);
    assert.equal(appointment.customerPhone, request.customerPhone);
    assert.equal(appointment.customerId, 'cust-test');
    assert.equal(appointment.isAiBooked, false);
  }
  assert.equal(appointmentFromRequest({ ...request, isAiBooked: true }, initialServices).isAiBooked, true);
});

const alice = { ...customerForRequest([], { ...request, customerName: 'Alice' }), id: 'alice', email: 'alice@example.ch' };
const bob = { ...alice, id: 'bob', name: 'Bob', initials: 'B', phone: '+41790000002', email: 'bob@example.ch' };
const appointment = appointmentFromRequest({ ...request, customerName: alice.name, customerId: alice.id }, initialServices);

test('new confirmed bookings link known contacts and keep their details', () => {
  const result = customerForAppointment([alice], appointment);
  assert.equal(result.customer.id, alice.id);
  assert.equal(result.customer.email, alice.email);
  assert.equal(result.customer.phone, alice.phone);
  assert.equal(result.previousCustomerId, undefined);
});

test('rescheduling preserves explicit customer identity', () => {
  const moved = { ...appointment, date: '2026-11-03', startTime: '14:00', endTime: '14:30' };
  const result = customerForAppointment([alice], moved, appointment);
  assert.equal(result.customer.id, alice.id);
  assert.equal(result.previousCustomerId, alice.id);
  assert.deepEqual(result.customer, alice);
});

test('legacy appointments match a unique name on reschedule', () => {
  const legacy = { ...appointment, customerId: undefined, customerPhone: undefined, customerName: '  ALICE  ' };
  const result = customerForAppointment([alice], { ...legacy, date: '2026-11-03' }, legacy);
  assert.equal(result.customer.id, alice.id);
  assert.equal(result.previousCustomerId, alice.id);
  assert.equal(result.customer.phone, alice.phone);
});

test('legacy name matching is unambiguous and uses phone numbers to distinguish namesakes', () => {
  const namesake = { ...alice, id: 'other-alice', phone: '+41790000003' };
  const legacy = { ...appointment, customerId: undefined, customerPhone: undefined };
  const ambiguous = customerForAppointment([alice, namesake], legacy, legacy);
  assert.notEqual(ambiguous.customer.id, alice.id);
  assert.notEqual(ambiguous.customer.id, namesake.id);
  assert.equal(ambiguous.customer.phone, '');
  assert.equal(ambiguous.previousCustomerId, undefined);
  const withPhone = { ...legacy, customerPhone: '+41 79 000 00 03' };
  const matched = customerForAppointment([alice, namesake], withPhone, withPhone);
  assert.equal(matched.customer.id, namesake.id);
  assert.equal(matched.previousCustomerId, namesake.id);
  assert.equal(matched.customer.phone, namesake.phone);
  const differentPhone = customerForAppointment([alice], { ...legacy, customerPhone: '+41790000004' });
  assert.notEqual(differentPhone.customer.id, alice.id);
});

test('an explicit ID preserves the right customer when multiple people share their name', () => {
  const namesake = { ...alice, id: 'other-alice', phone: '+41790000003' };
  const result = customerForAppointment([namesake, alice], appointment, appointment);
  assert.equal(result.customer.id, alice.id);
  assert.equal(result.customer.phone, alice.phone);
});

test('reassigning an appointment to a new name creates a fresh contact without leaking the old contact', () => {
  const created = customerForAppointment([], { ...appointment, customerId: undefined });
  const original = { ...appointment, customerId: created.customer.id, customerPhone: created.customer.phone };
  const reassigned = customerForAppointment([created.customer], { ...original, customerName: 'Bob' }, original);
  assert.notEqual(reassigned.customer.id, created.customer.id);
  assert.equal(reassigned.previousCustomerId, created.customer.id);
  assert.equal(reassigned.customer.name, 'Bob');
  assert.equal(reassigned.customer.phone, '');
  assert.equal(reassigned.customer.email, '');
  assert.deepEqual(upsertCustomer([created.customer], reassigned.customer).find(customer => customer.id === created.customer.id), created.customer);
});

test('reassigning to a unique existing customer preserves their contact and names the previous customer', () => {
  const reassigned = customerForAppointment([alice, bob], { ...appointment, customerName: 'Bob' }, appointment);
  assert.equal(reassigned.customer.id, bob.id);
  assert.equal(reassigned.previousCustomerId, alice.id);
  assert.equal(reassigned.customer.phone, bob.phone);
  assert.equal(reassigned.customer.email, bob.email);
});
