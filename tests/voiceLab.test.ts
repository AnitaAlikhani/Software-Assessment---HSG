import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { attemptFrom, buildReport, median, reportFileName, summarise, talkFrom, timingsOf, type Attempt, type LabSettings, type Recording } from '../src/voice/lab/report';
import { hears, scoreSentence, simplify, wordErrors, type LabSentence } from '../src/voice/lab/score';
import { LAB_LANGUAGES, type LabLanguage } from '../src/voice/lab/sentences';
import VoiceLab, { opened, problemText } from '../src/voice/lab/VoiceLab';
import type { RecognitionConstructor } from '../src/voice/transcriber';
import { readableText, render } from './renderHelpers';

// The voice check (voice-lab.html): what counts as "the detail arrived", how a round is summed
// up, and what the page says before anyone has spoken.

const root = path.resolve(import.meta.dirname, '..');
const languages = Object.keys(LAB_LANGUAGES) as LabLanguage[];
const sentence = (id: string): LabSentence => {
  const found = languages.flatMap(language => LAB_LANGUAGES[language].sentences).find(item => item.id === id);
  assert.ok(found, id);
  return found;
};

// ---------- what counts as heard ----------

test('texts are compared without case and punctuation, but with their umlauts', () => {
  assert.equal(simplify('Do we have anything free on Thursday at 3:00 p.m.?'), 'do we have anything free on thursday at 3:00 pm');
  assert.equal(simplify('At 3 PM. Or 3 P.M., or 3pm!'), 'at 3 pm or 3 pm or 3pm');
  assert.equal(simplify('Freitag, den 27. November, um 10.30 Uhr.'), 'freitag den 27 november um 10.30 uhr');
  assert.equal(simplify('27.11. und 27/11'), '27.11 und 27 11');
  assert.equal(simplify('Zum Färben um halb drei, dreißig Minuten'), 'zum färben um halb drei dreissig minuten');
  assert.equal(simplify('twenty-seventh, half-past'), 'twenty seventh half past');
  assert.equal(simplify('  am   Donnerstag  '), 'am donnerstag');
  // A decomposed umlaut (some systems write "a" plus two dots) is the same letter.
  assert.equal(simplify(`Fa${String.fromCharCode(0x0308)}rben`), 'färben');
});

test('every sentence, read word for word, carries all of its own details', () => {
  for (const language of languages) {
    const pack = LAB_LANGUAGES[language];
    for (const item of pack.sentences) {
      const score = scoreSentence(item, item.text);
      assert.equal(score.foundCount, score.total, `${item.id}: ${item.keys.filter((_, index) => !score.found[index]).map(key => key.label).join(', ')}`);
      assert.equal(score.wordErrors, 0, item.id);
    }
    const talk = scoreSentence({ id: 'talk', text: pack.talk.lines.join(' '), keys: pack.talk.keys }, pack.talk.lines.join(' '));
    assert.equal(talk.foundCount, talk.total, `${language} call: ${pack.talk.keys.filter((_, index) => !talk.found[index]).map(key => key.label).join(', ')}`);
  }
});

test('the sets are complete: twelve sentences each, one of them small talk, with ids that say the language', () => {
  for (const language of languages) {
    const pack = LAB_LANGUAGES[language];
    assert.equal(pack.sentences.length, 12, language);
    assert.equal(pack.sentences.filter(item => item.keys.length === 0).length, 1, language);
    assert.deepEqual(pack.sentences.map(item => item.id), pack.sentences.map((_, index) => `${language}-${String(index + 1).padStart(2, '0')}`));
    assert.ok(pack.locales.length >= 1 && pack.locales[0].code.startsWith(language), language);
    assert.ok(pack.talk.lines.length >= 5 && pack.talk.keys.length >= 5, language);
    for (const item of [...pack.sentences.flatMap(entry => entry.keys), ...pack.talk.keys]) {
      assert.ok(item.digits !== undefined || (item.accept ?? []).length > 0, `${language}: ${item.label} can be found`);
      for (const pattern of item.accept ?? []) assert.equal(pattern.flags, '', `${item.label}: a pattern with flags could remember where it stopped`);
    }
  }
});

