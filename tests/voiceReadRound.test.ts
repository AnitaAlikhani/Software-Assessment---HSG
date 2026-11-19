import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { AiReading, readingProblemText } from '../src/voice/lab/AiReading';
import { describeReading, readRound, textsToRead, type RoundToRead } from '../src/voice/lab/readRound';
import { buildReport, roundFromReport, summarise, type Understanding } from '../src/voice/lab/report';
import { checkSalon } from '../src/voice/lab/salon';
import { LAB_LANGUAGES } from '../src/voice/lab/sentences';
import type { VoiceQuestion } from '../src/voice/question';
import type { RouteAnswer, RouteProblem } from '../src/voice/understand';
import { readableText, render } from './renderHelpers';
import { FIRST_ROUND, FIRST_ROUND_MODEL_ANSWERS } from './voiceFirstRound';

// Opening a saved round and letting the AI reader read it. The round is the first real one
// (tests/voiceFirstRound.ts); the reader is replaced by the answers a model gave for its texts.

const saved = roundFromReport(FIRST_ROUND, LAB_LANGUAGES)!;
const round = (): RoundToRead => ({ pack: LAB_LANGUAGES.en, language: 'en', attempts: saved.attempts, talk: saved.talk, spokenOn: '2026-11-19' });

/** A reader that answers every text of the first round as the model did, and notes what it was asked. */
function modelReader() {
  const asked: { question: VoiceQuestion; key: string }[] = [];
  const waits: number[] = [];
  let clock = 0;
  const keys = textsToRead(round()).map(text => text.key);
  return {
    asked,
    waits,
    options: {
      ask: async (question: VoiceQuestion, key: string): Promise<RouteAnswer> => {
        const text = keys[asked.length];
        asked.push({ question, key });
        clock += 1300;
        return { ok: true, request: FIRST_ROUND_MODEL_ANSWERS[text], modelMs: 900 };
      },
      now: () => clock,
      wait: async (ms: number) => { waits.push(ms); },
      askedAt: '2026-11-19T12:30:00.000Z',
    },
  };
}

test('a saved round opens as it was spoken, also a file of the first shape', () => {
  assert.ok(saved);
  assert.equal(saved.createdAt, '2026-11-19T12:06:17.451Z');
  // Files from before the day was written down: the page takes it from the time of the file.
  assert.equal(saved.spokenOn, '');
  assert.deepEqual(saved.settings, { label: '', language: 'en', locale: 'en-GB', variety: 'standard', noise: 'quiet', microphone: 'built-in', onDevice: false, boost: false });
  assert.match(saved.browser.userAgent, /Chrome\/157/);
  assert.deepEqual(saved.support, { recognition: true, onDevice: true, boost: true });

  assert.equal(Object.keys(saved.attempts).length, 12);
  assert.equal(saved.attempts['en-01'].length, 3);
  assert.equal(saved.attempts['en-01'][0].heard, '');
  assert.deepEqual(saved.attempts['en-01'][0].errors, ['no-speech']);
  assert.equal(saved.attempts['en-01'][0].unfinished, '', 'the first shape did not keep unfinished words');
  assert.equal(saved.attempts['en-01'].at(-1)?.heard, 'do you have anything free on Thursday at 3:00 p.m.');
  assert.equal(saved.attempts['en-01'].at(-1)?.alternatives.length, 2);
  assert.equal(saved.attempts['en-04'][0].heard, 'next Tuesday at 5:45 with Salina');
  assert.ok(saved.attempts['en-02'][0].events.some(event => event.name === 'speechend'));

  // The scores are worked out again from what was heard: the same numbers the round showed that day.
  const summary = summarise(LAB_LANGUAGES.en.sentences, saved.attempts);
  assert.equal(summary.sentencesDone, 12);
  assert.equal(summary.keysFound, 23);
  assert.equal(summary.keysTotal, 29);
  assert.equal(summary.sentencesComplete, 6);

  assert.ok(saved.talk);
  assert.equal(saved.talk.segments.length, 7);
  assert.equal(saved.talk.segments[5].text, 'Leah Bruner thank you');
  assert.match(saved.talk.heard, /^Bella hair salon good morning .* confirm booking$/);
  assert.deepEqual(saved.talk.score.found, [true, true, true, true, true, false, true]);
  assert.equal(saved.talk.durationMs, 39242);
});

