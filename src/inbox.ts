import type { AppointmentRequest, CalendarEvent, Conversation } from './types';
import { appointmentIdForRequest, requestTimes } from './appointmentActions';
import type { ChatBooking, ChatCancellation } from './requestAnswers';
import { getSalonNow } from './scheduling';

/**
 * Home's inbox, "Waiting for you": everything that needs the owner, in one list.
 *
 *   - booking requests from the booking page;
 *   - booking requests the AI collected in a chat and the owner has not answered yet, and a
 *     customer's wish in a chat to cancel an appointment;
 *   - chats in which a customer waits for the owner.
 *
 * A chat with a waiting booking request or cancellation is listed once, as that request. The list is built here
 * from the data, without a clock of its own, so every screen and every test builds the same one.
 */

/**
 * How long an answered request stays in the list after the answer. It keeps its place for that
 * time, so the next entry cannot slide under a finger that taps twice, and it carries what the
 * owner still has to do: tell the customer. Five minutes are enough to copy the text, write to
 * the customer and come back; "Done" removes the entry at once.
 */
export const ANSWER_SHOWN_MS = 5 * 60_000;

/** An answer the owner gave on Home a moment ago. */
export type RequestAnswer =
  | {
      kind: 'request';
      /** The id of the request. */
      id: string;
      outcome: 'accepted' | 'moved' | 'rejected';
      /** When the answer was given (epoch ms). */
      at: number;
      /** The request as it stood before the answer: what "Undo" puts back. */
      request: AppointmentRequest;
      /** Its place in the stored list, so that "Undo" puts it back where it was. */
      index: number;
    }
  | {
      kind: 'chat';
      /** The id of the chat the request was collected in. */
      id: string;
      at: number;
      /**
       * What the owner answered. Missing on answers stored before there were other answers
       * than a confirmation: those are confirmations.
       */
      outcome?: 'confirmed' | 'suggested' | 'declined' | 'cancelled' | 'kept';
      /** The appointment a confirmation booked; empty for the other answers. */
      appointmentId: string;
      customerName: string;
      serviceName: string;
      /** Who takes the appointment, or who was suggested; empty when nobody is named. */
      staffName: string;
      /** The time the answer is about: the confirmed, suggested, declined or cancelled one. */
      date: string;
      startTime: string;
      endTime: string;
      /** The time the answered request asked for, where it differs from `date` and `startTime` (a suggestion names another time). */
      asked?: { date: string; time: string };
      /** Whether the chat is a live one: there the server has sent the customer the message. */
      live?: boolean;
      /**
       * Whether the answer has reached the chat. Answers are recorded once the server has taken
       * them ('done'); 'pending' and 'failed' are only found in answers stored by an earlier build.
       */
      delivery: 'pending' | 'done' | 'failed';
      /** After a failure: what the server said. */
      problem?: string;
    };

/** The answer to a chat's request, also for one stored before answers had an outcome. */
export const chatOutcome = (answer: Extract<RequestAnswer, { kind: 'chat' }>): NonNullable<Extract<RequestAnswer, { kind: 'chat' }>['outcome']> => answer.outcome ?? 'confirmed';

export const answerIsShown = (answer: RequestAnswer, now: Date): boolean => now.getTime() - answer.at < ANSWER_SHOWN_MS;

/** True for a chat's answer whose confirmation is still on its way: only the page that started it learns how it ends. */
export const unsettledAnswer = (answer: RequestAnswer): boolean => answer.kind === 'chat' && answer.delivery === 'pending';

/** The list of answers after a new one: one answer per request, and nothing that is no longer shown. */
export const withAnswer = (answers: RequestAnswer[], answer: RequestAnswer): RequestAnswer[] => [
  ...answers.filter((item) => answerIsShown(item, new Date(answer.at)) && !(item.kind === answer.kind && item.id === answer.id)),
  answer,
];

