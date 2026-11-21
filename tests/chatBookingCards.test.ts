import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { appointmentFromConversationAction, upsertAppointment } from '../src/appointmentActions';
import { validateCalendarEvent, type AvailabilityContext } from '../src/availability';
import type { ChatBookingAction } from '../src/chatBookingActions';
import { answerChatBooking, chatCustomer, chatCustomerRecord, type ChatBookingDeps, type ChatBookingServer } from '../src/chatBookingAnswers';
import { ChatAppointment, ChatBookedCard, ChatCancellationCard, ChatRequestCard, ChatWaitingCards, chatAwaitsAnswer } from '../src/components/ChatBookingCards';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { chatTimeOptionsOn, nearestChatTimes, planChatBooking, planChatCancellation } from '../src/requestAnswers';
import type { AppointmentAction, CalendarEvent, Conversation } from '../src/types';
import { demoCustomers, demoEvents, demoShifts, FIXED_NOW } from './fixedClock';
import { render, TELL_WORDS } from './renderHelpers';

// The cards an open chat shows about a booking, and the one way the owner's answers are carried
// out. The moment is fixed: Monday 5 October 2026, 12:00 in Zurich. Tom asks in the website chat
// for a haircut (30 minutes) on Thursday 8 October at 15:00. On Thursdays Anna Weber works 10:00
// to 18:30 and Selina Keller 08:30 to 17:00; Luca Frei does not work on Thursdays.

