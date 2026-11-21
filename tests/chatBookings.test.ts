import assert from 'node:assert/strict';
import test from 'node:test';
import { appointmentForConversation, appointmentFromConversationAction, appointmentFromRequest, upsertAppointment } from '../src/appointmentActions';
import { firstFreeEmployee, isOutsideOpeningHours, validateCalendarEvent, type AvailabilityContext } from '../src/availability';
import { chatBookingName, customerForAppointment, isPhoneNumber, upsertCustomer } from '../src/bookingData';
import { initialAiSettings, scriptedGerman } from '../src/conversationData';
import { messageForOwner } from '../src/conversationPresentation';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import type { AppointmentAction, CalendarEvent, Conversation } from '../src/types';
import { chatBookingMessage } from '../src/chatTemplates';
import { salonInstant } from '../src/demoSeed';
import { createDemoWorkspace } from '../src/demoWorkspace';
import { chatAppointmentId, planChatBooking } from '../src/requestAnswers';
import { getSalonNow } from '../src/scheduling';
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
  assert.equal(actions.length, 2); // Sabrina: the owner's two answers to her discount question
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
  const sabrina = demoConversations.find((item) => item.id === 'conv-sabrina')!;
  const giulia = demoConversations.find((item) => item.id === 'conv-giulia')!;
  const book = sabrina.quickReplies![0].appointmentAction!;
  const move = { type: 'reschedule' as const, appointmentId: 'cal-giulia', date: giulia.bookingRequest!.date, startTime: giulia.bookingRequest!.time };
  const build = (action: AppointmentAction, conversation: Conversation, partial: { events?: CalendarEvent[]; services?: typeof initialServices; employees?: typeof initialEmployees } = {}) =>
    appointmentFromConversationAction(action, conversation, partial.events ?? demoEvents, partial.services ?? initialServices, partial.employees ?? initialEmployees, true);
  assert.ok(build(book, sabrina));
  assert.equal(build(book, sabrina, { services: initialServices.filter((service) => service.id !== 'srv-3') }), null);
  assert.equal(build(book, sabrina, { employees: initialEmployees.filter((employee) => employee.id !== 'emp-1') }), null);
  // No other service or stylist with the old name is taken in its place.
  assert.equal(build(book, sabrina, { services: initialServices.map((service) => service.id === 'srv-3' ? { ...service, id: 'srv-other' } : service) }), null);
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
  // Marie writes French: her record says so, with her number stored like every other.
  const marie = demoCustomers.find((item) => item.id === 'cust-marie')!;
  assert.equal(marie.language, 'FR');
  assert.match(marie.phone, /^\+417\d555\d{4}$/);
});

