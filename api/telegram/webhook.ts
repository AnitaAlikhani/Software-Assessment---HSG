import { cleanName } from '../../server/bookingRules.js';
import { applyAi, askAi, recordDelivery, storeIncoming } from '../../server/chatFlow.js';
import { researchSetting } from '../../server/researchMode.js';
import { claimMessage, deleteOwnChat, loadConversation, releaseMessage, storeConfigured } from '../../server/store.js';
import { sendTelegramText, sendTelegramTyping, telegramConfigured, telegramRefused, webhookSecret } from '../../server/telegramApi.js';
import { parseTelegramUpdate, telegramChatId, toChatLanguage } from '../../server/whatsappCore.js';
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

  // The message is stored before the AI runs, so a slow or failing AI never loses it.
  const stored = await storeIncoming({ ...message, name: cleanName(message.name) || 'Telegram customer' });
  if (!stored) return new Response('OK'); // deleted in the moment it arrived
  if (!stored.conversation.takenOver) await sendTelegramTyping(chatId).catch(error => console.error(error));
  const analysis = await askAi(stored.conversation, message.id);
  // Applied to the chat as it is now: a customer who sent /delete meanwhile has been told that the
  // chat is gone (nothing is stored again and no answer follows), and a chat the owner took over
  // meanwhile gets no AI reply.
  const answered = await applyAi(stored, message.id, analysis, false);
  if (!answered?.reply) return new Response('OK');
  let delivered = false;
  try {
    await sendTelegramText(chatId, answered.reply.original);
    delivered = true;
  } catch (error) {
    // Telegram did not take the answer. The owner sees the message and that nobody answered it.
    console.error(error);
  }
  await recordDelivery(answered, answered.reply, delivered, false);
  return new Response('OK');
}