const salon = (partial: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
  events: [], requests: [], now: FIXED_NOW, timeZone: 'Europe/Zurich', ...partial,
});
const appointment = (id: string, employeeId: string, date: string, startTime: string, endTime: string, partial: Partial<CalendarEvent> = {}): CalendarEvent => ({
  ...demoEvents[0], id, employeeId, staffName: initialEmployees.find((employee) => employee.id === employeeId)!.name,
  serviceId: 'srv-2', serviceName: 'Haircut', customerId: `cust-${id}`, customerName: 'Sandra Keller', date, startTime, endTime,
  prepMinutes: 0, postMinutes: 0, isAiBooked: false, conversationId: undefined, ...partial,
});
type Booking = NonNullable<Conversation['bookingRequest']>;
const tom = (booking: Partial<Booking> | null = {}, partial: Partial<Conversation> = {}): Conversation => ({
  id: 'live-web-tom', live: true, customerName: 'Tom', initials: 'T', avatarColor: 'bg-green-100 text-green-700', language: 'EN',
  phone: '', channel: 'Website', status: 'needs-attention', lastTime: '11:59', lastMessageAt: '2026-10-05T09:59:00Z', messages: [],
  ...(booking ? { bookingRequest: { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-08', time: '15:00', customerName: 'Tom', status: 'requested' as const, ...booking } } : {}),
  ...partial,
});
/** Tom's haircut that was booked in the chat on Wednesday 7 October at 10:00 with Anna, for a change or a cancellation. */
const tomsAppointment = appointment('live-appt-live-web-tom-2026-10-07-1000', 'emp-1', '2026-10-07', '10:00', '10:30', { customerName: 'Tom', conversationId: 'live-web-tom', customerId: 'cust-tom' });
const annaBusy = appointment('cal-a', 'emp-1', '2026-10-08', '14:30', '15:30');
const selinaBusy = appointment('cal-s', 'emp-2', '2026-10-08', '15:00', '15:30');

const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const buttons = (html: string) => Array.from(html.matchAll(/<button[^>]*>(.*?)<\/button>/g), (match) => match[1].replace(/<[^>]+>/g, '').trim());
const answer = async () => null;
const requestCard = (conversation: Conversation, context = salon()) => render(React.createElement(ChatRequestCard, { conversation, salon: context, onAnswer: answer }));

// ---------- what the request card checks and offers ----------

test('a free time: the card names who takes it, what was checked, and offers all three answers', () => {
  const plan = planChatBooking(salon(), tom())!;
  assert.equal(plan.employee?.name, 'Anna Weber');
  assert.deepEqual(plan.freeEmployees.map((employee) => employee.id), ['emp-1', 'emp-2']);
  const html = requestCard(tom());
  assert.match(words(html), /^Tom wants to book Haircut Thu, 08\.10\.2026 · 15:00–15:30 · for Tom Anna Weber is free then\. Checked against the opening hours, the working hours, time off and your calendar\. Stylist who is free then Anna Weber Selina Keller Confirm adds it to your calendar and sends Tom the confirmation in the chat\. Confirm Suggest another time Decline$/);
  assert.deepEqual(buttons(html), ['Confirm', 'Suggest another time', 'Decline']);
  // The old promise is gone: nothing says it was checked against the opening hours alone.
  assert.doesNotMatch(html, /Checked against opening hours/);
  // Every control is a full tap target, and the stylist list has phone-sized text.
  for (const button of html.match(/<button[^>]*>/g)!) assert.match(button, /\bmin-h-11\b/);
  assert.match(html, /<select[^>]*class="[^"]*\btext-base\b/);
  assert.doesNotMatch(words(html), TELL_WORDS);
  // One of the salon's own chats: nothing claims that a message is sent.
  assert.match(words(requestCard(tom({}, { id: 'conv-tom', live: undefined })) ), /Confirm adds it to your calendar\. Confirm/);
});

test('a taken time: the card says who has it, offers no Confirm, and the nearest free times instead', () => {
  const context = salon({ events: [annaBusy, selinaBusy] });
  const plan = planChatBooking(context, tom())!;
  assert.equal(plan.employee, null);
  assert.equal(plan.action, null);
  const html = requestCard(tom(), context);
  assert.match(words(html), /Nobody who offers Haircut is free on Thu, 08\.10\.2026 at 15:00–15:30\. Suggest another time, or decline\. Suggest another time Decline$/);
  assert.deepEqual(buttons(html), ['Suggest another time', 'Decline']);
  // The nearest free times: on Thursday around 15:00 first, in the order of the day, each with who would take it.
  const nearest = nearestChatTimes(context, tom());
  assert.equal(nearest.length, 4);
  assert.ok(nearest.every((option) => option.date === '2026-10-08'));
  assert.deepEqual(nearest.map((option) => option.time), ['14:00', '14:30', '15:30', '16:00']);
  assert.deepEqual(nearest.map((option) => option.employee.id), ['emp-1', 'emp-2', 'emp-1', 'emp-1']);
  // Another day: every free time of that day; never the time asked for, never one that has passed.
  assert.ok(chatTimeOptionsOn(context, tom(), '2026-10-09').length > 4);
  assert.ok(!chatTimeOptionsOn(salon(), tom(), '2026-10-08').some((option) => option.time === '15:00'));
  assert.deepEqual(chatTimeOptionsOn(salon(), tom(), '2026-10-05'), []); // closed on Mondays
  assert.ok(chatTimeOptionsOn(salon({ now: new Date('2026-10-08T13:10:00Z') }), tom(), '2026-10-08').every((option) => option.time > '15:10'));
  // A day that is full: the nearest times come from the days around it, at most two of each.
  const fullThursday = salon({ closedDates: [{ id: 'c', name: 'Team day', start: '2026-10-08', end: '2026-10-08' }] });
  const around = nearestChatTimes(fullThursday, tom());
  assert.deepEqual(around.map((option) => option.date), ['2026-10-07', '2026-10-07', '2026-10-09', '2026-10-09']);
});

test('a stylist the customer asked for: theirs when free; when not, the card says why and who else is free', () => {
  const asksSelina = tom({ employeeId: 'emp-2', staffName: 'Selina Keller' });
  const free = planChatBooking(salon(), asksSelina)!;
  assert.equal(free.employee?.id, 'emp-2');
  assert.equal(free.checked, 'Selina Keller, whom Tom asked for, is free then. Checked against the opening hours, the working hours, time off and your calendar.');
  assert.match(words(requestCard(asksSelina)), /^Tom wants to book Haircut · asked for Selina Keller /);
  // Selina has somebody then: confirmed as it stands, it cannot be hers. The owner may give it to Anna.
  const busy = planChatBooking(salon({ events: [selinaBusy] }), asksSelina)!;
  assert.equal(busy.employee, null);
  assert.equal(busy.action, null);
  assert.deepEqual(busy.freeEmployees.map((employee) => employee.id), ['emp-1']);
  assert.equal(busy.refusal, 'Tom asked for Selina Keller. Selina Keller already has Sandra Keller at 15:00–15:30 on Thu, 08.10.2026. Anna Weber is free then. Confirm with Anna Weber, suggest another time, or decline.');
  const html = requestCard(asksSelina, salon({ events: [selinaBusy] }));
  assert.deepEqual(buttons(html), ['Confirm', 'Suggest another time', 'Decline']);
  assert.match(html, /<option value="emp-1" selected="">Anna Weber<\/option>/);
  // Nobody else is free either.
  assert.match(planChatBooking(salon({ events: [selinaBusy, annaBusy] }), asksSelina)!.refusal!, /Nobody else who offers Haircut is free then either\. Suggest another time, or decline\.$/);
  // A name the salon does not know (any more).
  assert.match(planChatBooking(salon(), tom({ staffName: 'Marco' }))!.refusal!, /^Tom asked for Marco\. Marco is no longer in your team\. Anna Weber, Selina Keller are free then\./);
  // The nearest times are the ones of the stylist asked for.
  assert.ok(nearestChatTimes(salon({ events: [selinaBusy] }), asksSelina).every((option) => option.employee.id === 'emp-2'));
});

test('a service that is gone and a time that has passed: what stands in the way, and only the answers that help', () => {
  const gone = tom({ serviceId: 'srv-gone', service: 'Perm' });
  const goneHtml = requestCard(gone);
  assert.match(words(goneHtml), /"Perm" is no longer one of your services\. Add the appointment by hand in the calendar, or decline\. Decline$/);
  assert.deepEqual(buttons(goneHtml), ['Decline']);
  const passed = tom({ date: '2026-10-05', time: '09:00' });
  const passedHtml = requestCard(passed);
  assert.match(words(passedHtml), /This time has passed\. Suggest another time, or decline\. Suggest another time Decline$/);
  // The nearest times for a request in the past start today, after the present moment.
  assert.ok(nearestChatTimes(salon(), passed).every((option) => `${option.date} ${option.time}` > '2026-10-05 12:00'));
});

test('a change: the card says from when to when, and Confirm moves the appointment booked in this chat', () => {
  const change = tom({ kind: 'change', previous: { date: '2026-10-07', time: '10:00' } }, { status: 'booked' });
  const context = salon({ events: [tomsAppointment] });
  const plan = planChatBooking(context, change)!;
  assert.equal(plan.previous?.id, tomsAppointment.id);
  // It stays with Anna, who had it: the same appointment moves.
  assert.deepEqual(plan.action, { type: 'reschedule', appointmentId: tomsAppointment.id, date: '2026-10-08', startTime: '15:00' });
  const html = requestCard(change, context);
  assert.match(words(html), /^Tom wants to move an appointment Haircut From Wed, 07\.10\.2026 · 10:00–10:30 to Thu, 08\.10\.2026 · 15:00–15:30 Anna Weber is free then\./);
  // A move by half an hour: its own old time does not stand in its way.
  const later = tom({ kind: 'change', previous: { date: '2026-10-07', time: '10:00' }, date: '2026-10-07', time: '10:15' });
  assert.equal(planChatBooking(context, { ...later, bookingRequest: { ...later.bookingRequest!, time: '10:30' } })!.employee?.id, 'emp-1');
  // The appointment is gone from the calendar meanwhile: the card says so, and Confirm books the new time.
  assert.match(words(requestCard(change)), /That appointment is no longer in your calendar\. Confirm books the new time\./);
});

test('a cancellation: the card names the appointment and says what each answer does', () => {
  const cancelling = tom({ status: 'confirmed' }, { cancellationRequest: { service: 'Haircut', date: '2026-10-07', time: '10:00' } });
  const plan = planChatCancellation({ events: [tomsAppointment] }, cancelling)!;
  assert.equal(plan.appointment?.id, tomsAppointment.id);
  const html = render(React.createElement(ChatCancellationCard, { conversation: cancelling, salon: { events: [tomsAppointment] }, onAnswer: answer }));
  assert.equal(words(html), 'Tom wants to cancel Haircut · with Anna Weber Wed, 07.10.2026 · 10:00–10:30 Cancel appointment takes it out of your calendar and sends Tom the cancellation in the chat. Keep appointment sends nothing: write to Tom yourself. Cancel appointment Keep appointment');
  assert.deepEqual(buttons(html), ['Cancel appointment', 'Keep appointment']);
  assert.equal(planChatCancellation({ events: [] }, cancelling)!.appointment, null);
  assert.equal(planChatCancellation({ events: [tomsAppointment] }, tom()), null);
});

test('the booking line: what was booked, how it came about, and the way to the calendar', () => {
  const card = (event: CalendarEvent, origin?: string) => render(React.createElement(ChatBookedCard, { appointment: event, origin, onOpenAppointment: () => {} }));
  assert.equal(words(card(tomsAppointment)), 'Confirmed by you Haircut · with Anna Weber Wed, 07.10.2026 · 10:00–10:30 View in calendar');
  assert.match(words(card({ ...tomsAppointment, isAiBooked: true })), /^Booked by the AI /);
  // The chat knows better than the appointment how it came about: the AI took the request, the owner confirmed it.
  assert.match(words(card({ ...tomsAppointment, isAiBooked: true }, 'Confirmed by you')), /^Confirmed by you /);
  // Its button is a full tap target, and on the narrowest phones an arrow whose words stay for screen readers.
  assert.match(card(tomsAppointment), /<button[^>]*class="[^"]*\bmin-h-11 min-w-11\b[^"]*"[^>]*><span class="max-\[419px\]:sr-only">View in calendar<\/span>/);
  assert.doesNotMatch(render(React.createElement(ChatBookedCard, { appointment: tomsAppointment })), /<button/);

  // In a chat: the line for the chat's own appointment, and nothing where there is none.
  const pinned = (conversation: Conversation, events: CalendarEvent[]) => words(render(React.createElement(ChatAppointment, { conversation, events, onOpenAppointment: () => {} })));
  // The AI took the request and the owner confirmed it: the line says both, as Home and the calendar count it for the AI.
  // (The confirmed request is the one Tom's appointment was booked for: Wednesday 10:00.)
  const confirmedTom = tom({ status: 'confirmed', date: '2026-10-07', time: '10:00' });
  assert.match(pinned(confirmedTom, [{ ...tomsAppointment, isAiBooked: true }]), /^Booked by the AI · confirmed by you Haircut · with Anna Weber/);
  assert.match(pinned(confirmedTom, [tomsAppointment]), /^Confirmed by you Haircut · with Anna Weber/);
  // A confirmed request whose appointment is not in the calendar shows no line, also when the chat
  // holds another appointment (booked by hand): that is not what the customer was told of.
  assert.equal(pinned(tom({ status: 'confirmed' }), [tomsAppointment]), '');
  assert.match(pinned(tom(), [tomsAppointment]), /^Confirmed by you Haircut/);
  assert.equal(pinned(tom(null), []), '');
  // An appointment given to another customer since is not shown in Tom's chat.
  assert.equal(pinned(tom(null, { customerId: 'cust-tom' }), [{ ...tomsAppointment, conversationId: undefined, customerId: 'cust-other' }]), '');
});

test('what waits for an answer in a chat: the request, the wish to cancel, or nothing', () => {
  const waiting = (conversation: Conversation, events: CalendarEvent[] = []) => words(render(React.createElement(ChatWaitingCards, { conversation, salon: salon({ events }), onAnswer: answer })));
  assert.match(waiting(tom()), /^Tom wants to book Haircut .* Confirm Suggest another time Decline$/);
  assert.equal(waiting(tom({ status: 'confirmed' }), [tomsAppointment]), '');
  assert.equal(waiting(tom(null)), '');
  const cancelling = tom({ status: 'confirmed', date: '2026-10-07', time: '10:00' }, { cancellationRequest: { service: 'Haircut', date: '2026-10-07', time: '10:00' } });
  assert.match(waiting(cancelling, [tomsAppointment]), /^Tom wants to cancel .* Cancel appointment Keep appointment$/);
  // The chat screen looks for this mark to bring a tall request into view from its first line.
  assert.match(render(React.createElement(ChatWaitingCards, { conversation: tom(), salon: salon(), onAnswer: answer })), /^<div data-chat-waiting=""/);
  assert.deepEqual([chatAwaitsAnswer(tom()), chatAwaitsAnswer(cancelling), chatAwaitsAnswer(tom({ status: 'confirmed' })), chatAwaitsAnswer(tom(null))], [true, true, false, false]);
});

// ---------- carrying the answers out ----------

/** The app around answerChatBooking: a calendar, the chats, and a server that answers as told. */
function harness(conversation: Conversation, events: CalendarEvent[], refuse: string | null | ((name: string, args: unknown[]) => string | null) = null) {
  const state = { events: [...events], conversations: [conversation], calls: [] as string[], own: [] as { action: ChatBookingAction; saved?: CalendarEvent }[] };
  // What the answer names (`expected`) reads "2026-10-08 15:00 Haircut for Tom" in the list of calls, with "asked Anna Weber" where a stylist was asked for.
  const shown = (arg: unknown) => {
    if (typeof arg !== 'object' || arg === null) return String(arg);
    const { date, time, service, customerName, staffName } = arg as { date: string; time: string; service?: string; customerName?: string; staffName?: string };
    return [date, time, service, customerName && `for ${customerName}`, staffName && `asked ${staffName}`].filter(Boolean).join(' ');
  };
  const call = (name: string) => async (...args: unknown[]) => {
    // The calendar is untouched while the server is asked.
    state.calls.push(`${name}(${args.map(shown).join(', ')}) with ${state.events.length} appointments`);
    return typeof refuse === 'function' ? refuse(name, args) : refuse;
  };
  const server: ChatBookingServer = {
    confirmBooking: call('confirmBooking'), suggestTime: call('suggestTime'), declineBooking: call('declineBooking'),
    cancelBooking: call('cancelBooking'), keepBooking: call('keepBooking'),
  };
  const deps: ChatBookingDeps = {
    salon: () => salon({ events: state.events }),
    conversation: (id) => state.conversations.find((item) => item.id === id),
    server,
    // As App.tsx does it: the chat's appointment under the usual rules.
    applyAppointment: (chat: Conversation, action: AppointmentAction) => {
      const built = appointmentFromConversationAction(action, chat, state.events, initialServices, initialEmployees, false);
      if (!built) return { error: 'This appointment could not be updated.' };
      const problem = validateCalendarEvent(salon({ events: state.events }), built, built.id);
      if (problem) return { error: problem };
      const saved = { ...built, conversationId: chat.id };
      state.events = upsertAppointment(state.events, saved);
      return { saved };
    },
    removeAppointment: (id) => { state.events = state.events.filter((event) => event.id !== id); },
    updateOwnChat: (_id, action, saved) => { state.own.push({ action, saved }); },
    busy: new Set(),
  };
  return { state, deps };
}

test('Confirm in a live chat: the server first, with the stylist; the calendar only once it has taken the answer', async () => {
  const { state, deps } = harness(tom(), [annaBusy]);
  const result = await answerChatBooking('live-web-tom', { type: 'confirm', employeeId: 'emp-2', staffName: 'Selina Keller' }, deps);
  assert.ok('done' in result);
  // The server is told which request this answers: the time the calendar gets.
  assert.deepEqual(state.calls, ['confirmBooking(live-web-tom, 2026-10-08 15:00 Haircut for Tom, Selina Keller) with 1 appointments']);
  const booked = state.events.find((event) => event.id === 'live-appt-live-web-tom-2026-10-08-1500');
  assert.deepEqual([booked?.employeeId, booked?.startTime, booked?.endTime, booked?.isAiBooked, booked?.conversationId], ['emp-2', '15:00', '15:30', false, 'live-web-tom']);
  assert.equal(result.done.outcome, 'confirmed');
  assert.equal(result.done.appointment?.id, booked?.id);
  // The server refuses: nothing enters the calendar, and the reason comes back for the card.
  const refused = harness(tom(), [], 'The chat was deleted by the customer.');
  assert.deepEqual(await answerChatBooking('live-web-tom', { type: 'confirm' }, refused.deps), { error: 'The chat was deleted by the customer.' });
  assert.equal(refused.state.events.length, 0);
});

test('a live answer names the request it answers: a changed request books nothing, and a retry after a lost answer fills the calendar', async () => {
  // The customer asked for another time after the card was drawn: the server refuses, the calendar stays as it is.
  const changed = harness(tom(), [], (_name, args) => {
    const expected = args[1] as { date: string; time: string };
    return expected.date === '2026-10-08' && expected.time === '15:00' ? 'The customer changed the request in the meantime. Look at it again.' : null;
  });
  assert.deepEqual(await answerChatBooking('live-web-tom', { type: 'confirm' }, changed.deps), { error: 'The customer changed the request in the meantime. Look at it again.' });
  assert.equal(changed.state.events.length, 0);
  // The first answer got lost on the way back: nothing in the calendar, and the card still waits.
  let lost = true;
  const retry = harness(tom(), [], () => (lost ? 'Could not reach the server. Check your connection.' : null));
  assert.ok('error' in await answerChatBooking('live-web-tom', { type: 'confirm' }, retry.deps));
  assert.equal(retry.state.events.length, 0);
  // Asked again with the same time, the server answers that it stands (it sends nothing twice); now the calendar gets it.
  lost = false;
  const again = await answerChatBooking('live-web-tom', { type: 'confirm' }, retry.deps);
  assert.ok('done' in again && again.done.outcome === 'confirmed');
  assert.deepEqual(retry.state.calls.map((item) => item.replace(/ with \d+ appointments$/, '')), ['confirmBooking(live-web-tom, 2026-10-08 15:00 Haircut for Tom, Anna Weber)', 'confirmBooking(live-web-tom, 2026-10-08 15:00 Haircut for Tom, Anna Weber)']);
  assert.deepEqual(retry.state.events.map((event) => [event.date, event.startTime]), [['2026-10-08', '15:00']]);
});

test('every answer is checked against the calendar as it is at that moment, also when the card was drawn earlier', async () => {
  // The card offered Selina; meanwhile she got another appointment at that time.
  const { state, deps } = harness(tom(), [selinaBusy]);
  const result = await answerChatBooking('live-web-tom', { type: 'confirm', employeeId: 'emp-2', staffName: 'Selina Keller' }, deps);
  assert.deepEqual(result, { error: 'Selina Keller is no longer free then. Choose another stylist, or suggest another time.' });
  assert.deepEqual(state.calls, []);
  // Nobody is free any more: the reason of the plan.
  const full = harness(tom(), [selinaBusy, annaBusy]);
  assert.match((await answerChatBooking('live-web-tom', { type: 'confirm' }, full.deps) as { error: string }).error, /^Nobody who offers Haircut is free/);
  // A suggested time that has been taken meanwhile is not offered to the customer.
  const taken = harness(tom(), [annaBusy, selinaBusy, appointment('cal-x', 'emp-1', '2026-10-08', '16:00', '16:30')]);
  assert.deepEqual(await answerChatBooking('live-web-tom', { type: 'suggest', date: '2026-10-08', time: '16:00', employeeId: 'emp-1' }, taken.deps), { error: 'This time is no longer free. Choose another one.' });
  assert.deepEqual(taken.state.calls, []);
  // A second answer while the first is on its way waits for it.
  const twice = harness(tom(), []);
  const first = answerChatBooking('live-web-tom', { type: 'decline' }, twice.deps);
  assert.match((await answerChatBooking('live-web-tom', { type: 'confirm' }, twice.deps) as { error: string }).error, /already on its way/);
  await first;
});

test('Suggest and Decline tell the customer and leave the calendar as it is', async () => {
  const { state, deps } = harness(tom(), [annaBusy, selinaBusy]);
  const suggested = await answerChatBooking('live-web-tom', { type: 'suggest', date: '2026-10-08', time: '16:00', employeeId: 'emp-1', staffName: 'Anna Weber' }, deps);
  assert.ok('done' in suggested);
  assert.deepEqual([suggested.done.outcome, suggested.done.date, suggested.done.startTime, suggested.done.staffName], ['suggested', '2026-10-08', '16:00', 'Anna Weber']);
  assert.deepEqual(suggested.done.asked, { date: '2026-10-08', time: '15:00' });
  const declined = await answerChatBooking('live-web-tom', { type: 'decline' }, deps);
  assert.ok('done' in declined && declined.done.outcome === 'declined');
  assert.deepEqual(state.calls, ['suggestTime(live-web-tom, 2026-10-08 15:00 Haircut for Tom, 2026-10-08, 16:00, Anna Weber) with 2 appointments', 'declineBooking(live-web-tom, 2026-10-08 15:00 Haircut for Tom) with 2 appointments']);
  assert.deepEqual(state.events.map((event) => event.id), ['cal-a', 'cal-s']);
  // A change that is declined leaves the old appointment where it is.
  const change = harness(tom({ kind: 'change', previous: { date: '2026-10-07', time: '10:00' } }), [tomsAppointment]);
  await answerChatBooking('live-web-tom', { type: 'decline' }, change.deps);
  assert.deepEqual(change.state.events, [tomsAppointment]);
});

test('a confirmed change moves the appointment: the old time leaves the calendar, the new one enters it', async () => {
  const change = tom({ kind: 'change', previous: { date: '2026-10-07', time: '10:00' } });
  // With Anna, who had it: the same appointment at the new time.
  const same = harness(change, [tomsAppointment]);
  const moved = await answerChatBooking('live-web-tom', { type: 'confirm' }, same.deps);
  assert.ok('done' in moved && moved.done.moved === true);
  assert.deepEqual(same.state.events.map((event) => [event.id, event.date, event.startTime, event.employeeId]), [[tomsAppointment.id, '2026-10-08', '15:00', 'emp-1']]);
  // With Selina: a new appointment, and the old one goes.
  const other = harness(change, [tomsAppointment]);
  await answerChatBooking('live-web-tom', { type: 'confirm', employeeId: 'emp-2' }, other.deps);
  assert.deepEqual(other.state.events.map((event) => [event.id, event.date, event.startTime, event.employeeId]), [['live-appt-live-web-tom-2026-10-08-1500', '2026-10-08', '15:00', 'emp-2']]);
});

test('Cancel takes the appointment out once the server has agreed; Keep sends nothing and changes nothing', async () => {
  const cancelling = tom({ status: 'confirmed' }, { cancellationRequest: { service: 'Haircut', date: '2026-10-07', time: '10:00' } });
  const cancel = harness(cancelling, [tomsAppointment, annaBusy]);
  const result = await answerChatBooking('live-web-tom', { type: 'cancel' }, cancel.deps);
  assert.ok('done' in result && result.done.outcome === 'cancelled');
  assert.deepEqual(cancel.state.calls, ['cancelBooking(live-web-tom, 2026-10-07 10:00 Haircut) with 2 appointments']);
  assert.deepEqual(cancel.state.events.map((event) => event.id), ['cal-a']);
  const refused = harness(cancelling, [tomsAppointment], 'Could not reach the server. Check your connection.');
  assert.deepEqual(await answerChatBooking('live-web-tom', { type: 'cancel' }, refused.deps), { error: 'Could not reach the server. Check your connection.' });
  assert.deepEqual(refused.state.events, [tomsAppointment]);
  const keep = harness(cancelling, [tomsAppointment]);
  assert.ok('done' in await answerChatBooking('live-web-tom', { type: 'keep' }, keep.deps));
  assert.deepEqual(keep.state.events, [tomsAppointment]);
  // Nothing to cancel: the request is no longer there.
  assert.deepEqual(await answerChatBooking('live-web-tom', { type: 'cancel' }, harness(tom(), []).deps), { error: 'This cancellation request is no longer waiting.' });
});

test('one of the salon\'s own chats: no server; the calendar changes and the chat is handed the answer', async () => {
  const own = tom({}, { id: 'conv-tom', live: undefined });
  const { state, deps } = harness(own, []);
  const result = await answerChatBooking('conv-tom', { type: 'confirm' }, deps);
  assert.ok('done' in result);
  assert.deepEqual(state.calls, []);
  assert.equal(state.events.length, 1);
  assert.equal(state.own.length, 1);
  assert.deepEqual([state.own[0].action.type, state.own[0].saved?.id], ['confirm', state.events[0].id]);
  // A refusal of the calendar changes neither the calendar nor the chat.
  const full = harness(own, [annaBusy, selinaBusy]);
  assert.ok('error' in await answerChatBooking('conv-tom', { type: 'confirm' }, full.deps));
  assert.deepEqual(full.state.own, []);
  const declined = harness(own, []);
  await answerChatBooking('conv-tom', { type: 'decline' }, declined.deps);
  assert.deepEqual(declined.state.own.map((item) => item.action.type), ['decline']);
  assert.deepEqual(declined.state.events, []);
});

test('"Book for this customer" finds the chat\'s record and makes one only for a chat that has none', () => {
  const sabrina = demoCustomers.find((customer) => customer.id === 'cust-sabrina')!;
  assert.equal(chatCustomer(demoCustomers, { id: 'conv-sabrina', customerId: sabrina.id }, [])?.id, sabrina.id);
  // A live chat: the record that remembers the chat, or the one its appointment was booked for.
  const fromChat = { ...sabrina, id: 'cust-tom', conversationId: 'live-web-tom' };
  assert.equal(chatCustomer([fromChat, ...demoCustomers], { id: 'live-web-tom' }, [])?.id, 'cust-tom');
  assert.equal(chatCustomer([{ ...fromChat, conversationId: undefined }, ...demoCustomers], { id: 'live-web-tom' }, [tomsAppointment])?.id, 'cust-tom');
  // Nobody with the same name is taken for the chat's customer.
  assert.equal(chatCustomer([{ ...sabrina, id: 'cust-x', name: 'Tom' }], { id: 'live-web-tom' }, []), null);
  const record = chatCustomerRecord(tom(), 'cust-new', '');
  assert.deepEqual(record, { id: 'cust-new', name: 'Tom', initials: 'T', email: '', phone: '', language: 'EN', channel: 'Website', conversationId: 'live-web-tom' });
});

// ---------- a chat that holds the appointment already (booked by hand from the chat) ----------

/** Tom's haircut on Thursday 8 October at 15:00 with Selina, booked by hand from his chat. */
const byHand = appointment('cal-by-hand', 'emp-2', '2026-10-08', '15:00', '15:30', { customerName: 'Tom', conversationId: 'live-web-tom', customerId: 'cust-tom' });

test('a request whose time the chat holds already: no stylist is looked for, and Confirm books nothing a second time', () => {
  const context = salon({ events: [byHand] });
  const plan = planChatBooking(context, tom())!;
  assert.equal(plan.held?.id, 'cal-by-hand');
  assert.equal(plan.refusal, null);
  assert.deepEqual(plan.freeEmployees, []);
  assert.equal(plan.checked, 'Selina Keller already has Tom at that time in your calendar.');
  // The card: that line, no stylist to choose, and what Confirm does.
  const live = words(requestCard(tom(), context));
  assert.match(live, /Selina Keller already has Tom at that time in your calendar\. Confirm sends Tom the confirmation in the chat\. Confirm Suggest another time Decline$/);
  assert.doesNotMatch(live, /Stylist who is free then|adds it to your calendar/);
  assert.match(words(requestCard(tom({}, { id: 'conv-tom', live: undefined }), salon({ events: [{ ...byHand, conversationId: 'conv-tom' }] }))),
    /already has Tom at that time in your calendar\. Confirm marks the request as booked\. Confirm/);
  // An appointment of the chat at another time, or of somebody else at this time, is no such appointment.
  assert.equal(planChatBooking(salon({ events: [{ ...byHand, startTime: '15:30', endTime: '16:00' }] }), tom())!.held, null);
  assert.equal(planChatBooking(salon({ events: [{ ...byHand, conversationId: undefined, customerName: 'Sandra Keller' }] }), tom())!.held, null);
  // The id that confirming gives counts as the chat's own, also without the chat named on it.
  const confirmedBefore = { ...byHand, id: 'live-appt-live-web-tom-2026-10-08-1500', conversationId: undefined };
  assert.equal(planChatBooking(salon({ events: [confirmedBefore] }), tom())!.held?.id, confirmedBefore.id);
});

test('Confirm with the appointment held: a live chat asks the server with its stylist; an own chat is updated; nothing is booked twice', async () => {
  const live = harness(tom(), [byHand]);
  const result = await answerChatBooking('live-web-tom', { type: 'confirm', employeeId: 'emp-1', staffName: 'Anna Weber' }, live.deps);
  assert.ok('done' in result);
  assert.deepEqual(live.state.calls, ['confirmBooking(live-web-tom, 2026-10-08 15:00 Haircut for Tom, Selina Keller) with 1 appointments']);
  assert.deepEqual(live.state.events.map((event) => event.id), ['cal-by-hand']);
  assert.deepEqual([result.done.outcome, result.done.staffName, result.done.appointment?.id], ['confirmed', 'Selina Keller', 'cal-by-hand']);
  // Refused by the server: nothing changes.
  const refused = harness(tom(), [byHand], 'The chat was deleted by the customer.');
  assert.ok('error' in await answerChatBooking('live-web-tom', { type: 'confirm' }, refused.deps));
  assert.deepEqual(refused.state.events.map((event) => event.id), ['cal-by-hand']);

  const ownHeld = { ...byHand, conversationId: 'conv-tom' };
  const own = harness(tom({}, { id: 'conv-tom', live: undefined }), [ownHeld]);
  assert.ok('done' in await answerChatBooking('conv-tom', { type: 'confirm' }, own.deps));
  assert.deepEqual(own.state.calls, []);
  assert.deepEqual(own.state.events.map((event) => event.id), ['cal-by-hand']);
  assert.deepEqual([own.state.own[0].action, own.state.own[0].saved?.id], [{ type: 'confirm', employeeId: 'emp-2', staffName: 'Selina Keller' }, 'cal-by-hand']);

  // A change whose new time is held already: the old appointment goes, the held one stays.
  const change = tom({ kind: 'change', previous: { date: '2026-10-07', time: '10:00' } }, { status: 'booked' });
  const moved = harness(change, [tomsAppointment, byHand]);
  const movedResult = await answerChatBooking('live-web-tom', { type: 'confirm' }, moved.deps);
  assert.ok('done' in movedResult);
  assert.deepEqual(moved.state.events.map((event) => event.id), ['cal-by-hand']);
  assert.equal(movedResult.done.moved, true);
});

test('the helper line of a change says that Confirm moves the appointment', () => {
  const change = tom({ kind: 'change', previous: { date: '2026-10-07', time: '10:00' } }, { status: 'booked' });
  const context = salon({ events: [tomsAppointment] });
  assert.match(words(requestCard(change, context)), /Confirm moves the appointment in your calendar and sends Tom the confirmation in the chat\./);
  assert.match(words(requestCard({ ...change, id: 'conv-tom', live: undefined }, salon({ events: [{ ...tomsAppointment, conversationId: 'conv-tom' }] }))),
    /Confirm moves the appointment in your calendar\. Confirm/);
});
