import process from 'node:process';
import { checkModels, listModelNames } from '../server/ai.js';

/** Open /api/ai-check?key=LIVE_ACCESS_KEY to see which free Gemini models answer right now. */
export async function GET(request: Request) {
  const key = process.env.LIVE_ACCESS_KEY;
  const given = request.headers.get('x-live-key') ?? new URL(request.url).searchParams.get('key');
  if (!key || given !== key) return Response.json({ error: 'No access' }, { status: 401 });
  if (new URL(request.url).searchParams.get('list') === '1') return Response.json({ available: await listModelNames() });
  return Response.json({ models: await checkModels(new URL(request.url).searchParams.get('full') === '1') }, { headers: { 'Cache-Control': 'no-store' } });
}
