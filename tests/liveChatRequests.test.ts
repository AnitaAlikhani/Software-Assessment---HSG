/**
 * The live chat's server for given AI answers: what reaches the customer, what the owner sees, and
 * that nothing is lost or doubled when messages and owner actions arrive close together. The AI's
 * answers are fixed here; how the real model answers is checked by hand before a release.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DELETE as deleteChat, GET as readChat, POST as writeChat } from '../api/chat';
import { POST as telegramWebhook } from '../api/telegram/webhook';
import { POST as act } from '../api/whatsapp/action';
import { GET as ownerInbox } from '../api/whatsapp/conversations';
import { checkBookingRequest, cleanName, strictDate, strictTime, validBookingRequest } from '../server/bookingRules';
import { fixedReply } from '../server/chatReplies';
import { TAKEN_OVER_REASON, UNANSWERED } from '../server/recordAnalysis';
import { DELETE_SCRIPT, SAVE_SCRIPT } from '../server/store';
import type { LiveConversation } from '../server/whatsappCore';
import { chatBookingMessage } from '../src/chatTemplates';
import { initialCompanySettings } from '../src/mockData';
import type { ChatLanguage } from '../src/types';
import { Command, deployedWith, FakeStore } from './fakeStore';
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
type VisitorBody = { messages: { from: string; text: string }[]; answeredBy?: string; aiFailed?: boolean; error?: string };
const run = (world: World, store: FakeStore, work: () => Promise<unknown>) => quietly(() => deployedWith(SETTINGS, work, { store, outside: world.outside }));
const inbox = async () => {
  const response = await ownerInbox(new Request('https://site.invalid/api/whatsapp/conversations', { headers: { 'x-live-key': 'right-key' } }));
  return ((await response.json()) as { conversations: (LiveConversation & { id: string })[] }).conversations;
};
/** An open request for a haircut on Tuesday 6 October at 10:00, as the AI leaves it for the owner. */
const OPEN = { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-06', time: '10:00', customerName: 'Eva', status: 'requested' as const, kind: 'new' as const };
const CONFIRMED = { ...OPEN, status: 'confirmed' as const };
/** Lets the customer delete the chat just before the next save of it reaches the storage. */
const deleteBeforeNextSave = (store: FakeStore, waId: string) => {
  const run = store.run.bind(store);
  let armed = false;
  store.run = (command: Command) => {
    if (armed && command[1] === SAVE_SCRIPT) {
      armed = false;
      run(['EVAL', DELETE_SCRIPT, 3, command[3], command[4], 'slotbee:live:index', 'another-request', 600, waId]);
    }
    return run(command);
  };
  return () => { armed = true; };
};

test('the same booking request twice adds nothing: no second card, and a confirmed chat is not reopened', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld({ ai: bookingAnswer() });
  await run(world, store, async () => {
    await writeChat(post('A haircut on Tuesday at 10, I am Eva'));
    const first = storedChat(store, WEB)!;
    assert.equal(first.status, 'needs-attention');
    assert.deepEqual(first.bookingRequest, OPEN);
    // The owner hands the chat back to the AI (the request still waits for her). The customer asks once more.
    assert.equal((await act(ownerAction({ type: 'let-ai-continue', conversationId: WEB_ID }))).status, 200);
    const again = (await (await writeChat(post('Haircut Tuesday 10:00 please'))).json()) as VisitorBody;
    // The AI's "I have sent your request" would be wrong: a fixed sentence says it is waiting.
    assert.equal(again.messages.at(-1)!.text, fixedReply('alreadyRequested', 'EN').original);
    let chat = storedChat(store, WEB)!;
    // Nothing new: the one card, and the same reason as before.
    assert.deepEqual([chat.status, chat.attentionReason], [first.status, first.attentionReason]);
    assert.deepEqual(chat.bookingRequest, first.bookingRequest);

    assert.equal((await act(ownerAction({ type: 'confirm-booking', conversationId: WEB_ID }))).status, 200);
    await writeChat(post('So Tuesday 10:00 haircut for Eva, right?'));
    chat = storedChat(store, WEB)!;
    assert.equal(chat.status, 'booked');
    assert.deepEqual(chat.bookingRequest, CONFIRMED);
    assert.equal(chat.messages.at(-1)!.original, fixedReply('alreadyConfirmed', 'EN').original);
    // One card in the owner's list, never two.
    assert.equal((await inbox()).length, 1);
  });
});

