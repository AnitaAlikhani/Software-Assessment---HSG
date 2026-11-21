import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, CalendarPlus, ChevronRight, Clock, Mail, MessageSquare, Pencil, Phone, StickyNote, UserX } from 'lucide-react';
import type { CalendarEvent, Customer } from '../types';
import type { CustomerHistory } from '../customerStats';
import { LANGUAGE_NAMES } from '../conversationData';
import { addDays } from '../scheduling';
import { formatDate, formatPhone, formatTimeRange, isPhoneNumber, isSamplePhone, normalizePhone } from '../format';
import { DeleteQuestion } from './DeleteQuestion';

interface CustomerProfileProps {
  /** The customer, or undefined when the address names one that is no longer in the list. */
  customer: Customer | undefined;
  /** This customer's appointments, read from the calendar (customerHistory). */
  history: CustomerHistory;
  /** The salon's date today (YYYY-MM-DD), so the next appointment can say "Today" or "Tomorrow". */
  today: string;
  /** Whether this customer has a chat. Only then is "Open conversation" offered. */
  hasChat: boolean;
  onBack: () => void;
  onEdit: () => void;
  /** Saves the note; an empty text removes it. */
  onSaveNote: (note: string) => void;
  onNewAppointment?: (customerId: string) => void;
  onOpenChat?: (customerId: string) => void;
  onOpenAppointment?: (event: CalendarEvent) => void;
  /** Why this customer cannot be deleted at the moment, or null. */
  deleteBlocked: string | null;
  onDelete: () => void;
}

/** How many appointments a list shows before "Show all". */
export const PROFILE_LIST_LIMIT = 5;
/** Long enough for an allergy, a colour formula and a preference; short enough to read during a call. */
const NOTE_MAX_LENGTH = 1000;

/** Addresses on the reserved example domains are invented: shown as text, so a tap cannot write to nobody. */
const isInventedEmail = (email: string) => /@example\.(com|org|net)$/i.test(email.trim());

/** How a person who came in through a chat reached the salon, in words. */
const channelName = (channel: Customer['channel']): string | null =>
  channel === 'Website' ? 'Web chat' : channel ?? null;

