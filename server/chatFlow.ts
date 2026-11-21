import { analyzeIncoming, type IncomingAnalysis } from './ai.js';
import { applyAnalysis, chatStateLines, storeCustomerMessage, UNANSWERED } from './recordAnalysis.js';
import { changeConversation, loadForUpdate, type LoadedChat } from './store.js';
import { addReply, needsOwner, type IncomingMessage, type LiveConversation, type Translated } from './whatsappCore.js';

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
 * After a messenger was asked to send the reply: adds it when it went out, or tells the owner
 * nobody answered. `noticeSent`: WhatsApp's first text went out during this request.
 */
export async function recordDelivery(saved: Saved, reply: Translated | null, delivered: boolean, noticeSent: boolean, now = Date.now()) {
  if (!reply && !noticeSent) return;
  await changeConversation(saved.loaded, chat => {
    if (!chat) return { conversation: null, value: null };
    if (noticeSent) chat.noticeSent = true;
    if (reply && delivered) addReply(chat, 'ai', reply, now);
    else if (reply && !chat.takenOver) needsOwner(chat, UNANSWERED);
    return { conversation: chat, value: null };
  }, now);
}
