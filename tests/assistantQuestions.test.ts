import assert from 'node:assert/strict';
import test from 'node:test';
import { taskFor, taskFromModel, turn } from '../src/assistant/conversation';
import { assistantExamples } from '../src/assistant/execute';
import { read } from '../src/assistant/interpret';
import { checkAssistantRequest, isChange } from '../src/assistant/types';
import { changes, chat, labels, text } from './assistantChat';
import { COLOURING, FRIDAY, HAIRCUT, LUCA, salon, THURSDAY, TUESDAY, WEDNESDAY, words } from './assistantFixture';

/**
 * The rule these tests defend: a message that asks whether or when something is or was the case
 * is answered and never becomes a booking, a cancellation, a closure or a reopening. It holds
 * with and without a request open, in English and German, for the built-in reader and for the
 * AI model's answers. "Today" is Monday 5 October 2026, 12:00 (the fixed clock of the fixture).
 */

/** Wednesday 14 October is a closed date here, so a proposal to reopen it can be open. */
const TEAM_DAY = '2026-10-14';
const withClosedDay = () => salon({ closedDates: [{ id: 'closed-team', name: 'Team day', start: TEAM_DAY, end: TEAM_DAY }] });

/** What can be open when the question comes: nothing, a proposal of each kind, or a question of the assistant. */
const SETUPS: { name: string; first?: string; proposal?: string; asked?: string }[] = [
  { name: 'nothing open' },
  { name: 'a booking proposal open', first: 'Book a haircut for Mia Keller tomorrow at 11', proposal: 'book' },
  { name: 'a cancellation proposal open', first: "Cancel Lea Brunner's appointment on Tuesday", proposal: 'cancel' },
  { name: 'a closure proposal open', first: 'Close Friday', proposal: 'close' },
  { name: 'a reopening proposal open', first: 'Open Wednesday 14 October again', proposal: 'reopen' },
  { name: 'the assistant waiting for a time', first: 'Book a haircut for Mia Keller tomorrow', asked: 'time' },
  { name: 'the assistant waiting for a name', first: 'Book a haircut tomorrow at 11', asked: 'customerName' },
  { name: 'a list of appointments to cancel shown', first: 'Cancel Marco Bianchi' },
];

function opened(setup: typeof SETUPS[number]) {
  const talk = chat(withClosedDay());
  if (setup.first) {
    const first = talk.say(setup.first);
    assert.equal(first.reply?.proposal?.action.kind, setup.proposal, setup.first);
    assert.equal(first.reply?.asked, setup.asked, setup.first);
  }
  return talk;
}

// What each question is answered with when nothing is open; '-' means "I did not understand".
const QUESTIONS: [message: string, answeredWith: string][] = [
  // bookings
  ['Is Esther Hug booked on Tuesday?', 'appointments'],
  ['Is Lea Brunner booked on Tuesday?', 'appointments'],
  ['is lea brunner booked on tuesday', 'appointments'],
  ['Lea Brunner is booked on Tuesday?', 'appointments'],
  ['Does Marco Bianchi have an appointment this week?', 'appointments'],
  ["When is Sandra Meier's appointment?", 'appointments'],
  ['What time is Marco Bianchi coming on Friday?', 'appointments'],
  ['Is there a booking for Lea Brunner tomorrow?', 'appointments'],
  ['Did Lea Brunner book for Tuesday?', 'appointments'],
  ['Could you tell me whether Lea Brunner is booked on Tuesday?', 'appointments'],
  ['I wonder if Lea Brunner is booked on Tuesday', 'appointments'],
  ['Tell me when Lea Brunner is booked', 'appointments'],
  ['Is anybody booked on Friday?', 'agenda'],
  ['Who booked the 10:00 slot tomorrow?', 'agenda'],
  ['Should I book Lea Brunner for a haircut on Friday at 10?', 'availability'],
  ['Book Lea Brunner for a haircut on Friday at 10?', 'availability'],
  ['Is it possible to book a haircut on Friday at 10?', 'availability'],
  ['Ist Lea Brunner am Dienstag gebucht?', 'appointments'],
  ['Hat Lea Brunner am Mittwoch einen Termin?', 'appointments'],
  ['Wann kommt Marco Bianchi?', 'appointments'],
  ['Gibt es eine Buchung für Lea Brunner?', 'appointments'],
  ['Weisst du, ob Lea Brunner am Dienstag gebucht ist?', 'appointments'],
  ['Kannst du nachsehen, ob Lea Brunner am Dienstag gebucht hat?', 'appointments'],
  ['Wer hat am Freitag um 14 Uhr gebucht?', 'agenda'],
  ['Soll ich Lea Brunner am Freitag um 10 Uhr für einen Haarschnitt eintragen?', 'availability'],
  // cancellations
  ['Has Sandra Meier cancelled?', 'appointments'],
  ['Did Lea Brunner cancel?', 'appointments'],
  ['Did anybody cancel today?', 'appointments'],
  ['Has Marco Bianchi cancelled his appointment on Friday?', 'appointments'],
  ['Can you check if Sandra Meier cancelled?', 'appointments'],
  ["Should I cancel Lea Brunner's appointment?", 'appointments'],
  ["Cancel Lea Brunner's appointment on Tuesday?", 'appointments'],
  ['Hat Sandra Meier abgesagt?', 'appointments'],
  ['Wurde der Termin von Lea Brunner storniert?', 'appointments'],
  ['Kannst du schauen, ob Marco Bianchi abgesagt hat?', 'appointments'],
  ['Soll ich den Termin von Lea Brunner absagen?', 'appointments'],
  // closures and opening times
  ['Are we closed on Friday?', 'hours'],
  ['Is Friday closed?', 'hours'],
  ['Are we closed on 24 December?', 'hours'],
  ['Is the salon open on Saturday?', 'hours'],
  ['What time do we close on Friday?', 'hours'],
  ['When do we open on Thursday?', 'hours'],
  ['What are our opening hours?', 'hours'],
  ['Can you tell me if Friday is closed?', 'hours'],
  ['Could you check whether we are closed on Friday?', 'hours'],
  ['Can you tell me what time we close on Friday', 'hours'],
  ['Tell me if Friday is closed', 'hours'],
  ['Will we be closed on Friday?', 'hours'],
  ['Should we close on Friday?', 'hours'],
  ['We are closed on Friday, right?', 'hours'],
  ['Close Friday?', 'hours'],
  ['Did we reopen Wednesday?', 'hours'],
  ['Haben wir am Freitag geschlossen?', 'hours'],
  ['Ist am Samstag geöffnet?', 'hours'],
  ['Wann schliessen wir am Freitag?', 'hours'],
  ['Bis wann haben wir am Donnerstag offen?', 'hours'],
  ['Kannst du schauen, ob wir am Freitag geschlossen haben?', 'hours'],
  ['Kannst du mir sagen, wann wir am Freitag schliessen?', 'hours'],
  ['Sag mir, ob wir am Freitag geschlossen haben', 'hours'],
  ['Am Freitag geschlossen?', 'hours'],
  ['Wir haben am Freitag geschlossen, oder?', 'hours'],
  ['Machen wir am Freitag zu?', 'hours'],
  // staff
  ['Is Selina off on Friday?', 'absence'],
  ['Is Selina taking Friday off?', 'absence'],
  ['Is Selina on holiday next week?', 'absence'],
  ['Is Luca working on Tuesday?', '-'],
  ['Who is working on Friday?', 'agenda'],
  ['Ist Selina am Freitag krank?', 'absence'],
  ['Hat Luca nächste Woche Ferien?', 'absence'],
  ['Arbeitet Luca am Dienstag?', '-'],
  // questions that do not open as one and have no question mark
  ['Remind me, are we closed on Friday', 'hours'],
  ['Lea asked if we are closed on Friday', 'hours'],
  ['We are closed on Friday, is that right', 'hours'],
  ['Am Freitag haben wir geschlossen, stimmt das', 'hours'],
  ['Lea Brunner, did she cancel', 'appointments'],
  ['Tomorrow, do we have Lea Brunner booked', 'appointments'],
  // free times and other things
  ['Is Thursday at 15:00 free for a haircut?', 'availability'],
  ['Hast du am Freitag um 15 Uhr etwas frei?', 'availability'],
  ['How many bookings do we have this week?', '-'],
  ['What does a haircut cost?', '-'],
  ['Can customers book online?', '-'],
  ['What is the weather like?', '-'],
];

