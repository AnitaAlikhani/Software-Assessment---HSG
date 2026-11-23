import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CalendarPlus,
  CheckCircle2,
  KeyRound,
  Languages,
  Loader2,
  RotateCw,
  Send,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AiAssistantSettings,
  AppointmentAction,
  CalendarEvent,
  ChatMessage,
  Conversation,
  ConversationStatus,
} from '../types';
import { conversationTimeLabel, LANGUAGE_NAMES } from '../conversationData';
import { confirmedButMissing, conversationForSelection, conversationsInFilter, messageForOwner, ownerLanguageName, shownStatus, type ConversationFilter } from '../conversationPresentation';
import { useDemoState } from '../useDemoState';
import { liveActionFor, type LiveActionState, type LiveChannels, type LiveInbox } from '../liveWhatsApp';
import { researchMode } from '../flags';
import { ChannelBadge, channelLabel } from '../components/ChannelBadge';
import { formatDate, formatPhone } from '../format';
import { LiveTestStrip } from './LiveTestStrip';
import { ChatAppointment, ChatMissingAppointment, ChatWaitingCards, chatAwaitsAnswer, type AnswerChat } from '../components/ChatBookingCards';
import type { AvailabilityContext } from '../availability';
import {
  aiStatusLabel,
  chatBackTarget,
  customerWaits,
  messagesWaitingForOwner,
  NO_ACCESS_TEXT,
  NO_ACCESS_TITLE,
  openChatState,
} from './chatScreen';

interface ConversationsViewProps {
  conversations: Conversation[];
  selectedId: string | null;
  mobileDetailOpen: boolean;
  /**
   * Leaves the open chat for the list. `viaHistory`: the chat was opened from the list, so one step
   * back in the browser's history leads there (see chatBackTarget).
   */
  onBackToList: (viaHistory?: boolean) => void;
  onSelect: (id: string) => void;
  onTakeOver: (id: string) => void;
  /** `answerNow`: a live chat in which the customer waits; the AI answers the waiting message at once. */
  onLetAiContinue: (id: string, answerNow?: boolean) => string | null;
  onOwnerReply: (
    id: string,
    english: string,
    local?: string,
    appointmentAction?: AppointmentAction
  ) => boolean;
  aiSettings: AiAssistantSettings;
  onOpenAiSettings: () => void;
  /** Study tool: with the research switch on, a strip shows how testers can write to the AI. */
  liveChannels?: LiveChannels | null;
  /** The connection to the live chats and the owner's answers on their way. */
  liveInbox?: LiveInbox | null;
  /** The salon as the slot rules see it: the booking cards check a chat's request against it. */
  salon?: AvailabilityContext;
  /** Answers a booking request, a change or a cancellation that waits in a chat (src/App.tsx, handleChatBooking). */
  onChatBooking?: AnswerChat;
  /** Opens the appointment form for the customer of a chat. */
  onBookForCustomer?: (conversationId: string) => void;
  /** Opens an appointment in the calendar: the way from a chat to what was booked in it. */
  onOpenAppointment?: (appointment: CalendarEvent) => void;
  /** Books a chat's confirmed time again after its appointment left the calendar; resolves to why it could not, or null. */
  onAddConfirmedToCalendar?: (conversationId: string) => string | null;
  /** The salon's time zone: the times in the list are salon times. */
  timeZone?: string;
  /** Tests pass a fixed time. */
  now?: Date;
}

// The language a customer writes in is a fact about the chat, not a state of it: every language
// wears the same quiet chip, so none of them reads like one of the status tags below (as on Home).
const LANG_CHIP = 'bg-slate-100 text-slate-700';

const STATUS_TAG: Record<ConversationStatus, { label: string; classes: string }> = {
  // The name Home's inbox carries, so the owner meets one word for one state.
  'needs-attention': { label: 'Waiting for you', classes: 'bg-amber-100 text-amber-800' },
  booked: { label: 'Booked', classes: 'bg-indigo-100 text-[#5551FF]' },
  'ai-handled': { label: 'AI handled', classes: 'bg-emerald-100 text-emerald-700' },
  'owner-handled': { label: 'You handled', classes: 'bg-slate-200 text-slate-700' },
};

/** What a failed answer was, for the line that offers to try again. */
const ACTION_NAMES: Record<LiveActionState['type'], string> = {
  reply: 'Your reply',
  'take-over': 'Taking over',
  'let-ai-continue': 'Handing back to the AI',
  'mark-done': 'Marking as done',
  'confirm-booking': 'Confirming the booking',
  'suggest-time': 'Suggesting another time',
  'decline-booking': 'Declining the booking',
  'cancel-booking': 'Cancelling the appointment',
  'keep-booking': 'Keeping the appointment',
};

const PHONE_QUERY = '(max-width: 767px)';

/** True below 768 px, where an open chat is a screen of its own. False without a browser (tests). */
function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const list = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, []);
  return phone;
}

/**
 * The part of the screen that is really visible. On a phone the on-screen keyboard covers the
 * bottom of the page without making the page shorter; the chat screen takes this size instead, so
 * its reply box rests just above the keyboard's edge.
 */
