import process from 'node:process';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { initialAiSettings } from '../src/conversationData.js';
import { initialBookingHours, initialCompanySettings, initialServices } from '../src/mockData.js';
import type { ChatMessage } from '../src/types.js';

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

/** What the AI knows about the demo salon. Mirrors the website's demo data. */
export function salonContext() {
  // All services: ones without online booking are still offered, the owner just books them by hand.
  const services = initialServices
    .map(service => `- ${service.name}: ${service.durationMinutes} min, CHF ${service.priceCHF.toFixed(2)}${service.onlineBooking ? '' : ' (the owner books this one personally: hand the chat over)'}`)
    .join('\n');
  const hours = initialBookingHours
    .map(day => `- ${day.day}: ${day.isOpen ? `${day.from}–${day.to}` : 'closed'}`)
    .join('\n');
  const handover = initialAiSettings.handoverRules.filter(rule => rule.enabled).map(rule => `- ${rule.label}`).join('\n');
  const { companyName, street, postalCode, city } = initialCompanySettings;
  return `You are the booking assistant of ${companyName}, ${street}, ${postalCode} ${city}, a small salon.

Services:
${services}

Opening hours:
${hours}

Rules:
- Only help with appointments: booking, moving and questions about services, prices and opening hours.
- Always reply in the customer's language. Keep replies short and friendly, like a chat message.
- Suggest times only inside the opening hours. You cannot see the live calendar, so say that the salon will confirm the exact time.
- Never promise discounts, refunds or anything not listed above.
- Hand these topics to the owner instead of answering them:
${handover}
  When you hand over, tell the customer politely that the owner will reply soon.
- If the message is not about the salon, answer briefly that you can only help with appointments.`;
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
  },
  required: ['languageCode', 'languageName', 'translationEn', 'translationDe', 'reply', 'replyEn', 'replyDe', 'needsOwner', 'reason'],
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
export const analyzeIncoming = (earlier: ChatMessage[], text: string) =>
  json<IncomingAnalysis>(`Conversation so far:\n${history(earlier)}\n\nNew customer message:\n${text}`, analysisSchema);

export interface OwnerReplyTranslation {
  customerText: string;
  translationEn: string;
  translationDe: string;
}

/** The owner types in their own language; the customer receives it in theirs. */
export const translateOwnerReply = (text: string, customerLanguage: string) =>
  json<OwnerReplyTranslation>(
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