test('a request the rule check refuses: the AI reply is not sent, the owner gets the reason, the customer a safe fixed sentence', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  // Monday 12 October: the salon is closed. The AI says it passed the request on anyway.
  const world = outsideWorld({ ai: bookingAnswer({ date: '2026-10-12' }, { languageCode: 'de', languageName: 'German', reply: 'Ich habe Ihre Anfrage an den Salon gesendet.' }) });
  await run(world, store, async () => {
    assert.equal((await telegramWebhook(telegramUpdate('Haarschnitt am Montag um 10 Uhr, ich bin Eva'))).status, 200);
  });
  assert.deepEqual(world.sent.map(message => message.text), [fixedReply('passedOn', 'DE').original]);
  const chat = storedChat(store, TG)!;
  assert.equal(chat.bookingRequest, undefined);
  assert.equal(chat.status, 'needs-attention');
  assert.match(chat.attentionReason!, /^Booking request not passed on: the salon is closed on Mondays\./);
  assert.deepEqual(chat.messages.map(message => [message.sender, message.original]), [
    ['customer', 'Haarschnitt am Montag um 10 Uhr, ich bin Eva'], ['ai', fixedReply('passedOn', 'DE').original],
  ]);
  // The owner reads the fixed sentence in English or German, like every other message.
  assert.equal(chat.messages[1].translation, fixedReply('passedOn', 'EN').original);
});

test('two messages in parallel: both are kept, and so are both answers', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  let second: VisitorBody | null = null;
  const world = outsideWorld({
    ai: call => aiAnswer({ reply: `Answer ${call}`, replyEn: `Answer ${call}` }),
    // While the AI reads the first message, the second one arrives (the chat is open twice).
    whileAiWorks: async (call) => { if (call === 1) second = (await (await writeChat(post('Second message'))).json()) as VisitorBody; },
  });
  await run(world, store, async () => {
    const first = (await (await writeChat(post('First message'))).json()) as VisitorBody;
    assert.equal(first.messages.length, 4);
  });
  assert.deepEqual(second!.messages.map(message => message.text), ['First message', 'Second message', 'Answer 2']);
  assert.deepEqual(storedChat(store, WEB)!.messages.map(message => message.original), ['First message', 'Second message', 'Answer 2', 'Answer 1']);
});

test('an owner action in parallel with a customer message: neither overwrites the other', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ status: 'needs-attention', bookingRequest: OPEN }));
  const world = outsideWorld({
    ai: aiAnswer({ reply: 'You are welcome!', replyEn: 'You are welcome!' }),
    whileAiWorks: async (call) => { if (call === 1) assert.equal((await act(ownerAction({ type: 'confirm-booking', conversationId: WEB_ID }))).status, 200); },
  });
  await run(world, store, async () => { await writeChat(post('Thank you!')); });
  const chat = storedChat(store, WEB)!;
  assert.deepEqual(chat.messages.map(message => [message.sender, message.original]), [
    ['customer', 'Hello'], ['customer', 'Thank you!'],
    ['owner', chatBookingMessage('confirmed', { language: 'EN', customerName: 'Eva', salonName, serviceName: 'Haircut', date: '2026-10-06', time: '10:00' }).original],
    ['ai', 'You are welcome!'],
  ]);
  assert.equal(chat.status, 'booked');
  assert.equal(chat.bookingRequest?.status, 'confirmed');
});

