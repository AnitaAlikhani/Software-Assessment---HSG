import { FormEvent, useEffect, useRef, useState } from 'react';
import { Clock, Link2Off, MoreVertical, Phone, Send, Sparkles } from 'lucide-react';
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

/** The server's sentence for a chat link it does not accept (api/chat.ts answers it with 401). */
export const LINK_NOT_VALID = 'This chat link is no longer valid. Please ask the salon for a new one.';
/** Said when the server's 429 answer brings no sentence of its own. */
export const TOO_MANY_MESSAGES = 'Too many messages in a short time. Please wait a moment and try again.';
/** How long the page waits before it asks again after the server said "too many" (429). */
const POLL_AFTER_LIMIT_MS = 30_000;

/**
 * The chat token that opens this chat: the "chat" parameter of the address ("/?chat=<token>").
 * The token opens this chat and nothing else. An address of the old form ("?chat=1&live=…")
 * carries no token: null, and the page says that the link is no longer valid.
 */
export function chatTokenFromAddress(search: string): string | null {
  const token = new URLSearchParams(search).get('chat');
  return token && token !== '1' ? token : null;
}

/** The headers of every request of this page: the chat token, and never an owner key. */
export const chatHeaders = (token: string, json = false): Record<string, string> =>
  ({ ...(json ? { 'Content-Type': 'application/json' } : {}), 'x-chat-token': token });

/**
 * What an answer of /api/chat means for this page. A chat that reached its length answers 429
 * with `full: true`: that is not "wait a moment" (trying again fails the same way) but "this
 * chat is closed", and the page offers a new chat. Only a 429 without `full` means "wait".
 */
export type ChatAnswer = 'ok' | 'link-not-valid' | 'full' | 'too-many' | 'failed';
export const chatAnswer = (status: number, data?: { full?: unknown; error?: unknown } | null): ChatAnswer => {
  if (status === 401 || status === 403) return 'link-not-valid';
  if (status >= 200 && status < 300) return 'ok';
  if (data?.full === true) return 'full';
  return status === 429 ? 'too-many' : 'failed';
};

/** The server's sentence in an answer, or the page's own when it sent none. */
const sentenceOf = (data: { error?: unknown } | null, answer: ChatAnswer): string =>
  typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : answer === 'too-many' ? TOO_MANY_MESSAGES : LINK_NOT_VALID;

/**
 * Asks the server about the earlier chats whose period is over, one after the other. The first
 * refused link ends the round: every further try with a refused token counts as a wrong try
 * for the customer's whole network, so the page asks nothing more.
 */
export async function askAboutEarlierChats(
  ids: string[],
  ask: (id: string) => Promise<Response>,
): Promise<{ answers: Record<string, 'gone' | 'kept' | undefined>; refused: Response | null }> {
  const answers: Record<string, 'gone' | 'kept' | undefined> = {};
  for (const id of ids) {
    try {
      const response = await ask(id);
      const answer = chatAnswer(response.status);
      if (answer === 'link-not-valid') return { answers, refused: response };
      if (answer === 'too-many') { done(response); break; }
      if (response.ok) answers[id] = ((await response.json()) as { messages?: unknown[] }).messages?.length ? 'kept' : 'gone';
      else { done(response); if (response.status === 404) answers[id] = 'gone'; }
    } catch { /* offline: ask again on the next visit */ }
  }
  return { answers, refused: null };
}

/**
 * A refused link or "too many": what to tell the customer. The server's own sentence is used
 * when it sends one; otherwise the page's. Reads the answer, so call it only for these two.
 */
export async function refusalSentence(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  return sentenceOf(data, chatAnswer(response.status));
}

/** What this page shows of the salon's profile (GET /api/salon/profile, server/salon.ts salonProfile). */
export interface ProfileFacts {
  name: string | null;
  timeZone: string | null;
  /** The salon's number as it set it; '' when it has none; null when the answer does not say. */
  phone: string | null;
}

/** Takes the salon's name (`companyName`), time zone and phone from the profile, where the answer has them. */
export function profileFacts(data: unknown): ProfileFacts {
  const record = typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
  return {
    name: text(record.companyName),
    timeZone: text(record.timeZone),
    phone: typeof record.phone === 'string' ? record.phone.trim() : null,
  };
}

