import { taskFromModel, turn, type AssistantMemory } from '../src/assistant/conversation';
import { answer, confirmProposal, type AssistantData, type AssistantHandlers, type AssistantReply } from '../src/assistant/execute';
import { read, type Reading } from '../src/assistant/interpret';
import { checkAssistantRequest, isChange, type AssistantLanguage, type AssistantTask } from '../src/assistant/types';
import { validateCalendarEvent } from '../src/availability';
import type { CalendarEvent, ClosedDate } from '../src/types';
import { salon, TODAY } from './assistantFixture';

/**
 * A conversation with the assistant as the panel runs it, without the screen. Every decision is
 * made by the functions the panel itself calls: read() for the message, turn() for what it means
 * here, taskFromModel() for an answer of the AI model, answer() and confirmProposal() for the
 * reply. This file only keeps what the panel keeps: the thread's last entry, the proposal that
 * waits, and the request before. The handlers do what the app's own handlers do for the calendar.
 */
export interface Said {
  /** What the message led to. `unclear`: not understood by the built-in reader (the model may be asked). */
  did: 'confirmed' | 'dismissed' | 'said' | 'answered' | 'unclear';
  reply?: AssistantReply;
  /** The request that was answered. */
  task?: AssistantTask;
}

export function chat(initial: AssistantData = salon()) {
  const state = { data: initial, added: [] as Omit<CalendarEvent, 'id'>[], deleted: [] as string[], closures: [] as ClosedDate[][] };
  const handlers: AssistantHandlers = {
    addEvent: event => {
      const refusal = validateCalendarEvent(state.data, event);
      if (refusal) return refusal;
      state.added.push(event);
      state.data = { ...state.data, events: [{ ...event, id: `cal-new-${state.added.length}` }, ...state.data.events] };
      return null;
    },
    deleteEvent: id => {
      state.deleted.push(id);
      state.data = { ...state.data, events: state.data.events.filter(event => event.id !== id) };
    },
    saveClosedDates: dates => {
      state.closures.push(dates);
      state.data = { ...state.data, closedDates: dates };
    },
  };

  let memory: AssistantMemory = {};
  let language: AssistantLanguage = 'en';
  /** The proposal that waits for Confirm, and the last thing the assistant put into the thread. */
  let open: AssistantReply | null = null;
  let last: AssistantReply | 'note' | null = null;
  /** The message the built-in reader did not understand, for the model's answer to it. */
  let pending: { message: string; reading: Reading } | null = null;

  const shown = (task: AssistantTask, lead?: string): Said => {
    const worked = answer(task, state.data);
    const reply = lead ? { ...worked, text: [lead, ...worked.text] } : worked;
    language = reply.language;
    if (task.intent !== 'help') memory = { task: reply.task, asked: reply.asked };
    // Any understood message replaces a proposal that was never confirmed.
    open = reply.proposal ? reply : null;
    last = reply;
    return { did: 'answered', reply, task };
  };

  return {
    state,
    /** True when nothing was added, cancelled, closed or reopened. */
    unchanged: () => state.added.length === 0 && state.deleted.length === 0 && state.closures.length === 0,
    /** The proposal that waits for Confirm, if any. */
    open: () => open?.proposal ?? null,
    say(message: string): Said {
      const { data } = state;
      const reading = read(message, {
        today: TODAY, services: data.services, employees: data.employees, customers: data.customers,
        expecting: memory.asked, language, waiting: Boolean(open || memory.asked),
      });
      language = reading.request.language;
      pending = null;
      const waiting = open;
      const step = turn(reading, memory, waiting?.proposal ? { kind: waiting.proposal.action.kind, last: last === waiting } : undefined);
      switch (step.kind) {
        case 'confirm': {
          const reply = confirmProposal(waiting!.proposal!, waiting!.language, data, handlers);
          memory = { task: reply.task, asked: reply.asked };
          open = null;
          last = reply;
          return { did: 'confirmed', reply };
        }
        case 'dismiss':
          memory = {};
          open = null;
          last = 'note';
          return { did: 'dismissed' };
        case 'askAgain':
          return shown(step.task, 'once more');
        case 'say':
          if (step.forget) memory = {};
          last = 'note';
          return { did: 'said' };
        case 'answer':
          return shown(step.task);
        default:
          // The panel answers "I did not understand" (or asks the model): the proposal stays open.
          pending = { message, reading };
          last = 'note';
          return { did: 'unclear' };
      }
    },
    /** The AI model's answer to the message that was just not understood, checked as the panel checks it. */
    model(raw: unknown): Said {
      if (!pending) throw new Error('the model is only asked about a message the built-in reader did not understand');
      const { data } = state;
      const checked = checkAssistantRequest(raw, {
        serviceIds: data.services.map(service => service.id), employeeIds: data.employees.map(employee => employee.id),
      }, pending.reading.request.language, pending.message);
      const task = checked ? taskFromModel(checked, pending.reading, memory) : null;
      return task ? shown(task) : { did: 'unclear' };
    },
    tap(label: string): Said {
      const choice = last && last !== 'note' ? last.choices?.find(item => item.label === label) : undefined;
      if (!choice) throw new Error(`no choice "${label}"`);
      return shown(choice.task);
    },
  };
}

/** True when the message led to a change or to a proposal of one. */
export const changes = (said: Said): boolean =>
  said.did === 'confirmed' || Boolean(said.reply?.proposal) || isChange(said.task?.intent) || isChange(said.reply?.task?.intent);

export const text = (said: Said): string => said.reply?.text.join(' ') ?? '';
export const labels = (said: Said): string[] => said.reply?.choices?.map(choice => choice.label) ?? [];
