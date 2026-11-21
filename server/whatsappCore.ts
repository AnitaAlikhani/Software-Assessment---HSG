import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { formatClock } from '../src/format.js';
import type { ChatLanguage, ChatMessage, Conversation, ConversationStatus } from '../src/types.js';

/** One WhatsApp chat as the server keeps it. The phone number never leaves the server. */
export type LiveChannel = 'WhatsApp' | 'Website' | 'Telegram';

export interface LiveConversation {
  /** WhatsApp ID of the customer (phone number, no "+"), or "web-<session>" for the website chat. */
  waId: string;
  /** Missing on chats saved before the website chat existed: those are WhatsApp. */
  channel?: LiveChannel;
  customerName: string;
  language: ChatLanguage;
  /** Language as the AI detected it, e.g. "Spanish", when it is not one of the demo languages. */
  languageLabel?: string;
  status: ConversationStatus;
  takenOver: boolean;
  attentionReason?: string;
  messages: ChatMessage[];
  updatedAt: number;
  /** A complete booking request the AI collected, waiting for the owner, or already confirmed. */
  bookingRequest?: LiveBookingRequest;
  /**
   * The customer asked to cancel the appointment confirmed in this chat. The owner decides
   * ('cancel-booking' or 'keep-booking'); until then the appointment stands.
   */
  cancellationRequest?: { service: string; date: string; time: string; customerName?: string };
  /**
   * Server only: the appointment confirmed in this chat. `bookingRequest` shows a change or a
   * further request while one is open; this keeps the appointment that stands until the owner
   * answers, so declining a change gives it back. Missing on chats confirmed before it existed:
   * there a confirmed `bookingRequest` is the appointment.
   */
  confirmedBooking?: LiveBookingRequest;
  /**
   * Server only: further appointments confirmed in this chat before `confirmedBooking`. A customer
   * may book twice in one chat; each one stays known, so a later wish to cancel or move is never
   * pinned on the wrong one. Appointments in the past are dropped from it when the chat changes.
   */
  earlierBookings?: LiveBookingRequest[];
  /**
   * Server only: another time the owner offered ('suggest-time'). The AI is told, so the customer's
   * "yes" becomes a request for exactly this time. An offer made in answer to a change keeps `kind`
   * and `previous`, so the "yes" moves that appointment instead of booking a second one.
   */
  suggestion?: { service: string; serviceId?: string; date: string; time: string; employeeId?: string; staffName?: string; kind?: 'new' | 'change'; previous?: { date: string; time: string } };
  /**
   * Server only: what the rule check found about the open request that cannot be read from the chat
   * later (a stylist not on the team; a move of an appointment not booked here). The owner's reason
   * is written from these and the chat as it is (requestReason in recordAnalysis.ts).
   */
  requestFacts?: { unknownStylist?: string; moveNotHere?: boolean };
  /** Server only: counts the saves of this chat, so two requests cannot overwrite each other (see changeConversation in store.ts). */
  rev?: number;
  /**
   * WhatsApp only: the fixed first text (who answers, what is stored) has really been sent to this
   * customer. Set after the send succeeded, never before, so a failed send is tried again.
   */
  noticeSent?: boolean;
}

export interface LiveBookingRequest {
  service: string;
  /** Id of the service in the salon's list. Missing on requests stored before ids were kept. */
  serviceId?: string;
  date: string;
  time: string;
  customerName: string;
  status: 'requested' | 'confirmed';
  /** The stylist the customer asked for (or the owner named on confirming): the id in the salon's list and the full name. */
  employeeId?: string;
  staffName?: string;
  /** 'change': move the appointment confirmed in this chat, which was at `previous`, to this time. */
  kind?: 'new' | 'change';
  previous?: { date: string; time: string };
}

export interface LiveState {
  conversations: LiveConversation[];
  /** WhatsApp message IDs already handled. Meta resends a webhook if we answer slowly. */
  processedIds: string[];
}

export interface IncomingMessage {
  id: string;
  waId: string;
  name: string;
  text: string;
  timestamp: number;
  channel?: LiveChannel;
}

