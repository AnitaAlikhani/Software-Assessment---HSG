import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialAiSettings } from '../src/conversationData';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { isLiveConversation } from '../src/liveWhatsApp';
import { ConversationsView } from '../src/views/ConversationsView';
import { salonContext, salonNow } from '../server/ai';
import {
  addCustomerMessage,
  addReply,
  emptyState,
  needsOwner,
  parseWebhook,
  publicConversations,
  isValidSessionId,
  parseTelegramUpdate,
  telegramChatId,
  toChatLanguage,
  verifySignature,
  visitorMessages,
  webChatId,
} from '../server/whatsappCore';

const webhook = (text: string, id = 'wamid.1', type = 'text') => ({
  object: 'whatsapp_business_account',
  entry: [{
    changes: [{
      field: 'messages',
      value: {
        contacts: [{ wa_id: '41791234567', profile: { name: 'Sofia Rossi' } }],
        messages: [{ id, from: '41791234567', timestamp: '1763200000', type, text: { body: text } }],
      },
    }],
  }],
});

test('reads text messages from a WhatsApp webhook and skips status updates', () => {
  const [message] = parseWebhook(webhook('Ciao, avete posto sabato?'));
  assert.equal(message.waId, '41791234567');
  assert.equal(message.name, 'Sofia Rossi');
  assert.equal(message.text, 'Ciao, avete posto sabato?');
  assert.deepEqual(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{ status: 'read' }] } }] }] }), []);
  assert.deepEqual(parseWebhook(webhook('', 'wamid.2', 'image')), []);
  assert.deepEqual(parseWebhook(null), []);
});