test('a question never yields a booking, a cancellation, a closure or a reopening, whatever is open', () => {
  assert.ok(QUESTIONS.length >= 30);
  for (const setup of SETUPS) {
    for (const [question, answeredWith] of QUESTIONS) {
      const talk = opened(setup);
      const before = talk.open();
      const said = talk.say(question);
      const where = `"${question}" with ${setup.name}`;
      assert.equal(changes(said), false, where);
      assert.equal(said.reply?.proposal, undefined, where);
      assert.ok(talk.unchanged(), where);
      // The answer is the same kind of answer whatever was open before.
      assert.equal(said.did === 'answered' ? said.task?.intent : '-', answeredWith, where);
      // A "yes" afterwards changes nothing either. An answered question has replaced what was
      // open; after one that was not understood, the proposal from before is shown once more.
      const yes = talk.say('yes');
      assert.ok(talk.unchanged(), `yes after ${where}`);
      assert.deepEqual(yes.reply?.proposal?.rows, said.did === 'unclear' ? before?.rows : undefined, `yes after ${where}`);
    }
  }
});

test('a question the assistant cannot answer leaves an open proposal as it was', () => {
  for (const setup of SETUPS.filter(item => item.proposal)) {
    for (const question of ['What does a haircut cost?', 'What is the weather like?', 'Arbeitet Luca am Dienstag?']) {
      const talk = opened(setup);
      const before = talk.open();
      assert.equal(talk.say(question).did, 'unclear');
      assert.equal(talk.open(), before, `${question} with ${setup.name}`);
    }
  }
});

test('a polite request for the change itself still gets its proposal', () => {
  const requests: [message: string, kind: string][] = [
    ['Can you book Lea Brunner for a haircut on Friday at 10?', 'book'],
    ['Could you please book Lea Brunner for a haircut on Friday at 10?', 'book'],
    ['Can I book Lea Brunner for a haircut on Friday at 10?', 'book'],
    ['Would you book Mia Keller for a colouring on Wednesday at 9?', 'book'],
    ['Kannst du Lea Brunner am Freitag um 10 Uhr für einen Haarschnitt eintragen?', 'book'],
    ['Könntest du bitte Lea Brunner am Freitag um 10 Uhr für einen Haarschnitt eintragen?', 'book'],
    ['Kann ich Lea Brunner am Freitag um 10 Uhr für einen Haarschnitt eintragen?', 'book'],
    ["Could you cancel Lea Brunner's appointment on Tuesday?", 'cancel'],
    ["Can you please delete Lea Brunner's appointment on Tuesday?", 'cancel'],
    ['Kannst du den Termin von Lea Brunner am Dienstag absagen?', 'cancel'],
    ['Würdest du bitte den Termin von Lea Brunner am Dienstag stornieren?', 'cancel'],
    ['Could you close Friday?', 'close'],
    ['Can we close on 24 December?', 'close'],
    ['Will you close the salon on Friday?', 'close'],
    ['Könntest du den Freitag schliessen?', 'close'],
    ['Können wir am Freitag schliessen?', 'close'],
    ['Kannst du am Freitag zumachen?', 'close'],
    ['Could you open Wednesday 14 October again?', 'reopen'],
    ['Can you remove the closure on 14 October?', 'reopen'],
    ['Kannst du den 14. Oktober wieder öffnen?', 'reopen'],
  ];
  for (const setup of SETUPS) {
    for (const [message, kind] of requests) {
      const said = opened(setup).say(message);
      assert.equal(said.reply?.proposal?.action.kind, kind, `"${message}" with ${setup.name}`);
    }
  }
  // Plain requests and statements about the salon are requests as before, also with a condition behind them.
  for (const [message, kind] of [
    ['Book Lea Brunner for a haircut on Friday at 10', 'book'], ['Close Friday', 'close'], ['Am Freitag geschlossen', 'close'],
    ['We are closed on 24 December', 'close'], ["Cancel Lea Brunner's appointment on Tuesday.", 'cancel'],
    ['Book Lea Brunner for a haircut on Friday at 10 if it is free', 'book'], ['Close Friday if nobody is booked', 'close'],
    ['Am Freitag haben wir geschlossen', 'close'],
  ]) {
    assert.equal(chat().say(message).reply?.proposal?.action.kind, kind, message);
  }
});

