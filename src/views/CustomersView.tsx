import React, { useEffect, useRef, useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  Download,
  Plus,
  Trash2,
  X,
  MessageSquare,
} from 'lucide-react';
import { Customer } from '../types';
import { createCsv } from '../csv';
import { validateOptionalContact } from '../managementValidation';

interface CustomersViewProps {
  customers: Customer[];
  selectedCustomerId: string | null;
  onClearSelection: () => void;
  onAddCustomer: (customer: Omit<Customer, 'id' | 'initials' | 'lastBooking' | 'bookingsCount'>) => void;
  onUpdateCustomer: (id: string, customer: Partial<Customer>) => void;
  onDeleteCustomer: (id: string) => void;
  onOpenChat?: (customerName: string) => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  selectedCustomerId,
  onClearSelection,
  onAddCustomer,
  onUpdateCustomer,
  onDeleteCustomer,
  onOpenChat,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
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

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  const filteredCustomers = (selectedCustomerId ? customers.filter(c => c.id === selectedCustomerId) : customers.filter(
    (c) =>
      c.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(filterQuery.toLowerCase()) ||
      c.phone.includes(filterQuery)
  )).filter((customer) => languageFilter === 'all' || customer.language === languageFilter).sort((a, b) =>
    sortOrder === 'name' ? a.name.localeCompare(b.name) : sortOrder === 'bookings' ? b.bookingsCount - a.bookingsCount : 0);

  const openEditor = (customer: Customer | null = null) => {
    setEditingCustomer(customer);
    setNewName(customer?.name ?? ''); setNewEmail(customer?.email ?? '');
    setNewPhone(customer?.phone ?? ''); setNewLang(customer?.language ?? 'EN');
    setFormError(''); setShowAddModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) { setFormError('Enter a customer name.'); return; }
    const error = validateOptionalContact(newEmail, newPhone);
    if (error) { setFormError(error); return; }
    const details = {
      name: newName.trim(),
      email: newEmail.trim(),
      phone: newPhone.trim(),
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
    const headers = ['Name', 'Email', 'Phone', 'Language', 'Last Booking', 'Bookings'];
    const rows = filteredCustomers.map((c) => [
      c.name,
      c.email,
      c.phone,
      c.language,
      c.lastBooking,
      c.bookingsCount,
    ]);
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
            title="Export the customers currently shown"
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
        <label className="flex min-w-0 flex-col gap-1 font-semibold text-slate-700">Sort by<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="min-h-11 rounded-lg border border-slate-200 px-3 text-base sm:text-sm"><option value="recent">Default order</option><option value="name">Name A–Z</option><option value="bookings">Most bookings</option></select></label>
        <button onClick={() => { setLanguageFilter('all'); setSortOrder('recent'); setFilterQuery(''); onClearSelection(); }} className="min-h-11 px-3 font-semibold text-[#5551FF]">Reset filters</button>
        <p className="w-full text-slate-500">CSV export includes the customers currently shown, in this order.</p>
      </div>}

      {selectedCustomerId && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-slate-700">
        <span>{selectedCustomer ? `Showing ${selectedCustomer.name}` : 'This customer is no longer available.'}</span>
        <button onClick={() => { setFilterQuery(''); onClearSelection(); }} className="font-semibold text-[#5551FF] underline">View all customers</button>
      </div>}

      {/* Customers Table matching Figma Page 14 */}
      <p id="customers-scroll-hint" className="text-xs text-slate-500 xl:hidden">Swipe horizontally to see contact details and actions. Names stay visible.</p>
      <div role="region" aria-label="Customers" aria-describedby="customers-scroll-hint" tabIndex={0} className="relative max-w-full bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto focus-visible:outline-2 focus-visible:outline-[#5551FF]">
        <div className="min-w-[928px]">
          {/* Header Row */}
          <div className="grid grid-cols-[180px_minmax(180px,1fr)_140px_80px_160px_164px] border-b border-slate-100 text-xs font-semibold text-slate-400 py-3.5 pr-2 sm:pr-6 bg-slate-50">
            <div className="sticky left-0 z-10 bg-slate-50 -my-3.5 py-3.5 pl-6 pr-3">Name</div>
            <div>Email</div>
            <div>Phone</div>
            <div className="text-center">Language</div>
            <div>Last booking</div>
            <div className="text-right">Bookings / Actions</div>
          </div>

          {/* Body Rows */}
          <div className="divide-y divide-slate-100">
            {filteredCustomers.map((cust) => (
              <div
                key={cust.id}
                className="grid grid-cols-[180px_minmax(180px,1fr)_140px_80px_160px_164px] items-center py-3.5 pr-2 sm:pr-6 bg-white hover:bg-slate-50 transition-colors text-xs text-slate-700 group"
              >
                {/* Name with initials circle */}
                <div className="sticky left-0 z-10 flex items-center gap-3 self-stretch bg-white group-hover:bg-slate-50 -my-3.5 py-3.5 pl-6 pr-3">
                  <div className="w-7 h-7 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[11px] shrink-0">
                    {cust.initials}
                  </div>
                  <button onClick={() => openEditor(cust)} className="min-h-11 min-w-0 font-semibold text-slate-900 truncate text-left hover:underline focus-visible:outline-2 focus-visible:outline-indigo-500" aria-label={`Edit ${cust.name}`} title="Edit customer">{cust.name}</button>
                </div>

                {/* Email */}
                <div className="text-slate-600 truncate pr-2">{cust.email || '—'}</div>

                {/* Phone */}
                <div className="text-slate-600 font-mono text-[11px] truncate">
                  {cust.phone || '—'}
                </div>

                {/* Language Tag */}
                <div className="flex justify-center">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                      cust.language === 'EN'
                        ? 'bg-amber-100/70 text-amber-800'
                        : cust.language === 'FR'
                        ? 'bg-purple-100/70 text-purple-800'
                        : 'bg-emerald-100/70 text-emerald-800'
                    }`}
                  >
                    {cust.language}
                  </span>
                </div>

                {/* Last Booking */}
                <div className="text-slate-500 truncate">{cust.lastBooking}</div>

                {/* Bookings Count & Trash */}
                <div className="flex items-center justify-end gap-1">
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {cust.bookingsCount}
                  </span>
                  {onOpenChat && <button onClick={() => onOpenChat(cust.name)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-[#5551FF]" aria-label={`Open conversation with ${cust.name}`} title="Open conversation"><MessageSquare className="h-4 w-4" /></button>}
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

            {filteredCustomers.length === 0 && (
              <div className="py-12 text-center text-xs text-slate-400">
                No customers found matching "{filterQuery}"
              </div>
            )}
          </div>
        </div>

        {/* Table Footer Pagination matching Figma Page 14 */}
        <div className="p-4 border-t border-slate-100 text-center text-xs text-slate-400">
          {filteredCustomers.length ? 1 : 0}-{filteredCustomers.length} of {filteredCustomers.length} customers
        </div>
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
                  placeholder="sandra.meier@example.ch"
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
                  placeholder="+41 78 123 45 67"
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
