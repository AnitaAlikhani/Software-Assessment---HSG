import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  deleteConversation, deletedSince, deleteOwnChat, DELETION_MARKER_SECONDS, listConversations, loadConversation, loadForUpdate,
  NO_DELETION_SEEN, RETENTION_SECONDS, saveConversation,
} from '../server/store';
import type { LiveConversation } from '../server/whatsappCore';
import { chatCopy } from '../src/CustomerChat';
import { chatDeletedNotice, chatNotDeletedNotice, CHAT_RETENTION_DAYS, firstContactNotice, telegramWelcome } from '../src/customerNotice';
import type { ChatLanguage } from '../src/types';
import { Command, deployedWith, FakeStore } from './fakeStore';
import { FIXED_NOW } from './fixedClock';

const NOW = FIXED_NOW.getTime();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const THIRTY_DAYS = 30 * 24 * 60 * 60;
const LANGUAGES: ChatLanguage[] = ['EN', 'DE', 'FR', 'IT'];
const EARLIER_LIST = 'slotbee:live:index';

const chatOf = (waId: string, text = 'Hello'): LiveConversation => ({
  waId, channel: 'Telegram', customerName: `Customer ${waId}`, language: 'EN', status: 'ai-handled', takenOver: false, updatedAt: NOW,
  messages: [{ id: `m-${waId}`, sender: 'customer', original: text, translation: text, time: '12:00' }],
});
/** Runs store calls on the live site against the given storage, at the storage's own time. Each call is a newly started instance. */
const live = (store: FakeStore, work: () => Promise<unknown>) => deployedWith({}, work, { store });
/** A new chat, or new activity in one, written by a request that saw no deletion. */
const save = (store: FakeStore, chat: LiveConversation) => live(store, async () => { assert.equal(await saveConversation(chat, NO_DELETION_SEEN, store.now), true); });
const listed = async (store: FakeStore) => {
  let names: string[] = [];
  await live(store, async () => { names = (await listConversations()).map(chat => chat.waId).sort(); });
  return names;
};
const names = (commands: Command[]) => commands.map(command => command[0]);
/** A chat as the earlier version stored it: 30 days, its id in the list of chats, and the list renewed for 30 days. */
const saveAsBefore = (store: FakeStore, chat: LiveConversation) => {
  store.run(['SET', `slotbee:live:chat:${chat.waId}`, JSON.stringify(chat), 'EX', THIRTY_DAYS]);
  store.run(['SADD', EARLIER_LIST, chat.waId]);
  store.run(['EXPIRE', EARLIER_LIST, THIRTY_DAYS]);
};
/** What a failing piece of housekeeping writes to the log while `work` runs. */
const errorsDuring = async (work: () => Promise<unknown>) => {
  const errors: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try { await work(); } finally { console.error = realError; }
  return errors;
};

test('a chat is deleted 14 days after its last activity, and nothing of it stays behind', async () => {
  assert.equal(CHAT_RETENTION_DAYS, 14);
  assert.equal(RETENTION_SECONDS, 14 * 24 * 60 * 60);
  const store = new FakeStore(NOW);
  await save(store, chatOf('tg-1'));
  assert.equal(store.secondsLeft('slotbee:live:chat:tg-1'), RETENTION_SECONDS);
  // The chat is all there is: no list of chats, no helper key.
  assert.deepEqual(store.keys(), ['slotbee:live:chat:tg-1']);

  // New activity on day 13 starts the 14 days again ...
  store.advance(13 * DAY);
  await save(store, chatOf('tg-1', 'One more question'));
  store.advance(13 * DAY);
  assert.deepEqual(await listed(store), ['tg-1']);
  assert.equal(store.secondsLeft('slotbee:live:chat:tg-1'), 24 * 60 * 60);
  // ... and without activity the chat is gone, and the storage is empty.
  store.advance(DAY);
  assert.deepEqual(await listed(store), []);
  assert.deepEqual(store.keys(), []);
});

