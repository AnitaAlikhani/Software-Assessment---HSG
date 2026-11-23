import { hasLiveAccess } from '../server/access.js';
import { countWrongTry, gateClosed, LIMIT_TEXTS, ownerAccess, ownerRefusal, wrongTriesGate } from '../server/limits.js';
import { loadSalonRecordAnd, readSalonChange, recordAnswer, saveSalonParts, SALON_LIMITS, resetSalonRecord } from '../server/salon.js';
import { storeConfigured } from '../server/store.js';

/**
 * The salon's settings on the server (server/salon.ts), for the owner's app on every device she
 * signed in on. Only the owner's key opens it, in the header x-live-key. A wrong key is counted
 * for its address and a right one from an address that has to wait is refused, as on the other
 * owner routes (server/limits.ts). Every error is `{ error: "a plain sentence" }`, shown to the owner as it is.
 *
 * GET    `{ rev, updatedAt, parts }` with the stored parts only; `{ rev: 0, parts: {} }` without a record.
 * PUT    `{ baseRev, parts }`: the given parts replace the stored ones, `{ rev, updatedAt }`. A part
 *        that fails its check is refused with a sentence that names it, and nothing is saved. A
 *        `baseRev` that is not the stored revision gets 409 with the record as it is now.
 * DELETE resets the salon to the built-in one: the record keeps counting, stored with the next
 *        revision and no parts, `{ rev, updatedAt }`; a revision never goes back, so no device can
 *        take a later record for the one it holds. Without a record nothing is written: `{ rev: 0 }`.
 */

const noStore = { 'Cache-Control': 'no-store' };
const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
const fail = (error: string, status: number) => answer({ error }, status);

/** What the owner reads when another device saved first. Her app takes the record that comes with it. */
export const CHANGED_ELSEWHERE = 'The salon was changed on another device. Look at it and save again.';
const NOT_SET_UP = 'The salon cannot be kept on the server: its storage is not set up.';
/** A PUT body may not be larger than this: the record it ends up in has to stay small enough to read with every message. */
const MAX_BODY_CHARACTERS = SALON_LIMITS.recordCharacters + 50_000;

/**
 * The key check of GET and PUT. A wrong key is counted; a right one is checked against its
 * address's count in the same storage command that reads the record (loadForOwner).
 */
async function wrongKey(request: Request): Promise<Response | null> {
  if (!hasLiveAccess(request)) return (await countWrongTry(request)) ? fail(LIMIT_TEXTS.wrongTriesOwner, 429) : fail('No access', 401);
  if (!storeConfigured()) return fail(NOT_SET_UP, 500);
  return null;
}

/** The record and whether the address has to wait, in one storage command. */
async function loadForOwner(request: Request) {
  const gate = wrongTriesGate(request);
  const { record, count } = await loadSalonRecordAnd(gate?.key ?? null);
  return { record, waiting: gateClosed(gate, count) };
}

export async function GET(request: Request) {
  const refused = await wrongKey(request);
  if (refused) return refused;
  try {
    const { record, waiting } = await loadForOwner(request);
    if (waiting) return fail(LIMIT_TEXTS.wrongTriesOwner, 429);
    return answer(recordAnswer(record));
  } catch (error) {
    console.error(error);
    return fail('The salon could not be loaded. Please try again.', 503);
  }
}

export async function PUT(request: Request) {
  const refused = await wrongKey(request);
  if (refused) return refused;
  let text: string;
  try { text = await request.text(); } catch { return fail('The change could not be read. Please try again.', 400); }
  try {
    const { record, waiting } = await loadForOwner(request);
    if (waiting) return fail(LIMIT_TEXTS.wrongTriesOwner, 429);
    if (text.length > MAX_BODY_CHARACTERS) return fail('This change is too large to save. A smaller logo may help.', 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return fail('The change could not be read. Reload the page and try again.', 400); }
    const change = readSalonChange(body);
    if (!change.ok) return fail(change.error, 400);
    if (change.baseRev !== (record?.rev ?? 0)) return answer({ error: CHANGED_ELSEWHERE, ...recordAnswer(record) }, 409);
    const outcome = await saveSalonParts(record, change.parts);
    if (outcome.status === 'too-large') return fail('The salon’s settings would be too large to save. A smaller logo may help.', 413);
    if (outcome.status === 'changed') return answer({ error: CHANGED_ELSEWHERE, ...recordAnswer(outcome.record) }, 409);
    return answer({ rev: outcome.rev, updatedAt: outcome.updatedAt });
  } catch (error) {
    console.error(error);
    return fail('The change could not be saved. Please try again.', 503);
  }
}

export async function DELETE(request: Request) {
  const access = await ownerAccess(request);
  if (access !== 'ok') return ownerRefusal(access, fail);
  if (!storeConfigured()) return fail(NOT_SET_UP, 500);
  try {
    const outcome = await resetSalonRecord();
    if (outcome.status === 'busy') return fail('The shared salon is being changed on another device right now. Please try again.', 503);
    return answer(outcome.updatedAt ? { rev: outcome.rev, updatedAt: outcome.updatedAt } : { rev: 0 });
  } catch (error) {
    console.error(error);
    return fail('The shared salon could not be reset. Please try again.', 503);
  }
}
