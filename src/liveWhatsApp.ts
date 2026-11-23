import { useCallback, useEffect, useRef, useState } from 'react';
import { researchMode } from './flags';
import type { Conversation } from './types';

const KEY_STORAGE = 'slotbee-live-key';
/** Where the browser keeps the owner's key: other pages of the app follow a sign-in or sign-out there. */
export const LIVE_KEY_STORAGE = KEY_STORAGE;

export const isLiveConversation = (id: string) => id.startsWith('live-');

/** The key of this visit when the browser keeps no storage (private modes): gone with the page. */
let keyThisVisit: string | null = null;

/**
 * The address without its "live" parameter: path, the other parameters exactly as they were
 * written, and the hash (the app's route). Null when the address has no "live" parameter.
 */
export function addressWithoutKey(href: string): string | null {
  const url = new URL(href);
  const parts = url.search.replace(/^\?/, '').split('&').filter(Boolean);
  const isKey = (part: string) => {
    const name = part.split('=')[0];
    try { return decodeURIComponent(name.replace(/\+/g, ' ')) === 'live'; } catch { return false; }
  };
  if (!parts.some(isKey)) return null;
  const kept = parts.filter(part => !isKey(part));
  return `${url.pathname}${kept.length ? `?${kept.join('&')}` : ''}${url.hash}`;
}

/**
 * The owner signs a browser in by opening her link "/?live=KEY" once. The key is kept in this
 * browser and taken out of the address at once, so it does not stay in the history, in a
 * bookmark or in a link she copies from the address bar. Every other part of the address stays.
 */
export function readLiveKey(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = new URLSearchParams(window.location?.search ?? '').get('live');
  const cleaned = window.location?.href ? addressWithoutKey(window.location.href) : null;
  if (cleaned !== null) {
    try { window.history?.replaceState(window.history.state, '', cleaned); } catch { /* the key stays in the address; it still works */ }
  }
  try {
    if (fromUrl) { localStorage.setItem(KEY_STORAGE, fromUrl); return fromUrl; }
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    // The storage is blocked: the key holds for this visit only.
    if (fromUrl) keyThisVisit = fromUrl;
    return keyThisVisit;
  }
}

/**
 * The key this browser holds, without looking at the address: for the salon on the server
 * (src/sharedSalon.ts), which starts after the key was taken out of the address (src/main.tsx).
 */
export function currentLiveKey(): string | null {
  try { return localStorage.getItem(KEY_STORAGE) ?? keyThisVisit; } catch { return keyThisVisit; }
}

/** Takes "live" out of the address without keeping it anywhere. */
function dropKeyFromAddress(): void {
  const cleaned = window.location?.href ? addressWithoutKey(window.location.href) : null;
  if (cleaned === null) return;
  try { window.history?.replaceState(window.history.state, '', cleaned); } catch { /* the address keeps it; nothing reads it there */ }
}

/**
 * Runs once when any page starts (src/main.tsx): no page keeps "live" in its address. Only the
 * owner's app stores the key; a customer's page (the booking page "?booking=1" or the chat
 * "?chat=…") removes it without keeping it, so a key in a link handed to a customer stays nowhere.
 */
export function takeKeyFromAddress(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location?.search ?? '');
  if (params.has('chat') || params.get('booking') === '1') dropKeyFromAddress();
  else readLiveKey();
}

/** "Sign out on this device": the browser forgets the key, and with it the live chats. */
export function forgetLiveKey(): void {
  keyThisVisit = null;
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* nothing was stored */ }
}

/**
 * The request or cancellation the owner answers, as her card showed it: day, time and service,
 * and for a request the customer's name and the stylist the customer asked for (none when none
 * was asked for). The server refuses the answer when the customer has asked for something else since.
 */
export interface ExpectedSlot { date: string; time: string; service?: string; customerName?: string; staffName?: string }

