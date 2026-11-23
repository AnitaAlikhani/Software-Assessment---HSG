/**
 * The limits of delivery 3A (contract point 6, server/limits.ts): each at its edge, the end of
 * its window, what a refused person reads, and that a counter can never be the reason the chat
 * is down. The clock is passed in or frozen; the storage is the one in memory.
 */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { GET as readChat, POST as writeChat } from '../api/chat';
import { POST as telegramWebhook } from '../api/telegram/webhook';
import { POST as act } from '../api/whatsapp/action';
import { GET as ownerInbox } from '../api/whatsapp/conversations';
import { POST as whatsappWebhook } from '../api/whatsapp/webhook';
import { fixedReply, fixedReplyGermanEnglish } from '../server/chatReplies';
import {
  addressWaiting, aiCeilingReached, countChatMessage, countMessengerMessage, countWrongTry, LIMIT_TEXTS, LIMITS, ownerAccess,
} from '../server/limits';
import { TAKEN_OVER_REASON } from '../server/recordAnalysis';
import { COUNT_SCRIPT } from '../server/store';
import { firstContactNotice } from '../src/customerNotice';
import { initialCompanySettings } from '../src/mockData';
import { type Command, deployedWith, FakeStore } from './fakeStore';
import {
  aiAnswer, CHAT_TOKEN, chatRequest, freezeClock, liveChat, NOW, outsideWorld, ownerAction, ownerInboxRequest, putChat, quietly,
  SESSION, SETTINGS, storedChat, TELEGRAM_CHAT, telegramUpdate, WHATSAPP_NUMBER, whatsappMessage,
} from './liveChatHarness';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ADDRESS = '203.0.113.7';
const OTHER_ADDRESS = '198.51.100.20';
/** A request from an address, as the hosting platform passes it on. */
const from = (address: string | null, headers: Record<string, string> = {}) =>
  new Request('https://site.invalid/api/chat', { headers: { ...headers, ...(address ? { 'x-forwarded-for': `${address}, 10.0.0.1` } : {}) } });
/** Lets time pass for the handlers (which read the frozen clock) and for the storage alike. */
const pass = (t: TestContext, store: FakeStore, ms: number) => { t.mock.timers.tick(ms); store.advance(ms); };
const WEB = `web-${SESSION}`;
const post = (text: string, address = ADDRESS, session = SESSION) => chatRequest('POST', { body: { session, name: 'Eva', text }, address });

test('the limits are the contract\'s, in one table', () => {
  assert.deepEqual(LIMITS, {
    chatPerMinute: { most: 12, seconds: 60 },
    chatInAll: 200,
    messengerPerDay: { most: 200, seconds: 86_400 },
    messengerKept: 200,
    newChatsPerAddress: { most: 200, seconds: 86_400 },
    messagesPerAddress: { most: 600, seconds: 3600 },
    aiAnswersPerDay: { most: 1500, seconds: 86_400 },
    wrongTries: { most: 60, seconds: 600 },
  });
});

test('one chat: the 12th message in a minute passes, the 13th waits, and the next minute it passes again', async () => {
  const store = new FakeStore(NOW);
  await deployedWith(SETTINGS, async () => {
    for (let i = 1; i <= 12; i += 1) assert.equal(await countChatMessage(from(ADDRESS), WEB, i === 1, NOW + i * 1000), 'ok', `message ${i}`);
    assert.equal(await countChatMessage(from(ADDRESS), WEB, false, NOW + 59_000), 'chatPerMinute');
    // Another chat from the same address is not held up by this one.
    assert.equal(await countChatMessage(from(ADDRESS), 'web-otherchat0000001', true, NOW + 59_000), 'ok');
    assert.equal(await countChatMessage(from(ADDRESS), WEB, false, NOW + MINUTE), 'ok');
  }, { store });
});

test('one address: the 600th message in an hour passes, the 601st waits until the next hour', async () => {
  const store = new FakeStore(NOW);
  await deployedWith(SETTINGS, async () => {
    // Spread over many chats, so that no chat reaches its own limit.
    for (let i = 1; i <= LIMITS.messagesPerAddress.most; i += 1) assert.equal(await countChatMessage(from(ADDRESS), `web-chat${i % 60}`, false, NOW + i), 'ok', `message ${i}`);
    assert.equal(await countChatMessage(from(ADDRESS), 'web-chatfresh', false, NOW + HOUR - 1), 'messagesPerAddress');
    assert.equal(await countChatMessage(from(OTHER_ADDRESS), 'web-chatfresh', false, NOW + HOUR - 1), 'ok');
    assert.equal(await countChatMessage(from(ADDRESS), 'web-chatfresh', false, NOW + HOUR), 'ok');
  }, { store });
});

