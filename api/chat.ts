import { randomUUID } from 'node:crypto';
import { analyzeIncoming } from '../server/ai.js';
import { hasLiveAccess } from '../server/access.js';
import { loadState, saveState, storeConfigured } from '../server/store.js';
import {
  addCustomerMessage,
  addReply,
  isValidSessionId,
  needsOwner,
  toChatLanguage,
  visitorMessages,
  webChatId,
} from '../server/whatsappCore.js';

const MAX_TEXT = 1000;
/** Keeps the free Gemini quota safe if someone leaves a script running. */
const MAX_MESSAGES_PER_CHAT = 80;

const noStore = { 'Cache-Control': 'no-store' };

function guard(request: Request) {
  if (!hasLiveAccess(request)) return Response.json({ error: 'This chat link is not valid.' }, { status: 401 });
  if (!storeConfigured()) return Response.json({ error: 'Storage is not configured.' }, { status: 500 });
  return null;
}

/** The visitor's own chat, polled so owner replies appear without reloading. */
export async function GET(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const sessionId = new URL(request.url).searchParams.get('session');
  if (!isValidSessionId(sessionId)) return Response.json({ error: 'Bad session' }, { status: 400 });
  const state = await loadState();
  const conversation = state.conversations.find(item => item.waId === webChatId(sessionId));
  return Response.json({ messages: visitorMessages(conversation) }, { headers: noStore });
}

/** A visitor writes to the salon from the website chat. The AI answers like it would on WhatsApp. */
export async function POST(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;

  let body: { session?: unknown; name?: unknown; text?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }
  const sessionId = body.session;
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
  const name = (typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '') || 'Website visitor';
  if (!isValidSessionId(sessionId) || !text) return Response.json({ error: 'Bad request' }, { status: 400 });

  const state = await loadState();
  const waId = webChatId(sessionId);
  const existing = state.conversations.find(item => item.waId === waId);
  if ((existing?.messages.length ?? 0) >= MAX_MESSAGES_PER_CHAT) {
    return Response.json({ error: 'This test chat is full. Please start a new chat.' }, { status: 429 });
  }

  let aiFailed = false;
  const incoming = { id: `web-${randomUUID()}`, waId, name, text, timestamp: Date.now(), channel: 'Website' as const };
  try {
    const analysis = await analyzeIncoming(existing?.messages ?? [], text);
    const conversation = addCustomerMessage(
      state,
      incoming,
      { original: text, translation: analysis.translationEn, translationDe: analysis.translationDe },
      toChatLanguage(analysis.languageCode),
      analysis.languageName,
    );
    if (analysis.needsOwner) needsOwner(conversation, analysis.reason || 'The AI handed this chat to you.');
    if (!conversation.takenOver && analysis.reply) {
      addReply(conversation, 'ai', { original: analysis.reply, translation: analysis.replyEn, translationDe: analysis.replyDe });
    }
  } catch (error) {
    // Keep the message so the owner can still answer it.
    console.error(error);
    aiFailed = true;
    const conversation = state.processedIds.includes(incoming.id)
      ? state.conversations.find(item => item.waId === waId)!
      : addCustomerMessage(state, incoming, { original: text, translation: text }, 'EN');
    needsOwner(conversation, 'The AI could not answer this message. Please reply yourself.');
  }
  await saveState(state);
  const conversation = state.conversations.find(item => item.waId === waId);
  return Response.json({ messages: visitorMessages(conversation), aiFailed }, { headers: noStore });
}
