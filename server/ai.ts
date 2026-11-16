import process from 'node:process';
import { GoogleGenAI } from '@google/genai';
import { initialAiSettings } from '../src/conversationData.js';
import { initialBookingHours, initialCompanySettings, initialServices } from '../src/mockData.js';
import type { ChatMessage } from '../src/types.js';

const model = () => process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
let client: GoogleGenAI | null = null;
const ai = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return (client ??= new GoogleGenAI({ apiKey }));
};

/** What the AI knows about the demo salon. Mirrors the website's demo data. */
export function salonContext() {
  const services = initialServices
    .filter(service => service.onlineBooking)
    .map(service => `- ${service.name}: ${service.durationMinutes} min, CHF ${service.priceCHF.toFixed(2)}`)
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
- Always reply in the customer's language. Keep replies short and friendly, like a WhatsApp message.
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

async function json<T>(prompt: string, schema: unknown): Promise<T> {
  const response = await ai().models.generateContent({
    model: model(),
    contents: prompt,
    config: {
      systemInstruction: salonContext(),
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      temperature: 0.3,
    },
  });
  return JSON.parse(response.text ?? '{}') as T;
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
    `The salon owner wrote this reply. Translate it into ${customerLanguage} for the customer without adding anything. Also give it in English and German.\n\nOwner reply:\n${text}`,
    {
      type: 'object',
      properties: {
        customerText: { type: 'string' },
        translationEn: { type: 'string' },
        translationDe: { type: 'string' },
      },
      required: ['customerText', 'translationEn', 'translationDe'],
    },
  );
