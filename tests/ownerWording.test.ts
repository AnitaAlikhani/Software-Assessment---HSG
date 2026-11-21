import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { AiAssistantView, channelRows } from '../src/views/AiAssistantView';
import { ConversationsView } from '../src/views/ConversationsView';
import { SettingsView } from '../src/views/SettingsView';
import { initialAiSettings } from '../src/conversationData';
import { useLiveWhatsApp } from '../src/liveWhatsApp';
import * as startingSalon from '../src/mockData';
import { initialBookingHours, initialCompanySettings } from '../src/mockData';
import { forgetRetiredDemoState, salonStorageKey, useDemoState } from '../src/useDemoState';
import { salonContext } from '../server/ai';
import { ALWAYS_HAND_OVER } from '../server/salonRules';
import type { Conversation } from '../src/types';
import { blockedStorage, BrowserStandIn, inTab } from './browserStandIn';
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
  ]);
  // The list holds what exists: a channel that is only planned has no row.
  assert.doesNotMatch(JSON.stringify(rows), /Instagram|Planned|missed call/i);
  // WhatsApp names the number from Settings and says what is missing, instead of "Connected".
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
  // WhatsApp stays "Not connected" until Meta has verified the business and Instagram is not offered
  // at all, so nothing the salon starts with may claim to have come in there.
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
  // Three channels, each with its real state; nothing is listed as planned.
  assert.equal(html.match(/<li /g)?.length, 3);
  assert.doesNotMatch(readableText(html), /Instagram|Planned|missed call/i);
});

