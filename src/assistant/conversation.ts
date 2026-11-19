import type { Reading } from './interpret';
import { isChange, type AssistantIntent, type AssistantRequest, type AssistantSlot, type AssistantTask, type ChangeIntent } from './types';

/**
 * What the assistant keeps in mind between two messages, so details are asked one at a time and
 * nothing has to be said twice. It lives in the open panel only and is never stored.
 */
export interface AssistantMemory {
  /** The request being worked on: a question is open, a proposal waits, or an answer was just given. */
  task?: AssistantTask;
  /** The detail the assistant asked for last. */
  asked?: AssistantSlot;
}

/**
 * How a message was put, as the built-in reader saw it in the owner's own words (see Reading in
 * interpret.ts). It limits what may be done with the message, whoever filled in the request.
 */
export type Manner = Pick<Reading, 'asks' | 'sentence' | 'denies' | 'agrees' | 'refers' | 'staff'>;

type Detail = 'service' | 'employee' | 'day' | 'time' | 'customer';

/** Which details can add to which kind of request. A name typed after the agenda adds nothing. */
const USEFUL: Record<AssistantIntent, Detail[]> = {
  availability: ['service', 'employee', 'day', 'time'],
  book: ['service', 'employee', 'day', 'time', 'customer'],
  cancel: ['customer', 'day', 'time'],
  close: ['day'],
  reopen: ['day'],
  agenda: ['day', 'employee'],
  appointments: ['customer', 'day'],
  hours: ['day'],
  absence: [],
  help: [],
};

const ASKED: Record<AssistantSlot, Detail> = { service: 'service', date: 'day', time: 'time', customerName: 'customer' };

/**
 * What a question about a change is answered with instead of the change: the facts it rests on.
 * "And on Friday?" after a booking proposal gets the free times, never a second proposal.
 */
const ANSWER_INSTEAD: Record<ChangeIntent, AssistantIntent> = { book: 'availability', cancel: 'appointments', close: 'hours', reopen: 'hours' };

const details = (said: AssistantRequest): Detail[] => [
  ...(said.serviceId || said.serviceOptions?.length ? ['service' as const] : []),
  ...(said.employeeId ? ['employee' as const] : []),
  ...(said.date || said.fromDate ? ['day' as const] : []),
  ...(said.time || said.partOfDay ? ['time' as const] : []),
  ...(said.customerName ? ['customer' as const] : []),
];

/** The earlier request with the new details on top. A new detail also clears what depended on the old one. */
function merge(before: AssistantTask, said: AssistantRequest): AssistantTask {
  const task: AssistantTask = { ...before, language: said.language };
  if (said.serviceId) { task.serviceId = said.serviceId; delete task.serviceOptions; }
  else if (said.serviceOptions?.length) { task.serviceOptions = said.serviceOptions; delete task.serviceId; }
  if (said.employeeId) task.employeeId = said.employeeId;
  if (said.date) {
    task.date = said.date;
    delete task.fromDate;
    delete task.scope;
    if (said.endDate) task.endDate = said.endDate; else delete task.endDate;
  } else if (said.fromDate) {
    task.fromDate = said.fromDate;
    delete task.date;
    delete task.endDate;
    delete task.time;
  }
  if (said.time) task.time = said.time;
  if (said.partOfDay) {
    task.partOfDay = said.partOfDay;
    // "What about the morning?" no longer asks about the exact time from before.
    if (!said.time) delete task.time;
  } else if (said.time) {
    delete task.partOfDay;
  }
  if (said.customerName) {
    task.customerName = said.customerName;
    delete task.customerId;
    delete task.newCustomer;
  }
  // A changed detail means a different appointment than the one picked from a list.
  if (said.customerName || said.date || said.time) delete task.appointmentId;
  return task;
}

/** The same request put as a question: what is free, booked or closed, instead of the change. */
function asQuestion(task: AssistantTask): AssistantTask {
  if (!isChange(task.intent)) return task;
  const { appointmentId: _appointmentId, ...rest } = task;
  return { ...rest, intent: ANSWER_INSTEAD[task.intent] };
}

