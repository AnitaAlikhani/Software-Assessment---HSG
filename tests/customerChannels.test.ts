import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { DELETE as deleteChat, GET as readChat, POST as writeChat } from '../api/chat';
import { POST as telegramWebhook } from '../api/telegram/webhook';
import { POST as whatsappWebhook } from '../api/whatsapp/webhook';
import { researchSetting } from '../server/researchMode';
import { DELETE_SCRIPT, RETENTION_SECONDS } from '../server/store';
import type { LiveConversation } from '../server/whatsappCore';
import { PRODUCT_NAME } from '../src/brand';
import { chatDeletedNotice, chatNotDeletedNotice, firstContactNotice, telegramWelcome } from '../src/customerNotice';
import { initialCompanySettings } from '../src/mockData';
import { Command, deployedWith, FakeStore } from './fakeStore';
import { FIXED_NOW } from './fixedClock';

// The salon comes from Company Settings, whatever they say at the moment.
const salon = initialCompanySettings.companyName;
const phone = initialCompanySettings.businessPhone.trim();
const orCall = phone ? ` or call ${phone}` : '';
const NOW = FIXED_NOW.getTime();
const SESSION = 'abc123def456ghi7';
const SETTINGS = {
  LIVE_ACCESS_KEY: 'right-key', GEMINI_API_KEY: 'test-key', TELEGRAM_BOT_TOKEN: 'bot-token',
  WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 'token',
};

/** What the AI would answer. The real model is never called from a test. */
const aiAnswer = (overrides: Record<string, unknown> = {}) => ({
  languageCode: 'en', languageName: 'English', translationEn: 'Hello', translationDe: 'Hallo',
  reply: 'Hello! How can I help you?', replyEn: 'Hello! How can I help you?', replyDe: 'Hallo! Wie kann ich helfen?',
  needsOwner: false, reason: '', bookingRequest: { service: '', date: '', time: '', customerName: '' }, ...overrides,
});

/** The services outside our own code: the AI and the two messengers. Records what would have been sent. */
function outsideWorld(ai: Record<string, unknown> | null) {
  const sent: { channel: 'Telegram' | 'WhatsApp'; to: string; text: string }[] = [];
  const world = {
    sent,
    aiCalls: 0,
    outside: (url: string, body: string): unknown => {
      if (url.includes('generativelanguage.googleapis.com')) {
        world.aiCalls += 1;
        if (!ai) throw new Error('the AI is down');
        return { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(ai) }] }, finishReason: 'STOP', index: 0 }] };
      }
      if (url.startsWith('https://api.telegram.org/botbot-token/')) {
        const payload = JSON.parse(body) as { chat_id: string; text?: string };
        if (url.endsWith('/sendMessage')) sent.push({ channel: 'Telegram', to: String(payload.chat_id), text: payload.text ?? '' });
        return { ok: true, result: {} };
      }
      if (url.startsWith('https://graph.facebook.com/')) {
        const payload = JSON.parse(body) as { to: string; text: { body: string } };
        sent.push({ channel: 'WhatsApp', to: payload.to, text: payload.text.body });
        return { messages: [{ id: 'wamid.out' }] };
      }
      throw new Error(`unexpected network call to ${url}`);
    },
  };
  return world;
}

/** Handlers read the clock themselves. Freeze it, so the tests give the same result on every day. */
const freezeClock = (t: TestContext) => t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
/** The AI helper reports a failed model on the console. That is expected where a test switches the AI off. */
const quietly = async <T>(work: () => Promise<T>): Promise<T> => {
  const real = { error: console.error, warn: console.warn, log: console.log };
  console.error = console.warn = console.log = () => {};
  try { return await work(); } finally { Object.assign(console, real); }
};