test('the owner takes over while the AI reads: its reply is not sent, and the message waits for her', async (t) => {
  freezeClock(t);
  for (const ownerReplies of [false, true]) {
    const store = new FakeStore(NOW);
    const world = outsideWorld({
      whileAiWorks: async (call) => {
        if (call !== 1) return;
        const action = ownerReplies ? { type: 'reply', conversationId: TG_ID, text: 'I am here.' } : { type: 'take-over', conversationId: TG_ID };
        assert.equal((await act(ownerAction(action))).status, 200);
      },
    });
    await run(world, store, async () => { await telegramWebhook(telegramUpdate('Can I bring my dog?')); });
    const chat = storedChat(store, TG)!;
    assert.deepEqual(world.sent.map(message => message.text), ownerReplies ? ['I am here.'] : []);
    assert.ok(!chat.messages.some(message => message.sender === 'ai'));
    // The message was stored before the AI ran, so the owner has it either way.
    assert.equal(chat.messages[0].original, 'Can I bring my dog?');
    if (ownerReplies) assert.equal(chat.status, 'owner-handled');
    else assert.deepEqual([chat.status, chat.attentionReason], ['needs-attention', TAKEN_OVER_REASON]);
  }
});

test('a message into a chat the owner took over asks for her, and the visitor sees that the team answers', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ takenOver: true, status: 'owner-handled' }));
  const world = outsideWorld({ ai: aiAnswer({ translationEn: 'Are you there?', reply: 'Sure!' }) });
  await run(world, store, async () => {
    const body = (await (await writeChat(post('Are you there?'))).json()) as VisitorBody;
    assert.equal(body.answeredBy, 'team');
    assert.deepEqual(body.messages.map(message => message.from), ['me', 'me']); // no AI reply
    const chat = storedChat(store, WEB)!;
    assert.deepEqual([chat.status, chat.attentionReason], ['needs-attention', TAKEN_OVER_REASON]);
    assert.equal(((await (await readChat(chatRequest('GET', { session: SESSION }))).json()) as VisitorBody).answeredBy, 'team');
    await act(ownerAction({ type: 'let-ai-continue', conversationId: WEB_ID }));
    assert.equal(((await (await readChat(chatRequest('GET', { session: SESSION }))).json()) as VisitorBody).answeredBy, 'assistant');
  });
  // The AI still translated the message for the owner.
  assert.equal(world.prompts.length, 1);
});

test('a change and a cancellation wait for the owner and never remove the confirmed appointment by themselves', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ language: 'FR', languageLabel: 'French', status: 'booked', bookingRequest: CONFIRMED }));
  const french = { languageCode: 'fr', languageName: 'French' };
  const world = outsideWorld({
    ai: call => call === 1
      ? bookingAnswer({ date: '2026-10-07', time: '14:00' }, { ...french, intent: 'change', reply: 'Je transmets le changement au salon.' })
      : aiAnswer({ ...french, intent: 'cancel', reply: 'Votre rendez-vous est annulé.' }),
  });
  const message = (kind: 'declined' | 'cancelled', date: string, time: string) =>
    chatBookingMessage(kind, { language: 'FR', customerName: 'Eva', salonName, serviceName: 'Haircut', date, time }).original;
  await run(world, store, async () => {
    await writeChat(post('Est-ce que je peux venir mercredi à 14h plutôt ?'));
    let chat = storedChat(store, WEB)!;
    assert.deepEqual(chat.bookingRequest, { ...OPEN, date: '2026-10-07', time: '14:00', kind: 'change', previous: { date: '2026-10-06', time: '10:00' } });
    assert.deepEqual(chat.confirmedBooking, CONFIRMED);
    assert.match(chat.attentionReason!, /^Change request: Haircut on Wednesday, 07\.10\.2026 at 14:00 for Eva, instead of Tuesday, 06\.10\.2026 at 10:00\./);
    // The owner's page gets the change with the time it replaces.
    assert.deepEqual((await inbox())[0].bookingRequest?.previous, { date: '2026-10-06', time: '10:00' });

    // Declined: the customer is told, and the appointment that was confirmed stands again.
    assert.equal((await act(ownerAction({ type: 'decline-booking', conversationId: WEB_ID }))).status, 200);
    chat = storedChat(store, WEB)!;
    assert.equal(chat.messages.at(-1)!.original, message('declined', '2026-10-07', '14:00'));
    assert.deepEqual(chat.bookingRequest, CONFIRMED);

    // A wish to cancel: the AI's "cancelled" is not sent; the owner decides.
    const body = (await (await writeChat(post('Finalement je voudrais annuler mon rendez-vous.'))).json()) as VisitorBody;
    assert.equal(body.messages.at(-1)!.text, fixedReply('cancelPassedOn', 'FR').original);
    chat = storedChat(store, WEB)!;
    assert.deepEqual(chat.cancellationRequest, { service: 'Haircut', date: '2026-10-06', time: '10:00', customerName: 'Eva' });
    assert.deepEqual(chat.bookingRequest, CONFIRMED);
    assert.equal(chat.status, 'needs-attention');
    assert.match(chat.attentionReason!, /^Cancellation request: Haircut on Tuesday, 06\.10\.2026 at 10:00 for Eva\./);

    assert.equal((await act(ownerAction({ type: 'cancel-booking', conversationId: WEB_ID }))).status, 200);
    chat = storedChat(store, WEB)!;
    assert.equal(chat.messages.at(-1)!.original, message('cancelled', '2026-10-06', '10:00'));
    assert.equal(chat.bookingRequest, undefined);
    assert.equal(chat.cancellationRequest, undefined);
    assert.equal(chat.confirmedBooking, undefined);
    assert.equal(chat.status, 'ai-handled');
  });
});

