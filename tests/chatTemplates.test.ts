import assert from 'node:assert/strict';
import test from 'node:test';
import { chatBookingMessage, type ChatBookingMessageDetails } from '../src/chatTemplates';
import type { ChatLanguage } from '../src/types';

// The fixed messages a customer gets in a chat about their booking. Friday 20 November 2026.
const details = (language: ChatLanguage, more: Partial<ChatBookingMessageDetails> = {}): ChatBookingMessageDetails => ({
  language, customerName: 'Lena', salonName: 'Bella Hair Salon', serviceName: 'Haircut', staffName: 'Selina Keller', date: '2026-11-20', time: '15:00', ...more,
});

test('a confirmation names the service, the day, the time and the stylist, in the customer\'s language', () => {
  assert.equal(chatBookingMessage('confirmed', details('DE')).original,
    'Guten Tag Lena, Ihr Termin bei Bella Hair Salon ist bestätigt: Haircut am Freitag, 20.11.2026 um 15:00 Uhr mit Selina Keller. Wir freuen uns auf Sie!');
  assert.match(chatBookingMessage('confirmed', details('FR')).original, /^Bonjour Lena, votre rendez-vous chez Bella Hair Salon est confirmé/);
  assert.match(chatBookingMessage('confirmed', details('IT')).original, /^Buongiorno Lena, il Suo appuntamento presso Bella Hair Salon è confermato/);
  assert.equal(chatBookingMessage('confirmed', details('EN')).original,
    'Hello Lena, your appointment at Bella Hair Salon is confirmed: Haircut on Friday, 20.11.2026 at 15:00 with Selina Keller. See you then!');
  // Nobody named: the sentence has no stylist, and no loose word where one would stand.
  assert.equal(chatBookingMessage('confirmed', details('EN', { staffName: undefined })).original,
    'Hello Lena, your appointment at Bella Hair Salon is confirmed: Haircut on Friday, 20.11.2026 at 15:00. See you then!');
});

test('the owner reads the same message in English and in German, whatever the customer\'s language', () => {
  const french = chatBookingMessage('confirmed', details('FR'));
  assert.equal(french.translation, chatBookingMessage('confirmed', details('EN')).original);
  assert.equal(french.translationDe, chatBookingMessage('confirmed', details('DE')).original);
  // A language the texts do not have: the customer gets the English one.
  assert.equal(chatBookingMessage('declined', details('ES' as ChatLanguage)).original, chatBookingMessage('declined', details('EN')).original);
});

test('a suggestion names the time asked for and the time offered, and asks', () => {
  const suggested = chatBookingMessage('suggested', details('DE', { date: '2026-11-21', time: '10:00', askedDate: '2026-11-20', askedTime: '15:00' })).original;
  assert.match(suggested, /Leider ist der Termin am Freitag, 20\.11\.2026 um 15:00 Uhr nicht möglich\./);
  assert.match(suggested, /Wir können Ihnen Haircut am Samstag, 21\.11\.2026 um 10:00 Uhr mit Selina Keller anbieten\. Passt Ihnen das\?$/);
});

test('declined and cancelled say so plainly and promise nothing', () => {
  const declined = chatBookingMessage('declined', details('EN')).original;
  assert.match(declined, /Unfortunately we cannot offer you Haircut on Friday, 20\.11\.2026 at 15:00\./);
  const cancelled = chatBookingMessage('cancelled', details('EN'));
  assert.equal(cancelled.original, 'Hello Lena, your appointment at Bella Hair Salon on Friday, 20.11.2026 at 15:00 is cancelled. Get in touch whenever you would like a new one.');
  assert.equal(cancelled.translationDe, 'Guten Tag Lena, Ihr Termin bei Bella Hair Salon am Freitag, 20.11.2026 um 15:00 Uhr ist abgesagt. Melden Sie sich gern, wenn Sie einen neuen Termin möchten.');
  assert.match(chatBookingMessage('cancelled', details('FR')).original, /votre rendez-vous chez Bella Hair Salon du vendredi 20\.11\.2026 à 15:00 est annulé/);
  assert.match(chatBookingMessage('cancelled', details('IT')).original, /il Suo appuntamento presso Bella Hair Salon di venerdì 20\.11\.2026 alle 15:00 è annullato/);
  for (const kind of ['confirmed', 'suggested', 'declined', 'cancelled'] as const) {
    assert.doesNotMatch(chatBookingMessage(kind, details('EN')).original, /\b(reminder|we will (call|write|remind)|shortly|soon)\b/i, kind);
  }
});
