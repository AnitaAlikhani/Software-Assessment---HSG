import { isDeepStrictEqual } from 'node:util';
import { translateOwnerReply } from '../../server/ai.js';
import { aiCeilingReached, LIMIT_TEXTS, ownerAccess, ownerRefusal } from '../../server/limits.js';
import { cleanName, matchStylist, strictDate, strictTime } from '../../server/bookingRules.js';
import { applyAi, askAi, recordDelivery, type Saved } from '../../server/chatFlow.js';
import { sendFirstNoticeIfDue } from '../../server/firstNotice.js';
import {
  confirmedBookings, confirmedOf, keepConfirmed, openRequestOf, sameBooking, sameSlot, settleStatus, type Slot,
} from '../../server/recordAnalysis.js';
import {
  changeConversation, deletedSince, deleteConversation, listConversations, loadForUpdate, NO_DELETION_SEEN, storeConfigured,
  type ChatVersion, type LoadedChat,
} from '../../server/store.js';
import { sendWhatsAppText } from '../../server/whatsappApi.js';
import { sendTelegramText } from '../../server/telegramApi.js';
import { addReply, addSalonMessage, publicConversations, telegramChatId, type LiveConversation, type Translated } from '../../server/whatsappCore.js';
import { chatBookingMessage, type ChatBookingMessageKind } from '../../src/chatTemplates.js';
import { LANGUAGE_NAMES } from '../../src/conversationData.js';
import { zonedDateTime } from '../../src/format.js';
import { initialCompanySettings } from '../../src/mockData.js';

/** Sends a text on the chat's own channel. Website chats read their messages from the storage, so nothing goes out for them. */
async function sendOnChannel(conversation: LiveConversation, text: string) {
  const channel = conversation.channel ?? 'WhatsApp';
  if (channel === 'Website') return;
  // A WhatsApp customer who has not had the fixed first text gets it before this message.
  await sendFirstNoticeIfDue(conversation);
  if (channel === 'Telegram') await sendTelegramText(telegramChatId(conversation.waId), text);
  else await sendWhatsAppText(conversation.waId, text);
}

/**
 * Translates the owner's own text for the customer and sends it on the chat's channel.
 * Returns null, and sends nothing, when the customer deleted the chat while the text was translated.
 */
async function translateAndSend(conversation: LiveConversation, version: ChatVersion, text: string): Promise<Translated | null> {
  const language = conversation.languageLabel ?? LANGUAGE_NAMES[conversation.language];
  let sent: Translated = { original: text, translation: text };
  try {
    const translated = await translateOwnerReply(text, language);
    sent = { original: translated.customerText, translation: translated.translationEn, translationDe: translated.translationDe };
  } catch (error) {
    console.error(error); // Send as written rather than not at all.
  }
  // The translation took a while. A customer who deleted the chat meanwhile gets no message from it.
  if ((conversation.channel ?? 'WhatsApp') !== 'Website' && await deletedSince(conversation.waId, version)) return null;
  await sendOnChannel(conversation, sent.original);
  return sent;
}

/**
 * `expected` on an answer to a request or a cancellation: the day and time of what the owner saw
 * on the card. The customer may have asked for something else since her page last looked; the
 * answer is then refused instead of being applied to a request she never saw. A page of an
 * earlier version sends none and gets the earlier behaviour.
 */
type Action =
  | { type: 'reply'; conversationId: string; text: string }
  | { type: 'take-over'; conversationId: string }
  | { type: 'let-ai-continue'; conversationId: string; answerNow?: boolean }
  | { type: 'mark-done'; conversationId: string }
  | { type: 'confirm-booking'; conversationId: string; staffName?: string; expected?: Expected }
  | { type: 'suggest-time'; conversationId: string; date: string; time: string; staffName?: string; expected?: Expected }
  | { type: 'decline-booking'; conversationId: string; expected?: Expected }
  | { type: 'cancel-booking'; conversationId: string; expected?: Expected }
  | { type: 'keep-booking'; conversationId: string; expected?: Expected }
  | { type: 'delete'; conversationId: string };

const BOOKING_ACTIONS = ['confirm-booking', 'suggest-time', 'decline-booking', 'cancel-booking'] as const;
type BookingAction = Extract<Action, { type: typeof BOOKING_ACTIONS[number] }>;