test('every owner answer sends its fixed message, in a German and in a French chat', async (t) => {
  freezeClock(t);
  for (const language of ['DE', 'FR'] as ChatLanguage[]) {
    const base = { language, customerName: 'Eva', salonName, serviceName: 'Haircut' };
    const cases: { action: Record<string, unknown>; chat?: Partial<LiveConversation>; sent: string[]; check: (chat: LiveConversation) => void }[] = [
      {
        action: { type: 'confirm-booking', staffName: 'Selina Keller' },
        sent: [chatBookingMessage('confirmed', { ...base, staffName: 'Selina Keller', date: '2026-10-06', time: '10:00' }).original],
        check: chat => {
          assert.deepEqual(chat.bookingRequest, { ...CONFIRMED, employeeId: 'emp-2', staffName: 'Selina Keller' });
          assert.equal(chat.status, 'booked');
          assert.equal(chat.takenOver, false); // confirming does not pause the AI
        },
      },
      {
        action: { type: 'suggest-time', date: '2026-10-07', time: '11:00' },
        sent: [chatBookingMessage('suggested', { ...base, date: '2026-10-07', time: '11:00', askedDate: '2026-10-06', askedTime: '10:00' }).original],
        check: chat => {
          assert.equal(chat.bookingRequest, undefined);
          assert.deepEqual(chat.suggestion, { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-07', time: '11:00' });
          assert.equal(chat.status, 'ai-handled');
        },
      },
      {
        action: { type: 'decline-booking' },
        sent: [chatBookingMessage('declined', { ...base, date: '2026-10-06', time: '10:00' }).original],
        check: chat => { assert.equal(chat.bookingRequest, undefined); assert.equal(chat.status, 'ai-handled'); },
      },
      {
        action: { type: 'cancel-booking' },
        chat: { status: 'needs-attention', bookingRequest: CONFIRMED, cancellationRequest: { service: 'Haircut', date: '2026-10-06', time: '10:00' } },
        sent: [chatBookingMessage('cancelled', { ...base, date: '2026-10-06', time: '10:00' }).original],
        check: chat => { assert.equal(chat.bookingRequest, undefined); assert.equal(chat.cancellationRequest, undefined); },
      },
      {
        action: { type: 'keep-booking' },
        chat: { status: 'needs-attention', bookingRequest: CONFIRMED, cancellationRequest: { service: 'Haircut', date: '2026-10-06', time: '10:00' } },
        sent: [],
        check: chat => {
          assert.deepEqual(chat.bookingRequest, CONFIRMED);
          assert.equal(chat.cancellationRequest, undefined);
          assert.deepEqual([chat.takenOver, chat.status], [true, 'owner-handled']); // she writes to the customer herself
        },
      },
      {
        action: { type: 'mark-done' },
        sent: [],
        // The request still waits for her answer, so the chat stays in "Needs you", with the request's reason.
        check: chat => {
          assert.deepEqual([chat.status, chat.attentionReason], ['needs-attention', 'Booking request: Haircut on Tuesday, 06.10.2026 at 10:00 for Eva. Please confirm.']);
          assert.deepEqual(chat.bookingRequest, OPEN);
        },
      },
      {
        action: { type: 'let-ai-continue', answerNow: true },
        chat: { takenOver: true, status: 'needs-attention', attentionReason: TAKEN_OVER_REASON },
        sent: ['Gern, wir öffnen um 8:30.'],
        check: chat => {
          assert.equal(chat.takenOver, false);
          assert.deepEqual(chat.messages.at(-1)!.original, 'Gern, wir öffnen um 8:30.');
          // The AI answers again, but the booking request still waits for her: the chat stays in "Needs you".
          assert.deepEqual([chat.status, chat.attentionReason], ['needs-attention', 'Booking request: Haircut on Tuesday, 06.10.2026 at 10:00 for Eva. Please confirm.']);
        },
      },
    ];
    for (const { action, chat: extra, sent, check } of cases) {
      const store = new FakeStore(NOW);
      putChat(store, liveChat({
        waId: TG, channel: 'Telegram', language, languageLabel: language === 'DE' ? 'German' : 'French', status: 'needs-attention', bookingRequest: OPEN,
        messages: [{ id: 'm1', sender: 'customer', original: 'Wann öffnet ihr?', translation: 'When do you open?', time: '12:00' }],
        ...extra,
      }));
      const world = outsideWorld({ ai: aiAnswer({ languageCode: language.toLowerCase(), reply: 'Gern, wir öffnen um 8:30.' }) });
      const where = `${language} ${String(action.type)}`;
      await run(world, store, async () => {
        const response = await act(ownerAction({ ...action, conversationId: TG_ID }));
        assert.equal(response.status, 200, where);
        assert.ok(Array.isArray(((await response.json()) as { conversations: unknown[] }).conversations), where);
      });
      assert.deepEqual(world.sent.map(message => message.text), sent, where);
      const chat = storedChat(store, TG)!;
      check(chat);
      if (sent.length && action.type !== 'let-ai-continue') {
        // The owner reads the same message in English and German; no AI wrote or translated it.
        const message = chat.messages.at(-1)!;
        assert.equal(message.sender, 'owner', where);
        assert.ok(message.translation.length > 0 && message.translationDe!.length > 0, where);
        assert.equal(world.prompts.length, 0, where);
      }
    }
  }
});

test('after another time was suggested, the AI is told, and the customer\'s "yes" becomes a request for it', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ status: 'needs-attention', bookingRequest: OPEN }));
  const world = outsideWorld({ ai: bookingAnswer({ date: '2026-10-07', time: '11:00' }) });
  await run(world, store, async () => {
    await act(ownerAction({ type: 'suggest-time', conversationId: WEB_ID, date: '2026-10-07', time: '11:00' }));
    await writeChat(post('Yes, that works'));
  });
  assert.match(world.prompts[0], /The salon offered Haircut on Wednesday, 07\.10\.2026 at 11:00 \(date 2026-10-07, time 11:00\)/);
  const chat = storedChat(store, WEB)!;
  assert.deepEqual(chat.bookingRequest, { ...OPEN, date: '2026-10-07', time: '11:00' });
  assert.equal(chat.suggestion, undefined);
});

