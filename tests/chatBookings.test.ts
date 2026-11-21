import assert from 'node:assert/strict';
import test from 'node:test';
import { appointmentForConversation, appointmentFromConversationAction, appointmentFromRequest, upsertAppointment } from '../src/appointmentActions';
import { firstFreeEmployee, isOutsideOpeningHours, validateCalendarEvent, type AvailabilityContext } from '../src/availability';
import { chatBookingName, customerForAppointment, isPhoneNumber, upsertCustomer } from '../src/bookingData';
import { initialAiSettings, scriptedGerman } from '../src/conversationData';
import { messageForOwner } from '../src/conversationPresentation';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import type { AppointmentAction, CalendarEvent, Conversation } from '../src/types';
import { addCustomerMessage, emptyState, publicConversations, webChatId } from '../server/whatsappCore';
import { demoConversations, demoCustomers, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';

const context = (partial: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
  events: demoEvents, requests: demoRequests, timeZone: 'Europe/Zurich', now: FIXED_NOW, ...partial,
});
const actionsOf = (conversation: Conversation): { action: AppointmentAction; fromAi: boolean }[] => [
  ...(conversation.aiFollowUp?.appointmentAction ? [{ action: conversation.aiFollowUp.appointmentAction, fromAi: true }] : []),
  ...(conversation.quickReplies ?? []).flatMap((reply) => reply.appointmentAction ? [{ action: reply.appointmentAction, fromAi: false }] : []),
];

test('chat actions name services and stylists by id only', () => {
  const actions = demoConversations.flatMap(actionsOf).map(({ action }) => action);
  assert.equal(actions.length, 3); // Camille: the AI's follow-up and the owner's reply; Giulia: the owner's reply
  for (const action of actions) {
    assert.ok(!('serviceName' in action) && !('staffName' in action));
    if (action.type === 'book') {
      assert.ok(initialServices.some((service) => service.id === action.serviceId));
      assert.ok(initialEmployees.some((employee) => employee.id === action.employeeId));
    }
  }
});

test('renaming every service, stylist and customer leaves the chat bookings and requests working', () => {
  // What the app does on a rename: the record gets its new name, and so do the appointments and chats that show it.
  const services = initialServices.map((service) => ({ ...service, name: `${service.name} (neu)` }));
  const employees = initialEmployees.map((employee) => ({ ...employee, firstName: 'Neu', lastName: employee.lastName, name: `Neu ${employee.lastName}` }));
  const events = demoEvents.map((event) => ({
    ...event,
    serviceName: services.find((service) => service.id === event.serviceId)!.name,
    staffName: employees.find((employee) => employee.id === event.employeeId)!.name,
    customerName: `${event.customerName} Neu`,
  }));
  const renamed = context({ services, employees, events });
  for (const conversation of demoConversations.map((item) => ({ ...item, customerName: `${item.customerName} Neu` }))) {
    for (const { action, fromAi } of actionsOf(conversation)) {
      const appointment = appointmentFromConversationAction(action, conversation, events, services, employees, fromAi);
      assert.ok(appointment, `${conversation.id}: no appointment after the renames`);
      assert.match(appointment.serviceName, /\(neu\)$/);
      assert.match(appointment.staffName, /^Neu /);
      assert.match(appointment.customerName, / Neu$/);
      assert.equal(validateCalendarEvent(renamed, appointment, appointment.id), null, conversation.id);
    }
  }
  // An accepted request shows the current names as well, not the ones it was sent with.
  for (const request of demoRequests) {
    const appointment = appointmentFromRequest(request, services, employees);
    assert.match(appointment.serviceName, /\(neu\)$/);
    assert.match(appointment.staffName, /^Neu /);
    assert.equal(validateCalendarEvent(context({ services, employees, events, requests: [] }), appointment), null, request.id);
  }
});

test('a booking whose service, stylist or appointment is gone is refused instead of guessed', () => {
  const camille = demoConversations.find((item) => item.id === 'conv-camille')!;
  const giulia = demoConversations.find((item) => item.id === 'conv-giulia')!;
  const book = camille.aiFollowUp!.appointmentAction!;
  const move = giulia.quickReplies![0].appointmentAction!;
  const build = (action: AppointmentAction, conversation: Conversation, partial: { events?: CalendarEvent[]; services?: typeof initialServices; employees?: typeof initialEmployees } = {}) =>
    appointmentFromConversationAction(action, conversation, partial.events ?? demoEvents, partial.services ?? initialServices, partial.employees ?? initialEmployees, true);
  assert.ok(build(book, camille));
  assert.equal(build(book, camille, { services: initialServices.filter((service) => service.id !== 'srv-3') }), null);
  assert.equal(build(book, camille, { employees: initialEmployees.filter((employee) => employee.id !== 'emp-1') }), null);
  // No other service or stylist with the old name is taken in its place.
  assert.equal(build(book, camille, { services: initialServices.map((service) => service.id === 'srv-3' ? { ...service, id: 'srv-other' } : service) }), null);
  assert.equal(build(move, giulia, { events: demoEvents.filter((event) => event.id !== 'cal-giulia') }), null);
  // A request without a known stylist is shown as unassigned, never under somebody's name.
  const unassigned = appointmentFromRequest({ ...demoRequests[0], employeeId: undefined, staffName: undefined }, initialServices, initialEmployees);
  assert.equal(unassigned.staffName, 'Unassigned');
});

