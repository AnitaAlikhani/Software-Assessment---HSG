/**
 * A complete booking request or change request that the server accepts and stores for the owner
 * is answered with the server's fixed sentence, never with the AI's own words: the AI has written
 * "I have entered your appointment" although only a request was stored. The sentence names what
 * was passed on and says that nothing is booked yet. A question still gets the AI's text.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as writeChat } from '../api/chat';
import { POST as telegramWebhook } from '../api/telegram/webhook';
import { chatBookingMessage } from '../src/chatTemplates';
import type { ChatLanguage } from '../src/types';
import { deployedWith, FakeStore } from './fakeStore';
import {
  aiAnswer, bookingAnswer, chatRequest, freezeClock, liveChat, NOW, outsideWorld, putChat, quietly, SESSION, SETTINGS, storedChat, telegramUpdate,
} from './liveChatHarness';

const WEB = `web-${SESSION}`;
/** What a model wrote on the live site: a promise the server has not kept. */
const PROMISE = 'Perfect, your appointment is booked and entered in the calendar!';
const promising = { reply: PROMISE, replyEn: PROMISE, replyDe: 'Perfekt, Ihr Termin ist gebucht und eingetragen!' };
const CODES: Record<ChatLanguage, string> = { EN: 'en', DE: 'de', FR: 'fr', IT: 'it' };
const NAMES: Record<ChatLanguage, string> = { EN: 'English', DE: 'German', FR: 'French', IT: 'Italian' };

type Body = { messages: { from: string; text: string }[] };
const send = async (store: FakeStore, ai: Record<string, unknown>, text: string) => {
  let body: Body = { messages: [] };
  await quietly(() => deployedWith(SETTINGS, async () => {
    body = (await (await writeChat(chatRequest('POST', { body: { session: SESSION, name: 'Eva', text } }))).json()) as Body;
  }, { store, outside: outsideWorld({ ai }).outside }));
  return body;
};
const lastFromSalon = (body: Body) => body.messages.filter(message => message.from === 'salon').at(-1)?.text;

const EXPECTED_NEW: Record<ChatLanguage, string> = {
  EN: 'Thank you, Eva. I have passed your request on to the salon: Haircut on Tuesday, 06.10.2026 at 10:00 with Selina Keller. The salon will answer you here in the chat; until then nothing is booked.',
  DE: 'Vielen Dank, Eva. Ich habe Ihre Anfrage an den Salon weitergegeben: Haircut am Dienstag, 06.10.2026 um 10:00 Uhr mit Selina Keller. Der Salon antwortet Ihnen hier im Chat; bis dahin ist noch nichts gebucht.',
  FR: 'Merci, Eva. J\'ai transmis votre demande au salon : Haircut le mardi 06.10.2026 à 10:00 avec Selina Keller. Le salon vous répondra ici dans le chat ; d\'ici là, rien n\'est réservé.',
  IT: 'Grazie, Eva. Ho inoltrato la Sua richiesta al salone: Haircut martedì 06.10.2026 alle 10:00 con Selina Keller. Il salone Le risponderà qui nella chat; fino ad allora non è ancora stato prenotato nulla.',
};

const EXPECTED_CHANGE: Record<ChatLanguage, string> = {
  EN: 'Thank you, Eva. I have passed on to the salon your wish to move your appointment to Friday, 09.10.2026 at 15:00. Your appointment on Tuesday, 06.10.2026 at 10:00 stays as it is until the salon answers you here in the chat.',
  DE: 'Vielen Dank, Eva. Ich habe Ihren Wunsch, den Termin auf Freitag, den 09.10.2026 um 15:00 Uhr zu verschieben, an den Salon weitergegeben. Ihr Termin am Dienstag, 06.10.2026 um 10:00 Uhr bleibt bestehen, bis der Salon Ihnen hier im Chat antwortet.',
  FR: 'Merci, Eva. J\'ai transmis au salon votre souhait de déplacer votre rendez-vous au vendredi 09.10.2026 à 15:00. Votre rendez-vous du mardi 06.10.2026 à 10:00 reste valable jusqu\'à ce que le salon vous réponde ici dans le chat.',
  IT: 'Grazie, Eva. Ho inoltrato al salone il Suo desiderio di spostare l\'appuntamento a venerdì 09.10.2026 alle 15:00. Il Suo appuntamento di martedì 06.10.2026 alle 10:00 resta valido finché il salone non Le risponde qui nella chat.',
};

