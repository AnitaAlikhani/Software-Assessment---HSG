import type { ChatBookingAction } from './chatBookingActions';
import { chatBookingMessage, type ChatBookingMessageKind } from './chatTemplates';
import { ATTENTION, chatTimeLabel, nextStepDate, sampleChatScript, scriptMessage, type ScriptedNextStep, type ScriptText } from './conversationData';
import { initialEmployees, initialServices } from './mockData';
import { chatAppointmentId } from './requestAnswers';
import { getSalonNow } from './scheduling';
import type { AppointmentAction, ChatMessage, Conversation } from './types';

/**
 * How the salon's own chats (not the live ones) go on after the owner acts in them: an answer to
 * a booking request (sampleChatAfter), a reply she sends (sampleChatAfterOwnerReply), or the
 * chat handed back to the AI (sampleChatAfterAi).
 *
 * All of it is a pure function of its arguments: the moment is passed in, nothing is booked here.
 * The caller (src/App.tsx) puts the appointment into the calendar first, with the usual checks,
 * and passes on only what the chat should show. A live chat is returned unchanged: the server
 * carries out the owner's answers there and sends the messages.
 */

type Booking = NonNullable<Conversation['bookingRequest']>;
type Text = Pick<ChatMessage, 'original' | 'translation' | 'translationDe'>;

/** A new message at `now`. Several messages of one step share the moment and differ by their number. */
const messageAt = (conversation: Conversation, sender: ChatMessage['sender'], text: Text, now: Date, timeZone: string, step: number): ChatMessage => ({
  id: `msg-${now.getTime()}-${conversation.messages.length + step}`,
  sender,
  original: text.original,
  translation: text.translation,
  ...(text.translationDe && conversation.language !== 'DE' ? { translationDe: text.translationDe } : {}),
  time: getSalonNow(timeZone, now).time,
  sentAt: now.toISOString(),
});

/**
 * The chat with these messages added at the end; the list shows the time of the newest one.
 * `keepPrepared`: the salon's confirmation leaves a question of the customer's open, so the answers
 * prepared for it stay (see sampleChatAfter).
 */
const withMessages = (conversation: Conversation, sent: { sender: ChatMessage['sender']; text: Text }[], now: Date, timeZone: string, keepPrepared = false): Conversation => {
  if (sent.length === 0) return conversation;
  return {
    ...conversation,
    messages: [...conversation.messages, ...sent.map((item, index) => messageAt(conversation, item.sender, item.text, now, timeZone, index + 1))],
    lastTime: chatTimeLabel(now, now, timeZone),
    lastMessageAt: now.toISOString(),
    // Scripted suggestions and the AI's prepared answer answer the customer's earlier message. Once
    // something new was said they are stale, and one of them could book the old time again.
    ...(keepPrepared ? {} : { quickReplies: undefined, aiFollowUp: undefined }),
  };
};

/**
 * True while the customer's last question has answers prepared for it (suggested replies, the AI's
 * answer): it is still open. A confirmation of the booking does not answer it.
 */
const questionOpen = (conversation: Conversation): boolean =>
  Boolean(conversation.aiFollowUp) || (conversation.quickReplies?.length ?? 0) > 0;

/**
 * The status that follows from what a chat holds: a request or a cancellation that waits needs
 * the owner, a chat with its appointment is booked, anything else is what the caller says.
 */
const settled = (conversation: Conversation, otherwise: Conversation['status'], reason?: string): Conversation => {
  const waits = conversation.bookingRequest?.status === 'requested' || conversation.cancellationRequest !== undefined;
  const status = waits ? 'needs-attention' : conversation.appointmentId ? 'booked' : otherwise;
  const attentionReason = status !== 'needs-attention' ? undefined
    : reason ?? conversation.attentionReason ?? (conversation.cancellationRequest ? ATTENTION.cancellation : requestReason(conversation.bookingRequest!));
  const { attentionReason: _old, ...rest } = conversation;
  return { ...rest, status, ...(attentionReason ? { attentionReason } : {}) };
};

