import { answer, confirmProposal, type AssistantReply } from '../../assistant/execute';
import type { AssistantIntent, AssistantLanguage, AssistantRequest, AssistantTask } from '../../assistant/types';
import { getSalonNow } from '../../scheduling';
import { matchName } from '../names';
import type { VoiceQuestion } from '../question';
import { readUnderstanding, voiceQuestion, type HeardLine, type RouteAnswer, type RouteProblem } from '../understand';
import type { Desk } from './desk';

/**
 * One live call, without any screen: every finished phrase the owner says is added to the call,
 * the AI reader is asked what the call is about by now, and the answer comes from the salon's
 * calendar through the same rules the owner assistant uses (assistant/execute.ts).
 *
 * The reader only fills in a request. Whether a time is free, and every booking, is decided here
 * with the booking rules. Nothing is entered without a spoken or pressed confirmation, and the
 * newest change can be taken back.
 */

/** What a call with a customer may ask of the calendar. Closing days or the day's plan are not part of it. */
export const CALL_INTENTS: readonly AssistantIntent[] = ['availability', 'book', 'cancel', 'appointments', 'hours'];

/** How the question about one phrase ended. */
export type LineOutcome =
  /** The reader has been asked and has not answered yet. */
  | { state: 'reading' }
  /** `noted`: the call holds something for the calendar. `shown`: this reading is the one on screen. */
  | { state: 'read'; waitMs: number; modelMs: number | null; noted: boolean; shown: boolean }
  | { state: 'problem'; problem: RouteProblem; waitMs: number }
  /** A spoken confirmation of the change that was waiting: carried out at once, the reader is not asked. */
  | { state: 'confirmed' };

export interface CallLine {
  id: number;
  text: string;
  alternatives: string[];
  /** When the phrase arrived (ISO). */
  at: string;
  outcome: LineOutcome;
}

export interface Understood {
  request: AssistantTask;
  /** The customer's name as the recogniser wrote it, when the customer list spells it differently. */
  heardName?: string;
  /** The phrase whose reading this is. */
  line: number;
}

/** A change waits for its confirmation, was carried out, was refused by the rules, or was set aside. */
export type ProposalState = 'none' | 'open' | 'confirmed' | 'failed' | 'dismissed';

export interface CallState {
  lines: CallLine[];
  understood: Understood | null;
  /** The answer from the calendar, worded for somebody on the phone. */
  reply: AssistantReply | null;
  proposal: ProposalState;
  canUndo: boolean;
}

export interface CallDeps {
  desk: Desk;
  language: AssistantLanguage;
  /** Asks the AI reader (see askVoiceRoute). */
  ask: (question: VoiceQuestion) => Promise<RouteAnswer>;
  onChange: (state: CallState) => void;
  now?: () => Date;
  /** A running clock in milliseconds, for measuring waits. */
  elapsed?: () => number;
}

export interface Call {
  state(): CallState;
  /** A finished phrase from the speech recogniser, or one typed in its place. */
  heard(line: HeardLine): void;
  /** Carries out the change that waits. */
  confirm(): void;
  /** Sets the waiting change aside. */
  dismiss(): void;
  /** Takes back the newest change made in this call. */
  undo(): void;
  /** A new call: the phrases are forgotten, the calendar stays as it is. */
  clear(): void;
}

// ---------- spoken confirmation ----------

const CONFIRM_PHRASES: Record<'book' | 'cancel', string[]> = {
  book: [
    'confirm booking', 'confirm the booking', 'confirm this booking', 'confirm appointment', 'confirm the appointment',
    'buchung bestätigen', 'die buchung bestätigen', 'termin bestätigen', 'den termin bestätigen',
  ],
  cancel: [
    'confirm cancellation', 'confirm the cancellation', 'confirm cancelation', 'confirm the cancelation',
    'absage bestätigen', 'die absage bestätigen', 'stornierung bestätigen', 'die stornierung bestätigen',
  ],
};
/** Words people put around a command without changing it. */
const FILLERS = new Set(['ok', 'okay', 'yes', 'ja', 'please', 'bitte', 'gut', 'good', 'great', 'perfect', 'perfekt', 'super', 'so', 'now', 'jetzt', 'then', 'dann', 'thanks', 'danke', 'and', 'und']);

const plainWords = (text: string): string[] =>
  text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/**
 * Which change a phrase confirms, or null. Only a phrase that is the command and nothing else
 * counts: "I will confirm the booking by e-mail" does not. Checked here in the browser, so a
 * confirmation never waits for the AI reader.
 */