/** A request that names what to do, seen together with the request before it. */
function continued(task: AssistantTask, memory: AssistantMemory, manner: Manner): AssistantTask {
  const before = memory.task;
  if (!before) return task;
  // Still answering the assistant's question, only in a full sentence: "Book it on Tuesday at 10".
  if (memory.asked && task.intent === before.intent) return merge(before, task);
  // "Yes, but book Lea Brunner instead", "Book it at 12", "Trag es ein": the request that is already
  // there, with the change on top if one was named. It is proposed again; nothing runs from here.
  if ((manner.agrees || manner.refers) && isChange(task.intent) && task.intent === before.intent) return merge(before, task);
  // "Is Thursday at 15:00 free for a haircut?" ... "Book it for Lea Brunner": same day, time and service.
  if (task.intent === 'book' && before.intent === 'availability') {
    const { partOfDay: _partOfDay, fromDate: _fromDate, scope: _scope, ...kept } = before;
    return merge({ ...kept, intent: 'book' }, task);
  }
  // "Is Lea Brunner booked on Tuesday?" ... "Cancel it": the customer and the day that were just looked up.
  if (task.intent === 'cancel' && before.intent === 'appointments' && !task.customerName && before.customerName) {
    const { fromDate: _fromDate, cancellations: _cancellations, ...kept } = before;
    return merge({ ...kept, intent: 'cancel' }, task);
  }
  // "Are we closed on Friday?" ... "Then close it": the day that was just asked about.
  if ((task.intent === 'close' || task.intent === 'reopen') && before.intent === 'hours' && !task.date && before.date) {
    return { ...task, date: before.date, ...(before.endDate ? { endDate: before.endDate } : {}) };
  }
  // A new question about free times that names no service ("Is Friday free?") is still about the
  // service and the stylist from before. The day is only kept for "is 16:00 free?"; "next free
  // time?" must not stay on the old day.
  if (task.intent === 'availability' && (before.intent === 'availability' || before.intent === 'book')) {
    const namesService = Boolean(task.serviceId || task.serviceOptions?.length);
    const next: AssistantTask = { ...task };
    if (!namesService && before.serviceId) next.serviceId = before.serviceId;
    if (!namesService && !task.employeeId && before.employeeId) next.employeeId = before.employeeId;
    if (!task.date && !task.fromDate && task.time && before.date) next.date = before.date;
    return next;
  }
  return task;
}

/**
 * The answer to a message that asks whether or when something is or was the case. Whatever comes
 * out of here only reads the salon's data: free times, the agenda, somebody's appointments, the
 * salon's hours. It is null when the assistant has no true answer to give.
 */
function answerTo(said: AssistantRequest, memory: AssistantMemory, manner: Manner): AssistantTask | null {
  const before = memory.task;
  const { language } = said;
  // The reader placed the question itself: free times, the agenda, help.
  if (said.intent && !isChange(said.intent)) return continued(said as AssistantTask, memory, manner);
  if (manner.asks === 'detail') {
    // "And on Friday?", "At 11?": the request before with this detail, as a question about it.
    if (!before || !details(said).some(detail => USEFUL[before.intent].includes(detail))) return null;
    return asQuestion(merge(before, said));
  }
  const days = {
    ...(said.date ? { date: said.date } : {}),
    ...(said.endDate ? { endDate: said.endDate } : {}),
    ...(said.fromDate ? { fromDate: said.fromDate } : {}),
  };
  if (manner.asks === 'hours') return { language, intent: 'hours', ...days };
  if (manner.asks === 'appointments' || manner.asks === 'cancelling') {
    const cancellations = manner.asks === 'cancelling' ? { cancellations: true } : {};
    if (said.customerName) return { language, intent: 'appointments', customerName: said.customerName, ...days, ...cancellations };
    // Nobody is named. "Did anybody cancel?" still gets the plain answer that cancellations are
    // not kept; "Is Friday booked?" gets the agenda of that day.
    if (manner.asks === 'cancelling') return { language, intent: 'appointments', ...days, ...cancellations };
    if (said.date || said.fromDate) return { language, intent: 'agenda', ...days, ...(said.employeeId ? { employeeId: said.employeeId } : {}) };
    return null;
  }
  // Only the model can have named a change for a question: it is answered as the question it is.
  if (!said.intent) return null;
  const facts = asQuestion(said as AssistantTask);
  return said.intent === 'cancel' ? { ...facts, cancellations: true } : facts;
}

