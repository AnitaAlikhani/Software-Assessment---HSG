import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialAiSettings } from '../src/conversationData';
import { appointmentForConversation } from '../src/appointmentActions';
import { demoStorageKey } from '../src/useDemoState';
import { demoConversations, demoEvents } from './fixedClock';
import { conversationForSelection, conversationsInFilter, messageForOwner } from '../src/conversationPresentation';
import { conversationsWaiting } from '../src/analytics';
import type { Conversation } from '../src/types';
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

/** A text as a pattern that matches exactly this text. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('a chat shows its own channel, and every message as the customer wrote it above its translation', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationsView, props));
  // The channel comes from the chat itself, whichever one the sample data gives it.
  const chloe = demoConversations.find(conversation => conversation.id === 'conv-chloe')!;
  assert.match(html, new RegExp(`via ${channelLabel(chloe.channel)}<`));
  // One bubble holds the customer's own words and, under a line, what the owner reads. That is
  // why there is no second view of the chat "as the customer sees it".
  const [message] = chloe.messages;
  assert.notEqual(message.original, message.translation);
  assert.match(html, new RegExp(`<p[^>]*>${literal(message.original)}</p><div[^>]*></div><p[^>]*>${literal(message.translation)}</p>`));
  assert.doesNotMatch(html, /Customer view|sees this chat|Open in WhatsApp/);
  // With no AI reply to approve, the page holds no dialog at all.
  assert.doesNotMatch(html, /<dialog/);
});

test('the list is filtered by All, Needs you and Booked', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationsView, { ...props, mobileDetailOpen: false }));
  // Three filters, named like the status tags in the list; the first is the one in use.
  assert.match(html, /role="group" aria-label="Filter conversations"/);
  const filters = Array.from(html.matchAll(/<button aria-pressed="(true|false)"[^>]*>([^<]+)/g), match => [match[2], match[1]]);
  assert.deepEqual(filters, [['All', 'true'], ['Needs you', 'false'], ['Booked', 'false']]);
  // "Needs you" carries the number of chats that wait, the one the header and Home show.
  const waiting = conversationsWaiting(demoConversations);
  assert.ok(waiting.length > 0);
  assert.match(html, new RegExp(`>Needs you<span[^>]*>${waiting.length}</span></button>`));

  // What each filter keeps. A live chat whose booking the owner confirmed has the status "booked" too.
  const confirmed: Conversation = {
    ...demoConversations[0], id: 'live-web-1', live: true, status: 'booked',
    bookingRequest: { service: 'Haircut', date: '2026-10-08', time: '15:00', customerName: 'Tom', status: 'confirmed' },
  };
  const all = [confirmed, ...demoConversations];
  assert.equal(conversationsInFilter(all, 'all'), all);
  assert.deepEqual(conversationsInFilter(all, 'needs'), waiting);
  // "Booked" keeps every chat with an appointment: the confirmed live chat, and the sample chats whose
  // appointment is in the calendar (Giulia asks to move hers; Léa's and John's were booked by the AI).
  assert.deepEqual(conversationsInFilter(all, 'booked').map(conversation => conversation.id), ['live-web-1', 'conv-giulia', 'conv-marie', 'conv-lea', 'conv-john']);
  for (const conversation of conversationsInFilter(all, 'booked')) assert.ok(conversation.status === 'booked' || conversation.appointmentId, conversation.id);
  // A chat without an appointment is not listed, whatever its status.
  assert.deepEqual(conversationsInFilter(demoConversations.filter(conversation => !conversation.appointmentId), 'booked'), []);
  assert.deepEqual(conversationsInFilter([], 'booked'), []);
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

test('the header of a chat holds two controls at most, laid out to share one row on a phone', () => {
  const header = (selectedId: string) => {
    const html = renderToStaticMarkup(React.createElement(ConversationsView, {
      ...props, selectedId, onOpenAppointment: () => {}, appointmentFor: conversation => appointmentForConversation(conversation, demoEvents),
    }));
    // The row of controls: what follows the customer's name and number, up to the end of the header.
    const row = /<div class="(flex flex-wrap items-center gap-2[^"]*)">(<button.*?<\/button>)<\/div><\/div>/.exec(html);
    assert.ok(row, 'the chat header has its row of controls');
    return { classes: row[1], buttons: Array.from(row[2].matchAll(/<button[^>]*class="([^"]*)"[^>]*>(?:<svg.*?<\/svg>)?([^<]*)<\/button>/g), match => ({ classes: match[1], label: match[2] })) };
  };
  // A chat with an appointment: how the AI works in it, and the way to the appointment. Nothing else.
  const booked = header('conv-marie');
  assert.deepEqual(booked.buttons.map(button => button.label), ['AI replies automatically', 'View appointment']);
  // From 360 px on the two never wrap: the note about the AI may narrow (and take two lines),
  // "View appointment" keeps its width and stays on one line. Measured in a browser at 375 px.
  assert.match(booked.classes, /min-\[360px\]:flex-nowrap/);
  assert.match(booked.buttons[0].classes, /\bmin-w-0\b/);
  assert.match(booked.buttons[1].classes, /\bshrink-0\b.*\bwhitespace-nowrap\b/);
  for (const button of booked.buttons) assert.match(button.classes, /\bmin-h-11\b/);
  // A chat without one: the note alone.
  assert.deepEqual(header('conv-chloe').buttons.map(button => button.label), ['AI replies automatically']);
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