test('a file that is no round of the check is not opened', () => {
  const round1 = FIRST_ROUND as Record<string, unknown>;
  for (const value of [null, undefined, 'text', 42, [], {}, { kind: 'something-else' }, { ...round1, kind: 'slotbee' }, { ...round1, createdAt: 'yesterday' }, { ...round1, createdAt: 5 },
    { ...round1, settings: { language: 'fr' } }, { ...round1, settings: null }]) {
    assert.equal(roundFromReport(value, LAB_LANGUAGES), null, JSON.stringify(value)?.slice(0, 50));
  }
});

test('whatever a file holds, only the parts of a round are taken from it, each with its type', () => {
  const odd = roundFromReport({
    kind: 'slotbee-voice-check',
    createdAt: '2026-11-20T08:00:00.000Z',
    spokenOn: '2026-11-20',
    settings: { language: 'de', label: 'x'.repeat(80), locale: 7, variety: 'loud', noise: 'loud', microphone: 'phone', onDevice: 'yes', boost: true, extra: 'ignored' },
    browser: { userAgent: 9, languages: ['de-CH', 4] },
    support: { recognition: 'yes' },
    sentences: [
      { id: 'de-10', attempts: [{ heard: 'Buchung bestätigen', alternatives: [{ text: 'Buchung bestätigen', confidence: '0.9' }, { text: 5 }, 'x'], errors: ['no-speech', 3], events: [{ ms: 5, name: 'start' }, { ms: 'late', name: 'end' }, null], unfinished: 'noch etwas', score: { found: [false] } }, 'not an attempt'] },
      { id: 'de-99', attempts: [{ heard: 'unknown sentence' }] },
      'not a sentence',
    ],
    talk: { segments: [{ ms: 100, text: 'Ein Haarschnitt gern' }, { text: 4 }], durationMs: '5000' },
    understanding: { summary: { right: 99 } },
  }, LAB_LANGUAGES);
  assert.ok(odd);
  assert.equal(odd.spokenOn, '2026-11-20');
  assert.deepEqual(odd.settings, { label: 'x'.repeat(40), language: 'de', locale: 'de-CH', variety: 'standard', noise: 'loud', microphone: 'built-in', onDevice: false, boost: true });
  assert.deepEqual(odd.browser, { userAgent: '', languages: ['de-CH'] });
  assert.deepEqual(odd.support, { recognition: false, onDevice: false, boost: false });
  assert.deepEqual(Object.keys(odd.attempts), ['de-10']);
  const [first, second] = odd.attempts['de-10'];
  assert.equal(first.heard, 'Buchung bestätigen');
  assert.equal(first.unfinished, 'noch etwas');
  assert.deepEqual(first.alternatives, [{ text: 'Buchung bestätigen', confidence: 0.9 }]);
  assert.deepEqual(first.errors, ['no-speech']);
  assert.deepEqual(first.events, [{ ms: 5, name: 'start' }]);
  assert.deepEqual(first.score.found, [true], 'the score comes from what was heard, not from the file');
  assert.equal(second.heard, '');
  assert.deepEqual(odd.talk?.segments, [{ ms: 100, text: 'Ein Haarschnitt gern' }]);
  assert.equal(odd.talk?.durationMs, 5000);

  // A round without a call.
  assert.equal(roundFromReport({ ...(FIRST_ROUND as object), talk: null }, LAB_LANGUAGES)?.talk, null);
});

