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
 * not seen (ARGV[1] is the marker it saw), or unless another request saved the chat after this
 * one read it (ARGV[4] is the revision it read; "any" skips that check). A marker that has run
 * out meanwhile is no new deletion: a new one would still be there, as markers live longer than
 * any request.
 *
 * The revision is the number every stored chat starts with ('{"rev":12,...'). A chat stored
 * before revisions existed has none and counts as revision 0, like a chat that does not exist.
 * Answers 1 (saved), 0 (deleted meanwhile) or 2 (changed meanwhile: read it again).
 */
export const SAVE_SCRIPT = [
  "local marker = redis.call('GET', KEYS[2])",
  'if marker and marker ~= ARGV[1] then return 0 end',
  "if ARGV[4] ~= 'any' then",
  "  local current = redis.call('GET', KEYS[1])",
  "  local rev = '0'",
  "  if current then rev = string.match(current, '^{\"rev\":(%d+),') or '0' end",
  '  if rev ~= ARGV[4] then return 2 end',
  'end',
  "redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])",
  'return 1',
].join('\n');

/**
 * Counting for the limits (server/limits.ts), in one storage command however many counters a
 * request moves. Each command costs free quota, so a request never sends one per counter.
 *
 * ARGV[1] is the most a gate counter (KEYS[1]) may hold, or 0 for no gate. A gate is only read:
 * when it is at its most, the script stops at once and answers -1, and nothing is counted. The
 * other keys are counters: each is raised by one and, the first time, told to delete itself after
 * its window (ARGV[2j] seconds for the j-th counter). Counting stops after the first counter that
 * went over its most (ARGV[2j+1], or "none"), so a refused request does not use up the later ones
 * (the day's AI answers come last). Answers the counts so far, in order.
 */
export const COUNT_SCRIPT = [
  'local gate = tonumber(ARGV[1])',
  'local first = 1',
  'if gate > 0 then',
  "  local seen = tonumber(redis.call('GET', KEYS[1])) or 0",
  '  if seen >= gate then return -1 end',
  '  first = 2',
  'end',
  'local counts = {}',
  'for i = first, #KEYS do',
  '  local j = i - first + 1',
  "  local n = redis.call('INCR', KEYS[i])",
  "  if n == 1 then redis.call('EXPIRE', KEYS[i], ARGV[2 * j]) end",
  '  counts[j] = n',
  '  local most = tonumber(ARGV[2 * j + 1])',
  '  if most and n > most then break end',
  'end',
  'return counts',
].join('\n');

/** A counter of server/limits.ts: its key, how long its window lasts, and the most it may reach (none: only counted). */
export interface Counter { key: string; seconds: number; most?: number }

/**
 * Reads the gate (if any) and raises the counters, as COUNT_SCRIPT describes: 'blocked' when the
 * gate is at its most, otherwise the new count of each counter that was raised, in order.
 */
export async function countUp(gate: { key: string; most: number } | null, counters: Counter[]): Promise<number[] | 'blocked'> {
  const keys = [...(gate ? [gate.key] : []), ...counters.map(counter => counter.key)];
  const args = [gate ? gate.most : 0, ...counters.flatMap(counter => [counter.seconds, counter.most ?? 'none'])];
  const { result } = await redis(['EVAL', COUNT_SCRIPT, keys.length, ...keys, ...args]);
  if (result === -1) return 'blocked';
  return list(result).map(Number);
}

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
  try {
    const chat = JSON.parse(value) as StoredChat;
    // A chat stored before revisions existed is revision 0 (see SAVE_SCRIPT).
    return { ...chat, rev: typeof chat.rev === 'number' ? chat.rev : 0 };
  } catch { return null; }
};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** Reads a chat to show it. A request that is going to save the chat uses loadForUpdate. */
export async function loadConversation(waId: string): Promise<LiveConversation | null> {
  return parse((await redis(['GET', chatKey(waId)])).result);
}

/** A counter's value as the storage holds it: a missing key counts 0. */
const count = (value: unknown) => Number(value) || 0;

/**
 * Reads a chat and, in the same command, one counter (the wrong-tries gate of server/limits.ts).
 * The customer's page asks every few seconds, so the check must not cost a command of its own.
 */