test('a chat booking without a named stylist takes the first one who offers the service and is free', () => {
  // Thursday 8 October, 13:30: the owner has Marie's haircut (cal-2), so the next stylist on duty takes it.
  assert.equal(firstFreeEmployee(context(), 'srv-2', '2026-10-08', '13:30')?.id, 'emp-2');
  // Confirming the same booking again finds the same stylist.
  assert.equal(firstFreeEmployee(context(), 'srv-2', '2026-10-08', '13:30', 'cal-2')?.id, 'emp-1');
  // The owner comes first whenever she is free.
  const free = context({ events: [], requests: [] });
  assert.equal(firstFreeEmployee(free, 'srv-2', '2026-10-08', '13:30')?.id, 'emp-1');
  // Services that are not offered online can be confirmed by the owner all the same.
  assert.equal(firstFreeEmployee(free, 'srv-3', '2026-10-08', '13:30')?.id, 'emp-1');
  // Nobody is taken who does not offer the service, works that day or is active.
  assert.equal(firstFreeEmployee(free, 'srv-9', '2026-10-06', '17:30'), null); // balayage: only the owner, whose Tuesday ends at 17:00
  assert.equal(firstFreeEmployee(free, 'srv-2', '2026-10-06', '17:30')?.id, 'emp-3');
  assert.equal(firstFreeEmployee(free, 'srv-2', '2026-10-05', '10:00'), null); // closed on Mondays
  assert.equal(firstFreeEmployee(free, 'srv-2', '2026-10-08', '13:15'), null); // not on the half hour
  assert.equal(firstFreeEmployee(free, 'srv-unknown', '2026-10-08', '13:30'), null);
  const ownerAway = context({ events: [], requests: [], employees: initialEmployees.map((employee) => employee.id === 'emp-1' ? { ...employee, status: 'Inactive' as const } : employee) });
  assert.equal(firstFreeEmployee(ownerAway, 'srv-2', '2026-10-08', '13:30')?.id, 'emp-2');
});

test('whether a time is outside opening hours is read from the hours of that day', () => {
  assert.equal(isOutsideOpeningHours(initialBookingHours, '2026-10-10', '10:00', '10:30'), false); // Saturday morning
  assert.equal(isOutsideOpeningHours(initialBookingHours, '2026-10-10', '15:30', '16:00'), false);
  assert.equal(isOutsideOpeningHours(initialBookingHours, '2026-10-10', '15:30', '16:30'), true);  // Saturday closes at 16:00
  assert.equal(isOutsideOpeningHours(initialBookingHours, '2026-10-09', '18:00', '18:30'), false);
  assert.equal(isOutsideOpeningHours(initialBookingHours, '2026-10-09', '18:30', '19:00'), true);
  assert.equal(isOutsideOpeningHours(initialBookingHours, '2026-10-09', '08:00', '08:30'), true);
  assert.equal(isOutsideOpeningHours(initialBookingHours, '2026-10-05', '10:00', '10:30'), true);  // Monday: closed
  assert.equal(isOutsideOpeningHours(initialBookingHours, 'not-a-date', '10:00', '10:30'), false);
  // An appointment after closing time needs the owner's approval; with it, the stylist's working hours do not limit it either.
  const friday = (partial: Partial<CalendarEvent>): CalendarEvent => ({ ...demoEvents[0], id: 'late', employeeId: 'emp-1', staffName: 'Anna Weber', serviceId: 'srv-2', serviceName: 'Haircut', date: '2026-10-09', startTime: '18:30', endTime: '19:00', ...partial });
  const longShift = context({ shiftOverview: demoShifts.map((entry) => entry.employeeId === 'emp-1' ? { ...entry, shifts: { ...entry.shifts, '2026-10-09': { start: '10:00', end: '19:30' } } } : entry) });
  assert.match(validateCalendarEvent(longShift, friday({}))!, /not available/);
  assert.equal(validateCalendarEvent(longShift, friday({ outsideHoursApproved: true })), null);
  assert.equal(validateCalendarEvent(context(), friday({ outsideHoursApproved: true })), null);
  assert.match(validateCalendarEvent(context(), friday({ startTime: '23:00', endTime: '23:30', outsideHoursApproved: true }))!, /not available/);
});

