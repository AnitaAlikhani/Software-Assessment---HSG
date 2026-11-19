import React, { useEffect, useRef, useState } from 'react';
import { useHorizontalOverflow } from '../useHorizontalOverflow';
import {
  Search,
  SlidersHorizontal,
  Download,
  Plus,
  Trash2,
  X,
  MessageSquare,
} from 'lucide-react';
import { CalendarEvent, Customer } from '../types';
import { createCsv } from '../csv';
import { customerStatsFromCalendar, emptyCustomerStats } from '../customerStats';
import { validateOptionalContact, validatePersonName } from '../managementValidation';
import { formatDate } from '../scheduling';
import { customerMatches } from '../bookingData';
import { formatPhone, normalizePhone } from '../format';

interface CustomersViewProps {
  customers: Customer[];
  /** The calendar. Visits, last visit and next appointment are counted from it, not stored. */
  events: CalendarEvent[];
  /** The current moment; given by the app so the list and the Home page use the same clock. */
  now?: Date;
  timeZone?: string;
  /** Ids of the customers who have a chat. Only they get "Open conversation". */
  customersWithChat?: ReadonlySet<string>;
  selectedCustomerId: string | null;
  onClearSelection: () => void;
  onAddCustomer: (customer: Omit<Customer, 'id' | 'initials'>) => void;
  onUpdateCustomer: (id: string, customer: Partial<Customer>) => void;
  onDeleteCustomer: (id: string) => void;
  onOpenChat?: (customerId: string) => void;
}

/** The list grows by this many customers per "Show more". */
const PAGE_SIZE = 25;

/** Shown in place of a phone number for someone who is only known from a chat. */
const reachedVia = (customer: Customer): string | null =>
  customer.channel === 'Website' ? 'via web chat' : customer.channel ? `via ${customer.channel}` : null;

