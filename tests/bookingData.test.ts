import test from 'node:test';
import assert from 'node:assert/strict';
import { customerForAppointment, customerForRequest, normalizePhone, upsertCustomer, validateContact } from '../src/bookingData';
import { appointmentFromRequest } from '../src/appointmentActions';
import { initialAppointmentRequests, initialServices } from '../src/mockData';

const request = { ...initialAppointmentRequests[0], id: 'contact-test', customerName: 'Test Customer', customerPhone: '+41 79 123 45 67', isAiBooked: false };

test('contact validation rejects missing names, missing phones and arbitrary text', () => {
  assert.match(validateContact('   ', '+41791234567')!, /name/);
  assert.match(validateContact('Test', '')!, /phone/);
  assert.match(validateContact('Test', 'abc')!, /valid phone/);
  assert.match(validateContact('Test', '++41791234567')!, /valid phone/);
  assert.equal(validateContact('Test', '0041 (79) 123-45-67'), null);
  assert.equal(normalizePhone('0041 (79) 123-45-67'), '+41791234567');
});

test('pending bookings create contacts without inventing prior bookings', () => {
  const customer = customerForRequest([], request);
  assert.equal(customer.phone, '+41791234567');
  assert.equal(customer.bookingsCount, 0);
  assert.equal(customer.lastBooking, 'No confirmed bookings');
  const repeat = customerForRequest([customer], { ...request, id: 'another-request' });
  assert.equal(repeat.id, customer.id);
  assert.equal(upsertCustomer([customer], repeat).length, 1);
  const otherPerson = customerForRequest([customer], { ...request, id: 'family-request', customerName: 'Another Person' });
  assert.notEqual(otherPerson.id, customer.id);
});

test('contact edits keep their customer identity and confirmed booking history', () => {
  const customer = { ...customerForRequest([], request), bookingsCount: 2, lastBooking: 'Earlier appointment' };
  const edited = customerForRequest([customer], { ...request, customerId: customer.id, customerPhone: '+41790000000' });
  assert.equal(edited.id, customer.id);
  assert.equal(edited.phone, '+41790000000');
  assert.equal(edited.bookingsCount, 2);
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

const alice = { ...customerForRequest([], { ...request, customerName: 'Alice' }), id: 'alice', email: 'alice@example.ch', bookingsCount: 3 };
const bob = { ...alice, id: 'bob', name: 'Bob', initials: 'B', phone: '+41790000002', email: 'bob@example.ch', bookingsCount: 2 };
const appointment = appointmentFromRequest({ ...request, customerName: alice.name, customerId: alice.id }, initialServices);

test('new confirmed bookings link known contacts and increment their count once', () => {
  const result = customerForAppointment([alice], appointment);
  assert.equal(result.customer.id, alice.id);
  assert.equal(result.customer.bookingsCount, 4);
  assert.equal(result.customer.email, alice.email);
  assert.equal(result.customer.phone, alice.phone);
  assert.equal(result.previousCustomerId, undefined);
});

test('rescheduling preserves explicit customer identity and booking count', () => {
  const moved = { ...appointment, date: '2026-11-03', startTime: '14:00', endTime: '14:30' };
  const result = customerForAppointment([alice], moved, appointment);
  assert.equal(result.customer.id, alice.id);
  assert.equal(result.previousCustomerId, alice.id);
  assert.equal(result.customer.bookingsCount, 3);
  assert.equal(result.customer.lastBooking, '3 November 2026, 14:00');
});

test('legacy appointments match a unique name without adding a booking on reschedule', () => {
  const legacy = { ...appointment, customerId: undefined, customerPhone: undefined, customerName: '  ALICE  ' };
  const result = customerForAppointment([alice], { ...legacy, date: '2026-11-03' }, legacy);
  assert.equal(result.customer.id, alice.id);
  assert.equal(result.previousCustomerId, alice.id);
  assert.equal(result.customer.bookingsCount, 3);
  assert.equal(result.customer.phone, alice.phone);
});

test('legacy name matching is unambiguous and uses phone numbers to distinguish namesakes', () => {
  const namesake = { ...alice, id: 'other-alice', phone: '+41790000003', bookingsCount: 7 };
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
  assert.equal(matched.customer.bookingsCount, 7);
  const differentPhone = customerForAppointment([alice], { ...legacy, customerPhone: '+41790000004' });
  assert.notEqual(differentPhone.customer.id, alice.id);
});

test('an explicit ID preserves the right customer when multiple people share their name', () => {
  const namesake = { ...alice, id: 'other-alice', phone: '+41790000003', bookingsCount: 7 };
  const result = customerForAppointment([namesake, alice], appointment, appointment);
  assert.equal(result.customer.id, alice.id);
  assert.equal(result.customer.bookingsCount, 3);
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
  assert.equal(reassigned.customer.bookingsCount, 1);
  assert.deepEqual(upsertCustomer([created.customer], reassigned.customer).find(customer => customer.id === created.customer.id), created.customer);
});

test('reassigning to a unique existing customer preserves their contact and returns the previous customer for decrement', () => {
  const reassigned = customerForAppointment([alice, bob], { ...appointment, customerName: 'Bob' }, appointment);
  assert.equal(reassigned.customer.id, bob.id);
  assert.equal(reassigned.previousCustomerId, alice.id);
  assert.equal(reassigned.customer.phone, bob.phone);
  assert.equal(reassigned.customer.email, bob.email);
  assert.equal(reassigned.customer.bookingsCount, 3);
  assert.equal(alice.bookingsCount, 3);
});
