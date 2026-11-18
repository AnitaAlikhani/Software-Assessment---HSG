import process from 'node:process';

/**
 * Which stored chats this copy of the site uses.
 *
 * The live site holds the chats of real testers. A Vercel preview of a work branch gets a space
 * of its own, so trying something out there can never show, change or delete a live chat, and
 * cannot take the Telegram bot or the WhatsApp number away from the live site.
 *
 * To stay safe, a copy is only moved to its own space when Vercel says it is a preview AND names
 * a branch other than the one that serves the live address. Everything else (the production
 * site, a copy Vercel tells us nothing about, a laptop) keeps the chats it used before this rule
 * existed. So this rule can never cut the live site off; at worst it does not separate a preview.
 * Open /api/space?key=LIVE_ACCESS_KEY on any copy to see which chats it uses.
 *
 * One optional setting: LIVE_DATA_SPACE=live makes a preview of another branch use the live
 * chats (for example when that branch takes over the live address). No setting can move a copy
 * away from the live chats.
 */
type Env = Record<string, string | undefined>;

export const LIVE_SPACE = 'live';
export const PREVIEW_SPACE = 'preview';
/** The branch whose previews use the live chats: it serves the live address today. */
const LIVE_BRANCH = 'nil-live-whatsapp';

export function dataSpace(env: Env = process.env): typeof LIVE_SPACE | typeof PREVIEW_SPACE {
  if (env.LIVE_DATA_SPACE?.trim().toLowerCase() === LIVE_SPACE) return LIVE_SPACE;
  if (env.VERCEL_ENV !== 'preview') return LIVE_SPACE;
  const branch = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (!branch || branch === LIVE_BRANCH) return LIVE_SPACE;
  return PREVIEW_SPACE;
}

/** True when this copy works on the live chats (see dataSpace). */
export const usesLiveData = (env: Env = process.env) => dataSpace(env) === LIVE_SPACE;