test('one address: the 200th new chat of the salon day starts, the 201st waits until the next day', async () => {
  const store = new FakeStore(NOW);
  await deployedWith(SETTINGS, async () => {
    for (let i = 1; i <= 200; i += 1) assert.equal(await countChatMessage(from(ADDRESS), `web-new${i}`, true, NOW + i), 'ok', `chat ${i}`);
    assert.equal(await countChatMessage(from(ADDRESS), 'web-new201', true, NOW + 300), 'newChatsPerAddress');
    // A message into a chat that exists is no new chat.
    assert.equal(await countChatMessage(from(ADDRESS), 'web-new1', false, NOW + 200), 'ok');
    // NOW is noon in Zurich: 11 hours 59 later it is still the same salon day, at midnight a new one.
    assert.equal(await countChatMessage(from(ADDRESS), 'web-new52', true, NOW + 12 * HOUR - MINUTE), 'newChatsPerAddress');
    assert.equal(await countChatMessage(from(ADDRESS), 'web-new53', true, NOW + 12 * HOUR), 'ok');
  }, { store });
});

test('the whole site: the 1,500th AI answer of the day is given, the 1,501st is not, the next day again', async () => {
  const store = new FakeStore(NOW);
  await deployedWith(SETTINGS, async () => {
    for (let i = 1; i <= 1499; i += 1) assert.equal(await aiCeilingReached(NOW + i), false);
    // A website message counts as an answer as well, over all channels.
    assert.equal(await countChatMessage(from(ADDRESS), WEB, true, NOW + 2000), 'ok');
    assert.equal(await aiCeilingReached(NOW + 3000), true);
    assert.equal(await countChatMessage(from(ADDRESS), WEB, false, NOW + 4000), 'ai-ceiling');
    assert.equal(await aiCeilingReached(NOW + 12 * HOUR), false);
  }, { store });
});

test('a message refused for another limit does not use up an AI answer', async () => {
  const store = new FakeStore(NOW);
  await deployedWith(SETTINGS, async () => {
    for (let i = 1; i <= 1498; i += 1) await aiCeilingReached(NOW);
    // Twelve messages in one minute: the first two get the last answers, the other ten are kept without the AI.
    for (let i = 1; i <= 12; i += 1) assert.equal(await countChatMessage(from(null), WEB, false, NOW), i <= 2 ? 'ok' : 'ai-ceiling');
    // The 13th and 14th are refused for the chat's own limit.
    assert.equal(await countChatMessage(from(null), WEB, false, NOW), 'chatPerMinute');
    assert.equal(await countChatMessage(from(null), WEB, false, NOW), 'chatPerMinute');
  }, { store });
  // Refused messages stopped before the AI counter: it holds 1,498 + 12, not 1,498 + 14.
  const aiKey = store.keys().find(key => key.includes(':limit:ai-day:'))!;
  assert.equal(store.text(aiKey), '1510');
});

test('wrong tries: 60 from one address are refused one by one, then the address waits for the rest of the 10 minutes', async () => {
  const store = new FakeStore(NOW);
  await deployedWith(SETTINGS, async () => {
    const most = LIMITS.wrongTries.most;
    for (let i = 1; i <= most - 1; i += 1) assert.equal(await countWrongTry(from(ADDRESS), NOW + i), false, `try ${i}`);
    assert.equal(await addressWaiting(from(ADDRESS), NOW + most), false);
    assert.equal(await countWrongTry(from(ADDRESS), NOW + most + 1), false, 'the last try that is only refused');
    // After that many wrong ones every further try waits, another wrong one as well as the right key.
    assert.equal(await addressWaiting(from(ADDRESS), NOW + most + 10), true);
    assert.equal(await countWrongTry(from(ADDRESS), NOW + most + 20), true);
    assert.equal(await addressWaiting(from(ADDRESS), NOW + most + 30), true);
    // The right key is refused too while the address waits; another address is not touched.
    assert.equal(await ownerAccess(from(ADDRESS, { 'x-live-key': 'right-key' }), NOW + 60), 'waiting');
    assert.equal(await ownerAccess(from(OTHER_ADDRESS, { 'x-live-key': 'right-key' }), NOW + 60), 'ok');
    assert.equal(await ownerAccess(from(OTHER_ADDRESS, { 'x-live-key': 'wrong' }), NOW + 60), 'no-access');
    // The window is over: the right key works again at once.
    assert.equal(await ownerAccess(from(ADDRESS, { 'x-live-key': 'right-key' }), NOW + 10 * MINUTE), 'ok');
    assert.equal(await addressWaiting(from(ADDRESS), NOW + 10 * MINUTE), false);
  }, { store });
});