test('finding 1: after a proposal, a question about a customer is answered and proposes nothing', () => {
  // English, a customer who is not in the list.
  let talk = chat();
  assert.equal(talk.say('Book a haircut for Mia Keller tomorrow at 11').reply?.proposal?.title, 'Book appointment');
  let said = talk.say('Is Esther Hug booked on Tuesday?');
  assert.equal(said.reply?.proposal, undefined);
  assert.deepEqual(said.reply?.text, ['I found no appointment for Esther Hug tomorrow (Tuesday, 06.10.2026).']);
  assert.equal(talk.say('yes').did, 'said');
  assert.ok(talk.unchanged());

  // A customer from the list: the appointment she has is shown, and Mia Keller's booking is not turned into hers.
  talk = chat();
  talk.say('Book a haircut for Mia Keller tomorrow at 11');
  said = talk.say('Is Lea Brunner booked on Tuesday?');
  assert.equal(said.reply?.proposal, undefined);
  assert.deepEqual(said.reply?.text, ['Lea Brunner has 1 appointment tomorrow (Tuesday, 06.10.2026):']);
  assert.deepEqual(said.reply?.list, ['10:00–10:30 · Lea Brunner · Haircut · Selina Keller']);
  talk.say('yes');
  assert.ok(talk.unchanged());

  // Cancelling: "Has Sandra Meier cancelled?" does not start a cancellation of her appointments.
  talk = chat();
  assert.deepEqual(labels(talk.say('Cancel Marco Bianchi')), ['Thu 08.10., 15:00 · Marco Bianchi · Haircut', 'Fri 09.10., 14:00 · Marco Bianchi · Haircut']);
  said = talk.say('Has Sandra Meier cancelled?');
  assert.equal(said.task?.intent, 'appointments');
  assert.deepEqual(labels(said), []);
  assert.deepEqual(said.reply?.text, [
    'Sandra Meier has 2 upcoming appointments:',
    'I cannot see whether something was cancelled: a cancelled appointment is simply no longer in the calendar.',
  ]);
  assert.deepEqual(said.reply?.list, [
    'Thu 08.10., 15:00–16:30 · Sandra Meier · Colouring · Luca Frei',
    'Fri 09.10., 16:00–16:30 · Sandra Meier · Wash & blow-dry · Luca Frei',
  ]);

  // German: the question is about her appointments, not about a free time for a haircut.
  talk = chat();
  said = talk.say('Hat Lea Brunner am Mittwoch einen Termin?');
  assert.equal(said.reply?.language, 'de');
  assert.deepEqual(said.reply?.text, ['Ich finde keinen Termin für Lea Brunner am Mittwoch, 07.10.2026.', 'Diese kommenden Termine gibt es:']);
  assert.deepEqual(said.reply?.list, ['Di 06.10., 10:00–10:30 · Lea Brunner · Haircut · Selina Keller']);
  talk = chat();
  assert.equal(talk.say('Trag Mia Keller morgen um 11 Uhr für einen Haarschnitt ein').reply?.proposal?.title, 'Termin eintragen');
  said = talk.say('Ist Lea Brunner am Dienstag gebucht?');
  assert.equal(said.reply?.proposal, undefined);
  assert.deepEqual(said.reply?.text, ['Lea Brunner hat morgen (Dienstag, 06.10.2026) 1 Termin:']);
  assert.equal(talk.say('ja').did, 'said');
  assert.ok(talk.unchanged());
  talk = chat();
  talk.say('Storniere den Termin von Marco Bianchi');
  said = talk.say('Hat Sandra Meier abgesagt?');
  assert.equal(said.task?.intent, 'appointments');
  assert.match(text(said), /^Sandra Meier hat 2 kommende Termine: Ob etwas abgesagt wurde, sehe ich nicht/);
});

test('finding 1: a statement about a customer is not taken for a correction of the open request either', () => {
  const reports = [
    'Lea Brunner is booked on Tuesday', 'Sandra Meier has cancelled', 'Lea Brunner hat schon gebucht', 'Lea Brunner kommt am Dienstag',
    "Don't book anything on Friday", 'Trag Lea Brunner nicht ein', 'not Lea Brunner',
  ];
  for (const setup of SETUPS.filter(item => item.first)) {
    // While the assistant waits for a detail, a sentence around that detail is an answer
    // ("I think Lea Brunner wanted Tuesday"); with a proposal or a list open it is not a correction.
    const statements = setup.asked ? reports : [...reports, 'Thursday is busy', 'I think Lea Brunner wanted Tuesday'];
    for (const statement of statements) {
      const talk = opened(setup);
      const before = talk.open();
      assert.equal(talk.say(statement).did, 'unclear', `"${statement}" with ${setup.name}`);
      assert.equal(talk.open(), before);
      assert.ok(talk.unchanged());
    }
  }
  // A sentence that answers the assistant's question is still taken as the answer.
  const asked = chat();
  assert.equal(asked.say('Book a haircut tomorrow at 11').reply?.asked, 'customerName');
  assert.equal(asked.say('it is for Lea Brunner').reply?.proposal?.rows[2].value, 'Lea Brunner (in your customer list)');
  // A bare detail still corrects the proposal, and the new one needs its own Confirm.
  const talk = chat();
  talk.say('Book a haircut for Mia Keller tomorrow at 11');
  assert.equal(talk.say('at 12 instead').reply?.proposal?.rows[1].value, 'Tomorrow (Tuesday, 06.10.2026), 12:00–12:30');
  assert.equal(talk.say('for Lea Brunner instead').reply?.proposal?.rows[2].value, 'Lea Brunner (in your customer list)');
  assert.equal(talk.say('lieber am Donnerstag').reply?.proposal?.rows[1].value, 'Donnerstag, 08.10.2026, 12:00–12:30');
  assert.ok(talk.unchanged());
});

test('a detail with a question mark is answered with the facts, and one tap makes the proposal', () => {
  const talk = chat();
  talk.say('Book a haircut for Mia Keller on Wednesday at 10');
  // "And on Friday?" asks; the booking proposal is not moved to Friday behind the owner's back.
  let said = talk.say('And on Friday?');
  assert.equal(said.task?.intent, 'availability');
  assert.equal(said.reply?.proposal, undefined);
  assert.match(text(said), /^Yes\. Friday, 09\.10\.2026 at 10:00 is free for Haircut \(30 min\) with Selina or Luca\.$/);
  assert.deepEqual(labels(said), ['Book this time']);
  said = talk.tap('Book this time');
  assert.deepEqual(said.reply?.proposal?.rows.map(row => row.value).slice(0, 3), ['Haircut (30 min)', 'Friday, 09.10.2026, 10:00–10:30', 'Mia Keller (new customer)']);

  // The same for a cancellation and a closure: the facts, not a second proposal.
  const cancelling = chat();
  cancelling.say('Cancel Marco Bianchi');
  said = cancelling.say('the one on Friday?');
  assert.equal(said.task?.intent, 'appointments');
  assert.deepEqual(said.reply?.list, ['14:00–14:30 · Marco Bianchi · Haircut · Luca Frei']);
  // "Cancel it" then means the appointment that was just looked up.
  assert.equal((cancelling.say('Cancel it').reply?.proposal?.action as { appointmentId: string }).appointmentId, 'cal-fri-2');
  const closing = chat();
  closing.say('Close Friday');
  said = closing.say('und am Donnerstag?');
  assert.equal(said.task?.intent, 'hours');
  assert.deepEqual(said.reply?.text, ['Donnerstag, 08.10.2026: Der Salon ist von 09:00 bis 18:00 Uhr geöffnet.']);

  // After the answer, the change itself can be asked for in a few words: it is about the same day.
  said = closing.say('Then close it');
  assert.deepEqual(said.reply?.proposal?.rows[0], { label: 'When', value: 'Thursday, 08.10.2026, all day' });
  assert.ok(closing.unchanged());

  // Without anything before, a detail with a question mark is not a request.
  assert.equal(chat().say('And on Friday?').did, 'unclear');
  // The one exception: a bare day, time or service that answers what the assistant itself just asked.
  const asked = chat();
  assert.equal(asked.say('Book a haircut for Mia Keller tomorrow').reply?.asked, 'time');
  assert.equal(asked.say('11?').reply?.proposal?.rows[1].value, 'Tomorrow (Tuesday, 06.10.2026), 11:00–11:30');
  // A whole question typed there is still a question.
  const asking = chat();
  asking.say('Book a haircut for Mia Keller tomorrow');
  said = asking.say('Is Lea Brunner booked at 10?');
  assert.equal(said.task?.intent, 'appointments');
  assert.equal(said.reply?.proposal, undefined);

  // Every such detail, with everything that can be open: no proposal, except that one exception.
  const details: [message: string, answers?: string][] = [
    ['and on Friday?'], ['at 12 instead?', 'time'], ['12?', 'time'], ['um 12?', 'time'], ['tomorrow at 12?'], ['Lea Brunner?'], ['Mia Keller?'],
    ['what about Thursday?'], ['und am Donnerstag?'], ['with Luca?'], ['Colouring?'], ['Lea Brunner on Friday?'],
    // German questions open with a verb, which a name could swallow: they stay questions.
    ['Schneidet Luca?'], ['Schneidet Luca am Freitag?'], ['Kommt Mia Keller?'], ['Fehlt Selina?'],
  ];
  for (const setup of SETUPS) {
    for (const [message, answers] of details) {
      const talk = opened(setup);
      const result = talk.say(message);
      const where = `"${message}" with ${setup.name}`;
      if (setup.asked !== undefined && setup.asked === answers) assert.ok(result.reply?.proposal, where);
      else assert.equal(changes(result), false, where);
      assert.ok(talk.unchanged(), where);
    }
  }
  // "Who is the appointment for?" ... "Mia Keller?": the free time is confirmed, one tap books it.
  const forWhom = chat();
  assert.equal(forWhom.say('Book a haircut tomorrow at 11').reply?.asked, 'customerName');
  said = forWhom.say('Mia Keller?');
  assert.equal(said.task?.intent, 'availability');
  assert.deepEqual(labels(said), ['Book this time']);
  assert.equal(forWhom.tap('Book this time').reply?.proposal?.rows[2].value, 'Mia Keller (new customer)');
});

