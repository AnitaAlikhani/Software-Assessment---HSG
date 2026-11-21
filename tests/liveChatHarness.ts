/**
 * What the tests of the live chat share when they need more than a well-behaved outside world:
 * an AI that takes its time (so something else can happen to the chat meanwhile), messengers that
 * fail to send, and builders for the calls the website, Telegram, Meta and the owner's page make.
 * The real model and the real messengers are never called.
 */
import { createHash, createHmac } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { LiveConversation } from '../server/whatsappCore';
import type { FakeStore } from './fakeStore';
import { FIXED_NOW } from './fixedClock';

export const NOW = FIXED_NOW.getTime();
export const SESSION = 'abc123def456ghi7';
export const SETTINGS = {
  LIVE_ACCESS_KEY: 'right-key', GEMINI_API_KEY: 'test-key', TELEGRAM_BOT_TOKEN: 'bot-token',
  WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 'token',
};

/** What the AI would answer to a customer message. */
export const aiAnswer = (overrides: Record<string, unknown> = {}) => ({
  languageCode: 'en', languageName: 'English', translationEn: 'Hello', translationDe: 'Hallo',
  reply: 'Hello! How can I help you?', replyEn: 'Hello! How can I help you?', replyDe: 'Hallo! Wie kann ich helfen?',
  needsOwner: false, reason: '', bookingRequest: { service: '', date: '', time: '', customerName: '' }, ...overrides,
});

/** The AI's answer when it has a complete booking request, in the current format (with intent and stylist). */
export const bookingAnswer = (request: Record<string, string> = {}, overrides: Record<string, unknown> = {}) => aiAnswer({
  intent: 'new',
  reply: 'Haircut on Tuesday, 6 October at 10:00 for Eva. The salon will confirm here.',
  replyEn: 'Haircut on Tuesday, 6 October at 10:00 for Eva. The salon will confirm here.',
  replyDe: 'Haarschnitt am Dienstag, 6. Oktober um 10:00 für Eva. Der Salon bestätigt hier.',
  bookingRequest: { service: 'Haircut', date: '2026-10-06', time: '10:00', customerName: 'Eva', staffName: '', ...request },
  ...overrides,
});

/** A website chat as an earlier request left it in the storage. */
export const liveChat = (overrides: Partial<LiveConversation> = {}): LiveConversation => ({
  waId: `web-${SESSION}`, channel: 'Website', customerName: 'Eva', language: 'EN', status: 'ai-handled', takenOver: false, updatedAt: NOW,
  messages: [{ id: 'm1', sender: 'customer', original: 'Hello', translation: 'Hello', time: '12:00' }],
  ...overrides,
});
/** Puts a chat into the storage, as a chat stored by an earlier version (no revision) would be. */
export const putChat = (store: FakeStore, chat: LiveConversation) =>
  store.run(['SET', `slotbee:live:chat:${chat.waId}`, JSON.stringify(chat), 'EX', 14 * 24 * 60 * 60]);

export interface Sent { channel: 'Telegram' | 'WhatsApp'; to: string; text: string }

export interface World {
  /** What reached a customer on a messenger, in order. */
  sent: Sent[];
  /** What a messenger was asked to send and did not take. */
  failed: Sent[];
  /** Every prompt the AI was given, in order. */
  prompts: string[];
  outside: (url: string, body: string) => Promise<unknown>;
}

export interface WorldOptions {
  /** What the AI answers to a customer message, if need be by the number of the call. null: the AI is down. */
  ai?: Record<string, unknown> | null | ((call: number) => Record<string, unknown> | null);
  /** Runs while the n-th call to the AI is on its way: the moment something else can happen to the chat. */
  whileAiWorks?: (call: number) => unknown;
  /**
   * Decides for the n-th message handed to a messenger whether it fails: a number is the status
   * the messenger answers with, true stands for a connection that broke.
   */
  sendFails?: (attempt: number, message: Sent) => number | boolean;
}

