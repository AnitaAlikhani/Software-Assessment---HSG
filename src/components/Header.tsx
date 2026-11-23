import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, Search, Sparkles, User } from 'lucide-react';
import type { Customer, AppointmentRequest, CalendarEvent } from '../types';
import { getHeaderSearchResults, headerSearchDetail, type HeaderSearchResult } from '../headerModels';
import { researchMode } from '../flags';
import { useCloseOnBack } from '../backGesture';
import { Logo } from './Logo';
import { initialsOf } from './MoreSheet';
import { SaveIndicator } from './SalonGate';
import type { SalonStatus } from '../sharedSalon';

interface HeaderProps {
  /** The screen that is open, by the name the menu gives it. Phones and tablets show it in the top bar. */
  title: string;
  /** The signed-in person, as shown in the account block on laptops. */
  ownerName?: string;
  ownerRole?: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  customers: Customer[];
  appointmentRequests: AppointmentRequest[];
  calendarEvents: CalendarEvent[];
  onSelectCustomer?: (customer: Customer) => void;
  onSelectRequest?: (request: AppointmentRequest) => void;
  onSelectAppointment: (appointment: CalendarEvent) => void;
  /** Opens the form for a new appointment. Laptops only: phones have "+" in the tab bar. */
  onNewAppointment?: () => void;
  /** Opens the owner assistant (src/components/AssistantPanel.tsx). */
  onOpenAssistant?: () => void;
  /** On a device signed in with the owner's key: whether changes are on their way to the server. */
  saveStatus?: SalonStatus;
}

/**
 * The bar on top of every owner screen.
 *
 * Laptops: the search field, "New appointment", the Assistant and who is signed in.
 * Phones and tablets: one slim bar with the product's mark, the name of the screen, a search
 * button and the Assistant. Search takes over the bar while it is open and gives it back when
 * it is closed. Everything else a phone needs is in the tab bar at the bottom.
 */
