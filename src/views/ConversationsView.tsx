import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Languages,
  Send,
  X,
} from 'lucide-react';
import {
  AiAssistantSettings,
  AppointmentAction,
  ChatMessage,
  Conversation,
  ConversationStatus,
} from '../types';
import { LANGUAGE_NAMES } from '../conversationData';
import { conversationForSelection, messageForOwner, ownerLanguageName } from '../conversationPresentation';
import { useDemoState } from '../useDemoState';

interface ConversationsViewProps {
  conversations: Conversation[];
  selectedId: string | null;
  mobileDetailOpen: boolean;
  onBackToList: () => void;
  onSelect: (id: string) => void;
  onTakeOver: (id: string) => void;
  onLetAiContinue: (id: string) => string | null;
  onOwnerReply: (
    id: string,
    english: string,
    local?: string,
    appointmentAction?: AppointmentAction
  ) => boolean;
  aiSettings: AiAssistantSettings;
  onOpenAiSettings: () => void;
}

type Filter = 'all' | 'needs' | 'languages' | 'ai';

const LANG_CHIP: Record<string, string> = {
  FR: 'bg-violet-100 text-violet-700',
  DE: 'bg-emerald-100 text-emerald-700',
  IT: 'bg-rose-100 text-rose-700',
  EN: 'bg-amber-100 text-amber-700',
};

