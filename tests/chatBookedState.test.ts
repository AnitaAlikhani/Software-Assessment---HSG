import assert from 'node:assert/strict';
import test from 'node:test';
import type { AvailabilityContext } from '../src/availability';
import { appointmentForConversation } from '../src/appointmentActions';
import { chatBookingOriginLabel, confirmedButMissing, conversationsInFilter, shownStatus } from '../src/conversationPresentation';
import { createDemoWorkspace } from '../src/demoWorkspace';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { chatOfFormBooking, planChatBooking, planChatCancellation, restoreConfirmedBooking } from '../src/requestAnswers';
import { sampleChatAfter, sampleChatAfterAi, sampleChatAfterOwnerReply } from '../src/sampleChatFlow';
import { demoConversations, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';

// When a chat counts as booked, what the owner is told about a confirmation the calendar lost,
// the link of an appointment booked by hand from a chat, and the salon's own chats on many days.
// Fixed moments only: Monday 5 October 2026, 12:00 in Zurich (tests/fixedClock.ts) and the list below.

const ZONE = 'Europe/Zurich';
const chat = (id: string) => demoConversations.find((conversation) => conversation.id === id)!;
const salon = (partial: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
  events: demoEvents, requests: demoRequests, timeZone: ZONE, now: FIXED_NOW, ...partial,
});
const withoutMarie = demoEvents.filter((event) => event.id !== 'cal-2');

test('"Booked" counts a chat only while its appointment is in the calendar', () => {
  const marie = chat('conv-marie');
  assert.equal(shownStatus(marie, demoEvents), 'booked');
  // Cancelled in the calendar: the chat shows "You handled" and leaves the "Booked" filter.
  assert.equal(shownStatus(marie, withoutMarie), 'owner-handled');
  assert.ok(conversationsInFilter(demoConversations, 'booked', demoEvents).some((item) => item.id === 'conv-marie'));
  assert.ok(!conversationsInFilter(demoConversations, 'booked', withoutMarie).some((item) => item.id === 'conv-marie'));
  // Without the calendar the chat's own record counts, as before.
  assert.equal(shownStatus(marie), 'booked');
  assert.ok(conversationsInFilter(demoConversations, 'booked').some((item) => item.id === 'conv-marie'));
  // A chat that waits keeps its status; Giulia's chat holds an appointment and is under "Booked".
  assert.equal(shownStatus(chat('conv-reto'), withoutMarie), 'needs-attention');
  assert.deepEqual(conversationsInFilter(demoConversations, 'booked', demoEvents).map((item) => item.id).sort(), ['conv-giulia', 'conv-john', 'conv-lara', 'conv-marie']);
});

test('a confirmation the calendar lost is said while its time is ahead, and only then', () => {
  const marie = chat('conv-marie');
  assert.equal(confirmedButMissing(marie, demoEvents, FIXED_NOW, ZONE), null);
  const missing = confirmedButMissing(marie, withoutMarie, FIXED_NOW, ZONE);
  assert.deepEqual([missing?.date, missing?.time, missing?.service], ['2026-10-08', '13:30', 'Haircut']);
  // The confirmed time has passed: nothing to say.
  assert.equal(confirmedButMissing(marie, withoutMarie, new Date('2026-10-08T11:31:00Z'), ZONE), null);
  assert.notEqual(confirmedButMissing(marie, withoutMarie, new Date('2026-10-08T11:29:00Z'), ZONE), null);
  // A request that waits is the card's business, not this line's.
  assert.equal(confirmedButMissing(chat('conv-reto'), [], FIXED_NOW, ZONE), null);
});

test('"Add to calendar" books the confirmed time again with its stylist, or says why it cannot', () => {
  const marie = chat('conv-marie');
  const planned = restoreConfirmedBooking(salon({ events: withoutMarie }), marie);
  assert.ok('action' in planned);
  assert.deepEqual(planned.action, { type: 'book', appointmentId: 'live-appt-conv-marie-2026-10-08-1330', date: '2026-10-08', startTime: '13:30', serviceId: 'srv-2', employeeId: 'emp-1' });
  // Somebody has Anna at that time now: the reason, without the card's advice to suggest or decline.
  const taken = { ...demoEvents.find((event) => event.id === 'cal-2')!, id: 'cal-other', customerName: 'Sandra Keller', customerId: 'cust-x', conversationId: undefined };
  const refused = restoreConfirmedBooking(salon({ events: [...withoutMarie, taken] }), marie);
  assert.ok('error' in refused);
  assert.match(refused.error, /Anna Weber/);
  assert.doesNotMatch(refused.error, /suggest|decline/i);
  // Still in the calendar: nothing to add.
  assert.ok('error' in restoreConfirmedBooking(salon(), marie));
  assert.ok('error' in restoreConfirmedBooking(salon(), chat('conv-reto')));
});

