/**
 * The owner's answers to what waits in a live chat, in the orders of events that go wrong most
 * easily: the customer asks for something else while the owner answers, a change and a wish to
 * cancel cross, the messenger refuses while the customer writes, and one chat holds more than one
 * appointment. The AI's answers are fixed here; the real model and messengers are never called.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as writeChat } from '../api/chat';
import { POST as telegramWebhook } from '../api/telegram/webhook';
import { POST as act } from '../api/whatsapp/action';
import { fixedReply } from '../server/chatReplies';
import type { LiveBookingRequest, LiveConversation } from '../server/whatsappCore';
import { chatBookingMessage } from '../src/chatTemplates';
import { initialCompanySettings } from '../src/mockData';
import { deployedWith, FakeStore } from './fakeStore';
import {
  aiAnswer, bookingAnswer, chatRequest, freezeClock, liveChat, NOW, outsideWorld, ownerAction, putChat, quietly, SESSION, SETTINGS,
  storedChat, TELEGRAM_CHAT, telegramUpdate, type World,
} from './liveChatHarness';

const salonName = initialCompanySettings.companyName;
const WEB = `web-${SESSION}`;
const WEB_ID = `live-${WEB}`;
const TG = `tg-${TELEGRAM_CHAT}`;
const TG_ID = `live-${TG}`;
const post = (text: string) => chatRequest('POST', { body: { session: SESSION, name: 'Eva', text } });
const run = (world: World, store: FakeStore, work: () => Promise<unknown>) => quietly(() => deployedWith(SETTINGS, work, { store, outside: world.outside }));
/** Tuesday 6 October 2026 at 10:00 (the clock stands on Monday 5 October). */
const OPEN: LiveBookingRequest = { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-06', time: '10:00', customerName: 'Eva', status: 'requested', kind: 'new' };
const CONFIRMED: LiveBookingRequest = { ...OPEN, status: 'confirmed' };
const TUESDAY = { date: '2026-10-06', time: '10:00' };
const WEDNESDAY = { date: '2026-10-07', time: '14:00' };
const FRIDAY = { date: '2026-10-09', time: '15:00' };
const salonMessages = (chat: LiveConversation) => chat.messages.filter(message => message.sender === 'owner');
const answer = async (action: Record<string, unknown>) => {
  const response = await act(ownerAction({ conversationId: WEB_ID, ...action }));
  return { status: response.status, body: (await response.json()) as { error?: string; conversations?: unknown[] } };
};

test('an answer names the request it answers: a request the customer changed meanwhile is not answered', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  // The owner's card shows Tuesday 10:00. Before her page looks again, the customer asks for Wednesday 14:00.
  putChat(store, liveChat({ status: 'needs-attention', bookingRequest: OPEN }));
  const world = outsideWorld({ ai: bookingAnswer(WEDNESDAY) });
  await run(world, store, async () => {
    await writeChat(post('Actually Wednesday 14:00 please'));
    for (const action of [
      { type: 'confirm-booking', expected: TUESDAY },
      { type: 'suggest-time', expected: TUESDAY, date: '2026-10-08', time: '11:00' },
      { type: 'decline-booking', expected: TUESDAY },
    ]) {
      const refused = await answer(action);
      assert.deepEqual(refused, { status: 409, body: { error: 'The customer changed the request in the meantime. Look at it again.' } }, action.type);
    }
    let chat = storedChat(store, WEB)!;
    assert.deepEqual(salonMessages(chat), []);
    assert.deepEqual([chat.bookingRequest?.date, chat.bookingRequest?.time, chat.bookingRequest?.status], ['2026-10-07', '14:00', 'requested']);
    // Something that is no day and time is not guessed at.
    assert.deepEqual(await answer({ type: 'confirm-booking', expected: { date: '2026-10-07' } }), { status: 400, body: { error: 'This answer could not be read. Reload the page and try again.' } });
    // Answering what the card now shows goes through.
    assert.equal((await answer({ type: 'confirm-booking', expected: WEDNESDAY })).status, 200);
    chat = storedChat(store, WEB)!;
    assert.deepEqual([chat.confirmedBooking?.date, chat.confirmedBooking?.time], ['2026-10-07', '14:00']);
    assert.equal(salonMessages(chat).length, 1);
  });
  // A page of an earlier version sends no `expected`: it answers whatever waits, as before.
  const older = new FakeStore(NOW);
  putChat(older, liveChat({ status: 'needs-attention', bookingRequest: { ...OPEN, ...WEDNESDAY } }));
  await run(outsideWorld(), older, async () => { assert.equal((await answer({ type: 'confirm-booking' })).status, 200); });
  assert.equal(storedChat(older, WEB)!.confirmedBooking?.date, '2026-10-07');
});

