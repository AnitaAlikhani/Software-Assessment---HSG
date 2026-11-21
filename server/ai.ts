import process from 'node:process';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { initialAiSettings } from '../src/conversationData.js';
import { formatMoney, formatMonth, weekdayName, zonedDateTime } from '../src/format.js';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData.js';
import type { ChatMessage } from '../src/types.js';
import { ALWAYS_HAND_OVER, BOOKING_CASES, BOOKING_FLOW, MAX_WEEKS_AHEAD, MIN_NOTICE_HOURS, SALON_FACTS, SLOT_STEP_MINUTES, STYLE_RULES, teamFact } from './salonRules.js';

/**
 * Tried in order, all on Google's free tier. Each model has its own free daily quota; the Lite
 * model has the largest, so it goes first. When one is busy, out of quota or not offered to this
 * key, the next one answers. GEMINI_MODEL, if set, is tried first.
 */
export const models = () => [
  ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []),
  // Lite models: fast, with the largest free quotas.
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  // Bigger Flash models: smaller free quotas each, but every one counts separately.
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  // Open Gemma models: separate free quotas. No JSON mode, so the format goes into the prompt (see json()).
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
].filter((name, index, all) => all.indexOf(name) === index);

const isGemma = (name: string) => name.startsWith('gemma');

/** Pulls the JSON object out of a plain-text answer like "```json {...} ```". */
function parseJsonText<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not answer with JSON');
  return JSON.parse(text.slice(start, end + 1)) as T;
}
/** Each try gets this long, so a visitor never waits more than about half a minute. */
const ATTEMPT_MS = 12_000;
let client: GoogleGenAI | null = null;
const ai = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return (client ??= new GoogleGenAI({ apiKey }));
};

const toMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const bullets = (items: string[]) => items.map(item => `- ${item}`).join('\n');

/** "Tuesday to Friday" for days that follow each other in the week, otherwise "Tuesday, Thursday". */
const dayRange = (days: string[], week: string[]) => {
  const positions = days.map(day => week.indexOf(day));
  const inARow = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
  return days.length >= 3 && inARow ? `${days[0]} to ${days[days.length - 1]}` : days.join(', ');
};