test('counters are named after hashes under the chats\' data space, delete themselves, and cost one command each time', async () => {
  const store = new FakeStore(NOW);
  const commands = await deployedWith(SETTINGS, async () => {
    await countChatMessage(from(ADDRESS), WEB, true, NOW);
    await countWrongTry(from(ADDRESS), NOW);
    await aiCeilingReached(NOW);
  }, { store });
  assert.deepEqual(commands.map(command => [command[0], command[1]]), [['EVAL', COUNT_SCRIPT], ['EVAL', COUNT_SCRIPT], ['EVAL', COUNT_SCRIPT]]);
  const keys = store.keys();
  assert.equal(keys.length, 5);
  for (const key of keys) {
    assert.match(key, /^slotbee:live:limit:[a-z-]+:([0-9a-f]{32}:)?[0-9-]+$/);
    assert.ok(store.secondsLeft(key)! > 0 && store.secondsLeft(key)! <= 25 * 3600, key);
  }
  for (const secret of [ADDRESS, '203.0.113', SESSION, 'right-key']) assert.deepEqual(store.holding(secret), [], secret);
  // The salon day of the AI answers is readable on purpose: it names no person.
  assert.ok(keys.includes('slotbee:live:limit:ai-day:2026-10-05'));
  // A preview keeps its counters in its own space.
  const preview = new FakeStore(NOW);
  await deployedWith({ ...SETTINGS, VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'launch' }, () => aiCeilingReached(NOW), { store: preview });
  assert.deepEqual(preview.keys(), ['slotbee:preview:live:limit:ai-day:2026-10-05']);
});

test('a missing storage or failing counters let every request through', async (t) => {
  // No storage: nothing is counted and nothing is refused.
  await deployedWith({ ...SETTINGS, KV_REST_API_URL: '' }, async () => {
    for (let i = 0; i < 30; i += 1) {
      assert.equal(await countChatMessage(from(ADDRESS), WEB, true, NOW), 'ok');
      assert.equal(await countWrongTry(from(ADDRESS), NOW), false);
      assert.equal(await aiCeilingReached(NOW), false);
    }
    assert.equal(await addressWaiting(from(ADDRESS), NOW), false);
  });
  // Counting fails: the chat still answers, and the failure is only written to the log.
  freezeClock(t);
  const store = new FakeStore(NOW);
  const run = store.run.bind(store);
  store.run = (command: Command) => { if (command[1] === COUNT_SCRIPT) throw new Error('storage hiccup'); return run(command); };
  const world = outsideWorld();
  const errors = await quietly(() => deployedWith(SETTINGS, async () => {
    for (let i = 0; i < 25; i += 1) await countWrongTry(from(ADDRESS), NOW);
    assert.equal(await addressWaiting(from(ADDRESS), NOW), false);
    for (let i = 1; i <= 14; i += 1) {
      const response = await writeChat(post(`Message ${i}`));
      assert.equal(response.status, 200, `message ${i}`);
    }
    assert.equal((await ownerInbox(ownerInboxRequest({ address: ADDRESS }))).status, 200);
    assert.equal((await telegramWebhook(telegramUpdate('Hello'))).status, 200);
  }, { store, outside: world.outside }));
  assert.equal(world.prompts.length, 15);
  assert.ok(errors.some(args => String(args[0]).includes('Storage error')));
});

test('the website chat: the 13th message in a minute gets 429 and a plain sentence, the next minute it goes through', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld();
  await quietly(() => deployedWith(SETTINGS, async () => {
    for (let i = 1; i <= 12; i += 1) assert.equal((await writeChat(post(`Message ${i}`))).status, 200, `message ${i}`);
    const refused = await writeChat(post('Message 13'));
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: LIMIT_TEXTS.chatPerMinute });
    pass(t, store, MINUTE);
    assert.equal((await writeChat(post('Message 14'))).status, 200);
  }, { store, outside: world.outside }));
  // The refused message is not stored and never reached the AI.
  assert.equal(world.prompts.length, 13);
  assert.ok(!storedChat(store, WEB)!.messages.some(message => message.original === 'Message 13'));
});

test('the website chat: too many new chats from one address get a sentence, a message into an existing chat does not', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  await quietly(() => deployedWith(SETTINGS, async () => {
    for (let i = 1; i <= 200; i += 1) assert.equal((await writeChat(post('Hi', ADDRESS, `session${String(i).padStart(8, '0')}`))).status, 200, `chat ${i}`);
    const refused = await writeChat(post('Hi', ADDRESS, 'session00000201'));
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: LIMIT_TEXTS.newChatsPerAddress });
    assert.equal((await writeChat(post('Again', ADDRESS, 'session00000001'))).status, 200);
    assert.equal(storedChat(store, 'web-session00000201'), null);
  }, { store, outside: outsideWorld().outside }));
});

