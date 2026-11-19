import React, { useRef } from 'react';

interface SectionTabsProps<T extends string> {
  /** What the tabs divide, for screen readers: "Team", "Settings". */
  label: string;
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  /** Start of the ids that tie the tabs to their panel (see sectionPanel). */
  idPrefix: string;
}

/**
 * The tabs of a page that holds several parts (Team, Settings). One part is shown at a time;
 * the arrow keys move between the tabs, as in any tab list.
 */
export function SectionTabs<T extends string>({ label, tabs, active, onChange, idPrefix }: SectionTabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const handleKey = (event: React.KeyboardEvent, index: number) => {
    const target = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? tabs.length - 1 : -1;
    if (target < 0) return;
    event.preventDefault();
    onChange(tabs[target].id);
    // Focus follows the choice.
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus();
  };
  return (
    // Phones: a grid, so that four names fit a 320 px screen without scrolling sideways. Wider: one row.
    <div ref={listRef} role="tablist" aria-label={label}
      className={`grid ${tabs.length > 3 ? 'grid-cols-2' : 'grid-cols-3'} gap-1 rounded-2xl bg-slate-200/60 p-1 text-sm font-semibold sm:inline-flex`}>
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button key={tab.id} type="button" role="tab" id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={selected} aria-controls={selected ? `${idPrefix}-panel` : undefined} tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)} onKeyDown={(event) => handleKey(event, index)}
            className={`min-h-11 rounded-xl px-2 py-2 text-center leading-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF] sm:px-4 ${
              selected ? 'bg-white text-[#5551FF] shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** What the element that holds the open part needs, so that a screen reader ties it to its tab. */
export const sectionPanel = (idPrefix: string, active: string) => ({
  role: 'tabpanel', id: `${idPrefix}-panel`, 'aria-labelledby': `${idPrefix}-tab-${active}`,
} as const);