export async function loadConversationAnd(waId: string, counterKey: string | null): Promise<{ conversation: LiveConversation | null; count: number }> {
  if (!counterKey) return { conversation: await loadConversation(waId), count: 0 };
  const [chat, counter] = list((await redis(['MGET', chatKey(waId), counterKey])).result);
  return { conversation: parse(chat), count: count(counter) };
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
 * The most messages a Telegram or WhatsApp chat keeps (LIMITS.messengerKept in limits.ts). Such a
 * chat is one ongoing conversation that cannot be closed like a website chat, so a save beyond it
 * keeps the newest ones. Nothing depends on the first messages staying: the first text of
 * WhatsApp, the language and the bookings are fields of the chat, not messages, and the AI reads
 * only the last 30.
 */
export const MESSENGER_MESSAGES_KEPT = 200;
const keepNewest = (chat: LiveConversation): LiveConversation =>
  (chat.channel ?? 'WhatsApp') !== 'Website' && Array.isArray(chat.messages) && chat.messages.length > MESSENGER_MESSAGES_KEPT
    ? { ...chat, messages: chat.messages.slice(-MESSENGER_MESSAGES_KEPT) }
    : chat;

/** What a save found: stored, refused because the customer deleted the chat, or refused because another request saved it first. */
export type SaveOutcome = 'saved' | 'deleted' | 'changed';

/**
 * Saves a chat that was read at revision `expectedRev` ('any': whatever is stored now). The text
 * starts with the next revision, so the next save can tell whether somebody else saved in between.
 * On success the chat object carries its new revision.
 */
async function saveAt(conversation: LiveConversation, version: ChatVersion, expectedRev: number | 'any', now: number): Promise<SaveOutcome> {
  const rev = (typeof expectedRev === 'number' ? expectedRev : conversation.rev ?? 0) + 1;
  // The revision goes first: the save script reads it from the start of the text.
  const { rev: _old, keptUntil: _kept, ...rest } = keepNewest(conversation) as StoredChat;
  const stored = { rev, ...rest, keptUntil: now + RETENTION_SECONDS * 1000 };
  // A caller outside the type check that hands in no version has seen no deletion.
  const seen = typeof version === 'string' && version !== '' ? version : NO_DELETION_SEEN;
  const { result } = await redis(['EVAL', SAVE_SCRIPT, 2, chatKey(conversation.waId), markerKey(conversation.waId), seen, JSON.stringify(stored), RETENTION_SECONDS, String(expectedRev)]);
  if (result === 0) return 'deleted';
  if (result !== 1) return 'changed';
  conversation.rev = rev;
  await cleanEarlierList(now);
  return 'saved';
}

/**
 * Saves a chat for the storage period and nothing else. Returns false, and stores nothing, when
 * the chat was deleted after the request loaded it: a deleted chat must not come back because an
 * answer to an earlier message was still on its way.
 *
 * A chat that was loaded carries its revision, and is not saved over a newer one (that counts as
 * not saved, too). Code that changes a chat other requests may change at the same moment uses
 * changeConversation instead, which reads the newer chat and applies its change again.
 */
export async function saveConversation(conversation: LiveConversation, version: ChatVersion, now = Date.now()): Promise<boolean> {
  // A copy: the caller's object keeps the revision it was loaded with.
  return (await saveAt({ ...conversation }, version, conversation.rev ?? 'any', now)) === 'saved';
}

/** How often a change is applied again to a chat somebody else saved first, before the request gives up. */
const CHANGE_TRIES = 5;

/** A chat as one request knows it: what it read, the deletion marker it saw then. */
export interface LoadedChat { conversation: LiveConversation | null; version: ChatVersion }

export type ChangeOutcome<T> =
  | { status: 'saved' | 'unchanged'; conversation: LiveConversation | null; value: T; loaded: LoadedChat }
  | { status: 'deleted' };

/**
 * Changes one chat without losing what other requests write at the same moment: a customer's
 * second message, the AI's answer to the first, the owner's action.
 *
 * `change` gets a copy of the chat as it is stored now (null when there is none) and changes it
 * in place, or returns `conversation: null` to store nothing. The save goes through only when
 * nobody saved the chat since it was read; otherwise the chat is read again and the change is
 * applied to the newer chat. So a change must be written as "add this to the chat as it is", and
 * it may run more than once. In the usual case nobody else wrote, and this costs one save and no
 * read: the chat was read already (`loaded`).
 *
 * The deletion marker stays the one the request saw first: a chat its customer deleted while the
 * request was busy stays deleted, however often the change is tried.
 */
export async function changeConversation<T>(
  loaded: LoadedChat,
  change: (conversation: LiveConversation | null) => { conversation: LiveConversation | null; value: T },
  now = Date.now(),
): Promise<ChangeOutcome<T>> {
  let current = loaded.conversation;
  for (let attempt = 1; ; attempt += 1) {
    const copy = current ? structuredClone(current) : null;
    const { conversation, value } = change(copy);
    if (!conversation) return { status: 'unchanged', conversation: current, value, loaded: { conversation: current, version: loaded.version } };
    const outcome = await saveAt(conversation, loaded.version, current?.rev ?? 0, now);
    if (outcome === 'saved') return { status: 'saved', conversation, value, loaded: { conversation, version: loaded.version } };
    if (outcome === 'deleted') return { status: 'deleted' };
    if (attempt >= CHANGE_TRIES) throw new Error(`The chat changed ${CHANGE_TRIES} times while this request was saving it.`);
    const again = await loadForUpdate(conversation.waId);
    if (again.version !== loaded.version) return { status: 'deleted' };
    current = again.conversation;
  }
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
  return (await listConversationsAnd(null)).conversations;
}

/**
 * All stored chats and, in the same last command, one counter (the wrong-tries gate of
 * server/limits.ts). The owner's app asks every few seconds, so the check costs no command of its own.
 */
export async function listConversationsAnd(counterKey: string | null): Promise<{ conversations: LiveConversation[]; count: number }> {
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
  const read = [...keys, ...(counterKey ? [counterKey] : [])];
  if (read.length === 0) return { conversations: [], count: 0 };
  const values = list((await redis(['MGET', ...read])).result);
  return {
    // A chat that expired between the two commands comes back empty and is left out.
    conversations: values.slice(0, keys.size).map(parse).filter((item): item is StoredChat => item !== null),
    count: counterKey ? count(values[keys.size]) : 0,
  };
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