/**
 * An answer to the booking while the customer's question is still open: the chat keeps waiting for
 * the owner with the question's reason, and the answers prepared for it stay. A suggested reply no
 * longer books, though: the booking has been answered, and it would book the time first asked for.
 */
const questionStillOpen = (told: Conversation, before: Conversation): Conversation => ({
  ...told,
  status: 'needs-attention',
  attentionReason: before.attentionReason ?? (told.bookingRequest?.status === 'requested' ? requestReason(told.bookingRequest) : ATTENTION.request),
  quickReplies: told.quickReplies?.map(({ appointmentAction: _booked, ...reply }) => reply),
});

const requestReason = (booking: Booking): string => booking.kind === 'change' ? ATTENTION.change : ATTENTION.request;

const fromScript = (text: ScriptText, conversation: Conversation): Text => scriptMessage(text, conversation.language);

/** Who the request names, or who the owner chose instead. */
const withStylist = (booking: Booking, employeeId?: string, staffName?: string): Booking => {
  if (!employeeId && !staffName) return booking;
  const { employeeId: _id, staffName: _name, ...rest } = booking;
  return { ...rest, ...(employeeId ? { employeeId } : {}), ...(staffName ? { staffName } : {}) };
};

const fixedMessage = (
  kind: ChatBookingMessageKind, conversation: Conversation, salonName: string,
  details: { serviceName: string; date: string; time: string; staffName?: string; askedDate?: string; askedTime?: string },
): Text => chatBookingMessage(kind, {
  language: conversation.language,
  customerName: conversation.bookingRequest?.customerName.trim() || conversation.customerName,
  salonName,
  ...details,
});

/** A request at the time a scripted step asks for, on the weekday after the day the customer wrote. */
const scriptedRequest = (conversation: Conversation, step: ScriptedNextStep, timeZone: string, now: Date): Booking => {
  const lastCustomer = [...conversation.messages].reverse().find((message) => message.sender === 'customer');
  const writtenOn = getSalonNow(timeZone, lastCustomer?.sentAt ? new Date(lastCustomer.sentAt) : now).date;
  const service = initialServices.find((item) => item.id === step.request.serviceId);
  const employee = initialEmployees.find((item) => item.id === step.request.employeeId);
  return {
    service: service?.name ?? step.request.serviceId,
    serviceId: step.request.serviceId,
    date: nextStepDate(step, writtenOn),
    time: step.request.time,
    customerName: conversation.customerName,
    status: 'requested',
    ...(employee ? { employeeId: employee.id, staffName: employee.name } : {}),
    kind: 'new',
  };
};

/**
 * What one of the salon's own chats looks like after the owner's answer to the booking request
 * (or the cancellation) in it.
 *
 * - confirm: the customer gets the fixed confirmation, the request is confirmed (with the stylist
 *   the owner chose), the chat is booked and names the appointment the caller has made: for a new
 *   request the id that confirming gives it (chatAppointmentId), for a change the appointment it moves.
 *   The customer thanks the salon.
 * - suggest: the customer gets the fixed "we can offer ... instead", agrees, and the AI passes that
 *   on: a new request at the suggested time waits for one more tap.
 * - decline: the customer gets the fixed "we cannot offer"; the request is cleared. A customer
 *   whose change cannot be made keeps the appointment they have.
 * - cancel: the customer gets the fixed cancellation; booking and cancellation request are cleared.
 * - keep: the cancellation request is cleared and nothing is sent; the owner writes herself.
 *
 * An answer that does not fit what the chat holds (confirming where nothing waits) changes nothing.
 */