test('a round that is saved again can be opened again, with the day it was spoken', () => {
  const again = buildReport({
    createdAt: saved.createdAt, spokenOn: '2026-11-19', browser: saved.browser, support: saved.support, settings: saved.settings,
    sentences: LAB_LANGUAGES.en.sentences, attempts: saved.attempts, script: LAB_LANGUAGES.en.talk, talk: saved.talk,
  });
  const reopened = roundFromReport(JSON.parse(JSON.stringify(again)), LAB_LANGUAGES);
  assert.ok(reopened);
  assert.equal(reopened.spokenOn, '2026-11-19');
  assert.deepEqual(reopened.attempts, saved.attempts);
  assert.deepEqual(reopened.talk, saved.talk);
  assert.deepEqual(reopened.settings, saved.settings);
});

test('the reader is given every finished text once, and the call phrase by phrase', () => {
  const texts = textsToRead(round());
  assert.deepEqual(texts.map(text => text.key), ['en-01', 'en-02', 'en-03', 'en-04', 'en-05', 'en-06', 'en-07', 'en-08', 'en-09', 'en-10', 'en-11', 'en-12', 'call-1', 'call-2', 'call-3', 'call-4', 'call-5', 'call-6', 'call-7']);
  // The last try of a sentence, with the other ways the recogniser heard it.
  assert.deepEqual(texts[0].heard, [{ text: 'do you have anything free on Thursday at 3:00 p.m.', alternatives: ['do you have anything free on Thursday at 3:00 p.m.', 'do we have anything free on Thursday at 3:00 p.m.'] }]);
  // The call grows by one phrase each time, and only its end is scored.
  assert.deepEqual(texts[12].heard, [{ text: 'Bella hair salon good morning' }]);
  assert.equal(texts[18].heard.length, 7);
  assert.deepEqual(texts.filter(text => text.key.startsWith('call-') && text.expected !== null).map(text => text.key), ['call-7']);
  // The phone number and the confirming phrase are read but not scored.
  assert.deepEqual(texts.filter(text => !text.key.startsWith('call-') && text.expected === null).map(text => text.key), ['en-07', 'en-10']);

  // A sentence that was skipped, or never got a finished text, is not sent; a round without a call has no call.
  const partial = textsToRead({ ...round(), attempts: { 'en-01': [saved.attempts['en-01'][0]], 'en-05': saved.attempts['en-05'] }, talk: null });
  assert.deepEqual(partial.map(text => text.key), ['en-05']);
});

