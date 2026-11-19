import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { CHAT_RETENTION_DAYS } from '../src/customerNotice.js';
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
// The chat key is the only place where a customer id (a WhatsApp number, a Telegram id) can be
// read. There is no list of chats beside it: a list is one more place where an id can outlive
// its chat. The chats are found by their key names instead (listConversations), so when the
// storage deletes a chat after its period, nothing of the customer is left, whether anybody
// writes or not.
const chatKeyPrefix = () => `${keyPrefix()}chat:`;
const chatKey = (waId: string) => `${chatKeyPrefix()}${waId}`;
/** For key names that must not show what they are about: the same text always gives the same name, but the name cannot be read. */
const hashed = (text: string) => createHash('sha256').update(text).digest('hex');
/** Says for a short time that a chat was deleted (see deleteOwnChat). Named after a hash, so no number or id stays readable. */
const markerKey = (waId: string) => `${keyPrefix()}gone:${hashed(waId)}`;
/**
 * A message id may itself carry the customer: a WhatsApp message id is the sender's number and a
 * random part, written in base64. So a claim is named after a hash of the id as well.
 */
const claimKey = (id: string) => `${keyPrefix()}msg:${hashed(id)}`;
/**
 * The list of chats the earlier version kept: a set of customer ids. This version never adds to
 * it and never reads it to find chats. It only takes ids out (see cleanEarlierList).
 */
const earlierListKey = () => `${keyPrefix()}index`;

/**
 * How long a chat is kept after its last activity. Every save (a new message, a reply, an owner
 * action) starts the period again; a chat nobody touches is deleted by the storage itself.
 * Customers are told the same number: it comes from src/customerNotice.ts. Change it only there.
 */
export const RETENTION_SECONDS = CHAT_RETENTION_DAYS * 24 * 60 * 60;
/**
 * How long the storage remembers that a chat was deleted. It has to be longer than any request
 * can run: a request that loaded the chat before the deletion must still find the marker when it
 * saves, however slow the AI was. The AI gives up after about a minute and the hosting platform
 * ends a request after five minutes at its standard settings, so ten minutes leave room. Raise
 * this if requests are ever allowed to run longer.
 */
export const DELETION_MARKER_SECONDS = 10 * 60;
/** The earlier version's list is looked through at most this often by one running instance. */
const CLEAN_EARLIER_LIST_EVERY_MS = 60 * 60 * 1000;
/** How many keys the storage looks at in one step of a listing. */
const SCAN_COUNT = 1000;
/**
 * A listing gives up after this many steps (100,000 keys looked at). A salon stays far below
 * that. The limit only makes sure a listing always ends; reaching it is written to the log.
 */
const SCAN_STEPS_MAX = 100;

/** A chat as it is stored: with the time (epoch ms) it is deleted unless something happens in it. */
type StoredChat = LiveConversation & { keptUntil?: number };

/**
 * What a request saw when it loaded a chat and hands back when it saves it: the value of the
 * deletion marker at that moment, or NO_DELETION_SEEN. Each request carries its own, because one
 * running instance can serve several requests at once.
 */
export type ChatVersion = string;
/**
 * No marker was there. Also for saving a chat that was not loaded first (a script, a test).
 * A word and not an empty text, so that no part of a storage command is ever empty; a marker is
 * a random id and can never read like this.
 */
export const NO_DELETION_SEEN: ChatVersion = 'none';

// Two steps must each happen in one piece, so they run inside the storage as scripts. Nothing
// else can get in between the lines of a script.
/**
 * Deleting: leave the marker (KEYS[2]) with a new random value, delete the chat (KEYS[1]) and
 * take its id off the earlier version's list (KEYS[3]). The marker is set even when no chat is
 * stored yet: the customer's first message may still be with the AI.
 */
export const DELETE_SCRIPT = [
  "redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])",
  "local deleted = redis.call('DEL', KEYS[1])",
  "redis.call('SREM', KEYS[3], ARGV[3])",
  'return deleted',
].join('\n');
/**
 * Saving: write the chat (KEYS[1]) unless the marker (KEYS[2]) shows a deletion the request has
 * not seen (ARGV[1] is the marker it saw). A marker that has run out meanwhile is no new
 * deletion: a new one would still be there, as markers live longer than any request.
 */
export const SAVE_SCRIPT = [
  "local marker = redis.call('GET', KEYS[2])",
  'if marker and marker ~= ARGV[1] then return 0 end',
  "redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])",
  'return 1',
].join('\n');

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

const parse = (value: unknown): StoredChat | null => {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value) as StoredChat; } catch { return null; }
};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** Reads a chat to show it. A request that is going to save the chat uses loadForUpdate. */
export async function loadConversation(waId: string): Promise<LiveConversation | null> {
  return parse((await redis(['GET', chatKey(waId)])).result);
}

/**
 * Reads a chat that the request is going to change and save. The version goes back into
 * saveConversation: with it the storage can tell whether the customer deleted the chat while
 * the request was busy (waiting for the AI or a translation takes many seconds).
 */
export async function loadForUpdate(waId: string): Promise<{ conversation: LiveConversation | null; version: ChatVersion }> {
  const [chat, marker] = list((await redis(['MGET', chatKey(waId), markerKey(waId)])).result);
  return { conversation: parse(chat), version: typeof marker === 'string' ? marker : NO_DELETION_SEEN };
}

