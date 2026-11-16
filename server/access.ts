import process from 'node:process';

/**
 * Live chats show real messages from testers, so only people with the key can see them
 * or reply. The website sends the key it got from a "?live=KEY" link.
 */
export function hasLiveAccess(request: Request) {
  const key = process.env.LIVE_ACCESS_KEY;
  return Boolean(key) && request.headers.get('x-live-key') === key;
}
