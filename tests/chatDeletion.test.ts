/**
 * A customer who deletes their chat must find it deleted, whatever else was going on at that
 * moment. Every handler loads a chat, waits many seconds for the AI or a translation, and then
 * saves the chat. These tests let the deletion arrive in exactly that wait.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DELETE as deleteChat, GET as readChat, POST as writeChat } from '../api/chat';
import { POST as telegramWebhook } from '../api/telegram/webhook';
import { POST as act } from '../api/whatsapp/action';
import { GET as ownerInbox } from '../api/whatsapp/conversations';
import { POST as whatsappWebhook } from '../api/whatsapp/webhook';
import { DELETE_SCRIPT, DELETION_MARKER_SECONDS, RETENTION_SECONDS, SAVE_SCRIPT } from '../server/store';
import type { LiveConversation } from '../server/whatsappCore';
import { chatDeletedNotice, firstContactNotice } from '../src/customerNotice';
import { initialCompanySettings } from '../src/mockData';
import { Command, deployedWith, FakeStore } from './fakeStore';
import {
  aiAnswer, chatRequest, freezeClock, NOW, outsideWorld, ownerAction, quietly, SESSION, SETTINGS, storedChat, TELEGRAM_CHAT, telegramUpdate,
  WHATSAPP_NUMBER, whatsappMessage,
} from './liveChatHarness';

const salon = initialCompanySettings.companyName;
const REPLY = 'Hello! How can I help you?';
const post = (text: string) => chatRequest('POST', { body: { session: SESSION, name: 'Eva', text } });
/** The chats the owner's page would show right now. */
const inbox = async () => {
  const response = await ownerInbox(new Request('https://site.invalid/api/whatsapp/conversations', { headers: { 'x-live-key': 'right-key' } }));
  return ((await response.json()) as { conversations: { id: string }[] }).conversations.map(chat => chat.id);
};

test('website chat: a chat deleted while an answer is on its way stays deleted, and the next message starts a clean one', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  let deleted: unknown = null;
  const world = outsideWorld({
    // The visitor has the chat open twice. While the second message is with the AI, they delete the chat in the other tab.
    whileAiWorks: async (call) => { if (call === 2) deleted = await (await deleteChat(chatRequest('DELETE', { session: SESSION }))).json(); },
  });
  await quietly(() => deployedWith(SETTINGS, async () => {
    assert.equal((await writeChat(post('My private question number one'))).status, 200);
    const late = await writeChat(post('And a second one'));
    // The visitor was told "deleted" ...
    assert.deepEqual(deleted, { deleted: true });
    // ... so the answer that comes back afterwards brings nothing with it and stores nothing.
    assert.equal(late.status, 410);
    assert.deepEqual(await late.json(), { error: 'Your chat has been deleted, so this message was not sent. You can send it again to start a new chat.' });
    assert.equal(storedChat(store, `web-${SESSION}`), null);
    assert.deepEqual(store.holding(SESSION), []);
    assert.deepEqual(await (await readChat(chatRequest('GET', { session: SESSION }))).json(), { messages: [] });
    assert.deepEqual(await inbox(), []);

    // A message sent after the deletion starts a clean chat.
    const again = await writeChat(post('Hello again'));
    assert.equal(again.status, 200);
    const body = (await again.json()) as { messages: { from: string; text: string }[] };
    assert.deepEqual(body.messages.map(message => [message.from, message.text]), [['me', 'Hello again'], ['salon', REPLY]]);
  }, { store, outside: world.outside }));
  assert.deepEqual(storedChat(store, `web-${SESSION}`)?.messages.map(message => message.original), ['Hello again', REPLY]);
  // The AI was not shown anything from before the deletion either.
  assert.equal(world.prompts.length, 3);
  assert.match(world.prompts[1], /My private question number one/);
  assert.doesNotMatch(world.prompts[2], /private question|second one/);
  assert.match(world.prompts[2], /\(no earlier messages\)/);
});

