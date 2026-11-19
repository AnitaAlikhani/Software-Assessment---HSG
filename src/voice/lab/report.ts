import type { AssistantRequest } from '../../assistant/types';
import type { HeardAlternative, SpeechSupport } from '../transcriber';
import type { RouteProblem } from '../understand';
import type { ReadingScore } from './expected';
import { scoreSentence, type KeyItem, type LabSentence, type SentenceScore } from './score';
import type { LabLanguage, LabLanguagePack } from './sentences';

/**
 * What one round of the voice check produces: for every sentence what was heard, how many details
 * arrived and how long it took, plus one file with everything for the people who build the feature.
 * The file holds text and timings only. No sound is kept anywhere.
 */

/** Something the engine or the page noted, in milliseconds since Start was pressed. */
export interface LabEvent {
  ms: number;
  name: string;
}

/** What was gathered between Start and the end of listening. */
export interface Recording {
  /** When Start was pressed, as an ISO time. */
  startedAt: string;
  events: LabEvent[];
  /** The finished phrases in the order they arrived. */
  finals: { ms: number; text: string }[];
  /** The other ways the engine may have heard the last phrase. */
  alternatives: HeardAlternative[];
  /** How often the unfinished text changed while the person spoke. */
  interimCount: number;
  /** Words the engine had heard but never delivered as a finished phrase. Empty when all were delivered. */
  unfinished: string;
  errors: string[];
  durationMs: number;
}

export interface Timings {
  /** From the moment the engine noticed speech to the first words on screen. */
  firstWordMs: number | null;
  /** From the end of speech to the finished text: how long an answer would have to wait. */
  finalDelayMs: number | null;
  /** From the opening of the microphone to the finished text. */
  totalMs: number | null;
}

const firstAt = (events: LabEvent[], ...names: string[]): number | null =>
  events.find(event => names.includes(event.name))?.ms ?? null;
const lastAtBefore = (events: LabEvent[], name: string, before: number): number | null =>
  events.filter(event => event.name === name && event.ms <= before).at(-1)?.ms ?? null;

export function timingsOf(events: LabEvent[]): Timings {
  const speech = firstAt(events, 'speechstart');
  const firstWord = firstAt(events, 'interim', 'final');
  const final = events.filter(event => event.name === 'final').at(-1)?.ms ?? null;
  const opened = firstAt(events, 'start');
  // Not every engine says when speech ended. The last change of the unfinished text is close to it.
  const quietFrom = final === null ? null : lastAtBefore(events, 'speechend', final) ?? lastAtBefore(events, 'interim', final);
  return {
    firstWordMs: speech !== null && firstWord !== null && firstWord >= speech ? firstWord - speech : null,
    finalDelayMs: final !== null && quietFrom !== null ? final - quietFrom : null,
    totalMs: final !== null ? final - (opened ?? 0) : null,
  };
}

/** One try at one sentence. */
export interface Attempt {
  startedAt: string;
  /** The finished text. Only this is scored. */
  heard: string;
  /** What the engine was still working on when listening ended. Not scored. */
  unfinished: string;
  alternatives: HeardAlternative[];
  interimCount: number;
  errors: string[];
  events: LabEvent[];
  timings: Timings;
  score: SentenceScore;
}

export const heardText = (recording: Recording): string => recording.finals.map(part => part.text).join(' ');

export function attemptFrom(sentence: LabSentence, recording: Recording): Attempt {
  const heard = heardText(recording);
  return {
    startedAt: recording.startedAt,
    heard,
    unfinished: recording.unfinished,
    alternatives: recording.alternatives,
    interimCount: recording.interimCount,
    errors: recording.errors,
    events: recording.events,
    timings: timingsOf(recording.events),
    score: scoreSentence(sentence, heard),
  };
}

/** The short call, read in one go while the engine keeps listening. */
export interface TalkRecord {
  startedAt: string;
  heard: string;
  /** What the engine was still working on when one of its sessions closed. Not scored. */
  unfinished: string;
  /** The phrases as the engine cut them, with the moment each one was finished. */
  segments: { ms: number; text: string }[];
  /** How often the engine closed by itself and was opened again. */
  reopened: number;
  errors: string[];
  events: LabEvent[];
  durationMs: number;
  score: SentenceScore;
}

export function talkFrom(script: { lines: string[]; keys: KeyItem[] }, recording: Recording): TalkRecord {
  const heard = heardText(recording);
  return {
    startedAt: recording.startedAt,
    heard,
    unfinished: recording.unfinished,
    segments: recording.finals,
    reopened: recording.events.filter(event => event.name === 'reopen').length,
    errors: recording.errors,
    events: recording.events,
    durationMs: recording.durationMs,
    score: scoreSentence({ id: 'talk', text: script.lines.join(' '), keys: script.keys }, heard),
  };
}

export type Variety = 'standard' | 'dialect';
export type Noise = 'quiet' | 'some' | 'loud';
export type Microphone = 'built-in' | 'headset' | 'other';