test('an appointment saved from the form that a chat opened belongs to that chat, for its customer only', () => {
  const link = { opening: 3, conversationId: 'conv-reto', customerId: 'cust-reto' };
  const save = { appointmentId: null, customer: { id: 'cust-reto' } };
  assert.equal(chatOfFormBooking(link, 3, save), 'conv-reto');
  // Another customer chosen in the form, another opening of the form, or a change of an appointment: no link.
  assert.equal(chatOfFormBooking(link, 3, { ...save, customer: { id: 'cust-001' } }), undefined);
  assert.equal(chatOfFormBooking(link, 3, { ...save, customer: null }), undefined);
  assert.equal(chatOfFormBooking(link, 4, save), undefined);
  assert.equal(chatOfFormBooking(link, 3, { ...save, appointmentId: 'cal-1' }), undefined);
  assert.equal(chatOfFormBooking(null, 3, save), undefined);
  // So linked, the chat's waiting request sees it, and Confirm books nothing more.
  const reto = chat('conv-reto');
  const byHand = { ...demoEvents[0], id: 'cal-by-hand', customerId: 'cust-reto', customerName: 'Reto Hollenstein', employeeId: 'emp-3', staffName: 'Luca Frei',
    serviceId: 'srv-5', date: reto.bookingRequest!.date, startTime: '09:00', endTime: '09:30', conversationId: chatOfFormBooking(link, 3, save) };
  const plan = planChatBooking(salon({ events: [...demoEvents, byHand] }), reto)!;
  assert.equal(plan.held?.id, 'cal-by-hand');
  assert.equal(plan.action, null);
});

// A short version of the review's sweep: the salon as it starts, at moments spread over weeks,
// including the turn of the year, a leap day, both clock changes and the closed days.
const MOMENTS = [
  '2026-10-05T10:00:00Z', '2026-10-24T23:30:00Z', '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '2026-10-25T02:30:00Z',
  '2026-11-21T06:00:00Z', '2026-11-22T22:30:00Z', '2026-11-23T08:00:00Z', '2026-11-24T05:10:00Z', '2026-11-25T14:10:00Z',
  '2026-11-26T23:30:00Z', '2026-11-27T17:40:00Z', '2026-11-28T08:20:00Z', '2026-11-28T15:59:00Z', '2026-11-29T12:00:00Z',
  '2026-12-04T11:00:00Z', '2026-12-12T20:00:00Z', '2026-12-24T09:00:00Z', '2026-12-31T22:59:00Z', '2026-12-31T23:01:00Z',
  '2027-01-01T08:00:00Z', '2027-01-15T16:30:00Z', '2027-02-02T07:00:00Z', '2027-03-28T00:30:00Z', '2027-03-28T01:30:00Z',
  '2027-03-28T05:00:00Z', '2027-06-18T15:00:00Z', '2027-10-31T00:59:00Z', '2027-10-31T01:01:00Z', '2028-02-28T22:30:00Z',
  '2028-02-29T09:00:00Z', '2028-02-29T21:00:00Z',
];

