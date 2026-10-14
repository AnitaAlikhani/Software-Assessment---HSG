import test from 'node:test';
import assert from 'node:assert/strict';
import { customerForRequest, normalizePhone, upsertCustomer, validateContact } from '../src/bookingData';
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
