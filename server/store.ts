import process from 'node:process';
import { emptyState, type LiveState } from './whatsappCore';

// Upstash Redis over its REST API (free tier, added from the Vercel Marketplace).
// Vercel's Upstash integration sets KV_REST_API_*; a direct Upstash setup sets UPSTASH_*.
const url = () => process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = () => process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'slotbee:live-whatsapp';

export const storeConfigured = () => Boolean(url() && token());

async function redis(command: unknown[]) {
  const response = await fetch(url()!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Storage error ${response.status}`);
  return (await response.json()) as { result: unknown };
}

export async function loadState(): Promise<LiveState> {
  const { result } = await redis(['GET', KEY]);
  if (typeof result !== 'string') return emptyState();
  try {
    return { ...emptyState(), ...(JSON.parse(result) as LiveState) };
  } catch {
    return emptyState();
  }
}

export async function saveState(state: LiveState) {
  await redis(['SET', KEY, JSON.stringify(state)]);
}

export async function clearState() {
  await redis(['DEL', KEY]);
}
