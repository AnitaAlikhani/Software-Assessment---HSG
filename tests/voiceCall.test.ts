import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { answer } from '../src/assistant/execute';
import type { AssistantTask } from '../src/assistant/types';
import { getAvailableSlots } from '../src/availability';
import { addDays, getSalonNow } from '../src/scheduling';
import { CALL_INTENTS, confirmationIn, createCall, wordedForCall, type CallState } from '../src/voice/live/call';
import { CALL_CUSTOMER, createDesk } from '../src/voice/live/desk';
import LiveCall, { ANSWER_LIMIT_MS, listeningProblem, readingProblem } from '../src/voice/live/LiveCall';
import type { VoiceQuestion } from '../src/voice/question';
import type { RouteAnswer } from '../src/voice/understand';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// The live call (voice-call.html): phrases go to the AI reader, the answer comes from the
// calendar through the assistant's rules, and a booking needs a confirmation.

const root = path.resolve(import.meta.dirname, '..');
/** A Tuesday morning in the salon, so the days ahead are open. */
const NOW = new Date('2026-11-17T08:00:00.000Z');
const HAIRCUT = 'srv-2';
const ANNA = 'emp-1';

const turn = () => new Promise<void>(resolve => { setImmediate(resolve); });

/** A call whose AI reader answers what the test hands it, when the test says so. */
function callWith(language: 'en' | 'de' = 'en') {
  let made = 0;
  const desk = createDesk(() => NOW, () => { made += 1; return `cal-new-${made}`; });
  const asked: { question: VoiceQuestion; answer: (value: RouteAnswer) => void }[] = [];
  const states: CallState[] = [];
  let clock = 0;
  const call = createCall({
    desk,
    language,
    ask: question => new Promise<RouteAnswer>(resolve => { asked.push({ question, answer: resolve }); }),
    onChange: state => { states.push(state); },
    now: () => NOW,
    elapsed: () => clock,
  });
  const reads = async (index: number, request: object | null, waitMs = 1200) => {
    clock += waitMs;
    asked[index].answer({ ok: true, request, modelMs: waitMs - 100 });
    await turn();
  };
  return { call, desk, asked, states, reads, today: getSalonNow(desk.timeZone, NOW).date };
}

/** The first day from tomorrow on with a free time for a haircut with Anna, and that time. */
function freeHaircut(desk: ReturnType<typeof createDesk>, today: string): { date: string; time: string } {
  for (let offset = 1; offset < 14; offset += 1) {
    const date = addDays(today, offset);
    const slots = getAvailableSlots(desk.data(NOW), { date, serviceId: HAIRCUT, employeeId: ANNA, mode: 'owner' });
    if (slots.length > 0) return { date, time: slots[0] };
  }
  throw new Error('no free time in two weeks');
}

// ---------- spoken confirmation ----------

test('only a phrase that is the command and nothing else confirms', () => {
  assert.equal(confirmationIn('confirm booking'), 'book');
  assert.equal(confirmationIn('Okay, confirm the booking, please.'), 'book');
  assert.equal(confirmationIn('Buchung bestätigen'), 'book');
  assert.equal(confirmationIn('Ja, den Termin bestätigen bitte'), 'book');
  assert.equal(confirmationIn('confirm cancellation'), 'cancel');
  assert.equal(confirmationIn('Absage bestätigen'), 'cancel');
  // The recogniser's second guess counts when the first one is off.
  assert.equal(confirmationIn('can firm booking', ['confirm booking']), 'book');

  assert.equal(confirmationIn('I will confirm the booking by e-mail'), null);
  assert.equal(confirmationIn('can you confirm booking for Friday'), null);
  assert.equal(confirmationIn('book it'), null);
  assert.equal(confirmationIn('yes please'), null);
  assert.equal(confirmationIn(''), null);
});

// ---------- the calendar of the page ----------

