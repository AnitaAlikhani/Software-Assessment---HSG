import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { appointmentFromRequest } from '../src/appointmentActions';
import { ANSWER_SHOWN_MS, answerIsShown, inboxItems, isWaiting, openRequestCount, withAnswer, type RequestAnswer } from '../src/inbox';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { acceptedAppointmentState, movedRequest } from '../src/requestAnswers';
import type { AppointmentRequest, CalendarEvent, Conversation } from '../src/types';
import { HomeView } from '../src/views/HomeView';
import { demoConversations, demoCustomers, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { render, TELL_WORDS } from './renderHelpers';

// Home's inbox, "Waiting for you": what is in it, in which order, and what an entry says once
// the owner has answered it. The moment is fixed (Monday 5 October 2026, 12:00 in Zurich): the
// first request is Petra Meier's for Wednesday 7 October at 10:00, the second Monika Hofer's
// for Thursday 8 October at 14:30. Three sample chats wait for the owner.

const ZONE = 'Europe/Zurich';
const SALON = 'Bella Hair Salon';
const nothing = () => {};
const [wash, haircut] = demoRequests;

const liveChat = (id: string, partial: Partial<Conversation> = {}): Conversation => ({
  id: `live-web-${id}`, live: true, customerName: 'Tom', initials: 'T', avatarColor: 'bg-green-100 text-green-700',
  language: 'EN', languageLabel: 'English', phone: '', channel: 'Website', status: 'needs-attention', lastTime: '11:59',
  lastMessageAt: '2026-10-05T09:59:00Z',
  messages: [{ id: `${id}-1`, sender: 'customer', original: 'Do you offer a discount?', translation: 'Do you offer a discount?', time: '11:59' }],
  ...partial,
});
/** Tom's booking request, collected by the AI: a haircut on Thursday 8 October at 15:00. */
const tomsRequest = liveChat('tom', {
  attentionReason: 'Booking request: Haircut on Thursday, 08.10.2026 at 15:00 for Tom. Please confirm.',
  bookingRequest: { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-08', time: '15:00', customerName: 'Tom', status: 'requested' },
});
const lena = liveChat('lena', { customerName: 'Lena', initials: 'L', attentionReason: 'The customer asked for a discount.' });

const items = (partial: Partial<Parameters<typeof inboxItems>[0]> = {}) =>
  inboxItems({ requests: demoRequests, conversations: demoConversations, events: demoEvents, answers: [], timeZone: ZONE, now: FIXED_NOW, ...partial });
const keys = (list: ReturnType<typeof inboxItems>) => list.map((item) => item.key);
const answered = (request: AppointmentRequest, outcome: 'accepted' | 'moved' | 'rejected', minutesAgo = 1): RequestAnswer =>
  ({ kind: 'request', id: request.id, outcome, at: FIXED_NOW.getTime() - minutesAgo * 60_000, request, index: demoRequests.indexOf(request) });

// ---------- what is listed, and in which order ----------

test('the inbox lists requests, chat requests and waiting chats, each once, the oldest need first', () => {
  const all = items({ conversations: [tomsRequest, lena, ...demoConversations] });
  assert.deepEqual(keys(all), [
    // Chats: whoever has waited longest. Giulia wrote at 10:25, Chloé at 11:18, Camille at 11:54, Lena at 11:59.
    'chat:conv-giulia', 'chat:conv-chloe', 'chat:conv-camille', 'chat:live-web-lena',
    // Requests: the nearest appointment first, wherever the request came from.
    'request:req-1', 'request:req-2', 'chat:live-web-tom',
  ]);
  assert.ok(all.every(isWaiting));
  // The second request came in earlier (47 minutes ago, the first 12): the day asked for decides, not the age.
  assert.ok(Date.parse(haircut.createdAt!) < Date.parse(wash.createdAt!));
  // A chat with a waiting booking request is listed as that request, not a second time as a chat.
  assert.deepEqual(all.filter((item) => item.key === 'chat:live-web-tom').map((item) => item.kind), ['chat-request']);
  // Chats nobody waits in, and a request that is confirmed, are not listed.
  const calm = items({ requests: [], conversations: [
    liveChat('done', { status: 'booked', bookingRequest: { ...tomsRequest.bookingRequest!, status: 'confirmed' } }),
    ...demoConversations.map((conversation) => ({ ...conversation, status: 'ai-handled' as const })),
  ] });
  assert.deepEqual(calm, []);
  // The owner answered in the chat without confirming: the request still waits, so it is still listed.
  assert.deepEqual(keys(items({ requests: [], conversations: [{ ...tomsRequest, status: 'owner-handled' }] })), ['chat:live-web-tom']);
});

test('a request whose time has passed stands at the top, and the order follows the salon\'s clock', () => {
  // Asked for 09:00 this morning; it is 12:00 now, and the first chat has waited since 10:25.
  const overdue: AppointmentRequest = { ...wash, id: 'req-late', date: '2026-10-05', timeStr: '09:00 - 09:30' };
  assert.equal(keys(items({ requests: [...demoRequests, overdue] }))[0], 'request:req-late');
  // Asked for 11:00: after Giulia (10:25), before Chloé (11:18). 08:25 UTC is 10:25 in Zurich.
  const between: AppointmentRequest = { ...overdue, timeStr: '11:00 - 11:30' };
  assert.deepEqual(keys(items({ requests: [between] })).slice(0, 3), ['chat:conv-giulia', 'request:req-late', 'chat:conv-chloe']);
  // Two requests for the same minute: the one that came in first comes first.
  const twin: AppointmentRequest = { ...wash, id: 'req-twin', createdAt: '2026-10-05T09:00:00.000Z' };
  assert.deepEqual(keys(items({ requests: [wash, twin], conversations: [] })), ['request:req-twin', 'request:req-1']);
  // A chat without a time for its last message (stored long ago) is not lost: it stands first.
  const undated = liveChat('old', { lastMessageAt: undefined });
  assert.equal(keys(items({ conversations: [...demoConversations, undated] }))[0], 'chat:live-web-old');
});

test('open requests are counted wherever they came from', () => {
  assert.equal(openRequestCount(demoRequests, demoConversations), 2);
  assert.equal(openRequestCount(demoRequests, [tomsRequest, lena, ...demoConversations]), 3);
  assert.equal(openRequestCount([{ ...wash, status: 'accepted' }], [{ ...tomsRequest, bookingRequest: { ...tomsRequest.bookingRequest!, status: 'confirmed' } }]), 0);
});

// ---------- answers ----------

const accepted = appointmentFromRequest(wash, initialServices, initialEmployees);

test('an answered request keeps its place for a while and no longer counts as waiting', () => {
  // Accepted: the request has left the list of requests and its appointment is in the calendar.
  const afterAccept = items({ requests: [haircut], events: [accepted, ...demoEvents], answers: [answered(wash, 'accepted')] });
  assert.deepEqual(keys(afterAccept), keys(items()));
  assert.equal(afterAccept.find((item) => item.key === 'request:req-1')?.kind, 'request-answered');
  assert.equal(afterAccept.filter(isWaiting).length, items().length - 1);
  // Rejected: the same place, nothing in the calendar.
  const afterReject = items({ requests: [haircut], answers: [answered(wash, 'rejected')] });
  assert.deepEqual(keys(afterReject), keys(items()));
  assert.equal(afterReject.find((item) => item.key === 'request:req-1')?.kind, 'request-answered');
  // Moved to the Friday after the other request: it still waits, shows the move, and stays where it was.
  const later = movedRequest(wash, '2026-10-09', '10:00');
  const afterMove = items({ requests: [later, haircut], answers: [answered(wash, 'moved')] });
  assert.deepEqual(keys(afterMove), keys(items()));
  const moved = afterMove.find((item) => item.key === 'request:req-1')!;
  assert.ok(moved.kind === 'request' && moved.moved?.request === wash && moved.request === later);
  assert.ok(isWaiting(moved));
});

test('an answer is shown for five minutes; an accepted one also leaves with its appointment', () => {
  assert.equal(ANSWER_SHOWN_MS, 5 * 60_000);
  const fresh = answered(wash, 'accepted', 4);
  const old = answered(wash, 'accepted', 5);
  assert.equal(answerIsShown(fresh, FIXED_NOW), true);
  assert.equal(answerIsShown(old, FIXED_NOW), false);
  const calendar = [accepted, ...demoEvents];
  assert.ok(keys(items({ requests: [haircut], events: calendar, answers: [fresh] })).includes('request:req-1'));
  assert.ok(!keys(items({ requests: [haircut], events: calendar, answers: [old] })).includes('request:req-1'));
  // The owner cancelled the appointment in the calendar meanwhile: there is nothing left to show or to undo.
  assert.ok(!keys(items({ requests: [haircut], events: demoEvents, answers: [fresh] })).includes('request:req-1'));
  // A moved request whose note has gone is an ordinary request again, at the place of its new time.
  const later = movedRequest(wash, '2026-10-09', '10:00');
  const afterNote = items({ requests: [later, haircut], answers: [answered(wash, 'moved', 6)], conversations: [] });
  assert.deepEqual(keys(afterNote), ['request:req-2', 'request:req-1']);
  assert.ok(afterNote.every((item) => item.kind === 'request' && !item.moved));
});

test('one answer per request is remembered, and old ones are dropped with the next', () => {
  const first = answered(wash, 'moved', 3);
  const second: RequestAnswer = { ...answered(wash, 'accepted', 0) };
  const other = answered(haircut, 'rejected', 2);
  assert.deepEqual(withAnswer([first, other], second), [other, second]);
  // An answer from ten minutes ago is not carried along any further.
  assert.deepEqual(withAnswer([answered(haircut, 'rejected', 10)], second), [second]);
  // A chat's answer and a request's answer never replace each other, even with the same id.
  const chat: RequestAnswer = { kind: 'chat', id: wash.id, at: FIXED_NOW.getTime(), appointmentId: 'a', customerName: 'Tom', serviceName: 'Haircut', staffName: 'Anna Weber', date: '2026-10-08', startTime: '15:00', endTime: '15:30', delivery: 'pending' };
  assert.deepEqual(withAnswer([first], chat), [first, chat]);
});

const chatAnswer = (delivery: 'pending' | 'done' | 'failed', problem?: string): RequestAnswer => ({
  kind: 'chat', id: tomsRequest.id, at: FIXED_NOW.getTime() - 30_000, appointmentId: 'live-appt-live-web-tom-2026-10-08-1500',
  customerName: 'Tom', serviceName: 'Haircut', staffName: 'Anna Weber', date: '2026-10-08', startTime: '15:00', endTime: '15:30', delivery, problem,
});

test('an accepted chat request stands in the place of the request, also before the server has answered', () => {
  const before = items({ conversations: [tomsRequest, ...demoConversations] });
  // The chat still says "requested" until the server has confirmed: the entry shows the answer, not a second "Accept".
  const waitingForServer = items({ conversations: [tomsRequest, ...demoConversations], answers: [chatAnswer('pending')] });
  assert.deepEqual(keys(waitingForServer), keys(before));
  assert.equal(waitingForServer.find((item) => item.key === 'chat:live-web-tom')?.kind, 'chat-request-answered');
  // Confirmed: the chat no longer waits, the answer is still shown.
  const confirmed = { ...tomsRequest, status: 'booked' as const, bookingRequest: { ...tomsRequest.bookingRequest!, status: 'confirmed' as const } };
  assert.deepEqual(keys(items({ conversations: [confirmed, ...demoConversations], answers: [chatAnswer('done')] })), keys(before));
  // Once the answer has gone, a request that the server never confirmed waits again.
  const stale = { ...chatAnswer('failed', 'Could not reach the server.'), at: FIXED_NOW.getTime() - ANSWER_SHOWN_MS };
  assert.equal(items({ conversations: [tomsRequest], requests: [], answers: [stale] })[0].kind, 'chat-request');
});

// ---------- on the screen ----------

const context = (partial: Partial<React.ComponentProps<typeof HomeView>['availabilityContext']> = {}) => ({
  requests: demoRequests, events: demoEvents, services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours,
  shiftOverview: demoShifts, now: FIXED_NOW, timeZone: ZONE, ...partial,
});
const home = (partial: Partial<React.ComponentProps<typeof HomeView>> = {}) => render(React.createElement(HomeView, {
  requests: demoRequests, selectedRequestId: null, now: FIXED_NOW, availabilityContext: context(),
  conversations: demoConversations, customers: demoCustomers, salonName: SALON,
  onAcceptRequest: () => null, onRejectRequest: nothing, onMoveRequest: () => null, onUndoAnswer: () => null, onDismissAnswer: nothing,
  onAcceptChatRequest: () => null, onSimulateNewRequest: nothing, onOpenAppointment: nothing, onOpenConversations: nothing, onOpenCustomer: nothing,
  ...partial,
}));
/** The entry of the inbox that names this customer. */
const entry = (html: string, name: string) => {
  const part = html.slice(html.indexOf('home-inbox-title')).split('<li').find((item) => item.includes(`>${name}<`));
  assert.ok(part, `${name} has an entry`);
  return `<li${part.split('</li>')[0]}</li>`;
};
/** What a person reads in a piece of the page: the text between the tags, every run of spaces as one. */
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const buttons = (html: string) => Array.from(html.matchAll(/<button[^>]*>(.*?)<\/button>/g), (match) => match[1].replace(/<[^>]+>/g, '').trim());

test('a request from the booking page shows who, what, when, the contact and three actions', () => {
  const html = home();
  const petra = entry(html, 'Petra Meier');
  assert.match(words(petra), /WED 07\.10\. Booking request · 12 minutes ago Petra Meier Wash & blow-dry · 10:00–10:30 with Selina Keller \+41 76 555 62 42 · Booking page Accept Move Reject$/);
  assert.deepEqual(buttons(petra), ['Petra Meier', 'Accept', 'Move', 'Reject']);
  // The name leads to the customer's record, and says so to a screen reader.
  assert.match(petra, /aria-label="Petra Meier: open the customer record"/);
  // Without a way to the customers, or without a record, the name is plain text.
  assert.deepEqual(buttons(entry(home({ onOpenCustomer: undefined }), 'Petra Meier')), ['Accept', 'Move', 'Reject']);
  assert.deepEqual(buttons(entry(home({ customers: [] }), 'Petra Meier')), ['Accept', 'Move', 'Reject']);
  // Every button is a full tap target.
  for (const button of petra.match(/<button[^>]*>/g)!) assert.match(button, /\bmin-h-11\b/);
  // A customer who has a chat: the request leads there too.
  const camille = demoCustomers.find((customer) => customer.id === 'cust-camille')!;
  const hers: AppointmentRequest = { ...wash, id: 'req-camille', customerId: camille.id, customerName: camille.name, customerPhone: camille.phone };
  const withChat = entry(home({ requests: [hers], availabilityContext: context({ requests: [hers] }), conversations: [] }), camille.name);
  assert.deepEqual(buttons(withChat), [camille.name, 'Accept', 'Move', 'Reject']);
  const linked = entry(home({ requests: [hers], availabilityContext: context({ requests: [hers] }), conversations: demoConversations.filter((item) => item.id === 'conv-camille').map((item) => ({ ...item, status: 'ai-handled' as const })) }), camille.name);
  assert.deepEqual(buttons(linked), [camille.name, 'Open chat', 'Accept', 'Move', 'Reject']);
});

test('a request that cannot be accepted says why and offers "Move" first, instead of an Accept that would fail', () => {
  const cut = demoShifts.map((item) => item.employeeId === 'emp-2' ? { ...item, shifts: { ...item.shifts, [wash.date]: { start: '13:00', end: '14:00' } } } : item);
  const petra = entry(home({ availabilityContext: context({ shiftOverview: cut }) }), 'Petra Meier');
  assert.match(words(petra), /Selina Keller works 13:00–14:00 on Wed, 07\.10\.2026, not at 10:00–10:30\. Move the request to a new time, or reject it\. Move Reject$/);
  assert.deepEqual(buttons(petra), ['Petra Meier', 'Move', 'Reject']);
  // "Move" is now the filled button.
  assert.match(petra, /<button[^>]*bg-\[#5551FF\][^>]*>(<svg.*?<\/svg>)?Move<\/button>/);
  // The stylist has left the team: no other time helps, so only "Reject" is left.
  const gone = entry(home({ availabilityContext: context({ employees: initialEmployees.filter((employee) => employee.id !== 'emp-2') }) }), 'Petra Meier');
  assert.match(words(gone), /Selina Keller is no longer in your team\. Add the appointment by hand with someone else, or reject the request\. Reject$/);
  assert.deepEqual(buttons(gone), ['Petra Meier', 'Reject']);
  // The other request is not touched by any of this.
  assert.deepEqual(buttons(entry(home({ availabilityContext: context({ shiftOverview: cut }) }), 'Monika Hofer')), ['Monika Hofer', 'Accept', 'Move', 'Reject']);
});

test('a chat\'s booking request offers "Accept" and "Open chat", and nothing the server cannot do', () => {
  const html = home({ conversations: [tomsRequest, lena, ...demoConversations] });
  const tom = entry(html, 'Tom');
  assert.match(words(tom), /^.*THU 08\.10\. Booking request from a chat · 1 minute ago Tom Haircut · 15:00–15:30 with (Anna Weber|Selina Keller|Luca Frei), who is free then Website chat Accept adds it to your calendar and confirms it in the chat\. Accept Open chat$/);
  assert.deepEqual(buttons(tom), ['Accept', 'Open chat']);
  assert.doesNotMatch(words(tom), /reject|decline|move/i);
  // Nobody is free at that time: the entry says so, and the chat is the way out.
  const full = [
    { ...demoEvents[0], id: 'x-1', employeeId: 'emp-1', staffName: 'Anna Weber', date: '2026-10-08', startTime: '15:00', endTime: '15:30' },
    ...demoEvents,
  ] as CalendarEvent[];
  const blocked = entry(home({ conversations: [tomsRequest], availabilityContext: context({ events: full }) }), 'Tom');
  assert.match(words(blocked), /Nobody who offers Haircut is free on Thu, 08\.10\.2026 at 15:00–15:30\. Open the chat to agree a new time\. Open chat$/);
  assert.deepEqual(buttons(blocked), ['Open chat']);
  // Without a way to accept (a page that only shows the list), no "Accept" is drawn.
  assert.deepEqual(buttons(entry(home({ conversations: [tomsRequest], onAcceptChatRequest: undefined }), 'Tom')), ['Open chat']);
  // A chat that waits for the owner is one row that opens the chat, with the reason it waits for.
  const row = entry(html, 'Lena');
  assert.equal(row.match(/<button/g)?.length, 1);
  assert.match(words(row), /Chat · 1 minute ago Lena English The customer asked for a discount\. Open chat$/);
  assert.match(words(entry(html, 'Giulia Rossi')), /Chat · 1 hour ago Giulia Rossi IT The customer wants to change an existing booking\./);
  assert.match(words(entry(home({ conversations: [{ ...lena, attentionReason: undefined }] }), 'Lena')), /The customer is waiting for your answer\./);
});

/** Words that would claim the app has told the customer. No answered entry of a booking-page request may hold one. */
const CLAIMS_CONTACT = /\b(sent|send|sends|sending|notif\w*|inform\w*|messaged|e-?mailed|texted|delivered|has been told|was told|let .* know)\b/i;

test('an accepted request says that the app does not tell the customer, shows the number and a text in the customer\'s language', () => {
  const html = home({ requests: [haircut], availabilityContext: context({ requests: [haircut], events: [accepted, ...demoEvents] }), answers: [answered(wash, 'accepted')] });
  const petra = entry(html, 'Petra Meier');
  const text = words(petra);
  assert.match(text, /Accepted Petra Meier Wash & blow-dry · Wed, 07\.10\.2026, 10:00–10:30 · with Selina Keller/);
  assert.match(text, /SlotBee does not tell Petra Meier\. Call or write to pass it on\. \+41 76 555 62 42/);
  // Her record says German: the text is German, and the card says which language it is.
  assert.match(text, /Text to copy, in German Guten Tag Petra Meier, Ihr Termin bei Bella Hair Salon ist bestätigt: Wash & blow-dry am Mittwoch, 07\.10\.2026 um 10:00 Uhr mit Selina Keller\. Wir freuen uns auf Sie!/);
  // Her number is one of the sample salon's invented ones (+41 7x 555 …): shown, but never a link that dials.
  assert.doesNotMatch(petra, /href="tel:/);
  assert.deepEqual(buttons(petra), ['Petra Meier', 'Copy text', 'View appointment', 'Undo', 'Done']);
  // Nothing claims that the customer was told, and the entry no longer counts as waiting.
  assert.doesNotMatch(text, CLAIMS_CONTACT);
  assert.doesNotMatch(text, TELL_WORDS);
  assert.match(html, /Waiting for you<\/h2><span[^>]*>4</);
  // A customer whose record says French, Italian or English gets that language.
  for (const [language, opening] of [['FR', 'Bonjour Petra Meier, votre rendez-vous chez Bella Hair Salon est confirmé'], ['IT', 'Buongiorno Petra Meier, il Suo appuntamento presso Bella Hair Salon è confermato'], ['EN', 'Hello Petra Meier, your appointment at Bella Hair Salon is confirmed']] as const) {
    const customers = demoCustomers.map((customer) => customer.id === wash.customerId ? { ...customer, language } : customer);
    const inLanguage = words(entry(home({ requests: [haircut], customers, availabilityContext: context({ requests: [haircut], events: [accepted, ...demoEvents] }), answers: [answered(wash, 'accepted')] }), 'Petra Meier'));
    assert.ok(inLanguage.includes(opening), language);
    assert.ok(inLanguage.includes(`Text to copy, in ${{ FR: 'French', IT: 'Italian', EN: 'English' }[language]}`), language);
  }
  // No record (deleted meanwhile): English, the number from the request itself, the name as plain text.
  const unknown = entry(home({ requests: [haircut], customers: [], availabilityContext: context({ requests: [haircut], events: [accepted, ...demoEvents] }), answers: [answered(wash, 'accepted')] }), 'Petra Meier');
  assert.match(words(unknown), /Text to copy, in English Hello Petra Meier/);
  assert.match(words(unknown), /\+41 76 555 62 42/);
  assert.doesNotMatch(unknown, /href="tel:/);
  // A number that is not one of the invented ones is a link that dials.
  const real = entry(home({ requests: [haircut], customers: [], availabilityContext: context({ requests: [haircut], events: [accepted, ...demoEvents] }), answers: [answered({ ...wash, customerPhone: '+41791234567' }, 'accepted')] }), 'Petra Meier');
  assert.match(real, /href="tel:\+41791234567"/);
  // No number anywhere: the card says so instead of showing an empty link.
  const noPhone = entry(home({ requests: [haircut], customers: [], availabilityContext: context({ requests: [haircut], events: [accepted, ...demoEvents] }), answers: [answered({ ...wash, customerPhone: undefined }, 'accepted')] }), 'Petra Meier');
  assert.match(words(noPhone), /No phone number is on record for Petra Meier\./);
  assert.doesNotMatch(noPhone, /href="tel:/);
});

test('a rejected and a moved request say the same, each with its own text and its own way back', () => {
  const rejected = entry(home({ requests: [haircut], availabilityContext: context({ requests: [haircut] }), answers: [answered(wash, 'rejected')] }), 'Petra Meier');
  assert.match(words(rejected), /Rejected Petra Meier Wash & blow-dry · Wed, 07\.10\.2026, 10:00–10:30 · with Selina Keller SlotBee does not tell Petra Meier\. Call or write to pass it on\./);
  assert.match(words(rejected), /Leider können wir Ihnen Wash & blow-dry am Mittwoch, 07\.10\.2026 um 10:00 Uhr nicht anbieten\./);
  assert.deepEqual(buttons(rejected), ['Petra Meier', 'Copy text', 'Undo', 'Done']);
  assert.doesNotMatch(words(rejected), CLAIMS_CONTACT);

  // Moved to Friday at 10:00: the request still waits, with its actions, and the note says what to ask the customer.
  const later = movedRequest(wash, '2026-10-09', '10:00');
  const moved = entry(home({ requests: [later, haircut], availabilityContext: context({ requests: [later, haircut] }), answers: [answered(wash, 'moved')] }), 'Petra Meier');
  assert.match(words(moved), /FRI 09\.10\. Booking request · 12 minutes ago Petra Meier Wash & blow-dry · 10:00–10:30 with Selina Keller/);
  assert.match(words(moved), /Moved from Wed, 07\.10\.2026, 10:00–10:30 SlotBee does not tell Petra Meier\. Call or write to ask whether the new time suits\./);
  assert.match(words(moved), /Leider ist der Termin am Mittwoch, 07\.10\.2026 um 10:00 Uhr nicht möglich\. Wir können Ihnen Wash & blow-dry am Freitag, 09\.10\.2026 um 10:00 Uhr mit Selina Keller anbieten\. Passt Ihnen das\?/);
  assert.deepEqual(buttons(moved), ['Petra Meier', 'Copy text', 'Undo', 'Done', 'Accept', 'Move', 'Reject']);
  assert.doesNotMatch(words(moved), CLAIMS_CONTACT);
  // Without a way to take an answer back or to put it away, those buttons are not drawn.
  const bare = entry(home({ requests: [haircut], availabilityContext: context({ requests: [haircut] }), answers: [answered(wash, 'rejected')], onUndoAnswer: undefined, onDismissAnswer: undefined }), 'Petra Meier');
  assert.deepEqual(buttons(bare), ['Petra Meier', 'Copy text']);
});

test('an accepted chat request says where the confirmation is, and only what is true of it', () => {
  const card = (answer: RequestAnswer, conversations: Conversation[] = [tomsRequest]) => entry(home({ conversations, answers: [answer] }), 'Tom');
  const pending = card(chatAnswer('pending'));
  assert.match(words(pending), /Accepted Tom Haircut · Thu, 08\.10\.2026, 15:00–15:30 · with Anna Weber The appointment is in your calendar\. The confirmation is on its way into the chat…/);
  assert.deepEqual(buttons(pending), ['Open chat']);
  const done = card(chatAnswer('done'));
  assert.match(words(done), /The appointment is in your calendar\. Tom has the confirmation in the chat\./);
  assert.deepEqual(buttons(done), ['Open chat', 'Done']);
  // The server did not take it: the card says so, and offers to try again while the request still waits.
  const failed = card(chatAnswer('failed', 'The confirmation could not be sent. Try again.'));
  assert.match(words(failed), /The appointment is in your calendar, but the confirmation did not get into the chat\. The confirmation could not be sent\. Try again\. You can also open the chat and write to Tom yourself\. Try again Open chat Done$/);
  assert.deepEqual(buttons(failed), ['Try again', 'Open chat', 'Done']);
  // The customer deleted the chat meanwhile: there is nothing to open or to try again, and the card says only what happened.
  const deleted = card(chatAnswer('failed', 'This chat was deleted by the customer.'), []);
  assert.match(words(deleted), /did not get into the chat\. This chat was deleted by the customer\. Done$/);
  assert.deepEqual(buttons(deleted), ['Done']);
  // What is in the chat cannot be taken back from here: no "Undo", and no word of rejecting.
  for (const html of [pending, done, failed]) assert.doesNotMatch(words(html), /undo|reject|decline/i);
  // With the appointment in the calendar, the card leads to it.
  const booked = { ...demoEvents[0], id: 'live-appt-live-web-tom-2026-10-08-1500' };
  assert.deepEqual(buttons(entry(home({ conversations: [tomsRequest], availabilityContext: context({ events: [booked, ...demoEvents] }), answers: [chatAnswer('done')] }), 'Tom')), ['Open chat', 'View appointment', 'Done']);
});


test('an accepted request follows its appointment: a change in the calendar changes the text and takes Undo away', () => {
  // The owner accepted Petra's wash for 10:00 and then moved the appointment to 14:00 in the calendar.
  const moved = { ...accepted, startTime: '14:00', endTime: '14:30' };
  assert.equal(acceptedAppointmentState(wash, accepted), 'same');
  assert.equal(acceptedAppointmentState(wash, moved), 'changed');
  assert.equal(acceptedAppointmentState(wash, { ...accepted, date: '2026-10-08' }), 'changed');
  assert.equal(acceptedAppointmentState(wash, undefined), 'gone');

  const changed = entry(home({ requests: [haircut], availabilityContext: context({ requests: [haircut], events: [moved, ...demoEvents] }), answers: [answered(wash, 'accepted')] }), 'Petra Meier');
  const text = words(changed);
  // The card shows the appointment as it stands, and the text to pass on gives the new time, not the one asked for.
  assert.match(text, /Accepted Petra Meier Wash & blow-dry · Wed, 07\.10\.2026, 14:00–14:30/);
  assert.match(text, /The appointment was changed in the calendar after you accepted\. The text below gives it as it stands now\./);
  assert.match(text, /um 14:00 Uhr/);
  assert.doesNotMatch(text, /um 10:00 Uhr/);
  // Undo would throw the change away, so it is not offered; the appointment itself is one tap away.
  assert.deepEqual(buttons(changed), ['Petra Meier', 'Copy text', 'View appointment', 'Done']);

  // Cancelled in the calendar: the answer has nothing left to show or to take back, so it leaves the list.
  const cancelled = home({ requests: [haircut], availabilityContext: context({ requests: [haircut], events: demoEvents }), answers: [answered(wash, 'accepted')] });
  assert.doesNotMatch(cancelled.slice(cancelled.indexOf('home-inbox-title')).split('Booked by the AI')[0], />Petra Meier</);
});