test('Telegram: /delete while an answer is on its way: the chat stays deleted and no answer follows the confirmation', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const deletions: number[] = [];
  const world = outsideWorld({
    ai: aiAnswer({ languageCode: 'de', languageName: 'German', reply: 'Gern!' }),
    // The second message is with the AI when the customer sends /delete.
    whileAiWorks: async (call) => { if (call === 2) deletions.push((await telegramWebhook(telegramUpdate('/delete'))).status); },
  });
  await quietly(() => deployedWith(SETTINGS, async () => {
    assert.equal((await telegramWebhook(telegramUpdate('Hallo, ich heisse Tim'))).status, 200);
    assert.equal((await telegramWebhook(telegramUpdate('Noch eine Frage'))).status, 200);
    assert.deepEqual(deletions, [200]);
    // The last thing the customer reads is that the chat is deleted. The answer to the message
    // from before is not sent after it.
    assert.deepEqual(world.sent.map(message => message.text), ['Gern!', chatDeletedNotice('DE', salon)]);
    assert.equal(storedChat(store, `tg-${TELEGRAM_CHAT}`), null);
    assert.deepEqual(store.holding(String(TELEGRAM_CHAT)), []);
    assert.deepEqual(await inbox(), []);

    // A message sent after the deletion starts a clean chat, and is answered as usual.
    await telegramWebhook(telegramUpdate('Hallo nochmal'));
  }, { store, outside: world.outside }));
  assert.equal(world.sent.at(-1)?.text, 'Gern!');
  assert.deepEqual(storedChat(store, `tg-${TELEGRAM_CHAT}`)?.messages.map(message => message.original), ['Hallo nochmal', 'Gern!']);
  assert.doesNotMatch(world.prompts[2], /Tim|Noch eine Frage/);
});

test('Telegram: a deletion that slips in between the last check and the save still wins', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld();
  // The narrowest case: the answer is already sent, and the customer's /delete is handled just before it is saved.
  // Each message is saved three times: on arrival, with the AI's reading, and with the reply once it went out.
  const run = store.run.bind(store);
  let saves = 0;
  store.run = (command: Command) => {
    if (command[1] === SAVE_SCRIPT && (saves += 1) === 6) {
      run(['EVAL', DELETE_SCRIPT, 3, command[3], command[4], 'slotbee:live:index', 'another-request', 600, `tg-${TELEGRAM_CHAT}`]);
    }
    return run(command);
  };
  await quietly(() => deployedWith(SETTINGS, async () => {
    await telegramWebhook(telegramUpdate('Hello'));
    await telegramWebhook(telegramUpdate('One more question'));
  }, { store, outside: world.outside }));
  assert.equal(saves, 6);
  assert.equal(storedChat(store, `tg-${TELEGRAM_CHAT}`), null);
  assert.deepEqual(store.holding(String(TELEGRAM_CHAT)), []);
});

test('WhatsApp: /delete while an answer is on its way: nothing more is sent, and a later message is treated as a first contact', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const deletions: number[] = [];
  const world = outsideWorld({
    ai: aiAnswer({ languageCode: 'it', languageName: 'Italian', reply: 'Certo!' }),
    whileAiWorks: async (call) => { if (call === 2) deletions.push((await whatsappWebhook(whatsappMessage('/delete'))).status); },
  });
  const notice = firstContactNotice('IT', 'WhatsApp', { salon });
  await quietly(() => deployedWith(SETTINGS, async () => {
    await whatsappWebhook(whatsappMessage('Ciao, avete posto sabato?'));
    await whatsappWebhook(whatsappMessage('Alle 10?'));
    assert.deepEqual(deletions, [200]);
    assert.deepEqual(world.sent.map(message => message.text), [notice, 'Certo!', chatDeletedNotice('IT', salon)]);
    assert.equal(storedChat(store, WHATSAPP_NUMBER), null);
    // The number is nowhere in the storage, not in clear and not inside a message id.
    assert.deepEqual(store.holding(WHATSAPP_NUMBER), []);
    assert.deepEqual(store.holding(Buffer.from(WHATSAPP_NUMBER).toString('base64').slice(0, 12)), []);

    // Writing again starts a clean chat. The customer is told again what happens to the messages.
    await whatsappWebhook(whatsappMessage('Buongiorno'));
  }, { store, outside: world.outside }));
  assert.deepEqual(world.sent.slice(3).map(message => message.text), [notice, 'Certo!']);
  assert.deepEqual(storedChat(store, WHATSAPP_NUMBER)?.messages.map(message => message.original), ['Buongiorno', 'Certo!']);
  assert.doesNotMatch(world.prompts[2], /sabato|Alle 10/);
});