export function sampleChatAfter(conversation: Conversation, action: ChatBookingAction, now: Date, timeZone: string, salonName: string): Conversation {
  if (conversation.live) return conversation;
  const script = sampleChatScript(conversation);
  if (!script) return conversation;
  const request = conversation.bookingRequest?.status === 'requested' ? conversation.bookingRequest : undefined;
  const cancellation = conversation.cancellationRequest;
  // Whatever the answer to the booking, a question of the customer's that is still open stays open.
  const open = questionOpen(conversation);

  if (action.type === 'confirm' || action.type === 'suggest' || action.type === 'decline') {
    if (!request) return conversation;
    if (action.type === 'confirm') {
      const booking = withStylist({ ...request, status: 'confirmed' }, action.employeeId, action.staffName);
      const appointmentId = request.kind === 'change' && conversation.appointmentId ? conversation.appointmentId : chatAppointmentId(conversation.id, request);
      // The customer thanks the salon, unless her question is still open (she waits for that answer)
      // or the owner has taken the chat over (what the customer says next is the owner's to answer,
      // and a scripted thanks would only wait there as an unanswered message).
      const thanks = !open && !conversation.takenOver;
      const told = withMessages({ ...conversation, bookingRequest: booking, appointmentId }, [
        { sender: 'owner', text: fixedMessage('confirmed', conversation, salonName, { serviceName: request.service, date: request.date, time: request.time, staffName: booking.staffName }) },
        ...(thanks ? [{ sender: 'customer' as const, text: fromScript(script.thanks, conversation) }] : []),
      ], now, timeZone, open);
      return open ? questionStillOpen(told, conversation) : settled(told, 'booked');
    }
    if (action.type === 'suggest') {
      const offered = withStylist({ ...request, date: action.date, time: action.time }, action.employeeId, action.staffName);
      const told = withMessages({ ...conversation, bookingRequest: offered }, [
        { sender: 'owner', text: fixedMessage('suggested', conversation, salonName, {
          serviceName: request.service, date: action.date, time: action.time, staffName: offered.staffName, askedDate: request.date, askedTime: request.time,
        }) },
        { sender: 'customer', text: fromScript(script.agree, conversation) },
        { sender: 'ai', text: fromScript(script.passedOn, conversation) },
      ], now, timeZone, open);
      return open ? questionStillOpen(told, conversation) : settled(told, 'ai-handled', ATTENTION.accepted);
    }
    const { bookingRequest: _declined, ...rest } = conversation;
    const told = withMessages(rest, [
      { sender: 'owner', text: fixedMessage('declined', conversation, salonName, { serviceName: request.service, date: request.date, time: request.time, staffName: request.staffName }) },
      ...(request.kind === 'change' && conversation.appointmentId ? [{ sender: 'customer' as const, text: fromScript(script.keepCurrent, conversation) }] : []),
    ], now, timeZone, open);
    return open ? questionStillOpen(told, conversation) : settled(told, 'owner-handled');
  }

  if (!cancellation) return conversation;
  const { cancellationRequest: _answered, ...withoutCancellation } = conversation;
  if (action.type === 'keep') return settled({ ...withoutCancellation, takenOver: true }, 'owner-handled');
  // The appointment leaves the calendar (the caller removes it), and with it the booking of this chat.
  const { bookingRequest: _booking, appointmentId: _appointment, ...rest } = withoutCancellation;
  const told = withMessages(rest, [
    { sender: 'owner', text: fixedMessage('cancelled', conversation, salonName, { serviceName: cancellation.service, date: cancellation.date, time: cancellation.time }) },
  ], now, timeZone);
  return settled(told, 'owner-handled');
}

/** The appointment a reply or the AI's follow-up booked, as the caller saved it. */
export interface ChatBookingMade {
  action: AppointmentAction;
  /** The stylist the appointment was saved with. */
  staffName?: string;
}

/**
 * One of the salon's chats after the owner sent a reply: a suggested one (its customer text in
 * `local`) or one she typed. The chat is hers from then on (taken over).
 * - A reply that booked (`booked`) and answers a waiting request confirms that request: the
 *   customer gets the fixed confirmation after the reply.
 * - A suggested reply that offers a time goes on as the chat's story says: the customer accepts,
 *   and a request at that time waits for the owner's tap.
 */