test('"How the AI answers" is one note in plain text, and says what the live assistant is really told', () => {
  const html = assistant({ live: 'off' });
  const prompt = salonContext();
  // Tone and handover cannot be changed here, so they are no sections of their own and no list
  // of ticks that reads like switched-on settings: one note holds both.
  const note = /<section aria-labelledby="ai-answers-title"[^>]*>(.*?)<\/section>/.exec(html)?.[1] ?? '';
  assert.match(note, /<h2 id="ai-answers-title"[^>]*>How the AI answers<\/h2>/);
  assert.doesNotMatch(note, /<(ul|li|svg|button|input|select)\b/);
  assert.doesNotMatch(html, />(Tone of voice|Handover rules)</);
  const text = readableText(note).replace(/\s+/g, ' ');
  // The rules in the note are the rules in the assistant's instructions, in the same order ...
  const rules = initialAiSettings.handoverRules.filter(item => item.enabled).map(item => item.label);
  assert.equal(rules.length, 4);
  for (const rule of rules) assert.ok(prompt.includes(rule), rule);
  assert.ok(text.includes(`The AI receptionist always hands these over to you: ${rules.join(', ').toLowerCase()}.`), text);
  // ... and the sentence after them sums up the topics the server always adds. If that list
  // changes in server/salonRules.ts, change the sentence in AiAssistantView.tsx with it.
  assert.equal(ALWAYS_HAND_OVER.length, 3);
  assert.match(ALWAYS_HAND_OVER[0], /Health, allergies/);
  assert.match(ALWAYS_HAND_OVER[1], /do not answer/);
  assert.match(ALWAYS_HAND_OVER[2], /upset or ask to talk to a person/);
  assert.match(text, /It also hands over health and allergy questions, anything it does not know, and customers who are upset or ask for a person\./);
  assert.match(prompt, /warm and friendly/);
  assert.match(text, /Warm and friendly, in the customer’s language and in a few short sentences\./);

  // With no rule of the owner's switched on, the note still names what is always handed over.
  const none = render(React.createElement(AiAssistantView, {
    settings: { ...initialAiSettings, handoverRules: initialAiSettings.handoverRules.map(rule => ({ ...rule, enabled: false })) },
    onSave: nothing, channels: { live: 'off' },
  }));
  assert.match(none, /The AI receptionist always hands over health and allergy questions/);
  assert.doesNotMatch(none, /hands these over to you|discounts/i);
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
  // Her own words stand in the bubble above the translation; there is no separate view of them.
  assert.match(html, />Bonjour, avez-vous de la place vendredi \?<\/p><div[^>]*><\/div><p[^>]*>Hello, do you have room on Friday\?<\/p>/);
  assert.doesNotMatch(html, /Customer view|sees this chat/);
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

// ---------- Settings, and the Rooms & equipment page that went ----------

test('Settings has no demo wording and no field that changes nothing', () => {
  const settingsTab = (tab?: React.ComponentProps<typeof SettingsView>['tab']) => render(React.createElement(SettingsView, {
    settings: initialCompanySettings, bookingHours: initialBookingHours, onSaveSettings: nothing,
    closedDates: [], onSaveClosedDates: nothing, now: FIXED_NOW, tab, bookingLink: 'https://slotbee.example/?booking=1',
  }));
  for (const tab of ['salon', 'hours', 'closed-dates', 'online-booking'] as const) {
    assert.doesNotMatch(readableText(settingsTab(tab)), TELL_WORDS, tab);
    assert.doesNotMatch(settingsTab(tab), /disabled=""/, tab);
  }
  const html = settingsTab();
  assert.match(html, /Select Save to apply the logo\./);
  // Industry, State/Province and the branch language were saved but read nowhere.
  assert.doesNotMatch(html, /Industry|State\/Province|Branch language/);
  // The currency is fixed: it is text, not a greyed-out field.
  assert.doesNotMatch(html, /disabled=""/);
  assert.ok(html.includes(`>${initialCompanySettings.currency}</p>`));
});

/** The salon as a browser that used the app before has it stored: one entry with all its parts (src/demoStore.ts). */
const storedSalon = (parts: Record<string, unknown>): string =>
  JSON.stringify({ day: '2026-10-05', builtAt: FIXED_NOW.toISOString(), changed: true, parts });

test('settings fields that nothing reads are gone, and a browser that stored them still loads', () => {
  for (const field of ['whatsappConnected', 'instagramConnected']) assert.ok(!(field in initialAiSettings), field);
  for (const field of ['state', 'industry', 'branchLanguage']) assert.ok(!(field in initialCompanySettings), field);
  // A browser that stored the settings earlier still holds the old fields, next to what the owner
  // saved. Fields the app does not know are no reason to refuse the stored settings.
  const browser = new BrowserStandIn();
  browser.stored.set(salonStorageKey('/'), storedSalon({
    aiSettings: { ...initialAiSettings, ownerLanguage: 'German', whatsappConnected: true, instagramConnected: false },
    companySettings: { ...initialCompanySettings, companyName: 'Coiffeur Keller', state: 'St. Gallen', industry: 'Hair & Beauty', branchLanguage: 'English' },
  }));
  let saved: unknown;
  const StoredTab = () => {
    const [aiSettings] = useDemoState('aiSettings', initialAiSettings);
    const [companySettings] = useDemoState('companySettings', initialCompanySettings);
    saved = { aiSettings, companySettings };
    return React.createElement(React.Fragment, null,
      React.createElement(AiAssistantView, { settings: aiSettings, onSave: nothing, channels: { live: 'off' } }),
      React.createElement(SettingsView, {
        settings: companySettings, bookingHours: initialBookingHours, onSaveSettings: nothing,
        closedDates: [], onSaveClosedDates: nothing, now: FIXED_NOW,
      }));
  };
  const html = inTab(browser.openTab(), () => render(React.createElement(StoredTab)));
  // The stored settings are used as they are: what the owner saved is shown ...
  assert.match(html, /value="Coiffeur Keller"/);
  assert.match(html, /<option[^>]*selected=""[^>]*>German<\/option>/);
  assert.equal((saved as { companySettings: { industry?: string } }).companySettings.industry, 'Hair & Beauty');
  // ... and the fields that went appear nowhere: no input, no label, no channel switch.
  assert.doesNotMatch(html, /Hair &amp; Beauty|Industry|State\/Province|Branch language/);
  assert.doesNotMatch(html, />(Connect|Connected)</);
});

test('Rooms & equipment is gone with its data, and what an earlier version stored of it is taken out', () => {
  // Nothing of the screen is left in the salon a workspace starts with.
  assert.ok(!('initialResources' in startingSalon));
  assert.doesNotMatch(JSON.stringify(startingSalon), /Styling Chair|Hair Steamer|Colour Studio|res-/);

  // A tab that was open before the screen went still holds its list, as the earlier version
  // stored it: every part under a key of its own, in the tab's storage.
  const browser = new BrowserStandIn();
  const tab = browser.openTab();
  tab.session.setItem('booking-demo-v3:/:resources', JSON.stringify([{ id: 'res-styling-chair-1', name: 'Styling Chair 1', type: 'Chair', capacity: 1, color: '#FDE047' }]));
  tab.session.setItem('booking-demo-v3:/:companySettings', JSON.stringify({ ...initialCompanySettings, companyName: 'Salon before the update' }));
  tab.session.setItem('booking-demo-v3:/previews/x/:resources', '[]');
  tab.session.setItem('slotbee-booking-from-dashboard', '1');
  // What the current version has stored for the salon stands next to it.
  browser.stored.set(salonStorageKey('/'), storedSalon({ companySettings: { ...initialCompanySettings, companyName: 'Coiffeur Keller' } }));
  // The app takes out what the earlier version left, when it starts: only for the place the app
  // is served from, and nothing that is not its own.
  forgetRetiredDemoState([tab.session, tab.local], '/');
  assert.deepEqual(Array.from({ length: tab.session.length }, (_, index) => tab.session.key(index)), ['booking-demo-v3:/previews/x/:resources', 'slotbee-booking-from-dashboard']);
  assert.deepEqual([...browser.stored.keys()], [salonStorageKey('/')]);
  // What the owner saved with the current version is read as before; the earlier version's copy is not.
  let name = '';
  const StoredTab = () => { name = useDemoState('companySettings', initialCompanySettings)[0].companyName; return null; };
  inTab(tab, () => render(React.createElement(StoredTab)));
  assert.equal(name, 'Coiffeur Keller');
  // Storage that is missing or blocked is no reason to fail.
  forgetRetiredDemoState([null, undefined], '/');
  forgetRetiredDemoState([blockedStorage], '/');
});
