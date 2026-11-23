import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { AiAssistantSettings, ChatLanguage } from '../types';
import { LANGUAGE_NAMES } from '../conversationData';
import type { LiveStatus } from '../liveWhatsApp';
import { ChannelIcon, channelLabel, type ChannelKind } from '../components/ChannelBadge';
import { formatPhone } from '../format';
import { refreshSharedSalon, useServerValue, whenFormSaved } from '../useDemoState';
import { BY_KEY, useStoredForm } from '../formFollow';

/** What the app really knows about the channels. Nothing here is a switch the owner can flip. */
export interface ChannelFacts {
  /** Whether this browser reached the workspace's live chats. */
  live: LiveStatus;
  /** User name of the connected Telegram bot, if there is one. */
  telegramBot?: string | null;
  /** True once a WhatsApp chat has arrived. */
  whatsappChats?: boolean;
  /** The salon's business phone from Settings: the number a WhatsApp connection would use. */
  businessPhone?: string;
}

export interface ChannelRow {
  channel: ChannelKind;
  state: 'active' | 'off' | 'checking';
  stateLabel: string;
  detail: string;
  /** A public address of the channel itself. Never the website chat link: that one carries the access key. */
  link?: { href: string; label: string };
}

/**
 * The Channels list, built from what is true right now: the website chat and Telegram are on
 * when the live chats answer, and WhatsApp only once a chat has really arrived. A channel that
 * does not exist yet is not listed: this page holds what is there. No row pretends to connect
 * anything.
 */
export function channelRows({ live, telegramBot, whatsappChats, businessPhone }: ChannelFacts): ChannelRow[] {
  const checking = live === 'checking';
  const waiting = { state: 'checking' as const, stateLabel: 'Checking…', detail: 'Checking the connection…' };
  const phone = businessPhone?.trim() ? formatPhone(businessPhone) : '';
  return [
    checking ? { channel: 'Website', ...waiting }
      : live === 'on'
        ? { channel: 'Website', state: 'active', stateLabel: 'Active', detail: 'The AI receptionist answers visitors in your website chat. Their chats appear in Conversations.' }
        : { channel: 'Website', state: 'off', stateLabel: 'Not active', detail: 'Not switched on for this workspace.' },
    checking ? { channel: 'Telegram', ...waiting }
      : live === 'on' && telegramBot
        ? {
            channel: 'Telegram', state: 'active', stateLabel: 'Active',
            detail: 'The AI receptionist answers customers who write to your bot. Their chats appear in Conversations.',
            link: { href: `https://t.me/${encodeURIComponent(telegramBot)}`, label: `@${telegramBot}` },
          }
        : { channel: 'Telegram', state: 'off', stateLabel: 'Not connected', detail: 'No bot is connected.' },
    checking ? { channel: 'WhatsApp', ...waiting }
      : live === 'on' && whatsappChats
        ? { channel: 'WhatsApp', state: 'active', stateLabel: 'Active', detail: 'WhatsApp messages appear in Conversations.' }
        : {
            channel: 'WhatsApp', state: 'off', stateLabel: 'Not connected',
            detail: `Meta has to verify the business before ${phone ? `your salon number (${phone})` : 'a salon number'} can be connected.`,
          },
  ];
}

const STATE_PILL: Record<ChannelRow['state'], string> = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  off: 'bg-white text-slate-600 border-slate-200',
  checking: 'bg-white text-slate-500 border-slate-200',
};

/** A rule's name inside a sentence: "Discounts and price changes" becomes "discounts and price changes". */
const inSentence = (label: string): string => /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;

interface AiAssistantViewProps {
  settings: AiAssistantSettings;
  onSave: (settings: AiAssistantSettings) => void;
  channels?: ChannelFacts;
}

const Toggle: React.FC<{
  checked: boolean;
  onChange: () => void;
  label: string;
}> = ({ checked, onChange, label }) => (
  <label className="relative inline-flex min-w-11 min-h-11 items-center justify-center cursor-pointer shrink-0">
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="sr-only peer"
    />
    <div className="relative w-9 h-5 bg-slate-200 peer-focus-visible:ring-2 peer-focus-visible:ring-[#5551FF] peer-focus-visible:ring-offset-2 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5551FF]" />
  </label>
);

