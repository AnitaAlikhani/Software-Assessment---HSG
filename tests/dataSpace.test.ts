import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { dataSpace, usesLiveData } from '../server/environment';
import {
  claimMessage, DELETE_SCRIPT, deleteConversation, deletedSince, deleteOwnChat, keyPrefix, listConversations, loadConversation, loadForUpdate,
  NO_DELETION_SEEN, releaseMessage, SAVE_SCRIPT, saveConversation,
} from '../server/store';
import { GET as spaceRoute } from '../api/space';
import { GET as telegramSetup } from '../api/telegram/setup';
import { GET as conversationsRoute } from '../api/whatsapp/conversations';
import { GET as whatsappVerification } from '../api/whatsapp/webhook';
import type { LiveConversation } from '../server/whatsappCore';
import { Command, deployedWith, FakeStore } from './fakeStore';
import { FIXED_NOW } from './fixedClock';

const WORK_BRANCH_PREVIEW = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'launch' };
const NOW = FIXED_NOW.getTime();
const FOURTEEN_DAYS = 14 * 24 * 60 * 60;

test('only a Vercel preview of a work branch is moved away from the live chats', () => {
  // The live site, however it is deployed, and every copy we know nothing about keep the live chats.
  assert.equal(dataSpace({}), 'live');
  assert.equal(dataSpace({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'anything' }), 'live');
  assert.equal(dataSpace({ VERCEL_ENV: 'development' }), 'live');
  assert.equal(dataSpace({ VERCEL_ENV: 'preview' }), 'live'); // no branch name: do not guess
  assert.equal(dataSpace({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: '  ' }), 'live');
  assert.equal(dataSpace({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'nil-live-whatsapp' }), 'live');
  // A preview of any other branch gets its own space.
  assert.equal(dataSpace(WORK_BRANCH_PREVIEW), 'preview');
  assert.equal(dataSpace({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'main' }), 'preview');
  assert.equal(dataSpace({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'nil-live-whatsapp-2' }), 'preview');
  assert.equal(usesLiveData(WORK_BRANCH_PREVIEW), false);
  // The one setting can give a preview the live chats ...
  assert.equal(dataSpace({ ...WORK_BRANCH_PREVIEW, LIVE_DATA_SPACE: 'live' }), 'live');
  assert.equal(dataSpace({ ...WORK_BRANCH_PREVIEW, LIVE_DATA_SPACE: ' Live ' }), 'live');
  // ... but no value of it can take the live chats away from a copy that has them.
  for (const value of ['test', 'preview', 'production', 'true', '', '   ']) {
    assert.equal(dataSpace({ VERCEL_ENV: 'production', LIVE_DATA_SPACE: value }), 'live', value);
    assert.equal(dataSpace({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'nil-live-whatsapp', LIVE_DATA_SPACE: value }), 'live', value);
    assert.equal(dataSpace({ LIVE_DATA_SPACE: value }), 'live', value);
    assert.equal(dataSpace({ ...WORK_BRANCH_PREVIEW, LIVE_DATA_SPACE: value }), 'preview', value);
  }
});

test('the live site keeps its old key names and the preview space never shares them', () => {
  assert.equal(keyPrefix('live'), 'slotbee:live:');
  assert.equal(keyPrefix('preview'), 'slotbee:preview:live:');
  assert.ok(!keyPrefix('preview').startsWith(keyPrefix('live')));
});

const chat = { waId: '4179' } as LiveConversation;
// What the storage holds for it: the chat, and the time it is deleted unless something happens in it.
const stored = JSON.stringify({ ...chat, keptUntil: NOW + FOURTEEN_DAYS * 1000 });
/** Key names that must not show a customer id or a message id carry a hash of it instead. */
const hashed = (text: string) => createHash('sha256').update(text).digest('hex');
const everyStoreAction = async () => {
  await saveConversation(chat, NO_DELETION_SEEN, NOW);
  await loadConversation('4179');
  await loadForUpdate('4179');
  await deletedSince('4179', NO_DELETION_SEEN);
  await listConversations();
  await claimMessage('wamid.1');
  await releaseMessage('wamid.1');
  await deleteOwnChat('4179');
  await deleteConversation('4179');
};
/** A deletion leaves a marker with a new random value each time. Checks that it is one, and puts a fixed word in its place. */
const withoutRandomValues = (commands: Command[]) => {
  const values = commands.filter(command => command[1] === DELETE_SCRIPT).map(command => String(command[6]));
  for (const value of values) assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(new Set(values).size, values.length);
  return commands.map(command => command[1] === DELETE_SCRIPT ? command.map((part, index) => index === 6 ? 'RANDOM' : part) : command);
};