test('wrong tokens on the chat: after 60 the address waits, even with the right token, and after the 10 minutes it does not', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const wrong = { 'x-chat-token': 'not-the-token-at-all-000' };
  await deployedWith(SETTINGS, async () => {
    for (let i = 1; i <= LIMITS.wrongTries.most; i += 1) {
      const response = await readChat(chatRequest('GET', { session: SESSION, access: wrong, address: ADDRESS }));
      assert.equal(response.status, 401, `try ${i}`);
    }
    const locked = await readChat(chatRequest('GET', { session: SESSION, access: wrong, address: ADDRESS }));
    assert.equal(locked.status, 429);
    assert.deepEqual(await locked.json(), { error: LIMIT_TEXTS.wrongTriesCustomer });
    for (const method of ['GET', 'POST'] as const) {
      const right = method === 'GET'
        ? await readChat(chatRequest('GET', { session: SESSION, address: ADDRESS }))
        : await writeChat(post('Hello'));
      assert.equal(right.status, 429, method);
      // The sentence gives neither the key nor the token away.
      const text = await right.text();
      assert.ok(!text.includes(CHAT_TOKEN) && !text.includes('right-key'));
    }
    assert.equal((await readChat(chatRequest('GET', { address: ADDRESS }))).status, 429);
    // Another address is not held up.
    assert.equal((await readChat(chatRequest('GET', { session: SESSION, address: OTHER_ADDRESS }))).status, 200);
    pass(t, store, 10 * MINUTE);
    assert.equal((await readChat(chatRequest('GET', { session: SESSION, address: ADDRESS }))).status, 200);
    assert.equal((await readChat(chatRequest('GET', { address: ADDRESS }))).status, 200);
  }, { store });
});

test('the right token or key from an address that is not waiting is never slowed, and polling costs no extra command', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat());
  const commands = await deployedWith(SETTINGS, async () => {
    for (let i = 0; i < 100; i += 1) {
      assert.equal((await readChat(chatRequest('GET', { session: SESSION, address: ADDRESS }))).status, 200);
      assert.equal((await ownerInbox(ownerInboxRequest({ address: ADDRESS }))).status, 200);
    }
  }, { store });
  // One read for the page's poll and two for the owner's, as before: the gate is read with the chats.
  assert.deepEqual(commands.slice(0, 3).map(command => command[0]), ['MGET', 'SCAN', 'MGET']);
  assert.equal(commands.length, 300);
});

test('wrong keys on the owner\'s inbox: after 60 the owner reads why she has to wait, and her key works again after the window', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  await deployedWith(SETTINGS, async () => {
    for (let i = 1; i <= LIMITS.wrongTries.most; i += 1) assert.equal((await ownerInbox(ownerInboxRequest({ access: { 'x-live-key': 'guess' }, address: ADDRESS }))).status, 401);
    // The customer's token is a wrong key here, and counts as one.
    const locked = await ownerInbox(ownerInboxRequest({ access: { 'x-live-key': CHAT_TOKEN }, address: ADDRESS }));
    assert.equal(locked.status, 429);
    assert.deepEqual(await locked.json(), { enabled: false, conversations: [], error: LIMIT_TEXTS.wrongTriesOwner });
    const right = await ownerInbox(ownerInboxRequest({ address: ADDRESS }));
    assert.equal(right.status, 429);
    const action = await act(ownerAction({ type: 'mark-done', conversationId: `live-${WEB}` }, { address: ADDRESS }));
    assert.equal(action.status, 429);
    assert.deepEqual(await action.json(), { error: LIMIT_TEXTS.wrongTriesOwner });
    pass(t, store, 10 * MINUTE);
    const again = await ownerInbox(ownerInboxRequest({ address: ADDRESS }));
    assert.equal(again.status, 200);
  }, { store });
});

// ---------- the day's AI answers used up ----------

/** Uses up the day's AI answers, as 1,500 earlier customer messages would have. */
const useUpAiAnswers = (store: FakeStore) =>
  deployedWith(SETTINGS, async () => { for (let i = 0; i < LIMITS.aiAnswersPerDay.most; i += 1) await aiCeilingReached(NOW); }, { store });