test('the page answers from a copy of the salon with the customer of the example call', () => {
  const desk = createDesk(() => NOW);
  const data = desk.data();
  assert.ok(data.services.some(service => service.id === HAIRCUT && service.name === 'Haircut'));
  assert.ok(data.employees.some(employee => employee.id === ANNA));
  assert.ok(data.events.length > 50, 'the calendar has appointments, so some times are taken');
  assert.equal(data.customers.filter(customer => customer.name === CALL_CUSTOMER.name).length, 1);
  assert.equal(data.now, NOW);
  assert.equal(desk.canUndo(), false);
});

test('an appointment goes through the booking rules, and the newest change can be taken back', () => {
  let made = 0;
  const desk = createDesk(() => NOW, () => { made += 1; return `cal-new-${made}`; });
  const today = getSalonNow(desk.timeZone, NOW).date;
  const { date, time } = freeHaircut(desk, today);
  const before = desk.data().events.length;
  const reply = answer({ intent: 'book', language: 'en', serviceId: HAIRCUT, employeeId: ANNA, date, time, customerName: CALL_CUSTOMER.name }, desk.data());
  assert.ok(reply.proposal && reply.proposal.action.kind === 'book');
  const event = reply.proposal.action.event;

  assert.equal(desk.handlers.addEvent(event), null);
  assert.equal(desk.data().events.length, before + 1);
  assert.equal(desk.data().events.at(-1)?.id, 'cal-new-1');
  // The same time once more is refused by the rules, as on the Calendar page.
  assert.match(desk.handlers.addEvent(event) ?? '', /not available/);
  assert.equal(desk.data().events.length, before + 1);

  assert.equal(desk.undo()?.kind, 'added');
  assert.equal(desk.data().events.length, before);
  assert.equal(desk.undo(), null);

  const existing = desk.data().events[0];
  desk.handlers.deleteEvent(existing.id);
  assert.equal(desk.data().events.length, before - 1);
  assert.equal(desk.undo()?.kind, 'removed');
  assert.ok(desk.data().events.some(item => item.id === existing.id));
});

// ---------- a call ----------

test('each phrase asks the reader about the call so far, and the calendar answers', async () => {
  const { call, desk, asked, reads, today } = callWith();
  const { date, time } = freeHaircut(desk, today);

  call.heard({ text: '  a haircut   sure ' });
  assert.equal(call.state().lines[0].text, 'a haircut sure');
  assert.deepEqual(call.state().lines[0].outcome, { state: 'reading' });
  assert.deepEqual(asked[0].question.lines, ['a haircut sure']);
  assert.equal(asked[0].question.today, today);
  assert.ok(asked[0].question.services.some(service => service.id === HAIRCUT));
  assert.deepEqual(Object.keys(asked[0].question).sort(), ['alternatives', 'language', 'lines', 'services', 'staff', 'timeZone', 'today', 'weekday'], 'no customer and no appointment leaves the page');

  await reads(0, { intent: 'availability', language: 'en', serviceId: HAIRCUT });
  assert.deepEqual(call.state().lines[0].outcome, { state: 'read', waitMs: 1200, modelMs: 1100, noted: true, shown: true });
  assert.equal(call.state().understood?.request.serviceId, HAIRCUT);
  assert.match(call.state().reply?.text[0] ?? '', /^The next free time for Haircut/);

  call.heard({ text: 'with Anna at that time let me check', alternatives: ['with Hannah at that time let me check', 'with Anna at that time let me check'] });
  assert.deepEqual(asked[1].question.lines, ['a haircut sure', 'with Anna at that time let me check']);
  assert.deepEqual(asked[1].question.alternatives, ['with Hannah at that time let me check']);
  const task: AssistantTask = { intent: 'availability', language: 'en', serviceId: HAIRCUT, employeeId: ANNA, date, time };
  await reads(1, task, 900);
  assert.deepEqual(call.state().reply?.text, wordedForCall(answer(task, desk.data(NOW))).text);
  assert.match(call.state().reply?.text[0] ?? '', /^Yes\./);
  assert.equal(call.state().proposal, 'none');
});