export const emptyState = (): LiveState => ({ conversations: [], processedIds: [] });

const KNOWN: ChatLanguage[] = ['EN', 'FR', 'DE', 'IT'];
export const toChatLanguage = (code: string | undefined): ChatLanguage => {
  const upper = (code ?? '').trim().slice(0, 2).toUpperCase();
  return (KNOWN as string[]).includes(upper) ? (upper as ChatLanguage) : 'EN';
};

/** Meta signs every webhook with the app secret. Reject anything that does not match. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const given = header.slice('sha256='.length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

/** Text messages from a WhatsApp Cloud API webhook. Status updates and media are ignored. */
export function parseWebhook(body: unknown): IncomingMessage[] {
  const result: IncomingMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return result;
  for (const entry of entries as { changes?: { value?: Record<string, unknown> }[] }[]) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const contacts = (value.contacts as { wa_id?: string; profile?: { name?: string } }[] | undefined) ?? [];
      const messages = (value.messages as { id?: string; from?: string; type?: string; timestamp?: string; text?: { body?: string } }[] | undefined) ?? [];
      for (const message of messages) {
        if (message.type !== 'text' || !message.id || !message.from || !message.text?.body) continue;
        const contact = contacts.find(item => item.wa_id === message.from);
        result.push({
          id: message.id,
          waId: message.from,
          name: contact?.profile?.name?.trim() || 'WhatsApp customer',
          text: message.text.body,
          timestamp: Number(message.timestamp ?? 0) * 1000 || Date.now(),
        });
      }
    }
  }
  return result;
}

/** The time under a message, on the salon's clock and in 24 hours: "14:05". */
const timeLabel = (ms: number) => formatClock(ms, 'Europe/Zurich');

export interface Translated {
  original: string;
  translation: string;
  translationDe?: string;
}

export function addCustomerMessage(
  state: LiveState,
  incoming: IncomingMessage,
  translated: Translated,
  language: ChatLanguage,
  languageLabel?: string,
): LiveConversation {
  let conversation = state.conversations.find(item => item.waId === incoming.waId);
  if (!conversation) {
    conversation = {
      waId: incoming.waId,
      channel: incoming.channel ?? 'WhatsApp',
      customerName: incoming.name,
      language,
      status: 'ai-handled',
      takenOver: false,
      messages: [],
      updatedAt: incoming.timestamp,
    };
    state.conversations.push(conversation);
  }
  conversation.customerName = incoming.name;
  conversation.language = language;
  conversation.languageLabel = languageLabel;
  conversation.messages.push({ id: incoming.id, sender: 'customer', time: timeLabel(incoming.timestamp), ...translated });
  conversation.updatedAt = incoming.timestamp;
  state.processedIds = [...state.processedIds, incoming.id].slice(-500);
  return conversation;
}

export function addReply(conversation: LiveConversation, sender: 'ai' | 'owner', message: Translated, now = Date.now()) {
  // A random tail: two replies within the same millisecond (or a frozen clock) still get their own ids.
  conversation.messages.push({ id: `${sender}-${now}-${randomUUID().slice(0, 8)}`, sender, time: timeLabel(now), ...message });
  conversation.updatedAt = now;
  if (sender === 'owner') {
    conversation.takenOver = true;
    conversation.status = 'owner-handled';
    conversation.attentionReason = undefined;
  }
}

/**
 * A fixed message from the salon about a booking (confirmed, another time, declined, cancelled).
 * Unlike an owner's own reply it does not pause the AI. Returns the message id.
 */
export function addSalonMessage(conversation: LiveConversation, message: Translated, now = Date.now()): string {
  const id = `owner-${now}-${randomUUID().slice(0, 8)}`;
  conversation.messages.push({ id, sender: 'owner', time: timeLabel(now), ...message });
  conversation.updatedAt = now;
  return id;
}

