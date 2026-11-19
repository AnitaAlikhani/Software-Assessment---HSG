import { bookingHoursDay } from '../assistant/dates';
import { checkAssistantRequest, type AssistantLanguage, type AssistantRequest } from '../assistant/types';
import { salonTimeZone } from '../scheduling';
import type { Employee, ServiceItem } from '../types';
import { MAX_VOICE_ALTERNATIVES, MAX_VOICE_LINE, MAX_VOICE_LINES, type VoiceQuestion } from './question';

/**
 * Understanding what was said: the words of a call go to the server route /api/voice, where the
 * AI model fills in a request (what, when, with whom, for whom). Whether a time is free is
 * decided afterwards by the booking rules, never by the model.
 *
 * The route sees the spoken words and the names of services and staff. It never sees the
 * customer list or the calendar: a customer's name comes back as it was heard and is matched to
 * the customer list here in the browser (names.ts).
 */

/** One finished phrase as the speech recogniser delivered it. */
export interface HeardLine {
  text: string;
  /** Other ways the recogniser may have heard the same phrase. */
  alternatives?: string[];
}

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, MAX_VOICE_LINE).trim();

/** Builds the question field by field: nothing else from the app's data can slip into the request. */
export function voiceQuestion(
  heard: HeardLine[],
  salon: {
    today: string;
    timeZone?: string;
    language: AssistantLanguage;
    services: Pick<ServiceItem, 'id' | 'name'>[];
    employees: Pick<Employee, 'id' | 'name' | 'status'>[];
  },
): VoiceQuestion {
  const spoken = heard.map(line => ({ ...line, text: tidy(line.text) })).filter(line => line.text).slice(-MAX_VOICE_LINES);
  const newest = spoken.at(-1);
  return {
    lines: spoken.map(line => line.text),
    alternatives: [...new Set((newest?.alternatives ?? []).map(tidy))].filter(text => text && text !== newest?.text).slice(0, MAX_VOICE_ALTERNATIVES),
    today: salon.today,
    weekday: bookingHoursDay(salon.today),
    timeZone: salonTimeZone(salon.timeZone),
    language: salon.language,
    services: salon.services.map(service => ({ id: service.id, name: service.name })),
    staff: salon.employees.filter(employee => employee.status === 'Active').map(employee => ({ id: employee.id, name: employee.name })),
  };
}

/** A call cannot wait as long as a typed message: after this the words count as not read. */
const ROUTE_TIMEOUT_MS = 12_000;

/** Why the route gave no reading. Each one calls for something different from the person at the screen. */
export type RouteProblem =
  /** This address has no server behind it (a static copy of the site). */
  | 'no-server'
  /** The owner's key is missing or not accepted. */
  | 'no-access'
  /** The server would not take the question as it was. */
  | 'refused'
  /** The AI model gave no usable answer. */
  | 'failed'
  | 'too-slow'
  | 'offline';

export type RouteAnswer =
  /** `request` is the route's raw answer: check it with readUnderstanding() before use. */
  | { ok: true; request: unknown; modelMs: number | null }
  | { ok: false; problem: RouteProblem };

export async function askVoiceRoute(
  question: VoiceQuestion,
  liveKey: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = ROUTE_TIMEOUT_MS,
): Promise<RouteAnswer> {
  const controller = new AbortController();
  let late = false;
  const timer = setTimeout(() => { late = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetcher('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-live-key': liveKey },
      body: JSON.stringify(question),
      signal: controller.signal,
    });
    // A static copy of the site answers "not found", or refuses to be posted to at all.
    if (response.status === 404 || response.status === 405) return { ok: false, problem: 'no-server' };
    if (response.status === 401 || response.status === 403) return { ok: false, problem: 'no-access' };
    if (response.status === 400) return { ok: false, problem: 'refused' };
    if (!response.ok) return { ok: false, problem: 'failed' };
    const data = (await response.json()) as { request?: unknown; modelMs?: unknown };
    return { ok: true, request: data.request ?? null, modelMs: typeof data.modelMs === 'number' && Number.isFinite(data.modelMs) ? data.modelMs : null };
  } catch {
    return { ok: false, problem: late ? 'too-slow' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks the route's answer before anything is done with it: only ids the salon really has, only
 * real dates and times, and only a customer name made of words that were heard. Returns null
 * when the words held nothing to note, such as a greeting.
 */
export const readUnderstanding = (answer: unknown, question: VoiceQuestion): AssistantRequest | null =>
  checkAssistantRequest(answer, {
    serviceIds: question.services.map(service => service.id),
    employeeIds: question.staff.map(person => person.id),
  }, question.language, [...question.lines, ...question.alternatives].join(' '));
