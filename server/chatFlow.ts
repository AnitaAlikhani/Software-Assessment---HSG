import { analyzeIncoming, type IncomingAnalysis } from './ai.js';
import { fixedReply, fixedReplyGermanEnglish } from './chatReplies.js';
import { countMessengerMessage, LIMIT_TEXTS } from './limits.js';
import { applyAnalysis, chatStateLines, storeCustomerMessage, UNANSWERED } from './recordAnalysis.js';
import { changeConversation, loadForUpdate, type LoadedChat } from './store.js';
import { addReply, needsOwner, type IncomingMessage, type LiveConversation, type Translated } from './whatsappCore.js';
import type { ChatLanguage } from '../src/types.js';

/**
 * The steps every channel (website chat, Telegram, WhatsApp) takes with a customer message, in
 * this order:
 *
 * 1. storeIncoming: the message is saved before the AI runs, so a slow or failing AI never loses it.
 * 2. askAi: the AI reads it (many seconds; nothing is locked meanwhile).
 * 3. applyAi: the AI's reading is applied to the chat as it is now. If the owner took the chat
 *    over, or the customer wrote again, in the meantime, the save notices it, reads the chat again
 *    and applies the reading to that: the reply is then not sent to a chat the owner handles.
 * 4. recordDelivery (messengers only): the reply is added once the messenger has taken it.
 *
 * Every save adds to the chat as it is at that moment (changeConversation in store.ts), so two
 * messages, or a message and an owner action, that arrive close together never overwrite each other.
 */

/** A chat that was saved: what the request knows of it now. */
export interface Saved { loaded: LoadedChat; conversation: LiveConversation }

export async function storeIncoming(incoming: IncomingMessage, loaded?: LoadedChat): Promise<Saved | null> {
  const start = loaded ?? await loadForUpdate(incoming.waId);
  const outcome = await changeConversation(start, chat => ({ conversation: storeCustomerMessage(chat, incoming), value: null }));
  return outcome.status === 'deleted' || !outcome.conversation ? null : { loaded: outcome.loaded, conversation: outcome.conversation };
}

/** The AI's reading of a message already in the chat, or null when the AI could not answer. */
export async function askAi(conversation: LiveConversation, messageId: string, now = Date.now()): Promise<IncomingAnalysis | null> {
  const index = conversation.messages.findIndex(message => message.id === messageId);
  if (index < 0) return null;
  try {
    const started = Date.now();
    const analysis = await analyzeIncoming(conversation.messages.slice(0, index), conversation.messages[index].original, new Date(now), chatStateLines(conversation, messageId, new Date(now)));
    console.log(`AI reply took ${Date.now() - started} ms`);
    return analysis;
  } catch (error) {
    console.error(error);
    return null;
  }
}

/**
 * Applies the AI's reading (null: the AI failed) to the chat as it is now. With `storeReply`
 * (the website chat, which reads its replies from the storage) the reply is saved with it.
 * Returns null when the chat is gone (the customer deleted it meanwhile).
 */
export async function applyAi(saved: Saved, messageId: string, analysis: IncomingAnalysis | null, storeReply: boolean, now = Date.now()) {
  const outcome = await changeConversation<Translated | null>(saved.loaded, chat => {
    if (!chat?.messages.some(message => message.id === messageId)) return { conversation: null, value: null };
    if (!analysis) {
      // In a chat the owner handles, her reason ("New message: ...") says it already.
      if (!chat.takenOver) needsOwner(chat, UNANSWERED);
      return { conversation: chat, value: null };
    }
    const reply = applyAnalysis(chat, messageId, analysis, new Date(now));
    if (reply && storeReply) addReply(chat, 'ai', reply, now);
    return { conversation: chat, value: reply };
  }, now);
  if (outcome.status === 'deleted' || !outcome.conversation) return null;
  return { loaded: outcome.loaded, conversation: outcome.conversation, reply: outcome.value };
}

/**
 * True while nobody has named the chat's language: the AI never read a message of it. Chats saved
 * before `languageSettled` existed count as settled once a customer message carries the AI's
 * German translation, which only the AI writes.
 */
const languageOpen = (chat: LiveConversation) =>
  !chat.languageSettled && !chat.messages.some(message => message.sender === 'customer' && message.translationDe);

/** Every form the "team will answer" sentence can take, to tell whether it is the last thing the customer got (chats saved before `teamPromised`). */
const TEAM_WILL_ANSWER = new Set([
  ...(['EN', 'DE', 'FR', 'IT'] as ChatLanguage[]).map(language => fixedReply('teamWillAnswer', language).original),
  fixedReplyGermanEnglish('teamWillAnswer').original,
]);