test('with no answer to send (the owner has taken over, or the AI is down) the save alone keeps a deleted chat deleted', async (t) => {
  freezeClock(t);
  for (const channel of ['Telegram', 'WhatsApp'] as const) {
    for (const aiDown of [false, true]) {
      const store = new FakeStore(NOW);
      const waId = channel === 'Telegram' ? `tg-${TELEGRAM_CHAT}` : WHATSAPP_NUMBER;
      const deliver = (text: string) => channel === 'Telegram' ? telegramWebhook(telegramUpdate(text)) : whatsappWebhook(whatsappMessage(text));
      const world = outsideWorld({
        ai: call => aiDown && call >= 2 ? null : aiAnswer(),
        // The second message is with the AI when the customer sends /delete.
        whileAiWorks: async (call) => { if (call === 2) await deliver('/delete'); },
      });
      await quietly(() => deployedWith(SETTINGS, async () => {
        await deliver('Hello');
        if (!aiDown) assert.equal((await act(ownerAction({ type: 'take-over', conversationId: `live-${waId}` }))).status, 200);
        await deliver('Are you there?');
      }, { store, outside: world.outside }));
      const where = `${channel}, ${aiDown ? 'the AI is down' : 'the owner has taken over'}`;
      // Nothing was about to be sent, so nothing asked about a deletion before the save. The save itself refused.
      assert.equal(storedChat(store, waId), null, where);
      assert.deepEqual(store.holding(channel === 'Telegram' ? String(TELEGRAM_CHAT) : WHATSAPP_NUMBER), [], where);
      assert.equal(world.sent.at(-1)?.text, chatDeletedNotice('EN', salon), where);
    }
  }
});

test('website chat: the AI is down and the visitor deletes the chat meanwhile: the message is not kept for the owner either', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld({ ai: null, whileAiWorks: async (call) => { if (call === 1) await deleteChat(chatRequest('DELETE', { session: SESSION })); } });
  await quietly(() => deployedWith(SETTINGS, async () => {
    const response = await writeChat(post('My private question'));
    assert.equal(response.status, 410);
    assert.equal(storedChat(store, `web-${SESSION}`), null);
    assert.deepEqual(await inbox(), []);
  }, { store, outside: world.outside }));
});

test('owner reply: the customer deletes the chat while the reply is translated: it is not sent and nothing is stored again', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld({
    // Call 1 answers the customer. Call 2 translates the owner's reply: meanwhile the customer sends /delete.
    whileAiWorks: async (call) => { if (call === 2) await telegramWebhook(telegramUpdate('/delete')); },
  });
  await quietly(() => deployedWith(SETTINGS, async () => {
    await telegramWebhook(telegramUpdate('Do you have a slot on Friday?'));
    assert.deepEqual(await inbox(), [`live-tg-${TELEGRAM_CHAT}`]);
    const response = await act(ownerAction({ type: 'reply', conversationId: `live-tg-${TELEGRAM_CHAT}`, text: 'Yes, at 10:00.' }));
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), { error: 'This chat was deleted by the customer.' });
    // The customer got the confirmation of the deletion and nothing after it.
    assert.deepEqual(world.sent.map(message => message.text), [REPLY, chatDeletedNotice('EN', salon)]);
    assert.equal(storedChat(store, `tg-${TELEGRAM_CHAT}`), null);
    // The owner's page drops the chat with its next look at the list.
    assert.deepEqual(await inbox(), []);
    // Acting on it once more says that it is gone.
    const gone = await act(ownerAction({ type: 'take-over', conversationId: `live-tg-${TELEGRAM_CHAT}` }));
    assert.equal(gone.status, 404);
    assert.deepEqual(await gone.json(), { error: 'This chat no longer exists' });
  }, { store, outside: world.outside }));
  assert.equal(world.prompts.length, 2);
});

