import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { answer, confirmProposal, type AssistantData, type AssistantReply } from '../src/assistant/execute';
import { interpret, read } from '../src/assistant/interpret';
import { refusalIn, UNKNOWN_REFUSAL_DE } from '../src/assistant/refusals';
import type { AssistantLanguage, AssistantTask } from '../src/assistant/types';
import { getAvailableSlots, validateCalendarEvent } from '../src/availability';
import { chat, labels, text } from './assistantChat';
import {
  appointment, COLOURING, FRIDAY, HAIRCUT, LUCA, salon, SATURDAY, SELINA, THURSDAY, TODAY, TUESDAY, WEDNESDAY, words,
} from './assistantFixture';

/**
 * Regression tests for what an independent review found in the assistant's reading and replies,
 * and for the three answers that only read the salon's data: a customer's appointments, the
 * salon's hours, and where one person's time off is entered. Fixed clock: Monday 5 October 2026.
 */
const ask = (task: Omit<AssistantTask, 'language'> & { language?: AssistantLanguage }, data: AssistantData = salon()) =>
  answer({ language: 'en', ...task }, data);
const said = (reply: AssistantReply) => reply.text.join(' ');
const offeredByRules = (data: AssistantData, date: string, serviceId: string, employeeIds: string[]) =>
  [...new Set(employeeIds.flatMap(employeeId => getAvailableSlots(data, { date, serviceId, employeeId, mode: 'owner' })))].sort();

test('finding 3: one person\'s time off never closes the salon, and the owner is told where absences are set', () => {
  const timeOff: [message: string, language: AssistantLanguage, who: string | null][] = [
    ['Selina is taking Friday off', 'en', 'Selina'],
    ['Luca is off on Friday, he is taking the day off', 'en', 'Luca'],
    ['Selina takes next week off', 'en', 'Selina'],
    ['Luca is sick tomorrow', 'en', 'Luca'],
    ['Luca Frei is away on Friday', 'en', 'Luca'],
    ['Close Friday, Selina is away', 'en', 'Selina'],
    ['Is Selina off on Friday?', 'en', 'Selina'],
    ["I'm off on Friday", 'en', null],
    ['My colleague is on holiday next week', 'en', null],
    ['Selina nimmt am Freitag frei', 'de', 'Selina'],
    ['Luca ist morgen krank', 'de', 'Luca'],
    ['Selina hat nächste Woche Ferien', 'de', 'Selina'],
    ['Luca ist am Freitag nicht da', 'de', 'Luca'],
    ['Am Freitag geschlossen, Selina ist krank', 'de', 'Selina'],
    ['Ich bin am Freitag krank', 'de', null],
  ];
  for (const [message, language, who] of timeOff) {
    const talk = chat();
    const result = talk.say(message);
    assert.equal(result.task?.intent, 'absence', message);
    assert.equal(result.reply?.proposal, undefined, message);
    assert.equal(result.reply?.language, language, message);
    // The screens are called what they are called in the app.
    // In English and in German alike: the page, then its tab, both under their own names.
    assert.match(text(result), /Team.*Absences.*Team.*This week/, message);
    // No screen is named that does not exist any more.
    assert.doesNotMatch(text(result), /Company Settings|Closed Dates|Shift Plan|Booking Hours/, message);
    assert.match(text(result), language === 'de'
      ? new RegExp(`^Eine Abwesenheit für ${who ?? 'eine einzelne Person'} kann ich nicht eintragen\\. Es wurde nichts geändert, und der Salon wurde nicht geschlossen\\.`)
      : new RegExp(`^I cannot enter time off for ${who ?? 'one person'}\\. Nothing was changed, and the salon was not closed\\.`), message);
    // Nothing can be confirmed afterwards.
    assert.equal(talk.say('yes').did, 'said', message);
    assert.ok(talk.unchanged(), message);
  }
  // The reader itself finds no closure in them.
  assert.deepEqual(interpret('Selina is taking Friday off', words()), { language: 'en', intent: 'absence', date: FRIDAY, employeeId: SELINA.id });
  assert.deepEqual(interpret('Luca ist morgen krank', words()), { language: 'de', intent: 'absence', date: TUESDAY, employeeId: LUCA.id });

  // What the shift plan and the calendar hold for that person on that day is said too.
  assert.deepEqual(chat().say('Selina is taking Friday off').reply?.text, [
    'I cannot enter time off for Selina. Nothing was changed, and the salon was not closed.',
    'You enter it in Team, on the tab Absences. For a single day you can also change the shift, in Team on the tab This week.',
    'In the shift plan Selina works from 09:00 to 18:00 on Friday, 09.10.2026.',
    '1 appointment is booked with Selina that day. It stays in the calendar when you enter an absence.',
    'If the whole salon should be closed, write for example “Close Friday”.',
  ]);
  assert.deepEqual(chat().say('Luca ist morgen krank').reply?.text, [
    'Eine Abwesenheit für Luca kann ich nicht eintragen. Es wurde nichts geändert, und der Salon wurde nicht geschlossen.',
    'Du trägst sie unter Team im Reiter Absences ein. Für einen einzelnen Tag kannst du auch die Schicht ändern, unter Team im Reiter This week.',
    'Im Schichtplan hat Luca morgen (Dienstag, 06.10.2026) keine Schicht.',
    'Wenn der ganze Salon geschlossen sein soll, schreibe zum Beispiel «Am Freitag geschlossen».',
  ]);
  const away = salon({ absences: [{ id: 'away-1', employeeId: SELINA.id, start: FRIDAY, end: FRIDAY }] });
  assert.match(text(chat(away).say('Is Selina off on Friday?')), /An absence is already entered for Selina on Friday, 09\.10\.2026\./);

  // The salon itself taking time off is a closure as before, and so is a plain closure.
  for (const message of ['We are taking Friday off', 'Close Friday', 'We are on holiday from 21 December until 3 January', 'Wir haben am Freitag Ferien', 'Mach den Freitag zu']) {
    assert.equal(chat().say(message).reply?.proposal?.action.kind, 'close', message);
  }
  // A customer is not a member of the team: no pointer to absences, and no closure either.
  for (const message of ['Lea Brunner is on holiday next week', 'Selina Graf is on holiday next week']) {
    assert.equal(chat().say(message).did, 'unclear', message);
  }
});