test('the spellings engines really use count, and a wrong detail does not', () => {
  const cases: [id: string, heard: string, found: boolean[]][] = [
    // English: times as digits, with and without "pm"
    ['en-01', 'Do we have anything free on Thursday at 3:00 p.m.?', [true, true]],
    ['en-01', 'do we have anything free on Thursday at 3 PM', [true, true]],
    ['en-01', 'Do we have anything free on Thursday at 15:00', [true, true]],
    ['en-01', 'Do we have anything free on Thursday at 3', [true, false]],
    ['en-01', 'Do we have anything free on Tuesday at 3pm', [false, true]],
    ['en-02', 'A haircut on Friday the 27th of November at 10:30', [true, true, true, true]],
    ['en-02', 'A haircut on Friday, November 27th at half past 10', [true, true, true, true]],
    ['en-02', 'a hair cut on Friday 27/11 at 10 30', [true, true, true, true]],
    ['en-02', 'A haircut on Friday the 7th of November at half past two', [true, true, false, false]],
    ['en-03', 'Tomorrow morning at 9:15 for a coloring', [true, true, true, true]],
    ['en-03', 'Tomorrow morning at quarter past nine for a colour', [true, true, true, true]],
    ['en-04', 'Next Tuesday at 3:45 with Selena', [true, true, false]],
    ['en-04', 'Tuesday at a quarter to 4 with Selina', [false, true, true]],
    ['en-06', 'The customer is Leah Bruner', [false, false]],
    ['en-07', 'Her phone number is 078 555 2740', [true]],
    ['en-07', 'her phone number is 0 7 8 5 5 5 2 7 4 0', [true]],
    ['en-07', 'Her phone number is 078 555 27 14', [false]],
    ['en-08', 'Move Lea Brunner from Thursday to Friday at 11:00', [true, true, true, true, true]],
    ['en-09', 'Cancel the appointment on December 2nd', [true, true]],
    ['en-09', 'Cancel the appointment on the 2nd of December', [true, true]],
    ['en-10', 'Confirm booking.', [true]],
    ['en-10', 'confirm looking', [false]],
    ['en-11', 'No, not Thursday, Friday at 2:30', [true, true]],
    ['en-11', 'No not Thursday Friday at 14:30', [true, true]],
    // German: "halb elf" is 10:30, and the umlaut decides between dyeing and colours
    ['de-01', 'Haben wir am Donnerstag um 15 Uhr noch etwas frei?', [true, true]],
    ['de-01', 'Haben wir am Donnerstag um 15:00 Uhr noch etwas frei', [true, true]],
    ['de-01', 'Haben wir am Dienstag um 5 Uhr noch etwas frei', [false, false]],
    ['de-02', 'Ein Haarschnitt am Freitag, dem 27. November, um halb 11.', [true, true, true, true]],
    ['de-02', 'ein Haarschnitt am Freitag den 27.11. um 10:30 Uhr', [true, true, true, true]],
    ['de-02', 'Ein Haarschnitt am Freitag, dem 27. November, um 10 Uhr 30', [true, true, true, true]],
    ['de-02', 'Ein Haarschnitt am Freitag, dem 27. November, um halb 12', [true, true, true, false]],
    ['de-03', 'Morgen Vormittag um 9:15 Uhr zum Färben', [true, true, true, true]],
    ['de-03', 'Morgen Vormittag um Viertel nach 9 zum Farben', [true, true, true, false]],
    ['de-04', 'Nächsten Dienstag um 15:45 Uhr bei Selina', [true, true, true]],
    ['de-04', 'nächsten Dienstag um Viertel vor 4 bei Celina', [true, true, false]],
    ['de-05', 'Ist Luca am Samstag Nachmittag frei?', [true, true, true]],
    ['de-05', 'Ist Luka am Samstagnachmittag frei', [false, true, true]],
    ['de-08', 'Lea Brunner von Donnerstag auf Freitag um 11 Uhr verschieben', [true, true, true, true, true]],
    ['de-09', 'Den Termin am 2. Dezember absagen', [true, true]],
    ['de-09', 'den Termin am 02.12. absagen', [true, true]],
    ['de-10', 'Buchung bestätigen', [true]],
    ['de-11', 'Nein, nicht Donnerstag, Freitag um 14:30 Uhr', [true, true]],
    ['de-11', 'Nein, nicht Donnerstag, Freitag um halb 3', [true, true]],
  ];
  for (const [id, heard, found] of cases) assert.deepEqual(scoreSentence(sentence(id), heard).found, found, `${id}: ${heard}`);
});

test('a phone number counts however the engine groups its digits', () => {
  const number = { label: '078 555 27 40', digits: '0785552740' };
  assert.equal(hears(number, '078 555 27 40'), true);
  assert.equal(hears(number, 'null sieben acht'), false);
  assert.equal(hears(number, '0 78 555 2740.'), true);
  assert.equal(hears(number, '078 555 27'), false);
});