test('AI answers used up, website chat: the message is kept, the chat goes to the owner, the customer is told the team will answer', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  await useUpAiAnswers(store);
  // A chat whose language the AI named earlier.
  putChat(store, liveChat({ language: 'FR', languageSettled: true, messages: [{ id: 'm1', sender: 'customer', original: 'Bonjour', translation: 'Hello', time: '11:58' }] }));
  const world = outsideWorld();
  await quietly(() => deployedWith(SETTINGS, async () => {
    const response = await writeChat(post('Une coupe demain ?'));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { messages: { from: string; text: string }[]; aiFailed: boolean; answeredBy: string };
    assert.deepEqual(body.messages.map(message => [message.from, message.text]), [
      ['me', 'Bonjour'], ['me', 'Une coupe demain ?'], ['salon', fixedReply('teamWillAnswer', 'FR').original],
    ]);
    assert.equal(body.aiFailed, false);
    // The customer writes again before anybody answered: kept, and the sentence is not repeated.
    const again = (await (await writeChat(post('Merci'))).json()) as { messages: { from: string }[] };
    assert.deepEqual(again.messages.map(message => message.from), ['me', 'me', 'salon', 'me']);
  }, { store, outside: world.outside }));
  assert.deepEqual(world.prompts, []);
  const chat = storedChat(store, WEB)!;
  assert.equal(chat.status, 'needs-attention');
  assert.equal(chat.attentionReason, "The AI has reached today's limit of answers. Please reply yourself.");
  assert.equal(chat.messages.at(-2)?.translation, fixedReply('teamWillAnswer', 'EN').original);
  // The sentence says nothing about bookings, times or prices: it promises only that the team answers.
  for (const language of ['EN', 'DE', 'FR', 'IT'] as const) {
    const sentence = fixedReply('teamWillAnswer', language).original;
    assert.doesNotMatch(sentence, /\d|confirm|bestätig|confirm|conferm|book|buch|réserv|prenot|AI|KI|IA/i, sentence);
  }
});

test('AI answers used up, a chat the owner handles: kept for her, and nothing is sent in her name', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  await useUpAiAnswers(store);
  putChat(store, liveChat({ takenOver: true, status: 'owner-handled' }));
  const world = outsideWorld();
  await quietly(() => deployedWith(SETTINGS, async () => {
    const body = (await (await writeChat(post('Are you there?'))).json()) as { messages: { from: string }[]; answeredBy: string };
    assert.deepEqual(body.messages.map(message => message.from), ['me', 'me']);
    assert.equal(body.answeredBy, 'team');
  }, { store, outside: world.outside }));
  assert.deepEqual(world.prompts, []);
  assert.equal(storedChat(store, WEB)?.attentionReason, TAKEN_OVER_REASON);
});

test('AI answers used up, Telegram and WhatsApp: the customer gets the fixed sentence in the chat\'s language, without the AI', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  await useUpAiAnswers(store);
  putChat(store, liveChat({ waId: `tg-${TELEGRAM_CHAT}`, channel: 'Telegram', language: 'DE', languageSettled: true }));
  const world = outsideWorld();
  await quietly(() => deployedWith(SETTINGS, async () => {
    assert.equal((await telegramWebhook(telegramUpdate('Haben Sie morgen Zeit?'))).status, 200);
    assert.equal((await whatsappWebhook(whatsappMessage('Hello, a haircut tomorrow?'))).status, 200);
  }, { store, outside: world.outside }));
  assert.deepEqual(world.prompts, []);
  const salon = initialCompanySettings.companyName;
  assert.deepEqual(world.sent.map(message => [message.channel, message.text]), [
    ['Telegram', fixedReply('teamWillAnswer', 'DE').original],
    // A new WhatsApp chat gets its fixed first text before anything else, as always.
    ['WhatsApp', firstContactNotice('EN', 'WhatsApp', { salon, study: false, product: 'SlotBee' })],
    // Nobody has named the new chat's language: German and English in one message.
    ['WhatsApp', fixedReplyGermanEnglish('teamWillAnswer').original],
  ]);
  for (const waId of [`tg-${TELEGRAM_CHAT}`, WHATSAPP_NUMBER]) {
    const chat = storedChat(store, waId)!;
    assert.equal(chat.status, 'needs-attention', waId);
    assert.equal(chat.attentionReason, LIMIT_TEXTS.aiCeiling, waId);
    assert.equal(chat.messages.at(-1)?.sender, 'ai', waId);
  }
});

test('AI answers used up, the owner asks the AI to answer now: she reads why it cannot, and the chat stays with her', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  await useUpAiAnswers(store);
  putChat(store, liveChat({ takenOver: true, status: 'needs-attention', attentionReason: TAKEN_OVER_REASON }));
  const world = outsideWorld();
  await deployedWith(SETTINGS, async () => {
    const response = await act(ownerAction({ type: 'let-ai-continue', conversationId: `live-${WEB}`, answerNow: true }));
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: LIMIT_TEXTS.aiCeiling });
  }, { store, outside: world.outside });
  assert.deepEqual(world.prompts, []);
  const chat = storedChat(store, WEB)!;
  assert.equal(chat.takenOver, true);
  assert.equal(chat.attentionReason, TAKEN_OVER_REASON);
  assert.equal(chat.messages.length, 1);
  // The next day the AI answers again.
  pass(t, store, 12 * HOUR);
  await quietly(() => deployedWith(SETTINGS, async () => {
    assert.equal((await act(ownerAction({ type: 'let-ai-continue', conversationId: `live-${WEB}`, answerNow: true }))).status, 200);
  }, { store, outside: world.outside }));
  assert.equal(world.prompts.length, 1);
  assert.equal(storedChat(store, WEB)?.messages.at(-1)?.original, aiAnswer().reply);
});

