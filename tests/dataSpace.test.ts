import assert from 'node:assert/strict';
import test from 'node:test';
import { dataSpace, usesLiveData } from '../server/environment';
import { claimMessage, deleteConversation, keyPrefix, listConversations, loadConversation, saveConversation } from '../server/store';
import { GET as spaceRoute } from '../api/space';
import { GET as telegramSetup } from '../api/telegram/setup';
import { GET as conversationsRoute } from '../api/whatsapp/conversations';
import { GET as whatsappVerification } from '../api/whatsapp/webhook';
import type { LiveConversation } from '../server/whatsappCore';

const WORK_BRANCH_PREVIEW = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'launch' };
const SETTINGS = ['VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF', 'LIVE_DATA_SPACE', 'LIVE_ACCESS_KEY', 'TELEGRAM_BOT_TOKEN',
  'WHATSAPP_VERIFY_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
type Command = (string | number)[];

/**
 * Runs `work` as if the site were deployed with exactly these settings. Storage is replaced by a
 * recorder and every other network call fails, so nothing leaves the test. Everything is put back afterwards.
 */
async function deployedWith(settings: Record<string, string>, work: () => Promise<unknown>): Promise<Command[]> {
  const before = new Map(SETTINGS.map(name => [name, process.env[name]]));
  const realFetch = globalThis.fetch;
  const commands: Command[] = [];
  for (const name of SETTINGS) delete process.env[name];
  Object.assign(process.env, { KV_REST_API_URL: 'https://storage.invalid', KV_REST_API_TOKEN: 'test-token' }, settings);
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    if (String(input) !== 'https://storage.invalid') throw new Error(`unexpected network call to ${String(input)}`);
    const command = JSON.parse(String(init?.body)) as Command;
    commands.push(command);
    const result = command[0] === 'SMEMBERS' ? ['4179'] : command[0] === 'MGET' ? [null] : command[0] === 'GET' ? null : 'OK';
    return new Response(JSON.stringify({ result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try { await work(); }
  finally {
    globalThis.fetch = realFetch;
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
  return commands;
}

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
const everyStoreAction = async () => {
  await saveConversation(chat);
  await loadConversation('4179');
  await listConversations();
  await claimMessage('wamid.1');
  await deleteConversation('4179');
};

test('on the live site every storage command uses exactly the keys it used before', async () => {
  const liveSites: Record<string, string>[] = [
    {}, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'nil-live-whatsapp' }, { VERCEL_ENV: 'preview' },
  ];
  for (const settings of liveSites) {
    assert.deepEqual(await deployedWith(settings, everyStoreAction), [
      ['SET', 'slotbee:live:chat:4179', JSON.stringify(chat), 'EX', 2592000],
      ['SADD', 'slotbee:live:index', '4179'],
      ['EXPIRE', 'slotbee:live:index', 2592000],
      ['GET', 'slotbee:live:chat:4179'],
      ['SMEMBERS', 'slotbee:live:index'],
      ['MGET', 'slotbee:live:chat:4179'],
      ['SET', 'slotbee:live:msg:wamid.1', '1', 'NX', 'EX', 172800],
      ['DEL', 'slotbee:live:chat:4179'],
      ['SREM', 'slotbee:live:index', '4179'],
      ['DEL', 'slotbee:live-whatsapp'],
    ]);
  }
});

test('a preview of a work branch never touches a key of the live site', async () => {
  const commands = await deployedWith(WORK_BRANCH_PREVIEW, everyStoreAction);
  assert.deepEqual(commands.map(command => command[0]), ['SET', 'SADD', 'EXPIRE', 'GET', 'SMEMBERS', 'MGET', 'SET', 'DEL', 'SREM']);
  const keys = commands.flatMap(command => command.slice(1).filter((part): part is string => typeof part === 'string' && part.startsWith('slotbee:')));
  assert.equal(keys.length, 9);
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

  const previewCommands = await deployedWith({ ...WORK_BRANCH_PREVIEW, LIVE_ACCESS_KEY: 'right-key', TELEGRAM_BOT_TOKEN: 'bot-token' }, async () => {
    assert.equal((await space('wrong-key')).status, 401);
    assert.deepEqual(await (await space('right-key')).json(),
      { dataSpace: 'preview', usesLiveChats: false, vercelEnvironment: 'preview', branch: 'launch' });
    // With a bot token set, asking Telegram for the bot name would be a network call, which fails this test.
    const body = (await (await inbox()).json()) as { enabled: boolean; channels: { telegram: string | null } };
    assert.equal(body.enabled, true);
    assert.equal(body.channels.telegram, null);
  });
  assert.deepEqual(previewCommands, [['SMEMBERS', 'slotbee:preview:live:index'], ['MGET', 'slotbee:preview:live:chat:4179']]);

  await deployedWith({ LIVE_ACCESS_KEY: 'right-key' }, async () => {
    assert.deepEqual(await (await space('right-key')).json(),
      { dataSpace: 'live', usesLiveChats: true, vercelEnvironment: null, branch: null });
  });
});