test('confirming again what already stands (its answer got lost) is taken as done and sends nothing; any other "already confirmed" stays refused', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ status: 'needs-attention', bookingRequest: OPEN }));
  await run(outsideWorld(), store, async () => {
    assert.equal((await answer({ type: 'confirm-booking', expected: TUESDAY })).status, 200);
    const again = await answer({ type: 'confirm-booking', expected: TUESDAY });
    assert.equal(again.status, 200);
    assert.equal(again.body.conversations?.length, 1);
    assert.equal(salonMessages(storedChat(store, WEB)!).length, 1);
    assert.deepEqual(await answer({ type: 'confirm-booking', expected: WEDNESDAY }), { status: 400, body: { error: 'This booking is already confirmed.' } });
    assert.deepEqual(await answer({ type: 'confirm-booking' }), { status: 400, body: { error: 'This booking is already confirmed.' } });
    assert.deepEqual(await answer({ type: 'decline-booking', expected: TUESDAY }), { status: 400, body: { error: 'This booking is already confirmed.' } });
  });
});

test('a change and a wish to cancel the same appointment never wait together, and confirming a change leaves no cancellation of the old time', async (t) => {
  freezeClock(t);
  // Change first, then "cancel": the wish to cancel takes the change away.
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ status: 'booked', bookingRequest: CONFIRMED }));
  const world = outsideWorld({ ai: call => call === 1 ? bookingAnswer(WEDNESDAY, { intent: 'change' }) : aiAnswer({ intent: 'cancel', reply: 'ok' }) });
  await run(world, store, async () => {
    await writeChat(post('Can I move to Wednesday 14:00?'));
    await writeChat(post('Or rather cancel it'));
    const chat = storedChat(store, WEB)!;
    assert.deepEqual(chat.bookingRequest, CONFIRMED);
    assert.deepEqual(chat.cancellationRequest, { service: 'Haircut', ...TUESDAY, customerName: 'Eva' });
    assert.equal(chat.status, 'needs-attention');
    assert.match(chat.attentionReason!, /^Cancellation request: Haircut on Tuesday, 06\.10\.2026 at 10:00 for Eva\./);
    // The change is gone: there is nothing to confirm.
    assert.equal((await answer({ type: 'confirm-booking', expected: WEDNESDAY })).status, 400);
  });
  // "Cancel" first, then a change: the change takes the wish to cancel away.
  const reverse = new FakeStore(NOW);
  putChat(reverse, liveChat({ status: 'booked', bookingRequest: CONFIRMED }));
  const world2 = outsideWorld({ ai: call => call === 1 ? aiAnswer({ intent: 'cancel', reply: 'ok' }) : bookingAnswer(WEDNESDAY, { intent: 'change' }) });
  await run(world2, reverse, async () => {
    await writeChat(post('Cancel it please'));
    await writeChat(post('No wait, move it to Wednesday 14:00'));
    const chat = storedChat(reverse, WEB)!;
    assert.equal(chat.cancellationRequest, undefined);
    assert.deepEqual([chat.bookingRequest?.kind, chat.bookingRequest?.previous], ['change', TUESDAY]);
    assert.match(chat.attentionReason!, /^Change request:/);
  });
  // A chat stored by the earlier version with both waiting: confirming the change leaves no cancellation of the old time.
  const both = new FakeStore(NOW);
  putChat(both, liveChat({
    status: 'needs-attention', confirmedBooking: CONFIRMED, cancellationRequest: { service: 'Haircut', ...TUESDAY },
    bookingRequest: { ...OPEN, ...WEDNESDAY, kind: 'change', previous: TUESDAY },
  }));
  await run(outsideWorld(), both, async () => {
    assert.equal((await answer({ type: 'confirm-booking', expected: WEDNESDAY })).status, 200);
    const chat = storedChat(both, WEB)!;
    assert.equal(chat.cancellationRequest, undefined);
    assert.deepEqual([chat.confirmedBooking?.date, chat.earlierBookings, chat.status, chat.attentionReason], ['2026-10-07', undefined, 'booked', undefined]);
    // The customer's old cancellation can no longer be answered by a card that names Tuesday.
    assert.equal((await answer({ type: 'cancel-booking', expected: TUESDAY })).status, 400);
  });
});