test('the salon\'s own chats work on every day: requests can be confirmed, offered times lead on, bookings match the calendar', () => {
  for (const at of MOMENTS) {
    const now = new Date(at);
    const later = new Date(now.getTime() + 5 * 60_000);
    const workspace = createDemoWorkspace(ZONE, now);
    const context = salon({ events: workspace.events, requests: workspace.requests, shiftOverview: workspace.shifts, now: later });
    const find = (id: string) => workspace.conversations.find((item) => item.id === id)!;
    for (const [id, asked] of [['conv-sabrina', undefined], ['conv-reto', 'emp-3'], ['conv-giulia', 'emp-2']] as const) {
      const plan = planChatBooking(context, find(id));
      assert.ok(plan?.action, `${at} ${id}: ${plan?.refusal}`);
      if (asked) assert.equal(plan.employee?.id, asked, `${at} ${id}`);
    }
    // Chloé: both suggested replies and the AI's answer lead to a request that can be confirmed.
    const chloe = find('conv-chloe');
    for (const reply of chloe.quickReplies!) {
      const after = sampleChatAfterOwnerReply(chloe, { english: reply.en, local: reply.local }, undefined, later, ZONE, 'Bella Hair Salon');
      assert.ok(planChatBooking(context, after)?.action, `${at} chloe reply`);
    }
    assert.ok(planChatBooking(context, sampleChatAfterAi(chloe, later, ZONE))?.action, `${at} chloe AI`);
    // Sabrina confirmed on the card keeps her question open and still holds her appointment's id.
    const sabrina = sampleChatAfter(find('conv-sabrina'), { type: 'confirm' }, later, ZONE, 'Bella Hair Salon');
    assert.equal(sabrina.status, 'needs-attention', at);
    // Every booked chat has its appointment, on the day and time the chat's request names.
    for (const id of ['conv-marie', 'conv-lara', 'conv-john']) {
      const booked = find(id);
      const event = workspace.events.find((item) => item.id === booked.appointmentId);
      assert.deepEqual([event?.date, event?.startTime, event?.employeeId], [booked.bookingRequest!.date, booked.bookingRequest!.time, booked.bookingRequest!.employeeId], `${at} ${id}`);
      assert.equal(shownStatus(booked, workspace.events), 'booked', `${at} ${id}`);
    }
    // No stylist has two appointments at once.
    const byDay = new Map<string, typeof workspace.events>();
    for (const event of workspace.events) byDay.set(`${event.employeeId}|${event.date}`, [...(byDay.get(`${event.employeeId}|${event.date}`) ?? []), event]);
    for (const [key, list] of byDay) {
      const sorted = [...list].sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let index = 1; index < sorted.length; index++) assert.ok(sorted[index].startTime >= sorted[index - 1].endTime, `${at} ${key}`);
    }
  }
});

// ---------- an appointment booked by hand from a chat is not the chat's confirmed appointment ----------

