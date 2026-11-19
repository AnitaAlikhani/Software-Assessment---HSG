/**
 * Speech to text behind one small interface.
 *
 * Today there is one engine: the speech recognition built into the browser (Chrome, Edge and
 * Safari have one). Everything that listens goes through createTranscriber, so another engine
 * can be added later without touching the code that uses the words.
 *
 * Nothing here records or stores sound. The browser turns speech into text and this module
 * passes the text on.
 */

/** One way the engine may have heard a phrase. Chrome gives a confidence from 0 to 1; Safari gives 0. */
export interface HeardAlternative {
  text: string;
  confidence: number;
}

export type TranscriberEvent =
  /** The microphone is open and the engine is listening. */
  | { type: 'listening' }
  /** Words heard so far in the phrase that is still being spoken. They may still change. */
  | { type: 'interim'; text: string }
  /** A finished phrase. */
  | { type: 'final'; text: string; alternatives: HeardAlternative[] }
  /** The engine reported a problem. A fatal one ends listening. */
  | { type: 'error'; code: string; fatal: boolean }
  /** What the engine itself reports ("speechstart", "end", ...), for timing and for finding faults. */
  | { type: 'engine'; name: string }
  /** Listening is over. Sent exactly once for every start(). */
  | { type: 'stopped' };

export interface TranscriberOptions {
  /** The language that will be spoken, for example "en-GB" or "de-CH". */
  lang: string;
  /** Keep listening across pauses, as during a phone call. Without it, listening ends after one phrase. */
  continuous?: boolean;
  /** Ask the browser to recognise on this device, so no sound leaves it. Needs a language pack. */
  onDevice?: boolean;
  /** Words the engine should favour, such as names and services. Ignored where the browser cannot do it. */
  boost?: string[];
}

export interface Transcriber {
  start(): void;
  /** Ends listening and still delivers what was heard so far. */
  stop(): void;
  /** Ends listening at once and drops what was not delivered yet. */
  abort(): void;
}

// ---------- the part of the browser's speech recognition this module uses ----------

interface RecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface RecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternativeLike;
}
interface RecognitionResultEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResultLike };
}
interface RecognitionErrorEventLike {
  error?: string;
}

const LIFECYCLE = ['audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'nomatch'] as const;
type LifecycleHandler = `on${typeof LIFECYCLE[number]}`;

export type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  phrases?: unknown;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionResultEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
} & { [Handler in LifecycleHandler]?: (() => void) | null };

export type RecognitionConstructor = new () => RecognitionLike;
export type PhraseConstructor = new (phrase: string, boost: number) => unknown;

