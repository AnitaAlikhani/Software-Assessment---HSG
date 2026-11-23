import process from 'node:process';
import { dataSpace, usesLiveData } from '../server/environment.js';
import { ownerAccess, ownerRefusal } from '../server/limits.js';

/**
 * Says which stored chats this copy of the site uses: the live ones, or its own preview space
 * (see server/environment.ts). It changes nothing. The owner's key goes in the header x-live-key,
 * never in the address: the study tools have a button for it ("Which chats this copy uses").
 */
export async function GET(request: Request) {
  const access = await ownerAccess(request);
  if (access !== 'ok') return ownerRefusal(access, (error, status) => Response.json({ error }, { status }));
  return Response.json({
    dataSpace: dataSpace(),
    usesLiveChats: usesLiveData(),
    // What Vercel tells this copy about itself. Both empty means: not told, so it counts as live.
    vercelEnvironment: process.env.VERCEL_ENV ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