/**
 * Works out what the owner wants now, from what was just said and what was said before.
 * Returns null when the message cannot be used: it asks for nothing and adds to nothing.
 *
 * `manner` is how the built-in reader saw the owner's own words. Two rules follow from it, and
 * they hold for every path that ends here, the built-in reader's and the AI model's alike:
 * - A question is answered. It never becomes a booking, a cancellation, a closure or a reopening,
 *   with or without a request open. The one exception is a bare day, time or service that answers
 *   the question the assistant itself just asked ("What time?" ... "11?").
 * - A message about one member of the team never closes or reopens the salon.
 */
export function nextTask(said: AssistantRequest, memory: AssistantMemory, unreadWords = 0, manner: Manner = {}): AssistantTask | null {
  const before = memory.task;
  const given = details(said);
  const answersQuestion = memory.asked !== undefined && given.includes(ASKED[memory.asked]);
  // "What time?" ... "11?": the asked detail and nothing else, only with a question mark. A name
  // is left out: almost any words can be read as one, so "Who is it for?" ... "Kommt Luca?" must
  // stay a question.
  const tentativeAnswer = manner.asks === 'detail' && answersQuestion && given.length === 1 && memory.asked !== 'customerName';
  const asking = manner.asks !== undefined && !tentativeAnswer;

  let task: AssistantTask | null;
  if (asking) {
    task = answerTo(said, memory, manner);
  } else if (!said.intent) {
    // "At 10", "Lea Brunner", "on Friday instead": only meaningful as an addition to the request before.
    // The answer to the question just asked may come with extra words ("let's say 11 if that works").
    // Anything else must be a bare detail: "Mia would like a cut at 11" is not "at 11 instead", and
    // "Lea Brunner is booked on Tuesday" is not "for Lea Brunner on Tuesday". And what says "not" or
    // reports something is never taken for a detail, not even as an answer.
    const moreThanDetail = manner.denies || ((unreadWords > 0 || manner.sentence) && !answersQuestion);
    if (!before || moreThanDetail) task = null;
    else task = given.some(detail => USEFUL[before.intent].includes(detail)) ? merge(before, said) : null;
  } else {
    task = continued(said as AssistantTask, memory, manner);
  }
  if (!task) return null;

  // One person's time off is not a closure: the owner is told where absences are entered.
  const person = said.employeeId ?? manner.staff;
  if ((task.intent === 'close' || task.intent === 'reopen') && person) {
    const { endDate: _endDate, ...rest } = task;
    task = { ...rest, intent: 'absence', employeeId: person };
  }
  // Asked about appointments without naming anybody (only the model can say so): that is the
  // agenda of the day, or nothing that can be answered.
  if (task.intent === 'appointments' && !task.customerName && !task.cancellations) {
    if (!task.date && !task.fromDate) return null;
    task = { language: task.language, intent: 'agenda', ...(task.date ? { date: task.date } : { fromDate: task.fromDate }) };
  }
  // Every path above is built to keep this rule; it is checked once more where they all end.
  if (asking && isChange(task.intent)) return null;
  return task;
}

/** The task for a message as the built-in reader read it. */
export const taskFor = (reading: Reading, memory: AssistantMemory): AssistantTask | null =>
  nextTask(reading.request, memory, reading.unread.length, reading);

/**
 * The task for a message the AI model read, because the built-in reader could not. The model
 * only fills in the request: how the message was put still comes from the owner's own words, so
 * the two rules of nextTask() hold here too. And since the built-in reader did not understand
 * the sentence, details without an intent are not taken for a correction of the request before:
 * they only count as the answer to the question the assistant just asked.
 */
