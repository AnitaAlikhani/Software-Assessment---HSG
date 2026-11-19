import React, { useEffect, useRef } from 'react';
import { ChevronRight, User, X } from 'lucide-react';
import { NavigationTab } from '../types';
import { MORE_TABS, SCREEN_NAMES } from '../navigation';
import { NAV_ICONS } from './navIcons';
import { StudyTools } from './StudyTools';

interface MoreSheetProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  /** Who is signed in, and the salon they work in. */
  ownerName?: string;
  ownerRole?: string;
  companyName?: string;
  /** Study tool: opens the pilot interest form. Shown with the research switch only. */
  onOpenPilotInterest: () => void;
}

/** The first letters of up to two names: "AW" for Anna Weber. Empty for no name. */
export const initialsOf = (name: string): string =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');

/**
 * What "More" in the tab bar opens on phones and tablets: a sheet from the bottom edge with the
 * screens the bar has no room for, and who is signed in. Home, Calendar and Chats are one tap
 * away in the bar, so they are not repeated here.
 *
 * A native dialog: focus moves into it and stays there, Escape closes it, and the page behind
 * cannot be used until it is closed. The Back gesture closes it too (src/backGesture.ts).
 */
export const MoreSheet: React.FC<MoreSheetProps> = ({
  isOpen, onClose, currentTab, onSelectTab, ownerName = '', ownerRole = '', companyName = '', onOpenPilotInterest,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    // A window made wide enough for the laptop menu (a tablet turned on its side) has no tab bar
    // and no use for the sheet any more.
    const wide = window.matchMedia('(min-width: 1024px)');
    const closeWhenWide = () => { if (wide.matches) closeRef.current(); };
    wide.addEventListener('change', closeWhenWide);
    return () => {
      wide.removeEventListener('change', closeWhenWide);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      // Back to "More", unless a screen was chosen: then the app moves focus to that screen's heading.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [isOpen]);

  if (!isOpen) return null;
  const account = [ownerRole, companyName].filter(Boolean).join(' · ');
  return (
    <dialog
      ref={dialogRef}
      id="more-sheet"
      aria-labelledby="more-sheet-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[calc(100dvh-3rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl border-0 bg-white p-0 pb-[env(safe-area-inset-bottom)] text-slate-800 shadow-2xl backdrop:bg-slate-900/40"
    >
      <h2 id="more-sheet-title" className="sr-only">More</h2>
      {/* Who is signed in. A plain line: there is no profile page or log-out to lead to. */}
      <div className="flex items-center gap-3 border-b border-slate-100 py-3 pl-5 pr-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#5551FF]/10 text-xs font-bold text-[#5551FF] ring-1 ring-[#5551FF]/20">
          {initialsOf(ownerName) || <User className="h-4 w-4" />}
        </span>
        <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="sr-only">Signed in as </span>
          <span className="block text-sm font-semibold text-slate-900">{ownerName || 'Account'}</span>
          {account && <span className="block text-xs text-slate-500">{account}</span>}
        </p>
        <button type="button" onClick={onClose} aria-label="Close menu"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <nav aria-label="More screens">
        <ul className="p-2 pb-3">
          {MORE_TABS.map((tab) => {
            const Icon = NAV_ICONS[tab];
            const active = currentTab === tab;
            return (
              <li key={tab}>
                <button type="button" onClick={() => { onSelectTab(tab); onClose(); }} aria-current={active ? 'page' : undefined}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF] ${
                    active ? 'bg-[#5551FF]/10 font-semibold text-[#5551FF]' : 'text-slate-700 hover:bg-slate-50'
                  }`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-white' : 'bg-slate-100 text-slate-600'}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">{SCREEN_NAMES[tab]}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Study tools stay out of the product and return with the research switch. */}
      <StudyTools onOpenPilotInterest={() => { onClose(); onOpenPilotInterest(); }} className="border-t border-slate-100 p-4" />
    </dialog>
  );
};
