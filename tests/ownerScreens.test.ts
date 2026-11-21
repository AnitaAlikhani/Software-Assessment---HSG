import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { chatPhoneAfterCustomerEdit } from '../src/bookingData';
import { conversationTimeLabel, initialAiSettings } from '../src/conversationData';
import { initialEmployees } from '../src/mockData';
import { toPublicConversation, type LiveConversation } from '../server/whatsappCore';
import { ConversationsView } from '../src/views/ConversationsView';
import { EmployeesView } from '../src/views/EmployeesView';
import { demoConversations, FIXED_NOW } from './fixedClock';
import { readableText, render } from './renderHelpers';

const ZONE = 'Europe/Zurich';
const DAY = 24 * 60 * 60 * 1000;
const nothing = () => {};

test('the chat list works out its times when it is drawn, so they do not go stale overnight', () => {
  const chat = demoConversations.find(item => item.lastMessageAt && /^\d{2}:\d{2}$/.test(item.lastTime))!;
  assert.ok(chat, 'a sample chat written today');
  // On the day of the message: its clock time. The next morning: "Yesterday". A week later: the date.
  assert.equal(conversationTimeLabel(chat, FIXED_NOW, ZONE), chat.lastTime);
  assert.equal(conversationTimeLabel(chat, new Date(FIXED_NOW.getTime() + DAY), ZONE), 'Yesterday');
  assert.match(conversationTimeLabel(chat, new Date(FIXED_NOW.getTime() + 7 * DAY), ZONE), /^[A-Z][a-z]{2} \d{2}\.\d{2}\.$/);
  // A chat that carries no time keeps the label it was stored with.
  assert.equal(conversationTimeLabel({ lastTime: '09:15' }, new Date(FIXED_NOW.getTime() + DAY), ZONE), '09:15');

  // The screen uses it. Drawn a day later, no chat in the list still shows a bare clock time.
  const list = (now: Date) => {
    const html = render(React.createElement(ConversationsView, {
      conversations: demoConversations, selectedId: demoConversations[0].id, mobileDetailOpen: false,
      onBackToList: nothing, onSelect: nothing, onTakeOver: nothing, onLetAiContinue: () => null, onOwnerReply: () => true,
      aiSettings: initialAiSettings, onOpenAiSettings: nothing, timeZone: ZONE, now,
    }));
    return Array.from(html.matchAll(/<span class="text-\[11px\] text-slate-500 shrink-0">([^<]*)<\/span>/g), match => match[1]);
  };
  const today = list(FIXED_NOW);
  assert.equal(today.length, demoConversations.length);
  assert.ok(today.some(label => /^\d{2}:\d{2}$/.test(label)));
  const tomorrow = list(new Date(FIXED_NOW.getTime() + DAY));
  assert.equal(tomorrow.length, demoConversations.length);
  assert.ok(tomorrow.includes('Yesterday'));
  assert.deepEqual(tomorrow.filter(label => /^\d{2}:\d{2}$/.test(label)), []);
});

test('a live chat tells the list when its newest message was sent', () => {
  const sent = Date.parse('2026-10-04T16:20:00Z');
  const chat: LiveConversation = {
    waId: 'web-abcdefabcdef', channel: 'Website', customerName: 'Mara', language: 'DE', status: 'ai-handled', takenOver: false,
    messages: [{ id: 'm1', sender: 'customer', original: 'Hallo', translation: 'Hello', time: '18:20' }], updatedAt: sent,
  };
  const shown = toPublicConversation(chat);
  assert.equal(shown.lastMessageAt, '2026-10-04T16:20:00.000Z');
  // So the day after, the owner reads "Yesterday" instead of a clock time that looks like today's.
  assert.equal(conversationTimeLabel(shown, FIXED_NOW, ZONE), 'Yesterday');
});

test('a chat header follows the customer record when the owner changes or removes the number', () => {
  const before = { phone: '+41785552740' };
  assert.equal(chatPhoneAfterCustomerEdit('+41785552740', before, { phone: '+41795550101' }), '+41795550101');
  assert.equal(chatPhoneAfterCustomerEdit('+41785552740', before, { phone: '' }), '');
  // An edit that does not touch the number keeps what the chat itself knows.
  assert.equal(chatPhoneAfterCustomerEdit('+41 ••• ••• 67', { phone: '' }, { phone: '' }), '+41 ••• ••• 67');
  assert.equal(chatPhoneAfterCustomerEdit('+41785552740', before, before), '+41785552740');
});

test('the team list of a salon with one location shows no branch tab, no Location column and no branch choice', () => {
  const html = render(React.createElement(EmployeesView, {
    employees: initialEmployees, onAddEmployee: nothing, onUpdateEmployee: nothing, onDeleteEmployee: nothing, companyName: 'Bella Hair Salon',
  }));
  const text = readableText(html);
  assert.doesNotMatch(text, /Location|Branch/);
  // The salon's name is not repeated in every row.
  assert.doesNotMatch(text, /Bella Hair Salon/);
  for (const person of initialEmployees) assert.ok(text.includes(person.name), person.name);
  // No bin in the rows: a person is deleted in their own form, which asks first. The name opens that form.
  assert.doesNotMatch(html, /Delete/);
  for (const person of initialEmployees) assert.ok(html.includes(`aria-label="Edit ${person.name}"`), person.name);
});
