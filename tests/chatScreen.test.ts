import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { initialAiSettings } from '../src/conversationData';
import {
  connectionAfter,
  keepsFailure,
  liveActionFor,
  nextPollDelay,
  pollOutcome,
  POLL_TIMING,
  type LiveActionState,
  type LiveInbox,
} from '../src/liveWhatsApp';
import type { Conversation } from '../src/types';
import {
  aiStatusLabel,
  chatBackTarget,
  customerWaits,
  messagesWaitingForOwner,
  openChatState,
} from '../src/views/chatScreen';
import { ConversationsView } from '../src/views/ConversationsView';
import { demoConversations, FIXED_NOW } from './fixedClock';
import { readableText, render, TELL_WORDS } from './renderHelpers';

const MINUTE = 60_000;

test('the live chats are asked for less often when nothing happens, never in a hidden tab, and with a growing wait after failures', () => {
  // Busy: every few seconds.
  assert.equal(nextPollDelay({ hidden: false, failures: 0, quietForMs: 0 }), POLL_TIMING.active);
  assert.equal(nextPollDelay({ hidden: false, failures: 0, quietForMs: MINUTE - 1 }), POLL_TIMING.active);
  // Quiet for a minute, then for five: slower and slower.
  assert.equal(nextPollDelay({ hidden: false, failures: 0, quietForMs: MINUTE }), POLL_TIMING.quiet);
  assert.equal(nextPollDelay({ hidden: false, failures: 0, quietForMs: 5 * MINUTE }), POLL_TIMING.resting);
  assert.equal(nextPollDelay({ hidden: false, failures: 0, quietForMs: 60 * MINUTE }), POLL_TIMING.resting);
  assert.ok(POLL_TIMING.active < POLL_TIMING.quiet && POLL_TIMING.quiet < POLL_TIMING.resting);
  // A hidden tab asks nothing at all, whatever else is true.
  assert.equal(nextPollDelay({ hidden: true, failures: 0, quietForMs: 0 }), null);
  assert.equal(nextPollDelay({ hidden: true, failures: 3, quietForMs: 0 }), null);
  // After failures the wait doubles, up to a ceiling; it does not depend on how quiet the chats were.
  const waits = [1, 2, 3, 4, 5, 6, 7, 8].map(failures => nextPollDelay({ hidden: false, failures, quietForMs: 60 * MINUTE }));
  assert.deepEqual(waits, [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
});

test('only a refused key means no access; other failures are retried and keep the chats', () => {
  assert.equal(pollOutcome(200, true), 'enabled');
  assert.equal(pollOutcome(200, false), 'disabled');
  assert.equal(pollOutcome(401), 'refused');
  assert.equal(pollOutcome(403), 'refused');
  assert.equal(pollOutcome(404), 'missing');
  for (const status of [500, 502, 503, 408, 400]) assert.equal(pollOutcome(status), 'failed', String(status));
  // 429: the server is there and makes this connection wait; that is not a failure to reach it.
  assert.equal(pollOutcome(429), 'waiting');
  assert.equal(connectionAfter('waiting', true), 'waiting');
  assert.equal(pollOutcome(null), 'failed');

  assert.equal(connectionAfter('enabled', false), 'live');
  assert.equal(connectionAfter('refused', true), 'denied');
  assert.equal(connectionAfter('failed', true), 'reconnecting');
  assert.equal(connectionAfter('failed', false), 'reconnecting');
  // A copy of the site without a server: no live chats, and no alarm. Once reached, a 404 is a hiccup.
  assert.equal(connectionAfter('missing', false), 'off');
  assert.equal(connectionAfter('missing', true), 'reconnecting');
  assert.equal(connectionAfter('disabled', true), 'off');
});

const message = (id: string, sender: 'customer' | 'ai' | 'owner') => ({ id, sender, original: id, translation: id, time: '12:00' });
const liveChat = (extra: Partial<Conversation> = {}): Conversation => ({
  ...demoConversations[0], id: 'live-web-abc', live: true, channel: 'Website', languageLabel: 'English',
  status: 'owner-handled', takenOver: true, bookingRequest: undefined, quickReplies: undefined, aiFollowUp: undefined,
  messages: [message('c1', 'customer'), message('a1', 'ai'), message('o1', 'owner'), message('c2', 'customer'), message('c3', 'customer')],
  ...extra,
});

test('a taken-over chat counts the customer messages since the salon last replied', () => {
  assert.equal(messagesWaitingForOwner(liveChat()), 2);
  assert.equal(customerWaits(liveChat()), true);
  // Answered: nothing waits.
  const answered = liveChat({ messages: [...liveChat().messages, message('o2', 'owner')] });
  assert.equal(messagesWaitingForOwner(answered), 0);
  assert.equal(customerWaits(answered), false);
  // The AI still answers a chat that is not taken over: no count there.
  assert.equal(messagesWaitingForOwner(liveChat({ takenOver: false })), 0);
});

test('the back button of a chat goes one step back after the list, and to the list from anywhere else', () => {
  assert.equal(chatBackTarget(true), 'history');
  assert.equal(chatBackTarget(false), 'list');
});

test('the address of a live chat waits for the server instead of saying the chat is gone', () => {
  assert.equal(openChatState('live-web-abc', true, 'loading'), 'open');
  assert.equal(openChatState('live-web-abc', false, 'loading'), 'loading');
  assert.equal(openChatState('live-web-abc', false, 'reconnecting'), 'loading');
  assert.equal(openChatState('live-web-abc', false, 'denied'), 'no-access');
  assert.equal(openChatState('live-web-abc', false, 'live'), 'gone');
  // The salon's own chats live in the browser: a missing one is gone at once.
  assert.equal(openChatState('conv-missing', false, 'loading'), 'gone');
  assert.equal(openChatState(null, false), 'none');
});

test('the bar says what the AI does in the chat', () => {
  assert.equal(aiStatusLabel(liveChat(), initialAiSettings), 'AI paused in this chat');
  assert.equal(aiStatusLabel(liveChat({ takenOver: false, status: 'needs-attention' }), initialAiSettings), 'AI waits for you');
  assert.equal(aiStatusLabel(liveChat({ takenOver: false, status: 'ai-handled' }), initialAiSettings), 'AI replies automatically');
});

const inbox = (connection: LiveInbox['connection'], actions: LiveActionState[] = []): LiveInbox => ({ connection, actions, retry: () => {}, dismiss: () => {} });
const view = (props: Partial<React.ComponentProps<typeof ConversationsView>>) => render(React.createElement(ConversationsView, {
  conversations: demoConversations, selectedId: null, mobileDetailOpen: false,
  onBackToList: () => {}, onSelect: () => {}, onTakeOver: () => {}, onLetAiContinue: () => null, onOwnerReply: () => true,
  aiSettings: initialAiSettings, onOpenAiSettings: () => {}, now: FIXED_NOW, timeZone: 'Europe/Zurich', ...props,
}));

test('the list says when live chats are loading, reconnecting or not allowed, and keeps its chats meanwhile', () => {
  const loading = view({ liveInbox: inbox('loading') });
  assert.match(loading, /role="status"[^>]*>.*Loading live chats…/);
  const reconnecting = view({ conversations: [liveChat(), ...demoConversations], liveInbox: inbox('reconnecting') });
  assert.match(reconnecting, />Reconnecting…</);
  // The chats stay on screen while the app tries again.
  assert.ok(demoConversations.every(chat => reconnecting.includes(chat.customerName)));
  const denied = view({ liveInbox: inbox('denied') });
  assert.match(denied, /role="alert"[^>]*>.*No access to live chats.*wrong or has expired/);
  // Connected, or without live chats: no notice at all.
  for (const quiet of [view({ liveInbox: inbox('live') }), view({})]) assert.doesNotMatch(quiet, /Reconnecting|Loading live chats|No access/);
  for (const html of [loading, reconnecting, denied]) assert.doesNotMatch(readableText(html), TELL_WORDS);
});

test('a live chat that is still loading shows a loading state, not "no longer available"', () => {
  const loading = view({ selectedId: 'live-web-abc', mobileDetailOpen: true, liveInbox: inbox('loading') });
  assert.match(loading, /Loading this chat…/);
  assert.doesNotMatch(loading, /no longer available/);
  // The way back is there while it loads.
  assert.match(loading, /aria-label="All conversations"/);
  const denied = view({ selectedId: 'live-web-abc', mobileDetailOpen: true, liveInbox: inbox('denied') });
  assert.match(denied, /No access to live chats/);
  assert.match(denied, />View all conversations</);
  assert.match(view({ selectedId: 'live-web-abc', mobileDetailOpen: true, liveInbox: inbox('live') }), /This conversation is no longer available/);
});

test('the list shows how many messages wait in a chat the owner has taken over', () => {
  const html = view({ conversations: [liveChat(), ...demoConversations] });
  assert.match(html, />2<span class="sr-only"> messages wait for your reply<\/span>/);
  const one = view({ conversations: [liveChat({ messages: [message('o1', 'owner'), message('c1', 'customer')] })] });
  assert.match(one, />1<span class="sr-only"> message waits for your reply<\/span>/);
  assert.doesNotMatch(view({ conversations: demoConversations }), /wait(s)? for your reply/);
});

test("the owner's answers to a live chat show Sending…, lock their button, and offer Try again when they fail", () => {
  const waiting = liveChat({ takenOver: false, status: 'needs-attention', attentionReason: 'The customer asked for a discount.' });
  const sending = view({
    conversations: [waiting], selectedId: waiting.id, mobileDetailOpen: true,
    liveInbox: inbox('live', [{ key: `${waiting.id}:take-over`, conversationId: waiting.id, type: 'take-over', state: 'sending' }]),
  });
  // The button says it is on its way and cannot be pressed again; the other answer waits too.
  assert.match(sending, /<button disabled="" aria-busy="true"[^>]*>.*?Sending…<\/span><\/button>/);
  assert.doesNotMatch(sending, />Take over</);
  // The two ways on stand where the reply box will be; the box itself comes with the take-over.
  // The buttons come first, the hint after them (a message at the bottom right lies over the hint, not a button).
  assert.match(sending, /<div role="group" aria-label="Who answers this chat"[^>]*><button[^>]*>.*Sending….*<button disabled=""[^>]*>Let AI continue<\/button><p[^>]*>Take over to write to [^<]* yourself\.<\/p><\/div>/);
  assert.doesNotMatch(sending, /aria-label="Reply as owner"/);

  const failed = view({
    conversations: [waiting], selectedId: waiting.id, mobileDetailOpen: true,
    liveInbox: inbox('live', [{ key: `${waiting.id}:take-over`, conversationId: waiting.id, type: 'take-over', state: 'failed', error: 'Could not reach the server. Check your connection.' }]),
  });
  assert.match(failed, /role="alert"[^>]*>.*Failed\..*Taking over did not go through: Could not reach the server/);
  assert.match(failed, />Try again<\/button>/);
  assert.match(failed, />Take over</);

  // A reply on its way stands in the chat with "Sending…"; a failed one keeps its text with "Not sent".
  const chat = liveChat();
  const replies = view({
    conversations: [chat], selectedId: chat.id, mobileDetailOpen: true,
    liveInbox: inbox('live', [
      { key: `${chat.id}:reply:1`, conversationId: chat.id, type: 'reply', text: 'See you on Tuesday', state: 'sending' },
      { key: `${chat.id}:reply:2`, conversationId: chat.id, type: 'reply', text: 'Are you still there?', state: 'failed', error: 'The server could not do this. Try again.' },
    ]),
  });
  assert.match(replies, />See you on Tuesday<\/p><p[^>]*><span[^>]*>.*?Sending…<\/span>/);
  assert.match(replies, />Are you still there\?<\/p><p[^>]*>Not sent<\/p>/);
  assert.match(replies, /Your reply did not go through/);
});

test('the answer that is on its way is found by chat and kind; replies are not buttons', () => {
  const actions: LiveActionState[] = [
    { key: 'a:take-over', conversationId: 'a', type: 'take-over', state: 'sending' },
    { key: 'a:reply:1', conversationId: 'a', type: 'reply', text: 'Hi', state: 'sending' },
  ];
  assert.equal(liveActionFor(actions, 'a', 'take-over')?.key, 'a:take-over');
  assert.equal(liveActionFor(actions, 'b', 'take-over'), undefined);
  assert.equal(liveActionFor(actions, 'a', 'reply'), undefined);
});

test('a failed answer to a booking is left to its card: no bare retry that would tell the customer and book nothing', () => {
  for (const type of ['confirm-booking', 'suggest-time', 'decline-booking', 'cancel-booking', 'keep-booking'] as const) assert.equal(keepsFailure(type), false, type);
  for (const type of ['reply', 'take-over', 'let-ai-continue', 'mark-done'] as const) assert.equal(keepsFailure(type), true, type);
});
