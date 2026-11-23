import type { AiAssistantSettings, CalendarEvent, ChatLanguage, ChatMessage, Conversation } from './types';
import { conversationsWaiting } from './analytics';
import { LANGUAGE_NAMES, scriptedGerman } from './conversationData';
import { appointmentForConversation } from './appointmentActions';
import { getSalonNow } from './scheduling';

export const ownerLanguageName = (settings: Pick<AiAssistantSettings, 'ownerLanguage'>) =>
  settings.ownerLanguage === 'German' ? 'German' : 'English';

/**
 * The language a chat is written in, by name. A live chat can be in any language and carries the
 * name the AI detected ("Spanish"); its language code falls back to English for everything unknown.
 */
const chatLanguageName = (conversation: Pick<Conversation, 'language' | 'live' | 'languageLabel'>): string =>
  (conversation.live && conversation.languageLabel?.trim()) || LANGUAGE_NAMES[conversation.language] || conversation.language;

/** True when the owner reads the language the chat is written in (the owner's language is set on the AI receptionist page). */
export const ownerReadsChatLanguage = (
  conversation: Pick<Conversation, 'language' | 'live' | 'languageLabel'>, settings: Pick<AiAssistantSettings, 'ownerLanguage'>,
): boolean => chatLanguageName(conversation).toLowerCase() === ownerLanguageName(settings).toLowerCase();

/**
 * Whether a chat shows that it is translated (the "Translated from ..." line): only when
 * translation is on and the owner does not read the chat's language. A German chat needs no
 * translation for an owner who reads German, an English one none for an owner who reads English.
 */
export const showsTranslation = (
  conversation: Pick<Conversation, 'language' | 'live' | 'languageLabel'>, settings: Pick<AiAssistantSettings, 'translateChats' | 'ownerLanguage'>,
): boolean => settings.translateChats && !ownerReadsChatLanguage(conversation, settings);

/** How the appointment of a chat came about. */
export type ChatBookingOrigin = 'ai' | 'owner' | 'hand';

const ORIGIN_LABELS: Record<ChatBookingOrigin, string> = {
  ai: 'Booked by the AI',
  owner: 'Confirmed by you',
  hand: 'Booked by you',
};

/** The appointment as this file reads it; its id says whether Confirm made it. */
type OriginAppointment = Pick<CalendarEvent, 'isAiBooked' | 'conversationId'> & { id?: string };

/**
 * How the appointment of a chat came about: the owner confirmed the AI's request in the chat,
 * the AI booked it on its own, or the owner booked it by hand from the chat ("Book"). A linked
 * appointment that is not the one the chat names, not one Confirm made (its id starts with
 * "live-appt-") and not the AI's was booked by hand: nothing about it was told to the customer,
 * so it is never called confirmed. Null when there is no appointment, or it is no longer the chat's own.
 */
export function chatBookingOrigin(
  conversation: Pick<Conversation, 'id' | 'bookingRequest'> & Partial<Pick<Conversation, 'appointmentId'>>,
  appointment: OriginAppointment | null | undefined,
): ChatBookingOrigin | null {
  if (!appointment || (appointment.conversationId !== undefined && appointment.conversationId !== conversation.id)) return null;
  if (appointment.conversationId === conversation.id && appointment.id !== undefined && appointment.id !== conversation.appointmentId
    && !appointment.id.startsWith('live-appt-') && !appointment.isAiBooked) return 'hand';
  if (conversation.bookingRequest?.status === 'confirmed') return 'owner';
  if (appointment.isAiBooked) return 'ai';
  return appointment.conversationId === conversation.id ? 'owner' : null;
}

/**
 * The same in words, for the line in the chat. An appointment whose request the AI took and the
 * owner confirmed is both: Home and the calendar count it as "Booked by the AI", so the chat says
 * that too and adds who confirmed it, instead of seeming to contradict them.
 */
