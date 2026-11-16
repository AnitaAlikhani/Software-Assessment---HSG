import process from 'node:process';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { initialAiSettings } from '../src/conversationData.js';
import { initialBookingHours, initialCompanySettings, initialServices } from '../src/mockData.js';
import type { ChatMessage } from '../src/types.js';
import { ALWAYS_HAND_OVER, BOOKING_FLOW, MAX_WEEKS_AHEAD, MIN_NOTICE_HOURS, SALON_FACTS, SLOT_STEP_MINUTES, STYLE_RULES } from './salonRules.js';

/**
 * Tried in order. When one model is overloaded or not offered to this key, the next one answers.
 * GEMINI_MODEL, if set, is tried first.
 */
const models = () => [
  ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []),
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
].filter((name, index, all) => all.indexOf(name) === index);
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

/** What the AI knows about the demo salon: website demo data plus the rulebook in salonRules.ts. */
export function salonContext() {
  const open = initialBookingHours.filter(day => day.isOpen);
  // Latest start so the service ends by closing time, assuming the same hours on all open days.
  const closing = open.length ? Math.min(...open.map(day => toMinutes(day.to))) : 18 * 60;
  const services = initialServices
    .map(service => {
      const lastStart = toTime(Math.floor((closing - service.durationMinutes) / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES);
      const extra = service.onlineBooking ? '' : ' The owner books this one personally: collect the request, then hand over.';
      return `- ${service.name}: ${service.durationMinutes} min, CHF ${service.priceCHF.toFixed(2)}. ${service.description ?? ''} Latest start ${lastStart}.${extra}`;
    })
    .join('\n');
  const hours = initialBookingHours.map(day => `- ${day.day}: ${day.isOpen ? `${day.from}–${day.to}` : 'closed'}`).join('\n');
  const handover = [
    ...initialAiSettings.handoverRules.filter(rule => rule.enabled).map(rule => rule.label),
    ...ALWAYS_HAND_OVER,
  ];
  const tone = initialAiSettings.tone === 'formal' ? 'polite and formal (use "Sie"/"vous" where the language has it)' : 'warm and friendly';
  const { companyName, street, postalCode, city, businessPhone } = initialCompanySettings;

  return `You are the booking assistant of ${companyName}, a small hair salon at ${street}, ${postalCode} ${city}. Salon phone: ${businessPhone}. Your tone is ${tone}.

SERVICES (the only services; never invent others or other prices):
${services}

OPENING HOURS:
${hours}

TIME RULES:
- Only suggest or accept start times on open days, inside opening hours, on ${SLOT_STEP_MINUTES}-minute steps, and early enough that the service ends by closing time.
- At least ${MIN_NOTICE_HOURS} hours from now and at most ${MAX_WEEKS_AHEAD} weeks ahead.
- If a wanted time breaks a rule, say why in a few words and offer the nearest two times that work.

SALON FACTS (you may share these):
${bullets(SALON_FACTS)}

BOOKING FLOW:
${bullets(BOOKING_FLOW)}

STYLE:
${bullets(STYLE_RULES)}

HAND OVER TO THE OWNER (set needsOwner, give a short reason, and tell the customer politely that the owner will reply soon):
${bullets(handover)}

Only help with the salon and appointments. If a message is about something else, say briefly that you can only help with appointments.`;
}

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
  /** Filled once service, day, time and first name are known. Empty strings otherwise. */
  bookingRequest?: BookingRequest;
}

export interface BookingRequest {
  service: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  customerName: string;
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
    bookingRequest: {
      type: 'object',
      description: 'Only when service, day, time and first name are all known and the time follows the rules. Otherwise all fields empty.',
      properties: {
        service: { type: 'string', description: 'Exact service name from the list, or empty' },
        date: { type: 'string', description: 'YYYY-MM-DD, or empty' },
        time: { type: 'string', description: 'HH:MM (24h), or empty' },
        customerName: { type: 'string', description: 'Customer first name, or empty' },
      },
      required: ['service', 'date', 'time', 'customerName'],
    },
  },
  required: ['languageCode', 'languageName', 'translationEn', 'translationDe', 'reply', 'replyEn', 'replyDe', 'needsOwner', 'reason', 'bookingRequest'],
};

const history = (messages: ChatMessage[]) =>
  messages.slice(-10).map(message => `${message.sender === 'customer' ? 'Customer' : 'Salon'}: ${message.original}`).join('\n') || '(no earlier messages)';

/** Errors where another model may still work: busy, rate-limited, unknown model, unsupported option, or our timeout. */
const tryNext = (error: unknown) =>
  /"code":\s*(400|404|429|500|503)|UNAVAILABLE|RESOURCE_EXHAUSTED|NOT_FOUND|INVALID_ARGUMENT|timed out/.test(String((error as Error)?.message ?? error));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Gemini timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function json<T>(prompt: string, schema: unknown, systemInstruction = salonContext()): Promise<T> {
  let lastError: unknown;
  for (const name of models()) {
    try {
      const response = await withTimeout(ai().models.generateContent({
        model: name,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature: 0.3,
          // Short chat replies need little reasoning; this keeps answers fast.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }), ATTEMPT_MS);
      return JSON.parse(response.text ?? '{}') as T;
    } catch (error) {
      lastError = error;
      console.warn(`Gemini model ${name} failed: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
      if (!tryNext(error)) break;
    }
  }
  throw lastError;
}

/** Reads a new customer message, translates it for the owner and drafts the AI reply. */
/** "Monday, 16 November 2026, 19:19" in salon time, so "tomorrow" or "next Friday" mean the right day. */
export const salonNow = (now = new Date()) =>
  now.toLocaleString('en-GB', {
    timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

export const analyzeIncoming = (earlier: ChatMessage[], text: string, now = new Date()) =>
  json<IncomingAnalysis>(
    `Right now it is ${salonNow(now)} (salon time, Europe/Zurich). Use this for words like "today", "tomorrow" or "next week", and only suggest times that are in the future and inside opening hours.\n\nConversation so far:\n${history(earlier)}\n\nNew customer message:\n${text}`,
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
