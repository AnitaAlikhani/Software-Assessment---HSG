import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialAiSettings } from '../src/conversationData';
import { appointmentForConversation } from '../src/appointmentActions';
import type { AvailabilityContext } from '../src/availability';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { demoStorageKey } from '../src/useDemoState';
import { demoConversations, demoEvents, demoShifts, FIXED_NOW } from './fixedClock';
import { chatBookingOrigin, chatBookingOriginLabel, conversationForSelection, conversationsInFilter, messageForOwner, ownerReadsChatLanguage, showsTranslation } from '../src/conversationPresentation';
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

test('the list is filtered by All, Waiting for you and Booked', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationsView, { ...props, mobileDetailOpen: false }));
  // Three filters, named like the status tags in the list; the first is the one in use.
  assert.match(html, /role="group" aria-label="Filter conversations"/);
  const filters = Array.from(html.matchAll(/<button aria-pressed="(true|false)"[^>]*>([^<]+)/g), match => [match[2], match[1]]);
  assert.deepEqual(filters, [['All', 'true'], ['Waiting for you', 'false'], ['Booked', 'false']]);
  // "Waiting for you" is the name of Home's inbox: one word for one state. It carries the number of chats that wait.
  const waiting = conversationsWaiting(demoConversations);
  assert.ok(waiting.length > 0);
  assert.match(html, new RegExp(`>Waiting for you<span[^>]*>${waiting.length}</span></button>`));
  // The language of a chat is no state: every language wears the same quiet chip, as on Home, so
  // none of them is taken for one of the status tags beside it.
  const chips = Array.from(html.matchAll(/<span class="shrink-0 text-\[10px\] font-bold px-1\.5 py-0\.5 rounded-md ([^"]*)">/g), (match) => match[1]);
  assert.ok(chips.length >= demoConversations.length);
  assert.deepEqual([...new Set(chips)], ['bg-slate-100 text-slate-700']);

  // What each filter keeps. A live chat whose booking the owner confirmed has the status "booked" too.
  const confirmed: Conversation = {
    ...demoConversations[0], id: 'live-web-1', live: true, status: 'booked',
    bookingRequest: { service: 'Haircut', date: '2026-10-08', time: '15:00', customerName: 'Tom', status: 'confirmed' },
  };
  const all = [confirmed, ...demoConversations];
  assert.equal(conversationsInFilter(all, 'all'), all);
  assert.deepEqual(conversationsInFilter(all, 'needs'), waiting);
  // "Booked" keeps every chat with an appointment: the confirmed live chat, and the salon's chats whose
  // appointment is in the calendar (Giulia asks to move hers; Marie's, Lara's and John's the owner confirmed).
  assert.deepEqual(conversationsInFilter(all, 'booked').map(conversation => conversation.id), ['live-web-1', 'conv-giulia', 'conv-marie', 'conv-lara', 'conv-john']);
  for (const conversation of conversationsInFilter(all, 'booked')) assert.ok(conversation.status === 'booked' || conversation.appointmentId, conversation.id);
  // A chat without an appointment is not listed, whatever its status.
  assert.deepEqual(conversationsInFilter(demoConversations.filter(conversation => !conversation.appointmentId), 'booked'), []);
  assert.deepEqual(conversationsInFilter([], 'booked'), []);
  // A live chat whose booking the owner confirmed stays under "Booked" after she wrote in it (its status is then "You handled").
  const answered: Conversation = { ...confirmed, id: 'live-web-2', status: 'owner-handled', appointmentId: undefined };
  assert.deepEqual(conversationsInFilter([answered, { ...answered, id: 'live-web-3', bookingRequest: undefined }], 'booked').map(conversation => conversation.id), ['live-web-2']);
});

/** The salon as the chat screen gets it: its calendar is where a chat's appointment is looked up. */
const salonWith = (events = demoEvents): AvailabilityContext => ({
  services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
  events, requests: [], now: FIXED_NOW, timeZone: 'Europe/Zurich',
});

