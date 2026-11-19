import { randomUUID } from 'node:crypto';
import { analyzeIncoming } from '../server/ai.js';
import { recordAnalysis } from '../server/recordAnalysis.js';
import { hasLiveAccess } from '../server/access.js';
import { deleteOwnChat, loadConversation, loadForUpdate, saveConversation, storeConfigured } from '../server/store.js';
import {
  addCustomerMessage,
  addReply,
  isValidSessionId,
  needsOwner,
  stateFor,
  visitorMessages,
  webChatId,
} from '../server/whatsappCore.js';
import { initialCompanySettings } from '../src/mockData.js';

const MAX_TEXT = 1000;
/**
 * A chat stops taking messages at this length, so a script left running cannot use up the AI
 * quota. To be replaced by a limit per visitor and per address once that exists.
 */
const MAX_MESSAGES_PER_CHAT = 200;

const noStore = { 'Cache-Control': 'no-store' };

/** " or call +41 ..." when the salon has a phone number in Company Settings, otherwise nothing. */
const orCall = () => {
  const phone = initialCompanySettings.businessPhone.trim();
  return phone ? ` or call ${phone}` : '';
};
const tryAgain = () => Response.json({ error: 'Your message could not be sent. Please try again.' }, { status: 400 });

// Every error text here is shown to the customer as it is.
function guard(request: Request) {
  if (!hasLiveAccess(request)) {
    return Response.json({ error: 'This chat link is no longer valid. Please ask the salon for a new one.' }, { status: 401 });
  }
  if (!storeConfigured()) {
    return Response.json({ error: `The chat is not available at the moment. Please try again later${orCall()}.` }, { status: 500 });
  }
  return null;
}

/** The visitor's own chat, polled so owner replies appear without reloading. */
export async function GET(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const sessionId = new URL(request.url).searchParams.get('session');
  // The start screen asks before a chat exists, only to learn whether its link still works.
  if (sessionId === null) return Response.json({ messages: [] }, { headers: noStore });
  if (!isValidSessionId(sessionId)) return tryAgain();
  const conversation = await loadConversation(webChatId(sessionId));
  return Response.json({ messages: visitorMessages(conversation ?? undefined) }, { headers: noStore });
}

/** A visitor writes to the salon from the website chat. The AI answers like it would on WhatsApp. */
export async function POST(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;

  let body: { session?: unknown; name?: unknown; text?: unknown };
  try { body = await request.json(); } catch { return tryAgain(); }
  const sessionId = body.session;
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
  const name = (typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '') || 'Website visitor';
  if (!isValidSessionId(sessionId) || !text) return tryAgain();

  const waId = webChatId(sessionId);
  const { conversation: existing, version } = await loadForUpdate(waId);
  const state = stateFor(existing);
  if ((existing?.messages.length ?? 0) >= MAX_MESSAGES_PER_CHAT) {
    return Response.json({ error: `This conversation has become long. Please start a new chat${orCall()}.`, full: true }, { status: 429 });
  }

  let aiFailed = false;
  const incoming = { id: `web-${randomUUID()}`, waId, name, text, timestamp: Date.now(), channel: 'Website' as const };
  try {
    const started = Date.now();
    const analysis = await analyzeIncoming(existing?.messages ?? [], text);
    console.log(`AI reply took ${Date.now() - started} ms`);
    const { conversation, reply } = recordAnalysis(state, incoming, analysis);
    if (reply) addReply(conversation, 'ai', reply);
  } catch (error) {
    // Keep the message so the owner can still answer it.
    console.error(error);
    aiFailed = true;
    const conversation = state.processedIds.includes(incoming.id)
      ? state.conversations.find(item => item.waId === waId)!
      : addCustomerMessage(state, incoming, { original: text, translation: text }, 'EN');
    needsOwner(conversation, 'The AI could not answer this message. Please reply yourself.');
  }
  const conversation = state.conversations.find(item => item.waId === waId)!;
  // The answer took a while. If the visitor deleted the chat meanwhile (the page can be open
  // twice), it stays deleted: nothing is stored, and neither the earlier messages nor the answer
  // go back to the page.
  if (!(await saveConversation(conversation, version))) {
    return Response.json({ error: 'Your chat has been deleted, so this message was not sent. You can send it again to start a new chat.' }, { status: 410, headers: noStore });
  }
  return Response.json({ messages: visitorMessages(conversation), aiFailed }, { headers: noStore });
}

/** A visitor deletes their own chat: the messages are gone here and for the salon. */
export async function DELETE(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const sessionId = new URL(request.url).searchParams.get('session');
  if (!isValidSessionId(sessionId)) return Response.json({ error: 'The chat could not be deleted. Please try again.' }, { status: 400 });
  await deleteOwnChat(webChatId(sessionId));
  return Response.json({ deleted: true }, { headers: noStore });
}
