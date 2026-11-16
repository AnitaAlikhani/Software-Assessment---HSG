import type { IncomingAnalysis } from './ai.js';
import { bookingDateLabel, validBookingRequest } from './bookingRules.js';
import {
  addCustomerMessage,
  needsOwner,
  toChatLanguage,
  type IncomingMessage,
  type LiveConversation,
  type LiveState,
} from './whatsappCore.js';

/**
 * Saves a customer message with the AI's translation, applies the handover rules and a complete
 * booking request. Returns the conversation and the AI reply to send, or null when the owner has
 * taken over. Call addReply only after the channel has really sent the reply.
 */
export function recordAnalysis(state: LiveState, incoming: IncomingMessage, analysis: IncomingAnalysis, now = new Date()) {
  const conversation: LiveConversation = addCustomerMessage(
    state,
    incoming,
    { original: incoming.text, translation: analysis.translationEn, translationDe: analysis.translationDe },
    toChatLanguage(analysis.languageCode),
    analysis.languageName,
  );
  if (analysis.needsOwner) needsOwner(conversation, analysis.reason || 'The AI handed this chat to you.');

  const request = validBookingRequest(analysis.bookingRequest, now);
  if (request) {
    conversation.bookingRequest = { ...request, status: 'requested' };
    needsOwner(conversation, `Booking request: ${request.service} on ${bookingDateLabel(request.date)} at ${request.time} for ${request.customerName}. Please confirm.`);
  }

  const reply = conversation.takenOver || !analysis.reply
    ? null
    : { original: analysis.reply, translation: analysis.replyEn, translationDe: analysis.replyDe };
  return { conversation, reply };
}
