import process from 'node:process';
import { usesLiveData } from '../../server/environment.js';
import { getTelegramBot, setTelegramWebhook, telegramConfigured } from '../../server/telegramApi.js';

/**
 * Connects the bot to this website: open /api/telegram/setup?key=LIVE_ACCESS_KEY once after
 * TELEGRAM_BOT_TOKEN is set in Vercel. The token itself never leaves the server.
 * A bot answers on one address only, so a preview of a work branch may not take it over.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = process.env.LIVE_ACCESS_KEY;
  const given = request.headers.get('x-live-key') ?? url.searchParams.get('key');
  if (!key || given !== key) return Response.json({ ok: false, error: 'No access' }, { status: 401 });
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