export const Header: React.FC<HeaderProps> = ({
  title, ownerName = '', ownerRole = '',
  searchQuery, onSearchChange, customers, appointmentRequests,
  calendarEvents, onSelectCustomer, onSelectRequest, onSelectAppointment,
  onNewAppointment, onOpenAssistant, saveStatus,
}) => {
  const [resultsOpen, setResultsOpen] = useState(false);
  // Phones and tablets: whether search has taken over the bar. Laptops always show the field.
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  const searchResults = getHeaderSearchResults(customers, appointmentRequests, calendarEvents, searchQuery);
  const searchIsOpen = resultsOpen && searchQuery.trim().length > 0;
  const activeIndex = Math.min(activeResultIndex, searchResults.length - 1);
  // Study tool: with the research switch on, one notice says that this is a sample workspace.
  const research = researchMode();

  /** Phones: leave search, empty the field and hand the bar back. */
  const closeSearch = (returnFocus = true) => {
    setSearchOpen(false);
    setResultsOpen(false);
    setActiveResultIndex(-1);
    onSearchChange('');
    // After the bar is back: the button is not on screen while search is open.
    if (returnFocus) requestAnimationFrame(() => searchButtonRef.current?.focus({ preventScroll: true }));
  };

  // The field appears with the tap on the search button: put the cursor in it.
  useEffect(() => { if (searchOpen) searchInputRef.current?.focus({ preventScroll: true }); }, [searchOpen]);
  // While search has the bar, the phone's Back gesture closes it instead of leaving the screen.
  useCloseOnBack(searchRef, searchOpen, () => closeSearch());

  useEffect(() => {
    if (!resultsOpen && !searchOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (searchRef.current?.contains(event.target as Node)) return;
      // The tap goes to something else on the page: do not pull focus back to the bar.
      if (searchOpen) closeSearch(false);
      else setResultsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  // closeSearch only uses setters and the latest onSearchChange.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsOpen, searchOpen]);

  useEffect(() => {
    if (searchIsOpen && activeIndex >= 0) {
      document.getElementById(`header-search-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [searchIsOpen, activeIndex, searchQuery]);

  const selectSearchResult = (result: HeaderSearchResult) => {
    setResultsOpen(false);
    setSearchOpen(false);
    setActiveResultIndex(-1);
    onSearchChange('');
    // Release the field so the phone keyboard closes, also when the result is the page already shown.
    searchInputRef.current?.blur();
    if (result.kind === 'customer') onSelectCustomer?.(result.record);
    else if (result.kind === 'request') onSelectRequest?.(result.record);
    else onSelectAppointment(result.record);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Phones: Escape closes search altogether.
      // Laptops: it closes the results and leaves the cursor in the field.
      if (searchOpen) closeSearch();
      else { setResultsOpen(false); setActiveResultIndex(-1); }
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      searchInputRef.current?.focus();
      setResultsOpen(true);
      if (!searchResults.length) return;
      setActiveResultIndex((current) => {
        if (!searchIsOpen || current < 0) return event.key === 'ArrowDown' ? 0 : searchResults.length - 1;
        return (current + (event.key === 'ArrowDown' ? 1 : -1) + searchResults.length) % searchResults.length;
      });
    } else if (event.key === 'Enter' && searchIsOpen && searchResults.length > 0) {
      event.preventDefault();
      selectSearchResult(searchResults[activeIndex >= 0 ? activeIndex : 0]);
    }
  };

  const iconButton = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]';

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200/60 bg-white/95 px-3 backdrop-blur-md sm:px-4 lg:h-auto lg:gap-4 lg:px-8 lg:py-3.5">
      {/* Phones and tablets show no menu, so the product's mark and the name of the screen stand here. */}
      <div className={`min-w-0 flex-1 items-center gap-2.5 pl-1 lg:hidden ${searchOpen ? 'hidden' : 'flex'}`}>
        <Logo size="compact" nameClassName="hidden" />
        <span className="min-w-0 truncate text-base font-bold tracking-tight text-slate-900">{title}</span>
        {research && (
          <span title="Changes are kept in this browser"
            className="hidden shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 min-[360px]:inline-flex">
            Demo
          </span>
        )}
      </div>
      {research && (
        <span title="Changes are kept in this browser"
          className="hidden shrink-0 items-center whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 lg:inline-flex">
          Demo&nbsp;workspace<span className="hidden xl:inline">&nbsp;· sample data</span>
        </span>
      )}

      {/* Search. Laptops: always in the bar. Phones and tablets: only after a tap on the search button. */}
      <div ref={searchRef}
        className={`min-w-0 flex-1 items-center gap-1 lg:relative lg:flex lg:max-w-md ${searchOpen ? 'flex' : 'hidden'}`}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setResultsOpen(false); }}
        onKeyDown={handleSearchKeyDown}>
        <button type="button" onClick={() => closeSearch()} aria-label="Close search"
          className={`${iconButton} text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:hidden`}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="relative min-w-0 flex-1">
          <label htmlFor="header-search" className="sr-only">Find customers, requests or appointments</label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input ref={searchInputRef} id="header-search" type="search" role="combobox"
            aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={searchIsOpen}
            aria-controls="header-search-results"
            aria-activedescendant={searchIsOpen && activeIndex >= 0 ? `header-search-option-${activeIndex}` : undefined}
            autoComplete="off" value={searchQuery}
            onChange={(event) => { onSearchChange(event.target.value); setActiveResultIndex(-1); setResultsOpen(true); }}
            onFocus={() => setResultsOpen(true)}
            placeholder="Find customer or booking"
            className="w-full min-h-11 rounded-full border border-transparent bg-slate-100/80 py-2 pl-10 pr-4 text-base text-slate-700 placeholder-slate-400 transition-all hover:bg-slate-100 focus:border-[#5551FF]/40 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#5551FF]/15 lg:text-sm" />
        </div>
        {searchIsOpen && (
          <div className="absolute left-3 right-3 top-full z-50 mt-2 rounded-2xl border border-slate-200/80 bg-white p-2 shadow-xl sm:left-4 sm:right-4 lg:left-0 lg:right-0">
            <div id="header-search-results" role="listbox" aria-label="Search results" className="max-h-[min(20rem,calc(100dvh-9rem))] overflow-y-auto overscroll-contain">
              {searchResults.map((result, index) => {
                const name = result.kind === 'customer' ? result.record.name : result.record.customerName;
                const category = result.kind === 'customer' ? 'Customer' : result.kind === 'request' ? 'Pending request' : 'Confirmed appointment';
                const detail = headerSearchDetail(result);
                return (
                  <button type="button" role="option" tabIndex={-1} aria-selected={activeIndex === index}
                    id={`header-search-option-${index}`} key={`${result.kind}:${result.record.id}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onFocus={() => setActiveResultIndex(index)}
                    onClick={() => selectSearchResult(result)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${activeIndex === index ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : 'hover:bg-slate-50'}`}>
                    <span className="block break-words text-[10px] font-semibold text-slate-400">{category}</span>
                    <span className="mt-0.5 block break-words font-semibold text-slate-800">{name}</span>
                    {detail && <span className="mt-0.5 block break-words text-[11px] text-slate-500">{detail}</span>}
                  </button>
                );
              })}
            </div>
            {searchResults.length === 0 && <p role="status" className="py-3 text-center text-xs text-slate-400">No matching customers, requests or appointments</p>}
            {searchResults.length > 0 && <p className="sr-only" role="status">{searchResults.length} results. Use the arrow keys to choose and Enter to open.</p>}
          </div>
        )}
      </div>

      <div className={`shrink-0 items-center gap-1 lg:ml-auto lg:flex lg:gap-3 ${searchOpen ? 'hidden' : 'flex'}`}>
        <SaveIndicator status={saveStatus} />
        <button ref={searchButtonRef} type="button" onClick={() => setSearchOpen(true)} aria-label="Search" aria-expanded={searchOpen} aria-controls="header-search"
          className={`${iconButton} text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:hidden`}>
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
        {onNewAppointment && (
          <button type="button" onClick={onNewAppointment}
            className="hidden min-h-11 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#5551FF] px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#433fd8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF] lg:inline-flex">
            <Plus className="h-4 w-4" aria-hidden="true" />New appointment
          </button>
        )}
        {onOpenAssistant && (
          // One primary action per bar: "New appointment" on laptops, "+" in the tab bar on phones.
          // The Assistant is the tinted button next to it, with its name where there is room.
          <button id="assistant-trigger" type="button" onClick={onOpenAssistant}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#5551FF]/10 text-xs font-semibold text-[#5551FF] transition-colors hover:bg-[#5551FF]/18 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF] lg:px-3.5"
            title="Assistant" aria-label="Open assistant" aria-haspopup="dialog">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Assistant</span>
          </button>
        )}
        {/* Who is signed in. A plain block, not a button: there is no account page to open, and the
            way to the salon's settings is the menu. */}
        <div className="hidden items-center gap-2.5 pl-1 lg:flex">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5551FF]/10 text-[11px] font-bold text-[#5551FF] ring-1 ring-[#5551FF]/20">
            {initialsOf(ownerName) || <User className="h-4 w-4" />}
          </span>
          {ownerName && (
            <p className="flex flex-col text-left">
              <span className="sr-only">Signed in as </span>
              <span className="whitespace-nowrap text-xs font-semibold leading-tight text-slate-800">{ownerName}</span>
              {ownerRole && <span className="text-[11px] font-medium leading-tight text-slate-500">{ownerRole}</span>}
            </p>
          )}
        </div>
      </div>
    </header>
  );
};
