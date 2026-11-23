import { usesLiveData } from '../../server/environment.js';
import { ownerAccess, ownerRefusal } from '../../server/limits.js';
import { getTelegramBot, setTelegramWebhook, telegramConfigured } from '../../server/telegramApi.js';

/**
 * Connects the bot to this website: call it once after TELEGRAM_BOT_TOKEN is set in Vercel, with
 * the owner's key in the header x-live-key (the study tools have a button for it, "Connect
 * Telegram"; the key is never read from the address). The bot token itself never leaves the server.
 * A bot answers on one address only, so a preview of a work branch may not take it over.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const access = await ownerAccess(request);
  if (access !== 'ok') return ownerRefusal(access, (error, status) => Response.json({ ok: false, error }, { status }));
  if (!usesLiveData()) {
    return Response.json({
      ok: false,
      error: 'This is a preview copy with its own test data. Connecting the bot here would disconnect it from the live site, so it is only possible on the live site.',
    }, { status: 409 });
  }
  if (!telegramConfigured()) return Response.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not set in Vercel' }, { status: 500 });
  try {
    const webhook = `${url.origin}/api/telegram/webhook`;
    await setTelegramWebhook(webhook);
    const bot = await getTelegramBot();
    return Response.json({
      ok: true,
      webhook,
      bot: bot.username ? `@${bot.username}` : bot.first_name,
      testerLink: bot.username ? `https://t.me/${bot.username}` : null,
    });
  } catch (error) {
    return Response.json({ ok: false, error: String((error as Error).message ?? error) }, { status: 502 });
  }
}
