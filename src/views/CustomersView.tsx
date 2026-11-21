import React, { useEffect, useRef, useState } from 'react';
import { useHorizontalOverflow } from '../useHorizontalOverflow';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Search,
  Download,
  Plus,
  X,
  MessageSquare,
} from 'lucide-react';
import { CalendarEvent, Customer } from '../types';
import { createCsv } from '../csv';
import { customerHistory, customerStatsFromCalendar, emptyCustomerStats } from '../customerStats';
import { CUSTOMER_SORT_OPTIONS, customerSortValue, nextCustomerSort, sortCustomers, type CustomerSort, type CustomerSortKey } from '../customerSort';
import { validateOptionalContact, validatePersonName } from '../managementValidation';
import { formatDate, getSalonNow } from '../scheduling';
import { customerMatches } from '../bookingData';
import { formatPhone, normalizePhone } from '../format';
import { routeHash } from '../navigation';
import { CustomerProfile } from './CustomerProfile';

interface CustomersViewProps {
  customers: Customer[];
  /** The calendar. Visits, last visit and next appointment are counted from it, not stored. */
  events: CalendarEvent[];
  /** The current moment; given by the app so the list and the Home page use the same clock. */
  now?: Date;
  timeZone?: string;
  /** Ids of the customers who have a chat. Only they get "Open conversation". */
  customersWithChat?: ReadonlySet<string>;
  /** The customer whose profile is open (the address's `customerId`), or null for the list. */
  selectedCustomerId: string | null;
  /** Back to the list. `replace` leaves no history entry, for a profile that is gone (deleted). */
  onClearSelection: (options?: { replace?: boolean }) => void;
  /** Opens a customer's profile. Without it the list opens the profile through the address. */
  onOpenCustomer?: (customerId: string) => void;
  onAddCustomer: (customer: Omit<Customer, 'id' | 'initials'>) => void;
  onUpdateCustomer: (id: string, customer: Partial<Customer>) => void;
  onDeleteCustomer: (id: string) => void;
  /**
   * Why a customer cannot be deleted at the moment (appointments or requests still use the
   * record), or null. The profile then says so instead of asking whether to delete.
   */
  cannotDelete?: (customer: Customer) => string | null;
  onOpenChat?: (customerId: string) => void;
  /** "New appointment" on a profile. Not offered until the app gives it. */
  onNewAppointment?: (customerId: string) => void;
  /** An appointment in a profile opens in the calendar. */
  onOpenAppointment?: (event: CalendarEvent) => void;
}

/** The list grows by this many customers per "Show more". */
const PAGE_SIZE = 25;

