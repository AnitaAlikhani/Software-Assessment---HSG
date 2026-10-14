import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  RotateCcw,
  X,
  Share2,
  MessageSquare,
  Sparkles,
  Moon,
  Timer,
  Clock,
  User,
  Plus,
} from 'lucide-react';
import { AppointmentRequest, CalendarEvent, Conversation } from '../types';
import { addMinutes, formatCalendarDate, formatDate } from '../scheduling';
import { getAvailableSlots, type AvailabilityContext } from '../availability';

const LANG_CHIP: Record<string, string> = {
  FR: 'bg-violet-100 text-violet-700',
  DE: 'bg-emerald-100 text-emerald-700',
  IT: 'bg-rose-100 text-rose-700',
  EN: 'bg-amber-100 text-amber-700',
};

interface HomeViewProps {
  requests: AppointmentRequest[];
  selectedRequestId: string | null;
  onSelectRequest: (id: string) => void;
  availabilityContext: AvailabilityContext;
  onAcceptRequest: (id: string) => void;
  onRejectRequest: (id: string) => void;
  onMoveRequest: (id: string, date: string, startTime: string) => string | null;
  onSimulateNewRequest: () => void;
  nextAppointment: CalendarEvent | null;
  onOpenAppointment: (event: CalendarEvent) => void;
  activityStats: {
    messagesToday: number;
    messagesMonth: number;
    aiBookingsToday: number;
    aiBookingsMonth: number;
    afterHoursToday: number;
    afterHoursMonth: number;
    replyTimeSec: number;
  };
  onExportActivity: () => void;
  conversations: Conversation[];
  onOpenConversations: (conversationId?: string) => void;
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
  nextAppointment,
  onOpenAppointment,
  activityStats,
  onExportActivity,
  conversations,
  onOpenConversations,
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
  const requestDate = currentRequest ? new Date(`${currentRequest.date}T00:00:00.000Z`) : null;