test('finding 4: a greeting anywhere in the message is a greeting, not a day or a time', () => {
  const cases: [message: string, expected: ReturnType<typeof interpret>][] = [
    ['Hallo, guten Morgen! Was steht heute an?', { language: 'de', intent: 'agenda', date: TODAY }],
    ['Guten Morgen, was steht morgen an?', { language: 'de', intent: 'agenda', date: TUESDAY }],
    ['Hallo zusammen, guten Morgen. Am Freitag geschlossen', { language: 'de', intent: 'close', date: FRIDAY }],
    ['Hi, good morning, is Selina free tomorrow at 3?', { language: 'en', intent: 'availability', date: TUESDAY, time: '15:00', employeeId: SELINA.id }],
    ['Hello, good evening. Is Thursday at 3 free for a haircut?', { language: 'en', intent: 'availability', date: THURSDAY, time: '15:00', serviceId: HAIRCUT.id }],
    ['Morning! Is Selina free tomorrow at 3 for a haircut?', { language: 'en', intent: 'availability', date: TUESDAY, time: '15:00', serviceId: HAIRCUT.id, employeeId: SELINA.id }],
    ["Selina here, good morning, what's on today?", { language: 'en', intent: 'agenda', date: TODAY, employeeId: SELINA.id }],
    // Without a greeting the same words keep their meaning.
    ['Is Selina free tomorrow morning at 9 for a haircut?', { language: 'en', intent: 'availability', date: TUESDAY, partOfDay: 'morning', time: '09:00', serviceId: HAIRCUT.id, employeeId: SELINA.id }],
    ['Geht Freitag Morgen ein Haarschnitt?', { language: 'de', intent: 'availability', date: FRIDAY, partOfDay: 'morning', serviceId: HAIRCUT.id }],
    ['Morgen um 10 Haarschnitt frei?', { language: 'de', intent: 'availability', date: TUESDAY, time: '10:00', serviceId: HAIRCUT.id }],
  ];
  for (const [message, expected] of cases) assert.deepEqual(interpret(message, words()), expected, message);
  // A greeting and nothing else still shows what the assistant can do.
  for (const greeting of ['Hallo', 'Guten Morgen', 'Hallo, guten Morgen!', 'Hi, good morning', 'Good evening']) {
    assert.equal(interpret(greeting, words()).intent, 'help', greeting);
  }
  // Answered from the data: today has no appointment, tomorrow has one.
  assert.deepEqual(chat().say('Hallo, guten Morgen! Was steht heute an?').reply?.text, ['Heute (Montag, 05.10.2026): keine Termine.']);
  assert.match(text(chat().say('Hi, good morning, is Selina free tomorrow at 3 for a haircut?')), /^Yes\. Tomorrow \(Tuesday, 06\.10\.2026\) at 15:00 is free/);
});

