import React, { useState } from 'react';
import {
  CalendarDays,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Sparkles,
  Users,
} from 'lucide-react';
import { AppointmentRequest, CalendarEvent, Conversation, Customer } from '../types';
import { formatDate, formatTimeRange } from '../format';
import { type AvailabilityContext } from '../availability';
import { timeAgoLabel } from '../demoRequests';
import { periodLabel } from '../analytics';
import { homeFigures, latestAiBookings, todayOverview } from '../dashboard';
import type { RequestAnswer } from '../inbox';
import { HomeInbox, type Outcome } from './HomeInbox';
import type { AnswerChat } from '../components/ChatBookingCards';

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

const CARD = 'rounded-2xl border border-slate-200/70 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]';
const LINK = 'inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg px-2 text-xs font-semibold text-[#5551FF] hover:underline';

/**
 * How many of today's appointments a phone shows before "Show all": the card stays short enough
 * for the inbox below it to be on the first screen. A wide screen shows the whole day.
 */
const TODAY_ROWS = 3;

interface HomeViewProps {
  requests: AppointmentRequest[];
  /** A request the owner came here for (a search result, a link): it is brought into view and marked. */
  selectedRequestId: string | null;
  availabilityContext: AvailabilityContext;
  /** Every chat the owner sees, live ones included: the inbox lists what the Chats badge counts. */
  conversations: Conversation[];
  /** The customer records: a request links to its customer, and the ready texts take the customer's language from here. */
  customers?: Customer[];
  /** The salon's name from Settings, for the texts the owner passes on to a customer. */
  salonName?: string;
  /** The current moment, refreshed by the app every minute. */
  now?: Date;
  /** The answers given a moment ago: each stays in the place of its request for a short while. */
  answers?: RequestAnswer[];
  /** Each returns why it could not be done, and nothing (or null) when it is done. */
  onAcceptRequest: (id: string) => Outcome;
  onRejectRequest: (id: string) => void;
  onMoveRequest: (id: string, date: string, startTime: string) => Outcome;
  onUndoAnswer?: (id: string) => Outcome;
  onDismissAnswer?: (kind: RequestAnswer['kind'], id: string) => void;
  /** Answers a booking request or a cancellation that waits in a chat (src/App.tsx, handleChatBooking). */
  onChatBooking?: AnswerChat;
  onSimulateNewRequest: () => void;
  onOpenAppointment: (event: CalendarEvent) => void;
  /** Leads to today in the calendar. The link is shown only when it has a target. */
  onOpenCalendar?: () => void;
  /** Leads to the same figures for any period. The link is shown only when it has a target. */
  onOpenAnalytics?: () => void;
  onOpenConversations: (conversationId?: string) => void;
  onOpenCustomer?: (customerId: string) => void;
  /** The compact card with the customers' booking link. Shown below the inbox when it is given. */
  bookingLink?: React.ReactNode;
}

