import { useCallback, useEffect, useRef, useState } from 'react';
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
  | { type: 'let-ai-continue'; conversationId: string };

export function useLiveWhatsApp() {
  const [key] = useState(readLiveKey);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [enabled, setEnabled] = useState(false);
  const stopped = useRef(false);

  useEffect(() => {
    if (!key) return;
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch('/api/whatsapp/conversations', { headers: { 'x-live-key': key }, cache: 'no-store' });
        // 404 on GitHub Pages / local dev (no server), 401 with a wrong key: stay a demo.
        if (!response.ok) { setEnabled(false); return; }
        const data = (await response.json()) as { enabled: boolean; conversations: Conversation[] };
        setEnabled(data.enabled);
        setConversations(data.conversations ?? []);
      } catch {
        // Network hiccup: try again on the next tick.
      }
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
    conversations: enabled ? conversations : [],
    reply: (conversationId: string, text: string) => act({ type: 'reply', conversationId, text }),
    takeOver: (conversationId: string) => act({ type: 'take-over', conversationId }),
    letAiContinue: (conversationId: string) => act({ type: 'let-ai-continue', conversationId }),
  };
}