test('finding 6: a refusal after Confirm is said in the owner\'s language, and another stylist who is free is offered', () => {
  // The owner named no stylist, the assistant proposed Selina. Then somebody books Selina at that time.
  for (const [request, language] of [
    ['Trag Mia Keller am Freitag um 10 Uhr für einen Haarschnitt ein', 'de'],
    ['Book Mia Keller for a haircut on Friday at 10', 'en'],
  ] as const) {
    const talk = chat();
    const proposal = talk.say(request).reply?.proposal;
    assert.equal(proposal?.rows[3].value, 'Selina Keller', request);
    talk.state.data = { ...talk.state.data, events: [appointment('cal-other', 'Tom Graf', HAIRCUT, SELINA, FRIDAY, '10:00'), ...talk.state.data.events] };
    const refused = talk.say(language === 'de' ? 'ja' : 'yes');
    assert.equal(refused.did, 'confirmed');
    assert.equal(refused.reply?.tone, 'problem');
    assert.equal(talk.state.added.length, 0);
    const rulesSay = validateCalendarEvent(talk.state.data, (proposal!.action as { event: Parameters<typeof validateCalendarEvent>[1] }).event)!;
    assert.match(rulesSay, /^This time is not available/);
    assert.deepEqual(refused.reply?.text, language === 'de'
      ? [
        'Der Termin wurde nicht eingetragen:',
        'Diese Zeit ist nicht verfügbar. Bitte wähle eine Zeit innerhalb der Schicht und der Öffnungszeiten, die sich mit keinem anderen Termin überschneidet.',
        'Um 10:00 Uhr ist Luca frei.',
        'An dem Tag frei:',
      ]
      : ['The appointment was not booked:', rulesSay, 'Luca is free at 10:00.', 'Free that day:']);
    // No English in the German reply.
    if (language === 'de') assert.doesNotMatch(text(refused), /\b(?:This|Choose|shift|booking|available)\b/);
    // The alternatives are those of everybody who offers the service, with the other stylist first.
    assert.deepEqual(labels(refused), [
      language === 'de' ? 'Lieber bei Luca' : 'With Luca instead',
      ...offeredByRules(talk.state.data, FRIDAY, HAIRCUT.id, [SELINA.id, LUCA.id]),
    ]);
    assert.ok(labels(refused).includes('10:00'), 'Luca is free at 10:00');
    // One tap proposes the same appointment with Luca, and that one can be booked.
    const again = talk.tap(language === 'de' ? 'Lieber bei Luca' : 'With Luca instead');
    assert.deepEqual(again.reply?.proposal?.rows.map(row => row.value).slice(1), [
      language === 'de' ? 'Freitag, 09.10.2026, 10:00–10:30' : 'Friday, 09.10.2026, 10:00–10:30',
      language === 'de' ? 'Mia Keller (neu)' : 'Mia Keller (new customer)',
      'Luca Frei',
    ]);
    assert.equal(talk.say(language === 'de' ? 'ja' : 'yes').reply?.tone, 'success');
    assert.deepEqual(talk.state.added.map(event => [event.customerName, event.staffName, event.startTime]), [['Mia Keller', 'Luca Frei', '10:00']]);
  }

  // The owner asked for Selina: the alternatives stay with her, in German too.
  const talk = chat();
  const proposal = talk.say('Trag Mia Keller am Mittwoch um 10 Uhr für einen Haarschnitt bei Selina ein').reply!.proposal!;
  talk.state.data = { ...talk.state.data, events: [appointment('cal-other', 'Tom Graf', HAIRCUT, SELINA, WEDNESDAY, '10:00'), ...talk.state.data.events] };
  const refused = confirmProposal(proposal, 'de', talk.state.data, { addEvent: event => validateCalendarEvent(talk.state.data, event), deleteEvent: () => {}, saveClosedDates: () => {} });
  assert.deepEqual(refused.text.slice(0, 1), ['Der Termin wurde nicht eingetragen:']);
  assert.match(refused.text[1], /^Diese Zeit ist nicht verfügbar\./);
  assert.deepEqual(refused.choices?.map(choice => choice.label), offeredByRules(talk.state.data, WEDNESDAY, HAIRCUT.id, [SELINA.id]));
  assert.equal(refused.task?.employeeId, SELINA.id);
});

