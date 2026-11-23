import { checkModels, listModelNames } from '../server/ai.js';
import { ownerAccess, ownerRefusal } from '../server/limits.js';
import { BUILT_IN_SALON, loadSalon } from '../server/salon.js';
import { storeConfigured } from '../server/store.js';

/**
 * Says which free Gemini models answer right now. The owner's key goes in the header x-live-key,
 * never in the address, where it would stay in histories and logs: the study tools on a signed-in
 * device have a button for it ("Check the AI").
 */
export async function GET(request: Request) {
  const access = await ownerAccess(request);
  if (access !== 'ok') return ownerRefusal(access, (error, status) => Response.json({ error }, { status }));
  if (new URL(request.url).searchParams.get('list') === '1') return Response.json({ available: await listModelNames() });
  const full = new URL(request.url).searchParams.get('full') === '1';
  // The full check sends the real instructions, so it reads the salon as it is now (one storage command).
  const salon = full && storeConfigured() ? await loadSalon() : BUILT_IN_SALON;
  return Response.json({ models: await checkModels(full, salon) }, { headers: { 'Cache-Control': 'no-store' } });
}