for (const language of ['EN', 'DE', 'FR', 'IT'] as ChatLanguage[]) {
  test(`${language}: an accepted new request gets the fixed sentence with service, day, time and stylist, never the AI's promise`, async (t) => {
    freezeClock(t);
    const store = new FakeStore(NOW);
    putChat(store, liveChat({ language, languageSettled: true }));
    const body = await send(store, bookingAnswer({ staffName: 'Selina' }, { ...promising, languageCode: CODES[language], languageName: NAMES[language] }), 'Haircut Tuesday 10:00 with Selina, I am Eva');
    assert.equal(lastFromSalon(body), EXPECTED_NEW[language]);
    assert.ok(body.messages.every(message => !message.text.includes('booked and entered')));
    const chat = storedChat(store, WEB)!;
    assert.equal(chat.bookingRequest?.status, 'requested');
    // The owner's screen gets the same sentence in English and German.
    const stored = chat.messages.at(-1)!;
    assert.equal(stored.translation, EXPECTED_NEW.EN);
    assert.equal(stored.translationDe, EXPECTED_NEW.DE);
    assert.deepEqual({ original: stored.original, translation: stored.translation, translationDe: stored.translationDe },
      chatBookingMessage('requested', { language, customerName: 'Eva', salonName: 'Bella Hair Salon', serviceName: 'Haircut', staffName: 'Selina Keller', date: '2026-10-06', time: '10:00' }));
  });

  test(`${language}: an accepted change gets the fixed sentence with the new and the old time, never the AI's promise`, async (t) => {
    freezeClock(t);
    const store = new FakeStore(NOW);
    const confirmed = { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-06', time: '10:00', customerName: 'Eva', status: 'confirmed' as const, kind: 'new' as const };
    putChat(store, liveChat({ language, languageSettled: true, status: 'booked', bookingRequest: confirmed, confirmedBooking: confirmed }));
    const body = await send(store, bookingAnswer({ date: '2026-10-09', time: '15:00' }, { ...promising, intent: 'change', languageCode: CODES[language], languageName: NAMES[language] }), 'Can we move it to Friday 15:00?');
    assert.equal(lastFromSalon(body), EXPECTED_CHANGE[language]);
    const chat = storedChat(store, WEB)!;
    assert.deepEqual([chat.bookingRequest?.kind, chat.bookingRequest?.previous], ['change', { date: '2026-10-06', time: '10:00' }]);
    assert.equal(chat.confirmedBooking?.date, '2026-10-06');
  });
}

test('the texts use the polite address and the Swiss spelling', () => {
  for (const text of [EXPECTED_NEW.DE, EXPECTED_CHANGE.DE]) { assert.doesNotMatch(text, /ß|\bdu\b|\bdein/i); assert.match(text, /Ihr/); }
  assert.match(EXPECTED_NEW.FR, /votre/);
  assert.match(EXPECTED_NEW.IT, /Sua/);
  // A request without a stylist names none.
  const plain = chatBookingMessage('requested', { language: 'EN', customerName: 'Eva', salonName: 'Bella Hair Salon', serviceName: 'Colouring', date: '2026-10-07', time: '14:00' });
  assert.equal(plain.original, 'Thank you, Eva. I have passed your request on to the salon: Colouring on Wednesday, 07.10.2026 at 14:00. The salon will answer you here in the chat; until then nothing is booked.');
});

test('Telegram: an accepted request sends the fixed sentence; a question still gets the AI\'s own text', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld({ ai: call => call === 1 ? bookingAnswer({}, promising) : aiAnswer({ intent: 'question', reply: 'We are open until 18:30.' }) });
  await quietly(() => deployedWith(SETTINGS, async () => {
    await telegramWebhook(telegramUpdate('Haircut Tuesday 10:00, I am Eva'));
    await telegramWebhook(telegramUpdate('Until when are you open?'));
  }, { store, outside: world.outside }));
  assert.deepEqual(world.sent.map(message => message.text), [
    'Thank you, Eva. I have passed your request on to the salon: Haircut on Tuesday, 06.10.2026 at 10:00. The salon will answer you here in the chat; until then nothing is booked.',
    'We are open until 18:30.',
  ]);
});

test('a website question, and a request that is not complete yet, still get the AI\'s own text', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putChat(store, liveChat());
  assert.equal(lastFromSalon(await send(store, aiAnswer({ intent: 'question', reply: 'A haircut is CHF 55.' }), 'How much?')), 'A haircut is CHF 55.');
  const missing = bookingAnswer({ customerName: '' }, { reply: 'Which name may I note?' });
  assert.equal(lastFromSalon(await send(store, missing, 'Haircut Tuesday 10:00')), 'Which name may I note?');
  assert.equal(storedChat(store, WEB)!.bookingRequest, undefined);
});