test('a customer id is gone when the chat is, even when nobody writes any more', async () => {
  const store = new FakeStore(NOW);
  const numberA = '41791110001'; // a WhatsApp number
  const numberB = '41791110002';
  await save(store, chatOf(numberA)); // day 0: A writes
  store.advance(13 * DAY + 20 * HOUR);
  await save(store, chatOf(numberB)); // day 13: B writes. Nobody writes afterwards, and no request runs.
  // A's number is in A's own chat and nowhere else.
  assert.deepEqual(store.holding(numberA), [`slotbee:live:chat:${numberA}`]);

  const untouched = store.commands.length;
  store.advance(4 * HOUR); // day 14: A's chat has run out
  assert.deepEqual(store.holding(numberA), []);
  assert.deepEqual(store.keys(), [`slotbee:live:chat:${numberB}`]);
  store.advance(13 * DAY + 20 * HOUR); // day 27, 20:00: so has B's
  assert.deepEqual(store.keys(), []);
  // The storage did that alone: no save and no poll had to help.
  assert.equal(store.commands.length, untouched);
});

test('listing the chats costs two reads and never writes, even when it meets an expired chat', async () => {
  const store = new FakeStore(NOW);
  await save(store, chatOf('tg-1'));
  store.advance(DAY);
  await save(store, chatOf('tg-2'));
  store.advance(13 * DAY + HOUR); // tg-1 has expired, tg-2 has not
  const poll = await live(store, async () => { assert.deepEqual((await listConversations()).map(chat => chat.waId), ['tg-2']); });
  assert.deepEqual(poll, [['SCAN', '0', 'MATCH', 'slotbee:live:chat:*', 'COUNT', 1000], ['MGET', 'slotbee:live:chat:tg-2']]);
  const emptyPoll = await live(new FakeStore(NOW), () => listConversations());
  assert.deepEqual(names(emptyPoll), ['SCAN']);
});

test('the chats are found among hundreds of other keys, each of them once, however the storage splits the search', async () => {
  const store = new FakeStore(NOW);
  const mine = Array.from({ length: 12 }, (_, index) => `tg-${100 + index}`);
  for (const waId of mine) await save(store, chatOf(waId));
  // What else lives in the same database: message claims, deletion markers, a preview's chats,
  // the earlier version's list and its old storage, a key that only looks similar.
  for (let index = 0; index < 400; index += 1) store.run(['SET', `slotbee:live:msg:${index}`, '1', 'EX', 172800]);
  for (let index = 0; index < 40; index += 1) store.run(['SET', `slotbee:live:gone:${index}`, 'x', 'EX', DELETION_MARKER_SECONDS]);
  for (let index = 0; index < 30; index += 1) store.run(['SET', `slotbee:preview:live:chat:tg-${100 + index}`, JSON.stringify(chatOf('preview')), 'EX', RETENTION_SECONDS]);
  store.run(['SADD', EARLIER_LIST, 'tg-100', 'tg-gone']);
  store.run(['SET', 'slotbee:live-whatsapp', '{"conversations":[]}']);
  store.run(['SET', 'slotbee:live:chatter', 'not a chat']);
  assert.equal(store.keys().length, 12 + 400 + 40 + 30 + 3);

  // One call is enough when the storage looks at everything at once.
  let found: string[] = [];
  const once = await live(store, async () => { found = (await listConversations()).map(chat => chat.waId); });
  assert.deepEqual(names(once), ['SCAN', 'MGET']);
  assert.deepEqual(found.sort(), mine);

  // The storage may look at a few keys per call and may name a key twice (here: two of the
  // chats). The search goes on from where the last call stopped until the storage says it is
  // through, and every chat is read once.
  store.scanStep = 7;
  store.scanRepeats = true;
  const split = await live(store, async () => { found = (await listConversations()).map(chat => chat.waId); });
  const scans = split.filter(command => command[0] === 'SCAN');
  assert.equal(scans.length, Math.ceil(store.keys().length / 7));
  assert.deepEqual(scans.map(command => command[1]), scans.map((_, index) => String(index * 7)));
  assert.equal(split.length, scans.length + 1);
  assert.deepEqual(split.at(-1), ['MGET', ...mine.map(waId => `slotbee:live:chat:${waId}`)]);
  assert.deepEqual(found.sort(), mine);
});