export type LiveAction =
  | { type: 'reply'; conversationId: string; text: string }
  | { type: 'take-over'; conversationId: string }
  /** `answerNow`: the AI answers the customer's waiting message at once instead of waiting for the next one. */
  | { type: 'let-ai-continue'; conversationId: string; answerNow?: boolean }
  /** The chat needs nobody any more: it leaves "Waiting for you" without a message to the customer. */
  | { type: 'mark-done'; conversationId: string }
  | { type: 'confirm-booking'; conversationId: string; expected: ExpectedSlot; staffName?: string }
  | { type: 'suggest-time'; conversationId: string; expected: ExpectedSlot; date: string; time: string; staffName?: string }
  | { type: 'decline-booking'; conversationId: string; expected: ExpectedSlot }
  /** The customer asked to cancel a confirmed appointment: agree ('cancel-booking') or leave it standing ('keep-booking'). */
  | { type: 'cancel-booking'; conversationId: string; expected: ExpectedSlot }
  | { type: 'keep-booking'; conversationId: string; expected: ExpectedSlot };

/** How people can reach the live AI: the Telegram bot (if connected) and the website chat. */
export interface LiveChannels {
  telegram: string | null;
  /**
   * The customer's chat link, made from the chat token the server sends. Null until the server
   * has sent one: there is no link to show then. It never holds the owner's key.
   */
  websiteChatUrl: string | null;
}

/**
 * The website-chat link for customers: "/?chat=<token>". The token opens the chat and nothing
 * else, so the link can be handed out. With the study tools on it switches them on for the
 * tester as well ("research=1"): otherwise a study participant would read the salon's wording
 * instead of the notice that this is a study.
 */
export const websiteChatUrl = (origin: string, token: string, study = researchMode()): string =>
  `${origin}/?chat=${encodeURIComponent(token)}${study ? '&research=1' : ''}`;

/** The team's three checks in the study tools, each a route that takes the owner's key from the header. */
export type TeamCheck = 'ai' | 'space' | 'telegram';

export const TEAM_CHECKS: Record<TeamCheck, { label: string; path: string }> = {
  ai: { label: 'Check the AI', path: '/api/ai-check' },
  space: { label: 'Which chats this copy uses', path: '/api/space' },
  telegram: { label: 'Connect Telegram', path: '/api/telegram/setup' },
};

/** What a check answered, as lines of plain text. `ok` is false when the check itself failed. */
export interface TeamCheckResult { ok: boolean; lines: string[] }

type CheckAnswer = {
  error?: string;
  models?: { model: string; ok: boolean; ms: number; error?: string }[];
  dataSpace?: string; usesLiveChats?: boolean; vercelEnvironment?: string | null; branch?: string | null;
  ok?: boolean; bot?: string; webhook?: string;
};

/**
 * Turns a check's answer into sentences. A failure says which check failed and why, in words a
 * team member can act on; the server's own sentence is used where it gives one.
 */
