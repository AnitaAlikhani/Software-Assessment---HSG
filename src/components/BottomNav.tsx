import React from 'react';
import { Ellipsis, Plus } from 'lucide-react';
import { NavigationTab } from '../types';
import { SCREEN_NAMES, TAB_BAR_TABS } from '../navigation';
import { NAV_ICONS } from './navIcons';

interface BottomNavProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  /** "+" in the middle: opens the form for a new appointment. */
  onNewAppointment: () => void;
  /** Opens the sheet with every screen that is not in the bar. */
  onOpenMore: () => void;
  isMoreOpen: boolean;
  /** Everything that waits for the owner: the number beside "Waiting for you" on Home. */
  homeBadge: number;
  /** Chats that wait for the owner: the number on Chats. */
  chatsBadge: number;
  /** True inside an open chat on a phone, where the reply box needs the bottom of the screen. */
  hideOnPhone?: boolean;
}

/** In the bar there is room for one short word per place, so Conversations is "Chats" here. */
const SHORT_NAMES: Partial<Record<NavigationTab, string>> = { conversations: 'Chats' };

const itemClass = (active: boolean) =>
  `relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF] ${active ? 'text-[#5551FF]' : 'text-slate-500 hover:text-slate-800'}`;
const pillClass = (active: boolean) =>
  `relative flex h-8 w-12 items-center justify-center rounded-full transition-colors ${active ? 'bg-[#5551FF]/10' : ''}`;

/**
 * App-style tab bar on phones and tablets: Home, Calendar, "+" for a new appointment, Chats and
 * More. Laptops have the menu on the left instead.
 */
export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onSelectTab, onNewAppointment, onOpenMore, isMoreOpen, homeBadge, chatsBadge, hideOnPhone }) => {
  const inBar = TAB_BAR_TABS.includes(currentTab);
  const tabButton = (tab: NavigationTab) => {
    const Icon = NAV_ICONS[tab];
    const active = currentTab === tab;
    const badge = tab === 'home' ? homeBadge : tab === 'conversations' ? chatsBadge : 0;
    const what = tab === 'home' ? 'waiting for you' : (badge === 1 ? 'chat is waiting for you' : 'chats are waiting for you');
    return (
      <li key={tab}>
        <button type="button" onClick={() => onSelectTab(tab)} aria-current={active ? 'page' : undefined} className={itemClass(active)}>
          <span className={pillClass(active)}>
            <Icon className="h-5 w-5" aria-hidden="true" />
            {badge > 0 && (
              <span aria-hidden="true" className="absolute -top-0.5 right-1 h-[1.1rem] min-w-[1.1rem] rounded-full bg-rose-500 px-1 text-[10px] leading-[1.1rem] text-white tabular-nums">
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </span>
          {SHORT_NAMES[tab] ?? SCREEN_NAMES[tab]}
          {/* Read out after the name of the tab, and with the full number: "Home, 12 waiting for you". */}
          {badge > 0 && <span className="sr-only">, {badge} {what}</span>}
        </button>
      </li>
    );
  };
  return (
    <nav
      aria-label="Quick navigation"
      className={`${hideOnPhone ? 'hidden md:block' : ''} lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/80 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.06)]`}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TAB_BAR_TABS.slice(0, 2).map(tabButton)}
        <li>
          {/* The one action that is needed from every screen: most bookings come in by phone. */}
          <button type="button" onClick={onNewAppointment} aria-label="New appointment" title="New appointment"
            className="group flex h-16 w-full items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF]">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#5551FF] text-white shadow-md shadow-indigo-500/30 transition-colors group-hover:bg-[#433fd8]">
              <Plus className="h-6 w-6" aria-hidden="true" />
            </span>
          </button>
        </li>
        {TAB_BAR_TABS.slice(2).map(tabButton)}
        <li>
          <button
            id="more-trigger"
            type="button"
            onClick={onOpenMore}
            aria-haspopup="dialog"
            aria-expanded={isMoreOpen}
            aria-controls={isMoreOpen ? 'more-sheet' : undefined}
            className={itemClass(!inBar)}
          >
            <span className={pillClass(!inBar)}>
              <Ellipsis className="h-5 w-5" aria-hidden="true" />
            </span>
            More
          </button>
        </li>
      </ul>
    </nav>
  );
};
