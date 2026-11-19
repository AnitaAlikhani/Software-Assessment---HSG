import { useCallback, useEffect, useRef, useState } from 'react';
import { researchMode } from './flags';
import type { Conversation } from './types';

const KEY_STORAGE = 'slotbee-live-key';
const POLL_MS = 4000;

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

type LiveAction =
  | { type: 'reply'; conversationId: string; text: string }
  | { type: 'take-over'; conversationId: string }
  | { type: 'let-ai-continue'; conversationId: string }
  | { type: 'confirm-booking'; conversationId: string };

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
 * or not available here ("off": no access key, no server, or no storage).
 */
export type LiveStatus = 'checking' | 'on' | 'off';

/**
 * `active` is false on the public booking page: a customer's browser never asks the server for
 * the salon's chats and never keeps an access key, whatever its address or its storage holds.
 */
export function useLiveWhatsApp(active = true) {
  const [key] = useState(() => (active ? readLiveKey() : null));
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [enabled, setEnabled] = useState(false);
  // Without a key there is nothing to ask the server, so the answer is known at once.
  const [checked, setChecked] = useState(!key);
  const [telegram, setTelegram] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    if (!key) return;
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch('/api/whatsapp/conversations', { headers: { 'x-live-key': key }, cache: 'no-store' });
        // 404 on GitHub Pages / local dev (no server), 401 with a wrong key: stay a demo.
        if (!response.ok) { setEnabled(false); setChecked(true); return; }
        const data = (await response.json()) as { enabled: boolean; conversations: Conversation[]; channels?: { telegram?: string | null } };
        setEnabled(data.enabled);
        setConversations(data.conversations ?? []);
        setTelegram(data.channels?.telegram ?? null);
      } catch {
        // Network hiccup: try again on the next tick.
      }
      setChecked(true);
      if (!stopped.current) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { stopped.current = true; clearTimeout(timer); };
  }, [key]);

  const act = useCallback(async (action: LiveAction): Promise<string | null> => {
    if (!key) return 'Live chats are not enabled in this browser.';
    try {
      const response = await fetch('/api/whatsapp/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-live-key': key },
        body: JSON.stringify(action),
      });
      const data = (await response.json()) as { conversations?: Conversation[]; error?: string };
      if (data.conversations) setConversations(data.conversations);
      return response.ok ? null : data.error ?? 'Something went wrong.';
    } catch {
      return 'Could not reach the server. Check your connection.';
    }
  }, [key]);

  return {
    enabled,
    status: (!checked ? 'checking' : enabled ? 'on' : 'off') as LiveStatus,
    telegram: enabled ? telegram : null,
    conversations: enabled ? conversations : [],
    reply: (conversationId: string, text: string) => act({ type: 'reply', conversationId, text }),
    takeOver: (conversationId: string) => act({ type: 'take-over', conversationId }),
    letAiContinue: (conversationId: string) => act({ type: 'let-ai-continue', conversationId }),
    confirmBooking: (conversationId: string) => act({ type: 'confirm-booking', conversationId }),
    channels: enabled && key
      ? { telegram, websiteChatUrl: websiteChatUrl(window.location.origin, key) } as LiveChannels
      : null,
  };
}