// ---------- the limits of one chat on Telegram and WhatsApp ----------

/** A messenger chat as earlier messages left it: `count` messages, its language named by the AI. */
const messengerChat = (waId: string, channel: 'Telegram' | 'WhatsApp', count: number, language: 'DE' | 'EN' = 'DE') => liveChat({
  waId, channel, language, languageSettled: true, noticeSent: true,
  messages: Array.from({ length: count }, (_, index) => ({
    id: `m${index}`, sender: index % 2 ? 'ai' as const : 'customer' as const, original: 'Hallo', translation: 'Hello', time: '11:00',
  })),
});
const sendOn = (channel: 'Telegram' | 'WhatsApp', text: string) =>
  channel === 'Telegram' ? telegramWebhook(telegramUpdate(text)) : whatsappWebhook(whatsappMessage(text));
const idOf = (channel: 'Telegram' | 'WhatsApp') => channel === 'Telegram' ? `tg-${TELEGRAM_CHAT}` : WHATSAPP_NUMBER;

for (const channel of ['Telegram', 'WhatsApp'] as const) {
  test(`${channel}: the 13th message in a minute is kept for the owner without the AI, the customer is told once, the next minute the AI answers again`, async (t) => {
    freezeClock(t);
    const store = new FakeStore(NOW);
    putChat(store, messengerChat(idOf(channel), channel, 0, 'EN'));
    const world = outsideWorld();
    await quietly(() => deployedWith(SETTINGS, async () => {
      for (let i = 1; i <= 14; i += 1) assert.equal((await sendOn(channel, `Message ${i}`)).status, 200);
    }, { store, outside: world.outside }));
    // Twelve answers from the AI, then one fixed sentence and nothing for the 14th.
    assert.equal(world.prompts.length, 12);
    assert.deepEqual(world.sent.map(message => message.text), [
      ...Array.from({ length: 12 }, () => aiAnswer().reply), fixedReply('teamWillAnswer', 'EN').original,
    ]);
    const chat = storedChat(store, idOf(channel))!;
    // Every message is kept for the owner, and she reads why the AI stopped.
    assert.equal(chat.messages.filter(message => message.sender === 'customer').length, 14);
    assert.equal(chat.status, 'needs-attention');
    assert.equal(chat.attentionReason, 'The customer is sending many messages quickly. The AI has paused in this chat: please reply yourself.');
    // The day's AI answers were not used for the two refused messages.
    assert.equal(store.text('slotbee:live:limit:ai-day:2026-10-05'), '12');
    pass(t, store, MINUTE);
    await quietly(() => deployedWith(SETTINGS, () => sendOn(channel, 'Message 15'), { store, outside: world.outside }));
    assert.equal(world.prompts.length, 13);
    assert.equal(world.sent.at(-1)?.text, aiAnswer().reply);
  });

  test(`${channel}: a message into a chat that holds 200 is kept and answered; the oldest messages go, the chat's fields stay`, async (t) => {
    freezeClock(t);
    const store = new FakeStore(NOW);
    const booked = { service: 'Haircut', date: '2026-10-20', time: '10:00', customerName: 'Eva', status: 'confirmed' as const };
    putChat(store, { ...messengerChat(idOf(channel), channel, 200), confirmedBooking: booked });
    const world = outsideWorld();
    await quietly(() => deployedWith(SETTINGS, async () => {
      assert.equal((await sendOn(channel, 'Kann ich auf 16 Uhr verschieben?')).status, 200);
    }, { store, outside: world.outside }));
    // The AI answered as in any chat: no customer message is lost for a long chat.
    assert.equal(world.prompts.length, 1);
    assert.deepEqual(world.sent.map(message => message.text), [aiAnswer().reply]);
    const chat = storedChat(store, idOf(channel))!;
    assert.equal(chat.messages.length, 200);
    assert.deepEqual(chat.messages.slice(-2).map(message => message.original), ['Kann ich auf 16 Uhr verschieben?', aiAnswer().reply]);
    // The two oldest went to make room; what was in fields stays.
    assert.equal(chat.messages[0].id, 'm2');
    assert.equal(chat.noticeSent, true);
    assert.equal(chat.languageSettled, true);
    assert.deepEqual(chat.confirmedBooking, booked);
  });

  test(`${channel}: the reviewer's cases: an AI reply makes the 200th message, and a full chat the owner answered`, async (t) => {
    freezeClock(t);
    // A: the chat reaches 200 through the AI's reply; the next customer message is kept and answered.
    let store = new FakeStore(NOW);
    putChat(store, messengerChat(idOf(channel), channel, 198));
    let world = outsideWorld();
    await quietly(() => deployedWith(SETTINGS, async () => {
      await sendOn(channel, 'Frage 199');
      await sendOn(channel, 'Kann ich auf 16 Uhr verschieben?');
    }, { store, outside: world.outside }));
    let chat = storedChat(store, idOf(channel))!;
    assert.equal(chat.messages.length, 200);
    assert.equal(chat.messages.at(-2)?.original, 'Kann ich auf 16 Uhr verschieben?');
    assert.equal(world.sent.length, 2);
    // B: a full chat, the owner answers, the customer writes again: kept for her with her reason.
    store = new FakeStore(NOW);
    putChat(store, messengerChat(idOf(channel), channel, 200));
    world = outsideWorld();
    await quietly(() => deployedWith(SETTINGS, async () => {
      assert.equal((await act(ownerAction({ type: 'reply', conversationId: `live-${idOf(channel)}`, text: 'Gern, um 15 Uhr' }))).status, 200);
      assert.equal((await sendOn(channel, 'Doch lieber 16 Uhr, geht das?')).status, 200);
    }, { store, outside: world.outside }));
    chat = storedChat(store, idOf(channel))!;
    assert.equal(chat.messages.length, 200);
    assert.equal(chat.messages.at(-1)?.original, 'Doch lieber 16 Uhr, geht das?');
    assert.equal(chat.status, 'needs-attention');
    assert.equal(chat.attentionReason, TAKEN_OVER_REASON);
  });

  test(`${channel}: the 200th customer message of a day is answered by the AI, the 201st goes to the owner, and the next day the AI answers again`, async (t) => {
    freezeClock(t);
    const store = new FakeStore(NOW);
    putChat(store, messengerChat(idOf(channel), channel, 0));
    // 199 earlier messages today, spread so that no minute passes its own limit.
    await deployedWith(SETTINGS, async () => {
      for (let i = 1; i <= 199; i += 1) assert.equal(await countMessengerMessage(idOf(channel), NOW - 6 * HOUR + i * 10_000), 'ok');
    }, { store });
    const world = outsideWorld();
    await quietly(() => deployedWith(SETTINGS, async () => {
      await sendOn(channel, 'Nachricht 200');
      await sendOn(channel, 'Nachricht 201');
      await sendOn(channel, 'Nachricht 202');
    }, { store, outside: world.outside }));
    assert.equal(world.prompts.length, 1);
    assert.deepEqual(world.sent.map(message => message.text), [aiAnswer().reply, fixedReply('teamWillAnswer', 'EN').original]);
    const chat = storedChat(store, idOf(channel))!;
    assert.deepEqual(chat.messages.filter(message => message.sender === 'customer').map(message => message.original), ['Nachricht 200', 'Nachricht 201', 'Nachricht 202']);
    assert.equal(chat.attentionReason, 'This customer has sent very many messages today. The AI has paused in this chat: please reply yourself.');
    assert.equal(chat.attentionReason, LIMIT_TEXTS.messengerPerDay);
    // The next salon day the AI answers again.
    pass(t, store, 12 * HOUR);
    await quietly(() => deployedWith(SETTINGS, () => sendOn(channel, 'Guten Morgen'), { store, outside: world.outside }));
    assert.equal(world.prompts.length, 2);
    assert.equal(world.sent.at(-1)?.text, aiAnswer().reply);
  });

  test(`${channel}: four messages at the same moment past the minute's limit give one "team will answer" sentence`, async (t) => {
    freezeClock(t);
    const store = new FakeStore(NOW);
    putChat(store, messengerChat(idOf(channel), channel, 0));
    const world = outsideWorld();
    await quietly(() => deployedWith(SETTINGS, async () => {
      for (let i = 1; i <= 12; i += 1) await sendOn(channel, `Nachricht ${i}`);
      await Promise.all(['a', 'b', 'c', 'd'].map(text => sendOn(channel, text)));
    }, { store, outside: world.outside }));
    const sentence = fixedReply('teamWillAnswer', 'EN').original;
    assert.equal(world.sent.filter(message => message.text === sentence).length, 1);
    const chat = storedChat(store, idOf(channel))!;
    assert.equal(chat.messages.filter(message => message.original === sentence).length, 1);
    assert.equal(chat.messages.filter(message => message.sender === 'customer').length, 16);
    assert.equal(chat.teamPromised, true);
  });
}

