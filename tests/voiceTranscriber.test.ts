import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserSpeech, createTranscriber, installOnDevice, onDeviceState, speechSupport,
  type RecognitionConstructor, type SpeechEnvironment, type TranscriberEvent, type TranscriberOptions,
} from '../src/voice/transcriber';

// The browser's speech recognition cannot run in a test: it needs a microphone and, in most
// browsers, the maker's speech service. These tests drive the transcriber with a stand-in engine
// that reports what a real one reports, in the order a real one reports it.

type Part = { text: string; final?: boolean; confidence?: number; alternatives?: string[] };

class FakeEngine {
  static made: FakeEngine[] = [];
  static failOnStart = false;
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  processLocally = false;
  phrases: unknown = null;
  onstart: (() => void) | null = null;
  onresult: ((event: { resultIndex: number; results: unknown }) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  calls: string[] = [];
  constructor() { FakeEngine.made.push(this); }
  start() {
    if (FakeEngine.failOnStart) throw new Error('already started');
    this.calls.push('start');
  }
  stop() { this.calls.push('stop'); }
  abort() { this.calls.push('abort'); }
  /** Reports results the way a browser does: a list of phrases, each with its alternatives. */
  hear(parts: Part[], resultIndex = 0) {
    const results = parts.map((part) => {
      const alternatives = [part.text, ...(part.alternatives ?? [])].map(transcript => ({ transcript, confidence: part.confidence ?? 0.9 }));
      return Object.assign(alternatives, { isFinal: part.final === true });
    });
    this.onresult?.({ resultIndex, results });
  }
}

class FakePhrase {
  constructor(public phrase: string, public boost: number) {}
}

/** A transcriber on the stand-in engine, with a clock and timers the test moves by hand. */
function setup(options: Partial<TranscriberOptions> = {}, environment: Partial<SpeechEnvironment> = {}) {
  FakeEngine.made = [];
  FakeEngine.failOnStart = false;
  const events: TranscriberEvent[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  let time = 0;
  const transcriber = createTranscriber({ lang: 'en-GB', ...options }, event => events.push(event), {
    Recognition: FakeEngine as unknown as RecognitionConstructor,
    Phrase: FakePhrase,
    now: () => time,
    setTimer: (run, ms) => { const timer = { run, ms }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const at = timers.indexOf(timer as { run: () => void; ms: number }); if (at >= 0) timers.splice(at, 1); },
    ...environment,
  });
  return {
    transcriber,
    events,
    timers,
    engine: () => FakeEngine.made.at(-1)!,
    engines: () => FakeEngine.made,
    wait: (ms: number) => { time += ms; },
    runTimers: () => { for (const timer of timers.splice(0)) timer.run(); },
    types: () => events.map(event => event.type === 'engine' ? `engine:${event.name}` : event.type === 'error' ? `error:${event.code}` : event.type),
  };
}

test('one phrase: the words arrive while they are spoken, then the finished text, then listening ends', () => {
  const { transcriber, events, engine, types } = setup();
  transcriber.start();
  assert.deepEqual(engine().calls, ['start']);
  assert.equal(engine().lang, 'en-GB');
  assert.equal(engine().continuous, false);
  assert.equal(engine().interimResults, true);
  assert.equal(engine().maxAlternatives, 3);

  engine().onstart?.();
  engine().onspeechstart?.();
  engine().hear([{ text: 'thursday at' }]);
  engine().hear([{ text: 'thursday at three' }]);
  engine().onspeechend?.();
  engine().hear([{ text: ' Thursday at 3 PM ', final: true, confidence: 0.87, alternatives: ['Thursday at 3:00 p.m.'] }]);
  engine().onend?.();

  assert.deepEqual(types(), ['engine:start', 'listening', 'engine:speechstart', 'interim', 'interim', 'engine:speechend', 'final', 'engine:end', 'stopped']);
  assert.deepEqual(events.filter(event => event.type === 'interim').map(event => event.text), ['thursday at', 'thursday at three']);
  assert.deepEqual(events.find(event => event.type === 'final'), {
    type: 'final',
    text: 'Thursday at 3 PM',
    alternatives: [{ text: 'Thursday at 3 PM', confidence: 0.87 }, { text: 'Thursday at 3:00 p.m.', confidence: 0.87 }],
  });
});

test('in a call, only the phrase being spoken counts as unfinished: earlier phrases are not repeated', () => {
  const { transcriber, events, engine } = setup({ continuous: true });
  transcriber.start();
  engine().onstart?.();
  assert.equal(engine().continuous, true);
  engine().hear([{ text: 'a haircut sure', final: true }]);
  // The browser keeps the finished phrase in its list and says where the news begins.
  engine().hear([{ text: 'a haircut sure', final: true }, { text: 'thursday' }, { text: ' the twenty sixth' }], 1);
  assert.deepEqual(events.filter(event => event.type === 'final').map(event => event.text), ['a haircut sure']);
  assert.deepEqual(events.filter(event => event.type === 'interim').map(event => event.text), ['thursday the twenty sixth']);
});

test('an empty finished phrase is not passed on', () => {
  const { transcriber, events, engine } = setup();
  transcriber.start();
  engine().onstart?.();
  engine().hear([{ text: '   ', final: true }]);
  engine().onend?.();
  assert.equal(events.some(event => event.type === 'final' || event.type === 'interim'), false);
  assert.equal(events.at(-1)?.type, 'stopped');
});

test('start twice opens one engine; stop lets the engine finish and reports the end once', () => {
  const { transcriber, events, engine, engines } = setup();
  transcriber.start();
  transcriber.start();
  assert.equal(engines().length, 1);
  engine().onstart?.();
  transcriber.stop();
  assert.deepEqual(engine().calls, ['start', 'stop']);
  assert.equal(events.some(event => event.type === 'stopped'), false, 'the end is reported by the engine, not assumed');
  engine().hear([{ text: 'friday', final: true }]);
  engine().onend?.();
  transcriber.stop();
  assert.equal(events.filter(event => event.type === 'stopped').length, 1);
  assert.equal(events.filter(event => event.type === 'final').length, 1);

  // A new start after the end listens again with a new engine.
  transcriber.start();
  assert.equal(engines().length, 2);
});

test('an engine that never reports its end after stop is given up, and its late news is ignored', () => {
  const { transcriber, events, engine, timers, runTimers, types } = setup();
  transcriber.start();
  engine().onstart?.();
  const silent = engine();
  transcriber.stop();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 4000);
  assert.equal(events.some(event => event.type === 'stopped'), false);
  runTimers();
  assert.deepEqual(types().slice(-2), ['engine:no-end', 'stopped']);
  assert.equal(silent.onend, null);
  assert.equal(silent.onresult, null);
  assert.equal(events.filter(event => event.type === 'stopped').length, 1);
});

test('an engine that reports its end in time leaves no timer behind', () => {
  const { transcriber, events, engine, timers, runTimers } = setup();
  transcriber.start();
  engine().onstart?.();
  transcriber.stop();
  assert.equal(timers.length, 1);
  engine().onend?.();
  assert.equal(timers.length, 0);
  runTimers();
  assert.equal(events.filter(event => event.type === 'stopped').length, 1);

  // Abort waits a shorter time for the same report.
  transcriber.start();
  engine().onstart?.();
  transcriber.abort();
  assert.equal(timers[0].ms, 1000);
});

test('abort ends at once', () => {
  const { transcriber, engine, types } = setup();
  transcriber.start();
  engine().onstart?.();
  transcriber.abort();
  assert.deepEqual(engine().calls, ['start', 'abort']);
  engine().onerror?.({ error: 'aborted' });
  engine().onend?.();
  assert.deepEqual(types().slice(-3), ['error:aborted', 'engine:end', 'stopped']);
});

test('in a call the engine is opened again when it closes by itself, until the caller stops', () => {
  const { transcriber, events, engine, engines, timers, wait, runTimers, types } = setup({ continuous: true });
  transcriber.start();
  engine().onstart?.();
  wait(8000);
  engine().onerror?.({ error: 'no-speech' });
  engine().onend?.();
  assert.deepEqual(types().slice(-3), ['error:no-speech', 'engine:end', 'engine:reopen']);
  assert.equal(events.some(event => event.type === 'stopped'), false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 300);
  runTimers();
  assert.equal(engines().length, 2);
  assert.deepEqual(engine().calls, ['start']);

  // Stop during the pause before the next opening: no further engine, and the end is reported.
  engine().onstart?.();
  wait(5000);
  engine().onend?.();
  assert.equal(timers.length, 1);
  transcriber.stop();
  assert.equal(timers.length, 0);
  assert.equal(events.at(-1)?.type, 'stopped');
  runTimers();
  assert.equal(engines().length, 2);
});

test('a phrase is not followed by a new opening: one press, one phrase', () => {
  const { transcriber, engine, engines, timers, events } = setup();
  transcriber.start();
  engine().onstart?.();
  engine().onerror?.({ error: 'no-speech' });
  engine().onend?.();
  assert.equal(engines().length, 1);
  assert.equal(timers.length, 0);
  assert.deepEqual(events.find(event => event.type === 'error'), { type: 'error', code: 'no-speech', fatal: false });
  assert.equal(events.at(-1)?.type, 'stopped');
});

test('a refused microphone ends a call instead of asking again and again', () => {
  for (const code of ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network']) {
    const { transcriber, events, engine, engines, timers } = setup({ continuous: true });
    transcriber.start();
    engine().onerror?.({ error: code });
    engine().onend?.();
    assert.deepEqual(events.find(event => event.type === 'error'), { type: 'error', code, fatal: true }, code);
    assert.equal(timers.length, 0, code);
    assert.equal(engines().length, 1, code);
    assert.equal(events.at(-1)?.type, 'stopped', code);
  }
});

test('an engine that keeps closing right after opening is given up', () => {
  const { transcriber, events, engine, engines, wait, runTimers } = setup({ continuous: true });
  transcriber.start();
  for (let round = 0; round < 3; round++) {
    engine().onstart?.();
    wait(200);
    engine().onend?.();
    runTimers();
  }
  assert.equal(engines().length, 3);
  assert.deepEqual(events.filter(event => event.type === 'error'), [{ type: 'error', code: 'keeps-closing', fatal: true }]);
  assert.equal(events.at(-1)?.type, 'stopped');
});

test('long sessions that close are normal: the count of short ones starts again', () => {
  const { transcriber, events, engine, engines, wait, runTimers } = setup({ continuous: true });
  transcriber.start();
  for (const lasted of [200, 200, 60_000, 200, 200]) {
    engine().onstart?.();
    wait(lasted);
    engine().onend?.();
    runTimers();
  }
  assert.equal(engines().length, 6);
  assert.equal(events.some(event => event.type === 'error'), false);
});

test('a browser without speech recognition says so and ends', () => {
  const events: TranscriberEvent[] = [];
  const transcriber = createTranscriber({ lang: 'en-GB' }, event => events.push(event), { Recognition: undefined });
  transcriber.start();
  assert.deepEqual(events, [{ type: 'error', code: 'unsupported', fatal: true }, { type: 'stopped' }]);
});

test('an engine that refuses to start is reported, and a later start can work', () => {
  const { transcriber, events, engines } = setup();
  FakeEngine.failOnStart = true;
  transcriber.start();
  assert.deepEqual(events, [{ type: 'error', code: 'start-failed', fatal: true }, { type: 'stopped' }]);
  FakeEngine.failOnStart = false;
  transcriber.start();
  assert.equal(engines().length, 2);
  assert.deepEqual(engines()[1].calls, ['start']);
});

test('favoured words are handed to the engine; an engine that cannot use them listens without them', () => {
  const { transcriber, events, engine, engines, runTimers } = setup({ boost: ['Selina', 'Lea Brunner'] });
  transcriber.start();
  assert.deepEqual(engine().phrases, [new FakePhrase('Selina', 4), new FakePhrase('Lea Brunner', 4)]);

  engine().onerror?.({ error: 'phrases-not-supported' });
  engine().onend?.();
  assert.equal(events.some(event => event.type === 'error' || event.type === 'stopped'), false);
  runTimers();
  assert.equal(engines().length, 2);
  assert.equal(engine().phrases, null, 'the second opening has no favoured words');
  engine().onstart?.();
  engine().hear([{ text: 'selina', final: true }]);
  engine().onend?.();
  assert.equal(events.at(-1)?.type, 'stopped');
  assert.equal(engines().length, 2);
});

test('without favoured words, and without the browser part for them, nothing is set', () => {
  const plain = setup();
  plain.transcriber.start();
  assert.equal(plain.engine().phrases, null);

  const noPhrases = setup({ boost: ['Selina'] }, { Phrase: undefined });
  noPhrases.transcriber.start();
  assert.equal(noPhrases.engine().phrases, null);
});

test('recognising on the device is asked for only when chosen', () => {
  const standard = setup();
  standard.transcriber.start();
  assert.equal(standard.engine().processLocally, false);

  const local = setup({ onDevice: true });
  local.transcriber.start();
  assert.equal(local.engine().processLocally, true);
});

test('the browser is asked what it offers', async () => {
  assert.deepEqual(speechSupport(browserSpeech({})), { recognition: false, onDevice: false, boost: false });
  assert.deepEqual(speechSupport(browserSpeech(undefined)), { recognition: false, onDevice: false, boost: false });

  // Safari and older Chrome: the engine under its old name, no extras.
  class Old { start() {} }
  const old = browserSpeech({ webkitSpeechRecognition: Old });
  assert.equal(old.Recognition, Old);
  assert.deepEqual(speechSupport(old), { recognition: true, onDevice: false, boost: false });

  // A current Chrome: recognition on the device and favoured words.
  class Current {
    static asked: unknown[] = [];
    static available(options: unknown) { Current.asked.push(options); return Promise.resolve('downloadable'); }
    static install(options: unknown) { Current.asked.push(options); return Promise.resolve(true); }
    get processLocally() { return false; }
    get phrases() { return []; }
  }
  const current = browserSpeech({ SpeechRecognition: Current, webkitSpeechRecognition: Old, SpeechRecognitionPhrase: FakePhrase });
  assert.equal(current.Recognition, Current);
  assert.deepEqual(speechSupport(current), { recognition: true, onDevice: true, boost: true });
  assert.equal(await onDeviceState('de-CH', current), 'downloadable');
  assert.equal(await installOnDevice('de-CH', current), true);
  assert.deepEqual(Current.asked, [{ langs: ['de-CH'], processLocally: true }, { langs: ['de-CH'], processLocally: true }]);

  // No answer, a strange answer or a failure all read as "unknown", never as ready.
  assert.equal(await onDeviceState('de-CH', old), 'unknown');
  assert.equal(await installOnDevice('de-CH', old), false);
  class Odd {
    static available() { return Promise.resolve('maybe'); }
    static install() { return Promise.reject(new Error('blocked')); }
  }
  const odd = { Recognition: Odd as unknown as RecognitionConstructor };
  assert.equal(await onDeviceState('en-GB', odd), 'unknown');
  assert.equal(await installOnDevice('en-GB', odd), false);
});
