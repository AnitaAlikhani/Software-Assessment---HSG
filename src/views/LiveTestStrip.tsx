import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, ExternalLink, Radio, Send } from 'lucide-react';
import type { LiveChannels } from '../liveWhatsApp';

interface LiveTestStripProps {
  channels: LiveChannels;
  liveCount: number;
  waitingCount: number;
}

/**
 * Shown on top of Conversations during the live test: how people can write to the AI right now.
 * The QR code is made in the browser, so the link is never sent to another service.
 */
export function LiveTestStrip({ channels, liveCount, waitingCount }: LiveTestStripProps) {
  const telegramUrl = channels.telegram ? `https://t.me/${channels.telegram}` : null;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!telegramUrl) { setQr(null); return; }
    let cancelled = false;
    QRCode.toDataURL(telegramUrl, { margin: 1, width: 240, color: { dark: '#0f172a', light: '#ffffff' } })
      .then(url => { if (!cancelled) setQr(url); })
      .catch(() => setQr(null));
    return () => { cancelled = true; };
  }, [telegramUrl]);

  const copyWebsiteLink = async () => {
    try {
      await navigator.clipboard.writeText(channels.websiteChatUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the link is still visible to open */ }
  };

  return (
    <>
    {/* Phones: one compact row. A QR code makes no sense on the phone that would scan it. */}
    <section aria-label="Live test" className="md:hidden flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2">
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
      <span className="min-w-0 flex-1 text-xs font-semibold text-emerald-800">
        Live test{waitingCount > 0 ? ` · ${waitingCount} waiting` : ''}
      </span>
      {telegramUrl && (
        <a href={telegramUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-white px-2.5 text-xs font-semibold text-sky-700 border border-sky-200">
          <Send className="w-3.5 h-3.5" /> Telegram
        </a>
      )}
      <a href={channels.websiteChatUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-lg bg-white px-2.5 text-xs font-semibold text-slate-700 border border-slate-200">
        Web chat
      </a>
    </section>

    <section aria-label="Live test" className="hidden md:block rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-sky-50 p-4 sm:p-5">
      <div className="flex flex-col lg:flex-row gap-4 lg:items-center">
        <div className="flex-1 min-w-0 space-y-2">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            Live test is on
          </p>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">Write to the AI receptionist in any language</h2>
          <p className="text-sm text-slate-600">
            Messages arrive here in real time with a translation. The AI answers by itself and hands over discounts,
            complaints and booking requests for you to confirm.
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
            <span className="inline-flex items-center gap-1"><Radio className="w-3.5 h-3.5" /> {liveCount} live {liveCount === 1 ? 'chat' : 'chats'}</span>
            {waitingCount > 0 && <span className="text-amber-700">{waitingCount} waiting for you</span>}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {telegramUrl && (
            <a
              href={telegramUrl}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-3 rounded-xl bg-white border border-sky-200 p-3 hover:border-sky-400 transition-colors"
            >
              {qr
                ? <img src={qr} alt={`QR code for ${telegramUrl}`} className="w-24 h-24 rounded-lg" />
                : <span className="w-24 h-24 rounded-lg bg-slate-100" aria-hidden="true" />}
              <span className="space-y-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Send className="w-4 h-4 text-sky-500" /> Telegram
                </span>
                <span className="block text-xs text-slate-500">Scan or open</span>
                <span className="block text-xs font-semibold text-sky-600 group-hover:underline">@{channels.telegram}</span>
              </span>
            </a>
          )}
          <div className="flex flex-col justify-center gap-2 rounded-xl bg-white border border-slate-200 p-3 min-w-[12rem]">
            <span className="text-sm font-semibold text-slate-900">Website chat</span>
            <span className="text-xs text-slate-500">For testers without Telegram</span>
            <div className="flex gap-2">
              <a
                href={channels.websiteChatUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8]"
              >
                Open <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={copyWebsiteLink}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
    </>
  );
}