test('a chat leads to its appointment: the one it names, else the newest one booked in it', () => {
  const chat = (id: string) => demoConversations.find((item) => item.id === id)!;
  for (const [id, appointmentId] of [['conv-marie', 'cal-2'], ['conv-lara', 'cal-3'], ['conv-john', 'cal-john'], ['conv-giulia', 'cal-giulia']]) {
    const appointment = appointmentForConversation(chat(id), demoEvents);
    assert.equal(appointment?.id, appointmentId, id);
    // The way back exists as well: the appointment names the chat it was booked in.
    assert.equal(appointment?.conversationId, id);
    assert.equal(appointment?.customerId, chat(id).customerId);
  }
  // Sabrina's colouring and Reto's men's cut still wait for the owner, Chloé only asked: nothing to open.
  for (const id of ['conv-sabrina', 'conv-reto', 'conv-chloe']) assert.equal(appointmentForConversation(chat(id), demoEvents), null, id);
  // Once the booking is made in Sabrina's chat, the chat leads to it.
  const sabrina = chat('conv-sabrina');
  const action = sabrina.quickReplies![0].appointmentAction!;
  const booked = { ...appointmentFromConversationAction(action, sabrina, demoEvents, initialServices, initialEmployees, false)!, conversationId: sabrina.id };
  const calendar = upsertAppointment(demoEvents, booked);
  assert.equal(appointmentForConversation({ ...sabrina, appointmentId: action.appointmentId }, calendar)?.id, action.appointmentId);
  assert.equal(appointmentForConversation(sabrina, calendar)?.id, action.appointmentId);
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
  assert.equal(chloe.attentionReason, 'The customer asked for Friday at 19:00, after closing time (18:30). Offer another time.');
  assert.match(chloe.messages[0].original, /am Freitag um 19:00 Uhr/);
  // The AI says why that time is not possible and hands over; it neither books nor promises a time.
  assert.match(chloe.messages[1].translation, /open until 18:30, so unfortunately an appointment at 19:00 isn't possible/);
  assert.equal(chloe.bookingRequest, undefined);
  assert.match(chloe.aiFollowUp!.translation, /last appointment on Friday starts at 18:00/);
  assert.deepEqual(chloe.quickReplies!.map((reply) => reply.en), [
    'We can offer you an appointment on Friday at 18:00. Does that suit you?',
    'On Saturday we would have an appointment free at 11:30. Does that suit you?',
  ]);
  // The salon is open on Saturdays, so the owner may offer one; Giulia's move goes to a Saturday too.
  assert.ok(initialBookingHours.find((day) => day.day === 'Saturday')!.isOpen);
});

// ---------- the salon's own chats as data ----------

const EVERY_TEXT = (conversation: Conversation) => [
  ...conversation.messages, ...(conversation.aiFollowUp ? [conversation.aiFollowUp] : []),
  ...(conversation.quickReplies ?? []).map((reply) => ({ sender: 'owner' as const, original: reply.local, translation: reply.en, translationDe: reply.de })),
];

test('the salon\'s chats lead with booking: four in German (one in Swiss German), one each in French, Italian and English', () => {
  const languages = demoConversations.map((conversation) => conversation.language);
  assert.deepEqual(['DE', 'FR', 'IT', 'EN'].map((language) => languages.filter((item) => item === language).length), [4, 1, 1, 1]);
  assert.ok(languages.filter((language) => language === 'DE').length / languages.length > 0.5);
  // Every chat is about an appointment: it holds a request, a booking, or a time the customer asks for.
  for (const conversation of demoConversations) {
    assert.ok(conversation.bookingRequest || /Termin|rendez-vous|appuntamento|appointment|haircut|coupe|taglio|Coloration|Herreschnitt/i.test(conversation.messages[0].original + conversation.messages[0].translation), conversation.id);
  }
  // Reto writes as many people here do, in Swiss German; the AI answers in standard German.
  const reto = demoConversations.find((item) => item.id === 'conv-reto')!;
  assert.match(reto.messages[0].original, /Samschtig/);
  assert.equal(reto.language, 'DE');
  // Swiss spelling throughout: no ß in any German text, wherever it stands.
  const german = demoConversations.flatMap((conversation) => EVERY_TEXT(conversation).map((text) => conversation.language === 'DE' ? text.original : text.translationDe ?? ''));
  assert.deepEqual(german.filter((text) => text.includes('ß')), []);
});

test('the names, services, prices, stylists and hours in the chats are the salon\'s own', () => {
  const services = new Map(initialServices.map((service) => [service.id, service]));
  for (const conversation of demoConversations) {
    const request = conversation.bookingRequest;
    if (request) {
      // The request names a service and a stylist of the salon, by id and by their current names.
      assert.equal(request.service, services.get(request.serviceId!)!.name, conversation.id);
      if (request.employeeId) assert.equal(request.staffName, initialEmployees.find((employee) => employee.id === request.employeeId)!.name, conversation.id);
      assert.equal(request.customerName, conversation.customerName, conversation.id);
      // The customer gave their name in the chat before the AI passed the request on.
      assert.ok(conversation.messages.some((message) => message.sender === 'customer' && message.original.includes(conversation.customerName)), conversation.id);
    }
    for (const text of EVERY_TEXT(conversation)) {
      // A price is one of the menu's, and the colouring's length the menu's.
      for (const price of text.translation.matchAll(/CHF (\d+)/g)) assert.ok(initialServices.some((service) => service.priceCHF === Number(price[1])), `${conversation.id}: CHF ${price[1]}`);
      if (/colouring takes (\d+) minutes/.test(text.translation)) assert.match(text.translation, new RegExp(`takes ${services.get('srv-3')!.durationMinutes} minutes`));
      // Stylists are named by their first names, as the salon's team has them.
      for (const name of text.translation.matchAll(/\bwith ([A-Z][a-z]+)\b/g)) assert.ok(initialEmployees.some((employee) => employee.firstName === name[1]), `${conversation.id}: ${name[1]}`);
    }
  }
  // Chloé is told the real closing time on Friday.
  const friday = initialBookingHours.find((day) => day.day === 'Friday')!;
  assert.match(demoConversations.find((item) => item.id === 'conv-chloe')!.messages[1].original, new RegExp(`bis ${friday.to} Uhr geöffnet`));
});

/** Words with which the AI would claim a booking or a free time it cannot know: the calendar is the owner's. */
const AI_PROMISES = /\b(booked|is confirmed|confirmed:|is free|is available|gebucht|ist bestätigt|frei ist|ist frei|réservé|confirmé|disponible|prenotato|confermato|disponibile|libero)\b/i;

test('no chat shows the AI booking, promising a free time or calling something booked that is not in the calendar', () => {
  for (const conversation of demoConversations) {
    for (const message of [...conversation.messages, ...(conversation.aiFollowUp ? [{ ...conversation.aiFollowUp, sender: 'ai' as const }] : [])]) {
      if (message.sender !== 'ai') continue;
      for (const text of [message.original, message.translation, message.translationDe ?? '']) {
        assert.doesNotMatch(text, AI_PROMISES, `${conversation.id}: ${text}`);
      }
    }
    // A confirmation is the salon's message, and only in a chat whose appointment is in the calendar.
    const confirmations = conversation.messages.filter((message) => message.sender === 'owner');
    assert.equal(confirmations.length, conversation.appointmentId ? 1 : 0, conversation.id);
    if (conversation.appointmentId) assert.ok(demoEvents.some((event) => event.id === conversation.appointmentId), conversation.id);
    // "Booked" only with its appointment.
    assert.equal(conversation.status === 'booked', Boolean(conversation.appointmentId) && conversation.bookingRequest?.status === 'confirmed', conversation.id);
  }
  // The chat about a discount waits for the owner's answer, with the request the AI took.
  const sabrina = demoConversations.find((item) => item.id === 'conv-sabrina')!;
  assert.equal(sabrina.status, 'needs-attention');
  assert.match(sabrina.attentionReason!, /discount/);
  assert.equal(sabrina.bookingRequest!.status, 'requested');
  // One chat asks to change a confirmed appointment, one asks for a time after closing.
  const giulia = demoConversations.find((item) => item.id === 'conv-giulia')!;
  assert.deepEqual([giulia.bookingRequest!.kind, giulia.bookingRequest!.status, giulia.appointmentId], ['change', 'requested', 'cal-giulia']);
  assert.equal(demoConversations.find((item) => item.id === 'conv-chloe')!.bookingRequest, undefined);
});

test('the salon\'s confirmations in the chats are the fixed sentences a live chat gets', () => {
  for (const conversation of demoConversations.filter((item) => item.appointmentId)) {
    const sent = conversation.messages.find((message) => message.sender === 'owner')!;
    const event = demoEvents.find((item) => item.id === conversation.appointmentId)!;
    const fixed = chatBookingMessage('confirmed', {
      language: conversation.language, customerName: conversation.customerName, salonName: 'Bella Hair Salon',
      serviceName: event.serviceName, staffName: event.staffName, date: event.date, time: event.startTime,
    });
    assert.equal(sent.original, fixed.original, conversation.id);
    assert.equal(sent.translation, fixed.translation, conversation.id);
    assert.equal(sent.translationDe, conversation.language === 'DE' ? undefined : fixed.translationDe, conversation.id);
  }
  // The appointment a reply in Sabrina's chat books has the id that confirming her request gives it.
  const sabrina = demoConversations.find((item) => item.id === 'conv-sabrina')!;
  assert.equal(sabrina.quickReplies![0].appointmentAction!.appointmentId, chatAppointmentId(sabrina.id, sabrina.bookingRequest!));
});

test('every request in a chat passes the salon\'s rules, today and on a day in another month', () => {
  for (const now of [FIXED_NOW, salonInstant('2026-11-19', '14:10', 'Europe/Zurich'), salonInstant('2027-06-03', '10:30', 'Europe/Zurich')]) {
    const workspace = createDemoWorkspace('Europe/Zurich', now);
    const salon = context({ events: workspace.events, requests: workspace.requests, shiftOverview: workspace.shifts, now });
    const waiting = workspace.conversations.filter((conversation) => conversation.bookingRequest?.status === 'requested');
    assert.equal(waiting.length, 3, String(now));
    for (const conversation of waiting) {
      const plan = planChatBooking(salon, conversation)!;
      assert.equal(plan.refusal, null, `${now.toISOString()}: ${conversation.id}`);
      assert.ok(plan.action, `${now.toISOString()}: ${conversation.id}`);
      // Inside the opening hours, never on a closed day, never in the past.
      const request = conversation.bookingRequest!;
      assert.equal(isOutsideOpeningHours(initialBookingHours, request.date, request.time, plan.endTime!), false, conversation.id);
      assert.ok(request.date > getSalonNow('Europe/Zurich', now).date, conversation.id);
    }
  }
});
