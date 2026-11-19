import assert from 'node:assert/strict';
import test from 'node:test';
import { interpret, read, type InterpreterContext } from '../src/assistant/interpret';
import type { AssistantRequest } from '../src/assistant/types';
import { BLOW_DRY, COLOURING, FRIDAY, HAIRCUT, LUCA, SATURDAY, SELINA, THURSDAY, TODAY, TUESDAY, WEDNESDAY, words } from './assistantFixture';

/**
 * The built-in interpreter, phrase by phrase. "Today" is Monday 5 October 2026 for every case:
 * the interpreter gets its date as an argument and never reads a clock.
 */
type Case = [message: string, expected: AssistantRequest];

const check = (cases: Case[], context: Partial<InterpreterContext> = {}) => {
  for (const [message, expected] of cases) {
    assert.deepEqual(interpret(message, words(context)), expected, message);
  }
};
const cut = HAIRCUT.id;
const colour = COLOURING.id;

test('questions about free times, in English and German', () => {
  check([
    ['Is Thursday at 15:00 free?', { language: 'en', intent: 'availability', date: THURSDAY, time: '15:00' }],
    ['Do you have anything on Friday for a haircut?', { language: 'en', intent: 'availability', date: FRIDAY, serviceId: cut }],
    ['Next free time for colouring?', { language: 'en', intent: 'availability', serviceId: colour }],
    ['Hast du am Freitag um 15 Uhr etwas frei?', { language: 'de', intent: 'availability', date: FRIDAY, time: '15:00' }],
    ['Is there a slot for a cut on Wed at 4?', { language: 'en', intent: 'availability', date: WEDNESDAY, time: '16:00', serviceId: cut }],
    ['Anything free tomorrow afternoon for a haircut?', { language: 'en', intent: 'availability', date: TUESDAY, partOfDay: 'afternoon', serviceId: cut }],
    ['Do you have anything next week for colouring?', { language: 'en', intent: 'availability', fromDate: '2026-10-12', serviceId: colour }],
    ['Is 3pm free?', { language: 'en', intent: 'availability', time: '15:00' }],
    ['Geht Freitag Morgen ein Haarschnitt?', { language: 'de', intent: 'availability', date: FRIDAY, partOfDay: 'morning', serviceId: cut }],
    ['Heute Abend noch etwas frei für einen Haarschnitt?', { language: 'de', intent: 'availability', date: TODAY, partOfDay: 'evening', serviceId: cut }],
    ['Wann hat Luca Frei Zeit für einen Haarschnitt?', { language: 'de', intent: 'availability', serviceId: cut, employeeId: LUCA.id }],
    ['Is Selina free on Friday at 3?', { language: 'en', intent: 'availability', date: FRIDAY, time: '15:00', employeeId: SELINA.id }],
    ['When can Lea Brunner come for a colouring?', { language: 'en', intent: 'availability', serviceId: colour, customerName: 'Lea Brunner' }],
    ['Do we have room for a colouring tomorrow morning?', { language: 'en', intent: 'availability', date: TUESDAY, partOfDay: 'morning', serviceId: colour }],
    ['Can Selina do a haircut at half past four today?', { language: 'en', intent: 'availability', date: TODAY, time: '16:30', serviceId: cut, employeeId: SELINA.id }],
    ['Kann ich morgen um 14 Uhr noch jemanden für einen Haarschnitt nehmen?', { language: 'de', intent: 'availability', date: TUESDAY, time: '14:00', serviceId: cut }],
    ['Wann ist der nächste freie Termin für Färben?', { language: 'de', intent: 'availability', serviceId: colour }],
  ]);
});

