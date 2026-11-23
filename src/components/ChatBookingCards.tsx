import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CalendarCheck, CalendarClock, CalendarX, Check, ChevronRight, Clock, Undo2, X } from 'lucide-react';
import { holdAnswer, type HeldAnswer } from '../answerHold';
import { appointmentForConversation } from '../appointmentActions';
import type { AvailabilityContext } from '../availability';
import type { ChatBookingAction } from '../chatBookingActions';
import { chatBookingOriginLabel } from '../conversationPresentation';
import { formatDate, formatTimeRange } from '../format';
import { isLiveConversation } from '../liveWhatsApp';
import {
  chatTimeOptionsOn, nearestChatTimes, planChatBooking, planChatCancellation, type ChatBookingPlan, type ChatTimeOption,
} from '../requestAnswers';
import { addMinutes, getSalonNow } from '../scheduling';
import type { CalendarEvent, Conversation } from '../types';

/**
 * What an open chat shows about a booking (contract 6 of delivery 2C):
 *
 *   - the request the AI passed on, with what was really checked against the calendar and the
 *     owner's three ways out: Confirm, Suggest another time, Decline;
 *   - the customer's wish to cancel, with Cancel appointment and Keep appointment;
 *   - the appointment the chat booked, with the way to it in the calendar.
 *
 * The cards carry nothing out themselves: `onAnswer` does (src/App.tsx, handleChatBooking). While
 * an answer is on its way a card says so and locks its buttons; a refusal is shown on the card,
 * and the request stays open.
 *
 * Placed in a chat (src/views/ConversationsView.tsx): what waits for an answer stands at the end
 * of the messages, where the owner reads and replies, and scrolls with them, so the reply box
 * always stays on screen; the appointment is one slim line pinned above the messages.
 *
 *   <ChatAppointment conversation={selected} events={salon.events} onOpenAppointment={openAppointment} />
 *   ...the messages...
 *   <ChatWaitingCards conversation={selected} salon={{ ...availabilityContext, now }} onAnswer={handleChatBooking} />
 */

/** Why an answer could not be carried out, or nothing when it was. */
export type AnswerOutcome = string | null | void;
export type AnswerChat = (conversationId: string, action: ChatBookingAction) => Promise<AnswerOutcome> | AnswerOutcome;

