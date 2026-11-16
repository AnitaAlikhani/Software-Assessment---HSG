import { translateOwnerReply } from '../../server/ai.js';
import { hasLiveAccess } from '../../server/access.js';
import { listConversations, loadConversation, saveConversation, storeConfigured } from '../../server/store.js';
import { sendWhatsAppText } from '../../server/whatsappApi.js';
import { sendTelegramText } from '../../server/telegramApi.js';
import { addReply, publicConversations, telegramChatId } from '../../server/whatsappCore.js';
import { LANGUAGE_NAMES } from '../../src/conversationData.js';

type Action =
  | { type: 'reply'; conversationId: string; text: string }
  | { type: 'take-over'; conversationId: string }
  | { type: 'let-ai-continue'; conversationId: string };

/** The owner's actions on a live chat: reply, take over, or hand back to the AI. */
export async function POST(request: Request) {
  if (!hasLiveAccess(request)) return Response.json({ error: 'No access' }, { status: 401 });
  if (!storeConfigured()) return Response.json({ error: 'Storage is not configured' }, { status: 500 });

  let action: Action;
  try { action = (await request.json()) as Action; } catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }

  const waId = typeof action.conversationId === 'string' && action.conversationId.startsWith('live-') ? action.conversationId.slice(5) : '';
  const conversation = waId ? await loadConversation(waId) : null;
  if (!conversation) return Response.json({ error: 'This chat no longer exists' }, { status: 404 });

  if (action.type === 'take-over') {
    conversation.takenOver = true;
  } else if (action.type === 'let-ai-continue') {
    conversation.takenOver = false;
    conversation.status = 'ai-handled';
    conversation.attentionReason = undefined;
  } else if (action.type === 'reply') {
    const text = action.text?.trim();
    if (!text) return Response.json({ error: 'The reply is empty' }, { status: 400 });
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
    try {
      if (channel === 'Telegram') await sendTelegramText(telegramChatId(conversation.waId), sent.original);
      else if (channel === 'WhatsApp') await sendWhatsAppText(conversation.waId, sent.original);
    } catch (error) {
      console.error(error);
      return Response.json({ error: `${channel} did not accept the message. Check the bot or token settings in Vercel.` }, { status: 502 });
    }
    addReply(conversation, 'owner', sent);
  } else {
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  }

  await saveConversation(conversation);
  return Response.json({ conversations: publicConversations({ conversations: await listConversations() }) });
}