test('the first real round, read by a model: 27 of 29 details, where the built-in rules get 19', async () => {
  const reader = modelReader();
  const progress: [number, number][] = [];
  const understanding = await readRound(round(), 'owner-key', { ...reader.options, onProgress: (done, total) => progress.push([done, total]) });

  assert.equal(reader.asked.length, 19);
  assert.ok(reader.asked.every(call => call.key === 'owner-key'));
  // What is sent: the heard words, the day of the round, the salon's services and team. No customer.
  const first = reader.asked[0].question;
  assert.deepEqual(first.lines, ['do you have anything free on Thursday at 3:00 p.m.']);
  assert.deepEqual(first.alternatives, ['do we have anything free on Thursday at 3:00 p.m.']);
  assert.equal(first.today, '2026-11-19');
  assert.equal(first.weekday, 'Thursday');
  assert.deepEqual(first.services.map(service => service.name).slice(0, 3), ['Wash & blow-dry', 'Haircut', 'Colouring']);
  assert.deepEqual(first.staff.map(person => person.name), ['Anna Weber', 'Selina Keller', 'Luca Frei']);
  assert.doesNotMatch(JSON.stringify(reader.asked.map(call => call.question)), /Lea Brunner|Girard|cust-/);
  assert.equal(reader.asked.at(-1)?.question.lines.length, 7);
  // A breath between two questions, none before the first.
  assert.deepEqual(reader.waits, Array.from({ length: 18 }, () => 1500));
  assert.deepEqual(progress[0], [0, 19]);
  assert.deepEqual(progress.at(-1), [19, 19]);

  assert.deepEqual(understanding.summary, { right: 27, total: 29, asked: 19, problems: 0, medianMs: 1300, medianModelMs: 900 });
  assert.equal(understanding.askedAt, '2026-11-19T12:30:00.000Z');
  const marks = (key: string) => understanding.sentences[key].score?.fields.map(field => `${field.label}:${field.right ? 'right' : 'wrong'}`);
  // The recogniser's slips the reader repaired ...
  assert.deepEqual(marks('en-02'), ['Day:right', 'Time:right', 'Service:right']);
  assert.equal(understanding.sentences['en-02'].request?.time, '10:30');
  assert.deepEqual(marks('en-03'), ['Day:right', 'Time:right', 'Service:right']);
  assert.deepEqual(marks('en-06'), ['Customer:right']);
  assert.equal(understanding.sentences['en-06'].score?.fields[0].got, 'Leah Brunner (found: Lea Brunner)');
  assert.deepEqual(marks('en-08'), ['Day:right', 'Time:right', 'Customer:right']);
  assert.deepEqual(marks('en-12'), ['Nothing to note:right']);
  assert.equal(understanding.sentences['en-12'].request, null);
  // ... and the two it could not: what the recogniser never wrote down cannot be read.
  assert.deepEqual(marks('en-04'), ['Day:right', 'Time:wrong', 'With:right']);
  assert.deepEqual(marks('en-11'), ['Day:right', 'Time:wrong']);
  // Not scored, but read.
  assert.equal(understanding.sentences['en-07'].score, null);
  assert.equal(understanding.sentences['en-10'].score, null);

  // The call: the reading grows with every phrase and ends on what was agreed.
  assert.equal(understanding.call.length, 7);
  assert.equal(understanding.call[0].request, null);
  assert.equal(understanding.call[2].request?.time, '15:00');
  assert.equal(understanding.call[3].request?.time, '15:30');
  assert.deepEqual(understanding.call.map(reading => reading.score === null), [true, true, true, true, true, true, false]);
  assert.deepEqual(understanding.call[6].score?.fields.map(field => field.right), [true, true, true, true]);
  assert.equal(describeReading(understanding.call[6].request), 'book · Thu, 26.11.2026 · 15:30 · Haircut · for Leah Bruner');
  assert.equal(describeReading(null), 'nothing to note');
  assert.equal(describeReading(understanding.sentences['en-05'].request), 'availability · Sat, 21.11.2026 · afternoon · with Luca Frei');

  // It all goes into the file that is sent back.
  const report = buildReport({
    createdAt: saved.createdAt, spokenOn: '2026-11-19', browser: saved.browser, support: saved.support, settings: saved.settings,
    sentences: LAB_LANGUAGES.en.sentences, attempts: saved.attempts, script: LAB_LANGUAGES.en.talk, talk: saved.talk, understanding,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(report)).understanding.summary, understanding.summary);
});

test('a reader that cannot be reached at all is asked once; other problems do not end the round', async () => {
  for (const problem of ['no-server', 'no-access'] as RouteProblem[]) {
    let asked = 0;
    const understanding = await readRound(round(), 'owner-key', { ask: async () => { asked += 1; return { ok: false, problem }; }, wait: async () => {}, now: () => 0 });
    assert.equal(asked, 1, problem);
    assert.deepEqual(understanding.summary, { right: 0, total: 0, asked: 1, problems: 1, medianMs: null, medianModelMs: null });
    assert.equal(understanding.sentences['en-01'].problem, problem);
    assert.equal(understanding.sentences['en-01'].score, null);
  }
  // One answer that fails or is late leaves the rest of the round to be read.
  const reader = modelReader();
  let call = 0;
  const understanding = await readRound(round(), 'owner-key', {
    ...reader.options,
    ask: async (question, key) => (++call === 2 ? (reader.asked.push({ question, key }), { ok: false, problem: 'failed' }) : call === 3 ? (reader.asked.push({ question, key }), { ok: false, problem: 'too-slow' }) : reader.options.ask(question, key)),
  });
  assert.equal(understanding.summary.asked, 19);
  assert.equal(understanding.summary.problems, 2);
  assert.equal(understanding.sentences['en-02'].problem, 'failed');
  assert.equal(understanding.sentences['en-03'].problem, 'too-slow');
  // The two unread sentences are simply not counted: 29 details less their six.
  assert.equal(understanding.summary.total, 23);
  assert.equal(understanding.summary.right, 21);
});