test('only accepts webhooks signed with the app secret', () => {
  const body = JSON.stringify(webhook('Hello'));
  const good = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`;
  assert.equal(verifySignature(body, good, 'secret'), true);
  assert.equal(verifySignature(body, good, 'other-secret'), false);
  assert.equal(verifySignature(`${body} `, good, 'secret'), false);
  assert.equal(verifySignature(body, null, 'secret'), false);
});

test('keeps one chat per customer, remembers handled messages and hides the phone number', () => {
  const state = emptyState();
  const [first] = parseWebhook(webhook('Ciao', 'wamid.a'));
  const conversation = addCustomerMessage(state, first, { original: 'Ciao', translation: 'Hello', translationDe: 'Hallo' }, 'IT', 'Italian');
  addReply(conversation, 'ai', { original: 'Ciao! Come posso aiutarti?', translation: 'Hi! How can I help?' });
  const [second] = parseWebhook(webhook('Uno sconto?', 'wamid.b'));
  addCustomerMessage(state, second, { original: 'Uno sconto?', translation: 'A discount?' }, 'IT', 'Italian');
  needsOwner(conversation, 'The customer asked for a discount.');

  assert.equal(state.conversations.length, 1);
  assert.deepEqual(state.processedIds, ['wamid.a', 'wamid.b']);
  const [shown] = publicConversations(state);
  assert.equal(shown.id, 'live-41791234567');
  assert.equal(shown.live, true);
  assert.equal(shown.status, 'needs-attention');
  assert.equal(shown.messages.length, 3);
  assert.ok(!shown.phone.includes('912345'), 'the full number must not reach the website');
});

test('an owner reply pauses the AI for that chat', () => {
  const state = emptyState();
  const conversation = addCustomerMessage(state, parseWebhook(webhook('Hi'))[0], { original: 'Hi', translation: 'Hi' }, 'EN');
  addReply(conversation, 'owner', { original: 'Hello!', translation: 'Hello!' });
  assert.equal(conversation.takenOver, true);
  assert.equal(conversation.status, 'owner-handled');
});

test('maps detected languages to the demo language chips', () => {
  assert.equal(toChatLanguage('fr'), 'FR');
  assert.equal(toChatLanguage('IT'), 'IT');
  assert.equal(toChatLanguage('es'), 'EN');
  assert.equal(toChatLanguage(undefined), 'EN');
  assert.equal(isLiveConversation('live-4179'), true);
  assert.equal(isLiveConversation('conv-camille'), false);
});

test('the AI is told the salon services, opening hours and handover rules', () => {
  const context = salonContext();
  assert.match(context, /Bella Hair Salon/);
  assert.match(context, /Haircut/);
  assert.match(context, /Monday: closed/);
  assert.match(context, /Saturday: 08:00–16:00/);
  assert.match(context, /Discounts and price changes/);
});

test('live chats show their channel and the detected language, and no customer view', () => {
  const state = emptyState();
  addCustomerMessage(state, parseWebhook(webhook('Hola, ¿tienen cita el lunes?'))[0], { original: 'Hola', translation: 'Hello' }, 'EN', 'Spanish');
  const [conversation] = publicConversations(state);
  const html = renderToStaticMarkup(React.createElement(ConversationsView, {
    conversations: [conversation],
    selectedId: conversation.id,
    mobileDetailOpen: false,
    onBackToList: () => {},
    onSelect: () => {},
    onTakeOver: () => {},
    onLetAiContinue: () => null,
    onOwnerReply: () => true,
    aiSettings: initialAiSettings,
    onOpenAiSettings: () => {},
  }));
  assert.match(html, /via WhatsApp</);
  assert.match(html, /Spanish/);
  assert.match(html, /Translated from Spanish/);
  assert.doesNotMatch(html, />Customer view</);
  // "Live" marks a tester's chat for moderators only (see tests/studyTools.test.ts).
  assert.doesNotMatch(html, />Live</);
});

test('website chats show as live "Website" chats and the visitor sees only their own language', () => {
  const state = emptyState();
  const waId = webChatId('abc123def456ghi7');
  const conversation = addCustomerMessage(
    state,
    { id: 'web-1', waId, name: 'Lena', text: 'Hallo, habt ihr Samstag frei?', timestamp: 1763200000000, channel: 'Website' },
    { original: 'Hallo, habt ihr Samstag frei?', translation: 'Hi, are you free on Saturday?' },
    'DE',
    'German',
  );
  addReply(conversation, 'ai', { original: 'Samstag ist geschlossen.', translation: 'We are closed on Saturday.' });
  const [shown] = publicConversations(state);
  assert.equal(shown.channel, 'Website');
  assert.equal(shown.phone, ''); // a website chat has no number, and no label stands in for one
  assert.deepEqual(visitorMessages(conversation).map(m => [m.from, m.text]), [
    ['me', 'Hallo, habt ihr Samstag frei?'],
    ['salon', 'Samstag ist geschlossen.'],
  ]);
  assert.deepEqual(visitorMessages(undefined), []);
  assert.equal(isValidSessionId('abc123def456ghi7'), true);
  assert.equal(isValidSessionId('../etc'), false);
  assert.equal(isValidSessionId('short'), false);
});

test('reads private Telegram text messages and shows them as live Telegram chats', () => {
  const update = (text: string, extra: Record<string, unknown> = {}) => ({
    update_id: 501,
    message: { message_id: 7, date: 1763200000, text, chat: { id: 987654, type: 'private' }, from: { first_name: 'Ana', last_name: 'Silva', language_code: 'pt' }, ...extra },
  });
  const message = parseTelegramUpdate(update('Olá, têm vaga sexta?'))!;
  assert.equal(message.id, 'tg-501');
  assert.equal(message.waId, 'tg-987654');
  assert.equal(message.name, 'Ana Silva');
  assert.equal(message.isCommand, false);
  assert.equal(telegramChatId(message.waId), '987654');
  assert.equal(parseTelegramUpdate(update('/start'))!.isCommand, true);
  assert.equal(parseTelegramUpdate(update('hi', { chat: { id: 1, type: 'group' } })), null);
  assert.equal(parseTelegramUpdate({ update_id: 1, edited_message: {} }), null);

  const state = emptyState();
  addCustomerMessage(state, message, { original: message.text, translation: 'Hello, any slot Friday?' }, 'EN', 'Portuguese');
  const [shown] = publicConversations(state);
  assert.equal(shown.channel, 'Telegram');
  assert.equal(shown.phone, '');
  assert.equal(shown.languageLabel, 'Portuguese');
});

test('the AI is told the current salon date and time', () => {
  assert.equal(salonNow(new Date('2026-11-16T18:19:00Z')), 'Monday, 16 November 2026 at 19:19');
});

test('AI booking requests are checked against the salon rules in code', async () => {
  const { validBookingRequest } = await import('../server/bookingRules');
  const now = new Date('2026-11-16T18:19:00Z'); // Monday 19:19 in Zurich
  const ask = (date: string, time: string, service = 'Haircut') => validBookingRequest({ service, date, time, customerName: 'Ana' }, now);
  // The answer names the service by its id too, so the owner's confirmation survives a rename.
  assert.deepEqual(ask('2026-11-17', '15:00'), { service: 'Haircut', serviceId: 'srv-2', date: '2026-11-17', time: '15:00', customerName: 'Ana' });
  assert.equal(ask('2026-11-17', '15:00', 'haircut')?.service, 'Haircut');
  assert.equal(ask('2026-11-23', '10:00'), null, 'Monday is closed');
  assert.equal(ask('2026-11-22', '10:00'), null, 'Sunday is closed');
  assert.equal(ask('2026-11-17', '17:45'), null, 'not on a 30-minute step');
  assert.equal(ask('2026-11-17', '17:00', 'Colouring')?.serviceId, 'srv-3', 'Colouring ends exactly at closing time');
  assert.equal(ask('2026-11-17', '17:30', 'Colouring'), null, 'Colouring would end after closing');
  assert.equal(ask('2026-11-17', '08:30')?.time, '08:30', 'opening time');
  assert.equal(ask('2026-11-17', '08:00'), null, 'before opening');
  // Each day has its own closing time: 18:00 is fine on a weekday, Saturday ends at 16:00.
  assert.equal(ask('2026-11-17', '18:00')?.time, '18:00');
  assert.equal(ask('2026-11-21', '15:30')?.time, '15:30');
  assert.equal(ask('2026-11-21', '16:00'), null, 'Saturday closes at 16:00');
  assert.equal(ask('2026-11-16', '20:00'), null, 'today, closed and too soon');
  assert.equal(ask('2026-11-13', '10:00'), null, 'in the past');
  assert.equal(ask('2027-03-02', '10:00'), null, 'more than 8 weeks ahead');
  assert.equal(ask('2026-11-17', '15:00', 'Massage'), null, 'unknown service');
  assert.equal(validBookingRequest(undefined, now), null);
  // Same day: at least two hours' notice.
  const tuesdayMorning = new Date('2026-11-17T09:00:00Z'); // 10:00 in Zurich
  const today = (time: string) => validBookingRequest({ service: 'Haircut', date: '2026-11-17', time, customerName: 'Ana' }, tuesdayMorning);
  assert.equal(today('11:30'), null);
  assert.equal(today('12:00')?.time, '12:00');
});

test('a valid AI booking request asks the owner to confirm; the reply is only stored after sending', async () => {
  const { recordAnalysis } = await import('../server/recordAnalysis');
  const state = emptyState();
  const analysis = {
    languageCode: 'pt', languageName: 'Portuguese', translationEn: 'Haircut tomorrow at 3 for Ana', translationDe: 'Haarschnitt morgen um 3 für Ana',
    reply: 'Corte amanhã às 15:00 para Ana, o salão confirma em breve.', replyEn: 'Haircut tomorrow 15:00 for Ana.', replyDe: 'Haarschnitt morgen 15:00 für Ana.',
    needsOwner: false, reason: '',
    bookingRequest: { service: 'Haircut', date: '2026-11-17', time: '15:00', customerName: 'Ana' },
  };
  const incoming = { id: 'tg-1', waId: 'tg-42', name: 'Ana', text: 'Corte amanhã às 15h, sou a Ana', timestamp: 1, channel: 'Telegram' as const };
  const { conversation, reply } = recordAnalysis(state, incoming, analysis, new Date('2026-11-16T18:19:00Z'));
  assert.equal(conversation.status, 'needs-attention');
  assert.equal(conversation.bookingRequest?.status, 'requested');
  assert.equal(conversation.bookingRequest?.serviceId, 'srv-2');
  assert.match(conversation.attentionReason ?? '', /Haircut on Tuesday, 17\.11\.2026 at 15:00 for Ana/);
  assert.equal(reply?.original, analysis.reply);
  assert.equal(conversation.messages.length, 1, 'the AI reply is added only after the channel sent it');

  const html = renderToStaticMarkup(React.createElement(ConversationsView, {
    conversations: publicConversations(state),
    selectedId: 'live-tg-42',
    mobileDetailOpen: false,
    onBackToList: () => {},
    onSelect: () => {},
    onTakeOver: () => {},
    onLetAiContinue: () => null,
    onOwnerReply: () => true,
    aiSettings: initialAiSettings,
    onOpenAiSettings: () => {},
    // The owner's page checks the request against the salon's calendar (empty here) and answers it.
    salon: { services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: [], events: [], requests: [], timeZone: 'Europe/Zurich', now: new Date('2026-11-16T18:19:00Z') },
    onChatBooking: () => null,
    liveChannels: { telegram: 'slotbee_bella_bot', websiteChatUrl: 'https://example.test/?chat=chat-token' },
  }));
  assert.match(html, /Ana wants to book/);
  assert.match(html, />Confirm</);
  assert.match(html, /Suggest another time/);
  assert.match(html, />Decline</);
  assert.match(html, /via Telegram</);
  // The strip with the tester links is a study tool: a normal visitor does not get it.
  assert.doesNotMatch(html, /Live test is on/);
  assert.doesNotMatch(html, /@slotbee_bella_bot/);
});