export function describeTeamCheck(kind: TeamCheck, status: number | null, data: CheckAnswer | null): TeamCheckResult {
  const failed = (why: string): TeamCheckResult => ({ ok: false, lines: [`${TEAM_CHECKS[kind].label} failed: ${why}`] });
  if (status === null) return failed('could not reach the server. Check your connection.');
  if (status === 401 || status === 403) return failed('the server did not accept the key of this device. Open your latest owner link.');
  if (status === 429) return failed(data?.error ?? 'too many tries. Try again in a few minutes.');
  if (status === 404) return failed('this copy of the site has no server for this check.');
  if (status >= 400 || !data) return failed(data?.error ?? `the server answered with status ${status}.`);
  if (kind === 'ai') {
    const models = data.models ?? [];
    if (models.length === 0) return failed('the server named no AI model.');
    const answering = models.filter(model => model.ok).length;
    return {
      ok: answering > 0,
      lines: [
        `${answering} of ${models.length} AI ${models.length === 1 ? 'model answers' : 'models answer'}.`,
        ...models.map(model => model.ok ? `${model.model}: answers (${model.ms} ms)` : `${model.model}: no answer${model.error ? ` (${model.error})` : ''}`),
      ],
    };
  }
  if (kind === 'space') {
    const where = [data.vercelEnvironment && `Vercel environment: ${data.vercelEnvironment}`, data.branch && `branch: ${data.branch}`].filter(Boolean).join(' · ');
    return {
      ok: true,
      lines: [
        data.usesLiveChats ? 'This copy uses the live chats.' : `This copy uses its own test chats ("${data.dataSpace ?? 'unnamed'}"), not the live ones.`,
        ...(where ? [where] : []),
      ],
    };
  }
  if (data.ok === false) return failed(data.error ?? 'the server could not connect the bot.');
  return { ok: true, lines: [`Telegram is connected${data.bot ? `: ${data.bot}` : ''}.`, ...(data.webhook ? [`Messages go to ${data.webhook}`] : [])] };
}

/** Runs one check with the owner's key in the header, never in the address. */
export async function runTeamCheck(kind: TeamCheck, key: string, fetcher: typeof fetch = fetch): Promise<TeamCheckResult> {
  let response: Response;
  try {
    response = await fetcher(TEAM_CHECKS[kind].path, { headers: { 'x-live-key': key }, cache: 'no-store' });
  } catch {
    return describeTeamCheck(kind, null, null);
  }
  let data: CheckAnswer | null = null;
  try { data = (await response.json()) as CheckAnswer; } catch { /* not the server's answer: the status says enough */ }
  return describeTeamCheck(kind, response.status, data);
}

/**
 * What this browser knows about the live chats: still asking the server, reached them ("on"),
 * or not available here ("off": no access key, no server, no storage, or a refused key).
 */
export type LiveStatus = 'checking' | 'on' | 'off';

/**
 * The connection to the live chats, as the chat screen shows it:
 * - `off`: nothing to show here (no key, no server on this address, or live chats switched off);
 * - `loading`: the first answer is on its way;
 * - `live`: the chats are up to date;
 * - `reconnecting`: the last request failed; the chats on screen stay and the app tries again;
 * - `denied`: the server refused the access key (a wrong or expired link);
 * - `waiting`: the server makes this connection wait (429: too many wrong keys came from its
 *   address). The server says why and for how long; the chats on screen stay.
 */
export type LiveConnection = 'off' | 'loading' | 'live' | 'reconnecting' | 'denied' | 'waiting';

/** Said when the server's 429 answer brings no sentence of its own. */
export const OWNER_WAIT_TEXT = 'Too many tries from this connection. The live chats come back in a few minutes.';

/** How one request to the server ended. */
export type PollOutcome = 'enabled' | 'disabled' | 'refused' | 'missing' | 'waiting' | 'failed';

/**
 * Sorts an answer (or a failure to get one) into an outcome. Only 401 and 403 mean the key was
 * refused; 429 means the server is reachable and makes this connection wait.
 */
export const pollOutcome = (status: number | null, enabled?: boolean): PollOutcome => {
  if (status === 429) return 'waiting';
  if (status === null || status >= 500 || status === 408) return 'failed';
  if (status === 401 || status === 403) return 'refused';
  if (status === 404) return 'missing';
  if (status >= 400) return 'failed';
  return enabled ? 'enabled' : 'disabled';
};

/**
 * The connection after a request. A missing endpoint before the first answer means this address
 * has no server (a static copy of the site): the app then simply has no live chats. Once the
 * chats were reached, any failure other than a refused key is a hiccup that is retried.
 */
export const connectionAfter = (outcome: PollOutcome, reachedBefore: boolean): LiveConnection => {
  switch (outcome) {
    case 'enabled': return 'live';
    case 'disabled': return 'off';
    case 'refused': return 'denied';
    case 'missing': return reachedBefore ? 'reconnecting' : 'off';
    case 'waiting': return 'waiting';
    case 'failed': return 'reconnecting';
  }
};

