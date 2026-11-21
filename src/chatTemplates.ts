import { answerText, cancelledText } from './customerTexts.js';
import type { ChatLanguage, ChatMessage } from './types.js';

/**
 * The fixed messages a customer gets in a chat about their booking: confirmed, another time
 * suggested, declined, cancelled.
 *
 * They are fixed sentences, not written or translated by the AI at that moment: the salon must be
 * able to rely on every word of a confirmation. The server sends them in live chats and the
 * sample chats use the same ones, so both read alike. A chat in a language the texts do not have
 * gets the English one.
 */
export type ChatBookingMessageKind = 'confirmed' | 'suggested' | 'declined' | 'cancelled';

export interface ChatBookingMessageDetails {
  language: ChatLanguage;
  customerName: string;
  /** The salon's name. Left out of the sentence when it is empty. */
  salonName: string;
  serviceName: string;
  /** Left out of the sentence when nobody is named. */
  staffName?: string;
  /** The time the message is about: the confirmed one, the suggested one, the declined one, the cancelled one. */
  date: string;
  time: string;
  /** For a suggestion: the time the customer had asked for. */
  askedDate?: string;
  askedTime?: string;
}

const inLanguage = (kind: ChatBookingMessageKind, details: ChatBookingMessageDetails, language: ChatLanguage): string => {
  const base = { language, customerName: details.customerName, salonName: details.salonName, serviceName: details.serviceName, staffName: details.staffName, date: details.date, startTime: details.time };
  if (kind === 'cancelled') return cancelledText(base);
  if (kind === 'suggested') return answerText({ ...base, outcome: 'moved', askedDate: details.askedDate ?? details.date, askedStartTime: details.askedTime ?? details.time });
  return answerText({ ...base, outcome: kind === 'confirmed' ? 'accepted' : 'rejected' });
};

/** The message in the customer's language, with the same text in English and German for the owner's screen. */
export function chatBookingMessage(kind: ChatBookingMessageKind, details: ChatBookingMessageDetails): Pick<ChatMessage, 'original' | 'translation' | 'translationDe'> {
  return {
    original: inLanguage(kind, details, details.language),
    translation: inLanguage(kind, details, 'EN'),
    translationDe: inLanguage(kind, details, 'DE'),
  };
}