const ChannelCard: React.FC<{ row: ChannelRow }> = ({ row }) => (
  <li className="flex items-start gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
    <ChannelIcon channel={row.channel} />
    <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-slate-800">{row.channel === 'WhatsApp' ? 'WhatsApp Business' : channelLabel(row.channel)}</p>
        {/* A state, not a button: nothing here can be switched by hand. */}
        <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${STATE_PILL[row.state]}`}>
          {row.stateLabel}
        </span>
      </div>
      <p className="text-xs text-slate-500 mt-1">{row.detail}</p>
      {row.link && (
        <a
          href={row.link.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center text-xs font-semibold text-sky-700 hover:underline"
        >
          {row.link.label}
        </a>
      )}
    </div>
  </li>
);

export const AiAssistantView: React.FC<AiAssistantViewProps> = ({
  settings: initial,
  onSave,
  channels = { live: 'off' },
}) => {
  // Compared with and following what the server has (src/formFollow.ts): a switch the owner has not
  // touched shows another device's change; the handover rules are followed one by one.
  const stored = useServerValue('aiSettings', initial);
  const { form, setForm } = useStoredForm<AiAssistantSettings>(stored, { lists: { handoverRules: (rule: AiAssistantSettings['handoverRules'][number]) => rule.id, answerLanguages: BY_KEY } });
  const [saved, setSaved] = useState(false);
  // The form starts from the latest record (src/useDemoState.ts refreshSharedSalon).
  useEffect(() => { refreshSharedSalon(); }, []);

  const update = <K extends keyof AiAssistantSettings>(
    key: K,
    value: AiAssistantSettings[K]
  ) => { setForm((prev) => ({ ...prev, [key]: value })); setSaved(false); };

  const toggleLanguage = (lang: ChatLanguage) =>
    update('answerLanguages', {
      ...form.answerLanguages,
      [lang]: !form.answerLanguages[lang],
    });

  const handleSave = () => {
    onSave(form);
    // "Saved!" only once it is: on a signed-in device that is when the server has taken it.
    whenFormSaved(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  };

  const languages: ChatLanguage[] = ['DE', 'FR', 'IT', 'EN'];
  const rows = channelRows(channels);
  const handover = form.handoverRules.filter((rule) => rule.enabled).map((rule) => inSentence(rule.label));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* The AI that answers customers. The "Assistant" in the header is the owner's own helper. */}
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          AI receptionist
        </h1>
        <button
          onClick={handleSave}
          className="flex min-h-11 items-center gap-1.5 px-6 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
        >
          {saved ? (
            <>
              <Check className="w-4 h-4" />
              <span>Saved!</span>
            </>
          ) : (
            <span>Save</span>
          )}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-4 sm:p-8">
        <p className="text-sm text-slate-500 mb-8">
          Decide how your AI receptionist answers customers.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Left column: the settings the owner can change */}
          <div className="space-y-8">
            <section className="space-y-5">
              <h2 className="text-sm font-bold text-slate-900">Replies</h2>

              <div className="flex items-start justify-between gap-3 sm:gap-6 pb-5 border-b border-slate-100">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    Ask me before sending replies
                  </p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    When you hand a chat back to the AI receptionist, it shows you its next reply for approval first. Answers to new customer messages go out right away.
                  </p>
                </div>
                <Toggle
                  checked={form.askBeforeSending}
                  onChange={() => update('askBeforeSending', !form.askBeforeSending)}
                  label="Ask me before sending replies"
                />
              </div>

              <div className="flex items-start justify-between gap-3 sm:gap-6 pb-5 border-b border-slate-100">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">Translate chats for me</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    See every chat in your language next to the original.
                  </p>
                </div>
                <Toggle
                  checked={form.translateChats}
                  onChange={() => update('translateChats', !form.translateChats)}
                  label="Translate chats for me"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label htmlFor="owner-language" className="text-sm font-semibold text-slate-800">
                  My language
                </label>
                <select
                  id="owner-language"
                  value={form.ownerLanguage}
                  onChange={(e) => update('ownerLanguage', e.target.value)}
                  className="min-h-11 max-w-full px-3 py-2 text-base sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:border-[#5551FF]"
                >
                  <option>English</option>
                  <option>German</option>
                </select>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-bold text-slate-900">
                Languages the AI receptionist answers in
              </h2>
              <p className="text-xs text-slate-500">Chats in other languages are handed to you.</p>
              <div className="flex flex-wrap gap-2">
                {languages.map((lang) => {
                  const on = form.answerLanguages[lang];
                  return (
                    <button
                      key={lang}
                      onClick={() => toggleLanguage(lang)}
                      aria-pressed={on}
                      className={`flex min-h-11 items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border transition-colors ${
                        on
                          ? 'bg-[#5551FF]/10 text-[#5551FF] border-[#5551FF]/30'
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {on && <Check className="w-3.5 h-3.5" />}
                      {LANGUAGE_NAMES[lang]}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Right column: what the AI does by itself, and where customers reach it */}
          <div className="space-y-8 lg:border-l lg:border-slate-100 lg:pl-10">
            {/* Tone and handover are facts about the AI, not settings: nothing in them can be
                switched, so they are one note in plain text. They become controls once the live AI
                reads the owner's choice; until then a switch here would change nothing. */}
            <section aria-labelledby="ai-answers-title" className="space-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm text-slate-700 [overflow-wrap:anywhere]">
              <h2 id="ai-answers-title" className="font-bold text-slate-900">How the AI answers</h2>
              <p>
                {form.tone === 'formal' ? 'Polite and formal' : 'Warm and friendly'}, in the customer’s language and in a few short sentences.
              </p>
              <p>
                {handover.length > 0 && `The AI receptionist always hands these over to you: ${handover.join(', ')}. `}
                {handover.length > 0 ? 'It also hands over' : 'The AI receptionist always hands over'} health and allergy questions, anything it does not know, and customers who are upset or ask for a person.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-bold text-slate-900">Channels</h2>
              <p className="text-xs text-slate-500">Where customers reach your AI receptionist.</p>
              <ul className="space-y-3">
                {rows.map((row) => <ChannelCard key={row.channel} row={row} />)}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
