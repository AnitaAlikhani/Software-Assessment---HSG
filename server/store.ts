import process from 'node:process';
import { dataSpace, LIVE_SPACE, usesLiveData } from './environment.js';
import type { LiveConversation } from './whatsappCore.js';

// Upstash Redis over its REST API (free tier, added from the Vercel Marketplace).
// Vercel's Upstash integration sets KV_REST_API_*; a direct Upstash setup sets UPSTASH_*.
const url = () => process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = () => process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

// Every chat has its own key. Saving one chat can then never overwrite another chat
// that a different request changed at the same moment.
// The live site keeps the key names it always had. A preview of a work branch gets its own
// names (see environment.ts), so it can never read, change or delete a live chat.
export const keyPrefix = (space: string = dataSpace()) => space === LIVE_SPACE ? 'slotbee:live:' : `slotbee:${space}:live:`;
const indexKey = () => `${keyPrefix()}index`;
const chatKey = (waId: string) => `${keyPrefix()}chat:${waId}`;
/** Keep test data at most 30 days, even if nobody deletes it. */
const TTL_SECONDS = 30 * 24 * 60 * 60;

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

const parse = (value: unknown): LiveConversation | null => {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value) as LiveConversation; } catch { return null; }
};

export async function loadConversation(waId: string): Promise<LiveConversation | null> {
  return parse((await redis(['GET', chatKey(waId)])).result);
}

export async function saveConversation(conversation: LiveConversation) {
  await redis(['SET', chatKey(conversation.waId), JSON.stringify(conversation), 'EX', TTL_SECONDS]);
  await redis(['SADD', indexKey(), conversation.waId]);
  await redis(['EXPIRE', indexKey(), TTL_SECONDS]);
}

export async function listConversations(): Promise<LiveConversation[]> {
  const ids = (await redis(['SMEMBERS', indexKey()])).result;
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const values = (await redis(['MGET', ...ids.map(id => chatKey(String(id)))])).result;
  return (Array.isArray(values) ? values : []).map(parse).filter((item): item is LiveConversation => item !== null);
}

/**
 * True the first time a WhatsApp message ID is seen. Meta resends a webhook when we answer
 * slowly; this makes sure the AI answers each message only once.
 */
export async function claimMessage(id: string): Promise<boolean> {
  return (await redis(['SET', `${keyPrefix()}msg:${id}`, '1', 'NX', 'EX', 2 * 24 * 60 * 60])).result === 'OK';
}

/** Deletes one chat for good (owner action, or cleanup after the test). */
export async function deleteConversation(waId: string) {
  await redis(['DEL', chatKey(waId)]);
  await redis(['SREM', indexKey(), waId]);
  // Old single-key storage from before per-chat keys. It belongs to the live site only.
  if (usesLiveData()) await redis(['DEL', 'slotbee:live-whatsapp']);
}