test('requests to book, in English and German', () => {
  const booking = { intent: 'book' as const, date: TUESDAY, time: '10:00', serviceId: cut, customerName: 'Lea Brunner' };
  check([
    ['Book Lea Brunner for a haircut on Tuesday at 10', { language: 'en', ...booking }],
    ['Book Lea Brunner for a haircut on Tuesday at 10 with Selina', { language: 'en', ...booking, employeeId: SELINA.id }],
    ['Trag Lea Brunner am Dienstag um 10 Uhr für einen Haarschnitt ein', { language: 'de', ...booking }],
    ['Can you book Lea Brunner for a haircut on Tuesday at 10?', { language: 'en', ...booking }],
    ['Kannst du Lea Brunner am Dienstag um 10 Uhr für einen Haarschnitt eintragen?', { language: 'de', ...booking }],
    ['book lea brunner haircut tuesday 10', { language: 'en', ...booking }],
    ['Neuer Termin für Lea Brunner am Dienstag um 10 Uhr, Haarschnitt', { language: 'de', ...booking }],
    ['book a haircut for Lea Brunner on 6 October at 10am', { language: 'en', ...booking }],
    ['add a booking for Mia Keller on 24.11. at 3pm, colouring', { language: 'en', intent: 'book', date: '2026-11-24', time: '15:00', serviceId: colour, customerName: 'Mia Keller' }],
    ['Mach einen Termin für Marco Bianchi am 7.10. um 11:30 bei Luca', { language: 'de', intent: 'book', date: WEDNESDAY, time: '11:30', employeeId: LUCA.id, customerName: 'Marco Bianchi' }],
    ['I need an appointment for Lea Brunner on Friday at 2', { language: 'en', intent: 'book', date: FRIDAY, time: '14:00', customerName: 'Lea Brunner' }],
    ['Bitte Lea Brunner morgen um 9 Uhr zum Färben eintragen', { language: 'de', intent: 'book', date: TUESDAY, time: '09:00', serviceId: colour, customerName: 'Lea Brunner' }],
    ['Book a haircut', { language: 'en', intent: 'book', serviceId: cut }],
    ['add a booking for Mia Keller on 12.10. at 14:30 for a haircut with Luca', { language: 'en', intent: 'book', date: '2026-10-12', time: '14:30', serviceId: cut, employeeId: LUCA.id, customerName: 'Mia Keller' }],
    ['Neue Buchung für Mia Keller am Freitag um 10 Uhr', { language: 'de', intent: 'book', date: FRIDAY, time: '10:00', customerName: 'Mia Keller' }],
  ]);
});

test('cancellations', () => {
  check([
    ["Cancel Lea Brunner's appointment on Tuesday.", { language: 'en', intent: 'cancel', date: TUESDAY, customerName: 'Lea Brunner' }],
    ['Storniere den Termin von Lea Brunner am Dienstag', { language: 'de', intent: 'cancel', date: TUESDAY, customerName: 'Lea Brunner' }],
    ['Sag den Termin von Marco Bianchi morgen ab', { language: 'de', intent: 'cancel', date: TUESDAY, customerName: 'Marco Bianchi' }],
    ['Cancel the appointment at 10 tomorrow', { language: 'en', intent: 'cancel', date: TUESDAY, time: '10:00' }],
    ["Please delete Tom Graf's appointment", { language: 'en', intent: 'cancel', customerName: 'Tom Graf' }],
  ]);
});

test('closing a day and opening it again', () => {
  check([
    ['Close Friday', { language: 'en', intent: 'close', date: FRIDAY }],
    ['We are closed on 24 December', { language: 'en', intent: 'close', date: '2026-12-24' }],
    ['Am Freitag geschlossen', { language: 'de', intent: 'close', date: FRIDAY }],
    ['make friday closed this week', { language: 'en', intent: 'close', date: FRIDAY }],
    ['Freitag ist zu', { language: 'de', intent: 'close', date: FRIDAY }],
    ['Schliesse den Salon am 24.12.', { language: 'de', intent: 'close', date: '2026-12-24' }],
    ['Wir haben vom 24. bis 26. Dezember geschlossen', { language: 'de', intent: 'close', date: '2026-12-24', endDate: '2026-12-26' }],
    ['Closed from 24 December to 2 January', { language: 'en', intent: 'close', date: '2026-12-24', endDate: '2027-01-02' }],
    ['Close the salon from Monday to Wednesday next week', { language: 'en', intent: 'close', date: '2026-10-12', endDate: '2026-10-14' }],
    ['Wir haben von Donnerstag bis Dienstag geschlossen', { language: 'de', intent: 'close', date: THURSDAY, endDate: '2026-10-13' }],
    ['Geschlossen vom 24.-26.12.', { language: 'de', intent: 'close', date: '2026-12-24', endDate: '2026-12-26' }],
    ['Am 24. und 25. Dezember ist geschlossen', { language: 'de', intent: 'close', date: '2026-12-24', endDate: '2026-12-25' }],
    ['We are on holiday from 21 December until 3 January', { language: 'en', intent: 'close', date: '2026-12-21', endDate: '2027-01-03' }],
    ['Mach den Samstag zu', { language: 'de', intent: 'close', date: SATURDAY }],
    ['Open Friday again', { language: 'en', intent: 'reopen', date: FRIDAY }],
    ['Freitag wieder öffnen', { language: 'de', intent: 'reopen', date: FRIDAY }],
    ['Am Freitag doch geöffnet', { language: 'de', intent: 'reopen', date: FRIDAY }],
    ['Remove the closure on Friday', { language: 'en', intent: 'reopen', date: FRIDAY }],
  ]);
});

