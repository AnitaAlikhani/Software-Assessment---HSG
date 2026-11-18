import process from 'node:process';
import { dataSpace, usesLiveData } from '../server/environment.js';

/**
 * Open /api/space?key=LIVE_ACCESS_KEY to see which stored chats this copy of the site uses:
 * the live ones, or its own preview space (see server/environment.ts). It changes nothing.
 */
export function GET(request: Request) {
  const key = process.env.LIVE_ACCESS_KEY;
  const given = request.headers.get('x-live-key') ?? new URL(request.url).searchParams.get('key');
  if (!key || given !== key) return Response.json({ error: 'No access' }, { status: 401 });
  return Response.json({
    dataSpace: dataSpace(),
    usesLiveChats: usesLiveData(),
    // What Vercel tells this copy about itself. Both empty means: not told, so it counts as live.
    vercelEnvironment: process.env.VERCEL_ENV ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