test('finding 6: every refusal the booking rules can give has German words', () => {
  // The rules' own texts, read from their source: a new refusal there must get a wording here.
  const rules = readFileSync(new URL('../src/availability.ts', import.meta.url), 'utf8');
  const upTo = rules.indexOf('/** Find the earliest available date');
  assert.ok(upTo > 0);
  const refusals = [...rules.slice(0, upTo).matchAll(/(?:unavailable\(|return )'((?:[^'\\]|\\.)+)'/g)].map(match => match[1])
    .filter(refusal => /[.]$/.test(refusal));
  assert.ok(refusals.length >= 20, `found ${refusals.length} refusals`);
  assert.ok(refusals.includes('This employee is away on this date. Please choose another date or specialist.'));
  for (const refusal of [...refusals, 'Choose a valid 30-minute slot on the same day.']) {
    const german = refusalIn(refusal, 'de');
    assert.notEqual(german, UNKNOWN_REFUSAL_DE, refusal);
    assert.notEqual(german, refusal, refusal);
    assert.doesNotMatch(german, /\b(?:the|this|please|choose|employee|appointment)\b/i, refusal);
    assert.doesNotMatch(german, /ß/, refusal);
    // English stays exactly what the rules say.
    assert.equal(refusalIn(refusal, 'en'), refusal);
  }
  assert.equal(refusalIn('Choose a valid 90-minute slot on the same day.', 'de'), 'Bitte wähle eine gültige Zeit von 90 Minuten am selben Tag.');
  // A refusal nobody has translated yet is never passed on in English.
  assert.equal(refusalIn('Some new rule says no.', 'de'), UNKNOWN_REFUSAL_DE);

  // A reason the assistant has no own sentence for reaches a German answer in German:
  // here Selina's shift on Tuesday is entered the wrong way round.
  const broken = salon();
  broken.shiftOverview = broken.shiftOverview.map(entry => entry.employeeId === SELINA.id
    ? { ...entry, shifts: { ...entry.shifts, [TUESDAY]: { start: '18:00', end: '09:00' } } } : entry);
  const reply = ask({ language: 'de', intent: 'availability', serviceId: HAIRCUT.id, date: TUESDAY, time: '11:00' }, broken);
  assert.match(said(reply), /Selina: Die Schicht dieser Person an diesem Tag ist ungültig\./);
  assert.doesNotMatch(said(reply), /invalid shift/);
});