export type InboxItem = { key: string } & (
  /** A request from the booking page. `moved` is set while it shows that the owner has just moved it. */
  | { kind: 'request'; request: AppointmentRequest; moved?: Extract<RequestAnswer, { kind: 'request' }> }
  /** A request the owner has just accepted or rejected. */
  | { kind: 'request-answered'; answer: Extract<RequestAnswer, { kind: 'request' }> }
  /** A booking request that waits in a chat. */
  | { kind: 'chat-request'; conversation: Conversation; booking: ChatBooking }
  /** A customer's wish in a chat to cancel the appointment confirmed there. */
  | { kind: 'chat-cancellation'; conversation: Conversation; cancellation: ChatCancellation }
  /** A chat's request the owner has just answered. */
  | { kind: 'chat-request-answered'; answer: Extract<RequestAnswer, { kind: 'chat' }> }
  /** A chat in which the customer waits for the owner. */
  | { kind: 'chat'; conversation: Conversation }
);

/** True for an entry that still waits for the owner; false for one that only shows an answer just given. */
export const isWaiting = (item: InboxItem): boolean => item.kind === 'request' || item.kind === 'chat-request' || item.kind === 'chat-cancellation' || item.kind === 'chat';

/**
 * How many entries wait for the owner, and of which kind: the number beside "Waiting for you",
 * the badge on Home and the count in the browser tab all show `waiting`, so the owner meets one
 * number. A request is whatever asks for a decision about an appointment (a booking request from
 * the booking page or from a chat, a change, a cancellation); a chat is a customer who waits for
 * an answer in words.
 */
export const inboxCounts = (items: InboxItem[]): { waiting: number; requests: number; chats: number } => {
  const waiting = items.filter(isWaiting);
  const chats = waiting.filter((item) => item.kind === 'chat').length;
  return { waiting: waiting.length, requests: waiting.length - chats, chats };
};

// ---------- how long somebody has waited ----------

/** The whole minutes since a moment. Null when the moment is not known. */
export const waitedMinutes = (since: string | undefined, now: Date): number | null => {
  const time = since ? Date.parse(since) : NaN;
  return Number.isFinite(time) ? Math.max(0, Math.round((now.getTime() - time) / 60_000)) : null;
};

/** How a wait is shown: quietly, as a long one, or as one that is overdue. */
export type WaitingLevel = 'calm' | 'long' | 'overdue';

/**
 * From when a wait stands out, in minutes. Somebody in a chat is waiting right now: a quarter of
 * an hour is long, an hour is overdue. A request from the booking page was sent and left: it is
 * answered within hours, so two hours are long and a day is overdue.
 */
export const WAITING_LIMITS = {
  chat: { long: 15, overdue: 60 },
  page: { long: 120, overdue: 24 * 60 },
} as const;

export const waitingLevel = (source: keyof typeof WAITING_LIMITS, minutes: number | null): WaitingLevel => {
  if (minutes === null) return 'calm';
  const limits = WAITING_LIMITS[source];
  return minutes >= limits.overdue ? 'overdue' : minutes >= limits.long ? 'long' : 'calm';
};

/** A wait as short as a small label has room for: "now", "42 min", "3 h", "2 days". */
export const waitingLabel = (minutes: number): string => {
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
};

/** The same wait in words, for a screen reader: "42 minutes", "3 hours", "2 days". */
export const waitingWords = (minutes: number): string => {
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
};

/** A chat's booking request that the owner has not confirmed yet. */
export const waitingChatBooking = (conversation: Pick<Conversation, 'bookingRequest'>): ChatBooking | null =>
  conversation.bookingRequest?.status === 'requested' ? conversation.bookingRequest : null;

interface InboxInput {
  requests: AppointmentRequest[];
  conversations: Conversation[];
  /** The calendar: an accepted request is only shown as such while its appointment is in it. */
  events: CalendarEvent[];
  answers: RequestAnswer[];
  timeZone?: string;
  now: Date;
}

/**
 * The inbox, the oldest need first. Every entry is dated by what it is about. A chat is about
 * the customer's last message: whoever has waited longest comes first. A booking request is
 * about the appointment asked for: the nearest date comes first. So people who wait in a chat
 * stand above the requests for the days to come, and a request whose time has already passed
 * stands at the top.
 *
 * An entry that shows an answer keeps the place it had before the answer.
 */