const chatRequest = (method: string, { key = 'right-key', session, body }: { key?: string | null; session?: string; body?: unknown } = {}) =>
  new Request(`https://site.invalid/api/chat${session === undefined ? '' : `?session=${session}`}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-live-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const storedChat = (store: FakeStore, waId: string) => JSON.parse(store.text(`slotbee:live:chat:${waId}`) ?? 'null') as (LiveConversation & { keptUntil?: number }) | null;
const names = (commands: Command[]) => commands.map(command => command[0]);

test('the chat explains a link that does not work and a server that is not ready, in plain words', async () => {
  await deployedWith(SETTINGS, async () => {
    for (const request of [chatRequest('GET', { key: null }), chatRequest('POST', { key: 'wrong-key', body: { session: SESSION, text: 'Hi' } }), chatRequest('DELETE', { key: 'wrong-key', session: SESSION })]) {
      const response = request.method === 'GET' ? await readChat(request) : request.method === 'POST' ? await writeChat(request) : await deleteChat(request);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'This chat link is no longer valid. Please ask the salon for a new one.' });
    }
  });
  await deployedWith({ ...SETTINGS, KV_REST_API_URL: '' }, async () => {
    const response = await writeChat(chatRequest('POST', { body: { session: SESSION, text: 'Hi' } }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: `The chat is not available at the moment. Please try again later${orCall}.` });
  });
});

test('the start screen learns whether its link works without touching the storage', async () => {
  const commands = await deployedWith(SETTINGS, async () => {
    const response = await readChat(chatRequest('GET'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { messages: [] });
  });
  assert.deepEqual(commands, []);
});

test('a customer message is answered by the AI and kept for 14 days', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld(aiAnswer());
  await quietly(() => deployedWith(SETTINGS, async () => {
    const response = await writeChat(chatRequest('POST', { body: { session: SESSION, name: 'Tamara', text: 'Hello' } }));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { messages: { from: string; text: string }[]; aiFailed: boolean };
    assert.deepEqual(body.messages.map(message => [message.from, message.text]), [['me', 'Hello'], ['salon', 'Hello! How can I help you?']]);
    assert.equal(body.aiFailed, false);
    // The customer's own view of the chat, as the page polls it.
    const poll = (await (await readChat(chatRequest('GET', { session: SESSION }))).json()) as { messages: unknown[] };
    assert.equal(poll.messages.length, 2);
  }, { store, outside: world.outside }));
  assert.equal(world.aiCalls, 1);
  assert.equal(store.secondsLeft(`slotbee:live:chat:web-${SESSION}`), RETENTION_SECONDS);
  assert.equal(storedChat(store, `web-${SESSION}`)?.keptUntil, NOW + RETENTION_SECONDS * 1000);
  assert.equal(storedChat(store, `web-${SESSION}`)?.customerName, 'Tamara');
});

test('when the AI is down the message is kept for the owner, and the customer is told so', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld(null);
  await quietly(() => deployedWith(SETTINGS, async () => {
    const response = await writeChat(chatRequest('POST', { body: { session: SESSION, text: 'Hello' } }));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { messages: { from: string }[]; aiFailed: boolean };
    assert.equal(body.aiFailed, true);
    assert.deepEqual(body.messages.map(message => message.from), ['me']);
  }, { store, outside: world.outside }));
  assert.equal(storedChat(store, `web-${SESSION}`)?.status, 'needs-attention');
});

test('a very long chat stops with a friendly text instead of calling the AI again', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const long: LiveConversation = {
    waId: `web-${SESSION}`, channel: 'Website', customerName: 'Tamara', language: 'EN', status: 'ai-handled', takenOver: false, updatedAt: NOW,
    messages: Array.from({ length: 200 }, (_, index) => ({ id: `m${index}`, sender: index % 2 ? 'ai' as const : 'customer' as const, original: 'Hi', translation: 'Hi', time: '12:00' })),
  };
  store.run(['SET', `slotbee:live:chat:web-${SESSION}`, JSON.stringify(long), 'EX', RETENTION_SECONDS]);
  const world = outsideWorld(aiAnswer());
  const commands = await deployedWith(SETTINGS, async () => {
    const response = await writeChat(chatRequest('POST', { body: { session: SESSION, text: 'One more' } }));
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: `This conversation has become long. Please start a new chat${orCall}.`, full: true });
  }, { store, outside: world.outside });
  assert.equal(world.aiCalls, 0);
  assert.deepEqual(names(commands), ['MGET']);
  // One message short of the limit still goes through to the AI.
  long.messages.pop();
  store.run(['SET', `slotbee:live:chat:web-${SESSION}`, JSON.stringify(long), 'EX', RETENTION_SECONDS]);
  await quietly(() => deployedWith(SETTINGS, async () => {
    assert.equal((await writeChat(chatRequest('POST', { body: { session: SESSION, text: 'One more' } }))).status, 200);
  }, { store, outside: world.outside }));
  assert.equal(world.aiCalls, 1);
});

test('a customer can delete their own chat, and only their own', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const other = 'zzz999yyy888xxx7';
  const world = outsideWorld(aiAnswer());
  await quietly(() => deployedWith(SETTINGS, async () => {
    await writeChat(chatRequest('POST', { body: { session: SESSION, text: 'Hello' } }));
    await writeChat(chatRequest('POST', { body: { session: other, text: 'Hello' } }));
    assert.equal((await deleteChat(chatRequest('DELETE', { session: '../etc' }))).status, 400);
    assert.equal((await deleteChat(chatRequest('DELETE'))).status, 400);
    const response = await deleteChat(chatRequest('DELETE', { session: SESSION }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true });
    assert.deepEqual(await (await readChat(chatRequest('GET', { session: SESSION }))).json(), { messages: [] });
  }, { store, outside: world.outside }));
  assert.equal(storedChat(store, `web-${SESSION}`), null);
  assert.notEqual(storedChat(store, `web-${other}`), null);
  // Nothing in the storage names the deleted chat any more; the other one is in its own key only.
  assert.deepEqual(store.holding(SESSION), []);
  assert.deepEqual(store.holding(other), [`slotbee:live:chat:web-${other}`]);
});

// ---------- Telegram ----------

let updateId = 500;
const telegramUpdate = (text: string, languageCode = 'en', chat = 987654) => {
  updateId += 1;
  return new Request('https://site.invalid/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': createHash('sha256').update('slotbee-telegram:bot-token').digest('hex').slice(0, 48),
    },
    body: JSON.stringify({
      update_id: updateId,
      message: { message_id: updateId, date: NOW / 1000, text, chat: { id: chat, type: 'private' }, from: { first_name: 'Ana', last_name: 'Silva', language_code: languageCode } },
    }),
  });
};

test('Telegram welcomes a customer in the language of their app, from a fixed text and without study wording', async () => {
  const store = new FakeStore(NOW);
  const world = outsideWorld(aiAnswer());
  await deployedWith(SETTINGS, async () => {
    for (const code of ['de', 'fr', 'it', 'en', 'pt-br']) assert.equal((await telegramWebhook(telegramUpdate('/start', code))).status, 200);
    await telegramWebhook(telegramUpdate('/help', 'de'));
  }, { store, outside: world.outside });
  assert.deepEqual(world.sent.map(message => message.text), [
    telegramWelcome('DE', { salon }), telegramWelcome('FR', { salon }), telegramWelcome('IT', { salon }),
    telegramWelcome('EN', { salon }), telegramWelcome('EN', { salon }), telegramWelcome('DE', { salon }),
  ]);
  assert.ok(world.sent.every(message => message.to === '987654'));
  for (const message of world.sent) assert.doesNotMatch(message.text, /HSG|student|Studierenden|étudiant|studentesco/);
  // The AI wrote none of it, and a command stores no chat.
  assert.equal(world.aiCalls, 0);
  assert.ok(store.keys().every(key => key.startsWith('slotbee:live:msg:')), store.keys().join());
});

test('with RESEARCH_MODE=1 Telegram keeps the study wording for research participants', async () => {
  const world = outsideWorld(aiAnswer());
  await deployedWith({ ...SETTINGS, RESEARCH_MODE: '1' }, () => telegramWebhook(telegramUpdate('/start', 'de')), { store: new FakeStore(NOW), outside: world.outside });
  assert.equal(world.sent[0].text, telegramWelcome('DE', { salon, study: true, product: PRODUCT_NAME }));
  assert.match(world.sent[0].text, /HSG/);
  assert.match(world.sent[0].text, /14 Tagen/);
});

test('the study wording on messengers is on for RESEARCH_MODE=1 and for nothing else', () => {
  assert.equal(researchSetting({ RESEARCH_MODE: '1' }), true);
  assert.equal(researchSetting({ RESEARCH_MODE: ' 1 ' }), true);
  for (const value of ['', '0', 'true', 'yes', 'on']) assert.equal(researchSetting({ RESEARCH_MODE: value }), false, value);
  assert.equal(researchSetting({}), false);
});

test('/delete on Telegram deletes the chat and says so only when it is true', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld(aiAnswer({ languageCode: 'fr', languageName: 'French', reply: 'Bonjour !' }));
  await quietly(() => deployedWith(SETTINGS, async () => {
    await telegramWebhook(telegramUpdate('Bonjour'));
    assert.equal(storedChat(store, 'tg-987654')?.language, 'FR');
    // The storage fails once: the chat is still there and the customer is told to try again.
    const run = store.run.bind(store);
    store.run = (command: Command) => { if (command[1] === DELETE_SCRIPT) throw new Error('storage hiccup'); return run(command); };
    await telegramWebhook(telegramUpdate('/delete'));
    store.run = run;
    assert.notEqual(storedChat(store, 'tg-987654'), null);
    await telegramWebhook(telegramUpdate('/delete@salon_bot'));
  }, { store, outside: world.outside }));
  assert.deepEqual(world.sent.map(message => message.text), ['Bonjour !', chatNotDeletedNotice('FR'), chatDeletedNotice('FR', salon)]);
  assert.equal(storedChat(store, 'tg-987654'), null);
  assert.deepEqual(store.holding('987654'), []);
  assert.equal(world.aiCalls, 1);
});

// ---------- WhatsApp ----------

let waMessage = 0;
const whatsappMessage = (text: string) => {
  waMessage += 1;
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      contacts: [{ wa_id: '41790000000', profile: { name: 'Sofia Rossi' } }],
      messages: [{ id: `wamid.${waMessage}`, from: '41790000000', timestamp: String(NOW / 1000), type: 'text', text: { body: text } }],
    } }] }],
  });
  return new Request('https://site.invalid/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}` },
    body: raw,
  });
};