export const HomeView: React.FC<HomeViewProps> = ({
  requests,
  selectedRequestId,
  availabilityContext,
  conversations,
  customers = [],
  salonName = '',
  now,
  answers = [],
  onAcceptRequest,
  onRejectRequest,
  onMoveRequest,
  onUndoAnswer,
  onDismissAnswer,
  onChatBooking,
  onSimulateNewRequest,
  onOpenAppointment,
  onOpenCalendar,
  onOpenAnalytics,
  onOpenConversations,
  onOpenCustomer,
  bookingLink,
}) => {
  const clock = now ?? availabilityContext.now ?? new Date();
  const salon = { ...availabilityContext, now: clock };

  // Counted from the calendar on every render, by the functions Analytics uses.
  const figures = homeFigures(availabilityContext.events, clock, availabilityContext.timeZone);
  const today = todayOverview(availabilityContext, clock);
  const aiBookings = latestAiBookings(availabilityContext.events);

  // Today: on a phone the card starts at what is going on now and shows a few rows.
  const [showWholeDay, setShowWholeDay] = useState(false);
  const total = today.appointments.length;
  const firstOpen = today.appointments.findIndex((item) => item.state !== 'done');
  const allDone = total > 0 && firstOpen < 0;
  const folds = total > TODAY_ROWS;
  const windowStart = firstOpen < 0 ? total : Math.max(0, Math.min(firstOpen, total - TODAY_ROWS));
  const inFirstRows = (index: number) => !folds || (index >= windowStart && index < windowStart + TODAY_ROWS);
  const closedToday = today.closed ? `The salon is closed today${today.closed.name ? ` (${today.closed.name})` : ''}.` : '';
  // The day in a sentence: closed, empty, over, or how many appointments it has.
  const dayInWords = today.closed
    ? total === 0 ? `${closedToday} No appointments.` : `${closedToday} ${total === 1 ? 'One appointment is' : `${total} appointments are`} in the calendar all the same.`
    : total === 0 ? 'No appointments today.'
      : allDone ? (total === 1 ? 'Today’s appointment is over.' : `All ${total} appointments of today are over.`)
        : `${total} ${total === 1 ? 'appointment' : 'appointments'}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <h1 tabIndex={-1} className="sr-only">Home</h1>

      {/* Today on the left and the inbox on the right; on a phone one below the other, in this order. */}
      <div className="grid grid-cols-1 items-start gap-5 sm:gap-6 xl:grid-cols-12 xl:grid-rows-[auto_1fr]">
        <section aria-labelledby="home-today-title" className={`${CARD} xl:col-span-5 xl:col-start-1 xl:row-start-1`}>
          <div className="flex items-center justify-between gap-2 pl-4 pr-2 pt-2 sm:pl-5 sm:pr-3">
            <h2 id="home-today-title" className="text-base font-bold tracking-tight text-slate-900">Today</h2>
            {onOpenCalendar && (
              <button type="button" onClick={onOpenCalendar} className={LINK}>
                Open calendar<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          {/* The date the page is about, then the day in a sentence. */}
          <p className={`flex flex-wrap items-baseline gap-x-2 px-4 pb-3 text-xs text-slate-500 sm:px-5 ${onOpenCalendar ? '-mt-1.5' : 'mt-1'}`}>
            <span className="whitespace-nowrap text-sm font-semibold text-slate-800">{formatDate(today.date, { weekday: 'long' })}</span>
            <span>{dayInWords}</span>
          </p>

          {total > 0 && (
            <ul id="home-today-list" className="space-y-0.5 px-2 pb-2 sm:px-3">
              {today.appointments.map(({ event, state }, index) => (
                <li key={event.id} className={showWholeDay || inFirstRows(index) ? '' : 'hidden xl:block'}>
                  <button
                    type="button"
                    onClick={() => onOpenAppointment(event)}
                    className={`flex min-h-11 w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors ${state === 'next' ? 'bg-indigo-50/80 hover:bg-indigo-50' : 'hover:bg-slate-50'}`}
                  >
                    <span className="w-[5.5rem] shrink-0">
                      <span className={`block text-sm tabular-nums ${state === 'done' ? 'text-slate-500' : 'font-semibold text-slate-900'}`}>
                        {formatTimeRange(event.startTime, event.endTime)}
                      </span>
                      {state === 'next' && <span className="mt-0.5 inline-block rounded-full bg-[#5551FF] px-2 py-0.5 text-[11px] font-bold leading-tight text-white">Next</span>}
                      {state === 'now' && <span className="mt-0.5 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold leading-tight text-emerald-800">Now</span>}
                      {state === 'done' && <span className="sr-only">Over</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm [overflow-wrap:anywhere] ${state === 'done' ? 'text-slate-500' : 'font-semibold text-slate-900'}`}>{event.customerName}</span>
                      <span className="block text-xs text-slate-500 [overflow-wrap:anywhere]">{event.serviceName} · {event.staffName}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {folds && (
            <div className="border-t border-slate-100 px-2 xl:hidden sm:px-3">
              <button
                type="button"
                aria-expanded={showWholeDay}
                aria-controls="home-today-list"
                onClick={() => setShowWholeDay((shown) => !shown)}
                className="flex min-h-11 w-full items-center justify-center gap-1 rounded-lg text-xs font-semibold text-[#5551FF] hover:underline"
              >
                {showWholeDay ? 'Show fewer' : `Show all ${total} appointments`}
                {showWholeDay ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            </div>
          )}

          {/* Nothing more today: the way to the next appointment, whatever day it is on. */}
          {today.following && (
            <div className="border-t border-slate-100 px-2 py-1 sm:px-3">
              <button
                type="button"
                onClick={() => onOpenAppointment(today.following!)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-slate-500">Next appointment</span>
                  <span className="block text-sm font-semibold text-slate-900">
                    <span className="whitespace-nowrap">{formatDate(today.following.date)},</span>{' '}
                    <span className="whitespace-nowrap tabular-nums">{formatTimeRange(today.following.startTime, today.following.endTime)}</span>
                  </span>
                  <span className="block text-xs text-slate-500 [overflow-wrap:anywhere]">{today.following.customerName} · {today.following.serviceName} · {today.following.staffName}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              </button>
            </div>
          )}
        </section>

        <div className="space-y-5 sm:space-y-6 xl:col-span-7 xl:col-start-6 xl:row-span-2 xl:row-start-1">
          <HomeInbox
            requests={requests}
            conversations={conversations}
            customers={customers}
            answers={answers}
            salon={salon}
            clock={clock}
            salonName={salonName}
            selectedRequestId={selectedRequestId}
            onAcceptRequest={onAcceptRequest}
            onRejectRequest={onRejectRequest}
            onMoveRequest={onMoveRequest}
            onUndoAnswer={onUndoAnswer}
            onDismissAnswer={onDismissAnswer}
            onChatBooking={onChatBooking}
            onOpenConversations={onOpenConversations}
            onOpenCustomer={onOpenCustomer}
            onOpenAppointment={onOpenAppointment}
            onSimulateNewRequest={onSimulateNewRequest}
          />
          {bookingLink}
        </div>

        {/* What the AI booked without the owner: the newest bookings, each a way to its appointment. */}
        <section aria-labelledby="home-ai-title" className={`${CARD} xl:col-span-5 xl:col-start-1 xl:row-start-2`}>
          <div className="px-4 pt-4 sm:px-5">
            <h2 id="home-ai-title" className="flex items-center gap-2 text-base font-bold tracking-tight text-slate-900">
              <Sparkles className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />Booked by the AI
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {aiBookings.length > 0 ? 'The newest bookings first.' : 'The AI has not booked an appointment yet.'}
            </p>
          </div>
          {aiBookings.length > 0 ? (
            <ul className="space-y-0.5 px-2 pb-2 pt-2 sm:px-3">
              {aiBookings.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => onOpenAppointment(event)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{event.customerName}</span>
                        {event.createdAt && <span className="whitespace-nowrap text-[11px] text-slate-500">Booked {timeAgoLabel(event.createdAt, clock).replace(/^[A-Z]/, (letter) => letter.toLowerCase())}</span>}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {event.serviceName} · <span className="whitespace-nowrap">{formatDate(event.date)},</span>{' '}
                        <span className="whitespace-nowrap tabular-nums">{formatTimeRange(event.startTime, event.endTime)}</span>
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : <div className="pb-4" />}
        </section>
      </div>

      {/* This month's figures */}
      <div className="space-y-4">
        {/* Heading and the way to Analytics, which also holds the export */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
          <h2 className="col-start-1 row-start-1 text-lg font-bold text-slate-900 tracking-tight">
            This month
          </h2>
          <p className="col-span-2 row-start-2 text-xs text-slate-500">{periodLabel(figures.month)} · past and upcoming appointments</p>
          {onOpenAnalytics && (
            <button type="button" onClick={onOpenAnalytics} className={`${LINK} col-start-2 row-start-1 -mr-2`}>
              View analytics<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Four figures of the month. Analytics shows the same numbers for "This month". */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
    </div>
  );
};