test('on the live site every chat is stored under the key it always had, and no other key names a customer', async () => {
  const liveSites: Record<string, string>[] = [
    {}, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'nil-live-whatsapp' }, { VERCEL_ENV: 'preview' },
  ];
  const marker = `slotbee:live:gone:${hashed('4179')}`;
  const claim = `slotbee:live:msg:${hashed('wamid.1')}`;
  for (const settings of liveSites) {
    assert.deepEqual(withoutRandomValues(await deployedWith(settings, everyStoreAction, { store: new FakeStore(NOW) })), [
      // Saving: the chat under its own key, with its 14 days, unless it was deleted meanwhile. The
      // key name and the stored text are the ones every chat saved before this version has, so
      // those stay reachable. No list of chats is written.
      ['EVAL', SAVE_SCRIPT, 2, 'slotbee:live:chat:4179', marker, 'none', stored, FOURTEEN_DAYS],
      // Once an hour a save looks whether the earlier version's list still holds ids to take out.
      ['SMEMBERS', 'slotbee:live:index'],
      // Reading one chat to show it, and reading it with its deletion marker to change it.
      ['GET', 'slotbee:live:chat:4179'],
      ['MGET', 'slotbee:live:chat:4179', marker],
      ['GET', marker],
      // Listing all chats: by their key names, and a poll never writes.
      ['SCAN', '0', 'MATCH', 'slotbee:live:chat:*', 'COUNT', 1000],
      ['MGET', 'slotbee:live:chat:4179'],
      // A message id can give the customer away, so a claim is named after a hash of it.
      ['SET', claim, '1', 'NX', 'EX', 172800],
      ['DEL', claim],
      // A customer deleting their own chat touches that chat only: it leaves the marker for ten
      // minutes and takes the id off the earlier version's list ...
      ['EVAL', DELETE_SCRIPT, 3, 'slotbee:live:chat:4179', marker, 'slotbee:live:index', 'RANDOM', 600, '4179'],
      // ... the owner's delete also clears the old single-key storage, as before.
      ['EVAL', DELETE_SCRIPT, 3, 'slotbee:live:chat:4179', marker, 'slotbee:live:index', 'RANDOM', 600, '4179'],
      ['DEL', 'slotbee:live-whatsapp'],
    ]);
  }
});

test('a preview of a work branch never touches a key of the live site', async () => {
  const commands = await deployedWith(WORK_BRANCH_PREVIEW, everyStoreAction, { store: new FakeStore(NOW) });
  assert.deepEqual(commands.map(command => command[0]),
    ['EVAL', 'SMEMBERS', 'GET', 'MGET', 'GET', 'SCAN', 'MGET', 'SET', 'DEL', 'EVAL', 'EVAL']);
  // Every key, and the pattern the listing searches with.
  const keys = commands.flatMap(command => command.slice(1).filter((part): part is string => typeof part === 'string' && part.startsWith('slotbee:')));
  assert.equal(keys.length, 17);
  for (const key of keys) assert.ok(key.startsWith('slotbee:preview:live:'), key);
});

test('a preview of a work branch cannot take over the Telegram bot or the WhatsApp number', async () => {
  const secrets = { LIVE_ACCESS_KEY: 'right-key', WHATSAPP_VERIFY_TOKEN: 'verify-word', TELEGRAM_BOT_TOKEN: '' };
  const setup = (key: string) => telegramSetup(new Request(`https://copy.invalid/api/telegram/setup?key=${key}`));
  const verify = () => whatsappVerification(new Request('https://copy.invalid/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-word&hub.challenge=1234'));

  await deployedWith({ ...WORK_BRANCH_PREVIEW, ...secrets }, async () => {
    assert.equal((await setup('wrong-key')).status, 401);
    const refused = await setup('right-key');
    assert.equal(refused.status, 409);
    assert.match(((await refused.json()) as { error: string }).error, /only possible on the live site/);
    assert.equal(verify().status, 403);
  });
  // On the live site both requests get past this check (Telegram then stops at the missing bot token).
  await deployedWith({ VERCEL_ENV: 'production', ...secrets }, async () => {
    const live = await setup('right-key');
    assert.equal(live.status, 500);
    assert.match(((await live.json()) as { error: string }).error, /TELEGRAM_BOT_TOKEN/);
    const verified = verify();
    assert.equal(verified.status, 200);
    assert.equal(await verified.text(), '1234');
  });
});

test('every copy can say which chats it uses, and a preview does not advertise the live bot', async () => {
  const space = (key: string) => spaceRoute(new Request(`https://copy.invalid/api/space?key=${key}`));
  const inbox = () => conversationsRoute(new Request('https://copy.invalid/api/whatsapp/conversations', { headers: { 'x-live-key': 'right-key' } }));

  // The preview's own storage holds one chat.
  const previewStore = new FakeStore(NOW);
  const previewChat: LiveConversation = { waId: '4179', channel: 'WhatsApp', customerName: 'Sofia Rossi', language: 'IT', status: 'ai-handled', takenOver: false, messages: [], updatedAt: NOW };
  await deployedWith(WORK_BRANCH_PREVIEW, () => saveConversation(previewChat, NO_DELETION_SEEN, NOW), { store: previewStore });
  // The live site's storage is the same database: a live chat with the same customer must not show up in the preview.
  await deployedWith({}, () => saveConversation({ ...previewChat, customerName: 'A live customer' }, NO_DELETION_SEEN, NOW), { store: previewStore });
  const previewCommands = await deployedWith({ ...WORK_BRANCH_PREVIEW, LIVE_ACCESS_KEY: 'right-key', TELEGRAM_BOT_TOKEN: 'bot-token' }, async () => {
    assert.equal((await space('wrong-key')).status, 401);
    assert.deepEqual(await (await space('right-key')).json(),
      { dataSpace: 'preview', usesLiveChats: false, vercelEnvironment: 'preview', branch: 'launch' });
    // With a bot token set, asking Telegram for the bot name would be a network call, which fails this test.
    const body = (await (await inbox()).json()) as { enabled: boolean; conversations: { customerName: string }[]; channels: { telegram: string | null } };
    assert.equal(body.enabled, true);
    assert.deepEqual(body.conversations.map(item => item.customerName), ['Sofia Rossi']);
    assert.equal(body.channels.telegram, null);
  }, { store: previewStore });
  assert.deepEqual(previewCommands, [['SCAN', '0', 'MATCH', 'slotbee:preview:live:chat:*', 'COUNT', 1000], ['MGET', 'slotbee:preview:live:chat:4179']]);

  await deployedWith({ LIVE_ACCESS_KEY: 'right-key' }, async () => {
    assert.deepEqual(await (await space('right-key')).json(),
      { dataSpace: 'live', usesLiveChats: true, vercelEnvironment: null, branch: null });
  });
});