test('a "team will answer" sentence that could not be sent is tried again with the next message; an answer ends the promise', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  await useUpAiAnswers(store);
  putChat(store, messengerChat(`tg-${TELEGRAM_CHAT}`, 'Telegram', 2));
  const sentence = fixedReply('teamWillAnswer', 'DE').original;
  const world = outsideWorld({ sendFails: attempt => attempt === 1 ? 502 : false });
  await quietly(() => deployedWith(SETTINGS, async () => {
    await telegramWebhook(telegramUpdate('Eins'));
    assert.equal(storedChat(store, `tg-${TELEGRAM_CHAT}`)?.teamPromised, undefined);
    assert.equal(storedChat(store, `tg-${TELEGRAM_CHAT}`)?.attentionReason, LIMIT_TEXTS.aiCeiling);
    await telegramWebhook(telegramUpdate('Zwei'));
    assert.equal(storedChat(store, `tg-${TELEGRAM_CHAT}`)?.teamPromised, true);
    await telegramWebhook(telegramUpdate('Drei'));
    // The owner answers: the promise is kept, and a later message may be told again.
    assert.equal((await act(ownerAction({ type: 'reply', conversationId: `live-tg-${TELEGRAM_CHAT}`, text: 'Gern' }))).status, 200);
    assert.equal(storedChat(store, `tg-${TELEGRAM_CHAT}`)?.teamPromised, undefined);
    assert.equal((await act(ownerAction({ type: 'let-ai-continue', conversationId: `live-tg-${TELEGRAM_CHAT}` }))).status, 200);
    await telegramWebhook(telegramUpdate('Vier'));
  }, { store, outside: world.outside }));
  assert.deepEqual(world.failed.map(message => message.text), [sentence]);
  assert.deepEqual(world.sent.map(message => message.text).filter(text => text === sentence), [sentence, sentence]);
});