test('the agenda', () => {
  check([
    ["What's on today?", { language: 'en', intent: 'agenda', date: TODAY }],
    ['Who is next?', { language: 'en', intent: 'agenda', scope: 'next' }],
    ['Appointments tomorrow?', { language: 'en', intent: 'agenda', date: TUESDAY }],
    ['Was steht morgen an?', { language: 'de', intent: 'agenda', date: TUESDAY }],
    ['Wer kommt als Nächstes?', { language: 'de', intent: 'agenda', scope: 'next' }],
    ['Termine am 2026-11-24', { language: 'de', intent: 'agenda', date: '2026-11-24' }],
    ["what's my schedule tomorrow", { language: 'en', intent: 'agenda', date: TUESDAY }],
    ['Was hat Luca Frei heute?', { language: 'de', intent: 'agenda', date: TODAY, employeeId: LUCA.id }],
    ['Who booked the 10:00 slot tomorrow?', { language: 'en', intent: 'agenda', date: TUESDAY, time: '10:00' }],
    ['Show me Friday', { language: 'en', intent: 'agenda', date: FRIDAY }],
    ['How does tomorrow look?', { language: 'en', intent: 'agenda', date: TUESDAY }],
    ['What is Selina doing on Friday?', { language: 'en', intent: 'agenda', date: FRIDAY, employeeId: SELINA.id }],
    ['Welche Termine haben wir morgen?', { language: 'de', intent: 'agenda', date: TUESDAY }],
  ]);
});

test('days are worked out from the "today" that is passed in', () => {
  const day = (message: string) => interpret(message, words()).date;
  const expected: [string, string][] = [
    ['today', TODAY], ['heute', TODAY], ['tomorrow', TUESDAY], ['morgen', TUESDAY],
    ['the day after tomorrow', WEDNESDAY], ['übermorgen', WEDNESDAY],
    ['on Thursday', THURSDAY], ['am Donnerstag', THURSDAY], ['Sat', SATURDAY],
    // Today is a Monday: a bare "Monday" is the next one, "this Monday" is today.
    ['Monday', '2026-10-12'], ['this Monday', TODAY],
    ['this Friday', FRIDAY], ['Friday this week', FRIDAY], ['diesen Freitag', FRIDAY],
    // English "next Friday" is the Friday of next week; German "nächsten Freitag" the next one to come.
    ['next Friday', '2026-10-16'], ['Friday next week', '2026-10-16'], ['Freitag nächste Woche', '2026-10-16'],
    ['nächsten Freitag', FRIDAY], ['kommenden Freitag', FRIDAY], ['übernächsten Freitag', '2026-10-16'],
    ['24.11.', '2026-11-24'], ['24.11.2026', '2026-11-24'], ['24/11', '2026-11-24'], ['2026-11-24', '2026-11-24'],
    ['24 November', '2026-11-24'], ['24. November', '2026-11-24'], ['24th of November', '2026-11-24'], ['November 24th', '2026-11-24'],
    // A date without a year that has passed means next year.
    ['1.10.', '2027-10-01'], ['5 January', '2027-01-05'], ['am 3. Januar', '2027-01-03'],
    ['in 3 days', THURSDAY], ['in zwei Wochen', '2026-10-19'], ['in a week', '2026-10-12'],
    ['the 24th', '2026-10-24'],
    // Past days are read too: the agenda can show them, a booking there is refused by the rules.
    ['yesterday', '2026-10-04'], ['gestern', '2026-10-04'], ['vorgestern', '2026-10-03'],
  ];
  for (const [message, date] of expected) assert.equal(day(message), date, message);
  // The same words on another day give another date: nothing comes from the real clock.
  assert.equal(interpret('tomorrow', words({ today: '2027-02-28' })).date, '2027-03-01');
  assert.equal(interpret('Friday', words({ today: FRIDAY })).date, '2026-10-16');
  // A calendar date wins over the weekday written beside it (which alone would be the coming Friday).
  assert.equal(day('Friday 27 November'), '2026-11-27');
  assert.equal(day('am Freitag, 27.11.'), '2026-11-27');
  assert.equal(day('Friday the 16th'), '2026-10-16');
  // A date that does not exist is not a date.
  assert.equal(day('31.02.'), undefined);
  assert.equal(day('2026-13-45'), undefined);
});

