import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, ExternalLink, CalendarDays, Clock, ArrowRight, Pencil, X } from 'lucide-react';
import type { AppointmentRequest, CompanySettingsData, ServiceItem } from '../types';
import { addMinutes, formatDate } from '../scheduling';
import {
  AvailabilityContext,
  getAvailableSlots,
  getNextAvailableDate,
  getSalonNow,
  isBookableEmployee,
  isEmployeeAssignedToService,
  validateBookingRequest,
} from '../availability';
import { normalizePhone, validateContact } from '../bookingData';

export interface BookingDraft {
  serviceId: string;
  employeeId: string;
  date: string;
  startTime: string;
  name: string;
  phone: string;
  editingRequestId?: string;
}

export const createBookingDraft = (services: ServiceItem[], timeZone = 'Europe/Zurich'): BookingDraft => ({
  serviceId: services.find((service) => service.onlineBooking)?.id ?? '',
  employeeId: '',
  date: getSalonNow(timeZone).date,
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
const inputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-base sm:text-sm text-slate-900 focus:border-indigo-600 focus:outline-2 focus:outline-indigo-100';
const cardClass = (selected: boolean) => `min-w-0 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${selected ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'border-slate-200 bg-white hover:border-indigo-300'}`;
const stepClass = 'mb-3 block text-xs font-bold uppercase tracking-wider text-slate-500';

export const BookingPageView: React.FC<BookingPageViewProps> = ({
  services, employees, bookingHours, shiftOverview, events, requests, closedDates, absences,
  companySettings, draft, setDraft, submittedRequest, setSubmittedRequest,
  onNewBookingRequest, onUpdateBookingRequest, onCancelBookingRequest, onViewRequest,
  publicMode = false,
}) => {
  const timeZone = (companySettings.timeZone || 'Europe/Zurich').split(' ')[0];
  const [clock, setClock] = useState(() => new Date());
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [confirmCancellation, setConfirmCancellation] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancellationRef = useRef<HTMLParagraphElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
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
  const slotsFor = (employeeId: string) => selectedService ? getAvailableSlots(context, {
    date: draft.date, serviceId: selectedService.id, employeeId, excludeRequestId: draft.editingRequestId,
  }) : [];
  const availableSlots = selectedEmployee ? slotsFor(selectedEmployee.id) : [];
  const selectedStartTime = availableSlots.includes(draft.startTime) ? draft.startTime : '';
  const anyAvailableEmployee = eligibleEmployees.some((employee) => slotsFor(employee.id).length > 0);
  const liveRequest = submittedRequest
    ? requests.find((request) => request.id === submittedRequest.id) ?? submittedRequest
    : null;
  const isEditing = Boolean(draft.editingRequestId && liveRequest?.status === 'pending');
  const showForm = !liveRequest || isEditing;
  const bookingUrl = new URL(window.location.pathname, window.location.origin);
  bookingUrl.searchParams.set('booking', '1');
  const address = [companySettings.street, [companySettings.postalCode, companySettings.city].filter(Boolean).join(' '), companySettings.country].filter(Boolean).join(', ');
  const currencyCode = companySettings.currency?.match(/\b([A-Z]{3})\s*$/)?.[1] ?? 'CHF';
  const formatPrice = (price: number) => `${currencyCode} ${price.toFixed(2)}`;
  const appointmentChosen = Boolean(selectedService && selectedEmployee && draft.date && selectedStartTime);

  useEffect(() => {
    const refresh = () => setClock(new Date());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => {
    if (showForm && !availableServices.some((service) => service.id === draft.serviceId)) {
      setDraft((previous) => ({ ...previous, serviceId: availableServices[0]?.id ?? '', employeeId: '', startTime: '' }));
      if (draft.serviceId) setNotice('Your previous service is no longer available. Please review the service and choose a specialist and time.');
    }
  }, [services, draft.serviceId, showForm, setDraft]);

  useEffect(() => { if (formError) errorRef.current?.focus(); }, [formError]);
  useEffect(() => { if (confirmCancellation) cancellationRef.current?.focus(); }, [confirmCancellation]);
  useEffect(() => {
    if (!showForm) {
      headingRef.current?.focus();
      submitting.current = false;
    }
  }, [showForm, liveRequest?.id, liveRequest?.status]);

  const updateDraft = (patch: Partial<BookingDraft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setFormError('');
    setNotice('');
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
    if (!draft.date) { fail('Please choose an appointment date.'); return; }
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
      date: draft.date,
      dateStr: formatDate(draft.date),
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
    const nextDate = getNextAvailableDate(freshContext, selectedService.id, draft.date || today, draft.employeeId || undefined);
    if (!nextDate) {
      setNotice(draft.employeeId
        ? 'No available date was found for this specialist in the next 90 days. Choose a different specialist or contact the salon.'
        : 'No available date was found in the next 90 days. Choose another service or contact the salon.');
      return;
    }
    setClock(freshContext.now);
    updateDraft({ date: nextDate, startTime: '' });
    setNotice(`Next available date${selectedEmployee ? ` with ${selectedEmployee.name}` : ''}: ${formatDate(nextDate)}. ${selectedEmployee ? 'Choose a time below.' : 'Choose an available specialist below.'}`);
    dateRef.current?.focus();
  };

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(bookingUrl.href);
      setCopyState('copied');
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
    requestAnimationFrame(() => dateRef.current?.focus());
  };

  const editRequest = () => {
    if (!liveRequest || liveRequest.status !== 'pending') return;
    setDraft({
      serviceId: liveRequest.serviceId ?? '', employeeId: liveRequest.employeeId ?? '',
      date: liveRequest.date, startTime: liveRequest.timeStr.split(' - ')[0],
      name: liveRequest.customerName, phone: liveRequest.customerPhone ?? '', editingRequestId: liveRequest.id,
    });
    setFormError('');
    setNotice('Your current request stays reserved while you edit. It changes only when you save.');
    setConfirmCancellation(false);
    requestAnimationFrame(() => dateRef.current?.focus());
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

  const statusHeading = liveRequest?.status === 'accepted' ? 'Appointment confirmed'
    : liveRequest?.status === 'rejected' ? 'Request declined'
      : liveRequest?.status === 'cancelled' ? 'Request cancelled' : 'Booking request received';

  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8 animate-in fade-in duration-200 [overflow-wrap:anywhere]">
      {publicMode && <a href={window.location.pathname} className="inline-block text-sm font-semibold text-indigo-700 hover:underline">Back to owner preview</a>}
      {!publicMode && (
        <div className="space-y-4 rounded-2xl bg-gradient-to-r from-[#5551FF] to-indigo-600 p-5 text-white shadow-lg shadow-indigo-500/10 sm:p-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-indigo-200">Customer booking preview</span>
            <h1 className="mt-1 text-xl font-bold sm:text-2xl">Your online booking page</h1>
            <p className="mt-1 text-sm text-indigo-100">Try the customer journey, then review the request in Home.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Customer booking link" readOnly value={bookingUrl.href} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-xs text-white" />
            <button type="button" onClick={handleCopy} className={`${buttonClass} flex items-center gap-2 bg-white/15 hover:bg-white/25`}>
              {copyState === 'copied' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copyState === 'copied' ? 'Copied' : 'Copy link'}
            </button>
            <a href={bookingUrl.href} className={`${buttonClass} flex items-center gap-2 bg-white text-indigo-700 hover:bg-indigo-50`}>
              Open booking page <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
          {copyState !== 'idle' && <p role={copyState === 'failed' ? 'alert' : 'status'} className="text-xs text-indigo-100">{copyState === 'copied' ? 'Booking link copied.' : 'The link could not be copied. Select the link above and copy it manually.'}</p>}
        </div>
      )}

      <p className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs leading-relaxed text-indigo-900">
        Interactive demo: requests and changes stay in this browser tab, including after refresh. No external messages are sent. Other tabs or devices do not receive your bookings.
      </p>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-8">
        <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-5">
          <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#5551FF] text-lg font-bold text-white">{(companySettings.companyName || 'Salon').slice(0, 1)}</div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">{companySettings.companyName || 'Salon'}</h2>
            {address && <p className="mt-0.5 text-xs text-slate-500">{address}</p>}
            {companySettings.businessPhone && <a className="mt-1 inline-block text-xs text-indigo-600 underline-offset-2 hover:underline" href={`tel:${normalizePhone(companySettings.businessPhone)}`}>{companySettings.businessPhone}</a>}
          </div>
        </div>

        {formError && <div ref={errorRef} tabIndex={-1} role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 focus:outline-2 focus:outline-rose-500"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{formError}</span></div>}

        {!showForm && liveRequest ? (
          <section className="space-y-5 py-3" aria-labelledby="booking-status-heading" onClickCapture={(event) => { if (event.detail > 1) { event.preventDefault(); event.stopPropagation(); } }}>
            <div className="text-center">
              <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${liveRequest.status === 'rejected' || liveRequest.status === 'cancelled' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-600'}`}><CheckCircle2 className="h-8 w-8" aria-hidden="true" /></div>
              <h2 id="booking-status-heading" ref={headingRef} tabIndex={-1} className="text-xl font-bold text-slate-900 focus:outline-hidden">{statusHeading}</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{liveRequest.status === 'pending' ? 'Your request is awaiting approval in this demo. This is not a confirmed appointment yet.' : liveRequest.status === 'accepted' ? 'The salon has accepted this appointment in the demo calendar.' : liveRequest.status === 'cancelled' ? 'This request is no longer pending. Its time is available for booking again.' : 'The salon has declined this request in the demo. You can choose another time.'}</p>
            </div>
            <dl className="mx-auto grid min-w-0 max-w-xl grid-cols-1 gap-4 rounded-xl bg-slate-50 p-5 text-sm sm:grid-cols-2 [&>div]:min-w-0">
              <div><dt className="text-xs text-slate-500">Service</dt><dd className="mt-1 font-semibold text-slate-900">{liveRequest.serviceName}</dd></div>
              <div><dt className="text-xs text-slate-500">Specialist</dt><dd className="mt-1 font-semibold text-slate-900">{liveRequest.staffName}</dd></div>
              <div><dt className="text-xs text-slate-500">Date and time</dt><dd className="mt-1 font-semibold text-slate-900">{formatDate(liveRequest.date)}<br />{liveRequest.timeStr}</dd></div>
              <div><dt className="text-xs text-slate-500">Contact</dt><dd className="mt-1 font-semibold text-slate-900">{liveRequest.customerName}<br />{liveRequest.customerPhone}</dd></div>
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
                <p className="mt-1 text-xs text-rose-700">Your reserved time will become available to other bookings in this demo.</p>
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
              <p className="mt-1 text-xs text-slate-500">Choose a service, date and specialist. All appointment times are in {timeZone}.</p>
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
                      <span className="flex items-start justify-between gap-3"><span className="min-w-0 text-sm font-bold text-slate-900">{service.name}</span><span className="shrink-0 whitespace-nowrap text-xs font-bold text-indigo-600">{formatPrice(service.priceCHF)}</span></span>
                      <span className="mt-1 block text-xs text-slate-500">{service.durationMinutes} minutes</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <div>
                <label className={stepClass} htmlFor="booking-date">2. Choose date</label>
                <div className="flex flex-wrap items-center gap-3">
                  <input id="booking-date" ref={dateRef} type="date" required min={today} value={draft.date} aria-describedby="booking-date-help" onChange={(event) => {
                    if (event.target.value === draft.date) return;
                    updateDraft({ date: event.target.value, startTime: '' });
                  }} className={`${inputClass} max-w-64`} />
                  <button type="button" onClick={findNextDate} disabled={!selectedService} className={`${buttonClass} flex items-center gap-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50`}><CalendarDays className="h-4 w-4" aria-hidden="true" />Find next available date</button>
                </div>
                <p id="booking-date-help" className="mt-2 text-xs text-slate-500">{draft.employeeId ? 'Date search keeps your chosen specialist. Choose another specialist below to check their dates.' : 'Date search finds the next day with availability for this service.'}</p>
                {draft.date && draft.date < today && <p role="alert" className="mt-2 text-sm text-rose-600">This date has passed. Choose today or a future date.</p>}
              </div>

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
                    {!anyAvailableEmployee && <p className="mt-3 text-xs text-slate-500">No specialist has a time on this date. Use Find next available date, or choose a different service.</p>}
                  </>
                )}
              </fieldset>

              <fieldset className="min-w-0">
                <legend className={stepClass}>4. Choose time</legend>
                {!selectedEmployee ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Choose a specialist to see their available times.</p> : availableSlots.length === 0 ? (
                  <div role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><strong>{selectedEmployee.name}</strong> has no available times on {draft.date ? formatDate(draft.date) : 'this date'}. Find their next available date, or choose a different specialist above.</div>
                ) : <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {availableSlots.map((slot) => <button key={slot} type="button" aria-pressed={selectedStartTime === slot} onClick={() => updateDraft({ startTime: slot })} className={`${buttonClass} border text-center text-xs tabular-nums ${selectedStartTime === slot ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-indigo-50'}`}>{slot} - {addMinutes(slot, selectedService?.durationMinutes ?? 30)}</button>)}
                </div>}
                {draft.startTime && !selectedStartTime && selectedEmployee && <p role="status" className="mt-2 text-sm text-amber-800">Your previously selected time is no longer available. Please choose another time.</p>}
              </fieldset>

              <fieldset className="min-w-0">
                <legend className={stepClass}>5. Contact details</legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div><label className="mb-1.5 block text-xs font-semibold text-slate-700" htmlFor="booking-name">Full name <span aria-hidden="true">*</span></label><input id="booking-name" type="text" autoComplete="name" required maxLength={120} value={draft.name} placeholder="e.g. Sandra Meier" onChange={(event) => updateDraft({ name: event.target.value })} className={inputClass} /></div>
                  <div><label className="mb-1.5 block text-xs font-semibold text-slate-700" htmlFor="booking-phone">Phone number <span aria-hidden="true">*</span></label><input id="booking-phone" type="tel" autoComplete="tel" inputMode="tel" required maxLength={40} value={draft.phone} placeholder="+41 79 123 45 67" aria-describedby="booking-phone-help" onChange={(event) => updateDraft({ phone: event.target.value })} className={inputClass} /><p id="booking-phone-help" className="mt-1.5 text-xs text-slate-500">Use a country code, for example +41. No call or message is sent by this demo.</p></div>
                </div>
                <p className="mt-3 text-xs text-slate-500">Both fields are required. This request comes from the web booking page.</p>
              </fieldset>

              <section aria-labelledby="booking-review-heading" className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 sm:p-5">
                <h3 id="booking-review-heading" className="mb-4 text-sm font-bold text-slate-900">Review your request</h3>
                <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 [&>div]:min-w-0">
                  <div><dt className="text-xs text-slate-500">Service and price</dt><dd className="mt-1 font-semibold text-slate-800">{selectedService ? `${selectedService.name} · ${selectedService.durationMinutes} min · ${formatPrice(selectedService.priceCHF)}` : 'Choose a service'}</dd></div>
                  <div><dt className="text-xs text-slate-500">Specialist</dt><dd className="mt-1 font-semibold text-slate-800">{selectedEmployee?.name ?? 'Choose a specialist'}</dd></div>
                  <div><dt className="text-xs text-slate-500">Date and time</dt><dd className="mt-1 font-semibold text-slate-800">{draft.date ? formatDate(draft.date) : 'Choose a date'}{selectedStartTime && selectedService ? `, ${selectedStartTime} - ${addMinutes(selectedStartTime, selectedService.durationMinutes)}` : ', choose a time'}</dd></div>
                  <div><dt className="text-xs text-slate-500">Contact</dt><dd className="mt-1 break-words font-semibold text-slate-800">{draft.name.trim() || 'Enter your name'}<br />{draft.phone.trim() || 'Enter your phone number'}</dd></div>
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
      </div>
    </div>
  );
};
