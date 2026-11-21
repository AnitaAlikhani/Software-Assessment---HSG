import type { AvailabilityContext } from './availability';
import type { ChatBookingAction } from './chatBookingActions';
import { isLiveConversation, type ExpectedSlot } from './liveWhatsApp';
import { chatBookingAction, chatTimeOptionsOn, planChatBooking, planChatCancellation } from './requestAnswers';
import type { AppointmentAction, CalendarEvent, Conversation, Customer } from './types';

/**
 * Carries out the owner's answer to what waits in a chat: a booking request, a change, a
 * cancellation. One way for both kinds of chat:
 *
 *   - a live chat: the server sends the customer the fixed message and changes the chat; the
 *     calendar is changed only once the server has taken the answer, so the calendar never holds
 *     an appointment that the customer was not told of;
 *   - one of the salon's own chats: the calendar is changed first, then the chat shows the answer.
 *
 * Every answer is checked against the calendar as it is at the moment of the answer, not as it
 * was when the card was drawn: somebody else may have got the time meanwhile.
 *
 * App.tsx hands in what this needs (src/App.tsx, handleChatBooking); tests hand in stand-ins.
 */

/**
 * The server's side of the answers (src/liveWhatsApp.ts). Each resolves to the server's reason for
 * refusing, or null. `expected` is the request or cancellation this answer is about (day, time,
 * service, person, stylist), as planned here: the server refuses when the customer has asked for something else since,
 * so the customer is never told of another booking than the one the calendar gets.
 */
export interface ChatBookingServer {
  confirmBooking: (conversationId: string, expected: ExpectedSlot, staffName?: string) => Promise<string | null>;
  suggestTime: (conversationId: string, expected: ExpectedSlot, date: string, time: string, staffName?: string) => Promise<string | null>;
  declineBooking: (conversationId: string, expected: ExpectedSlot) => Promise<string | null>;
  cancelBooking: (conversationId: string, expected: ExpectedSlot) => Promise<string | null>;
  keepBooking: (conversationId: string, expected: ExpectedSlot) => Promise<string | null>;
}

export interface ChatBookingDeps {
  /** The salon as it is now, with the clock of this moment. Asked anew after each wait. */
  salon: () => AvailabilityContext;
  /** The chat as it is now. */
  conversation: (id: string) => Conversation | undefined;
  server: ChatBookingServer;
  /** Books or moves the chat's appointment under the usual rules (App.tsx, applyConversationAppointment). */
  applyAppointment: (conversation: Conversation, action: AppointmentAction) => { error: string } | { saved: CalendarEvent };
  removeAppointment: (appointmentId: string) => void;
  /** One of the salon's own chats after the answer; `saved` is the appointment a confirmation booked. */
  updateOwnChat: (conversationId: string, action: ChatBookingAction, saved?: CalendarEvent) => void;
  /** The chats with an answer on its way: a second answer to the same chat waits for the first. */
  busy?: Set<string>;
}

export type ChatBookingOutcome = 'confirmed' | 'suggested' | 'declined' | 'cancelled' | 'kept';

export interface ChatBookingDone {
  outcome: ChatBookingOutcome;
  live: boolean;
  customerName: string;
  serviceName: string;
  /** Who takes the appointment, or who was suggested. Empty when nobody is named. */
  staffName: string;
  /** The time the answer is about: the confirmed, suggested, declined or cancelled one. */
  date: string;
  startTime: string;
  endTime: string;
  /** The time the answered request asked for. */
  asked: { date: string; time: string };
  /** The appointment a confirmation booked. */
  appointment?: CalendarEvent;
  /** A confirmed change: the appointment moved from the time it had. */
  moved?: boolean;
  /** Something the owner still has to do although the answer went through. */
  warning?: string;
}

export type ChatBookingResult = { error: string } | { done: ChatBookingDone };

const NO_REQUEST = 'This booking request is no longer waiting.';
const NO_CANCELLATION = 'This cancellation request is no longer waiting.';