test('the share of differing words: 0 is word for word, 1 is nothing right', () => {
  assert.equal(wordErrors('Confirm booking.', 'confirm booking'), 0);
  assert.equal(wordErrors('Thursday at three pm', 'Thursday at 3 pm'), 0.25);
  assert.equal(wordErrors('Thursday at three pm', 'Thursday three pm'), 0.25);
  assert.equal(wordErrors('Thursday at three pm', 'well Thursday at three pm'), 0.25);
  assert.equal(wordErrors('Thursday at three pm', ''), 1);
  assert.equal(wordErrors('one two', 'a b c d e f'), 1, 'never more than everything');
  assert.equal(wordErrors('', ''), 0);
  assert.equal(wordErrors('', 'something'), 1);
});

// ---------- timings ----------

const recording = (events: [ms: number, name: string][], finals: string[] = [], more: Partial<Recording> = {}): Recording => ({
  startedAt: '2026-11-19T14:32:10.000Z',
  events: events.map(([ms, name]) => ({ ms, name })),
  finals: finals.map((text, index) => ({ ms: 1000 * (index + 1), text })),
  alternatives: [],
  interimCount: events.filter(([, name]) => name === 'interim').length,
  unfinished: '',
  errors: [],
  durationMs: events.at(-1)?.[0] ?? 0,
  ...more,
});

test('the wait for the finished text runs from the end of speech', () => {
  assert.deepEqual(timingsOf(recording([
    [120, 'start'], [150, 'audiostart'], [900, 'speechstart'], [1300, 'interim'], [2100, 'interim'], [2600, 'speechend'], [3250, 'final'], [3300, 'end'],
  ]).events), { firstWordMs: 400, finalDelayMs: 650, totalMs: 3130 });
});

test('an engine that does not report the end of speech is timed from the last change of the text', () => {
  assert.deepEqual(timingsOf(recording([[100, 'start'], [1200, 'interim'], [2000, 'interim'], [2900, 'final']]).events), { firstWordMs: null, finalDelayMs: 900, totalMs: 2800 });
  // A "speechend" after the finished text says nothing about the wait for it.
  assert.equal(timingsOf(recording([[100, 'start'], [1500, 'interim'], [2000, 'final'], [2400, 'speechend']]).events).finalDelayMs, 500);
});

test('without a finished text there is nothing to time', () => {
  assert.deepEqual(timingsOf(recording([[100, 'start'], [8100, 'error:no-speech'], [8150, 'end']]).events), { firstWordMs: null, finalDelayMs: null, totalMs: null });
  assert.deepEqual(timingsOf([]), { firstWordMs: null, finalDelayMs: null, totalMs: null });
});

// ---------- a round ----------

const heardAs = (id: string, heard: string, events: [number, string][] = [[100, 'start'], [2000, 'speechend'], [2600, 'final']]): Attempt =>
  attemptFrom(sentence(id), recording(events, heard ? [heard] : []));

test('a round counts the last try of each sentence, and small talk has nothing to count', () => {
  const pack = LAB_LANGUAGES.en;
  const attempts: Record<string, Attempt[]> = {
    'en-01': [heardAs('en-01', 'do we have anything on Tuesday'), heardAs('en-01', 'Do we have anything free on Thursday at 3 PM', [[100, 'start'], [2000, 'speechend'], [2400, 'final']])],
    'en-02': [heardAs('en-02', 'A haircut on Friday the 27th of November at half past two', [[100, 'start'], [2000, 'speechend'], [3000, 'final']])],
    'en-06': [heardAs('en-06', '', [[100, 'start'], [8000, 'error:no-speech']])],
    'en-12': [heardAs('en-12', 'yes of course no problem one moment please', [[100, 'start'], [2000, 'speechend'], [2200, 'final']])],
  };
  assert.deepEqual(summarise(pack.sentences, attempts), {
    sentencesDone: 4,
    sentencesTotal: 12,
    keysFound: 5,
    keysTotal: 8,
    sentencesComplete: 1,
    medianFinalDelayMs: 400,
    medianFirstWordMs: null,
    // Three texts were heard: word for word (0), one word in ten written differently (0.1), three in thirteen (0.23).
    medianWordErrors: 0.1,
  });
  assert.deepEqual(summarise(pack.sentences, {}), {
    sentencesDone: 0, sentencesTotal: 12, keysFound: 0, keysTotal: 0, sentencesComplete: 0, medianFinalDelayMs: null, medianFirstWordMs: null, medianWordErrors: null,
  });
});

test('the middle value', () => {
  assert.equal(median([]), null);
  assert.equal(median([700]), 700);
  assert.equal(median([900, 300, 500]), 500);
  assert.equal(median([400, 200, 1000, 600]), 500);
});