test('a refused message is taken back without undoing a request the customer sent meanwhile', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ waId: TG, channel: 'Telegram', status: 'needs-attention', bookingRequest: OPEN }));
  let sends = 0;
  const base = outsideWorld({ ai: bookingAnswer({ date: '2026-10-08', time: '11:00' }) });
  const world: World = {
    ...base,
    outside: async (url, body) => {
      if (url.endsWith('/sendMessage') && (sends += 1) === 1) {
        // While Telegram is slow with the owner's confirmation, the customer asks for Thursday 11:00.
        await telegramWebhook(telegramUpdate('Thursday 11:00 instead, Eva'));
        return new Response(JSON.stringify({ ok: false, error_code: 502, description: 'refused' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
      return base.outside(url, body);
    },
  };
  await run(world, store, async () => {
    assert.equal((await act(ownerAction({ type: 'confirm-booking', conversationId: TG_ID, expected: TUESDAY }))).status, 502);
  });
  const chat = storedChat(store, TG)!;
  // The confirmation that did not go out is gone, and so is what it confirmed.
  assert.deepEqual(chat.messages.map(message => message.sender), ['customer', 'customer', 'ai']);
  assert.equal(chat.confirmedBooking, undefined);
  // The Thursday request survives, and the chat waits for the owner with its reason.
  assert.deepEqual([chat.bookingRequest?.date, chat.bookingRequest?.time, chat.bookingRequest?.status], ['2026-10-08', '11:00', 'requested']);
  assert.equal(chat.status, 'needs-attention');
  assert.match(chat.attentionReason!, /^Booking request: Haircut on Thursday, 08\.10\.2026 at 11:00 for Eva\./);
});

test('several appointments from one chat: each stays known, and a wish to cancel or move one goes to the owner instead of a guessed card', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ status: 'booked', bookingRequest: CONFIRMED }));
  const world = outsideWorld({
    ai: call => call === 1 ? bookingAnswer(FRIDAY, { intent: 'new' })
      : call === 2 ? aiAnswer({ intent: 'cancel', reply: 'Your appointment is cancelled.' })
        : call === 3 ? bookingAnswer({ date: '2026-10-08', time: '11:00' }, { intent: 'change', reply: 'Moved!' })
          : aiAnswer(),
  });
  await run(world, store, async () => {
    await writeChat(post('Also book Friday 15:00 for my second cut'));
    assert.match(storedChat(store, WEB)!.attentionReason!, /The appointment Haircut on Tuesday, 06\.10\.2026 at 10:00 for Eva stays booked\./);
    assert.equal((await answer({ type: 'confirm-booking', expected: FRIDAY })).status, 200);
    let chat = storedChat(store, WEB)!;
    assert.deepEqual([chat.confirmedBooking?.date, chat.earlierBookings?.map(booking => booking.date)], ['2026-10-09', ['2026-10-06']]);
    assert.equal(chat.status, 'booked');

    const cancel = (await (await writeChat(post('Please cancel my appointment'))).json()) as { messages: { text: string }[] };
    assert.equal(cancel.messages.at(-1)!.text, fixedReply('passedOn', 'EN').original);
    chat = storedChat(store, WEB)!;
    assert.equal(chat.cancellationRequest, undefined);
    assert.equal(chat.status, 'needs-attention');
    assert.equal(chat.attentionReason, 'The customer wants to cancel an appointment, and several are booked in this chat: Haircut on Tuesday, 06.10.2026 at 10:00 for Eva; Haircut on Friday, 09.10.2026 at 15:00 for Eva. Ask which one is meant and reply yourself.');

    const move = (await (await writeChat(post('Move it to Thursday 11:00'))).json()) as { messages: { text: string }[] };
    assert.equal(move.messages.at(-1)!.text, fixedReply('passedOn', 'EN').original);
    chat = storedChat(store, WEB)!;
    assert.equal(chat.bookingRequest?.status, 'confirmed');
    assert.match(chat.attentionReason!, /^The customer wants to move an appointment to Haircut on Thursday, 08\.10\.2026 at 11:00 for Eva, and several are booked/);

    // The AI is told of both.
    await writeChat(post('Thanks'));
    assert.match(world.prompts[3], /Confirmed appointment: Haircut on Tuesday, 06\.10\.2026 at 10:00[\s\S]*Confirmed appointment: Haircut on Friday, 09\.10\.2026 at 15:00/);
  });

  // Cancelling one of them (the owner made sure which) keeps the other known.
  const one = new FakeStore(NOW);
  putChat(one, liveChat({
    status: 'needs-attention', earlierBookings: [CONFIRMED], confirmedBooking: { ...CONFIRMED, ...FRIDAY }, bookingRequest: { ...CONFIRMED, ...FRIDAY },
    cancellationRequest: { service: 'Haircut', ...FRIDAY },
  }));
  await run(outsideWorld(), one, async () => {
    assert.equal((await answer({ type: 'cancel-booking', expected: FRIDAY })).status, 200);
  });
  const left = storedChat(one, WEB)!;
  assert.match(left.messages.at(-1)!.original, /Friday, 09\.10\.2026 at 15:00 is cancelled/);
  assert.deepEqual([left.confirmedBooking?.date, left.earlierBookings, left.bookingRequest?.date, left.status], ['2026-10-06', undefined, '2026-10-06', 'booked']);
});

