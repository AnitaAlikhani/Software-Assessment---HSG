import process from 'node:process';
import { analyzeIncoming } from '../../server/ai.js';
import { sendFirstNoticeIfDue } from '../../server/firstNotice.js';
import { recordAnalysis } from '../../server/recordAnalysis.js';
import { claimMessage, deletedSince, deleteOwnChat, loadForUpdate, saveConversation, storeConfigured } from '../../server/store.js';
import { sendWhatsAppText } from '../../server/whatsappApi.js';
import { addCustomerMessage, addReply, needsOwner, parseWebhook, stateFor, verifySignature } from '../../server/whatsappCore.js';
import type { LiveConversation } from '../../server/whatsappCore.js';
import { usesLiveData } from '../../server/environment.js';
import { chatDeletedNotice, chatNotDeletedNotice } from '../../src/customerNotice.js';
import { initialCompanySettings } from '../../src/mockData.js';
import type { ChatLanguage } from '../../src/types.js';

/** What the owner reads on a chat whose last message got no answer. */
const UNANSWERED = 'The AI could not answer this message. Please reply yourself.';

/** Meta calls this once when you save the webhook URL, to check it is really ours. */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  // A preview with its own chats must not become the address Meta delivers the live number to.
  if (usesLiveData() && verifyToken && params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === verifyToken) {
    return new Response(params.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

/** A customer writes "/delete": their chat is deleted and they are told so, without the AI. */
async function deleteChat(waId: string, language: ChatLanguage) {
  let deleted = false;
  try {
    await deleteOwnChat(waId);
    deleted = true;
  } catch (error) {
    console.error(error);
  }
  // Only say "deleted" when it is.
  await sendWhatsAppText(waId, deleted ? chatDeletedNotice(language, initialCompanySettings.companyName) : chatNotDeletedNotice(language))
    .catch(error => console.error(error));
}

/** Every new WhatsApp message to the salon's number arrives here. */
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

  for (const message of incoming) {
    if (!(await claimMessage(message.id))) continue; // Meta retried a webhook we already handled
    const { conversation: existing, version } = await loadForUpdate(message.waId);
    if (message.text.trim().toLowerCase() === '/delete') {
      await deleteChat(message.waId, existing?.language ?? 'EN');
      continue;
    }
    const state = stateFor(existing);
    const earlier = existing?.messages ?? [];
    let conversation: LiveConversation;
    let reply: ReturnType<typeof recordAnalysis>['reply'] = null;
    try {
      const analysis = await analyzeIncoming(earlier, message.text);
      ({ conversation, reply } = recordAnalysis(state, message, analysis));
    } catch (error) {
      // Keep the message visible even when the AI fails, so the owner can still reply.
      console.error(error);
      // The language is unknown when the AI did not answer: the chat keeps the one it had, and a
      // new chat gets English, the fallback everywhere else.
      conversation = state.processedIds.includes(message.id)
        ? state.conversations.find(item => item.waId === message.waId)!
        : addCustomerMessage(state, message, { original: message.text, translation: message.text }, existing?.language ?? 'EN', existing?.languageLabel);
      needsOwner(conversation, UNANSWERED);
    }
    // The AI took its time. A customer who sent /delete meanwhile has been told that the chat is
    // gone: they get nothing more from it, and nothing of it is stored again. (When nothing is
    // about to be sent, the save below finds out by itself.)
    if ((reply || !conversation.noticeSent) && await deletedSince(message.waId, version)) continue;
    // A notice that cannot be sent must not cost the customer the answer: it is tried again next time.
    await sendFirstNoticeIfDue(conversation);
    if (reply) {
      try {
        await sendWhatsAppText(message.waId, reply.original);
        addReply(conversation, 'ai', reply);
      } catch (error) {
        // WhatsApp did not take the answer. The owner sees the message and that nobody answered it.
        console.error(error);
        needsOwner(conversation, UNANSWERED);
      }
    }
    // Saving checks for a deletion once more, in one step with the write.
    await saveConversation(conversation, version);
  }
  return new Response('OK');
}
