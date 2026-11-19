import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Copy, ExternalLink, CalendarDays, Clock, ArrowRight, Pencil, X } from 'lucide-react';
import type { AppointmentRequest, CompanySettingsData, ServiceItem } from '../types';
import { addDays, addMinutes, formatDate, salonTimeZone } from '../scheduling';
import { formatDayMonth, formatMoney, formatPhone, formatStoredTimeRange, formatTimeRange, weekdayName } from '../format';
import {
  AvailabilityContext,
  getAvailableSlots,
  getNextAvailableDate,
  getSalonNow,
  isBookableEmployee,
  isEmployeeAssignedToService,
  validateBookingRequest,
} from '../availability';
import { bookingDays, closedReason, openingHoursLines } from '../bookingDays';
import { normalizePhone, validateContact } from '../bookingData';
import { PoweredBy } from '../components/Logo';
import { SalonTimeNote } from '../components/SalonTimeNote';
import { salonAddress } from '../region';

export interface BookingDraft {
  serviceId: string;
  employeeId: string;
  date: string;
  /**
   * True once the customer has picked a day (or a time on it). Until then the page shows the
   * first day with a free time for the chosen service, so nobody starts on "no times".
   */
  dateChosen?: boolean;
  startTime: string;
  name: string;
  phone: string;
  editingRequestId?: string;
}

/** The service a new visitor most likely wants: bookable online and offered by the most specialists. */
const defaultService = (services: ServiceItem[]): ServiceItem | undefined =>
  services.filter((service) => service.onlineBooking).reduce<ServiceItem | undefined>((best, service) =>
    !best || (service.assignedEmployeeIds?.length ?? 0) > (best.assignedEmployeeIds?.length ?? 0) ? service : best, undefined);

export const createBookingDraft = (services: ServiceItem[], timeZone = 'Europe/Zurich', now = new Date()): BookingDraft => ({
  serviceId: defaultService(services)?.id ?? '',
  employeeId: '',
  date: getSalonNow(timeZone, now).date,
  startTime: '',
  name: '',
  phone: '',
});

interface BookingPageViewProps extends AvailabilityContext {
  companySettings: CompanySettingsData;
  draft: BookingDraft;
  setDraft: React.Dispatch<React.SetStateAction<BookingDraft>>;
  submittedRequest: AppointmentRequest | null;
  setSubmittedRequest: React.Dispatch<React.SetStateAction<AppointmentRequest | null>>;
  onNewBookingRequest: (request: AppointmentRequest) => string | null;
  onUpdateBookingRequest: (request: AppointmentRequest) => string | null;
  onCancelBookingRequest: (requestId: string) => string | null;
  onViewRequest: (requestId: string) => void;
  publicMode?: boolean;
}

const buttonClass = 'min-h-11 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';
// Time slots sit three or two per row: narrower padding so a label never breaks or spills.
const slotButtonClass = buttonClass.replace('px-4', 'px-2');
const inputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-base sm:text-sm text-slate-900 focus:border-indigo-600 focus:outline-2 focus:outline-indigo-100';
const cardClass = (selected: boolean) => `min-w-0 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${selected ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'border-slate-200 bg-white hover:border-indigo-300'}`;
const stepClass = 'mb-3 block text-xs font-bold uppercase tracking-wider text-slate-500';

/** Company profiles may contain a bare domain, but never an executable URL. */
export const bookingProfileUrl = (value: string): string | null => {
  if (!value.trim()) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
};

/** How many of the coming days the date step shows as buttons. Later dates use the date field. */
const DAYS_SHOWN = 14;
/** Shifts are planned this far ahead, so later dates cannot have a time. */
const DAYS_BOOKABLE = 90;

/**
 * The owner's "Open booking page" marks this browser tab. Only a tab with the mark gets a way
 * back to the dashboard on the public page: the link a customer receives never shows one.
 */
const FROM_DASHBOARD = 'slotbee-booking-from-dashboard';
const openedFromDashboard = (): boolean => {
  try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(FROM_DASHBOARD) === '1'; } catch { return false; }
};
const rememberDashboard = () => {
  try { sessionStorage.setItem(FROM_DASHBOARD, '1'); } catch { /* without storage the public page just shows no way back */ }
};