/** What createTranscriber needs from its surroundings. Tests pass stand-ins. */
export interface SpeechEnvironment {
  Recognition?: RecognitionConstructor;
  Phrase?: PhraseConstructor;
  /** A clock in milliseconds. */
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/** The browser's own speech recognition, if it has one. Safari and older Chrome use the "webkit" name. */
export function browserSpeech(scope: unknown = globalThis): Pick<SpeechEnvironment, 'Recognition' | 'Phrase'> {
  const host = (scope ?? {}) as Record<string, unknown>;
  const Recognition = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  const Phrase = host.SpeechRecognitionPhrase;
  return {
    Recognition: typeof Recognition === 'function' ? Recognition as RecognitionConstructor : undefined,
    Phrase: typeof Phrase === 'function' ? Phrase as PhraseConstructor : undefined,
  };
}

export interface SpeechSupport {
  /** The browser can turn speech into text at all. */
  recognition: boolean;
  /** The browser offers recognition on the device itself. */
  onDevice: boolean;
  /** The browser can be told which words to favour. */
  boost: boolean;
}

const offers = (Recognition: RecognitionConstructor | undefined, property: string): boolean => {
  try { return Boolean(Recognition) && property in (Recognition!.prototype as object); } catch { return false; }
};

export function speechSupport(speech: Pick<SpeechEnvironment, 'Recognition' | 'Phrase'> = browserSpeech()): SpeechSupport {
  const { Recognition, Phrase } = speech;
  return {
    recognition: Boolean(Recognition),
    onDevice: offers(Recognition, 'processLocally') && typeof (Recognition as unknown as { available?: unknown }).available === 'function',
    boost: offers(Recognition, 'phrases') && Boolean(Phrase),
  };
}

// ---------- recognition on the device ----------

export type OnDeviceState = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown';
const ON_DEVICE_STATES: readonly string[] = ['available', 'downloadable', 'downloading', 'unavailable'];

type LanguagePacks = {
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<unknown>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<unknown>;
};

/**
 * Whether the browser can recognise this language on the device. Call it only after the person
 * asked for it: it makes the browser look for its language packs.
 */
export async function onDeviceState(lang: string, speech: Pick<SpeechEnvironment, 'Recognition'> = browserSpeech()): Promise<OnDeviceState> {
  const packs = speech.Recognition as unknown as LanguagePacks | undefined;
  if (typeof packs?.available !== 'function') return 'unknown';
  try {
    const state = await packs.available({ langs: [lang], processLocally: true });
    return typeof state === 'string' && ON_DEVICE_STATES.includes(state) ? state as OnDeviceState : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Downloads the language pack for recognition on the device. True when it is installed afterwards. */
export async function installOnDevice(lang: string, speech: Pick<SpeechEnvironment, 'Recognition'> = browserSpeech()): Promise<boolean> {
  const packs = speech.Recognition as unknown as LanguagePacks | undefined;
  if (typeof packs?.install !== 'function') return false;
  try {
    return (await packs.install({ langs: [lang], processLocally: true })) === true;
  } catch {
    return false;
  }
}

// ---------- listening ----------

/** After these, trying again cannot help until something outside changes (permission, connection, language). */
const FATAL_ERRORS: readonly string[] = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network'];
/** How strongly listed words are favoured, on the browser's scale from 0 to 10. */
const BOOST_STRENGTH = 4;
/** In a call the engine closes now and then (after silence, or after about a minute). It is opened again after this pause. */
const REOPEN_PAUSE_MS = 300;
/** An engine that closes again within this time, several times in a row, is not going to work. */
const SHORT_SESSION_MS = 1000;
const MAX_SHORT_SESSIONS = 3;
/** After stop() the engine hands over the last words and reports its end. One that stays silent this long is given up. */
const STOP_GRACE_MS = 4000;
const ABORT_GRACE_MS = 1000;

const clean = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

export function createTranscriber(
  options: TranscriberOptions,
  listener: (event: TranscriberEvent) => void,
  environment: SpeechEnvironment = {},
): Transcriber {
  const found = browserSpeech();
  const Recognition = environment.Recognition ?? found.Recognition;
  const Phrase = environment.Phrase ?? found.Phrase;
  const now = environment.now ?? (() => Date.now());
  const setTimer = environment.setTimer ?? ((run: () => void, ms: number): unknown => setTimeout(run, ms));
  const clearTimer = environment.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));

  let engine: RecognitionLike | null = null;
  /** Between start() and the "stopped" event. */
  let running = false;
  /** The caller still wants to listen. */
  let wanted = false;
  let fatal = false;
  let boost = options.boost ?? [];
  let boostRefused = false;
  let openedAt: number | null = null;
  let shortSessions = 0;
  let reopen: unknown = null;
  let giveUp: unknown = null;

  const finish = () => {
    if (!running) return;
    running = false;
    wanted = false;
    if (giveUp !== null) {
      clearTimer(giveUp);
      giveUp = null;
    }
    listener({ type: 'stopped' });
  };

  const fail = (code: string) => {
    fatal = true;
    listener({ type: 'error', code, fatal: true });
  };

  const open = () => {
    if (!Recognition) {
      fail('unsupported');
      finish();
      return;
    }
    const current = new Recognition();
    current.lang = options.lang;
    current.continuous = options.continuous === true;
    current.interimResults = true;
    current.maxAlternatives = 3;
    if (options.onDevice && 'processLocally' in current) current.processLocally = true;
    if (boost.length > 0 && Phrase && 'phrases' in current) {
      try {
        current.phrases = boost.map(word => new Phrase(word, BOOST_STRENGTH));
      } catch {
        listener({ type: 'engine', name: 'boost-refused' });
      }
    }
    openedAt = null;

    for (const name of LIFECYCLE) current[`on${name}`] = () => listener({ type: 'engine', name });
    current.onstart = () => {
      openedAt = now();
      listener({ type: 'engine', name: 'start' });
      listener({ type: 'listening' });
    };
    current.onresult = (event) => {
      let unfinished = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (!result || result.length === 0) continue;
        if (!result.isFinal) {
          unfinished += ` ${result[0].transcript}`;
          continue;
        }
        const alternatives: HeardAlternative[] = [];
        for (let n = 0; n < result.length; n++) {
          const text = clean(result[n]?.transcript);
          if (text) alternatives.push({ text, confidence: Number(result[n].confidence) || 0 });
        }
        // Some engines close a silent phrase with an empty result: there is nothing to pass on.
        if (alternatives.length > 0) listener({ type: 'final', text: alternatives[0].text, alternatives });
      }
      if (clean(unfinished)) listener({ type: 'interim', text: clean(unfinished) });
    };
    current.onerror = (event) => {
      const code = event.error || 'unknown';
      // The engine cannot favour words in this mode: listen again without them instead of failing.
      if (code === 'phrases-not-supported' && boost.length > 0) {
        boost = [];
        boostRefused = true;
        listener({ type: 'engine', name: 'boost-unsupported' });
        return;
      }
      if (FATAL_ERRORS.includes(code)) fatal = true;
      listener({ type: 'error', code, fatal: FATAL_ERRORS.includes(code) });
    };
    current.onend = () => {
      listener({ type: 'engine', name: 'end' });
      if (engine === current) engine = null;
      const again = wanted && !fatal && (boostRefused || options.continuous === true);
      const wasRefused = boostRefused;
      boostRefused = false;
      if (!again) {
        finish();
        return;
      }
      if (!wasRefused) {
        shortSessions = openedAt !== null && now() - openedAt >= SHORT_SESSION_MS ? 0 : shortSessions + 1;
        if (shortSessions >= MAX_SHORT_SESSIONS) {
          fail('keeps-closing');
          finish();
          return;
        }
      }
      listener({ type: 'engine', name: 'reopen' });
      reopen = setTimer(() => {
        reopen = null;
        if (wanted) open();
        else finish();
      }, REOPEN_PAUSE_MS);
    };

    engine = current;
    try {
      current.start();
    } catch {
      engine = null;
      fail('start-failed');
      finish();
    }
  };

  const end = (how: 'stop' | 'abort') => {
    if (!running) return;
    wanted = false;
    if (reopen !== null) {
      clearTimer(reopen);
      reopen = null;
      finish();
      return;
    }
    if (!engine) {
      finish();
      return;
    }
    const closing = engine;
    try {
      closing[how]();
    } catch {
      engine = null;
      finish();
      return;
    }
    // Some engines never report their end after being told to stop. The caller still gets its
    // "stopped": late news from that engine is ignored from then on.
    if (giveUp !== null) clearTimer(giveUp);
    giveUp = setTimer(() => {
      giveUp = null;
      if (!running || engine !== closing) return;
      closing.onstart = closing.onresult = closing.onerror = closing.onend = null;
      for (const name of LIFECYCLE) closing[`on${name}`] = null;
      engine = null;
      listener({ type: 'engine', name: 'no-end' });
      finish();
    }, how === 'abort' ? ABORT_GRACE_MS : STOP_GRACE_MS);
  };

  return {
    start() {
      if (running) return;
      running = true;
      wanted = true;
      fatal = false;
      boostRefused = false;
      shortSessions = 0;
      boost = options.boost ?? [];
      open();
    },
    stop: () => end('stop'),
    abort: () => end('abort'),
  };
}
