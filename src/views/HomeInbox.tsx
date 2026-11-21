import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarCheck, CalendarClock, CalendarX, Check, ChevronRight, Copy, MessageSquare, Phone, Plus, RotateCcw, Undo2, X } from 'lucide-react';
import { ChannelBadge, channelLabel } from '../components/ChannelBadge';
import { ChatCancellationAnswers, ChatRequestAnswers, type AnswerChat } from '../components/ChatBookingCards';
import { appointmentIdForRequest, requestTimes } from '../appointmentActions';
import type { AvailabilityContext } from '../availability';
import { chatBookingName } from '../bookingData';
import { PRODUCT_NAME } from '../brand';
import { LANGUAGE_NAMES } from '../conversationData';
import { answerText } from '../customerTexts';
import { timeAgoLabel } from '../demoRequests';
import { researchMode } from '../flags';
import { formatDate, formatDayMonth, formatPhone, formatStoredTimeRange, formatTimeRange, isPhoneNumber, isSamplePhone, normalizePhone, weekdayName } from '../format';
import { chatOutcome, inboxItems, isWaiting, type InboxItem, type RequestAnswer } from '../inbox';
import { acceptedAppointmentState, checkRequest, freeStartsForRequest, nextFreeDayForRequest, planChatBooking, planChatCancellation } from '../requestAnswers';
import { addMinutes, getSalonNow } from '../scheduling';
import type { AppointmentRequest, CalendarEvent, Conversation, Customer } from '../types';

/** What an action on a request gives back: the reason it could not be done, or nothing. */
export type Outcome = string | null | void;

export interface HomeInboxProps {
  requests: AppointmentRequest[];
  /** Every chat the owner sees, live ones included. */
  conversations: Conversation[];
  customers: Customer[];
  /** The answers given a moment ago. Each stays in the place of its request for a short while. */
  answers: RequestAnswer[];
  /** The salon as the slot rules see it, with the clock the page is drawn for. */
  salon: AvailabilityContext;
  clock: Date;
  /** The salon's name from Settings, for the texts the owner passes on to a customer. */
  salonName: string;
  /** A request the owner came here for, for example from the search: it is brought into view and marked. */
  selectedRequestId: string | null;
  /** Each returns why it could not be done, and nothing (or null) when it is done. */
  onAcceptRequest: (id: string) => Outcome;
  onRejectRequest: (id: string) => void;
  onMoveRequest: (id: string, date: string, startTime: string) => Outcome;
  /** Takes back an answer to a request from the booking page. Left out, no "Undo" is shown. */
  onUndoAnswer?: (id: string) => Outcome;
  onDismissAnswer?: (kind: RequestAnswer['kind'], id: string) => void;
  /**
   * Answers a chat's booking request or cancellation (src/App.tsx, handleChatBooking): resolves
   * to why it could not be done, or nothing. Left out, a chat's request only offers "Open chat".
   */
  onChatBooking?: AnswerChat;
  onOpenConversations: (conversationId?: string) => void;
  onOpenCustomer?: (customerId: string) => void;
  onOpenAppointment: (event: CalendarEvent) => void;
  onSimulateNewRequest: () => void;
}

/**
 * How long the second half of a double tap can follow the first. For this long after a tap on
 * an entry, two things hold, so that the second tap answers, undoes or dismisses nothing:
 *   - the entry keeps at least the height it had, also when it has become shorter or has gone,
 *     so nothing below it slides up under the finger;
 *   - a tap on the same spot of the same entry does nothing: another control lies there now.
 */
const DOUBLE_TAP_MS = 600;
const DOUBLE_TAP_PX = 30;
/**
 * After the list has changed without the owner's doing (a new chat came in, an answered entry
 * has had its time), everything below has moved. For this long a tap does nothing, so that it
 * cannot land on another entry than the one the owner aimed at.
 */
const SHIFT_GUARD_MS = 400;

const LANG_CHIP: Record<string, string> = {
  FR: 'bg-violet-100 text-violet-700',
  DE: 'bg-emerald-100 text-emerald-700',
  IT: 'bg-rose-100 text-rose-700',
  EN: 'bg-amber-100 text-amber-700',
};