test('a chat whose booking is in the calendar shows it above the messages, with the way to that appointment', () => {
  const view = (selectedId: string, extra: Partial<React.ComponentProps<typeof ConversationsView>> = {}) =>
    renderToStaticMarkup(React.createElement(ConversationsView, { ...props, selectedId, salon: salonWith(), onOpenAppointment: () => {}, ...extra }));
  const line = (html: string) => /<section[^>]*aria-label="Appointment from this chat"[^>]*>(.*?)<\/section>/.exec(html)?.[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Marie's haircut was booked in her chat: who confirmed it, what and when, and the way to it.
  assert.match(line(view('conv-marie')) ?? '', /^Booked by the AI · confirmed by you \S.* · with \S.* \w{3}, \d{2}\.\d{2}\.\d{4} · \d{2}:\d{2}–\d{2}:\d{2} View in calendar$/);
  // Giulia asks to move an appointment she has: it stays in view while her request waits.
  assert.match(line(view('conv-giulia')) ?? '', /^Confirmed by you .* View in calendar$/);
  // The line stands above the messages, before what the chat needs from the owner.
  assert.match(view('conv-giulia'), /Appointment from this chat[\s\S]*>Waiting for you<\/p>[\s\S]*wants to move an appointment/);
  // Chloé only asked for a time: nothing is booked, so nothing is shown.
  assert.equal(line(view('conv-chloe')), undefined);
  // A cancelled appointment has left the calendar: no line that leads nowhere.
  const withoutMarie = demoEvents.filter(event => event.id !== 'cal-2');
  assert.equal(line(view('conv-marie', { salon: salonWith(withoutMarie) })), undefined);
  // Without a calendar to look in the line is left out; without a way to open it, it has no button.
  assert.equal(line(view('conv-marie', { salon: undefined })), undefined);
  assert.match(line(view('conv-marie', { onOpenAppointment: undefined })) ?? '', /^Booked by the AI · confirmed by you (?!.*View in calendar)/);
});

test('the bar of a chat holds the way back, the name, what the AI does, and two controls at most', () => {
  const bar = (selectedId: string, extra: Partial<React.ComponentProps<typeof ConversationsView>> = {}) => {
    const html = renderToStaticMarkup(React.createElement(ConversationsView, { ...props, selectedId, salon: salonWith(), onOpenAppointment: () => {}, onBookForCustomer: () => {}, ...extra }));
    // The bar: from the thread's start to the end of its first row.
    const row = /<div id="conversation-thread"[^>]*><div class="(flex shrink-0 items-center[^"]*)">(.*?)<\/button><\/div>/.exec(html);
    assert.ok(row, 'the chat has its bar');
    // A button's name: its aria-label, or else its text.
    const labels = Array.from(row[2].matchAll(/<button([^>]*)>(.*?)(?=<\/button>|$)/g), ([, attributes, inner]) =>
      /aria-label="([^"]*)"/.exec(attributes)?.[1] ?? inner.replace(/<[^>]+>/g, ''));
    return { classes: row[1], html: row[2], labels };
  };
  const booked = bar('conv-marie');
  // Back to the list (phones only), an appointment by hand for this customer, the AI's settings. Nothing else.
  assert.deepEqual(booked.labels, ['All conversations', 'Book for this customer', 'Open AI receptionist settings']);
  assert.match(booked.html, /<button[^>]*aria-label="All conversations"[^>]*class="md:hidden/);
  assert.match(booked.html, /<h2[^>]*truncate[^>]*>Marie/);
  assert.match(booked.html, /AI replies automatically/);
  // On a phone "Book" is an icon with its name for screen readers, so the customer's name keeps its room.
  assert.match(booked.html, /<span aria-hidden="true" class="max-sm:hidden">Book<\/span>/);
  for (const button of booked.html.matchAll(/<button[^>]*class="([^"]*)"/g)) assert.match(button[1], /\b(min-h-11|size-11)\b/);
  // The same bar for a chat without an appointment; without a form to open, the way back and the settings.
  assert.deepEqual(bar('conv-chloe').labels, booked.labels);
  assert.deepEqual(bar('conv-chloe', { onBookForCustomer: undefined }).labels, ['All conversations', 'Open AI receptionist settings']);
});