/**
 * In place of askAi and applyAi when the AI must not be asked (server/limits.ts): the day's AI
 * answers are used up, or a messenger chat passed its own limit. The chat goes to the owner with
 * `reason`, and the customer gets a fixed sentence that the team will answer, which is true
 * because the chat now waits for her. A chat whose language nobody named yet gets it in German
 * and English.
 *
 * Nothing is said that is not so: a chat the owner already handles gets no sentence (it waits for
 * her as it is), the sentence is not repeated while the customer keeps writing before anybody
 * answered, and a chat the customer deleted meanwhile stays deleted (null). Returns the same as
 * applyAi, so each channel sends and records the sentence as it would the AI's reply, with
 * `promise` set when the reply is this sentence (see recordDelivery).
 *
 * The right to send the sentence (`teamPromised`) is taken in the same save that sets the owner's
 * reason. Messages that arrive at the same moment save one after the other (changeConversation
 * reads the chat again when another request saved first), so only one of them takes it.
 */
export async function answerWithoutAi(saved: Saved, messageId: string, storeReply: boolean, now = Date.now(), reason: string = LIMIT_TEXTS.aiCeiling) {
  const outcome = await changeConversation<Translated | null>(saved.loaded, chat => {
    if (!chat?.messages.some(message => message.id === messageId)) return { conversation: null, value: null };
    // In a chat the owner handles, her reason ("New message: ...") says it already.
    if (chat.takenOver) return { conversation: chat, value: null };
    needsOwner(chat, reason);
    const lastAnswer = [...chat.messages].reverse().find(message => message.sender !== 'customer');
    const told = chat.teamPromised || (lastAnswer?.sender === 'ai' && TEAM_WILL_ANSWER.has(lastAnswer.original));
    if (told) return { conversation: chat, value: null };
    const reply = languageOpen(chat) ? fixedReplyGermanEnglish('teamWillAnswer') : fixedReply('teamWillAnswer', chat.language);
    chat.teamPromised = true;
    if (storeReply) addReply(chat, 'ai', reply, now, { promise: true });
    return { conversation: chat, value: reply };
  }, now);
  if (outcome.status === 'deleted' || !outcome.conversation) return null;
  return { loaded: outcome.loaded, conversation: outcome.conversation, reply: outcome.value, promise: outcome.value !== null };
}

/**
 * A customer's message on Telegram or WhatsApp, from storing it to the answer to send (the steps
 * above). A messenger cannot be told 429, so the limits of a chat (server/limits.ts) take the
 * path without the AI: a message over the chat's limit for a minute or its sender's limit for the
 * day, and any message once the day's AI answers are used up. Every message is stored; a chat
 * keeps its newest messages (store.ts MESSENGER_MESSAGES_KEPT). The count costs one storage
 * command; the read of the chat is the one storing needs anyway.
 *
 * `beforeAi` runs only when the AI is about to be asked (Telegram shows "typing…" then).
 * Returns what applyAi returns, or null when nothing is to be sent.
 */
/** What the owner reads when a messenger message took the path without the AI. */
const WITHOUT_AI_REASON = {
  chatPerMinute: LIMIT_TEXTS.pausedQuick,
  messengerPerDay: LIMIT_TEXTS.messengerPerDay,
  'ai-ceiling': LIMIT_TEXTS.aiCeiling,
} as const;

export async function answerMessengerMessage(incoming: IncomingMessage, beforeAi?: (saved: Saved) => Promise<unknown>, now = Date.now()) {
  const stored = await storeIncoming(incoming);
  if (!stored) return null; // deleted in the moment it arrived
  const check = await countMessengerMessage(incoming.waId, now);
  if (check !== 'ok') return answerWithoutAi(stored, incoming.id, false, now, WITHOUT_AI_REASON[check]);
  await beforeAi?.(stored);
  const answered = await applyAi(stored, incoming.id, await askAi(stored.conversation, incoming.id, now), false, now);
  return answered && { ...answered, promise: false };
}

/**
 * After a messenger was asked to send the reply: adds it when it went out, or tells the owner
 * nobody answered. `noticeSent`: WhatsApp's first text went out during this request. `promise`:
 * the reply is the "team will answer" sentence of answerWithoutAi; when it did not go out, its
 * right is given back so that a later message tries again, and the owner keeps the reason she has.
 */
export async function recordDelivery(saved: Saved, reply: Translated | null, delivered: boolean, noticeSent: boolean, now = Date.now(), promise = false) {
  if (!reply && !noticeSent) return;
  await changeConversation(saved.loaded, chat => {
    if (!chat) return { conversation: null, value: null };
    if (noticeSent) chat.noticeSent = true;
    if (reply && delivered) addReply(chat, 'ai', reply, now, { promise });
    else if (reply && promise) chat.teamPromised = undefined;
    else if (reply && !chat.takenOver) needsOwner(chat, UNANSWERED);
    return { conversation: chat, value: null };
  }, now);
}