test('the owner\'s answers refuse what does not fit, in words she can read', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat());
  const world = outsideWorld();
  const errorOf = async (action: Record<string, unknown>) => {
    const response = await act(ownerAction({ ...action, conversationId: WEB_ID }));
    return [response.status, ((await response.json()) as { error?: string }).error];
  };
  await run(world, store, async () => {
    assert.deepEqual(await errorOf({ type: 'confirm-booking' }), [400, 'There is no open booking request in this chat.']);
    assert.deepEqual(await errorOf({ type: 'decline-booking' }), [400, 'There is no open booking request in this chat.']);
    assert.deepEqual(await errorOf({ type: 'cancel-booking' }), [400, 'There is no cancellation request in this chat.']);
    assert.deepEqual(await errorOf({ type: 'keep-booking' }), [400, 'There is no cancellation request in this chat.']);
    putChat(store, liveChat({ bookingRequest: OPEN }));
    assert.deepEqual(await errorOf({ type: 'suggest-time', date: '2026-02-30', time: '10:00' }), [400, 'Choose a valid day and time to suggest.']);
    assert.deepEqual(await errorOf({ type: 'suggest-time', date: '2026-10-07', time: '25:00' }), [400, 'Choose a valid day and time to suggest.']);
    assert.deepEqual(await errorOf({ type: 'suggest-time', date: '2026-10-01', time: '10:00' }), [400, 'That day is in the past. Choose another day.']);
    assert.deepEqual(await errorOf({ type: 'fly-to-moon' }), [400, 'Unknown action']);
    putChat(store, liveChat({ bookingRequest: CONFIRMED }));
    assert.deepEqual(await errorOf({ type: 'confirm-booking' }), [400, 'This booking is already confirmed.']);
  });
  assert.deepEqual(world.sent, []);
});

