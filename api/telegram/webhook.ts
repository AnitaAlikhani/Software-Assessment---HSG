import { analyzeIncoming } from '../../server/ai.js';
import { recordAnalysis } from '../../server/recordAnalysis.js';
import { researchSetting } from '../../server/researchMode.js';
import { claimMessage, deletedSince, deleteOwnChat, loadConversation, loadForUpdate, releaseMessage, saveConversation, storeConfigured } from '../../server/store.js';
import { sendTelegramText, sendTelegramTyping, telegramConfigured, telegramRefused, webhookSecret } from '../../server/telegramApi.js';
import {
  addCustomerMessage,
  addReply,
  needsOwner,
  parseTelegramUpdate,
  stateFor,
  telegramChatId,
  toChatLanguage,
} from '../../server/whatsappCore.js';
import { PRODUCT_NAME } from '../../src/brand.js';
import { chatDeletedNotice, chatNotDeletedNotice, telegramWelcome } from '../../src/customerNotice.js';
import { initialCompanySettings } from '../../src/mockData.js';

/**
 * Commands get a fixed text in the language of the customer's Telegram app (German, French,
 * Italian or English), never one written by the AI:
 * /delete deletes the customer's chat; /start and every other command explain who answers and
 * what is stored. Telegram shows /start as the first step, so every customer reads it once.
 */
async function answerCommand(message: NonNullable<ReturnType<typeof parseTelegramUpdate>>) {
  const chatId = telegramChatId(message.waId);
  const salon = initialCompanySettings.companyName;
  const language = toChatLanguage(message.languageCode);
  const command = message.text.trim().split(/[\s@]/)[0].toLowerCase();
  if (command !== '/delete') {
    await sendTelegramText(chatId, telegramWelcome(language, { salon, study: researchSetting(), product: PRODUCT_NAME }));
    return;
  }
  let deleted = false;
  let chatLanguage = language;
  try {
    // Answer in the language the customer wrote in, if a chat is stored.
    chatLanguage = (await loadConversation(message.waId))?.language ?? language;
    await deleteOwnChat(message.waId);
    deleted = true;
  } catch (error) {
    console.error(error);
  }
  // Only say "deleted" when it is.
  await sendTelegramText(chatId, deleted ? chatDeletedNotice(chatLanguage, salon) : chatNotDeletedNotice(chatLanguage));
}

/** Every new Telegram message to the salon's bot arrives here. */
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
    try {
      await answerCommand(message);
    } catch (error) {
      console.error(error);
      // The fixed text did not reach the customer, and for /start it is the only place that says
      // what happens to their messages. No chat exists yet that could remember to send it later.
      // So the command is handed back: Telegram delivers a call again when we do not accept it.
      // Not when Telegram itself turned the text down for good (the customer blocked the bot):
      // repeating that cannot help.
      if (!telegramRefused(error)) {
        await releaseMessage(message.id).catch(releaseError => console.error(releaseError));
        return new Response('The answer could not be sent', { status: 503 });
      }
    }
    return new Response('OK');
  }

  const { conversation: existing, version } = await loadForUpdate(message.waId);
  const state = stateFor(existing);
  try {
    if (!existing?.takenOver) await sendTelegramTyping(chatId);
    const analysis = await analyzeIncoming(existing?.messages ?? [], message.text);
    const { conversation, reply } = recordAnalysis(state, message, analysis);
    if (reply) {
      // The AI took its time. A customer who sent /delete meanwhile has been told that the chat
      // is gone: they get no answer from it, and nothing of it is stored again.
      if (await deletedSince(message.waId, version)) return new Response('OK');
      await sendTelegramText(chatId, reply.original);
      addReply(conversation, 'ai', reply);
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
  // Saving checks for a deletion once more, in one step with the write.
  if (conversation) await saveConversation(conversation, version);
  return new Response('OK');
}