// ---------- the page ----------

const noRead = async (): Promise<Understanding> => { throw new Error('not asked in this test'); };
const section = (props: Partial<Parameters<typeof AiReading>[0]>) =>
  render(createElement(AiReading, { round: round(), liveKey: null, value: null, onChange: () => {}, read: noRead, ...props }));

test('without the owner link the page says what is needed and offers nothing to press', () => {
  const html = section({});
  assert.match(readableText(html), /This part needs the owner link/);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(readableText(html), /Gemini/);
});

test('with the owner link it says what will be sent before anything is sent', () => {
  const html = section({ liveKey: 'owner-key' });
  const text = readableText(html);
  assert.match(html, /<button[^>]*>.*Let the AI read this round<\/button>/s);
  assert.match(text, /Only the texts are sent/);
  assert.match(text, /Google&#x27;s AI service Gemini|Google's AI service Gemini/);
  assert.match(text, /No sound is sent, and no customer and no appointment\./);
  assert.doesNotMatch(text, /Details the AI got right/);
  // A round with nothing in it has nothing to read.
  assert.match(section({ liveKey: 'owner-key', round: { ...round(), attempts: {}, talk: null } }), /<button[^>]*disabled=""/);
});

test('the readings are shown with every detail marked, and the waits in seconds', async () => {
  const reader = modelReader();
  const understanding = await readRound(round(), 'owner-key', reader.options);
  const html = section({ liveKey: 'owner-key', value: understanding });
  const text = readableText(html).replace(/\s+/g, ' ');
  assert.match(text, /Details the AI got right 27 of 29 in 19 texts/);
  assert.match(text, /Wait for an answer 1\.3 s/);
  assert.match(text, /Of that, the AI service 0\.9 s/);
  assert.match(text, /Heard: next Tuesday at 5:45 with Salina/);
  assert.match(text, /Time: 17:45 \(should be 15:45\) wrong/);
  assert.match(text, /With: Selina Keller right/);
  assert.match(text, /Customer: Leah Brunner \(found: Lea Brunner\) right/);
  assert.match(text, /The short call, phrase by phrase/);
  assert.match(text, /The AI read: book · Thu, 26\.11\.2026 · 15:30 · Haircut · for Leah Bruner \(1\.3 s\)/);
  assert.match(html, /Let the AI read it again/);
});

test('a reader that cannot be reached is explained once, instead of nineteen times', async () => {
  for (const [problem, words] of [['no-server', /has no SlotBee server behind it/], ['no-access', /owner key in this browser was not accepted/]] as const) {
    const understanding = await readRound(round(), 'owner-key', { ask: async () => ({ ok: false, problem }), wait: async () => {}, now: () => 0 });
    const text = readableText(section({ liveKey: 'owner-key', value: understanding }));
    assert.match(text, words);
    assert.equal(text.split(readingProblemText(problem)).length, 2, problem);
    assert.doesNotMatch(text, /Details the AI got right/);
  }
  for (const problem of ['no-server', 'no-access', 'refused', 'failed', 'too-slow', 'offline'] as RouteProblem[]) assert.ok(readingProblemText(problem).length > 20, problem);
});

test('the salon of the check never changes under a round: the names the scores rest on are there', () => {
  const { services, employees } = checkSalon();
  assert.deepEqual(services.slice(1, 3).map(service => service.name), ['Haircut', 'Colouring']);
  assert.deepEqual(employees.map(employee => employee.name.split(' ')[0]), ['Anna', 'Selina', 'Luca']);
});