test('a confirmation the messenger refuses is taken back: the chat never shows a message that did not go out', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat({ waId: TG, channel: 'Telegram', status: 'needs-attention', bookingRequest: OPEN }));
  const world = outsideWorld({ sendFails: () => 502 });
  await run(world, store, async () => {
    const response = await act(ownerAction({ type: 'confirm-booking', conversationId: TG_ID }));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Telegram did not accept the message, so the customer was not told. Try again.' });
  });
  const chat = storedChat(store, TG)!;
  assert.deepEqual(chat.bookingRequest, OPEN);
  assert.equal(chat.status, 'needs-attention');
  assert.deepEqual(chat.messages.map(message => message.sender), ['customer']);
});

test('a chat the customer deletes stays deleted through every owner action', async (t) => {
  freezeClock(t);
  const actions: Record<string, unknown>[] = [
    { type: 'take-over' }, { type: 'mark-done' }, { type: 'let-ai-continue' }, { type: 'let-ai-continue', answerNow: true },
    { type: 'reply', text: 'Hello' }, { type: 'confirm-booking' }, { type: 'suggest-time', date: '2026-10-07', time: '11:00' },
    { type: 'decline-booking' }, { type: 'cancel-booking' }, { type: 'keep-booking' },
  ];
  for (const action of actions) {
    const store = new FakeStore(NOW);
    putChat(store, liveChat({ waId: TG, channel: 'Telegram', status: 'needs-attention', bookingRequest: OPEN, cancellationRequest: { service: 'Haircut', date: '2026-10-06', time: '10:00' } }));
    const arm = deleteBeforeNextSave(store, TG);
    // The owner's own reply is deleted while it is translated; every other action just before it is saved.
    const world = outsideWorld({ whileAiWorks: () => (action.type === 'reply' ? telegramWebhook(telegramUpdate('/delete')) : undefined) });
    const where = `${String(action.type)}${action.answerNow ? ' now' : ''}`;
    await run(world, store, async () => {
      if (action.type !== 'reply') arm();
      const response = await act(ownerAction({ ...action, conversationId: TG_ID }));
      assert.equal(response.status, 410, where);
      // Once it is gone, the owner's page is told so.
      assert.equal((await act(ownerAction({ ...action, conversationId: TG_ID }))).status, 404, where);
    });
    assert.equal(storedChat(store, TG), null, where);
    assert.deepEqual(store.holding(String(TELEGRAM_CHAT)), [], where);
    assert.ok(world.sent.every(message => !message.text.includes('Haircut') && message.text !== 'Hello'), where);
  }
});

test('the AI\'s answer in the earlier format (no intent, no stylist) is still handled safely', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const old = (request: Record<string, string>) => aiAnswer({ reply: 'Sent to the salon.', bookingRequest: { service: 'Haircut', date: '2026-10-06', time: '10:00', customerName: 'Eva', ...request } });
  const world = outsideWorld({ ai: call => (call === 1 ? old({}) : call === 2 ? old({ time: '15:00' }) : { reply: 'Hi' }) });
  await run(world, store, async () => {
    await writeChat(post('Haircut Tuesday 10:00 for Eva'));
    assert.deepEqual(storedChat(store, WEB)!.bookingRequest, OPEN);
    await act(ownerAction({ type: 'confirm-booking', conversationId: WEB_ID }));
    // With an appointment confirmed, another time in the old format is read as a change, which only waits for the owner.
    await writeChat(post('Make it 15:00'));
    const chat = storedChat(store, WEB)!;
    assert.deepEqual(chat.bookingRequest, { ...OPEN, time: '15:00', kind: 'change', previous: { date: '2026-10-06', time: '10:00' } });
    assert.deepEqual(chat.confirmedBooking, CONFIRMED);
    // An answer with hardly anything in it: the message is kept and the reply sent.
    const body = (await (await writeChat(post('Hello?'))).json()) as VisitorBody;
    assert.equal(body.messages.at(-1)!.text, 'Hi');
    assert.equal(storedChat(store, WEB)!.messages.at(-2)!.translation, 'Hello?');
  });
});