/** One set of columns for the header and every row: name, email, phone, language, last visit, next appointment, visits, chat. */
const COLUMNS = 'grid grid-cols-[170px_minmax(100px,1fr)_130px_76px_124px_168px_64px_44px]';

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
  onOpenCustomer,
  onAddCustomer,
  onUpdateCustomer,
  onDeleteCustomer,
  cannotDelete,
  onOpenChat,
  onNewAppointment,
  onOpenAppointment,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const tableRef = useRef<HTMLDivElement>(null);
  const tableScrolls = useHorizontalOverflow(tableRef);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formError, setFormError] = useState('');
  // The list opens as it is kept (most recent contact first) until the owner chooses an order.
  const [sort, setSort] = useState<CustomerSort>(null);
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
      // The customer whose name opened the form was deleted: the page's heading takes the focus.
      else if (headingRef.current) { headingRef.current.tabIndex = -1; headingRef.current.focus({ preventScroll: true }); }
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
  const filteredCustomers = sortCustomers(customers.filter((c) => customerMatches(c, filterQuery)), statsOf, sort);
  // A long list opens with its first 25 customers; "Show more" adds the next 25. Opening a
  // profile and coming back keeps the filter, the order and how far the list was opened.
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  useEffect(() => { setShownCount(PAGE_SIZE); }, [filterQuery, sort]);

  // Back from a profile, the focus returns to that customer's name in the list, where the owner left off.
  const lastProfile = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCustomerId) { lastProfile.current = selectedCustomerId; return; }
    const id = lastProfile.current;
    lastProfile.current = null;
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      const link = Array.from(document.querySelectorAll<HTMLElement>(`[data-customer-link="${CSS.escape(id)}"]`)).find((item) => item.offsetParent !== null);
      if (!link) return;
      link.focus({ preventScroll: true });
      link.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedCustomerId]);

  /** A customer's name in the list: a real link to the profile, so it can also open in a new tab. */
  const profileLink = (customer: Customer, className: string) => (
    <a
      href={routeHash({ tab: 'customers', customerId: customer.id })}
      data-customer-link={customer.id}
      onClick={(event) => {
        if (!onOpenCustomer || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onOpenCustomer(customer.id);
      }}
      className={`${className} rounded-md hover:underline focus-visible:outline-2 focus-visible:outline-indigo-500`}
    >
      {customer.name}
    </a>
  );
  const shownCustomers = filteredCustomers.slice(0, shownCount);
  const hiddenCount = filteredCustomers.length - shownCustomers.length;
  const showMore = hiddenCount > 0 && (
    <button onClick={() => setShownCount((count) => count + PAGE_SIZE)} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-[#5551FF] hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
      Show {Math.min(PAGE_SIZE, hiddenCount)} more
    </button>
  );
  const emptyText = filterQuery ? `No customers found matching "${filterQuery}"` : 'No customers yet.';

  /**
   * A column header that sorts the list. A real button, so the keyboard reaches it; the arrow
   * shows the direction, and screen readers hear it from aria-sort on the header. Above a column
   * of numbers the arrow stands in front, so the word ends where the numbers end.
   */
  const sortHeader = (key: CustomerSortKey, label: string, { cell = '', numbers = false } = {}) => {
    const direction = sort?.key === key ? sort.direction : undefined;
    const Arrow = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown;
    return (
      <div role="columnheader" aria-sort={direction} className={['flex', numbers && 'justify-end', cell].filter(Boolean).join(' ')}>
        <button
          type="button"
          onClick={() => setSort((current) => nextCustomerSort(current, key))}
          className={['-my-3.5 inline-flex min-h-11 items-center gap-1 rounded-lg font-semibold hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-[#5551FF]', numbers && 'flex-row-reverse', direction && 'text-slate-900'].filter(Boolean).join(' ')}
        >
          {label}
          <Arrow aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${direction ? 'text-[#5551FF]' : 'text-slate-400'}`} />
        </button>
      </div>
    );
  };

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
    // The rows are the customers that match the filter, in the order chosen for the list.
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

  const today = getSalonNow(timeZone, now).date;

  return (
    <>
    {/* A customer opens into a page of its own in place of the list, on phones and laptops alike:
        beside the list, a panel would squeeze the table, and more so with the assistant docked. */}
    {selectedCustomerId ? (
      <CustomerProfile
        customer={selectedCustomer}
        history={customerHistory(selectedCustomerId, customers, events, now, timeZone)}
        today={today}
        hasChat={Boolean(customersWithChat?.has(selectedCustomerId))}
        onBack={() => onClearSelection()}
        onEdit={() => selectedCustomer && openEditor(selectedCustomer)}
        onSaveNote={(note) => onUpdateCustomer(selectedCustomerId, { note: note || undefined })}
        onNewAppointment={onNewAppointment}
        onOpenChat={onOpenChat}
        onOpenAppointment={onOpenAppointment}
        deleteBlocked={selectedCustomer ? cannotDelete?.(selectedCustomer) ?? null : null}
        // The profile is gone with the customer: back to the list, and Back does not lead to it again.
        onDelete={() => { onDeleteCustomer(selectedCustomerId); onClearSelection({ replace: true }); }}
      />
    ) : (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 ref={headingRef} className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Customers
        </h1>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          {/* Search */}
          <div className="relative w-full min-w-0 sm:w-64 sm:flex-1 sm:min-w-40">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              aria-label="Filter customers"
              placeholder="Filter by name, email or phone"
              className="min-w-0 min-h-11 text-base sm:text-sm w-full pl-9 pr-3 py-2 bg-slate-100/90 rounded-xl border border-transparent focus:bg-white focus:border-[#5551FF]/40 focus:outline-hidden text-slate-700 placeholder-slate-400"
            />
          </div>

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

      {/* Phones: one card per customer so every field is readable without sideways scrolling */}
      <div className="space-y-2 md:hidden" aria-label="Customers">
        {/* Cards have no column headers to sort by: one list sets the order instead. */}
        <div className="flex items-center gap-3 pb-1">
          <label htmlFor="customer-sort" className="shrink-0 text-xs font-semibold text-slate-600">Sort by</label>
          <select
            id="customer-sort"
            value={customerSortValue(sort)}
            onChange={(event) => setSort(CUSTOMER_SORT_OPTIONS.find((option) => option.value === event.target.value)?.sort ?? null)}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-700 focus:border-[#5551FF] focus:outline-hidden"
          >
            {CUSTOMER_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        {shownCustomers.map((cust) => (
          <div key={cust.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 text-xs text-slate-700 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[11px] shrink-0">
                {cust.initials}
              </div>
              {profileLink(cust, 'flex min-h-11 min-w-0 flex-1 items-center text-left text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]')}
              <span className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold ${languageClass(cust.language)}`}>{cust.language}</span>
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
        {filteredCustomers.length === 0 && emptyText && (
          <p className="rounded-2xl border border-slate-200/80 bg-white py-10 text-center text-xs text-slate-400">{emptyText}</p>
        )}
        {filteredCustomers.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-2 text-xs text-slate-500">
            <span>Showing {shownCustomers.length} of {filteredCustomers.length} customers</span>
            {showMore}
          </div>
        )}
      </div>

      {/* Wide screens: a table. The headers of name, last visit, next appointment and visits sort it. */}
      {tableScrolls && <p id="customers-scroll-hint" className="hidden text-xs text-slate-500 md:block">Swipe horizontally to see contact details and visits. Names stay visible.</p>}
      <div ref={tableRef} role="region" aria-label="Customers" aria-describedby={tableScrolls ? 'customers-scroll-hint' : undefined} tabIndex={tableScrolls ? 0 : undefined} className="relative hidden max-w-full bg-white rounded-2xl md:rounded-b-none border border-slate-200/80 shadow-xs overflow-x-auto focus-visible:outline-2 focus-visible:outline-[#5551FF] md:block">
        <div role="table" aria-label="Customers" className="min-w-[900px]">
          {/* Header Row */}
          <div role="row" className={`${COLUMNS} border-b border-slate-100 text-xs font-semibold text-slate-500 py-3.5 pr-2 sm:pr-6 bg-slate-50`}>
            {sortHeader('name', 'Name', { cell: 'sticky left-0 z-10 bg-slate-50 -my-3.5 py-3.5 pl-4 pr-3' })}
            <div role="columnheader">Email</div>
            <div role="columnheader">Phone</div>
            <div role="columnheader" className="text-center">Language</div>
            {sortHeader('lastVisit', 'Last visit')}
            {sortHeader('nextAppointment', 'Next appointment')}
            {sortHeader('visits', 'Visits', { numbers: true })}
            <div role="columnheader"><span className="sr-only">Conversation</span></div>
          </div>

          {/* Body Rows */}
          <div role="rowgroup" className="divide-y divide-slate-100">
            {shownCustomers.map((cust) => (
              <div
                key={cust.id}
                role="row"
                className={`${COLUMNS} items-center py-3.5 pr-2 sm:pr-6 bg-white hover:bg-slate-50 transition-colors text-xs text-slate-700 group`}
              >
                {/* Name with initials circle */}
                <div role="cell" className="sticky left-0 z-10 flex items-center gap-3 self-stretch bg-white group-hover:bg-slate-50 -my-3.5 py-3.5 pl-4 pr-3">
                  <div className="w-7 h-7 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[11px] shrink-0">
                    {cust.initials}
                  </div>
                  {profileLink(cust, 'block min-h-11 min-w-0 truncate font-semibold leading-[2.75rem] text-slate-900')}
                </div>

                {/* Email */}
                <div role="cell" className="text-slate-600 truncate pr-2" title={cust.email}>{cust.email || '—'}</div>

                {/* Phone, or how a chat-only customer reached the salon */}
                {cust.phone
                  ? <div role="cell" className="text-slate-600 tabular-nums truncate pr-2" title={formatPhone(cust.phone)}>{formatPhone(cust.phone)}</div>
                  : <div role="cell" className="text-slate-500 truncate">{reachedVia(cust) ?? '—'}</div>}

                {/* Language Tag */}
                <div role="cell" className="flex justify-center">
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${languageClass(cust.language)}`}>
                    {cust.language}
                  </span>
                </div>

                {/* Last visit and next appointment, both read from the calendar */}
                <div role="cell" className="text-slate-500 truncate pr-2" title={lastVisitOf(cust)}>{lastVisitOf(cust) || '—'}</div>
                <div role="cell" className="text-slate-500 truncate pr-2" title={nextAppointmentOf(cust)}>{nextAppointmentOf(cust) || '—'}</div>

                {/* Visits, under their header */}
                <div role="cell" className="text-right font-semibold text-slate-800 tabular-nums">{statsOf(cust).visits}</div>

                {/* The way to the customer's chat. Without a chat the cell stays empty. */}
                <div role="cell" className="flex justify-end">
                  {onOpenChat && customersWithChat?.has(cust.id) && <button onClick={() => onOpenChat(cust.id)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-[#5551FF]" aria-label={`Open conversation with ${cust.name}`} title="Open conversation"><MessageSquare className="h-4 w-4" /></button>}
                </div>
              </div>
            ))}

          </div>
        </div>
        {filteredCustomers.length === 0 && emptyText && (
          <div className="py-12 text-center text-xs text-slate-400">
            {emptyText}
          </div>
        )}

      </div>
      {/* Table Footer Pagination matching Figma Page 14 */}
      <div className="-mt-6 hidden rounded-b-2xl border border-t-0 border-slate-200/80 bg-white p-4 text-xs text-slate-500 md:flex md:flex-wrap md:items-center md:justify-center md:gap-4">
        <span>Showing {shownCustomers.length} of {filteredCustomers.length} customers</span>
        {showMore}
      </div>

    </div>
    )}

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

            {/* Deleting lives on the customer's profile (CustomerProfile), not here: one place, behind one question. */}
          </form>
        </dialog>
      )}
    </>
  );
};