export const taskFromModel = (checked: AssistantRequest, reading: Reading, memory: AssistantMemory): AssistantTask | null =>
  nextTask(checked, memory, Math.max(1, reading.unread.length), reading);

/**
 * The message names the instruction of the proposal that is open and nothing new: said with a yes
 * in front ("Yes, book it", "Ja, bitte eintragen") or pointing at it ("Book it", "Trag es ein").
 * A message with anything else in it (another day, another name, another instruction, a question,
 * "a new appointment") is not this; it is read as a message of its own.
 */
const repeatsProposal = (reading: Reading, proposal: ChangeIntent): boolean =>
  (reading.agrees === true || reading.refers === true) && reading.asks === undefined && reading.request.intent === proposal &&
  details(reading.request).length === 0 && reading.unread.length === 0;

/**
 * Such a message confirms the proposal, like a bare "yes", when it is said directly. The others
 * confirm nothing and get the proposal shown once more instead:
 * - one put as a question ("Can you book it?"), because a question never changes the calendar;
 * - a statement or anything hedged ("Yes, I will book it", "Ok, no need to book it", "Book it later");
 * - in front of a proposed cancellation, anything but a yes with "cancel it": "cancel" is also how
 *   one says "leave it", so "Cancel it" or "Ok, cancel" alone is not taken for the go-ahead.
 */
export const confirmsProposal = (reading: Reading, proposal: ChangeIntent): boolean =>
  repeatsProposal(reading, proposal) && reading.direct === true &&
  (proposal === 'cancel' ? reading.agrees === true && reading.refers === true : true);

/** The proposal that waits for the owner's Confirm, as far as a typed message is concerned. */
export interface OpenProposal {
  kind: ChangeIntent;
  /** It is the last thing in the thread: nothing was said since the assistant showed it. */
  last: boolean;
}

/** What the assistant does with one typed message. */
export type Turn =
  /** Run the open proposal, as its Confirm button would. */
  | { kind: 'confirm' }
  /** Show the open proposal once more instead of running it. */
  | { kind: 'askAgain'; task: AssistantTask }
  | { kind: 'dismiss' }
  /** A short fixed answer. `forget`: the half-finished request is dropped with it. */
  | { kind: 'say'; note: 'thanks' | 'nothingOpen' | 'dismissed'; forget: boolean }
  | { kind: 'answer'; task: AssistantTask }
  /** The built-in reader did not understand it: the AI model may be asked, or the assistant says so. */
  | { kind: 'unclear' };

/**
 * Decides what one typed message means at this point of the conversation.
 *
 * A typed yes, or the proposal's own instruction said directly ("Book it", "Ja, bitte eintragen"),
 * is the same as pressing Confirm, as long as the proposal is what the assistant said last. If
 * something else was said in between (a question it did not understand, a "thanks"), the yes may
 * answer that instead, so the proposal is shown once more and nothing is changed yet.
 */
export function turn(reading: Reading, memory: AssistantMemory, open?: OpenProposal): Turn {
  const { reply } = reading.request;
  if (open) {
    const yes = reply === 'yes' || confirmsProposal(reading, open.kind);
    if (yes && open.last) return { kind: 'confirm' };
    // A yes after something else was said, or an instruction that is not a clear go-ahead (see
    // confirmsProposal): the proposal is shown once more and nothing is changed yet.
    if (yes || repeatsProposal(reading, open.kind)) {
      // The request before is the one the proposal was made from; anything else is not shown as "it".
      // It is shown in the language of the message, like every other answer.
      return memory.task?.intent === open.kind
        ? { kind: 'askAgain', task: { ...memory.task, language: reading.request.language } } : { kind: 'unclear' };
    }
  }
  if (reply) {
    if (open && reply === 'no') return { kind: 'dismiss' };
    // "Never mind" while the assistant waits for a detail drops the half-finished request.
    const forget = reply === 'no' && memory.asked !== undefined;
    return { kind: 'say', note: reply === 'thanks' ? 'thanks' : forget ? 'dismissed' : 'nothingOpen', forget };
  }
  const task = taskFor(reading, memory);
  return task ? { kind: 'answer', task } : { kind: 'unclear' };
}
