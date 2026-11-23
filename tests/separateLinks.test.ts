import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CustomerChat, { askAboutEarlierChats, chatAnswer, chatHeaders, chatTokenFromAddress, LINK_NOT_VALID, refusalSentence, TOO_MANY_MESSAGES } from '../src/CustomerChat';
import { deviceState, ThisDeviceCard } from '../src/components/ThisDeviceCard';
import { openChatState } from '../src/views/chatScreen';
import { initialAiSettings } from '../src/conversationData';
import { initialBookingHours, initialCompanySettings } from '../src/mockData';
import {
  actionError, addressWithoutKey, describeTeamCheck, forgetLiveKey, OWNER_WAIT_TEXT, POLL_TIMING, takeKeyFromAddress, readLiveKey, runTeamCheck, TEAM_CHECKS, useLiveWhatsApp, websiteChatUrl,
  type LiveInbox, type TeamCheck,
} from '../src/liveWhatsApp';
import { ConversationsView } from '../src/views/ConversationsView';
import { LiveTestStrip, NO_CHAT_LINK_YET, TeamChecks } from '../src/views/LiveTestStrip';
import { SettingsView } from '../src/views/SettingsView';
import type { Conversation } from '../src/types';
import { blockedStorage, StorageStandIn } from './browserStandIn';
import { readableText, render } from './renderHelpers';

// Delivery 3A "Separate links": the owner's key signs a browser in and then lives in its storage
// only; the customer's link carries a chat token; a device can be signed out.

const KEY = 'owner-secret-key-42';
const TOKEN = 'Abc-def_ghi0123456789xyz';
const nothing = () => {};

/** A browser tab with an address, a history that records replaceState, and a storage. */
function tabAt(href: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = new StorageStandIn(new Map())) {
  const url = new URL(href);
  const replaced: string[] = [];
  const window = {
    location: { href: url.href, search: url.search, pathname: url.pathname, origin: url.origin },
    history: { state: { kept: true }, replaceState: (_state: unknown, _title: string, address: string) => { replaced.push(address); } },
    addEventListener: nothing, removeEventListener: nothing,
  };
  return { window, storage, replaced };
}