test('finding 7: a name keeps a word that is also an everyday word; the everyday word keeps its meaning elsewhere', () => {
  const name = (message: string, context = {}) => interpret(message, words(context)).customerName;
  const names: [message: string, customer: string][] = [
    ['book haircut for May Keller on friday at 11', 'May Keller'],
    ['Book Will Smith for a haircut on Friday at 11', 'Will Smith'],
    ['Book Rose Meier for a haircut on Friday at 11', 'Rose Meier'],
    ['Book Anna Frei for a haircut on Friday at 10', 'Anna Frei'],
    ['Book a haircut for Glenn Close on Friday at 10', 'Glenn Close'],
    ['Book Doris Day for a colouring on Wednesday at 9', 'Doris Day'],
    ['Trag Peter Gut am Freitag um 10 Uhr für einen Haarschnitt ein', 'Peter Gut'],
    ['Trag Sebastian Kurz am Freitag um 10 Uhr für einen Haarschnitt ein', 'Sebastian Kurz'],
    ["Cancel May Keller's appointment on Friday", 'May Keller'],
    // Typed all in lower case, the common names are still found beside another name word.
    ['book haircut for may keller on friday at 11', 'May Keller'],
    ['book will smith for a haircut on friday at 11', 'Will Smith'],
    ['trag anna frei am freitag um 10 uhr für einen haarschnitt ein', 'Anna Frei'],
  ];
  for (const [message, customer] of names) assert.equal(name(message), customer, message);
  // The whole request is read as before, with the full name.
  assert.deepEqual(interpret('book haircut for May Keller on friday at 11', words()),
    { language: 'en', intent: 'book', date: FRIDAY, time: '11:00', serviceId: HAIRCUT.id, customerName: 'May Keller' });
  // "Close" in a name does not close the salon: the change that is named first counts.
  assert.equal(chat().say('Book a haircut for Glenn Close on Friday at 10').reply?.proposal?.rows[2].value, 'Glenn Close (new customer)');
  // As the answer to "Who is the appointment for?".
  for (const [typed, customer] of [['May Keller', 'May Keller'], ['may keller', 'May Keller'], ['it is for Will Smith', 'Will Smith'], ['Anna Frei', 'Anna Frei'], ['Will', 'Will']]) {
    assert.equal(name(typed, { expecting: 'customerName' }), customer, typed);
  }

  // The same words as a verb, a month or an adjective are no part of a name.
  assert.deepEqual(interpret('Book Lea in May', words()), { language: 'en', intent: 'book', customerName: 'Lea' });
  const willAnna = read('Will Anna be in on Friday?', words());
  assert.deepEqual(willAnna.request, { language: 'en', date: FRIDAY });
  assert.equal(chat().say('Will Anna be in on Friday?').reply?.proposal, undefined);
  assert.deepEqual(interpret('Book Lea Brunner for a haircut on 5 May at 10', words()),
    { language: 'en', intent: 'book', date: '2027-05-05', time: '10:00', serviceId: HAIRCUT.id, customerName: 'Lea Brunner' });
  assert.equal(name('Will you book Mia Keller for a haircut on Friday at 10?'), 'Mia Keller');
  assert.equal(name('Can I book Mia Keller for a haircut on Friday at 10?'), 'Mia Keller');
  assert.equal(name('Book Mia Keller, I need her on Friday at 10 for a haircut'), 'Mia Keller');
  assert.equal(name('Book Mia Keller. Please make it Friday at 10'), 'Mia Keller');
  assert.equal(name('Können Sie Mia Keller am Freitag um 10 Uhr für einen Haarschnitt eintragen?'), 'Mia Keller');
  assert.equal(name('Neuer Termin für Mia Keller, Zeit 10 Uhr am Freitag'), 'Mia Keller');
  assert.equal(name('Hast du am Freitag um 15 Uhr etwas frei?'), undefined);
  assert.equal(name('Ist am Freitag um 15 Uhr noch etwas Frei?'), undefined);
  assert.equal(name('book lea brunner in may'), 'Lea Brunner');
});