/** What the AI knows about the salon: its services, team, address and hours, plus the rulebook in salonRules.ts. */
export function salonContext() {
  const open = initialBookingHours.filter(day => day.isOpen);
  const week = initialBookingHours.map(day => day.day);
  // The latest start lets the service end by closing time. Days do not all close at the same
  // time (Saturday is shorter), so each closing time gets its own latest start.
  const closings = [...new Set(open.map(day => day.to))];
  const latestStarts = (durationMinutes: number) => closings.map(closing => {
    const latest = toTime(Math.floor((toMinutes(closing) - durationMinutes) / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES);
    return closings.length === 1 ? latest : `${latest} (${dayRange(open.filter(day => day.to === closing).map(day => day.day), week)})`;
  }).join(', ');
  const services = initialServices
    .map(service => {
      const extra = service.onlineBooking ? '' : ' The owner books this one personally: collect the request, then hand over.';
      return `- ${service.name}: ${service.durationMinutes} min, ${formatMoney(service.priceCHF)}. ${service.description ?? ''} Latest start ${latestStarts(service.durationMinutes)}.${extra}`;
    })
    .join('\n');
  const hours = initialBookingHours.map(day => `- ${day.day}: ${day.isOpen ? `${day.from}–${day.to}` : 'closed'}`).join('\n');
  const handover = [
    ...initialAiSettings.handoverRules.filter(rule => rule.enabled).map(rule => rule.label),
    ...ALWAYS_HAND_OVER,
  ];
  const tone = initialAiSettings.tone === 'formal' ? 'polite and formal (use "Sie"/"vous" where the language has it)' : 'warm and friendly';
  const { companyName, street, postalCode, city, businessPhone } = initialCompanySettings;
  const address = [street, [postalCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  // A salon without a phone line gets no phone sentence: the AI must not invent a number.
  const phone = businessPhone.trim() ? ` Salon phone: ${businessPhone.trim()}.` : '';
  const team = teamFact(initialEmployees);

  return `You are the booking assistant of ${companyName}, a small hair salon${address ? ` at ${address}` : ''}.${phone} Your tone is ${tone}.

SERVICES (the only services; never invent others or other prices):
${services}

OPENING HOURS:
${hours}

TIME RULES:
- Only suggest or accept start times on open days, inside opening hours, on ${SLOT_STEP_MINUTES}-minute steps, and early enough that the service ends by closing time.
- At least ${MIN_NOTICE_HOURS} hours from now and at most ${MAX_WEEKS_AHEAD} weeks ahead.
- If a wanted time breaks a rule, say why in a few words and offer the nearest two times that work.

SALON FACTS (you may share these):
${bullets(team ? [...SALON_FACTS, team] : SALON_FACTS)}

BOOKING FLOW:
${bullets(BOOKING_FLOW)}

WHAT THE CUSTOMER WANTS (set intent to exactly one of these; one rule per case):
${bullets(BOOKING_CASES)}

STYLE:
${bullets(STYLE_RULES)}

HAND OVER TO THE OWNER (set needsOwner, give a short reason, and tell the customer politely that the owner will reply soon):
${bullets(handover)}

Only help with the salon and appointments. If a message is about something else, say briefly that you can only help with appointments.`;
}

/** What the customer's message is about. The server acts on this, never on the wording of the reply. */
export type Intent = 'new' | 'change' | 'cancel' | 'question';
export const INTENTS: Intent[] = ['new', 'change', 'cancel', 'question'];

export interface IncomingAnalysis {
  languageCode: string;
  languageName: string;
  translationEn: string;
  translationDe: string;
  reply: string;
  replyEn: string;
  replyDe: string;
  needsOwner: boolean;
  reason: string;
  /**
   * Missing in answers of the earlier format, and in any answer a model wrote without it: the
   * server then works out a safe meaning itself (see recordAnalysis.ts).
   */
  intent?: Intent;
  /** Filled once service, day, time and first name are known. Empty strings otherwise. */
  bookingRequest?: BookingRequest;
}

export interface BookingRequest {
  service: string;
  /** Id of that service in the salon's list. Added by the check in bookingRules.ts, not by the AI. */
  serviceId?: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  customerName: string;
  /** The stylist the customer asked for, as they wrote it. Matched against the team by the check, which adds employeeId. */
  staffName?: string;
  employeeId?: string;
}

const analysisSchema = {
  type: 'object',
  properties: {
    languageCode: { type: 'string', description: 'ISO 639-1 code of the customer message, e.g. fr' },
    languageName: { type: 'string', description: 'English name of that language, e.g. French' },
    translationEn: { type: 'string', description: 'The customer message in English' },
    translationDe: { type: 'string', description: 'The customer message in German' },
    reply: { type: 'string', description: "Your reply, in the customer's language" },
    replyEn: { type: 'string', description: 'Your reply in English' },
    replyDe: { type: 'string', description: 'Your reply in German' },
    needsOwner: { type: 'boolean', description: 'True when the rules say the owner must handle this' },
    reason: { type: 'string', description: 'If needsOwner, one short English sentence for the owner. Otherwise empty.' },
    intent: { type: 'string', enum: INTENTS, description: 'new: a new booking; change: move the confirmed appointment; cancel: cancel it; question: anything else' },
    bookingRequest: {
      type: 'object',
      description: 'Only for intent new or change, when service, day, time and first name are all known and the time follows the rules. Otherwise all fields empty.',
      properties: {
        service: { type: 'string', description: 'Exact service name from the list, or empty' },
        date: { type: 'string', description: 'YYYY-MM-DD, or empty' },
        time: { type: 'string', description: 'HH:MM (24h), or empty' },
        customerName: { type: 'string', description: 'Customer first name, or empty' },
        staffName: { type: 'string', description: 'First name of the stylist the customer asked for, or empty' },
      },
      required: ['service', 'date', 'time', 'customerName', 'staffName'],
    },
  },
  required: ['languageCode', 'languageName', 'translationEn', 'translationDe', 'reply', 'replyEn', 'replyDe', 'needsOwner', 'reason', 'intent', 'bookingRequest'],
};

/** How many earlier messages the AI sees. Enough for a booking talk that went back and forth; the chat state covers what came before. */
export const HISTORY_MESSAGES = 30;

const history = (messages: ChatMessage[]) =>
  messages.slice(-HISTORY_MESSAGES).map(message => `${message.sender === 'customer' ? 'Customer' : 'Salon'}: ${message.original}`).join('\n') || '(no earlier messages)';

/** Errors where another model may still work: busy, rate-limited, unknown model, unsupported option, or our timeout. */
const tryNext = (error: unknown) =>
  /"code":\s*(400|404|429|500|503)|UNAVAILABLE|RESOURCE_EXHAUSTED|NOT_FOUND|INVALID_ARGUMENT|timed out|did not answer with JSON|JSON/.test(String((error as Error)?.message ?? error));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Gemini timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** Stop trying more models after this long, so a visitor gets an answer (or a "busy" note) in time. */
const TOTAL_BUDGET_MS = 40_000;

export async function json<T>(prompt: string, schema: unknown, systemInstruction = salonContext()): Promise<T> {
  let lastError: unknown;
  const started = Date.now();
  for (const name of models()) {
    if (Date.now() - started > TOTAL_BUDGET_MS) break;
    // Some models reject the thinking setting; then the same model is tried once without it.
    for (const thinking of isGemma(name) ? [false] : [true, false]) {
      try {
        const response = await withTimeout(ai().models.generateContent(isGemma(name)
          ? {
              model: name,
              contents: `${systemInstruction}\n\n---\n\n${prompt}\n\n---\nAnswer with one JSON object only, no other text. It must match this JSON schema:\n${JSON.stringify(schema)}`,
              config: { temperature: 0.3 },
            }
          : {
              model: name,
              contents: prompt,
              config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseJsonSchema: schema,
                temperature: 0.3,
                // Short chat replies need little reasoning; this keeps answers fast.
                ...(thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
              },
            }), isGemma(name) ? 25_000 : ATTEMPT_MS);
        return isGemma(name) ? parseJsonText<T>(response.text ?? '') : JSON.parse(response.text ?? '{}') as T;
      } catch (error) {
        lastError = error;
        const message = String((error as Error)?.message ?? error);
        console.warn(`Gemini model ${name}${thinking ? '' : ' (no thinking)'} failed: ${message.slice(0, 200)}`);
        if (thinking && /thinking/i.test(message)) continue;
        break;
      }
    }
    if (!tryNext(lastError)) break;
  }
  throw lastError;
}

/** Reads a new customer message, translates it for the owner and drafts the AI reply. */
/**
 * "Monday, 16 November 2026 at 19:19" in salon time, so "tomorrow" or "next Friday" mean the
 * right day. This line is read by the AI model, not by a person: the month is spelled out, so
 * the model cannot take day and month for each other. It is put together from the date's parts,
 * so the wording does not change with the server's version.
 */
export const salonNow = (now = new Date()) => {
  const { date, time } = zonedDateTime(now, 'Europe/Zurich');
  return `${weekdayName(date)}, ${Number(date.slice(8))} ${formatMonth(date)} at ${time}`;
};

/**
 * `chatState` is what the server knows about the chat (see chatStateLines in recordAnalysis.ts):
 * the language, the first name and service known so far, a waiting or confirmed booking. It stands
 * before the conversation, so the markers "Conversation so far:" and "New customer message:" keep
 * their meaning for anything that reads the prompt.
 */
export const analyzeIncoming = (earlier: ChatMessage[], text: string, now = new Date(), chatState: string[] = []) =>
  json<IncomingAnalysis>(
    `Right now it is ${salonNow(now)} (salon time, Europe/Zurich). Use this for words like "today", "tomorrow" or "next week", and only suggest times that are in the future and inside opening hours.\n\n${chatState.length ? `Chat state (from the salon's records; trust it over your own reading of the conversation):\n${bullets(chatState)}\n\n` : ''}Conversation so far:\n${history(earlier)}\n\nNew customer message:\n${text}`,
    analysisSchema,
  );

export interface OwnerReplyTranslation {
  customerText: string;
  translationEn: string;
  translationDe: string;
}

/** The owner types in their own language; the customer receives it in theirs. */
export async function translateOwnerReply(text: string, customerLanguage: string): Promise<OwnerReplyTranslation> {
  const result = await json<OwnerReplyTranslation>(
    `Translate this message from a hair salon owner to a customer.\nTarget language for customerText: ${customerLanguage}.\nKeep the meaning, tone, times and prices exactly. Add nothing.\n\nMessage:\n${text}`,
    {
      type: 'object',
      properties: {
        customerText: { type: 'string', description: `The message translated into ${customerLanguage}` },
        translationEn: { type: 'string', description: 'The message in English' },
        translationDe: { type: 'string', description: 'The message in German' },
      },
      required: ['customerText', 'translationEn', 'translationDe'],
    },
    'You are a precise translator. You only translate; you never answer or change the message.',
  );
  // The model sometimes fills customerText in English. For English and German we already have the
  // right text in its own field, so use that; other languages keep customerText.
  const language = customerLanguage.trim().toLowerCase();
  if (language === 'german' && result.translationDe) result.customerText = result.translationDe;
  if (language === 'english' && result.translationEn) result.customerText = result.translationEn;
  if (!result.customerText?.trim()) throw new Error('Empty translation');
  return result;
}

/** For the owner's AI check: which free models answer right now, and how fast. */
export async function checkModels(full = false) {
  const results: { model: string; ok: boolean; ms: number; error?: string }[] = [];
  for (const name of models()) {
    const started = Date.now();
    try {
      if (full && isGemma(name)) {
        const response = await withTimeout(ai().models.generateContent({
          model: name,
          contents: `${salonContext()}\n\n---\n\nNew customer message:\nBonjour, une coupe demain à 15h ? Je suis Claire.\n\n---\nAnswer with one JSON object only, no other text. It must match this JSON schema:\n${JSON.stringify(analysisSchema)}`,
        }), 25_000);
        parseJsonText(response.text ?? '');
        results.push({ model: name, ok: true, ms: Date.now() - started });
        continue;
      }
      await withTimeout(ai().models.generateContent(full
        ? {
            model: name,
            contents: 'New customer message:\nBonjour, une coupe demain à 15h ? Je suis Claire.',
            config: { systemInstruction: salonContext(), responseMimeType: 'application/json', responseJsonSchema: analysisSchema, temperature: 0.3 },
          }
        : { model: name, contents: 'Reply with the word OK.' }), ATTEMPT_MS);
      results.push({ model: name, ok: true, ms: Date.now() - started });
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      const short = message.match(/"message":"([^"]{0,120})/)?.[1] ?? message.slice(0, 120);
      results.push({ model: name, ok: false, ms: Date.now() - started, error: short });
    }
  }
  return results;
}

/** Names of the models this key can use for chat, for picking free fallbacks. */
export async function listModelNames() {
  const names: string[] = [];
  const pager = await ai().models.list({ config: { pageSize: 200 } });
  for await (const model of pager) {
    if (model.supportedActions?.includes('generateContent') && model.name) names.push(model.name.replace(/^models\//, ''));
  }
  return names;
}
