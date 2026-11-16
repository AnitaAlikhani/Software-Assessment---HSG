import { analyzeIncoming } from '../../server/ai.js';
import { claimMessage, loadConversation, saveConversation, storeConfigured } from '../../server/store.js';
import { sendTelegramText, sendTelegramTyping, telegramConfigured, webhookSecret } from '../../server/telegramApi.js';
import {
  addCustomerMessage,
  addReply,
  needsOwner,
  parseTelegramUpdate,
  stateFor,
  telegramChatId,
  toChatLanguage,
} from '../../server/whatsappCore.js';
import { initialCompanySettings } from '../../src/mockData.js';

const WELCOME = [
  `Hi! This is the test chat of ${initialCompanySettings.companyName} (SlotBee, a student project at HSG).`,
  'Write in any language, for example to ask for an appointment. An AI assistant answers, and the salon owner may reply too.',
  'Your messages and first name are saved for about two weeks and then deleted. Please do not share sensitive personal data.',
].join('\n\n');

/** Every new Telegram message to the SlotBee bot arrives here. */
export async function POST(request: Request) {
  if (!telegramConfigured()) return new Response('Telegram is not configured', { status: 500 });
  if (request.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret()) {
    return new Response('Forbidden', { status: 403 });
  }
  if (!storeConfigured()) return new Response('Storage is not configured', { status: 500 });

  let body: unknown;
  try { body = await request.json(); } catch { return new Response('OK'); }
  const message = parseTelegramUpdate(body);
  if (!message) return new Response('OK'); // edits, stickers, group messages: ignored
  if (!(await claimMessage(message.id))) return new Response('OK'); // Telegram retried a call we already handled

  const chatId = telegramChatId(message.waId);
  if (message.isCommand) {
    await sendTelegramText(chatId, WELCOME).catch(error => console.error(error));
    return new Response('OK');
  }

  const existing = await loadConversation(message.waId);
  const state = stateFor(existing);
  try {
    if (!existing?.takenOver) await sendTelegramTyping(chatId);
    const analysis = await analyzeIncoming(existing?.messages ?? [], message.text);
    const conversation = addCustomerMessage(
      state,
      message,
      { original: message.text, translation: analysis.translationEn, translationDe: analysis.translationDe },
      toChatLanguage(analysis.languageCode),
      analysis.languageName,
    );
    if (analysis.needsOwner) needsOwner(conversation, analysis.reason || 'The AI handed this chat to you.');
    if (!conversation.takenOver && analysis.reply) {
      await sendTelegramText(chatId, analysis.reply);
      addReply(conversation, 'ai', { original: analysis.reply, translation: analysis.replyEn, translationDe: analysis.replyDe });
    }
  } catch (error) {
    // Keep the message visible even when the AI or Telegram fails, so the owner can still reply.
    console.error(error);
    const conversation = state.conversations.find(item => item.waId === message.waId)
      ?? addCustomerMessage(state, message, { original: message.text, translation: message.text }, 'EN');
    if (!conversation.messages.some(item => item.id === message.id)) {
      addCustomerMessage(state, message, { original: message.text, translation: message.text }, conversation.language);
    }
    needsOwner(conversation, 'The AI could not answer this message. Please reply yourself.');
  }
  const conversation = state.conversations.find(item => item.waId === message.waId);
  if (conversation) await saveConversation(conversation);
  return new Response('OK');
}