test('an appointment that is over no longer counts: no "stays booked" note, no change guessed from it', async (t) => {
  freezeClock(t);
  const past = { ...CONFIRMED, date: '2026-10-01' };
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ status: 'booked', bookingRequest: past }));
  const world = outsideWorld({ ai: call => call === 1 ? bookingAnswer({}, { intent: 'new' }) : bookingAnswer({ date: '2026-10-07', time: '11:00' }, { intent: 'change' }) });
  await run(world, store, async () => {
    await writeChat(post('A haircut on Tuesday at 10, I am Eva'));
    let chat = storedChat(store, WEB)!;
    assert.equal(chat.attentionReason, 'Booking request: Haircut on Tuesday, 06.10.2026 at 10:00 for Eva. Please confirm.');
    assert.doesNotMatch(world.prompts[0], /Confirmed appointment/);
    await writeChat(post('Move it to Wednesday 11:00'));
    chat = storedChat(store, WEB)!;
    assert.deepEqual([chat.bookingRequest?.kind, chat.bookingRequest?.previous], ['new', undefined]);
    assert.match(chat.attentionReason!, /The customer wants to move an appointment that was not booked in this chat\./);
  });
});

test('a "yes" to a time offered instead of a change moves the appointment; it does not book a second one', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ status: 'booked', bookingRequest: CONFIRMED }));
  const world = outsideWorld({
    // The AI calls the "yes" a new booking (the local stand-in does, and a real model may).
    ai: call => call === 1 ? bookingAnswer(WEDNESDAY, { intent: 'change' }) : bookingAnswer({ date: '2026-10-07', time: '15:00' }, { intent: 'new' }),
  });
  await run(world, store, async () => {
    await writeChat(post('Move to Wednesday 14:00?'));
    assert.equal((await answer({ type: 'suggest-time', expected: WEDNESDAY, date: '2026-10-07', time: '15:00' })).status, 200);
    assert.deepEqual(storedChat(store, WEB)!.suggestion, { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-07', time: '15:00', kind: 'change', previous: TUESDAY });
    await writeChat(post('yes'));
  });
  const chat = storedChat(store, WEB)!;
  assert.deepEqual([chat.bookingRequest?.kind, chat.bookingRequest?.previous, chat.bookingRequest?.time], ['change', TUESDAY, '15:00']);
  assert.match(chat.attentionReason!, /^Change request: Haircut on Wednesday, 07\.10\.2026 at 15:00 for Eva, instead of Tuesday, 06\.10\.2026 at 10:00\./);
});