export async function answerChatBooking(conversationId: string, action: ChatBookingAction, deps: ChatBookingDeps): Promise<ChatBookingResult> {
  if (deps.busy?.has(conversationId)) return { error: 'An answer to this chat is already on its way. Wait a moment.' };
  deps.busy?.add(conversationId);
  try {
    return await answer(conversationId, action, deps);
  } finally {
    deps.busy?.delete(conversationId);
  }
}

async function answer(id: string, action: ChatBookingAction, deps: ChatBookingDeps): Promise<ChatBookingResult> {
  const conversation = deps.conversation(id);
  if (!conversation) return { error: 'This chat is no longer available. The customer may have deleted it.' };
  const live = conversation.live === true || isLiveConversation(id);
  const salon = deps.salon();

  if (action.type === 'cancel' || action.type === 'keep') {
    const plan = planChatCancellation(salon, conversation);
    if (!plan) return { error: NO_CANCELLATION };
    const { request, appointment } = plan;
    const done: ChatBookingDone = {
      outcome: action.type === 'cancel' ? 'cancelled' : 'kept', live,
      customerName: plan.customerName, serviceName: appointment?.serviceName ?? request.service, staffName: appointment?.staffName ?? '',
      date: appointment?.date ?? request.date, startTime: appointment?.startTime ?? request.time, endTime: appointment?.endTime ?? request.time,
      asked: { date: request.date, time: request.time },
    };
    if (live) {
      const expected: ExpectedSlot = { date: request.date, time: request.time, service: request.service };
      const refused = action.type === 'cancel' ? await deps.server.cancelBooking(id, expected) : await deps.server.keepBooking(id, expected);
      if (refused) return { error: refused };
    }
    if (action.type === 'cancel' && appointment) deps.removeAppointment(appointment.id);
    if (!live) deps.updateOwnChat(id, action);
    return { done };
  }

  const plan = planChatBooking(salon, conversation);
  if (!plan) return { error: NO_REQUEST };
  const { booking, customerName } = plan;
  const asked = { date: booking.date, time: booking.time };
  // What the card showed, so the server answers exactly this request or none (see ExpectedSlot).
  const expected: ExpectedSlot = {
    ...asked, service: booking.service, customerName: booking.customerName, ...(booking.staffName ? { staffName: booking.staffName } : {}),
  };

  if (action.type === 'suggest') {
    const offered = chatTimeOptionsOn(salon, conversation, action.date).find((option) => option.time === action.time
      && (action.employeeId === undefined || option.employee.id === action.employeeId));
    if (!offered) return { error: 'This time is no longer free. Choose another one.' };
    if (live) {
      const refused = await deps.server.suggestTime(id, expected, action.date, action.time, action.staffName ?? offered.employee.name);
      if (refused) return { error: refused };
    } else {
      deps.updateOwnChat(id, action);
    }
    return { done: { outcome: 'suggested', live, customerName, serviceName: plan.serviceName, staffName: offered.employee.name, date: action.date, startTime: action.time, endTime: offered.endTime, asked } };
  }

  if (action.type === 'decline') {
    if (live) {
      const refused = await deps.server.declineBooking(id, expected);
      if (refused) return { error: refused };
    } else {
      deps.updateOwnChat(id, action);
    }
    return { done: { outcome: 'declined', live, customerName, serviceName: plan.serviceName, staffName: '', date: booking.date, startTime: booking.time, endTime: plan.endTime ?? booking.time, asked } };
  }

  // Confirm where the chat holds the appointment already (booked by hand from the chat): the request
  // is answered and nothing is booked a second time. A change whose old appointment is another one
  // lets that one go, as a confirmed change does.
  if (plan.held) {
    const { held } = plan;
    if (live) {
      const refused = await deps.server.confirmBooking(id, expected, held.staffName);
      if (refused) return { error: refused };
    }
    if (plan.previous && plan.previous.id !== held.id) deps.removeAppointment(plan.previous.id);
    if (!live) deps.updateOwnChat(id, { type: 'confirm', employeeId: held.employeeId, staffName: held.staffName }, held);
    return { done: {
      outcome: 'confirmed', live, customerName, serviceName: held.serviceName, staffName: held.staffName,
      date: held.date, startTime: held.startTime, endTime: held.endTime, asked, appointment: held,
      ...(booking.kind === 'change' && plan.previous ? { moved: true } : {}),
    } };
  }
  // Confirm: with the stylist the owner chose, else the one the plan gives it to.
  const chosen = action.employeeId !== undefined ? plan.freeEmployees.find((employee) => employee.id === action.employeeId) : plan.employee;
  const booked = chosen ? chatBookingAction(plan, chosen.id) : null;
  if (!chosen || !booked || !plan.endTime) {
    const named = action.employeeId !== undefined ? salon.employees.find((employee) => employee.id === action.employeeId)?.name : undefined;
    return { error: named && !plan.refusal ? `${named} is no longer free then. Choose another stylist, or suggest another time.` : plan.refusal ?? NO_REQUEST };
  }
  const done: ChatBookingDone = {
    outcome: 'confirmed', live, customerName, serviceName: plan.serviceName, staffName: chosen.name,
    date: booking.date, startTime: booking.time, endTime: plan.endTime, asked,
  };
  if (live) {
    // The time this plan books: the server confirms exactly this one or nothing. Asked again after
    // a lost answer, the server takes it as done, and the calendar gets it now.
    const refused = await deps.server.confirmBooking(id, expected, chosen.name);
    if (refused) return { error: refused };
  }
  // A new appointment that replaces the one a change moves away from: the old one goes once the new one stands.
  const replaces = booked.type === 'book' ? plan.previous : null;
  // After the wait for the server, the latest chat and calendar count.
  const result = deps.applyAppointment({ ...(deps.conversation(id) ?? conversation), customerName }, booked);
  if ('error' in result) {
    // The server has told the customer already: what is left is the owner's to fix by hand.
    if (live) return { done: { ...done, warning: `${customerName} has the confirmation in the chat, but the appointment could not be added to your calendar: ${result.error} Add it by hand in the calendar.` } };
    return { error: result.error };
  }
  if (replaces) deps.removeAppointment(replaces.id);
  if (!live) deps.updateOwnChat(id, action, result.saved);
  return { done: { ...done, appointment: result.saved, ...(booking.kind === 'change' && plan.previous ? { moved: true } : {}) } };
}

