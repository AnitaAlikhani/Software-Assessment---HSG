import { chatBookingMessage } from '../src/chatTemplates.js';
import { LANGUAGE_NAMES } from '../src/conversationData.js';
import { zonedDateTime } from '../src/format.js';
import type { ChatLanguage } from '../src/types.js';
import { INTENTS, type BookingRequest, type IncomingAnalysis, type Intent } from './ai.js';
import { bookingDateLabel, checkBookingRequest, findService } from './bookingRules.js';
import { fixedReply } from './chatReplies.js';
import { BUILT_IN_SALON, isDay, type Salon } from './salon.js';
import {
  addCustomerMessage,
  needsOwner,
  toChatLanguage,
  type IncomingMessage,
  type LiveBookingRequest,
  type LiveConversation,
  type LiveState,
  type Translated,
} from './whatsappCore.js';

/** What the owner reads when a customer writes into a chat she has taken over. */
export const TAKEN_OVER_REASON = 'New message: you are handling this chat.';
/** What the owner reads on a chat whose last message got no answer. */
export const UNANSWERED = 'The AI could not answer this message. Please reply yourself.';

/** The appointment confirmed in this chat, if any (see LiveConversation.confirmedBooking). */
export const confirmedOf = (conversation: LiveConversation): LiveBookingRequest | undefined =>
  conversation.confirmedBooking ?? (conversation.bookingRequest?.status === 'confirmed' ? conversation.bookingRequest : undefined);
/** The request waiting for the owner, if any. */
export const openRequestOf = (conversation: LiveConversation): LiveBookingRequest | undefined =>
  conversation.bookingRequest?.status === 'requested' ? conversation.bookingRequest : undefined;

