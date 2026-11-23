import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { AppointmentRequest, CalendarEvent, Conversation, Customer, NavigationTab } from '../types';
import { formatDate, formatDayMonth, formatMoney, formatMonth, formatTimeRange } from '../format';
import { type AvailabilityContext } from '../availability';
import { bookingSource } from '../bookingSource';
import { timeAgoLabel } from '../demoRequests';
import { periodLabel } from '../analytics';
import {
  aiSummary, bookedShare, bookedValue, changeInCount, changeInPercent, chatSummary, homeFigures, latestAiBookings, monthPace,
  todayOverview, weekDates, type Change,
} from '../dashboard';
import { isNewSince, lastHomeVisit, noteHomeVisit, rememberDayView, rememberedDayView, type DayView } from '../homeVisit';
import type { RequestAnswer } from '../inbox';
import { SourceIcon } from './CalendarGrid';
import { HomeInbox, type Outcome } from './HomeInbox';
import type { AnswerChat } from '../components/ChatBookingCards';

const CARD = 'rounded-2xl border border-slate-200/70 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]';
const LINK_BASE = 'inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg text-xs font-semibold text-[#5551FF] hover:underline';
const LINK = `${LINK_BASE} px-2`;
// The second line of a row: read at arm's length between two customers, so it is not set smaller than this.
const SMALL = 'text-[13px]';

const CHANGE_STYLE: Record<Change['direction'], string> = {
  up: 'bg-emerald-50 text-emerald-800',
  down: 'bg-rose-50 text-rose-800',
  same: 'bg-slate-100 text-slate-700',
};

