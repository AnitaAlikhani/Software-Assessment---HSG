/**
 * Who may call which live route (contract points 1 to 3 of delivery 3A): the owner's key in the
 * header x-live-key opens the owner's routes only, the customer's chat token in x-chat-token
 * opens /api/chat only, and no route reads a key or token from the address.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { GET as aiCheck } from '../api/ai-check';
import { POST as assistantRoute } from '../api/assistant';
import { DELETE as deleteChat, GET as readChat, POST as writeChat } from '../api/chat';
import { GET as spaceRoute } from '../api/space';
import { GET as telegramSetup } from '../api/telegram/setup';
import { POST as act } from '../api/whatsapp/action';
import { GET as ownerInbox } from '../api/whatsapp/conversations';
import { customerChatToken, hasChatAccess, hasLiveAccess } from '../server/access';
import { deployedWith, FakeStore } from './fakeStore';
import { CHAT_TOKEN, chatRequest, freezeClock, NOW, outsideWorld, quietly, SESSION, SETTINGS } from './liveChatHarness';

const withKey = (key: string | undefined, work: () => unknown) => {
  const before = process.env.LIVE_ACCESS_KEY;
  if (key === undefined) delete process.env.LIVE_ACCESS_KEY; else process.env.LIVE_ACCESS_KEY = key;
  try { return work(); } finally { if (before === undefined) delete process.env.LIVE_ACCESS_KEY; else process.env.LIVE_ACCESS_KEY = before; }
};
const headers = (values: Record<string, string>) => new Request('https://site.invalid/api/x', { headers: values });

test('the chat token follows the recipe: a fixed key gives a fixed token of 24 characters, another key another token', () => {
  // Known values, worked out once with the contract's recipe. A change here breaks every link customers hold.
  assert.equal(withKey('localdemo', customerChatToken), 'j95SQDHTLs33Cp1qDsJK4EHW');
  assert.equal(withKey('right-key', customerChatToken), 'M-5Jz6qu_YMxmRxfvvwCljsJ');
  assert.equal(withKey('right-key', customerChatToken), CHAT_TOKEN);
  assert.equal(withKey('other-key', customerChatToken), 'kZ0R1lOGrk-49FBIZbQJ1sWs');
  for (const key of ['localdemo', 'right-key', 'a much longer key with spaces and ümlauts']) {
    const token = withKey(key, customerChatToken) as string;
    assert.equal(token.length, 24);
    assert.match(token, /^[A-Za-z0-9_-]{24}$/);
    assert.ok(!token.includes(key) && !key.includes(token));
  }
  // Without a key there are no live chats, and so no token.
  assert.equal(withKey(undefined, customerChatToken), null);
  assert.equal(withKey('', customerChatToken), null);
});

test('the key and the token each open only their own door, from the header only', () => {
  withKey('right-key', () => {
    assert.equal(hasLiveAccess(headers({ 'x-live-key': 'right-key' })), true);
    assert.equal(hasChatAccess(headers({ 'x-chat-token': CHAT_TOKEN })), true);
    // Crossed over, wrong, almost right, empty, or in the address: refused.
    assert.equal(hasLiveAccess(headers({ 'x-live-key': CHAT_TOKEN })), false);
    assert.equal(hasLiveAccess(headers({ 'x-chat-token': 'right-key' })), false);
    assert.equal(hasChatAccess(headers({ 'x-chat-token': 'right-key' })), false);
    assert.equal(hasChatAccess(headers({ 'x-live-key': 'right-key' })), false);
    assert.equal(hasChatAccess(headers({ 'x-live-key': CHAT_TOKEN })), false);
    assert.equal(hasLiveAccess(headers({ 'x-live-key': 'right-ke' })), false);
    assert.equal(hasLiveAccess(headers({ 'x-live-key': 'right-key2' })), false);
    assert.equal(hasChatAccess(headers({ 'x-chat-token': CHAT_TOKEN.slice(0, 23) })), false);
    assert.equal(hasLiveAccess(headers({ 'x-live-key': '' })), false);
    assert.equal(hasLiveAccess(new Request('https://site.invalid/api/x?key=right-key&live=right-key')), false);
    assert.equal(hasChatAccess(new Request(`https://site.invalid/api/chat?chat=${CHAT_TOKEN}&token=${CHAT_TOKEN}`)), false);
  });
  // Without a key set, nothing opens anything: not an empty header, not the empty token.
  withKey(undefined, () => {
    assert.equal(hasLiveAccess(headers({ 'x-live-key': '' })), false);
    assert.equal(hasChatAccess(headers({ 'x-chat-token': '' })), false);
    assert.equal(hasChatAccess(headers({ 'x-chat-token': 'null' })), false);
  });
});

/** Every owner route, called as the owner's app would call it, with the given headers and address. */
const ownerRoutes: { name: string; call: (headers: Record<string, string>, query?: string) => Promise<Response> }[] = [
  { name: 'GET /api/whatsapp/conversations', call: (h, q = '') => ownerInbox(new Request(`https://site.invalid/api/whatsapp/conversations${q}`, { headers: h })) },
  { name: 'POST /api/whatsapp/action', call: (h, q = '') => act(new Request(`https://site.invalid/api/whatsapp/action${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ type: 'mark-done', conversationId: 'live-nobody' }) })) },
  { name: 'POST /api/assistant', call: (h, q = '') => assistantRoute(new Request(`https://site.invalid/api/assistant${q}`, { method: 'POST', headers: h, body: '{}' })) },
  { name: 'GET /api/ai-check', call: (h, q = '') => aiCheck(new Request(`https://site.invalid/api/ai-check${q}`, { headers: h })) },
  { name: 'GET /api/space', call: (h, q = '') => spaceRoute(new Request(`https://site.invalid/api/space${q}`, { headers: h })) },
  { name: 'GET /api/telegram/setup', call: (h, q = '') => telegramSetup(new Request(`https://site.invalid/api/telegram/setup${q}`, { headers: h })) },
];

test('the owner\'s routes take the owner\'s key from the header, and refuse the token and any key in the address', async () => {
  const settings = { ...SETTINGS, TELEGRAM_BOT_TOKEN: '' };
  const world = outsideWorld();
  await quietly(() => deployedWith(settings, async () => {
    for (const route of ownerRoutes) {
      const refusals = [
        await route.call({}),
        await route.call({ 'x-live-key': 'wrong-key' }),
        await route.call({ 'x-live-key': CHAT_TOKEN }),
        await route.call({ 'x-chat-token': CHAT_TOKEN }),
        await route.call({ 'x-chat-token': 'right-key' }),
        await route.call({}, '?key=right-key'),
        await route.call({}, '?live=right-key'),
        await route.call({ 'x-live-key': 'wrong-key' }, '?key=right-key&live=right-key'),
      ];
      for (const response of refusals) {
        assert.equal(response.status, 401, route.name);
        const text = await response.text();
        assert.ok(!text.includes('right-key') && !text.includes(CHAT_TOKEN), `${route.name}: ${text}`);
      }
      // The right key gets past the door (what the route then answers is its own business).
      const accepted = await route.call({ 'x-live-key': 'right-key' });
      assert.notEqual(accepted.status, 401, route.name);
      assert.notEqual(accepted.status, 429, route.name);
    }
  }, { store: new FakeStore(NOW), outside: () => { throw new Error('offline'); } }));
  assert.deepEqual(world.prompts, []);
});

test('the owner\'s app learns the token for the customers\' links, and only with the owner\'s key', async () => {
  await deployedWith(SETTINGS, async () => {
    const owner = await ownerInbox(new Request('https://site.invalid/api/whatsapp/conversations', { headers: { 'x-live-key': 'right-key' } }));
    assert.equal(owner.status, 200);
    const body = (await owner.json()) as { enabled: boolean; conversations: unknown[]; channels: { telegram: unknown; chatToken: string } };
    assert.equal(body.enabled, true);
    assert.deepEqual(body.channels, { telegram: null, chatToken: CHAT_TOKEN });
    const customer = await ownerInbox(new Request('https://site.invalid/api/whatsapp/conversations', { headers: { 'x-chat-token': CHAT_TOKEN } }));
    assert.equal(customer.status, 401);
    assert.deepEqual(await customer.json(), { enabled: false, conversations: [] });
  }, { store: new FakeStore(NOW) });
});

test('the website chat takes the chat token on every method, and refuses the owner\'s key and anything in the address', async (t) => {
  freezeClock(t);
  const world = outsideWorld();
  const invalid = { error: 'This chat link is no longer valid. Please ask the salon for a new one.' };
  await quietly(() => deployedWith(SETTINGS, async () => {
    const run = (request: Request) => request.method === 'GET' ? readChat(request) : request.method === 'POST' ? writeChat(request) : deleteChat(request);
    const body = { session: SESSION, name: 'Eva', text: 'Hello' };
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const session = method === 'POST' ? undefined : SESSION;
      const send = method === 'POST' ? body : undefined;
      for (const access of [{}, { 'x-live-key': 'right-key' }, { 'x-chat-token': 'right-key' }, { 'x-live-key': CHAT_TOKEN }, { 'x-chat-token': 'kZ0R1lOGrk-49FBIZbQJ1sWs' }] as Record<string, string>[]) {
        const response = await run(chatRequest(method, { session, body: send, access }));
        assert.equal(response.status, 401, `${method} ${JSON.stringify(access)}`);
        assert.deepEqual(await response.json(), invalid);
      }
      const inAddress = await run(new Request(`https://site.invalid/api/chat?session=${SESSION}&live=right-key&key=right-key&chat=${CHAT_TOKEN}&token=${CHAT_TOKEN}`, { method }));
      assert.equal(inAddress.status, 401, method);
    }
    // The token opens all three.
    assert.equal((await writeChat(chatRequest('POST', { body }))).status, 200);
    assert.equal((await readChat(chatRequest('GET', { session: SESSION }))).status, 200);
    assert.equal((await deleteChat(chatRequest('DELETE', { session: SESSION }))).status, 200);
  }, { store: new FakeStore(NOW), outside: world.outside }));
  // Only the one accepted message reached the AI.
  assert.equal(world.prompts.length, 1);
});