const CHANGED_REQUEST = 'The customer changed the request in the meantime. Look at it again.';
const CHANGED_CANCELLATION = 'The customer changed the cancellation request in the meantime. Look at it again.';
/** The answers that refuse because the chat moved on: the owner's page asks her to look again. */
const statusOf = (error: string) => error === 'This chat no longer exists' ? 404 : error === CHANGED_REQUEST || error === CHANGED_CANCELLATION ? 409 : 400;

/**
 * What the owner's card showed: the day and time, and from pages of this version also the service,
 * the customer's name and the stylist the customer asked for. The same time for another service
 * or another person is another request.
 */
interface Expected extends Slot { service?: string; customerName?: string; staffName?: string }

/** `expected` as sent: what the card showed, missing (undefined), or something unreadable (null). */
function readExpected(value: unknown): Expected | null | undefined {
  if (value === undefined) return undefined;
  const given = value as { date?: unknown; time?: unknown; service?: unknown; customerName?: unknown; staffName?: unknown } | null;
  const date = strictDate(given?.date);
  const time = strictTime(given?.time);
  if (!date || !time) return null;
  const expected: Expected = { date, time };
  for (const field of ['service', 'customerName', 'staffName'] as const) {
    const part = given?.[field];
    if (part === undefined) continue;
    if (typeof part !== 'string' || part.length > 100) return null;
    expected[field] = part.trim();
  }
  return expected;
}

const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
/**
 * True when what waits is what the owner's card showed. A page of an earlier version names the day
 * and time only, and is compared by those. A page of this version names the service; then the
 * stylist the customer asked for must match too (none named on the card means none asked for).
 */
function shows(expected: Expected, waiting: Slot & { service: string; customerName?: string; staffName?: string }, { stylist = true } = {}) {
  if (!sameSlot(expected, waiting)) return false;
  if (expected.service === undefined) return true;
  return same(expected.service, waiting.service)
    && (expected.customerName === undefined || !waiting.customerName || same(expected.customerName, waiting.customerName))
    && (!stylist || same(expected.staffName, waiting.staffName));
}

/** Every error text here is shown to the owner as it is. */
const fail = (error: string, status = 400) => Response.json({ error }, { status });
/**
 * The customer deleted the chat while the owner's action was on its way. Nothing is stored again.
 * The owner's page shows this text, and its next look at the chats no longer finds this one.
 */
const deletedByCustomer = () => fail('This chat was deleted by the customer.', 410);
const allChats = async () => Response.json({ conversations: publicConversations({ conversations: await listConversations() }) });

/** The stylist the owner named: matched to the team where possible, else her words as they are (cleaned). */
function ownerStylist(value: unknown): { staffName?: string; employeeId?: string } {
  const name = cleanName(value, 60);
  if (!name) return {};
  return matchStylist(name) ?? { staffName: name };
}

/** What an answer to a request or a cancellation found: the message to send, a refusal, or a confirmation that already stands. */
type BookingOutcome = { kind: ChatBookingMessageKind; message: Translated } | { error: string } | { already: true };

/**
 * The owner's answer to a booking request or a cancellation: what changes in the chat and the
 * fixed message the customer gets (src/chatTemplates.ts, never written or translated by the AI).
 */