test('the short call is scored over everything that was heard, and says how the engine cut it', () => {
  const pack = LAB_LANGUAGES.de;
  const talk = talkFrom(pack.talk, recording(
    [[100, 'start'], [4000, 'final'], [9000, 'final'], [9500, 'end'], [9500, 'reopen'], [9900, 'start'], [15000, 'final'], [20000, 'end']],
    ['Bella Hair Salon guten Morgen ein Haarschnitt gern', 'Donnerstag der 26. um 15 Uhr einen Moment ich schaue nach', 'um 15 Uhr ist besetzt ich kann Ihnen halb 4 anbieten Lea Brunner danke'],
    { durationMs: 20000 },
  ));
  assert.deepEqual(talk.score.found, [true, true, true, true, true, true, false]);
  assert.equal(talk.segments.length, 3);
  assert.equal(talk.reopened, 1);
  assert.equal(talk.durationMs, 20000);
  assert.match(talk.heard, /^Bella Hair Salon guten Morgen .* Lea Brunner danke$/);
});

const settings: LabSettings = { label: '  A.B. ', language: 'de', locale: 'de-CH', variety: 'dialect', noise: 'loud', microphone: 'headset', onDevice: false, boost: true };

test('the file to send back holds the choices, the texts and the timings, and nothing else about the person', () => {
  const pack = LAB_LANGUAGES.de;
  const attempts = { 'de-10': [heardAs('de-10', 'Buchung bestätigen')] };
  const report = buildReport({
    createdAt: '2026-11-19T14:32:10.000Z',
    browser: { userAgent: 'Mozilla/5.0 Chrome/157', languages: ['de-CH', 'en'] },
    support: { recognition: true, onDevice: true, boost: true },
    settings,
    sentences: pack.sentences,
    attempts,
    script: pack.talk,
    talk: null,
  });
  assert.deepEqual(Object.keys(report), ['kind', 'version', 'createdAt', 'browser', 'support', 'settings', 'summary', 'sentences', 'talk']);
  assert.equal(report.kind, 'slotbee-voice-check');
  assert.equal(report.version, 2);
  assert.equal(report.settings.label, 'A.B.');
  assert.deepEqual({ ...report.settings, label: '' }, { ...settings, label: '' });
  assert.equal(report.sentences.length, 12);
  assert.deepEqual(report.sentences[9], { id: 'de-10', text: 'Buchung bestätigen.', keys: ['Buchung bestätigen'], attempts: attempts['de-10'] });
  assert.deepEqual(report.sentences[0].attempts, []);
  assert.equal(report.talk, null);
  assert.equal(report.summary.keysFound, 1);
  // It survives the trip through text, which is how it is copied and downloaded.
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);

  assert.equal(reportFileName(report), 'voice-check-de-a-b-2026-11-19-1432.json');
  assert.equal(reportFileName({ createdAt: '2026-11-19T14:32:10.000Z', settings: { ...settings, label: '', language: 'en' } }), 'voice-check-en-2026-11-19-1432.json');
});

test('words the engine never finished are kept with the try, but not scored', () => {
  // What happened in the first real round: Stop was pressed while the words were still grey.
  const stopped = attemptFrom(sentence('en-01'), recording(
    [[5, 'start'], [1600, 'speechstart'], [3100, 'interim'], [3300, 'interim'], [5200, 'stop-pressed'], [5230, 'speechend'], [5400, 'end'], [5400, 'unfinished']],
    [],
    { unfinished: 'do we have anything free on Thursday' },
  ));
  assert.equal(stopped.heard, '');
  assert.equal(stopped.unfinished, 'do we have anything free on Thursday');
  assert.deepEqual(stopped.score.found, [false, false]);
  assert.deepEqual(stopped.timings, { firstWordMs: 1500, finalDelayMs: null, totalMs: null });
  assert.ok(stopped.events.some(event => event.name === 'stop-pressed'));

  const call = talkFrom(LAB_LANGUAGES.en.talk, recording([[5, 'start'], [4000, 'final'], [9000, 'end'], [9000, 'unfinished']], ['a haircut sure'], { unfinished: 'thursday the twenty' }));
  assert.equal(call.heard, 'a haircut sure');
  assert.equal(call.unfinished, 'thursday the twenty');
});

// ---------- the page ----------

