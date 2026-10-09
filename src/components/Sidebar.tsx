import React from 'react';
import {
  Calendar,
  Store,
  CalendarDays,
  Users,
  Box,
  UserCheck,
  Scissors,
  BarChart3,
  Settings as SettingsIcon,
  X,
  PieChart,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { NavigationTab } from '../types';

interface SidebarProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  pendingRequestsCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpenMobile,
  onCloseMobile,
  pendingRequestsCount,
}) => {
  const isManagementActive = [
    'customers',
    'resources',
    'employees',
    'services',
    'analytics',
  ].includes(currentTab);

  const isSettingsActive = currentTab === 'settings';

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
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 bg-[#F8F9FD] border-r border-slate-200/60 flex flex-col p-5 transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top Header / Brand Button */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => handleNav('home')}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-all shadow-xs ${
              currentTab === 'home'
                ? 'bg-[#5551FF] text-white shadow-[#5551FF]/25'
                : 'bg-white hover:bg-slate-100/80 text-slate-700 border border-slate-200/70'
            }`}
          >
            <PieChart className="w-5 h-5 shrink-0" />
            <span className="font-semibold text-[15px]">Dashboard</span>
          </button>

          {/* Mobile Close Button */}
          <button
            onClick={onCloseMobile}
            className="lg:hidden ml-2 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded-lg"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 space-y-1 overflow-y-auto pr-1 text-sm font-medium text-slate-500">
          {/* Home */}
          <button
            onClick={() => handleNav('home')}
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
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors ${
              currentTab === 'calendar'
                ? 'bg-[#5551FF] text-white font-semibold shadow-xs'
                : 'hover:bg-slate-100 text-slate-600'
            }`}
          >
            <Calendar className="w-4 h-4 shrink-0" />
            <span>Calendar</span>
          </button>

          {/* Your Booking Page */}
          <button
            onClick={() => handleNav('booking-page')}
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

        {/* Bottom Salon Badge */}
        <div className="pt-4 border-t border-slate-200/60 mt-auto">
          <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-white/70 border border-slate-200/50">
            <div className="w-7 h-7 rounded-lg bg-[#5551FF]/10 text-[#5551FF] flex items-center justify-center font-bold text-xs">
              B
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-800 truncate">Bella Hair Salon</p>
              <p className="text-[11px] text-slate-400 truncate">St. Gallen, Switzerland</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