function bookingAnswer(chat: LiveConversation, action: BookingAction, expected: Expected | undefined, now: number): BookingOutcome {
  const details = { language: chat.language, salonName: initialCompanySettings.companyName };
  const today = new Date(now);
  if (action.type === 'cancel-booking') {
    const cancellation = chat.cancellationRequest;
    if (!cancellation) return { error: 'There is no cancellation request in this chat.' };
    if (expected && !shows(expected, cancellation, { stylist: false })) return { error: CHANGED_CANCELLATION };
    const all = confirmedBookings(chat);
    const cancelled = all.find(booking => sameBooking(booking, cancellation));
    const customerName = cancelled?.customerName ?? cancellation.customerName ?? confirmedOf(chat)?.customerName ?? chat.customerName.split(/\s+/)[0] ?? '';
    const message = chatBookingMessage('cancelled', { ...details, customerName, serviceName: cancellation.service, date: cancellation.date, time: cancellation.time });
    chat.cancellationRequest = undefined;
    // A change of the cancelled appointment goes with it; a request for another appointment stays.
    const open = openRequestOf(chat);
    if (open?.kind === 'change' && (!open.previous || sameSlot(open.previous, cancellation))) chat.bookingRequest = undefined;
    // Only the cancelled appointment goes: the others of this chat stay known.
    keepConfirmed(chat, all.filter(booking => booking !== cancelled), today);
    if (!openRequestOf(chat)) chat.bookingRequest = chat.confirmedBooking;
    settleStatus(chat, today);
    return { kind: 'cancelled', message };
  }

  const open = openRequestOf(chat);
  if (!open) {
    // The owner's page asks again for exactly the appointment that stands: its first answer got
    // lost on the way back. Nothing is sent twice; her page can now put it into the calendar.
    // The stylist is not compared here: the owner may have given the appointment to another one on confirming.
    if (action.type === 'confirm-booking' && expected && confirmedBookings(chat).some(booking => shows(expected, booking, { stylist: false }))) return { already: true };
    return { error: confirmedOf(chat) ? 'This booking is already confirmed.' : 'There is no open booking request in this chat.' };
  }
  if (expected && !shows(expected, open)) return { error: CHANGED_REQUEST };
  const asked = { ...details, customerName: open.customerName, serviceName: open.service };
  // What stands once the request is answered without a booking: the appointment confirmed before, if any.
  const restore = () => { chat.bookingRequest = chat.confirmedBooking; };

  if (action.type === 'confirm-booking') {
    const stylist = ownerStylist(action.staffName);
    const message = chatBookingMessage('confirmed', { ...asked, staffName: stylist.staffName, date: open.date, time: open.time });
    // A change keeps `kind` and `previous`, so the owner's calendar knows which appointment moves.
    const confirmed = { ...open, ...stylist, status: 'confirmed' as const };
    let bookings = confirmedBookings(chat);
    if (open.kind === 'change' && open.previous) {
      const from = open.previous;
      // The moved appointment is now at the new time; a wish to cancel it at the old time has nothing left to point at.
      // Only the one appointment that moves: another one at the same time (a second person) stays.
      const moved = bookings.findIndex(booking => sameSlot(booking, from));
      if (moved >= 0) bookings = bookings.filter((_, index) => index !== moved);
      if (chat.cancellationRequest && sameSlot(chat.cancellationRequest, from)) chat.cancellationRequest = undefined;
    }
    keepConfirmed(chat, [...bookings, confirmed], today);
    chat.bookingRequest = confirmed;
    chat.suggestion = undefined;
    settleStatus(chat, today);
    return { kind: 'confirmed', message };
  }
  if (action.type === 'suggest-time') {
    const date = strictDate(action.date);
    const time = strictTime(action.time);
    if (!date || !time) return { error: 'Choose a valid day and time to suggest.' };
    if (date < zonedDateTime(today, 'Europe/Zurich').date) return { error: 'That day is in the past. Choose another day.' };
    const stylist = ownerStylist(action.staffName);
    const message = chatBookingMessage('suggested', { ...asked, staffName: stylist.staffName, date, time, askedDate: open.date, askedTime: open.time });
    // The AI is told about the offer: the customer's "yes" becomes a new request for exactly this
    // time. An offer instead of a change remembers which appointment it moves.
    chat.suggestion = {
      service: open.service, ...(open.serviceId ? { serviceId: open.serviceId } : {}), date, time, ...stylist,
      ...(open.kind === 'change' && open.previous ? { kind: 'change' as const, previous: open.previous } : {}),
    };
    restore();
    settleStatus(chat, today);
    return { kind: 'suggested', message };
  }
  const message = chatBookingMessage('declined', { ...asked, date: open.date, time: open.time });
  chat.suggestion = undefined;
  restore();
  settleStatus(chat, today);
  return { kind: 'declined', message };
}

/** The parts of a chat an answer to a request or a cancellation changes, and that are put back when its message could not be sent. */
const ANSWERED_FIELDS = ['bookingRequest', 'confirmedBooking', 'earlierBookings', 'cancellationRequest', 'suggestion', 'status', 'attentionReason', 'requestFacts'] as const;
type AnsweredFields = Pick<LiveConversation, typeof ANSWERED_FIELDS[number]>;
// Through JSON, as the storage keeps it: a field set to undefined then reads the same as one that is missing.
const answeredFields = (chat: LiveConversation): AnsweredFields =>
  JSON.parse(JSON.stringify(Object.fromEntries(ANSWERED_FIELDS.map(field => [field, chat[field]])))) as AnsweredFields;