/** The timing of the requests for the live chats, in milliseconds. */
export const POLL_TIMING = {
  /** While something happens in the chats. */
  active: 4000,
  /** After a minute without change. */
  quiet: 10_000,
  /** After five minutes without change. */
  resting: 30_000,
  quietAfter: 60_000,
  restingAfter: 5 * 60_000,
  /** The first retry after a failed request; each further failure doubles it, up to `retryMax`. */
  retryFirst: 2000,
  retryMax: 60_000,
  /** After the server said "wait" (429): one request a minute, so waiting adds no load and ends soon after. */
  waiting: 60_000,
} as const;

/** The server's sentence in an answer, if it sent one. */
const serverSentence = (data: unknown): string | null => {
  const error = (data as { error?: unknown } | null)?.error;
  return typeof error === 'string' && error.trim() ? error.trim() : null;
};

/**
 * What the owner reads when one of her actions was not done: the server's sentence where it
 * gives one (a 429 says why she has to wait), otherwise a plain one. Null when it was done.
 */
export function actionError(status: number, data: unknown): string | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return 'This access link is not valid any more.';
  return serverSentence(data) ?? (status === 429 ? OWNER_WAIT_TEXT : 'The server could not do this. Try again.');
}

export interface PollSituation {
  /** The tab is in the background (document.hidden). */
  hidden: boolean;
  /** Failed requests in a row since the last answer. */
  failures: number;
  /** Time since the chats last changed, or since the owner last acted. */
  quietForMs: number;
}

/**
 * How long until the next request for the live chats, or null for none. Every request costs
 * storage commands on the server's free allowance, so a hidden tab asks nothing (it asks again at
 * once when it comes back), and a quiet inbox is asked less often. After a failure the wait grows,
 * so a server that is down is not hammered.
 */
export function nextPollDelay({ hidden, failures, quietForMs }: PollSituation): number | null {
  if (hidden) return null;
  if (failures > 0) return Math.min(POLL_TIMING.retryFirst * 2 ** (failures - 1), POLL_TIMING.retryMax);
  if (quietForMs >= POLL_TIMING.restingAfter) return POLL_TIMING.resting;
  if (quietForMs >= POLL_TIMING.quietAfter) return POLL_TIMING.quiet;
  return POLL_TIMING.active;
}

/** One of the owner's answers to a live chat while it is on its way, or after it failed. */
export interface LiveActionState {
  key: string;
  conversationId: string;
  type: LiveAction['type'];
  /** A reply's text: shown in the chat until the server's copy of the chat holds it. */
  text?: string;
  state: 'sending' | 'failed';
  error?: string;
}

/** What the chat screen needs to show the connection and the owner's answers on their way. */
export interface LiveInbox {
  connection: LiveConnection;
  /** While `waiting`: the server's sentence on why and how long. */
  waitNotice?: string | null;
  actions: LiveActionState[];
  retry: (key: string) => void;
  dismiss: (key: string) => void;
}

/**
 * The answers to a booking request or a cancellation change the calendar too, in a fixed order
 * with the server's part (src/chatBookingAnswers.ts). A failed one is shown on its card, where
 * trying again runs the whole answer with a fresh look at the calendar. It is not kept here: a
 * bare "Try again" of the server's part alone would tell the customer and book nothing.
 */
const BOOKING_ANSWERS: ReadonlySet<LiveAction['type']> = new Set(['confirm-booking', 'suggest-time', 'decline-booking', 'cancel-booking', 'keep-booking']);
export const keepsFailure = (type: LiveAction['type']): boolean => !BOOKING_ANSWERS.has(type);

/** The answer that is on its way or failed for one kind of action in one chat. */
export const liveActionFor = (actions: LiveActionState[] | undefined, conversationId: string, type: LiveAction['type']) =>
  actions?.find((item) => item.conversationId === conversationId && item.type === type && type !== 'reply');

