import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { AiAssistantView, channelRows } from '../src/views/AiAssistantView';
import { ConversationsView } from '../src/views/ConversationsView';
import { ResourcesView } from '../src/views/ResourcesView';
import { SettingsView } from '../src/views/SettingsView';
import { initialAiSettings } from '../src/conversationData';
import { useLiveWhatsApp } from '../src/liveWhatsApp';
import { initialBookingHours, initialCompanySettings, initialResources } from '../src/mockData';
import { demoStorageKey, useDemoState } from '../src/useDemoState';
import { salonContext } from '../server/ai';
import { ALWAYS_HAND_OVER } from '../server/salonRules';
import type { Conversation } from '../src/types';
import { demoConversations, demoCustomers, demoRequests, FIXED_NOW } from './fixedClock';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// The owner's screens read like a product: no word that gives the class exercise away, no control
// that does nothing, and nothing that claims a connection which does not exist.

const nothing = () => {};

// ---------- Channels on the AI receptionist page ----------

test('without live chats no channel is called active', () => {
  const rows = channelRows({ live: 'off', telegramBot: 'slotbee_bella_bot', whatsappChats: true, businessPhone: '+41 71 222 33 44' });
  assert.deepEqual(rows.map(row => [row.channel, row.state, row.stateLabel]), [
    ['Website', 'off', 'Not active'],
    ['Telegram', 'off', 'Not connected'],
    ['WhatsApp', 'off', 'Not connected'],
    ['Instagram', 'planned', 'Planned'],
    ['Phone', 'planned', 'Planned'],
  ]);
  // WhatsApp names the number from Company Settings and says what is missing, instead of "Connected".
  assert.match(rows[2].detail, /Meta has to verify the business before your salon number \(\+41 71 222 33 44\) can be connected\./);
  assert.match(channelRows({ live: 'off' })[2].detail, /before a salon number can be connected/);
});

test('channels are active only for what the live chats really show', () => {
  const waiting = channelRows({ live: 'checking', telegramBot: 'slotbee_bella_bot' });
  assert.deepEqual(waiting.slice(0, 3).map(row => row.state), ['checking', 'checking', 'checking']);

  const [website, telegram, whatsapp] = channelRows({ live: 'on', telegramBot: null });
  assert.equal(website.state, 'active');
  assert.equal(telegram.state, 'off');
  assert.equal(whatsapp.state, 'off');

  const connected = channelRows({ live: 'on', telegramBot: 'slotbee_bella_bot', whatsappChats: true });
  assert.deepEqual(connected.slice(0, 3).map(row => row.state), ['active', 'active', 'active']);
  assert.deepEqual(connected[1].link, { href: 'https://t.me/slotbee_bella_bot', label: '@slotbee_bella_bot' });
  // The only address ever shown is the public one of the Telegram bot. The website chat link
  // carries the owner's access key, so no row has it.
  assert.deepEqual(connected.filter(row => row.link).map(row => row.channel), ['Telegram']);
});

test('the sample chats and requests use a channel that the Channels list can show as active', () => {
  // WhatsApp stays "Not connected" until Meta has verified the business and Instagram is only planned,
  // so nothing the salon starts with may claim to have come in there.
  const rows = channelRows({ live: 'on' });
  const active = rows.filter(row => row.state === 'active').map(row => row.channel);
  assert.deepEqual(active, ['Website']);
  for (const conversation of demoConversations) assert.ok(active.includes(conversation.channel), `${conversation.id}: ${conversation.channel}`);
  for (const customer of demoCustomers) assert.ok(customer.channel === undefined || active.includes(customer.channel), `${customer.id}: ${customer.channel}`);
  // A request has no chat behind it: it comes in over the web, as from the booking page.
  for (const request of demoRequests) assert.equal(request.channel, 'Web', request.id);
});

/** Runs with a browser's globals standing in for the tab: its address and what it has stored. */
const inBrowser = <T,>(globals: Record<string, unknown>, run: () => T): T => {
  const previous = Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value });
  try {
    return run();
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
};

