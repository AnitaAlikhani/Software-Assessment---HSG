import React, { useEffect, useRef, useState } from 'react';
import {
  Search, Menu, Calculator, Bell, ChevronDown, CheckCircle2, MessageSquare,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { Customer, AppointmentRequest, CalendarEvent } from '../types';
import {
  getHeaderNotifications, getHeaderSearchResults, isHeaderNotificationUnread, notificationReadTokens,
  type HeaderNotification, type HeaderSearchResult,
} from '../headerModels';

interface HeaderProps {
  onOpenMobileMenu: () => void;
  isMobileMenuOpen: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  customers: Customer[];
  appointmentRequests: AppointmentRequest[];
  calendarEvents: CalendarEvent[];
  onSelectCustomer?: (customer: Customer) => void;
  onSelectRequest?: (request: AppointmentRequest) => void;
  onSelectAppointment: (appointment: CalendarEvent) => void;
  onOpenPOSModal?: () => void;
  needsAttentionCount: number;
  needsAttentionNames: string[];
  needsAttentionRevision?: string;
  needsAttentionUpdates?: string[];
  latestAiBooking: CalendarEvent | null;
  onOpenConversations: () => void;
  onOpenSettings: () => void;
}

type Dropdown = 'search' | 'notifications' | 'profile' | null;

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
};

