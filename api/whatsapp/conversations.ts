import { listConversations, storeConfigured } from '../../server/store.js';
import { publicConversations } from '../../server/whatsappCore.js';
import { hasLiveAccess } from '../../server/access.js';
import { usesLiveData } from '../../server/environment.js';
import { telegramBotUsername } from '../../server/telegramApi.js';

/** The website polls this every few seconds to show live chats (WhatsApp and website chat). */
export async function GET(request: Request) {
  if (!hasLiveAccess(request)) return Response.json({ enabled: false, conversations: [] }, { status: 401 });
  if (!storeConfigured()) return Response.json({ enabled: false, conversations: [] });
  // The bot answers on the live site only, so a preview with its own chats does not advertise it.
  const [conversations, telegram] = await Promise.all([listConversations(), usesLiveData() ? telegramBotUsername() : null]);
  return Response.json(
    { enabled: true, conversations: publicConversations({ conversations }), channels: { telegram } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
