import { randomUUID } from 'node:crypto';
import { cleanName } from '../server/bookingRules.js';
import { applyAi, askAi, storeIncoming } from '../server/chatFlow.js';
import { hasLiveAccess } from '../server/access.js';
import { deleteOwnChat, loadConversation, loadForUpdate, storeConfigured } from '../server/store.js';
import { answeredBy, isValidSessionId, visitorMessages, webChatId } from '../server/whatsappCore.js';
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
  // Who answers is said only for a chat that exists.
  return Response.json({ messages: visitorMessages(conversation ?? undefined), ...(conversation ? { answeredBy: answeredBy(conversation) } : {}) }, { headers: noStore });
}

/** A visitor writes to the salon from the website chat. The AI answers like it would on WhatsApp. */
export async function POST(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;

  let body: { session?: unknown; name?: unknown; text?: unknown };
  try { body = await request.json(); } catch { return tryAgain(); }
  const sessionId = body.session;
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
  // The name is shown to the owner and may end up in a message to the visitor: no markup, no line breaks.
  const name = cleanName(body.name) || 'Website visitor';
  if (!isValidSessionId(sessionId) || !text) return tryAgain();

  const waId = webChatId(sessionId);
  const loaded = await loadForUpdate(waId);
  if ((loaded.conversation?.messages.length ?? 0) >= MAX_MESSAGES_PER_CHAT) {
    return Response.json({ error: `This conversation has become long. Please start a new chat${orCall()}.`, full: true }, { status: 429 });
  }

  // The message is stored first: if the AI is slow or fails, the salon has it all the same.
  const incoming = { id: `web-${randomUUID()}`, waId, name, text, timestamp: Date.now(), channel: 'Website' as const };
  const stored = await storeIncoming(incoming, loaded);
  const analysis = stored ? await askAi(stored.conversation, incoming.id) : null;
  // The answer is added to the chat as it is now. If the owner took it over meanwhile, no AI reply is added.
  const answered = stored ? await applyAi(stored, incoming.id, analysis, true) : null;
  // The answer took a while. If the visitor deleted the chat meanwhile (the page can be open
  // twice), it stays deleted: nothing is stored, and neither the earlier messages nor the answer
  // go back to the page.
  if (!answered) {
    return Response.json({ error: 'Your chat has been deleted, so this message was not sent. You can send it again to start a new chat.' }, { status: 410, headers: noStore });
  }
  return Response.json(
    { messages: visitorMessages(answered.conversation), aiFailed: !analysis, answeredBy: answeredBy(answered.conversation) },
    { headers: noStore },
  );
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