const LIVE = 'live-web-eva';
/** A live chat after the server confirmed a haircut on Tuesday 6 October at 10:00 with Anna. */
const eva = {
  ...chat('conv-john'), id: LIVE, live: true, customerId: undefined, appointmentId: undefined, customerName: 'Eva', status: 'booked' as const,
  bookingRequest: { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-06', time: '10:00', customerName: 'Eva', status: 'confirmed' as const, kind: 'new' as const, employeeId: 'emp-1', staffName: 'Anna Weber' },
};
const evaConfirmed = { ...demoEvents[0], id: `live-appt-${LIVE}-2026-10-06-1000`, conversationId: LIVE, customerId: undefined, customerName: 'Eva', serviceId: 'srv-2', serviceName: 'Haircut',
  employeeId: 'emp-1', staffName: 'Anna Weber', date: '2026-10-06', startTime: '10:00', endTime: '10:30', isAiBooked: true };
/** Booked by hand with "Book" in Eva's chat later: a colouring on Friday. */
const evaByHand = { ...evaConfirmed, id: 'cal-hand', serviceId: 'srv-3', serviceName: 'Colouring', employeeId: 'emp-2', staffName: 'Selina Keller', date: '2026-10-09', startTime: '15:00', endTime: '16:30', isAiBooked: false };

test('1a the confirmed appointment cancelled in the calendar: another one booked by hand does not stand in for it', () => {
  // Marie: a Friday booked by hand from her chat, then her confirmed Thursday is cancelled.
  const marie = chat('conv-marie');
  const friday = { ...demoEvents.find((event) => event.id === 'cal-2')!, id: 'cal-friday', date: '2026-10-09', startTime: '14:00', endTime: '14:30' };
  assert.equal(appointmentForConversation(marie, [friday, ...demoEvents])?.id, 'cal-2');
  const afterCancel = [friday, ...withoutMarie];
  assert.equal(appointmentForConversation(marie, afterCancel), null);
  assert.notEqual(confirmedButMissing(marie, afterCancel, FIXED_NOW, ZONE), null);
  assert.equal(shownStatus(marie, afterCancel), 'owner-handled');
  // The same for a live chat, which names no appointment.
  assert.notEqual(confirmedButMissing(eva, [evaByHand, ...demoEvents], FIXED_NOW, ZONE), null);
});

test('1b while both are in the calendar, the chat\'s appointment is the confirmed one; moved, it is still that one, and nothing is added again', () => {
  assert.equal(appointmentForConversation(eva, [evaByHand, evaConfirmed, ...demoEvents])?.id, evaConfirmed.id);
  const moved = { ...evaConfirmed, date: '2026-10-07', startTime: '11:00', endTime: '11:30' };
  assert.equal(appointmentForConversation(eva, [evaByHand, moved, ...demoEvents])?.id, evaConfirmed.id);
  assert.equal(confirmedButMissing(eva, [evaByHand, moved, ...demoEvents], FIXED_NOW, ZONE), null);
  assert.ok('error' in restoreConfirmedBooking(salon({ events: [evaByHand, moved, ...demoEvents] }), eva));
  // A cancellation of the confirmed time is about that appointment, not the one booked by hand.
  const cancelling = { ...eva, cancellationRequest: { service: 'Haircut', date: '2026-10-06', time: '10:00' } } as typeof eva;
  assert.equal(planChatCancellation(salon({ events: [evaByHand, moved, ...demoEvents] }), cancelling)?.appointment?.id, evaConfirmed.id);
  // A chat without a confirmed request still leads to its newest appointment.
  const { bookingRequest: _none, ...noRequest } = eva;
  assert.equal(appointmentForConversation(noRequest, [evaByHand, evaConfirmed])?.id, 'cal-hand');
});

test('1c an appointment booked by hand from a chat says "Booked by you", never "Confirmed by you"', () => {
  const waiting = { ...eva, bookingRequest: { ...eva.bookingRequest, status: 'requested' as const } };
  assert.equal(chatBookingOriginLabel(waiting, evaByHand), 'Booked by you');
  assert.equal(chatBookingOriginLabel(eva, evaByHand), 'Booked by you');
  // What Confirm made, what the chat names, and what the AI booked keep their words.
  assert.equal(chatBookingOriginLabel(eva, evaConfirmed), 'Booked by the AI · confirmed by you');
  assert.equal(chatBookingOriginLabel({ ...eva, appointmentId: 'cal-hand' }, evaByHand), 'Confirmed by you');
  assert.equal(chatBookingOriginLabel(chat('conv-marie'), demoEvents.find((event) => event.id === 'cal-2')), 'Booked by the AI · confirmed by you');
});

test('2 only an appointment for the service asked for holds the request', () => {
  const reto = chat('conv-reto');
  const at = { ...demoEvents[0], id: 'cal-by-hand', customerId: 'cust-reto', customerName: 'Reto Hollenstein', employeeId: 'emp-3', staffName: 'Luca Frei',
    date: reto.bookingRequest!.date, startTime: '09:00', endTime: '09:30', conversationId: 'conv-reto' };
  const haircut = planChatBooking(salon({ events: [...demoEvents, { ...at, serviceId: 'srv-2', serviceName: 'Haircut' }] }), reto)!;
  assert.equal(haircut.held, null);
  // The card says as usual that Luca is not free then.
  assert.match(haircut.refusal ?? '', /Luca Frei already has Reto Hollenstein/);
  assert.equal(planChatBooking(salon({ events: [...demoEvents, { ...at, serviceId: 'srv-5', serviceName: "Men's cut" }] }), reto)!.held?.id, 'cal-by-hand');
  // A request that names its service by name only is matched by name.
  const byName = { ...reto, bookingRequest: { ...reto.bookingRequest!, serviceId: undefined } };
  assert.equal(planChatBooking(salon({ events: [...demoEvents, { ...at, serviceId: 'srv-5', serviceName: "Men's cut" }] }), byName)!.held?.id, 'cal-by-hand');
  assert.equal(planChatBooking(salon({ events: [...demoEvents, { ...at, serviceId: 'srv-2', serviceName: 'Haircut' }] }), byName)!.held, null);
});

test('3 Decline and Suggest leave the customer\'s open question open, with answers that do not book', () => {
  const sabrina = chat('conv-sabrina');
  const request = sabrina.bookingRequest!;
  for (const action of [{ type: 'decline' as const }, { type: 'suggest' as const, date: request.date, time: '14:00', employeeId: 'emp-1', staffName: 'Anna Weber' }]) {
    const after = sampleChatAfter(sabrina, action, FIXED_NOW, ZONE, 'Bella Hair Salon');
    assert.equal(after.status, 'needs-attention', action.type);
    assert.equal(after.attentionReason, sabrina.attentionReason, action.type);
    assert.ok(after.aiFollowUp, action.type);
    assert.equal(after.quickReplies?.length, 2, action.type);
    for (const reply of after.quickReplies!) assert.equal(reply.appointmentAction, undefined, action.type);
    // Answered by the AI: nothing of the question waits any more.
    const answered = sampleChatAfterAi(after, FIXED_NOW, ZONE);
    assert.equal(answered.attentionReason === sabrina.attentionReason, false, action.type);
  }
});