test('a search for the chats always ends: after 100 calls it stops and says so in the log', async () => {
  const store = new FakeStore(NOW);
  for (let index = 0; index < 150; index += 1) store.run(['SET', `slotbee:live:chat:tg-${1000 + index}`, JSON.stringify(chatOf(`tg-${1000 + index}`)), 'EX', RETENTION_SECONDS]);
  store.scanStep = 1; // a storage that hands out one key per call
  let found = 0;
  let commands: Command[] = [];
  const errors = await errorsDuring(async () => { commands = await live(store, async () => { found = (await listConversations()).length; }); });
  assert.equal(commands.filter(command => command[0] === 'SCAN').length, 100);
  assert.equal(found, 100);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /stopped after 100 steps/);
});

test('a save cannot bring back a chat that was deleted after it was loaded', async () => {
  const store = new FakeStore(NOW);
  await save(store, chatOf('tg-1', 'My private question'));
  await live(store, async () => {
    // A request loads the chat and goes to the AI ...
    const request = await loadForUpdate('tg-1');
    assert.equal(request.version, NO_DELETION_SEEN);
    assert.equal(await deletedSince('tg-1', request.version), false);
    // ... the customer deletes the chat ...
    await deleteOwnChat('tg-1');
    assert.equal(await deletedSince('tg-1', request.version), true);
    // ... and when the request comes back with the answer, its save is refused.
    assert.equal(await saveConversation(request.conversation!, request.version, store.now), false);
    assert.equal(await loadConversation('tg-1'), null);

    // A message the customer sends after the deletion starts a clean chat: its request has seen the deletion.
    const afterwards = await loadForUpdate('tg-1');
    assert.equal(afterwards.conversation, null);
    assert.notEqual(afterwards.version, NO_DELETION_SEEN);
    assert.equal(await deletedSince('tg-1', afterwards.version), false);
    assert.equal(await saveConversation(chatOf('tg-1', 'A new start'), afterwards.version, store.now), true);
    // The request from before the deletion still cannot write, not on top of the new chat either.
    assert.equal(await saveConversation(request.conversation!, request.version, store.now), false);
    assert.deepEqual((await loadConversation('tg-1'))?.messages.map(message => message.original), ['A new start']);

    // Deleting again is a new deletion: a request that has only seen the first one is refused.
    await deleteOwnChat('tg-1');
    assert.equal(await saveConversation(chatOf('tg-1', 'A new start'), afterwards.version, store.now), false);
    assert.equal(await loadConversation('tg-1'), null);
  });
});

test('a deletion is remembered even when no chat was stored yet, and by the owner\'s delete too', async () => {
  const store = new FakeStore(NOW);
  await live(store, async () => {
    // The customer's very first message is still with the AI when they send /delete.
    const first = await loadForUpdate('tg-1');
    assert.equal(first.conversation, null);
    await deleteOwnChat('tg-1');
    assert.equal(await saveConversation(chatOf('tg-1'), first.version, store.now), false);

    // The owner deletes a chat while its customer's message is being answered.
    assert.equal(await saveConversation(chatOf('tg-2'), NO_DELETION_SEEN, store.now), true);
    const busy = await loadForUpdate('tg-2');
    await deleteConversation('tg-2');
    assert.equal(await saveConversation(busy.conversation!, busy.version, store.now), false);
  });
  assert.deepEqual(await listed(store), []);
});

test('the note that a chat was deleted cannot be read as the customer, and is gone after ten minutes', async () => {
  const store = new FakeStore(NOW);
  const number = '41791110001';
  await save(store, chatOf(number));
  await live(store, () => deleteOwnChat(number));
  // Nothing in the storage shows the number any more ...
  assert.deepEqual(store.holding(number), []);
  // ... what is left is one key named after a hash, holding a random value.
  const [marker, ...others] = store.keys();
  assert.deepEqual(others, []);
  assert.match(marker, /^slotbee:live:gone:[0-9a-f]{64}$/);
  assert.match(store.text(marker)!, /^[0-9a-f-]{36}$/);
  assert.equal(DELETION_MARKER_SECONDS, 600);
  assert.equal(store.secondsLeft(marker), DELETION_MARKER_SECONDS);

  // A customer who writes again within the ten minutes gets a clean chat. Its request has seen the marker.
  let afterwards = { conversation: null as LiveConversation | null, version: NO_DELETION_SEEN };
  await live(store, async () => { afterwards = await loadForUpdate(number); });
  assert.equal(afterwards.version, store.text(marker));
  // The AI is slow, and the marker runs out before the answer is saved. That is no new deletion:
  // the save goes through.
  store.advance(DELETION_MARKER_SECONDS * 1000);
  assert.deepEqual(store.keys(), []);
  await live(store, async () => { assert.equal(await saveConversation(chatOf(number, 'Hello again'), afterwards.version, store.now), true); });
  assert.deepEqual(store.keys(), [`slotbee:live:chat:${number}`]);
});

