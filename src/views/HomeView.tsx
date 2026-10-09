import React, { useState } from 'react';
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
import { AppointmentRequest, Conversation } from '../types';

const LANG_CHIP: Record<string, string> = {
  FR: 'bg-violet-100 text-violet-700',
  DE: 'bg-emerald-100 text-emerald-700',
  IT: 'bg-rose-100 text-rose-700',
  EN: 'bg-amber-100 text-amber-700',
};

interface HomeViewProps {
  requests: AppointmentRequest[];
  onAcceptRequest: (id: string) => void;
  onRejectRequest: (id: string) => void;
  onMoveRequest: (id: string, newTime: string) => void;
  onSimulateNewRequest: () => void;
  nextAppointment: {
    customerName: string;
    staffName: string;
    time: string;
    dayName: string;
  } | null;
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
  onAcceptRequest,
  onRejectRequest,
  onMoveRequest,
  onSimulateNewRequest,
  nextAppointment,
  activityStats,
  onExportActivity,
  conversations,
  onOpenConversations,
}) => {
  const [movingRequestId, setMovingRequestId] = useState<string | null>(null);
  const [rescheduleTime, setRescheduleTime] = useState('11:30 - 12:00');

  const currentRequest = requests.length > 0 ? requests[0] : null;

  const needingAttention = conversations.filter((c) => c.status === 'needs-attention');
  const shownConversations = (needingAttention.length > 0 ? needingAttention : conversations).slice(0, 2);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-200">
      {/* Top Grid: Appointment Request / Empty State & Next Appointment */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Pending Appointment Request or Empty State (span 8) */}
        <div className="lg:col-span-8 bg-white rounded-2xl p-6 sm:p-7 shadow-[0_2px_12px_rgba(0,0,0,0.03)] border border-slate-200/70 min-h-[190px] flex flex-col justify-center">
          {currentRequest ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              {/* Date Block + Info */}
              <div className="flex items-start gap-5">
                {/* OCT 1 Box */}
                <div className="flex flex-col items-center justify-center w-16 h-18 rounded-xl border border-slate-200/90 bg-white p-2 shrink-0 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-400 tracking-wider">
                    OCT
                  </span>
                  <span className="text-2xl font-bold text-slate-800 tabular-nums">
                    1
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
                      {currentRequest.dateStr}, from {currentRequest.timeStr}
                    </p>
                    <p className="text-slate-400">{currentRequest.serviceName}</p>
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
                  onClick={() => setMovingRequestId(currentRequest.id)}
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
                No pending appointment requests
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                New requests from WhatsApp and Instagram will show up here.
              </p>
              <div className="pt-3">
                <button
                  onClick={onSimulateNewRequest}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium text-[#5551FF] bg-[#5551FF]/8 hover:bg-[#5551FF]/15 transition-colors border border-[#5551FF]/20"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Simulate incoming booking</span>
                </button>
              </div>
            </div>
          )}

          {/* If there are more requests in queue */}
          {requests.length > 1 && (
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
              <span>+{requests.length - 1} more in queue</span>
              <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-medium">
                Next: {requests[1].customerName} ({requests[1].timeStr})
              </span>
            </div>
          )}
        </div>

        {/* Right Column: Next Appointment (span 4) */}
        <div className="lg:col-span-4 bg-white rounded-2xl p-6 sm:p-7 shadow-[0_2px_12px_rgba(0,0,0,0.03)] border border-slate-200/70 min-h-[190px] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">Next appointment</h3>
              <span className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">
                {nextAppointment?.dayName || 'WEDNESDAY'}
              </span>
            </div>

            {nextAppointment ? (
              <div className="space-y-3 pt-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold text-slate-900 tabular-nums">
                    {nextAppointment.time}
                  </span>
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-800">
                    {nextAppointment.customerName}
                  </p>
                  <p className="text-xs text-slate-500 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>Staff : {nextAppointment.staffName}</span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-xs text-slate-400">
                <Clock className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                No appointment scheduled for this slot
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 mt-4 flex items-center justify-between text-[11px] text-slate-400">
            <span>Room 1 · Chair A</span>
            <span className="text-emerald-600 font-medium">Confirmed</span>
          </div>
        </div>
      </div>

      {/* Today's Activity + Conversations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-8 space-y-4">
        {/* Header & Export Button */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Today’s Activity
            </h2>
            <p className="text-xs text-slate-400 font-medium">Activity Summary</p>
          </div>

          <button
            onClick={onExportActivity}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200/80 shadow-2xs transition-colors"
          >
            <Share2 className="w-3.5 h-3.5 text-slate-500" />
            <span>Export</span>
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
                    <p className="text-[11px] text-slate-500 truncate">{last.translation}</p>
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

      {/* Move Appointment Modal */}
      {movingRequestId && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full p-6 animate-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-slate-900 mb-2">Reschedule Appointment</h3>
            <p className="text-xs text-slate-500 mb-4">
              Select a new time slot for {currentRequest?.customerName}
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Time Slot</label>
                <select
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:border-[#5551FF]"
                >
                  <option value="10:30 - 11:00">10:30 - 11:00</option>
                  <option value="11:00 - 11:30">11:00 - 11:30</option>
                  <option value="11:30 - 12:00">11:30 - 12:00</option>
                  <option value="14:00 - 14:30">14:00 - 14:30</option>
                  <option value="16:00 - 16:30">16:00 - 16:30</option>
                </select>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  onClick={() => setMovingRequestId(null)}
                  className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onMoveRequest(movingRequestId, rescheduleTime);
                    setMovingRequestId(null);
                  }}
                  className="flex-1 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors"
                >
                  Confirm Move
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