test('owner reply and booking confirmation in a website chat that its visitor deletes meanwhile', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const id = `live-web-${SESSION}`;
  // A chat with an open booking request, as the AI leaves it for the owner.
  const waiting: LiveConversation = {
    waId: `web-${SESSION}`, channel: 'Website', customerName: 'Eva', language: 'EN', status: 'needs-attention', takenOver: false, updatedAt: NOW,
    messages: [{ id: 'm1', sender: 'customer', original: 'A haircut on Thursday at 10:00, please.', translation: 'A haircut on Thursday at 10:00, please.', time: '12:00' }],
    bookingRequest: { service: 'Haircut', date: '2026-10-08', time: '10:00', customerName: 'Eva', status: 'requested' },
  };
  // The owner's own reply is translated first: the visitor deletes the chat while that runs.
  const world = outsideWorld({ whileAiWorks: () => deleteChat(chatRequest('DELETE', { session: SESSION })) });
  // The confirmation is a fixed text and needs no AI: the deletion lands between loading the chat and saving it.
  const run = store.run.bind(store);
  let deleteBeforeSave = false;
  store.run = (command: Command) => {
    if (deleteBeforeSave && command[1] === SAVE_SCRIPT) {
      deleteBeforeSave = false;
      run(['EVAL', DELETE_SCRIPT, 3, command[3], command[4], 'slotbee:live:index', 'another-request', 600, `web-${SESSION}`]);
    }
    return run(command);
  };
  await quietly(() => deployedWith(SETTINGS, async () => {
    for (const action of [{ type: 'reply', conversationId: id, text: 'See you then.' }, { type: 'confirm-booking', conversationId: id }]) {
      store.advance(DELETION_MARKER_SECONDS * 1000); // the deletion of the round before is long over
      store.run(['SET', `slotbee:live:chat:web-${SESSION}`, JSON.stringify(waiting), 'EX', RETENTION_SECONDS]);
      deleteBeforeSave = action.type === 'confirm-booking';
      const response = await act(ownerAction(action));
      assert.equal(response.status, 410, action.type);
      assert.deepEqual(await response.json(), { error: 'This chat was deleted by the customer.' });
      // A website chat reads its replies from the storage: nothing was stored, so nothing reaches the visitor.
      assert.equal(storedChat(store, `web-${SESSION}`), null, action.type);
      assert.deepEqual(await (await readChat(chatRequest('GET', { session: SESSION }))).json(), { messages: [] });
    }
  }, { store, outside: world.outside }));
  // Only the owner's own words went to the AI, for the translation. The confirmation is a fixed text.
  assert.equal(world.prompts.length, 1);
});

test('owner taking over a chat in the moment its customer deletes it', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld();
  // Taking over has no slow step. The deletion lands between loading the chat and saving it.
  // (The visitor's message is saved twice before: on arrival and with the answer.)
  const run = store.run.bind(store);
  let saves = 0;
  store.run = (command: Command) => {
    if (command[1] === SAVE_SCRIPT && (saves += 1) === 3) {
      run(['EVAL', DELETE_SCRIPT, 3, command[3], command[4], 'slotbee:live:index', 'another-request', 600, `web-${SESSION}`]);
    }
    return run(command);
  };
  await quietly(() => deployedWith(SETTINGS, async () => {
    await writeChat(post('Hello'));
    for (const type of ['take-over', 'let-ai-continue']) {
      const response = await act(ownerAction({ type, conversationId: `live-web-${SESSION}` }));
      if (type === 'take-over') {
        assert.equal(response.status, 410);
        assert.deepEqual(await response.json(), { error: 'This chat was deleted by the customer.' });
      } else {
        assert.equal(response.status, 404);
      }
      assert.equal(storedChat(store, `web-${SESSION}`), null);
    }
  }, { store, outside: world.outside }));
});

test('an owner action on a chat that still exists works as before', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld();
  await quietly(() => deployedWith(SETTINGS, async () => {
    await telegramWebhook(telegramUpdate('Do you have a slot on Friday?'));
    const response = await act(ownerAction({ type: 'reply', conversationId: `live-tg-${TELEGRAM_CHAT}`, text: 'Yes, at 10:00.' }));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { conversations: { id: string; takenOver: boolean; messages: { sender: string; original: string }[] }[] };
    assert.deepEqual(body.conversations.map(chat => chat.id), [`live-tg-${TELEGRAM_CHAT}`]);
    assert.equal(body.conversations[0].takenOver, true);
    // The customer writes English, so the owner's English text goes out as it is.
    assert.deepEqual(body.conversations[0].messages.map(message => [message.sender, message.original]), [
      ['customer', 'Do you have a slot on Friday?'], ['ai', REPLY], ['owner', 'Yes, at 10:00.'],
    ]);
  }, { store, outside: world.outside }));
  assert.deepEqual(world.sent.map(message => message.text), [REPLY, 'Yes, at 10:00.']);
});
