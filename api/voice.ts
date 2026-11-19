import { json } from '../server/ai.js';
import { hasLiveAccess } from '../server/access.js';
import { readVoiceAnswer, readVoiceQuestion, VOICE_INSTRUCTION, voicePrompt, voiceSchema } from '../server/voice.js';

const noStore = { 'Cache-Control': 'no-store' };
/** A question is a few spoken phrases plus the names of services and staff; anything bigger is not one. */
const MAX_BODY = 30_000;

/**
 * Listening to a call asks this route to read what was said. The answer is a structured request
 * and nothing more: this route changes nothing and knows nothing about the calendar or the
 * customers. Only the owner's key may call it, so nobody else can spend the AI quota.
 */
export async function POST(request: Request) {
  if (!hasLiveAccess(request)) return Response.json({ error: 'No access' }, { status: 401 });

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return Response.json({ error: 'Bad request' }, { status: 400 });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  const question = readVoiceQuestion(body);
  if (!question) return Response.json({ error: 'Bad request' }, { status: 400 });

  const started = Date.now();
  try {
    const answer = await json<unknown>(voicePrompt(question), voiceSchema, VOICE_INSTRUCTION);
    // How long the model took, apart from the way there and back: a call lives on short waits.
    return Response.json({ request: readVoiceAnswer(answer, question), modelMs: Date.now() - started }, { headers: noStore });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'The words could not be read.' }, { status: 502, headers: noStore });
  }
}