test('a customer\'s appointments are read from the calendar, with what the calendar cannot tell said plainly', () => {
  const data = salon();
  // One day.
  assert.deepEqual(ask({ intent: 'appointments', customerName: 'Marco Bianchi', date: FRIDAY }, data), {
    language: 'en',
    task: { language: 'en', intent: 'appointments', customerName: 'Marco Bianchi', date: FRIDAY },
    text: ['Marco Bianchi has 1 appointment on Friday, 09.10.2026:'],
    list: ['14:00–14:30 · Marco Bianchi · Haircut · Luca Frei'],
    calendar: { date: FRIDAY, label: 'Open calendar on Fri 09.10.' },
  });
  // Everything still to come, in order.
  const upcoming = ask({ intent: 'appointments', customerName: 'Marco Bianchi' }, data);
  assert.deepEqual(upcoming.text, ['Marco Bianchi has 2 upcoming appointments:']);
  assert.deepEqual(upcoming.list, ['Thu 08.10., 15:00–15:30 · Marco Bianchi · Haircut · Selina Keller', 'Fri 09.10., 14:00–14:30 · Marco Bianchi · Haircut · Luca Frei']);
  // A week, a part of a name, and a name with an accent.
  const week = ask({ intent: 'appointments', customerName: 'Lea', fromDate: TODAY }, data);
  assert.deepEqual(week.text, ['Lea has 2 appointments from Monday, 05.10.2026 to Sunday, 11.10.2026 (7 days):']);
  assert.deepEqual(week.list, ['Tue 06.10., 10:00–10:30 · Lea Brunner · Haircut · Selina Keller', 'Fri 09.10., 09:00–09:30 · Léa Girard · Haircut · Selina Keller']);
  // Nothing on that day: what the customer does have is shown, as a cancellation would show it.
  const none = ask({ intent: 'appointments', customerName: 'Lea Brunner', date: WEDNESDAY }, data);
  assert.deepEqual(none.text, ['I found no appointment for Lea Brunner on Wednesday, 07.10.2026.', 'These upcoming appointments exist:']);
  assert.deepEqual(none.list, ['Tue 06.10., 10:00–10:30 · Lea Brunner · Haircut · Selina Keller']);
  assert.deepEqual(ask({ intent: 'appointments', customerName: 'Esther Hug' }, data).text, ['I found no upcoming appointment for Esther Hug.']);
  // A request that still waits is not an appointment, and the answer says where it is.
  assert.deepEqual(ask({ intent: 'appointments', customerName: 'Tom Graf', date: FRIDAY }, data).text,
    ['I found no appointment for Tom Graf on Friday, 09.10.2026.', '1 request from Tom Graf waits for your answer on Home.']);
  // A day that is over.
  const past = salon({ events: [appointment('cal-old', 'Lea Brunner', COLOURING, LUCA, '2026-10-02', '10:00'), ...data.events] });
  assert.deepEqual(chat(past).say('Was Lea Brunner booked last Friday?').reply?.text, ['Lea Brunner had 1 appointment on Friday, 02.10.2026:']);
  assert.equal(chat(past).say('Did Lea Brunner have an appointment last week?').did, 'unclear', 'a period the reader does not know is not answered from the coming days');

  // Cancellations leave no trace in the calendar: the assistant says so instead of guessing.
  const cancelled = ask({ intent: 'appointments', customerName: 'Sandra Meier', cancellations: true }, data);
  assert.equal(cancelled.text[1], 'I cannot see whether something was cancelled: a cancelled appointment is simply no longer in the calendar.');
  assert.deepEqual(chat().say('Did anybody cancel today?').reply?.text, ['I cannot see whether something was cancelled: a cancelled appointment is simply no longer in the calendar.']);
  // German, with the same facts.
  const german = ask({ language: 'de', intent: 'appointments', customerName: 'Marco Bianchi', fromDate: TODAY }, data);
  assert.deepEqual(german.text, ['Marco Bianchi hat von Montag, 05.10.2026 bis Sonntag, 11.10.2026 (7 Tage) 2 Termine:']);
  assert.deepEqual(german.list, ['Do 08.10., 15:00–15:30 · Marco Bianchi · Haircut · Selina Keller', 'Fr 09.10., 14:00–14:30 · Marco Bianchi · Haircut · Luca Frei']);
  assert.deepEqual(ask({ language: 'de', intent: 'appointments', customerName: 'Esther Hug' }, data).text, ['Ich finde keinen kommenden Termin für Esther Hug.']);
  // It reads only: no proposal, no choice that changes anything.
  for (const reply of [upcoming, week, none, cancelled, german]) {
    assert.equal(reply.proposal, undefined);
    assert.equal(reply.choices, undefined);
  }
});

