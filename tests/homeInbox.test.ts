import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { appointmentFromRequest } from '../src/appointmentActions';
import { ANSWER_SHOWN_MS, answerIsShown, inboxCounts, inboxItems, isWaiting, withAnswer, type RequestAnswer } from '../src/inbox';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { acceptedAppointmentState, movedRequest } from '../src/requestAnswers';
import type { AppointmentRequest, CalendarEvent, Conversation } from '../src/types';
import { HomeView } from '../src/views/HomeView';
import { demoConversations, demoCustomers, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { render, TELL_WORDS } from './renderHelpers';

// Home's inbox, "Waiting for you": what is in it, in which order, and what an entry says once
// the owner has answered it. The moment is fixed (Monday 5 October 2026, 12:00 in Zurich): the
// first request is Petra Meier's for Wednesday 7 October at 10:00, the second Monika Hofer's
// for Thursday 8 October at 14:30. Four of the salon's chats wait for the owner: Chloé's question
// about a time after closing, and three booking requests the AI took (Sabrina's colouring on
// Friday, Reto's men's cut and Giulia's move, both on Saturday).

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
    // Chats: whoever has waited longest. Chloé wrote at 11:18, Lena at 11:59.
    'chat:conv-chloe', 'chat:live-web-lena',
    // Requests: the nearest appointment first, wherever the request came from.
    'request:req-1', 'request:req-2', 'chat:live-web-tom', 'chat:conv-sabrina', 'chat:conv-reto', 'chat:conv-giulia',
  ]);
  assert.ok(all.every(isWaiting));
  // The second request came in earlier (47 minutes ago, the first 12): the day asked for decides, not the age.
  assert.ok(Date.parse(haircut.createdAt!) < Date.parse(wash.createdAt!));
  // A chat with a waiting booking request is listed as that request, not a second time as a chat.
  assert.deepEqual(all.filter((item) => item.key === 'chat:live-web-tom').map((item) => item.kind), ['chat-request']);
  // Chats nobody waits in, and a request that is confirmed, are not listed.
  const calm = items({ requests: [], conversations: [
    liveChat('done', { status: 'booked', bookingRequest: { ...tomsRequest.bookingRequest!, status: 'confirmed' } }),
    ...demoConversations.map((conversation) => ({ ...conversation, status: 'ai-handled' as const, bookingRequest: conversation.bookingRequest && { ...conversation.bookingRequest, status: 'confirmed' as const } })),
  ] });
  assert.deepEqual(calm, []);
  // The owner answered in the chat without confirming: the request still waits, so it is still listed.
  assert.deepEqual(keys(items({ requests: [], conversations: [{ ...tomsRequest, status: 'owner-handled' }] })), ['chat:live-web-tom']);
});

test('a request whose time has passed stands at the top, and the order follows the salon\'s clock', () => {
  // Asked for 09:00 this morning; it is 12:00 now, and the first chat has waited since 11:18.
  const overdue: AppointmentRequest = { ...wash, id: 'req-late', date: '2026-10-05', timeStr: '09:00 - 09:30' };
  assert.equal(keys(items({ requests: [...demoRequests, overdue] }))[0], 'request:req-late');
  // Asked for 11:30: after Chloé (11:18), before Lena (11:59). 09:59 UTC is 11:59 in Zurich.
  const between: AppointmentRequest = { ...overdue, timeStr: '11:30 - 12:00' };
  assert.deepEqual(keys(items({ requests: [between], conversations: [lena, ...demoConversations] })).slice(0, 3), ['chat:conv-chloe', 'request:req-late', 'chat:live-web-lena']);
  // Two requests for the same minute: the one that came in first comes first.
  const twin: AppointmentRequest = { ...wash, id: 'req-twin', createdAt: '2026-10-05T09:00:00.000Z' };
  assert.deepEqual(keys(items({ requests: [wash, twin], conversations: [] })), ['request:req-twin', 'request:req-1']);
  // A chat without a time for its last message (stored long ago) is not lost: it stands first.
  const undated = liveChat('old', { lastMessageAt: undefined });
  assert.equal(keys(items({ conversations: [...demoConversations, undated] }))[0], 'chat:live-web-old');
});

test('everything that waits is counted once: requests wherever they came from, and chats', () => {
  // Two requests from the booking page, three in the salon's chats (Sabrina, Reto, Giulia), and Chloé's question.
  assert.deepEqual(inboxCounts(items()), { waiting: 6, requests: 5, chats: 1 });
  // Tom's request and Lena's question come in over the live chat.
  assert.deepEqual(inboxCounts(items({ conversations: [tomsRequest, lena, ...demoConversations] })), { waiting: 8, requests: 6, chats: 2 });
  // A chat with a waiting request is one entry, a request: it is not counted a second time as a chat.
  assert.deepEqual(inboxCounts(items({ requests: [], conversations: [tomsRequest] })), { waiting: 1, requests: 1, chats: 0 });
  // What is answered or confirmed no longer waits.
  assert.deepEqual(inboxCounts(items({ requests: [{ ...wash, status: 'accepted' }], conversations: [{ ...tomsRequest, status: 'booked', bookingRequest: { ...tomsRequest.bookingRequest!, status: 'confirmed' } }] })), { waiting: 0, requests: 0, chats: 0 });
});