function useVisibleViewport(active: boolean): { height: number; top: number } | null {
  const [box, setBox] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) { setBox(null); return; }
    const update = () => setBox({ height: Math.round(viewport.height), top: Math.round(viewport.offsetTop) });
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, [active]);
  return box;
}

/** Live chats can be in any language; show the language the AI detected. */
const languageChip = (c: Conversation) => (c.live && c.languageLabel ? c.languageLabel : c.language);

/**
 * Study tool: marks a real chat from a tester, so a moderator can tell it from the sample chats.
 * Normal visitors see the channel mark on the avatar only.
 */
const LiveChip = () => (
  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700">
    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
    Live
  </span>
);

/**
 * Under the name: the customer's number or handle where the salon has one, then the channel.
 * A new website or Telegram chat has neither: then the channel stands alone, without a separator,
 * and a stand-in label is never shown as a phone number. A number is written like every number;
 * a masked one (WhatsApp) and a handle stay as they came.
 */
const contactLine = (c: Conversation) =>
  [/\d/.test(c.phone) || c.phone.startsWith('@') ? formatPhone(c.phone) : '', channelLabel(c.channel)].filter(Boolean).join(' · ');

const BACK_BUTTON = 'md:hidden -ml-1.5 flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#5551FF]';
const PRIMARY = 'min-h-11 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] transition-colors disabled:opacity-60 disabled:cursor-wait';
const SECONDARY = 'min-h-11 px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition-colors disabled:opacity-60 disabled:cursor-wait';

/** "Sending…" with a turning wheel, in place of a button's label while its request runs. */
const Sending = () => (
  <span className="inline-flex items-center gap-1.5">
    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    Sending…
  </span>
);

/** A failed answer to a live chat: what failed and why, with a way to try again. */
const ActionFailed: React.FC<{ item: LiveActionState; onRetry: () => void; onDismiss: () => void }> = ({ item, onRetry, onDismiss }) => (
  <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 py-1 pl-3 pr-1 text-xs text-rose-800">
    <p className="min-w-0 flex-1 py-1.5 [overflow-wrap:anywhere]">
      <span className="font-semibold">Failed.</span> {ACTION_NAMES[item.type]} did not go through{item.error ? `: ${item.error}` : '.'}
    </p>
    <button type="button" onClick={onRetry} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2.5 font-semibold text-rose-800 hover:bg-rose-100">
      <RotateCw className="size-3.5" aria-hidden="true" />
      Try again
    </button>
    <button type="button" onClick={onDismiss} aria-label="Close this message" className="flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-rose-100">
      <X className="size-4" aria-hidden="true" />
    </button>
  </div>
);