/** The services outside our own code: the AI and the two messengers. */
export function outsideWorld({ ai = aiAnswer(), whileAiWorks, sendFails }: WorldOptions = {}): World {
  let attempts = 0;
  const world: World = {
    sent: [], failed: [], prompts: [],
    outside: async (url, body) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        const { contents } = JSON.parse(body) as { contents?: string | { parts?: { text?: string }[] }[] };
        const prompt = typeof contents === 'string' ? contents : (contents ?? []).flatMap(item => item.parts ?? []).map(part => part.text ?? '').join('\n');
        world.prompts.push(prompt);
        // The number of this call, taken before anything else can call the AI meanwhile.
        const call = world.prompts.length;
        await whileAiWorks?.(call);
        // The owner's reply is translated by the same service. Here the "translation" is the text itself, marked.
        const translating = body.includes('customerText');
        const analysis = typeof ai === 'function' ? ai(call) : ai;
        if (!analysis && !translating) throw new Error('the AI is down');
        const message = prompt.split('Message:\n').pop() ?? '';
        const answer = translating ? { customerText: `[translated] ${message}`, translationEn: message, translationDe: message } : analysis;
        return { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP', index: 0 }] };
      }
      const telegram = url.startsWith('https://api.telegram.org/botbot-token/');
      if (telegram && !url.endsWith('/sendMessage')) return { ok: true, result: {} }; // "typing…"
      if (telegram || url.startsWith('https://graph.facebook.com/')) {
        const payload = JSON.parse(body) as { chat_id?: string; to?: string; text?: string | { body: string } };
        const message: Sent = telegram
          ? { channel: 'Telegram', to: String(payload.chat_id), text: String(payload.text ?? '') }
          : { channel: 'WhatsApp', to: String(payload.to), text: (payload.text as { body: string }).body };
        attempts += 1;
        const failure = sendFails?.(attempts, message) ?? false;
        if (failure !== false) {
          world.failed.push(message);
          if (failure === true) throw new Error('connection lost');
          const answer = telegram ? { ok: false, error_code: failure, description: 'refused' } : { error: { message: 'temporary' } };
          return new Response(JSON.stringify(answer), { status: failure, headers: { 'Content-Type': 'application/json' } });
        }
        world.sent.push(message);
        return telegram ? { ok: true, result: {} } : { messages: [{ id: 'wamid.out' }] };
      }
      throw new Error(`unexpected network call to ${url}`);
    },
  };
  return world;
}

/** Handlers read the clock themselves. Freeze it, so the tests give the same result on every day. */
export const freezeClock = (t: TestContext) => t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });

/** Runs `work` without console output and returns what would have been printed as errors. */
export async function quietly(work: () => Promise<unknown>): Promise<unknown[][]> {
  const real = { error: console.error, warn: console.warn, log: console.log };
  const errors: unknown[][] = [];
  console.warn = console.log = () => {};
  console.error = (...args: unknown[]) => { errors.push(args); };
  try { await work(); } finally { Object.assign(console, real); }
  return errors;
}

export const storedChat = (store: FakeStore, waId: string) =>
  JSON.parse(store.text(`slotbee:live:chat:${waId}`) ?? 'null') as (LiveConversation & { keptUntil?: number }) | null;

/** The visitor's page: reading, writing and deleting its own chat. */
export const chatRequest = (method: 'GET' | 'POST' | 'DELETE', { session, body }: { session?: string; body?: unknown } = {}) =>
  new Request(`https://site.invalid/api/chat${session === undefined ? '' : `?session=${session}`}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-live-key': 'right-key' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** The owner's page acting on a live chat. */
export const ownerAction = (action: Record<string, unknown>) =>
  new Request('https://site.invalid/api/whatsapp/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-live-key': 'right-key' },
    body: JSON.stringify(action),
  });

export const TELEGRAM_CHAT = 987654;
let updateId = 9000;
/** A message to the Telegram bot. Give `update` to deliver the very same update again, as Telegram does after a failure. */
export const telegramUpdate = (text: string, { update = (updateId += 1), languageCode = 'en' }: { update?: number; languageCode?: string } = {}) =>
  new Request('https://site.invalid/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': createHash('sha256').update('slotbee-telegram:bot-token').digest('hex').slice(0, 48),
    },
    body: JSON.stringify({
      update_id: update,
      message: { message_id: update, date: NOW / 1000, text, chat: { id: TELEGRAM_CHAT, type: 'private' }, from: { first_name: 'Ana', last_name: 'Silva', language_code: languageCode } },
    }),
  });

/** An invented number that cannot be anybody's. */
export const WHATSAPP_NUMBER = '41790000000';
let waMessage = 0;
/**
 * A message id as WhatsApp builds it: base64 of a few marker bytes, the sender's number and a
 * random part. So the id itself gives the number away to anyone who decodes it.
 */
export const whatsappMessageId = () => {
  waMessage += 1;
  const random = createHash('sha256').update(`message ${waMessage}`).digest('hex').slice(0, 20).toUpperCase();
  return `wamid.${Buffer.concat([
    Buffer.from([0x1c, 0x18, WHATSAPP_NUMBER.length]), Buffer.from(WHATSAPP_NUMBER),
    Buffer.from([0x15, 0x02, 0x00, 0x12, 0x18, random.length]), Buffer.from(random), Buffer.from([0x00]),
  ]).toString('base64')}`;
};
/** A message to the salon's WhatsApp number, signed like Meta signs it. */
export const whatsappMessage = (text: string, id = whatsappMessageId()) => {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      contacts: [{ wa_id: WHATSAPP_NUMBER, profile: { name: 'Sofia Rossi' } }],
      messages: [{ id, from: WHATSAPP_NUMBER, timestamp: String(NOW / 1000), type: 'text', text: { body: text } }],
    } }] }],
  });
  return new Request('https://site.invalid/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}` },
    body: raw,
  });
};