test('after every answer the chat shows what still waits: no reason outlives its request, and a standing appointment reads "booked"', async (t) => {
  freezeClock(t);
  // A further request is open when the owner agrees to cancel: the chat still needs her, for that request.
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ status: 'booked', bookingRequest: CONFIRMED }));
  const world = outsideWorld({ ai: call => call === 1 ? bookingAnswer(FRIDAY, { intent: 'new' }) : aiAnswer({ intent: 'cancel', reply: 'ok' }) });
  await run(world, store, async () => {
    await writeChat(post('Also Friday 15:00'));
    await writeChat(post('and cancel the Tuesday one'));
    // Two appointments are not standing yet (Friday waits), so the Tuesday one gets a card.
    assert.deepEqual(storedChat(store, WEB)!.cancellationRequest, { service: 'Haircut', ...TUESDAY, customerName: 'Eva' });
    assert.equal((await answer({ type: 'cancel-booking', expected: TUESDAY })).status, 200);
    const chat = storedChat(store, WEB)!;
    assert.equal(chat.status, 'needs-attention');
    assert.match(chat.attentionReason!, /^Booking request: Haircut on Friday, 09\.10\.2026 at 15:00 for Eva\. Please confirm\./);
    assert.doesNotMatch(chat.attentionReason!, /stands until you answer/);
  });
  // A change declined, or answered with another time: the appointment stands, so the chat reads "booked".
  for (const action of [{ type: 'decline-booking', expected: WEDNESDAY }, { type: 'suggest-time', expected: WEDNESDAY, date: '2026-10-08', time: '11:00' }]) {
    const declined = new FakeStore(NOW);
    putChat(declined, liveChat({ status: 'booked', bookingRequest: CONFIRMED }));
    await run(outsideWorld({ ai: bookingAnswer(WEDNESDAY, { intent: 'change' }) }), declined, async () => {
      await writeChat(post('Move to Wed 14:00?'));
      assert.equal((await answer(action)).status, 200);
    });
    const chat = storedChat(declined, WEB)!;
    assert.deepEqual([chat.status, chat.attentionReason, chat.bookingRequest?.status, chat.bookingRequest?.date], ['booked', undefined, 'confirmed', '2026-10-06'], action.type);
  }
  // A chat the owner took over is hers once nothing waits, also after a confirmation.
  const taken = new FakeStore(NOW);
  putChat(taken, liveChat({ status: 'needs-attention', takenOver: true, bookingRequest: OPEN }));
  await run(outsideWorld(), taken, async () => { assert.equal((await answer({ type: 'confirm-booking', expected: TUESDAY })).status, 200); });
  assert.deepEqual([storedChat(taken, WEB)!.status, storedChat(taken, WEB)!.attentionReason], ['owner-handled', undefined]);
});

test('Cancel and Keep name the cancellation they answer', async (t) => {
  freezeClock(t);
  for (const type of ['cancel-booking', 'keep-booking']) {
    const store = new FakeStore(NOW);
    putChat(store, liveChat({ status: 'needs-attention', bookingRequest: CONFIRMED, cancellationRequest: { service: 'Haircut', ...TUESDAY } }));
    await run(outsideWorld(), store, async () => {
      assert.deepEqual(await answer({ type, expected: FRIDAY }), { status: 409, body: { error: 'The customer changed the cancellation request in the meantime. Look at it again.' } }, type);
      assert.deepEqual(storedChat(store, WEB)!.cancellationRequest, { service: 'Haircut', ...TUESDAY });
      assert.equal((await answer({ type, expected: TUESDAY })).status, 200, type);
    });
    const chat = storedChat(store, WEB)!;
    assert.equal(chat.cancellationRequest, undefined);
    if (type === 'cancel-booking') {
      assert.equal(chat.messages.at(-1)!.original, chatBookingMessage('cancelled', { language: 'EN', customerName: 'Eva', salonName, serviceName: 'Haircut', ...TUESDAY }).original);
      assert.equal(chat.status, 'ai-handled');
    } else {
      assert.deepEqual([chat.status, chat.takenOver], ['owner-handled', true]);
    }
  }
});