test('chats saved before this version stay reachable, with their content, for as long as they had', async () => {
  const store = new FakeStore(NOW);
  // The live site as the earlier version left it: two chats, one from yesterday, one twenty days old.
  saveAsBefore(store, chatOf('41791112233', 'Ciao, avete posto sabato?'));
  store.advance(19 * DAY);
  saveAsBefore(store, chatOf('web-abc123def456ghi7', 'Hallo'));
  store.advance(DAY);

  // Deploying this version changes nothing by itself: both chats are listed and complete.
  assert.deepEqual(await listed(store), ['41791112233', 'web-abc123def456ghi7']);
  await live(store, async () => {
    assert.equal((await loadConversation('41791112233'))?.messages[0].original, 'Ciao, avete posto sabato?');
  });
  assert.equal(store.secondsLeft('slotbee:live:chat:41791112233'), 10 * 24 * 60 * 60);
  assert.equal(store.secondsLeft('slotbee:live:chat:web-abc123def456ghi7'), 29 * 24 * 60 * 60);

  // A new customer writes. The earlier chats keep their time.
  await save(store, chatOf('tg-9'));
  assert.equal(store.secondsLeft('slotbee:live:chat:41791112233'), 10 * 24 * 60 * 60);
  assert.equal(store.secondsLeft('slotbee:live:chat:web-abc123def456ghi7'), 29 * 24 * 60 * 60);
  assert.deepEqual(await listed(store), ['41791112233', 'tg-9', 'web-abc123def456ghi7']);

  // Then nobody writes for 20 days: the new chat is gone after 14, the earlier one is still in the owner's list.
  store.advance(20 * DAY);
  assert.deepEqual(await listed(store), ['web-abc123def456ghi7']);
  // New activity in an earlier chat keeps its messages and gives it the 14 days from then on.
  await live(store, async () => {
    const earlier = await loadForUpdate('web-abc123def456ghi7');
    assert.equal(await saveConversation({ ...earlier.conversation!, takenOver: true }, earlier.version, store.now), true);
    assert.equal((await loadConversation('web-abc123def456ghi7'))?.messages[0].original, 'Hallo');
  });
  assert.equal(store.secondsLeft('slotbee:live:chat:web-abc123def456ghi7'), RETENTION_SECONDS);
  store.advance(14 * DAY);
  assert.deepEqual(store.keys(), []);
});

