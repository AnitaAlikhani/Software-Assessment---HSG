import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialAiSettings, initialConversations } from '../src/conversationData';
import { conversationForSelection, messageForOwner } from '../src/conversationPresentation';
import { ConversationsView } from '../src/views/ConversationsView';

const germanSettings = { ...initialAiSettings, ownerLanguage: 'German', translateChats: true };

test('every scripted message, follow-up and suggested reply has a German display', () => {
  for (const conversation of initialConversations) {
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
  const message = initialConversations[0].messages[0];
  assert.equal(messageForOwner(message, 'FR', { ...germanSettings, translateChats: false }).text, message.original);
  assert.equal(messageForOwner(message, 'FR', initialAiSettings).text, message.translation);
});

test('invalid conversation IDs never fall back to another customer', () => {
  assert.equal(conversationForSelection(initialConversations, 'missing'), null);
  assert.equal(conversationForSelection(initialConversations, null)?.id, initialConversations[0].id);
  assert.equal(conversationForSelection([], null), null);
});

const props: React.ComponentProps<typeof ConversationsView> = {
  conversations: initialConversations,
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

test('Instagram conversations expose an Instagram demo preview', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationsView, props));
  assert.match(html, /Preview Instagram/);
  assert.match(html, /Instagram preview for Chloé Favre/);
  assert.doesNotMatch(html, /Open in WhatsApp/);
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
  const storageKey = 'booking-demo-v1:/audit/:conversationDrafts';
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
