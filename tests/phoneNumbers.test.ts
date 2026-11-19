import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { appointmentFromRequest } from '../src/appointmentActions';
import { answer } from '../src/assistant/execute';
import {
  MAX_NAME_LENGTH, customerForAppointment, customerForRequest, customerMatches, nameProblem, phoneAdvice, upsertCustomer, validateContact,
} from '../src/bookingData';
import { initialAiSettings } from '../src/conversationData';
import { demoPeople } from '../src/demoSeed';
import { formatPhone, normalizePhone } from '../src/format';
import { getHeaderSearchResults, headerSearchDetail } from '../src/headerModels';
import { validateOptionalContact, validatePersonName } from '../src/managementValidation';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData';
import type { AppointmentRequest, Customer } from '../src/types';
import { BookingPageView, createBookingDraft } from '../src/views/BookingPageView';
import { CalendarView } from '../src/views/CalendarView';
import { ConversationsView } from '../src/views/ConversationsView';
import { EmployeesView } from '../src/views/EmployeesView';
import { HomeView } from '../src/views/HomeView';
import { demoConversations, demoCustomers, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { readableText, render } from './renderHelpers';

// A phone number is stored once (+41791234567), shown one way (+41 79 123 45 67) and compared on
// its digits. These tests follow a number through the booking form, the customer records, the
// search and the screens. The format itself is pinned in tests/format.test.ts.

const nothing = () => {};
/** What a person reads on a rendered screen, with every run of spaces as one. */
const shown = (html: string) => readableText(html).replace(/\s+/g, ' ');

/** A request as the public booking page sends it: the number already in its stored form. */
const requestFrom = (id: string, name: string, typedPhone: string): AppointmentRequest => ({
  ...demoRequests[0], id, customerId: undefined, customerName: name, customerPhone: normalizePhone(typedPhone), isAiBooked: false,
});

/** What the app does with a new request: find or create the customer, and keep one record per person. */
const book = (customers: Customer[], request: AppointmentRequest): Customer[] =>
  upsertCustomer(customers, customerForRequest(customers, request));

// ---------- one person, one customer ----------

test('the same person booking with "079 ..." and with "+41 79 ..." is one customer', () => {
  let customers: Customer[] = [];
  customers = book(customers, requestFrom('req-a', 'Sandra Keller', '079 123 45 67'));
  customers = book(customers, requestFrom('req-b', 'Sandra Keller', '+41 79 123 45 67'));
  assert.equal(customers.length, 1);
  assert.equal(customers[0].phone, '+41791234567');
  assert.equal(formatPhone(customers[0].phone), '+41 79 123 45 67');
  // Every way of writing the number leads to the same record, also with other spacing of the name.
  for (const typed of ['0791234567', '079/123 45 67', '0041 79 123 45 67', '+41 (0)79 123 45 67']) {
    customers = book(customers, requestFrom(`req-${typed}`, ' sandra KELLER ', typed));
    assert.equal(customers.length, 1, typed);
  }
  // Another person with the same number (a mother booking for herself and for her child) stays
  // another customer, and so does the same name with another number.
  customers = book(customers, requestFrom('req-c', 'Mia Keller', '079 123 45 67'));
  customers = book(customers, requestFrom('req-d', 'Sandra Keller', '079 123 45 68'));
  assert.equal(customers.length, 3);
});

test('a record saved in an older spelling is found by its digits and joined, not doubled', () => {
  // Three spellings the app has stored in the past: without a country code, with spaces, and
  // the wrong record of "+41 (0)79 ...".
  for (const stored of ['0794445566', '+41 79 444 55 66', '+410794445566']) {
    const earlier: Customer = { id: 'cust-earlier', name: 'Petra Huber', initials: 'PH', email: 'petra@example.com', phone: stored, language: 'DE' };
    const customers = book([earlier], requestFrom('req-new', 'Petra Huber', '+41 79 444 55 66'));
    assert.equal(customers.length, 1, stored);
    assert.equal(customers[0].id, 'cust-earlier', stored);
    assert.equal(customers[0].email, 'petra@example.com', stored);
    assert.equal(formatPhone(customers[0].phone), '+41 79 444 55 66', stored);
  }
});

test('accepting a request never rewrites the number a customer record holds', () => {
  // A regular whose record still has the spelling with spaces sends a request; the owner accepts it.
  const regular: Customer = { id: 'cust-regular', name: 'Livia Sutter', initials: 'LS', email: '', phone: '+41 78 555 00 19', language: 'DE' };
  const request = requestFrom('req-regular', 'Livia Sutter', '078 555 00 19');
  const withRequest = customerForRequest([regular], request);
  assert.equal(withRequest.id, regular.id);
  assert.equal(withRequest.phone, '+41 78 555 00 19');
  const appointment = appointmentFromRequest({ ...request, customerId: withRequest.id, customerPhone: withRequest.phone }, initialServices, initialEmployees);
  const accepted = customerForAppointment([withRequest], appointment);
  assert.deepEqual(accepted.customer, regular);
  // Moving the appointment later does not touch the record either.
  const moved = customerForAppointment([accepted.customer], { ...appointment, date: '2026-10-09' }, appointment);
  assert.deepEqual(moved.customer, regular);
  // On screen the old spelling and the stored form read the same.
  assert.equal(formatPhone(regular.phone), formatPhone('+41785550019'));
});

test('the invented people keep their invented numbers, stored and shown like every number', () => {
  const people = [...demoPeople(), ...initialEmployees];
  for (const person of people) {
    assert.equal(person.phone, normalizePhone(person.phone), person.name);
    assert.match(formatPhone(person.phone), /^\+41 7[6-9] 555 \d\d \d\d$/, person.name);
  }
  // The records built from them hold the same form: customers, requests, appointments and chats.
  for (const customer of demoCustomers) assert.match(customer.phone, /^\+417[6-9]555\d{4}$/, customer.name);
  for (const request of demoRequests) assert.match(request.customerPhone ?? '', /^\+417[6-9]555\d{4}$/, request.id);
  for (const event of demoEvents) assert.match(event.customerPhone ?? '', /^\+417[6-9]555\d{4}$/, event.id);
  for (const chat of demoConversations) assert.match(chat.phone, /^\+417[6-9]555\d{4}$/, chat.id);
});

// ---------- search ----------

test('the header search and the customer filter find a number in any spelling', () => {
  const sandra: Customer = { id: 'cust-sandra', name: 'Sandra Keller', initials: 'SK', email: 'sandra.keller@example.com', phone: '+41791234567', language: 'DE' };
  const livia: Customer = { id: 'cust-livia', name: 'Livia Sutter', initials: 'LS', email: '', phone: '+41 78 555 00 19', language: 'DE' };
  const chatOnly: Customer = { id: 'cust-chat', name: 'Tom', initials: 'T', email: '', phone: '', language: 'EN', channel: 'Website' };
  const customers = [sandra, livia, chatOnly];
  const found = (query: string) => ({
    header: getHeaderSearchResults(customers, [], [], query).map((result) => result.record.id),
    filter: customers.filter((customer) => customerMatches(customer, query)).map((customer) => customer.id),
  });
  for (const query of ['079 123', '+41 79 123', '+4179123', '0791234567', '+41 79 123 45 67', '0041 79 123', '079/123']) {
    assert.deepEqual(found(query), { header: ['cust-sandra'], filter: ['cust-sandra'] }, query);
  }
  for (const query of ['078 555 00 19', '+41 78 555 00 19', '+41785550019', '+41 78', '078']) {
    assert.deepEqual(found(query), { header: ['cust-livia'], filter: ['cust-livia'] }, query);
  }
  // Names and e-mail addresses are found as before, in any letter case.
  assert.deepEqual(found('  KELLER ').filter, ['cust-sandra']);
  assert.deepEqual(found('sandra.keller@').header, ['cust-sandra']);
  assert.deepEqual(found('tom').filter, ['cust-chat']);
  // A number nobody has, and a customer without a number, are not found by digits.
  assert.deepEqual(found('079 999'), { header: [], filter: [] });
  // The filter shows everybody while it is empty; the header shows nothing.
  assert.equal(customers.filter((customer) => customerMatches(customer, '  ')).length, 3);
  assert.deepEqual(getHeaderSearchResults(customers, [], [], '  '), []);
  // A result shows the number the way every screen does.
  assert.equal(headerSearchDetail({ kind: 'customer', record: sandra }), '+41 79 123 45 67 · sandra.keller@example.com');
  assert.equal(headerSearchDetail({ kind: 'customer', record: livia }), '+41 78 555 00 19');
});

test('searching the salon finds its people by the number on screen, typed the national way', () => {
  const marie = demoCustomers.find((customer) => customer.id === 'cust-marie')!; // shown as +41 79 555 61 12
  for (const query of ['079 555 61 12', '+41 79 555 61 12', '+41795556112', '0795556112']) {
    const results = getHeaderSearchResults(demoCustomers, demoRequests, demoEvents, query);
    assert.deepEqual(results.map((result) => `${result.kind}:${result.record.id}`), ['customer:cust-marie'], query);
  }
  assert.equal(marie.phone, '+41795556112');
});

// ---------- forms ----------

test('the booking form accepts Swiss writing habits and says what is wrong with a number', () => {
  for (const phone of ['079 123 45 67', '079/123 45 67', '+41/79/123 45 67', '+41 (0)79 123 45 67', '0041 79 123 45 67', '+49 151 23456789']) {
    assert.equal(validateContact('Sandra Keller', phone), null, phone);
  }
  // Too short or too long for a Swiss number: the message says which, and shows a right one.
  assert.match(validateContact('Sandra Keller', '+41 79 123 45')!, /valid phone number\. This Swiss number is too short: 9 digits follow the 0 or \+41, for example 079 123 45 67\./);
  assert.match(validateContact('Sandra Keller', '079 123 45 678')!, /This Swiss number is too long/);
  assert.match(validateContact('Sandra Keller', '+41 079 123 45 6')!, /After \+41 the number goes on without a 0/);
  // No leading 0 and no country code: nothing says which country the number is in.
  assert.match(validateContact('Sandra Keller', '1234567')!, /Start with 0 or with a country code, for example 079 123 45 67 or \+41 79 123 45 67\./);
  assert.match(validateContact('Sandra Keller', 'call me')!, /Use digits only/);
  assert.match(validateContact('Sandra Keller', '+49 1234')!, /7 to 15 digits/);
  assert.match(validateContact('Sandra Keller', '   ')!, /Please enter a phone number/);
});

test('a name needs two letters, and one that is too long is refused instead of cut', () => {
  for (const name of ['A', '12345', '!!!', '7 7', 'X.']) {
    assert.equal(nameProblem(name), 'letters', name);
    assert.match(validateContact(name, '079 123 45 67')!, /full name: a name has at least two letters/, name);
  }
  for (const name of ['Li', 'Zoë', 'Sandra Keller', 'Jean-Luc O’Neil', 'Ayşe Yılmaz', 'Ng 2']) assert.equal(validateContact(name, '079 123 45 67'), null, name);
  assert.match(validateContact('  ', '079 123 45 67')!, /Please enter your full name\./);
  // 200 characters: the form says so and names both lengths. Nothing is shortened behind the customer's back.
  const long = 'Maria '.repeat(34).trim().slice(0, 200);
  assert.equal(long.length, 200);
  assert.equal(validateContact(long, '079 123 45 67'), `This name is too long (200 characters). Please shorten it to ${MAX_NAME_LENGTH} characters or fewer.`);
  assert.equal(validateContact('M'.repeat(MAX_NAME_LENGTH), '079 123 45 67'), null);
  // The fields themselves no longer stop or cut what is typed or pasted.
  const draft = { ...createBookingDraft(initialServices, 'Europe/Zurich', FIXED_NOW), name: long, phone: '079 123 45 67' };
  const html = render(React.createElement(BookingPageView, {
    services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
    events: [], requests: [], timeZone: 'Europe/Zurich', now: FIXED_NOW, companySettings: initialCompanySettings,
    draft, setDraft: nothing, submittedRequest: null, setSubmittedRequest: nothing,
    onNewBookingRequest: () => null, onUpdateBookingRequest: () => null, onCancelBookingRequest: () => null, onViewRequest: nothing, publicMode: true,
  }));
  assert.doesNotMatch(html, /maxLength|maxlength/);
  assert.ok(html.includes(`value="${long}"`));
  // The review shows the number as it will be stored and shown, while the field keeps what was typed.
  assert.match(html, /id="booking-phone"[^>]*value="079 123 45 67"/);
  assert.match(shown(html), /Contact Maria [^+]*\+41 79 123 45 67/);
});

test('the owner\'s forms use the same checks, and a number may stay empty there', () => {
  assert.equal(validateOptionalContact('', ''), null);
  assert.equal(validateOptionalContact('', '079/123 45 67'), null);
  assert.equal(validateOptionalContact('', '+41 (0)79 123 45 67'), null);
  assert.match(validateOptionalContact('', '079 123 45')!, /^Enter a valid phone number or leave it blank\. This Swiss number is too short/);
  assert.match(validateOptionalContact('', '1234567')!, /Start with 0 or with a country code/);
  assert.equal(phoneAdvice('079 123 45 67'), null);
  assert.equal(validatePersonName('Sandra Keller', 'the customer’s'), null);
  assert.equal(validatePersonName('', 'the customer’s'), 'Enter the customer’s name.');
  assert.equal(validatePersonName('7', 'the employee’s'), 'Enter the employee’s name: it needs at least two letters.');
  assert.match(validatePersonName('M'.repeat(121), 'the customer’s')!, /too long \(121 characters\)\. Use 120 characters or fewer\./);
});

// ---------- screens ----------

test('every screen writes a number the same way, whatever spelling the record holds', () => {
  const GROUPED = '+41 79 123 45 67';
  const spellings = ['+41791234567', '0791234567', '+41 79 123 45 67', '079 123 45 67'];
  for (const stored of spellings) {
    // Home: the request card.
    const request = { ...demoRequests[0], customerPhone: stored };
    const home = render(React.createElement(HomeView, {
      requests: [request], selectedRequestId: null, onSelectRequest: nothing, now: FIXED_NOW,
      availabilityContext: { requests: [request], events: demoEvents, services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts, now: FIXED_NOW, timeZone: 'Europe/Zurich' },
      onAcceptRequest: nothing, onRejectRequest: nothing, onMoveRequest: () => null, onSimulateNewRequest: nothing,
      nextAppointment: null, onOpenAppointment: nothing, onExportReport: nothing, conversations: [], onOpenConversations: nothing,
    }));
    assert.match(shown(home), new RegExp(`Phone: ${GROUPED.replace('+', '\\+')}`), stored);

    // Calendar: the appointment's details.
    const appointment = { ...demoEvents[0], id: 'cal-phone', customerPhone: stored };
    const calendar = render(React.createElement(CalendarView, {
      events: [appointment], services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
      requests: [], date: appointment.date, selectedEventId: appointment.id, timeZone: 'Europe/Zurich',
      onSelectEvent: nothing, onDateChange: nothing, onAddEvent: () => null, onUpdateEvent: () => null, onDeleteEvent: nothing,
    }));
    assert.match(shown(calendar), new RegExp(`Phone: ${GROUPED.replace('+', '\\+')}`), stored);

    // Employees: the list, in the page's own font.
    const employees = render(React.createElement(EmployeesView, {
      employees: [{ ...initialEmployees[0], phone: stored }], onAddEmployee: nothing, onUpdateEmployee: nothing, onDeleteEmployee: nothing,
    }));
    assert.equal(employees.split(`>${GROUPED}<`).length - 1, 2, stored); // the phone card and the table
    assert.doesNotMatch(employees, /font-mono/);

    // Conversations: under the customer's name.
    const chat = { ...demoConversations[0], phone: stored };
    const inbox = render(React.createElement(ConversationsView, {
      conversations: [chat], selectedId: chat.id, mobileDetailOpen: false, onBackToList: nothing, onSelect: nothing,
      onTakeOver: nothing, onLetAiContinue: () => null, onOwnerReply: () => true, aiSettings: initialAiSettings, onOpenAiSettings: nothing,
    }));
    assert.match(shown(inbox), new RegExp(`${GROUPED.replace('+', '\\+')} · Website chat`), stored);
  }
  // A masked WhatsApp number and a handle are shown as they came.
  const masked = render(React.createElement(ConversationsView, {
    conversations: [{ ...demoConversations[0], phone: '+41 ••• ••• 67', channel: 'WhatsApp' as const }], selectedId: demoConversations[0].id,
    mobileDetailOpen: false, onBackToList: nothing, onSelect: nothing, onTakeOver: nothing, onLetAiContinue: () => null,
    onOwnerReply: () => true, aiSettings: initialAiSettings, onOpenAiSettings: nothing,
  }));
  assert.match(shown(masked), /\+41 ••• ••• 67 · WhatsApp/);
});

test('the assistant tells two customers of the same name apart by their number, written the same way', () => {
  const twins: Customer[] = [
    { id: 'cust-one', name: 'Lea Brunner', initials: 'LB', email: '', phone: '+41791234567', language: 'DE' },
    { id: 'cust-two', name: 'Lea Brunner', initials: 'LB', email: '', phone: '079 765 43 21', language: 'DE' },
  ];
  // A day and time that are free in the salon as it is at the fixed moment: asked from the rules, not assumed.
  const free = answer({ intent: 'availability', language: 'en', serviceId: 'srv-2' }, {
    services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
    events: demoEvents, requests: demoRequests, timeZone: 'Europe/Zurich', now: FIXED_NOW, customers: twins,
  });
  const slot = free.choices![0].task;
  const reply = answer({ ...slot, intent: 'book', customerName: 'Lea Brunner' }, {
    services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
    events: demoEvents, requests: demoRequests, timeZone: 'Europe/Zurich', now: FIXED_NOW, customers: twins,
  });
  assert.deepEqual(reply.choices!.map((choice) => choice.label), ['Lea Brunner · +41 79 123 45 67', 'Lea Brunner · +41 79 765 43 21']);
});