export function inboxItems({ requests, conversations, events, answers, timeZone, now }: InboxInput): InboxItem[] {
  const shown = answers.filter((answer) => answerIsShown(answer, now));
  const requestAnswer = (id: string) => shown.find((answer): answer is Extract<RequestAnswer, { kind: 'request' }> => answer.kind === 'request' && answer.id === id);
  const chatAnswer = (id: string) => shown.find((answer): answer is Extract<RequestAnswer, { kind: 'chat' }> => answer.kind === 'chat' && answer.id === id);

  /** The appointment a request asks for, as a moment on the salon's clock. */
  const asked = (date: string, start: string) => `${date} ${start}`;
  const askedBy = (request: AppointmentRequest) => asked(request.date, requestTimes(request)?.start ?? request.timeStr.slice(0, 5));
  /** A moment in time on the salon's clock, so that it can be compared with the dates of requests. */
  const written = (moment: string | undefined): string => {
    const time = moment ? Date.parse(moment) : NaN;
    if (!Number.isFinite(time)) return '';
    const clock = getSalonNow(timeZone, new Date(time));
    return `${clock.date} ${clock.time}`;
  };

  const dated: { item: InboxItem; at: string; exact: string }[] = [];
  const pendingIds = new Set<string>();
  for (const request of requests) {
    if (request.status !== 'pending') continue;
    pendingIds.add(request.id);
    const answer = requestAnswer(request.id);
    const moved = answer?.outcome === 'moved' ? answer : undefined;
    dated.push({ item: { kind: 'request', key: `request:${request.id}`, request, moved }, at: askedBy(moved?.request ?? request), exact: request.createdAt ?? '' });
  }
  for (const answer of shown) {
    if (answer.kind !== 'request' || answer.outcome === 'moved' || pendingIds.has(answer.id)) continue;
    // An accepted request whose appointment has been removed from the calendar since has nothing left to show or to undo.
    if (answer.outcome === 'accepted' && !events.some((event) => event.id === appointmentIdForRequest(answer.id))) continue;
    dated.push({ item: { kind: 'request-answered', key: `request:${answer.id}`, answer }, at: askedBy(answer.request), exact: answer.request.createdAt ?? '' });
  }
  const supersededAnswers = new Set<string>();
  for (const conversation of conversations) {
    const answer = chatAnswer(conversation.id);
    const booking = waitingChatBooking(conversation);
    const cancellation = conversation.cancellationRequest;
    // A new request in the same chat (the customer took up a suggested time) is listed as itself;
    // until then the answer stands where the request stood, also when the chat itself has gone meanwhile.
    const before = answer?.asked ?? (answer ? { date: answer.date, time: answer.startTime } : null);
    const answered = answer && before && !(booking && (booking.date !== before.date || booking.time !== before.time))
      && !(cancellation && chatOutcome(answer) !== 'cancelled' && chatOutcome(answer) !== 'kept');
    if (answer && answered) continue;
    if (answer) supersededAnswers.add(answer.id);
    if (cancellation) {
      dated.push({ item: { kind: 'chat-cancellation', key: `chat:${conversation.id}`, conversation, cancellation }, at: asked(cancellation.date, cancellation.time), exact: '' });
    } else if (booking) {
      // No second key: the time of the last message changes when the confirmation arrives, and the entry must not move then.
      dated.push({ item: { kind: 'chat-request', key: `chat:${conversation.id}`, conversation, booking }, at: asked(booking.date, booking.time), exact: '' });
    } else if (conversation.status === 'needs-attention') {
      dated.push({ item: { kind: 'chat', key: `chat:${conversation.id}`, conversation }, at: written(conversation.lastMessageAt), exact: conversation.lastMessageAt ?? '' });
    }
  }
  for (const answer of shown) {
    if (answer.kind === 'chat' && !supersededAnswers.has(answer.id)) dated.push({ item: { kind: 'chat-request-answered', key: `chat:${answer.id}`, answer }, at: asked(answer.date, answer.startTime), exact: '' });
  }
  return dated
    .sort((a, b) => a.at.localeCompare(b.at) || a.exact.localeCompare(b.exact) || a.item.key.localeCompare(b.item.key))
    .map(({ item }) => item);
}