test('the AI\'s answer settles the chat\'s language; an answer without a language leaves it open', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld({ ai: call => call === 1
    ? aiAnswer({ languageCode: 'fr', languageName: 'French', reply: 'Bonjour !' })
    : aiAnswer({ languageCode: '', languageName: '' }) });
  await quietly(() => deployedWith(SETTINGS, async () => {
    await telegramWebhook(telegramUpdate('Bonjour, je voudrais une coupe demain'));
    await whatsappWebhook(whatsappMessage('Hello there'));
  }, { store, outside: world.outside }));
  const telegram = storedChat(store, `tg-${TELEGRAM_CHAT}`)!;
  assert.equal(telegram.language, 'FR');
  assert.equal(telegram.languageSettled, true);
  assert.equal(storedChat(store, WHATSAPP_NUMBER)?.languageSettled, undefined);
});

test('without a named language the fixed sentence goes out in German and English, German first; a named language keeps its one language', async (t) => {
  freezeClock(t);
  const both = fixedReplyGermanEnglish('teamWillAnswer');
  assert.equal(both.original, `${fixedReply('teamWillAnswer', 'DE').original}\n\n${fixedReply('teamWillAnswer', 'EN').original}`);
  assert.equal(both.translation, fixedReply('teamWillAnswer', 'EN').original);
  assert.equal(both.translationDe, fixedReply('teamWillAnswer', 'DE').original);

  const store = new FakeStore(NOW);
  await useUpAiAnswers(store);
  // A chat saved before the flag existed, whose messages the AI translated, counts as named.
  putChat(store, liveChat({ waId: 'web-earlierchat000001', language: 'IT', messages: [
    { id: 'm1', sender: 'customer', original: 'Buongiorno, vorrei un taglio', translation: 'Good morning', translationDe: 'Guten Tag', time: '11:00' },
  ] }));
  await quietly(() => deployedWith(SETTINGS, async () => {
    // A brand-new chat: nobody has named its language.
    const fresh = (await (await writeChat(post('Bonjour'))).json()) as { messages: { from: string; text: string }[] };
    assert.deepEqual(fresh.messages.map(message => message.text), ['Bonjour', both.original]);
    const earlier = (await (await writeChat(post('Ci siete?', ADDRESS, 'earlierchat000001'))).json()) as { messages: { text: string }[] };
    assert.equal(earlier.messages.at(-1)?.text, fixedReply('teamWillAnswer', 'IT').original);
  }, { store, outside: outsideWorld().outside }));
  // The owner reads it in English and German, as any message.
  assert.equal(storedChat(store, WEB)?.messages.at(-1)?.translation, fixedReply('teamWillAnswer', 'EN').original);
});