test('the first WhatsApp message gets the fixed notice before the AI answer, later messages the answer only', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld(aiAnswer({ languageCode: 'it', languageName: 'Italian', reply: 'Ciao! Come posso aiutarla?' }));
  await quietly(() => deployedWith(SETTINGS, async () => {
    assert.equal((await whatsappWebhook(whatsappMessage('Ciao, avete posto sabato?'))).status, 200);
    assert.equal((await whatsappWebhook(whatsappMessage('Alle 10?'))).status, 200);
  }, { store, outside: world.outside }));
  assert.deepEqual(world.sent.map(message => message.text), [
    firstContactNotice('IT', 'WhatsApp', { salon }),
    'Ciao! Come posso aiutarla?',
    'Ciao! Come posso aiutarla?',
  ]);
  assert.match(world.sent[0].text, /Gemini/);
  assert.match(world.sent[0].text, /14 giorni/);
  assert.ok(world.sent.every(message => message.channel === 'WhatsApp' && message.to === '41790000000'));
  // The stored chat holds what the customer and the AI said; the notice is a fixed text and not part of it.
  assert.deepEqual(storedChat(store, '41790000000')?.messages.map(message => message.sender), ['customer', 'ai', 'customer', 'ai']);
  assert.equal(store.secondsLeft('slotbee:live:chat:41790000000'), RETENTION_SECONDS);
});

test('if the AI is down on first contact, the WhatsApp customer still learns who answers', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld(null);
  await quietly(() => deployedWith({ ...SETTINGS, RESEARCH_MODE: '1' }, () => whatsappWebhook(whatsappMessage('Hallo')), { store, outside: world.outside }));
  assert.deepEqual(world.sent.map(message => message.text), [firstContactNotice('EN', 'WhatsApp', { salon, study: true, product: PRODUCT_NAME })]);
  assert.match(world.sent[0].text, /HSG/);
  assert.equal(storedChat(store, '41790000000')?.status, 'needs-attention');
});

test('/delete on WhatsApp deletes the chat without asking the AI', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld(aiAnswer({ languageCode: 'de', languageName: 'German', reply: 'Guten Tag!' }));
  await quietly(() => deployedWith(SETTINGS, async () => {
    await whatsappWebhook(whatsappMessage('Guten Tag'));
    await whatsappWebhook(whatsappMessage(' /Delete '));
  }, { store, outside: world.outside }));
  assert.equal(world.aiCalls, 1);
  assert.equal(world.sent.at(-1)?.text, chatDeletedNotice('DE', salon));
  assert.equal(storedChat(store, '41790000000'), null);
});