test('a heard name is matched to the customer list before the calendar is asked', async () => {
  const { call, asked, reads, desk, today } = callWith();
  const { date, time } = freeHaircut(desk, today);
  call.heard({ text: 'Leah Bruner thank you' });
  await reads(0, { intent: 'book', language: 'en', serviceId: HAIRCUT, employeeId: ANNA, date, time, customerName: 'Leah Bruner' });
  const understood = call.state().understood;
  assert.equal(understood?.request.customerName, CALL_CUSTOMER.name);
  assert.equal(understood?.request.customerId, CALL_CUSTOMER.id);
  assert.equal(understood?.heardName, 'Leah Bruner');
  assert.equal(call.state().proposal, 'open');
  assert.ok(call.state().reply?.proposal?.rows.some(row => row.value.includes('Lea Brunner (in your customer list)')));
  assert.equal(asked.length, 1);
});

test('a name nobody in the list fits stays as it was heard, as a new customer', async () => {
  const { call, reads, desk, today } = callWith();
  const { date, time } = freeHaircut(desk, today);
  call.heard({ text: 'for Zorana Petkovic please' });
  await reads(0, { intent: 'book', language: 'en', serviceId: HAIRCUT, employeeId: ANNA, date, time, customerName: 'Zorana Petkovic' });
  assert.equal(call.state().understood?.request.customerName, 'Zorana Petkovic');
  assert.equal(call.state().understood?.heardName, undefined);
  assert.ok(call.state().reply?.proposal?.rows.some(row => row.value.includes('new customer')));
});

test('a booking waits for the button or the spoken confirmation, and can be taken back', async () => {
  const { call, asked, reads, desk, today } = callWith();
  const { date, time } = freeHaircut(desk, today);
  const before = desk.data().events.length;
  call.heard({ text: 'I will put you down Lea Brunner' });
  await reads(0, { intent: 'book', language: 'en', serviceId: HAIRCUT, employeeId: ANNA, date, time, customerName: 'Lea Brunner' });
  assert.equal(call.state().proposal, 'open');
  assert.equal(call.state().reply?.text[0], 'Ready to book. Say "confirm booking" or press Confirm.');
  assert.equal(desk.data().events.length, before, 'nothing is entered before the confirmation');

  call.heard({ text: 'Okay, confirm booking.' });
  assert.equal(asked.length, 1, 'the confirmation does not wait for the AI reader');
  assert.deepEqual(call.state().lines[1].outcome, { state: 'confirmed' });
  assert.equal(call.state().proposal, 'confirmed');
  assert.equal(call.state().reply?.tone, 'success');
  assert.match(call.state().reply?.text[0] ?? '', /^Booked: Haircut for Lea Brunner/);
  assert.equal(desk.data().events.length, before + 1);
  assert.equal(call.state().canUndo, true);

  // The call goes on with a clean sheet: the next phrase is read on its own.
  call.heard({ text: 'thank you goodbye' });
  assert.deepEqual(asked[1].question.lines, ['thank you goodbye']);
  await reads(1, null);
  assert.deepEqual(call.state().lines[2].outcome, { state: 'read', waitMs: 1200, modelMs: 1100, noted: false, shown: false });
  assert.equal(call.state().proposal, 'confirmed', 'a phrase with nothing to note leaves the answer on screen');

  call.undo();
  assert.equal(desk.data().events.length, before);
  assert.equal(call.state().canUndo, false);
  assert.equal(call.state().reply?.text[0], 'Taken back: the appointment is out of the calendar again.');
});

