import { hasChatAccess } from '../../server/access.js';
import { countWrongTry, gateClosed, LIMIT_TEXTS, wrongTriesGate } from '../../server/limits.js';
import { BUILT_IN_SALON, loadSalonRecordAnd, salonFromRecord, salonProfile } from '../../server/salon.js';
import { storeConfigured } from '../../server/store.js';

const noStore = { 'Cache-Control': 'no-store' };
// Every error text here is shown to the customer as it is.
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: noStore });

/**
 * What the customer's chat page may show of the salon (server/salon.ts salonProfile): its name,
 * the services a customer may book, the opening hours, the closed dates ahead and the time zone.
 * Only the customer's chat token opens it, as /api/chat: a wrong token is counted for its address,
 * and a right one from an address that has to wait is refused (server/limits.ts). The check costs
 * no command of its own: it is read together with the salon.
 */
export async function GET(request: Request) {
  if (!hasChatAccess(request)) {
    if (await countWrongTry(request)) return fail(LIMIT_TEXTS.wrongTriesCustomer, 429);
    return fail('This chat link is no longer valid. Please ask the salon for a new one.', 401);
  }
  // Without storage nothing can have been saved: the salon is the built-in one.
  if (!storeConfigured()) return Response.json(salonProfile(BUILT_IN_SALON), { headers: noStore });
  try {
    const gate = wrongTriesGate(request);
    const { record, count } = await loadSalonRecordAnd(gate?.key ?? null);
    if (gateClosed(gate, count)) return fail(LIMIT_TEXTS.wrongTriesCustomer, 429);
    return Response.json(salonProfile(salonFromRecord(record)), { headers: noStore });
  } catch (error) {
    console.error(error);
    return fail('The salon’s details could not be loaded. Please try again.', 503);
  }
}