test('what the page says when listening went wrong', () => {
  assert.equal(problemText([], false), null);
  assert.equal(problemText(['aborted'], false), null);
  assert.match(problemText(['no-speech'], false) ?? '', /Nothing was heard/);
  assert.match(problemText(['no-speech', 'not-allowed'], false) ?? '', /did not allow the microphone/);
  assert.match(problemText(['audio-capture'], false) ?? '', /No microphone/);
  assert.match(problemText(['network'], false) ?? '', /internet connection/);
  assert.match(problemText(['language-not-supported'], false) ?? '', /cannot recognise the chosen language/);
  assert.match(problemText(['service-not-allowed'], true) ?? '', /language pack/);
  assert.doesNotMatch(problemText(['service-not-allowed'], false) ?? '', /language pack/);
  assert.match(problemText(['unsupported'], false) ?? '', /Chrome, Edge or Safari/);
  assert.match(problemText(['keeps-closing'], false) ?? '', /Reload the page/);
  // Some browsers have the speech feature but no speech service behind it: the engine never opens and says nothing.
  assert.equal(opened([{ name: 'start' }, { name: 'end' }]), true);
  assert.equal(opened([{ name: 'no-end' }]), false);
  assert.match(problemText([], false, false) ?? '', /Listening never began.*Chrome, Edge or Safari/);
  assert.equal(problemText([], false, true), null);
  assert.match(problemText(['not-allowed'], false, false) ?? '', /did not allow the microphone/, 'a stated reason comes first');
});

class Engine {
  static available() { return Promise.resolve('available'); }
  get processLocally() { return false; }
  get phrases() { return []; }
  start() {}
}
class Phrase {}

test('a browser without speech recognition is told so, and the check cannot be started', () => {
  const html = render(createElement(VoiceLab, { speech: {} }));
  assert.match(readableText(html), /This browser has no speech recognition/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Start the check<\/button>/);
});

test('the first screen says what is asked, what happens to the voice, and offers the choices', () => {
  const html = render(createElement(VoiceLab, { speech: { Recognition: Engine as unknown as RecognitionConstructor, Phrase: Phrase as never } }));
  const text = readableText(html);
  assert.doesNotMatch(text, /This browser has no speech recognition/);
  assert.match(text, /Voice check/);
  assert.match(text, /You read 12 short sentences aloud, then one short call/);
  assert.match(text, /There is nothing to pass\. A sentence that comes out wrong is exactly what we need to see/);
  assert.match(text, /keeps no sound and stores nothing/);
  assert.match(text, /Google for Chrome, Apple for Safari/);
  for (const label of ['Language you will speak', 'Around you', 'Microphone', 'Your initials (optional)', 'More options', 'Favour salon words.', 'Recognise on this device.']) {
    assert.ok(text.includes(label), label);
  }
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Start the check<\/button>/);
  assert.match(html, /<button[^>]*>Start the check<\/button>/);
  // English is the first choice, so the question about dialect is not asked yet.
  assert.doesNotMatch(text, /Swiss German/);
  // No link leads from this page into the app or anywhere else.
  assert.doesNotMatch(html, /<a\s/);
});

test('extra speech options show only where the browser has them', () => {
  class Plain { start() {} }
  const text = readableText(render(createElement(VoiceLab, { speech: { Recognition: Plain as unknown as RecognitionConstructor } })));
  assert.doesNotMatch(text, /Favour salon words|Recognise on this device/);
  assert.match(text, /This browser offers no further speech options/);
});

test('the page of the voice check loads everything from the app itself and is part of the build', () => {
  const html = readFileSync(path.join(root, 'voice-lab.html'), 'utf8');
  const addresses = [...html.matchAll(/<(?:link|script)\b[^>]*?\s(?:href|src)="([^"]*)"/g)].map(match => match[1]);
  assert.ok(addresses.includes('/src/voice/lab/main.tsx'));
  for (const address of addresses) {
    assert.match(address, /^\/(?!\/)/, address);
    assert.ok(existsSync(path.join(root, address.startsWith('/src/') ? address.slice(1) : `public${address}`)), `${address} exists`);
  }
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.doesNotMatch(html, /rel="manifest"/, 'the page must not offer the owner app for a home screen');
  // A merge that drops the second page from the build would take the check offline without any error.
  assert.match(readFileSync(path.join(root, 'vite.config.ts'), 'utf8'), /'voice-lab':[^\n]*'voice-lab\.html'/);
});

test('the voice check is written without long dashes', () => {
  // The two characters are built from their numbers, so this file holds none either.
  const LONG_DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  for (const file of ['voice-lab.html', 'src/voice/transcriber.ts', 'src/voice/lab/VoiceLab.tsx', 'src/voice/lab/sentences.ts', 'src/voice/lab/score.ts', 'src/voice/lab/report.ts', 'src/voice/lab/main.tsx', 'tests/voiceLab.test.ts', 'tests/voiceTranscriber.test.ts']) {
    assert.doesNotMatch(readFileSync(path.join(root, file), 'utf8'), LONG_DASHES, file);
  }
});