const NO_PROFILE: ProfileFacts = { name: null, timeZone: null, phone: null };

/**
 * How long the page keeps the salon's name back while the profile is on its way. Showing the
 * built-in name and then another one would flicker; after this moment the built-in name shows.
 */
export const NAME_WAIT_MS = 1200;

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
    // Without a working link there is no chat to open. The sentence is the server's (api/chat.ts).
    noLink: LINK_NOT_VALID,
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
    teamAnswers: `The ${salon} team is answering this chat now, so a reply can take a little longer.`,
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
 * Opened with "/?chat=<token>". This page never links into the owner's dashboard, and it never
 * sends or keeps an owner key: its requests carry the chat token only.
 */
export default function CustomerChat({ token }: { token?: string | null }) {
  const [key] = useState(() => token === undefined ? chatTokenFromAddress(typeof window === 'undefined' ? '' : window.location.search) : token);
  const [study] = useState(researchMode);
  // The server says when a link has stopped working; until then the chat shows.
  const [linkWorks, setLinkWorks] = useState(true);
  // The server's sentence for a refused link, when it sent one.
  const [linkSentence, setLinkSentence] = useState(LINK_NOT_VALID);
  // The server's sentence after "too many" (429): the chat stays, the customer tries again later.
  const [limited, setLimited] = useState<string | null>(null);
  // The server has accepted the link once on this page (any answer that was not a refusal).
  const [linkConfirmed, setLinkConfirmed] = useState(false);
  // Set by the first refusal: from then on the page sends nothing, so it adds no further wrong tries.
  const refused = useRef(false);
  const [session, setSession] = useState(() => stored(SESSION_STORAGE) ?? '');
  const [name, setName] = useState(() => stored(NAME_STORAGE) ?? '');
  const [nameDraft, setNameDraft] = useState('');
  const [messages, setMessages] = useState<VisitorMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatFull, setChatFull] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Who answers now, as the salon says: the AI assistant, or the team once the owner took the chat over.
  const [answeredBy, setAnsweredBy] = useState<'assistant' | 'team' | null>(null);
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
  // The salon's name and time zone as the salon has set them (GET /api/salon/profile), asked for
  // once the link has been accepted, so a refused link costs no second wrong try. Until the
  // answer comes, and when it fails, the page uses the built-in ones.
  const [profile, setProfile] = useState<ProfileFacts | null>(null);
  const [nameWaited, setNameWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setNameWaited(true), NAME_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  const askedProfile = useRef(false);
  useEffect(() => {
    if (!key || !linkConfirmed || refused.current || askedProfile.current) return;
    askedProfile.current = true;
    let stopped = false;
    fetch('/api/salon/profile', { headers: chatHeaders(key), cache: 'no-store' })
      .then(async response => {
        if (stopped) { done(response); return; }
        if (chatAnswer(response.status) === 'link-not-valid') { void linkRefused(response); return; }
        if (!response.ok) { done(response); setProfile(NO_PROFILE); return; }
        const facts = profileFacts(await response.json().catch(() => null));
        if (!stopped) setProfile(facts);
      })
      .catch(() => { if (!stopped) setProfile(NO_PROFILE); });
    return () => { stopped = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, linkConfirmed]);
  const salon = profile?.name ?? initialCompanySettings.companyName;
  const salonTimeZone = profile?.timeZone ?? initialCompanySettings.timeZone;
  // The name shows once it is known, or once waiting longer would only keep the page empty.
  const nameShown = profile !== null || nameWaited || !linkWorks;
  const nameClass = `transition-opacity duration-200 ${nameShown ? 'opacity-100' : 'opacity-0'}`;
  // The salon's number from the profile once it is there (none when the salon has none); the built-in one until then.
  const businessPhone = profile?.phone ?? initialCompanySettings.businessPhone;
  // The salon's number is written the way every number is: "+41 71 123 45 67".
  const salonPhone = businessPhone.trim() ? formatPhone(businessPhone) : '';
  const copy = chatCopy(study, salon, salonPhone, earlier.length);
  // The browser tab names the salon, not the product: "Chat with Bella Hair Salon".
  usePageHead(chatPageHead(nameShown ? salon : '', key && linkWorks ? HEADER_COLOR : undefined));

  /** The link was refused: the page shows the server's sentence and nothing to type into. */
  const linkRefused = async (response: Response) => {
    // The first refusal ends every request of this page (see `refused`).
    refused.current = true;
    setLinkSentence(await refusalSentence(response));
    setLinkWorks(false);
  };
  /** "Too many" (429): the server's sentence, said calmly; nothing typed is lost. */
  const tooMany = async (response: Response) => { setLimited(await refusalSentence(response)); };

  // Before a chat exists, ask once whether the link still works, so nobody types into a dead chat.
  useEffect(() => {
    if (!key || session || refused.current) return;
    let stopped = false;
    fetch('/api/chat', { headers: chatHeaders(key), cache: 'no-store' })
      .then(response => {
        if (stopped) { done(response); return; }
        const answer = chatAnswer(response.status);
        if (answer === 'link-not-valid') void linkRefused(response);
        else if (answer === 'too-many') void tooMany(response);
        else { done(response); if (answer === 'ok') setLinkConfirmed(true); }
      })
      .catch(() => { /* offline: sending explains it */ });
    return () => { stopped = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, session]);

  useEffect(() => {
    if (!key || !session) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    setAnsweredBy(null);
    const poll = async () => {
      if (refused.current) return;
      const sentBefore = sends.current;
      try {
        const response = await fetch(`/api/chat?session=${session}`, { headers: chatHeaders(key), cache: 'no-store' });
        if (chatAnswer(response.status) === 'link-not-valid') { if (!stopped) void linkRefused(response); else done(response); return; }
        // Too many requests from here: ask again later, and say nothing while nothing was sent.
        if (response.status === 429) { done(response); if (!stopped) timer = setTimeout(poll, POLL_AFTER_LIMIT_MS); return; }
        if (response.ok) {
          const data = (await response.json()) as { messages: VisitorMessage[]; answeredBy?: 'assistant' | 'team' };
          if (!stopped) { setAnsweredBy(data.answeredBy ?? null); setLinkConfirmed(true); }
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
  // It waits until the server has accepted the link once, so a refused link costs one try, not one per chat.
  useEffect(() => {
    if (!key || !linkConfirmed || refused.current) return;
    const due = dueEarlierChats(parseEarlierChats(stored(EARLIER_STORAGE)), Date.now());
    if (due.length === 0) return;
    let stopped = false;
    void (async () => {
      const { answers, refused: refusal } = await askAboutEarlierChats(
        due.map(chat => chat.id),
        id => refused.current ? Promise.reject(new Error('link refused')) : fetch(`/api/chat?session=${id}`, { headers: chatHeaders(key), cache: 'no-store' }),
      );
      if (refusal) { if (!stopped) void linkRefused(refusal); else done(refusal); return; }
      if (stopped) return;
      const settled = settleEarlierChats(parseEarlierChats(stored(EARLIER_STORAGE)), answers, Date.now());
      store(EARLIER_STORAGE, JSON.stringify(settled));
      setEarlier(settled);
    })();
    return () => { stopped = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, linkConfirmed]);

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
        if (refused.current) return;
        const response = await fetch(`/api/chat?session=${id}`, { method: 'DELETE', headers: chatHeaders(key) });
        const answer = chatAnswer(response.status);
        if (answer === 'link-not-valid') { await linkRefused(response); return; }
        if (answer === 'too-many') { await tooMany(response); closeMenu(); return; }
        done(response);
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
    if (!text || sending || !key || refused.current) return;
    setSending(true);
    sendingRef.current = true;
    sends.current += 1;
    // From here on the salon may hold this chat, whatever becomes of the answer.
    atSalon.current = null;
    setError(null);
    setLimited(null);
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
        headers: chatHeaders(key, true),
        body: JSON.stringify({ session, name, text }),
      });
      if (chatAnswer(response.status) === 'link-not-valid') { await linkRefused(response); return; }
      // A server that fell over answers with a page instead of data.
      const data = (await response.json().catch(() => ({}))) as { messages?: VisitorMessage[]; error?: string; aiFailed?: boolean; full?: boolean; answeredBy?: 'assistant' | 'team' };
      // A full chat is checked before "too many": it is closed, and the way out is a new chat.
      const answer = chatAnswer(response.status, data);
      if (answer === 'too-many') {
        // Not sent: the text goes back into the input, and the server's sentence says when to try again.
        setMessages(previous => previous.filter(item => item.id !== pendingId));
        setDraft(current => current || text);
        setLimited(sentenceOf(data, answer));
        return;
      }
      if (response.ok && data.messages) {
        setAnsweredBy(data.answeredBy ?? null);
        atSalon.current = data.messages.length;
        setMessages(data.messages);
        if (data.aiFailed) setNotice(copy.aiBusy);
      } else {
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
    // A page of its own, complete and calm: the link is over, so there is nothing to type into.
    return (
      <main className="min-h-dvh bg-[#efeae2] flex justify-center">
        <div className="w-full max-w-lg flex flex-col min-h-dvh">
          <div className="flex-1 flex items-center justify-center p-4">
            <section aria-labelledby="chat-closed-title" className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm space-y-4">
              <div aria-hidden="true" className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#075e54]/10 text-[#075e54]">
                <Link2Off className="size-6" />
              </div>
              <div className="space-y-2">
                <h1 id="chat-closed-title" className="text-lg font-semibold text-slate-900">{salon}</h1>
                <p className="text-[15px] leading-relaxed text-slate-700">{key ? linkSentence : copy.noLink}</p>
              </div>
              {salonPhone && (
                <p className="flex items-center justify-center gap-2 border-t border-slate-100 pt-4 text-sm text-slate-600">
                  <Phone className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>You can also call the salon on <span className="font-semibold text-slate-800 whitespace-nowrap">{salonPhone}</span>.</span>
                </p>
              )}
            </section>
          </div>
          <PoweredBy className="shrink-0 px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]" />
        </div>
      </main>
    );
  }

  /** The server's "too many" sentence: calm, above the input, which keeps what was typed. */
  const limitNotice = limited && (
    <p role="status" className="flex items-start gap-2 rounded-lg bg-white/90 px-3 py-2 text-xs text-slate-700 shadow-xs">
      <Clock className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
      <span>{limited}</span>
    </p>
  );

  return (
    // A column exactly as tall as the screen: header, the list that scrolls, the input bar.
    // "100dvh" follows the phone's address bar; older browsers fall back to the class.
    <main className="h-screen overflow-hidden bg-[#efeae2] flex justify-center" style={{ height: '100dvh' }}>
      <div className="w-full max-w-lg flex flex-col h-full min-h-0 bg-[#efeae2]" onKeyDown={event => { if (event.key === 'Escape' && menuOpen) closeMenu(); }}>
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 bg-[#075e54] text-white">
          <div aria-hidden="true" className="w-10 h-10 shrink-0 rounded-full bg-white/20 flex items-center justify-center font-bold">
            <span className={nameClass}>{salon.slice(0, 1)}</span>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className={`text-base font-semibold truncate ${nameClass}`} aria-busy={!nameShown}>{salon}</h1>
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
            {limited && <div className="mx-4 mt-4">{limitNotice}</div>}
            {justDeleted && <p role="status" className="mx-4 mt-4 rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">{justDeleted === 'all' ? copy.deletedAll : copy.deleted}</p>}
            <form onSubmit={start} className="m-4 mt-6 p-5 rounded-2xl bg-white shadow-sm space-y-4">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-[#5551FF] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 space-y-2 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">{copy.title}</p>
                  <p className={nameClass}>{copy.intro}</p>
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
              <SalonTimeNote timeZone={salonTimeZone} className="justify-center text-[11px]" />
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
              {answeredBy === 'team' && messages.length > 0 && <p role="status" className="mx-auto max-w-xs text-center text-xs text-slate-700 bg-white/80 rounded-lg px-3 py-2">{copy.teamAnswers}</p>}
              {notice && <p role="status" className="rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-700">{notice}</p>}
              {limitNotice}
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