/** How a figure stands against the month before: the short form for the eye, the sentence for a screen reader. */
const ChangeChip = ({ change, words }: { change: Change; words: string }) => (
  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${CHANGE_STYLE[change.direction]}`}>
    {change.direction === 'up' && <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
    {change.direction === 'down' && <TrendingDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
    <span aria-hidden="true">{change.label}</span>
    <span className="sr-only">{words}</span>
  </span>
);

/**
 * One figure of "This month": what it counts, the number, how it stands against the month
 * before, and a line of detail. On a phone the number stands to the right of its name, so three
 * figures are three short rows; from tablet width on they are three tiles.
 */
const Figure = ({ label, value, change, changeWords = '', detail }: {
  label: string; value: number | string; change?: Change | null; changeWords?: string; detail: React.ReactNode;
}) => (
  <div className={`${CARD} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 p-4 sm:block sm:p-5`}>
    <p className="col-start-1 row-start-1 text-sm font-semibold text-slate-800">{label}</p>
    <div className="col-start-2 row-span-2 row-start-1 flex flex-col items-end gap-1 sm:mt-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
      {/* The number is the message: it is set in the text colour. */}
      <p className="whitespace-nowrap text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">{value}</p>
      {change && <ChangeChip change={change} words={changeWords} />}
    </div>
    <p className={`col-start-1 row-start-2 ${SMALL} text-slate-500 sm:mt-1`}>{detail}</p>
  </div>
);

/**
 * One figure of the AI receptionist's month, as a row: what it counts on the left, the number on
 * the right. The card is narrow wherever it stands (a phone, or the left-hand column), and an
 * amount such as "CHF 2'335.00" needs the width of a row: three figures side by side ran into
 * each other.
 */
const AiFigure = ({ value, label, detail }: { value: number | string; label: string; detail: string }) => (
  <div className="flex items-center justify-between gap-3">
    <div className="min-w-0">
      <p className={`${SMALL} font-semibold text-slate-800`}>{label}</p>
      <p className="text-xs leading-snug text-slate-500">{detail}</p>
    </div>
    <p className="shrink-0 whitespace-nowrap text-lg font-bold tabular-nums text-slate-900">{value}</p>
  </div>
);

/**
 * How many of today's appointments a phone shows before "Show all": the card stays short enough
 * for the inbox below it to be on the first screen. From tablet width on the whole day is shown.
 */
const TODAY_ROWS = 3;

/** The person who is signed in, where they are one of the team: Today can show their own day. */
export interface SignedIn { id: string; name: string }

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
  /** Who is signed in. Left out, or in a salon of one, Today shows the one day there is. */
  me?: SignedIn | null;
  /**
   * When the owner last looked at Home (ISO), or null for a first visit: what the AI booked since
   * then is marked as new. Left out, the moment is kept in this browser (src/homeVisit.ts).
   */
  lastVisit?: string | null;
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
  /** Leads to another screen by its place in the menu: the rows of "Getting started" use it. */
  onOpenScreen?: (tab: NavigationTab) => void;
  /** The compact card with the customers' booking link. Shown at the end of the page when it is given. */
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
  me = null,
  lastVisit: givenLastVisit,
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
  onOpenScreen,
  bookingLink,
}) => {
  const clock = now ?? availabilityContext.now ?? new Date();
  const salon = { ...availabilityContext, now: clock };
  const { events, services, employees, timeZone } = availabilityContext;

  // Counted from the calendar on every render, by the functions Analytics uses.
  const figures = homeFigures(events, clock, timeZone);
  const pace = monthPace(events, services, clock, timeZone);
  const ai = aiSummary(availabilityContext, clock);
  const chats = chatSummary(conversations);
  const aiBookings = latestAiBookings(events);
  // The chats in one sentence, made of what there is to say: "Of your 7 chats, 3 ended in a booking and 4 wait for you."
  const chatParts = [
    chats.aiHandled > 0 ? `the AI answered ${chats.aiHandled} on its own` : '',
    chats.booked > 0 ? `${chats.booked} ended in a booking` : '',
    chats.waiting > 0 ? `${chats.waiting} ${chats.waiting === 1 ? 'waits' : 'wait'} for you` : '',
  ].filter(Boolean);
  const chatLine = chatParts.length === 0 ? null
    : `Of your ${chats.total} ${chats.total === 1 ? 'chat' : 'chats'}, ${chatParts.length === 1 ? chatParts[0] : `${chatParts.slice(0, -1).join(', ')} and ${chatParts.at(-1)}`}.`;

  // A salon that has not begun: no appointment, no request, no chat. Its figures would be a row
  // of zeros, so Home shows "Getting started" in their place.
  const notBegun = events.length === 0 && requests.length === 0 && conversations.length === 0;

  // What the AI booked since the owner last looked is marked as new. This visit is noted when
  // she leaves Home or the page, so the marks stay while she reads.
  const [lastVisit] = useState<string | null>(() => givenLastVisit !== undefined ? givenLastVisit : lastHomeVisit());
  useEffect(() => {
    if (givenLastVisit !== undefined) return;
    const note = () => noteHomeVisit(new Date());
    window.addEventListener('pagehide', note);
    return () => { window.removeEventListener('pagehide', note); note(); };
  }, [givenLastVisit]);

  // ---------- today: the team's day, or the owner's own ----------

  const staff = employees.filter((employee) => employee.status === 'Active');
  const self = me && staff.some((employee) => employee.id === me.id) ? me : null;
  // Ids decide; an older appointment without one is matched by the name.
  const isOwn = (event: CalendarEvent) => self !== null && (event.employeeId !== undefined ? event.employeeId === self.id : event.staffName === self.name);
  const teamDay = todayOverview(availabilityContext, clock);
  // A salon of one has one day, and a day without appointments is the same for everybody: there
  // is nothing to choose between.
  const canSwitch = self !== null && staff.length > 1 && teamDay.appointments.length > 0;
  const [chosenView, setChosenView] = useState<DayView>(() => rememberedDayView());
  const view: DayView = canSwitch ? chosenView : 'team';
  const mine = view === 'mine';
  const chooseView = (next: DayView) => { setChosenView(next); rememberDayView(next); };
  const ownDay = self ? todayOverview({ ...availabilityContext, events: events.filter(isOwn) }, clock) : null;
  const today = mine && ownDay ? ownDay : teamDay;

  // On a phone the card starts at what is going on now and shows a few rows.
  const [showWholeDay, setShowWholeDay] = useState(false);
  const total = today.appointments.length;
  const teamTotal = teamDay.appointments.length;
  const firstOpen = today.appointments.findIndex((item) => item.state !== 'done');
  const allDone = total > 0 && firstOpen < 0;
  const folds = total > TODAY_ROWS;
  const windowStart = firstOpen < 0 ? total : Math.max(0, Math.min(firstOpen, total - TODAY_ROWS));
  const inFirstRows = (index: number) => !folds || (index >= windowStart && index < windowStart + TODAY_ROWS);
  const closedToday = today.closed ? `The salon is closed today${today.closed.name ? ` (${today.closed.name})` : ''}.` : '';
  // The day in a sentence: closed, empty, over, or how many appointments it has.
  const dayInWords = today.closed
    ? total === 0 ? `${closedToday} ${mine ? 'You have no appointments.' : 'No appointments.'}`
      : `${closedToday} ${total === 1 ? `One appointment${mine ? ' of yours' : ''} is` : `${total} appointments${mine ? ' of yours' : ''} are`} in the calendar all the same.`
    : total === 0 ? (mine ? 'You have no appointments today.' : 'No appointments today.')
      : allDone
        ? total === 1 ? (mine ? 'Your appointment of today is over.' : 'Today’s appointment is over.') : `All ${total} ${mine ? 'of your appointments' : 'appointments'} of today are over.`
        : `${total} ${total === 1 ? 'appointment' : 'appointments'}`;
  // What the day is worth at list prices. No takings: the app records no payment.
  const dayValue = bookedValue(today.appointments.map((item) => item.event), services).value;

  // What stands after the number while appointments are still to come: the owner's part of the
  // team's day (or the team's day beside her own), then the value. Kept short, so the card stays
  // low enough on a phone for the inbox to begin on the first screen.
  const ownCount = ownDay ? ownDay.appointments.length : 0;
  const beside = !canSwitch || total === 0 ? null
    : mine ? (teamTotal > total ? `the team has ${teamTotal}` : null)
      : ownCount === 0 ? 'none with you' : ownCount === teamTotal ? (teamTotal === 1 ? 'with you' : 'all with you') : `${ownCount} with you`;
  const worth = total > 0 && dayValue > 0 ? `${formatMoney(dayValue)} booked` : null;
  const counts = !today.closed && total > 0 && !allDone;

  // How full the day and the week are: appointments against working hours (src/dashboard.ts, bookedShare).
  const counted = mine && self ? [self.id] : undefined;
  const shareToday = bookedShare(availabilityContext, [today.date], counted).share;
  const shareWeek = bookedShare(availabilityContext, weekDates(today.date), counted).share;
  // An empty calendar would only say "0%" twice.
  const workload = shareWeek === null || notBegun ? null
    : { label: mine ? 'Your working hours booked' : 'Working hours booked', shares: shareToday === null ? `${shareWeek}% this week` : `${shareToday}% today · ${shareWeek}% this week` };

  // ---------- this month against the month before ----------

  const before = pace.before;
  const beforeName = before ? formatMonth(before.month.from).split(' ')[0] : '';
  /** A change in words: "4% more than October at the same point", "1 fewer than …", "the same as …". */
  const inWords = (change: Change, unit: string, less: string) =>
    change.difference === 0 ? `the same as ${beforeName} at the same point`
      : `${Math.abs(change.difference)}${unit} ${change.difference > 0 ? 'more' : less} than ${beforeName} at the same point`;
  const valueChange = before ? changeInPercent(pace.soFar.value, before.value) : null;
  const countChange = before ? changeInCount(pace.soFar.appointments, before.appointments) : null;

  // ---------- a salon that has not begun ----------

  // No appointment, no request, no chat (see `notBegun` above): Home shows what is set up and where to go on.
  const openDays = availabilityContext.bookingHours.filter((day) => day.isOpen).length;
  const online = services.filter((service) => service.onlineBooking).length;
  const setUp: { tab: NavigationTab; title: string; state: string }[] = [
    { tab: 'settings', title: 'Opening hours', state: openDays === 0 ? 'No day is open yet' : `Open on ${openDays} ${openDays === 1 ? 'day' : 'days'} of the week` },
    { tab: 'services', title: 'Services and prices', state: services.length === 0 ? 'No service yet' : `${services.length} ${services.length === 1 ? 'service' : 'services'}, ${online} of them can be booked online` },
    { tab: 'team', title: 'Team and working hours', state: staff.length === 0 ? 'Nobody yet' : `${staff.length} ${staff.length === 1 ? 'person' : 'people'}` },
    { tab: 'ai-assistant', title: 'AI receptionist', state: 'How it answers, and what it hands over to you' },
  ];

  return (
    <div className="p-4 sm:p-6 xl:p-8 max-w-6xl mx-auto space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <h1 tabIndex={-1} className="sr-only">Home</h1>

      {notBegun && (
        <section aria-labelledby="home-start-title" className={CARD}>
          <div className="px-4 pt-4 sm:px-5">
            <h2 id="home-start-title" className="text-base font-bold tracking-tight text-slate-900">Getting started</h2>
            <p className={`mt-0.5 ${SMALL} text-slate-600`}>Your calendar is still empty. This is what is set up, and where to change it.</p>
          </div>
          <ul className="grid gap-x-4 px-2 pb-2 pt-2 sm:grid-cols-2 sm:px-3">
            {setUp.map((step) => {
              const words = (
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{step.title}</span>
                  <span className={`block ${SMALL} text-slate-600`}>{step.state}</span>
                </span>
              );
              return (
                <li key={step.tab}>
                  {onOpenScreen ? (
                    <button type="button" onClick={() => onOpenScreen(step.tab)} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-50">
                      {words}
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    </button>
                  ) : <div className="flex min-h-11 items-center gap-3 px-2 py-2">{words}</div>}
                </li>
              );
            })}
          </ul>
          <p className={`border-t border-slate-100 px-4 py-3 ${SMALL} leading-relaxed text-slate-600 sm:px-5`}>
            Then pass your booking link on to your customers, or add the first appointment yourself with the plus button.
          </p>
          {bookingLink && <div className="px-2 pb-2 sm:px-3">{bookingLink}</div>}
        </section>
      )}

      {/* Today on the left and the inbox on the right; on a phone one below the other, in this order. */}
      <div className="grid grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-12 lg:grid-rows-[auto_1fr]">
        <section aria-labelledby="home-today-title" className={`${CARD} lg:col-span-5 lg:col-start-1 lg:row-start-1`}>
          <div className="flex flex-wrap items-center gap-x-2 pl-4 pr-2 pt-2 sm:pl-5 sm:pr-3">
            <h2 id="home-today-title" className="text-base font-bold tracking-tight text-slate-900">Today</h2>
            {/* Whose day the card shows. Only where there is a choice: the owner is one of several who work here. */}
            {canSwitch && (
              <div role="group" aria-label="Whose day is shown" className="ml-1 inline-flex shrink-0 rounded-full bg-slate-100">
                {(['team', 'mine'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={view === option}
                    onClick={() => chooseView(option)}
                    className={`min-h-11 rounded-full px-2.5 text-xs font-semibold transition-colors sm:px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF] ${view === option ? 'bg-white text-[#433fd8] ring-1 ring-inset ring-slate-200' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    {option === 'team' ? 'Team' : 'My day'}
                  </button>
                ))}
              </div>
            )}
            {onOpenCalendar && (
              <button type="button" onClick={onOpenCalendar} className={`${LINK_BASE} ml-auto px-1 sm:px-2`}>
                Open calendar<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          {/* The date the page is about, then the day in a sentence and what it is worth at list prices. */}
          <p className={`px-4 pb-2.5 ${SMALL} leading-snug text-slate-600 sm:px-5 ${onOpenCalendar || canSwitch ? '' : 'mt-1'}`}>
            <span className="whitespace-nowrap text-sm font-semibold text-slate-800">{formatDate(today.date, { weekday: 'long' })}</span>{' '}
            <span>{dayInWords}</span>
            {/* A thin space of its own keeps each dot at the end of a line, never at the start of the next. */}
            {counts && beside && <><span aria-hidden="true">{'\u00a0· '}</span><span className="sr-only">, </span><span className="whitespace-nowrap">{beside}</span></>}
            {worth && (counts
              ? <><span aria-hidden="true">{'\u00a0· '}</span><span className="sr-only">, </span><span className="whitespace-nowrap">{worth}</span></>
              : <>{' '}<span className="whitespace-nowrap">{worth}.</span></>)}
          </p>

          {total > 0 && (
            <ul id="home-today-list" className="space-y-0.5 px-2 pb-2 sm:px-3">
              {today.appointments.map(({ event, state }, index) => (
                <li key={event.id} className={showWholeDay || inFirstRows(index) ? '' : 'hidden lg:block'}>
                  <button
                    type="button"
                    onClick={() => onOpenAppointment(event)}
                    className={`flex min-h-11 w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors ${state === 'next' ? 'bg-indigo-50/80 hover:bg-indigo-50' : 'hover:bg-slate-50'}`}
                  >
                    <span className="w-[5.5rem] shrink-0">
                      <span className={`block text-sm tabular-nums ${state === 'done' ? 'text-slate-500' : 'font-semibold text-slate-900'}`}>
                        {formatTimeRange(event.startTime, event.endTime)}
                      </span>
                      {state === 'next' && <span className="mt-0.5 inline-block rounded-full bg-[#5551FF] px-2 py-0.5 text-xs font-bold leading-tight text-white">Next</span>}
                      {state === 'now' && <span className="mt-0.5 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold leading-tight text-emerald-800">Now</span>}
                      {state === 'done' && <span className="sr-only">Over</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`flex items-center gap-1.5 text-sm ${state === 'done' ? 'text-slate-500' : 'font-semibold text-slate-900'}`}>
                        <span className="min-w-0 [overflow-wrap:anywhere]">{event.customerName}</span>
                        {/* What the AI brought in is marked as in the calendar; every other booking is the salon's own. */}
                        {bookingSource(event) === 'ai' && <span className="text-amber-600"><SourceIcon event={event} className="h-3.5 w-3.5" /></span>}
                      </span>
                      {/* On the tint of the next appointment the grey of the other rows would be too pale to read. */}
                      <span className={`block ${SMALL} [overflow-wrap:anywhere] ${state === 'next' ? 'text-slate-600' : 'text-slate-500'}`}>
                        {mine ? event.serviceName : `${event.serviceName} · ${event.staffName}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
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
                  <span className={`block ${SMALL} font-medium text-slate-500`}>{mine ? 'Your next appointment' : 'Next appointment'}</span>
                  <span className="block text-sm font-semibold text-slate-900">
                    <span className="whitespace-nowrap">{formatDate(today.following.date)},</span>{' '}
                    <span className="whitespace-nowrap tabular-nums">{formatTimeRange(today.following.startTime, today.following.endTime)}</span>
                  </span>
                  <span className={`block ${SMALL} text-slate-500 [overflow-wrap:anywhere]`}>
                    {today.following.customerName} · {today.following.serviceName}{mine ? '' : ` · ${today.following.staffName}`}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* The foot of the card, one row: how full the day and the week are (where time is still free,
              there is room for a booking), and on a phone the way to the rest of the day. */}
          {(workload || folds) && (
            <div className={`flex items-center justify-between gap-3 border-t border-slate-100 pl-4 pr-2 sm:pl-5 sm:pr-3 ${workload ? '' : 'lg:hidden'}`}>
              {workload ? (
                <p className="min-w-0 py-1.5 leading-tight">
                  <span className="block text-xs text-slate-500">{workload.label}</span>
                  <span className={`block ${SMALL} font-semibold tabular-nums text-slate-700`}>{workload.shares}</span>
                </p>
              ) : <span />}
              {folds && (
                <button
                  type="button"
                  aria-expanded={showWholeDay}
                  aria-controls="home-today-list"
                  onClick={() => setShowWholeDay((shown) => !shown)}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[#5551FF] hover:underline lg:hidden"
                >
                  {showWholeDay ? 'Show fewer' : `Show all ${total}`}<span className="sr-only">{showWholeDay ? '' : ' appointments'}</span>
                  {showWholeDay ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              )}
            </div>
          )}
        </section>

        <div className="lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1">
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
        </div>

        {/* What the AI receptionist brought in: its month in figures, then its newest bookings, each a way to its appointment. */}
        {!notBegun && (
          <section aria-labelledby="home-ai-title" className={`${CARD} lg:col-span-5 lg:col-start-1 lg:row-start-2`}>
            <div className="px-4 pt-4 sm:px-5">
              <h2 id="home-ai-title" className="flex items-center gap-2 text-base font-bold tracking-tight text-slate-900">
                <Sparkles className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />AI receptionist
              </h2>
              {aiBookings.length === 0 && <p className={`mt-0.5 ${SMALL} text-slate-600`}>The AI has not booked an appointment yet.</p>}
            </div>
            {aiBookings.length > 0 && (
              <>
                <p className={`px-4 pt-0.5 ${SMALL} text-slate-600 sm:px-5`}>{periodLabel(ai.month)}, by the day of the appointment</p>
                <div className="space-y-2 px-4 pt-3 sm:px-5">
                  <AiFigure value={ai.bookings} label={ai.bookings === 1 ? 'Booking' : 'Bookings'} detail={ai.share === null ? 'none this month' : `${ai.share}% of appointments`} />
                  <AiFigure value={formatMoney(ai.value)} label="Booked value" detail="at list prices" />
                  {ai.whileClosed !== null && <AiFigure value={ai.whileClosed} label="While closed" detail="outside opening hours" />}
                </div>
              </>
            )}
            {chatLine && <p className={`px-4 pt-3 ${SMALL} leading-relaxed text-slate-600 sm:px-5`}>{chatLine}</p>}
            {aiBookings.length > 0 ? (
              <>
                <h3 className="px-4 pt-4 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-5">Latest bookings</h3>
                <ul className="space-y-0.5 px-2 pb-2 pt-1 sm:px-3">
                  {aiBookings.map((event) => (
                    <li key={event.id}>
                      <button
                        type="button"
                        onClick={() => onOpenAppointment(event)}
                        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
                              <span className="min-w-0 [overflow-wrap:anywhere]">{event.customerName}</span>
                              {isNewSince(event.createdAt, lastVisit) && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold leading-tight text-amber-900">New</span>}
                            </span>
                            {event.createdAt && <span className="whitespace-nowrap text-xs text-slate-500">Booked {timeAgoLabel(event.createdAt, clock).replace(/^[A-Z]/, (letter) => letter.toLowerCase())}</span>}
                          </span>
                          <span className={`block ${SMALL} text-slate-500`}>
                            {event.serviceName} · <span className="whitespace-nowrap">{formatDate(event.date)},</span>{' '}
                            <span className="whitespace-nowrap tabular-nums">{formatTimeRange(event.startTime, event.endTime)}</span>
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : <div className="pb-4" />}
          </section>
        )}
      </div>

      {/* How the month is going, against the month before at the same point */}
      {!notBegun && (
        <section aria-labelledby="home-month-title" className="space-y-4">
          {/* Heading and the way to Analytics, which also holds the export */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
            <h2 id="home-month-title" className="col-start-1 row-start-1 text-lg font-bold text-slate-900 tracking-tight">
              This month
            </h2>
            <p className={`col-span-2 row-start-2 ${SMALL} text-slate-600`}>
              {periodLabel(figures.month)} · {figures.appointments} {figures.appointments === 1 ? 'appointment' : 'appointments'}, past and upcoming
            </p>
            {onOpenAnalytics && (
              <button type="button" onClick={onOpenAnalytics} className={`${LINK} col-start-2 row-start-1 -mr-2`}>
                View analytics<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* What has taken place, in francs and in appointments, and what is still booked. Analytics splits the month the same way. */}
          <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
            <Figure
              label="Booked value so far"
              value={formatMoney(pace.soFar.value)}
              change={valueChange}
              changeWords={valueChange ? inWords(valueChange, '%', 'less') : ''}
              detail={pace.unpriced > 0 ? `at list prices · ${pace.unpriced} without a price` : 'at list prices'}
            />
            <Figure
              label="Appointments so far"
              value={pace.soFar.appointments}
              change={countChange}
              changeWords={countChange ? inWords(countChange, '', 'fewer') : ''}
              detail={`of ${figures.appointments} this month`}
            />
            <Figure
              label="Still to come"
              value={pace.stillToCome.appointments}
              detail={<><span className="whitespace-nowrap">{formatMoney(pace.stillToCome.value)} booked,</span> <span className="whitespace-nowrap">until {formatDayMonth(pace.month.to)}</span></>}
            />
          </div>
          {before && (
            <p className="text-xs text-slate-500">
              Compared with {beforeName} at the same point: <span className="whitespace-nowrap">{formatDate(before.until.date)},</span> <span className="whitespace-nowrap tabular-nums">{before.until.time}.</span>
            </p>
          )}
        </section>
      )}

      {/* The customers' booking link: needed now and then, so it stands last. A salon that has not begun finds it under "Getting started". */}
      {!notBegun && bookingLink}
    </div>
  );
};
