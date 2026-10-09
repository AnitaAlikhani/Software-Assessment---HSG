import React, { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { AiAssistantSettings, ChatLanguage } from '../types';
import { LANGUAGE_NAMES } from '../conversationData';

interface AiAssistantViewProps {
  settings: AiAssistantSettings;
  onSave: (settings: AiAssistantSettings) => void;
}

const Toggle: React.FC<{
  checked: boolean;
  onChange: () => void;
  label: string;
}> = ({ checked, onChange, label }) => (
  <label className="relative inline-flex items-center cursor-pointer shrink-0">
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="sr-only peer"
    />
    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5551FF]" />
  </label>
);

export const AiAssistantView: React.FC<AiAssistantViewProps> = ({
  settings: initial,
  onSave,
}) => {
  const [form, setForm] = useState<AiAssistantSettings>(initial);
  const [newRule, setNewRule] = useState('');
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof AiAssistantSettings>(
    key: K,
    value: AiAssistantSettings[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggleLanguage = (lang: ChatLanguage) =>
    update('answerLanguages', {
      ...form.answerLanguages,
      [lang]: !form.answerLanguages[lang],
    });

  const toggleRule = (id: string) =>
    update(
      'handoverRules',
      form.handoverRules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );

  const addRule = () => {
    const label = newRule.trim();
    if (!label) return;
    update('handoverRules', [
      ...form.handoverRules,
      { id: `rule-${Date.now()}`, label, enabled: true },
    ]);
    setNewRule('');
  };

  const handleSave = () => {
    onSave(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const languages: ChatLanguage[] = ['DE', 'FR', 'IT', 'EN'];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          AI Assistant
        </h1>
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-6 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
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

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 sm:p-8">
        <p className="text-sm text-slate-500 mb-8">
          Control how your assistant replies to customers.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Left column */}
          <div className="space-y-8">
            <section className="space-y-5">
              <h2 className="text-sm font-bold text-slate-900">Replies</h2>

              <div className="flex items-start justify-between gap-6 pb-5 border-b border-slate-100">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    Ask me before sending replies
                  </p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    The assistant writes a draft and waits for your approval. Off: it replies on
                    its own.
                  </p>
                </div>
                <Toggle
                  checked={form.askBeforeSending}
                  onChange={() => update('askBeforeSending', !form.askBeforeSending)}
                  label="Ask me before sending replies"
                />
              </div>

              <div className="flex items-start justify-between gap-6 pb-5 border-b border-slate-100">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Translate chats for me</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    Show every message in its original language and in your language.
                  </p>
                </div>
                <Toggle
                  checked={form.translateChats}
                  onChange={() => update('translateChats', !form.translateChats)}
                  label="Translate chats for me"
                />
              </div>

              <div className="flex items-center justify-between gap-6">
                <label htmlFor="owner-language" className="text-sm font-semibold text-slate-800">
                  My language
                </label>
                <select
                  id="owner-language"
                  value={form.ownerLanguage}
                  onChange={(e) => update('ownerLanguage', e.target.value)}
                  className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:border-[#5551FF]"
                >
                  <option>English</option>
                  <option>German</option>
                </select>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-bold text-slate-900">
                Languages the assistant answers in
              </h2>
              <div className="flex flex-wrap gap-2">
                {languages.map((lang) => {
                  const on = form.answerLanguages[lang];
                  return (
                    <button
                      key={lang}
                      onClick={() => toggleLanguage(lang)}
                      aria-pressed={on}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border transition-colors ${
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

            <section className="space-y-3">
              <h2 className="text-sm font-bold text-slate-900">Tone of voice</h2>
              <div className="inline-flex p-1 bg-slate-100 rounded-xl">
                {(['friendly', 'formal'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => update('tone', t)}
                    className={`px-6 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                      form.tone === t
                        ? 'bg-[#5551FF] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* Right column */}
          <div className="space-y-8 lg:border-l lg:border-slate-100 lg:pl-10">
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-slate-900">Always hand over to me</h2>
              <p className="text-xs text-slate-500">
                The assistant pauses and asks you to step in for:
              </p>
              <div className="space-y-2.5">
                {form.handoverRules.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center gap-3 text-sm text-slate-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={() => toggleRule(r.id)}
                      className="w-4 h-4 rounded border-slate-300 accent-[#5551FF]"
                    />
                    {r.label}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input
                  value={newRule}
                  onChange={(e) => setNewRule(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRule()}
                  placeholder="Add a rule, e.g. Group bookings"
                  className="flex-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:border-[#5551FF]"
                />
                <button
                  onClick={addRule}
                  disabled={!newRule.trim()}
                  className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-[#5551FF] hover:bg-[#5551FF]/8 rounded-xl transition-colors disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-bold text-slate-900">Connected channels</h2>

              <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#25D366] text-white text-xs font-bold flex items-center justify-center">
                    W
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">WhatsApp Business</p>
                    <p className="text-xs text-slate-500">+41 71 000 00 00</p>
                  </div>
                </div>
                <button
                  onClick={() => update('whatsappConnected', !form.whatsappConnected)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    form.whatsappConnected
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {form.whatsappConnected ? 'Connected' : 'Connect'}
                </button>
              </div>

              <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-fuchsia-500 text-white text-xs font-bold flex items-center justify-center">
                    IG
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Instagram</p>
                    <p className="text-xs text-slate-500">
                      {form.instagramConnected ? 'instagram.com/bellahair' : 'Not connected'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => update('instagramConnected', !form.instagramConnected)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    form.instagramConnected
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {form.instagramConnected ? 'Connected' : 'Connect'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Demo only. Nothing is actually connected to WhatsApp or Instagram.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