test('the earlier version\'s list of ids is emptied as its chats go, and never gets a new id', async () => {
  const store = new FakeStore(NOW);
  // What the earlier version left: three chats and their ids in its list. Two of the chats run
  // out, and their ids stay in the list, as they did under that version.
  saveAsBefore(store, chatOf('41791110001'));
  saveAsBefore(store, chatOf('tg-2'));
  store.advance(20 * DAY);
  saveAsBefore(store, chatOf('tg-3'));
  store.advance(11 * DAY);
  assert.deepEqual(store.members(EARLIER_LIST), ['41791110001', 'tg-2', 'tg-3']);
  assert.deepEqual(store.holding('41791110001'), [EARLIER_LIST]);
  const lifetime = store.secondsLeft(EARLIER_LIST);
  const setUp = store.commands.length;

  // One running instance, three saves.
  const commands = await live(store, async () => {
    await saveConversation(chatOf('tg-9'), NO_DELETION_SEEN, store.now);
    // The ids without a chat are out, the chat that still exists stays listed for a copy that
    // runs the earlier version, and the new chat's id did not go in.
    assert.deepEqual(store.members(EARLIER_LIST), ['tg-3']);
    // At most once an hour: a save 20 minutes later does not look at the list ...
    store.advance(20 * MINUTE);
    await saveConversation(chatOf('tg-9'), NO_DELETION_SEEN, store.now);
    // ... the first one after the hour does, and finds nothing to take out.
    store.advance(41 * MINUTE);
    await saveConversation(chatOf('tg-9'), NO_DELETION_SEEN, store.now);
  });
  assert.deepEqual(names(commands), ['EVAL', 'SMEMBERS', 'MGET', 'SREM', 'EVAL', 'EVAL', 'SMEMBERS', 'MGET']);
  assert.deepEqual(commands[3], ['SREM', EARLIER_LIST, '41791110001', 'tg-2']);
  assert.deepEqual(store.holding('41791110001'), []);
  // The list keeps the lifetime the earlier version gave it: nothing renews it.
  assert.equal(store.secondsLeft(EARLIER_LIST), lifetime! - 61 * 60);

  // The customer of the last listed chat deletes it: the id leaves the list, and an empty list does not exist.
  await live(store, () => deleteOwnChat('tg-3'));
  assert.ok(!store.keys().includes(EARLIER_LIST));
  // From then on a newly started instance looks once and finds nothing.
  assert.deepEqual(names(await save(store, chatOf('tg-9'))), ['EVAL', 'SMEMBERS']);
  // In all of this, nothing was added to the list and nothing kept it alive.
  assert.deepEqual(store.commands.slice(setUp).filter(command => ['SADD', 'EXPIRE'].includes(String(command[0]))), []);
  assert.deepEqual(await listed(store), ['tg-9']);
});

test('a chat saved in the moment the earlier list is cleaned is still found', async () => {
  const store = new FakeStore(NOW);
  saveAsBefore(store, chatOf('tg-1'));
  store.advance(25 * DAY);
  saveAsBefore(store, chatOf('tg-0'));
  store.advance(5 * DAY + MINUTE); // tg-1 has expired, its id is still in the earlier list
  // Another request saves tg-1 again at the worst moment: after the cleaner has seen it gone, before it removes the id.
  const run = store.run.bind(store);
  let interfered = false;
  store.run = (command: Command) => {
    if (command[0] === 'SREM' && !interfered) {
      interfered = true;
      run(['SET', 'slotbee:live:chat:tg-1', JSON.stringify(chatOf('tg-1', 'I am back')), 'EX', RETENTION_SECONDS]);
    }
    return run(command);
  };
  await save(store, chatOf('tg-2'));
  assert.ok(interfered);
  // The chats are found by their keys, so what the earlier list says does not matter here.
  assert.deepEqual(await listed(store), ['tg-0', 'tg-1', 'tg-2']);
});

test('a problem while cleaning the earlier list never fails a save', async () => {
  const store = new FakeStore(NOW);
  const run = store.run.bind(store);
  store.run = (command: Command) => {
    if (command[0] === 'SMEMBERS') throw new Error('storage hiccup');
    return run(command);
  };
  const errors = await errorsDuring(() => save(store, chatOf('tg-1')));
  assert.equal(errors.length, 1);
  assert.deepEqual(await listed(store), ['tg-1']);
});

test('a customer deleting their chat removes that chat only', async () => {
  const store = new FakeStore(NOW);
  store.run(['SET', 'slotbee:live-whatsapp', '{"conversations":[]}']); // the old single-key storage
  saveAsBefore(store, chatOf('web-abc123def456ghi7')); // a chat the earlier version listed
  await save(store, chatOf('tg-2'));
  await live(store, () => deleteOwnChat('web-abc123def456ghi7'));
  assert.deepEqual(await listed(store), ['tg-2']);
  assert.equal(store.text('slotbee:live:chat:web-abc123def456ghi7'), null);
  // Its id is off the earlier version's list too, and nothing else names it.
  assert.deepEqual(store.members(EARLIER_LIST), []);
  assert.deepEqual(store.holding('web-abc123def456ghi7'), []);
  assert.notEqual(store.text('slotbee:live-whatsapp'), null);
  // The owner's delete also clears the old storage, as it always did.
  await live(store, () => deleteConversation('tg-2'));
  assert.equal(store.text('slotbee:live-whatsapp'), null);
  assert.deepEqual(await listed(store), []);
  // Ten minutes later the two notes that something was deleted are gone as well.
  assert.equal(store.keys().length, 2);
  store.advance(DELETION_MARKER_SECONDS * 1000);
  assert.deepEqual(store.keys(), []);
});

