import React from 'react';
import { BarChart3, Calendar, Menu, MessageSquare, Users } from 'lucide-react';
import { NavigationTab } from '../types';

interface BottomNavProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  /** Opens the full menu (the sidebar) for everything that is not in the bar. */
  onOpenMore: () => void;
  isMoreOpen: boolean;
  homeBadge: number;
  chatsBadge: number;
  /** True inside an open chat on a phone, where the reply box needs the bottom of the screen. */
  hideOnPhone?: boolean;
}

const TABS: { tab: NavigationTab; label: string; icon: typeof Calendar }[] = [
  { tab: 'home', label: 'Home', icon: BarChart3 },
  { tab: 'calendar', label: 'Calendar', icon: Calendar },
  { tab: 'conversations', label: 'Chats', icon: MessageSquare },
  { tab: 'customers', label: 'Customers', icon: Users },
];

/** App-style tab bar on phones and tablets, like a native salon app. Desktop keeps the sidebar. */
export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onSelectTab, onOpenMore, isMoreOpen, homeBadge, chatsBadge, hideOnPhone }) => {
  const inBar = TABS.some(item => item.tab === currentTab);
  return (
    <nav
      aria-label="Quick navigation"
      className={`${hideOnPhone ? 'hidden md:block' : ''} lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/80 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.06)]`}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map(({ tab, label, icon: Icon }) => {
          const active = currentTab === tab;
          const badge = tab === 'home' ? homeBadge : tab === 'conversations' ? chatsBadge : 0;
          return (
            <li key={tab}>
              <button
                type="button"
                onClick={() => onSelectTab(tab)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${active ? 'text-[#5551FF]' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <span className={`relative flex h-8 w-12 items-center justify-center rounded-full transition-colors ${active ? 'bg-[#5551FF]/10' : ''}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {badge > 0 && (
                    <span className="absolute -top-0.5 right-1 min-w-[1.1rem] h-[1.1rem] rounded-full bg-rose-500 px-1 text-[10px] leading-[1.1rem] text-white tabular-nums">
                      {badge > 9 ? '9+' : badge}
                      <span className="sr-only"> waiting</span>
                    </span>
                  )}
                </span>
                {label}
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onOpenMore}
            aria-expanded={isMoreOpen}
            aria-controls="mobile-sidebar"
            className={`flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${!inBar ? 'text-[#5551FF]' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <span className={`flex h-8 w-12 items-center justify-center rounded-full ${!inBar ? 'bg-[#5551FF]/10' : ''}`}>
              <Menu className="h-5 w-5" aria-hidden="true" />
            </span>
            More
          </button>
        </li>
      </ul>
    </nav>
  );
};