function inTab<T>(tab: ReturnType<typeof tabAt>, run: () => T): T {
  const globals: Record<string, unknown> = { window: tab.window, localStorage: tab.storage };
  const previous = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value });
  try {
    return run();
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test('opening the owner link stores the key and takes "live" out of the address, keeping the rest', () => {
  const tab = tabAt(`https://slotbee.example/sub/?research=1&live=${KEY}&x=a%20b+c#/settings?tab=online-booking`);
  assert.equal(inTab(tab, () => readLiveKey()), KEY);
  assert.equal(tab.storage.getItem('slotbee-live-key'), KEY);
  // One replace, with every other parameter written as it was, and the app's route in the hash.
  assert.deepEqual(tab.replaced, ['/sub/?research=1&x=a%20b+c#/settings?tab=online-booking']);
  assert.doesNotMatch(tab.replaced[0], new RegExp(KEY));
  // Read again (the address is now clean in a real browser): the key comes from the storage.
  const later = tabAt('https://slotbee.example/sub/?research=1#/settings', tab.storage);
  assert.equal(inTab(later, () => readLiveKey()), KEY);
  assert.deepEqual(later.replaced, []);
});

test('an address without "live" is left exactly as it is', () => {
  const tab = tabAt('https://slotbee.example/?research=1&lively=1#/conversations');
  assert.equal(inTab(tab, () => readLiveKey()), null);
  assert.deepEqual(tab.replaced, []);
  assert.equal(addressWithoutKey('https://slotbee.example/?research=1&lively=1#/x'), null);
  // "live" alone, or encoded, is still the key's parameter; the address keeps nothing else of it.
  assert.equal(addressWithoutKey(`https://slotbee.example/?live=${KEY}`), '/');
  assert.equal(addressWithoutKey(`https://slotbee.example/?%6Cive=${KEY}#/home`), '/#/home');
});

test('a browser that keeps no storage still uses the key for this visit, and forgets it on sign out', () => {
  const tab = tabAt(`https://slotbee.example/?live=${KEY}`, blockedStorage);
  assert.equal(inTab(tab, () => readLiveKey()), KEY);
  assert.deepEqual(tab.replaced, ['/']);
  const after = tabAt('https://slotbee.example/', blockedStorage);
  assert.equal(inTab(after, () => readLiveKey()), KEY);
  inTab(after, () => forgetLiveKey());
  assert.equal(inTab(after, () => readLiveKey()), null);
});

test('after "Sign out on this device" the app behaves as without a key', () => {
  const storage = new StorageStandIn(new Map([['slotbee-live-key', KEY]]));
  let live: ReturnType<typeof useLiveWhatsApp> | undefined;
  const Probe = () => { live = useLiveWhatsApp(); return null; };
  const tab = tabAt('https://slotbee.example/#/settings', storage);
  inTab(tab, () => renderToStaticMarkup(React.createElement(Probe)));
  assert.equal(live?.signedIn, true);
  assert.equal(live?.status, 'checking');
  inTab(tab, () => live!.signOut());
  assert.equal(storage.getItem('slotbee-live-key'), null);
  inTab(tab, () => renderToStaticMarkup(React.createElement(Probe)));
  assert.equal(live?.signedIn, false);
  assert.equal(live?.status, 'off');
  assert.equal(live?.connection, 'off');
  assert.equal(live?.channels, null);
  assert.deepEqual(live?.conversations, []);
});

test('the customer link is "/?chat=<token>" and never carries the owner key', () => {
  assert.equal(websiteChatUrl('https://slotbee.example', TOKEN, false), `https://slotbee.example/?chat=${TOKEN}`);
  assert.equal(websiteChatUrl('https://slotbee.example', TOKEN, true), `https://slotbee.example/?chat=${TOKEN}&research=1`);
  const address = new URL(websiteChatUrl('https://slotbee.example', TOKEN, true));
  assert.deepEqual([...address.searchParams.keys()], ['chat', 'research']);
});

test('the customer page takes its token from "chat"; the old form has none', () => {
  assert.equal(chatTokenFromAddress(`?chat=${TOKEN}`), TOKEN);
  assert.equal(chatTokenFromAddress(`?chat=${TOKEN}&research=1`), TOKEN);
  assert.equal(chatTokenFromAddress(`?chat=1&live=${KEY}`), null);
  assert.equal(chatTokenFromAddress('?chat='), null);
  assert.equal(chatTokenFromAddress('?booking=1'), null);
  // Every request carries the token in its own header, never an owner key.
  assert.deepEqual(chatHeaders(TOKEN), { 'x-chat-token': TOKEN });
  assert.deepEqual(chatHeaders(TOKEN, true), { 'Content-Type': 'application/json', 'x-chat-token': TOKEN });
  const source = readFileSync(new URL('../src/CustomerChat.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /x-live-key|get\('live'\)|readLiveKey/);
});

test('the customer page sorts the server\'s answers: refused link, too many, normal', async () => {
  assert.equal(chatAnswer(200), 'ok');
  assert.equal(chatAnswer(401), 'link-not-valid');
  assert.equal(chatAnswer(429), 'too-many');
  assert.equal(chatAnswer(500), 'failed');
  const answer = (status: number, body?: unknown) => new Response(body === undefined ? 'oops' : JSON.stringify(body), { status });
  assert.equal(await refusalSentence(answer(401, { error: LINK_NOT_VALID })), LINK_NOT_VALID);
  assert.equal(await refusalSentence(answer(401)), LINK_NOT_VALID);
  assert.equal(await refusalSentence(answer(429, { error: 'Please wait a minute before you write again.' })), 'Please wait a minute before you write again.');
  assert.equal(await refusalSentence(answer(429)), TOO_MANY_MESSAGES);
});

test('an old or refused link is a calm page of its own; a working one opens the chat', () => {
  const page = (token: string | null) => render(React.createElement(CustomerChat, { token }));
  const closed = page(null);
  assert.match(readableText(closed), /This chat link is no longer valid\. Please ask the salon for a new one\./);
  assert.match(closed, new RegExp(`<h1[^>]*>${initialCompanySettings.companyName}</h1>`));
  // Nothing invites typing, and it is not an error line.
  assert.doesNotMatch(closed, /<input|<textarea|<button|role="alert"|text-red/);
  const open = page(TOKEN);
  assert.match(open, /Start chat/);
  assert.match(open, /<input/);
  assert.doesNotMatch(open, /no longer valid/);
  assert.doesNotMatch(open, new RegExp(TOKEN));
});

test('"This device" says whether the browser is signed in, and offers to sign out', () => {
  const signedIn = render(React.createElement(ThisDeviceCard, { signedIn: true, connection: 'live', onSignOut: nothing }));
  assert.match(signedIn, /This device/);
  assert.match(readableText(signedIn), /Signed in to the live chats/);
  assert.match(signedIn, /<button[^>]*>.*Sign out on this device<\/button>/);
  const refused = readableText(render(React.createElement(ThisDeviceCard, { signedIn: true, connection: 'denied', onSignOut: nothing })));
  assert.match(refused, /no longer works/);
  const signedOut = render(React.createElement(ThisDeviceCard, { signedIn: false, connection: 'off', onSignOut: nothing }));
  assert.match(readableText(signedOut), /Not signed in to the live chats/);
  assert.match(readableText(signedOut), /open your owner link on this device/);
  assert.doesNotMatch(signedOut, /<button|live=|key=/);
});

test('Settings › Online booking holds "This device"', () => {
  const settings = (signedIn: boolean) => render(React.createElement(SettingsView, {
    settings: initialCompanySettings, bookingHours: initialBookingHours, onSaveSettings: nothing, closedDates: [], onSaveClosedDates: nothing,
    tab: 'online-booking', onTabChange: nothing, bookingLink: 'https://slotbee.example/?booking=1',
    thisDevice: { signedIn, connection: signedIn ? 'live' : 'off', onSignOut: nothing },
  }));
  assert.match(settings(true), /This device.*Sign out on this device/s);
  assert.doesNotMatch(settings(false), /Sign out on this device/);
  assert.match(readableText(settings(false)), /open your owner link/);
});

const liveChat: Conversation = {
  id: 'live-web-abc123def456', live: true, customerName: 'Tomás', initials: 'T', avatarColor: 'bg-green-100 text-green-700',
  language: 'EN', languageLabel: 'Spanish', phone: 'Website visitor', channel: 'Website', status: 'ai-handled', lastTime: '10:02',
  messages: [{ id: 'm1', sender: 'customer', original: 'Hola', translation: 'Hello', time: '10:02' }],
};
const denied: LiveInbox = { connection: 'denied', actions: [], retry: nothing, dismiss: nothing };

test('the "No access to live chats" notices offer "Sign out on this device"', () => {
  const chats = (selectedId: string | null, onSignOut?: () => void) => render(React.createElement(ConversationsView, {
    conversations: [], selectedId, mobileDetailOpen: false, onBackToList: nothing, onSelect: nothing, onTakeOver: nothing,
    onLetAiContinue: () => null, onOwnerReply: () => true, aiSettings: initialAiSettings, onOpenAiSettings: nothing,
    liveInbox: denied, onSignOut,
  }));
  const list = chats(null, nothing);
  assert.match(list, /No access to live chats/);
  assert.equal(list.match(/>Sign out on this device</g)?.length, 1);
  // The open live chat that cannot be shown says the same, with the same way out.
  const thread = chats(liveChat.id, nothing);
  assert.equal(thread.match(/>Sign out on this device</g)?.length, 2);
  assert.doesNotMatch(chats(null), /Sign out on this device/);
});

test('the study strip shows the customer link, three checks, and never the key', () => {
  const strip = (websiteChatUrl: string | null) => render(React.createElement(LiveTestStrip, {
    channels: { telegram: null, websiteChatUrl }, liveCount: 1, waitingCount: 0, onCheck: async () => ({ ok: true, lines: [] }),
  }), { research: true });
  const html = strip(`https://slotbee.example/?chat=${TOKEN}&research=1`);
  assert.match(html, new RegExp(`href="https://slotbee.example/\\?chat=${TOKEN}&amp;research=1"`));
  for (const label of ['Check the AI', 'Which chats this copy uses', 'Connect Telegram']) {
    assert.equal(html.match(new RegExp(`<button[^>]*>${label}</button>`, 'g'))?.length, 2, label);
  }
  assert.doesNotMatch(html, /[?&](live|key)=|owner-secret/);
  // Before the server sent a token there is no link to open or copy.
  const waiting = strip(null);
  assert.match(waiting, new RegExp(NO_CHAT_LINK_YET));
  assert.doesNotMatch(waiting, /chat=|Copy link|>Web chat</);
});

test('a check\'s answer is shown as readable text, and a failure says what failed', () => {
  const shown = (kind: TeamCheck, ok: boolean, lines: string[]) =>
    readableText(renderToStaticMarkup(React.createElement(TeamChecks, { onCheck: async () => ({ ok, lines }), initial: { kind, result: { ok, lines } } })));
  const ai = describeTeamCheck('ai', 200, { models: [{ model: 'gemini-2.5-flash', ok: true, ms: 812 }, { model: 'gemma-3', ok: false, ms: 20, error: 'quota' }] });
  assert.deepEqual(ai, { ok: true, lines: ['1 of 2 AI models answer.', 'gemini-2.5-flash: answers (812 ms)', 'gemma-3: no answer (quota)'] });
  assert.match(shown('ai', ai.ok, ai.lines), /Check the AI\s+1 of 2 AI models answer\./);
  assert.deepEqual(describeTeamCheck('space', 200, { dataSpace: 'live', usesLiveChats: true, vercelEnvironment: 'production', branch: 'main' }).lines,
    ['This copy uses the live chats.', 'Vercel environment: production · branch: main']);
  assert.match(describeTeamCheck('space', 200, { dataSpace: 'preview-x', usesLiveChats: false }).lines[0], /own test chats \("preview-x"\)/);
  assert.deepEqual(describeTeamCheck('telegram', 200, { ok: true, bot: '@bella_bot', webhook: 'https://slotbee.example/api/telegram/webhook' }).lines,
    ['Telegram is connected: @bella_bot.', 'Messages go to https://slotbee.example/api/telegram/webhook']);
  assert.deepEqual(describeTeamCheck('telegram', 409, { ok: false, error: 'Only on the live site.' }), { ok: false, lines: ['Connect Telegram failed: Only on the live site.'] });
  assert.match(describeTeamCheck('space', 401, { error: 'No access' }).lines[0], /^Which chats this copy uses failed: the server did not accept the key of this device/);
  assert.match(describeTeamCheck('ai', null, null).lines[0], /^Check the AI failed: could not reach the server/);
  assert.match(describeTeamCheck('ai', 429, { error: 'Too many wrong keys. Try again in 10 minutes.' }).lines[0], /Too many wrong keys/);
});

test('the checks send the key in the header, never in the address', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    return Response.json({ dataSpace: 'live', usesLiveChats: true });
  }) as typeof fetch;
  for (const kind of Object.keys(TEAM_CHECKS) as TeamCheck[]) await runTeamCheck(kind, KEY, fetcher);
  assert.deepEqual(calls.map(call => call.url), ['/api/ai-check', '/api/space', '/api/telegram/setup']);
  for (const call of calls) {
    assert.equal(call.headers['x-live-key'], KEY);
    assert.doesNotMatch(call.url, new RegExp(`${KEY}|key=|live=`));
  }
  const offline = await runTeamCheck('space', KEY, (async () => { throw new TypeError('offline'); }) as typeof fetch);
  assert.equal(offline.ok, false);
  assert.doesNotMatch(offline.lines.join(' '), new RegExp(KEY));
});