export function confirmationIn(text: string, alternatives: string[] = []): 'book' | 'cancel' | null {
  for (const heard of [text, ...alternatives]) {
    const words = plainWords(heard);
    while (words.length > 0 && FILLERS.has(words[0])) words.shift();
    while (words.length > 0 && FILLERS.has(words[words.length - 1])) words.pop();
    const phrase = words.join(' ');
    if (CONFIRM_PHRASES.book.includes(phrase)) return 'book';
    if (CONFIRM_PHRASES.cancel.includes(phrase)) return 'cancel';
  }
  return null;
}

// ---------- wording ----------

/**
 * The assistant's sentences were written for a chat where the owner taps and types. On the phone
 * the owner speaks, so the few sentences that mention tapping or typing are reworded here.
 */
const FOR_A_CALL: [RegExp, string][] = [
  [/ \(tap a time to book it\)/, ''],
  [/ \(antippen zum Eintragen\)/, ''],
  [/ Tap a time to book it\./, ''],
  [/ Zeit antippen, um sie einzutragen\./, ''],
  [/Type the customer's name\./, 'Ask for the name.'],
  [/Bitte den Namen eingeben\./, 'Bitte nach dem Namen fragen.'],
  [/Type the name or the day\./, 'Say the name or the day.'],
  [/Gib den Namen oder den Tag ein\./, 'Nenne den Namen oder den Tag.'],
  [/^Shall I book this\?$/, 'Ready to book. Say "confirm booking" or press Confirm.'],
  [/^Soll ich das so eintragen\?$/, 'Bereit zum Eintragen. Sag «Buchung bestätigen» oder drücke Bestätigen.'],
  [/^Shall I cancel this appointment\?$/, 'Ready to cancel. Say "confirm cancellation" or press Confirm.'],
  [/^Soll ich diesen Termin absagen\?$/, 'Bereit zum Absagen. Sag «Absage bestätigen» oder drücke Bestätigen.'],
];

export const wordedForCall = (reply: AssistantReply): AssistantReply => ({
  ...reply,
  text: reply.text.map(line => FOR_A_CALL.reduce((worded, [from, to]) => worded.replace(from, to), line)),
});

const plain = (language: AssistantLanguage, en: string, de: string, tone?: AssistantReply['tone']): AssistantReply =>
  ({ language, text: [language === 'de' ? de : en], ...(tone ? { tone } : {}) });

// ---------- the call ----------

export function createCall(deps: CallDeps): Call {
  const now = deps.now ?? (() => new Date());
  const elapsed = deps.elapsed ?? (() => performance.now());
  const { desk, language } = deps;

  let lines: CallLine[] = [];
  let nextId = 1;
  let understood: Understood | null = null;
  let reply: AssistantReply | null = null;
  let proposal: ProposalState = 'none';
  /** The first phrase the reader is still given. After a change the call starts afresh from the next one. */
  let partFrom = 1;
  /** The newest phrase whose reading is on screen. An older answer that arrives late is not shown. */
  let shown = 0;
  /** A phrase that confirmed before any change was waiting: the reading of that phrase is carried out at once. */
  let confirmOn = 0;
  /** Counts up with every new call, so an answer that belongs to an earlier call is dropped. */
  let round = 0;

  const state = (): CallState => ({ lines, understood, reply, proposal, canUndo: desk.canUndo() });
  const publish = () => deps.onChange(state());
  const setOutcome = (id: number, outcome: LineOutcome) => {
    lines = lines.map(line => (line.id === id ? { ...line, outcome } : line));
  };

  /** Working out an answer changes nothing; if it ever fails on unexpected data the owner gets a plain sentence. */
  const respond = (task: AssistantTask): AssistantReply => {
    try {
      return wordedForCall(answer(task, desk.data(now())));
    } catch (error) {
      console.error(error);
      return plain(task.language, 'I could not work that out. Nothing was changed.', 'Das konnte ich nicht ausrechnen. Es wurde nichts geändert.', 'problem');
    }
  };

  const confirm = () => {
    const waiting = reply?.proposal;
    if (!waiting || proposal !== 'open') return;
    let result: AssistantReply;
    try {
      result = wordedForCall(confirmProposal(waiting, reply?.language ?? language, desk.data(now()), desk.handlers));
    } catch (error) {
      console.error(error);
      result = plain(language, 'That did not work. Nothing was changed.', 'Das hat nicht geklappt. Es wurde nichts geändert.', 'problem');
    }
    const done = result.tone === 'success';
    // The proposal stays on screen as the record of what was entered or refused.
    reply = { ...result, proposal: waiting };
    proposal = done ? 'confirmed' : 'failed';
    confirmOn = 0;
    if (done) {
      // The call goes on with a clean sheet: what was said before belongs to the change just made.
      partFrom = nextId;
      shown = nextId - 1;
    }
    publish();
  };

  const show = (id: number, task: AssistantTask) => {
    const confirmNow = confirmOn === id;
    if (id >= confirmOn) confirmOn = 0;
    shown = id;
    let named = task;
    let heardName: string | undefined;
    if (task.customerName) {
      const person = matchName(task.customerName, desk.data(now()).customers);
      if (person) {
        if (person.name !== task.customerName) heardName = task.customerName;
        named = { ...task, customerName: person.name, customerId: person.id };
      }
    }
    understood = { request: named, ...(heardName ? { heardName } : {}), line: id };
    reply = respond(named);
    proposal = reply.proposal ? 'open' : 'none';
    // "Confirm booking" was said before the booking was worked out: enter it now, unless the rules warn about something.
    if (confirmNow && reply.proposal && reply.proposal.warnings.length === 0 && reply.proposal.action.kind === 'book') confirm();
  };

  /** Details without a named wish count as a question about free times: the owner repeats what the customer wants. */
  const taskOf = (request: AssistantRequest | null): AssistantTask | null => {
    if (!request) return null;
    const intent = request.intent ?? 'availability';
    return CALL_INTENTS.includes(intent) ? { ...request, intent } : null;
  };

  const settle = (calledIn: number, id: number, question: VoiceQuestion, routeAnswer: RouteAnswer, waitMs: number) => {
    if (calledIn !== round) return;
    if (!routeAnswer.ok) {
      setOutcome(id, { state: 'problem', problem: routeAnswer.problem, waitMs });
      if (confirmOn === id) confirmOn = 0;
      publish();
      return;
    }
    const task = taskOf(readUnderstanding(routeAnswer.request, question));
    const fresh = id > shown && id >= partFrom;
    setOutcome(id, { state: 'read', waitMs, modelMs: routeAnswer.modelMs, noted: Boolean(task), shown: Boolean(task) && fresh });
    if (task && fresh) show(id, task);
    else if (confirmOn === id) confirmOn = 0;
    publish();
  };

  return {
    state,
    confirm,
    heard(line) {
      const text = line.text.replace(/\s+/g, ' ').trim();
      if (!text) return;
      const id = nextId;
      nextId += 1;
      const alternatives = (line.alternatives ?? []).map(other => other.replace(/\s+/g, ' ').trim()).filter(other => other && other !== text);
      lines = [...lines, { id, text, alternatives, at: now().toISOString(), outcome: { state: 'reading' } }];

      const confirms = confirmationIn(text, alternatives);
      if (confirms && proposal === 'open' && reply?.proposal?.action.kind === confirms) {
        setOutcome(id, { state: 'confirmed' });
        confirm();
        return;
      }
      if (confirms === 'book') confirmOn = id;

      const data = desk.data(now());
      const part = lines.filter(item => item.id >= partFrom && item.outcome.state !== 'confirmed');
      const question = voiceQuestion(
        part.map(item => ({ text: item.text, alternatives: item.id === id ? item.alternatives : undefined })),
        { today: getSalonNow(data.timeZone, data.now).date, timeZone: data.timeZone, language, services: data.services, employees: data.employees },
      );
      const calledIn = round;
      const started = elapsed();
      publish();
      const waited = () => Math.max(0, Math.round(elapsed() - started));
      deps.ask(question).then(
        routeAnswer => settle(calledIn, id, question, routeAnswer, waited()),
        () => settle(calledIn, id, question, { ok: false, problem: 'offline' }, waited()),
      );
    },
    dismiss() {
      if (proposal !== 'open') return;
      proposal = 'dismissed';
      confirmOn = 0;
      publish();
    },
    undo() {
      const change = desk.undo();
      if (!change) return;
      reply = change.kind === 'added'
        ? plain(language, 'Taken back: the appointment is out of the calendar again.', 'Zurückgenommen: Der Termin ist wieder aus dem Kalender.')
        : plain(language, 'Taken back: the appointment is in the calendar again.', 'Zurückgenommen: Der Termin steht wieder im Kalender.');
      proposal = 'none';
      understood = null;
      publish();
    },
    clear() {
      round += 1;
      lines = [];
      nextId = 1;
      understood = null;
      reply = null;
      proposal = 'none';
      partFrom = 1;
      shown = 0;
      confirmOn = 0;
      publish();
    },
  };
}