export function needsOwner(conversation: LiveConversation, reason: string) {
  conversation.status = 'needs-attention';
  conversation.attentionReason = reason;
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || 'WA';

export const liveId = (waId: string) => `live-${waId}`;

/**
 * What the website receives. A WhatsApp number is shortened, so it is never shown in full.
 * Website and Telegram chats have no number: the field stays empty rather than carrying a label,
 * because whatever stands here could end up in a customer record.
 */
export function toPublicConversation(conversation: LiveConversation): Conversation & { live: true; languageLabel?: string } {
  const channel = conversation.channel ?? 'WhatsApp';
  return {
    id: liveId(conversation.waId),
    live: true,
    customerName: conversation.customerName,
    initials: initials(conversation.customerName),
    avatarColor: 'bg-green-100 text-green-700',
    language: conversation.language,
    languageLabel: conversation.languageLabel,
    phone: channel === 'WhatsApp' ? `+${conversation.waId.slice(0, 2)} ••• ••• ${conversation.waId.slice(-2)}` : '',
    channel,
    status: conversation.status,
    attentionReason: conversation.attentionReason,
    takenOver: conversation.takenOver,
    lastTime: conversation.messages.at(-1)?.time ?? '',
    // The list works its label out from this, so a chat from another day shows the day, not only a clock time.
    lastMessageAt: new Date(conversation.updatedAt).toISOString(),
    messages: conversation.messages,
    bookingRequest: conversation.bookingRequest,
    cancellationRequest: conversation.cancellationRequest,
  };
}

export const publicConversations = (state: Pick<LiveState, 'conversations'>) =>
  [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(toPublicConversation);

/** A working copy that holds just one chat, for code that loads and saves chats one by one. */
export const stateFor = (conversation: LiveConversation | null): LiveState =>
  ({ conversations: conversation ? [conversation] : [], processedIds: [] });

/** What the visitor sees in the website chat: their own words and the replies in their language. */
export interface VisitorMessage {
  id: string;
  from: 'me' | 'salon';
  text: string;
  time: string;
}

export const visitorMessages = (conversation: LiveConversation | undefined): VisitorMessage[] =>
  (conversation?.messages ?? []).map(message => ({
    id: message.id,
    from: message.sender === 'customer' ? 'me' : 'salon',
    text: message.original,
    time: message.time,
  }));

/**
 * Who answers the website visitor now: the AI assistant, or the salon's team once the owner has
 * taken the chat over. The visitor's page shows it, so nobody waits for an instant answer that
 * will not come.
 */
export type AnsweredBy = 'assistant' | 'team';
export const answeredBy = (conversation: LiveConversation | null | undefined): AnsweredBy => conversation?.takenOver ? 'team' : 'assistant';

export const webChatId = (sessionId: string) => `web-${sessionId}`;
export const isValidSessionId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9]{12,40}$/.test(value);

/** Text messages from a Telegram webhook update. Commands like /start are returned with isCommand. */
export function parseTelegramUpdate(body: unknown): (IncomingMessage & { isCommand: boolean; languageCode?: string }) | null {
  const update = body as {
    update_id?: number;
    message?: { message_id?: number; date?: number; text?: string; chat?: { id?: number; type?: string }; from?: { first_name?: string; last_name?: string; language_code?: string; is_bot?: boolean } };
  };
  const message = update?.message;
  if (typeof update?.update_id !== 'number' || !message?.text || message.chat?.id === undefined) return null;
  if (message.chat.type && message.chat.type !== 'private') return null; // only one-to-one chats
  if (message.from?.is_bot) return null;
  const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ').trim() || 'Telegram customer';
  return {
    id: `tg-${update.update_id}`,
    waId: `tg-${message.chat.id}`,
    name,
    text: message.text,
    timestamp: Number(message.date ?? 0) * 1000 || Date.now(),
    channel: 'Telegram',
    isCommand: message.text.trim().startsWith('/'),
    languageCode: message.from?.language_code,
  };
}

/** The Telegram chat ID stored in a conversation key like "tg-12345". */
export const telegramChatId = (waId: string) => waId.slice(3);