// ---------- answers ----------

const accepted = appointmentFromRequest(wash, initialServices, initialEmployees);

test('an answered request keeps its place for a while and no longer counts as waiting', () => {
  // Confirmed: the request has left the list of requests and its appointment is in the calendar.
  const afterAccept = items({ requests: [haircut], events: [accepted, ...demoEvents], answers: [answered(wash, 'accepted')] });
  assert.deepEqual(keys(afterAccept), keys(items()));
  assert.equal(afterAccept.find((item) => item.key === 'request:req-1')?.kind, 'request-answered');
  assert.equal(afterAccept.filter(isWaiting).length, items().length - 1);
  // Declined: the same place, nothing in the calendar.
  const afterReject = items({ requests: [haircut], answers: [answered(wash, 'rejected')] });
  assert.deepEqual(keys(afterReject), keys(items()));
  assert.equal(afterReject.find((item) => item.key === 'request:req-1')?.kind, 'request-answered');
  // Another time suggested, the Friday after the other request: it still waits, shows the suggestion, and stays where it was.
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
  customerName: 'Tom', serviceName: 'Haircut', staffName: 'Anna Weber', date: '2026-10-08', startTime: '15:00', endTime: '15:30', live: true, delivery, problem,
});

test('an accepted chat request stands in the place of the request, also before the server has answered', () => {
  const before = items({ conversations: [tomsRequest, ...demoConversations] });
  // The chat still says "requested" until the server has confirmed: the entry shows the answer, not a second "Confirm".
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
  onChatBooking: () => null, onSimulateNewRequest: nothing, onOpenAppointment: nothing, onOpenConversations: nothing, onOpenCustomer: nothing,
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
/** The links of a piece of the page: what each is called (without what only a screen reader hears) and where it leads. */
const links = (html: string) => Array.from(html.matchAll(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/g), ([, href, content]) =>
  [content.replace(/<span class="sr-only">.*?<\/span>/g, '').replace(/<[^>]+>/g, '').trim(), href.replace(/&amp;/g, '&')]);

test('a request from the booking page shows who, what, when, the contact and the three answers', () => {
  const html = home();
  const petra = entry(html, 'Petra Meier');
  // Three lines beside the day. Who it is from, and how long they have waited: short for the eye, in words for
  // a screen reader. What is asked for and when. Then, small, what kind of entry it is and how to reach the customer.
  // Below them, what Confirm does and who tells the customer; then the answers.
  assert.match(words(petra), /WED 07\.10\. Petra Meier 12 min Waiting for 12 minutes Wash & blow-dry · 10:00–10:30 · with Selina Keller Booking request · \+41 76 555 62 42 · Booking page Confirm adds it to your calendar\. You tell Petra Meier yourself\. Confirm Suggest another time Decline$/);
  assert.deepEqual(buttons(petra), ['Petra Meier', 'Confirm', 'Suggest another time', 'Decline']);
  // On a narrow screen a line breaks between two facts, never inside one: the stylist and the number stay whole.
  assert.match(petra, /<span class="inline-block max-w-full">with Selina Keller<\/span>/);
  assert.match(petra, /<span class="whitespace-nowrap">\+41 76 555 62 42<\/span>/);
  // The name leads to the customer's record, and says so to a screen reader.
  assert.match(petra, /aria-label="Petra Meier: open the customer record"/);
  // Without a way to the customers, or without a record, the name is plain text.
  assert.deepEqual(buttons(entry(home({ onOpenCustomer: undefined }), 'Petra Meier')), ['Confirm', 'Suggest another time', 'Decline']);
  assert.deepEqual(buttons(entry(home({ customers: [] }), 'Petra Meier')), ['Confirm', 'Suggest another time', 'Decline']);
  // Every button is a full tap target.
  for (const button of petra.match(/<button[^>]*>/g)!) assert.match(button, /\bmin-h-11\b/);
  // A customer who has a chat: the request leads there too.
  const sabrina = demoCustomers.find((customer) => customer.id === 'cust-sabrina')!;
  const hers: AppointmentRequest = { ...wash, id: 'req-sabrina', customerId: sabrina.id, customerName: sabrina.name, customerPhone: sabrina.phone };
  const withChat = entry(home({ requests: [hers], availabilityContext: context({ requests: [hers] }), conversations: [] }), sabrina.name);
  assert.deepEqual(buttons(withChat), [sabrina.name, 'Confirm', 'Suggest another time', 'Decline']);
  // Her chat, with nothing waiting in it (no question, no booking request).
  const calmChat = demoConversations.filter((item) => item.id === 'conv-sabrina').map((item) => ({ ...item, status: 'ai-handled' as const, bookingRequest: undefined }));
  const linked = entry(home({ requests: [hers], availabilityContext: context({ requests: [hers] }), conversations: calmChat }), sabrina.name);
  assert.deepEqual(buttons(linked), [sabrina.name, 'Open chat', 'Confirm', 'Suggest another time', 'Decline']);
  // The way into the chat ends the entry's small line; the row at the end holds the answers and nothing else.
  assert.match(words(linked), / · Booking page Open chat Confirm adds it to your calendar\. You tell \S+ \S+ yourself\. Confirm Suggest another time Decline$/);
  for (const button of linked.match(/<button[^>]*>/g)!) assert.match(button, /\bmin-h-11\b/);
});

test('a request that cannot be confirmed says why and offers "Suggest another time" first, instead of a Confirm that would fail', () => {
  const cut = demoShifts.map((item) => item.employeeId === 'emp-2' ? { ...item, shifts: { ...item.shifts, [wash.date]: { start: '13:00', end: '14:00' } } } : item);
  const petra = entry(home({ availabilityContext: context({ shiftOverview: cut }) }), 'Petra Meier');
  // What is in the way, and the ways out in the words of the answers below it.
  assert.match(words(petra), /Selina Keller works 13:00–14:00 on Wed, 07\.10\.2026, not at 10:00–10:30\. Suggest another time, or decline\. Suggest another time Decline$/);
  assert.deepEqual(buttons(petra), ['Petra Meier', 'Suggest another time', 'Decline']);
  // "Suggest another time" is now the filled button, and nothing says what a Confirm would do.
  assert.match(petra, /<button[^>]*bg-\[#5551FF\][^>]*>(<svg.*?<\/svg>)?Suggest another time<\/button>/);
  assert.doesNotMatch(words(petra), /Confirm adds it/);
  // The stylist has left the team: no other time helps, so only "Decline" is left.
  const gone = entry(home({ availabilityContext: context({ employees: initialEmployees.filter((employee) => employee.id !== 'emp-2') }) }), 'Petra Meier');
  assert.match(words(gone), /Selina Keller is no longer in your team\. Add the appointment by hand with someone else, or decline\. Decline$/);
  assert.deepEqual(buttons(gone), ['Petra Meier', 'Decline']);
  // The other request is not touched by any of this.
  assert.deepEqual(buttons(entry(home({ availabilityContext: context({ shiftOverview: cut }) }), 'Monika Hofer')), ['Monika Hofer', 'Confirm', 'Suggest another time', 'Decline']);
});

test('every booking request has the same three answers in the same words, wherever it came from', () => {
  const html = home({ conversations: [tomsRequest, ...demoConversations] });
  /** The row of answers of an entry, as it is drawn. */
  const answers = (part: string) => /<div class="mt-3 grid grid-cols-2[^"]*">.*?<\/div>/.exec(part)?.[0] ?? '';
  const [page, liveChat, ownChat] = ['Petra Meier', 'Tom', 'Sabrina Lüchinger'].map((name) => entry(html, name));
  // From the booking page, from a live chat, from one of the salon's own chats: one row, drawn the same.
  assert.deepEqual(buttons(answers(page)), ['Confirm', 'Suggest another time', 'Decline']);
  assert.equal(answers(liveChat), answers(page));
  assert.equal(answers(ownChat), answers(page));
  // What differs is who tells the customer, and the line above the answers says it in each case.
  assert.match(words(page), /Confirm adds it to your calendar\. You tell Petra Meier yourself\. Confirm Suggest another time Decline$/);
  assert.match(words(liveChat), /Confirm adds it to your calendar and sends Tom the confirmation in the chat\. Confirm Suggest another time Decline$/);
  // Nobody is on the other side of the salon's own chat: the confirmation goes into the chat, and nothing says it was sent.
  assert.match(words(ownChat), /Confirm adds it to your calendar and puts the confirmation in the chat\. Confirm Suggest another time Decline$/);
  // No entry of the list offers to accept, move or reject any more.
  const list = html.slice(html.indexOf('home-inbox-title'), html.indexOf('home-ai-title'));
  assert.deepEqual(buttons(list).filter((name) => /^(Accept|Move|Reject)$/.test(name)), []);
});

test('a chat\'s booking request offers the answers of the chat\'s own card: Confirm, Suggest another time, Decline', () => {
  const html = home({ conversations: [tomsRequest, lena, ...demoConversations] });
  const tom = entry(html, 'Tom');
  assert.match(words(tom), /^THU 08\.10\. Tom 1 min Waiting for 1 minute Haircut · 15:00–15:30 · with Anna Weber Booking request from a chat · Website chat Open chat Anna Weber is free then\. Checked against the opening hours, the working hours, time off and your calendar\. Confirm adds it to your calendar and sends Tom the confirmation in the chat\. Confirm Suggest another time Decline$/);
  // The way into the chat stands with what the entry says; the answers stand together below it.
  assert.deepEqual(buttons(tom), ['Open chat', 'Confirm', 'Suggest another time', 'Decline']);
  // Who is free is said in the colour of the text; what it was checked against follows more quietly, and is still there.
  assert.match(tom, /<span class="font-medium text-slate-900">Anna Weber is free then\.<\/span> Checked against the opening hours, the working hours, time off and your calendar\.<\/span>/);
  for (const button of tom.match(/<button[^>]*>/g)!) assert.match(button, /\bmin-h-11\b/);
  // Two stylists are free (an empty calendar): the owner can give it to the other one.
  const two = entry(home({ conversations: [tomsRequest], availabilityContext: context({ events: [], requests: [] }) }), 'Tom');
  assert.match(two, /<label[^>]*>Stylist who is free then<\/label><select[^>]*>(<option[^>]*>[^<]*<\/option>)+<\/select>/);
  assert.match(two, /<option value="emp-1" selected="">Anna Weber<\/option><option value="emp-2">Selina Keller<\/option>/);
  // Nobody is free at that time: the entry says so, and offers another time or declining instead of a Confirm that would fail.
  const full = [
    { ...demoEvents[0], id: 'x-1', employeeId: 'emp-1', staffName: 'Anna Weber', date: '2026-10-08', startTime: '15:00', endTime: '15:30' },
    { ...demoEvents[0], id: 'x-2', employeeId: 'emp-2', staffName: 'Selina Keller', date: '2026-10-08', startTime: '15:00', endTime: '15:30' },
    ...demoEvents,
  ] as CalendarEvent[];
  const blocked = entry(home({ conversations: [tomsRequest], availabilityContext: context({ events: full }) }), 'Tom');
  assert.match(words(blocked), /Nobody who offers Haircut is free on Thu, 08\.10\.2026 at 15:00–15:30\. Suggest another time, or decline\. Suggest another time Decline$/);
  assert.deepEqual(buttons(blocked), ['Open chat', 'Suggest another time', 'Decline']);
  // A stylist the customer asked for is shown as such.
  const asking = (employeeId: string, staffName: string) => ({ ...tomsRequest, bookingRequest: { ...tomsRequest.bookingRequest!, employeeId, staffName } });
  assert.match(words(entry(home({ conversations: [asking('emp-1', 'Anna Weber')] }), 'Tom')), /Haircut · 15:00–15:30 · with Anna Weber, as asked Booking request from a chat/);
  // Asked for a stylist who is not free: the entry says why, and who is free instead.
  assert.match(words(entry(home({ conversations: [asking('emp-2', 'Selina Keller')] }), 'Tom')),
    /Haircut · 15:00–15:30 · asked for Selina Keller Booking request from a chat · Website chat Open chat Tom asked for Selina Keller\. Selina Keller already has Giulia Rossi at 15:00–15:30 on Thu, 08\.10\.2026\. Anna Weber is free then\. Confirm with Anna Weber, suggest another time, or decline\. Stylist who is free then Anna Weber/);
  // Without a way to answer (a page that only shows the list), only "Open chat" is drawn.
  assert.deepEqual(buttons(entry(home({ conversations: [tomsRequest], onChatBooking: undefined }), 'Tom')), ['Open chat']);
  // A customer's wish to cancel stands in the list as such, with its two answers.
  const booked = { ...demoEvents[0], id: 'live-appt-live-web-tom-2026-10-08-1500', conversationId: tomsRequest.id, customerName: 'Tom', serviceName: 'Haircut', employeeId: 'emp-1', staffName: 'Anna Weber', date: '2026-10-08', startTime: '15:00', endTime: '15:30' };
  const cancelling = { ...tomsRequest, bookingRequest: { ...tomsRequest.bookingRequest!, status: 'confirmed' as const }, cancellationRequest: { service: 'Haircut', date: '2026-10-08', time: '15:00' } };
  const cancel = entry(home({ conversations: [cancelling], availabilityContext: context({ events: [booked, ...demoEvents] }) }), 'Tom wants to cancel');
  assert.match(words(cancel), /^THU 08\.10\. Tom wants to cancel 1 min Waiting for 1 minute Haircut · 15:00–15:30 · with Anna Weber Cancellation request from a chat · Website chat Open chat Cancel appointment takes it out of your calendar and sends Tom the cancellation in the chat\. Keep appointment sends nothing: write to Tom yourself\. Cancel appointment Keep appointment$/);
  assert.deepEqual(buttons(cancel), ['Open chat', 'Cancel appointment', 'Keep appointment']);
  assert.match(html, /Waiting for you<\/h2><span[^>]*>8</); // two requests, Tom, Lena and four of the salon's own chats
  // A chat that waits for the owner is one row that opens the chat: who waits and for how long, then the reason.
  const row = entry(html, 'Lena');
  assert.equal(row.match(/<button/g)?.length, 1);
  assert.match(words(row), /Chat: Lena English 1 min Waiting for 1 minute The customer asked for a discount\. Open chat$/);
  assert.match(words(entry(html, 'Chloé Favre')), /Chat: Chloé Favre DE 42 min Waiting for 42 minutes, a long wait The customer asked for Friday at 19:00, after closing time \(18:30\)\. Offer another time\. Open chat$/);
  assert.match(words(entry(home({ conversations: [{ ...lena, attentionReason: undefined }] }), 'Lena')), /The customer is waiting for your answer\./);
});

/** Words that would claim the app has told the customer. No answered entry of a booking-page request may hold one. */
const CLAIMS_CONTACT = /\b(sent|send|sends|sending|notif\w*|inform\w*|messaged|e-?mailed|texted|delivered|has been told|was told|let .* know)\b/i;

test('a confirmed request says that the app does not tell the customer, shows the number and a text in the customer\'s language', () => {
  const html = home({ requests: [haircut], availabilityContext: context({ requests: [haircut], events: [accepted, ...demoEvents] }), answers: [answered(wash, 'accepted')] });
  const petra = entry(html, 'Petra Meier');
  const text = words(petra);
  // It is called what the button was called, and what the customer's own page calls it.
  assert.match(text, /^Confirmed Petra Meier Wash & blow-dry · Wed, 07\.10\.2026, 10:00–10:30 · with Selina Keller/);
  assert.match(text, /SlotBee does not tell Petra Meier\. Call or write to pass it on\. \+41 76 555 62 42/);
  // Her record says German: the text is German, and the card says which language it is.
  assert.match(text, /Text to copy, in German Guten Tag Petra Meier, Ihr Termin bei Bella Hair Salon ist bestätigt: Wash & blow-dry am Mittwoch, 07\.10\.2026 um 10:00 Uhr mit Selina Keller\. Wir freuen uns auf Sie!/);
  // Her number is one of the sample salon's invented ones (+41 7x 555 …): shown, but never a link that dials.
  assert.doesNotMatch(petra, /href="tel:/);
  assert.deepEqual(buttons(petra), ['Petra Meier', 'Copy text', 'View appointment', 'Undo', 'Done']);
  // Beside "Copy text": the owner's own WhatsApp and text messages, opened with the text written. Nothing
  // goes out by following them, and with an invented number they name nobody: she chooses whom it is for.
  const written = encodeURIComponent('Guten Tag Petra Meier, Ihr Termin bei Bella Hair Salon ist bestätigt: Wash & blow-dry am Mittwoch, 07.10.2026 um 10:00 Uhr mit Selina Keller. Wir freuen uns auf Sie!');
  assert.deepEqual(links(petra), [['Open in WhatsApp', `https://wa.me/?text=${written}`], ['Open as SMS', `sms:?&body=${written}`]]);
  // Both are full tap targets, and the one that leaves the app opens beside it.
  for (const link of petra.match(/<a [^>]*>/g)!) assert.match(link, /\bmin-h-11\b/);
  assert.match(petra, /<a href="https:\/\/wa\.me\/[^"]*" target="_blank" rel="noopener noreferrer"/);
  // Nothing claims that the customer was told, and the entry no longer counts as waiting.
  assert.doesNotMatch(text, CLAIMS_CONTACT);
  assert.doesNotMatch(text, TELL_WORDS);
  assert.match(html, /Waiting for you<\/h2><span[^>]*>5</);
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
  // A number that is not one of the invented ones is a link that dials, and the two messengers open on that customer.
  const real = entry(home({ requests: [haircut], customers: [], availabilityContext: context({ requests: [haircut], events: [accepted, ...demoEvents] }), answers: [answered({ ...wash, customerPhone: '+41791234567' }, 'accepted')] }), 'Petra Meier');
  assert.match(real, /href="tel:\+41791234567"/);
  assert.deepEqual(links(real).slice(1).map(([label, href]) => [label, href.split('=')[0]]), [['Open in WhatsApp', 'https://wa.me/41791234567?text'], ['Open as SMS', 'sms:+41791234567?&body']]);
  // No number anywhere: the card says so instead of showing an empty link.
  const noPhone = entry(home({ requests: [haircut], customers: [], availabilityContext: context({ requests: [haircut], events: [accepted, ...demoEvents] }), answers: [answered({ ...wash, customerPhone: undefined }, 'accepted')] }), 'Petra Meier');
  assert.match(words(noPhone), /No phone number is on record for Petra Meier\./);
  assert.doesNotMatch(noPhone, /href="tel:/);
  // The text can still be taken to a messenger, where the owner looks the customer up herself.
  assert.deepEqual(links(noPhone).map(([label, href]) => [label, href.split('=')[0]]), [['Open in WhatsApp', 'https://wa.me/?text'], ['Open as SMS', 'sms:?&body']]);
});

test('a declined request and one with another time suggested say the same, each with its own text and its own way back', () => {
  const rejected = entry(home({ requests: [haircut], availabilityContext: context({ requests: [haircut] }), answers: [answered(wash, 'rejected')] }), 'Petra Meier');
  assert.match(words(rejected), /^Declined Petra Meier Wash & blow-dry · Wed, 07\.10\.2026, 10:00–10:30 · with Selina Keller SlotBee does not tell Petra Meier\. Call or write to pass it on\./);
  assert.match(words(rejected), /Leider können wir Ihnen Wash & blow-dry am Mittwoch, 07\.10\.2026 um 10:00 Uhr nicht anbieten\./);
  assert.deepEqual(buttons(rejected), ['Petra Meier', 'Copy text', 'Undo', 'Done']);
  assert.doesNotMatch(words(rejected), CLAIMS_CONTACT);

  // Friday at 10:00 suggested instead: the request still waits, with its answers, and the note says what to ask the customer.
  const later = movedRequest(wash, '2026-10-09', '10:00');
  const moved = entry(home({ requests: [later, haircut], availabilityContext: context({ requests: [later, haircut] }), answers: [answered(wash, 'moved')] }), 'Petra Meier');
  assert.match(words(moved), /FRI 09\.10\. Petra Meier 12 min Waiting for 12 minutes Wash & blow-dry · 10:00–10:30 · with Selina Keller Booking request · /);
  assert.match(words(moved), /Other time suggested, instead of Wed, 07\.10\.2026, 10:00–10:30 SlotBee does not tell Petra Meier\. Call or write to ask whether the new time suits\./);
  assert.match(words(moved), /Leider ist der Termin am Mittwoch, 07\.10\.2026 um 10:00 Uhr nicht möglich\. Wir können Ihnen Wash & blow-dry am Freitag, 09\.10\.2026 um 10:00 Uhr mit Selina Keller anbieten\. Passt Ihnen das\?/);
  assert.deepEqual(buttons(moved), ['Petra Meier', 'Copy text', 'Undo', 'Done', 'Confirm', 'Suggest another time', 'Decline']);
  // The time that is suggested can be confirmed like any other, and the owner still tells the customer herself.
  assert.match(words(moved), /Confirm adds it to your calendar\. You tell Petra Meier yourself\. Confirm Suggest another time Decline$/);
  assert.doesNotMatch(words(moved), CLAIMS_CONTACT);
  // Without a way to take an answer back or to put it away, those buttons are not drawn.
  const bare = entry(home({ requests: [haircut], availabilityContext: context({ requests: [haircut] }), answers: [answered(wash, 'rejected')], onUndoAnswer: undefined, onDismissAnswer: undefined }), 'Petra Meier');
  assert.deepEqual(buttons(bare), ['Petra Meier', 'Copy text']);
});

test('an answered chat request says what was done and what the customer got, and only what is true of it', () => {
  const card = (answer: RequestAnswer, conversations: Conversation[] = [tomsRequest]) => entry(home({ conversations, answers: [answer] }), 'Tom');
  const done = card(chatAnswer('done'));
  assert.match(words(done), /^Confirmed Tom Haircut · Thu, 08\.10\.2026, 15:00–15:30 · with Anna Weber The appointment is in your calendar\. Tom has the confirmation in the chat\./);
  assert.deepEqual(buttons(done), ['Open chat', 'Done']);
  // An answer stored by an earlier build, while its confirmation was on its way or had failed.
  assert.match(words(card(chatAnswer('pending'))), /The confirmation is on its way into the chat…/);
  const failed = card(chatAnswer('failed', 'The confirmation could not be sent. Try again.'));
  assert.match(words(failed), /The appointment is in your calendar, but the confirmation did not get into the chat\. The confirmation could not be sent\. Try again\. You can also open the chat and write to Tom yourself\. Try again Open chat Done$/);
  // The customer deleted the chat meanwhile: there is nothing to open or to try again.
  assert.deepEqual(buttons(card(chatAnswer('failed', 'This chat was deleted by the customer.'), [])), ['Done']);
  // The other answers, each in its own words.
  const other = (outcome: 'suggested' | 'declined' | 'cancelled' | 'kept', partial: Partial<Extract<RequestAnswer, { kind: 'chat' }>> = {}) =>
    words(card({ ...chatAnswer('done'), outcome, appointmentId: '', asked: { date: '2026-10-08', time: '15:00' }, ...partial } as RequestAnswer));
  assert.match(other('suggested', { date: '2026-10-09', startTime: '10:00', endTime: '10:30' }), /^Other time suggested Tom Haircut · Fri, 09\.10\.2026, 10:00–10:30 · with Anna Weber Tom has the suggestion in the chat\. When Tom takes it up, it comes back here as a request\./);
  assert.match(other('declined', { staffName: '' }), /^Declined Tom Haircut · Thu, 08\.10\.2026, 15:00–15:30 Tom has the answer in the chat\. Open chat Done$/);
  assert.match(other('cancelled'), /The appointment has left your calendar\. Tom has the cancellation in the chat\./);
  assert.match(other('kept'), /^Appointment kept .* Nothing was sent to Tom\. Write to them in the chat yourself\./);
  // One of the salon's own chats: the answer is in the chat, and nothing claims a message was sent.
  assert.match(other('declined', { live: false }), /The answer is in the chat\./);
  // What is in the chat cannot be taken back from here: no "Undo".
  for (const html of [done, failed]) assert.doesNotMatch(words(html), /undo/i);
  // With the appointment in the calendar, the card leads to it.
  const booked = { ...demoEvents[0], id: 'live-appt-live-web-tom-2026-10-08-1500', conversationId: tomsRequest.id };
  assert.deepEqual(buttons(entry(home({ conversations: [tomsRequest], availabilityContext: context({ events: [booked, ...demoEvents] }), answers: [chatAnswer('done')] }), 'Tom')), ['Open chat', 'View appointment', 'Done']);
  // Given to another customer since (the form takes the chat off it then), it is no longer offered from Tom's card.
  const givenAway = { ...booked, conversationId: undefined, customerId: 'cust-001', customerName: 'Petra Meier' };
  assert.deepEqual(buttons(entry(home({ conversations: [tomsRequest], availabilityContext: context({ events: [givenAway, ...demoEvents] }), answers: [chatAnswer('done')] }), 'Tom')), ['Open chat', 'Done']);
  // A new request in the same chat (the customer took up the suggestion) is listed as itself, not hidden behind the answer.
  const suggested = { ...chatAnswer('done'), outcome: 'suggested', date: '2026-10-09', startTime: '10:00', endTime: '10:30', asked: { date: '2026-10-08', time: '15:00' } } as RequestAnswer;
  const takenUp = { ...tomsRequest, bookingRequest: { ...tomsRequest.bookingRequest!, date: '2026-10-09', time: '10:00' } };
  assert.deepEqual(items({ conversations: [takenUp], requests: [], answers: [suggested] }).map((item) => item.kind), ['chat-request']);
});

test('a confirmed request follows its appointment: a change in the calendar changes the text and takes Undo away', () => {
  // The owner confirmed Petra's wash for 10:00 and then moved the appointment to 14:00 in the calendar.
  const moved = { ...accepted, startTime: '14:00', endTime: '14:30' };
  assert.equal(acceptedAppointmentState(wash, accepted), 'same');
  assert.equal(acceptedAppointmentState(wash, moved), 'changed');
  assert.equal(acceptedAppointmentState(wash, { ...accepted, date: '2026-10-08' }), 'changed');
  assert.equal(acceptedAppointmentState(wash, undefined), 'gone');

  const changed = entry(home({ requests: [haircut], availabilityContext: context({ requests: [haircut], events: [moved, ...demoEvents] }), answers: [answered(wash, 'accepted')] }), 'Petra Meier');
  const text = words(changed);
  // The card shows the appointment as it stands, and the text to pass on gives the new time, not the one asked for.
  assert.match(text, /Confirmed Petra Meier Wash & blow-dry · Wed, 07\.10\.2026, 14:00–14:30/);
  assert.match(text, /The appointment was changed in the calendar after you confirmed\. The text below gives it as it stands now\./);
  assert.match(text, /um 14:00 Uhr/);
  assert.doesNotMatch(text, /um 10:00 Uhr/);
  // Undo would throw the change away, so it is not offered; the appointment itself is one tap away.
  assert.deepEqual(buttons(changed), ['Petra Meier', 'Copy text', 'View appointment', 'Done']);

  // Cancelled in the calendar: the answer has nothing left to show or to take back, so it leaves the list.
  const cancelled = home({ requests: [haircut], availabilityContext: context({ requests: [haircut], events: demoEvents }), answers: [answered(wash, 'accepted')] });
  assert.doesNotMatch(cancelled.slice(cancelled.indexOf('home-inbox-title')).split('home-ai-title')[0], />Petra Meier</);
});

// ---------- one number, and how long somebody has waited ----------

test('the heading counts everything that waits and says what the number is made of', () => {
  const heading = (html: string) => words(/<h2 id="home-inbox-title"[^>]*>.*?<\/div>/.exec(html)?.[0] ?? '');
  // Five requests (two from the booking page, three in chats) and Chloé's question.
  assert.equal(heading(home()), 'Waiting for you 6 entries 5 requests · 1 chat');
  assert.equal(heading(home({ requests: [wash], availabilityContext: context({ requests: [wash] }), conversations: [lena] })), 'Waiting for you 2 entries 1 request · 1 chat');
  // One kind alone is said by the entries themselves: the number stands without a breakdown.
  assert.equal(heading(home({ conversations: [] })), 'Waiting for you 2 entries');
  assert.equal(heading(home({ requests: [], availabilityContext: context({ requests: [] }), conversations: [lena] })), 'Waiting for you 1 entry');
  assert.equal(heading(home({ requests: [], availabilityContext: context({ requests: [] }), conversations: [] })), 'Waiting for you');
});

test('a wait stands out once it is long: in a chat after a quarter of an hour, on a request from the booking page after two hours', () => {
  /** The label of an entry's wait: what it says, and whether it is drawn calm, amber or red. */
  const wait = (html: string, name: string) => {
    const label = /<span class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0\.5 text-xs font-semibold tabular-nums ([^"]*)">.*?<span aria-hidden="true">([^<]*)<\/span><span class="sr-only">([^<]*)<\/span>/.exec(entry(html, name));
    assert.ok(label, `${name} shows how long the entry has waited`);
    return { look: /bg-rose-100/.test(label[1]) ? 'red' : /bg-amber-100/.test(label[1]) ? 'amber' : 'calm', label: label[2], words: label[3] };
  };
  const minutesAgo = (minutes: number) => new Date(FIXED_NOW.getTime() - minutes * 60_000).toISOString();
  const chatting = (minutes: number) => home({ requests: [], availabilityContext: context({ requests: [] }), conversations: [{ ...lena, lastMessageAt: minutesAgo(minutes) }] });
  // Somebody in a chat is waiting right now.
  assert.deepEqual(wait(chatting(6), 'Lena'), { look: 'calm', label: '6 min', words: 'Waiting for 6 minutes' });
  assert.deepEqual(wait(chatting(15), 'Lena'), { look: 'amber', label: '15 min', words: 'Waiting for 15 minutes, a long wait' });
  assert.deepEqual(wait(chatting(60), 'Lena'), { look: 'red', label: '1 h', words: 'Waiting for 1 hour, overdue' });
  // A request the AI took in a chat: the customer is in the conversation too, so the same limits apply.
  const requested = (minutes: number) => home({ requests: [], availabilityContext: context({ requests: [] }), conversations: [{ ...tomsRequest, lastMessageAt: minutesAgo(minutes) }] });
  assert.equal(wait(requested(14), 'Tom').look, 'calm');
  assert.equal(wait(requested(45), 'Tom').look, 'amber');
  assert.equal(wait(requested(200), 'Tom').look, 'red');
  // A request from the booking page was sent and left: it is answered within hours.
  const sent = (minutes: number) => { const request = { ...wash, createdAt: minutesAgo(minutes) }; return home({ requests: [request], availabilityContext: context({ requests: [request] }), conversations: [] }); };
  assert.deepEqual(wait(sent(47), 'Petra Meier'), { look: 'calm', label: '47 min', words: 'Waiting for 47 minutes' });
  assert.deepEqual(wait(sent(180), 'Petra Meier'), { look: 'amber', label: '3 h', words: 'Waiting for 3 hours, a long wait' });
  assert.deepEqual(wait(sent(3 * 24 * 60), 'Petra Meier'), { look: 'red', label: '3 days', words: 'Waiting for 3 days, overdue' });
  // The colour is never the only sign: the label always says how long.
  for (const html of [chatting(6), chatting(60), sent(180)]) assert.match(html, /<span aria-hidden="true">\d+ (min|h)<\/span>/);
  // An entry stored without the moment it came in keeps the words it was stored with, without a colour.
  const old = { ...wash, createdAt: undefined, timeAgo: '10 minutes ago' };
  const undated = entry(home({ requests: [old], availabilityContext: context({ requests: [old] }), conversations: [] }), 'Petra Meier');
  assert.match(words(undated), /Petra Meier 10 minutes ago Wash & blow-dry · /);
  assert.doesNotMatch(undated, /Waiting for|bg-amber-100|bg-rose-100/);
});

test('the language of a chat wears one quiet chip, whatever the language', () => {
  const chatIn = (language: 'EN' | 'FR' | 'DE' | 'IT') => entry(home({ requests: [], availabilityContext: context({ requests: [] }), conversations: [{ ...lena, live: false, languageLabel: undefined, language }] }), 'Lena');
  const chips = (['EN', 'FR', 'DE', 'IT'] as const).map((language) => /<span class="([^"]*)">(?:EN|FR|DE|IT)<\/span>/.exec(chatIn(language))?.[1]);
  assert.equal(new Set(chips).size, 1);
  assert.match(chips[0] ?? '', /bg-slate-100 text-slate-700/);
  // No language looks like a warning beside the red count.
  for (const language of ['EN', 'FR', 'DE', 'IT'] as const) assert.doesNotMatch(chatIn(language), /bg-rose-100 text-rose-700|bg-amber-100 text-amber-700|bg-violet-100|bg-emerald-100 text-emerald-700/);
});

test('an inbox with nothing in it says so as good news, with what the AI dealt with by itself', () => {
  const calm = (conversations: Conversation[]) => {
    const html = home({ requests: [], availabilityContext: context({ requests: [] }), conversations });
    return words(html.slice(html.indexOf('home-inbox-title'), html.indexOf('home-ai-title')).replace(/^[^>]*>/, ''));
  };
  const handled = (id: string) => liveChat(id, { status: 'ai-handled' });
  assert.match(calm([handled('a'), handled('b')]), /^Waiting for you Nothing is waiting for you\. The AI receptionist handled 2 chats on its own\. New booking requests and chats that need you appear here\./);
  assert.match(calm([handled('a')]), /The AI receptionist handled one chat on its own\./);
  // Chats that ended in a booking or that the owner answered herself are not what the AI did alone.
  assert.doesNotMatch(calm([liveChat('c', { status: 'booked' }), liveChat('d', { status: 'owner-handled' })]), /AI receptionist handled/);
  assert.doesNotMatch(calm([handled('a')]), TELL_WORDS);
});
