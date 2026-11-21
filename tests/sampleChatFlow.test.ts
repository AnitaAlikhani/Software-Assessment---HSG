import assert from 'node:assert/strict';
import test from 'node:test';
import type { AvailabilityContext } from '../src/availability';
import type { ChatBookingAction } from '../src/chatBookingActions';
import { chatBookingMessage } from '../src/chatTemplates';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { chatAppointmentId, planChatBooking } from '../src/requestAnswers';
import { sampleChatAfter, sampleChatAfterAi, sampleChatAfterOwnerReply } from '../src/sampleChatFlow';
import type { Conversation } from '../src/types';
import { demoConversations, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';

// What the salon's own chats look like after the owner acts in them (src/sampleChatFlow.ts). The
// chats are those of Monday 5 October 2026, 12:00 (tests/fixedClock.ts); the owner answers at 12:05.

const ZONE = 'Europe/Zurich';
const SALON = 'Bella Hair Salon';
const LATER = new Date(FIXED_NOW.getTime() + 5 * 60_000);
const chat = (id: string) => demoConversations.find((conversation) => conversation.id === id)!;
const context: AvailabilityContext = {
  services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
  events: demoEvents, requests: demoRequests, timeZone: ZONE, now: LATER,
};
/** The messages a step added. */
const added = (before: Conversation, after: Conversation) => after.messages.slice(before.messages.length);
const ACTIONS: ChatBookingAction[] = [
  { type: 'confirm' },
  { type: 'suggest', date: '2026-10-10', time: '14:00', employeeId: 'emp-2', staffName: 'Selina Keller' },
  { type: 'decline' },
  { type: 'cancel' },
  { type: 'keep' },
];
const WAITING = ['conv-sabrina', 'conv-reto', 'conv-giulia'];

test('every answer leaves every chat coherent, and an answer that does not fit changes nothing', () => {
  for (const conversation of demoConversations) {
    const copy = structuredClone(conversation);
    for (const action of ACTIONS) {
      const where = `${conversation.id} ${action.type}`;
      const after = sampleChatAfter(conversation, action, LATER, ZONE, SALON);
      // A pure function: the chat passed in is untouched, and the same arguments give the same chat.
      assert.deepEqual(conversation, copy, where);
      assert.deepEqual(sampleChatAfter(conversation, action, LATER, ZONE, SALON), after, where);
      const fits = WAITING.includes(conversation.id) && ['confirm', 'suggest', 'decline'].includes(action.type);
      if (!fits) { assert.equal(after, conversation, where); continue; }
      // Every new message is from now, and the list shows it.
      for (const message of added(conversation, after)) {
        assert.equal(message.sentAt, LATER.toISOString(), where);
        assert.equal(message.time, '12:05', where);
      }
      assert.equal(after.lastMessageAt, LATER.toISOString(), where);
      assert.equal(after.lastTime, '12:05', where);
      // A confirmation leaves a question of the customer's open (Sabrina's discount): its prepared
      // answers stay. Otherwise the prepared suggestions answered an earlier message: they are gone.
      const questionStays = Boolean(conversation.aiFollowUp || conversation.quickReplies?.length);
      assert.equal(after.quickReplies === undefined, !questionStays, where);
      assert.equal(after.aiFollowUp === undefined, !questionStays, where);
      // The status follows from what the chat holds: "booked" only with its appointment, and nothing waiting.
      assert.equal(after.status === 'booked', Boolean(after.appointmentId) && after.bookingRequest?.status !== 'requested' && !questionStays, where);
      assert.equal(after.status === 'needs-attention', after.bookingRequest?.status === 'requested' || questionStays, where);
      assert.equal(Boolean(after.attentionReason), after.status === 'needs-attention', where);
    }
  }
});

test('confirming sends the fixed confirmation, confirms the request and names the appointment the caller made', () => {
  for (const id of WAITING) {
    const conversation = chat(id);
    const request = conversation.bookingRequest!;
    const after = sampleChatAfter(conversation, { type: 'confirm' }, LATER, ZONE, SALON);
    const [confirmation, thanks, ...more] = added(conversation, after);
    // Sabrina's discount question is still open: no thanks follows, and the chat still needs the owner.
    const open = id === 'conv-sabrina';
    const fixed = chatBookingMessage('confirmed', {
      language: conversation.language, customerName: request.customerName, salonName: SALON, serviceName: request.service,
      staffName: request.staffName, date: request.date, time: request.time,
    });
    // The salon's message, word for word the one a live chat gets (German needs no German translation).
    assert.equal(confirmation.sender, 'owner', id);
    assert.equal(confirmation.original, fixed.original, id);
    assert.equal(confirmation.translation, fixed.translation, id);
    assert.equal(confirmation.translationDe, conversation.language === 'DE' ? undefined : fixed.translationDe, id);
    assert.equal(thanks?.sender, open ? undefined : 'customer', id);
    assert.equal(more.length, 0, id);
    assert.deepEqual(after.bookingRequest, { ...request, status: 'confirmed' }, id);
    assert.equal(after.status, open ? 'needs-attention' : 'booked', id);
    // A new request books under the id that confirming gives it; a change moves the chat's appointment.
    assert.equal(after.appointmentId, request.kind === 'change' ? 'cal-giulia' : chatAppointmentId(id, request), id);
  }
  // Reto writes Swiss German, and thanks the salon in it.
  assert.equal(added(chat('conv-reto'), sampleChatAfter(chat('conv-reto'), { type: 'confirm' }, LATER, ZONE, SALON))[1].original, 'Super, merci vielmal!');
  // The stylist the owner chose is the one the confirmation names.
  const withAnna = sampleChatAfter(chat('conv-sabrina'), { type: 'confirm', employeeId: 'emp-1', staffName: 'Anna Weber' }, LATER, ZONE, SALON);
  assert.match(added(chat('conv-sabrina'), withAnna)[0].original, /Colouring am Freitag, 09\.10\.2026 um 11:00 Uhr mit Anna Weber\./);
  assert.deepEqual([withAnna.bookingRequest!.employeeId, withAnna.bookingRequest!.staffName], ['emp-1', 'Anna Weber']);
  // The salon's name is the one in Settings; without one the sentence leaves it out.
  assert.doesNotMatch(added(chat('conv-reto'), sampleChatAfter(chat('conv-reto'), { type: 'confirm' }, LATER, ZONE, ''))[0].original, /bei /);
});

test('a suggested time goes on: the customer agrees, and a request at that time waits for one more tap', () => {
  const suggestion: ChatBookingAction = { type: 'suggest', date: '2026-10-10', time: '14:00', employeeId: 'emp-2', staffName: 'Selina Keller' };
  for (const id of WAITING) {
    const conversation = chat(id);
    const request = conversation.bookingRequest!;
    const after = sampleChatAfter(conversation, suggestion, LATER, ZONE, SALON);
    const [offer, yes, passedOn] = added(conversation, after);
    assert.equal(offer.original, chatBookingMessage('suggested', {
      language: conversation.language, customerName: request.customerName, salonName: SALON, serviceName: request.service,
      staffName: 'Selina Keller', date: '2026-10-10', time: '14:00', askedDate: request.date, askedTime: request.time,
    }).original, id);
    assert.deepEqual([offer.sender, yes.sender, passedOn.sender], ['owner', 'customer', 'ai'], id);
    assert.deepEqual(after.bookingRequest, { ...request, date: '2026-10-10', time: '14:00', employeeId: 'emp-2', staffName: 'Selina Keller', status: 'requested' }, id);
    assert.equal(after.status, 'needs-attention', id);
    // Sabrina's discount question is still open: the chat keeps waiting with that reason.
    const open = id === 'conv-sabrina';
    assert.equal(after.attentionReason, open ? conversation.attentionReason : 'The customer accepted the time you offered. Confirm it to book the appointment.', id);
    // Nothing is booked yet: the appointment the chat had (Giulia's) is still the one it names.
    assert.equal(after.appointmentId, conversation.appointmentId, id);
    // One more tap books the new time.
    const confirmed = sampleChatAfter(after, { type: 'confirm' }, LATER, ZONE, SALON);
    assert.equal(confirmed.status, open ? 'needs-attention' : 'booked', id);
    assert.deepEqual([confirmed.bookingRequest!.date, confirmed.bookingRequest!.time, confirmed.bookingRequest!.status], ['2026-10-10', '14:00', 'confirmed'], id);
    assert.match(added(after, confirmed)[0].translation, /confirmed: .* on Saturday, 10\.10\.2026 at 14:00 with Selina Keller/, id);
  }
  // The customer answers in the language of the chat, with the English and German for the owner.
  const giulia = added(chat('conv-giulia'), sampleChatAfter(chat('conv-giulia'), suggestion, LATER, ZONE, SALON));
  assert.deepEqual(giulia.slice(1).map((message) => [message.original, message.translationDe]), [
    ['Sì, mi va bene. Grazie mille!', 'Ja, das passt mir. Vielen Dank!'],
    ["Grazie! Comunico al salone che l'orario Le va bene. Riceverà la conferma qui in chat.", 'Danke! Ich gebe dem Salon Bescheid, dass Ihnen die Zeit passt. Die Bestätigung erhalten Sie hier im Chat.'],
  ]);
  // Without a stylist named, the request keeps the one the customer asked for.
  assert.equal(sampleChatAfter(chat('conv-reto'), { type: 'suggest', date: '2026-10-10', time: '10:00' }, LATER, ZONE, SALON).bookingRequest!.staffName, 'Luca Frei');
});

test('declining clears the request; a customer whose change cannot be made keeps the appointment', () => {
  for (const id of WAITING) {
    const conversation = chat(id);
    const request = conversation.bookingRequest!;
    const after = sampleChatAfter(conversation, { type: 'decline' }, LATER, ZONE, SALON);
    const [declined, ...rest] = added(conversation, after);
    assert.equal(declined.original, chatBookingMessage('declined', {
      language: conversation.language, customerName: request.customerName, salonName: SALON, serviceName: request.service,
      staffName: request.staffName, date: request.date, time: request.time,
    }).original, id);
    assert.equal(after.bookingRequest, undefined, id);
    if (id === 'conv-giulia') {
      // Her Thursday stays: the chat is still booked, and she says she keeps it.
      assert.equal(after.status, 'booked');
      assert.equal(after.appointmentId, 'cal-giulia');
      assert.deepEqual(rest.map((message) => message.translation), ["All right, then I'll keep the appointment I already have."]);
    } else if (id === 'conv-sabrina') {
      // Her discount question is still open: it waits with its reason and its prepared answers.
      assert.equal(after.status, 'needs-attention');
      assert.equal(after.attentionReason, conversation.attentionReason);
      assert.deepEqual(rest, []);
    } else {
      assert.equal(after.status, 'owner-handled', id);
      assert.deepEqual(rest, [], id);
    }
  }
});

test('a cancellation the customer asked for is carried out or kept, and only cancelling sends a message', () => {
  const john = chat('conv-john');
  const asking: Conversation = { ...john, status: 'needs-attention', cancellationRequest: { service: 'Haircut', date: '2026-10-07', time: '15:00' } };
  const cancelled = sampleChatAfter(asking, { type: 'cancel' }, LATER, ZONE, SALON);
  assert.deepEqual(added(asking, cancelled).map((message) => [message.sender, message.original]), [
    ['owner', chatBookingMessage('cancelled', { language: 'EN', customerName: 'John Bennett', salonName: SALON, serviceName: 'Haircut', date: '2026-10-07', time: '15:00' }).original],
  ]);
  assert.match(added(asking, cancelled)[0].original, /^Hello John Bennett, your appointment at Bella Hair Salon on Wednesday, 07\.10\.2026 at 15:00 is cancelled\./);
  // The appointment leaves the calendar with it (the caller removes it): the chat names none, and is no longer booked.
  assert.deepEqual([cancelled.cancellationRequest, cancelled.bookingRequest, cancelled.appointmentId, cancelled.status], [undefined, undefined, undefined, 'owner-handled']);
  // Kept: nothing is sent, the appointment stays, the owner writes herself.
  const kept = sampleChatAfter(asking, { type: 'keep' }, LATER, ZONE, SALON);
  assert.deepEqual(added(asking, kept), []);
  assert.deepEqual([kept.cancellationRequest, kept.appointmentId, kept.status, kept.takenOver], [undefined, 'cal-john', 'booked', true]);
  // Confirming, suggesting or declining is not an answer to a cancellation.
  for (const action of ACTIONS.slice(0, 3)) assert.equal(sampleChatAfter(asking, action, LATER, ZONE, SALON), asking, action.type);
});

test('a live chat is never changed here: the server carries out the owner\'s answers there', () => {
  const live: Conversation = { ...chat('conv-reto'), id: 'live-web-abc', live: true };
  for (const action of ACTIONS) assert.equal(sampleChatAfter(live, action, LATER, ZONE, SALON), live, action.type);
});

test('either answer to the discount question confirms the colouring, with the fixed confirmation after the reply', () => {
  const sabrina = chat('conv-sabrina');
  for (const reply of sabrina.quickReplies!) {
    const booked = { action: reply.appointmentAction!, staffName: 'Anna Weber' };
    const after = sampleChatAfterOwnerReply(sabrina, { english: reply.en, local: reply.local }, booked, LATER, ZONE, SALON);
    const [answer, confirmation, thanks] = added(sabrina, after);
    // The owner has taken the chat over by replying: no scripted thanks waits there for her.
    assert.equal(thanks, undefined);
    assert.deepEqual([answer.sender, answer.original, answer.translation, answer.untranslated], ['owner', reply.local, reply.en, undefined]);
    assert.equal(confirmation.sender, 'owner');
    assert.match(confirmation.original, /^Guten Tag Sabrina Lüchinger, Ihr Termin bei Bella Hair Salon ist bestätigt: Colouring am Freitag, 09\.10\.2026 um 11:00 Uhr mit Anna Weber\./);
    assert.equal(after.status, 'booked');
    assert.equal(after.appointmentId, reply.appointmentAction!.appointmentId);
    assert.equal(after.bookingRequest!.status, 'confirmed');
    assert.equal(after.takenOver, true);
    assert.equal(after.quickReplies, undefined);
  }
  // A reply the owner typed herself is sent as written, marked as not translated; the request still waits.
  const typed = sampleChatAfterOwnerReply(sabrina, { english: 'Let me check and come back to you.' }, undefined, LATER, ZONE, SALON);
  assert.deepEqual(added(sabrina, typed).map((message) => [message.original, message.untranslated]), [['Let me check and come back to you.', true]]);
  assert.equal(typed.status, 'needs-attention');
  assert.equal(typed.quickReplies, undefined);
});

test('a time the owner offers leads to a request at that time, never to a dead end', () => {
  const chloe = chat('conv-chloe');
  const expected = [['2026-10-09', '18:00'], ['2026-10-10', '11:30']];
  chloe.quickReplies!.forEach((reply, index) => {
    const after = sampleChatAfterOwnerReply(chloe, { english: reply.en, local: reply.local }, undefined, LATER, ZONE, SALON);
    const [offer, yes, ...rest] = added(chloe, after);
    assert.equal(offer.original, reply.local);
    // The AI is paused while the owner writes: only the customer answers.
    assert.equal(yes.sender, 'customer');
    assert.match(yes.original, /Chloé Favre/);
    assert.deepEqual(rest, []);
    assert.deepEqual([after.bookingRequest!.date, after.bookingRequest!.time, after.bookingRequest!.status, after.bookingRequest!.serviceId], [...expected[index], 'requested', 'srv-2']);
    assert.equal(after.status, 'needs-attention');
    // The request passes the salon's rules: one tap confirms it.
    const plan = planChatBooking(context, after)!;
    assert.equal(plan.refusal, null, reply.en);
    assert.ok(plan.action, reply.en);
  });
});

test('handing a chat back to the AI sends its answer, removes the suggestions and never books', () => {
  // Chloé: the AI offers the last time on Friday, she accepts, and the AI passes the request on.
  const chloe = chat('conv-chloe');
  const afterChloe = sampleChatAfterAi(chloe, LATER, ZONE);
  assert.deepEqual(added(chloe, afterChloe).map((message) => message.sender), ['ai', 'customer', 'ai']);
  assert.equal(added(chloe, afterChloe)[0].original, chloe.aiFollowUp!.original);
  assert.deepEqual([afterChloe.bookingRequest!.date, afterChloe.bookingRequest!.time, afterChloe.bookingRequest!.status], ['2026-10-09', '18:00', 'requested']);
  assert.equal(planChatBooking(context, afterChloe)!.refusal, null);
  assert.deepEqual([afterChloe.quickReplies, afterChloe.aiFollowUp, afterChloe.takenOver, afterChloe.appointmentId], [undefined, undefined, false, undefined]);
  assert.equal(afterChloe.status, 'needs-attention');
  // Sabrina: the AI gives the listed price; her request still waits for the owner, and says so.
  const sabrina = chat('conv-sabrina');
  const afterSabrina = sampleChatAfterAi(sabrina, LATER, ZONE);
  assert.deepEqual(added(sabrina, afterSabrina).map((message) => message.sender), ['ai']);
  assert.match(added(sabrina, afterSabrina)[0].translation, /the colouring costs CHF 120/);
  assert.deepEqual([afterSabrina.status, afterSabrina.attentionReason, afterSabrina.bookingRequest!.status], ['needs-attention', 'The AI took a booking request. Confirm it or suggest another time.', 'requested']);
  assert.equal(afterSabrina.quickReplies, undefined);
  // A chat without a prepared answer is only handed back; what waits keeps waiting.
  const giulia = chat('conv-giulia');
  const afterGiulia = sampleChatAfterAi({ ...giulia, takenOver: true }, LATER, ZONE);
  assert.deepEqual(added(giulia, afterGiulia), []);
  assert.deepEqual([afterGiulia.status, afterGiulia.attentionReason, afterGiulia.takenOver], ['needs-attention', giulia.attentionReason, false]);
  // A booked chat stays booked.
  assert.equal(sampleChatAfterAi(chat('conv-marie'), LATER, ZONE).status, 'booked');
});

test("a confirmation leaves the customer's open question open; answered either way, the chat is booked", () => {
  const sabrina = chat('conv-sabrina');
  const confirmed = sampleChatAfter(sabrina, { type: 'confirm', employeeId: 'emp-1', staffName: 'Anna Weber' }, LATER, ZONE, SALON);
  // Only the salon's confirmation: she waits for an answer to her question, not to thank anybody.
  assert.deepEqual(added(sabrina, confirmed).map((message) => message.sender), ['owner']);
  assert.equal(confirmed.status, 'needs-attention');
  assert.equal(confirmed.attentionReason, sabrina.attentionReason);
  assert.equal(confirmed.bookingRequest!.status, 'confirmed');
  // The AI's prepared answer stays, in one sentence that promises no confirmation (it is there already).
  assert.equal(confirmed.aiFollowUp!.original, 'Unsere Preise sind für alle Kundinnen und Kunden gleich: Die Coloration kostet CHF 120.');
  assert.equal(confirmed.aiFollowUp!.translation, 'Our prices are the same for every customer: the colouring costs CHF 120.');
  // The suggested replies stay, but no longer book: the appointment exists.
  assert.equal(confirmed.quickReplies!.length, 2);
  for (const reply of confirmed.quickReplies!) assert.equal(reply.appointmentAction, undefined);
  // Handed to the AI: it answers the question, and the chat is booked.
  const byAi = sampleChatAfterAi(confirmed, LATER, ZONE);
  assert.equal(byAi.status, 'booked');
  assert.equal(byAi.attentionReason, undefined);
  assert.equal(added(confirmed, byAi).at(-1)!.original, confirmed.aiFollowUp!.original);
  // A suggested reply answers it: booked, nothing booked again.
  const reply = confirmed.quickReplies![0];
  const byReply = sampleChatAfterOwnerReply({ ...confirmed, takenOver: true }, { english: reply.en, local: reply.local }, undefined, LATER, ZONE, SALON);
  assert.equal(byReply.status, 'booked');
  assert.deepEqual(added(confirmed, byReply).map((message) => message.sender), ['owner']);
  assert.equal(byReply.appointmentId, confirmed.appointmentId);
  // A typed reply answers it too.
  const byTyping = sampleChatAfterOwnerReply({ ...confirmed, takenOver: true }, { english: 'No discount, sorry.' }, undefined, LATER, ZONE, SALON);
  assert.equal(byTyping.status, 'booked');
});

test('in a chat the owner has taken over, no scripted thanks follows a confirmation', () => {
  const reto = { ...chat('conv-reto'), takenOver: true };
  const after = sampleChatAfter(reto, { type: 'confirm' }, LATER, ZONE, SALON);
  assert.deepEqual(added(reto, after).map((message) => message.sender), ['owner']);
  assert.equal(after.status, 'booked');
});