test('times, as people write them', () => {
  const time = (message: string) => interpret(message, words()).time;
  const expected: [string, string][] = [
    ['at 15:00', '15:00'], ['3pm', '15:00'], ['3 pm', '15:00'], ['at 3', '15:00'], ['um 15 Uhr', '15:00'],
    ['um 3', '15:00'], ['halb drei', '14:30'], ['half past two', '14:30'], ['quarter to three', '14:45'],
    ['viertel nach drei', '15:15'], ['viertel vor zehn', '09:45'], ['at 9:30 am', '09:30'], ['10am', '10:00'],
    ['um 15.30 Uhr', '15:30'], ['15 Uhr 30', '15:30'], ["10 o'clock", '10:00'], ['at noon', '12:00'], ['at 10', '10:00'],
    ['um zehn', '10:00'], ['at 08:00', '08:00'], ['@ 11', '11:00'], ['at 8 in the evening', '20:00'], ['um 8 Uhr abends', '20:00'],
  ];
  for (const [message, clock] of expected) assert.equal(time(message), clock, message);
  // "am" after a number is a.m. in English but a preposition in German.
  assert.deepEqual(interpret('um 3 am Freitag frei für einen Haarschnitt?', words()),
    { language: 'de', intent: 'availability', date: FRIDAY, time: '15:00', serviceId: cut });
  // A date is not read as a time, and a time is not read as a date.
  assert.deepEqual(interpret('10.11. um 10 Uhr Haarschnitt frei?', words()),
    { language: 'de', intent: 'availability', date: '2026-11-10', time: '10:00', serviceId: cut });
  assert.deepEqual(interpret('Is Friday free at 9.30 for a haircut?', words()),
    { language: 'en', intent: 'availability', date: FRIDAY, time: '09:30', serviceId: cut });
});

test('services by their own name and by everyday words', () => {
  const service = (message: string) => interpret(message, words()).serviceId;
  for (const message of ['Haircut', 'a haircut', 'hair cut', 'Haarschnitt', 'Haare schneiden', 'cut', 'trim']) {
    assert.equal(service(message), cut, message);
  }
  for (const message of ['Colouring', 'coloring', 'colour', 'Färben', 'färben', 'hair dye']) {
    assert.equal(service(message), colour, message);
  }
  for (const message of ['wash and blow dry', 'Wash & blow-dry', 'blow-dry', 'föhnen']) {
    assert.equal(service(message), BLOW_DRY.id, message);
  }
  assert.equal(service('a massage'), undefined);

  // Several services fit the word: the owner has to pick, the interpreter does not guess.
  const menu = [
    { id: 'women', name: "Women's cut & blow-dry", category: 'Cut' },
    { id: 'men', name: "Men's cut", category: 'Cut' },
    { id: 'kids', name: "Children's cut", category: 'Cut' },
    { id: 'roots', name: 'Root colour', category: 'Colour' },
  ];
  const pick = (message: string) => {
    const { serviceId, serviceOptions } = interpret(message, words({ services: menu }));
    return serviceId ?? serviceOptions;
  };
  assert.deepEqual(pick('Is Friday free for a haircut?'), ['women', 'men', 'kids']);
  assert.equal(pick('Is Friday free for a Herrenschnitt?'), 'men');
  assert.equal(pick('Is Friday free for a kids cut?'), 'kids');
  assert.equal(pick("Is Friday free for a men's cut?"), 'men');
  assert.equal(pick('Is Friday free for a cut and blow-dry?'), 'women');
  assert.equal(pick('Ist am Freitag etwas frei zum Färben?'), 'roots');
});

