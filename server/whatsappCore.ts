import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChatLanguage, ChatMessage, Conversation, ConversationStatus } from '../src/types';

/** One WhatsApp chat as the server keeps it. The phone number never leaves the server. */
export interface LiveConversation {
  /** WhatsApp ID of the customer (their phone number in international format, no "+"). */
  waId: string;
  customerName: string;
  language: ChatLanguage;
  /** Language as the AI detected it, e.g. "Spanish", when it is not one of the demo languages. */
  languageLabel?: string;
  status: ConversationStatus;
  takenOver: boolean;
  attentionReason?: string;
  messages: ChatMessage[];
  updatedAt: number;
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
  return {
    id: liveId(conversation.waId),
    live: true,
    customerName: conversation.customerName,
    initials: initials(conversation.customerName),
    avatarColor: 'bg-green-100 text-green-700',
    language: conversation.language,
    languageLabel: conversation.languageLabel,
    phone: `+${conversation.waId.slice(0, 2)} ••• ••• ${conversation.waId.slice(-2)}`,
    channel: 'WhatsApp',
    status: conversation.status,
    attentionReason: conversation.attentionReason,
    takenOver: conversation.takenOver,
    lastTime: conversation.messages.at(-1)?.time ?? '',
    messages: conversation.messages,
  };
}

export const publicConversations = (state: LiveState) =>
  [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(toPublicConversation);