test('the public booking page never reads the access key, so it cannot ask for the salon\'s chats', () => {
  // The owner's own browser holds the key, and a link could carry one as well.
  const touched: string[] = [];
  const browser = {
    window: { location: { pathname: '/', search: '?booking=1&live=key-in-the-address' } },
    localStorage: {
      getItem: (name: string) => { touched.push(`read ${name}`); return 'key-in-the-storage'; },
      setItem: (name: string) => { touched.push(`write ${name}`); },
    },
  };
  let live: ReturnType<typeof useLiveWhatsApp> | undefined;
  const Probe = ({ active }: { active: boolean }) => { live = useLiveWhatsApp(active); return null; };
  inBrowser(browser, () => render(React.createElement(Probe, { active: false })));
  assert.equal(live?.status, 'off');
  assert.equal(live?.channels, null);
  assert.deepEqual(live?.conversations, []);
  assert.deepEqual(touched, []);
  // The dashboard in the same browser takes the key and starts asking: its status is not known yet.
  inBrowser(browser, () => render(React.createElement(Probe, { active: true })));
  assert.equal(live?.status, 'checking');
  assert.deepEqual(touched, ['write slotbee-live-key']);
});

test('without an access key the live status is known at once, so nothing reads "Checking…"', () => {
  let status = '';
  const Probe = () => { status = useLiveWhatsApp().status; return null; };
  render(React.createElement(Probe));
  assert.equal(status, 'off');
});

const assistant = (channels: React.ComponentProps<typeof AiAssistantView>['channels']) =>
  render(React.createElement(AiAssistantView, { settings: initialAiSettings, onSave: nothing, channels }));

test('the AI receptionist page has no demo wording, no dead control and no switch that only flips its label', () => {
  const html = assistant({ live: 'on', telegramBot: 'slotbee_bella_bot', businessPhone: '+41 71 222 33 44' });
  // The page carries the name of its menu entry. "Assistant" alone is the owner's helper in the header.
  assert.match(html, /<h1[^>]*>AI receptionist<\/h1>/);
  assert.doesNotMatch(readableText(html), /\bassistant\b/i);
  assert.doesNotMatch(readableText(html), TELL_WORDS);
  assert.doesNotMatch(html, /disabled=""/);
  assert.doesNotMatch(html, />(Connect|Connected)</);
  assert.doesNotMatch(html, /000 00 00|instagram\.com/);
  // Controls that remain act: Save, the four language chips, two switches and the language choice.
  assert.equal(html.match(/<button/g)?.length, 5);
  assert.equal(html.match(/<input/g)?.length, 2);
  assert.equal(html.match(/<select/g)?.length, 1);
  assert.match(html, />Website chat</);
  assert.match(html, />Active</);
  assert.match(html, /href="https:\/\/t\.me\/slotbee_bella_bot"/);
  assert.match(html, /\(\+41 71 222 33 44\)/);
  assert.doesNotMatch(html, /chat=1|live=/);
});

test('tone and handover rules are shown as what the live assistant is really told', () => {
  const html = assistant({ live: 'off' });
  const prompt = salonContext();
  // The rules on the page are the rules in the assistant's instructions ...
  for (const rule of initialAiSettings.handoverRules.filter(item => item.enabled)) {
    assert.ok(html.includes(`${rule.label}</li>`), rule.label);
    assert.ok(prompt.includes(rule.label), rule.label);
  }
  // ... and the sentence below them sums up the topics the server always adds. If that list
  // changes in server/salonRules.ts, change the sentence in AiAssistantView.tsx with it.
  assert.equal(ALWAYS_HAND_OVER.length, 3);
  assert.match(ALWAYS_HAND_OVER[0], /Health, allergies/);
  assert.match(ALWAYS_HAND_OVER[1], /do not answer/);
  assert.match(ALWAYS_HAND_OVER[2], /upset or ask to talk to a person/);
  assert.match(html, /It also hands over health and allergy questions, anything it does not know, and customers who are upset or ask for a person\./);
  assert.match(prompt, /warm and friendly/);
  assert.match(html, /Warm and friendly, in the customer’s language and in a few short sentences\./);
});