test('a stylist the customer asks for is carried into the request; a service not booked online is marked for the owner', async (t) => {
  freezeClock(t);
  for (const [request, expected, reason] of [
    [{ staffName: 'selina' }, { employeeId: 'emp-2', staffName: 'Selina Keller' }, /The customer asked for Selina Keller\./],
    [{ staffName: 'Maria' }, {}, /The customer asked for "Maria", who is not on the team\./],
    [{ service: 'Colouring' }, { service: 'Colouring', serviceId: 'srv-3' }, /Colouring is not booked online: you book it personally\./],
  ] as const) {
    const store = new FakeStore(NOW);
    const world = outsideWorld({ ai: bookingAnswer(request) });
    await run(world, store, async () => { await writeChat(post('Booking please')); });
    const chat = storedChat(store, WEB)!;
    assert.deepEqual(chat.bookingRequest, { ...OPEN, ...expected });
    assert.match(chat.attentionReason!, reason);
    // The AI's reply went out: the request really is with the owner.
    assert.equal(chat.messages.at(-1)!.sender, 'ai');
  }
});

test('a chat keeps its language: a short "ok" or a name does not flip it, a whole sentence does', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld({
    ai: call => [
      aiAnswer({ languageCode: 'de', languageName: 'German' }),
      aiAnswer({ languageCode: 'en', languageName: 'English' }),
      aiAnswer({ languageCode: 'it', languageName: 'Italian' }),
      aiAnswer({ languageCode: 'en', languageName: 'English' }),
    ][call - 1],
  });
  const languages: string[] = [];
  await run(world, store, async () => {
    for (const text of ['Guten Tag, ich hätte gern einen Termin', 'ok', 'Marco', 'Sorry, can we continue in English please?']) {
      await writeChat(post(text));
      languages.push(storedChat(store, WEB)!.language);
    }
  });
  assert.deepEqual(languages, ['DE', 'DE', 'DE', 'EN']);
  // The AI is told the chat's language and what the chat holds, with a wider window of earlier messages.
  assert.match(world.prompts[1], /Chat language: German\. Reply in German\./);
  assert.match(world.prompts[1], /Customer's first name: Eva\./);
  assert.match(world.prompts[1], /Chat state[^\n]*\n[\s\S]*Conversation so far:\n[\s\S]*New customer message:\nok/);
});

test('the AI sees the last 30 messages and the booking the chat holds', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const messages = Array.from({ length: 40 }, (_, index) => ({ id: `m${index}`, sender: 'customer' as const, original: `Message number ${index}.`, translation: '', time: '12:00' }));
  putChat(store, liveChat({ messages, status: 'booked', bookingRequest: { ...CONFIRMED, staffName: 'Luca Frei', employeeId: 'emp-3' } }));
  const world = outsideWorld();
  await run(world, store, async () => { await writeChat(post('One more')); });
  assert.doesNotMatch(world.prompts[0], /Message number 9\./);
  assert.match(world.prompts[0], /Message number 10\.[\s\S]*Message number 39\./);
  assert.match(world.prompts[0], /Confirmed appointment: Haircut on Tuesday, 06\.10\.2026 at 10:00 for Eva with Luca Frei/);
});