test('a customer created from a live chat is clean: the chat\'s language, a real phone or none, never a label', () => {
  const state = emptyState();
  addCustomerMessage(state, { id: 'web-1', waId: webChatId('abc123def456ghi7'), name: 'Website visitor', text: 'Hallo, ich bin Tom.', timestamp: 1, channel: 'Website' },
    { original: 'Hallo, ich bin Tom.', translation: 'Hello, I am Tom.' }, 'DE', 'German');
  addCustomerMessage(state, { id: 'wa-1', waId: '41791234567', name: 'Ana Silva', text: 'Olá', timestamp: 2 }, { original: 'Olá', translation: 'Hello' }, 'EN', 'Portuguese');
  const [whatsapp, website] = publicConversations(state);
  // What a chat shows in place of a number is never taken for one.
  assert.equal(website.phone, '');
  assert.equal(isPhoneNumber(website.phone), false);
  assert.match(whatsapp.phone, /^\+41 ••• ••• 67$/);
  assert.equal(isPhoneNumber(whatsapp.phone), false);

  const booking = (conversation: Conversation, name: string, id: string): CalendarEvent => ({
    ...demoEvents[0], id, customerId: undefined, customerPhone: isPhoneNumber(conversation.phone) ? conversation.phone : undefined,
    customerName: chatBookingName(conversation.customerName, name), conversationId: conversation.id,
  });
  const chat = (conversation: Conversation) => ({ language: conversation.language, channel: conversation.channel, conversationId: conversation.id });

  const first = customerForAppointment(demoCustomers, booking(website, 'Tom', 'live-1'), undefined, chat(website)).customer;
  assert.deepEqual({ ...first, id: '' }, { id: '', name: 'Tom', initials: 'T', email: '', phone: '', language: 'DE', channel: 'Website', conversationId: website.id });
  const customers = upsertCustomer(demoCustomers, first);
  // A second booking in the same chat belongs to the same customer.
  assert.equal(customerForAppointment(customers, booking(website, 'Tom', 'live-2'), undefined, chat(website)).customer.id, first.id);
  // Another chat with a Tom is another person: a first name alone joins nobody.
  const otherChat = { ...website, id: 'live-web-other' };
  const second = customerForAppointment(customers, booking(otherChat, 'Tom', 'live-3'), undefined, chat(otherChat)).customer;
  assert.notEqual(second.id, first.id);
  assert.equal(second.conversationId, 'live-web-other');
  // The WhatsApp profile gives the full name; the masked number is not stored.
  const ana = customerForAppointment(customers, booking(whatsapp, 'Ana', 'live-4'), undefined, chat(whatsapp)).customer;
  assert.equal(ana.name, 'Ana Silva');
  assert.equal(ana.phone, '');
  assert.equal(ana.channel, 'WhatsApp');
  assert.equal(ana.language, 'EN');
  // Somebody who gives the full name of an existing customer is that customer, with the record's own details.
  const known = demoCustomers.find((customer) => customer.id === demoRequests[0].customerId)!;
  const again = customerForAppointment(customers, booking(website, known.name, 'live-5'), undefined, chat(website)).customer;
  assert.equal(again.id, known.id);
  assert.equal(again.phone, known.phone);
  assert.equal(again.language, known.language);
});

test('a sample chat books for its own customer record and never changes that record\'s details', () => {
  for (const conversation of demoConversations) {
    const customer = demoCustomers.find((item) => item.id === conversation.customerId)!;
    for (const { action, fromAi } of actionsOf(conversation)) {
      const appointment = appointmentFromConversationAction(action, conversation, demoEvents, initialServices, initialEmployees, fromAi)!;
      const event = { ...appointment, customerId: appointment.customerId ?? conversation.customerId, customerPhone: conversation.phone, conversationId: conversation.id };
      const previous = demoEvents.find((item) => item.id === appointment.id);
      const result = customerForAppointment(demoCustomers, event, previous, { language: conversation.language, channel: conversation.channel, conversationId: conversation.id });
      assert.deepEqual(result.customer, customer, conversation.id);
    }
  }
  // Camille writes French: her record says so, with her number stored like every other.
  const camille = demoCustomers.find((item) => item.id === 'cust-camille')!;
  assert.equal(camille.language, 'FR');
  assert.match(camille.phone, /^\+417\d555\d{4}$/);
});