// ---------- Conversations ----------

const chat = (partial: Partial<Conversation> = {}): Conversation => ({
  id: 'conv-1', customerName: 'Camille Bernard', initials: 'CB', avatarColor: 'bg-rose-100 text-rose-700',
  language: 'FR', phone: '+41 79 555 01 13', channel: 'Website', status: 'ai-handled', lastTime: '12:18',
  messages: [{ id: 'm1', sender: 'customer', original: 'Bonjour, avez-vous de la place vendredi ?', translation: 'Hello, do you have room on Friday?', time: '12:10' }],
  ...partial,
});
const inbox = (conversation: Conversation, settings = initialAiSettings) => render(React.createElement(ConversationsView, {
  conversations: [conversation], selectedId: conversation.id, mobileDetailOpen: true,
  onBackToList: nothing, onSelect: nothing, onTakeOver: nothing, onLetAiContinue: () => null, onOwnerReply: () => true,
  aiSettings: settings, onOpenAiSettings: nothing,
}));

test('a chat is worded as a product', () => {
  const html = inbox(chat());
  assert.doesNotMatch(readableText(html), TELL_WORDS);
  assert.match(html, /AI replies automatically/);
  // The way to the AI's settings carries the name of that page.
  assert.match(html, /title="Open AI receptionist settings"/);
  assert.match(html, /Translated from French/);
  assert.match(html, /placeholder="Write a reply…"/);
  // A customer the salon knows: the number from her record, then the channel she wrote on.
  assert.match(html, />\+41 79 555 01 13 · Website chat</);
  assert.doesNotMatch(html, /WhatsApp|Instagram/);
  assert.match(html, /How Camille sees this chat/);
  assert.doesNotMatch(html, /Sending is disabled|Preview/);
});

test('the chat says how the AI works in it: automatically, after approval, or paused', () => {
  const waiting = chat({ status: 'needs-attention', attentionReason: 'The customer asked for a discount.', aiFollowUp: { original: 'Bien sûr.', translation: 'Of course.' } });
  const approval = inbox(waiting, { ...initialAiSettings, askBeforeSending: true });
  assert.match(approval, /AI asks before sending/);
  assert.match(approval, /placeholder="Take over to reply"/);
  assert.match(inbox(waiting), /AI replies automatically/);

  const takenOver = inbox(chat({
    status: 'owner-handled', takenOver: true,
    messages: [...chat().messages, { id: 'm2', sender: 'owner', original: 'We can offer 10%.', translation: 'We can offer 10%.', time: 'now', untranslated: true }],
  }));
  assert.match(takenOver, /AI paused in this chat/);
  assert.match(takenOver, />The AI is paused for this chat\.</);
  // A typed reply is marked for what it is, without a claim about where it went.
  assert.match(takenOver, />\s*Not translated\s*</);
  assert.doesNotMatch(readableText(takenOver), TELL_WORDS);
});

test('a chat without a phone number shows its channel, never a stand-in label', () => {
  const website = inbox(chat({ id: 'live-web-1', live: true, languageLabel: 'Spanish', language: 'EN', phone: 'Test visitor', channel: 'Website' }));
  assert.match(website, />Website chat</);
  assert.doesNotMatch(readableText(website), TELL_WORDS);
  // The server sends no number at all for a website chat: the channel stands alone, without a separator.
  const noNumber = inbox(chat({ id: 'live-web-2', live: true, phone: '', channel: 'Website' }));
  assert.match(noNumber, /<p[^>]*>Website chat<\/p>/);
  assert.doesNotMatch(readableText(noNumber), /·\s*Website|Website chat\s*·/);
  assert.match(inbox(chat({ id: 'live-tg-1', live: true, phone: 'Telegram user', channel: 'Telegram' })), />Telegram</);
  assert.match(inbox(chat({ id: 'live-41791234567', live: true, phone: '+41 ••• ••• 67', channel: 'WhatsApp' })), /\+41 ••• ••• 67 · WhatsApp/);
});

