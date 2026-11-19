import assert from 'node:assert/strict';
import test from 'node:test';
import { answerText, type AnswerTextDetails } from '../src/customerTexts';
import type { ChatLanguage } from '../src/types';

// The ready texts the owner copies for a customer whose request she has answered. Nothing in the
// app passes the answer on, so these sentences are what the customer will read: every one is
// pinned here, in the four languages of the salon's customers.

const request = {
  customerName: 'Claudia Steiner', salonName: 'Bella Hair Salon', serviceName: 'Wash & blow-dry', staffName: 'Selina Keller',
  date: '2026-11-20', startTime: '09:30',
};
const accepted = (language: ChatLanguage, extra: Partial<AnswerTextDetails> = {}) => answerText({ ...request, language, outcome: 'accepted', ...extra } as AnswerTextDetails);
const rejected = (language: ChatLanguage) => answerText({ ...request, language, outcome: 'rejected' });
/** Asked for Friday 20 November at 09:30, offered Saturday 21 November at 11:00. */
const moved = (language: ChatLanguage) => answerText({ ...request, language, outcome: 'moved', date: '2026-11-21', startTime: '11:00', askedDate: '2026-11-20', askedStartTime: '09:30' });

test('an accepted request: the appointment is confirmed, with service, day, time and stylist', () => {
  assert.equal(accepted('EN'), 'Hello Claudia Steiner, your appointment at Bella Hair Salon is confirmed: Wash & blow-dry on Friday, 20.11.2026 at 09:30 with Selina Keller. See you then!');
  assert.equal(accepted('DE'), 'Guten Tag Claudia Steiner, Ihr Termin bei Bella Hair Salon ist bestätigt: Wash & blow-dry am Freitag, 20.11.2026 um 09:30 Uhr mit Selina Keller. Wir freuen uns auf Sie!');
  assert.equal(accepted('FR'), 'Bonjour Claudia Steiner, votre rendez-vous chez Bella Hair Salon est confirmé : Wash & blow-dry, le vendredi 20.11.2026 à 09:30 avec Selina Keller. À bientôt !');
  assert.equal(accepted('IT'), 'Buongiorno Claudia Steiner, il Suo appuntamento presso Bella Hair Salon è confermato: Wash & blow-dry, venerdì 20.11.2026 alle 09:30 con Selina Keller. A presto!');
});

test('a moved request: the time asked for is not possible, the new one is offered and asked about', () => {
  assert.equal(moved('EN'), 'Hello Claudia Steiner, thank you for your booking request at Bella Hair Salon. Unfortunately Friday, 20.11.2026 at 09:30 is not possible. We can offer you Wash & blow-dry on Saturday, 21.11.2026 at 11:00 with Selina Keller instead. Does that suit you?');
  assert.equal(moved('DE'), 'Guten Tag Claudia Steiner, vielen Dank für Ihre Terminanfrage bei Bella Hair Salon. Leider ist der Termin am Freitag, 20.11.2026 um 09:30 Uhr nicht möglich. Wir können Ihnen Wash & blow-dry am Samstag, 21.11.2026 um 11:00 Uhr mit Selina Keller anbieten. Passt Ihnen das?');
  assert.equal(moved('FR'), 'Bonjour Claudia Steiner, merci pour votre demande de rendez-vous chez Bella Hair Salon. Malheureusement, le rendez-vous du vendredi 20.11.2026 à 09:30 n\'est pas possible. Nous pouvons vous proposer Wash & blow-dry le samedi 21.11.2026 à 11:00 avec Selina Keller. Est-ce que cela vous convient ?');
  assert.equal(moved('IT'), 'Buongiorno Claudia Steiner, grazie per la Sua richiesta di appuntamento presso Bella Hair Salon. Purtroppo venerdì 20.11.2026 alle 09:30 non è possibile. Possiamo proporLe Wash & blow-dry sabato 21.11.2026 alle 11:00 con Selina Keller. Le va bene?');
  // A move is an offer, not a booking: every language asks, none confirms.
  for (const language of ['EN', 'DE', 'FR', 'IT'] as const) {
    assert.match(moved(language), /\?$/, language);
    assert.doesNotMatch(moved(language), /confirm|bestätigt|confermato/i, language);
  }
});