test('finding 2: "Can you tell me ..." asks to be told; only a request for the change itself is a request', () => {
  const asks: [message: string, answer: string][] = [
    ['Can you tell me if Friday is closed?', 'Friday, 09.10.2026: the salon is open from 09:00 to 18:00.'],
    ['Could you check whether we are closed on Friday?', 'Friday, 09.10.2026: the salon is open from 09:00 to 18:00.'],
    ['Can you tell me what time we close on Friday', 'Friday, 09.10.2026: the salon is open from 09:00 to 18:00.'],
    ['Kannst du schauen, ob wir am Freitag geschlossen haben?', 'Freitag, 09.10.2026: Der Salon ist von 09:00 bis 18:00 Uhr geöffnet.'],
    ['Kannst du mir sagen, wann wir am Samstag schliessen?', 'Samstag, 10.10.2026: Der Salon ist geschlossen. Am Samstag ist er nach den Öffnungszeiten immer geschlossen.'],
    ['Could you tell me if we are closed on Wednesday 14 October?', 'Wednesday, 14.10.2026: the salon is closed (closed date “Team day”).'],
  ];
  for (const [message, answer] of asks) {
    const said = chat(withClosedDay()).say(message);
    assert.equal(said.task?.intent, 'hours', message);
    assert.equal(said.reply?.proposal, undefined, message);
    assert.deepEqual(said.reply?.text, [answer], message);
  }
  // The reader itself finds no closure in them, and says that they ask something.
  for (const [message] of asks) {
    const reading = read(message, words());
    assert.equal(reading.request.intent, undefined, message);
    assert.equal(reading.asks, 'hours', message);
  }
  // A polite request is no question: it has no "asks" and names the change.
  for (const [message, intent] of [
    ['Can you book Lea Brunner for a haircut on Friday at 10?', 'book'], ['Könntest du den Freitag schliessen?', 'close'],
    ['Could you close Friday?', 'close'], ['Kannst du den Termin von Lea Brunner am Dienstag absagen?', 'cancel'],
  ]) {
    const reading = read(message, words());
    assert.equal(reading.asks, undefined, message);
    assert.equal(reading.request.intent, intent, message);
  }
});

test('finding 5: a yes with the proposal\'s own instruction confirms it; a yes with a change does not', () => {
  const confirms: [request: string, yes: string, done: RegExp][] = [
    ['Book a haircut for Mia Keller tomorrow at 11', 'Yes, book it', /^Booked: Haircut for Mia Keller tomorrow/],
    ['Book a haircut for Mia Keller tomorrow at 11', 'yes', /^Booked:/],
    ['Book a haircut for Mia Keller tomorrow at 11', 'ok', /^Booked:/],
    ['Book a haircut for Mia Keller tomorrow at 11', 'Ok, go ahead', /^Booked:/],
    ['Book a haircut for Mia Keller tomorrow at 11', 'Yes please, book her in', /^Booked:/],
    ['Trag Mia Keller morgen um 11 Uhr für einen Haarschnitt ein', 'Ja, bitte eintragen', /^Eingetragen: Haircut für Mia Keller morgen/],
    ['Trag Mia Keller morgen um 11 Uhr für einen Haarschnitt ein', 'ja', /^Eingetragen:/],
    ['Trag Mia Keller morgen um 11 Uhr für einen Haarschnitt ein', 'Ja, trag sie ein', /^Eingetragen:/],
    ['Trag Mia Keller morgen um 11 Uhr für einen Haarschnitt ein', 'Ja genau', /^Eingetragen:/],
    ["Cancel Lea Brunner's appointment on Tuesday", 'Yes, cancel it', /^Cancelled: Haircut for Lea Brunner/],
    ['Storniere den Termin von Lea Brunner am Dienstag', 'Ja, bitte absagen', /^Abgesagt: Haircut für Lea Brunner/],
    ['Close Friday', 'Yes, close it', /^Done\. The salon is closed on Friday, 09\.10\.2026\./],
    ['Am Freitag geschlossen', 'Ja, schliessen', /^Erledigt\. Der Salon ist am Freitag, 09\.10\.2026 geschlossen\./],
    ['Open Wednesday 14 October again', 'Yes, open it again', /^Done\. The salon is open again on Wednesday, 14\.10\.2026\.$/],
  ];
  for (const [request, yes, done] of confirms) {
    const talk = chat(withClosedDay());
    assert.ok(talk.say(request).reply?.proposal, request);
    const said = talk.say(yes);
    assert.equal(said.did, 'confirmed', `${request} / ${yes}`);
    assert.match(text(said), done, `${request} / ${yes}`);
    assert.equal(talk.unchanged(), false);
  }

  // A yes followed by something that changes the request: a new proposal, nothing booked yet.
  const talk = chat();
  talk.say('Book a haircut for Mia Keller tomorrow at 11');
  let said = talk.say('Yes, but at 12');
  assert.equal(said.did, 'answered');
  assert.equal(said.reply?.proposal?.rows[1].value, 'Tomorrow (Tuesday, 06.10.2026), 12:00–12:30');
  assert.equal(said.reply?.proposal?.rows[2].value, 'Mia Keller (new customer)');
  assert.ok(talk.unchanged());
  said = talk.say('Yes, book it for Lea Brunner');
  assert.equal(said.reply?.proposal?.rows[2].value, 'Lea Brunner (in your customer list)');
  assert.equal(said.reply?.proposal?.rows[1].value, 'Tomorrow (Tuesday, 06.10.2026), 12:00–12:30');
  assert.ok(talk.unchanged());
  said = talk.say('Ja, aber am Donnerstag');
  assert.equal(said.reply?.proposal?.rows[1].value, 'Donnerstag, 08.10.2026, 12:00–12:30');
  assert.ok(talk.unchanged());
  // Only now a plain yes books it, once, as it was last proposed.
  assert.equal(talk.say('ja').did, 'confirmed');
  assert.deepEqual(talk.state.added.map(event => [event.customerName, event.date, event.startTime]), [['Lea Brunner', THURSDAY, '12:00']]);

  // A yes with another instruction, with a "not", with a question mark or with words that were
  // not understood confirms nothing.
  for (const [message, did] of [
    ['Yes, cancel it', 'answered'], ['Yes, close Friday', 'answered'], ["Yes, don't book it", 'unclear'], ['Yes?', 'unclear'], ['ok?', 'unclear'],
    ['Yes, whatever works for Selina', 'unclear'], ['Yes, is Lea Brunner booked tomorrow?', 'answered'], ['Ja, aber nicht eintragen', 'unclear'],
  ] as const) {
    const other = chat();
    other.say('Book a haircut for Mia Keller tomorrow at 11');
    const result = other.say(message);
    assert.equal(result.did, did, message);
    assert.ok(other.unchanged(), message);
  }
  // Without a proposal a yes runs nothing, and "Yes, book it" starts a booking from the beginning.
  assert.equal(chat().say('yes').did, 'said');
  assert.equal(chat().say('Yes, book it').reply?.asked, 'service');
});

