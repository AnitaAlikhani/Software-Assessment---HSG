import { createHmac } from 'node:crypto';
import process from 'node:process';
import { hasLiveAccess } from './access.js';
import { salonToday } from './recordAnalysis.js';
import { countUp, keyPrefix, MESSENGER_MESSAGES_KEPT, storeConfigured, type Counter } from './store.js';

/**
 * How much the live chats may be used, so that a link passed around, a script left running or
 * somebody guessing keys cannot use up the salon's free AI and storage quota or keep the chat busy.
 *
 * Every limit counts in a fixed window (this minute, this hour, this salon day, these ten
 * minutes) in the storage, under the chats' own data space. A counter is named after a hash,
 * never after an address or a chat id, and deletes itself after its window.
 *
 * A counter must never be the reason the chat is down: when the storage is not set up or a count
 * fails, the request goes through.
 */
export const LIMITS = {
  /** Customer messages in one chat within a minute. */
  chatPerMinute: { most: 12, seconds: 60 },
  /**
   * Website chat only: messages one chat may hold in all. A longer chat is closed and the visitor
   * starts a new one ("Start a new chat").
   */
  chatInAll: 200,
  /**
   * Telegram and WhatsApp: customer messages from one sender within a salon day. A messenger chat
   * is one ongoing conversation with a person and cannot be started anew, so over this the
   * messages are still kept, but the AI pauses in that chat and the owner answers.
   */
  messengerPerDay: { most: 200, seconds: 24 * 60 * 60 },
  /**
   * Telegram and WhatsApp: the most messages a chat keeps. A message added beyond it removes the
   * oldest ones (the AI reads only the last 30 anyway), so no customer message is ever refused.
   */
  messengerKept: MESSENGER_MESSAGES_KEPT,
  /**
   * New chats started from one address within a salon day. Generous: a class on one Wi-Fi shares
   * one address, and 25 people who each start over a few times would soon pass 50.
   */
  newChatsPerAddress: { most: 200, seconds: 24 * 60 * 60 },
  /** Customer messages from one address within an hour. Generous: a class or a salon's Wi-Fi shares one address. */
  messagesPerAddress: { most: 600, seconds: 60 * 60 },
  /** AI answers to customers over the whole site and every channel within a salon day. */
  aiAnswersPerDay: { most: 1500, seconds: 24 * 60 * 60 },
  /**
   * Wrong keys or tokens from one address within ten minutes; beyond that the address waits. High
   * enough that a class opening an outdated link does not lock out the owner on the same Wi-Fi,
   * low enough that guessing a key takes for ever.
   */
  wrongTries: { most: 60, seconds: 10 * 60 },
} as const;

/** What the person who is refused reads. */
export const LIMIT_TEXTS = {
  chatPerMinute: 'You are sending messages very quickly. Please wait a minute and try again.',
  messagesPerAddress: 'Too many messages have been sent from this connection. Please try again in an hour.',
  newChatsPerAddress: 'Too many chats have been started from this connection today. Please try again tomorrow.',
  wrongTriesCustomer: 'This chat link has been tried too often with a wrong code. Please try again in 10 minutes.',
  wrongTriesOwner: 'Too many wrong access keys were sent from this connection. Please wait 10 minutes and try again.',
  /** The owner reads this on the chat when the day's AI answers are used up, and when she asks the AI to answer. */
  aiCeiling: "The AI has reached today's limit of answers. Please reply yourself.",
  /** The owner reads this on a Telegram or WhatsApp chat whose customer passed the chat's limit for a minute. */
  pausedQuick: 'The customer is sending many messages quickly. The AI has paused in this chat: please reply yourself.',
  /** The owner reads this on a Telegram or WhatsApp chat whose customer passed the day's limit of messages. */
  messengerPerDay: 'This customer has sent very many messages today. The AI has paused in this chat: please reply yourself.',
} as const;

/** The caller's address as the hosting platform passes it on: the first entry of x-forwarded-for, else x-real-ip. */
export function clientAddress(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || null;
}

/**
 * A name that cannot be read back: an address has so few possible values that a plain hash of
 * it could be reversed by trying them all, so the hash is keyed with the site's own secret.
 */
const nameFor = (kind: string, subject: string) =>
  createHmac('sha256', process.env.LIVE_ACCESS_KEY ?? '').update(`${kind}:${subject}`).digest('hex').slice(0, 32);

/**
 * The window a moment falls in. A day is the salon's day (Europe/Zurich), so "today's limit"
 * means the day the owner sees; anything shorter counts from the start of the epoch.
 */
const windowOf = (seconds: number, now: number) =>
  seconds === 24 * 60 * 60 ? salonToday(new Date(now)) : String(Math.floor(now / (seconds * 1000)));
/**
 * How long a counter is kept. A salon day can last 25 hours when the clocks change, and a
 * counter made at the start of its window must still be there at its end.
 */
const keepFor = (seconds: number) => seconds === 24 * 60 * 60 ? 25 * 60 * 60 : seconds;

type Limit = { most: number; seconds: number };
const counter = (name: string, limit: Limit, subject: string | null, now: number): Counter => ({
  key: `${keyPrefix()}limit:${name}:${subject === null ? '' : `${nameFor(name, subject)}:`}${windowOf(limit.seconds, now)}`,
  seconds: keepFor(limit.seconds),
  most: limit.most,
});

/** The wrong-tries counter of the request's address, or null when no address is known (nothing to count under). */
export function wrongTriesGate(request: Request, now = Date.now()): { key: string; most: number } | null {
  const address = clientAddress(request);
  if (!address) return null;
  return { key: counter('wrong', LIMITS.wrongTries, address, now).key, most: LIMITS.wrongTries.most };
}

