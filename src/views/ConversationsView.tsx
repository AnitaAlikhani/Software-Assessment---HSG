import React, { useState } from 'react';
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
  ChatMessage,
  Conversation,
  ConversationStatus,
} from '../types';
import { LANGUAGE_NAMES } from '../conversationData';
import { WAITLIST_FORM_URL } from '../config';

interface ConversationsViewProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTakeOver: (id: string) => void;
  onLetAiContinue: (id: string) => void;
  onOwnerReply: (id: string, english: string, local?: string) => void;
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
  onSelect,
  onTakeOver,
  onLetAiContinue,
  onOwnerReply,
  aiSettings,
  onOpenAiSettings,
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState('');
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [showWaitlist, setShowWaitlist] = useState(false);

  const needsCount = conversations.filter(
    (c) => c.status === 'needs-attention'
  ).length;

  const visible = conversations.filter((c) => {
    if (filter === 'needs') return c.status === 'needs-attention';
    if (filter === 'languages') return c.language !== 'EN';
    if (filter === 'ai') return c.status === 'ai-handled';
    return true;
  });

  const selected =
    conversations.find((c) => c.id === selectedId) ?? conversations[0] ?? null;

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'needs', label: 'Needs attention' },
    { key: 'languages', label: 'Languages' },
    { key: 'ai', label: 'AI handled' },
  ];

  const isTranslated = (c: Conversation) =>
    aiSettings.translateChats && c.language !== 'EN';

  const locked = selected
    ? selected.status === 'needs-attention' && !selected.takenOver
    : true;

  const send = (english: string, local?: string) => {
    if (!selected || !english.trim()) return;
    onOwnerReply(selected.id, english.trim(), local);
    setDraft('');
  };

  const renderBubble = (c: Conversation, m: ChatMessage, flagged: boolean) => {
    const mine = m.sender !== 'customer';
    const showBoth = isTranslated(c) && m.original !== m.translation;
    const bubbleColor =
      m.sender === 'customer'
        ? 'bg-slate-100 text-slate-800'
        : m.sender === 'ai'
        ? 'bg-[#5551FF] text-white'
        : 'bg-slate-800 text-white';
    const subColor = mine ? 'text-white/70' : 'text-slate-500';

    return (
      <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <div className="max-w-[78%] relative">
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
            {showBoth ? (
              <>
                <p className={`text-[11px] leading-snug ${subColor}`}>{m.original}</p>
                <div
                  className={`my-1.5 h-px ${mine ? 'bg-white/30' : 'bg-slate-300/80'}`}
                />
                <p className="text-sm font-medium leading-snug">{m.translation}</p>
              </>
            ) : (
              <p className="text-sm font-medium leading-snug">
                {aiSettings.translateChats ? m.translation : m.original}
              </p>
            )}
            {m.untranslated && (
              <p className={`text-[10px] mt-1 italic ${subColor}`}>
                Sent in English. Not translated in this demo.
              </p>
            )}
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
        <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-slate-200/70 flex flex-col">
          <div className="flex items-center gap-3.5 px-4 pt-4 border-b border-slate-100 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={`pb-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
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
              const preview = aiSettings.translateChats ? last.translation : last.original;
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
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${LANG_CHIP[c.language]}`}
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
          <div className="md:col-span-8 flex flex-col min-h-[520px]">
            {/* Chat header */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${selected.avatarColor}`}
                >
                  {selected.initials}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900 truncate">
                      {selected.customerName}
                    </h2>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${LANG_CHIP[selected.language]}`}
                    >
                      {selected.language}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 truncate">
                    {selected.phone} · {selected.channel}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={onOpenAiSettings}
                  title="Change in AI Assistant settings"
                  className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200/70 transition-colors"
                >
                  <Bot className="w-3.5 h-3.5" />
                  {aiSettings.askBeforeSending ? 'AI replies need your approval' : 'AI replies automatically'}
                </button>
                <button
                  onClick={() => setShowWhatsApp(true)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-2xs transition-colors"
                >
                  <span className="w-4 h-4 rounded-full bg-[#25D366] inline-block" />
                  Open in WhatsApp
                </button>
              </div>
            </div>

            {/* Translation chip */}
            {isTranslated(selected) && (
              <div className="flex justify-center pt-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                  <Languages className="w-3.5 h-3.5" />
                  Translating {LANGUAGE_NAMES[selected.language]} → English
                </span>
              </div>
            )}
            {!aiSettings.translateChats && selected.language !== 'EN' && (
              <div className="flex justify-center pt-3">
                <button
                  onClick={onOpenAiSettings}
                  className="text-[11px] font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded-full transition-colors"
                >
                  Translation is off. Turn it on in AI Assistant settings
                </button>
              </div>
            )}

            {/* Attention banner */}
            {selected.status === 'needs-attention' && !selected.takenOver && (
              <div className="mx-6 mt-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Needs your attention</p>
                  <p className="text-xs text-slate-500">{selected.attentionReason}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => onTakeOver(selected.id)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] transition-colors"
                  >
                    Take over
                  </button>
                  <button
                    onClick={() => onLetAiContinue(selected.id)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition-colors"
                  >
                    Let AI continue
                  </button>
                </div>
              </div>
            )}

            {selected.status === 'needs-attention' && selected.takenOver && (
              <div className="mx-6 mt-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-[#5551FF] text-white flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">You've taken over</p>
                  <p className="text-xs text-slate-500">
                    The AI is paused for this chat. Your replies are translated automatically.
                  </p>
                </div>
                <button
                  onClick={() => onLetAiContinue(selected.id)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition-colors shrink-0"
                >
                  Hand back to AI
                </button>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
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
            <div className="px-6 pb-5 pt-3 border-t border-slate-100 space-y-3">
              {!locked && selected.quickReplies && selected.quickReplies.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selected.quickReplies.map((q) => (
                    <button
                      key={q.en}
                      onClick={() => send(q.en, q.local)}
                      className="text-left text-[11px] font-medium text-[#5551FF] bg-[#5551FF]/8 hover:bg-[#5551FF]/15 border border-[#5551FF]/20 rounded-xl px-3 py-1.5 transition-colors"
                    >
                      {q.en}
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
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={locked}
                  placeholder={
                    locked
                      ? 'Take over to reply as the owner'
                      : selected.language === 'EN'
                      ? 'Reply as owner'
                      : `Reply as owner, auto-translated to ${LANGUAGE_NAMES[selected.language]}`
                  }
                  className="flex-1 px-4 py-2.5 text-sm bg-slate-100 rounded-full border border-transparent focus:bg-white focus:border-[#5551FF]/40 focus:outline-hidden focus:ring-2 focus:ring-[#5551FF]/15 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  disabled={locked || !draft.trim()}
                  className="w-10 h-10 rounded-full bg-[#5551FF] text-white flex items-center justify-center hover:bg-[#433fd8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
          <div className="md:col-span-8 flex items-center justify-center text-sm text-slate-400">
            No conversations yet.
          </div>
        )}
      </div>

      {/* Pilot waitlist call to action */}
      <div className="rounded-2xl border border-[#5551FF]/20 bg-[#5551FF]/5 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Want this assistant for your business?
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            This is a student prototype. Leaving your email on the waitlist is optional.
          </p>
        </div>
        <button
          onClick={() => setShowWaitlist(true)}
          className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] transition-colors shrink-0"
        >
          Join the pilot waitlist
        </button>
      </div>

      {showWaitlist && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowWaitlist(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Join the pilot waitlist"
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900">Join the pilot waitlist</h2>
              <div className="flex items-center gap-4">
                <a
                  href={WAITLIST_FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-[#5551FF] hover:underline"
                >
                  Open in a new tab
                </a>
                <button
                  onClick={() => setShowWaitlist(false)}
                  aria-label="Close waitlist form"
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="relative h-[640px] max-h-[75vh]">
              <p className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                Loading the form…
              </p>
              <iframe
                src={`${WAITLIST_FORM_URL}?embedded=true`}
                title="Pilot waitlist form"
                className="relative w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp view: what the customer sees on their phone */}
      {showWhatsApp && selected && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowWhatsApp(false)}
        >
          <div
            className="w-[340px] max-w-full h-[640px] bg-[#0b141a] rounded-[2.2rem] border-[6px] border-slate-900 shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-3 py-3 bg-[#1f2c34] text-white">
              <button
                onClick={() => setShowWhatsApp(false)}
                aria-label="Back to conversations"
                className="p-1 rounded-full hover:bg-white/10"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold ${selected.avatarColor}`}
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
                className="p-1 rounded-full hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
              <p className="text-center text-[10px] text-white/50 pb-1">
                What your customer sees in {selected.channel}
              </p>
              {selected.messages.map((m) => {
                const mine = m.sender !== 'customer';
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[82%] rounded-xl px-3 py-2 text-[13px] text-white leading-snug ${
                        mine ? 'bg-[#005c4b]' : 'bg-[#202c33]'
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
            <div className="px-3 py-3 bg-[#0b141a]">
              <div className="rounded-full bg-[#202c33] px-4 py-2 text-xs text-white/40">
                Message
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