export const Header: React.FC<HeaderProps> = ({
  onOpenMobileMenu, isMobileMenuOpen, searchQuery, onSearchChange, customers, appointmentRequests,
  calendarEvents, onSelectCustomer, onSelectRequest, onSelectAppointment, onOpenPOSModal,
  needsAttentionCount, needsAttentionNames, needsAttentionRevision, needsAttentionUpdates, latestAiBooking,
  onOpenConversations, onOpenSettings,
}) => {
  const [openDropdown, setOpenDropdown] = useState<Dropdown>(null);
  // Below 480px the search gets its own row under the icons, so it is rendered after them in the DOM
  // (keyboard order = visual order); from 480px it sits between the menu button and the icons.
  const narrowHeader = useMediaQuery('(max-width: 479px)');
  const compactSearch = useMediaQuery('(min-width: 480px) and (max-width: 700px)');
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const [readRevisions, setReadRevisions] = useState<Record<string, string[]>>({});
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);

  const searchResults = getHeaderSearchResults(customers, appointmentRequests, calendarEvents, searchQuery);
  const searchIsOpen = openDropdown === 'search' && searchQuery.trim().length > 0;
  const activeIndex = Math.min(activeResultIndex, searchResults.length - 1);
  const notifications = getHeaderNotifications(appointmentRequests, needsAttentionCount,
    needsAttentionNames, latestAiBooking, needsAttentionRevision, needsAttentionUpdates);
  const unreadCount = notifications.filter((item) => isHeaderNotificationUnread(item, readRevisions)).length;

  useEffect(() => {
    if (!openDropdown) return;
    const container = openDropdown === 'search' ? searchRef.current
      : openDropdown === 'notifications' ? notificationsRef.current : profileRef.current;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (container?.contains(event.target as Node)) return;
      const target = event.target instanceof Element ? event.target : null;
      // Keep focus on an intentional outside control; restore the trigger after a blank-area click.
      if (openDropdown !== 'search' && container?.contains(document.activeElement) &&
          !target?.closest('button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]')) {
        if (openDropdown === 'notifications') notificationsButtonRef.current?.focus();
        else profileButtonRef.current?.focus();
      }
      setOpenDropdown(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      // Focus first: the search field's onFocus must not reopen the popup afterward.
      if (openDropdown === 'search') searchInputRef.current?.focus();
      else if (openDropdown === 'notifications') notificationsButtonRef.current?.focus();
      else profileButtonRef.current?.focus();
      setOpenDropdown(null);
      setActiveResultIndex(-1);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openDropdown]);

  useEffect(() => {
    if (searchIsOpen && activeIndex >= 0) {
      document.getElementById(`header-search-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [searchIsOpen, activeIndex, searchQuery]);

  const closeWhenFocusLeaves = (event: React.FocusEvent<HTMLDivElement>, dropdown: Dropdown) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpenDropdown((current) => current === dropdown ? null : current);
    }
  };

  const selectSearchResult = (result: HeaderSearchResult) => {
    setOpenDropdown(null);
    setActiveResultIndex(-1);
    onSearchChange('');
    // Release the field so the phone keyboard closes, also when the result is the page already shown.
    searchInputRef.current?.blur();
    if (result.kind === 'customer') onSelectCustomer?.(result.record);
    else if (result.kind === 'request') onSelectRequest?.(result.record);
    else onSelectAppointment(result.record);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      searchInputRef.current?.focus();
      setOpenDropdown('search');
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

  const markRead = (notification: HeaderNotification) => {
    setReadRevisions((previous) => ({ ...previous, [notification.id]: notification.kind === 'attention'
      ? Array.from(new Set([...(previous[notification.id] ?? []), ...notificationReadTokens(notification)]))
      : notificationReadTokens(notification) }));
  };
  const selectNotification = (notification: HeaderNotification) => {
    markRead(notification);
    setOpenDropdown(null);
    if (notification.kind === 'attention') onOpenConversations();
    else if (notification.kind === 'request') onSelectRequest?.(notification.record);
    else onSelectAppointment(notification.record);
  };
  const markAllRead = () => {
    // The action becomes disabled after reading; move focus before that happens.
    notificationsButtonRef.current?.focus();
    setReadRevisions((previous) => Object.fromEntries([
      ...Object.entries(previous), ...notifications.map((item) => [item.id, item.kind === 'attention'
        ? Array.from(new Set([...(previous[item.id] ?? []), ...notificationReadTokens(item)]))
        : notificationReadTokens(item)]),
    ]));
  };

  const searchField = (
      <div ref={searchRef} className="w-full min-w-0 min-[480px]:relative min-[480px]:mx-3 min-[480px]:w-auto min-[480px]:flex-1 min-[480px]:max-w-md sm:mx-6"
        onBlur={(event) => closeWhenFocusLeaves(event, 'search')} onKeyDown={handleSearchKeyDown}>
        <label htmlFor="header-search" className="sr-only">Find customers, requests or appointments</label>
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
          <input ref={searchInputRef} id="header-search" type="search" role="combobox"
            aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={searchIsOpen}
            aria-controls="header-search-results"
            aria-activedescendant={searchIsOpen && activeIndex >= 0 ? `header-search-option-${activeIndex}` : undefined}
            autoComplete="off" value={searchQuery}
            onChange={(event) => { onSearchChange(event.target.value); setActiveResultIndex(-1); setOpenDropdown('search'); }}
            onFocus={() => setOpenDropdown('search')}
            placeholder={compactSearch ? 'Search' : 'Find customer or booking'}
            className="w-full min-h-11 pl-10 pr-4 py-2 bg-slate-100/80 hover:bg-slate-100 focus:bg-white text-base sm:text-sm text-slate-700 placeholder-slate-400 rounded-full border border-transparent focus:border-[#5551FF]/40 focus:outline-hidden focus:ring-2 focus:ring-[#5551FF]/15 transition-all" />
        </div>
        {searchIsOpen && (
          <div className="absolute top-full left-4 right-4 mt-2 bg-white rounded-2xl min-[480px]:left-0 min-[480px]:right-0 shadow-xl border border-slate-200/80 p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
            <div id="header-search-results" role="listbox" aria-label="Search results" className="max-h-[min(20rem,calc(100dvh-9rem))] overflow-y-auto overscroll-contain">
              {searchResults.map((result, index) => {
                const title = result.kind === 'customer' ? result.record.name : result.record.customerName;
                const category = result.kind === 'customer' ? 'Customer' : result.kind === 'request' ? 'Pending request' : 'Confirmed appointment';
                const detail = result.kind === 'customer' ? `${result.record.phone} · ${result.record.email}`
                  : result.kind === 'request' ? `${result.record.serviceName} · ${result.record.dateStr} · ${result.record.timeStr}`
                  : `${result.record.serviceName} · ${result.record.dateDisplay} · ${result.record.startTime}`;
                return (
                  <button type="button" role="option" tabIndex={-1} aria-selected={activeIndex === index}
                    id={`header-search-option-${index}`} key={`${result.kind}:${result.record.id}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onFocus={() => setActiveResultIndex(index)}
                    onClick={() => selectSearchResult(result)}
                    className={`w-full px-3 py-2.5 text-left rounded-xl transition-colors text-xs ${activeIndex === index ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : 'hover:bg-slate-50'}`}>
                    <span className="block break-words text-[10px] font-semibold text-slate-400">{category}</span>
                    <span className="block mt-0.5 break-words font-semibold text-slate-800">{title}</span>
                    <span className="block mt-0.5 text-[11px] text-slate-500 break-words">{detail}</span>
                  </button>
                );
              })}
            </div>
            {searchResults.length === 0 && <p role="status" className="text-xs text-slate-400 text-center py-3">No matching customers, requests or appointments</p>}
            {searchResults.length > 0 && <p className="sr-only" role="status">{searchResults.length} results. Use the arrow keys to choose and Enter to open.</p>}
          </div>
        )}
      </div>
  );

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-y-2 px-4 sm:px-6 lg:px-8 py-2 sm:py-3.5 bg-white/95 backdrop-blur-md border-b border-slate-200/60">
      <div className="flex items-center gap-3">
        <button id="mobile-menu-trigger" type="button" onClick={onOpenMobileMenu}
          className="lg:hidden flex h-11 w-11 items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl"
          aria-label="Open navigation menu" aria-expanded={isMobileMenuOpen} aria-controls="mobile-sidebar">
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {!narrowHeader && searchField}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <button type="button" onClick={onOpenConversations}
          className="relative flex h-11 w-11 items-center justify-center rounded-xl text-[#5551FF] bg-[#5551FF]/8 hover:bg-[#5551FF]/15 transition-colors"
          title="Conversations" aria-label={`Conversations${needsAttentionCount > 0 ? `, ${needsAttentionCount} need attention` : ''}`}>
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          {needsAttentionCount > 0 && <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white tabular-nums">{needsAttentionCount}</span>}
        </button>
        <button type="button" onClick={onOpenPOSModal}
          className="relative flex h-11 w-11 items-center justify-center rounded-xl text-amber-600 bg-amber-50/80 hover:bg-amber-100/90 transition-colors border border-amber-200/60"
          title="Quick Cash Register / POS Checkout" aria-label="POS Register">
          <Calculator className="w-4 h-4" aria-hidden="true" />
        </button>

        <div ref={notificationsRef} className="static sm:relative" onBlur={(event) => closeWhenFocusLeaves(event, 'notifications')}>
          <button ref={notificationsButtonRef} type="button"
            onClick={() => setOpenDropdown((current) => current === 'notifications' ? null : 'notifications')}
            aria-expanded={openDropdown === 'notifications'} aria-controls="header-notifications"
            className="relative flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            title="Notifications" aria-label={`Notifications, ${unreadCount} unread`}>
            <Bell className="w-4 h-4" aria-hidden="true" />
            {unreadCount > 0 && <span aria-hidden="true" className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-white" />}
          </button>
          {openDropdown === 'notifications' && (
            <div id="header-notifications" role="region" aria-labelledby="header-notifications-title"
              className="absolute left-4 right-4 top-full mt-2 flex max-h-[calc(100dvh-8rem)] flex-col sm:left-auto sm:right-0 sm:w-80 sm:max-h-[calc(100dvh-6rem)] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-slate-200/80 p-4 z-50 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h2 id="header-notifications-title" className="font-semibold text-xs text-slate-800">Notifications</h2>
                <span className="text-[11px] text-slate-400" aria-live="polite">{unreadCount} unread</span>
              </div>
              {notifications.length > 0 && <button type="button" onClick={markAllRead} disabled={unreadCount === 0} className="inline-flex min-h-11 items-center text-[11px] font-semibold text-[#5551FF] hover:underline disabled:text-slate-400 disabled:no-underline">Mark all as read</button>}
              <div className="mt-2 min-h-0 space-y-2 max-h-72 overflow-y-auto overscroll-contain">
                {notifications.map((notification) => {
                  const unread = isHeaderNotificationUnread(notification, readRevisions);
                  return (
                    <button type="button" key={notification.id} onClick={() => selectNotification(notification)}
                      className={`w-full text-left p-2.5 rounded-xl text-xs text-slate-700 transition-colors flex gap-2.5 ${unread ? 'bg-indigo-50/70 hover:bg-indigo-100/70' : 'bg-slate-50 hover:bg-slate-100'}`}>
                      <span aria-hidden="true" className={`mt-1 w-2 h-2 rounded-full shrink-0 ${unread ? 'bg-[#5551FF]' : 'bg-slate-300'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="sr-only">{unread ? 'Unread. ' : 'Read. '}</span>
                        <span className="block break-words font-semibold text-slate-900">{notification.title}</span>
                        <span className="block break-words text-slate-500 mt-0.5">{notification.detail}</span>
                      </span>
                    </button>
                  );
                })}
                {notifications.length === 0 && <div className="text-center py-4 text-xs text-slate-400"><CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1.5 opacity-80" aria-hidden="true" />All caught up! No notifications.</div>}
              </div>
              <button type="button" onClick={() => {
                const attention = notifications.find((item) => item.kind === 'attention');
                if (attention) markRead(attention);
                setOpenDropdown(null); onOpenConversations();
              }} className="mt-3 flex min-h-11 w-full items-center justify-center border-t border-slate-100 pt-2 text-center text-xs font-semibold text-[#5551FF] hover:underline">View all conversations →</button>
            </div>
          )}
        </div>

        <div ref={profileRef} className="static sm:relative sm:pl-2" onBlur={(event) => closeWhenFocusLeaves(event, 'profile')}>
          <button ref={profileButtonRef} type="button"
            onClick={() => setOpenDropdown((current) => current === 'profile' ? null : 'profile')}
            aria-label="Account and salon settings" aria-expanded={openDropdown === 'profile'} aria-controls="header-account"
            className="flex min-h-11 min-w-11 items-center justify-center gap-2.5 p-1 rounded-xl hover:bg-slate-100 transition-colors">
            <div aria-hidden="true" className="relative w-8 h-8 rounded-full overflow-hidden ring-1 ring-slate-200 bg-gradient-to-tr from-amber-200 via-rose-200 to-indigo-200 flex items-center justify-center shadow-xs">
              <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
                <circle cx="18" cy="18" r="18" fill="#F4ECE6" />
                {/* Hair */}
                <path
                  d="M9 19c0-6 3.5-12 9-12s9 6 9 12c-2-2-4-2.5-6-2.5-3 0-5 1-7 2-2 1-3 1.5-5 .5z"
                  fill="#4A3427"
                />
                {/* Face */}
                <circle cx="18" cy="17" r="7.5" fill="#FDD7BA" />
                {/* Hair bangs */}
                <path
                  d="M12 14c2-3 5-4 8-3.5 2 .3 4 2 4.5 3.5-2-.5-4-.8-6-.5-2.5.4-4.5 1-6.5.5z"
                  fill="#4A3427"
                />
                {/* Body / Blazer */}
                <path
                  d="M10 32c1-6 4-8 8-8s7 2 8 8"
                  fill="#5551FF"
                />
                {/* Inner shirt */}
                <path d="M15 25h6l-3 4-3-4z" fill="#FFFFFF" />
              </svg>
            </div>
            <div aria-hidden="true" className="hidden sm:flex flex-col text-left">
              <span className="text-xs font-semibold text-slate-800 leading-tight">Anna</span>
              <span className="text-[11px] text-slate-400 font-medium leading-tight">Admin</span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block" aria-hidden="true" />
          </button>
          {openDropdown === 'profile' && (
            <div id="header-account" role="region" aria-labelledby="header-account-title" className="absolute left-4 right-4 top-full mt-2 max-h-[calc(100dvh-8rem)] overflow-y-auto sm:left-auto sm:right-0 sm:w-64 sm:max-h-[calc(100dvh-6rem)] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-slate-200/80 p-2 z-50 text-xs animate-in fade-in zoom-in-95">
              <div className="px-3 py-2 border-b border-slate-100">
                <h2 id="header-account-title" className="font-semibold text-slate-800">Anna Weber</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Bella Hair Salon · St. Gallen</p>
              </div>
              <button type="button" onClick={() => { setOpenDropdown(null); onOpenSettings(); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 mt-1 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors">
                <SettingsIcon className="w-3.5 h-3.5" aria-hidden="true" />Company settings
              </button>
              <p className="px-3 py-2 text-[11px] leading-relaxed text-slate-400">Bookings and booking settings stay in this tab after refresh. Conversations and checkout are simulated.</p>
            </div>
          )}
        </div>
      </div>
      {narrowHeader && searchField}
    </header>
  );
};