test('finding 5: the proposal\'s own instruction confirms it without a yes too, but only when it points at the proposal', () => {
  const BOOK = 'Book a haircut for Mia Keller tomorrow at 11';
  const BUCHE = 'Trag Mia Keller morgen um 11 Uhr für einen Haarschnitt ein';
  const confirms: [request: string, reply: string, done: RegExp][] = [
    [BOOK, 'Book it', /^Booked: Haircut for Mia Keller tomorrow/], [BOOK, 'Please book it', /^Booked:/], [BOOK, 'Then book it', /^Booked:/],
    [BOOK, 'Book that appointment', /^Booked:/], [BOOK, 'Go ahead and book it', /^Booked:/], [BOOK, 'Schedule it', /^Booked:/],
    [BUCHE, 'Trag es ein', /^Eingetragen: Haircut für Mia Keller morgen/], [BUCHE, 'Bitte eintragen', /^Eingetragen:/],
    [BUCHE, 'Eintragen', /^Eingetragen:/], [BUCHE, 'Dann trag den Termin ein', /^Eingetragen:/],
    ['Close Friday', 'Close it', /^Done\. The salon is closed on Friday, 09\.10\.2026\./],
    ['Am Freitag geschlossen', 'Schliessen', /^Erledigt\. Der Salon ist am Freitag, 09\.10\.2026 geschlossen\./],
    ['Open Wednesday 14 October again', 'Reopen it', /^Done\. The salon is open again on Wednesday, 14\.10\.2026\.$/],
    // More ways of saying yes.
    [BOOK, 'ok thanks', /^Booked:/], [BOOK, 'Yes, thank you', /^Booked:/], [BOOK, 'Sounds good', /^Booked:/], [BOOK, 'Alright', /^Booked:/],
    [BUCHE, 'Ja, danke', /^Eingetragen:/], [BUCHE, 'Ja, passt so', /^Eingetragen:/], [BUCHE, 'Alles klar', /^Eingetragen:/],
    [BOOK, 'Yes, yes, book it', /^Booked:/], [BOOK, 'Hi, book it!', /^Booked:/], ['Close Friday', 'Ok, close the salon', /^Done\./],
    ['Storniere den Termin von Lea Brunner am Dienstag', 'Ja, sag ihn ab', /^Abgesagt: Haircut für Lea Brunner/],
  ];
  for (const [request, reply, done] of confirms) {
    const talk = chat(withClosedDay());
    assert.ok(talk.say(request).reply?.proposal, request);
    const said = talk.say(reply);
    assert.equal(said.did, 'confirmed', `${request} / ${reply}`);
    assert.match(text(said), done, `${request} / ${reply}`);
  }

  // With a detail in it, the instruction is the open request with that change: proposed again, nothing run.
  for (const [reply, row, value] of [
    ['Book it at 12', 1, 'Tomorrow (Tuesday, 06.10.2026), 12:00–12:30'], ['Buch es um 12', 1, 'Morgen (Dienstag, 06.10.2026), 12:00–12:30'],
    ['Book it for Lea Brunner', 2, 'Lea Brunner (in your customer list)'], ['Trag das am Freitag ein', 1, 'Freitag, 09.10.2026, 11:00–11:30'],
    ['Can you book it on Friday instead?', 1, 'Friday, 09.10.2026, 11:00–11:30'],
  ] as const) {
    const talk = chat();
    talk.say(BOOK);
    const said = talk.say(reply);
    assert.equal(said.did, 'answered', reply);
    assert.equal(said.reply?.proposal?.rows[row].value, value, reply);
    // What was not named stays as it was proposed.
    assert.equal(said.reply?.proposal?.rows[0].value, 'Haircut (30 min)', reply);
    if (row !== 2) assert.equal(said.reply?.proposal?.rows[2].value.startsWith('Mia Keller'), true, reply);
    assert.ok(talk.unchanged(), reply);
  }

  // Only an instruction said directly is a go-ahead. Put as a question, as a statement or with a
  // "not", "maybe" or "if" in it, or "Cancel it" in front of a cancellation (which can also mean
  // "leave it"): the proposal is shown once more and only a yes or Confirm runs it.
  const CANCEL = "Cancel Lea Brunner's appointment on Tuesday";
  for (const [request, reply] of [
    [BOOK, 'Can you book it?'], [BOOK, 'Could you book it please'], [BOOK, 'Yes, can you book it?'], [BUCHE, 'Kannst du es eintragen?'],
    ['Close Friday', 'Could you close it?'],
    [BOOK, 'Yes, I will book it'], [BOOK, 'I do not want to book it'], [BOOK, 'Ok, no need to book it'], [BOOK, 'Maybe book it'],
    [BOOK, 'Book it if possible'], [BOOK, 'You can book it'], [BUCHE, 'Ich trage es ein'], ['Close Friday', 'Ok, we should close'],
    ['Close Friday', "Ok, I don't want to close it"], ['Am Freitag geschlossen', 'Ja, wir schliessen'],
    [CANCEL, 'Cancel it'], [CANCEL, 'Delete it'], [CANCEL, 'Ok, cancel'], [CANCEL, 'Can you cancel it?'],
    [CANCEL, 'Yes, there is no need to cancel it'], [CANCEL, 'Yes, he might cancel it'], [CANCEL, "I don't want to cancel it"],
    ['Storniere den Termin von Lea Brunner am Dienstag', 'Absagen'],
  ] as const) {
    const talk = chat();
    const proposed = talk.say(request).reply?.proposal;
    assert.ok(proposed, request);
    const said = talk.say(reply);
    assert.equal(said.did, 'answered', `${request} / ${reply}`);
    assert.equal(said.reply?.text[0], 'once more', `${request} / ${reply}`);
    assert.deepEqual(said.reply?.proposal?.action, proposed.action, `${request} / ${reply}`);
    assert.ok(talk.unchanged(), `${request} / ${reply}`);
    assert.equal(talk.say('yes').did, 'confirmed', `${request} / ${reply}`);
  }
  // "Cancel" alone still means "leave it".
  const left = chat();
  left.say("Cancel Lea Brunner's appointment on Tuesday");
  assert.equal(left.say('Cancel').did, 'dismissed');
  assert.ok(left.unchanged());

  // An instruction that names something new, or a lone "Book" that may have been sent too early,
  // is not about the proposal: a new request starts, and the proposal is never run by it.
  for (const reply of [
    'Book', 'New appointment', 'Book an appointment', 'Yes, new appointment', 'Ok, book another appointment', 'Add a booking',
    'Termin eintragen', 'Neuer Termin', 'Ja, noch einen Termin eintragen', 'Ok, einen Termin eintragen',
    // A name inside the instruction makes it a request about that person, not "Trag ein".
    'Trag Lea Brunner ein', 'Book Lea Brunner', 'Book Sandra Meier in',
  ]) {
    const talk = chat();
    talk.say(BOOK);
    const said = talk.say(reply);
    assert.notEqual(said.did, 'confirmed', reply);
    assert.equal(said.reply?.asked, 'service', reply);
    assert.ok(talk.unchanged(), reply);
  }
  // An instruction for another kind of change does not run the proposal either.
  for (const reply of ['Cancel it', 'Close it', 'Reopen it', 'Schliessen', 'Absagen']) {
    const talk = chat();
    talk.say(BOOK);
    assert.notEqual(talk.say(reply).did, 'confirmed', reply);
    assert.ok(talk.unchanged(), reply);
  }
  // Like a yes, it only runs the proposal when the proposal is what the assistant said last.
  const later = chat();
  later.say(BOOK);
  assert.equal(later.say('What does a haircut cost?').did, 'unclear');
  const again = later.say('Book it');
  assert.equal(again.did, 'answered');
  assert.equal(again.reply?.text[0], 'once more');
  assert.ok(later.unchanged());
  assert.equal(later.say('Book it').did, 'confirmed');
  assert.equal(later.state.added.length, 1);

  // "Ok thanks" is a yes only while something waits for one; otherwise it is a thank-you.
  assert.equal(read('ok thanks', words({ waiting: true })).request.reply, 'yes');
  assert.equal(read('ok thanks', words()).request.reply, 'thanks');
  assert.equal(read('Ja, danke', words()).request.reply, 'thanks');
  assert.equal(read('ok thanks?', words({ waiting: true })).request.reply, 'thanks');
  // How the reader marks these messages. A plain request has none of the marks.
  assert.equal(read('Book it', words()).refers, true);
  assert.equal(read('Can you book it?', words()).direct, undefined);
  assert.equal(read('Please book it', words()).direct, true);
  assert.equal(read('Yes, new appointment', words()).agrees, undefined);
  const plain = read('Book Lea Brunner for a haircut on Friday at 10', words());
  assert.deepEqual([plain.refers, plain.direct, plain.agrees, plain.asks], [undefined, undefined, undefined, undefined]);
  assert.equal(read('Close this Friday', words()).refers, undefined);
  assert.deepEqual([read('Trag Lea Brunner ein', words()).refers, read('Trag Lea Brunner ein', words()).direct], [undefined, undefined]);
  assert.deepEqual([read('I will book it', words()).refers, read('I will book it', words()).direct], [true, undefined]);
  assert.equal(read('Schliess das Geschäft am Freitag', words()).refers, undefined);
  // The pure decision: a question for form never confirms, even as the last thing said.
  const task = { intent: 'book' as const, language: 'en' as const, serviceId: HAIRCUT.id, date: TUESDAY, time: '11:00', customerName: 'Mia Keller' };
  assert.deepEqual(turn(read('Book it', words({ waiting: true })), { task }, { kind: 'book', last: true }), { kind: 'confirm' });
  assert.deepEqual(turn(read('Can you book it?', words({ waiting: true })), { task }, { kind: 'book', last: true }), { kind: 'askAgain', task });
  assert.deepEqual(turn(read('Book it', words({ waiting: true })), { task }, { kind: 'book', last: false }), { kind: 'askAgain', task });
});

