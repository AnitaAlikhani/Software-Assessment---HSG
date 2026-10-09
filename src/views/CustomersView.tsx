import React, { useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  Download,
  Plus,
  Trash2,
  X,
  Mail,
  Phone,
  Calendar,
} from 'lucide-react';
import { Customer } from '../types';

interface CustomersViewProps {
  customers: Customer[];
  onAddCustomer: (customer: Omit<Customer, 'id' | 'initials' | 'lastBooking' | 'bookingsCount'>) => void;
  onDeleteCustomer: (id: string) => void;
  onOpenChat?: (customerName: string) => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  onAddCustomer,
  onDeleteCustomer,
  onOpenChat,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newLang, setNewLang] = useState<'EN' | 'FR' | 'DE' | 'IT'>('EN');

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(filterQuery.toLowerCase()) ||
      c.phone.includes(filterQuery)
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    onAddCustomer({
      name: newName.trim(),
      email: newEmail.trim() || 'user@example.ch',
      phone: newPhone.trim() || '+41 79 000 00 00',
      language: newLang,
    });

    setNewName('');
    setNewEmail('');
    setNewPhone('');
    setShowAddModal(false);
  };

  const handleExportCSV = () => {
    const headers = ['Name', 'Email', 'Phone', 'Language', 'Last Booking', 'Bookings'];
    const rows = customers.map((c) => [
      `"${c.name}"`,
      `"${c.email}"`,
      `"${c.phone}"`,
      `"${c.language}"`,
      `"${c.lastBooking}"`,
      c.bookingsCount,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'customers_bella_salon.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Customers
        </h1>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter by name, email or phone"
              className="w-full pl-9 pr-3 py-2 bg-slate-100/90 text-xs rounded-xl border border-transparent focus:bg-white focus:border-[#5551FF]/40 focus:outline-hidden text-slate-700 placeholder-slate-400"
            />
          </div>

          <button className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            <span>Options</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="p-2 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
            title="Download CSV"
            aria-label="Export customers CSV"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Customer</span>
          </button>
        </div>
      </div>

      {/* Customers Table matching Figma Page 14 */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto">
        <div className="min-w-[780px]">
          {/* Header Row */}
          <div className="grid grid-cols-12 border-b border-slate-100 text-xs font-semibold text-slate-400 py-3.5 px-6 bg-slate-50/50">
            <div className="col-span-3">Name</div>
            <div className="col-span-3">Email</div>
            <div className="col-span-2">Phone</div>
            <div className="col-span-1 text-center">Language</div>
            <div className="col-span-2">Last booking</div>
            <div className="col-span-1 text-right">Bookings</div>
          </div>

          {/* Body Rows */}
          <div className="divide-y divide-slate-100">
            {filteredCustomers.map((cust) => (
              <div
                key={cust.id}
                onClick={() => onOpenChat?.(cust.name)}
                title={`Open conversation with ${cust.name}`}
                className="grid grid-cols-12 items-center py-3.5 px-6 hover:bg-slate-50/60 transition-colors text-xs text-slate-700 group cursor-pointer"
              >
                {/* Name with initials circle */}
                <div className="col-span-3 flex items-center gap-3">
                  <div className="w-7 h-7 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[11px] shrink-0">
                    {cust.initials}
                  </div>
                  <span className="font-semibold text-slate-900 truncate">{cust.name}</span>
                </div>

                {/* Email */}
                <div className="col-span-3 text-slate-600 truncate pr-2">{cust.email}</div>

                {/* Phone */}
                <div className="col-span-2 text-slate-600 font-mono text-[11px] truncate">
                  {cust.phone}
                </div>

                {/* Language Tag */}
                <div className="col-span-1 flex justify-center">
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
                <div className="col-span-2 text-slate-500 truncate">{cust.lastBooking}</div>

                {/* Bookings Count & Trash */}
                <div className="col-span-1 flex items-center justify-end gap-3">
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {cust.bookingsCount}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCustomer(cust.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 rounded-md transition-opacity"
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
          1-{filteredCustomers.length} of {filteredCustomers.length} customers
        </div>
      </div>

      {/* Add Customer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-in zoom-in-95"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add Customer</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sandra Meier"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Email Address</label>
                <input
                  type="email"
                  placeholder="sandra.meier@example.ch"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Phone Number</label>
                <input
                  type="tel"
                  placeholder="+41 78 123 45 67"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Preferred Language</label>
                <select
                  value={newLang}
                  onChange={(e) => setNewLang(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                >
                  <option value="EN">English (EN)</option>
                  <option value="FR">French (FR)</option>
                  <option value="DE">German (DE)</option>
                  <option value="IT">Italian (IT)</option>
                </select>
              </div>
            </div>

            <div className="pt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors"
              >
                Save Customer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
