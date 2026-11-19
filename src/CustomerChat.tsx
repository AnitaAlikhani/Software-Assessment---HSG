import { FormEvent, useEffect, useRef, useState } from 'react';
import { MoreVertical, Send, Sparkles } from 'lucide-react';
import { PRODUCT_NAME } from './brand';
import { PoweredBy } from './components/Logo';
import { SalonTimeNote } from './components/SalonTimeNote';
import {
  CHAT_RETENTION_DAYS, chatsToDelete, dueEarlierChats, MAX_EARLIER_CHATS, parseEarlierChats, rememberEarlierChat, settleEarlierChats,
  type EarlierChat,
} from './customerNotice';
import { researchMode } from './flags';
import { formatPhone } from './format';
import { initialCompanySettings } from './mockData';
import { chatPageHead, usePageHead } from './pageHead';

interface VisitorMessage {
  id: string;
  from: 'me' | 'salon';
  text: string;
  time: string;
}

const SESSION_STORAGE = 'slotbee-chat-session';
const NAME_STORAGE = 'slotbee-chat-name';
/** The ids of the chats "New chat" set aside, so "Delete chat" can still reach them (rules in customerNotice.ts). */
const EARLIER_STORAGE = 'slotbee-chat-earlier';
const POLL_MS = 4000;
/** The green of the chat header (bg-[#075e54] below). A phone colours its browser bar with it. */
const HEADER_COLOR = '#075e54';

const newSessionId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(36).padStart(2, '0')).join('').slice(0, 20);

/**
 * The key that opens this chat comes with the link and stays in the address. This page does not
 * save it: the same key opens the owner's view of all chats, and a customer's browser must not
 * be left holding it for the next visit to the site.
 */
const keyFromAddress = (): string | null =>
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('live');

function stored(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode: the chat still works for this visit */ }
}
function forget(key: string) {
  try { localStorage.removeItem(key); } catch { /* nothing was stored */ }
}

/**
 * Every sentence a customer reads on this page. Normal visitors get the salon's wording.
 * Research participants (a link with "?research=1") get the study wording, which tells them
 * that this is a student test. Both state the same facts about their data: the period comes
 * from the constant the storage uses, so text and storage cannot disagree.
 */
export function chatCopy(study: boolean, salon: string, phone: string, earlier = 0) {
  const days = CHAT_RETENTION_DAYS;
  const chats = earlier === 1 ? '1 earlier chat' : `${earlier} earlier chats`;
  const orCall = phone ? ` or call ${phone}` : '';
  const processing = "To write the answers, the messages are processed by Google's AI service Gemini. Please don’t share sensitive personal data. You can delete your chat at any time.";
  return {
    subtitle: study ? 'Test chat · answers by AI assistant' : 'AI assistant · the salon team reads along',
    title: study ? 'Write to the salon like on WhatsApp.' : 'Grüezi! Write to us in any language.',
    intro: study
      ? 'Use any language. An AI assistant answers and can suggest appointments. The salon owner sees the chat in English or German and may reply too.'
      : `Our AI assistant answers right away and can suggest appointments. The ${salon} team reads along and can reply too.`,
    privacy: study
      ? `This is a student test (HSG). Your messages and first name are saved for ${days} days after the last activity in this chat and then deleted. ${processing}`
      : `Your messages and first name are stored for the salon and deleted automatically after ${days} days without activity in this chat. ${processing}`,
    details: [
      `Stored: your messages, the first name you enter, the language you write in, and translations of your messages into English and German so the ${study ? 'team' : 'salon team'} can read them.`,
      `Answers: an AI assistant writes them. For this, your messages are sent to Google's AI service Gemini. The ${study ? 'team' : 'salon team'} reads along and can answer in person.`,
      `Where: ${PRODUCT_NAME}, the booking software of ${salon}, keeps the chat with its hosting providers Vercel and Upstash.`,
      `How long: ${days} days after the last activity in the chat. Every new message starts the ${days} days again. “Delete chat” in the chat menu removes it at once, together with earlier chats you started on this device.`,
      'This device remembers the chat and your first name, so you can continue later. When you start a new chat, it also keeps a reference to the chat before (no messages), so that “Delete chat” can remove that one too. The reference is dropped once that chat is gone.',
    ],
    // Without a working link there is no chat to open.
    noLink: study
      ? `This test chat needs the invitation link from the ${PRODUCT_NAME} team.`
      : 'This chat link is no longer valid. Please ask the salon for a new one.',
    threadNote: `Chats are deleted automatically after ${days} days without activity.`,
    // What "New chat" does with the chat on screen. Shown in the chat menu and where a long chat has to be left.
    newChatNote: 'A new chat starts empty. The salon keeps this one until it is deleted automatically, and “Delete chat” removes it too.',
    tooManyChats: `This device has ${MAX_EARLIER_CHATS} earlier chats. Choose “Delete chat” in the chat menu before you start another one.`,
    deleteTitle: earlier > 0 ? `Delete this chat and ${chats}?` : 'Delete this chat?',
    deleteText: earlier > 0
      ? `Your messages in this chat and in the ${chats} you started on this device are deleted here and at the salon. Appointment requests that the salon has not confirmed yet are deleted with them.`
      : 'Your messages are deleted on this device and at the salon. An appointment request that the salon has not confirmed yet is deleted with them.',
    greeting: (name: string) => `Hello${name ? ` ${name}` : ''}! How can we help you? You can write in any language.`,
    studyHint: 'Say hello in any language, for example “Bonjour, avez-vous un rendez-vous jeudi ?”',
    aiBusy: 'The assistant is busy right now. The salon has your message and will answer here.',
    notSent: `Your message was not sent. Please check your connection and try again${orCall}.`,
    notDeleted: earlier > 0 ? 'Not all of your chats could be deleted. Please try again.' : 'Your chat could not be deleted. Please try again.',
    deleted: 'Your chat has been deleted.',
    deletedAll: 'Your chats have been deleted.',
  };
}