// Fix round after the review of the merged 3A state.

test('(1) a full chat (429 with "full") is closed with a way out; only a 429 without it means "wait"', () => {
  assert.equal(chatAnswer(429, { full: true }), 'full');
  assert.equal(chatAnswer(429, { error: 'You are sending messages very quickly.' }), 'too-many');
  assert.equal(chatAnswer(429), 'too-many');
  assert.equal(chatAnswer(400, { full: true }), 'full');
  // A refused link stays refused whatever else the answer says.
  assert.equal(chatAnswer(401, { full: true }), 'link-not-valid');
  // The page checks "full" before "too many" when it sends (src/CustomerChat.tsx, send).
  const source = readFileSync(new URL('../src/CustomerChat.tsx', import.meta.url), 'utf8');
  const send = source.slice(source.indexOf('const send = async'));
  assert.ok(send.indexOf('chatAnswer(response.status, data)') > 0, 'send reads the body before it sorts the answer');
  assert.ok(send.indexOf("setChatFull(Boolean(data.full))") > send.indexOf("answer === 'too-many'"), 'the full chat leads to "Start a new chat"');
});

test('(2) an owner who is made to wait reads the server\'s sentence, keeps her chats and is asked again after a minute', () => {
  const inbox = (connection: LiveInbox['connection'], waitNotice: string | null) =>
    ({ connection, waitNotice, actions: [], retry: nothing, dismiss: nothing }) as LiveInbox;
  const sentence = 'Too many wrong access keys were sent from this connection. Please wait 10 minutes and try again.';
  const list = render(React.createElement(ConversationsView, {
    conversations: [liveChat], selectedId: null, mobileDetailOpen: false, onBackToList: nothing, onSelect: nothing, onTakeOver: nothing,
    onLetAiContinue: () => null, onOwnerReply: () => true, aiSettings: initialAiSettings, onOpenAiSettings: nothing,
    liveInbox: inbox('waiting', sentence),
  }));
  const text = readableText(list);
  assert.match(text, /Live chats are paused/);
  assert.ok(text.includes(sentence));
  assert.doesNotMatch(text, /Reconnecting|cannot be reached/);
  assert.match(text, /Tomás/);
  // An open live chat that is not on screen yet does not pretend to load or to be gone.
  assert.equal(openChatState('live-web-x', false, 'waiting'), 'waiting');
  // "This device" says the same.
  assert.deepEqual(deviceState({ signedIn: true, connection: 'waiting', waitNotice: sentence }).text, sentence);
  assert.equal(deviceState({ signedIn: true, connection: 'waiting' }).text, OWNER_WAIT_TEXT);
  // Asked again after a minute, not every few seconds.
  assert.ok(POLL_TIMING.waiting >= 60_000);
  // An action that gets a 429 says the server's sentence.
  assert.equal(actionError(429, { error: sentence }), sentence);
  assert.equal(actionError(429, null), OWNER_WAIT_TEXT);
  assert.equal(actionError(200, {}), null);
});

