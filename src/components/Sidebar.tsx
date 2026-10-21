import React, { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  MessageSquare,
  Store,
  CalendarDays,
  Users,
  Box,
  UserCheck,
  Scissors,
  BarChart3,
  Settings as SettingsIcon,
  X,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { NavigationTab } from '../types';

interface SidebarProps {
  companyName: string;
  companyLocation?: string;
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  pendingRequestsCount: number;
  onOpenPilotInterest: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  companyName,
  companyLocation,
  currentTab,
  onSelectTab,
  isOpenMobile,
  onCloseMobile,
  pendingRequestsCount,
  onOpenPilotInterest,
}) => {
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onCloseMobile);
  closeRef.current = onCloseMobile;
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(desktop.matches);
    update();
    desktop.addEventListener('change', update);
    return () => desktop.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isOpenMobile || isDesktop) return;
    const sidebar = sidebarRef.current;
    const content = document.getElementById('app-content');
    if (!sidebar) return;
    const wasInert = content?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    if (content) content.inert = true;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      // A native dialog opened from navigation manages its own focus.
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const controls = Array.from(sidebar.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]'))
          .filter(element => element.getClientRects().length > 0 && !element.hasAttribute('disabled'));
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (content) content.inert = wasInert;
      document.body.style.overflow = previousOverflow;
      if (sidebar.contains(document.activeElement) && !document.querySelector('dialog[open]')) {
        document.getElementById('mobile-menu-trigger')?.focus({ preventScroll: true });
      }
    };
  }, [isOpenMobile, isDesktop]);

  const handleNav = (tab: NavigationTab) => {
    onSelectTab(tab);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs lg:hidden transition-opacity"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        ref={sidebarRef}
        id="mobile-sidebar"
        role={isOpenMobile && !isDesktop ? 'dialog' : undefined}
        aria-modal={isOpenMobile && !isDesktop ? true : undefined}
        aria-label="Main navigation"
        inert={!isDesktop && !isOpenMobile}
        className={`fixed top-0 left-0 z-50 h-dvh w-64 max-w-[calc(100vw-2rem)] shrink-0 overflow-y-auto overscroll-contain bg-[#F8F9FD] border-r border-slate-200/60 flex flex-col p-5 lg:visible lg:sticky lg:self-start lg:translate-x-0 ${
          isOpenMobile
            ? 'visible translate-x-0 [transition:translate_300ms_ease-in-out,visibility_0s]'
            : 'invisible -translate-x-full [transition:translate_300ms_ease-in-out,visibility_0s_linear_300ms]'
        }`}
      >
        {/* Salon identity. Home is the single dashboard navigation item. */}
        <div className="flex shrink-0 items-center justify-between mb-8">
          <div className="min-w-0 flex items-center gap-3 px-2 py-2.5">
            <span aria-hidden="true" className="w-8 h-8 rounded-xl bg-[#5551FF] text-white flex items-center justify-center font-bold text-sm shrink-0">{companyName.trim().charAt(0).toUpperCase() || 'S'}</span>
            <p className="min-w-0 break-words font-semibold text-sm text-slate-900 leading-snug">{companyName}</p>
          </div>

          {/* Mobile Close Button */}
          <button
            ref={closeButtonRef}
            onClick={onCloseMobile}
            className="lg:hidden ml-2 flex h-11 w-11 shrink-0 items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded-lg"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 space-y-1 pr-1 text-sm font-medium text-slate-500">
          {/* Home */}
          <button
            onClick={() => handleNav('home')}
            aria-current={currentTab === 'home' ? 'page' : undefined}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-colors ${
              currentTab === 'home'
                ? 'bg-[#5551FF]/10 text-[#5551FF] font-semibold'
                : 'hover:bg-slate-100 text-slate-600'
            }`}
          >
            <div className="flex items-center gap-3">
              {/* 3 vertical bars icon from Figma */}
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <rect x="2" y="7" width="2.5" height="7" rx="0.75" />
                <rect x="6.75" y="4" width="2.5" height="10" rx="0.75" />
                <rect x="11.5" y="2" width="2.5" height="12" rx="0.75" />
              </svg>
              <span>Home</span>
            </div>
            {pendingRequestsCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-rose-500 text-white font-semibold tabular-nums">
                {pendingRequestsCount}
              </span>
            )}
          </button>

          {/* Calendar */}
          <button
            onClick={() => handleNav('calendar')}
            aria-current={currentTab === 'calendar' ? 'page' : undefined}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
              currentTab === 'calendar'
                ? 'bg-[#5551FF] text-white font-semibold shadow-xs'
                : 'hover:bg-slate-100 text-slate-600'
            }`}
          >
            <Calendar className="w-4 h-4 shrink-0" />
            <span>Calendar</span>
          </button>

          {/* Conversations */}
          <button
            onClick={() => handleNav('conversations')}
            aria-current={currentTab === 'conversations' ? 'page' : undefined}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
              currentTab === 'conversations'
                ? 'bg-[#5551FF] text-white font-semibold shadow-xs'
                : 'hover:bg-slate-100 text-slate-600'
            }`}
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>Conversations</span>
          </button>

          {/* Your Booking Page */}
          <button
            onClick={() => handleNav('booking-page')}
            aria-current={currentTab === 'booking-page' ? 'page' : undefined}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
              currentTab === 'booking-page'
                ? 'bg-[#5551FF] text-white font-semibold shadow-xs'
                : 'hover:bg-slate-100 text-slate-600'
            }`}
          >
            <Store className="w-4 h-4 shrink-0" />
            <span>Your Booking Page</span>
          </button>

          {/* Shift Plan */}
          <button
            onClick={() => handleNav('shift-plan')}
            aria-current={currentTab === 'shift-plan' ? 'page' : undefined}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
              currentTab === 'shift-plan'
                ? 'bg-[#5551FF] text-white font-semibold shadow-xs'
                : 'hover:bg-slate-100 text-slate-600'
            }`}
          >
            <CalendarDays className="w-4 h-4 shrink-0" />
            <span>Shift Plan</span>
          </button>

          {/* Management Group */}
          <div className="pt-5 pb-1">
            <div className="flex items-center gap-2.5 px-3.5 py-1 text-slate-400 font-medium text-xs tracking-wider uppercase">
              <BarChart3 className="w-3.5 h-3.5 shrink-0" />
              <span>Management</span>
            </div>

            <div className="mt-1 space-y-0.5 pl-2">
              <button
                onClick={() => handleNav('customers')}
                aria-current={currentTab === 'customers' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl transition-colors ${
                  currentTab === 'customers'
                    ? 'bg-[#5551FF]/12 text-[#5551FF] font-semibold'
                    : 'hover:bg-slate-100 text-slate-600'
                }`}
              >
                <Users className="w-4 h-4 shrink-0" />
                <span>Customers</span>
              </button>

              <button
                onClick={() => handleNav('resources')}
                aria-current={currentTab === 'resources' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl transition-colors ${
                  currentTab === 'resources'
                    ? 'bg-[#5551FF]/12 text-[#5551FF] font-semibold'
                    : 'hover:bg-slate-100 text-slate-600'
                }`}
              >
                <Box className="w-4 h-4 shrink-0" />
                <span>Resources</span>
              </button>

              <button
                onClick={() => handleNav('employees')}
                aria-current={currentTab === 'employees' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl transition-colors ${
                  currentTab === 'employees'
                    ? 'bg-[#5551FF]/12 text-[#5551FF] font-semibold'
                    : 'hover:bg-slate-100 text-slate-600'
                }`}
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Employees</span>
              </button>

              <button
                onClick={() => handleNav('services')}
                aria-current={currentTab === 'services' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl transition-colors ${
                  currentTab === 'services'
                    ? 'bg-[#5551FF]/12 text-[#5551FF] font-semibold'
                    : 'hover:bg-slate-100 text-slate-600'
                }`}
              >
                <Scissors className="w-4 h-4 shrink-0" />
                <span>Services</span>
              </button>

              <button
                onClick={() => handleNav('analytics')}
                aria-current={currentTab === 'analytics' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl transition-colors ${
                  currentTab === 'analytics'
                    ? 'bg-[#5551FF]/12 text-[#5551FF] font-semibold'
                    : 'hover:bg-slate-100 text-slate-600'
                }`}
              >
                <BarChart3 className="w-4 h-4 shrink-0" />
                <span>Analytics</span>
              </button>
            </div>
          </div>

          {/* Settings Group */}
          <div className="pt-3 pb-2">
            <div className="flex items-center gap-2.5 px-3.5 py-1 text-slate-400 font-medium text-xs tracking-wider uppercase">
              <SettingsIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Settings</span>
            </div>

            <div className="mt-1 space-y-0.5 pl-2">
              <button
                onClick={() => handleNav('ai-assistant')}
                aria-current={currentTab === 'ai-assistant' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl transition-colors ${
                  currentTab === 'ai-assistant'
                    ? 'bg-[#5551FF]/12 text-[#5551FF] font-semibold'
                    : 'hover:bg-slate-100 text-slate-600'
                }`}
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>AI Assistant</span>
              </button>

              <button
                onClick={() => handleNav('settings')}
                aria-current={currentTab === 'settings' ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl transition-colors ${
                  currentTab === 'settings'
                    ? 'bg-[#5551FF]/12 text-[#5551FF] font-semibold'
                    : 'hover:bg-slate-100 text-slate-600'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4 shrink-0" />
                <span>Company Settings</span>
              </button>
            </div>
          </div>
        </nav>

        {/* Persistent pilot interest button. */}
        <div className="mt-auto shrink-0 border-t border-slate-200/60 pt-4">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-controls="pilot-interest-dialog"
            onClick={() => { onCloseMobile(); onOpenPilotInterest(); }}
            className="mb-4 flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]"
          >
            Register interest
          </button>
          <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-white/70 border border-slate-200/50">
            <div className="w-7 h-7 rounded-lg bg-[#5551FF]/10 text-[#5551FF] flex items-center justify-center font-bold text-xs">
              B
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-800 truncate">{companyName}</p>
              <p className="text-[11px] text-slate-400 truncate">{companyLocation}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