const BUTTON = 'inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors sm:px-4';
const PRIMARY = `${BUTTON} bg-[#5551FF] text-white hover:bg-[#433fd8]`;
const OUTLINE = `${BUTTON} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const OUTLINE_BRAND = `${BUTTON} border border-[#5551FF]/40 bg-white text-[#5551FF] hover:bg-indigo-50`;
const DANGER = `${BUTTON} text-rose-700 hover:bg-rose-50`;
const QUIET = `${BUTTON} text-[#5551FF] hover:bg-indigo-50`;
// On the narrowest phones three buttons share a row: their icons appear where there is room for them.
const ICON = 'hidden h-4 w-4 shrink-0 min-[400px]:block';
// From tablet width on, what belongs to an entry lines up with its text, to the right of the date tile.
const INDENT = 'sm:ml-[3.75rem]';

/** The day a request is for: the weekday above the day, written like every short date ("FRI" over "20.11."). */
const DateTile = ({ date }: { date: string }) => (
  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-slate-200 bg-white">
    <span className="text-[10px] font-bold leading-none tracking-wider text-slate-500">{weekdayName(date, 'short').toUpperCase()}</span>
    <span className="text-[13px] font-bold leading-none tabular-nums text-slate-900">{formatDayMonth(date)}</span>
  </div>
);

/**
 * Where a request came from. Requests come in over the booking page ('Web'); a tab stored
 * earlier may still name another channel.
 */
const requestSource = (channel: AppointmentRequest['channel']): string => channel === 'Web' ? 'Booking page' : channel ?? '';

/**
 * A chat's contact: the customer's number where the salon has one (WhatsApp brings a masked
 * one), then the channel. A stand-in label is never shown as a number.
 */
const chatContact = (conversation: Conversation): string =>
  [/\d/.test(conversation.phone) || conversation.phone.startsWith('@') ? formatPhone(conversation.phone) : '', channelLabel(conversation.channel)].filter(Boolean).join(' · ');

/** Puts a text on the clipboard. True only when the browser says it is there. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Not allowed here: try the older way below. */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

/**
 * "Waiting for you": the one list of everything that needs the owner. Booking requests from the
 * booking page (Accept, Move, Reject), booking requests the AI collected in a chat (Confirm,
 * Suggest another time, Decline, as the chat's own card offers them), a customer's wish to cancel
 * (Cancel appointment, Keep appointment) and chats in which a customer waits.
 *
 * An answered request does not disappear at once. It stays where it was, says what was done and
 * offers "Undo". For a request from the booking page it also says what the app does not do:
 * nothing tells the customer. So it shows the customer's number and a ready text to copy.
 */
export const HomeInbox: React.FC<HomeInboxProps> = ({
  requests, conversations, customers, answers, salon, clock, salonName, selectedRequestId,
  onAcceptRequest, onRejectRequest, onMoveRequest, onUndoAnswer, onDismissAnswer, onChatBooking,
  onOpenConversations, onOpenCustomer, onOpenAppointment, onSimulateNewRequest,
}) => {
  const items = inboxItems({ requests, conversations, events: salon.events, answers, timeZone: salon.timeZone, now: clock });
  const waiting = items.filter(isWaiting).length;
  const today = getSalonNow(salon.timeZone, clock).date;
  const research = researchMode();

  const [problems, setProblems] = useState<Record<string, string>>({});
  // Which text was copied last, and whether the browser took it. Kept by the text itself: after
  // "Undo" and another answer the same entry holds another text, which has not been copied.
  const [copied, setCopied] = useState<{ text: string; done: boolean } | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  // ---------- taps and focus while the list changes ----------

  const entries = useRef(new Map<string, HTMLLIElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const quietUntil = useRef(0);
  const lastTap = useRef<{ key: string; x: number; y: number; scroll: number; at: number } | null>(null);
  const ownChangeAt = useRef(Number.NEGATIVE_INFINITY);
  const drawnBefore = useRef(false);
  const focusAfter = useRef<string | null>(null);
  // The entry that was tapped a moment ago, with the place and the height it had then.
  const [held, setHeld] = useState<{ key: string; index: number; height: number } | null>(null);
  const heldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (heldTimer.current) clearTimeout(heldTimer.current); }, []);
  const layout = items.map((item) => `${item.key}:${item.kind}${item.kind === 'request' && item.moved ? ':moved' : ''}`).join('|');
  useLayoutEffect(() => {
    // The list has changed. When the page opens, and after the owner's own tap, that is
    // expected; otherwise taps wait a moment.
    if (drawnBefore.current && performance.now() - ownChangeAt.current > 150) quietUntil.current = performance.now() + SHIFT_GUARD_MS;
    drawnBefore.current = true;
  }, [layout]);
  /** Whether a tap or a key press on an entry is to be acted on. */
  const counts = (event: React.MouseEvent, key: string): boolean => {
    const now = performance.now();
    if (now < quietUntil.current) return false;
    // A press of Enter or Space has no place on the screen (detail 0), and needs none: the focus
    // has left the control that was pressed, so a second press finds nothing to press.
    if (event.detail > 0) {
      const last = lastTap.current;
      const tap = { key, x: event.clientX, y: event.clientY, scroll: window.scrollY, at: now };
      lastTap.current = tap;
      // The same spot of the same entry, in the same view: after scrolling, a tap is aimed anew.
      if (last && last.key === key && tap.at - last.at < DOUBLE_TAP_MS && Math.hypot(tap.x - last.x, tap.y - last.y) < DOUBLE_TAP_PX && Math.abs(tap.scroll - last.scroll) < 2) return false;
    }
    ownChangeAt.current = now;
    // Measured before the change is drawn: the height the entry has under the finger right now.
    const element = entries.current.get(key);
    const index = items.findIndex((item) => item.key === key);
    if (element && index >= 0) {
      if (heldTimer.current) clearTimeout(heldTimer.current);
      setHeld({ key, index, height: element.offsetHeight });
      heldTimer.current = setTimeout(() => setHeld(null), DOUBLE_TAP_MS);
    }
    return true;
  };
  // The button that was pressed is gone once its entry has changed. Focus goes to the entry, so
  // that keyboard and screen reader stay where the owner was; to the heading when the entry has left.
  useLayoutEffect(() => {
    const key = focusAfter.current;
    if (key === null) return;
    focusAfter.current = null;
    (entries.current.get(key) ?? headingRef.current)?.focus({ preventScroll: true });
  });
  const act = (key: string, run: () => void) => (event: React.MouseEvent) => { if (counts(event, key)) run(); };
  /** After an action on an entry: show why it failed, or follow the entry with the focus. */
  const settle = (key: string, outcome: Outcome) => {
    const problem = outcome || null;
    setProblems((previous) => {
      const { [key]: _before, ...others } = previous;
      return problem ? { ...others, [key]: problem } : others;
    });
    if (problem) return;
    focusAfter.current = key;
    // If nothing was drawn anew, there is nothing to follow: forget it before an unrelated change takes the focus.
    setTimeout(() => { if (focusAfter.current === key) focusAfter.current = null; }, 0);
  };

  const selectedKey = selectedRequestId === null ? null : `request:${selectedRequestId}`;
  const selectionGone = selectedKey !== null && !items.some((item) => item.key === selectedKey);
  useEffect(() => {
    if (!selectedKey) return;
    // One frame later than the app, which scrolls to the top when the page is opened.
    const frame = requestAnimationFrame(() => entries.current.get(selectedKey)?.scrollIntoView({ block: 'center' }));
    return () => cancelAnimationFrame(frame);
  }, [selectedKey]);

  // ---------- moving a request ----------

  const [movingRequestId, setMovingRequestId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleStart, setRescheduleStart] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);
  const moveDialogRef = useRef<HTMLDialogElement>(null);
  const movingRequest = requests.find((request) => request.id === movingRequestId);
  const moveMinutes = movingRequest ? requestTimes(movingRequest)?.minutes ?? 0 : 0;
  const availableMoveSlots = movingRequest && rescheduleDate ? freeStartsForRequest(salon, movingRequest, rescheduleDate) : [];
  const selectedMoveStart = availableMoveSlots.includes(rescheduleStart) ? rescheduleStart : availableMoveSlots[0] ?? '';

  const openMoveDialog = (request: AppointmentRequest) => {
    // A day on which nothing is free (the time has passed, the salon is closed, the stylist is
    // away) is no place to start: the dialog opens on the stylist's next free day.
    const from = request.date < today ? today : request.date;
    const firstFreeDay = freeStartsForRequest(salon, request, from).length > 0 ? from : nextFreeDayForRequest(salon, request, from);
    setRescheduleDate(firstFreeDay ?? from);
    setRescheduleStart(requestTimes(request)?.start ?? '');
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

  // ---------- who and what ----------

  const customerOf = (id: string | undefined) => (id === undefined ? undefined : customers.find((customer) => customer.id === id));
  // Chats and customers are linked by id, in both directions; names are never compared.
  const chatOf = (customer: Customer) => conversations.find((conversation) =>
    conversation.customerId === customer.id || (customer.conversationId !== undefined && conversation.id === customer.conversationId));
  const customerOfChat = (conversation: Conversation) => customers.find((customer) =>
    customer.id === conversation.customerId || customer.conversationId === conversation.id);
  const serviceName = (request: AppointmentRequest) =>
    (request.serviceId !== undefined ? salon.services.find((service) => service.id === request.serviceId)?.name : undefined) ?? request.serviceName;
  const staffName = (request: AppointmentRequest) =>
    (request.employeeId !== undefined ? salon.employees.find((employee) => employee.id === request.employeeId)?.name : undefined) ?? request.staffName ?? '';
  const age = (moment: string | undefined, fallback = '') => (moment ? timeAgoLabel(moment, clock) : fallback);

  /** A customer's name; a link to the customer's record where there is one. */
  const nameOf = (key: string, name: string, customerId: string | undefined) => customerId !== undefined && onOpenCustomer ? (
    <button
      type="button"
      onClick={act(key, () => onOpenCustomer(customerId))}
      aria-label={`${name}: open the customer record`}
      className="-my-3 inline-flex min-h-11 max-w-full items-center gap-0.5 text-left font-semibold text-slate-900 underline decoration-slate-300 underline-offset-2 hover:text-[#5551FF] hover:decoration-[#5551FF]"
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  ) : name;

  /** Why the last action on an entry could not be done. Not repeated when the entry says the same already. */
  const problemOf = (key: string, shownAlready?: string | null) => problems[key] && problems[key] !== shownAlready && (
    <p role="alert" className={`mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium leading-relaxed text-rose-800 ${INDENT}`}>{problems[key]}</p>
  );

  const copy = (text: string) => {
    void copyToClipboard(text).then((done) => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      setCopied({ text, done });
      // "Copied" goes back to "Copy text" after a moment; a failure stays until the next try.
      if (done) copiedTimer.current = setTimeout(() => setCopied(null), 4000);
    });
  };

  // ---------- an answered request from the booking page ----------

  /**
   * What the owner still has to do after an answer: tell the customer. Nothing in the app does
   * it, and the card says so. `request` is the request as it stands now, `answer.request` as it
   * stood before the answer.
   */
  const telling = (key: string, answer: Extract<RequestAnswer, { kind: 'request' }>, request: AppointmentRequest) => {
    const customer = customerOf(request.customerId);
    const name = customer?.name ?? request.customerName;
    const phone = customer?.phone || request.customerPhone || '';
    const language = customer?.language ?? 'EN';
    const now = requestTimes(request);
    const asked = requestTimes(answer.request);
    // An accepted request is an appointment now, and the owner may have changed it in the calendar
    // since. The text to pass on is written from the appointment as it stands. (Once the
    // appointment is cancelled there, the inbox no longer lists the answer at all.)
    const appointment = answer.outcome === 'accepted' ? salon.events.find((event) => event.id === appointmentIdForRequest(answer.id)) : undefined;
    const standing = answer.outcome === 'accepted' ? acceptedAppointmentState(answer.request, appointment) : 'same';
    const details = appointment
      ? { language, customerName: name, salonName, serviceName: appointment.serviceName, staffName: appointment.staffName, date: appointment.date, startTime: appointment.startTime }
      : { language, customerName: name, salonName, serviceName: serviceName(request), staffName: staffName(request), date: request.date, startTime: now?.start ?? '' };
    const text = answer.outcome === 'moved'
      ? answerText({ ...details, outcome: 'moved', askedDate: answer.request.date, askedStartTime: asked?.start ?? '' })
      : answerText({ ...details, outcome: answer.outcome });
    const copiedHere = copied?.text === text ? copied : null;
    return (
      <>
        {standing === 'changed' && (
          <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            The appointment was changed in the calendar after you accepted. The text below gives it as it stands now.
          </p>
        )}
        {/* What the app does not do, said as it is: the one thing the owner cannot see for herself. */}
        <p className="text-xs leading-relaxed text-slate-700">
          <span className="font-semibold text-slate-900">{PRODUCT_NAME} does not tell {name}.</span>{' '}
          {answer.outcome === 'moved' ? 'Call or write to ask whether the new time suits.' : 'Call or write to pass it on.'}
        </p>
        {isPhoneNumber(phone) && isSamplePhone(phone) ? (
          // An invented number of the sample salon: text only, so a tap cannot call a stranger.
          <p className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Phone className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="whitespace-nowrap tabular-nums">{formatPhone(phone)}</span>
          </p>
        ) : isPhoneNumber(phone) ? (
          <a
            href={`tel:${normalizePhone(phone)}`}
            onClick={(event) => { if (!counts(event, key)) event.preventDefault(); }}
            className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-[#5551FF] underline-offset-2 hover:underline"
          >
            <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap tabular-nums">{formatPhone(phone)}</span>
          </a>
        ) : (
          <p className="py-1 text-xs text-slate-600">No phone number is on record for {name}.</p>
        )}
        <p className="text-[11px] font-semibold text-slate-600">Text to copy, in {LANGUAGE_NAMES[language] ?? LANGUAGE_NAMES.EN}</p>
        <p className="mt-1 select-all rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-800 [overflow-wrap:anywhere]">{text}</p>
        {copiedHere && !copiedHere.done && (
          <p role="alert" className="mt-2 text-xs font-medium text-rose-800">Copying did not work in this browser. Mark the text above and copy it by hand.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {/* On a request that still waits, "Accept" is the one filled button; there this one is drawn as an outline. */}
          <button type="button" onClick={act(key, () => copy(text))} className={answer.outcome === 'moved' ? OUTLINE_BRAND : PRIMARY}>
            {copiedHere?.done ? <Check className={ICON} aria-hidden="true" /> : <Copy className={ICON} aria-hidden="true" />}
            <span aria-live="polite">{copiedHere?.done ? 'Copied' : 'Copy text'}</span>
          </button>
          {appointment && (
            <button type="button" onClick={act(key, () => onOpenAppointment(appointment))} className={OUTLINE}>View appointment</button>
          )}
          {/* Undo takes the acceptance back. After a change in the calendar it would throw that change away, so it is not offered. */}
          {onUndoAnswer && standing === 'same' && (
            <button type="button" onClick={act(key, () => settle(key, onUndoAnswer(answer.id)))} className={QUIET}>
              <Undo2 className={ICON} aria-hidden="true" />Undo
            </button>
          )}
          {onDismissAnswer && (
            <button type="button" onClick={act(key, () => { onDismissAnswer('request', answer.id); settle(key, null); })} className={QUIET}>Done</button>
          )}
        </div>
      </>
    );
  };

  const renderAnswered = (item: Extract<InboxItem, { kind: 'request-answered' }>) => {
    const { answer } = item;
    const request = answer.request;
    const accepted = answer.outcome === 'accepted';
    // An accepted request is shown as the appointment it became, also after a change in the calendar.
    const appointment = accepted ? salon.events.find((event) => event.id === appointmentIdForRequest(answer.id)) : undefined;
    const staff = appointment?.staffName ?? staffName(request);
    return (
      <>
        <div className="flex items-start gap-3">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${accepted ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
            {accepted ? <Check className="h-5 w-5" aria-hidden="true" /> : <X className="h-5 w-5" aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1">
            <p role="status" className={`text-sm font-bold ${accepted ? 'text-emerald-800' : 'text-slate-700'}`}>{accepted ? 'Accepted' : 'Rejected'}</p>
            <p className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{nameOf(item.key, customerOf(request.customerId)?.name ?? request.customerName, customerOf(request.customerId)?.id)}</p>
            <p className="text-xs text-slate-600">
              {appointment?.serviceName ?? serviceName(request)} · <span className="whitespace-nowrap">{formatDate(appointment?.date ?? request.date)},</span>{' '}
              <span className="whitespace-nowrap tabular-nums">{appointment ? formatTimeRange(appointment.startTime, appointment.endTime) : formatStoredTimeRange(request.timeStr)}</span>
              {staff && <> · with {staff}</>}
            </p>
          </div>
        </div>
        <div className={`mt-3 ${INDENT}`}>{telling(item.key, answer, request)}</div>
        {problemOf(item.key)}
      </>
    );
  };

  // ---------- a request from the booking page ----------

  const renderRequest = (item: Extract<InboxItem, { kind: 'request' }>) => {
    const { request, moved } = item;
    const customer = customerOf(request.customerId);
    const chat = customer ? chatOf(customer) : undefined;
    const check = checkRequest(salon, request);
    const staff = staffName(request);
    const contact = [request.customerPhone ? formatPhone(request.customerPhone) : '', requestSource(request.channel)].filter(Boolean);
    const buttons = (check.refusal ? 0 : 1) + (check.movable ? 1 : 0) + 1;
    return (
      <>
        <div className="flex items-start gap-3">
          <DateTile date={request.date} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-xs font-medium text-slate-500">Booking request · {age(request.createdAt, request.timeAgo)}</p>
            <p className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{nameOf(item.key, customer?.name ?? request.customerName, customer?.id)}</p>
            <p className="text-sm text-slate-700">
              {serviceName(request)} · <span className="whitespace-nowrap tabular-nums">{formatStoredTimeRange(request.timeStr)}</span>
            </p>
            {staff && <p className="text-xs text-slate-500">with {staff}</p>}
            {contact.length > 0 && (
              <p className="text-xs text-slate-500">
                {contact.map((part, index) => <React.Fragment key={part}>{index > 0 && ' · '}<span className="whitespace-nowrap">{part}</span></React.Fragment>)}
              </p>
            )}
            {chat && (
              <button type="button" onClick={act(item.key, () => onOpenConversations(chat.id))} className="-ml-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[#5551FF] hover:bg-indigo-50">
                <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />Open chat
              </button>
            )}
          </div>
        </div>
        {moved && (
          <div className={`mt-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 ${INDENT}`}>
            <p role="status" className="mb-1 text-sm font-bold text-slate-900">
              Moved from <span className="whitespace-nowrap">{formatDate(moved.request.date)},</span>{' '}
              <span className="whitespace-nowrap tabular-nums">{formatStoredTimeRange(moved.request.timeStr)}</span>
            </p>
            {telling(item.key, moved, request)}
          </div>
        )}
        {check.refusal && <p role="status" className={`mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-900 ${INDENT}`}>{check.refusal}</p>}
        {problemOf(item.key, check.refusal)}
        <div className={`mt-3 grid gap-2 ${buttons === 3 ? 'grid-cols-3' : buttons === 2 ? 'grid-cols-2' : 'grid-cols-1'} sm:flex sm:flex-wrap ${INDENT}`}>
          {!check.refusal && (
            <button type="button" onClick={act(item.key, () => settle(item.key, onAcceptRequest(request.id)))} className={PRIMARY}>
              <Check className={ICON} aria-hidden="true" />Accept
            </button>
          )}
          {check.movable && (
            <button type="button" onClick={act(item.key, () => openMoveDialog(request))} className={check.refusal ? PRIMARY : OUTLINE}>
              <RotateCcw className={ICON} aria-hidden="true" />Move
            </button>
          )}
          <button type="button" onClick={act(item.key, () => { onRejectRequest(request.id); settle(item.key, null); })} className={DANGER}>
            <X className={ICON} aria-hidden="true" />Reject
          </button>
        </div>
      </>
    );
  };

  // ---------- a booking request that waits in a chat ----------

  /** Home's way into the chat's answers: a tap counts only when it was aimed (see `counts`). */
  const chatAnswer = (key: string): AnswerChat | undefined => onChatBooking && (async (conversationId, action) => {
    const outcome = await onChatBooking(conversationId, action);
    if (!outcome) settle(key, null);
    return outcome;
  });

  const renderChatRequest = (item: Extract<InboxItem, { kind: 'chat-request' }>) => {
    const { conversation, booking } = item;
    const plan = planChatBooking(salon, conversation);
    const customer = customerOfChat(conversation);
    const name = chatBookingName(conversation.customerName, booking.customerName);
    const change = booking.kind === 'change' && booking.previous;
    return (
      <>
        <div className="flex items-start gap-3">
          <DateTile date={booking.date} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-xs font-medium text-slate-500">{change ? 'Change request from a chat' : 'Booking request from a chat'} · {age(conversation.lastMessageAt, conversation.lastTime)}</p>
            <p className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{nameOf(item.key, customer?.name ?? name, customer?.id)}</p>
            <p className="text-sm text-slate-700">
              {plan?.serviceName ?? booking.service} ·{' '}
              <span className="whitespace-nowrap tabular-nums">{plan?.endTime ? formatTimeRange(booking.time, plan.endTime) : booking.time}</span>
            </p>
            {change && (
              <p className="text-xs text-slate-500">
                instead of <span className="whitespace-nowrap">{formatDate(plan?.previous?.date ?? booking.previous!.date)},</span>{' '}
                <span className="whitespace-nowrap tabular-nums">{plan?.previous ? formatTimeRange(plan.previous.startTime, plan.previous.endTime) : booking.previous!.time}</span>
              </p>
            )}
            {plan?.employee
              ? <p className="text-xs text-slate-500">with {plan.employee.name}{plan.asked ? ', as asked' : ''}</p>
              : plan?.asked && <p className="text-xs text-slate-500">asked for {plan.asked.name}</p>}
            <p className="text-xs text-slate-500">{chatContact(conversation)}</p>
          </div>
        </div>
        <div className={INDENT}>
          <ChatRequestAnswers conversation={conversation} salon={salon} onAnswer={chatAnswer(item.key)} allowTap={(event) => counts(event, item.key)} />
          <button type="button" onClick={act(item.key, () => onOpenConversations(conversation.id))} className={`mt-2 ${QUIET} -ml-3`}>
            <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />Open chat
          </button>
        </div>
      </>
    );
  };

  const renderChatCancellation = (item: Extract<InboxItem, { kind: 'chat-cancellation' }>) => {
    const { conversation, cancellation } = item;
    const plan = planChatCancellation(salon, conversation);
    const customer = customerOfChat(conversation);
    const appointment = plan?.appointment;
    return (
      <>
        <div className="flex items-start gap-3">
          <DateTile date={appointment?.date ?? cancellation.date} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-xs font-medium text-slate-500">Cancellation request from a chat · {age(conversation.lastMessageAt, conversation.lastTime)}</p>
            <p className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{nameOf(item.key, customer?.name ?? conversation.customerName, customer?.id)} wants to cancel</p>
            <p className="text-sm text-slate-700">
              {appointment?.serviceName ?? cancellation.service} ·{' '}
              <span className="whitespace-nowrap tabular-nums">{appointment ? formatTimeRange(appointment.startTime, appointment.endTime) : cancellation.time}</span>
            </p>
            {appointment && <p className="text-xs text-slate-500">with {appointment.staffName}</p>}
            <p className="text-xs text-slate-500">{chatContact(conversation)}</p>
          </div>
        </div>
        <div className={INDENT}>
          <ChatCancellationAnswers conversation={conversation} salon={salon} onAnswer={chatAnswer(item.key)} allowTap={(event) => counts(event, item.key)} />
          <button type="button" onClick={act(item.key, () => onOpenConversations(conversation.id))} className={`mt-2 ${QUIET} -ml-3`}>
            <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />Open chat
          </button>
        </div>
      </>
    );
  };

  /** What an answer to a chat did, as the entry says it: a title, its colours and icon, and the sentence below. */
  const answeredChat = (answer: Extract<RequestAnswer, { kind: 'chat' }>, chatIsThere: boolean) => {
    const name = answer.customerName;
    // A live chat's message was sent by the server; one of the salon's own chats shows the answer in the chat itself.
    const told = (what: string) => answer.live ? `${name} has ${what} in the chat.` : `The ${what.replace(/^the /, '')} is in the chat.`;
    switch (chatOutcome(answer)) {
      case 'suggested': return { title: 'Other time suggested', tone: 'indigo', Icon: CalendarClock, line: `${told('the suggestion')} When ${name} takes it up, it comes back here as a request.` };
      case 'declined': return { title: 'Declined', tone: 'slate', Icon: X, line: told('the answer') };
      case 'cancelled': return { title: 'Cancelled', tone: 'slate', Icon: CalendarX, line: `The appointment has left your calendar. ${told('the cancellation')}` };
      case 'kept': return { title: 'Appointment kept', tone: 'slate', Icon: CalendarCheck, line: `Nothing was sent to ${name}. ${chatIsThere ? 'Write to them in the chat yourself.' : ''}`.trim() };
      default: return { title: 'Confirmed', tone: 'emerald', Icon: CalendarCheck, line: `The appointment is in your calendar. ${told('the confirmation')}` };
    }
  };
  const TONES: Record<string, { tile: string; title: string }> = {
    emerald: { tile: 'bg-emerald-100 text-emerald-700', title: 'text-emerald-800' },
    indigo: { tile: 'bg-indigo-100 text-[#5551FF]', title: 'text-[#433fd8]' },
    slate: { tile: 'bg-slate-200 text-slate-600', title: 'text-slate-700' },
  };

  const renderChatAnswered = (item: Extract<InboxItem, { kind: 'chat-request-answered' }>) => {
    const { answer } = item;
    // Only while the appointment is still the chat's own: one given to another customer since is not offered from here.
    const appointment = answer.appointmentId ? salon.events.find((event) => event.id === answer.appointmentId && event.conversationId === answer.id) : undefined;
    // A customer can delete the chat at any time: then there is nothing to open or to try again.
    const chatIsThere = conversations.some((conversation) => conversation.id === answer.id);
    const outcome = chatOutcome(answer);
    const retry = answer.delivery === 'failed' && outcome === 'confirmed' && onChatBooking && chatIsThere ? onChatBooking : null;
    const said = answeredChat(answer, chatIsThere);
    const tone = TONES[said.tone];
    const time = answer.endTime && answer.endTime !== answer.startTime ? formatTimeRange(answer.startTime, answer.endTime) : answer.startTime;
    return (
      <>
        <div className="flex items-start gap-3">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tone.tile}`}>
            <said.Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p role="status" className={`text-sm font-bold ${tone.title}`}>{said.title}</p>
            <p className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{answer.customerName}</p>
            <p className="text-xs text-slate-600">
              {answer.serviceName} · <span className="whitespace-nowrap">{formatDate(answer.date)},</span>{' '}
              <span className="whitespace-nowrap tabular-nums">{time}</span>{answer.staffName && <> · with {answer.staffName}</>}
            </p>
          </div>
        </div>
        {answer.delivery === 'failed' ? (
          <div role="alert" className={`mt-3 space-y-1 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-800 ${INDENT}`}>
            <p className="font-semibold">The appointment is in your calendar, but the confirmation did not get into the chat.</p>
            {/* What the server answered, in its own words. */}
            {answer.problem && <p>{answer.problem}</p>}
            {chatIsThere && <p>You can also open the chat and write to {answer.customerName} yourself.</p>}
          </div>
        ) : answer.delivery === 'pending' ? (
          <p role="status" className={`mt-3 text-xs leading-relaxed text-slate-700 ${INDENT}`}>The appointment is in your calendar. The confirmation is on its way into the chat…</p>
        ) : (
          <p role="status" className={`mt-3 text-xs leading-relaxed text-slate-700 ${INDENT}`}>{said.line}</p>
        )}
        {problemOf(item.key)}
        <div className={`mt-3 flex flex-wrap gap-2 ${INDENT}`}>
          {retry && <button type="button" onClick={act(item.key, () => { void Promise.resolve(retry(answer.id, { type: 'confirm' })).then((outcome) => settle(item.key, outcome)); })} className={PRIMARY}>Try again</button>}
          {chatIsThere && (
            <button type="button" onClick={act(item.key, () => onOpenConversations(answer.id))} className={OUTLINE}>
              <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />Open chat
            </button>
          )}
          {appointment && <button type="button" onClick={act(item.key, () => onOpenAppointment(appointment))} className={OUTLINE}>View appointment</button>}
          {onDismissAnswer && answer.delivery !== 'pending' && (
            <button type="button" onClick={act(item.key, () => { onDismissAnswer('chat', answer.id); settle(item.key, null); })} className={QUIET}>Done</button>
          )}
        </div>
      </>
    );
  };

  // ---------- a chat in which the customer waits ----------

  const renderChat = ({ key, conversation }: Extract<InboxItem, { kind: 'chat' }>) => (
    <button
      type="button"
      onClick={act(key, () => onOpenConversations(conversation.id))}
      className="-m-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-xl p-2 text-left transition-colors hover:bg-slate-50"
    >
      <span className="relative shrink-0">
        <span className={`flex h-12 w-12 items-center justify-center rounded-full text-xs font-bold ${conversation.avatarColor}`}>{conversation.initials}</span>
        <ChannelBadge channel={conversation.channel} />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-xs font-medium text-slate-500">Chat · {age(conversation.lastMessageAt, conversation.lastTime)}</span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{conversation.customerName}</span>
          {/* A live chat can be in any language: the one the AI detected, as the chat list shows it. */}
          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${LANG_CHIP[conversation.language]}`}>
            {conversation.live && conversation.languageLabel ? conversation.languageLabel : conversation.language}
          </span>
        </span>
        <span className="block text-xs leading-relaxed text-slate-600">{conversation.attentionReason?.trim() || 'The customer is waiting for your answer.'}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 self-center text-xs font-semibold text-[#5551FF]">
        <span className="sr-only sm:not-sr-only">Open chat</span>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </button>
  );

  const tint = (item: InboxItem) => item.kind === 'request-answered' || item.kind === 'chat-request-answered' ? 'bg-slate-50/80' : '';

  const rows = items.map((item) => (
    <li
      key={item.key}
      ref={(element) => { if (element) entries.current.set(item.key, element); else entries.current.delete(item.key); }}
      tabIndex={-1}
      aria-current={item.key === selectedKey ? 'true' : undefined}
      style={held?.key === item.key ? { minHeight: held.height } : undefined}
      className={`px-4 py-4 last:rounded-b-2xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF] sm:px-5 ${item.key === selectedKey ? 'bg-indigo-50/70 ring-1 ring-inset ring-indigo-200' : tint(item)}`}
    >
      {item.kind === 'request' && renderRequest(item)}
      {item.kind === 'request-answered' && renderAnswered(item)}
      {item.kind === 'chat-request' && renderChatRequest(item)}
      {item.kind === 'chat-cancellation' && renderChatCancellation(item)}
      {item.kind === 'chat-request-answered' && renderChatAnswered(item)}
      {item.kind === 'chat' && renderChat(item)}
    </li>
  ));
  // An entry that has just left ("Done") leaves a gap of its height for the moment, where it stood.
  if (held && !items.some((item) => item.key === held.key)) {
    rows.splice(Math.min(held.index, rows.length), 0, <li key={`gap:${held.key}`} aria-hidden="true" style={{ height: held.height }} />);
  }

  return (
    <section aria-labelledby="home-inbox-title" className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
      <div className="flex items-center gap-2 px-4 pt-4 sm:px-5">
        <h2 id="home-inbox-title" ref={headingRef} tabIndex={-1} className="text-base font-bold tracking-tight text-slate-900">Waiting for you</h2>
        {waiting > 0 && (
          <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold tabular-nums text-white">
            {waiting}<span className="sr-only"> {waiting === 1 ? 'entry' : 'entries'}</span>
          </span>
        )}
      </div>

      {selectionGone && (
        <p role="status" className="mx-4 mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 sm:mx-5">
          This request is no longer available.{waiting > 0 ? ' The list below shows what is still waiting.' : ''}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="px-4 pb-5 pt-3 sm:px-5">
          <p className="text-sm font-semibold text-slate-800">Nothing is waiting for you.</p>
          <p className="mt-1 text-xs text-slate-500">New booking requests and chats that need you appear here.</p>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 pb-1">{rows}</ul>
      )}

      {/* Study tool: adds a made-up request. Not part of the product; shown with the research switch only. */}
      {research && requests.length === 0 && (
        <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onSimulateNewRequest}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#5551FF]/20 bg-[#5551FF]/8 px-3.5 py-1.5 text-xs font-medium text-[#5551FF] transition-colors hover:bg-[#5551FF]/15"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">Simulate incoming booking</span>
          </button>
        </div>
      )}

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
              const error = onMoveRequest(movingRequest.id, rescheduleDate, selectedMoveStart) || null;
              if (error) {
                setMoveError(error);
                return;
              }
              setProblems(({ [`request:${movingRequest.id}`]: _before, ...others }) => others);
              ownChangeAt.current = performance.now();
              setMovingRequestId(null);
            }}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 id="move-appointment-title" className="text-base font-bold text-slate-900">Move booking request</h3>
              <button type="button" onClick={() => setMovingRequestId(null)} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div id="move-appointment-context" className="text-xs text-slate-500 mb-4 space-y-1">
              <p className="font-semibold text-slate-700">{movingRequest.customerName}</p>
              <p>{serviceName(movingRequest)}{moveMinutes > 0 ? ` · ${moveMinutes} minutes` : ''}</p>
              <p>Staff: {staffName(movingRequest) || 'Unassigned'}</p>
              <p>Asked for: {formatDate(movingRequest.date)}, {formatStoredTimeRange(movingRequest.timeStr)}</p>
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
                    <option key={start} value={start}>{formatTimeRange(start, addMinutes(start, moveMinutes))}</option>
                  ))}
                </select>
                {availableMoveSlots.length === 0 && (
                  <p className="mt-2 text-xs text-slate-500" role="status">No available times for this employee and service on this date. Choose another date, or check the working hours and the opening hours.</p>
                )}
              </div>
              {moveError && <p role="alert" className="text-xs text-rose-600 rounded-xl bg-rose-50 p-3">{moveError}</p>}
              <div className="sticky -bottom-4 -mx-4 flex gap-2 border-t border-slate-100 bg-white px-4 pt-3 pb-4 shadow-[0_-6px_12px_-8px_rgba(15,23,42,0.25)] sm:-bottom-6 sm:-mx-6 sm:px-6 sm:pb-6 sm:-mb-6 -mb-4">
                <button
                  type="button"
                  onClick={() => setMovingRequestId(null)}
                  className="min-h-11 flex-1 py-2 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedMoveStart || !rescheduleDate}
                  className="min-h-11 flex-1 py-2 text-sm font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Move request
                </button>
              </div>
            </div>
          </form>
        </dialog>
      )}
    </section>
  );
};