test('people: stylists, known customers and new names', () => {
  const read = (message: string, context: Partial<InterpreterContext> = {}) => {
    const { customerName, employeeId } = interpret(message, words(context));
    return { customerName, employeeId };
  };
  assert.deepEqual(read('Book Lea Brunner with Luca on Friday at 9'), { customerName: 'Lea Brunner', employeeId: LUCA.id });
  assert.deepEqual(read('Trag Lea Brunner am Freitag um 9 bei Selina Keller ein'), { customerName: 'Lea Brunner', employeeId: SELINA.id });
  // A stylist's first name in the customer's place is a customer.
  assert.deepEqual(read('Book Selina Graf for a haircut tomorrow at 2pm'), { customerName: 'Selina Graf', employeeId: undefined });
  assert.deepEqual(read('Book Sandra Keller for a colouring on Wednesday at 9'), { customerName: 'Sandra Keller', employeeId: undefined });
  // The customer list is matched without regard to capitals and accents, and gives back its own spelling.
  assert.deepEqual(read('book lea girard for a haircut on friday at 9'), { customerName: 'Léa Girard', employeeId: undefined });
  assert.deepEqual(read('Book Lea von Arx for a haircut on Friday at 10 am'), { customerName: 'Lea von Arx', employeeId: undefined });
  assert.deepEqual(read('book mia keller for a haircut on friday at 10'), { customerName: 'Mia Keller', employeeId: undefined });
  // "Frei" is Luca's family name and the German word for free.
  assert.deepEqual(read('Hast du am Freitag um 15 Uhr etwas frei?'), { customerName: undefined, employeeId: undefined });
  assert.deepEqual(read('Hat Frei am Freitag Zeit?'), { customerName: undefined, employeeId: LUCA.id });
});

test('sentences that must not be understood as a booking, cancellation or closure', () => {
  const nothing: [string, AssistantRequest][] = [
    ['How many bookings do we have this week?', { language: 'en', fromDate: TODAY }],
    ["Don't book anything on Friday", { language: 'en', date: FRIDAY }],
    ['Is Lea Brunner booked in for Tuesday?', { language: 'en', date: TUESDAY, customerName: 'Lea Brunner' }],
    ['Lea Brunner hat schon gebucht', { language: 'de', customerName: 'Lea Brunner' }],
    ['Can customers book online?', { language: 'en' }],
    ['What does a haircut cost?', { language: 'en', serviceId: cut }],
    ['I read a book about colouring', { language: 'en', serviceId: colour }],
    ['Bitte nicht buchen', { language: 'de' }],
    ['Trag Lea Brunner nicht ein', { language: 'de', customerName: 'Lea Brunner' }],
    ['Are we closed on 24 December?', { language: 'en', date: '2026-12-24' }],
    ['What time do we close on Friday?', { language: 'en', date: FRIDAY }],
    ['Am Freitag nicht geschlossen', { language: 'de', date: FRIDAY }],
    ['Did Lea Brunner cancel?', { language: 'en', customerName: 'Lea Brunner' }],
    ['Gibt es eine Buchung für Lea Brunner?', { language: 'de', customerName: 'Lea Brunner' }],
    ['Lea Brunner is on holiday next week', { language: 'en', fromDate: '2026-10-12', customerName: 'Lea Brunner' }],
    ['Change the price of a haircut to 60', { language: 'en', serviceId: cut }],
    ['What is the weather like?', { language: 'en' }],
    ['Bitte den Termin von Lea Brunner nicht absagen', { language: 'de', customerName: 'Lea Brunner' }],
    ['Friday', { language: 'en', date: FRIDAY }],
    ['', { language: 'en' }],
  ];
  for (const [message, expected] of nothing) {
    const heard = interpret(message, words());
    assert.equal(heard.intent, undefined, message);
    assert.deepEqual(heard, expected, message);
  }
  // A question about who booked is about the agenda, never a new booking.
  assert.equal(interpret('Who booked the 10:00 slot tomorrow?', words()).intent, 'agenda');
});