const buttonBase = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]';
const primaryButton = `${buttonBase} bg-[#5551FF] text-white shadow-xs hover:bg-[#433fd8]`;
const secondaryButton = `${buttonBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const card = 'rounded-2xl border border-slate-200/80 bg-white shadow-xs';

/** A short day name for the next appointment where it helps most: during a call about today or tomorrow. */
const dayWord = (date: string, today: string) =>
  date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : null;

/**
 * One customer: who they are, what is booked, what has been, and one note. It opens from the
 * customer list, the Home inbox and the search, so the owner can look a person up before or
 * during a phone call. Every figure is counted from the calendar.
 */
export const CustomerProfile: React.FC<CustomerProfileProps> = ({
  customer, history, today, hasChat, onBack, onEdit, onSaveNote,
  onNewAppointment, onOpenChat, onOpenAppointment, deleteBlocked, onDelete,
}) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // A profile is a page of its own: it opens at the top, with its heading in focus, so a screen
  // reader says whose profile this is and a phone does not keep the list's scroll position.
  useEffect(() => {
    window.scrollTo?.({ top: 0, left: 0 });
    const heading = headingRef.current;
    if (heading && !document.querySelector('dialog[open]')) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [customer?.id]);

  const back = (
    <button type="button" onClick={onBack} className="-ml-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-[#5551FF] hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      All customers
    </button>
  );

  if (!customer) {
    return (
      <div className="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6 lg:p-8">
        {back}
        <div className={`${card} flex flex-col items-center gap-3 px-6 py-12 text-center`}>
          <UserX className="h-8 w-8 text-slate-300" aria-hidden="true" />
          <h1 ref={headingRef} className="text-lg font-bold text-slate-900">This customer is no longer in your list</h1>
          <p className="max-w-sm text-sm text-slate-600">They may have been deleted. Their past appointments stay in the calendar.</p>
          <button type="button" onClick={onBack} className={`${secondaryButton} mt-2`}>Back to all customers</button>
        </div>
      </div>
    );
  }

  const { upcoming, past, visits, lastVisit, nextAppointment } = history;
  const later = upcoming.slice(1);
  const channel = channelName(customer.channel);
  const phone = customer.phone;
  const nextDay = nextAppointment && dayWord(nextAppointment.date, today);

  return (
    <div className="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6 lg:p-8">
      {back}

      {/* Who: the name, how to reach them, and what the owner can do from here. */}
      <section aria-labelledby="customer-profile-name" className={`${card} p-4 sm:p-6`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-base font-bold text-[#5551FF] sm:h-14 sm:w-14 sm:text-lg">
              {customer.initials}
            </div>
            <div className="min-w-0 flex-1">
              <h1 id="customer-profile-name" ref={headingRef} className="text-xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-2xl">{customer.name}</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                {visits === 0 ? 'No visits yet' : visits === 1 ? '1 visit' : `${visits} visits`}
                {lastVisit && <> · last visit {formatDate(lastVisit.date)}</>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {onNewAppointment && (
              <button type="button" onClick={() => onNewAppointment(customer.id)} className={primaryButton}>
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />New appointment
              </button>
            )}
            {onOpenChat && hasChat && (
              <button type="button" onClick={() => onOpenChat(customer.id)} className={secondaryButton}>
                <MessageSquare className="h-4 w-4" aria-hidden="true" />Open conversation
              </button>
            )}
            <button type="button" onClick={onEdit} className={secondaryButton}>
              <Pencil className="h-4 w-4" aria-hidden="true" />Edit details
            </button>
          </div>
        </div>

        <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-slate-500">Phone</dt>
            <dd className="mt-0.5">
              {isPhoneNumber(phone) && !isSamplePhone(phone) ? (
                <a href={`tel:${normalizePhone(phone)}`} className="-ml-1 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 font-semibold text-[#5551FF] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#5551FF]">
                  <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="whitespace-nowrap tabular-nums">{formatPhone(phone)}</span>
                </a>
              ) : phone ? (
                // An invented number of the sample salon: text only, so a tap cannot call a stranger.
                <span className="inline-flex min-h-11 items-center gap-2 font-semibold text-slate-800">
                  <Phone className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="whitespace-nowrap tabular-nums">{formatPhone(phone)}</span>
                </span>
              ) : (
                <span className="inline-flex min-h-11 items-center text-slate-500">No phone number</span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-slate-500">Email</dt>
            <dd className="mt-0.5 min-w-0">
              {customer.email && !isInventedEmail(customer.email) ? (
                <a href={`mailto:${customer.email.trim()}`} className="-ml-1 inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg px-1 text-[#5551FF] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#5551FF]">
                  <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{customer.email}</span>
                </a>
              ) : customer.email ? (
                <span className="inline-flex min-h-11 max-w-full items-center gap-2 text-slate-800">
                  <Mail className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{customer.email}</span>
                </span>
              ) : (
                <span className="inline-flex min-h-11 items-center text-slate-500">No email address</span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-slate-500">Language</dt>
            <dd className="mt-0.5 text-slate-800">{LANGUAGE_NAMES[customer.language] ?? customer.language}</dd>
          </div>
          {channel && (
            <div className="min-w-0">
              <dt className="text-xs font-semibold text-slate-500">Reached the salon via</dt>
              <dd className="mt-0.5 text-slate-800">{channel}</dd>
            </div>
          )}
        </dl>

      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        {/* The note comes first on a phone: an allergy has to be seen before anything is booked. */}
        <CustomerNote key={customer.id} name={customer.name} note={customer.note ?? ''} onSave={onSaveNote} />

        {/* The next appointment, on its own and large: the answer to "when am I coming?". */}
        <section aria-labelledby="customer-next-title" className={`${card} p-4 sm:p-5 lg:col-start-1 lg:row-start-1`}>
          <h2 id="customer-next-title" className="text-sm font-bold text-slate-900">Next appointment</h2>
          {nextAppointment ? (
            <AppointmentBody event={nextAppointment} onOpen={onOpenAppointment} large dayWord={nextDay} />
          ) : (
            <p className="mt-2 text-sm text-slate-600">Nothing booked.</p>
          )}
        </section>

        <div className="space-y-4 lg:col-start-1">
          {later.length > 0 && (
            <AppointmentList id="customer-upcoming" title="Upcoming" events={later} onOpen={onOpenAppointment} />
          )}
          <AppointmentList id="customer-past" title="Past" events={past} onOpen={onOpenAppointment} empty="No visits yet." />
        </div>

        <div className="px-4 sm:px-5 lg:col-start-2">
          {/* Deleting lives here, on the customer's own page, and asks first. */}
          <DeleteQuestion
            kind="customer"
            name={customer.name}
            consequence="Their contact details and note are removed from your customer list."
            blocked={deleteBlocked}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
};

/** Date, time, service and stylist of one appointment; a button to the calendar where the app gives one. */
function AppointmentBody({ event, onOpen, large = false, dayWord = null }: {
  event: CalendarEvent; onOpen?: (event: CalendarEvent) => void; large?: boolean; dayWord?: string | null;
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className={`block font-semibold text-slate-900 ${large ? 'text-base sm:text-lg' : 'text-sm'}`}>
          {dayWord && <span className="mr-1.5 rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-bold text-[#5551FF]">{dayWord}</span>}
          {formatDate(event.date)}
        </span>
        <span className={`mt-0.5 flex flex-wrap items-center gap-x-1.5 text-slate-600 ${large ? 'text-sm' : 'text-xs'}`}>
          <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="tabular-nums">{formatTimeRange(event.startTime, event.endTime)}</span>
          <span aria-hidden="true">·</span>
          <span className="[overflow-wrap:anywhere]">{event.serviceName}</span>
          {event.staffName && <span className="text-slate-500">with {event.staffName}</span>}
        </span>
      </span>
      {onOpen && <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />}
    </>
  );
  const box = `flex w-full min-h-11 items-center gap-3 text-left ${large ? 'mt-3 rounded-xl bg-indigo-50/50 p-3 sm:p-4' : 'px-4 py-2.5 sm:px-5'}`;
  return onOpen ? (
    <button type="button" onClick={() => onOpen(event)} title="Open in calendar" className={`${box} hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF]`}>
      {content}
      <span className="sr-only">Open in calendar</span>
    </button>
  ) : <div className={box}>{content}</div>;
}

/** Upcoming or past appointments: the first few, and "Show all" for the rest. */
function AppointmentList({ id, title, events, onOpen, empty }: {
  id: string; title: string; events: CalendarEvent[]; onOpen?: (event: CalendarEvent) => void; empty?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? events : events.slice(0, PROFILE_LIST_LIMIT);
  return (
    <section aria-labelledby={`${id}-title`} className={`${card} overflow-hidden`}>
      <h2 id={`${id}-title`} className="flex items-baseline justify-between gap-2 px-4 pb-2 pt-4 text-sm font-bold text-slate-900 sm:px-5">
        {title}
        {events.length > 0 && <span className="text-xs font-semibold text-slate-500">{events.length}</span>}
      </h2>
      {events.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-slate-600 sm:px-5">{empty}</p>
      ) : (
        <ul id={`${id}-list`} className="divide-y divide-slate-100 border-t border-slate-100">
          {shown.map((event) => <li key={event.id}><AppointmentBody event={event} onOpen={onOpen} /></li>)}
        </ul>
      )}
      {events.length > PROFILE_LIST_LIMIT && (
        <div className="border-t border-slate-100 px-2 py-1">
          <button type="button" aria-expanded={showAll} aria-controls={`${id}-list`} onClick={() => setShowAll((value) => !value)} className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-[#5551FF] hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
            {showAll ? 'Show fewer' : `Show all ${events.length}`}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * The one note. It is saved when the owner leaves the field (a tap elsewhere, Tab, or leaving
 * the page): during a phone call there is no second step to forget, and nothing typed is lost.
 * Escape throws the change away.
 */
function CustomerNote({ name, note, onSave }: { name: string; note: string; onSave: (note: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const [saved, setSaved] = useState(false);
  const fieldId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const discard = useRef(false);
  const latest = useRef({ editing, draft, note, onSave });
  latest.current = { editing, draft, note, onSave };

  // The cursor goes to the end of the note: what is added most often is one more line.
  useEffect(() => {
    const field = textRef.current;
    if (!editing || !field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [editing]);
  // Leaving the page while typing (Back, a menu entry) saves too, as leaving the field does. So
  // does a reload, a closed tab, or a phone that puts the browser in the background: none of them
  // takes the cursor out of the field first.
  useEffect(() => {
    const keep = () => {
      const { editing: open, draft: text, note: stored, onSave: save } = latest.current;
      if (open && !discard.current && text.trim() !== stored) save(text.trim());
    };
    const whenHidden = () => { if (document.visibilityState === 'hidden') keep(); };
    window.addEventListener('pagehide', keep);
    document.addEventListener('visibilitychange', whenHidden);
    return () => {
      window.removeEventListener('pagehide', keep);
      document.removeEventListener('visibilitychange', whenHidden);
      keep();
    };
  }, []);

  const finish = () => {
    if (discard.current) { discard.current = false; return; }
    const text = draft.trim();
    if (text !== note) { onSave(text); setSaved(true); }
    setEditing(false);
  };
  const start = () => { discard.current = false; setDraft(note); setSaved(false); setEditing(true); };

  return (
    <section aria-labelledby={`${fieldId}-title`} className={`rounded-2xl border p-4 shadow-xs sm:p-5 lg:col-start-2 lg:row-start-1 ${note && !editing ? 'border-amber-200 bg-amber-50' : 'border-slate-200/80 bg-white'}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${fieldId}-title`} className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
          <StickyNote className={`h-4 w-4 ${note ? 'text-amber-600' : 'text-slate-400'}`} aria-hidden="true" />
          Note
        </h2>
        {!editing && (
          <button ref={openerRef} type="button" onClick={start} className="-mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[#5551FF] hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
            {note ? 'Edit note' : 'Add note'}
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2">
          <label htmlFor={fieldId} className="sr-only">Note on {name}</label>
          <textarea
            id={fieldId}
            ref={textRef}
            value={draft}
            maxLength={NOTE_MAX_LENGTH}
            rows={4}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={finish}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              discard.current = true;
              setDraft(note);
              setEditing(false);
              requestAnimationFrame(() => openerRef.current?.focus());
            }}
            aria-describedby={`${fieldId}-hint`}
            placeholder="For example an allergy, a colour formula or a preference"
            className="block w-full min-w-0 resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base text-slate-800 placeholder-slate-400 focus:border-[#5551FF] focus:bg-white focus:outline-hidden sm:text-sm"
          />
          <p id={`${fieldId}-hint`} className="mt-1.5 text-xs text-slate-500">Saved when you leave the field. Esc discards the change.</p>
        </div>
      ) : note ? (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 [overflow-wrap:anywhere]">{note}</p>
      ) : (
        <p className="mt-1 text-sm text-slate-600">No note yet. Add one for things like an allergy or a preference.</p>
      )}
      <p role="status" className="text-xs font-semibold text-emerald-700">{saved && !editing ? 'Note saved.' : ''}</p>
    </section>
  );
}