test('the rule check reads dates, times and names strictly', () => {
  const now = new Date(NOW); // Monday 5 October 2026, 12:00 in Zurich
  assert.equal(strictDate('2026-10-06'), '2026-10-06');
  assert.equal(strictDate('2026-02-30'), null);
  assert.equal(strictDate('2026-13-01'), null);
  assert.equal(strictDate('6.10.2026'), null);
  assert.equal(strictTime('09:30'), '09:30');
  assert.equal(strictTime('9:30'), '09:30');
  for (const bad of ['25:00', '9:5', '9.30', '09:30:00', '24:00', '']) assert.equal(strictTime(bad), null, bad);
  assert.equal(cleanName('  Eva\n<b>Maria</b> '), 'Eva Maria');
  assert.equal(cleanName('<script>alert(1)</script>'), 'alert(1)');
  assert.equal(cleanName('x'.repeat(80)).length, 40);
  assert.equal(cleanName('12345'), '');
  assert.equal(cleanName('https://spam.example'), '');
  const ask = (request: Record<string, string>) => checkBookingRequest({ service: 'Haircut', date: '2026-10-06', time: '10:00', customerName: 'Eva', ...request }, now);
  const reason = (request: Record<string, string>) => { const check = ask(request); return check.ok ? '' : check.reason; };
  assert.equal(reason({ date: '2026-02-30' }), '"2026-02-30" is not a date that exists');
  assert.equal(reason({ time: '25:00' }), '"25:00" is not a valid time');
  assert.equal(reason({ time: '9:5' }), '"9:5" is not a valid time');
  assert.equal(reason({ customerName: '<br>' }), "the customer's first name is missing or unclear");
  assert.equal(reason({ service: 'Massage' }), '"Massage" is not one of the salon\'s services');
  assert.equal(reason({ date: '2026-10-12' }), 'the salon is closed on Mondays');
  assert.equal(reason({ time: '18:30' }), 'Haircut at 18:30 does not fit into the opening hours on Tuesdays (08:30–18:30)');
  assert.equal(reason({ time: '10:15' }), '10:15 is not on the 30-minute steps appointments start on');
  assert.equal(reason({ date: '2026-12-15' }), 'the date is more than 8 weeks ahead');
  assert.equal(validBookingRequest({ service: 'Haircut', date: '2026-10-06', time: '9:30', customerName: 'Eva\nMaria' }, now)?.customerName, 'Eva Maria');
  assert.equal(validBookingRequest({ service: 'Haircut', date: '2026-10-06', time: '9:30', customerName: 'Eva' }, now)?.time, '09:30');
  const colour = ask({ service: 'Colouring' });
  assert.ok(colour.ok && colour.ownerOnly);
});

test('the AI failing on a message into a handed-back chat is said to the owner; a visitor\'s name is cleaned', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld({ ai: null });
  await run(world, store, async () => {
    const response = await writeChat(chatRequest('POST', { body: { session: SESSION, name: 'Eva\n<i>Admin</i>', text: 'Hello' } }));
    assert.equal(((await response.json()) as VisitorBody).aiFailed, true);
  });
  const chat = storedChat(store, WEB)!;
  assert.equal(chat.customerName, 'Eva Admin');
  assert.deepEqual([chat.status, chat.attentionReason], ['needs-attention', UNANSWERED]);
  assert.equal(chat.messages[0].original, 'Hello');
});

test('storage commands: a website message costs one read and two saves, a Telegram message one read and three saves', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld();
  const webCommands = await deployedWith(SETTINGS, async () => { await writeChat(post('Hello')); }, { store, outside: world.outside });
  // SMEMBERS: a newly started instance looks once an hour at the earlier version's list (see store.ts).
  assert.deepEqual(webCommands.map(command => command[0]), ['MGET', 'EVAL', 'SMEMBERS', 'EVAL']);
  const tgCommands = await deployedWith(SETTINGS, async () => { await telegramWebhook(telegramUpdate('Hello')); }, { store, outside: world.outside });
  assert.deepEqual(tgCommands.map(command => command[0]), ['SET', 'MGET', 'EVAL', 'SMEMBERS', 'EVAL', 'EVAL']);
  // The visitor deletes the chat: it is gone for the owner too.
  await deployedWith(SETTINGS, async () => { await deleteChat(chatRequest('DELETE', { session: SESSION })); }, { store });
  assert.equal(storedChat(store, WEB), null);
});
