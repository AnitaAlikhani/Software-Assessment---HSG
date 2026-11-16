import { createHmac, timingSafeEqual } from 'node:crypto';
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
}

export interface LiveBookingRequest {
  service: string;
  date: string;
  time: string;
  customerName: string;
  status: 'requested' | 'confirmed';
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

const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });

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
  conversation.messages.push({ id: `${sender}-${now}`, sender, time: timeLabel(now), ...message });
  conversation.updatedAt = now;
  if (sender === 'owner') {
    conversation.takenOver = true;
    conversation.status = 'owner-handled';
    conversation.attentionReason = undefined;
  }
}

export function needsOwner(conversation: LiveConversation, reason: string) {
  conversation.status = 'needs-attention';
  conversation.attentionReason = reason;
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || 'WA';

export const liveId = (waId: string) => `live-${waId}`;

/** What the website receives. The customer's number is shortened, so it is never shown in full. */
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
    phone: channel === 'Website' ? 'Test visitor' : channel === 'Telegram' ? 'Telegram user' : `+${conversation.waId.slice(0, 2)} ••• ••• ${conversation.waId.slice(-2)}`,
    channel,
    status: conversation.status,
    attentionReason: conversation.attentionReason,
    takenOver: conversation.takenOver,
    lastTime: conversation.messages.at(-1)?.time ?? '',
    messages: conversation.messages,
    bookingRequest: conversation.bookingRequest,
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