test('the answer names the service, the person and the stylist asked for: the same time for something else is another request', async (t) => {
  freezeClock(t);
  const card = { ...TUESDAY, service: 'Haircut', customerName: 'Eva' };
  for (const changed of [{ service: 'Colouring' }, { customerName: 'Tom' }, { staffName: 'Luca' }] as Record<string, string>[]) {
    const store = new FakeStore(NOW);
    // The card shows "Haircut on Tuesday 10:00 for Eva"; before her page looks again, the customer changes it at the same time.
    putChat(store, liveChat({ status: 'needs-attention', bookingRequest: OPEN }));
    await run(outsideWorld({ ai: bookingAnswer({ ...TUESDAY, ...changed }) }), store, async () => {
      await writeChat(post('Same time, but something else'));
      const what = JSON.stringify(changed);
      assert.deepEqual(await answer({ type: 'confirm-booking', expected: card }), { status: 409, body: { error: 'The customer changed the request in the meantime. Look at it again.' } }, what);
      assert.equal((await answer({ type: 'decline-booking', expected: card })).status, 409, what);
      assert.deepEqual(salonMessages(storedChat(store, WEB)!), [], what);
    });
  }
  // What the card shows goes through, whatever the letter case; a page of an earlier version (day and time only) as before.
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ status: 'needs-attention', bookingRequest: { ...OPEN, staffName: 'Luca Frei', employeeId: 'emp-3' } }));
  await run(outsideWorld(), store, async () => {
    assert.equal((await answer({ type: 'confirm-booking', expected: card })).status, 409); // the card must name the stylist asked for
    assert.equal((await answer({ type: 'confirm-booking', expected: { ...card, service: 'haircut', staffName: 'Luca Frei' } })).status, 200);
    // Asked again after a lost answer: done, also when the owner gave it to another stylist; not for another service.
    assert.equal((await answer({ type: 'confirm-booking', expected: { ...card, staffName: 'Luca Frei' }, staffName: 'Anna Weber' })).status, 200);
    assert.equal((await answer({ type: 'confirm-booking', expected: { ...card, service: 'Colouring' } })).status, 400);
    assert.equal(salonMessages(storedChat(store, WEB)!).length, 1);
  });
  // A wish to cancel names its service too.
  const cancelling = new FakeStore(NOW);
  putChat(cancelling, liveChat({ status: 'needs-attention', bookingRequest: CONFIRMED, cancellationRequest: { service: 'Haircut', ...TUESDAY } }));
  await run(outsideWorld(), cancelling, async () => {
    assert.equal((await answer({ type: 'cancel-booking', expected: { ...TUESDAY, service: 'Colouring' } })).status, 409);
    assert.equal((await answer({ type: 'keep-booking', expected: { ...TUESDAY, service: 'Colouring' } })).status, 409);
    assert.equal((await answer({ type: 'cancel-booking', expected: { ...TUESDAY, service: 'Haircut' } })).status, 200);
  });
});

test('the reason of a waiting request is written from the chat as it is: a cancelled appointment no longer "stays booked"', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ status: 'booked', bookingRequest: CONFIRMED }));
  const world = outsideWorld({ ai: call => call === 1 ? bookingAnswer({ ...FRIDAY, staffName: 'Lukas' }, { intent: 'new' }) : aiAnswer({ intent: 'cancel', reply: 'ok' }) });
  await run(world, store, async () => {
    await writeChat(post('Also Friday 15:00 with Lukas'));
    assert.equal(storedChat(store, WEB)!.attentionReason, 'Booking request: Haircut on Friday, 09.10.2026 at 15:00 for Eva. Please confirm. The customer asked for "Lukas", who is not on the team. The appointment Haircut on Tuesday, 06.10.2026 at 10:00 for Eva stays booked.');
    await writeChat(post('and cancel the Tuesday one'));
    assert.equal((await answer({ type: 'cancel-booking', expected: TUESDAY })).status, 200);
  });
  // The note about the stylist the rule check found stays; the one about Tuesday is gone with it.
  assert.equal(storedChat(store, WEB)!.attentionReason, 'Booking request: Haircut on Friday, 09.10.2026 at 15:00 for Eva. Please confirm. The customer asked for "Lukas", who is not on the team.');
});