test('"confirm booking" said before the booking was worked out enters it when the reading arrives', async () => {
  const { call, asked, reads, desk, today } = callWith();
  const { date, time } = freeHaircut(desk, today);
  const before = desk.data().events.length;
  call.heard({ text: 'Lea Brunner thank you' });
  call.heard({ text: 'confirm booking' });
  assert.equal(asked.length, 2, 'no booking waits yet, so the reader is asked');
  const booking = { intent: 'book', language: 'en', serviceId: HAIRCUT, employeeId: ANNA, date, time, customerName: 'Lea Brunner' };
  await reads(1, booking);
  assert.equal(call.state().proposal, 'confirmed');
  assert.equal(desk.data().events.length, before + 1);
  // The answer to the earlier phrase arrives late and changes nothing any more.
  await reads(0, booking);
  assert.equal(desk.data().events.length, before + 1);
  assert.equal(call.state().proposal, 'confirmed');
});

test('a spoken confirmation is dropped when the owner says something else before its reading arrives', async () => {
  const { call, reads, desk, today } = callWith();
  const { date, time } = freeHaircut(desk, today);
  const before = desk.data().events.length;
  call.heard({ text: 'for Lea Brunner' });
  call.heard({ text: 'confirm booking' });
  call.heard({ text: 'no wait make it with Anna' });
  const booking = { intent: 'book', language: 'en', serviceId: HAIRCUT, employeeId: ANNA, date, time, customerName: 'Lea Brunner' };
  await reads(2, booking);
  assert.equal(call.state().proposal, 'open', 'the newer phrase came after the confirmation, so the booking waits');
  await reads(1, booking);
  assert.equal(call.state().proposal, 'open');
  assert.equal(desk.data().events.length, before);
  call.dismiss();
  assert.equal(call.state().proposal, 'dismissed');
  call.confirm();
  assert.equal(desk.data().events.length, before, 'a booking that was set aside is not entered');
});

test('a booking the rules warn about is not entered by voice alone', async () => {
  const { call, reads, desk, today } = callWith();
  const { date, time } = freeHaircut(desk, today);
  const first = answer({ intent: 'book', language: 'en', serviceId: HAIRCUT, employeeId: ANNA, date, time, customerName: 'Lea Brunner' }, desk.data(NOW));
  assert.ok(first.proposal && first.proposal.action.kind === 'book');
  assert.equal(desk.handlers.addEvent(first.proposal.action.event), null);
  const later = getAvailableSlots(desk.data(NOW), { date, serviceId: HAIRCUT, employeeId: ANNA, mode: 'owner' })[0];
  const before = desk.data().events.length;

  call.heard({ text: 'Lea Brunner once more' });
  call.heard({ text: 'confirm booking' });
  await reads(1, { intent: 'book', language: 'en', serviceId: HAIRCUT, employeeId: ANNA, date, time: later, customerName: 'Lea Brunner' });
  assert.equal(call.state().proposal, 'open');
  assert.match(call.state().reply?.proposal?.warnings[0] ?? '', /already has an appointment that day/);
  assert.equal(desk.data().events.length, before);
  // Said again with the warning on screen, it is carried out.
  call.heard({ text: 'confirm booking' });
  assert.equal(call.state().proposal, 'confirmed');
  assert.equal(desk.data().events.length, before + 1);
});

test('the newest reading stays on screen when an older answer arrives late', async () => {
  const { call, reads, desk, today } = callWith();
  const { date, time } = freeHaircut(desk, today);
  call.heard({ text: 'a haircut' });
  call.heard({ text: 'tomorrow with Anna' });
  await reads(1, { intent: 'availability', language: 'en', serviceId: HAIRCUT, employeeId: ANNA, date, time });
  assert.equal(call.state().understood?.line, 2);
  await reads(0, { intent: 'availability', language: 'en', serviceId: HAIRCUT }, 5000);
  assert.equal(call.state().understood?.line, 2);
  assert.equal(call.state().understood?.request.date, date);
  assert.deepEqual(call.state().lines[0].outcome, { state: 'read', waitMs: 6200, modelMs: 4900, noted: true, shown: false });
});