export function sampleChatAfterOwnerReply(
  conversation: Conversation, reply: { english: string; local?: string }, booked: ChatBookingMade | undefined,
  now: Date, timeZone: string, salonName: string,
): Conversation {
  // A suggested reply brings its German text along; a typed one has none and is sent as written.
  const german = reply.local ? conversation.quickReplies?.find((item) => item.en === reply.english && item.local === reply.local)?.de : undefined;
  const sent = withMessages({ ...conversation, takenOver: true, appointmentId: booked?.action.appointmentId ?? conversation.appointmentId }, [{
    sender: 'owner',
    text: { original: reply.local ?? reply.english, translation: reply.english, ...(german ? { translationDe: german } : {}) },
  }], now, timeZone);
  const typed = { ...sent, messages: sent.messages.map((message, index) => index === sent.messages.length - 1 && !reply.local ? { ...message, untranslated: true } : message) };

  if (booked && typed.bookingRequest?.status === 'requested') {
    const confirmed = sampleChatAfter(typed, {
      type: 'confirm',
      ...(booked.action.type === 'book' ? { employeeId: booked.action.employeeId } : {}),
      ...(booked.staffName ? { staffName: booked.staffName } : {}),
    }, now, timeZone, salonName);
    return { ...confirmed, appointmentId: booked.action.appointmentId };
  }
  const script = sampleChatScript(conversation);
  const step = reply.local ? script?.afterReply(reply.english) : undefined;
  if (!booked && step) {
    // The AI is paused while the owner writes, so only the customer answers.
    const answered = withMessages({ ...typed, bookingRequest: scriptedRequest(typed, step, timeZone, now) }, [{ sender: 'customer', text: fromScript(step.customer, typed) }], now, timeZone);
    return settled(answered, 'owner-handled', ATTENTION.accepted);
  }
  // The reply answered the customer's open question: a request that still waits is what remains.
  const stillWaits = typed.bookingRequest?.status === 'requested' && questionOpen(conversation);
  return settled(typed, 'owner-handled', stillWaits ? requestReason(typed.bookingRequest!) : undefined);
}

/**
 * One of the salon's chats after the owner handed it back to the AI: the AI sends its prepared
 * answer, if there is one, and the suggested replies are gone (the AI has answered for the owner).
 * Where the answer offers a time, the customer accepts and a request at that time waits for the
 * owner's tap. A request that waited before still waits: only the owner confirms bookings.
 */
export function sampleChatAfterAi(conversation: Conversation, now: Date, timeZone: string, booked?: ChatBookingMade): Conversation {
  const followUp = conversation.aiFollowUp;
  const base: Conversation = { ...conversation, takenOver: false, quickReplies: undefined, aiFollowUp: undefined, appointmentId: booked?.action.appointmentId ?? conversation.appointmentId };
  if (!followUp) return settled(base, 'ai-handled');
  const answered = withMessages(base, [{ sender: 'ai', text: followUp }], now, timeZone);
  const step = !booked ? sampleChatScript(conversation)?.afterFollowUp : undefined;
  // What the chat waited for (a discount question, a time after closing) is answered now; a request that is still open is what remains.
  if (!step) return settled(answered, 'ai-handled', answered.bookingRequest?.status === 'requested' ? requestReason(answered.bookingRequest) : undefined);
  const withRequest = withMessages({ ...answered, bookingRequest: scriptedRequest(answered, step, timeZone, now) }, [
    { sender: 'customer', text: fromScript(step.customer, answered) },
    ...(step.ai ? [{ sender: 'ai' as const, text: fromScript(step.ai, answered) }] : []),
  ], now, timeZone);
  return settled(withRequest, 'ai-handled', ATTENTION.request);
}