test('a chat that waits for a decision ends with the reason and the ways on, in the place of the reply box', () => {
  const view = (selectedId: string, conversations = demoConversations) =>
    renderToStaticMarkup(React.createElement(ConversationsView, { ...props, conversations, selectedId, salon: salonWith(), onChatBooking: () => null }));
  const ways = (html: string) => {
    const group = /<div role="group" aria-label="Who answers this chat"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? '';
    return Array.from(group.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(.*?)<\/button>/g), ([, classes, label]) => `${label}${/bg-\[#5551FF\]/.test(classes) ? ' (main)' : ''}`);
  };
  // Chloé asked for a time after closing: the owner takes over, or the AI offers its answer.
  const chloe = view('conv-chloe');
  assert.deepEqual(ways(chloe), ['Take over (main)', 'Let AI continue']);
  assert.match(chloe, /Waiting for you<\/p><p[^>]*>The customer asked for Friday at 19:00, after closing time \(18:30\)\. Offer another time\.<\/p>/);
  assert.doesNotMatch(chloe, /aria-label="Reply as owner"/);
  // Sabrina's request waits on its card, and the AI has an answer ready for her question: both ways stay, the card's answers lead.
  assert.deepEqual(ways(view('conv-sabrina')), ['Take over', 'Let AI continue']);
  // Reto's request is all that waits: the AI has passed it on and has nothing to go on with.
  const reto = view('conv-reto');
  assert.deepEqual(ways(reto), ['Take over']);
  // After the last message come the reason, then the request with its answers, then the ways on:
  // all of it where the owner reads and replies, the request inside what scrolls with the messages.
  const lastMessage = demoConversations.find(conversation => conversation.id === 'conv-reto')!.messages.at(-1)!.original.slice(0, 30);
  const order = [lastMessage, '>Waiting for you</p>', 'data-chat-waiting', 'Reto Hollenstein wants to book', '>Confirm<', 'Who answers this chat'].map(part => reto.indexOf(part));
  assert.ok(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1])), `order of the chat's end: ${order.join(', ')}`);
  // The earlier block with its single answer is gone.
  assert.doesNotMatch(reto, /Confirm booking|Checked against opening hours\b/);
  // A live chat with a request in which the customer wrote again: the AI can answer that message.
  const live = (messages: Conversation['messages']): Conversation => ({
    ...demoConversations.find(conversation => conversation.id === 'conv-reto')!, id: 'live-web-9', live: true, messages,
  });
  const asked = { id: 'm1', sender: 'customer' as const, original: 'Haircut on Thursday at 15:00, for Tom', translation: 'Haircut on Thursday at 15:00, for Tom', time: '10:00' };
  const passedOn = { id: 'm2', sender: 'ai' as const, original: 'I have passed your request on.', translation: 'I have passed your request on.', time: '10:00' };
  const again = { id: 'm3', sender: 'customer' as const, original: 'Do you have parking?', translation: 'Do you have parking?', time: '10:05' };
  assert.deepEqual(ways(view('live-web-9', [live([asked, passedOn])])), ['Take over']);
  assert.deepEqual(ways(view('live-web-9', [live([asked, passedOn, again])])), ['Take over', 'Let AI continue']);
  // Once the owner has taken over, the reply box is there and the ways on are gone.
  const taken = view('conv-reto', demoConversations.map(conversation => conversation.id === 'conv-reto' ? { ...conversation, takenOver: true } : conversation));
  assert.deepEqual(ways(taken), []);
  assert.match(taken, /aria-label="Reply as owner"/);
  assert.match(taken, /Reto Hollenstein wants to book/);
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
    value: { getItem: (key: string) => key === storageKey ? JSON.stringify({ 'conv-marie': 'Draft kept while reviewing settings', 'conv-chloe': 'Kept for later' }) : null },
  });
  try {
    const html = renderToStaticMarkup(React.createElement(ConversationsView, { ...props, selectedId: 'conv-marie' }));
    assert.match(html, /value="Draft kept while reviewing settings"/);
    // A chat that waits for a decision has no reply box yet; its draft comes back with the take-over.
    const waiting = renderToStaticMarkup(React.createElement(ConversationsView, props));
    assert.doesNotMatch(waiting, /Kept for later/);
    const takenOver = props.conversations.map(conversation => conversation.id === 'conv-chloe' ? { ...conversation, takenOver: true } : conversation);
    assert.match(renderToStaticMarkup(React.createElement(ConversationsView, { ...props, conversations: takenOver })), /value="Kept for later"/);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('a chat\'s booking says how it came about: confirmed by the owner, or booked by the AI', () => {
  const chat = (id: string) => demoConversations.find(conversation => conversation.id === id)!;
  const appointmentOf = (id: string) => appointmentForConversation(chat(id), demoEvents);
  // The owner confirmed the requests the AI took in these chats, although they came in through the AI.
  for (const id of ['conv-marie', 'conv-lara', 'conv-john']) {
    assert.equal(appointmentOf(id)?.isAiBooked, true, id);
    // Home and the calendar count them as booked by the AI: the chat agrees, and adds who confirmed.
    assert.equal(chatBookingOriginLabel(chat(id), appointmentOf(id)), 'Booked by the AI · confirmed by you', id);
  }
  // Giulia's appointment was confirmed in her chat as well; her change waits, the appointment stays hers.
  assert.equal(chatBookingOrigin(chat('conv-giulia'), appointmentOf('conv-giulia')), 'owner');
  // An appointment the AI made by itself, where no request was confirmed.
  const live: Conversation = { ...chat('conv-marie'), id: 'live-web-1', live: true, bookingRequest: undefined };
  assert.equal(chatBookingOriginLabel(live, { isAiBooked: true, conversationId: 'live-web-1' }), 'Booked by the AI');
  // The owner booked it in the chat by hand.
  assert.equal(chatBookingOriginLabel(live, { isAiBooked: false, conversationId: 'live-web-1' }), 'Confirmed by you');
  // No appointment, or one that belongs to another chat: nothing to say.
  for (const id of ['conv-sabrina', 'conv-reto', 'conv-chloe']) assert.equal(chatBookingOriginLabel(chat(id), appointmentOf(id)), null, id);
  assert.equal(chatBookingOrigin(chat('conv-marie'), { isAiBooked: true, conversationId: 'conv-john' }), null);
  // An appointment that names no chat (made before chats were linked) counts only by who made it.
  assert.equal(chatBookingOrigin({ id: 'x', bookingRequest: undefined }, { isAiBooked: true, conversationId: undefined }), 'ai');
  assert.equal(chatBookingOrigin({ id: 'x', bookingRequest: undefined }, { isAiBooked: false, conversationId: undefined }), null);
});

test('the translation line shows only when the owner does not read the chat\'s language', () => {
  const english = { ...initialAiSettings, ownerLanguage: 'English', translateChats: true };
  const german = { ...english, ownerLanguage: 'German' };
  const byLanguage = (language: Conversation['language']) => demoConversations.find(conversation => conversation.language === language)!;
  // An owner who reads English: the German, French and Italian chats are translated, the English one is not.
  assert.deepEqual((['DE', 'FR', 'IT', 'EN'] as const).map(language => showsTranslation(byLanguage(language), english)), [true, true, true, false]);
  // An owner who reads German: the German chats need no translation, the others do.
  assert.deepEqual((['DE', 'FR', 'IT', 'EN'] as const).map(language => showsTranslation(byLanguage(language), german)), [false, true, true, true]);
  assert.equal(ownerReadsChatLanguage(byLanguage('DE'), german), true);
  // Translation off: no line at all.
  assert.equal(showsTranslation(byLanguage('FR'), { ...english, translateChats: false }), false);
  // A live chat names the language the AI detected; its code stands in for every unknown language.
  const spanish: Conversation = { ...byLanguage('EN'), id: 'live-web-2', live: true, languageLabel: 'Spanish' };
  assert.equal(showsTranslation(spanish, english), true);
  assert.equal(showsTranslation({ ...spanish, languageLabel: 'german' }, german), false);
  // Without a detected name the code decides.
  assert.equal(showsTranslation({ ...spanish, languageLabel: undefined }, english), false);
  // The messages follow the same rule: a German chat is shown as written to an owner who reads German.
  const message = byLanguage('DE').messages[0];
  assert.deepEqual(messageForOwner(message, 'DE', german), { text: message.original, showOriginal: false, translationUnavailable: false });
  assert.equal(messageForOwner(message, 'DE', english).showOriginal, true);
});
