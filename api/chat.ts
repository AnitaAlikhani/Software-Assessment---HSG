import { randomUUID } from 'node:crypto';
import { cleanName } from '../server/bookingRules.js';
import { answerWithoutAi, applyAi, askAi, storeIncoming } from '../server/chatFlow.js';
import { hasChatAccess } from '../server/access.js';
import { addressWaiting, countChatMessage, countWrongTry, gateClosed, LIMIT_TEXTS, LIMITS, wrongTriesGate } from '../server/limits.js';
import { deleteOwnChat, loadConversationAnd, loadForUpdate, storeConfigured } from '../server/store.js';
import { answeredBy, isValidSessionId, visitorMessages, webChatId } from '../server/whatsappCore.js';
import { initialCompanySettings } from '../src/mockData.js';

const MAX_TEXT = 1000;

const noStore = { 'Cache-Control': 'no-store' };

/** " or call +41 ..." when the salon has a phone number in Company Settings, otherwise nothing. */
const orCall = () => {
  const phone = initialCompanySettings.businessPhone.trim();
  return phone ? ` or call ${phone}` : '';
};
const tryAgain = () => Response.json({ error: 'Your message could not be sent. Please try again.' }, { status: 400 });

// Every error text here is shown to the customer as it is.
const refused = (error: string, status: number, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status, headers: noStore });
const waiting = () => refused(LIMIT_TEXTS.wrongTriesCustomer, 429);

/**
 * Only the customer's chat token opens this route (server/access.ts), never the owner's key: a
 * customer's link opens the customer's chat and nothing more. A wrong token is counted for its
 * address (server/limits.ts); a right one is checked against that count by each method, together
 * with the storage command it needs anyway where it can.
 */
async function guard(request: Request) {
  if (!hasChatAccess(request)) {
    if (await countWrongTry(request)) return waiting();
    return refused('This chat link is no longer valid. Please ask the salon for a new one.', 401);
  }
  if (!storeConfigured()) return refused(`The chat is not available at the moment. Please try again later${orCall()}.`, 500);
  return null;
}

/** The visitor's own chat, polled so owner replies appear without reloading. */
export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  const sessionId = new URL(request.url).searchParams.get('session');
  // The start screen asks before a chat exists, only to learn whether its link still works.
  if (sessionId === null) return (await addressWaiting(request)) ? waiting() : Response.json({ messages: [] }, { headers: noStore });
  if (!isValidSessionId(sessionId)) return tryAgain();
  // The page asks every few seconds: the address's wrong tries are read in the same command as the chat.
  const gate = wrongTriesGate(request);
  const { conversation, count } = await loadConversationAnd(webChatId(sessionId), gate?.key ?? null);
  if (gateClosed(gate, count)) return waiting();
  // Who answers is said only for a chat that exists.
  return Response.json({ messages: visitorMessages(conversation ?? undefined), ...(conversation ? { answeredBy: answeredBy(conversation) } : {}) }, { headers: noStore });
}

/** A visitor writes to the salon from the website chat. The AI answers like it would on WhatsApp. */
export async function POST(request: Request) {
  const blocked = await guard(request);
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
  // A chat stops taking messages at this length, so it cannot grow without end.
  if ((loaded.conversation?.messages.length ?? 0) >= LIMITS.chatInAll) {
    return refused(`This conversation has become long. Please start a new chat${orCall()}.`, 429, { full: true });
  }
  // One storage command: the address's wrong tries, and this message counted for its chat, its
  // address and the day's AI answers (server/limits.ts).
  const check = await countChatMessage(request, waId, !loaded.conversation);
  if (check === 'waiting') return waiting();
  if (check !== 'ok' && check !== 'ai-ceiling') return refused(LIMIT_TEXTS[check], 429);

  // The message is stored first: if the AI is slow or fails, the salon has it all the same.
  const incoming = { id: `web-${randomUUID()}`, waId, name, text, timestamp: Date.now(), channel: 'Website' as const };
  const stored = await storeIncoming(incoming, loaded);
  // With the day's AI answers used up, the AI is not asked: the chat goes to the owner (see answerWithoutAi).
  const withoutAi = check === 'ai-ceiling';
  const analysis = stored && !withoutAi ? await askAi(stored.conversation, incoming.id) : null;
  // The answer is added to the chat as it is now. If the owner took it over meanwhile, no AI reply is added.
  const answered = !stored ? null
    : withoutAi ? await answerWithoutAi(stored, incoming.id, true)
    : await applyAi(stored, incoming.id, analysis, true);
  // The answer took a while. If the visitor deleted the chat meanwhile (the page can be open
  // twice), it stays deleted: nothing is stored, and neither the earlier messages nor the answer
  // go back to the page.
  if (!answered) {
    return Response.json({ error: 'Your chat has been deleted, so this message was not sent. You can send it again to start a new chat.' }, { status: 410, headers: noStore });
  }
  return Response.json(
    { messages: visitorMessages(answered.conversation), aiFailed: !withoutAi && !analysis, answeredBy: answeredBy(answered.conversation) },
    { headers: noStore },
  );
}

/** A visitor deletes their own chat: the messages are gone here and for the salon. */
export async function DELETE(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  if (await addressWaiting(request)) return waiting();
  const sessionId = new URL(request.url).searchParams.get('session');
  if (!isValidSessionId(sessionId)) return Response.json({ error: 'The chat could not be deleted. Please try again.' }, { status: 400 });
  await deleteOwnChat(webChatId(sessionId));
  return Response.json({ deleted: true }, { headers: noStore });
}
