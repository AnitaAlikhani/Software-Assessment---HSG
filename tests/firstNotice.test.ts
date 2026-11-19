/**
 * The fixed text that tells a customer who answers and what happens to their messages must reach
 * them, also when sending it fails at first. And a text that cannot be sent must not cost the
 * customer their answer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as telegramWebhook } from '../api/telegram/webhook';
import { POST as act } from '../api/whatsapp/action';
import { POST as whatsappWebhook } from '../api/whatsapp/webhook';
import { chatDeletedNotice, firstContactNotice, telegramWelcome } from '../src/customerNotice';
import { initialCompanySettings } from '../src/mockData';
import { deployedWith, FakeStore } from './fakeStore';
import {
  aiAnswer, freezeClock, NOW, outsideWorld, ownerAction, quietly, SETTINGS, storedChat, TELEGRAM_CHAT, telegramUpdate, WHATSAPP_NUMBER, whatsappMessage,
} from './liveChatHarness';

const salon = initialCompanySettings.companyName;
const notice = firstContactNotice('EN', 'WhatsApp', { salon });
const UNANSWERED = 'The AI could not answer this message. Please reply yourself.';

test('WhatsApp: a first text that fails to send does not cost the answer, and goes out with the next message, once', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  // Meta has a short hiccup: the first message handed to it is not taken.
  const world = outsideWorld({ ai: aiAnswer({ reply: 'Sure, which day?' }), sendFails: attempt => attempt === 1 && 500 });
  await quietly(() => deployedWith(SETTINGS, async () => {
    await whatsappWebhook(whatsappMessage('Hi, I want a haircut'));
    // The customer got the answer although the text before it failed ...
    assert.deepEqual(world.failed.map(message => message.text), [notice]);
    assert.deepEqual(world.sent.map(message => message.text), ['Sure, which day?']);
    // ... the chat is an ordinary answered chat, and it does not claim that the text went out.
    const first = storedChat(store, WHATSAPP_NUMBER)!;
    assert.equal(first.status, 'ai-handled');
    assert.deepEqual(first.messages.map(message => message.sender), ['customer', 'ai']);
    assert.ok(!first.noticeSent);

    // With the next message the text is tried again, before the answer.
    await whatsappWebhook(whatsappMessage('Friday please'));
    assert.deepEqual(world.sent.map(message => message.text), ['Sure, which day?', notice, 'Sure, which day?']);
    assert.equal(storedChat(store, WHATSAPP_NUMBER)?.noticeSent, true);

    // After that, never again.
    await whatsappWebhook(whatsappMessage('At 10'));
    await whatsappWebhook(whatsappMessage('Thanks'));
  }, { store, outside: world.outside }));
  assert.deepEqual(world.sent.map(message => message.text), ['Sure, which day?', notice, 'Sure, which day?', 'Sure, which day?', 'Sure, which day?']);
  assert.equal(world.sent.filter(message => message.text === notice).length, 1);
  assert.equal(world.failed.length, 1);
});

test('WhatsApp: when nothing can be sent the owner is told, and the first text goes out before the owner\'s reply', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  // Meta takes nothing for a while: neither the first text nor the answer.
  const world = outsideWorld({ ai: aiAnswer({ reply: 'Sure, which day?' }), sendFails: attempt => attempt <= 2 });
  await quietly(() => deployedWith(SETTINGS, async () => {
    await whatsappWebhook(whatsappMessage('Hi, I want a haircut'));
    assert.equal(world.sent.length, 0);
    assert.deepEqual(world.failed.map(message => message.text), [notice, 'Sure, which day?']);
    // The message is kept for the owner, and the chat shows neither an answer nor a text that never left.
    const kept = storedChat(store, WHATSAPP_NUMBER)!;
    assert.equal(kept.status, 'needs-attention');
    assert.equal(kept.attentionReason, UNANSWERED);
    assert.deepEqual(kept.messages.map(message => message.sender), ['customer']);
    assert.ok(!kept.noticeSent);

    // The owner answers before the customer writes again: the first text goes ahead of the reply.
    const response = await act(ownerAction({ type: 'reply', conversationId: `live-${WHATSAPP_NUMBER}`, text: 'Hello, which day suits you?' }));
    assert.equal(response.status, 200);
    assert.deepEqual(world.sent.map(message => message.text), [notice, 'Hello, which day suits you?']);
    assert.equal(storedChat(store, WHATSAPP_NUMBER)?.noticeSent, true);

    // The owner has taken over. The customer's next message brings neither an AI answer nor the text again.
    await whatsappWebhook(whatsappMessage('Friday'));
  }, { store, outside: world.outside }));
  assert.deepEqual(world.sent.map(message => message.text), [notice, 'Hello, which day suits you?']);
  assert.deepEqual(storedChat(store, WHATSAPP_NUMBER)?.messages.map(message => message.sender), ['customer', 'owner', 'customer']);
});

test('WhatsApp: the first text goes out but the owner\'s reply after it does not: the text is still not sent twice', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  // Sends 1 and 2 (first text, AI answer) fail. Send 3 is the first text again, ahead of the owner's reply: it goes out.
  // Send 4, the reply itself, fails. From send 5 on everything works.
  const world = outsideWorld({ sendFails: attempt => attempt <= 2 || attempt === 4 });
  await quietly(() => deployedWith(SETTINGS, async () => {
    await whatsappWebhook(whatsappMessage('Hi, I want a haircut'));
    const failed = await act(ownerAction({ type: 'reply', conversationId: `live-${WHATSAPP_NUMBER}`, text: 'Hello, which day suits you?' }));
    assert.equal(failed.status, 502);
    assert.deepEqual(world.sent.map(message => message.text), [notice]);
    // The reply is not in the chat, as it never left. That the first text left is remembered.
    assert.deepEqual(storedChat(store, WHATSAPP_NUMBER)?.messages.map(message => message.sender), ['customer']);
    assert.equal(storedChat(store, WHATSAPP_NUMBER)?.noticeSent, true);
    // The owner tries again: the reply goes out, and the first text does not go out a second time.
    assert.equal((await act(ownerAction({ type: 'reply', conversationId: `live-${WHATSAPP_NUMBER}`, text: 'Hello, which day suits you?' }))).status, 200);
  }, { store, outside: world.outside }));
  assert.deepEqual(world.sent.map(message => message.text), [notice, 'Hello, which day suits you?']);
});

test('WhatsApp: the first text is tried again when the AI is down, in the language the chat already has', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const italian = aiAnswer({ languageCode: 'it', languageName: 'Italian', reply: 'Certo! Che giorno?' });
  // First message: the AI answers, Meta does not take the first text. Second message: the AI is down.
  const world = outsideWorld({ ai: call => call === 1 ? italian : null, sendFails: attempt => attempt === 1 });
  await quietly(() => deployedWith(SETTINGS, async () => {
    await whatsappWebhook(whatsappMessage('Ciao, avete posto sabato?'));
    assert.deepEqual(world.sent.map(message => message.text), ['Certo! Che giorno?']);
    await whatsappWebhook(whatsappMessage('Alle 10?'));
  }, { store, outside: world.outside }));
  assert.deepEqual(world.sent.map(message => message.text), ['Certo! Che giorno?', firstContactNotice('IT', 'WhatsApp', { salon })]);
  const chat = storedChat(store, WHATSAPP_NUMBER)!;
  assert.equal(chat.noticeSent, true);
  assert.equal(chat.language, 'IT');
  assert.equal(chat.status, 'needs-attention');
  assert.deepEqual(chat.messages.map(message => message.sender), ['customer', 'ai', 'customer']);
});

test('Telegram: a welcome that could not be sent is handed back, so Telegram delivers /start again until it has gone out', async () => {
  const store = new FakeStore(NOW);
  const world = outsideWorld({ sendFails: attempt => attempt === 1 });
  const welcome = telegramWelcome('DE', { salon });
  await quietly(() => deployedWith(SETTINGS, async () => {
    // The connection to Telegram breaks while the welcome is sent. We do not accept the update ...
    const first = await telegramWebhook(telegramUpdate('/start', { update: 7001, languageCode: 'de' }));
    assert.equal(first.status, 503);
    assert.equal(world.sent.length, 0);
    // ... and do not keep it as handled.
    assert.deepEqual(store.keys(), []);

    // Telegram delivers the same update again: now the welcome goes out.
    const second = await telegramWebhook(telegramUpdate('/start', { update: 7001, languageCode: 'de' }));
    assert.equal(second.status, 200);
    assert.deepEqual(world.sent.map(message => message.text), [welcome]);

    // Should Telegram deliver it once more (our answer got lost), the customer does not get it twice.
    assert.equal((await telegramWebhook(telegramUpdate('/start', { update: 7001, languageCode: 'de' }))).status, 200);
  }, { store, outside: world.outside }));
  assert.deepEqual(world.sent.map(message => message.text), [welcome]);
  assert.deepEqual(world.sent.map(message => message.to), [String(TELEGRAM_CHAT)]);
  // A command stores no chat.
  assert.ok(store.keys().every(key => key.startsWith('slotbee:live:msg:')), store.keys().join());
});

test('Telegram: a welcome that Telegram refuses for good is not asked for again', async () => {
  for (const status of [403, 400]) {
    const store = new FakeStore(NOW);
    // The customer blocked the bot right after pressing Start, or the chat is gone.
    const world = outsideWorld({ sendFails: () => status });
    await quietly(() => deployedWith(SETTINGS, async () => {
      const response = await telegramWebhook(telegramUpdate('/start', { update: 7100 + status }));
      assert.equal(response.status, 200);
      // The update stays handled: delivering it again would change nothing.
      assert.equal(store.keys().length, 1);
      assert.equal((await telegramWebhook(telegramUpdate('/start', { update: 7100 + status }))).status, 200);
    }, { store, outside: world.outside }));
    assert.equal(world.failed.length, 1);
  }
});

test('Telegram: when the confirmation of /delete cannot be sent, the command comes again and is confirmed then', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  // Send 1 is the AI answer. Send 2, the confirmation of the deletion, meets a busy Telegram.
  const world = outsideWorld({ sendFails: attempt => attempt === 2 && 502 });
  await quietly(() => deployedWith(SETTINGS, async () => {
    await telegramWebhook(telegramUpdate('Hello'));
    const first = await telegramWebhook(telegramUpdate('/delete', { update: 7300 }));
    assert.equal(first.status, 503);
    // The chat is deleted all the same: only the confirmation is missing.
    assert.equal(storedChat(store, `tg-${TELEGRAM_CHAT}`), null);
    assert.equal((await telegramWebhook(telegramUpdate('/delete', { update: 7300 }))).status, 200);
  }, { store, outside: world.outside }));
  assert.deepEqual(world.sent.map(message => message.text), ['Hello! How can I help you?', chatDeletedNotice('EN', salon)]);
  assert.equal(storedChat(store, `tg-${TELEGRAM_CHAT}`), null);
});