const STATUS_TAG: Record<ConversationStatus, { label: string; classes: string }> = {
  'needs-attention': { label: 'Needs you', classes: 'bg-amber-100 text-amber-700' },
  booked: { label: 'Booked', classes: 'bg-indigo-100 text-[#5551FF]' },
  'ai-handled': { label: 'AI handled', classes: 'bg-emerald-100 text-emerald-700' },
  'owner-handled': { label: 'You handled', classes: 'bg-slate-200 text-slate-700' },
};

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
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [drafts, setDrafts] = useDemoState<Record<string, string>>('conversationDrafts', {});
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const whatsAppDialogRef = useRef<HTMLDialogElement>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState('');
  const reviewDialogRef = useRef<HTMLDialogElement>(null);
  const reviewConversation = conversations.find(c => c.id === reviewId);
  const reviewPresentation = reviewConversation?.aiFollowUp
    ? messageForOwner(reviewConversation.aiFollowUp, reviewConversation.language, aiSettings)
    : null;

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

  useEffect(() => { setReviewId(null); setShowWhatsApp(false); }, [selectedId]);

  useEffect(() => {
    const dialog = whatsAppDialogRef.current;
    if (!dialog) return;
    if (showWhatsApp && !dialog.open) dialog.showModal();
    if (!showWhatsApp && dialog.open) dialog.close();
  }, [showWhatsApp]);

  useEffect(() => {
    if (!showWhatsApp) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [showWhatsApp]);

  const needsCount = conversations.filter(
    (c) => c.status === 'needs-attention'
  ).length;

  const visible = conversations.filter((c) => {
    if (filter === 'needs') return c.status === 'needs-attention';
    if (filter === 'languages') return c.language !== 'EN';
    if (filter === 'ai') return c.status === 'ai-handled';
    return true;
  });

  const selected = conversationForSelection(conversations, selectedId);
  const unavailableSelection = selectedId !== null && !selected;
  const draft = selected ? drafts[selected.id] ?? '' : '';
  const ownerLanguage = ownerLanguageName(aiSettings);

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'needs', label: 'Needs attention' },
    { key: 'languages', label: 'Languages' },
    { key: 'ai', label: 'AI handled' },
  ];

  const isTranslated = (c: Conversation) =>
    aiSettings.translateChats && c.language !== (ownerLanguage === 'German' ? 'DE' : 'EN');

  const continueWithAi = () => {
    if (!selected) return;
    if (aiSettings.askBeforeSending && selected.aiFollowUp) {
      setReviewError('');
      setReviewId(selected.id);
    } else {
      onLetAiContinue(selected.id);
    }
  };

  const locked = selected
    ? selected.status === 'needs-attention' && !selected.takenOver
    : true;

  const send = (english: string, local?: string, appointmentAction?: AppointmentAction) => {
    if (!selected || !english.trim()) return;
    const conversationId = selected.id;
    if (onOwnerReply(conversationId, english.trim(), local, appointmentAction)) {
      setDrafts((previous) => ({ ...previous, [conversationId]: '' }));
    }
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
        <div className="max-w-[90%] sm:max-w-[78%] min-w-0 relative [overflow-wrap:anywhere]">
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
            className={`rounded-2xl px-4 py-2.5 ${bubbleColor} ${
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
                Sent as written. Automatic translation is unavailable in this demo.
              </p>
            )}
            {!m.untranslated && presentation.translationUnavailable && <p className={`text-[10px] mt-1 italic ${subColor}`}>{ownerLanguage} translation unavailable. Original message shown.</p>}
            <p className={`text-[10px] mt-1 text-right ${subColor}`}>{m.time}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
        Conversations
      </h1>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[600px]">
        {/* Chat list */}
        <div className={`md:col-span-4 min-w-0 border-b md:border-b-0 md:border-r border-slate-200/70 flex-col ${mobileDetailOpen ? 'hidden md:flex' : 'flex'}`}>
          <div className="flex items-center gap-3.5 px-4 pt-4 border-b border-slate-100 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={`min-h-11 pb-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
                  filter === t.key
                    ? 'border-[#5551FF] text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
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

          <div className="flex-1 overflow-y-auto">
            {visible.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-10 px-4">
                No conversations in this view.
              </p>
            )}
            {visible.map((c) => {
              const last = c.messages[c.messages.length - 1];
              const tag = STATUS_TAG[c.status];
              const preview = last ? messageForOwner(last, c.language, aiSettings).text : 'No messages yet.';
              const active = selected?.id === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  className={`w-full text-left px-4 py-3.5 flex gap-3 border-b border-slate-100 transition-colors ${
                    active ? 'bg-[#5551FF]/7' : 'hover:bg-slate-50'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${c.avatarColor}`}
                  >
                    {c.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {c.customerName}
                        </span>
                        <span
                          className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${LANG_CHIP[c.language]}`}
                        >
                          {c.language}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 shrink-0">{c.lastTime}</span>
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{preview}</p>
                    <span
                      className={`inline-block mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${tag.classes}`}
                    >
                      {tag.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Open chat */}
        {selected ? (
          <div className={`md:col-span-8 min-w-0 flex-col min-h-[520px] ${mobileDetailOpen ? 'flex' : 'hidden md:flex'}`}>
            {/* Chat header */}
            <div className="flex flex-col gap-3 px-4 sm:px-6 py-4 border-b border-slate-100">
              <button
                type="button"
                onClick={onBackToList}
                className="md:hidden self-start inline-flex min-h-11 items-center gap-2 rounded-xl px-3 -ml-3 text-sm font-semibold text-[#5551FF] hover:bg-indigo-50"
              >
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                All conversations
              </button>
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${selected.avatarColor}`}
                >
                  {selected.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="min-w-0 text-base font-bold text-slate-900 [overflow-wrap:anywhere]">
                      {selected.customerName}
                    </h2>
                    <span
                      className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${LANG_CHIP[selected.language]}`}
                    >
                      {selected.language}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 [overflow-wrap:anywhere]">
                    {selected.phone} · {selected.channel}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={onOpenAiSettings}
                  title="Change in AI Assistant settings"
                  className="flex min-h-11 min-w-0 items-center gap-1.5 px-3 py-2 rounded-xl text-left text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200/70 transition-colors"
                >
                  <Bot className="w-4 h-4 shrink-0" />
                  {aiSettings.askBeforeSending ? 'Review AI replies before sending' : 'Send demo AI replies without review'}
                </button>
                <button
                  onClick={() => setShowWhatsApp(true)}
                  className="flex min-h-11 items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-2xs transition-colors"
                >
                  <span className={`w-4 h-4 rounded-full inline-block ${selected.channel === 'Instagram' ? 'bg-fuchsia-500' : 'bg-[#25D366]'}`} />
                  Preview {selected.channel}
                </button>
              </div>
            </div>

            {/* Translation chip */}
            {isTranslated(selected) && (
              <div className="flex justify-center px-4 pt-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                  <Languages className="w-3.5 h-3.5 shrink-0" />
                  Demo translations: {LANGUAGE_NAMES[selected.language]} → {ownerLanguage}
                </span>
              </div>
            )}
            {!aiSettings.translateChats && selected.language !== 'EN' && (
              <div className="flex justify-center px-4 pt-3">
                <button
                  onClick={onOpenAiSettings}
                  className="min-h-11 text-xs font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded-xl transition-colors"
                >
                  Translation is off. Turn it on in AI Assistant settings
                </button>
              </div>
            )}

            {/* Attention banner */}
            {selected.status === 'needs-attention' && !selected.takenOver && (
              <div className="mx-4 sm:mx-6 mt-4 flex flex-wrap items-start gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-[8rem]">
                  <p className="text-sm font-semibold text-slate-900">Needs your attention</p>
                  <p className="text-xs text-slate-500">{selected.attentionReason}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => onTakeOver(selected.id)}
                    className="min-h-11 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] transition-colors"
                  >
                    Take over
                  </button>
                  <button
                    onClick={continueWithAi}
                    className="min-h-11 px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition-colors"
                  >
                    {aiSettings.askBeforeSending && selected.aiFollowUp ? 'Review AI reply' : 'Let AI continue'}
                  </button>
                </div>
              </div>
            )}

            {selected.takenOver && (
              <div className="mx-4 sm:mx-6 mt-4 flex flex-wrap items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-[#5551FF] text-white flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-[8rem]">
                  <p className="text-sm font-semibold text-slate-900">You've taken over</p>
                  <p className="text-xs text-slate-500">
                    The AI is paused for this chat. Suggested replies include a translation; typed replies are sent as written.
                  </p>
                </div>
                <button
                  onClick={continueWithAi}
                  className="min-h-11 px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition-colors"
                >
                  {aiSettings.askBeforeSending && selected.aiFollowUp ? 'Review AI reply' : 'Hand back to AI'}
                </button>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
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
            </div>

            {/* Composer */}
            <div className="px-4 sm:px-6 pb-5 pt-3 border-t border-slate-100 space-y-3">
              {!locked && selected.quickReplies && selected.quickReplies.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selected.quickReplies.map((q) => (
                    <button
                      key={q.en}
                      onClick={() => send(q.en, q.local, q.appointmentAction)}
                      className="min-h-11 text-left text-xs [overflow-wrap:anywhere] font-medium text-[#5551FF] bg-[#5551FF]/8 hover:bg-[#5551FF]/15 border border-[#5551FF]/20 rounded-xl px-3 py-1.5 transition-colors"
                    >
                      {messageForOwner({ original: q.local, translation: q.en }, selected.language, { ...aiSettings, translateChats: true }).text}
                    </button>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(draft);
                }}
                className="flex items-center gap-3"
              >
                <input
                  aria-label="Reply as owner"
                  value={draft}
                  onChange={(e) => {
                    const conversationId = selected.id;
                    const value = e.target.value;
                    setDrafts((previous) => ({ ...previous, [conversationId]: value }));
                  }}
                  disabled={locked}
                  placeholder={
                    locked
                      ? 'Take over to reply as the owner'
                      : 'Reply as owner (sent as written)'
                  }
                  className="min-w-0 flex-1 min-h-11 px-4 py-2.5 text-base sm:text-sm bg-slate-100 rounded-full border border-transparent focus:bg-white focus:border-[#5551FF]/40 focus:outline-hidden focus:ring-2 focus:ring-[#5551FF]/15 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  disabled={locked || !draft.trim()}
                  className="w-11 h-11 shrink-0 rounded-full bg-[#5551FF] text-white flex items-center justify-center hover:bg-[#433fd8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Send reply"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
              {!locked && selected.language !== 'EN' && (
                <p className="text-[10px] text-slate-400">
                  Demo: suggested replies come with a ready translation. Free text is sent without
                  a translation in this prototype.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="md:col-span-8 p-6 flex flex-col items-center justify-center gap-4 text-sm text-slate-600" role="status">
            <p>{unavailableSelection ? 'This conversation is no longer available.' : 'No conversations yet.'}</p>
            {unavailableSelection && <button type="button" onClick={onBackToList} className="min-h-11 rounded-xl px-4 py-2 font-semibold text-[#5551FF] bg-indigo-50">View all conversations</button>}
          </div>
        )}
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
          <p className="mt-2 text-sm text-slate-600">Approve this scripted reply to {reviewConversation.customerName} in the demo. No external message will be sent.</p>
          <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4 text-sm [overflow-wrap:anywhere]">
            <div><p className="mb-1 text-xs font-semibold text-slate-500">Customer receives ({LANGUAGE_NAMES[reviewConversation.language]})</p><p>{reviewConversation.aiFollowUp.original}</p></div>
            {reviewPresentation?.showOriginal && <div><p className="mb-1 text-xs font-semibold text-slate-500">{ownerLanguage} translation</p><p>{reviewPresentation.text}</p></div>}
            {reviewPresentation?.translationUnavailable && <p className="text-xs text-slate-500">{ownerLanguage} translation unavailable. Original reply shown.</p>}
            {reviewConversation.aiFollowUp.appointmentAction && <p className="border-t border-slate-200 pt-3 text-xs text-slate-600">Appointment {reviewConversation.aiFollowUp.appointmentAction.type === 'book' ? 'booking' : 'change'}: {reviewConversation.aiFollowUp.appointmentAction.date} at {reviewConversation.aiFollowUp.appointmentAction.startTime}. Availability is checked before approval.</p>}
          </div>
          {!aiSettings.answerLanguages[reviewConversation.language] && <p className="mt-4 text-sm text-amber-700">Enable {LANGUAGE_NAMES[reviewConversation.language]} replies in AI Assistant settings before approving.</p>}
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
            >Approve demo reply</button>
          </div>
        </dialog>
      )}

      {/* Local channel preview, not an external messaging connection. */}
      {selected && (
        <dialog
          ref={whatsAppDialogRef}
          aria-label={`${selected.channel} preview for ${selected.customerName}`}
          onCancel={() => setShowWhatsApp(false)}
          onClose={() => setShowWhatsApp(false)}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
              setShowWhatsApp(false);
            }
          }}
          className="fixed inset-0 m-auto p-0 w-[340px] max-w-[calc(100vw-2rem)] h-[640px] max-h-[calc(100dvh-2rem)] bg-[#0b141a] rounded-[2rem] border-[6px] border-slate-900 shadow-2xl overflow-hidden backdrop:bg-slate-900/50 backdrop:backdrop-blur-xs"
        >
          <div className="h-full min-h-0 flex flex-col">
            <div className="flex shrink-0 items-center gap-2 px-2 py-2 bg-[#1f2c34] text-white">
              <button
                autoFocus
                onClick={() => setShowWhatsApp(false)}
                aria-label="Back to conversations"
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full hover:bg-white/10"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div
                className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${selected.avatarColor}`}
              >
                {selected.initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{selected.customerName}</p>
                <p className="text-[10px] text-white/60 truncate">{selected.phone}</p>
              </div>
              <button
                onClick={() => setShowWhatsApp(false)}
                aria-label="Close"
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4 space-y-2">
              <p className="text-center text-[10px] text-white/50 pb-1">
                {selected.channel} preview · Demo messages only
              </p>
              {selected.messages.map((m) => {
                const mine = m.sender !== 'customer';
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[82%] min-w-0 [overflow-wrap:anywhere] rounded-xl px-3 py-2 text-[13px] text-white leading-snug ${
                        mine ? selected.channel === 'Instagram' ? 'bg-fuchsia-700' : 'bg-[#005c4b]' : 'bg-[#202c33]'
                      }`}
                    >
                      {m.original}
                      <span className="block text-[9px] text-white/50 text-right mt-0.5">
                        {m.time}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="shrink-0 px-3 py-3 bg-[#0b141a]">
              <div className="rounded-full bg-[#202c33] px-4 py-2 text-xs text-white/40">
                Preview only · Sending is disabled
              </div>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
};

