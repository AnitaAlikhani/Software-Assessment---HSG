import { PRODUCT_NAME } from '../src/brand.js';
import { firstContactNotice } from '../src/customerNotice.js';
import { initialCompanySettings } from '../src/mockData.js';
import { researchSetting } from './researchMode.js';
import { sendWhatsAppText } from './whatsappApi.js';
import type { LiveConversation } from './whatsappCore.js';

/**
 * WhatsApp has no start screen. Before the first answer a customer gets one fixed text that says
 * an AI answers and what happens to the messages. A customer whose chat does not say that the
 * text went out is new, was away longer than chats are kept, deleted their chat, or the text
 * could not be sent last time.
 *
 * The chat is marked only after WhatsApp has accepted the text. When the send fails, the
 * customer still gets their answer, and the text is tried again before the next message that
 * goes to them (an AI answer or a reply from the owner) until it has gone out. Never throws.
 */
export async function sendFirstNoticeIfDue(conversation: LiveConversation): Promise<void> {
  if (conversation.noticeSent || (conversation.channel ?? 'WhatsApp') !== 'WhatsApp') return;
  try {
    await sendWhatsAppText(conversation.waId, firstContactNotice(conversation.language, 'WhatsApp', {
      salon: initialCompanySettings.companyName, study: researchSetting(), product: PRODUCT_NAME,
    }));
    conversation.noticeSent = true;
  } catch (error) {
    console.error(error);
  }
}
