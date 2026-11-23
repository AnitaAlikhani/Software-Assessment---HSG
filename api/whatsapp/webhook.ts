import process from 'node:process';
import { cleanName } from '../../server/bookingRules.js';
import { answerMessengerMessage, recordDelivery } from '../../server/chatFlow.js';
import { addressWaiting, countWrongTry } from '../../server/limits.js';
import { sendFirstNoticeIfDue } from '../../server/firstNotice.js';
import { loadConversationAndSalon } from '../../server/salon.js';
import { claimMessage, deleteOwnChat, storeConfigured } from '../../server/store.js';
import { sendWhatsAppText } from '../../server/whatsappApi.js';
import { parseWebhook, verifySignature } from '../../server/whatsappCore.js';
import { usesLiveData } from '../../server/environment.js';
import { chatDeletedNotice, chatNotDeletedNotice } from '../../src/customerNotice.js';

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

/**
 * A customer writes "/delete": their chat is deleted and they are told so, without the AI. The
 * chat (for its language) and the salon (for its name) are read in one command.
 */
async function deleteChat(waId: string) {
  const { conversation, salon } = await loadConversationAndSalon(waId);
  const language = conversation?.language ?? 'EN';
  let deleted = false;
  try {
    await deleteOwnChat(waId);
    deleted = true;
  } catch (error) {
    console.error(error);
  }
  // Only say "deleted" when it is.
  await sendWhatsAppText(waId, deleted ? chatDeletedNotice(language, salon.companySettings.companyName) : chatNotDeletedNotice(language))
    .catch(error => console.error(error));
}

/** Every new WhatsApp message to the salon's number arrives here. */
export async function POST(request: Request) {
  const raw = await request.text();
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  // A signature made without the app secret is counted for its address and, after too many wrong
  // tries, made to wait (server/limits.ts).
  if (!appSecret || !verifySignature(raw, request.headers.get('x-hub-signature-256'), appSecret)) {
    return (await countWrongTry(request)) ? new Response('Too many wrong tries', { status: 429 }) : new Response('Invalid signature', { status: 401 });
  }
  if (!storeConfigured()) return new Response('Storage is not configured', { status: 500 });
  if (await addressWaiting(request)) return new Response('Too many wrong tries', { status: 429 });

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response('Bad request', { status: 400 }); }
  const incoming = parseWebhook(body);
  if (incoming.length === 0) return new Response('OK'); // delivery/read receipts

  for (const message of incoming) {
    if (!(await claimMessage(message.id))) continue; // Meta retried a webhook we already handled
    if (message.text.trim().toLowerCase() === '/delete') {
      await deleteChat(message.waId);
      continue;
    }
    // The message is stored before the AI runs, so a slow or failing AI never loses it. The answer
    // is applied to the chat as it is now. A customer who sent /delete meanwhile has been told that
    // the chat is gone: they get nothing more from it, and nothing of it is stored again. A chat
    // the owner took over meanwhile gets no AI reply. Past a limit the AI is not asked: the chat
    // goes to the owner and the customer is told the team will answer (see answerMessengerMessage).
    const answered = await answerMessengerMessage({ ...message, name: cleanName(message.name) || 'WhatsApp customer' });
    if (!answered) continue;
    const { conversation, reply } = answered;
    // A notice that cannot be sent must not cost the customer the answer: it is tried again next time.
    const noticeBefore = conversation.noticeSent;
    await sendFirstNoticeIfDue(conversation, answered.salon);
    let delivered = false;
    if (reply) {
      try {
        await sendWhatsAppText(message.waId, reply.original);
        delivered = true;
      } catch (error) {
        // WhatsApp did not take the answer. The owner sees the message and that nobody answered it.
        console.error(error);
      }
    }
    await recordDelivery(answered, reply, delivered, Boolean(conversation.noticeSent && !noticeBefore), Date.now(), answered.promise);
  }
  return new Response('OK');
}