export const ConversationsView: React.FC<ConversationsViewProps> = ({
  conversations,
  selectedId,
  mobileDetailOpen,
  onBackToList,
  onSelect,
  onTakeOver,
  onLetAiContinue,
  onOwnerReply,
  aiSettings,
  onOpenAiSettings,
  liveChannels,
  liveInbox,
  salon,
  onChatBooking,
  onBookForCustomer,
  onOpenAppointment,
  onAddConfirmedToCalendar,
  timeZone,
  now = new Date(),
}) => {
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [drafts, setDrafts] = useDemoState<Record<string, string>>('conversationDrafts', {});
  const threadRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wasDetailOpen = useRef(mobileDetailOpen);
  // The chat the owner opened from this list: its back button goes back one step in the history.
  const openedFromList = useRef<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState('');
  // "Hand back to AI" in a live chat whose customer waits asks what should happen with the waiting message.
  const [handBackChoice, setHandBackChoice] = useState<string | null>(null);
  const reviewDialogRef = useRef<HTMLDialogElement>(null);
  const reviewConversation = conversations.find(c => c.id === reviewId);
  const reviewPresentation = reviewConversation?.aiFollowUp
    ? messageForOwner(reviewConversation.aiFollowUp, reviewConversation.language, aiSettings)
    : null;
  const research = researchMode();
  const phone = usePhone();
  const connection = liveInbox?.connection ?? 'off';
  const actions = liveInbox?.actions ?? [];

  useEffect(() => {
    const dialog = reviewDialogRef.current;
    if (!reviewId || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      else {
        const heading = document.querySelector<HTMLElement>('#main-content h1');
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      }
    };
  }, [reviewId]);

  const needsCount = conversationsInFilter(conversations, 'needs').length;
  // "Booked" counts a chat only while its appointment is in this calendar.
  const visible = conversationsInFilter(conversations, filter, salon?.events);

  const selected = conversationForSelection(conversations, selectedId);
  const chatState = openChatState(selectedId, Boolean(selected), connection);
  const selectedMessageCount = selected?.messages.length ?? 0;
  const awaitsAnswer = selected ? chatAwaitsAnswer(selected) : false;
  const missing = selected && salon ? confirmedButMissing(selected, salon.events, salon.now ?? now, timeZone) : null;
  const pendingReplies = selected ? actions.filter(item => item.type === 'reply' && item.conversationId === selected.id) : [];

  // On a phone an open chat is a screen of its own over the page: the page behind it stays where it is.
  const chatScreenOnPhone = phone && mobileDetailOpen;
  const viewport = useVisibleViewport(chatScreenOnPhone);
  useEffect(() => {
    if (!chatScreenOnPhone) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => { root.style.overflow = previous; };
  }, [chatScreenOnPhone]);

  // Phones show the chat as its own screen: move focus to its heading; going back returns focus
  // to the conversation that was open.
  useEffect(() => {
    const wasOpen = wasDetailOpen.current;
    wasDetailOpen.current = mobileDetailOpen;
    if (!window.matchMedia(PHONE_QUERY).matches) return;
    if (mobileDetailOpen && threadRef.current) {
      const heading = threadRef.current.querySelector<HTMLElement>('h2');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    } else if (!mobileDetailOpen && wasOpen && listRef.current) {
      const row = listRef.current.querySelector<HTMLElement>('[aria-current="true"]') ?? listRef.current.querySelector<HTMLElement>('button');
      row?.focus({ preventScroll: true });
    }
  }, [mobileDetailOpen, selectedId]);

  // A Back gesture changes the conversation underneath an open approval: close it.
  useEffect(() => { setReviewId(null); setHandBackChoice(null); }, [selectedId, mobileDetailOpen]);

  // The message pane scrolls by itself: keep the newest message in view when the chat opens, when
  // a message arrives (also the AI's answer after "Let AI continue"), when the banner above it
  // changes size (take over / hand back) and when the pane itself resizes (the phone's keyboard).
  useEffect(() => {
    const pane = messagesRef.current;
    if (!pane) return;
    const toBottom = () => {
      pane.scrollTop = pane.scrollHeight;
      // A request that waits stands below the messages. Where it is taller than the pane (a small
      // phone), it starts at its first line, what the customer asks for, not at its buttons.
      const waiting = pane.querySelector<HTMLElement>('[data-chat-waiting]');
      if (waiting && waiting.offsetHeight > pane.clientHeight) pane.scrollTop += waiting.getBoundingClientRect().top - pane.getBoundingClientRect().top - 8;
    };
    toBottom();
    const observer = new ResizeObserver(toBottom);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [selectedId, selectedMessageCount, selected?.takenOver, selected?.status, awaitsAnswer, pendingReplies.length, mobileDetailOpen]);
  const draft = selected ? drafts[selected.id] ?? '' : '';
  const ownerLanguage = ownerLanguageName(aiSettings);

  // The filters carry the words of the status tags in the list below.
  const tabs: { key: ConversationFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'needs', label: STATUS_TAG['needs-attention'].label },
    { key: 'booked', label: STATUS_TAG.booked.label },
  ];

  const isTranslated = (c: Conversation) =>
    aiSettings.translateChats &&
    (c.live && c.languageLabel
      ? c.languageLabel !== ownerLanguage
      : c.language !== (ownerLanguage === 'German' ? 'DE' : 'EN'));

  const back = () => onBackToList(chatBackTarget(openedFromList.current !== null && openedFromList.current === selectedId) === 'history');

  const open = (id: string) => {
    openedFromList.current = id;
    onSelect(id);
  };

  const continueWithAi = () => {
    if (!selected) return;
    if (aiSettings.askBeforeSending && selected.aiFollowUp) {
      setReviewError('');
      setReviewId(selected.id);
    } else {
      // In a live chat whose customer waits, the AI answers that message at once: that answer is
      // what the owner hands the chat back for, and the view scrolls to it when it arrives.
      onLetAiContinue(selected.id, selected.live && customerWaits(selected) ? true : undefined);
    }
  };

  const handBack = () => {
    if (!selected) return;
    // A live chat in which the customer waits: answer now, or leave it (the owner has dealt with it elsewhere).
    if (selected.live && customerWaits(selected)) setHandBackChoice(selected.id);
    else continueWithAi();
  };

  const locked = selected
    ? selected.status === 'needs-attention' && !selected.takenOver
    : true;
  // Where only a booking request or a cancellation waits, the AI has nothing to go on with: it has
  // passed the request on, and the answer is the owner's (on the card). It can continue where it
  // has an answer ready, or where the customer of a live chat waits for one.
  const aiCanContinue = selected
    ? !awaitsAnswer || Boolean(selected.aiFollowUp) || (selected.live === true && customerWaits(selected))
    : false;

  // "Take over" stands where the reply box will be: once the chat is the owner's, the box has the focus.
  const replyRef = useRef<HTMLInputElement>(null);
  const replyAfterTakeOver = useRef<string | null>(null);
  const takeOverToReply = () => {
    if (!selected) return;
    replyAfterTakeOver.current = selected.id;
    onTakeOver(selected.id);
  };
  useEffect(() => {
    if (locked || replyAfterTakeOver.current === null) return;
    if (replyAfterTakeOver.current === selected?.id) replyRef.current?.focus({ preventScroll: true });
    replyAfterTakeOver.current = null;
  }, [locked, selected?.id]);

  // An answer that takes the card away (Decline, a suggestion in a live chat) takes the focused
  // button with it: the chat's heading gets the focus, so the keyboard and a screen reader stay in
  // the chat. Where something else took it already (after Confirm the appointment line), it stays.
  const awaitedIn = useRef<{ id: string; awaits: boolean } | null>(null);
  useEffect(() => {
    const last = awaitedIn.current;
    awaitedIn.current = selected ? { id: selected.id, awaits: awaitsAnswer } : null;
    if (!last || !selected || last.id !== selected.id || !last.awaits || awaitsAnswer) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const heading = threadRef.current?.querySelector<HTMLElement>('h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [selected?.id, awaitsAnswer]);

  const send = (english: string, local?: string, appointmentAction?: AppointmentAction): boolean => {
    if (!selected || !english.trim()) return false;
    const conversationId = selected.id;
    if (onOwnerReply(conversationId, english.trim(), local, appointmentAction)) {
      setDrafts((previous) => ({ ...previous, [conversationId]: '' }));
      return true;
    }
    return false;
  };

  // Suggestions are hidden after sending, but fast repeated taps land before that re-render
  // and each one sent a reply again. Only one suggestion per chat may be sent (the owner
  // picks one of the options), so remember the chat and ignore further taps.
  const sentQuickReplies = useRef(new Set<string>());
  const sendQuickReply = (conversationId: string, q: { en: string; local: string; appointmentAction?: AppointmentAction }) => {
    const key = conversationId;
    if (sentQuickReplies.current.has(key)) return;
    sentQuickReplies.current.add(key);
    // A rejected booking keeps the suggestion, so allow another try.
    if (!send(q.en, q.local, q.appointmentAction)) sentQuickReplies.current.delete(key);
  };

  const renderBubble = (c: Conversation, m: ChatMessage, flagged: boolean) => {
    const mine = m.sender !== 'customer';
    const presentation = messageForOwner(m, c.language, aiSettings);
    const bubbleColor =
      m.sender === 'customer'
        ? 'bg-slate-100 text-slate-800'
        : m.sender === 'ai'
        ? 'bg-[#5551FF] text-white'
        : 'bg-slate-800 text-white';
    const subColor = mine ? 'text-white/70' : 'text-slate-500';

    return (
      <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <div className="max-w-[88%] sm:max-w-[78%] min-w-0 relative [overflow-wrap:anywhere]">
          {mine && (
            <span
              className={`absolute -top-2 right-3 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white border ${
                m.sender === 'ai'
                  ? 'text-[#5551FF] border-[#5551FF]/40'
                  : 'text-slate-700 border-slate-300'
              }`}
            >
              {m.sender === 'ai' ? 'AI' : 'You'}
            </span>
          )}
          <div
            className={`rounded-2xl px-3.5 py-2 sm:px-4 sm:py-2.5 ${bubbleColor} ${
              flagged ? 'ring-2 ring-amber-400' : ''
            }`}
          >
            {presentation.showOriginal ? (
              <>
                <p className={`text-[11px] leading-snug ${subColor}`}>{m.original}</p>
                <div
                  className={`my-1.5 h-px ${mine ? 'bg-white/30' : 'bg-slate-300/80'}`}
                />
                <p className="text-sm font-medium leading-snug">{presentation.text}</p>
              </>
            ) : (
              <p className="text-sm font-medium leading-snug">
                {presentation.text}
              </p>
            )}
            {m.untranslated && (
              <p className={`text-[10px] mt-1 italic ${subColor}`}>
                Not translated
              </p>
            )}
            {!m.untranslated && presentation.translationUnavailable && <p className={`text-[10px] mt-1 italic ${subColor}`}>{ownerLanguage} translation unavailable. Original message shown.</p>}
            <p className={`text-[10px] mt-1 text-right ${subColor}`}>{m.time}</p>
          </div>
        </div>
      </div>
    );
  };

  /** A reply to a live chat that the server has not confirmed yet, or that failed. */
  const renderPendingReply = (item: LiveActionState) => (
    <div key={item.key} className="flex flex-col items-end gap-1.5">
      <div className={`max-w-[88%] sm:max-w-[78%] min-w-0 rounded-2xl px-3.5 py-2 sm:px-4 sm:py-2.5 [overflow-wrap:anywhere] ${item.state === 'failed' ? 'bg-white text-slate-800 border border-rose-300' : 'bg-slate-800/80 text-white'}`}>
        <p className="text-sm font-medium leading-snug">{item.text}</p>
        <p className={`text-[10px] mt-1 text-right ${item.state === 'failed' ? 'text-rose-700 font-semibold' : 'text-white/70'}`}>
          {item.state === 'failed' ? 'Not sent' : <Sending />}
        </p>
      </div>
      {item.state === 'failed' && liveInbox && (
        <div className="w-full max-w-[88%] sm:max-w-[78%]">
          <ActionFailed item={item} onRetry={() => liveInbox.retry(item.key)} onDismiss={() => liveInbox.dismiss(item.key)} />
        </div>
      )}
    </div>
  );

  /** The label of a button whose request may be on its way: "Sending…" while it runs. */
  const actionLabel = (conversationId: string, type: LiveActionState['type'], label: string) =>
    liveActionFor(actions, conversationId, type)?.state === 'sending' ? <Sending /> : label;
  const busy = (conversationId: string, ...types: LiveActionState['type'][]) =>
    types.some(type => liveActionFor(actions, conversationId, type)?.state === 'sending');

  /** Where the connection to the live chats is not as it should be, the list says so above its rows. */
  const connectionNotice = () => {
    if (connection === 'denied') {
      return (
        <div role="alert" className="m-3 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
          <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p><span className="block text-sm font-semibold">{NO_ACCESS_TITLE}</span>{NO_ACCESS_TEXT}</p>
        </div>
      );
    }
    if (connection === 'reconnecting') {
      return (
        <p role="status" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">
          <WifiOff className="size-4 shrink-0" aria-hidden="true" />
          <span><span className="font-semibold">Reconnecting…</span> Live chats may not be up to date.</span>
        </p>
      );
    }
    if (connection === 'loading') {
      return (
        <p role="status" className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-xs font-medium text-slate-500">
          <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading live chats…
        </p>
      );
    }
    return null;
  };

  // The open chat: on a phone a screen of its own over the page, at the size of the part of the
  // screen that is visible (above the keyboard); on wider screens the right part of the workspace.
  const threadClass = `md:col-span-7 xl:col-span-8 min-w-0 min-h-0 flex-col bg-white ${
    mobileDetailOpen ? 'flex max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:z-[35] max-md:h-dvh' : 'hidden md:flex'
  }`;
  const threadStyle = chatScreenOnPhone && viewport ? { height: viewport.height, top: viewport.top } : undefined;

  /** The bar of a chat that cannot be shown (loading, no access, gone): the way back and what happens. */
  const placeholderThread = (state: Exclude<typeof chatState, 'open'>) => (
    <div id="conversation-thread" ref={threadRef} className={threadClass} style={threadStyle}>
      <div className="flex min-h-16 items-center gap-2 border-b border-slate-100 px-3 md:hidden">
        <button type="button" onClick={back} aria-label="All conversations" className={BACK_BUTTON}>
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        <h2 className="text-base font-bold text-slate-900">{state === 'loading' ? 'Loading chat' : 'Chat'}</h2>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-sm text-slate-600" role="status">
        {state === 'loading' && (
          <>
            <Loader2 className="size-6 animate-spin text-[#5551FF] motion-reduce:animate-none" aria-hidden="true" />
            <p>{connection === 'reconnecting' ? 'Reconnecting…' : 'Loading this chat…'}</p>
          </>
        )}
        {state === 'no-access' && (
          <>
            <KeyRound className="size-6 text-rose-600" aria-hidden="true" />
            <p className="max-w-sm"><span className="block font-semibold text-slate-900">{NO_ACCESS_TITLE}</span>{NO_ACCESS_TEXT}</p>
          </>
        )}
        {state === 'gone' && <p>This conversation is no longer available.</p>}
        {state === 'none' && <p>No conversations yet.</p>}
        {(state === 'gone' || state === 'no-access') && <button type="button" onClick={back} className="min-h-11 rounded-xl px-4 py-2 font-semibold text-[#5551FF] bg-indigo-50">View all conversations</button>}
      </div>
    </div>
  );

  const failedHere = selected
    ? actions.filter(item => item.conversationId === selected.id && item.type !== 'reply' && item.state === 'failed')
    : [];

  return (
    <div className="max-w-7xl mx-auto md:flex md:flex-col md:gap-4 md:p-6 lg:p-8 md:h-[calc(100dvh-7.5rem-env(safe-area-inset-bottom))] md:-mb-28 lg:h-[calc(100dvh-4.5625rem)] lg:-mb-16">
      {/* The header names the screen on phones and tablets; the heading is there for screen readers and focus. */}
      <h1 className="sr-only lg:not-sr-only text-2xl font-bold text-slate-900 tracking-tight">
        Conversations
      </h1>

      {research && liveChannels && (
        <div className="px-4 pt-4 md:p-0">
          <LiveTestStrip
            channels={liveChannels}
            liveCount={conversations.filter(c => c.live).length}
            waitingCount={conversations.filter(c => c.live && c.status === 'needs-attention').length}
          />
        </div>
      )}

      <div className="bg-white md:rounded-2xl md:border md:border-slate-200/80 md:shadow-xs md:overflow-hidden md:grid md:grid-cols-12 md:flex-1 md:min-h-0">
        {/* Chat list */}
        <div className={`md:col-span-5 xl:col-span-4 min-w-0 min-h-0 md:border-r border-slate-200/70 flex-col ${mobileDetailOpen ? 'hidden md:flex' : 'flex'}`}>
          {/* One row of filters; on a narrow screen it scrolls sideways by itself, never the page. */}
          <div role="group" aria-label="Filter conversations" className="max-md:sticky max-md:top-14 z-10 flex flex-nowrap items-center gap-x-3 overflow-x-auto overscroll-x-contain bg-white px-4 border-b border-slate-100 [scrollbar-width:none]">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                aria-pressed={filter === t.key}
                className={`min-h-11 min-w-11 shrink-0 px-1 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
                  filter === t.key
                    ? 'border-[#5551FF] text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
                {t.key === 'needs' && needsCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500 text-white tabular-nums">
                    {needsCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {connectionNotice()}

          <div ref={listRef} className="flex-1 min-h-0 md:overflow-y-auto md:overscroll-contain">
            {visible.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-10 px-4">
                No conversations in this view.
              </p>
            )}
            {visible.map((c) => {
              const last = c.messages[c.messages.length - 1];
              const tag = STATUS_TAG[shownStatus(c, salon?.events)];
              const preview = last ? messageForOwner(last, c.language, aiSettings).text : 'No messages yet.';
              const active = selected?.id === c.id;
              const waiting = messagesWaitingForOwner(c);
              return (
                <button
                  key={c.id}
                  onClick={() => open(c.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full text-left px-4 py-2.5 flex items-center gap-3 border-b border-slate-100 transition-colors ${
                    active ? 'md:bg-[#5551FF]/7' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="relative shrink-0">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ${c.avatarColor}`}
                    >
                      {c.initials}
                    </div>
                    <ChannelBadge channel={c.channel} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {c.customerName}
                        </span>
                        <span
                          className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${LANG_CHIP}`}
                        >
                          {languageChip(c)}
                        </span>
                        {research && c.live && <LiveChip />}
                      </div>
                      <span className="text-[11px] text-slate-500 shrink-0">{conversationTimeLabel(c, now, timeZone)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <p className={`min-w-0 flex-1 text-xs truncate ${waiting > 0 ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>{preview}</p>
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${tag.classes}`}>
                        {tag.label}
                      </span>
                      {waiting > 0 && (
                        <span className="shrink-0 min-w-5 rounded-full bg-[#5551FF] px-1.5 py-0.5 text-center text-[10px] font-bold text-white tabular-nums">
                          {waiting}
                          <span className="sr-only">{waiting === 1 ? ' message waits for your reply' : ' messages wait for your reply'}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Open chat */}
        {selected ? (
          <div id="conversation-thread" ref={threadRef} className={threadClass} style={threadStyle}>
            {/* The chat's bar: stays at the top while the messages scroll under it. */}
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2 sm:gap-3 sm:px-5 md:py-3">
              <button type="button" onClick={back} aria-label="All conversations" title="All conversations" className={BACK_BUTTON}>
                <ArrowLeft className="size-5" aria-hidden="true" />
              </button>
              <div className="relative shrink-0">
                <div className={`size-10 rounded-full flex items-center justify-center text-sm font-bold ${selected.avatarColor}`}>
                  {selected.initials}
                </div>
                <ChannelBadge channel={selected.channel} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="min-w-0 truncate text-base font-bold text-slate-900">
                    {selected.customerName}
                  </h2>
                  <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${LANG_CHIP}`}>
                    {languageChip(selected)}
                  </span>
                  {research && selected.live && <LiveChip />}
                </div>
                {/* What the AI is doing in this chat; on wider screens also how the customer wrote. */}
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
                  <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${selected.live && connection === 'reconnecting' ? 'bg-amber-500 animate-pulse motion-reduce:animate-none' : selected.takenOver ? 'bg-slate-400' : selected.status === 'needs-attention' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  <span className="truncate">{selected.live && connection === 'reconnecting' ? 'Reconnecting…' : aiStatusLabel(selected, aiSettings)}</span>
                </p>
                <p className="hidden sm:block truncate text-xs text-slate-400">{contactLine(selected)}</p>
              </div>
              {/* An appointment by hand for the customer of this chat: the form opens with the customer chosen. */}
              {onBookForCustomer && <button
                type="button"
                onClick={() => onBookForCustomer(selected.id)}
                title="Book for this customer"
                aria-label="Book for this customer"
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold whitespace-nowrap text-[#5551FF] hover:bg-indigo-50 border border-slate-200 sm:px-3"
              >
                <CalendarPlus className="size-4 shrink-0" aria-hidden="true" />
                <span aria-hidden="true" className="max-sm:hidden">Book</span>
              </button>}
              <button
                type="button"
                onClick={onOpenAiSettings}
                title="Open AI receptionist settings"
                aria-label="Open AI receptionist settings"
                // The narrowest phones give this room to the customer's name: the settings are one tap away in the menu.
                className="flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700 max-[359px]:hidden"
              >
                <Bot className="size-5" aria-hidden="true" />
              </button>
            </div>

            {selected.live && connection === 'reconnecting' && (
              <p role="status" className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
                <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
                <span><span className="font-semibold">Reconnecting…</span> New messages may be missing.</span>
              </p>
            )}

            <div className="shrink-0 space-y-2 px-3 sm:px-5 empty:hidden [&>*:first-child]:mt-3">
              {/* The appointment that came of this chat, with the way to it in the calendar. */}
              {salon && (missing
                // A confirmation the calendar no longer holds: said in the place of the appointment line.
                ? <ChatMissingAppointment key={selected.id} customerName={selected.customerName} booking={missing} onAdd={onAddConfirmedToCalendar && (() => onAddConfirmedToCalendar(selected.id))} />
                : <ChatAppointment conversation={selected} events={salon.events} onOpenAppointment={onOpenAppointment} />)}

              {selected.takenOver && (
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2 sm:px-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="size-5 shrink-0 text-[#5551FF] max-[359px]:hidden" aria-hidden="true" />
                    {/* The one place that says the take-over worked: read out when it appears. */}
                    <div role="status" className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">You've taken over</p>
                      <p className="text-xs leading-snug text-slate-600">
                        {selected.live
                          ? 'The AI is paused for this chat. Type in your language; the customer gets it in theirs.'
                          : 'The AI is paused for this chat.'}
                      </p>
                    </div>
                    {handBackChoice !== selected.id && (
                      <button
                        onClick={handBack}
                        disabled={busy(selected.id, 'let-ai-continue')}
                        aria-busy={busy(selected.id, 'let-ai-continue') || undefined}
                        className={`${SECONDARY} shrink-0 px-3`}
                      >
                        {busy(selected.id, 'let-ai-continue') ? <Sending /> : aiSettings.askBeforeSending && selected.aiFollowUp ? 'Review AI reply' : 'Hand back to AI'}
                      </button>
                    )}
                  </div>
                  {handBackChoice === selected.id && (
                    <div role="group" aria-label="The customer is waiting for an answer" className="mt-2 flex flex-wrap items-center gap-2 border-t border-indigo-200/70 pt-2">
                      <p className="basis-full text-xs text-slate-600">The customer is waiting for an answer.</p>
                      <button type="button" onClick={() => { setHandBackChoice(null); onLetAiContinue(selected.id, true); }} className={PRIMARY}>AI answers now</button>
                      {/* The owner has dealt with it elsewhere: the AI takes the chat back and sends nothing. */}
                      <button type="button" onClick={() => { setHandBackChoice(null); onLetAiContinue(selected.id, false); }} className={SECONDARY}>Hand back, no answer</button>
                      <button type="button" onClick={() => setHandBackChoice(null)} className="min-h-11 rounded-xl px-3 text-xs font-semibold text-slate-600 hover:bg-indigo-100">Cancel</button>
                    </div>
                  )}
                </div>
              )}

              {liveInbox && failedHere.map(item => (
                <ActionFailed key={item.key} item={item} onRetry={() => liveInbox.retry(item.key)} onDismiss={() => liveInbox.dismiss(item.key)} />
              ))}
            </div>

            {/* Messages */}
            <div ref={messagesRef} className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain px-3 sm:px-5 py-4 space-y-4">
              {/* Translation chip */}
              {isTranslated(selected) && (
                <div className="flex justify-center">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                    <Languages className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    {`Translated from ${(selected.live && selected.languageLabel) || LANGUAGE_NAMES[selected.language]}`}
                  </span>
                </div>
              )}
              {!aiSettings.translateChats && selected.language !== 'EN' && (
                <div className="flex justify-center">
                  <button
                    onClick={onOpenAiSettings}
                    className="min-h-11 text-xs font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded-xl transition-colors"
                  >
                    Translation is off. Turn it on in AI receptionist settings
                  </button>
                </div>
              )}
              {selected.messages.map((m, i) =>
                renderBubble(
                  selected,
                  m,
                  selected.status === 'needs-attention' &&
                    !selected.takenOver &&
                    m.sender === 'customer' &&
                    i === selected.messages.length - 1
                )
              )}
              {pendingReplies.map(renderPendingReply)}
              {/* Why this chat waits for the owner. It stands at the end of the messages, above the two
                  ways on that take the place of the reply box: take over, or let the AI continue. */}
              {locked && (
                <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300/70 bg-amber-50 px-3 py-2.5 sm:px-4">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">Waiting for you</p>
                    {selected.attentionReason && <p className="text-xs leading-snug text-slate-600 [overflow-wrap:anywhere]">{selected.attentionReason}</p>}
                  </div>
                </div>
              )}
              {/* BOOKING CARDS */}
              {/* What waits for the owner's answer: a booking request or a change (confirm, suggest
                  another time, decline) and a wish to cancel. It stands where she reads and replies,
                  and scrolls with the messages, so the reply box stays on screen. The cards and
                  their rules live in src/components/ChatBookingCards.tsx. */}
              {/* Keyed by the chat and by its opening on a phone: times that were open in one chat are not open in the next. */}
              {salon && <ChatWaitingCards key={`${selected.id}:${mobileDetailOpen}`} conversation={selected} salon={salon} onAnswer={onChatBooking} />}
            </div>

            {/* Composer: at the bottom of the chat, above the phone's keyboard and its home bar. */}
            <div className="shrink-0 bg-white px-3 sm:px-5 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-100 space-y-2.5">
              {!locked && selected.quickReplies && selected.quickReplies.length > 0 && (
                <div className="flex gap-2 max-md:-mx-3 max-md:overflow-x-auto max-md:px-3 max-md:[scrollbar-width:none] md:flex-wrap">
                  {selected.quickReplies.map((q) => (
                    <button
                      key={q.en}
                      onClick={() => sendQuickReply(selected.id, q)}
                      className="min-h-11 max-md:max-w-[80%] max-md:shrink-0 text-left text-xs [overflow-wrap:anywhere] font-medium text-[#5551FF] bg-[#5551FF]/8 hover:bg-[#5551FF]/15 border border-[#5551FF]/20 rounded-xl px-3 py-1.5 transition-colors"
                    >
                      {messageForOwner({ original: q.local, translation: q.en }, selected.language, { ...aiSettings, translateChats: true }).text}
                    </button>
                  ))}
                </div>
              )}
              {locked ? (
                // The chat waits for a decision: the owner writes herself, or the AI goes on. A
                // booking request above is answered on its card either way.
                // The buttons come first and the hint after them: a message at the bottom right of
                // the screen then lies over the hint, never over a button.
                <div role="group" aria-label="Who answers this chat" className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                  {/* Beside a request card the card's own answers lead; taking over is the second way. */}
                  <button
                    onClick={takeOverToReply}
                    disabled={busy(selected.id, 'take-over', 'let-ai-continue')}
                    aria-busy={busy(selected.id, 'take-over') || undefined}
                    className={`${awaitsAnswer ? SECONDARY : PRIMARY} ${aiCanContinue ? '' : 'max-sm:col-span-2'}`}
                  >
                    {actionLabel(selected.id, 'take-over', 'Take over')}
                  </button>
                  {aiCanContinue && (
                    <button
                      onClick={continueWithAi}
                      disabled={busy(selected.id, 'take-over', 'let-ai-continue')}
                      aria-busy={busy(selected.id, 'let-ai-continue') || undefined}
                      className={SECONDARY}
                    >
                      {actionLabel(selected.id, 'let-ai-continue', aiSettings.askBeforeSending && selected.aiFollowUp ? 'Review AI reply' : 'Let AI continue')}
                    </button>
                  )}
                  <p className="hidden min-w-0 flex-1 text-xs text-slate-500 sm:block">Take over to write to {selected.customerName} yourself.</p>
                </div>
              ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(draft);
                }}
                className="flex items-center gap-2 sm:gap-3"
              >
                <input
                  ref={replyRef}
                  aria-label="Reply as owner"
                  value={draft}
                  onChange={(e) => {
                    const conversationId = selected.id;
                    const value = e.target.value;
                    setDrafts((previous) => ({ ...previous, [conversationId]: value }));
                  }}
                  enterKeyHint="send"
                  placeholder="Write a reply…"
                  className="min-w-0 flex-1 min-h-11 px-4 py-2.5 text-base md:text-sm bg-slate-100 rounded-full border border-transparent focus:bg-white focus:border-[#5551FF]/40 focus:outline-hidden focus:ring-2 focus:ring-[#5551FF]/15 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="w-11 h-11 shrink-0 rounded-full bg-[#5551FF] text-white flex items-center justify-center hover:bg-[#433fd8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Send reply"
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                </button>
              </form>
              )}
              {!locked && selected.live && (
                <p className="text-[10px] leading-tight text-slate-500">
                  Your reply is translated into the customer’s language and sent {selected.channel === 'Website' ? 'to the website chat' : `on ${selected.channel}`}.
                </p>
              )}
            </div>
          </div>
        ) : placeholderThread(chatState === 'open' ? 'gone' : chatState)}
      </div>

      {reviewConversation?.aiFollowUp && (
        <dialog
          ref={reviewDialogRef}
          aria-labelledby="ai-reply-review-title"
          onCancel={event => { event.preventDefault(); setReviewId(null); }}
          className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl backdrop:bg-slate-900/50"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="ai-reply-review-title" className="text-lg font-bold text-slate-900">Review AI reply</h2>
            <button autoFocus type="button" aria-label="Close AI reply review" onClick={() => setReviewId(null)} className="flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-slate-100"><X className="size-5" /></button>
          </div>
          <p className="mt-2 text-sm text-slate-600">{`The AI wants to reply to ${reviewConversation.customerName} with this message.`}</p>
          <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4 text-sm [overflow-wrap:anywhere]">
            <div><p className="mb-1 text-xs font-semibold text-slate-500">{`Reply in ${LANGUAGE_NAMES[reviewConversation.language]}`}</p><p>{reviewConversation.aiFollowUp.original}</p></div>
            {reviewPresentation?.showOriginal && <div><p className="mb-1 text-xs font-semibold text-slate-500">{ownerLanguage} translation</p><p>{reviewPresentation.text}</p></div>}
            {reviewPresentation?.translationUnavailable && <p className="text-xs text-slate-500">{ownerLanguage} translation unavailable. Original reply shown.</p>}
            {reviewConversation.aiFollowUp.appointmentAction && <p className="border-t border-slate-200 pt-3 text-xs text-slate-600">Appointment {reviewConversation.aiFollowUp.appointmentAction.type === 'book' ? 'booking' : 'change'}: {formatDate(reviewConversation.aiFollowUp.appointmentAction.date)} at {reviewConversation.aiFollowUp.appointmentAction.startTime}. Availability is checked before approval.</p>}
          </div>
          {!aiSettings.answerLanguages[reviewConversation.language] && <p className="mt-4 text-sm text-amber-700">Enable {LANGUAGE_NAMES[reviewConversation.language]} replies in AI receptionist settings before approving.</p>}
          {reviewError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{reviewError}</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <button type="button" onClick={() => setReviewId(null)} className="min-h-11 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
            <button
              type="button"
              disabled={!aiSettings.answerLanguages[reviewConversation.language]}
              onClick={() => {
                const error = onLetAiContinue(reviewConversation.id);
                if (error === null) setReviewId(null);
                else setReviewError(error);
              }}
              className="min-h-11 rounded-xl bg-[#5551FF] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >Approve reply</button>
          </div>
        </dialog>
      )}
    </div>
  );
};
