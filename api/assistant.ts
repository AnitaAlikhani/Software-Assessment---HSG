import { json } from '../server/ai.js';
import { hasLiveAccess } from '../server/access.js';
import { ASSISTANT_INSTRUCTION, assistantPrompt, assistantSchema, readAnswer, readQuestion } from '../server/assistant.js';

const noStore = { 'Cache-Control': 'no-store' };
/** A question is a short message plus the names of services and staff; anything bigger is not one. */
const MAX_BODY = 20_000;

/**
 * The owner assistant asks this route to read a message its built-in interpreter did not
 * understand. The answer is a structured request and nothing more: this route changes nothing
 * and knows nothing about the calendar. Only the owner's key may call it, so nobody else can
 * spend the AI quota.
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
  const question = readQuestion(body);
  if (!question) return Response.json({ error: 'Bad request' }, { status: 400 });

  try {
    const answer = await json<unknown>(assistantPrompt(question), assistantSchema, ASSISTANT_INSTRUCTION);
    return Response.json({ request: readAnswer(answer, question) }, { headers: noStore });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'The message could not be read.' }, { status: 502, headers: noStore });
  }
}