test('a chat leads to its appointment: the one it names, else the newest one booked in it', () => {
  const chat = (id: string) => demoConversations.find((item) => item.id === id)!;
  for (const [id, appointmentId] of [['conv-marie', 'cal-2'], ['conv-lea', 'cal-3'], ['conv-john', 'cal-john'], ['conv-giulia', 'cal-giulia']]) {
    const appointment = appointmentForConversation(chat(id), demoEvents);
    assert.equal(appointment?.id, appointmentId, id);
    // The way back exists as well: the appointment names the chat it was booked in.
    assert.equal(appointment?.conversationId, id);
    assert.equal(appointment?.customerId, chat(id).customerId);
  }
  // Camille's colouring is still to be booked and Chloé only asked for a time: nothing to open.
  assert.equal(appointmentForConversation(chat('conv-camille'), demoEvents), null);
  assert.equal(appointmentForConversation(chat('conv-chloe'), demoEvents), null);
  // Once the booking is made in Camille's chat, the chat leads to it.
  const camille = chat('conv-camille');
  const action = camille.aiFollowUp!.appointmentAction!;
  const booked = { ...appointmentFromConversationAction(action, camille, demoEvents, initialServices, initialEmployees, true)!, conversationId: camille.id };
  const calendar = upsertAppointment(demoEvents, booked);
  assert.equal(appointmentForConversation({ ...camille, appointmentId: action.appointmentId }, calendar)?.id, 'cal-camille');
  assert.equal(appointmentForConversation(camille, calendar)?.id, 'cal-camille');
  // A cancelled appointment has left the calendar: the chat does not lead to another customer's booking.
  assert.equal(appointmentForConversation(chat('conv-marie'), demoEvents.filter((event) => event.id !== 'cal-2')), null);
  // A live chat names no appointment. A booking confirmed in it carries the chat's id; the newest one counts.
  const live = { id: 'live-web-abc123def456', appointmentId: undefined };
  const first = { ...demoEvents[0], id: 'live-appt-1', conversationId: live.id };
  const second = { ...demoEvents[0], id: 'live-appt-2', conversationId: live.id };
  assert.equal(appointmentForConversation(live, demoEvents), null);
  assert.equal(appointmentForConversation(live, upsertAppointment(demoEvents, first))?.id, 'live-appt-1');
  assert.equal(appointmentForConversation(live, upsertAppointment(upsertAppointment(demoEvents, first), second))?.id, 'live-appt-2');
});

test('the name for a chat booking is the fuller chat name only when it starts with the name given', () => {
  assert.equal(chatBookingName('Ana Silva', 'Ana'), 'Ana Silva');
  assert.equal(chatBookingName('  ana   silva ', 'Ana'), 'ana silva');
  assert.equal(chatBookingName('Website visitor', 'Tom'), 'Tom');
  assert.equal(chatBookingName('Anabel Cruz', 'Ana'), 'Ana');
  assert.equal(chatBookingName('Ana', 'Ana'), 'Ana');
  assert.equal(chatBookingName('Maria Silva', 'Lea'), 'Lea'); // booked for somebody else
});

test('every sample text carries its German version, so renames cannot leave a message untranslated', () => {
  const german = { ...initialAiSettings, ownerLanguage: 'German', translateChats: true };
  for (const conversation of demoConversations) {
    const writtenInGerman = conversation.language === 'DE';
    for (const message of conversation.messages) {
      assert.equal(message.translationDe !== undefined, !writtenInGerman, `${conversation.id} ${message.id}`);
      // The German text is found without the English one: change that, and it is still shown.
      const shown = messageForOwner({ ...message, translation: 'changed' }, conversation.language, german);
      assert.equal(shown.text, writtenInGerman ? message.original : message.translationDe);
    }
    if (conversation.aiFollowUp) assert.equal(conversation.aiFollowUp.translationDe !== undefined, !writtenInGerman, conversation.id);
    for (const reply of conversation.quickReplies ?? []) {
      assert.equal(reply.de !== undefined, !writtenInGerman, `${conversation.id}: ${reply.en}`);
      // A suggested reply is shown before it is a message: its German is found by its English text.
      assert.equal(scriptedGerman(reply.en), reply.de);
    }
  }
  assert.equal(scriptedGerman('A sentence nobody wrote.'), undefined);
});

test('the Friday chat about a late appointment follows the opening hours', () => {
  const chloe = demoConversations.find((item) => item.id === 'conv-chloe')!;
  const friday = initialBookingHours.find((day) => day.day === 'Friday')!;
  assert.equal(friday.to, '18:30');
  assert.equal(chloe.attentionReason, 'The request is outside opening hours (we close at 18:30 on Fridays).');
  assert.match(chloe.messages[0].original, /nach 18:30 Uhr/);
  assert.match(chloe.aiFollowUp!.translation, /last appointment on Friday is at 18:00/);
  assert.match(chloe.quickReplies![0].en, /stay open until 19:30 on Friday\. Shall I book you for 19:00\?/);
  // The salon is open on Saturdays, so the AI may offer Giulia a Saturday time.
  assert.ok(initialBookingHours.find((day) => day.day === 'Saturday')!.isOpen);
});