// ---------- Company Settings and the hidden Rooms & equipment page ----------

test('Company Settings has no demo wording and no field that changes nothing', () => {
  const html = render(React.createElement(SettingsView, {
    settings: initialCompanySettings, bookingHours: initialBookingHours, onSaveSettings: nothing,
    closedDates: [], absences: [], employees: [], onSaveClosedDates: nothing, onSaveAbsences: nothing, now: FIXED_NOW,
  }));
  assert.doesNotMatch(readableText(html), TELL_WORDS);
  assert.match(html, /Select Save to apply the logo\./);
  // Industry, State/Province and the branch language were saved but read nowhere.
  assert.doesNotMatch(html, /Industry|State\/Province|Branch language/);
  // The currency is fixed: it is text, not a greyed-out field.
  assert.doesNotMatch(html, /disabled=""/);
  assert.ok(html.includes(`>${initialCompanySettings.currency}</p>`));
});

test('settings fields that nothing reads are gone, and a tab that stored them still loads', () => {
  for (const field of ['whatsappConnected', 'instagramConnected']) assert.ok(!(field in initialAiSettings), field);
  for (const field of ['state', 'industry', 'branchLanguage']) assert.ok(!(field in initialCompanySettings), field);
  // A tab that was open before still holds the old fields in its storage, next to what the owner saved.
  const stored: Record<string, string> = {
    [demoStorageKey('aiSettings', '/')]: JSON.stringify({ ...initialAiSettings, ownerLanguage: 'German', whatsappConnected: true, instagramConnected: false }),
    [demoStorageKey('companySettings', '/')]: JSON.stringify({ ...initialCompanySettings, companyName: 'Coiffeur Keller', state: 'St. Gallen', industry: 'Hair & Beauty', branchLanguage: 'English' }),
  };
  let saved: unknown;
  const StoredTab = () => {
    const [aiSettings] = useDemoState('aiSettings', initialAiSettings);
    const [companySettings] = useDemoState('companySettings', initialCompanySettings);
    saved = { aiSettings, companySettings };
    return React.createElement(React.Fragment, null,
      React.createElement(AiAssistantView, { settings: aiSettings, onSave: nothing, channels: { live: 'off' } }),
      React.createElement(SettingsView, {
        settings: companySettings, bookingHours: initialBookingHours, onSaveSettings: nothing,
        closedDates: [], absences: [], employees: [], onSaveClosedDates: nothing, onSaveAbsences: nothing, now: FIXED_NOW,
      }));
  };
  const html = inBrowser({ sessionStorage: { getItem: (name: string) => stored[name] ?? null } }, () => render(React.createElement(StoredTab)));
  // The stored settings are used as they are: what the owner saved is shown ...
  assert.match(html, /value="Coiffeur Keller"/);
  assert.match(html, /<option[^>]*selected=""[^>]*>German<\/option>/);
  assert.equal((saved as { companySettings: { industry?: string } }).companySettings.industry, 'Hair & Beauty');
  // ... and the fields that went appear nowhere: no input, no label, no channel switch.
  assert.doesNotMatch(html, /Hair &amp; Beauty|Industry|State\/Province|Branch language/);
  assert.doesNotMatch(html, />(Connect|Connected)</);
});

test('Rooms & equipment uses salon wording and has no options that do nothing', () => {
  const html = render(React.createElement(ResourcesView, {
    resources: initialResources, onAddResource: nothing, onUpdateResource: nothing, onDeleteResource: nothing,
  }));
  assert.match(html, />\s*Rooms &amp; equipment\s*</);
  assert.doesNotMatch(readableText(html), TELL_WORDS);
  assert.doesNotMatch(html, /inventory|booking automation|person|people|disabled=""/i);
  // Seats are a property of rooms only.
  const rooms = initialResources.filter(resource => resource.type === 'Room').length;
  assert.equal(html.match(/Seats:/g)?.length ?? 0, rooms);
});
