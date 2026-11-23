import React from 'react';
import { NavigationTab } from '../types';
import { MENU_GROUPS, SCREEN_NAMES } from '../navigation';
import { Logo } from './Logo';
import { NAV_ICONS } from './navIcons';
import { StudyTools } from './StudyTools';

interface SidebarProps {
  companyName: string;
  companyLocation?: string;
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  /** Everything that waits for the owner: the number beside "Waiting for you" on Home. */
  waitingCount: number;
  /** Chats that wait for the owner: the number on Conversations. */
  needsAttentionCount?: number;
  /** Study tool: opens the pilot interest form. Its button is shown with the research switch only. */
  onOpenPilotInterest: () => void;
}

/**
 * The menu on laptops. Phones and tablets have the tab bar and "More" instead (BottomNav, MoreSheet),
 * so this is never a drawer: it is simply not there below 1024 px.
 */
export const Sidebar: React.FC<SidebarProps> = ({
  companyName,
  companyLocation,
  currentTab,
  onSelectTab,
  waitingCount,
  needsAttentionCount = 0,
  onOpenPilotInterest,
}) => {
  const badges: Partial<Record<NavigationTab, { count: number; what: string }>> = {
    home: { count: waitingCount, what: 'waiting for you' },
    conversations: { count: needsAttentionCount, what: needsAttentionCount === 1 ? 'chat is waiting for you' : 'chats are waiting for you' },
  };

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col self-start border-r border-slate-200/60 bg-[#F8F9FD] p-5 lg:flex">
      {/* The product on top, the salon as the workspace under it. The salon is shown once and is
          no button: the one way to its settings is the menu entry "Settings". */}
      <div className="mb-5 shrink-0">
        <div className="flex min-h-11 items-center">
          <Logo className="px-2" />
        </div>
        <div className="mt-3 flex min-h-11 items-center gap-3 rounded-xl border border-slate-200/70 bg-white/70 px-2.5 py-2">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#5551FF]/10 text-sm font-bold text-[#5551FF]">
            {companyName.trim().charAt(0).toUpperCase() || 'S'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-semibold leading-snug text-slate-900">{companyName}</span>
            {companyLocation && <span className="block truncate text-[11px] text-slate-500">{companyLocation}</span>}
          </span>
        </div>
      </div>

      {/* The list scrolls by itself in a low window; the logo above and the study tools below stay in place. */}
      <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-sm font-medium">
        {MENU_GROUPS.map((group, index) => (
          <div key={group.heading ?? index} role={group.heading ? 'group' : undefined} aria-labelledby={group.heading ? `menu-group-${index}` : undefined}>
            {/* Group headings are plain words: no icon, so that every icon in the menu stands for one screen. */}
            {group.heading && <p id={`menu-group-${index}`} className="px-3.5 pb-1 text-xs font-semibold text-slate-500">{group.heading}</p>}
            <ul className="space-y-0.5">
              {group.tabs.map((tab) => {
                const Icon = NAV_ICONS[tab];
                const active = currentTab === tab;
                const badge = badges[tab];
                return (
                  <li key={tab}>
                    {/* One style for the open screen, whichever group it is in: tint, brand text and a bar on the left.
                        The text takes the darker brand tone: on the tint the lighter one is too pale for its size. */}
                    <button
                      type="button"
                      onClick={() => onSelectTab(tab)}
                      aria-current={active ? 'page' : undefined}
                      className={`relative flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF] ${
                        active
                          ? 'bg-[#5551FF]/10 font-semibold text-[#433fd8] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-[#5551FF]'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">{SCREEN_NAMES[tab]}</span>
                      {badge && badge.count > 0 && (
                        <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
                          {badge.count}<span className="sr-only"> {badge.what}</span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Study tools stay out of the product and return with the research switch. */}
      <StudyTools onOpenPilotInterest={onOpenPilotInterest} className="mt-4 shrink-0 border-t border-slate-200/60 pt-4" />
    </aside>
  );
};