test('a phrase without an answer is marked, and what was on screen stays', async () => {
  const { call, asked, reads } = callWith();
  call.heard({ text: 'a haircut' });
  await reads(0, { intent: 'availability', language: 'en', serviceId: HAIRCUT });
  const shown = call.state().reply;
  call.heard({ text: 'one moment' });
  asked[1].answer({ ok: false, problem: 'too-slow' });
  await turn();
  assert.deepEqual(call.state().lines[1].outcome, { state: 'problem', problem: 'too-slow', waitMs: 0 });
  assert.equal(call.state().reply, shown);
});

test('a call never closes the salon or reads out the day, whatever the reader returns', async () => {
  const { call, reads, today } = callWith();
  assert.deepEqual([...CALL_INTENTS].sort(), ['appointments', 'availability', 'book', 'cancel', 'hours']);
  call.heard({ text: 'close the salon tomorrow' });
  await reads(0, { intent: 'close', language: 'en', date: addDays(today, 1) });
  assert.equal(call.state().reply, null);
  assert.deepEqual(call.state().lines[0].outcome, { state: 'read', waitMs: 1200, modelMs: 1100, noted: false, shown: false });
  // Details without a named wish are a question about free times.
  call.heard({ text: 'a haircut' });
  await reads(1, { intent: 'unknown', language: 'en', serviceId: HAIRCUT });
  assert.equal(call.state().understood?.request.intent, 'availability');
});

test('a new call forgets the phrases, keeps the calendar and drops answers that come too late', async () => {
  const { call, asked, reads, desk } = callWith();
  const events = desk.data().events.length;
  call.heard({ text: 'a haircut' });
  call.clear();
  assert.deepEqual(call.state().lines, []);
  await reads(0, { intent: 'availability', language: 'en', serviceId: HAIRCUT });
  assert.equal(call.state().reply, null);
  assert.deepEqual(call.state().lines, []);
  call.heard({ text: 'a colouring' });
  assert.equal(call.state().lines[0].id, 1);
  assert.deepEqual(asked[1].question.lines, ['a colouring']);
  assert.equal(desk.data().events.length, events);
});

test('a German call is answered in German', async () => {
  const { call, asked, reads, desk, today } = callWith('de');
  const { date, time } = freeHaircut(desk, today);
  call.heard({ text: 'einen Haarschnitt für Lea Brunner gern' });
  assert.equal(asked[0].question.language, 'de');
  await reads(0, { intent: 'book', language: 'de', serviceId: HAIRCUT, employeeId: ANNA, date, time, customerName: 'Lea Brunner' });
  assert.equal(call.state().reply?.text[0], 'Bereit zum Eintragen. Sag «Buchung bestätigen» oder drücke Bestätigen.');
  call.heard({ text: 'Buchung bestätigen' });
  assert.match(call.state().reply?.text[0] ?? '', /^Eingetragen: Haircut für Lea Brunner/);
});

test('answers on the phone never speak of tapping or typing', () => {
  const desk = createDesk(() => NOW);
  const today = getSalonNow(desk.timeZone, NOW).date;
  const { date, time } = freeHaircut(desk, today);
  const taken = desk.data().events.find(event => event.date > today && event.employeeId === ANNA);
  assert.ok(taken);
  const requests: Omit<AssistantTask, 'language'>[] = [
    { intent: 'availability', serviceId: HAIRCUT },
    { intent: 'availability', serviceId: HAIRCUT, date },
    { intent: 'availability', serviceId: HAIRCUT, date, time },
    { intent: 'availability', serviceId: taken.serviceId, employeeId: ANNA, date: taken.date, time: taken.startTime },
    { intent: 'availability' },
    { intent: 'book', serviceId: HAIRCUT, date },
    { intent: 'book', serviceId: HAIRCUT, date, time },
    { intent: 'book', serviceId: HAIRCUT, employeeId: ANNA, date, time, customerName: 'Lea Brunner' },
    { intent: 'book', serviceId: HAIRCUT, employeeId: ANNA, date, time, customerName: 'Brunner' },
    { intent: 'cancel' },
    { intent: 'cancel', customerName: taken.customerName },
    { intent: 'hours', date },
    { intent: 'appointments', customerName: taken.customerName },
  ];
  for (const language of ['en', 'de'] as const) {
    for (const request of requests) {
      const text = wordedForCall(answer({ ...request, language }, desk.data(NOW))).text.join(' ');
      assert.doesNotMatch(text, /\b(tap|type|typed|antippen|eingeben|tippe|gib)\b/i, `${language} ${JSON.stringify(request)}: ${text}`);
      assert.doesNotMatch(text, /Shall I|Soll ich/, text);
    }
  }
});

