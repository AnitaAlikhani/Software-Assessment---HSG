import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, Footprints, Phone, X } from 'lucide-react';
import type { Customer } from '../types';
import type { AvailabilityContext } from '../availability';
import {
  ANYONE, APPOINTMENT_SOURCES, appointmentFormView, appointmentSave, changeDraft, discardQuestion, draftTouched, openDraft, stillNeeded,
  type AppointmentDraft, type AppointmentFormRequest, type AppointmentSave, type AppointmentSource, type DraftChange, type TimeOption,
} from '../appointmentForm';
import { formatDate, formatDayMonth, formatMoney, formatTimeRange, weekdayName } from '../format';
import { CustomerPicker } from './CustomerPicker';

export interface AppointmentFormProps {
  /** What the form is opened with. Null while it is closed. */
  request: AppointmentFormRequest | null;
  /** The salon as the slot rules see it: services, team, hours, the calendar and the requests that wait. */
  salon: AvailabilityContext;
  customers: Customer[];
  /** Stores the appointment. Returns why it could not be stored, or null when it is done. */
  onSave: (save: AppointmentSave) => string | null;
  onClose: () => void;
  /** Leads to the screen where something the form needs is set up (a first service, somebody who offers it). */
  onOpenScreen?: (screen: 'services' | 'team') => void;
  /** A fixed clock, for tests. Without it the form reads the real one and keeps it fresh while it is open. */
  now?: Date;
  /** Tests start from a state the owner reaches with a few taps: the switch on, a new customer being entered. */
  initially?: Partial<AppointmentDraft>;
}

/** With more stylists than this the choice is a list field; the buttons would fill the screen. */
const STYLIST_BUTTONS = 6;
/** How long after the form has closed, and how near to the tap that closed it, a tap is taken for the second half of a double tap. */
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_PX = 30;

