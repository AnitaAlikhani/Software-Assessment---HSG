import React, { useState } from 'react';
import {
  Search,
  Menu,
  Calculator,
  Bell,
  ChevronDown,
  User,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { Customer, AppointmentRequest } from '../types';

interface HeaderProps {
  onOpenMobileMenu: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  customers: Customer[];
  appointmentRequests: AppointmentRequest[];
  onSelectCustomer?: (customer: Customer) => void;
  onSelectRequest?: (req: AppointmentRequest) => void;
  onOpenPOSModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenMobileMenu,
  searchQuery,
  onSearchChange,
  customers,
  appointmentRequests,
  onSelectCustomer,
  onSelectRequest,
  onOpenPOSModal,
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  const filteredCustomers = searchQuery.trim()
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.phone.includes(searchQuery)
      )
    : [];

  const filteredRequests = searchQuery.trim()
    ? appointmentRequests.filter(
        (r) =>
          r.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.serviceName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 lg:px-8 py-3.5 bg-white/95 backdrop-blur-md border-b border-slate-200/60">
      {/* Left: Mobile hamburger */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Center: Search input */}
      <div className="relative flex-1 max-w-md mx-2 sm:mx-6">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.target.value);
              setShowSearchDropdown(true);
            }}
            onFocus={() => setShowSearchDropdown(true)}
            onBlur={() => setTimeout(() => setShowSearchDropdown(false), 250)}
            placeholder="Find customers or appointments"
            className="w-full pl-10 pr-4 py-2 bg-slate-100/80 hover:bg-slate-100 focus:bg-white text-sm text-slate-700 placeholder-slate-400 rounded-full border border-transparent focus:border-[#5551FF]/40 focus:outline-hidden focus:ring-2 focus:ring-[#5551FF]/15 transition-all"
          />
        </div>

        {/* Live Search Results Dropdown */}
        {showSearchDropdown && searchQuery.trim() && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-slate-200/80 p-3 z-50 animate-in fade-in zoom-in-95 duration-150">
            {filteredCustomers.length === 0 && filteredRequests.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-3">
                No matching customers or appointments
              </p>
            ) : (
              <div className="space-y-3">
                {filteredCustomers.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
                      Customers
                    </p>
                    <div className="space-y-1">
                      {filteredCustomers.map((cust) => (
                        <button
                          key={cust.id}
                          onClick={() => {
                            onSelectCustomer?.(cust);
                            setShowSearchDropdown(false);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 text-left rounded-xl hover:bg-slate-50 transition-colors text-xs"
                        >
                          <div>
                            <span className="font-semibold text-slate-800">{cust.name}</span>
                            <span className="text-slate-400 ml-2">{cust.phone}</span>
                          </div>
                          <span className="text-[11px] text-slate-400">{cust.lastBooking}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {filteredRequests.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
                      Appointments
                    </p>
                    <div className="space-y-1">
                      {filteredRequests.map((req) => (
                        <button
                          key={req.id}
                          onClick={() => {
                            onSelectRequest?.(req);
                            setShowSearchDropdown(false);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 text-left rounded-xl hover:bg-slate-50 transition-colors text-xs"
                        >
                          <div>
                            <span className="font-semibold text-slate-800">{req.customerName}</span>
                            <span className="text-slate-500 ml-2">· {req.serviceName}</span>
                          </div>
                          <span className="text-[#5551FF] font-medium">{req.timeStr}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Zone: POS/Calculator, Bell, Profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* POS / Register Calculator Icon */}
        <button
          onClick={onOpenPOSModal}
          className="relative p-2 rounded-xl text-amber-600 bg-amber-50/80 hover:bg-amber-100/90 transition-colors border border-amber-200/60"
          title="Quick Cash Register / POS Checkout"
          aria-label="POS Register"
        >
          <Calculator className="w-4 h-4" />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
        </button>

        {/* Notification Bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            {appointmentRequests.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-white" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-200/80 p-4 z-50 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="font-semibold text-xs text-slate-800">Notifications</span>
                <span className="text-[11px] text-slate-400">
                  {appointmentRequests.length} pending
                </span>
              </div>
              <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                {appointmentRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-2.5 rounded-xl bg-slate-50 hover:bg-indigo-50/40 text-xs text-slate-700 transition-colors cursor-pointer"
                    onClick={() => {
                      onSelectRequest?.(req);
                      setShowNotifications(false);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{req.customerName}</span>
                      <span className="text-[10px] text-slate-400">{req.timeAgo}</span>
                    </div>
                    <p className="text-slate-500 mt-0.5">
                      Requested {req.serviceName} ({req.timeStr})
                    </p>
                  </div>
                ))}
                {appointmentRequests.length === 0 && (
                  <div className="text-center py-4 text-xs text-slate-400">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1.5 opacity-80" />
                    All caught up! No unread notifications.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile */}
        <div className="relative pl-1 sm:pl-2">
          <button
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            className="flex items-center gap-2.5 p-1 rounded-xl hover:bg-slate-100 transition-colors"
          >
            {/* Anna Avatar */}
            <div className="relative w-8 h-8 rounded-full overflow-hidden ring-1 ring-slate-200 bg-gradient-to-tr from-amber-200 via-rose-200 to-indigo-200 flex items-center justify-center shadow-xs">
              {/* Illustrated photo avatar matching Figma */}
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

            <div className="hidden sm:flex flex-col text-left">
              <span className="text-xs font-semibold text-slate-800 leading-tight">Anna</span>
              <span className="text-[11px] text-slate-400 font-medium leading-tight">Admin</span>
            </div>

            <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
          </button>

          {/* Profile Dropdown */}
          {showProfileMenu && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-200/80 p-2 z-50 text-xs animate-in fade-in zoom-in-95">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="font-semibold text-slate-800">Anna Weber</p>
                <p className="text-[11px] text-slate-400">anna@bellahair.ch</p>
              </div>
              <div className="py-1">
                <button
                  onClick={() => setShowProfileMenu(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Profile Settings</span>
                </button>
                <button
                  onClick={() => setShowProfileMenu(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Switch Salon</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
