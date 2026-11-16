import { FormEvent, useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { readLiveKey } from './liveWhatsApp';
import { initialCompanySettings } from './mockData';

interface VisitorMessage {
  id: string;
  from: 'me' | 'salon';
  text: string;
  time: string;
}

const SESSION_STORAGE = 'slotbee-chat-session';
const NAME_STORAGE = 'slotbee-chat-name';
const POLL_MS = 4000;

const newSessionId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(36).padStart(2, '0')).join('').slice(0, 20);

function stored(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode: the chat still works for this visit */ }
}

/**
 * The customer side of the live test: a tester writes to the demo salon like on WhatsApp,
 * in any language. The AI answers here, and the owner sees the chat in Conversations.
 * Opened with "?chat=1&live=KEY".
 */
export default function CustomerChat() {
  const [key] = useState(readLiveKey);
  const [session, setSession] = useState(() => stored(SESSION_STORAGE) ?? '');
  const [name, setName] = useState(() => stored(NAME_STORAGE) ?? '');
  const [nameDraft, setNameDraft] = useState('');
  const [messages, setMessages] = useState<VisitorMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const salon = initialCompanySettings.companyName;

  useEffect(() => {
    if (!key || !session) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/chat?session=${session}`, { headers: { 'x-live-key': key }, cache: 'no-store' });
        if (response.ok) {
          const data = (await response.json()) as { messages: VisitorMessage[] };
          // While a message is on its way, keep showing it instead of the older server copy.
          if (!stopped && !sendingRef.current) setMessages(data.messages);
        }
      } catch { /* try again on the next tick */ }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [key, session]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, sending]);

  const start = (event: FormEvent) => {
    event.preventDefault();
    const id = newSessionId();
    const chosen = nameDraft.trim().slice(0, 40);
    store(SESSION_STORAGE, id);
    store(NAME_STORAGE, chosen);
    setSession(id);
    setName(chosen);
  };

  const restart = () => {
    const id = newSessionId();
    store(SESSION_STORAGE, id);
    setSession(id);
    setMessages([]);
    setError(null);
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || !key) return;
    setSending(true);
    sendingRef.current = true;
    setError(null);
    setNotice(null);
    setMessages(previous => [...previous, { id: `pending-${Date.now()}`, from: 'me', text, time: '' }]);
    setDraft('');
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-live-key': key },
        body: JSON.stringify({ session, name, text }),
      });
      const data = (await response.json()) as { messages?: VisitorMessage[]; error?: string; aiFailed?: boolean };
      if (data.messages) setMessages(data.messages);
      if (!response.ok) setError(data.error ?? 'The message could not be sent.');
      else if (data.aiFailed) setNotice('The assistant is busy right now. The salon has your message and will answer here.');
    } catch {
      setError('Could not reach the salon. Check your connection.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (!key) {
    return (
      <main className="min-h-dvh bg-slate-50 flex items-center justify-center p-6">
        <p className="max-w-sm text-center text-sm text-slate-600">
          This test chat needs the invitation link from the SlotBee team.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#efeae2] flex justify-center">
      <div className="w-full max-w-lg flex flex-col min-h-dvh bg-[#efeae2]">
        <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-[#075e54] text-white">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold">
            {salon.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold truncate">{salon}</h1>
            <p className="text-xs text-white/80">Test chat · answers by AI assistant</p>
          </div>
          {session && (
            <button onClick={restart} className="min-h-11 px-3 text-xs font-semibold rounded-lg hover:bg-white/10">
              New chat
            </button>
          )}
        </header>

        {!session ? (
          <form onSubmit={start} className="m-4 mt-8 p-5 rounded-2xl bg-white shadow-sm space-y-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-[#5551FF] shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Write to the salon like on WhatsApp.</p>
                <p>Use any language. An AI assistant answers and can suggest appointments. The salon owner sees the chat in English or German and may reply too.</p>
                <p className="text-xs text-slate-500">This is a student test (HSG). Your messages are saved for about two weeks and then deleted. Please don’t share sensitive personal data.</p>
              </div>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Your first name (optional)
              <input
                value={nameDraft}
                onChange={event => setNameDraft(event.target.value)}
                maxLength={40}
                autoComplete="given-name"
                className="mt-1 w-full min-h-11 px-3 rounded-xl border border-slate-200 text-base focus:outline-hidden focus:ring-2 focus:ring-[#5551FF]/30"
              />
            </label>
            <button type="submit" className="w-full min-h-11 rounded-xl bg-[#5551FF] text-white font-semibold hover:bg-[#433fd8]">
              Start chat
            </button>
          </form>
        ) : (
          <>
            <div className="flex-1 px-3 py-4 space-y-2" aria-live="polite">
              {messages.length === 0 && !sending && (
                <p className="mx-auto max-w-xs text-center text-xs text-slate-600 bg-[#fff5c4] rounded-lg px-3 py-2">
                  Say hello in any language, for example “Bonjour, avez-vous un rendez-vous jeudi ?”
                </p>
              )}
              {messages.map(message => (
                <div key={message.id} className={`flex ${message.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-[15px] shadow-xs whitespace-pre-wrap [overflow-wrap:anywhere] ${message.from === 'me' ? 'bg-[#d9fdd3] text-slate-900' : 'bg-white text-slate-900'}`}>
                    {message.text}
                    {message.time && <span className="block text-right text-[10px] text-slate-500 mt-1">{message.time}</span>}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-lg px-3 py-2 bg-white text-sm text-slate-500 shadow-xs">typing…</div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            {notice && <p role="status" className="px-4 pb-2 text-xs text-slate-600">{notice}</p>}
            {error && <p role="alert" className="px-4 pb-2 text-xs text-red-700">{error}</p>}
            <form onSubmit={send} className="sticky bottom-0 flex items-center gap-2 px-3 py-3 bg-[#f0f2f5]">
              <input
                value={draft}
                onChange={event => setDraft(event.target.value)}
                maxLength={1000}
                placeholder="Message"
                aria-label="Message"
                className="min-w-0 flex-1 min-h-11 px-4 rounded-full bg-white text-base focus:outline-hidden focus:ring-2 focus:ring-[#075e54]/30"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label="Send message"
                className="w-11 h-11 shrink-0 rounded-full bg-[#075e54] text-white flex items-center justify-center disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
