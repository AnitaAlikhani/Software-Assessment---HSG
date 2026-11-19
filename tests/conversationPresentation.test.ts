import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialAiSettings } from '../src/conversationData';
import { appointmentForConversation } from '../src/appointmentActions';
import { demoStorageKey } from '../src/useDemoState';
import { demoConversations, demoEvents } from './fixedClock';
import { conversationForSelection, messageForOwner } from '../src/conversationPresentation';
import { ConversationsView } from '../src/views/ConversationsView';
import { channelLabel } from '../src/components/ChannelBadge';

const germanSettings = { ...initialAiSettings, ownerLanguage: 'German', translateChats: true };

test('every scripted message, follow-up and suggested reply has a German display', () => {
  for (const conversation of demoConversations) {
    const scripted = [
      ...conversation.messages,
      ...(conversation.aiFollowUp ? [conversation.aiFollowUp] : []),
      ...(conversation.quickReplies ?? []).map(reply => ({ original: reply.local, translation: reply.en })),
    ];
    for (const message of scripted) {
      const display = messageForOwner(message, conversation.language, germanSettings);
      assert.equal(display.translationUnavailable, false, `${conversation.id}: ${message.translation}`);
      assert.notEqual(display.text, message.translation, `English displayed as German: ${message.translation}`);
    }
  }
});

test('unknown text stays original and is never presented as a German translation', () => {
  const message = { original: 'Un nouveau message sans traduction.', translation: 'A new message with no reviewed translation.' };
  assert.deepEqual(messageForOwner(message, 'FR', germanSettings), {
    text: message.original, showOriginal: false, translationUnavailable: true,
  });
});

test('typed replies are shown as written even when their text matches a scripted translation', () => {
  const message = { original: 'Yes, thank you.', translation: 'Yes, thank you.', untranslated: true };
  assert.deepEqual(messageForOwner(message, 'FR', germanSettings), {
    text: message.original, showOriginal: false, translationUnavailable: true,
  });
});

test('turning translation off shows the original while English preserves existing scripted translations', () => {
  const message = demoConversations[0].messages[0];
  assert.equal(messageForOwner(message, 'FR', { ...germanSettings, translateChats: false }).text, message.original);
  assert.equal(messageForOwner(message, 'FR', initialAiSettings).text, message.translation);
});

test('invalid conversation IDs never fall back to another customer', () => {
  assert.equal(conversationForSelection(demoConversations, 'missing'), null);
  assert.equal(conversationForSelection(demoConversations, null)?.id, demoConversations[0].id);
  assert.equal(conversationForSelection([], null), null);
});

const props: React.ComponentProps<typeof ConversationsView> = {
  conversations: demoConversations,
  selectedId: 'conv-chloe',
  mobileDetailOpen: true,
  onBackToList: () => {},
  onSelect: () => {},
  onTakeOver: () => {},
  onLetAiContinue: () => null,
  onOwnerReply: () => true,
  aiSettings: initialAiSettings,
  onOpenAiSettings: () => {},
};

test('a stale conversation link displays recovery and no reply or takeover action', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationsView, { ...props, selectedId: 'missing' }));
  assert.match(html, /This conversation is no longer available/);
  assert.match(html, /View all conversations/);
  assert.doesNotMatch(html, /aria-label="Send reply"/);
  assert.doesNotMatch(html, />Take over</);
});

test('a chat shows its own channel and offers the customer view', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationsView, props));
  // The channel comes from the chat itself, whichever one the sample data gives it.
  const chloe = demoConversations.find(conversation => conversation.id === 'conv-chloe')!;
  assert.match(html, new RegExp(`via ${channelLabel(chloe.channel)}<`));
  assert.match(html, />Customer view</);
  assert.match(html, /Customer view of the chat with Chloé Favre/);
  assert.match(html, /How Chloé sees this chat/);
  assert.doesNotMatch(html, /Open in WhatsApp/);
});

test('a chat whose booking is in the calendar offers the way to that appointment', () => {
  const view = (selectedId: string, extra: Partial<React.ComponentProps<typeof ConversationsView>> = {}) =>
    renderToStaticMarkup(React.createElement(ConversationsView, {
      ...props, selectedId, onOpenAppointment: () => {},
      appointmentFor: conversation => appointmentForConversation(conversation, demoEvents), ...extra,
    }));
  // Marie's haircut was booked in her chat, Giulia asks to move an appointment she has.
  assert.match(view('conv-marie'), />View appointment</);
  assert.match(view('conv-giulia'), />View appointment</);
  // Chloé only asked for a time: nothing is booked, so nothing is offered.
  assert.doesNotMatch(view('conv-chloe'), /View appointment/);
  // A cancelled appointment has left the calendar: no link that leads nowhere.
  const withoutMarie = demoEvents.filter(event => event.id !== 'cal-2');
  assert.doesNotMatch(view('conv-marie', { appointmentFor: conversation => appointmentForConversation(conversation, withoutMarie) }), /View appointment/);
  // Without a calendar to look in, or a way to open it, the link is left out.
  assert.doesNotMatch(view('conv-marie', { appointmentFor: undefined }), /View appointment/);
  assert.doesNotMatch(view('conv-marie', { onOpenAppointment: undefined }), /View appointment/);
});

test('approval setting replaces immediate AI sending with a review entry point', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationsView, {
    ...props, aiSettings: { ...initialAiSettings, askBeforeSending: true },
  }));
  assert.match(html, />Review AI reply</);
  assert.doesNotMatch(html, />Let AI continue</);
});

test('stored conversation drafts are restored when the conversation view mounts again', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const storageKey = demoStorageKey('conversationDrafts', '/audit/');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { pathname: '/audit/' } } });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: { getItem: (key: string) => key === storageKey ? JSON.stringify({ 'conv-chloe': 'Draft kept while reviewing settings' }) : null },
  });
  try {
    const html = renderToStaticMarkup(React.createElement(ConversationsView, props));
    assert.match(html, /value="Draft kept while reviewing settings"/);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