const isHidden = () => typeof document !== 'undefined' && document.hidden;

/**
 * `active` is false on the public booking page: a customer's browser never asks the server for
 * the salon's chats and never keeps an access key, whatever its address or its storage holds.
 */
export function useLiveWhatsApp(active = true) {
  const [key, setKey] = useState(() => (active ? readLiveKey() : null));
  // The key the hook works with right now: an answer that arrives after signing out is dropped.
  const keyNow = useRef(key);
  keyNow.current = key;
  const [chatToken, setChatToken] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Without a key there is nothing to ask the server, so the answer is known at once.
  const [connection, setConnection] = useState<LiveConnection>(key ? 'loading' : 'off');
  const [telegram, setTelegram] = useState<string | null>(null);
  const [actions, setActions] = useState<LiveActionState[]>([]);
  const [waitNotice, setWaitNotice] = useState<string | null>(null);
  // The revision of the salon on the server, as the chats' answer reports it (src/sharedSalon.ts).
  const [salonRev, setSalonRev] = useState<number | null>(null);
  const reached = useRef(false);
  const lastSeen = useRef('');
  const lastChange = useRef(Date.now());
  // Set by the polling effect: asks the server at once (the tab came back, the owner acted).
  const pollNow = useRef<() => void>(() => {});

  /** Takes the server's list of chats and notes whether anything changed since the last one. */
  const takeConversations = useCallback((next: Conversation[]) => {
    const seen = JSON.stringify(next);
    if (seen !== lastSeen.current) {
      lastSeen.current = seen;
      lastChange.current = Date.now();
      setConversations(next);
    }
  }, []);

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let running = false;
    let failures = 0;
    // The server made this connection wait: the next request comes after POLL_TIMING.waiting, also
    // when the tab comes back to the front, so waiting is never cut short by asking more.
    let waiting = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (stopped) return;
      if (waiting) { timer = setTimeout(poll, POLL_TIMING.waiting); return; }
      const delay = nextPollDelay({ hidden: isHidden(), failures, quietForMs: Date.now() - lastChange.current });
      if (delay !== null) timer = setTimeout(poll, delay);
    };

    const poll = async () => {
      if (stopped || running) return;
      running = true;
      clearTimeout(timer);
      let outcome: PollOutcome;
      try {
        const response = await fetch('/api/whatsapp/conversations', { headers: { 'x-live-key': key }, cache: 'no-store' });
        if (response.ok) {
          const data = (await response.json()) as { enabled: boolean; conversations?: Conversation[]; channels?: { telegram?: string | null; chatToken?: string | null }; salonRev?: unknown };
          outcome = pollOutcome(response.status, data.enabled);
          if (data.enabled && !stopped) {
            if (typeof data.salonRev === 'number' && Number.isFinite(data.salonRev)) setSalonRev(data.salonRev);
            takeConversations(data.conversations ?? []);
            setTelegram(data.channels?.telegram ?? null);
            setChatToken(typeof data.channels?.chatToken === 'string' && data.channels.chatToken ? data.channels.chatToken : null);
          }
        } else {
          outcome = pollOutcome(response.status);
          if (outcome === 'waiting') {
            const data = await response.json().catch(() => null);
            if (!stopped) setWaitNotice(serverSentence(data) ?? OWNER_WAIT_TEXT);
          }
        }
      } catch {
        // No connection, or an answer that is not the server's (a proxy's error page).
        outcome = 'failed';
      }
      running = false;
      if (stopped) return;
      const next = connectionAfter(outcome, reached.current);
      if (outcome === 'enabled') reached.current = true;
      failures = next === 'reconnecting' ? failures + 1 : 0;
      waiting = next === 'waiting';
      if (!waiting) setWaitNotice(null);
      setConnection(next);
      // Off and denied are final for this page: asking again would get the same answer.
      if (next === 'off' || next === 'denied') { stopped = true; return; }
      schedule();
    };

    pollNow.current = () => { if (!isHidden() && !waiting) void poll(); };
    // A hidden tab asks nothing; when it comes back to the front it asks at once (unless it has to wait).
    const onVisibility = () => { if (isHidden()) clearTimeout(timer); else if (waiting) schedule(); else void poll(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', pollNow.current);
    window.addEventListener('online', pollNow.current);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', pollNow.current);
      window.removeEventListener('online', pollNow.current);
      pollNow.current = () => {};
    };
  }, [key, takeConversations]);

  const send = useCallback(async (action: LiveAction): Promise<string | null> => {
    if (!key) return 'Live chats are not enabled in this browser.';
    let response: Response;
    try {
      response = await fetch('/api/whatsapp/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-live-key': key },
        body: JSON.stringify(action),
      });
    } catch {
      return 'Could not reach the server. Check your connection.';
    }
    // Signed out while the answer was on its way: nothing of it belongs on screen any more.
    if (keyNow.current !== key) return null;
    if (response.status === 401 || response.status === 403) {
      setConnection('denied');
      return actionError(response.status, null);
    }
    let data: { conversations?: Conversation[]; error?: string } = {};
    try { data = await response.json(); } catch { /* not the server's answer: the status says enough */ }
    if (keyNow.current !== key) return null;
    if (data.conversations) {
      takeConversations(data.conversations);
      setConnection('live');
    }
    // The owner acted: the chats are busy again, so the next request comes soon.
    lastChange.current = Date.now();
    return actionError(response.status, data);
  }, [key, takeConversations]);

  // The actions on their way, by key, so a second tap waits for the first instead of sending twice.
  const inflight = useRef(new Map<string, Promise<string | null>>());
  const sent = useRef(new Map<string, LiveAction>());
  const replyCount = useRef(0);

  const run = useCallback((itemKey: string, action: LiveAction): Promise<string | null> => {
    const running = inflight.current.get(itemKey);
    if (running) return running;
    sent.current.set(itemKey, action);
    const item: LiveActionState = {
      key: itemKey, conversationId: action.conversationId, type: action.type, state: 'sending',
      ...(action.type === 'reply' ? { text: action.text } : {}),
    };
    setActions((list) => {
      const index = list.findIndex((existing) => existing.key === itemKey);
      return index < 0 ? [...list, item] : list.map((existing, at) => (at === index ? item : existing));
    });
    const promise = send(action).then((error) => {
      inflight.current.delete(itemKey);
      const kept = Boolean(error) && keepsFailure(action.type);
      if (!kept) sent.current.delete(itemKey);
      setActions((list) => kept
        ? list.map((existing) => (existing.key === itemKey ? { ...existing, state: 'failed' as const, error: error ?? undefined } : existing))
        : list.filter((existing) => existing.key !== itemKey));
      return error;
    });
    inflight.current.set(itemKey, promise);
    return promise;
  }, [send]);

  /** One key per chat and kind of action: a second "Take over" while the first runs is the same request. */
  const act = (action: Exclude<LiveAction, { type: 'reply' }>) => run(`${action.conversationId}:${action.type}`, action);

  const reply = (conversationId: string, text: string) => {
    // The same text to the same chat while it is still on its way is a double tap, not a second message.
    const twin = actions.find((item) => item.type === 'reply' && item.conversationId === conversationId && item.text === text && item.state === 'sending');
    if (twin) return inflight.current.get(twin.key) ?? Promise.resolve(null);
    replyCount.current += 1;
    return run(`${conversationId}:reply:${replyCount.current}`, { type: 'reply', conversationId, text });
  };

  /**
   * "Sign out on this device": the key is forgotten, the requests stop (the polling effect ends
   * with the key) and everything the server sent is dropped. The app is then as without a key.
   */
  const signOut = useCallback(() => {
    forgetLiveKey();
    setKey(null);
  }, []);

  // A new key, or none: start from nothing, so no chat of the old key stays on screen.
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setConnection(key ? 'loading' : 'off');
    setConversations([]);
    setTelegram(null);
    setChatToken(null);
    setActions([]);
    setWaitNotice(null);
    setSalonRev(null);
  }
  useEffect(() => {
    reached.current = false;
    lastSeen.current = '';
    inflight.current.clear();
    sent.current.clear();
  }, [key]);

  // Signing out or in in another tab of this browser counts here too.
  useEffect(() => {
    if (!active) return;
    const follow = (event: StorageEvent) => {
      if (event.key === KEY_STORAGE || event.key === null) setKey(event.key === null ? null : event.newValue);
    };
    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, [active]);

  // While the app reconnects or waits, the chats it already has stay on screen.
  const enabled = connection === 'live' || ((connection === 'reconnecting' || connection === 'waiting') && reached.current);
  const inbox: LiveInbox = {
    connection,
    waitNotice: connection === 'waiting' ? waitNotice ?? OWNER_WAIT_TEXT : null,
    actions,
    retry: (itemKey: string) => {
      const action = sent.current.get(itemKey);
      if (action) void run(itemKey, action);
    },
    dismiss: (itemKey: string) => {
      sent.current.delete(itemKey);
      setActions((list) => list.filter((item) => item.key !== itemKey || item.state === 'sending'));
    },
  };

  return {
    enabled,
    /** Whether this browser holds an owner key (it may still be refused: see `connection`). */
    signedIn: Boolean(key),
    /** The key itself, for the salon on the server (src/sharedSalon.ts). It is never shown. */
    accessKey: key,
    /** The salon's revision on the server, from the latest answer of the chats; null before one came. */
    salonRev,
    signOut,
    /** Runs one of the team's checks of the study tools with this device's key. */
    teamCheck: (kind: TeamCheck): Promise<TeamCheckResult> => key
      ? runTeamCheck(kind, key)
      : Promise.resolve({ ok: false, lines: [`${TEAM_CHECKS[kind].label} failed: this device is not signed in to the live chats.`] }),
    status: (connection === 'loading' ? 'checking' : enabled ? 'on' : 'off') as LiveStatus,
    connection,
    inbox,
    /** Asks the server for the chats at once. */
    refresh: () => pollNow.current(),
    telegram: enabled ? telegram : null,
    conversations: enabled ? conversations : [],
    reply,
    takeOver: (conversationId: string) => act({ type: 'take-over', conversationId }),
    letAiContinue: (conversationId: string, answerNow = false) => act({ type: 'let-ai-continue', conversationId, ...(answerNow ? { answerNow } : {}) }),
    markDone: (conversationId: string) => act({ type: 'mark-done', conversationId }),
    confirmBooking: (conversationId: string, expected: ExpectedSlot, staffName?: string) =>
      act({ type: 'confirm-booking', conversationId, expected, ...(staffName ? { staffName } : {}) }),
    suggestTime: (conversationId: string, expected: ExpectedSlot, date: string, time: string, staffName?: string) =>
      act({ type: 'suggest-time', conversationId, expected, date, time, ...(staffName ? { staffName } : {}) }),
    declineBooking: (conversationId: string, expected: ExpectedSlot) => act({ type: 'decline-booking', conversationId, expected }),
    cancelBooking: (conversationId: string, expected: ExpectedSlot) => act({ type: 'cancel-booking', conversationId, expected }),
    keepBooking: (conversationId: string, expected: ExpectedSlot) => act({ type: 'keep-booking', conversationId, expected }),
    channels: enabled && key
      ? { telegram, websiteChatUrl: chatToken ? websiteChatUrl(window.location.origin, chatToken) : null } as LiveChannels
      : null,
  };
}
