import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import process from 'node:process';

/**
 * Two secrets open the live chats, each for its own people:
 *
 * - The owner's key (LIVE_ACCESS_KEY) opens everything: every chat, the owner's actions and the
 *   team's checks. The owner's app sends it in the header "x-live-key" and nowhere else, so it
 *   never stands in an address, a browser history or a log.
 * - The customer's chat token opens the website chat only (/api/chat). It is made from the key,
 *   so no new setting is needed, and it cannot be turned back into the key. Whoever holds a
 *   customer's link can chat with the salon, and nothing more.
 */

/** Changing this text gives every customer link a new token: the old links stop working. */
const TOKEN_MESSAGE = 'slotbee customer chat v1';
const TOKEN_LENGTH = 24;

/** The token in the customer's chat link, or null when no key is set (live chats are off then). */
export function customerChatToken(): string | null {
  const key = process.env.LIVE_ACCESS_KEY;
  if (!key) return null;
  return createHmac('sha256', key).update(TOKEN_MESSAGE).digest('base64url').slice(0, TOKEN_LENGTH);
}

/**
 * True when the given text is the secret. Both are hashed first, so the comparison takes the same
 * time whatever was sent and however much of it is right: the time of an answer tells nothing.
 */
function sameSecret(given: string | null, secret: string | null | undefined) {
  if (!given || !secret) return false;
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

/** The request carries the owner's key. */
export function hasLiveAccess(request: Request) {
  return sameSecret(request.headers.get('x-live-key'), process.env.LIVE_ACCESS_KEY);
}

/** The request carries the customer's chat token (the owner's key does not count here). */
export function hasChatAccess(request: Request) {
  return sameSecret(request.headers.get('x-chat-token'), customerChatToken());
}
