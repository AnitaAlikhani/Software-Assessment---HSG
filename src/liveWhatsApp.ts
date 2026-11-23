import { useCallback, useEffect, useRef, useState } from 'react';
import { researchMode } from './flags';
import type { Conversation } from './types';

const KEY_STORAGE = 'slotbee-live-key';

export const isLiveConversation = (id: string) => id.startsWith('live-');

/**
 * The access key comes from a "?live=KEY" link that we give to testers. It is kept in this
 * browser so the link only has to be opened once. Without a key the website stays a pure demo.
 */
export function readLiveKey(search = typeof window === 'undefined' ? '' : window.location.search): string | null {
  const fromUrl = new URLSearchParams(search).get('live');
  try {
    if (fromUrl) localStorage.setItem(KEY_STORAGE, fromUrl);
    return fromUrl ?? localStorage.getItem(KEY_STORAGE);
  } catch {
    return fromUrl;
  }
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
  /** Carries the access key, so it is shown with the study tools only, never as a customer link. */
  websiteChatUrl: string;
}

/**
 * The website-chat link the owner copies for testers. With the study tools on it switches them
 * on for the tester as well ("research=1"): otherwise a study participant would read the salon's
 * wording instead of the notice that this is a study.
 */
export const websiteChatUrl = (origin: string, key: string, study = researchMode()): string =>
  `${origin}/?chat=1&live=${encodeURIComponent(key)}${study ? '&research=1' : ''}`;

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
 * - `denied`: the server refused the access key (a wrong or expired link).
 */
export type LiveConnection = 'off' | 'loading' | 'live' | 'reconnecting' | 'denied';

/** How one request to the server ended. */
export type PollOutcome = 'enabled' | 'disabled' | 'refused' | 'missing' | 'failed';

/** Sorts an answer (or a failure to get one) into an outcome. Only 401 and 403 mean the key was refused. */
export const pollOutcome = (status: number | null, enabled?: boolean): PollOutcome => {
  if (status === null || status >= 500 || status === 429 || status === 408) return 'failed';
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
} as const;

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
  const [key] = useState(() => (active ? readLiveKey() : null));
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Without a key there is nothing to ask the server, so the answer is known at once.
  const [connection, setConnection] = useState<LiveConnection>(key ? 'loading' : 'off');
  const [telegram, setTelegram] = useState<string | null>(null);
  const [actions, setActions] = useState<LiveActionState[]>([]);
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
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (stopped) return;
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
          const data = (await response.json()) as { enabled: boolean; conversations?: Conversation[]; channels?: { telegram?: string | null } };
          outcome = pollOutcome(response.status, data.enabled);
          if (data.enabled) {
            takeConversations(data.conversations ?? []);
            setTelegram(data.channels?.telegram ?? null);
          }
        } else {
          outcome = pollOutcome(response.status);
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
      setConnection(next);
      // Off and denied are final for this page: asking again would get the same answer.
      if (next === 'off' || next === 'denied') { stopped = true; return; }
      schedule();
    };

    pollNow.current = () => { if (!isHidden()) void poll(); };
    // A hidden tab asks nothing; when it comes back to the front it asks at once.
    const onVisibility = () => { if (isHidden()) clearTimeout(timer); else void poll(); };
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
    if (response.status === 401 || response.status === 403) {
      setConnection('denied');
      return 'This access link is not valid any more.';
    }
    let data: { conversations?: Conversation[]; error?: string } = {};
    try { data = await response.json(); } catch { /* not the server's answer: the status says enough */ }
    if (data.conversations) {
      takeConversations(data.conversations);
      setConnection('live');
    }
    // The owner acted: the chats are busy again, so the next request comes soon.
    lastChange.current = Date.now();
    return response.ok ? null : data.error ?? 'The server could not do this. Try again.';
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

  const enabled = connection === 'live' || (connection === 'reconnecting' && reached.current);
  const inbox: LiveInbox = {
    connection,
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
      ? { telegram, websiteChatUrl: websiteChatUrl(window.location.origin, key) } as LiveChannels
      : null,
  };
}