test('help, greetings and one-word answers', () => {
  check([
    ['help', { language: 'en', intent: 'help' }],
    ['Was kannst du?', { language: 'de', intent: 'help' }],
    ['Hallo', { language: 'de', intent: 'help' }],
    ['yes', { language: 'en', reply: 'yes' }],
    ['Ja bitte', { language: 'de', reply: 'yes' }],
    ['Nein', { language: 'de', reply: 'no' }],
    ['never mind', { language: 'en', reply: 'no' }],
    ['thanks!', { language: 'en', reply: 'thanks' }],
  ]);
  // "Cancel" answers an open proposal or question; with nothing open it starts a cancellation.
  assert.deepEqual(interpret('Cancel', words({ waiting: true })), { language: 'en', reply: 'no' });
  assert.deepEqual(interpret('Cancel', words()), { language: 'en', intent: 'cancel' });
});

test('an answer to the assistant\'s question is read as that detail', () => {
  assert.deepEqual(interpret('10', words({ expecting: 'time' })), { language: 'en', time: '10:00' });
  assert.deepEqual(interpret('halb drei', words({ expecting: 'time', language: 'de' })), { language: 'de', time: '14:30' });
  assert.deepEqual(interpret('lea brunner', words({ expecting: 'customerName' })), { language: 'en', customerName: 'Lea Brunner' });
  assert.deepEqual(interpret('Frau Meier', words({ expecting: 'customerName', language: 'de' })), { language: 'de', customerName: 'Meier' });
  // A stylist's family name inside a customer's name stays part of the customer's name.
  assert.deepEqual(interpret('Sandra Keller', words({ expecting: 'customerName' })), { language: 'en', customerName: 'Sandra Keller' });
  assert.deepEqual(interpret('Haircut', words({ expecting: 'service' })), { language: 'en', serviceId: cut });
  assert.deepEqual(interpret('the 24th', words({ expecting: 'date' })), { language: 'en', date: '2026-10-24' });
  // Outside such a question a stray word is not a customer.
  assert.deepEqual(interpret('Später', words({ expecting: 'time', language: 'de' })), { language: 'de' });
  assert.deepEqual(interpret('at 11 instead', words()), { language: 'en', time: '11:00' });
  assert.deepEqual(interpret('with Luca instead', words()), { language: 'en', employeeId: LUCA.id });
});

test('words that could not be placed are reported, so a half-understood sentence is not taken for a detail', () => {
  const unread = (message: string, context: Partial<InterpreterContext> = {}) => read(message, words(context)).unread;
  for (const message of ['at 11 instead', 'and on Friday?', 'with Luca instead', 'lieber um 11', 'how about the morning?', 'Book Lea Brunner for a haircut on Tuesday at 10', 'yes']) {
    assert.deepEqual(unread(message), [], message);
  }
  // The service and the time are understood, but the sentence says more than that.
  const half = read('Mia Keller would like a haircut at 10:30', words());
  assert.deepEqual(half.request, { language: 'en', time: '10:30', serviceId: cut });
  assert.deepEqual(half.unread, ['Mia', 'Keller']);
  assert.deepEqual(unread('Lea Brunner hat schon gebucht'), ['gebucht']);
  // Asked for a name, only a name is a name.
  assert.deepEqual(read('I wonder what the weather will be like', words({ expecting: 'customerName' })).request, { language: 'en' });
  assert.deepEqual(read('it is for mia keller', words({ expecting: 'customerName' })), { request: { language: 'en', customerName: 'Mia Keller' }, unread: [] });
});

test('the answer language follows the message; a message without telling words keeps the language before', () => {
  assert.equal(interpret('Is Thursday free?', words({ language: 'de' })).language, 'en');
  assert.equal(interpret('Ist Donnerstag frei?', words({ language: 'en' })).language, 'de');
  assert.equal(interpret('10:30', words({ language: 'de' })).language, 'de');
  assert.equal(interpret('10:30', words()).language, 'en');
});