test('every text a customer reads states the period the storage applies', () => {
  const period = `${CHAT_RETENTION_DAYS} days`;
  for (const study of [false, true]) {
    const copy = chatCopy(study, 'Salon Test', '+41 00 000 00 00');
    assert.ok(copy.privacy.includes(period), copy.privacy);
    assert.ok(copy.threadNote.includes(period));
    assert.ok(copy.details.some(line => line.includes(period)));
    // Who answers and who processes the messages.
    assert.match(copy.privacy, /Google's AI service Gemini/);
    assert.match(copy.subtitle, /AI assistant/);
  }
  const days: Record<ChatLanguage, string> = { EN: '14 days', DE: '14 Tagen', FR: '14 jours', IT: '14 giorni' };
  for (const language of LANGUAGES) {
    for (const text of [
      telegramWelcome(language, { salon: 'Salon Test' }),
      telegramWelcome(language, { salon: 'Salon Test', study: true, product: 'SlotBee' }),
      firstContactNotice(language, 'WhatsApp', { salon: 'Salon Test' }),
    ]) {
      assert.ok(text.includes(days[language]), text);
      assert.match(text, /Gemini/);
      assert.match(text, /Google/);
      assert.match(text, /\/delete/);
      assert.match(text, /Salon Test/);
    }
    assert.match(chatDeletedNotice(language, 'Salon Test'), /Salon Test/);
    assert.match(chatNotDeletedNotice(language), /\/delete/);
  }
  // The setup guide for the team names the same number.
  const guide = readFileSync(new URL('../WHATSAPP_LIVE_SETUP.md', import.meta.url), 'utf8');
  assert.ok(guide.includes(`${CHAT_RETENTION_DAYS} days`));
  assert.doesNotMatch(guide, /after 30 days|about two weeks/);
  // And it describes the storage as it is: no list of ids is kept, and a deletion leaves a marker for ten minutes.
  assert.equal(DELETION_MARKER_SECONDS, 10 * 60);
  assert.match(guide, /marker for ten minutes,\s+`slotbee:live:gone:<hash of the id>`/);
  assert.match(guide, /There is no list of chats beside it/);
  assert.doesNotMatch(guide, /the storage keeps one list of customer ids/);
});

test('study wording appears only for research participants, in every language', () => {
  const studyWords = /student|Studierenden|étudiant|studentesco|HSG|test chat|Test-Chat|chat de test|chat di prova/i;
  for (const language of LANGUAGES) {
    assert.doesNotMatch(telegramWelcome(language, { salon: 'Haar & Stil' }), studyWords);
    assert.doesNotMatch(firstContactNotice(language, 'WhatsApp', { salon: 'Haar & Stil' }), studyWords);
    assert.match(telegramWelcome(language, { salon: 'Haar & Stil', study: true, product: 'SlotBee' }), /HSG/);
    assert.match(telegramWelcome(language, { salon: 'Haar & Stil', study: true, product: 'SlotBee' }), /SlotBee/);
    assert.match(firstContactNotice(language, 'WhatsApp', { salon: 'Haar & Stil', study: true, product: 'SlotBee' }), /HSG/);
  }
  // What is stored differs by channel, and the text says which.
  assert.match(firstContactNotice('EN', 'WhatsApp', { salon: 'Haar & Stil' }), /your WhatsApp name and your number/);
  assert.match(firstContactNotice('EN', 'Telegram', { salon: 'Haar & Stil' }), /your Telegram name/);
  assert.match(telegramWelcome('DE', { salon: 'Haar & Stil' }), /^Grüezi! Das ist der Chat von Haar & Stil\./);
  assert.doesNotMatch(telegramWelcome('DE', { salon: 'Haar & Stil' }), /ß/);
});