/** An answer we only need the status of: finish reading it, so the connection is free again. */
const done = (response: Response) => { void response.text().catch(() => undefined); };

const sameMessages = (a: VisitorMessage[], b: VisitorMessage[]) =>
  a.length === b.length && a.every((message, index) => message.id === b[index].id && message.text === b[index].text);

/**
 * The customer's side of the salon chat: a customer writes like on WhatsApp, in any language.
 * The AI assistant answers here, and the owner sees the chat in Conversations and can reply.
 * Opened with "?chat=1&live=KEY". This page never links into the owner's dashboard.
 */
export default function CustomerChat({ liveKey }: { liveKey?: string | null }) {
  const [key] = useState(() => liveKey === undefined ? keyFromAddress() : liveKey);
  const [study] = useState(researchMode);
  // The server says when a link has stopped working; until then the chat shows.
  const [linkWorks, setLinkWorks] = useState(true);
  const [session, setSession] = useState(() => stored(SESSION_STORAGE) ?? '');
  const [name, setName] = useState(() => stored(NAME_STORAGE) ?? '');
  const [nameDraft, setNameDraft] = useState('');
  const [messages, setMessages] = useState<VisitorMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatFull, setChatFull] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [justDeleted, setJustDeleted] = useState<false | 'one' | 'all'>(false);
  const [earlier, setEarlier] = useState<EarlierChat[]>(() => parseEarlierChats(stored(EARLIER_STORAGE)));
  const sendingRef = useRef(false);
  /**
   * How many messages the salon holds for the chat on screen: 0 when it is known to hold none (a
   * chat just started here, or one the salon answered "empty" for), null while that is not known.
   * Only a chat the salon may hold has to be remembered when a new one starts.
   */
  const atSalon = useRef<number | null>(null);
  /** Counts the messages sent from here, so an answer to a poll that started before one of them is not taken for news. */
  const sends = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { companyName: salon, businessPhone } = initialCompanySettings;
  // The salon's number is written the way every number is: "+41 71 123 45 67".
  const salonPhone = businessPhone.trim() ? formatPhone(businessPhone) : '';
  const copy = chatCopy(study, salon, salonPhone, earlier.length);
  // The browser tab names the salon, not the product: "Chat with Bella Hair Salon".
  usePageHead(chatPageHead(salon, key && linkWorks ? HEADER_COLOR : undefined));

  // Before a chat exists, ask once whether the link still works, so nobody types into a dead chat.
  useEffect(() => {
    if (!key || session) return;
    let stopped = false;
    fetch('/api/chat', { headers: { 'x-live-key': key }, cache: 'no-store' })
      .then(response => { done(response); if (!stopped && response.status === 401) setLinkWorks(false); })
      .catch(() => { /* offline: sending explains it */ });
    return () => { stopped = true; };
  }, [key, session]);

  useEffect(() => {
    if (!key || !session) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const sentBefore = sends.current;
      try {
        const response = await fetch(`/api/chat?session=${session}`, { headers: { 'x-live-key': key }, cache: 'no-store' });
        if (response.status === 401) { done(response); if (!stopped) setLinkWorks(false); return; }
        if (response.ok) {
          const data = (await response.json()) as { messages: VisitorMessage[] };
          // While a message is on its way, keep showing it instead of the older server copy.
          // The same holds for an answer that was asked for before the last message went out.
          if (!stopped && !sendingRef.current && sentBefore === sends.current) {
            atSalon.current = data.messages.length;
            setMessages(previous => sameMessages(previous, data.messages) ? previous : data.messages);
          }
        } else {
          done(response);
        }
      } catch { /* try again on the next tick */ }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [key, session]);

  // An earlier chat whose period is over is normally gone at the salon. The device asks once
  // before it forgets the id, so a chat the salon kept alive can still be deleted from here.
  useEffect(() => {
    if (!key) return;
    const due = dueEarlierChats(parseEarlierChats(stored(EARLIER_STORAGE)), Date.now());
    if (due.length === 0) return;
    let stopped = false;
    void (async () => {
      const answers: Record<string, 'gone' | 'kept' | undefined> = {};
      for (const chat of due) {
        try {
          const response = await fetch(`/api/chat?session=${chat.id}`, { headers: { 'x-live-key': key }, cache: 'no-store' });
          if (response.ok) answers[chat.id] = ((await response.json()) as { messages?: unknown[] }).messages?.length ? 'kept' : 'gone';
          else { done(response); if (response.status === 404) answers[chat.id] = 'gone'; }
        } catch { /* offline: ask again on the next visit */ }
      }
      if (stopped) return;
      const settled = settleEarlierChats(parseEarlierChats(stored(EARLIER_STORAGE)), answers, Date.now());
      store(EARLIER_STORAGE, JSON.stringify(settled));
      setEarlier(settled);
    })();
    return () => { stopped = true; };
  }, [key]);

  // Another tab of this browser started a new chat or deleted the chats: follow it. The device
  // then has one current chat in every tab, and none is left where "Delete chat" cannot reach it.
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key === EARLIER_STORAGE) setEarlier(parseEarlierChats(event.newValue));
      if (event.key === NAME_STORAGE) setName(event.newValue ?? '');
      if (event.key !== SESSION_STORAGE) return;
      atSalon.current = null;
      setSession(event.newValue ?? '');
      setMessages([]);
      setError(null);
      setChatFull(false);
      setNotice(null);
      setMenuOpen(false);
      setConfirmDelete(false);
    };
    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, []);

  // The newest line (a message, "typing…", a notice or an error) is always in view: the list
  // scrolls on its own and the input bar sits below it, so nothing can hide behind the bar.
  const lastMessageId = messages.at(-1)?.id;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, lastMessageId, sending, error, notice]);
  // The same when the list gets shorter: the on-screen keyboard or the chat menu takes room.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { list.scrollTop = list.scrollHeight; });
    observer.observe(list);
    return () => observer.disconnect();
  }, [session]);

  const start = (event: FormEvent) => {
    event.preventDefault();
    const id = newSessionId();
    const chosen = nameDraft.trim().slice(0, 40);
    store(SESSION_STORAGE, id);
    store(NAME_STORAGE, chosen);
    atSalon.current = 0;
    setSession(id);
    setName(chosen);
    setJustDeleted(false);
  };

  const closeMenu = () => { setMenuOpen(false); setConfirmDelete(false); };

  /** With this many chats set aside, another one could not be remembered: delete first. */
  const tooManyChats = earlier.length >= MAX_EARLIER_CHATS;

  /**
   * "New chat", and "Start a new chat" when a chat has become too long. The chat on screen stays
   * at the salon, so its id is remembered before the new one replaces it: "Delete chat" removes
   * it later. A chat the salon holds nothing of needs no successor, it simply starts over.
   */
  const restart = () => {
    if (atSalon.current !== 0) {
      // Read from the storage, not from this tab's copy: another tab may have added to the list.
      const kept = rememberEarlierChat(parseEarlierChats(stored(EARLIER_STORAGE)), session, Date.now());
      if (!kept) return;
      const id = newSessionId();
      store(EARLIER_STORAGE, JSON.stringify(kept));
      store(SESSION_STORAGE, id);
      atSalon.current = 0;
      setEarlier(kept);
      setSession(id);
    }
    setMessages([]);
    setError(null);
    setChatFull(false);
    setNotice(null);
    closeMenu();
  };

  /**
   * "Delete chat": this chat and every earlier chat this device remembers, one request each (the
   * route deletes one chat per call). The earlier ones go first and each id is forgotten as soon
   * as its chat is gone. If a request fails, this chat stays on screen with its menu, so the
   * customer can try again and nothing is left that could no longer be reached.
   */
  const deleteChat = async () => {
    if (!key || deleting) return;
    setDeleting(true);
    setError(null);
    // Read from the storage, not from this tab's copy: another tab may have added to the list.
    let remaining = parseEarlierChats(stored(EARLIER_STORAGE));
    const ids = chatsToDelete(remaining, session);
    try {
      for (const id of ids) {
        const response = await fetch(`/api/chat?session=${id}`, { method: 'DELETE', headers: { 'x-live-key': key } });
        done(response);
        if (response.status === 401) { setLinkWorks(false); return; }
        if (!response.ok) { setError(copy.notDeleted); closeMenu(); return; }
        if (id === session) break;
        remaining = remaining.filter(chat => chat.id !== id);
        store(EARLIER_STORAGE, JSON.stringify(remaining));
        setEarlier(remaining);
      }
      // Gone at the salon: forget everything on this device too, including the first name.
      forget(SESSION_STORAGE);
      forget(NAME_STORAGE);
      forget(EARLIER_STORAGE);
      atSalon.current = null;
      setEarlier([]);
      setSession('');
      setName('');
      setNameDraft('');
      setMessages([]);
      setNotice(null);
      setChatFull(false);
      closeMenu();
      setJustDeleted(ids.length > 1 ? 'all' : 'one');
    } catch {
      setError(copy.notDeleted);
      closeMenu();
    } finally {
      setDeleting(false);
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || !key) return;
    setSending(true);
    sendingRef.current = true;
    sends.current += 1;
    // From here on the salon may hold this chat, whatever becomes of the answer.
    atSalon.current = null;
    setError(null);
    setChatFull(false);
    setNotice(null);
    const pendingId = `pending-${Date.now()}`;
    setMessages(previous => [...previous, { id: pendingId, from: 'me', text, time: '' }]);
    setDraft('');
    // A message that did not reach the salon must not stay in the thread as if it had:
    // it goes back into the input, ready to send again.
    const notSent = (message: string) => {
      setMessages(previous => previous.filter(item => item.id !== pendingId));
      setDraft(current => current || text);
      setError(message);
    };
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-live-key': key },
        body: JSON.stringify({ session, name, text }),
      });
      // A server that fell over answers with a page instead of data.
      const data = (await response.json().catch(() => ({}))) as { messages?: VisitorMessage[]; error?: string; aiFailed?: boolean; full?: boolean };
      if (response.ok && data.messages) {
        atSalon.current = data.messages.length;
        setMessages(data.messages);
        if (data.aiFailed) setNotice(copy.aiBusy);
      } else {
        if (response.status === 401) setLinkWorks(false);
        setChatFull(Boolean(data.full));
        notSent(data.error ?? copy.notSent);
      }
    } catch {
      notSent(copy.notSent);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (!key || !linkWorks) {
    return (
      <main className="min-h-dvh bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-2">
          <h1 className="text-base font-semibold text-slate-900">{salon}</h1>
          <p className="text-sm text-slate-600">{copy.noLink}</p>
          {salonPhone && <p className="text-sm text-slate-600">You can reach the salon on {salonPhone}.</p>}
        </div>
      </main>
    );
  }

  return (
    // A column exactly as tall as the screen: header, the list that scrolls, the input bar.
    // "100dvh" follows the phone's address bar; older browsers fall back to the class.
    <main className="h-screen overflow-hidden bg-[#efeae2] flex justify-center" style={{ height: '100dvh' }}>
      <div className="w-full max-w-lg flex flex-col h-full min-h-0 bg-[#efeae2]" onKeyDown={event => { if (event.key === 'Escape' && menuOpen) closeMenu(); }}>
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 bg-[#075e54] text-white">
          <div aria-hidden="true" className="w-10 h-10 shrink-0 rounded-full bg-white/20 flex items-center justify-center font-bold">
            {salon.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold truncate">{salon}</h1>
            <p className="text-xs leading-snug text-white/80">{copy.subtitle}</p>
          </div>
          {session && (
            <button
              type="button"
              onClick={() => menuOpen ? closeMenu() : setMenuOpen(true)}
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? 'chat-menu' : undefined}
              aria-label="Chat menu"
              className="w-11 h-11 shrink-0 -mr-2 rounded-lg flex items-center justify-center hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
            >
              <MoreVertical className="w-5 h-5" aria-hidden="true" />
            </button>
          )}
        </header>

        {session && menuOpen && (
          <div id="chat-menu" className="shrink-0 bg-white px-4 py-3 shadow-sm space-y-2">
            {confirmDelete ? (
              <>
                <p className="text-sm font-semibold text-slate-900">{copy.deleteTitle}</p>
                <p className="text-xs text-slate-600">{copy.deleteText}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={deleteChat} disabled={deleting || sending} className="min-h-11 px-4 rounded-xl bg-rose-600 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                    {deleting ? 'Deleting…' : 'Delete chat'}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} className="min-h-11 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    Keep chat
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-600">{copy.threadNote} {tooManyChats ? copy.tooManyChats : copy.newChatNote}</p>
                <div className="flex flex-wrap gap-2">
                  {/* While an answer is on its way, the chat cannot be swapped or deleted under it. */}
                  <button type="button" onClick={restart} disabled={sending || tooManyChats} className="min-h-11 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    New chat
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(true)} disabled={sending} className="min-h-11 px-4 rounded-xl border border-rose-200 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                    Delete chat
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!session ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {justDeleted && <p role="status" className="mx-4 mt-4 rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">{justDeleted === 'all' ? copy.deletedAll : copy.deleted}</p>}
            <form onSubmit={start} className="m-4 mt-6 p-5 rounded-2xl bg-white shadow-sm space-y-4">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-[#5551FF] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 space-y-2 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">{copy.title}</p>
                  <p>{copy.intro}</p>
                  <p className="text-xs text-slate-500">{copy.privacy}</p>
                  <details className="text-xs text-slate-500">
                    <summary className="min-h-11 cursor-pointer content-center font-semibold text-slate-600">More about your data</summary>
                    <ul className="list-disc space-y-1.5 pl-4 pb-1">
                      {copy.details.map(line => <li key={line}>{line}</li>)}
                    </ul>
                  </details>
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
          </div>
        ) : (
          <>
            <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4 space-y-2" aria-live="polite">
              <p className="mx-auto max-w-xs text-center text-[11px] leading-snug text-slate-500">{copy.threadNote}</p>
              {/* The times under the messages are the salon's: said only on a device set to another time zone. */}
              <SalonTimeNote timeZone={initialCompanySettings.timeZone} className="justify-center text-[11px]" />
              {messages.length === 0 && !sending && (study ? (
                <p className="mx-auto max-w-xs text-center text-xs text-slate-600 bg-[#fff5c4] rounded-lg px-3 py-2">{copy.studyHint}</p>
              ) : (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg px-3 py-2 text-[15px] shadow-xs bg-white text-slate-900">{copy.greeting(name)}</div>
                </div>
              ))}
              {messages.map(message => (
                <div key={message.id} className={`flex ${message.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-[15px] shadow-xs whitespace-pre-wrap [overflow-wrap:anywhere] ${message.from === 'me' ? 'bg-[#d9fdd3] text-slate-900' : 'bg-white text-slate-900'}`}>
                    {message.text}
                    {message.time
                      ? <span className="block text-right text-[10px] text-slate-500 mt-1">{message.time}</span>
                      : message.from === 'me' && <span className="block text-right text-[10px] text-slate-500 mt-1">Sending…</span>}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-lg px-3 py-2 bg-white text-sm text-slate-500 shadow-xs">typing…</div>
                </div>
              )}
              {notice && <p role="status" className="rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-700">{notice}</p>}
              {error && (
                <div role="alert" className="rounded-lg bg-white px-3 py-2 text-xs text-red-700">
                  <p>{error}</p>
                  {/* Leaving a chat that has become too long: say what happens to it, as the chat menu does. */}
                  {chatFull && <p className="mt-1 text-slate-600">{tooManyChats ? copy.tooManyChats : copy.newChatNote}</p>}
                  {chatFull && !tooManyChats && (
                    <button type="button" onClick={restart} className="mt-1 min-h-11 rounded-lg px-3 text-sm font-semibold text-[#075e54] underline hover:bg-slate-50">
                      Start a new chat
                    </button>
                  )}
                </div>
              )}
            </div>
            <form onSubmit={send} className="shrink-0 flex items-center gap-2 px-3 pt-3 pb-1.5 bg-[#f0f2f5]">
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
                <Send className="w-4 h-4" aria-hidden="true" />
              </button>
            </form>
          </>
        )}
        {/* The foot of the page names the product, on the input bar once the chat has started. Text only. */}
        <PoweredBy className={`shrink-0 px-3 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] ${session ? 'bg-[#f0f2f5]' : ''}`} />
      </div>
    </main>
  );
}