const LABEL = 'mb-1.5 block text-xs font-semibold text-slate-700';
const FIELD = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base text-slate-900 focus:border-[#5551FF] focus:bg-white focus:outline-hidden sm:text-sm';
const NOTE = 'mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900';
const OFFER = 'inline-flex min-h-11 items-center rounded-xl border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-950 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700';
const SWITCH_TRACK = "relative h-6 w-11 shrink-0 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#5551FF] peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus-visible:ring-2 peer-focus-visible:ring-[#5551FF] peer-focus-visible:ring-offset-2";

const SOURCE_ICONS: Partial<Record<AppointmentSource, React.ReactNode>> = {
  phone: <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />,
  'walk-in': <Footprints className="h-4 w-4 shrink-0" aria-hidden="true" />,
};

/**
 * One choice of a group, drawn as a button. It is a real radio button underneath, so the arrow
 * keys move within the group and a screen reader says how many choices there are.
 */
function Choice({ name, checked, onChoose, label, look = '', children }: {
  name: string; checked: boolean; onChoose: () => void;
  /** What a screen reader says, where the visible text is too short to stand alone. */
  label?: string;
  look?: string; children: React.ReactNode;
}) {
  return (
    <label className="relative block cursor-pointer">
      <input type="radio" name={name} checked={checked} onChange={onChoose} aria-label={label} className="peer sr-only" />
      <span className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl border text-center text-sm font-semibold transition-colors peer-checked:border-[#5551FF] peer-checked:bg-[#5551FF] peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#5551FF] ${look}`}>
        {children}
      </span>
    </label>
  );
}
const WHITE = 'border-slate-200 bg-white text-slate-700 hover:border-slate-300';
const PLAIN = `${WHITE} px-3`;
// Nothing is free there: still a choice (the form then says why), but drawn back.
const MUTED = 'border-slate-200 bg-slate-50 px-3 text-slate-400';

/**
 * The one form for adding and changing an appointment. It opens over the screen the owner is on:
 * during a phone call there is no time to find the way back. The owner picks the customer, and
 * everything else is filled in with what is free; what cannot be booked is said in place, with
 * the way out next to it. All rules are in src/appointmentForm.ts.
 */
export const AppointmentForm: React.FC<AppointmentFormProps> = (props) =>
  props.request ? <OpenForm {...props} request={props.request} /> : null;

function OpenForm({ request, salon, customers, onSave, onClose, onOpenScreen, now, initially }: AppointmentFormProps & { request: AppointmentFormRequest }) {
  const id = useId();
  // The clock the times are judged by. A form that stays open during a call must not offer a time that has passed meanwhile.
  const [clock, setClock] = useState(() => now ?? new Date());
  useEffect(() => {
    if (now) return;
    const refresh = () => setClock(new Date());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [now]);
  const salonNow = useMemo(() => ({ ...salon, now: clock }), [salon, clock]);

  const [draft, setDraft] = useState<AppointmentDraft>(() => ({ ...openDraft({ ...salon, now: clock }, customers, request), ...initially }));
  // What the form opened with: anything else in it now would be lost by closing it.
  const [opened] = useState(draft);
  const [problem, setProblem] = useState<string | null>(null);
  // The customer does not decide which times are free: typing a name works out nothing anew.
  const view = useMemo(
    () => appointmentFormView(salonNow, draft),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salonNow, draft.appointmentId, draft.serviceId, draft.employeeId, draft.date, draft.time, draft.outsideHours],
  );
  const change = (next: DraftChange) => { setProblem(null); setDraft((current) => changeDraft(salonNow, current, next)); };

  // A native dialog: focus moves into it and stays there, Escape and the phone's Back gesture
  // close it, and the page behind cannot be used meanwhile.
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    // With nobody chosen yet the cursor is in the customer field: typing starts at once.
    // Otherwise the heading takes the focus, so that no keyboard and no list opens by itself.
    const search = dialog.querySelector<HTMLInputElement>('input[role="combobox"]');
    (search ?? titleRef.current)?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  /**
   * Closes the form. With something entered in it, the form asks first, however it is closed
   * (Escape, the X, Cancel, the Back gesture): during a call one key too many must not lose a new
   * customer's name and number. After saving it closes without asking (`saved`).
   *
   * Closed with a tap, it goes away under the finger: the second half of a double tap on "Save"
   * or "Close" must not press what lies there on the page (the tab bar, the Assistant's button).
   * For a moment, a tap on that same spot does nothing. Taps elsewhere, and anything after Escape
   * or the Back gesture, work at once.
   */
  const lastTap = useRef<{ x: number; y: number; at: number } | null>(null);
  const close = (leave: () => void = onClose, saved = false) => {
    if (!saved && draftTouched(opened, draft) && !window.confirm(discardQuestion(draft))) return;
    const tap = lastTap.current;
    if (tap && performance.now() - tap.at < 100) {
      const swallow = (event: MouseEvent) => {
        if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < DOUBLE_TAP_PX) { event.preventDefault(); event.stopPropagation(); }
      };
      document.addEventListener('click', swallow, true);
      window.setTimeout(() => document.removeEventListener('click', swallow, true), DOUBLE_TAP_MS);
    }
    leave();
  };

  // On a phone the quick choice of the day scrolls sideways: the chosen day is brought into view.
  const daysRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = daysRef.current;
    const chosen = strip?.querySelector<HTMLElement>('[data-chosen="true"]');
    if (strip && chosen) strip.scrollLeft = Math.max(0, chosen.offsetLeft - parseFloat(getComputedStyle(strip).paddingLeft));
  }, [draft.date]);

  // "Book outside opening hours" stands below the times it adds. The list above it grows or
  // shrinks with the switch, so the form is scrolled by as much: the switch stays under the
  // finger, with the evening's new times right above it. (Not every browser does this by itself.)
  const bodyRef = useRef<HTMLDivElement>(null);
  const outsideRef = useRef<HTMLDivElement>(null);
  const outsideTop = useRef<number | null>(null);
  const switchOutsideHours = (on: boolean) => {
    outsideTop.current = outsideRef.current?.getBoundingClientRect().top ?? null;
    change({ outsideHours: on });
  };
  useLayoutEffect(() => {
    const before = outsideTop.current;
    outsideTop.current = null;
    if (before !== null && bodyRef.current && outsideRef.current) bodyRef.current.scrollTop += outsideRef.current.getBoundingClientRect().top - before;
  }, [draft.outsideHours]);

  /** Says why the form was not saved, and brings the part that needs the owner into view. */
  const fail = (message: string, field = 'form') => {
    setProblem(message);
    requestAnimationFrame(() => {
      const part = bodyRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`);
      part?.scrollIntoView({ block: 'nearest' });
      // A missing customer is typed in at once; everything else is read first.
      const customerField = field === 'customer' ? part?.querySelector<HTMLElement>('input') : null;
      (customerField ?? problemRef.current)?.focus({ preventScroll: true });
    });
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = appointmentSave(salonNow, customers, draft);
    if ('error' in result) { fail(result.error, result.field); return; }
    const refusal = onSave(result.save);
    // The rules had the last word (a time taken a moment ago, say): the times are worked out anew.
    if (refusal) { setClock(now ?? new Date()); fail(refusal); return; }
    close(onClose, true);
  };
  /** Enter saves only on the Save button. In a field it would save a half-filled form (a name typed, the rest untouched). */
  const noSaveOnEnter = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Enter' && target.tagName === 'INPUT') event.preventDefault();
  };

  const { editing, blocked, service, chosen, employee, dayProblem, timeProblem } = view;
  const needed = stillNeeded(draft, view);
  const who = draft.customer;
  // The summary below is read out when it changes: a name that is still being typed stays out of it.
  const customerName = who.kind === 'existing' ? customers.find((customer) => customer.id === who.customerId)?.name
    : who.kind === 'kept' ? who.name : undefined;
  const title = draft.appointmentId ? 'Edit appointment' : 'New appointment';
  // A past appointment keeps its own day in the date field; a new one starts today at the earliest.
  const firstDay = editing && editing.date < view.today ? editing.date : view.today;
  const dayInStrip = view.days.some((day) => day.date === draft.date);
  const timeButton = (option: TimeOption) => (
    <Choice
      key={option.time} name={`${id}-time`} checked={chosen?.time === option.time} onChoose={() => change({ time: option.time })}
      look={`px-1 tabular-nums bg-white text-slate-700 ${option.outside || option.offShift ? 'border-dashed border-amber-400 hover:border-amber-500' : 'border-slate-200 hover:border-slate-300'}`}
    >
      {option.time}
    </Choice>
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => { event.preventDefault(); close(); }}
      // Where the form was last tapped (a key press has no place: detail 0), for the double tap that closes it.
      onClickCapture={(event) => { lastTap.current = event.detail > 0 ? { x: event.clientX, y: event.clientY, at: performance.now() } : null; }}
      className="fixed inset-0 m-0 h-dvh max-h-dvh w-full max-w-none border-0 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-900/40 open:flex open:flex-col sm:m-auto sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100%-2rem)] sm:max-w-xl sm:rounded-2xl"
    >
      <form onSubmit={submit} onKeyDown={noSaveOnEnter} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 py-1.5 pl-4 pr-1.5 sm:pl-6 sm:pr-3">
          <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1} className="text-base font-bold text-slate-900 outline-none">{title}</h2>
          <button type="button" onClick={() => close()} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none] sm:px-6">
          {blocked ? (
            <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold leading-relaxed text-amber-950">{blocked.text}</p>
              {blocked.screen && onOpenScreen && (
                <button type="button" onClick={() => close(() => onOpenScreen(blocked.screen!))} className={`${OFFER} mt-3`}>
                  {blocked.screen === 'services' ? 'Open Services' : 'Open Team'}
                </button>
              )}
            </div>
          ) : (
            <>
              <div data-field="customer">
                <CustomerPicker
                  customers={customers} value={draft.customer} onChange={(customer) => change({ customer })} id={`${id}-customer`}
                  events={salon.events} now={clock} timeZone={salon.timeZone} showHistory={!draft.appointmentId}
                />
              </div>

              {/* Next to the customer, where it is in sight when the form opens: what is stored is what the owner saw chosen. */}
              {draft.source !== null && (
                <fieldset className="min-w-0">
                  <legend className={LABEL}>How the booking came in</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {APPOINTMENT_SOURCES.map((source) => (
                      <Choice key={source.id} name={`${id}-source`} checked={draft.source === source.id} onChoose={() => change({ source: source.id })} look={`${WHITE} whitespace-nowrap px-1`}>
                        {SOURCE_ICONS[source.id]}{source.label}
                      </Choice>
                    ))}
                  </div>
                </fieldset>
              )}

              <div data-field="service">
                <label htmlFor={`${id}-service`} className={LABEL}>Service</label>
                <select id={`${id}-service`} value={service?.id ?? ''} onChange={(event) => change({ serviceId: event.target.value })} className={FIELD}>
                  {!service && <option value="" disabled>Choose a service</option>}
                  {salon.services.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.durationMinutes} min</option>)}
                </select>
                {view.serviceNote && <p role="status" className={NOTE}>{view.serviceNote}</p>}
              </div>

              {view.stylists.length > 0 && (
                <fieldset data-field="stylist" className="min-w-0">
                  <legend className={LABEL}>Stylist</legend>
                  {view.stylists.length > STYLIST_BUTTONS ? (
                    <select aria-label="Stylist" value={view.employeeId} onChange={(event) => change({ employeeId: event.target.value })} className={FIELD}>
                      {view.employeeId === '' && <option value="" disabled>Choose a stylist</option>}
                      <option value={ANYONE}>Anyone free</option>
                      {view.stylists.map(({ employee: stylist, free }) => <option key={stylist.id} value={stylist.id}>{stylist.name}{free ? '' : ' (no free time that day)'}</option>)}
                    </select>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Choice name={`${id}-stylist`} checked={view.employeeId === ANYONE} onChoose={() => change({ employeeId: ANYONE })} look={PLAIN}>Anyone free</Choice>
                      {view.stylists.map(({ employee: stylist, free }) => (
                        <Choice
                          key={stylist.id} name={`${id}-stylist`} checked={view.employeeId === stylist.id} onChoose={() => change({ employeeId: stylist.id })}
                          label={free ? undefined : `${stylist.name}, no free time on this day`} look={free ? PLAIN : MUTED}
                        >
                          {stylist.name}
                        </Choice>
                      ))}
                    </div>
                  )}
                  {view.stylistNote && <p role="status" className={NOTE}>{view.stylistNote}</p>}
                </fieldset>
              )}

              {service && view.stylists.length > 0 && view.employeeId !== '' && (
                <>
                  <fieldset className="min-w-0">
                    <legend className={LABEL}>
                      Day <span className="ml-1 font-normal text-slate-500">{formatDate(draft.date)}</span>
                    </legend>
                    {/* Phones: one row to swipe through. Wider: the two weeks as two rows of seven. */}
                    <div ref={daysRef} className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-7 sm:overflow-visible sm:px-0 sm:pb-0">
                      {view.days.map((day) => (
                        <label key={day.date} data-chosen={day.date === draft.date} className="relative block shrink-0 cursor-pointer">
                          <input
                            type="radio" name={`${id}-day`} checked={day.date === draft.date} onChange={() => change({ date: day.date })}
                            aria-label={`${day.name || weekdayName(day.date)}, ${formatDate(day.date, { weekday: 'none' })}${day.free ? '' : ', no free time'}`} className="peer sr-only"
                          />
                          <span className={`flex h-14 w-[4.5rem] flex-col items-center justify-center rounded-xl border border-slate-200 transition-colors sm:w-auto peer-checked:border-[#5551FF] peer-checked:bg-[#5551FF] peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#5551FF] ${day.free ? 'bg-white text-slate-800 hover:border-slate-300' : 'bg-slate-50 text-slate-400'}`}>
                            <span className="text-[11px] font-semibold leading-tight">{day.name || weekdayName(day.date, 'short')}</span>
                            <span className="text-sm font-bold leading-tight tabular-nums">{formatDayMonth(day.date)}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <label htmlFor={`${id}-date`} className="shrink-0 text-xs font-semibold text-slate-600">{dayInStrip ? 'Another day' : 'Chosen day'}</label>
                      <input
                        id={`${id}-date`} type="date" min={firstDay} value={draft.date}
                        onChange={(event) => change({ date: event.target.value })} className={FIELD}
                      />
                    </div>
                  </fieldset>

                  <fieldset data-field="time" className="min-w-0">
                    <legend className={LABEL}>
                      Time {chosen && <span className="ml-1 font-normal tabular-nums text-slate-500">{formatTimeRange(chosen.time, chosen.end)}</span>}
                    </legend>
                    {timeProblem && (
                      <div role="status" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm font-semibold leading-relaxed text-amber-950">{timeProblem.text}</p>
                        <p className="mt-2 text-xs text-amber-900">Nearest free times</p>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {timeProblem.nearest.map((option) => (
                            <button key={option.time} type="button" onClick={() => change({ time: option.time })} className={`${OFFER} tabular-nums`}>{option.time}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {dayProblem ? (
                      <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm font-semibold leading-relaxed text-amber-950">{dayProblem.text}</p>
                        {dayProblem.advice && <p className="mt-1 text-xs leading-relaxed text-amber-900">{dayProblem.advice}</p>}
                        {!dayProblem.nextDay && <p className="mt-1 text-xs leading-relaxed text-amber-900">The next 90 days have no free time for this service and stylist either. Check the working hours in Team.</p>}
                        {(dayProblem.nextDay || dayProblem.othersFree || dayProblem.ownDay) && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {dayProblem.nextDay && (
                              <button type="button" onClick={() => change({ date: dayProblem.nextDay! })} className={OFFER}>
                                Next free day: {formatDate(dayProblem.nextDay)}
                              </button>
                            )}
                            {dayProblem.othersFree && (
                              <button type="button" onClick={() => change({ employeeId: ANYONE })} className={OFFER}>Anyone free on this day</button>
                            )}
                            {dayProblem.ownDay && (
                              <button type="button" onClick={() => change({ date: dayProblem.ownDay! })} className={OFFER}>Back to {formatDate(dayProblem.ownDay)}</button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {view.groups.map((group) => (
                          <div key={group.label}>
                            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</p>
                            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{group.options.map(timeButton)}</div>
                          </div>
                        ))}
                        {draft.outsideHours && view.times.some((option) => option.outside || option.offShift) && (
                          <p className="text-xs text-slate-500">A dashed time lies outside your opening hours or the stylist’s working hours.</p>
                        )}
                      </div>
                    )}
                  </fieldset>

                  <div ref={outsideRef} className={`rounded-xl border p-3 ${draft.outsideHours ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                    <label className="relative flex min-h-11 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox" role="switch" checked={draft.outsideHours} onChange={(event) => switchOutsideHours(event.target.checked)}
                        aria-describedby={`${id}-outside-help`} className="peer sr-only"
                      />
                      <span className={SWITCH_TRACK} />
                      <span className="text-sm font-semibold text-slate-800">Book outside opening hours</span>
                    </label>
                    <p id={`${id}-outside-help`} className={`mt-1 flex items-start gap-2 text-xs leading-relaxed ${draft.outsideHours ? 'text-amber-900' : 'text-slate-500'}`}>
                      {draft.outsideHours && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                      <span>
                        {draft.outsideHours
                          ? 'You can now choose times while the salon is closed or the stylist is not working. Only use this for an appointment you have agreed yourself, and make sure the stylist knows.'
                          : 'For an appointment you have agreed outside the usual hours, for example late on a Friday.'}
                      </span>
                    </p>
                  </div>
                </>
              )}

            </>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_12px_-8px_rgba(15,23,42,0.18)] sm:rounded-b-2xl sm:px-6">
          {!blocked && (
            <div aria-live="polite" className="mb-3 space-y-1">
              {/* The form did not open on today: said here, next to the day that would be saved, where it cannot be missed. */}
              {draft.startNote && <p role="status" className="text-xs font-semibold leading-relaxed text-amber-800">{draft.startNote}</p>}
              {chosen && employee && service ? (
                <p className="flex items-start gap-2 text-sm text-slate-700">
                  <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-[#5551FF]" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-semibold text-slate-900">
                      <span className="whitespace-nowrap">{formatDate(draft.date)},</span> <span className="whitespace-nowrap tabular-nums">{formatTimeRange(chosen.time, chosen.end)}</span>
                    </span>
                    <span className="block text-xs text-slate-600">
                      {customerName ? <>{customerName} · </> : null}{service.name} with {employee.name} · <span className="whitespace-nowrap">{formatMoney(service.priceCHF)}</span>
                    </span>
                  </span>
                </p>
              ) : null}
              {needed.length > 0 && (
                <p className="text-xs text-slate-600">Still needed: {needed.length > 1 ? `${needed.slice(0, -1).join(', ')} and ${needed[needed.length - 1]}` : needed[0]}.</p>
              )}
              {chosen?.outside && <p className="text-xs font-semibold text-amber-800">This time is outside your opening hours.</p>}
              {chosen && !chosen.outside && chosen.offShift && employee && (
                <p className="text-xs font-semibold text-amber-800">This time is outside {employee.name}’s working hours.</p>
              )}
              {/* A note, not a stop: moving a visit that has taken place is allowed, but the owner should know what it costs. */}
              {view.pastMoveNote && <p className="text-xs font-semibold leading-relaxed text-amber-800">{view.pastMoveNote}</p>}
            </div>
          )}
          {problem && <p ref={problemRef} tabIndex={-1} role="alert" className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium leading-relaxed text-rose-800 outline-none">{problem}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => close()} className="min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
              {blocked ? 'Close' : 'Cancel'}
            </button>
            {!blocked && (
              <button type="submit" className="min-h-11 flex-1 rounded-xl bg-[#5551FF] px-4 text-sm font-semibold text-white hover:bg-[#433fd8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
                {draft.appointmentId ? 'Save changes' : 'Save appointment'}
              </button>
            )}
          </div>
        </div>
      </form>
    </dialog>
  );
}