/** What the person chose before the round. It labels the results. */
export interface LabSettings {
  /** Initials or a nickname, to tell rounds apart. May be empty. */
  label: string;
  language: LabLanguage;
  /** What the engine was told, for example "de-CH". */
  locale: string;
  variety: Variety;
  noise: Noise;
  microphone: Microphone;
  onDevice: boolean;
  boost: boolean;
}

export interface LabSummary {
  sentencesDone: number;
  sentencesTotal: number;
  /** Details that arrived, over all sentences that were read. The last try of each sentence counts. */
  keysFound: number;
  keysTotal: number;
  /** Sentences in which every detail arrived. */
  sentencesComplete: number;
  /** The middle value of each sentence's wait from the end of speech to the finished text. */
  medianFinalDelayMs: number | null;
  medianFirstWordMs: number | null;
  /** The middle value of the share of differing words, 0 to 1. */
  medianWordErrors: number | null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2 * 100) / 100;
}

const present = (value: number | null): value is number => value !== null;

export function summarise(sentences: LabSentence[], attempts: Record<string, Attempt[]>): LabSummary {
  const last = sentences.map(sentence => attempts[sentence.id]?.at(-1)).filter((attempt): attempt is Attempt => attempt !== undefined);
  const withKeys = last.filter(attempt => attempt.score.total > 0);
  return {
    sentencesDone: last.length,
    sentencesTotal: sentences.length,
    keysFound: withKeys.reduce((sum, attempt) => sum + attempt.score.foundCount, 0),
    keysTotal: withKeys.reduce((sum, attempt) => sum + attempt.score.total, 0),
    sentencesComplete: withKeys.filter(attempt => attempt.score.foundCount === attempt.score.total).length,
    medianFinalDelayMs: median(last.map(attempt => attempt.timings.finalDelayMs).filter(present)),
    medianFirstWordMs: median(last.map(attempt => attempt.timings.firstWordMs).filter(present)),
    medianWordErrors: median(last.filter(attempt => attempt.heard).map(attempt => attempt.score.wordErrors)),
  };
}

/** What the AI model made of one text, and how long the answer took. */
export interface ReadingRecord {
  /** The lines that were sent: one sentence, or the call up to this phrase. */
  lines: string[];
  alternatives: string[];
  /** The checked reading. Null when the model noted nothing, or when there is a problem. */
  request: AssistantRequest | null;
  problem: RouteProblem | null;
  /** From sending the question to having the answer, as the person at the screen waits. */
  ms: number | null;
  /** The part of that wait the model itself took, as the server measured it. */
  modelMs: number | null;
  /** Null where the text is not scored (a phone number, the confirming phrase, the call before its end). */
  score: ReadingScore | null;
}

/** One round read by the AI model: every sentence on its own, and the call phrase by phrase. */
export interface Understanding {
  askedAt: string;
  /** By the id of the sentence. Sentences with no finished text are not in it. */
  sentences: Record<string, ReadingRecord>;
  /** The call after each of its phrases. Only the last one is scored. */
  call: ReadingRecord[];
  summary: {
    /** Details the model got right, over everything that is scored. */
    right: number;
    total: number;
    /** How many texts were sent, and how many came back with a problem. */
    asked: number;
    problems: number;
    medianMs: number | null;
    medianModelMs: number | null;
  };
}

export function summariseReadings(readings: ReadingRecord[]): Understanding['summary'] {
  const scored = readings.filter(reading => reading.score !== null && reading.problem === null);
  return {
    right: scored.reduce((sum, reading) => sum + (reading.score?.right ?? 0), 0),
    total: scored.reduce((sum, reading) => sum + (reading.score?.total ?? 0), 0),
    asked: readings.length,
    problems: readings.filter(reading => reading.problem !== null).length,
    medianMs: median(readings.filter(reading => reading.problem === null).map(reading => reading.ms).filter(present)),
    medianModelMs: median(readings.map(reading => reading.modelMs).filter(present)),
  };
}

/** The file a person sends back. */
export interface LabReport {
  kind: 'slotbee-voice-check';
  /**
   * 2: tries also hold the unfinished text, and the events say when Stop was pressed.
   * 3: the day the round was spoken, and what the AI model understood when it was asked.
   */
  version: 3;
  createdAt: string;
  /** The salon's day (YYYY-MM-DD) on which the round was spoken: "tomorrow" is read from it. */
  spokenOn: string;
  browser: { userAgent: string; languages: string[] };
  support: SpeechSupport;
  settings: LabSettings;
  summary: LabSummary;
  sentences: { id: string; text: string; keys: string[]; attempts: Attempt[] }[];
  talk: (TalkRecord & { lines: string[]; keys: string[] }) | null;
  understanding: Understanding | null;
}