// ---------- the page ----------

test('the live call page says what it does, who hears what, and that its calendar is a copy', () => {
  const html = render(createElement(LiveCall, { speech: {} }));
  const text = readableText(html);
  assert.match(text, /Live call/);
  assert.match(text, /You only speak your own side/);
  assert.match(text, /Google&#x27;s AI service Gemini|Google's AI service Gemini/);
  assert.match(text, /The customer list and the calendar stay in this page/);
  assert.match(text, /appears nowhere else and is gone when the page is reloaded/);
  assert.match(text, /Start listening/);
  assert.match(text, /Or type a phrase/);
  assert.match(text, /This browser has no owner key yet/);
  assert.match(text, /Confirm booking\./, 'the lines to try end with the spoken confirmation');
  assert.doesNotMatch(text, TELL_WORDS);
  assert.doesNotMatch(text, /undefined|NaN|\[object/);
  // Without speech recognition the page says so and still takes typed phrases.
  assert.match(text, /This browser has no speech recognition\. Please open this page in Chrome, Edge or Safari, or type the phrases below\./);
  assert.match(html, /<button[^>]*disabled=""[^>]*>.*?Start listening<\/button>/s);
});

test('problems are told in plain words', () => {
  assert.equal(listeningProblem([], false), null);
  assert.equal(listeningProblem(['no-speech'], true), null, 'a pause in a call is not a problem');
  assert.match(listeningProblem(['not-allowed'], false) ?? '', /did not allow the microphone/);
  assert.match(listeningProblem(['network'], true) ?? '', /speech service/);
  assert.match(listeningProblem(['aborted'], false) ?? '', /Listening never began/);
  assert.equal(readingProblem('too-slow'), `no answer within ${ANSWER_LIMIT_MS / 1000} seconds`);
  assert.equal(readingProblem('no-access'), 'the owner key was not accepted');
  for (const problem of ['no-server', 'no-access', 'refused', 'failed', 'too-slow', 'offline'] as const) {
    assert.ok(readingProblem(problem).length > 10, problem);
  }
});

test('the page of the live call loads everything from the app itself and is part of the build', () => {
  const html = readFileSync(path.join(root, 'voice-call.html'), 'utf8');
  const addresses = [...html.matchAll(/<(?:link|script)\b[^>]*?\s(?:href|src)="([^"]*)"/g)].map(match => match[1]);
  assert.ok(addresses.includes('/src/voice/live/main.tsx'));
  for (const address of addresses) {
    assert.match(address, /^\/(?!\/)/, address);
    assert.ok(existsSync(path.join(root, address.startsWith('/src/') ? address.slice(1) : `public${address}`)), `${address} exists`);
  }
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.doesNotMatch(html, /rel="manifest"/);
  assert.match(readFileSync(path.join(root, 'vite.config.ts'), 'utf8'), /'voice-call':[^\n]*'voice-call\.html'/);
});

test('the live call is written without long dashes', () => {
  // The two characters are built from their numbers, so this file holds none either.
  const LONG_DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  for (const file of ['voice-call.html', 'src/voice/live/call.ts', 'src/voice/live/desk.ts', 'src/voice/live/LiveCall.tsx', 'src/voice/live/main.tsx', 'tests/voiceCall.test.ts']) {
    assert.doesNotMatch(readFileSync(path.join(root, file), 'utf8'), LONG_DASHES, file);
  }
});
