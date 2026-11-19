import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  RotateCcw,
  X,
  Download,
  CalendarDays,
  CalendarClock,
  Sparkles,
  Users,
  Clock,
  User,
  Plus,
} from 'lucide-react';
import { researchMode } from '../flags';
import { AppointmentRequest, CalendarEvent, Conversation } from '../types';
import { addMinutes, formatCalendarDate, formatDate } from '../scheduling';
import { formatDayMonth, formatPhone, formatStoredTimeRange, formatTimeRange, weekdayName } from '../format';
import { getAvailableSlots, getNextAvailableDate, getSalonNow, type AvailabilityContext } from '../availability';
import { timeAgoLabel } from '../demoRequests';
import { conversationsWaiting, periodLabel } from '../analytics';
import { homeFigures } from '../dashboard';

const LANG_CHIP: Record<string, string> = {
  FR: 'bg-violet-100 text-violet-700',
  DE: 'bg-emerald-100 text-emerald-700',
  IT: 'bg-rose-100 text-rose-700',
  EN: 'bg-amber-100 text-amber-700',
};

/** One figure of "This month": the number, what it counts, and a line of detail. */
const Figure = ({ icon, tint, value, label, detail }: {
  icon: React.ReactNode; tint: string; value: number | string; label: string; detail: React.ReactNode;
}) => (
  <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/70 shadow-[0_2px_12px_rgba(0,0,0,0.02)] space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${tint}`}>
        {icon}
      </div>
      {/* The number is the message: it is set in the text colour, the icon alone carries the tint. */}
      <span className="text-2xl font-bold text-slate-900">{value}</span>
    </div>
    <div>
      <p className="text-xs font-bold text-slate-800">{label}</p>
      <p className="text-[11px] text-slate-500">{detail}</p>
    </div>
  </div>
);

interface HomeViewProps {
  requests: AppointmentRequest[];
  selectedRequestId: string | null;
  onSelectRequest: (id: string) => void;
  availabilityContext: AvailabilityContext;
  onAcceptRequest: (id: string) => void;
  onRejectRequest: (id: string) => void;
  onMoveRequest: (id: string, date: string, startTime: string) => string | null;
  onSimulateNewRequest: () => void;
  /** The current moment, refreshed by the app every minute. */
  now?: Date;
  nextAppointment: CalendarEvent | null;
  onOpenAppointment: (event: CalendarEvent) => void;
  /** Starts the download of this month's figures and appointments. */
  onExportReport: () => void;
  /** Leads to the same figures for any period. The link is shown only when it has a target. */
  onOpenAnalytics?: () => void;
  /** Every chat the owner sees, live ones included: the card counts what the header counts. */
  conversations: Conversation[];
  onOpenConversations: (conversationId?: string) => void;
  /** What an owner with an empty request list can do next. A button is shown only when it has a target. */
  onOpenBookingPage?: () => void;
  onNewAppointment?: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  requests,
  selectedRequestId,
  onSelectRequest,
  availabilityContext,
  onAcceptRequest,
  onRejectRequest,
  onMoveRequest,
  onSimulateNewRequest,
  now,
  nextAppointment,
  onOpenAppointment,
  onExportReport,
  onOpenAnalytics,
  conversations,
  onOpenConversations,
  onOpenBookingPage,
  onNewAppointment,
}) => {
  const [movingRequestId, setMovingRequestId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleStart, setRescheduleStart] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);
  const moveDialogRef = useRef<HTMLDialogElement>(null);

  const selectedRequest = requests.find((request) => request.id === selectedRequestId);
  const unavailableRequest = selectedRequestId !== null && !selectedRequest;
  const currentRequest = selectedRequestId !== null ? selectedRequest ?? null : requests[0] ?? null;
  const movingRequest = requests.find((request) => request.id === movingRequestId);
  const moveService = movingRequest && availabilityContext.services.find((service) =>
    movingRequest.serviceId !== undefined ? service.id === movingRequest.serviceId : service.name === movingRequest.serviceName
  );
  const moveEmployee = movingRequest && availabilityContext.employees.find((employee) =>
    movingRequest.employeeId !== undefined ? employee.id === movingRequest.employeeId : employee.name === movingRequest.staffName
  );
  const moveDuration = moveService?.durationMinutes ?? 0;
  const availableMoveSlots = movingRequest && moveService && moveEmployee && rescheduleDate
    ? getAvailableSlots(availabilityContext, {
        date: rescheduleDate,
        serviceId: moveService.id,
        employeeId: moveEmployee.id,
        excludeRequestId: movingRequest.id,
      })
    : [];
  const selectedMoveStart = availableMoveSlots.includes(rescheduleStart)
    ? rescheduleStart
    : availableMoveSlots[0] ?? '';
  const clock = now ?? availabilityContext.now ?? new Date();
  const salonNow = getSalonNow(availabilityContext.timeZone, clock);
  const hasPassed = (request: AppointmentRequest) =>
    `${request.date} ${request.timeStr.split(/\s*-\s*/)[0]}` < `${salonNow.date} ${salonNow.time}`;
  // A request whose start has passed cannot be accepted any more. The card says so and offers
  // to move it, instead of letting "Accept" end in an error.
  const requestTimePassed = currentRequest !== null && hasPassed(currentRequest);

  const openMoveDialog = (request: AppointmentRequest) => {
    // A request in the past opens on the stylist's next free day, where there is something to choose.
    const nextFreeDate = hasPassed(request) && request.serviceId
      ? getNextAvailableDate({ ...availabilityContext, now: clock }, request.serviceId, salonNow.date, request.employeeId, request.id)
      : null;
    setRescheduleDate(nextFreeDate ?? (hasPassed(request) ? salonNow.date : request.date));
    setRescheduleStart(request.timeStr.split(/\s*-\s*/)[0]);
    setMoveError(null);
    setMovingRequestId(request.id);
  };

  useEffect(() => {
    const dialog = moveDialogRef.current;
    if (!movingRequestId || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [movingRequestId, Boolean(movingRequest)]);

  // Counted from the calendar on every render, by the functions Analytics uses.
  const figures = homeFigures(availabilityContext.events, clock, availabilityContext.timeZone);

  const needingAttention = conversationsWaiting(conversations);
  const shownConversations = (needingAttention.length > 0 ? needingAttention : conversations).slice(0, 2);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-200">
      <h1 tabIndex={-1} className="sr-only">Home</h1>
      {/* Top Grid: Appointment Request / Empty State & Next Appointment */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Pending Appointment Request or Empty State (span 8) */}
        <div className="lg:col-span-8 bg-white rounded-2xl p-6 sm:p-7 shadow-[0_2px_12px_rgba(0,0,0,0.03)] border border-slate-200/70 min-h-[190px] flex flex-col justify-center">
          {currentRequest ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              {/* Date Block + Info */}
              <div className="flex items-start gap-3 sm:gap-5">
                {/* Request date: the weekday above the day, written like every short date ("THU" over "19.11.") */}
                <div className="flex flex-col items-center justify-center w-16 h-18 rounded-xl border border-slate-200/90 bg-white p-2 shrink-0 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-400 tracking-wider">
                    {weekdayName(currentRequest.date, 'short').toUpperCase()}
                  </span>
                  <span className="text-base font-bold text-slate-800 tabular-nums">
                    {formatDayMonth(currentRequest.date)}
                  </span>
                </div>

                {/* Details */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                      Appointment request
                    </h2>
                    <span className="text-xs text-slate-400">
                      {currentRequest.createdAt ? timeAgoLabel(currentRequest.createdAt, clock) : currentRequest.timeAgo}
                    </span>
                  </div>

                  <p className="text-sm font-medium text-slate-600">
                    by <span className="text-slate-900 font-semibold">{currentRequest.customerName}</span>
                  </p>

                  <div className="text-xs text-slate-500 pt-0.5 space-y-0.5">
                    <p className="font-medium text-slate-700">
                      {formatDate(currentRequest.date)}, {formatStoredTimeRange(currentRequest.timeStr)}
                    </p>
                    <p className="text-slate-500">{currentRequest.serviceName}</p>
                    <p className="flex items-center gap-1.5">
                      <User className="w-3 h-3 text-slate-400" />
                      <span>Staff: {currentRequest.staffName || 'Unassigned'}</span>
                    </p>
                    {currentRequest.channel && <p className="text-slate-400">Via {currentRequest.channel}</p>}
                    {currentRequest.customerPhone && <p>Phone: <span className="whitespace-nowrap">{formatPhone(currentRequest.customerPhone)}</span></p>}
                    {requestTimePassed && <p role="status" className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5 font-medium text-amber-800">This time has passed. Move the request to a new time, or reject it.</p>}
                  </div>
                </div>
              </div>

              {/* Actions: Accept, Move, Reject */}
              <div className={`grid grid-cols-1 ${requestTimePassed ? 'min-[380px]:grid-cols-2' : 'min-[380px]:grid-cols-3'} sm:flex sm:flex-col gap-2 w-full sm:w-auto shrink-0 justify-end`}>
                {!requestTimePassed && <button
                  onClick={() => onAcceptRequest(currentRequest.id)}
                  className="min-h-11 min-w-0 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors border border-emerald-200/60 shadow-2xs"
                >
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Accept</span>
                </button>}

                <button
                  onClick={() => openMoveDialog(currentRequest)}
                  className={`min-h-11 min-w-0 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors border ${requestTimePassed ? 'text-white bg-[#5551FF] hover:bg-[#433fd8] border-transparent' : 'text-slate-600 bg-slate-50 hover:bg-slate-100 border-slate-200/70'}`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Move</span>
                </button>

                <button
                  onClick={() => onRejectRequest(currentRequest.id)}
                  className="min-h-11 min-w-0 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors border border-rose-200/60"
                >
                  <X className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Reject</span>
                </button>
              </div>
            </div>
          ) : (
            /* Nothing to decide: say so, and offer what an owner would do next. */
            <div className="text-center py-6 px-4 space-y-2">
              <h3 className="text-base sm:text-lg font-bold text-slate-800">
                {unavailableRequest ? 'This request is no longer available' : 'All requests handled'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                {unavailableRequest && requests.length > 0
                  ? 'Select another pending request below.'
                  : 'New booking requests appear here as they come in.'}
              </p>
              {requests.length === 0 && <div className="pt-3 flex flex-wrap items-center justify-center gap-2">
                {onOpenBookingPage && (
                  <button
                    onClick={onOpenBookingPage}
                    className="inline-flex min-h-11 items-center px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 transition-colors border border-slate-200 shadow-2xs"
                  >
                    <span className="whitespace-nowrap">Open booking page</span>
                  </button>
                )}
                {onNewAppointment && (
                  <button
                    onClick={onNewAppointment}
                    className="inline-flex min-h-11 items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] transition-colors shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span className="whitespace-nowrap">New appointment</span>
                  </button>
                )}
                {/* Study tool: adds a made-up request. Not part of the product; back with the research switch. */}
                {researchMode() && (
                  <button
                    onClick={onSimulateNewRequest}
                    className="inline-flex min-h-11 items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium text-[#5551FF] bg-[#5551FF]/8 hover:bg-[#5551FF]/15 transition-colors border border-[#5551FF]/20"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span className="whitespace-nowrap">Simulate incoming booking</span>
                  </button>
                )}
              </div>}
            </div>
          )}

          {/* Every pending request can be reviewed without processing another first. */}
          {(requests.length > 1 || (unavailableRequest && requests.length > 0)) && (
            <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
              <p className="text-xs font-semibold text-slate-500">{requests.length} pending {requests.length === 1 ? 'request' : 'requests'}</p>
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 sm:max-h-44" aria-label="Pending appointment requests">
                {requests.map((request) => (
                  <button
                    key={request.id}
                    type="button"
                    aria-pressed={currentRequest?.id === request.id}
                    onClick={() => onSelectRequest(request.id)}
                    className={`w-full flex min-h-11 flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left text-xs border transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
                      currentRequest?.id === request.id
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                        : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-indigo-50/50'
                    }`}
                  >
                    <span className="min-w-0 max-w-full truncate font-semibold">{request.customerName}</span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500 sm:text-right">{formatCalendarDate(request.date)} · {formatStoredTimeRange(request.timeStr)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Next Appointment (span 4) */}
        <div className="lg:col-span-4 bg-white rounded-2xl p-6 sm:p-7 shadow-[0_2px_12px_rgba(0,0,0,0.03)] border border-slate-200/70 min-h-[190px] flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Next appointment</h3>
            {nextAppointment ? (
              <div className="space-y-3 pt-1">
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">{formatDate(nextAppointment.date)}</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">
                    {formatTimeRange(nextAppointment.startTime, nextAppointment.endTime)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-800">{nextAppointment.customerName}</p>
                  <p className="text-xs text-slate-500">{nextAppointment.serviceName}</p>
                  <p className="text-xs text-slate-500 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>Staff: {nextAppointment.staffName}</span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-xs text-slate-400">
                <Clock className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                No upcoming appointments
              </div>
            )}
          </div>
          {nextAppointment && (
            <div className="pt-3 border-t border-slate-100 mt-4 flex items-center justify-between text-[11px]">
              <span className="text-emerald-600 font-medium">Confirmed</span>
              <button
                type="button"
                onClick={() => onOpenAppointment(nextAppointment)}
                className="inline-flex min-h-11 items-center rounded-lg px-2 -mr-2 font-semibold text-[#5551FF] hover:underline"
              >
                View appointment
              </button>
            </div>
          )}
        </div>
      </div>

      {/* This month's figures and conversations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-8 space-y-4">
        {/* Heading, the way to Analytics and the export */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              This month
            </h2>
            <p className="text-xs text-slate-500 mt-1">{periodLabel(figures.month)} · past and upcoming appointments</p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {onOpenAnalytics && (
              <button
                type="button"
                onClick={onOpenAnalytics}
                className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-[#5551FF] hover:underline"
              >
                View analytics
              </button>
            )}
            <button
              type="button"
              onClick={onExportReport}
              aria-label="Export CSV for this month"
              className="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200/80 shadow-2xs transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Four figures of the month. Analytics shows the same numbers for "This month". */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-4">
          <Figure
            icon={<CalendarDays className="w-4 h-4" />}
            tint="bg-indigo-50 text-[#5551FF]"
            value={figures.appointments}
            label="Appointments"
            detail={<><span className="whitespace-nowrap">{figures.today} today,</span> <span className="whitespace-nowrap">{figures.week} this week</span></>}
          />
          <Figure
            icon={<Sparkles className="w-4 h-4" />}
            tint="bg-amber-50 text-amber-600"
            value={figures.aiShare === null ? '–' : `${figures.aiShare}%`}
            label="Booked by AI"
            detail={<><span className="whitespace-nowrap">{figures.aiBookings} of {figures.appointments}</span> {figures.appointments === 1 ? 'appointment' : 'appointments'}</>}
          />
          <Figure
            icon={<Users className="w-4 h-4" />}
            tint="bg-emerald-50 text-emerald-600"
            value={figures.customers}
            label="Customers"
            detail={figures.customers === 1 ? 'with an appointment' : 'with appointments'}
          />
          <Figure
            icon={<CalendarClock className="w-4 h-4" />}
            tint="bg-purple-50 text-purple-600"
            value={figures.stillToCome}
            label="Still to come"
            detail={`${figures.appointments - figures.stillToCome} so far`}
          />
        </div>
      </div>

        {/* Conversations card */}
        <div className="lg:col-span-4 bg-white rounded-2xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.03)] border border-slate-200/70 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Conversations</h3>
            {needingAttention.length > 0 && (
              <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                {needingAttention.length} need you
              </span>
            )}
          </div>

          <div className="space-y-3">
            {shownConversations.map((c) => {
              const last = c.messages[c.messages.length - 1];
              return (
                <button
                  key={c.id}
                  onClick={() => onOpenConversations(c.id)}
                  className="w-full flex items-center gap-3 text-left rounded-xl p-1.5 -m-1.5 hover:bg-slate-50 transition-colors"
                >
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${c.avatarColor}`}
                  >
                    {c.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {c.customerName}
                      </span>
                      {/* A live chat can be in any language: show the one the AI detected, as the chat list does. */}
                      <span
                        className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md ${LANG_CHIP[c.language]}`}
                      >
                        {c.live && c.languageLabel ? c.languageLabel : c.language}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">{last?.translation || 'No messages yet.'}</p>
                  </div>
                </button>
              );
            })}
            {shownConversations.length === 0 && (
              <p className="text-xs text-slate-400">No conversations yet.</p>
            )}
          </div>

          <button
            onClick={() => onOpenConversations()}
            className="flex min-h-11 w-full items-center border-t border-slate-100 pt-2 text-left text-xs font-semibold text-[#5551FF] hover:underline"
          >
            Open conversations →
          </button>
        </div>
      </div>

      {/* Native dialog supplies modal focus handling and Escape support. */}
      {movingRequest && (
        <dialog
          ref={moveDialogRef}
          aria-labelledby="move-appointment-title"
          aria-describedby="move-appointment-context"
          onCancel={(event) => {
            event.preventDefault();
            setMovingRequestId(null);
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
              setMovingRequestId(null);
            }
          }}
          className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 text-slate-800 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-xs"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!selectedMoveStart || !rescheduleDate) {
                setMoveError('Choose a date and an available time slot.');
                return;
              }
              const error = onMoveRequest(movingRequest.id, rescheduleDate, selectedMoveStart);
              if (error) {
                setMoveError(error);
                return;
              }
              setMovingRequestId(null);
            }}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 id="move-appointment-title" className="text-base font-bold text-slate-900">Reschedule appointment request</h3>
              <button type="button" onClick={() => setMovingRequestId(null)} aria-label="Close reschedule dialog" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div id="move-appointment-context" className="text-xs text-slate-500 mb-4 space-y-1">
              <p className="font-semibold text-slate-700">{movingRequest.customerName}</p>
              <p>{moveService?.name ?? movingRequest.serviceName}{moveDuration > 0 ? ` · ${moveDuration} minutes` : ''}</p>
              <p>Staff: {moveEmployee?.name ?? movingRequest.staffName ?? 'Unassigned'}</p>
              <p>Current: {formatDate(movingRequest.date)}, {formatStoredTimeRange(movingRequest.timeStr)}</p>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="move-appointment-date" className="text-xs font-medium text-slate-700 block mb-1">Date</label>
                <input
                  id="move-appointment-date"
                  type="date"
                  required
                  autoFocus
                  value={rescheduleDate}
                  onChange={(event) => {
                    setRescheduleDate(event.target.value);
                    setRescheduleStart('');
                    setMoveError(null);
                  }}
                  className="w-full min-h-11 px-3 py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:border-[#5551FF]"
                />
              </div>
              <div>
                <label htmlFor="move-appointment-time" className="text-xs font-medium text-slate-700 block mb-1">Available time slot</label>
                <select
                  id="move-appointment-time"
                  value={selectedMoveStart}
                  disabled={availableMoveSlots.length === 0}
                  required
                  onChange={(event) => { setRescheduleStart(event.target.value); setMoveError(null); }}
                  className="w-full min-h-11 px-3 py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:border-[#5551FF] disabled:opacity-60"
                >
                  {availableMoveSlots.length === 0 && <option value="">No available times</option>}
                  {availableMoveSlots.map((start) => (
                    <option key={start} value={start}>{formatTimeRange(start, addMinutes(start, moveDuration))}</option>
                  ))}
                </select>
                {availableMoveSlots.length === 0 && (
                  <p className="mt-2 text-xs text-slate-500" role="status">No available times for this employee and service on this date. Choose another date or check their shift and booking settings.</p>
                )}
              </div>
              {moveError && <p role="alert" className="text-xs text-rose-600 rounded-xl bg-rose-50 p-3">{moveError}</p>}
              <div className="sticky -bottom-4 -mx-4 flex gap-2 border-t border-slate-100 bg-white px-4 pt-3 pb-4 shadow-[0_-6px_12px_-8px_rgba(15,23,42,0.25)] sm:-bottom-6 sm:-mx-6 sm:px-6 sm:pb-6 sm:-mb-6 -mb-4">
                <button
                  type="button"
                  onClick={() => setMovingRequestId(null)}
                  className="min-h-11 flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedMoveStart || !rescheduleDate}
                  className="min-h-11 flex-1 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm Move
                </button>
              </div>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
};
