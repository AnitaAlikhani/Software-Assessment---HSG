import React, { useEffect, useState } from 'react';
import { BarChart3, Calendar, CalendarRange, ChevronDown, ChevronRight, ChevronUp, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { AppointmentRequest, CalendarEvent, Conversation, Customer, NavigationTab } from '../types';
import { formatDate, formatDateRange, formatDayMonth, formatMoney, formatMonth, formatTimeRange } from '../format';
import { type AvailabilityContext } from '../availability';
import { bookingSource } from '../bookingSource';
import { timeAgoLabel } from '../demoRequests';
import { periodLabel } from '../analytics';
import {
  aiSummary, bookedShare, bookedValue, changeInCount, changeInPercent, chatSummary, dayPart, homeFigures, latestAiBookings, monthCurve, monthPace,
  openState, todayOverview, weekDates, weekLoad, type Change, type OpenState,
} from '../dashboard';
import { isNewSince, lastHomeVisit, noteHomeVisit, rememberDayView, rememberedDayView, type DayView } from '../homeVisit';
import { inboxItems, type InboxItem, type RequestAnswer } from '../inbox';
import { getSalonNow } from '../scheduling';
import { staffColorFor } from '../staffColors';
import { useLaptopScreen, useWideScreen } from '../useWideScreen';
import { SourceIcon } from './CalendarGrid';
import { Meter, PaceChart, WeekBars } from './HomeCharts';
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
 * figures are three short rows. From tablet width on they stand side by side in the one card,
 * a hairline between them, each read from top to bottom: the name, the number alone on its
 * line, the comparison, the detail. `lead` is the figure the block opens with: its number is larger.
 */
const Figure = ({ label, value, change, changeWords = '', detail, lead = false }: {
  label: string; value: number | string; change?: Change | null; changeWords?: string; detail: React.ReactNode; lead?: boolean;
}) => (
  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-3 first:pt-0 last:pb-0 sm:block sm:px-4 sm:py-0 sm:first:pl-0 sm:last:pr-0 2xl:px-5">
    <p className={`col-start-1 row-start-1 ${SMALL} font-semibold text-slate-600`}>{label}</p>
    <div className="col-start-2 row-span-2 row-start-1 flex flex-col items-end gap-1 sm:mt-1 sm:items-start">
      {/* The number is the message: it is set in the text colour. In a column of numbers (a phone) every digit has one width; a large number alone needs none. */}
      <p className={`whitespace-nowrap text-xl font-bold tracking-tight tabular-nums text-slate-900 sm:normal-nums ${lead ? 'sm:text-[2rem] sm:leading-10' : 'sm:text-2xl sm:leading-10'}`}>{value}</p>
      {change && <ChangeChip change={change} words={changeWords} />}
    </div>
    <p className={`col-start-1 row-start-2 ${SMALL} text-slate-500 sm:mt-1.5`}>{detail}</p>
  </div>
);

/** A card's title, with the icon of the screen it leads to. The icon is a picture only. */
const TITLE = 'flex items-center gap-2 text-base font-bold tracking-tight text-slate-900';
const TITLE_ICON = 'h-4 w-4 shrink-0 text-slate-400';

const OPEN_WORDS = (open: OpenState): string =>
  open.state === 'open' ? `Open until ${open.closes}`
    : open.state === 'before' ? `Opens at ${open.opens}`
      : open.state === 'after' ? 'Closed for today'
        : `Closed today${open.name ? ` (${open.name})` : ''}`;

/** Whether the salon is open right now, beside Home's greeting. The dot is green only while it is; the words say it either way. */
const OpenChip = ({ open }: { open: OpenState }) => (
  <p className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${open.state === 'open' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
    <span className="whitespace-nowrap tabular-nums">{OPEN_WORDS(open)}</span>
  </p>
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
  /**
   * Leads to the calendar: to today, or with a date (a day of "This week") to that day. The
   * links are shown only when they have a target.
   */
  onOpenCalendar?: (date?: string) => void;
  /** Leads to the same figures for any period. The link is shown only when it has a target. */
  onOpenAnalytics?: () => void;
  onOpenConversations: (conversationId?: string) => void;
  onOpenCustomer?: (customerId: string) => void;
  /** Leads to another screen by its place in the menu: the rows of "Getting started" use it. */
  onOpenScreen?: (tab: NavigationTab) => void;
  /** The compact card with the customers' booking link. Shown at the end of the page when it is given. */
  bookingLink?: React.ReactNode;
  /**
   * The same link as two buttons. A wide screen shows them beside the greeting and leaves the
   * card out: the link is a tool of the page, not one of its figures. A salon that has not begun
   * keeps the card, under "Getting started".
   */
  bookingLinkButtons?: React.ReactNode;
}

/**
 * Rough heights on a laptop, in pixels: an entry of the inbox by its kind, and the cards beside
 * it (the week with the gap above it). They only have to tell a full inbox from a short one and
 * a busy day from an empty one.
 */
const ENTRY_HEIGHT: Record<InboxItem['kind'], number> = {
  chat: 90, request: 185, 'chat-request': 275, 'chat-cancellation': 230, 'request-answered': 330, 'chat-request-answered': 190,
};
const INBOX_HEAD = 52;
const INBOX_EMPTY = 125;
const TODAY_HEAD = 165;
const TODAY_ROW = 57;
const TODAY_EMPTY = 215;
const WEEK_CARD = 300;

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
  bookingLinkButtons,
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
  // The week day by day, for the same people: the team's, or the owner's own.
  const week = weekLoad({ ...availabilityContext, timeZone }, clock, counted);
  const weekTotal = week.reduce((sum, day) => sum + day.appointments, 0);

  // ---------- this month against the month before ----------

  const before = pace.before;
  const beforeName = before ? formatMonth(before.month.from).split(' ')[0] : '';
  /** A change in words: "4% more than October at the same point", "1 fewer than …", "the same as …". */
  const inWords = (change: Change, unit: string, less: string) =>
    change.difference === 0 ? `the same as ${beforeName} at the same point`
      : `${Math.abs(change.difference)}${unit} ${change.difference > 0 ? 'more' : less} than ${beforeName} at the same point`;
  const valueChange = before ? changeInPercent(pace.soFar.value, before.value) : null;
  const countChange = before ? changeInCount(pace.soFar.appointments, before.appointments) : null;
  // The month as a line. A month without anything of worth in it, and with no month before to
  // set it against, would be a flat line: then the figures stand alone.
  const curve = monthCurve(events, services, clock, timeZone);
  const drawn = before !== null || (curve.days.at(-1)?.value ?? 0) > 0;

  // ---------- a wide screen: a greeting, two columns, and on a laptop the month first ----------

  const wide = useWideScreen();
  const laptop = useLaptopScreen();
  const open = openState(availabilityContext, clock);
  const firstName = me ? employees.find((employee) => employee.id === me.id)?.firstName || me.name.split(' ')[0] : '';
  const greeting = `Good ${dayPart(getSalonNow(timeZone, clock).time)}${firstName ? `, ${firstName}` : ''}`;
  // The AI's card stands in the shorter of the two columns: beside an inbox that is longer than
  // Today and the week together, under one that is shorter. How long they are is estimated from
  // what is in them (see ENTRY_HEIGHT). Decided once per visit: a card that changed sides while
  // the owner answers a request would move the page under her hand.
  const [inboxIsLonger] = useState(() => {
    const entries = inboxItems({ requests, conversations, events, answers, timeZone, now: clock });
    const inboxHeight = entries.length === 0 ? INBOX_EMPTY : entries.reduce((sum, entry) => sum + ENTRY_HEIGHT[entry.kind], INBOX_HEAD);
    return inboxHeight > (total === 0 ? TODAY_EMPTY : TODAY_HEAD + total * TODAY_ROW) + WEEK_CARD;
  });

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

  // ---------- the cards ----------

  // The same cards on every screen. A narrow screen sets them one below the other; a wide one
  // puts the month first and the rest in two columns (see the two layouts at the end).

  const startCard = notBegun && (
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
  );

  /** The stylist's colour, as the calendar and Team show it. Ids decide; an older appointment without one is matched by the name. */
  const colourOf = (event: CalendarEvent) =>
    staffColorFor(employees, event.employeeId ?? employees.find((employee) => employee.name === event.staffName)?.id);

  const todayCard = (
    <section aria-labelledby="home-today-title" className={CARD}>
      <div className="flex flex-wrap items-center gap-x-2 pl-4 pr-2 pt-2 sm:pl-5 sm:pr-3">
        <h2 id="home-today-title" className={TITLE}><Calendar className={TITLE_ICON} aria-hidden="true" />Today</h2>
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
          <button type="button" onClick={() => onOpenCalendar()} className={`${LINK_BASE} ml-auto px-1 sm:px-2`}>
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
                {/* The team's day: each row wears its stylist's colour at its edge, as in the calendar. The name stands on the row as well. */}
                {!mine && <span aria-hidden="true" className="mt-0.5 h-9 w-1 shrink-0 rounded-full" style={{ backgroundColor: state === 'done' ? colourOf(event).pastAccent : colourOf(event).accent }} />}
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
  );

  const inbox = (
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
  );

  // What the AI receptionist brought in: its month in figures, then its newest bookings, each a way to its appointment.
  const aiCard = !notBegun && (
    <section aria-labelledby="home-ai-title" className={CARD}>
      <div className="px-4 pt-4 sm:px-5">
        <h2 id="home-ai-title" className={TITLE}>
          <Sparkles className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />AI receptionist
        </h2>
        {aiBookings.length === 0 && <p className={`mt-0.5 ${SMALL} text-slate-600`}>The AI has not booked an appointment yet.</p>}
      </div>
      {aiBookings.length > 0 && (
        <>
          <p className={`px-4 pt-0.5 ${SMALL} text-slate-600 sm:px-5`}>{periodLabel(ai.month)}, by the day of the appointment</p>
          <div className="space-y-2 px-4 pt-3 sm:px-5">
            <div>
              <AiFigure value={ai.bookings} label={ai.bookings === 1 ? 'Booking' : 'Bookings'} detail={ai.share === null ? 'none this month' : `${ai.share}% of appointments`} />
              {/* The AI's share of the month's appointments, drawn: the amber of everything the AI brought in. */}
              {ai.share !== null && <Meter share={ai.share} tone="ai" className="mt-1.5" />}
            </div>
            <AiFigure value={formatMoney(ai.value)} label="Booked value" detail="at list prices" />
            {ai.whileClosed !== null && <AiFigure value={ai.whileClosed} label="While closed" detail="outside opening hours" />}
          </div>
        </>
      )}
      {chatLine && <p className={`px-4 pt-3 ${SMALL} leading-relaxed text-slate-600 sm:px-5`}>{chatLine}</p>}
      {aiBookings.length > 0 ? (
        <>
          <h3 className={`mt-4 border-t border-slate-100 px-4 pt-3 ${SMALL} font-semibold text-slate-700 sm:px-5`}>Latest bookings</h3>
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
  );

  // The week, day by day: where it is full and where there is room. A day leads to itself in the calendar.
  const weekCard = !notBegun && (
    <section aria-labelledby="home-week-title" className={CARD}>
      <div className="px-4 pt-4 sm:px-5">
        <h2 id="home-week-title" className={TITLE}><CalendarRange className={TITLE_ICON} aria-hidden="true" />This week</h2>
        <p className={`mt-0.5 ${SMALL} text-slate-600`}>
          <span className="whitespace-nowrap tabular-nums">{formatDateRange(week[0].date, week[6].date)}</span> · <span className="whitespace-nowrap">{weekTotal} {weekTotal === 1 ? 'appointment' : 'appointments'}{mine ? ' with you' : ''}</span>
        </p>
      </div>
      <div className="px-3 pb-4 pt-3 sm:px-4">
        <WeekBars days={week} mine={mine} onOpenDay={onOpenCalendar} />
      </div>
    </section>
  );

  // How the month is going, against the month before at the same point: the figures, then the same in a line.
  const monthCard = !notBegun && (
    <section aria-labelledby="home-month-title" className={`${CARD} p-4 sm:p-5 xl:px-6`}>
      <div className={drawn ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_20.5rem] xl:grid-rows-[auto_auto_1fr] xl:gap-x-8 2xl:grid-cols-[minmax(0,1fr)_23rem]' : ''}>
        {/* Heading and the way to Analytics, which also holds the export. Where the card is wide, the period stands on the heading's line. */}
        <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 xl:flex xl:items-baseline ${drawn ? 'xl:col-span-2' : ''}`}>
          <h2 id="home-month-title" className={`col-start-1 row-start-1 ${TITLE} xl:shrink-0 xl:self-center`}>
            <BarChart3 className={TITLE_ICON} aria-hidden="true" />This month
          </h2>
          <p className={`col-span-2 row-start-2 ${SMALL} text-slate-600 xl:min-w-0 xl:flex-1 xl:self-center`}>
            {periodLabel(figures.month)} · {figures.appointments} {figures.appointments === 1 ? 'appointment' : 'appointments'}, past and upcoming
          </p>
          {onOpenAnalytics && (
            <button type="button" onClick={onOpenAnalytics} className={`${LINK} col-start-2 row-start-1 -mr-2`}>
              View analytics<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* What has taken place, in francs and in appointments, and what is still booked. Analytics splits the month the same way. */}
        <div className="mt-4 divide-y divide-slate-100 xl:mt-2 sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:divide-x sm:divide-y-0 xl:col-start-1">
          <Figure
            lead
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
          <p className="mt-4 text-xs text-slate-500 xl:col-start-1 xl:mt-3">
            Compared with {beforeName} at the same point: <span className="whitespace-nowrap">{formatDate(before.until.date)},</span> <span className="whitespace-nowrap tabular-nums">{before.until.time}.</span>
          </p>
        )}
        {/* The same month as a line. Below the figures; beside them where the card is wide enough. */}
        {drawn && (
          <PaceChart
            curve={curve} month={pace.month}
            className="mt-5 border-t border-slate-100 pt-4 xl:col-start-2 xl:row-span-2 xl:row-start-2 xl:mt-2 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0"
          />
        )}
      </div>
    </section>
  );

  // The customers' booking link: needed now and then, so it stands last. A salon that has not begun finds it under "Getting started".
  const link = !notBegun && bookingLink;

  // ---------- a wide screen ----------

  // A laptop has room for a dashboard: a greeting with whether the salon is open and, at the far
  // end of its row, the booking link as two buttons; the month's figures first; and below them
  // two columns that each end where their cards end. Today and the week stand on the left; the
  // inbox, which is the widest, on the right. The order in the page is the order on the screen,
  // for the keyboard and a screen reader too.
  //
  // The month comes first only where it is a short band (see LAPTOP_SCREEN). On a tablet on its
  // side its line stands under its figures and the card fills the screen: the day and what waits
  // for an answer would start below it. There the month follows the two columns.
  if (wide) {
    // The buttons take the card's place. Without them (a page that was given the card alone) the card ends the left column.
    const linkButtons = !notBegun && bookingLinkButtons;
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-6 xl:px-8 animate-in fade-in duration-200">
        <h1 tabIndex={-1} className="sr-only">Home</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-2xl font-bold tracking-tight text-slate-900">{greeting}</p>
          <OpenChip open={open} />
          {/* The buttons are taller than the greeting: they reach into the space around the row, so the row keeps its height. */}
          {linkButtons && <div className="-my-1.5 ml-auto">{linkButtons}</div>}
        </div>
        {startCard}
        {laptop && monthCard}
        <div className="grid grid-cols-12 items-start gap-6">
          <div className="col-span-5 space-y-6">
            {todayCard}
            {weekCard}
            {inboxIsLonger && aiCard}
            {!linkButtons && link}
          </div>
          <div className="col-span-7 space-y-6">
            {inbox}
            {!inboxIsLonger && aiCard}
          </div>
        </div>
        {!laptop && monthCard}
      </div>
    );
  }

  // ---------- a phone, and a tablet held upright ----------

  // One column, in the order of what is needed first: today, what waits for an answer, what the
  // AI brought in, then the week and the month, which are looked at now and then.
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <h1 tabIndex={-1} className="sr-only">Home</h1>
      {startCard}
      {todayCard}
      {inbox}
      {aiCard}
      {weekCard}
      {monthCard}
      {link}
    </div>
  );
};