test('a typed yes only confirms the proposal when the proposal is what the assistant said last', () => {
  const talk = chat();
  talk.say('Book a haircut for Mia Keller tomorrow at 11');
  // Something else is said in between and not understood: the proposal stays, but ...
  assert.equal(talk.say('What does a haircut cost?').did, 'unclear');
  assert.ok(talk.open());
  // ... an "ok" now may answer that exchange, so the proposal is shown again instead of being run.
  const again = talk.say('ok');
  assert.equal(again.did, 'answered');
  assert.equal(again.reply?.proposal?.title, 'Book appointment');
  assert.ok(talk.unchanged());
  assert.equal(talk.say('ok').did, 'confirmed');
  assert.equal(talk.state.added.length, 1);

  // The same after a "thanks".
  const polite = chat();
  polite.say('Close Friday');
  assert.equal(polite.say('thanks').did, 'said');
  assert.equal(polite.say('Yes, close it').reply?.proposal?.title, 'Close the salon');
  assert.ok(polite.unchanged());
  // The pure decision, as the panel asks for it.
  const reading = read('yes', words({ waiting: true }));
  const task = { intent: 'close' as const, language: 'en' as const, date: FRIDAY };
  assert.deepEqual(turn(reading, { task }, { kind: 'close', last: true }), { kind: 'confirm' });
  assert.deepEqual(turn(reading, { task }, { kind: 'close', last: false }), { kind: 'askAgain', task });
  assert.deepEqual(turn(reading, { task }), { kind: 'say', note: 'nothingOpen', forget: false });
});