test('whether the salon is open is read from the opening hours and the closed dates', () => {
  const data = salon({ closedDates: [{ id: 'closed-x', name: 'Christmas', start: '2026-12-24', end: '2026-12-26' }] });
  assert.deepEqual(ask({ intent: 'hours', date: FRIDAY }, data).text, ['Friday, 09.10.2026: the salon is open from 09:00 to 18:00.']);
  assert.deepEqual(ask({ intent: 'hours', date: TODAY }, data).text, ['Today (Monday, 05.10.2026): the salon is open from 09:00 to 18:00.']);
  assert.deepEqual(ask({ intent: 'hours', date: SATURDAY }, data).text, ['Saturday, 10.10.2026: the salon is closed. It is closed on Saturdays in the opening hours.']);
  assert.deepEqual(ask({ intent: 'hours', date: '2026-12-24' }, data).text, ['Thursday, 24.12.2026: the salon is closed (closed date “Christmas”).']);
  assert.deepEqual(ask({ language: 'de', intent: 'hours', date: '2026-12-24' }, data).text, ['Donnerstag, 24.12.2026: Der Salon ist geschlossen (Schliesstag «Christmas»).']);
  assert.deepEqual(ask({ language: 'de', intent: 'hours', date: FRIDAY }, data).text, ['Freitag, 09.10.2026: Der Salon ist von 09:00 bis 18:00 Uhr geöffnet.']);
  // The answer agrees with the booking rules: a day it calls closed has no free time, an open one has.
  assert.deepEqual(offeredByRules(data, '2026-12-24', HAIRCUT.id, [SELINA.id, LUCA.id]), []);
  assert.ok(offeredByRules(data, FRIDAY, HAIRCUT.id, [SELINA.id, LUCA.id]).length > 0);

  // Several days: one line a day.
  const days = ask({ intent: 'hours', date: '2026-12-23', endDate: '2026-12-27' }, data);
  assert.deepEqual(days.text, ['Wednesday, 23.12.2026 to Sunday, 27.12.2026 (5 days):']);
  assert.deepEqual(days.list, [
    'Wed 23.12. · open 09:00–18:00', 'Thu 24.12. · closed (closed date “Christmas”)', 'Fri 25.12. · closed (closed date “Christmas”)',
    'Sat 26.12. · closed (closed date “Christmas”)', 'Sun 27.12. · closed',
  ]);
  // No day: the week as it is set, and the closed dates still to come.
  const weekly = ask({ intent: 'hours' }, data);
  assert.deepEqual(weekly.text, ['The salon’s opening hours (set in Settings under Opening hours):']);
  assert.deepEqual(weekly.list, [
    'Monday · 09:00–18:00', 'Tuesday · 09:00–18:00', 'Wednesday · 09:00–18:00', 'Thursday · 09:00–18:00', 'Friday · 09:00–18:00',
    'Saturday · closed', 'Sunday · closed', 'Closed date “Christmas” · 24.–26.12.2026',
  ]);
  assert.deepEqual(ask({ language: 'de', intent: 'hours' }, data).list?.slice(4), ['Freitag · 09:00–18:00 Uhr', 'Samstag · geschlossen', 'Sonntag · geschlossen', 'Schliesstag «Christmas» · 24.–26.12.2026']);
  // Asked by name, with or without a question mark.
  for (const message of ['What are our opening hours?', 'Opening hours', 'Wie sind die Öffnungszeiten?']) {
    assert.equal(chat().say(message).task?.intent, 'hours', message);
  }
  // It reads only.
  for (const reply of [days, weekly, ask({ intent: 'hours', date: FRIDAY }, data)]) {
    assert.equal(reply.proposal, undefined);
    assert.equal(reply.choices, undefined);
  }
});