/** A day and a time, as requests, appointments and the owner's answers name them. */
export interface Slot { date: string; time: string }
export const sameSlot = (a: Slot, b: Slot) => a.date === b.date && a.time === b.time;
const sameText = (a: string | undefined, b: string | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
/**
 * The same appointment: the same day, time, service and person. A parent and a child may both
 * be booked at 10:00 from one chat; by day and time alone they would count as one.
 * A side that names no person (a wish to cancel stored before names were kept) matches any.
 */
export const sameBooking = (a: Slot & { service: string; customerName?: string }, b: Slot & { service: string; customerName?: string }) =>
  sameSlot(a, b) && sameText(a.service, b.service) && (!a.customerName || !b.customerName || sameText(a.customerName, b.customerName));
/** The salon's date today ("2026-10-05"): an appointment before it is over. */
export const salonToday = (now: Date) => zonedDateTime(now, 'Europe/Zurich').date;

/** Every appointment confirmed in this chat, oldest first, over or not. */
export function confirmedBookings(conversation: LiveConversation): LiveBookingRequest[] {
  const latest = confirmedOf(conversation);
  const all = [...(conversation.earlierBookings ?? [])];
  if (latest && !all.some(booking => sameBooking(booking, latest))) all.push(latest);
  return all;
}
/**
 * The appointments of this chat that still lie ahead (today counts). Only these can be cancelled
 * or moved, and only these are "booked": one from last week must not turn a new request into a
 * change of it.
 */
export const standingBookings = (conversation: LiveConversation, now: Date) => {
  const today = salonToday(now);
  return confirmedBookings(conversation).filter(booking => booking.date >= today);
};
/** Stores the chat's confirmed appointments (oldest first): the newest is `confirmedBooking`, the rest stay known; those that are over go. */
export function keepConfirmed(conversation: LiveConversation, bookings: LiveBookingRequest[], now: Date) {
  const today = salonToday(now);
  const ahead = bookings.filter(booking => booking.date >= today);
  conversation.confirmedBooking = ahead.at(-1);
  conversation.earlierBookings = ahead.length > 1 ? ahead.slice(0, -1) : undefined;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const sameService = (a: { service: string; serviceId?: string }, b: { service: string; serviceId?: string }) =>
  a.serviceId && b.serviceId ? a.serviceId === b.serviceId : a.service.toLowerCase() === b.service.toLowerCase();
/** The same service, day, time and person, and no other stylist than the one already noted. */
const sameRequest = (stored: LiveBookingRequest, asked: BookingRequest) =>
  sameService(stored, asked) && stored.date === asked.date && stored.time === asked.time && sameText(stored.customerName, asked.customerName)
  && (!asked.employeeId || asked.employeeId === stored.employeeId);
/** "Haircut on Tuesday, 17.11.2026 at 15:00 for Ana": how the owner's notes name a booking. */
const describe = (booking: { service: string; date: string; time: string; customerName?: string }) =>
  `${booking.service} on ${bookingDateLabel(booking.date)} at ${booking.time}${booking.customerName ? ` for ${booking.customerName}` : ''}`;
const describeAll = (bookings: LiveBookingRequest[]) => bookings.map(booking => describe(booking)).join('; ');

/** What the owner reads while a wish to cancel waits. */
function cancellationReason(conversation: LiveConversation): string {
  const wish = conversation.cancellationRequest!;
  const booked = confirmedBookings(conversation).find(booking => sameBooking(booking, wish));
  return `Cancellation request: ${describe({ ...wish, customerName: wish.customerName ?? booked?.customerName })}. The appointment stands until you answer.`;
}

/**
 * What the owner reads while a request waits, written from the chat as it is now: an appointment
 * that was cancelled meanwhile is no longer said to "stay booked". Used whenever a request is
 * made and whenever a chat is settled after an answer, so the sentence has one source.
 */
export function requestReason(conversation: LiveConversation, now: Date, salon: Salon = BUILT_IN_SALON): string {
  const open = openRequestOf(conversation)!;
  const facts = conversation.requestFacts ?? {};
  const standing = standingBookings(conversation, now);
  // Looked up in the salon as it is now: a service taken off online booking since says so.
  const service = findService(open, salon);
  const moving = open.kind === 'change' ? open.previous : undefined;
  const notes = [
    open.staffName ? `The customer asked for ${open.staffName}.` : '',
    facts.unknownStylist ? `The customer asked for "${facts.unknownStylist}", who is not on the team.` : '',
    facts.stylistNotOffering ? `The customer asked for ${facts.stylistNotOffering}, who does not offer ${open.service}.` : '',
    service && !service.onlineBooking ? `${open.service} is not booked online: you book it personally.` : '',
    facts.moveNotHere ? 'The customer wants to move an appointment that was not booked in this chat.' : '',
    !moving && standing.length === 1 ? `The appointment ${describe(standing[0])} stays booked.` : '',
    !moving && standing.length > 1 ? `The appointments ${describeAll(standing)} stay booked.` : '',
  ].filter(Boolean).join(' ');
  const head = moving
    ? `Change request: ${describe(open)}, instead of ${bookingDateLabel(moving.date)} at ${moving.time}. The appointment stands until you answer.`
    : `Booking request: ${describe(open)}. Please confirm.`;
  return notes ? `${head} ${notes}` : head;
}

/**
 * The one rule for what a chat shows once something in it was answered: it needs the owner while
 * a request or a wish to cancel waits; otherwise it is hers if she took it over; otherwise it is
 * "booked" while an appointment from it lies ahead; otherwise the AI handles it. Computed from
 * what still waits, so no reason outlives the thing it was about.
 */
export function settleStatus(conversation: LiveConversation, now: Date, salon: Salon = BUILT_IN_SALON) {
  const open = openRequestOf(conversation);
  if (!open) conversation.requestFacts = undefined;
  if (open) {
    conversation.status = 'needs-attention';
    conversation.attentionReason = requestReason(conversation, now, salon);
    return;
  }
  if (conversation.cancellationRequest) {
    conversation.status = 'needs-attention';
    conversation.attentionReason = cancellationReason(conversation);
    return;
  }
  conversation.attentionReason = undefined;
  conversation.status = conversation.takenOver ? 'owner-handled' : standingBookings(conversation, now).length > 0 ? 'booked' : 'ai-handled';
}

/**
 * Puts a customer's message into the chat before the AI has seen it, so a slow or failing AI
 * never loses it. The owner sees the text as written until the translation comes. A message
 * into a chat the owner has taken over asks for her at once.
 */
export function storeCustomerMessage(conversation: LiveConversation | null, incoming: IncomingMessage, fallbackLanguage: ChatLanguage = 'EN'): LiveConversation {
  if (conversation?.messages.some(message => message.id === incoming.id)) return conversation;
  const state: LiveState = { conversations: conversation ? [conversation] : [], processedIds: [] };
  // The chat keeps the language it has; the AI settles it for a new one (see settleLanguage).
  const stored = addCustomerMessage(state, incoming, { original: incoming.text, translation: incoming.text },
    conversation?.language ?? fallbackLanguage, conversation?.languageLabel);
  if (stored.takenOver) needsOwner(stored, TAKEN_OVER_REASON);
  return stored;
}

const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

/**
 * One language per chat. The first message sets it; after that it changes only for a message of
 * at least four words in another language. "ok", "merci" or a name are read as all sorts of
 * languages and must not flip the chat (the owner's fixed messages follow this language).
 */
function settleLanguage(conversation: LiveConversation, messageId: string, analysis: IncomingAnalysis, written: string) {
  const detected = toChatLanguage(text(analysis.languageCode));
  const label = text(analysis.languageName) || undefined;
  const spokenBefore = conversation.messages.some(message => message.sender === 'customer' && message.id !== messageId);
  const current = (conversation.languageLabel ?? LANGUAGE_NAMES[conversation.language] ?? '').toLowerCase();
  const same = (label ?? LANGUAGE_NAMES[detected]).toLowerCase() === current;
  if (!text(analysis.languageCode) || (spokenBefore && !same && words(written) < 4)) return;
  conversation.language = detected;
  conversation.languageLabel = label;
  conversation.languageSettled = true;
}

/**
 * The case the AI named. An answer of the earlier format has no intent: a complete booking
 * request then counts as a new one, or, where an appointment is confirmed in this chat, as a
 * change. Both only wait for the owner, so a wrong guess costs nothing but her look.
 */
function intentOf(conversation: LiveConversation, analysis: IncomingAnalysis, now: Date): Intent {
  if (INTENTS.includes(analysis.intent as Intent)) return analysis.intent as Intent;
  const request = analysis.bookingRequest;
  const complete = Boolean(request && [request.service, request.date, request.time, request.customerName].every(value => text(value)));
  if (!complete) return 'question';
  return standingBookings(conversation, now).length > 0 ? 'change' : 'new';
}

/**
 * Applies the AI's reading of a customer message to the chat as it is now: the translation, the
 * language, the handover, and a booking, change or cancellation request. Returns what to send the
 * customer: the AI's reply, a fixed sentence where the AI's words would promise something the
 * server did not do, or null when nothing is to be sent (the owner has taken over).
 * Call addReply only after the reply has really gone out.
 */
export function applyAnalysis(conversation: LiveConversation, messageId: string, analysis: IncomingAnalysis, now = new Date(), salon: Salon = BUILT_IN_SALON): Translated | null {
  const message = conversation.messages.find(item => item.id === messageId);
  if (!message) return null;
  message.translation = text(analysis.translationEn) || message.original;
  const german = text(analysis.translationDe);
  if (german) message.translationDe = german; else delete message.translationDe;
  settleLanguage(conversation, messageId, analysis, message.original);

  const takenOver = conversation.takenOver;
  // The owner took the chat over (maybe while the AI was reading): no AI reply, and the message
  // waits for her, unless she has answered it already.
  const ownerAnswered = conversation.messages.slice(conversation.messages.indexOf(message) + 1).some(item => item.sender === 'owner');
  if (takenOver && !ownerAnswered) needsOwner(conversation, TAKEN_OVER_REASON);
  // In a chat the owner handles, the reason stays "New message: you are handling this chat."
  // The cards still show what the customer asked for.
  const attention = (reason: string) => { if (!takenOver) needsOwner(conversation, reason); };
  const fixed = (kind: Parameters<typeof fixedReply>[0]) => (takenOver ? null : fixedReply(kind, conversation.language));
  const replyText = text(analysis.reply);
  const reply: Translated | null = takenOver || !replyText
    ? null
    : { original: replyText, translation: text(analysis.replyEn) || replyText, ...(text(analysis.replyDe) ? { translationDe: text(analysis.replyDe) } : {}) };

  if (analysis.needsOwner) attention(text(analysis.reason) || 'The AI handed this chat to you.');
  const intent = intentOf(conversation, analysis, now);
  const standing = standingBookings(conversation, now);
  // With more than one appointment ahead, "cancel it" or "move it" could mean either: the owner
  // asks the customer, rather than a card that guesses.
  const several = standing.length > 1;
  const open = openRequestOf(conversation);

  if (intent === 'cancel') {
    if (several) {
      attention(`The customer wants to cancel an appointment, and several are booked in this chat: ${describeAll(standing)}. Ask which one is meant and reply yourself.`);
      return fixed('passedOn');
    }
    const confirmed = standing[0];
    if (confirmed) {
      // The appointment stands until the owner answers; asking twice changes nothing.
      if (!conversation.cancellationRequest) {
        // A change of this appointment and a wish to cancel it never wait together: the newer wish counts.
        if (open?.kind === 'change' && (!open.previous || sameSlot(open.previous, confirmed))) {
          conversation.bookingRequest = conversation.confirmedBooking ?? confirmed;
          conversation.requestFacts = undefined;
        }
        conversation.cancellationRequest = { service: confirmed.service, date: confirmed.date, time: confirmed.time, customerName: confirmed.customerName };
        attention(cancellationReason(conversation));
      }
      return fixed('cancelPassedOn');
    }
    attention(open
      ? 'The customer wants to withdraw the open booking request. Decline it, or reply yourself.'
      : 'The customer wants to cancel an appointment that was not booked in this chat. Please check the calendar and reply.');
    return fixed('passedOn');
  }

  const asked = analysis.bookingRequest;
  const complete = Boolean(asked && [asked.service, asked.date, asked.time, asked.customerName].every(value => text(value)));
  if ((intent !== 'new' && intent !== 'change') || !complete) return reply;

  const check = checkBookingRequest(asked, now, salon);
  if (!check.ok) {
    // The AI's reply says the request went to the salon. It did not: the owner gets it with the
    // reason, and the customer a sentence that promises nothing else.
    // The day as every screen writes it; something that is no date stays as the AI gave it.
    const askedDate = text(asked?.date);
    const askedDay = isDay(askedDate) ? bookingDateLabel(askedDate) : askedDate;
    attention(`Booking request not passed on: ${check.reason}. The customer asked for ${text(asked?.service)} on ${askedDay} at ${text(asked?.time)}. Please reply to the customer.`);
    return fixed('passedOn');
  }
  const request = check.request;
  // The same request again changes nothing: no second card, no chat back in "Needs you".
  if (open && sameRequest(open, request)) return fixed('alreadyRequested');
  if (standing.some(booking => sameRequest(booking, request))) return fixed('alreadyConfirmed');

  // A "yes" to a time the owner offered instead of a change moves that appointment, whatever the
  // AI called it: it must not become a second appointment beside the first.
  const offer = conversation.suggestion;
  const offeredFor = offer?.kind === 'change' && offer.previous && sameService(offer, request) && sameSlot(offer, request)
    ? standing.find(booking => sameSlot(booking, offer.previous!))
    : undefined;
  let moving = offeredFor;
  if (!moving && intent === 'change') {
    if (several) {
      attention(`The customer wants to move an appointment to ${describe(request)}, and several are booked in this chat: ${describeAll(standing)}. Ask which one is meant and reply yourself.`);
      return fixed('passedOn');
    }
    moving = standing[0];
  }
  // The confirmed appointments are kept aside: a change or a further request does not remove them.
  keepConfirmed(conversation, confirmedBookings(conversation), now);
  // A change of an appointment and a wish to cancel it never wait together: the newer wish counts.
  if (moving && conversation.cancellationRequest && sameSlot(conversation.cancellationRequest, moving)) conversation.cancellationRequest = undefined;
  conversation.bookingRequest = {
    ...request,
    status: 'requested',
    kind: moving ? 'change' : 'new',
    ...(moving ? { previous: { date: moving.date, time: moving.time } } : {}),
  };
  conversation.suggestion = undefined;
  // Only what cannot be read from the chat later is kept; the sentence itself is always written anew.
  const facts = {
    ...(check.unknownStylist ? { unknownStylist: check.unknownStylist } : {}),
    ...(check.stylistNotOffering ? { stylistNotOffering: check.stylistNotOffering } : {}),
    ...(intent === 'change' && !moving ? { moveNotHere: true } : {}),
  };
  conversation.requestFacts = Object.keys(facts).length > 0 ? facts : undefined;
  attention(requestReason(conversation, now, salon));
  // Only a request is stored; the owner has not confirmed anything. The AI's own words may say
  // more ("I have entered your appointment"), so the customer gets the server's fixed sentence,
  // which names what was passed on and that nothing is booked yet.
  if (takenOver) return null;
  // A wish to move an appointment that was not booked in this chat: which one stays is not known here.
  return chatBookingMessage(moving ? 'changeRequested' : intent === 'change' ? 'moveRequested' : 'requested', {
    language: conversation.language, customerName: request.customerName, salonName: salon.companySettings.companyName,
    serviceName: request.service, staffName: request.staffName, date: request.date, time: request.time,
    ...(moving ? { askedDate: moving.date, askedTime: moving.time } : {}),
  });
}

/** The first name the chat knows: from a booking, else from the name the customer gave, unless that is only a channel's placeholder. */
function knownFirstName(conversation: LiveConversation): string {
  const booked = conversation.bookingRequest?.customerName ?? conversation.confirmedBooking?.customerName;
  if (booked) return booked;
  if (/^(website visitor|telegram customer|whatsapp customer)$/i.test(conversation.customerName.trim())) return '';
  return conversation.customerName.trim().split(/\s+/)[0] ?? '';
}

const withStylist = (booking: { staffName?: string }) => (booking.staffName ? ` with ${booking.staffName}` : '');
const slot = (booking: { service: string; date: string; time: string; customerName?: string; staffName?: string }) =>
  `${describe(booking)}${withStylist(booking)} (date ${booking.date}, time ${booking.time})`;

/**
 * What the server knows about the chat, for the AI: the language to answer in, the first name and
 * service known so far, and a booking that waits or stands. The message being answered is left
 * out (`messageId`), so a chat's first message is a first message.
 */
export function chatStateLines(conversation: LiveConversation, messageId?: string, now = new Date()): string[] {
  const lines: string[] = [];
  if (conversation.messages.some(message => message.sender === 'customer' && message.id !== messageId)) {
    const language = conversation.languageLabel ?? LANGUAGE_NAMES[conversation.language];
    lines.push(`Chat language: ${language}. Reply in ${language}.`);
  }
  const name = knownFirstName(conversation);
  lines.push(name ? `Customer's first name: ${name}.` : "Customer's first name: not known yet.");
  const open = openRequestOf(conversation);
  // Every appointment ahead, so the AI never talks as if there were only one.
  const standing = standingBookings(conversation, now);
  const service = open?.service ?? conversation.suggestion?.service ?? standing.at(-1)?.service;
  if (service) lines.push(`Service already chosen: ${service}.`);
  for (const booking of standing) lines.push(`Confirmed appointment: ${slot(booking)}.`);
  if (standing.length > 1) lines.push('Several appointments are confirmed in this chat: if the customer wants to cancel or move one, ask which one.');
  if (open) lines.push(`${open.kind === 'change' ? 'Change' : 'Booking'} request waiting for the salon: ${slot(open)}.`);
  if (conversation.cancellationRequest) lines.push("The customer's wish to cancel the confirmed appointment is waiting for the salon.");
  if (conversation.suggestion) {
    lines.push(`The salon offered ${slot(conversation.suggestion)}. If the customer accepts, fill in bookingRequest with exactly this.`);
  }
  return lines;
}

/**
 * Saves a customer message with the AI's translation, applies the handover rules and a complete
 * booking request. Returns the conversation and the reply to send, or null when the owner has
 * taken over. Call addReply only after the channel has really sent the reply.
 */
export function recordAnalysis(state: LiveState, incoming: IncomingMessage, analysis: IncomingAnalysis, now = new Date(), salon: Salon = BUILT_IN_SALON) {
  const existing = state.conversations.find(item => item.waId === incoming.waId) ?? null;
  const conversation = storeCustomerMessage(existing, incoming);
  if (!existing) state.conversations.push(conversation);
  if (!state.processedIds.includes(incoming.id)) state.processedIds = [...state.processedIds, incoming.id].slice(-500);
  const reply = applyAnalysis(conversation, incoming.id, analysis, now, salon);
  return { conversation, reply };
}