export const BookingPageView: React.FC<BookingPageViewProps> = ({
  services, employees, bookingHours, shiftOverview, events, requests, closedDates, absences, now,
  companySettings, draft, setDraft, submittedRequest, setSubmittedRequest,
  onNewBookingRequest, onUpdateBookingRequest, onCancelBookingRequest, onViewRequest,
  publicMode = false,
}) => {
  const timeZone = salonTimeZone(companySettings.timeZone);
  const [clock, setClock] = useState(() => now ?? new Date());
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [confirmCancellation, setConfirmCancellation] = useState(false);
  const [fromDashboard] = useState(openedFromDashboard);
  const errorRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancellationRef = useRef<HTMLParagraphElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<number | null>(null);
  const submitting = useRef(false);
  const today = getSalonNow(timeZone, clock).date;
  const context: AvailabilityContext = {
    services, employees, bookingHours, shiftOverview, events, requests,
    closedDates, absences, timeZone, now: clock,
  };
  const availableServices = services.filter((service) => service.onlineBooking);
  const selectedService = availableServices.find((service) => service.id === draft.serviceId);
  const eligibleEmployees = selectedService
    ? employees.filter((employee) => isBookableEmployee(employee) && isEmployeeAssignedToService(selectedService, employee))
    : [];
  // A chosen specialist remains chosen when their availability changes. Never substitute another person.
  const selectedEmployee = eligibleEmployees.find((employee) => employee.id === draft.employeeId);
  // What the availability below depends on. The clock ticks every 30 seconds, so typing a name
  // does not recompute two weeks of slots on every key.
  const availabilityInputs = [services, employees, bookingHours, shiftOverview, events, requests, closedDates, absences, timeZone, clock, selectedService?.id];
  // The day the customer picked stays. Before that, the page opens on the first day that has a
  // free time for the chosen service, and follows the service when the customer changes it.
  const dateFixed = Boolean(draft.dateChosen || draft.startTime || draft.editingRequestId);
  const earliestDate = useMemo(
    () => !dateFixed && selectedService ? getNextAvailableDate(context, selectedService.id, today) : null,
    [...availabilityInputs, dateFixed],
  );
  const date = dateFixed ? draft.date : earliestDate ?? (draft.date > today ? draft.date : today);
  const comingDays = useMemo(
    () => selectedService ? bookingDays(context, selectedService.id, today, DAYS_SHOWN, draft.editingRequestId) : [],
    [...availabilityInputs, draft.editingRequestId],
  );
  const slotsFor = (employeeId: string) => selectedService ? getAvailableSlots(context, {
    date, serviceId: selectedService.id, employeeId, excludeRequestId: draft.editingRequestId,
  }) : [];
  const availableSlots = selectedEmployee ? slotsFor(selectedEmployee.id) : [];
  const selectedStartTime = availableSlots.includes(draft.startTime) ? draft.startTime : '';
  const anyAvailableEmployee = eligibleEmployees.some((employee) => slotsFor(employee.id).length > 0);
  const dateClosed = date && date >= today ? closedReason({ bookingHours, closedDates }, date) : null;
  const liveRequest = submittedRequest
    ? requests.find((request) => request.id === submittedRequest.id) ?? submittedRequest
    : null;
  const isEditing = Boolean(draft.editingRequestId && liveRequest?.status === 'pending');
  const showForm = !liveRequest || isEditing;
  // No browser while the page is rendered by a test.
  const page = typeof window === 'undefined' ? { pathname: '/', origin: 'http://localhost' } : window.location;
  const bookingUrl = new URL(page.pathname, page.origin);
  bookingUrl.searchParams.set('booking', '1');
  const salon = companySettings.companyName || 'The salon';
  const address = salonAddress(companySettings);
  // A date inside a sentence carries its weekday in full: "Tuesday, 06.10.2026".
  const longDate = (value: string) => formatDate(value, { weekday: 'long' });
  const appointmentChosen = Boolean(selectedService && selectedEmployee && date && selectedStartTime);
  const openingLines = openingHoursLines(bookingHours);
  const profileLinks = [
    { label: 'Website', value: companySettings.website },
    { label: 'Facebook', value: companySettings.facebook },
    { label: 'Instagram', value: companySettings.instagram },
    { label: 'X', value: companySettings.xProfile },
  ].map(link => ({ ...link, href: bookingProfileUrl(link.value) })).filter(link => link.href !== null);
  const legalUrl = bookingProfileUrl(companySettings.legalNote);
  const logoUrl = companySettings.logoDataUrl?.match(/^data:image\/(?:png|jpeg|gif|webp);base64,/) ? companySettings.logoDataUrl : null;
  // The public page has no dashboard header above it, so the salon's name is its main heading.
  const SalonName = publicMode ? 'h1' : 'h2';

  useEffect(() => {
    const refresh = () => setClock(new Date());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => () => { if (copyTimer.current !== null) window.clearTimeout(copyTimer.current); }, []);

  useEffect(() => {
    if (showForm && !availableServices.some((service) => service.id === draft.serviceId)) {
      setDraft((previous) => ({ ...previous, serviceId: defaultService(services)?.id ?? '', employeeId: '', startTime: '' }));
      if (draft.serviceId) setNotice('Your previous service is no longer available. Please review the service and choose a specialist and time.');
    }
  }, [services, draft.serviceId, showForm, setDraft]);

  useEffect(() => { if (formError) errorRef.current?.focus(); }, [formError]);
  useEffect(() => { if (confirmCancellation) cancellationRef.current?.focus(); }, [confirmCancellation]);
  useEffect(() => {
    if (!showForm) {
      headingRef.current?.focus();
      submitting.current = false;
      requestAnimationFrame(() => {
        // Keep the status heading below the sticky header (owner preview); the public page has none.
        const heading = headingRef.current;
        if (!heading) return;
        const headerHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
        window.scrollTo({ top: heading.getBoundingClientRect().top + window.scrollY - headerHeight - 16 });
      });
    }
  }, [showForm, liveRequest?.id, liveRequest?.status]);

  const updateDraft = (patch: Partial<BookingDraft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setFormError('');
    setNotice('');
  };
  const pickDate = (value: string) => {
    // An emptied date field hands the choice back to the page: it shows the first free day again.
    updateDraft(value === date ? { date: value, dateChosen: Boolean(value) } : { date: value, dateChosen: Boolean(value), startTime: '' });
  };
  const fail = (message: string) => {
    setFormError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  };

  const handleBookingSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const contactError = validateContact(draft.name, draft.phone);
    if (contactError) { fail(contactError); return; }
    if (!selectedService) { fail('Please choose an available service.'); return; }
    if (!date) { fail('Please choose an appointment date.'); return; }
    if (!selectedEmployee) { fail('Please choose a specialist for this appointment.'); return; }
    if (!selectedStartTime) { fail('Please choose an available time for this specialist.'); return; }
    const currentTime = new Date();
    const newRequest: AppointmentRequest = {
      ...(isEditing && liveRequest ? liveRequest : {}),
      id: isEditing && liveRequest ? liveRequest.id : `req-${crypto.randomUUID()}`,
      serviceId: selectedService.id,
      employeeId: selectedEmployee.id,
      customerName: draft.name.trim(),
      customerPhone: normalizePhone(draft.phone),
      serviceName: selectedService.name,
      date,
      dateStr: formatDate(date),
      timeStr: `${selectedStartTime} - ${addMinutes(selectedStartTime, selectedService.durationMinutes)}`,
      timeAgo: 'Just now',
      staffName: selectedEmployee.name,
      channel: 'Web',
      isAiBooked: false,
      status: 'pending',
    };
    const availabilityError = validateBookingRequest({ ...context, now: currentTime }, newRequest, draft.editingRequestId);
    if (availabilityError) { setClock(currentTime); fail(availabilityError); return; }
    submitting.current = true;
    const error = isEditing ? onUpdateBookingRequest(newRequest) : onNewBookingRequest(newRequest);
    if (error) { submitting.current = false; fail(error); return; }
    setFormError('');
    setNotice('');
    setConfirmCancellation(false);
    setDraft((previous) => ({ ...previous, editingRequestId: undefined }));
    setSubmittedRequest(newRequest);
  };

  const findNextDate = () => {
    if (!selectedService) return;
    const freshContext = { ...context, now: new Date(), requests: requests.filter((request) => request.id !== draft.editingRequestId) };
    const nextDate = getNextAvailableDate(freshContext, selectedService.id, date || today, draft.employeeId || undefined);
    if (!nextDate) {
      setNotice(draft.employeeId
        ? `No available date was found for this specialist in the next ${DAYS_BOOKABLE} days. Choose a different specialist or contact the salon.`
        : `No available date was found in the next ${DAYS_BOOKABLE} days. Choose another service or contact the salon.`);
      return;
    }
    setClock(freshContext.now);
    updateDraft({ date: nextDate, dateChosen: true, startTime: '' });
    setNotice(`Next available date${selectedEmployee ? ` with ${selectedEmployee.name}` : ''}: ${longDate(nextDate)}. ${selectedEmployee ? 'Choose a time below.' : 'Choose an available specialist below.'}`);
    dateRef.current?.focus();
  };

  const handleCopy = async () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(bookingUrl.href);
      setCopyState('copied');
      // "Copied" answers one tap. It must not stay as if the button were a switch.
      copyTimer.current = window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('failed');
    }
  };

  const resetBooking = () => {
    submitting.current = false;
    setDraft(createBookingDraft(services, timeZone));
    setSubmittedRequest(null);
    setFormError('');
    setNotice('');
    setConfirmCancellation(false);
    requestAnimationFrame(() => {
      // The form replaces the status screen: bring the field out from under the sticky header.
      dateRef.current?.scrollIntoView({ block: 'center' });
      dateRef.current?.focus({ preventScroll: true });
    });
  };

  const editRequest = () => {
    if (!liveRequest || liveRequest.status !== 'pending') return;
    setDraft({
      serviceId: liveRequest.serviceId ?? '', employeeId: liveRequest.employeeId ?? '',
      date: liveRequest.date, dateChosen: true, startTime: liveRequest.timeStr.split(' - ')[0],
      name: liveRequest.customerName, phone: formatPhone(liveRequest.customerPhone ?? ''), editingRequestId: liveRequest.id,
    });
    setFormError('');
    setNotice('Your current request stays reserved while you edit. It changes only when you save.');
    setConfirmCancellation(false);
    requestAnimationFrame(() => {
      // The form replaces the status screen: bring the field out from under the sticky header.
      dateRef.current?.scrollIntoView({ block: 'center' });
      dateRef.current?.focus({ preventScroll: true });
    });
  };

  const cancelRequest = () => {
    if (!liveRequest || liveRequest.status !== 'pending') return;
    const error = onCancelBookingRequest(liveRequest.id);
    if (error) { fail(error); return; }
    setSubmittedRequest({ ...liveRequest, status: 'cancelled' });
    setConfirmCancellation(false);
    setFormError('');
  };

  const keepRequest = () => {
    setConfirmCancellation(false);
    requestAnimationFrame(() => cancelButtonRef.current?.focus());
  };

  // While a request waits, the page says what is true wherever it was opened: an appointment was
  // asked for and is not confirmed. It does not say that the salon has the request or will answer:
  // a request made on another device does not reach the salon yet.
  const statusHeading = liveRequest?.status === 'accepted' ? 'Appointment confirmed'
    : liveRequest?.status === 'rejected' ? 'Request declined'
      : liveRequest?.status === 'cancelled' ? 'Request cancelled' : 'Appointment requested';
  const statusText = liveRequest?.status === 'accepted' ? `${salon} has confirmed your appointment. See you then!`
    : liveRequest?.status === 'rejected' ? `Sorry, ${salon} cannot offer this time. Please choose another one.`
      : liveRequest?.status === 'cancelled' ? 'Your request has been cancelled. The time is free again.'
        : `Thank you! Your appointment is not confirmed yet: ${salon} must accept your request first.`;
  // One line under the day buttons says what is special about the day shown.
  const dateNote = !date || date < today ? null
    : dateClosed ? `${dateClosed} Please choose another day.`
      : selectedService && eligibleEmployees.length > 0 && !anyAvailableEmployee ? `${longDate(date)}: no free times for ${selectedService.name}. Please choose another day.`
        : !dateFixed && selectedService && date !== today ? `First day with free times for ${selectedService.name}: ${longDate(date)}.`
          : null;

  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8 animate-in fade-in duration-200 [overflow-wrap:anywhere]">
      {publicMode && fromDashboard && (
        <a href={`${page.pathname}#/booking-page`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-indigo-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to dashboard
        </a>
      )}
      {!publicMode && (
        <div className="space-y-4 rounded-2xl bg-gradient-to-r from-[#5551FF] to-indigo-600 p-5 text-white shadow-lg shadow-indigo-500/10 sm:p-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-indigo-200">Preview</span>
            <h1 className="mt-1 text-xl font-bold focus:outline-hidden sm:text-2xl">Your booking page</h1>
            <p className="mt-1 text-sm text-indigo-100">This is what your customers see. Try it: a request you send here appears in Home.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Customer booking link" readOnly value={bookingUrl.href} onFocus={(event) => event.target.select()} className="min-h-11 w-full min-w-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-base text-white sm:w-auto sm:flex-1 sm:text-xs" />
            <button type="button" onClick={handleCopy} className={`${buttonClass} flex items-center gap-2 bg-white/15 hover:bg-white/25`}>
              {copyState === 'copied' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copyState === 'copied' ? 'Copied' : 'Copy link'}
            </button>
            <a href={bookingUrl.href} onClick={rememberDashboard} className={`${buttonClass} flex items-center gap-2 bg-white text-indigo-700 hover:bg-indigo-50`}>
              Open booking page <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
          {copyState !== 'idle' && <p role={copyState === 'failed' ? 'alert' : 'status'} className="text-xs text-indigo-100">{copyState === 'copied' ? 'Booking link copied.' : 'The link could not be copied. Select the link above and copy it manually.'}</p>}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-8">
        <div className="mb-6 border-b border-slate-100 pb-5">
          <div className="flex items-center gap-3">
            {logoUrl ? <img src={logoUrl} alt={`${companySettings.companyName || 'Salon'} logo`} className="h-12 w-12 shrink-0 rounded-xl object-contain" /> : <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#5551FF] text-lg font-bold text-white">{(companySettings.companyName || 'Salon').slice(0, 1)}</div>}
            <div className="min-w-0">
              <SalonName className="text-lg font-bold text-slate-900">{companySettings.companyName || 'Salon'}</SalonName>
              {address && <p className="mt-0.5 text-xs text-slate-500">{address}</p>}
              {companySettings.businessPhone && <a className="inline-flex min-h-11 items-center text-xs text-indigo-600 underline-offset-2 hover:underline" href={`tel:${normalizePhone(companySettings.businessPhone)}`}>{formatPhone(companySettings.businessPhone)}</a>}
            </div>
          </div>
          {openingLines.length > 0 && (
            <section aria-label="Opening hours" className="mt-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Opening hours</h3>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm text-slate-700">
                {openingLines.map((line) => (
                  <React.Fragment key={line.days}>
                    <dt>{line.days}</dt>
                    <dd className="tabular-nums">{line.hours}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          )}
        </div>

        {(companySettings.description.trim() || profileLinks.length > 0) && <section aria-label="About the salon" className="mb-6 space-y-3 border-b border-slate-100 pb-5">
          {companySettings.description.trim() && <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{companySettings.description}</p>}
          {profileLinks.length > 0 && <nav aria-label="Salon links" className="flex flex-wrap gap-x-4 gap-y-1">
            {profileLinks.map(link => <a key={link.label} href={link.href!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:underline">{link.label}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>)}
          </nav>}
        </section>}

        {formError && <div ref={errorRef} tabIndex={-1} role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 focus:outline-2 focus:outline-rose-500"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{formError}</span></div>}

        {!showForm && liveRequest ? (
          <section className="space-y-5 py-3" aria-labelledby="booking-status-heading" onClickCapture={(event) => { if (event.detail > 1) { event.preventDefault(); event.stopPropagation(); } }}>
            <div className="text-center">
              <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${liveRequest.status === 'rejected' || liveRequest.status === 'cancelled' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-600'}`}><CheckCircle2 className="h-8 w-8" aria-hidden="true" /></div>
              <h2 id="booking-status-heading" ref={headingRef} tabIndex={-1} className="text-xl font-bold text-slate-900 focus:outline-hidden">{statusHeading}</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{statusText}</p>
            </div>
            <dl className="mx-auto grid min-w-0 max-w-xl grid-cols-1 gap-4 rounded-xl bg-slate-50 p-5 text-sm sm:grid-cols-2 [&>div]:min-w-0">
              <div><dt className="text-xs text-slate-500">Service</dt><dd className="mt-1 font-semibold text-slate-900">{liveRequest.serviceName}</dd></div>
              <div><dt className="text-xs text-slate-500">Specialist</dt><dd className="mt-1 font-semibold text-slate-900">{liveRequest.staffName}</dd></div>
              <div><dt className="text-xs text-slate-500">Date and time</dt><dd className="mt-1 font-semibold text-slate-900">{formatDate(liveRequest.date)}<br />{formatStoredTimeRange(liveRequest.timeStr)}</dd></div>
              <div><dt className="text-xs text-slate-500">Contact</dt><dd className="mt-1 font-semibold text-slate-900">{liveRequest.customerName}<br />{formatPhone(liveRequest.customerPhone ?? '')}</dd></div>
            </dl>
            {liveRequest.status === 'pending' && !confirmCancellation && (
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={editRequest} className={`${buttonClass} flex items-center gap-2 border border-slate-200 text-slate-700 hover:bg-slate-50`}><Pencil className="h-4 w-4" aria-hidden="true" />Edit request</button>
                <button ref={cancelButtonRef} type="button" onClick={() => setConfirmCancellation(true)} className={`${buttonClass} text-rose-600 hover:bg-rose-50`}>Cancel request</button>
              </div>
            )}
            {confirmCancellation && liveRequest.status === 'pending' && (
              <div className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-rose-50 p-4" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); keepRequest(); } }}>
                <p ref={cancellationRef} tabIndex={-1} className="text-sm font-semibold text-rose-900 focus:outline-hidden">Cancel this booking request?</p>
                <p className="mt-1 text-xs text-rose-700">Your time slot will be released.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={cancelRequest} className={`${buttonClass} bg-rose-600 text-white hover:bg-rose-700`}>Yes, cancel request</button>
                  <button type="button" onClick={keepRequest} className={`${buttonClass} bg-white text-slate-700 hover:bg-slate-100`}>Keep request</button>
                </div>
              </div>
            )}
            {liveRequest.status === 'accepted' && <p className="text-center text-xs text-slate-500">To change a confirmed appointment, contact the salon{!publicMode ? ' or use the owner calendar' : ''}.</p>}
            <div className="flex flex-wrap justify-center gap-3 border-t border-slate-100 pt-5">
              {!publicMode && (liveRequest.status === 'pending' || liveRequest.status === 'accepted') && <button type="button" onClick={() => onViewRequest(liveRequest.id)} className={`${buttonClass} flex items-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700`}>{liveRequest.status === 'accepted' ? 'View appointment' : 'View request'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>}
              <button type="button" onClick={resetBooking} className={`${buttonClass} border border-slate-200 text-slate-700 hover:bg-slate-50`}>Book another appointment</button>
            </div>
          </section>
        ) : (
          <form onSubmit={handleBookingSubmit} noValidate className="space-y-7">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-slate-900">{isEditing ? 'Edit your request' : 'Request an appointment'}</h2>
                {isEditing && <button type="button" className={`${buttonClass} flex items-center gap-1.5 text-slate-600 hover:bg-slate-50`} onClick={() => { updateDraft({ editingRequestId: undefined }); }}><X className="h-4 w-4" aria-hidden="true" />Cancel editing</button>}
              </div>
              <p className="mt-1 text-xs text-slate-500">Choose a service, a date and a specialist.</p>
              {/* The owner's preview sits inside the app, which carries this note itself. */}
              {publicMode && <SalonTimeNote timeZone={timeZone} className="mt-2 text-xs" />}
            </div>

            {notice && <p role="status" className="rounded-xl bg-indigo-50 p-3 text-sm text-indigo-800">{notice}</p>}
            {availableServices.length === 0 ? (
              <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">No services are currently available for online booking. Please contact the salon{!publicMode ? ', or enable a service in Services' : ''}.</div>
            ) : (<>
              <fieldset className="min-w-0">
                <legend className={stepClass}>1. Select service</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {availableServices.map((service) => (
                    <button type="button" key={service.id} aria-pressed={selectedService?.id === service.id} onClick={() => {
                      if (draft.serviceId === service.id) return;
                      const keepEmployee = employees.find((employee) => employee.id === draft.employeeId);
                      updateDraft({ serviceId: service.id, startTime: '', employeeId: keepEmployee && isBookableEmployee(keepEmployee) && isEmployeeAssignedToService(service, keepEmployee) ? keepEmployee.id : '' });
                    }} className={cardClass(selectedService?.id === service.id)}>
                      <span className="flex items-start justify-between gap-3"><span className="min-w-0 text-sm font-bold text-slate-900">{service.name}</span><span className="shrink-0 whitespace-nowrap text-xs font-bold text-indigo-600">{formatMoney(service.priceCHF)}</span></span>
                      <span className="mt-1 block text-xs text-slate-500">{service.durationMinutes} minutes</span>
                      {service.description?.trim() && <span className="mt-2 block whitespace-pre-wrap text-xs leading-relaxed text-slate-500">{service.description}</span>}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="min-w-0">
                <legend className={stepClass}>2. Choose date</legend>
                {/* Days without a time stay visible but cannot be picked, so the first tap already lands on a day with times. */}
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-7 sm:gap-2">
                  {comingDays.map((day) => {
                    const selected = day.date === date;
                    const free = day.state === 'free';
                    return (
                      <button key={day.date} type="button" disabled={!free} aria-pressed={selected} onClick={() => pickDate(day.date)}
                        aria-label={`${longDate(day.date)}${day.state === 'closed' ? ', closed' : day.state === 'full' ? ', fully booked' : day.state === 'none' ? ', no times' : ''}`}
                        className={`flex min-h-16 min-w-0 flex-col items-center justify-center rounded-xl border py-1.5 text-center whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${selected && free ? 'border-indigo-600 bg-indigo-600 text-white' : selected ? 'border-indigo-300 bg-slate-100 text-slate-500' : free ? 'border-slate-200 bg-white text-slate-800 hover:border-indigo-300' : 'border-transparent bg-slate-100 text-slate-500'}`}>
                        <span className="block text-[11px] font-semibold">{day.date === today ? 'Today' : weekdayName(day.date, 'short')}</span>
                        <span className="block text-[13px] font-bold leading-tight tabular-nums min-[360px]:text-sm sm:text-base">{formatDayMonth(day.date)}</span>
                        {(day.state === 'closed' || day.state === 'full') && <span className="block text-[11px]">{day.state === 'closed' ? 'Closed' : 'Full'}</span>}
                      </button>
                    );
                  })}
                </div>
                {dateNote && <p role="status" className="mt-3 text-sm text-slate-600">{dateNote}</p>}
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <div className="w-full max-w-64">
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700" htmlFor="booking-date">Other date</label>
                    <input id="booking-date" ref={dateRef} type="date" required min={today} max={addDays(today, DAYS_BOOKABLE - 1)} value={date} aria-describedby="booking-date-help" onChange={(event) => {
                      if (event.target.value === date) return;
                      pickDate(event.target.value);
                    }} className={inputClass} />
                  </div>
                  <button type="button" onClick={findNextDate} disabled={!selectedService} className={`${buttonClass} flex items-center gap-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50`}><CalendarDays className="h-4 w-4" aria-hidden="true" />Find next available date</button>
                </div>
                <p id="booking-date-help" className="mt-2 text-xs text-slate-500">{draft.employeeId ? 'Date search keeps your chosen specialist. Choose another specialist below to check their dates.' : 'Date search finds the next day with availability for this service.'}</p>
                {date && date < today && <p role="alert" className="mt-2 text-sm text-rose-600">This date has passed. Choose today or a future date.</p>}
              </fieldset>

              <fieldset className="min-w-0">
                <legend className={stepClass}>3. Choose specialist</legend>
                {eligibleEmployees.length === 0 ? <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">No specialists currently offer this service online. Choose another service or contact the salon.</p> : (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {eligibleEmployees.map((employee) => {
                        const hasSlots = slotsFor(employee.id).length > 0;
                        return <button type="button" key={employee.id} aria-pressed={draft.employeeId === employee.id} onClick={() => {
                          if (draft.employeeId !== employee.id) updateDraft({ employeeId: employee.id, startTime: '' });
                        }} className={`${cardClass(draft.employeeId === employee.id)} flex items-center gap-3`}>
                          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-xs font-bold text-indigo-600">{employee.initials}</span>
                          <span className="min-w-0"><span className="block text-sm font-semibold text-slate-800">{employee.name}</span><span className={`mt-0.5 block text-xs ${hasSlots ? 'text-emerald-700' : 'text-slate-500'}`}>{hasSlots ? 'Available on this date' : 'No times on this date'}</span></span>
                          {draft.employeeId === employee.id && <CheckCircle2 aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-indigo-600" />}
                        </button>;
                      })}
                    </div>
                    {draft.employeeId && !selectedEmployee && <p role="status" className="mt-3 text-sm text-amber-800">Your chosen specialist is no longer available for this service. Please choose another specialist.</p>}
                    {!anyAvailableEmployee && <p className="mt-3 text-xs text-slate-500">{dateClosed ? `${dateClosed} Choose another date above.` : 'No specialist has a time on this date. Use Find next available date, or choose a different service.'}</p>}
                  </>
                )}
              </fieldset>

              <fieldset className="min-w-0">
                <legend className={stepClass}>4. Choose time</legend>
                {!selectedEmployee ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Choose a specialist to see their available times.</p> : availableSlots.length === 0 ? (
                  <div role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><strong>{selectedEmployee.name}</strong> has no available times on {date ? longDate(date) : 'this date'}. Find their next available date, or choose a different specialist above.</div>
                ) : <><p className="mb-3 text-sm text-slate-600">Free times with {selectedEmployee.name} on {longDate(date)}:</p><div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {/* Picking a time settles the day as well: the page must not move it afterwards. */}
                  {availableSlots.map((slot) => <button key={slot} type="button" aria-pressed={selectedStartTime === slot} onClick={() => updateDraft({ startTime: slot, date, dateChosen: true })} className={`${slotButtonClass} border text-center text-xs tabular-nums whitespace-nowrap ${selectedStartTime === slot ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-indigo-50'}`}>{formatTimeRange(slot, addMinutes(slot, selectedService?.durationMinutes ?? 30))}</button>)}
                </div></>}
                {draft.startTime && !selectedStartTime && selectedEmployee && <p role="status" className="mt-2 text-sm text-amber-800">Your previously selected time is no longer available. Please choose another time.</p>}
              </fieldset>

              <fieldset className="min-w-0">
                <legend className={stepClass}>5. Contact details</legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div><label className="mb-1.5 block text-xs font-semibold text-slate-700" htmlFor="booking-name">Full name <span aria-hidden="true">*</span></label><input id="booking-name" type="text" autoComplete="name" required value={draft.name} placeholder="e.g. Sandra Meier" onChange={(event) => updateDraft({ name: event.target.value })} className={inputClass} /></div>
                  <div><label className="mb-1.5 block text-xs font-semibold text-slate-700" htmlFor="booking-phone">Phone number <span aria-hidden="true">*</span></label><input id="booking-phone" type="tel" autoComplete="tel" inputMode="tel" required value={draft.phone} placeholder="079 123 45 67" aria-describedby="booking-phone-help" onChange={(event) => updateDraft({ phone: event.target.value })} className={inputClass} /><p id="booking-phone-help" className="mt-1.5 text-xs text-slate-500">A Swiss number as you usually write it, or any other number with its country code (for example +49). The salon uses your number for questions about this appointment.</p></div>
                </div>
                <p className="mt-3 text-xs text-slate-500">Both fields are required.</p>
              </fieldset>

              <section aria-labelledby="booking-review-heading" className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 sm:p-5">
                <h3 id="booking-review-heading" className="mb-4 text-sm font-bold text-slate-900">Review your request</h3>
                <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 [&>div]:min-w-0">
                  <div><dt className="text-xs text-slate-500">Service and price</dt><dd className="mt-1 font-semibold text-slate-800">{selectedService ? `${selectedService.name} · ${selectedService.durationMinutes} min · ${formatMoney(selectedService.priceCHF)}` : 'Choose a service'}</dd></div>
                  <div><dt className="text-xs text-slate-500">Specialist</dt><dd className="mt-1 font-semibold text-slate-800">{selectedEmployee?.name ?? 'Choose a specialist'}</dd></div>
                  <div><dt className="text-xs text-slate-500">Date and time</dt><dd className="mt-1 font-semibold text-slate-800">{date ? formatDate(date) : 'Choose a date'}{selectedStartTime && selectedService ? `, ${formatTimeRange(selectedStartTime, addMinutes(selectedStartTime, selectedService.durationMinutes))}` : ', choose a time'}</dd></div>
                  {/* A number that can be read as one is shown back the way it will be stored and displayed. */}
                  <div><dt className="text-xs text-slate-500">Contact</dt><dd className="mt-1 break-words font-semibold text-slate-800">{draft.name.trim() || 'Enter your name'}<br />{formatPhone(draft.phone) || 'Enter your phone number'}</dd></div>
                </dl>
                <p className="mt-4 flex items-start gap-2 border-t border-indigo-100 pt-3 text-xs leading-relaxed text-slate-600"><Clock className="h-4 w-4 shrink-0" aria-hidden="true" />The salon must accept your request before the appointment is confirmed. No payment is taken.</p>
              </section>
            </>)}

            <div className="border-t border-slate-100 pt-5">
              <button type="submit" disabled={!appointmentChosen} className={`${buttonClass} flex w-full items-center justify-center gap-2 bg-indigo-600 py-3.5 text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50`}>{isEditing ? 'Save request changes' : 'Request appointment'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
              {!appointmentChosen && availableServices.length > 0 && <p className="mt-2 text-center text-xs text-slate-500">Choose an available service, specialist, date and time to continue.</p>}
            </div>
          </form>
        )}
        {(companySettings.legalNote.trim() || (companySettings.customTerms && companySettings.termsText?.trim())) && <footer className="mt-6 space-y-3 border-t border-slate-100 pt-5 text-xs leading-relaxed text-slate-500">
          {companySettings.legalNote.trim() && (legalUrl ? <a href={legalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-indigo-600 hover:underline">Legal information<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a> : <p className="whitespace-pre-wrap">{companySettings.legalNote}</p>)}
          {companySettings.customTerms && companySettings.termsText?.trim() && <details className="rounded-xl border border-slate-200 p-3"><summary className="min-h-11 cursor-pointer content-center font-semibold text-slate-700">Booking terms</summary><p className="mt-2 whitespace-pre-wrap">{companySettings.termsText}</p></details>}
        </footer>}
      </div>
      {/* The page is the salon's; the product is named once, at its foot. */}
      <PoweredBy />
    </div>
  );
};
