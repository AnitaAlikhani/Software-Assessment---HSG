import React, { useEffect, useRef, useState } from 'react';
import { Plus, Search, StickyNote, User } from 'lucide-react';
import type { CalendarEvent, Customer } from '../types';
import { findCustomers, knownCustomerLike, type CustomerDraft } from '../appointmentForm';
import { LANGUAGE_NAMES } from '../conversationData';
import { customerHistory } from '../customerStats';
import { formatDate, formatPhone } from '../format';

interface CustomerPickerProps {
  customers: Customer[];
  value: CustomerDraft;
  onChange: (value: CustomerDraft) => void;
  /** Ids of the fields start with this, so that their labels find them. */
  id: string;
  /** The calendar and the clock: a chosen customer is shown with their visits and next appointment. */
  events: CalendarEvent[];
  now: Date;
  timeZone?: string;
  /** False while an appointment is being changed: "next appointment" would name the one that is open. */
  showHistory?: boolean;
}

/** The languages a customer can be written to in, German first: it is the one most customers here speak. */
const LANGUAGES: Customer['language'][] = ['DE', 'FR', 'IT', 'EN'];

const LABEL = 'mb-1.5 block text-xs font-semibold text-slate-700';
const FIELD = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base text-slate-900 placeholder-slate-400 focus:border-[#5551FF] focus:bg-white focus:outline-hidden sm:text-sm';
const LINK = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[#5551FF] hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]';

/** A text that reads like a phone number goes into the number field of a new customer, anything else into the name. */
const looksLikeNumber = (text: string): boolean => /^[+(\d][\d\s()./\-–]*$/.test(text.trim()) && /\d/.test(text);

/**
 * Whose appointment it is. The owner types a few letters of the name, or part of the number in
 * any spelling, and picks the customer; somebody new is entered with a name, a mobile number
 * and a language, and becomes a customer when the appointment is saved. A record that is picked
 * is never rewritten from here: only a customer without a number can be given one.
 */
export const CustomerPicker: React.FC<CustomerPickerProps> = ({
  customers, value, onChange, id, events, now, timeZone, showHistory = true,
}) => {
  const [active, setActive] = useState(-1);
  // Escape closes the list of customers found, and only a second Escape reaches the form around it.
  const [listClosed, setListClosed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  // Where the focus belongs after the picker has changed its shape: the field or the button that took the place of the control just used.
  const focusNext = useRef<'search' | 'name' | 'change' | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'search') searchRef.current?.focus();
    if (target === 'name') nameRef.current?.focus();
    if (target === 'change') changeRef.current?.focus();
  });

  const searchAgain = () => { focusNext.current = 'search'; setActive(-1); onChange({ kind: 'search', query: '' }); };
  const pick = (customer: Customer) => { focusNext.current = 'change'; onChange({ kind: 'existing', customerId: customer.id, phone: '' }); };

  // ---------- a customer from the list ----------

  if (value.kind === 'existing' || value.kind === 'kept') {
    const record = value.kind === 'existing' ? customers.find((customer) => customer.id === value.customerId) : undefined;
    const name = record?.name ?? (value.kind === 'kept' ? value.name : 'This customer');
    const history = record && showHistory ? customerHistory(record.id, customers, events, now, timeZone) : null;
    const next = history?.nextAppointment;
    return (
      <div>
        <p id={`${id}-label`} className={LABEL}>Customer</p>
        <div role="group" aria-labelledby={`${id}-label`} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-xs font-bold text-[#5551FF]">
            {record?.initials || <User className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <p className="text-sm font-semibold text-slate-900">{name}</p>
            {record ? (
              <p className="text-xs text-slate-600">
                {record.phone ? <span className="whitespace-nowrap tabular-nums">{formatPhone(record.phone)}</span> : 'No phone number'}
                {' · '}{LANGUAGE_NAMES[record.language] ?? record.language}
              </p>
            ) : (
              <p className="text-xs text-slate-600">{value.kind === 'kept' ? 'Not in your customer list' : 'No longer in your customer list'}</p>
            )}
            {history && (
              <p className="text-xs text-slate-500">
                {history.visits === 0 ? 'No visits yet' : history.visits === 1 ? '1 visit' : `${history.visits} visits`}
                {next && <> · next appointment <span className="whitespace-nowrap">{formatDate(next.date)},</span> <span className="tabular-nums">{next.startTime}</span></>}
              </p>
            )}
            {/* The note is what the owner wrote down to see before a booking: an allergy, a preference. */}
            {record?.note && (
              <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs leading-relaxed text-amber-900">
                <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 whitespace-pre-wrap"><span className="sr-only">Note: </span>{record.note}</span>
              </p>
            )}
          </div>
          <button ref={changeRef} type="button" onClick={searchAgain} aria-label={`Change customer (${name})`} className={`${LINK} -my-1.5 -mr-1.5 shrink-0`}>Change</button>
        </div>
        {value.kind === 'existing' && record && !record.phone && (
          <div className="mt-2">
            <label htmlFor={`${id}-add-phone`} className={LABEL}>Mobile number <span className="font-normal text-slate-500">(optional)</span></label>
            <input
              id={`${id}-add-phone`} type="tel" inputMode="tel" autoComplete="off" placeholder="079 123 45 67"
              value={value.phone} onChange={(event) => onChange({ ...value, phone: event.target.value })}
              aria-describedby={`${id}-add-phone-help`} className={FIELD}
            />
            <p id={`${id}-add-phone-help`} className="mt-1 text-xs text-slate-500">{record.name} has no number yet. One you enter here is saved with the customer.</p>
          </div>
        )}
      </div>
    );
  }

  // ---------- somebody new ----------

  if (value.kind === 'new') {
    const known = knownCustomerLike(customers, value.name, value.phone);
    return (
      <div role="group" aria-labelledby={`${id}-label`}>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p id={`${id}-label`} className="text-xs font-semibold text-slate-700">New customer</p>
          <button type="button" onClick={searchAgain} className={`${LINK} -my-2 -mr-2`}>
            <Search className="h-4 w-4" aria-hidden="true" />Search instead
          </button>
        </div>
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div>
            <label htmlFor={`${id}-name`} className={LABEL}>Name</label>
            <input
              ref={nameRef} id={`${id}-name`} type="text" autoComplete="off" autoCapitalize="words" placeholder="First and last name"
              value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} className={`${FIELD} bg-white`}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-phone`} className={LABEL}>Mobile number <span className="font-normal text-slate-500">(optional)</span></label>
              <input
                id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="off" placeholder="079 123 45 67"
                value={value.phone} onChange={(event) => onChange({ ...value, phone: event.target.value })} className={`${FIELD} bg-white`}
              />
            </div>
            <div>
              <label htmlFor={`${id}-language`} className={LABEL}>Language</label>
              <select
                id={`${id}-language`} value={value.language}
                onChange={(event) => onChange({ ...value, language: event.target.value as Customer['language'] })} className={`${FIELD} bg-white`}
              >
                {LANGUAGES.map((language) => <option key={language} value={language}>{LANGUAGE_NAMES[language]}</option>)}
              </select>
            </div>
          </div>
          {/* Somebody the salon may know already. The owner decides: two people can share a name or a number. */}
          {known && (
            <div role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 sm:flex sm:items-center sm:gap-3">
              <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="font-semibold">{known.name}</span>
                {known.phone && <> (<span className="whitespace-nowrap tabular-nums">{formatPhone(known.phone)}</span>)</>} is already a customer.
              </p>
              <button type="button" onClick={() => pick(known)} className="-ml-2 inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-amber-950 underline hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-700 sm:ml-0">
                Use this customer
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- searching ----------

  const found = findCustomers(customers, value.query);
  const typed = value.query.trim();
  const listOpen = typed !== '' && !listClosed;
  const { matches, more } = listOpen ? found : { matches: [], more: 0 };
  const current = Math.min(active, matches.length - 1);
  const startNew = () => {
    focusNext.current = 'name';
    onChange({ kind: 'new', name: looksLikeNumber(typed) ? '' : typed, phone: looksLikeNumber(typed) ? typed : '', language: 'DE' });
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && listOpen) {
      // Keeps the form open: what was typed stays, only the list goes.
      event.preventDefault();
      event.stopPropagation();
      setActive(-1);
      setListClosed(true);
      return;
    }
    // A closed list comes back with the arrow keys or Enter before anything is picked from it.
    if (!listOpen && typed !== '' && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault();
      setListClosed(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (matches.length === 0) return;
      event.preventDefault();
      setActive(current < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      // Enter picks: the customer the arrow keys stand on, else the first one found. With nobody found it starts a new customer.
      event.preventDefault();
      if (matches.length > 0) pick(matches[Math.max(current, 0)]);
      else if (typed) startNew();
    }
  };
  return (
    <div>
      <label htmlFor={`${id}-search`} className={LABEL}>Customer</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          ref={searchRef} id={`${id}-search`} type="text" inputMode="search" enterKeyHint="search" role="combobox"
          aria-autocomplete="list" aria-expanded={listOpen} aria-controls={`${id}-results`}
          aria-activedescendant={current >= 0 ? `${id}-result-${current}` : undefined}
          autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="Name or phone number"
          value={value.query} onChange={(event) => { setActive(-1); setListClosed(false); onChange({ kind: 'search', query: event.target.value }); }}
          onKeyDown={onKeyDown} className={`${FIELD} pl-9`}
        />
      </div>
      <div id={`${id}-results`} role="listbox" aria-label="Customers found" className={matches.length > 0 ? 'mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white' : undefined}>
        {matches.map((customer, index) => (
          <button
            key={customer.id} id={`${id}-result-${index}`} type="button" role="option" aria-selected={current === index} tabIndex={-1}
            // The field keeps the focus (and a phone its keyboard) until a customer is picked.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(customer)}
            className={`flex min-h-12 w-full items-center gap-3 border-b border-slate-100 px-3 py-1.5 text-left last:border-b-0 ${current === index ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
          >
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600">{customer.initials}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">{customer.name}</span>
              <span className="block text-xs tabular-nums text-slate-500">{customer.phone ? formatPhone(customer.phone) : 'No phone number'}</span>
            </span>
          </button>
        ))}
      </div>
      {listOpen && (
        <p role="status" className="mt-1.5 text-xs text-slate-500">
          {matches.length === 0 ? `No customer found for “${typed}”.`
            : more > 0 ? `${more} more ${more === 1 ? 'customer matches' : 'customers match'}. Type more of the name or number.`
              : ''}
        </p>
      )}
      <button type="button" onClick={startNew} className={`${LINK} -ml-2 mt-0.5`}>
        <Plus className="h-4 w-4" aria-hidden="true" />New customer
      </button>
    </div>
  );
};
