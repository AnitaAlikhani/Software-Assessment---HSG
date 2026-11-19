import type { AssistantLanguage, AssistantRequest } from '../../assistant/types';
import { formatDate } from '../../format';
import type { VoiceQuestion } from '../question';
import { askVoiceRoute, readUnderstanding, voiceQuestion, type HeardLine, type RouteAnswer } from '../understand';
import { EXPECTED_CALL, expectedFor, scoreReading, type Expected } from './expected';
import { summariseReadings, type Attempt, type ReadingRecord, type TalkRecord, type Understanding } from './report';
import { checkSalon } from './salon';
import type { LabLanguagePack } from './sentences';

/**
 * Lets the AI model read a round of the voice check: every sentence on its own, then the call
 * phrase by phrase, the way the words would arrive while somebody is on the phone. Each reading
 * is scored against what the sentence says, and timed.
 */

export interface RoundToRead {
  pack: LabLanguagePack;
  language: AssistantLanguage;
  attempts: Record<string, Attempt[]>;
  talk: TalkRecord | null;
  /** The salon's day on which the round was spoken. */
  spokenOn: string;
}

export interface TextToRead {
  key: string;
  heard: HeardLine[];
  expected: Expected | null;
}

/** The texts of a round in the order they are sent. A sentence with no finished text is left out. */
export function textsToRead(round: RoundToRead): TextToRead[] {
  const texts: TextToRead[] = [];
  for (const sentence of round.pack.sentences) {
    const last = round.attempts[sentence.id]?.at(-1);
    if (!last?.heard) continue;
    texts.push({ key: sentence.id, heard: [{ text: last.heard, alternatives: last.alternatives.map(option => option.text) }], expected: expectedFor(sentence.id) });
  }
  const phrases = round.talk?.segments ?? [];
  phrases.forEach((_, index) => texts.push({
    key: `call-${index + 1}`,
    heard: phrases.slice(0, index + 1).map(phrase => ({ text: phrase.text })),
    // The call is about what was agreed in the end: only the reading after its last phrase is scored.
    expected: index === phrases.length - 1 ? EXPECTED_CALL : null,
  }));
  return texts;
}

/** After these, asking again for the next text would fail the same way. */
const STOPS_THE_ROUND = ['no-server', 'no-access'];
/**
 * A breath between two questions. The AI service allows a free key only so many questions a
 * minute, and the same key answers the salon's customers: a round must not use them all at once.
 */
const PAUSE_MS = 1500;

export interface ReadOptions {
  ask?: (question: VoiceQuestion, liveKey: string) => Promise<RouteAnswer>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  askedAt?: string;
}

export async function readRound(round: RoundToRead, liveKey: string, options: ReadOptions = {}): Promise<Understanding> {
  const ask = options.ask ?? ((question: VoiceQuestion, key: string) => askVoiceRoute(question, key));
  const now = options.now ?? (() => performance.now());
  const wait = options.wait ?? ((ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); }));
  const salon = { ...checkSalon(), today: round.spokenOn };
  const texts = textsToRead(round);
  const sentences: Record<string, ReadingRecord> = {};
  const call: ReadingRecord[] = [];
  const all: ReadingRecord[] = [];

  for (const [index, text] of texts.entries()) {
    options.onProgress?.(index, texts.length);
    if (index > 0) await wait(PAUSE_MS);
    const question = voiceQuestion(text.heard, { today: round.spokenOn, language: round.language, services: salon.services, employees: salon.employees });
    const started = now();
    const answer = await ask(question, liveKey);
    const ms = Math.round(now() - started);
    const request = answer.ok ? readUnderstanding(answer.request, question) : null;
    const reading: ReadingRecord = {
      lines: question.lines,
      alternatives: question.alternatives,
      request,
      problem: answer.ok ? null : answer.problem,
      ms,
      modelMs: answer.ok ? answer.modelMs : null,
      score: answer.ok && text.expected ? scoreReading(text.expected, request, salon) : null,
    };
    all.push(reading);
    if (text.key.startsWith('call-')) call.push(reading);
    else sentences[text.key] = reading;
    if (!answer.ok && STOPS_THE_ROUND.includes(answer.problem)) break;
  }
  options.onProgress?.(texts.length, texts.length);
  return { askedAt: options.askedAt ?? new Date().toISOString(), sentences, call, summary: summariseReadings(all) };
}

/** A reading in a few words, for the page: "availability · Thu, 26.11.2026 · 15:30 · Haircut · for Leah Bruner". */
export function describeReading(request: AssistantRequest | null): string {
  if (!request) return 'nothing to note';
  const salon = checkSalon();
  const service = salon.services.find(item => item.id === request.serviceId)?.name;
  const staff = salon.employees.find(item => item.id === request.employeeId)?.name;
  const parts = [
    request.intent,
    request.date ? formatDate(request.date, { weekday: 'short' }) : '',
    request.time,
    request.partOfDay,
    service,
    staff ? `with ${staff}` : '',
    request.customerName ? `for ${request.customerName}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'nothing to note';
}