const BUTTON = 'inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4';
const PRIMARY = `${BUTTON} bg-[#5551FF] text-white hover:bg-[#433fd8]`;
const OUTLINE = `${BUTTON} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const DANGER = `${BUTTON} text-rose-700 hover:bg-rose-50`;
const QUIET = `${BUTTON} text-[#5551FF] hover:bg-indigo-50`;
// On the narrowest phones three buttons share a row: their icons appear where there is room for them.
const ICON = 'hidden h-4 w-4 shrink-0 min-[400px]:block';
const CARD = 'rounded-2xl border px-4 py-3 sm:px-5 sm:py-4';

const isLive = (conversation: Pick<Conversation, 'id' | 'live'>) => conversation.live === true || isLiveConversation(conversation.id);

// ---------- the three answers to a request ----------

export interface RequestAnswerButtonsProps {
  /** Left out where the request cannot be confirmed as it stands: "Suggest another time" is the filled button then. */
  onConfirm?: (event: React.MouseEvent) => void;
  /** Left out where no other time would help either. */
  onSuggest?: (event: React.MouseEvent) => void;
  onDecline: (event: React.MouseEvent) => void;
  /** While an answer is on its way or on hold. */
  locked?: boolean;
  /** The button that opens the times: the focus returns to it when they close. */
  suggestRef?: React.Ref<HTMLButtonElement>;
}

/**
 * The three answers to a booking request: Confirm, Suggest another time, Decline. One row with
 * one set of words, wherever the request came from: the customers' booking page (Home's inbox)
 * or a chat (Home's inbox, and the chat itself). They are the words the customer reads on the
 * other side too: "Appointment confirmed", "The salon suggests another time", "Request declined".
 *
 * The row goes by the width of the element around it, which has to be a container (`@container`):
 * a card in a chat on one screen, half a column of Home's inbox on another.
 */
export const RequestAnswerButtons: React.FC<RequestAnswerButtonsProps> = ({ onConfirm, onSuggest, onDecline, locked = false, suggestRef }) => (
  // Too narrow for the three in one row (a phone, a narrow column): Confirm and Decline share
  // a row, "Suggest another time" takes a row of its own so its words fit.
  <div className="mt-3 grid grid-cols-2 gap-2 @[27rem]:flex @[27rem]:flex-wrap">
    {onConfirm && (
      <button type="button" disabled={locked} onClick={onConfirm} className={PRIMARY}>
        <Check className={ICON} aria-hidden="true" />Confirm
      </button>
    )}
    {onSuggest && (
      <button
        ref={suggestRef} type="button" disabled={locked} onClick={onSuggest}
        className={`${onConfirm ? OUTLINE : PRIMARY} col-span-2 ${onConfirm ? 'order-last @[27rem]:order-none' : ''}`}
      >
        <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />Suggest another time
      </button>
    )}
    <button type="button" disabled={locked} onClick={onDecline} className={`${DANGER} ${onConfirm ? '' : 'col-span-2'}`}>
      <X className={ICON} aria-hidden="true" />Decline
    </button>
  </div>
);

/** What the card says while an answer is on its way. A live chat waits for the server, which sends the customer's message. */
const sendingText = (type: ChatBookingAction['type'], live: boolean): string => {
  if (!live) return { confirm: 'Confirming…', suggest: 'Suggesting the time…', decline: 'Declining…', cancel: 'Cancelling the appointment…', keep: 'Saving…' }[type];
  return {
    confirm: 'Confirming and sending the confirmation…', suggest: 'Sending the suggestion…', decline: 'Sending the answer…',
    cancel: 'Cancelling and sending the cancellation…', keep: 'Saving…',
  }[type];
};

/**
 * Home's inbox holds an answer that reaches a customer for a moment, so that a wrong tap can be
 * taken back (src/answerHold.ts). `current` gives the chat as it is when the hold ends: the answer
 * goes out only for the request it was given to. A card in an open chat is given no hold: there
 * the owner has the whole conversation in front of her.
 */
export interface AnswerHold { ms: number; current: () => Conversation | undefined }

/** What a card's answers are about: the request and the cancellation as they stand. */
const waitingFor = (conversation: Conversation | undefined): string =>
  JSON.stringify([conversation?.bookingRequest ?? null, conversation?.cancellationRequest ?? null]);

const CHANGED_ON_HOLD = 'The request changed while your answer was on hold, so the answer was not carried out. Check the request and answer again.';

/** What the card says while an answer is on hold. */
const holdText = (type: ChatBookingAction['type']): string => ({
  confirm: 'The confirmation goes out in a few seconds.', suggest: 'The suggestion goes out in a few seconds.',
  decline: 'The answer goes out in a few seconds.', cancel: 'The cancellation goes out in a few seconds.', keep: '',
}[type]);

/**
 * One answer at a time: what is on hold, what is on its way, and why the last one failed.
 *
 * With a `hold`, an answer that sends the customer of a live chat a message waits first and can
 * be taken back with `undo`. "Keep appointment" sends nothing and one of the salon's own chats
 * has nobody on the other side: neither is held.
 */
function useAnswer(conversation: Conversation, onAnswer: AnswerChat | undefined, hold?: AnswerHold) {
  const conversationId = conversation.id;
  const [sending, setSending] = useState<ChatBookingAction['type'] | null>(null);
  const [onHold, setOnHold] = useState<ChatBookingAction['type'] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const running = useRef(false);
  const heldAnswer = useRef<HeldAnswer | null>(null);
  /** Resolves to true when the answer was carried out. */
  const carryOut = async (action: ChatBookingAction): Promise<boolean> => {
    if (!onAnswer || running.current) return false;
    running.current = true;
    setSending(action.type);
    setProblem(null);
    let problem: string | null;
    try {
      problem = (await onAnswer(conversationId, action)) || null;
    } catch {
      problem = 'The answer could not be carried out. Check your connection and try again.';
    } finally {
      running.current = false;
      setSending(null);
    }
    setProblem(problem);
    return problem === null;
  };
  const run = async (action: ChatBookingAction): Promise<boolean> => {
    if (!onAnswer || running.current || heldAnswer.current) return false;
    if (!hold || hold.ms <= 0 || action.type === 'keep' || !isLive(conversation)) return carryOut(action);
    const asked = waitingFor(conversation);
    const held = holdAnswer(hold.ms, () => waitingFor(hold.current()) === asked, () => carryOut(action));
    heldAnswer.current = held;
    setProblem(null);
    setOnHold(action.type);
    const end = await held.ended;
    heldAnswer.current = null;
    setOnHold(null);
    if (end === 'changed') setProblem(CHANGED_ON_HOLD);
    return end === 'done';
  };
  // The owner leaves Home, or the app, while an answer is on hold: it goes out now. She pressed
  // the button; walking on is no "Undo".
  useEffect(() => {
    const release = () => heldAnswer.current?.release();
    const whenHidden = () => { if (document.visibilityState === 'hidden') release(); };
    window.addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', whenHidden);
    return () => {
      window.removeEventListener('pagehide', release);
      document.removeEventListener('visibilitychange', whenHidden);
      release();
    };
  }, []);
  return { sending, onHold, problem, run, undo: () => heldAnswer.current?.undo() };
}

const Status = ({ sending, onHold, onUndo, problem, live }: {
  sending: ChatBookingAction['type'] | null; onHold: ChatBookingAction['type'] | null; onUndo: (event: React.MouseEvent) => void; problem: string | null; live: boolean;
}) => (
  <>
    {/* An answer on hold: nothing has gone out yet, and "Undo" keeps it that way. */}
    {onHold && (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 rounded-xl bg-indigo-50 py-0.5 pl-3 pr-1">
        <p role="status" className="flex min-w-0 flex-1 items-center gap-2 py-2 text-[13px] font-medium text-slate-800">
          <Clock className="h-4 w-4 shrink-0 text-[#5551FF]" aria-hidden="true" />{holdText(onHold)}
        </p>
        <button type="button" onClick={onUndo} className={QUIET}><Undo2 className="h-4 w-4 shrink-0" aria-hidden="true" />Undo</button>
      </div>
    )}
    {/* Read out when an answer starts and when it fails. */}
    <p role="status" className={sending ? 'mt-3 flex items-center gap-2 text-[13px] font-medium text-slate-700' : 'sr-only'}>
      {sending && <><Clock className="h-4 w-4 shrink-0 animate-pulse text-[#5551FF]" aria-hidden="true" />{sendingText(sending, live)}</>}
    </p>
    {problem && !sending && !onHold && (
      <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-medium leading-relaxed text-rose-800 [overflow-wrap:anywhere]">{problem}</p>
    )}
  </>
);

/** "Thu, 08.10.2026 · 15:00–15:30", kept together on a line where it fits. */
const When = ({ date, start, end }: { date: string; start: string; end: string | null }) => (
  <>
    <span className="whitespace-nowrap">{formatDate(date)}</span> ·{' '}
    <span className="whitespace-nowrap tabular-nums">{end ? formatTimeRange(start, end) : start}</span>
  </>
);

// ---------- the answers to a booking request ----------

export interface ChatRequestAnswersProps {
  conversation: Conversation;
  /** The salon as the slot rules see it, with the clock the card is drawn for. */
  salon: AvailabilityContext;
  onAnswer?: AnswerChat;
  /** Home's inbox lets a tap count only when it was aimed (see HomeInbox). */
  allowTap?: (event: React.MouseEvent) => boolean;
  /** Home's inbox holds an answer that reaches the customer for a moment (see AnswerHold). */
  hold?: AnswerHold;
}

// The sentence about what was checked ends on the same words every time (src/requestAnswers.ts).
// The card says who is free in the colour of its text and the list of what was checked more quietly.
const CHECKED_AGAINST = ' Checked against ';

/**
 * What was checked and the three answers. Home's inbox shows this under its own lines about the
 * request; the chat shows it inside ChatRequestCard.
 */
export const ChatRequestAnswers: React.FC<ChatRequestAnswersProps> = ({ conversation, salon, onAnswer, allowTap, hold }) => {
  const plan = planChatBooking(salon, conversation);
  const live = isLive(conversation);
  const { sending, onHold, problem, run, undo } = useAnswer(conversation, onAnswer, hold);
  const [stylistId, setStylistId] = useState<string>('');
  const [suggesting, setSuggesting] = useState(false);
  const [day, setDay] = useState('');
  const [choice, setChoice] = useState('');
  const ids = useId();
  // Back from the times: the focus returns to the button that opened them.
  const suggestRef = useRef<HTMLButtonElement>(null);
  const backFocus = useRef(false);
  useEffect(() => {
    if (!suggesting && backFocus.current) { backFocus.current = false; suggestRef.current?.focus(); }
  }, [suggesting]);
  if (!plan) return null;

  const { freeEmployees, held } = plan;
  // The owner's choice while that stylist is still free; else whom the plan gives it to.
  const stylist = freeEmployees.find((employee) => employee.id === stylistId) ?? plan.employee ?? freeEmployees[0] ?? null;
  // Where the chat holds the appointment already, Confirm only answers the request: no stylist to choose.
  const canConfirm = Boolean(onAnswer && plan.endTime && (held || stylist));
  const chooseStylist = !held && (freeEmployees.length > 1 || (!plan.employee && freeEmployees.length > 0));
  const moves = plan.booking.kind === 'change' && plan.previous !== null;
  // What Confirm does, and how the customer learns of it: a request from a chat is answered in
  // the chat. A live chat has the customer on the other side, so the confirmation is sent; one of
  // the salon's own chats has nobody there, so nothing claims that. (A request from the booking
  // page says in the same place that the owner tells the customer herself: see HomeInbox.)
  const confirmDoes = held
    ? live ? `Confirm sends ${plan.customerName} the confirmation in the chat.` : 'Confirm marks the request as booked.'
    : `Confirm ${moves ? 'moves the appointment in' : 'adds it to'} your calendar and ${live ? `sends ${plan.customerName} the confirmation in the chat` : 'puts the confirmation in the chat'}.`;
  const locked = sending !== null || onHold !== null;
  const tap = (event: React.MouseEvent, then: () => void) => { if (!allowTap || allowTap(event)) then(); };
  const checked = held ? plan.checked : stylist && plan.endTime
    ? plan.employee && stylist.id === plan.employee.id && plan.checked ? plan.checked
      : `${stylist.name} is free then. Checked against the opening hours, the working hours, time off and your calendar.`
    : null;
  // "Anna Weber is free then." is what the owner reads; what it was checked against follows more quietly.
  const checkedAt = checked?.indexOf(CHECKED_AGAINST) ?? -1;
  const [found, against] = checked && checkedAt > 0 ? [checked.slice(0, checkedAt), checked.slice(checkedAt + 1)] : [checked, ''];

  return (
    // The row of answers goes by the width of this block, not of the screen: the block is a card in
    // a chat on one screen and half a column of Home's inbox on another.
    <div className="@container">
      {plan.refusal && (
        <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-medium leading-relaxed text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="[overflow-wrap:anywhere]">{plan.refusal}</span>
        </p>
      )}
      {checked && !plan.refusal && (
        <p className="mt-3 flex gap-2 text-[13px] leading-relaxed text-slate-600">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
          <span><span className="font-medium text-slate-900">{found}</span>{against && <> {against}</>}</span>
        </p>
      )}
      {chooseStylist && onAnswer && (
        // The name of the list and the list on one line where they fit; on a narrow phone the list takes the next one.
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <label htmlFor={`${ids}-stylist`} className="text-[13px] font-semibold text-slate-700">Stylist who is free then</label>
          <select
            id={`${ids}-stylist`}
            value={stylist?.id ?? ''}
            disabled={locked}
            onChange={(event) => setStylistId(event.target.value)}
            className="min-h-11 min-w-0 flex-1 basis-40 rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-[#5551FF] sm:max-w-[14rem] sm:text-sm"
          >
            {freeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </select>
        </div>
      )}
      {canConfirm && !suggesting && (
        <p className="mt-2 text-[13px] text-slate-500">
          {confirmDoes}
        </p>
      )}

      {onAnswer && !suggesting && (
        <RequestAnswerButtons
          locked={locked} suggestRef={suggestRef}
          onConfirm={canConfirm ? (event) => tap(event, () => void run(held ? { type: 'confirm' } : { type: 'confirm', employeeId: stylist!.id, staffName: stylist!.name })) : undefined}
          onSuggest={plan.movable ? (event) => tap(event, () => { setSuggesting(true); setChoice(''); }) : undefined}
          onDecline={(event) => tap(event, () => void run({ type: 'decline' }))}
        />
      )}

      {onAnswer && suggesting && (
        <SuggestPanel
          conversation={conversation} salon={salon} plan={plan} live={live} locked={locked}
          day={day} onDay={setDay} choice={choice} onChoice={setChoice}
          onBack={() => { setSuggesting(false); backFocus.current = true; }}
          onSend={(option, event) => tap(event, () => {
            // Once the suggestion is out, the times close: the request that follows (the customer's
            // yes to it) shows its three answers again, not the list it was picked from.
            void run({ type: 'suggest', date: option.date, time: option.time, employeeId: option.employee.id, staffName: option.employee.name })
              // The focus goes back to "Suggest another time" where the card stays (the customer's yes
              // waits in it); where the card goes, the chat's heading takes it (ConversationsView).
              .then((sent) => { if (sent) { backFocus.current = true; setSuggesting(false); setDay(''); setChoice(''); } });
          })}
        />
      )}
      <Status sending={sending} onHold={onHold} onUndo={(event) => tap(event, undo)} problem={problem} live={live} />
    </div>
  );
};

interface SuggestPanelProps {
  conversation: Conversation;
  salon: AvailabilityContext;
  plan: ChatBookingPlan;
  live: boolean;
  locked: boolean;
  day: string;
  onDay: (day: string) => void;
  choice: string;
  onChoice: (key: string) => void;
  onBack: () => void;
  onSend: (option: ChatTimeOption, event: React.MouseEvent) => void;
}

/** The nearest free times for the service, and any other day: the owner picks one, and the customer is offered it. */
const SuggestPanel: React.FC<SuggestPanelProps> = ({ conversation, salon, plan, live, locked, day, onDay, choice, onChoice, onBack, onSend }) => {
  const ids = useId();
  // The button that opened the times is gone: the focus goes to the first of them.
  const panelRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => { panelRef.current?.querySelector<HTMLInputElement>('input')?.focus(); }, []);
  const today = getSalonNow(salon.timeZone, salon.now ?? new Date()).date;
  const options = day ? chatTimeOptionsOn(salon, conversation, day) : nearestChatTimes(salon, conversation);
  const keyOf = (option: ChatTimeOption) => `${option.date} ${option.time}`;
  const chosen = options.find((option) => keyOf(option) === choice) ?? null;
  const asked = plan.asked?.employee ? plan.asked.name : null;
  const heading = day ? `Free times on ${formatDate(day)}` : 'Nearest free times';
  return (
    // Escape does what Back does: the times close and the focus returns to the button that opened them.
    <fieldset
      ref={panelRef}
      onKeyDown={(event) => { if (event.key === 'Escape' && !locked) { event.preventDefault(); event.stopPropagation(); onBack(); } }}
      className="mt-3 min-w-0 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
      <legend className="sr-only">Suggest another time</legend>
      <p id={`${ids}-heading`} className="text-[13px] font-semibold text-slate-800">{heading}{asked ? ` with ${asked}` : ''}</p>
      {options.length === 0 ? (
        <p className="mt-1 text-[13px] text-slate-600">{day ? 'Nothing is free on that day. Choose another day.' : 'Nothing is free in the next three weeks. Choose a day further ahead.'}</p>
      ) : (
        <div role="radiogroup" aria-labelledby={`${ids}-heading`} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label key={keyOf(option)} className="relative block min-w-0 cursor-pointer">
              <input
                type="radio" name={`${ids}-time`} value={keyOf(option)} checked={choice === keyOf(option)} disabled={locked}
                onChange={() => onChoice(keyOf(option))} className="peer sr-only"
              />
              <span className="flex min-h-11 flex-col justify-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 peer-checked:border-[#5551FF] peer-checked:bg-white peer-checked:ring-2 peer-checked:ring-[#5551FF]/30 peer-focus-visible:outline-2 peer-focus-visible:outline-[#5551FF]">
                <span className="font-semibold text-slate-900"><When date={option.date} start={option.time} end={option.endTime} /></span>
                {!asked && <span className="text-slate-500">with {option.employee.name}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      <label htmlFor={`${ids}-day`} className="mt-3 block text-[13px] font-semibold text-slate-700">Another day</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={`${ids}-day`} type="date" min={today} value={day} disabled={locked}
          onChange={(event) => { onDay(event.target.value); onChoice(''); }}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-[#5551FF] sm:max-w-[12rem] sm:flex-none sm:text-sm"
        />
        {day && <button type="button" disabled={locked} onClick={() => { onDay(''); onChoice(''); }} className={QUIET}>Nearest times</button>}
      </div>
      {chosen && (
        <p className="mt-3 text-[13px] text-slate-600">
          {live ? `${plan.customerName} gets the suggestion in the chat and can answer there.` : `${plan.customerName} is offered this time in the chat.`}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button type="button" disabled={locked || !chosen} onClick={(event) => chosen && onSend(chosen, event)} className={PRIMARY}>Suggest this time</button>
        <button type="button" disabled={locked} onClick={onBack} className={OUTLINE}>Back</button>
      </div>
    </fieldset>
  );
};

// ---------- the request card in a chat ----------

export interface ChatRequestCardProps extends ChatRequestAnswersProps {}

/** A booking request or a change the AI passed on: what is asked, what was checked, and the answers. */
export const ChatRequestCard: React.FC<ChatRequestCardProps> = (props) => {
  const { conversation, salon } = props;
  const plan = planChatBooking(salon, conversation);
  if (!plan) return null;
  const { booking } = plan;
  const change = booking.kind === 'change' && booking.previous;
  const from = plan.previous
    ? { date: plan.previous.date, start: plan.previous.startTime, end: plan.previous.endTime }
    : change ? { date: booking.previous!.date, start: booking.previous!.time, end: plan.endTime ? addMinutes(booking.previous!.time, durationOf(booking.time, plan.endTime)) : null } : null;
  return (
    <section aria-label={change ? 'Change request' : 'Booking request'} className={`${CARD} border-[#5551FF]/30 bg-indigo-50/60`}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#5551FF] text-white">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">{change ? `${plan.customerName} wants to move an appointment` : `${plan.customerName} wants to book`}</h3>
          <p className="text-sm text-slate-700 [overflow-wrap:anywhere]">{plan.serviceName}{plan.asked ? <> · asked for {plan.asked.name}</> : null}</p>
          {from ? (
            <p className="text-xs leading-relaxed text-slate-600">
              From <When date={from.date} start={from.start} end={from.end} /><br />
              to <span className="font-semibold text-slate-900"><When date={booking.date} start={booking.time} end={plan.endTime} /></span>
            </p>
          ) : (
            <p className="text-xs text-slate-600"><span className="font-semibold text-slate-900"><When date={booking.date} start={booking.time} end={plan.endTime} /></span> · for {plan.customerName}</p>
          )}
          {change && !plan.previous && (
            <p className="mt-1 text-xs text-slate-500">That appointment is no longer in your calendar. Confirm books the new time.</p>
          )}
        </div>
      </div>
      <ChatRequestAnswers {...props} />
    </section>
  );
};

const durationOf = (start: string, end: string): number =>
  (Number(end.slice(0, 2)) * 60 + Number(end.slice(3))) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)));

// ---------- a cancellation ----------

export interface ChatCancellationAnswersProps {
  conversation: Conversation;
  salon: Pick<AvailabilityContext, 'events'>;
  onAnswer?: AnswerChat;
  allowTap?: (event: React.MouseEvent) => boolean;
  /** Home's inbox holds "Cancel appointment" for a moment before the customer is told (see AnswerHold). */
  hold?: AnswerHold;
}

/** The two answers to a customer's wish to cancel, and what each of them does. */
export const ChatCancellationAnswers: React.FC<ChatCancellationAnswersProps> = ({ conversation, salon, onAnswer, allowTap, hold }) => {
  const plan = planChatCancellation(salon, conversation);
  const live = isLive(conversation);
  const { sending, onHold, problem, run, undo } = useAnswer(conversation, onAnswer, hold);
  const locked = sending !== null || onHold !== null;
  if (!plan) return null;
  const name = plan.customerName || conversation.customerName;
  const tap = (event: React.MouseEvent, then: () => void) => { if (!allowTap || allowTap(event)) then(); };
  return (
    <div>
      <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
        {plan.appointment
          ? live ? `Cancel appointment takes it out of your calendar and sends ${name} the cancellation in the chat.` : 'Cancel appointment takes it out of your calendar.'
          : live ? `The appointment is no longer in your calendar. Cancel appointment sends ${name} the cancellation in the chat.` : 'The appointment is no longer in your calendar. Cancel appointment closes the request.'}
        {' '}Keep appointment sends nothing: write to {name} yourself.
      </p>
      {onAnswer && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button type="button" disabled={locked} onClick={(event) => tap(event, () => void run({ type: 'cancel' }))} className={`${BUTTON} bg-rose-600 text-white hover:bg-rose-700`}>
            <CalendarX className={ICON} aria-hidden="true" />Cancel appointment
          </button>
          <button type="button" disabled={locked} onClick={(event) => tap(event, () => void run({ type: 'keep' }))} className={OUTLINE}>Keep appointment</button>
        </div>
      )}
      <Status sending={sending} onHold={onHold} onUndo={(event) => tap(event, undo)} problem={problem} live={live} />
    </div>
  );
};

/** "Tom wants to cancel ...": the appointment, and the answers. */
export const ChatCancellationCard: React.FC<ChatCancellationAnswersProps> = (props) => {
  const plan = planChatCancellation(props.salon, props.conversation);
  if (!plan) return null;
  const { request, appointment } = plan;
  const name = plan.customerName || props.conversation.customerName;
  return (
    <section aria-label="Cancellation request" className={`${CARD} border-rose-200 bg-rose-50/60`}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-600 text-white">
          <CalendarX className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">{name} wants to cancel</h3>
          <p className="text-sm text-slate-700 [overflow-wrap:anywhere]">{appointment?.serviceName ?? request.service}{appointment ? ` · with ${appointment.staffName}` : ''}</p>
          <p className="text-xs font-semibold text-slate-900">
            <When date={appointment?.date ?? request.date} start={appointment?.startTime ?? request.time} end={appointment?.endTime ?? null} />
          </p>
        </div>
      </div>
      <ChatCancellationAnswers {...props} />
    </section>
  );
};

// ---------- the booking a chat made ----------

export interface ChatBookedCardProps {
  appointment: CalendarEvent;
  /** How it came about, in words. Without it, the appointment itself says who booked it. */
  origin?: string | null;
  onOpenAppointment?: (appointment: CalendarEvent) => void;
}

/** The appointment a chat booked, how it came about, and the way to it in the calendar: one slim line. */
export const ChatBookedCard = React.forwardRef<HTMLElement, ChatBookedCardProps>(({ appointment, origin, onOpenAppointment }, ref) => (
  <section
    ref={ref} tabIndex={-1} aria-label="Appointment from this chat"
    className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 py-1.5 pl-3 pr-1.5 focus-visible:outline-2 focus-visible:outline-[#5551FF] sm:pl-4"
  >
    <CalendarCheck className="h-5 w-5 shrink-0 text-emerald-700 max-[359px]:hidden" aria-hidden="true" />
    <div className="min-w-0 flex-1 py-0.5">
      <p className="text-[11px] font-semibold leading-tight text-emerald-800">{origin ?? (appointment.isAiBooked ? 'Booked by the AI' : 'Confirmed by you')}</p>
      <h3 className="text-sm font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere]">{appointment.serviceName} · with {appointment.staffName}</h3>
      <p className="text-xs text-slate-700"><When date={appointment.date} start={appointment.startTime} end={appointment.endTime} /></p>
    </div>
    {onOpenAppointment && (
      <button
        type="button" onClick={() => onOpenAppointment(appointment)}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]"
      >
        {/* The narrowest phones show the arrow alone; the words stay for screen readers. */}
        <span className="max-[419px]:sr-only">View in calendar</span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
    )}
  </section>
));
ChatBookedCard.displayName = 'ChatBookedCard';

export interface ChatAppointmentProps {
  conversation: Conversation;
  events: CalendarEvent[];
  onOpenAppointment?: (appointment: CalendarEvent) => void;
}

/**
 * The appointment that came of a chat, pinned above its messages; nothing while the chat has
 * none. Once the owner's answer to a request has booked or moved it, the line takes the focus
 * and is read out: she sees what came of the answer in the place the request left.
 */
export const ChatAppointment: React.FC<ChatAppointmentProps> = ({ conversation, events, onOpenAppointment }) => {
  const appointment = appointmentForConversation(conversation, events);
  const waiting = conversation.bookingRequest?.status === 'requested';
  const confirmed = conversation.bookingRequest?.status === 'confirmed';
  const line = useRef<HTMLElement>(null);
  const before = useRef<{ id: string; waiting: boolean } | null>(null);
  useEffect(() => {
    const last = before.current;
    before.current = { id: conversation.id, waiting };
    // Only a confirmation leads here. A declined change leaves the old appointment in this line, but
    // the work goes on in the chat: its heading takes the focus then (ConversationsView).
    if (last?.id === conversation.id && last.waiting && !waiting && confirmed && appointment) line.current?.focus({ preventScroll: true });
  }, [conversation.id, waiting, confirmed, appointment?.id]);
  if (!appointment) return null;
  return <ChatBookedCard ref={line} appointment={appointment} origin={chatBookingOriginLabel(conversation, appointment)} onOpenAppointment={onOpenAppointment} />;
};

/**
 * In the place of the appointment line: the customer holds a confirmation whose appointment is no
 * longer in the calendar (cancelled there; nothing was sent). "Add to calendar" books it again under
 * the usual rules and sends nothing. Where that cannot be done, the line says why and what is left.
 */
export const ChatMissingAppointment: React.FC<{
  customerName: string;
  booking: NonNullable<Conversation['bookingRequest']>;
  /** Books the confirmed time again; resolves to why it could not, or null. */
  onAdd?: () => string | null;
}> = ({ customerName, booking, onAdd }) => {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <section aria-label="Confirmed appointment missing from your calendar" className="rounded-2xl border border-amber-300/70 bg-amber-50 py-1.5 pl-3 pr-1.5 sm:pl-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 max-[359px]:hidden" aria-hidden="true" />
        <p className="min-w-0 flex-1 py-0.5 text-xs leading-snug text-slate-800 [overflow-wrap:anywhere]">
          {customerName} has a confirmation for {booking.service} on <span className="whitespace-nowrap">{formatDate(booking.date)}</span> · {booking.time}, but it is not in your calendar.
        </p>
        {onAdd && (
          <button
            type="button" onClick={() => setProblem(onAdd())}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-amber-300 bg-white px-2.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]"
          >
            Add to calendar
          </button>
        )}
      </div>
      {problem && (
        <p role="alert" className="mb-1 mr-1.5 mt-1.5 rounded-xl bg-white px-3 py-2 text-xs leading-relaxed text-rose-800 [overflow-wrap:anywhere]">
          {problem} Book it by hand, or write to {customerName}.
        </p>
      )}
    </section>
  );
};

// ---------- what waits for an answer, for one chat ----------

export interface ChatWaitingCardsProps {
  conversation: Conversation;
  salon: AvailabilityContext;
  onAnswer?: AnswerChat;
  className?: string;
}

/** True when a chat holds something the owner has to answer: a booking request, a change, or a wish to cancel. */
export const chatAwaitsAnswer = (conversation: Pick<Conversation, 'bookingRequest' | 'cancellationRequest'>): boolean =>
  conversation.bookingRequest?.status === 'requested' || conversation.cancellationRequest !== undefined;

/**
 * What waits for the owner's answer in a chat: the customer's wish to cancel, and a booking
 * request or a change. Nothing at all when nothing waits.
 */
export const ChatWaitingCards: React.FC<ChatWaitingCardsProps> = ({ conversation, salon, onAnswer, className = '' }) => {
  if (!chatAwaitsAnswer(conversation)) return null;
  return (
    <div data-chat-waiting="" className={`space-y-3 ${className}`}>
      {conversation.cancellationRequest && <ChatCancellationCard conversation={conversation} salon={salon} onAnswer={onAnswer} />}
      {conversation.bookingRequest?.status === 'requested' && <ChatRequestCard conversation={conversation} salon={salon} onAnswer={onAnswer} />}
    </div>
  );
};