/**
 * True when the chat was deleted after the request loaded it. Ask this before sending the
 * customer something that belongs to the chat. Saving checks again by itself.
 */
export async function deletedSince(waId: string, version: ChatVersion): Promise<boolean> {
  const marker = (await redis(['GET', markerKey(waId)])).result;
  return typeof marker === 'string' && marker !== version;
}

/**
 * Saves a chat for the storage period and nothing else. Returns false, and stores nothing, when
 * the chat was deleted after the request loaded it: a deleted chat must not come back because an
 * answer to an earlier message was still on its way.
 */
export async function saveConversation(conversation: LiveConversation, version: ChatVersion, now = Date.now()): Promise<boolean> {
  const stored: StoredChat = { ...conversation, keptUntil: now + RETENTION_SECONDS * 1000 };
  // A caller outside the type check that hands in no version has seen no deletion.
  const seen = typeof version === 'string' && version !== '' ? version : NO_DELETION_SEEN;
  const { result } = await redis(['EVAL', SAVE_SCRIPT, 2, chatKey(conversation.waId), markerKey(conversation.waId), seen, JSON.stringify(stored), RETENTION_SECONDS]);
  if (result !== 1) return false;
  await cleanEarlierList(now);
  return true;
}

/** When this running instance last looked through the earlier version's list (epoch ms). */
let earlierListCleanedAt = 0;
/** A newly started instance remembers nothing. The tests call this to stand for one. */
export const forgetEarlierListCleaning = () => { earlierListCleanedAt = 0; };

/**
 * The earlier version listed every chat in a set of customer ids, and an id stayed there after
 * its chat had expired. So that such ids do not linger, a save looks through that set at most
 * once an hour per running instance and takes out every id whose chat is gone. The storage drops
 * the set when it is empty. The set is not deleted outright: while a copy of the site still runs
 * the earlier version, that copy finds its chats through it. For the same reason only ids without
 * a chat are removed, and none is ever added.
 */
async function cleanEarlierList(now: number) {
  if (now - earlierListCleanedAt < CLEAN_EARLIER_LIST_EVERY_MS) return;
  // Noted before the work: two saves at the same moment must not both do it.
  earlierListCleanedAt = now;
  try {
    const ids = list((await redis(['SMEMBERS', earlierListKey()])).result).map(String);
    if (ids.length === 0) return;
    const chats = list((await redis(['MGET', ...ids.map(chatKey)])).result);
    const gone = ids.filter((_, index) => typeof chats[index] !== 'string');
    if (gone.length > 0) await redis(['SREM', earlierListKey(), ...gone]);
  } catch (error) {
    // The chat itself is saved at this point. Housekeeping must never fail a save.
    console.error(error);
  }
}

/**
 * All stored chats of this copy's data space, found by their key names. SCAN looks through the
 * database in steps and may name a key twice, so the names are collected in a set.
 */
export async function listConversations(): Promise<LiveConversation[]> {
  const keys = new Set<string>();
  let cursor = '0';
  for (let step = 1; ; step += 1) {
    const [next, found] = list((await redis(['SCAN', cursor, 'MATCH', `${chatKeyPrefix()}*`, 'COUNT', SCAN_COUNT])).result);
    for (const key of list(found)) keys.add(String(key));
    cursor = String(next ?? '0');
    if (cursor === '0') break;
    if (step >= SCAN_STEPS_MAX) {
      console.error(`The list of chats stopped after ${SCAN_STEPS_MAX} steps: the database holds more keys than expected, so some chats may be missing from the list.`);
      break;
    }
  }
  if (keys.size === 0) return [];
  // A chat that expired between the two commands comes back empty and is left out.
  return list((await redis(['MGET', ...keys])).result).map(parse).filter((item): item is StoredChat => item !== null);
}

/**
 * True the first time a message ID is seen. Meta and Telegram resend a webhook when we answer
 * slowly; this makes sure the AI answers each message only once.
 */
export async function claimMessage(id: string): Promise<boolean> {
  return (await redis(['SET', claimKey(id), '1', 'NX', 'EX', 2 * 24 * 60 * 60])).result === 'OK';
}

/** Gives a claim back, so the message is handled when the messenger delivers it again. */
export async function releaseMessage(id: string) {
  await redis(['DEL', claimKey(id)]);
}

/**
 * A customer deletes their own chat (the "Delete chat" button, or /delete on a messenger).
 * Only this one chat goes, and its id comes off the earlier version's list. No other chat is touched.
 *
 * A request that loaded the chat a moment earlier may still be waiting for the AI and would save
 * the whole chat again afterwards. The marker left here stops that: saveConversation refuses a
 * chat whose marker changed after it was loaded. The marker holds a random value under a hash of
 * the customer id and deletes itself after DELETION_MARKER_SECONDS.
 */
export async function deleteOwnChat(waId: string) {
  await redis(['EVAL', DELETE_SCRIPT, 3, chatKey(waId), markerKey(waId), earlierListKey(), randomUUID(), DELETION_MARKER_SECONDS, waId]);
}

/** Deletes one chat for good (owner action, or cleanup after the test). */
export async function deleteConversation(waId: string) {
  await deleteOwnChat(waId);
  // Old single-key storage from before per-chat keys. It belongs to the live site only.
  if (usesLiveData()) await redis(['DEL', 'slotbee:live-whatsapp']);
}