export const chatBookingOriginLabel = (
  conversation: Pick<Conversation, 'id' | 'bookingRequest'> & Partial<Pick<Conversation, 'appointmentId'>>,
  appointment: OriginAppointment | null | undefined,
): string | null => {
  const origin = chatBookingOrigin(conversation, appointment);
  if (!origin) return null;
  return origin === 'owner' && appointment?.isAiBooked ? `${ORIGIN_LABELS.ai} · confirmed by you` : ORIGIN_LABELS[origin];
};

/**
 * A chat belongs under "Booked" when an appointment in the calendar came out of it, whatever
 * happened in the chat afterwards. With the salon's calendar at hand that appointment must be in
 * it: a chat whose appointment was cancelled in the calendar is booked no longer. Without the
 * calendar (a test, a screen that has none) the chat's own record counts: its status, the
 * appointment it names, or its confirmed request.
 */
const hasBooking = (conversation: Conversation, events?: CalendarEvent[]): boolean => events
  ? appointmentForConversation(conversation, events) !== null
  : conversation.status === 'booked' || Boolean(conversation.appointmentId) || conversation.bookingRequest?.status === 'confirmed';

/**
 * The status a chat shows in the list. A chat stored as booked whose appointment is no longer in
 * the calendar shows "You handled": it is not booked any more, and nothing waits in it.
 */
export function shownStatus(conversation: Conversation, events?: CalendarEvent[]): Conversation['status'] {
  if (conversation.status === 'booked' && events && appointmentForConversation(conversation, events) === null) return 'owner-handled';
  return conversation.status;
}

/** The filters above the chat list. */
export type ConversationFilter = 'all' | 'needs' | 'booked';

/**
 * The chats a filter shows: all of them, those in which a customer waits for the owner (the
 * rule behind every "waiting for you" count), or those with an appointment that was booked in them.
 */
export function conversationsInFilter(conversations: Conversation[], filter: ConversationFilter, events?: CalendarEvent[]): Conversation[] {
  if (filter === 'needs') return conversationsWaiting(conversations);
  if (filter === 'booked') return conversations.filter((conversation) => hasBooking(conversation, events));
  return conversations;
}

/**
 * A confirmed booking whose appointment is not in the calendar (cancelled there since), while its
 * time is still ahead: the customer holds a confirmation the calendar does not know of. Null
 * otherwise; a time that has passed is history and needs nothing.
 */
export function confirmedButMissing(
  conversation: Conversation, events: CalendarEvent[], now: Date, timeZone?: string,
): NonNullable<Conversation['bookingRequest']> | null {
  const booking = conversation.bookingRequest;
  if (booking?.status !== 'confirmed' || appointmentForConversation(conversation, events) !== null) return null;
  const clock = getSalonNow(timeZone, now);
  return `${booking.date} ${booking.time}` > `${clock.date} ${clock.time}` ? booking : null;
}

export function conversationForSelection(conversations: Conversation[], selectedId: string | null): Conversation | null {
  return selectedId === null ? conversations[0] ?? null : conversations.find(item => item.id === selectedId) ?? null;
}

export function messageForOwner(
  message: Pick<ChatMessage, 'original' | 'translation' | 'untranslated'> & { translationDe?: string },
  sourceLanguage: ChatLanguage,
  settings: Pick<AiAssistantSettings, 'translateChats' | 'ownerLanguage'>,
) {
  const original = { text: message.original, showOriginal: false, translationUnavailable: false };
  if (!settings.translateChats) return original;
  if (message.untranslated) return { ...original, translationUnavailable: true };
  const language = ownerLanguageName(settings);
  if (language === 'German' && sourceLanguage === 'DE') return original;
  // Messages carry their own German text. A suggested reply is shown before it becomes a message,
  // so its German is looked up among the sample texts. Free text is never machine-translated here.
  const translated = language === 'German' ? message.translationDe ?? scriptedGerman(message.translation) : message.translation;
  if (!translated) return { ...original, translationUnavailable: true };
  return { text: translated, showOriginal: translated !== message.original, translationUnavailable: false };
}