test('a rejected request: the time cannot be offered, and the customer is asked to get in touch', () => {
  assert.equal(rejected('EN'), 'Hello Claudia Steiner, thank you for your booking request at Bella Hair Salon. Unfortunately we cannot offer you Wash & blow-dry on Friday, 20.11.2026 at 09:30. Please get in touch to find another time.');
  assert.equal(rejected('DE'), 'Guten Tag Claudia Steiner, vielen Dank für Ihre Terminanfrage bei Bella Hair Salon. Leider können wir Ihnen Wash & blow-dry am Freitag, 20.11.2026 um 09:30 Uhr nicht anbieten. Bitte melden Sie sich, damit wir einen anderen Termin finden.');
  assert.equal(rejected('FR'), 'Bonjour Claudia Steiner, merci pour votre demande de rendez-vous chez Bella Hair Salon. Malheureusement, nous ne pouvons pas vous proposer Wash & blow-dry le vendredi 20.11.2026 à 09:30. N\'hésitez pas à nous contacter pour trouver une autre date.');
  assert.equal(rejected('IT'), 'Buongiorno Claudia Steiner, grazie per la Sua richiesta di appuntamento presso Bella Hair Salon. Purtroppo non possiamo offrirLe Wash & blow-dry venerdì 20.11.2026 alle 09:30. Ci contatti pure per trovare un\'altra data.');
});

test('dates and times are written as on every screen, with the weekday in the text\'s own language', () => {
  // One week, Monday to Sunday: every weekday in every language, and the same numbers everywhere.
  const week = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
  const names: Record<ChatLanguage, string[]> = {
    EN: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    DE: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
    FR: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
    IT: ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'],
  };
  for (const language of ['EN', 'DE', 'FR', 'IT'] as const) {
    week.forEach((date, index) => {
      const text = accepted(language, { date });
      const day = `${date.slice(8)}.11.2026`;
      assert.ok(text.includes(language === 'EN' || language === 'DE' ? `${names[language][index]}, ${day}` : `${names[language][index]} ${day}`), `${language} ${date}: ${text}`);
      // No weekday of another language slips in, and the date is never the stored form.
      for (const other of ['EN', 'DE', 'FR', 'IT'] as const) {
        if (other !== language) assert.ok(!names[other].some((name) => new RegExp(`\\b${name}\\b`).test(text)), `${language} ${date}: ${text}`);
      }
      assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}/);
      assert.match(text, /\b09:30\b/);
    });
  }
});

test('what is not known is left out instead of leaving a gap', () => {
  // A salon without a name, a request without a stylist.
  assert.equal(accepted('EN', { salonName: '  ', staffName: undefined }), 'Hello Claudia Steiner, your appointment is confirmed: Wash & blow-dry on Friday, 20.11.2026 at 09:30. See you then!');
  assert.equal(accepted('DE', { salonName: '', staffName: '' }), 'Guten Tag Claudia Steiner, Ihr Termin ist bestätigt: Wash & blow-dry am Freitag, 20.11.2026 um 09:30 Uhr. Wir freuen uns auf Sie!');
  for (const language of ['EN', 'DE', 'FR', 'IT'] as const) {
    for (const text of [accepted(language, { salonName: '', staffName: '' }), accepted(language), moved(language), rejected(language)]) {
      assert.doesNotMatch(text, / {2}| [.,!?]|undefined|null/, `${language}: ${text}`);
    }
  }
  // A record with a language the texts do not have is answered in English, never with an error.
  assert.equal(accepted('ES' as ChatLanguage), accepted('EN'));
  // Something that is no date is passed through as it is, without an invented weekday.
  assert.match(accepted('FR', { date: 'vendredi prochain' }), /le vendredi prochain à 09:30/);
});

test('no text claims more than the owner has done', () => {
  for (const language of ['EN', 'DE', 'FR', 'IT'] as const) {
    // Only an accepted request is called confirmed.
    assert.match(accepted(language), /confirmed|bestätigt|confirmé|confermato/);
    assert.doesNotMatch(rejected(language), /confirmed|bestätigt|confirmé|confermato/);
    // The salon is named, so a text from the owner's own phone says who it is from.
    for (const text of [accepted(language), moved(language), rejected(language)]) assert.ok(text.includes('Bella Hair Salon'), text);
  }
  // German follows the Swiss spelling: no ß.
  for (const text of [accepted('DE'), moved('DE'), rejected('DE')]) assert.doesNotMatch(text, /ß/);
});