  const openMoveDialog = (request: AppointmentRequest) => {
    setRescheduleDate(request.date);
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

  const needingAttention = conversations.filter((c) => c.status === 'needs-attention');
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
              <div className="flex items-start gap-5">
                {/* Request date */}
                <div className="flex flex-col items-center justify-center w-16 h-18 rounded-xl border border-slate-200/90 bg-white p-2 shrink-0 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-400 tracking-wider">
                    {requestDate?.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase()}
                  </span>
                  <span className="text-2xl font-bold text-slate-800 tabular-nums">
                    {requestDate?.getUTCDate()}
                  </span>
                </div>

                {/* Details */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                      Appointment request
                    </h2>
                    <span className="text-xs text-slate-400">
                      {currentRequest.timeAgo}
                    </span>
                  </div>

                  <p className="text-sm font-medium text-slate-600">
                    by <span className="text-slate-900 font-semibold">{currentRequest.customerName}</span>
                  </p>

                  <div className="text-xs text-slate-500 pt-0.5 space-y-0.5">
                    <p className="font-medium text-slate-700">
                      {formatDate(currentRequest.date)}, from {currentRequest.timeStr}
                    </p>
                    <p className="text-slate-500">{currentRequest.serviceName}</p>
                    <p className="flex items-center gap-1.5">
                      <User className="w-3 h-3 text-slate-400" />
                      <span>Staff: {currentRequest.staffName || 'Unassigned'}</span>
                    </p>
                    {currentRequest.channel && <p className="text-slate-400">Via {currentRequest.channel}</p>}
                  </div>
                </div>
              </div>

              {/* Actions: Accept, Move, Reject */}
              <div className="flex flex-row sm:flex-col gap-2 w-full sm:w-auto shrink-0 justify-end">
                <button
                  onClick={() => onAcceptRequest(currentRequest.id)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors border border-emerald-200/60 shadow-2xs"
                >
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Accept</span>
                </button>

                <button
                  onClick={() => openMoveDialog(currentRequest)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 transition-colors border border-slate-200/70"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Move</span>
                </button>

                <button
                  onClick={() => onRejectRequest(currentRequest.id)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors border border-rose-200/60"
                >
                  <X className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Reject</span>
                </button>
              </div>
            </div>
          ) : (
            /* Empty State from Figma Page 11 & 25 */
            <div className="text-center py-6 px-4 space-y-2">
              <h3 className="text-base sm:text-lg font-bold text-slate-800">
                {unavailableRequest ? 'This request is no longer available' : 'No pending appointment requests'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                {unavailableRequest && requests.length > 0
                  ? 'Select another pending request below.'
                  : 'New requests from WhatsApp and Instagram will show up here.'}
              </p>
              {requests.length === 0 && <div className="pt-3">
                <button
                  onClick={onSimulateNewRequest}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium text-[#5551FF] bg-[#5551FF]/8 hover:bg-[#5551FF]/15 transition-colors border border-[#5551FF]/20"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Simulate incoming booking</span>
                </button>
              </div>}
            </div>
          )}

          {/* Every pending request can be reviewed without processing another first. */}
          {(requests.length > 1 || (unavailableRequest && requests.length > 0)) && (
            <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
              <p className="text-xs font-semibold text-slate-500">{requests.length} pending {requests.length === 1 ? 'request' : 'requests'}</p>
              <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1" aria-label="Pending appointment requests">
                {requests.map((request) => (
                  <button
                    key={request.id}
                    type="button"
                    aria-pressed={currentRequest?.id === request.id}
                    onClick={() => onSelectRequest(request.id)}
                    className={`w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs border transition-colors ${
                      currentRequest?.id === request.id
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                        : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-indigo-50/50'
                    }`}
                  >
                    <span className="font-semibold">{request.customerName}</span>
                    <span className="text-right tabular-nums">{formatCalendarDate(request.date)} · {request.timeStr}</span>
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
                    {nextAppointment.startTime} - {nextAppointment.endTime}
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
                className="font-semibold text-[#5551FF] hover:underline"
              >
                View appointment
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sample activity and conversations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-8 space-y-4">
        {/* Header & Export Button */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Sample activity
            </h2>
            <p className="text-xs text-slate-400 mt-1">Demo salon metrics. Participant activity is not tracked here.</p>
          </div>

          <button
            onClick={onExportActivity}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200/80 shadow-2xs transition-colors"
          >
            <Share2 className="w-3.5 h-3.5 text-slate-500" />
            <span>Export sample</span>
          </button>
        </div>

        {/* 4 Stat Cards matching Figma */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Messages */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/70 shadow-[0_2px_12px_rgba(0,0,0,0.02)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-pink-50 flex items-center justify-center text-pink-600">
                <MessageSquare className="w-4 h-4" />
              </div>
              <span className="text-xl font-bold text-pink-600 tabular-nums">
                {activityStats.messagesToday}
              </span>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-800">Messages</p>
              <p className="text-[11px] text-slate-400 tabular-nums">
                of {activityStats.messagesMonth} this month
              </p>
            </div>
          </div>

          {/* AI Bookings */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/70 shadow-[0_2px_12px_rgba(0,0,0,0.02)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
                <Sparkles className="w-4 h-4" />
              </div>
              <span className="text-xl font-bold text-amber-600 tabular-nums">
                {activityStats.aiBookingsToday}
              </span>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-800">AI Bookings</p>
              <p className="text-[11px] text-slate-400 tabular-nums">
                of {activityStats.aiBookingsMonth} this month
              </p>
            </div>
          </div>

          {/* After-hours */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/70 shadow-[0_2px_12px_rgba(0,0,0,0.02)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                <Moon className="w-4 h-4" />
              </div>
              <span className="text-xl font-bold text-emerald-600 tabular-nums">
                {activityStats.afterHoursToday}
              </span>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-800">After-hours</p>
              <p className="text-[11px] text-slate-400 tabular-nums">
                of {activityStats.afterHoursMonth} this month
              </p>
            </div>
          </div>

          {/* Reply time */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/70 shadow-[0_2px_12px_rgba(0,0,0,0.02)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600">
                <Timer className="w-4 h-4" />
              </div>
              <span className="text-xl font-bold text-purple-600 tabular-nums">
                {activityStats.replyTimeSec}s
              </span>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-800">Reply time</p>
              <p className="text-[11px] text-slate-400 tabular-nums">
                avg. this month
              </p>
            </div>
          </div>
        </div>
      </div>

        {/* Conversations card */}
        <div className="lg:col-span-4 bg-white rounded-2xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.03)] border border-slate-200/70 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Conversations</h3>
            {needingAttention.length > 0 && (
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
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
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${LANG_CHIP[c.language]}`}
                      >
                        {c.language}
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
            className="w-full pt-3 border-t border-slate-100 text-left text-xs font-semibold text-[#5551FF] hover:underline"
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
          className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-xs"
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
              <button type="button" onClick={() => setMovingRequestId(null)} aria-label="Close reschedule dialog" className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div id="move-appointment-context" className="text-xs text-slate-500 mb-4 space-y-1">
              <p className="font-semibold text-slate-700">{movingRequest.customerName}</p>
              <p>{moveService?.name ?? movingRequest.serviceName}{moveDuration > 0 ? ` · ${moveDuration} minutes` : ''}</p>
              <p>Staff: {moveEmployee?.name ?? movingRequest.staffName ?? 'Unassigned'}</p>
              <p>Current: {formatDate(movingRequest.date)}, {movingRequest.timeStr}</p>
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
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:border-[#5551FF]"
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
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:border-[#5551FF] disabled:opacity-60"
                >
                  {availableMoveSlots.length === 0 && <option value="">No available times</option>}
                  {availableMoveSlots.map((start) => (
                    <option key={start} value={start}>{start} - {addMinutes(start, moveDuration)}</option>
                  ))}
                </select>
                {availableMoveSlots.length === 0 && (
                  <p className="mt-2 text-xs text-slate-500" role="status">No available times for this employee and service on this date. Choose another date or check their shift and booking settings.</p>
                )}
              </div>
              {moveError && <p role="alert" className="text-xs text-rose-600 rounded-xl bg-rose-50 p-3">{moveError}</p>}
              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setMovingRequestId(null)}
                  className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedMoveStart || !rescheduleDate}
                  className="flex-1 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