test('the AI model\'s answer goes through the same rules: it cannot turn a question into a change', () => {
  const NOTHING = { intent: 'unknown', language: 'en', serviceId: '', employeeId: '', date: '', endDate: '', time: '', customerName: '', scope: '' };

  // Details without an intent do not correct the open request (the suspected defect).
  let talk = chat();
  talk.say('Book a haircut for Mia Keller tomorrow at 11');
  assert.equal(talk.say('Esther Hug, Tuesday, is that right').did, 'unclear');
  assert.equal(talk.model({ ...NOTHING, customerName: 'Esther Hug', date: TUESDAY }).did, 'unclear');
  assert.equal(talk.open()?.rows[2].value, 'Mia Keller (new customer)');
  for (const setup of SETUPS.filter(item => item.first && !item.asked)) {
    const open = opened(setup);
    const before = open.open();
    assert.equal(open.say('Sandra Meier, Thursday, hmm').did, 'unclear');
    assert.equal(open.model({ ...NOTHING, customerName: 'Sandra Meier', date: THURSDAY }).did, 'unclear', setup.name);
    assert.equal(open.open(), before, setup.name);
  }
  // They still count as the answer to the question the assistant just asked.
  talk = chat();
  assert.equal(talk.say('Book a haircut for Mia Keller tomorrow').reply?.asked, 'time');
  assert.equal(talk.say('shortly before lunch I would say').did, 'unclear');
  assert.equal(talk.model({ ...NOTHING, time: '11:30' }).reply?.proposal?.rows[1].value, 'Tomorrow (Tuesday, 06.10.2026), 11:30–12:00');

  // A change the model names for a question is answered as the question it is.
  const modelSays: [question: string, answer: Record<string, string>, answeredWith: string][] = [
    ['Is Esther Hug in for Tuesday then, or what', { intent: 'book', customerName: 'Esther Hug', date: TUESDAY }, 'availability'],
    ['Did Sandra Meier bail on us', { intent: 'cancel', customerName: 'Sandra Meier' }, 'appointments'],
    ['are we shut thursday as well', { intent: 'close', date: THURSDAY }, 'hours'],
    // The word order of a question, without a question mark and not at the start.
    ['Tuesday, are we going to be there or what', { intent: 'close', date: TUESDAY }, 'hours'],
    ['And Sandra Meier, did she drop out', { intent: 'cancel', customerName: 'Sandra Meier' }, 'appointments'],
    ['is the team day on the 14th still on', { intent: 'reopen', date: TEAM_DAY }, 'hours'],
    ['Would Friday at ten work for a trim', { intent: 'book', date: FRIDAY, time: '10:00', serviceId: HAIRCUT.id }, 'availability'],
    ['Wäre Freitag um zehn was für einmal Spitzen', { intent: 'book', language: 'de', date: FRIDAY, time: '10:00', serviceId: HAIRCUT.id }, 'availability'],
  ];
  for (const setup of SETUPS) {
    for (const [question, answer, answeredWith] of modelSays) {
      const open = opened(setup);
      const first = open.say(question);
      const said = first.did === 'unclear' ? open.model({ ...NOTHING, ...answer }) : first;
      const where = `"${question}" with ${setup.name}`;
      assert.equal(changes(said), false, where);
      assert.equal(said.task?.intent, answeredWith, where);
      assert.ok(open.unchanged(), where);
    }
  }
  // The rule is the function's own: whatever request is handed in for a question, no change comes out.
  const question = read('Is Esther Hug booked on Tuesday?', words());
  for (const intent of ['book', 'cancel', 'close', 'reopen'] as const) {
    for (const memory of [{}, { task: { intent, language: 'en' as const, date: FRIDAY, serviceId: HAIRCUT.id, time: '10:00', customerName: 'Mia Keller' } }]) {
      const task = taskFromModel({ language: 'en', intent, date: TUESDAY, time: '11:00', serviceId: HAIRCUT.id, customerName: 'Esther Hug' }, question, memory);
      assert.equal(isChange(task?.intent), false, intent);
      assert.equal(isChange(taskFor(question, memory)?.intent), false, intent);
    }
  }

  // What the model is for still works: a request the built-in reader could not read.
  talk = chat();
  assert.equal(talk.say('Lea Brunner needs to come in on Wednesday at ten for a trim, pop her in').did, 'unclear');
  const booking = talk.model({ ...NOTHING, intent: 'book', customerName: 'Lea Brunner', date: WEDNESDAY, time: '10:00', serviceId: HAIRCUT.id });
  assert.deepEqual(booking.reply?.proposal?.rows.map(row => row.value).slice(0, 3), ['Haircut (30 min)', 'Wednesday, 07.10.2026, 10:00–10:30', 'Lea Brunner (in your customer list)']);
  assert.ok(talk.unchanged());
  // And a question it reads gets its answer.
  talk = chat();
  assert.equal(talk.say('Any chance of colour work on Thursday arvo').did, 'unclear');
  assert.equal(talk.model({ ...NOTHING, intent: 'availability', date: THURSDAY, serviceId: COLOURING.id }).task?.intent, 'availability');

  // One person's time off, read by the model as a closure, does not close the salon.
  talk = chat();
  assert.equal(talk.say("Selina won't be around Friday").did, 'unclear');
  const off = talk.model({ ...NOTHING, intent: 'close', date: FRIDAY });
  assert.equal(off.task?.intent, 'absence');
  assert.equal(off.reply?.proposal, undefined);
  assert.match(text(off), /^I cannot enter time off for Selina\./);
  talk = chat();
  talk.say('The new one is out all of Friday');
  assert.equal(talk.model({ ...NOTHING, intent: 'close', date: FRIDAY, employeeId: LUCA.id }).task?.intent, 'absence');
});