export function buildReport(input: {
  createdAt: string;
  spokenOn: string;
  browser: { userAgent: string; languages: string[] };
  support: SpeechSupport;
  settings: LabSettings;
  sentences: LabSentence[];
  attempts: Record<string, Attempt[]>;
  script: { lines: string[]; keys: KeyItem[] };
  talk: TalkRecord | null;
  understanding?: Understanding | null;
}): LabReport {
  return {
    kind: 'slotbee-voice-check',
    version: 3,
    createdAt: input.createdAt,
    spokenOn: input.spokenOn,
    browser: input.browser,
    support: input.support,
    settings: { ...input.settings, label: input.settings.label.trim().slice(0, 40) },
    summary: summarise(input.sentences, input.attempts),
    sentences: input.sentences.map(sentence => ({
      id: sentence.id,
      text: sentence.text,
      keys: sentence.keys.map(item => item.label),
      attempts: input.attempts[sentence.id] ?? [],
    })),
    talk: input.talk ? { ...input.talk, lines: input.script.lines, keys: input.script.keys.map(item => item.label) } : null,
    understanding: input.understanding ?? null,
  };
}

// ---------- opening a round that was saved before ----------

/** A round as the page holds it. */
export interface SavedRound {
  createdAt: string;
  /** Empty in files from before the day was written down: the page then takes it from createdAt. */
  spokenOn: string;
  browser: { userAgent: string; languages: string[] };
  support: SpeechSupport;
  settings: LabSettings;
  attempts: Record<string, Attempt[]>;
  talk: TalkRecord | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {});
const oneOf = <Choice extends string>(value: unknown, choices: readonly Choice[], fallback: Choice): Choice =>
  (choices as readonly unknown[]).includes(value) ? value as Choice : fallback;

/** Only what a recording is made of is taken from a file, each part with the type it must have. */
function savedRecording(value: unknown): Recording {
  const raw = record(value);
  const events = list(raw.events).map(record).filter(event => typeof event.ms === 'number' && typeof event.name === 'string')
    .map(event => ({ ms: event.ms as number, name: event.name as string }));
  return {
    startedAt: text(raw.startedAt),
    events,
    // A sentence has one text; a call keeps how the engine cut it.
    finals: list(raw.segments).map(record).filter(part => typeof part.text === 'string').map(part => ({ ms: Number(part.ms) || 0, text: part.text as string })),
    alternatives: list(raw.alternatives).map(record).filter(option => typeof option.text === 'string').map(option => ({ text: option.text as string, confidence: Number(option.confidence) || 0 })),
    interimCount: Number(raw.interimCount) || events.filter(event => event.name === 'interim').length,
    unfinished: text(raw.unfinished),
    errors: list(raw.errors).filter((code): code is string => typeof code === 'string'),
    durationMs: Number(raw.durationMs) || 0,
  };
}

/**
 * Reads a results file back into a round, so it can be looked at again and read by the AI model
 * without anybody speaking a second time. What was heard is taken from the file; the scores are
 * worked out again with today's sentences. Returns null for anything that is no round of the check.
 */
export function roundFromReport(value: unknown, languages: Record<LabLanguage, LabLanguagePack>): SavedRound | null {
  const raw = record(value);
  if (raw.kind !== 'slotbee-voice-check' || typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) return null;
  const settings = record(raw.settings);
  if (settings.language !== 'en' && settings.language !== 'de') return null;
  const pack = languages[settings.language];
  const saved = new Map(list(raw.sentences).map(record).map(entry => [text(entry.id), list(entry.attempts)] as const));
  const attempts: Record<string, Attempt[]> = {};
  for (const sentence of pack.sentences) {
    const tries = (saved.get(sentence.id) ?? []).map((attempt) => {
      const heard = text(record(attempt).heard);
      return attemptFrom(sentence, { ...savedRecording(attempt), finals: heard ? [{ ms: 0, text: heard }] : [] });
    });
    if (tries.length > 0) attempts[sentence.id] = tries;
  }
  const call = raw.talk === null || raw.talk === undefined ? null : savedRecording(raw.talk);
  const browser = record(raw.browser);
  const support = record(raw.support);
  return {
    createdAt: raw.createdAt,
    spokenOn: /^\d{4}-\d{2}-\d{2}$/.test(text(raw.spokenOn)) ? text(raw.spokenOn) : '',
    browser: { userAgent: text(browser.userAgent), languages: list(browser.languages).filter((entry): entry is string => typeof entry === 'string') },
    support: { recognition: support.recognition === true, onDevice: support.onDevice === true, boost: support.boost === true },
    settings: {
      label: text(settings.label).slice(0, 40),
      language: settings.language,
      locale: text(settings.locale) || pack.locales[0].code,
      variety: oneOf(settings.variety, ['standard', 'dialect'] as const, 'standard'),
      noise: oneOf(settings.noise, ['quiet', 'some', 'loud'] as const, 'quiet'),
      microphone: oneOf(settings.microphone, ['built-in', 'headset', 'other'] as const, 'built-in'),
      onDevice: settings.onDevice === true,
      boost: settings.boost === true,
    },
    attempts,
    talk: call ? talkFrom(pack.talk, call) : null,
  };
}

/** A name for the downloaded file that says who, which language and when: "voice-check-de-ab-2026-11-19-1432.json". */
export function reportFileName(report: Pick<LabReport, 'createdAt' | 'settings'>): string {
  const label = report.settings.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stamp = report.createdAt.slice(0, 16).replace('T', '-').replace(':', '');
  return ['voice-check', report.settings.language, label, stamp].filter(Boolean).join('-') + '.json';
}