/**
 * The customer record of a chat, for "Book for this customer": the one the chat names, the one
 * that remembers the chat, or the one its appointment was booked for. Null when the chat has
 * none yet; then one is made from the chat (chatCustomerRecord), never a second one.
 */
export function chatCustomer(customers: Customer[], conversation: Pick<Conversation, 'id' | 'customerId' | 'appointmentId'>, events: CalendarEvent[]): Customer | null {
  const byId = (id: string | undefined) => (id === undefined ? undefined : customers.find((customer) => customer.id === id));
  const booked = events.find((event) => event.conversationId === conversation.id && event.customerId !== undefined)
    ?? events.find((event) => event.id === conversation.appointmentId && event.customerId !== undefined && event.customerId === conversation.customerId);
  return byId(conversation.customerId)
    ?? customers.find((customer) => customer.conversationId === conversation.id)
    ?? byId(booked?.customerId)
    ?? null;
}

/** A new customer record for a chat that has none: its name, its language and channel, and the chat itself. A real number only. */
export function chatCustomerRecord(conversation: Pick<Conversation, 'id' | 'customerName' | 'language' | 'channel' | 'phone'>, id: string, phone: string): Customer {
  const name = conversation.customerName.trim().replace(/\s+/g, ' ');
  return {
    id, name, initials: name.split(' ').map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase(),
    email: '', phone, language: conversation.language, channel: conversation.channel, conversationId: conversation.id,
  };
}