test('(3) a customer\'s page removes "live" from its address and keeps nothing; the owner\'s app keeps it', () => {
  const booking = tabAt(`https://slotbee.example/?booking=1&live=${KEY}#/x`);
  inTab(booking, () => takeKeyFromAddress());
  assert.deepEqual(booking.replaced, ['/?booking=1#/x']);
  assert.equal(booking.storage.getItem('slotbee-live-key'), null);
  const chat = tabAt(`https://slotbee.example/?chat=1&live=${KEY}`);
  inTab(chat, () => takeKeyFromAddress());
  assert.deepEqual(chat.replaced, ['/?chat=1']);
  assert.equal(chat.storage.getItem('slotbee-live-key'), null);
  const owner = tabAt(`https://slotbee.example/?live=${KEY}&research=1#/home`);
  inTab(owner, () => takeKeyFromAddress());
  assert.deepEqual(owner.replaced, ['/?research=1#/home']);
  assert.equal(owner.storage.getItem('slotbee-live-key'), KEY);
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /takeKeyFromAddress\(\);/);
});

test('(4) no request of the app carries the page\'s address as its Referer', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const policy = html.indexOf('<meta name="referrer" content="origin" />');
  assert.ok(policy > 0, 'index.html sets the referrer policy');
  // It stands before anything the page loads.
  for (const tag of ['<link rel="icon"', '<link rel="preload"', '<script']) assert.ok(policy < html.indexOf(tag), tag);
});

test('(5) the first refused link ends the questions about earlier chats', async () => {
  const asked: string[] = [];
  const refusedAnswer = await askAboutEarlierChats(['a', 'b', 'c'], async (id) => {
    asked.push(id);
    return Response.json({ error: LINK_NOT_VALID }, { status: 401 });
  });
  assert.deepEqual(asked, ['a']);
  assert.equal(refusedAnswer.refused?.status, 401);
  const kept = await askAboutEarlierChats(['a', 'b'], async (id) => Response.json({ messages: id === 'a' ? [{}] : [] }));
  assert.deepEqual(kept.answers, { a: 'kept', b: 'gone' });
  assert.equal(kept.refused, null);
  // The page asks about earlier chats only after the server has accepted the link once.
  const source = readFileSync(new URL('../src/CustomerChat.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!key \|\| !linkConfirmed \|\| refused\.current\) return;/);
});