test('two appointments at the same day and time for two people both stay known', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ status: 'booked', bookingRequest: { ...CONFIRMED, employeeId: 'emp-1', staffName: 'Anna Weber' } }));
  const world = outsideWorld({
    ai: call => call === 1
      ? bookingAnswer({ service: "Children's cut", ...TUESDAY, customerName: 'Mia', staffName: 'Luca' }, { intent: 'new' })
      : call === 2 ? aiAnswer({ intent: 'cancel', reply: 'ok' }) : aiAnswer(),
  });
  await run(world, store, async () => {
    await writeChat(post("And a children's cut for Mia at the same time with Luca"));
    assert.equal((await answer({ type: 'confirm-booking', expected: { ...TUESDAY, service: "Children's cut", customerName: 'Mia', staffName: 'Luca Frei' } })).status, 200);
    const chat = storedChat(store, WEB)!;
    assert.deepEqual([chat.earlierBookings?.map(booking => booking.customerName), chat.confirmedBooking?.customerName], [['Eva'], 'Mia']);
    await writeChat(post('Please cancel my appointment'));
    await writeChat(post('Thanks'));
  });
  const chat = storedChat(store, WEB)!;
  // Two appointments ahead: no card for a guessed one, and the AI is told of both.
  assert.equal(chat.cancellationRequest, undefined);
  assert.match(chat.attentionReason!, /several are booked in this chat: Haircut on Tuesday, 06\.10\.2026 at 10:00 for Eva; Children's cut on Tuesday, 06\.10\.2026 at 10:00 for Mia\./);
  assert.equal((world.prompts[2].match(/Confirmed appointment: /g) ?? []).length, 2);
});

test('"Let AI continue" and "mark done" leave a chat in "needs attention" while a request or a wish to cancel waits', async (t) => {
  freezeClock(t);
  const cases: { chat: Partial<LiveConversation>; reason: string }[] = [
    { chat: { bookingRequest: OPEN }, reason: 'Booking request: Haircut on Tuesday, 06.10.2026 at 10:00 for Eva. Please confirm.' },
    { chat: { bookingRequest: CONFIRMED, cancellationRequest: { service: 'Haircut', ...TUESDAY } }, reason: 'Cancellation request: Haircut on Tuesday, 06.10.2026 at 10:00 for Eva. The appointment stands until you answer.' },
  ];
  for (const { chat: waiting, reason } of cases) {
    for (const action of [{ type: 'let-ai-continue' }, { type: 'let-ai-continue', answerNow: true }, { type: 'mark-done' }]) {
      const store = new FakeStore(NOW);
      putChat(store, liveChat({ status: 'needs-attention', takenOver: true, attentionReason: 'New message: you are handling this chat.', ...waiting }));
      await run(outsideWorld(), store, async () => { assert.equal((await answer(action)).status, 200); });
      const chat = storedChat(store, WEB)!;
      const where = `${action.type}${action.answerNow ? ' now' : ''} with ${waiting.cancellationRequest ? 'a cancellation' : 'a request'}`;
      assert.deepEqual([chat.status, chat.attentionReason, chat.takenOver], ['needs-attention', reason, action.type === 'mark-done'], where);
    }
  }
  // Nothing waits: handed back, the chat is the AI's again, or "booked" while its appointment lies ahead.
  for (const [extra, status] of [[{}, 'ai-handled'], [{ bookingRequest: CONFIRMED }, 'booked']] as const) {
    const store = new FakeStore(NOW);
    putChat(store, liveChat({ status: 'needs-attention', takenOver: true, attentionReason: 'New message: you are handling this chat.', ...extra }));
    await run(outsideWorld(), store, async () => { assert.equal((await answer({ type: 'let-ai-continue' })).status, 200); });
    assert.deepEqual([storedChat(store, WEB)!.status, storedChat(store, WEB)!.attentionReason], [status, undefined]);
  }
});
