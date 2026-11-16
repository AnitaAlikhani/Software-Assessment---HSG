import process from 'node:process';
import { analyzeIncoming } from '../../server/ai';
import { loadState, saveState, storeConfigured } from '../../server/store';
import { sendWhatsAppText } from '../../server/whatsappApi';
import { addCustomerMessage, addReply, needsOwner, parseWebhook, toChatLanguage, verifySignature } from '../../server/whatsappCore';

/** Meta calls this once when you save the webhook URL, to check it is really ours. */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (verifyToken && params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === verifyToken) {
    return new Response(params.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

/** Every new WhatsApp message to the test number arrives here. */
export async function POST(request: Request) {
  const raw = await request.text();
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !verifySignature(raw, request.headers.get('x-hub-signature-256'), appSecret)) {
    return new Response('Invalid signature', { status: 401 });
  }
  if (!storeConfigured()) return new Response('Storage is not configured', { status: 500 });

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response('Bad request', { status: 400 }); }
  const incoming = parseWebhook(body);
  if (incoming.length === 0) return new Response('OK'); // delivery/read receipts

  const state = await loadState();
  for (const message of incoming) {
    if (state.processedIds.includes(message.id)) continue; // Meta retried a webhook we already handled
    const earlier = state.conversations.find(item => item.waId === message.waId)?.messages ?? [];
    try {
      const analysis = await analyzeIncoming(earlier, message.text);
      const conversation = addCustomerMessage(
        state,
        message,
        { original: message.text, translation: analysis.translationEn, translationDe: analysis.translationDe },
        toChatLanguage(analysis.languageCode),
        analysis.languageName,
      );
      if (analysis.needsOwner) needsOwner(conversation, analysis.reason || 'The AI handed this chat to you.');
      if (!conversation.takenOver && analysis.reply) {
        await sendWhatsAppText(message.waId, analysis.reply);
        addReply(conversation, 'ai', { original: analysis.reply, translation: analysis.replyEn, translationDe: analysis.replyDe });
      }
    } catch (error) {
      // Keep the message visible even when the AI or WhatsApp fails, so the owner can still reply.
      const conversation = state.processedIds.includes(message.id)
        ? state.conversations.find(item => item.waId === message.waId)!
        : addCustomerMessage(state, message, { original: message.text, translation: message.text }, 'EN');
      needsOwner(conversation, 'The AI could not answer this message. Please reply yourself.');
      console.error(error);
    }
  }
  await saveState(state);
  return new Response('OK');
}
