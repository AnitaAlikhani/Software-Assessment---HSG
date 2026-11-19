import { createHash } from 'node:crypto';
import process from 'node:process';

const botToken = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  return token;
};

export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN);

/**
 * Telegram sends this value in every webhook call, so we know the call is really from Telegram.
 * It is made from the bot token, so no extra secret has to be set up.
 */
export const webhookSecret = () =>
  createHash('sha256').update(`slotbee-telegram:${botToken()}`).digest('hex').slice(0, 48);

async function call(method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string; error_code?: number; result?: unknown };
  if (!response.ok || !data.ok) {
    // The status goes along, so the caller can tell a refusal from a hiccup (see telegramRefused).
    throw Object.assign(new Error(`Telegram ${method} failed: ${data.description ?? response.status}`), { status: data.error_code ?? response.status });
  }
  return data.result;
}

/**
 * True when Telegram itself turned a call down for good: the customer blocked the bot or the chat
 * does not exist (403, 400). Sending the same again cannot help. Everything else (no connection,
 * a busy or failing Telegram) may work the next time.
 */
export const telegramRefused = (error: unknown): boolean =>
  [400, 403].includes((error as { status?: unknown } | null)?.status as number);

/** Sends a text message from the SlotBee bot to a Telegram chat. */
export const sendTelegramText = (chatId: string, text: string) => call('sendMessage', { chat_id: chatId, text });

/** Shows "typing…" in the customer's Telegram while the AI writes. */
export const sendTelegramTyping = (chatId: string) =>
  call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);

/** Tells Telegram where to deliver new messages. */
export const setTelegramWebhook = (url: string) =>
  call('setWebhook', { url, secret_token: webhookSecret(), allowed_updates: ['message'], drop_pending_updates: true });

export const getTelegramBot = () => call('getMe', {}) as Promise<{ username?: string; first_name?: string }>;

let cachedUsername: string | null | undefined;
/** The bot's @username for the owner's live-test strip. Cached, so polling does not call Telegram each time. */
export async function telegramBotUsername(): Promise<string | null> {
  if (!telegramConfigured()) return null;
  if (cachedUsername !== undefined) return cachedUsername;
  try {
    cachedUsername = (await getTelegramBot()).username ?? null;
  } catch {
    return null; // try again on the next poll
  }
  return cachedUsername;
}
