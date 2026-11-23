import React, { useEffect, useRef, useState } from 'react';
import { Check, CloudOff, Loader2, LogOut, RefreshCw } from 'lucide-react';
import type { SalonStatus } from '../sharedSalon';
import { SIGN_OUT_LABEL } from '../views/chatScreen';
import { LogoMark } from './Logo';

const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]';

export const LOADING_TEXT = 'Loading your salon…';
export const LOAD_FAILED_TITLE = 'Your salon could not be loaded';

/**
 * Stands in for the whole owner app while a signed-in device loads the salon from the server,
 * and when that failed. Nothing that depends on the salon is shown before the record is there,
 * and the device never shows this browser's own salon instead without saying so: the way to it
 * is "Sign out on this device".
 */
export function SalonGate({ status, onRetry, onSignOut }: { status: SalonStatus; onRetry: () => void; onSignOut: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const failed = status.phase === 'failed';
  // The screen replaces the page: a screen reader starts at its heading once there is something to read.
  useEffect(() => { if (failed) headingRef.current?.focus(); }, [failed]);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F8F9FD] p-4 text-slate-800">
      {failed ? (
        <div role="alert" className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs sm:p-8">
          <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-amber-50 text-amber-700"><CloudOff className="size-5" /></span>
          <h1 ref={headingRef} tabIndex={-1} className="mt-4 text-xl font-bold text-slate-900 focus:outline-hidden">{LOAD_FAILED_TITLE}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{status.loadError}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={onRetry} className={`${buttonClass} bg-[#5551FF] text-white shadow-xs hover:bg-[#433fd8]`}>
              <RefreshCw className="size-4" aria-hidden="true" />Try again
            </button>
            <button type="button" onClick={onSignOut} className={`${buttonClass} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
              <LogOut className="size-4" aria-hidden="true" />{SIGN_OUT_LABEL}
            </button>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">Signed out, this device shows the salon kept in this browser, without your live chats.</p>
        </div>
      ) : (
        <div role="status" className="flex flex-col items-center gap-4 text-center">
          <LogoMark className="h-11 w-11" />
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{LOADING_TEXT}
          </p>
        </div>
      )}
    </main>
  );
}

/** How long "Saved" stays after the server has taken a change. */
const SAVED_FOR_MS = 2500;

/**
 * A small sign in the top bar of a signed-in device: "Saving…" while a change is on its way to
 * the server, "Saved" for a moment once it has it. Nothing at all otherwise, so it never takes
 * room from the screen's name on a phone when there is nothing to say.
 */
export function SaveIndicator({ status, now = Date.now }: { status: SalonStatus | undefined; now?: () => number }) {
  const savedAt = status?.savedAt ?? null;
  const [, setTick] = useState(0);
  const freshlySaved = savedAt !== null && now() - savedAt < SAVED_FOR_MS;
  useEffect(() => {
    if (!freshlySaved || savedAt === null) return;
    const timer = setTimeout(() => setTick((tick) => tick + 1), Math.max(0, SAVED_FOR_MS - (now() - savedAt)) + 20);
    return () => clearTimeout(timer);
  }, [freshlySaved, savedAt, now]);
  if (!status || status.phase !== 'ready') return null;
  const state = status.saving ? 'saving' : freshlySaved ? 'saved' : null;
  return (
    <span role="status" aria-live="polite" className="inline-flex shrink-0 items-center">
      {state && (
        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold ${state === 'saving' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
          {state === 'saving'
            ? <><Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />Saving…</>
            : <><Check className="size-3" aria-hidden="true" />Saved</>}
        </span>
      )}
    </span>
  );
}
