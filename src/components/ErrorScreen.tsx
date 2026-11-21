import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PRODUCT_NAME } from '../brand';
import { LogoMark } from './Logo';

interface ErrorScreenProps {
  /** Loads the page again. */
  onReload: () => void;
  /**
   * Clears what this browser has stored for the salon and loads the page again. Left out on a
   * page that keeps nothing of the salon (the customer chat): there the screen offers Reload only.
   */
  onResetData?: () => void;
}

const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]';

/**
 * What is shown instead of a page that could not be drawn. It says what happened in one
 * sentence and offers the two ways on: load the page again, or, if what the browser has stored
 * is the cause, clear that and start again. Resetting removes what the owner did, so it asks first.
 */
export const ErrorScreen: React.FC<ErrorScreenProps> = ({ onReload, onResetData }) => {
  const [asking, setAsking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  // The screen replaces the whole page: move focus to its heading, so a screen reader starts there.
  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => { if (asking) questionRef.current?.focus(); }, [asking]);
  const keepData = () => {
    setAsking(false);
    requestAnimationFrame(() => resetRef.current?.focus());
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F8F9FD] p-4 text-slate-800">
      <div role="alert" className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs sm:p-8">
        <LogoMark className="h-9 w-9" />
        <h1 ref={headingRef} tabIndex={-1} className="mt-4 text-xl font-bold text-slate-900 focus:outline-hidden">This page could not be shown</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">Something went wrong in {PRODUCT_NAME}. Reload the page to try again.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={onReload} className={`${buttonClass} bg-[#5551FF] text-white shadow-xs hover:bg-[#433fd8]`}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />Reload
          </button>
          {onResetData && !asking && (
            <button ref={resetRef} type="button" onClick={() => setAsking(true)} className={`${buttonClass} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
              Reset data
            </button>
          )}
        </div>
        {onResetData && !asking && (
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            If reloading does not help, the data saved in this browser may be damaged. Reset data clears them: appointments, customers, chats and settings go back to their starting state.
          </p>
        )}
        {onResetData && asking && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); keepData(); } }}>
            <p ref={questionRef} tabIndex={-1} className="text-sm font-semibold text-rose-900 focus:outline-hidden">Reset the data in this browser?</p>
            <p className="mt-1 text-xs leading-relaxed text-rose-700">Appointments, customers, chats and settings go back to their starting state, in every open tab. This cannot be undone.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onResetData} className={`${buttonClass} bg-rose-600 text-white hover:bg-rose-700`}>Yes, reset data</button>
              <button type="button" onClick={keepData} className={`${buttonClass} bg-white text-slate-700 hover:bg-slate-100`}>Keep data</button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

interface ErrorBoundaryProps {
  /** Clears what this browser has stored for the salon. Left out, the error screen offers no reset. */
  resetData?: () => void;
  children: React.ReactNode;
}

/**
 * Stands around a whole page. Whatever fails while the page is drawn (a stored value of a kind
 * the screens cannot handle, a fault in a screen) ends on the error screen instead of a blank page.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const reload = () => window.location.reload();
    const { resetData } = this.props;
    const resetAndReload = resetData && (() => {
      // The page is loaded again also when clearing fails: it can only get better from there.
      try { resetData(); } catch { /* Nothing could be cleared. */ }
      reload();
    });
    return <ErrorScreen onReload={reload} onResetData={resetAndReload} />;
  }
}
