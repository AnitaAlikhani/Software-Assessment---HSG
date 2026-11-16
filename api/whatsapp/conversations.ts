import { listConversations, storeConfigured } from '../../server/store.js';
import { publicConversations } from '../../server/whatsappCore.js';
import { hasLiveAccess } from '../../server/access.js';

/** The website polls this every few seconds to show live chats (WhatsApp and website chat). */
export async function GET(request: Request) {
  if (!hasLiveAccess(request)) return Response.json({ enabled: false, conversations: [] }, { status: 401 });
  if (!storeConfigured()) return Response.json({ enabled: false, conversations: [] });
  const conversations = await listConversations();
  return Response.json(
    { enabled: true, conversations: publicConversations({ conversations }) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
