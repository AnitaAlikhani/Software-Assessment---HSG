import { listConversationsAnd, storeConfigured } from '../../server/store.js';
import { publicConversations } from '../../server/whatsappCore.js';
import { customerChatToken, hasLiveAccess } from '../../server/access.js';
import { usesLiveData } from '../../server/environment.js';
import { countWrongTry, gateClosed, LIMIT_TEXTS, wrongTriesGate } from '../../server/limits.js';
import { telegramBotUsername } from '../../server/telegramApi.js';

const off = (status: number, error?: string) => Response.json({ enabled: false, conversations: [], ...(error ? { error } : {}) }, { status });

/**
 * The website polls this every few seconds to show live chats (WhatsApp and website chat). Only
 * the owner's key opens it. The answer also gives the owner's app what it needs to show the
 * channels: the bot's name and the token for the customers' chat links (server/access.ts).
 */
export async function GET(request: Request) {
  if (!hasLiveAccess(request)) {
    return (await countWrongTry(request)) ? off(429, LIMIT_TEXTS.wrongTriesOwner) : off(401);
  }
  if (!storeConfigured()) return off(200);
  // The address's wrong tries are read in the same command as the chats, so polling costs nothing more.
  const gate = wrongTriesGate(request);
  // The bot answers on the live site only, so a preview with its own chats does not advertise it.
  const [{ conversations, count }, telegram] = await Promise.all([listConversationsAnd(gate?.key ?? null), usesLiveData() ? telegramBotUsername() : null]);
  if (gateClosed(gate, count)) return off(429, LIMIT_TEXTS.wrongTriesOwner);
  return Response.json(
    { enabled: true, conversations: publicConversations({ conversations }), channels: { telegram, chatToken: customerChatToken() } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