/** The owner's actions on a live chat (contract 2 of delivery 2C). */
export async function POST(request: Request) {
  const access = await ownerAccess(request);
  if (access !== 'ok') return ownerRefusal(access, fail);
  if (!storeConfigured()) return fail('Storage is not configured', 500);

  let action: Action;
  try { action = (await request.json()) as Action; } catch { return fail('Bad request'); }
  if (!action || typeof action !== 'object') return fail('Bad request');

  const expected = readExpected((action as { expected?: unknown }).expected);
  if (expected === null) return fail('This answer could not be read. Reload the page and try again.');

  const waId = typeof action.conversationId === 'string' && action.conversationId.startsWith('live-') ? action.conversationId.slice(5) : '';
  const loaded: LoadedChat = waId ? await loadForUpdate(waId) : { conversation: null, version: NO_DELETION_SEEN };
  const conversation = loaded.conversation;
  if (!conversation) return fail('This chat no longer exists', 404);
  const now = Date.now();

  if (action.type === 'delete') {
    await deleteConversation(conversation.waId);
    return allChats();
  }

  /**
   * Applies `change` to the chat as it is now (read again if somebody saved it meanwhile) and
   * saves it. `change` returns an error sentence to stop without saving.
   */
  const apply = async (change: (chat: LiveConversation) => string | null, from: LoadedChat = loaded) => {
    let error: string | null = null;
    const outcome = await changeConversation(from, chat => {
      error = chat ? change(chat) : 'This chat no longer exists';
      return { conversation: error ? null : chat, value: null };
    }, now);
    return { outcome, error: error as string | null };
  };

  if (action.type === 'take-over' || action.type === 'mark-done' || action.type === 'keep-booking' || (action.type === 'let-ai-continue' && !action.answerNow)) {
    const kind = action.type;
    const { outcome, error } = await apply(chat => {
      if (kind === 'take-over') chat.takenOver = true;
      else if (kind === 'mark-done') {
        // Nothing is sent. What the owner still has to answer (a request, a wish to cancel) keeps
        // the chat in "Needs you"; anything else is done.
        settleStatus(chat, new Date(now));
      } else if (kind === 'keep-booking') {
        if (!chat.cancellationRequest) return 'There is no cancellation request in this chat.';
        if (expected && !shows(expected, chat.cancellationRequest, { stylist: false })) return CHANGED_CANCELLATION;
        // The appointment stands. The owner writes to the customer herself, so the AI waits.
        chat.cancellationRequest = undefined;
        chat.takenOver = true;
        settleStatus(chat, new Date(now));
      } else {
        // The AI answers again, but a card that waits still waits for the owner: the chat stays in "Needs you" with its reason.
        chat.takenOver = false;
        settleStatus(chat, new Date(now));
      }
      return null;
    });
    if (outcome.status === 'deleted') return deletedByCustomer();
    if (error) return fail(error, statusOf(error));
    return allChats();
  }

  if (action.type === 'let-ai-continue') {
    // With the day's AI answers used up the AI cannot answer now: the chat stays with the owner as
    // it is, and she reads why. Counted only when a customer's message waits for an answer.
    if (conversation.messages.at(-1)?.sender === 'customer' && await aiCeilingReached(now)) return fail(LIMIT_TEXTS.aiCeiling, 429);
    // Hand the chat back first, then let the AI answer the customer's waiting message at once.
    const { outcome } = await apply(chat => {
      chat.takenOver = false;
      settleStatus(chat, new Date(now));
      return null;
    });
    if (outcome.status === 'deleted') return deletedByCustomer();
    if (outcome.status !== 'saved' || !outcome.conversation) return fail('This chat no longer exists', 404);
    const waiting = outcome.conversation.messages.at(-1);
    if (!waiting || waiting.sender !== 'customer') return allChats(); // nothing waits for an answer
    const saved: Saved = { loaded: outcome.loaded, conversation: outcome.conversation };
    const analysis = await askAi(saved.conversation, waiting.id, now);
    const website = (saved.conversation.channel ?? 'WhatsApp') === 'Website';
    const answered = await applyAi(saved, waiting.id, analysis, website, now);
    if (!answered) return deletedByCustomer();
    if (!analysis) return fail('The AI could not answer just now. The chat is back with the AI: reply yourself, or try again.', 502);
    if (!website && answered.reply) {
      const noticeBefore = answered.conversation.noticeSent;
      let delivered = false;
      try {
        await sendOnChannel(answered.conversation, answered.reply.original);
        delivered = true;
      } catch (error) {
        console.error(error);
      }
      await recordDelivery(answered, answered.reply, delivered, Boolean(answered.conversation.noticeSent && !noticeBefore), now);
      if (!delivered) return fail(`${answered.conversation.channel ?? 'WhatsApp'} did not accept the AI's answer. Reply yourself, or try again.`, 502);
    }
    return allChats();
  }

  if (action.type === 'reply') {
    const text = typeof action.text === 'string' ? action.text.trim() : '';
    if (!text) return fail('The reply is empty');
    const noticeBefore = conversation.noticeSent;
    let sent: Translated | null;
    try {
      sent = await translateAndSend(conversation, loaded.version, text);
    } catch (error) {
      console.error(error);
      // The fixed first text of a WhatsApp chat may have gone out although the reply did not: the chat remembers it.
      if (conversation.noticeSent && !noticeBefore) await apply(chat => { chat.noticeSent = true; return null; }).catch(saveError => console.error(saveError));
      return fail(`${conversation.channel ?? 'WhatsApp'} did not accept the message. Check the bot or token settings in Vercel.`, 502);
    }
    if (!sent) return deletedByCustomer();
    const reply = sent;
    const { outcome } = await apply(chat => {
      if (conversation.noticeSent) chat.noticeSent = true;
      addReply(chat, 'owner', reply, now);
      return null;
    });
    return outcome.status === 'deleted' ? deletedByCustomer() : allChats();
  }

  if ((BOOKING_ACTIONS as readonly string[]).includes(action.type)) {
    const bookingAction = action as BookingAction;
    // The answer is saved first and sent after: two owner tabs answering at once then cannot both
    // send it, as the second finds the request already answered. If the messenger refuses the
    // message, the answer is taken back, so the chat never shows a message that did not go out.
    let before: AnsweredFields | null = null;
    let after: AnsweredFields | null = null;
    let message: Translated | null = null;
    let messageId = '';
    let already = false;
    const { outcome, error } = await apply(chat => {
      before = answeredFields(chat);
      const answer = bookingAnswer(chat, bookingAction, expected, now);
      if ('error' in answer) return answer.error;
      if ('already' in answer) { already = true; return null; }
      message = answer.message;
      messageId = addSalonMessage(chat, answer.message, now);
      after = answeredFields(chat);
      return null;
    });
    if (outcome.status === 'deleted') return deletedByCustomer();
    if (error) return fail(error, statusOf(error));
    if (already) return allChats();
    if (outcome.status !== 'saved' || !outcome.conversation || !message) return fail('This chat no longer exists', 404);
    const saved = outcome.conversation;
    const noticeBefore = saved.noticeSent;
    try {
      await sendOnChannel(saved, (message as Translated).original);
    } catch (error) {
      console.error(error);
      const noticeSent = Boolean(saved.noticeSent && !noticeBefore);
      const taken = before as AnsweredFields | null;
      const written = after as AnsweredFields | null;
      await apply(chat => {
        // The message that did not go out leaves the chat in any case.
        const index = chat.messages.findIndex(item => item.id === messageId);
        if (index >= 0) chat.messages.splice(index, 1);
        // Only what still holds the answer's values is put back. What changed since (a new
        // request the customer sent while the messenger was asked) is newer and stays.
        let kept = false;
        if (taken && written) {
          for (const field of ANSWERED_FIELDS) {
            if (isDeepStrictEqual(chat[field], written[field])) Object.assign(chat, { [field]: taken[field] });
            else kept = true;
          }
        }
        if (kept) settleStatus(chat, new Date(now));
        if (noticeSent) chat.noticeSent = true;
        return null;
      }, outcome.loaded).catch(saveError => console.error(saveError));
      return fail(`${saved.channel ?? 'WhatsApp'} did not accept the message, so the customer was not told. Try again.`, 502);
    }
    if (saved.noticeSent && !noticeBefore) {
      await apply(chat => { chat.noticeSent = true; return null; }, outcome.loaded).catch(saveError => console.error(saveError));
    }
    return allChats();
  }

  return fail('Unknown action');
}
