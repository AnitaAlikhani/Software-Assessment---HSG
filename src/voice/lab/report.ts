import type { HeardAlternative, SpeechSupport } from '../transcriber';
import { scoreSentence, type KeyItem, type LabSentence, type SentenceScore } from './score';
import type { LabLanguage } from './sentences';

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
  heard: string;
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

/** The file a person sends back. */
export interface LabReport {
  kind: 'slotbee-voice-check';
  version: 1;
  createdAt: string;
  browser: { userAgent: string; languages: string[] };
  support: SpeechSupport;
  settings: LabSettings;
  summary: LabSummary;
  sentences: { id: string; text: string; keys: string[]; attempts: Attempt[] }[];
  talk: (TalkRecord & { lines: string[]; keys: string[] }) | null;
}

export function buildReport(input: {
  createdAt: string;
  browser: { userAgent: string; languages: string[] };
  support: SpeechSupport;
  settings: LabSettings;
  sentences: LabSentence[];
  attempts: Record<string, Attempt[]>;
  script: { lines: string[]; keys: KeyItem[] };
  talk: TalkRecord | null;
}): LabReport {
  return {
    kind: 'slotbee-voice-check',
    version: 1,
    createdAt: input.createdAt,
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
  };
}

/** A name for the downloaded file that says who, which language and when: "voice-check-de-ab-2026-11-19-1432.json". */
export function reportFileName(report: Pick<LabReport, 'createdAt' | 'settings'>): string {
  const label = report.settings.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stamp = report.createdAt.slice(0, 16).replace('T', '-').replace(':', '');
  return ['voice-check', report.settings.language, label, stamp].filter(Boolean).join('-') + '.json';
}