const languageClass = (language: string) =>
  language === 'EN' ? 'bg-amber-100/70 text-amber-800'
    : language === 'FR' ? 'bg-purple-100/70 text-purple-800'
    : 'bg-emerald-100/70 text-emerald-800';

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  events,
  now,
  timeZone,
  customersWithChat,
  selectedCustomerId,
  onClearSelection,
  onAddCustomer,
  onUpdateCustomer,
  onDeleteCustomer,
  onOpenChat,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const tableRef = useRef<HTMLDivElement>(null);
  const tableScrolls = useHorizontalOverflow(tableRef);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formError, setFormError] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [languageFilter, setLanguageFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('recent');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newLang, setNewLang] = useState<'EN' | 'FR' | 'DE' | 'IT'>('EN');
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!showAddModal) return;
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('#customer-name')?.focus();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [showAddModal]);

  const stats = customerStatsFromCalendar(customers, events, now, timeZone);
  const statsOf = (customer: Customer) => stats.get(customer.id) ?? emptyCustomerStats;
  const lastVisitOf = (customer: Customer) => {
    const visit = statsOf(customer).lastVisit;
    return visit ? formatDate(visit.date) : '';
  };
  const nextAppointmentOf = (customer: Customer) => {
    const appointment = statsOf(customer).nextAppointment;
    return appointment ? `${formatDate(appointment.date)}, ${appointment.startTime}` : '';
  };

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  // A phone number is found in any spelling: "079 123", "+41 79 123" and "+4179123" are the same search.
  const filteredCustomers = (selectedCustomerId ? customers.filter(c => c.id === selectedCustomerId) : customers.filter(
    (c) => customerMatches(c, filterQuery)
  )).filter((customer) => languageFilter === 'all' || customer.language === languageFilter).sort((a, b) =>
    sortOrder === 'name' ? a.name.localeCompare(b.name) : sortOrder === 'bookings' ? statsOf(b).visits - statsOf(a).visits : 0);
  // A long list opens with its first 25 customers; "Show more" adds the next 25.
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  useEffect(() => { setShownCount(PAGE_SIZE); }, [filterQuery, languageFilter, sortOrder, selectedCustomerId]);
  const shownCustomers = filteredCustomers.slice(0, shownCount);
  const hiddenCount = filteredCustomers.length - shownCustomers.length;
  const showMore = hiddenCount > 0 && (
    <button onClick={() => setShownCount((count) => count + PAGE_SIZE)} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-[#5551FF] hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
      Show {Math.min(PAGE_SIZE, hiddenCount)} more
    </button>
  );

  const openEditor = (customer: Customer | null = null) => {
    setEditingCustomer(customer);
    setNewName(customer?.name ?? ''); setNewEmail(customer?.email ?? '');
    setNewPhone(formatPhone(customer?.phone ?? '')); setNewLang(customer?.language ?? 'EN');
    setFormError(''); setShowAddModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const error = validatePersonName(newName, 'the customer’s') ?? validateOptionalContact(newEmail, newPhone);
    if (error) { setFormError(error); return; }
    const details = {
      name: newName.trim(),
      email: newEmail.trim(),
      // Stored once, in the international form; the list writes it out again.
      phone: newPhone.trim() ? normalizePhone(newPhone) : '',
      language: newLang,
    };
    if (editingCustomer) onUpdateCustomer(editingCustomer.id, details);
    else onAddCustomer(details);

    setNewName('');
    setNewEmail('');
    setNewPhone('');
    setShowAddModal(false);
  };

  const handleExportCSV = () => {
    const headers = ['Name', 'Email', 'Phone', 'Language', 'Last visit', 'Next appointment', 'Visits'];
    // A file carries dates as data (YYYY-MM-DD), like the appointment export, so a spreadsheet
    // reads them as dates in every language. Every phone number is written the same way.
    const rows = filteredCustomers.map((c) => {
      const { lastVisit, nextAppointment, visits } = statsOf(c);
      return [
        c.name,
        c.email,
        formatPhone(c.phone),
        c.language,
        lastVisit?.date ?? '',
        nextAppointment ? `${nextAppointment.date} ${nextAppointment.startTime}` : '',
        visits,
      ];
    });
    const url = URL.createObjectURL(new Blob([createCsv([headers, ...rows])], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'customers.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Customers
        </h1>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          {/* Search */}
          <div className="relative w-full min-w-0 sm:w-64 sm:flex-1 sm:min-w-40">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => { setFilterQuery(e.target.value); if (selectedCustomerId) onClearSelection(); }}
              aria-label="Filter customers"
              placeholder="Filter by name, email or phone"
              className="min-w-0 min-h-11 text-base sm:text-sm w-full pl-9 pr-3 py-2 bg-slate-100/90 rounded-xl border border-transparent focus:bg-white focus:border-[#5551FF]/40 focus:outline-hidden text-slate-700 placeholder-slate-400"
            />
          </div>

          <button onClick={() => setShowOptions((value) => !value)} aria-expanded={showOptions} aria-controls="customer-options" className="flex min-h-11 items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            <span>Options</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
            title="Export all customers that match the filter"
            aria-label="Export customers CSV"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={() => openEditor()}
            className="flex min-h-11 items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Customer</span>
          </button>
        </div>
      </div>

      {showOptions && <div id="customer-options" className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 text-xs">
        <label className="flex min-w-0 flex-col gap-1 font-semibold text-slate-700">Language<select value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)} className="min-h-11 rounded-lg border border-slate-200 px-3 text-base sm:text-sm"><option value="all">All languages</option>{['EN', 'FR', 'DE', 'IT'].map((language) => <option key={language}>{language}</option>)}</select></label>
        <label className="flex min-w-0 flex-col gap-1 font-semibold text-slate-700">Sort by<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="min-h-11 rounded-lg border border-slate-200 px-3 text-base sm:text-sm"><option value="recent">Default order</option><option value="name">Name A–Z</option><option value="bookings">Most visits</option></select></label>
        <button onClick={() => { setLanguageFilter('all'); setSortOrder('recent'); setFilterQuery(''); onClearSelection(); }} className="min-h-11 px-3 font-semibold text-[#5551FF]">Reset filters</button>
        <p className="w-full text-slate-500">CSV export includes all customers that match the filter, in this order.</p>
      </div>}

      {selectedCustomerId && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-slate-700">
        <span>{selectedCustomer ? `Showing ${selectedCustomer.name}` : 'This customer is no longer available.'}</span>
        <button onClick={() => { setFilterQuery(''); onClearSelection(); }} className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-[#5551FF] underline hover:bg-indigo-100/60">View all customers</button>
      </div>}

      {/* Phones: one card per customer so every field is readable without sideways scrolling */}
      <div className="space-y-2 md:hidden" aria-label="Customers">
        {shownCustomers.map((cust) => (
          <div key={cust.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 text-xs text-slate-700 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[11px] shrink-0">
                {cust.initials}
              </div>
              <button onClick={() => openEditor(cust)} className="min-h-11 min-w-0 flex-1 text-left text-sm font-semibold text-slate-900 [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-indigo-500" aria-label={`Edit ${cust.name}`} title={`Edit ${cust.name}`}>{cust.name}</button>
              <span className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold ${languageClass(cust.language)}`}>{cust.language}</span>
              <button
                onClick={() => onDeleteCustomer(cust.id)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-slate-500 hover:text-rose-500 hover:bg-rose-50 rounded-lg focus-visible:outline-2 focus-visible:outline-[#5551FF]"
                aria-label={`Delete ${cust.name}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
              <dt className="text-slate-400">Email</dt><dd className="min-w-0 text-slate-600">{cust.email || '—'}</dd>
              <dt className="text-slate-400">Phone</dt>{cust.phone ? <dd className="min-w-0 tabular-nums text-slate-600">{formatPhone(cust.phone)}</dd> : <dd className="min-w-0 text-slate-500">{reachedVia(cust) ?? '—'}</dd>}
              <dt className="text-slate-400">Last visit</dt><dd className="min-w-0 text-slate-500">{lastVisitOf(cust) || '—'}</dd>
              <dt className="text-slate-400">Next appointment</dt><dd className="min-w-0 text-slate-500">{nextAppointmentOf(cust) || '—'}</dd>
              <dt className="text-slate-400">Visits</dt><dd className="min-w-0 font-semibold tabular-nums text-slate-800">{statsOf(cust).visits}</dd>
            </dl>
            {onOpenChat && customersWithChat?.has(cust.id) && <button onClick={() => onOpenChat(cust.id)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 font-semibold text-[#5551FF] hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]" aria-label={`Open conversation with ${cust.name}`}><MessageSquare className="h-4 w-4" />Open conversation</button>}
          </div>
        ))}
        {filteredCustomers.length === 0 && (
          <p className="rounded-2xl border border-slate-200/80 bg-white py-10 text-center text-xs text-slate-400">No customers found matching "{filterQuery}"</p>
        )}
        {filteredCustomers.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-2 text-xs text-slate-500">
            <span>Showing {shownCustomers.length} of {filteredCustomers.length} customers</span>
            {showMore}
          </div>
        )}
      </div>

      {/* Customers Table matching Figma Page 14 */}
      {tableScrolls && <p id="customers-scroll-hint" className="hidden text-xs text-slate-500 md:block">Swipe horizontally to see contact details and actions. Names stay visible.</p>}
      <div ref={tableRef} role="region" aria-label="Customers" aria-describedby={tableScrolls ? 'customers-scroll-hint' : undefined} tabIndex={tableScrolls ? 0 : undefined} className="relative hidden max-w-full bg-white rounded-2xl md:rounded-b-none border border-slate-200/80 shadow-xs overflow-x-auto focus-visible:outline-2 focus-visible:outline-[#5551FF] md:block">
        <div className="min-w-[900px]">
          {/* Header Row */}
          <div className="grid grid-cols-[170px_minmax(100px,1fr)_130px_76px_124px_168px_124px] border-b border-slate-100 text-xs font-semibold text-slate-400 py-3.5 pr-2 sm:pr-6 bg-slate-50">
            <div className="sticky left-0 z-10 bg-slate-50 -my-3.5 py-3.5 pl-4 pr-3">Name</div>
            <div>Email</div>
            <div>Phone</div>
            <div className="text-center">Language</div>
            <div>Last visit</div>
            <div>Next appointment</div>
            <div className="text-right">Visits / Actions</div>
          </div>

          {/* Body Rows */}
          <div className="divide-y divide-slate-100">
            {shownCustomers.map((cust) => (
              <div
                key={cust.id}
                className="grid grid-cols-[170px_minmax(100px,1fr)_130px_76px_124px_168px_124px] items-center py-3.5 pr-2 sm:pr-6 bg-white hover:bg-slate-50 transition-colors text-xs text-slate-700 group"
              >
                {/* Name with initials circle */}
                <div className="sticky left-0 z-10 flex items-center gap-3 self-stretch bg-white group-hover:bg-slate-50 -my-3.5 py-3.5 pl-4 pr-3">
                  <div className="w-7 h-7 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[11px] shrink-0">
                    {cust.initials}
                  </div>
                  <button onClick={() => openEditor(cust)} className="min-h-11 min-w-0 font-semibold text-slate-900 truncate text-left hover:underline focus-visible:outline-2 focus-visible:outline-indigo-500" aria-label={`Edit ${cust.name}`} title={`Edit ${cust.name}`}>{cust.name}</button>
                </div>

                {/* Email */}
                <div className="text-slate-600 truncate pr-2" title={cust.email}>{cust.email || '—'}</div>

                {/* Phone, or how a chat-only customer reached the salon */}
                {cust.phone
                  ? <div className="text-slate-600 tabular-nums truncate pr-2" title={formatPhone(cust.phone)}>{formatPhone(cust.phone)}</div>
                  : <div className="text-slate-500 truncate">{reachedVia(cust) ?? '—'}</div>}

                {/* Language Tag */}
                <div className="flex justify-center">
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${languageClass(cust.language)}`}>
                    {cust.language}
                  </span>
                </div>

                {/* Last visit and next appointment, both read from the calendar */}
                <div className="text-slate-500 truncate pr-2" title={lastVisitOf(cust)}>{lastVisitOf(cust) || '—'}</div>
                <div className="text-slate-500 truncate pr-2" title={nextAppointmentOf(cust)}>{nextAppointmentOf(cust) || '—'}</div>

                {/* Visits, chat & trash */}
                <div className="flex items-center justify-end gap-1">
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {statsOf(cust).visits}
                  </span>
                  {/* Without a chat the button's place stays empty, so the visit counts line up. */}
                  {onOpenChat && customersWithChat?.has(cust.id)
                    ? <button onClick={() => onOpenChat(cust.id)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-[#5551FF]" aria-label={`Open conversation with ${cust.name}`} title="Open conversation"><MessageSquare className="h-4 w-4" /></button>
                    : <span aria-hidden="true" className="h-11 w-11 shrink-0" />}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCustomer(cust.id);
                    }}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-slate-500 hover:text-rose-500 hover:bg-rose-50 rounded-lg focus-visible:outline-2 focus-visible:outline-[#5551FF]"
                    title="Delete customer"
                    aria-label={`Delete ${cust.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

          </div>
        </div>
        {filteredCustomers.length === 0 && (
          <div className="py-12 text-center text-xs text-slate-400">
            No customers found matching "{filterQuery}"
          </div>
        )}

      </div>
      {/* Table Footer Pagination matching Figma Page 14 */}
      <div className="-mt-6 hidden rounded-b-2xl border border-t-0 border-slate-200/80 bg-white p-4 text-xs text-slate-500 md:flex md:flex-wrap md:items-center md:justify-center md:gap-4">
        <span>Showing {shownCustomers.length} of {filteredCustomers.length} customers</span>
        {showMore}
      </div>

      {/* Add Customer Modal */}
      {showAddModal && (
        <dialog ref={dialogRef} aria-labelledby="customer-dialog-title" onCancel={(event) => { event.preventDefault(); setShowAddModal(false); }} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-xs">
          <form
            onSubmit={handleSubmit}
            className="w-full p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 id="customer-dialog-title" className="text-base font-bold text-slate-900">{editingCustomer ? 'Edit Customer' : 'Add Customer'}</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                aria-label="Close customer editor"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="customer-name" className="font-semibold text-slate-700 block mb-1">Full Name *</label>
                <input
                  id="customer-name"
                  type="text"
                  required
                  placeholder="e.g. Sandra Meier"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                />
              </div>

              <div>
                <label htmlFor="customer-email" className="font-semibold text-slate-700 block mb-1">Email Address</label>
                <input
                  id="customer-email"
                  type="email"
                  placeholder="sandra.meier@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                />
              </div>

              <div>
                <label htmlFor="customer-phone" className="font-semibold text-slate-700 block mb-1">Phone Number</label>
                <input
                  id="customer-phone"
                  type="tel"
                  placeholder="079 123 45 67"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                />
              </div>

              <div>
                <label htmlFor="customer-language" className="font-semibold text-slate-700 block mb-1">Preferred Language</label>
                <select
                  id="customer-language"
                  value={newLang}
                  onChange={(e) => setNewLang(e.target.value as any)}
                  className="min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                >
                  <option value="EN">English (EN)</option>
                  <option value="FR">French (FR)</option>
                  <option value="DE">German (DE)</option>
                  <option value="IT">Italian (IT)</option>
                </select>
              </div>
            </div>

            {formError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{formError}</p>}
            <div className="pt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="min-h-11 flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-11 flex-1 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors"
              >
                Save Customer
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
};