test('what worked before works on the path the panel uses: details one at a time, corrections, follow-ups', () => {
  // The earlier executor tests drive nextTask() directly. The panel goes through turn(), which
  // also knows how the message was put, so the same conversations are replayed here.
  let talk = chat();
  assert.equal(talk.say('Book an appointment').reply?.asked, 'service');
  assert.equal(talk.say('Haircut').reply?.asked, 'date');
  assert.equal(talk.say('tomorrow').reply?.asked, 'time');
  assert.equal(talk.say('9').reply?.asked, 'customerName');
  assert.equal(talk.say('Mia Keller').reply?.proposal?.rows[2].value, 'Mia Keller (new customer)');
  assert.equal(talk.say('yes').did, 'confirmed');
  assert.deepEqual(talk.state.added.map(event => [event.customerName, event.date, event.startTime]), [['Mia Keller', TUESDAY, '09:00']]);

  // A change afterwards changes the proposal.
  talk = chat();
  assert.equal(talk.say('Book Mia Keller for a haircut on Wednesday at 10').reply?.proposal?.rows[1].value, 'Wednesday, 07.10.2026, 10:00–10:30');
  assert.equal(talk.tap('With Luca instead').reply?.proposal?.rows[3].value, 'Luca Frei');
  assert.equal(talk.say('at 11 instead').reply?.proposal?.rows[1].value, 'Wednesday, 07.10.2026, 11:00–11:30');
  assert.equal(talk.say('on Thursday').reply?.proposal?.rows[1].value, 'Thursday, 08.10.2026, 11:00–11:30');
  assert.equal(talk.say('make it at 12').reply?.proposal?.rows[1].value, 'Thursday, 08.10.2026, 12:00–12:30');
  assert.equal(talk.say('at 13 if possible').reply?.proposal?.rows[1].value, 'Thursday, 08.10.2026, 13:00–13:30');
  assert.equal(talk.say('it is for Lea Brunner').reply?.proposal?.rows[2].value, 'Lea Brunner (in your customer list)');
  assert.ok(talk.unchanged());

  // The answer to the open question may be a sentence, and an answer that cannot be read is no answer.
  talk = chat();
  talk.say('Book Mia Keller for a haircut on Wednesday');
  assert.equal(talk.say("let's say 11 if that works for everybody").reply?.proposal?.rows[1].value, 'Wednesday, 07.10.2026, 11:00–11:30');
  talk = chat();
  talk.say('Book Mia Keller for a haircut tomorrow');
  assert.equal(talk.say('whenever you like').did, 'unclear');
  assert.equal(talk.say('never mind').did, 'said');
  assert.equal(talk.say('11').did, 'unclear', 'the half-finished request was dropped');

  // Questions about free times follow each other, and "Book it" takes what was just answered.
  talk = chat();
  talk.say('Is Thursday at 15:00 free for a haircut?');
  assert.match(text(talk.say('And on Friday?')), /^Yes\. Friday, 09\.10\.2026 at 15:00 is free for Haircut/);
  assert.deepEqual(talk.say('Book it for Lea Brunner').reply?.proposal?.rows.map(row => row.value).slice(0, 3),
    ['Haircut (30 min)', 'Friday, 09.10.2026, 15:00–15:30', 'Lea Brunner (in your customer list)']);
  talk = chat();
  talk.say('Do you have anything on Friday for a haircut?');
  assert.match(text(talk.say('Next free time for colouring?')), /^The next free time for Colouring \(90 min\) is today/);
  talk.say('Do you have anything on Friday for a haircut?');
  assert.match(text(talk.say('Is 16:00 free?')), /^Yes\. Friday, 09\.10\.2026 at 16:00 is free for Haircut/);
  talk = chat();
  talk.say('Is Selina free on Thursday at 15:00 for a haircut?');
  assert.match(text(talk.say('Is Friday free?')), /^Friday, 09\.10\.2026: \d+ free times for Haircut \(30 min\) with Selina, /);
  assert.equal(talk.say('Mia Keller would like a haircut at 10:30').did, 'unclear');
  // Without anything before, a detail alone is not a request; after the agenda a name adds nothing.
  assert.equal(chat().say('Friday').did, 'unclear');
  assert.equal(chat().say('Lea Brunner').did, 'unclear');
  talk = chat();
  talk.say("What's on today?");
  assert.equal(talk.say('Lea Brunner').did, 'unclear');
  assert.match(text(talk.say('and tomorrow?')), /^Tomorrow \(Tuesday, 06\.10\.2026\): 1 appointment\.$/);

  // The examples the panel offers to tap: two questions that are answered, two requests that are proposed.
  for (const language of ['en', 'de'] as const) {
    const kinds = assistantExamples(language, salon().services).map(example => {
      const result = chat().say(example);
      assert.equal(result.reply?.language, language, example);
      return result.reply?.proposal?.action.kind ?? result.task?.intent;
    });
    assert.deepEqual(kinds, ['availability', 'book', 'close', 'agenda'], language);
  }

  // German, from the question to the booking.
  talk = chat();
  assert.deepEqual(talk.say('Hast du am Freitag um 15 Uhr etwas frei?').reply?.text, ['Für welche Dienstleistung?']);
  assert.equal(text(talk.say('Haarschnitt')), 'Ja. Freitag, 09.10.2026 um 15:00 Uhr ist frei für Haircut (30 min) bei Selina oder Luca.');
  assert.equal(talk.say('Trag Lea Brunner ein').reply?.proposal?.title, 'Termin eintragen');
  assert.equal(text(talk.say('ja')), 'Eingetragen: Haircut für Lea Brunner am Freitag, 09.10.2026, 15:00–15:30 Uhr, bei Selina Keller.');
  // Closing, reopening and cancelling, each confirmed by a typed yes.
  talk = chat(withClosedDay());
  talk.say('Close Friday');
  assert.match(text(talk.say('yes')), /^Done\. The salon is closed on Friday, 09\.10\.2026\./);
  talk.say('Open Wednesday 14 October again');
  assert.match(text(talk.say('ok')), /^Done\. The salon is open again on Wednesday, 14\.10\.2026\.$/);
  talk.say("Cancel Lea Brunner's appointment on Tuesday.");
  assert.equal(text(talk.say('yes please')), 'Cancelled: Haircut for Lea Brunner tomorrow (Tuesday, 06.10.2026) at 10:00. The time is free again.');
  // "Cancel" and "no" keep everything as it is.
  talk.say('Close Thursday');
  assert.equal(talk.say('Cancel').did, 'dismissed');
  talk.say('Close Thursday');
  assert.equal(talk.say('no thanks').did, 'dismissed');
  assert.equal(talk.state.closures.length, 2, 'only Friday was closed and Wednesday reopened');
});

test('the AI model is told the same rule and may name the three answers that only read', async () => {
  // Loading the instruction needs no key and makes no call: it is the text the route sends along.
  const { ASSISTANT_INSTRUCTION, assistantSchema } = await import('../server/assistant');
  const known = { serviceIds: [HAIRCUT.id], employeeIds: [LUCA.id] };
  for (const intent of ['appointments', 'hours', 'absence']) {
    assert.match(ASSISTANT_INSTRUCTION, new RegExp(`^- ${intent}: `, 'm'), intent);
    assert.ok(assistantSchema.properties.intent.description.includes(intent), intent);
    assert.deepEqual(checkAssistantRequest({ intent }, known), { language: 'en', intent });
  }
  assert.match(ASSISTANT_INSTRUCTION, /A question about something that exists or happened is never book, cancel, close or reopen/);
  assert.match(ASSISTANT_INSTRUCTION, /book, cancel, close and reopen are only for a message that asks for that change to be made/);
  assert.match(ASSISTANT_INSTRUCTION, /One person's day off is absence, never close/);
  // What only the browser may set is still never taken from the model.
  assert.deepEqual(checkAssistantRequest({ intent: 'appointments', cancellations: true, customerName: 'Lea Brunner' }, known, 'en', 'has Lea Brunner cancelled'),
    { language: 'en', intent: 'appointments', customerName: 'Lea Brunner' });
});
