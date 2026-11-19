import { translateOwnerReply } from '../../server/ai.js';
import { hasLiveAccess } from '../../server/access.js';
import { sendFirstNoticeIfDue } from '../../server/firstNotice.js';
import { deletedSince, deleteConversation, listConversations, loadForUpdate, NO_DELETION_SEEN, saveConversation, storeConfigured } from '../../server/store.js';
import type { ChatVersion } from '../../server/store.js';
import { sendWhatsAppText } from '../../server/whatsappApi.js';
import { sendTelegramText } from '../../server/telegramApi.js';
import { addReply, publicConversations, telegramChatId } from '../../server/whatsappCore.js';
import { LANGUAGE_NAMES } from '../../src/conversationData.js';
import { bookingDateLabel } from '../../server/bookingRules.js';
import type { LiveConversation } from '../../server/whatsappCore.js';

/**
 * Translates an English text for the customer and sends it on the chat's own channel.
 * Returns null, and sends nothing, when the customer deleted the chat while the text was translated.
 */
async function translateAndSend(conversation: LiveConversation, version: ChatVersion, text: string) {
  const language = conversation.languageLabel ?? LANGUAGE_NAMES[conversation.language];
  let sent = { original: text, translation: text, translationDe: undefined as string | undefined };
  try {
    const translated = await translateOwnerReply(text, language);
    sent = { original: translated.customerText, translation: translated.translationEn, translationDe: translated.translationDe };
  } catch (error) {
    console.error(error); // Send as written rather than not at all.
  }
  // Website chats read the reply from storage; WhatsApp and Telegram chats need sending.
  const channel = conversation.channel ?? 'WhatsApp';
  if (channel !== 'Website') {
    // The translation took a while. A customer who deleted the chat meanwhile gets no message from it.
    if (await deletedSince(conversation.waId, version)) return null;
    // A WhatsApp customer who has not had the fixed first text gets it before this message.
    await sendFirstNoticeIfDue(conversation);
  }
  if (channel === 'Telegram') await sendTelegramText(telegramChatId(conversation.waId), sent.original);
  else if (channel === 'WhatsApp') await sendWhatsAppText(conversation.waId, sent.original);
  return sent;
}

type Action =
  | { type: 'reply'; conversationId: string; text: string }
  | { type: 'take-over'; conversationId: string }
  | { type: 'let-ai-continue'; conversationId: string }
  | { type: 'confirm-booking'; conversationId: string }
  | { type: 'delete'; conversationId: string };

/**
 * The customer deleted the chat while the owner's action was on its way. Nothing is stored again.
 * The owner's page shows this text, and its next look at the chats no longer finds this one.
 */
const deletedByCustomer = () => Response.json({ error: 'This chat was deleted by the customer.' }, { status: 410 });

/** The owner's actions on a live chat: reply, take over, or hand back to the AI. */
export async function POST(request: Request) {
  if (!hasLiveAccess(request)) return Response.json({ error: 'No access' }, { status: 401 });
  if (!storeConfigured()) return Response.json({ error: 'Storage is not configured' }, { status: 500 });

  let action: Action;
  try { action = (await request.json()) as Action; } catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }

  const waId = typeof action.conversationId === 'string' && action.conversationId.startsWith('live-') ? action.conversationId.slice(5) : '';
  const { conversation, version } = waId ? await loadForUpdate(waId) : { conversation: null, version: NO_DELETION_SEEN };
  if (!conversation) return Response.json({ error: 'This chat no longer exists' }, { status: 404 });

  if (action.type === 'delete') {
    await deleteConversation(conversation.waId);
    return Response.json({ conversations: publicConversations({ conversations: await listConversations() }) });
  }

  // The fixed first text of a WhatsApp chat may go out although the message after it does not.
  // The chat then still has to remember it, or the customer would get the text a second time.
  const noticeSentBefore = conversation.noticeSent;
  const rememberNotice = async () => {
    if (conversation.noticeSent && !noticeSentBefore) await saveConversation(conversation, version).catch(saveError => console.error(saveError));
  };

  if (action.type === 'take-over') {
    conversation.takenOver = true;
  } else if (action.type === 'let-ai-continue') {
    conversation.takenOver = false;
    conversation.status = 'ai-handled';
    conversation.attentionReason = undefined;
  } else if (action.type === 'reply') {
    const text = action.text?.trim();
    if (!text) return Response.json({ error: 'The reply is empty' }, { status: 400 });
    try {
      const sent = await translateAndSend(conversation, version, text);
      if (!sent) return deletedByCustomer();
      addReply(conversation, 'owner', sent);
    } catch (error) {
      console.error(error);
      await rememberNotice();
      return Response.json({ error: `${conversation.channel ?? 'WhatsApp'} did not accept the message. Check the bot or token settings in Vercel.` }, { status: 502 });
    }
  } else if (action.type === 'confirm-booking') {
    const booking = conversation.bookingRequest;
    if (!booking || booking.status !== 'requested') return Response.json({ error: 'There is no open booking request in this chat.' }, { status: 400 });
    const text = `Your appointment is confirmed: ${booking.service} on ${bookingDateLabel(booking.date)} at ${booking.time}. See you then, ${booking.customerName}!`;
    try {
      const sent = await translateAndSend(conversation, version, text);
      if (!sent) return deletedByCustomer();
      const takenOver = conversation.takenOver;
      addReply(conversation, 'owner', sent);
      conversation.takenOver = takenOver; // confirming does not pause the AI
    } catch (error) {
      console.error(error);
      await rememberNotice();
      return Response.json({ error: 'The confirmation could not be sent. Try again.' }, { status: 502 });
    }
    conversation.bookingRequest = { ...booking, status: 'confirmed' };
    conversation.status = 'booked';
    conversation.attentionReason = undefined;
  } else {
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  }

  // Saving checks for a deletion once more, in one step with the write.
  if (!(await saveConversation(conversation, version))) return deletedByCustomer();
  return Response.json({ conversations: publicConversations({ conversations: await listConversations() }) });
}