/** True when a gate read in another command (see store.ts loadConversationAnd) shows the address is waiting. */
export const gateClosed = (gate: { most: number } | null, count: number) => gate !== null && count >= gate.most;

/** Runs a count; a storage that is not set up, or a count that fails, lets the request through. */
async function tryCount<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  if (!storeConfigured()) return fallback;
  try { return await work(); } catch (error) {
    console.error(error);
    return fallback;
  }
}

/**
 * A wrong (or missing) key or token arrived. Counts it for the address; true when the address has
 * now had more than its share and must wait (the answer is then 429, not 401).
 */
export async function countWrongTry(request: Request, now = Date.now()): Promise<boolean> {
  const address = clientAddress(request);
  if (!address) return false;
  const limit = counter('wrong', LIMITS.wrongTries, address, now);
  return tryCount(async () => {
    const counts = await countUp(null, [{ key: limit.key, seconds: limit.seconds }]);
    return counts !== 'blocked' && (counts[0] ?? 0) > LIMITS.wrongTries.most;
  }, false);
}

/** A right key or token arrived. True when its address is still waiting after too many wrong ones. */
export async function addressWaiting(request: Request, now = Date.now()): Promise<boolean> {
  const gate = wrongTriesGate(request, now);
  if (!gate) return false;
  return tryCount(async () => (await countUp(gate, [])) === 'blocked', false);
}

/**
 * The check of every owner route: 'ok', 'no-access' (401) or 'waiting' (429, too many wrong
 * keys from this address). A right key from an address that is not waiting costs one read and
 * is never slowed.
 */
export async function ownerAccess(request: Request, now = Date.now()): Promise<'ok' | 'no-access' | 'waiting'> {
  if (!hasLiveAccess(request)) return (await countWrongTry(request, now)) ? 'waiting' : 'no-access';
  return (await addressWaiting(request, now)) ? 'waiting' : 'ok';
}

/**
 * What the owner's routes answer when access is refused: the route's usual "No access" for a
 * wrong key, and a sentence with 429 for an address that has to wait.
 */
export function ownerRefusal(outcome: 'no-access' | 'waiting', answer: (error: string, status: number) => Response) {
  return outcome === 'waiting' ? answer(LIMIT_TEXTS.wrongTriesOwner, 429) : answer('No access', 401);
}

export type MessageCheck = 'ok' | 'waiting' | 'ai-ceiling' | 'chatPerMinute' | 'messagesPerAddress' | 'newChatsPerAddress';

/**
 * A customer's message on the website chat, with a right token: reads the address's wrong-tries
 * gate and counts the message for its chat, its address (and the new chat, if it is one) and the
 * day's AI answers, all in one storage command. The AI comes last, so a refused message does not
 * use up an answer. 'ai-ceiling': the message may be stored, but the AI must not be asked.
 */
export async function countChatMessage(request: Request, chatId: string, newChat: boolean, now = Date.now()): Promise<MessageCheck> {
  const address = clientAddress(request);
  const checks: { name: MessageCheck; counter: Counter }[] = [
    { name: 'chatPerMinute', counter: counter('chat-minute', LIMITS.chatPerMinute, chatId, now) },
    ...(address ? [{ name: 'messagesPerAddress' as const, counter: counter('address-hour', LIMITS.messagesPerAddress, address, now) }] : []),
    ...(address && newChat ? [{ name: 'newChatsPerAddress' as const, counter: counter('address-chats', LIMITS.newChatsPerAddress, address, now) }] : []),
    { name: 'ai-ceiling', counter: aiCounter(now) },
  ];
  return tryCount(async () => {
    const counts = await countUp(wrongTriesGate(request, now), checks.map(check => check.counter));
    if (counts === 'blocked') return 'waiting';
    const over = checks.find((check, index) => (counts[index] ?? 0) > (check.counter.most ?? Infinity));
    return over?.name ?? 'ok';
  }, 'ok' as MessageCheck);
}

const aiCounter = (now: number) => counter('ai-day', LIMITS.aiAnswersPerDay, null, now);

/**
 * A customer's message on Telegram or WhatsApp: counted for its chat's minute, its sender's salon
 * day and the day's AI answers, in one storage command (the AI last, so a message over a limit of
 * the chat uses none). A messenger cannot be answered with 429, so the caller takes the path
 * without the AI for anything but 'ok' (chatFlow.ts answerWithoutAi).
 */
export async function countMessengerMessage(chatId: string, now = Date.now()): Promise<'ok' | 'chatPerMinute' | 'messengerPerDay' | 'ai-ceiling'> {
  const checks = [
    { name: 'chatPerMinute' as const, counter: counter('chat-minute', LIMITS.chatPerMinute, chatId, now) },
    { name: 'messengerPerDay' as const, counter: counter('messenger-day', LIMITS.messengerPerDay, chatId, now) },
    { name: 'ai-ceiling' as const, counter: aiCounter(now) },
  ];
  return tryCount(async () => {
    const counts = await countUp(null, checks.map(check => check.counter));
    if (counts === 'blocked') return 'ok';
    return checks.find((check, index) => (counts[index] ?? 0) > (check.counter.most ?? Infinity))?.name ?? 'ok';
  }, 'ok' as const);
}

/**
 * Counts one AI answer to a customer (the owner's "AI answers now"; a message on a messenger is
 * counted by countMessengerMessage, a website message by countChatMessage). True
 * when the day's answers are used up: the AI must not be asked then.
 */
export async function aiCeilingReached(now = Date.now()): Promise<boolean> {
  const limit = aiCounter(now);
  return tryCount(async () => {
    const counts = await countUp(null, [limit]);
    return counts !== 'blocked' && (counts[0] ?? 0) > LIMITS.aiAnswersPerDay.most;
  }, false);
}
