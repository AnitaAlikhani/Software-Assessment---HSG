import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Send, Sparkles, X } from 'lucide-react';
import type { AvailabilityContext } from '../availability';
import { taskFromModel, turn, type AssistantMemory } from '../assistant/conversation';
import {
  answer,
  askAgain,
  assistantExamples,
  confirmProposal,
  helpReply,
  smallTalk,
  type AssistantChoice,
  type AssistantData,
  type AssistantReply,
} from '../assistant/execute';
import { read } from '../assistant/interpret';
import { askAssistantRoute, assistantQuestion } from '../assistant/remote';
import { checkAssistantRequest, MAX_ASSISTANT_MESSAGE, type AssistantLanguage, type AssistantTask } from '../assistant/types';
import { readLiveKey } from '../liveWhatsApp';
import { getSalonNow } from '../scheduling';
import type { CalendarEvent, ClosedDate, Customer } from '../types';

interface AssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** The salon's data, the same object the Calendar and the booking page give to the booking rules. */
  salon: AvailabilityContext;
  customers: Customer[];
  /** The Calendar page's own "add appointment": returns the rules' refusal, or null. */
  onAddEvent: (event: Omit<CalendarEvent, 'id'>) => string | null;
  /** The Calendar page's own "cancel appointment". */
  onDeleteEvent: (id: string) => void;
  /** The setter Company Settings uses for closed dates. */
  onSaveClosedDates: (dates: ClosedDate[]) => void;
  onOpenCalendar: (date: string) => void;
  /**
   * Called after the assistant ran a change and reported it in its thread, so the page can drop
   * its own notice about the same change (it would say it twice and cover the input).
   */
  onResultShown?: () => void;
  /** Tests pass a fixed clock. */
  clock?: () => Date;
  /**
   * Whether a message the built-in reader cannot understand goes to the AI model. That needs
   * live access; when not given, it is worked out from the stored key.
   */
  usesAiModel?: boolean;
}

type ProposalState = 'open' | 'confirmed' | 'dismissed' | 'failed';
type ThreadItem =
  | { id: number; from: 'owner'; text: string }
  | { id: number; from: 'assistant'; reply: AssistantReply; proposal?: ProposalState };

/** Wide screens dock the assistant at the right edge; this is how wide it is there. */
const DOCK_WIDTH = 420;
/** The same width as Tailwind's `xl`, which hides the word "Close" beside the X when docked. */
const DOCKED_QUERY = '(min-width: 80rem)';
/**
 * From this width the page keeps a usable layout beside the menu and the drawer, so room is
 * reserved for the drawer. On smaller laptops (1280 to 1439 px) reserving 420 px would squeeze
 * the page to about 600 px while it still uses its laptop layout (cut figures on Home, a chat
 * list of initials), so there the drawer lies over the right part of the page instead.
 */
const ROOM_QUERY = '(min-width: 90rem)';

const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
};

const PROPOSAL_STATE: Record<Exclude<ProposalState, 'open'>, Record<AssistantLanguage, string>> = {
  confirmed: { en: 'Confirmed', de: 'Bestätigt' },
  dismissed: { en: 'Not confirmed', de: 'Nicht bestätigt' },
  failed: { en: 'Not done', de: 'Nicht ausgeführt' },
};

const chip = 'inline-flex min-h-11 items-center rounded-xl border border-[#5551FF]/20 bg-[#5551FF]/8 px-3 py-1.5 text-left text-sm font-medium text-[#5551FF] transition-colors hover:bg-[#5551FF]/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]';

/**
 * The owner assistant: a chat beside the page that answers from the salon's own data and
 * prepares changes to the calendar. It asks the booking rules, never guesses, and changes
 * nothing before the owner presses Confirm. The thread lives while the app is open.
 */
export const AssistantPanel: React.FC<AssistantPanelProps> = (props) => {
  const { isOpen, onClose } = props;
  const docked = useMediaQuery(DOCKED_QUERY);
  const hasRoom = useMediaQuery(ROOM_QUERY);
  // Read again each time the panel opens, since the key can arrive with the address later.
  const usesAiModel = useMemo(() => props.usesAiModel ?? Boolean(readLiveKey()), [props.usesAiModel, isOpen]);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const memory = useRef<AssistantMemory>({});
  const language = useRef<AssistantLanguage>('en');
  const nextId = useRef(1);
  /** Proposals already answered, so a quick second tap cannot run one twice. */
  const answered = useRef(new Set<number>());
  // The route's answer arrives later; by then the props may be newer than the ones this render saw.
  const latest = useRef(props);
  latest.current = props;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  // Remember what had focus when the panel opened, and give it back when the panel closes.
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (!isOpen && wasOpen.current) {
      // Some browsers do not focus a button on click; then the header button is found by its id.
      const target = opener.current?.isConnected && opener.current !== document.body
        ? opener.current : document.getElementById('assistant-trigger');
      opener.current = null;
      target?.focus({ preventScroll: true });
    }
    wasOpen.current = isOpen;
  }, [isOpen]);

  // Wide screens: a drawer at the right edge. Where the window is wide enough the page keeps its
  // full use: room is reserved for the drawer instead of covering the right part of the page.
  useEffect(() => {
    if (!isOpen || !docked) return;
    const previous = document.body.style.paddingRight;
    if (hasRoom) document.body.style.paddingRight = `${DOCK_WIDTH}px`;
    // For anything fixed to the right edge of the window that wants to stay clear of the drawer.
    document.documentElement.style.setProperty('--assistant-dock', `${DOCK_WIDTH}px`);
    return () => {
      document.body.style.paddingRight = previous;
      document.documentElement.style.removeProperty('--assistant-dock');
    };
  }, [isOpen, docked, hasRoom]);

  // Docked, the drawer is not a dialog, so the browser does not move focus into it by itself.
  useEffect(() => {
    if (isOpen && docked) inputRef.current?.focus({ preventScroll: true });
  }, [isOpen, docked]);

  // Phones and tablets: a sheet over the page, as a native dialog (focus stays inside, Escape closes).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || docked || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    // Focus the title, not the input: the on-screen keyboard would hide the examples.
    titleRef.current?.focus({ preventScroll: true });
    // A Back gesture or "Open calendar" changes the page behind the sheet: get out of the way.
    const closeOnNavigation = () => latest.current.onClose();
    window.addEventListener('hashchange', closeOnNavigation);
    return () => {
      window.removeEventListener('hashchange', closeOnNavigation);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, docked]);

  // Touch screens: keep the input above the on-screen keyboard. The panel follows the part of the
  // screen that is still visible, instead of leaving its lower end behind the keyboard.
  useEffect(() => {
    const panel = docked ? asideRef.current : dialogRef.current;
    const viewport = window.visualViewport;
    if (!isOpen || !panel || !viewport) return;
    const fit = () => {
      const keyboardOpen = viewport.scale === 1 && viewport.height < window.innerHeight - 1;
      panel.style.height = keyboardOpen ? `${viewport.height}px` : '';
      panel.style.top = keyboardOpen ? `${viewport.offsetTop}px` : '';
      // The thread just got shorter: keep its newest message in view.
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    };
    viewport.addEventListener('resize', fit);
    viewport.addEventListener('scroll', fit);
    return () => {
      viewport.removeEventListener('resize', fit);
      viewport.removeEventListener('scroll', fit);
      panel.style.height = '';
      panel.style.top = '';
    };
  }, [isOpen, docked]);

  // Keep the newest message in view.
  useEffect(() => {
    const pane = scrollRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [thread.length, busy, isOpen, docked]);

  const salonData = (): AssistantData => ({
    ...latest.current.salon,
    customers: latest.current.customers,
    now: (latest.current.clock ?? (() => new Date()))(),
  });
  /**
   * A pressed button (Confirm, a choice) disappears with the answer, and the focus with it.
   * Beside the page it goes to the input; on a phone to the thread, so the keyboard stays down.
   */
  const keepFocus = () => {
    requestAnimationFrame(() => (docked ? inputRef.current : scrollRef.current)?.focus({ preventScroll: true }));
  };
  const ownerSaid = (text: string): ThreadItem => ({ id: nextId.current++, from: 'owner', text });
  const assistantSaid = (reply: AssistantReply): ThreadItem => ({
    id: nextId.current++, from: 'assistant', reply, proposal: reply.proposal ? 'open' : undefined,
  });
  /** A new request replaces a proposal that was never confirmed: only one change can wait at a time. */
  const supersede = (items: ThreadItem[]): ThreadItem[] => items.map(item =>
    item.from === 'assistant' && item.proposal === 'open' ? { ...item, proposal: 'dismissed' as const } : item);

  /**
   * Working out an answer changes nothing, so if it ever fails on unexpected data the owner gets
   * a plain sentence instead of a panel that silently does nothing.
   */
  const respond = (task: AssistantTask, data: AssistantData): AssistantReply => {
    try {
      return answer(task, data);
    } catch (error) {
      console.error(error);
      return {
        language: task.language, tone: 'problem',
        text: [task.language === 'de' ? 'Das konnte ich nicht ausrechnen. Es wurde nichts geändert.' : 'I could not work that out. Nothing was changed.'],
      };
    }
  };

  const run = (task: AssistantTask, said: ThreadItem, lead?: string) => {
    const worked = respond(task, salonData());
    const reply = lead ? { ...worked, text: [lead, ...worked.text] } : worked;
    const item = assistantSaid(reply);
    language.current = reply.language;
    if (task.intent !== 'help') memory.current = { task: reply.task, asked: reply.asked };
    setThread(previous => [...supersede(previous), said, item]);
  };

  const confirm = (item: Extract<ThreadItem, { from: 'assistant' }>, said?: ThreadItem) => {
    const proposal = item.reply.proposal;
    if (!proposal || answered.current.has(item.id)) return;
    answered.current.add(item.id);
    const current = latest.current;
    // The same handlers the Calendar page and Company Settings call.
    const reply = confirmProposal(proposal, item.reply.language, salonData(), {
      addEvent: current.onAddEvent,
      deleteEvent: current.onDeleteEvent,
      saveClosedDates: current.onSaveClosedDates,
    });
    const result = assistantSaid(reply);
    memory.current = { task: reply.task, asked: reply.asked };
    setThread(previous => [
      ...previous.map(other => other.id === item.id ? { ...item, proposal: reply.tone === 'success' ? 'confirmed' as const : 'failed' as const } : other),
      ...(said ? [said] : []),
      result,
    ]);
    current.onResultShown?.();
    keepFocus();
  };

  const dismiss = (item: Extract<ThreadItem, { from: 'assistant' }>, said?: ThreadItem) => {
    if (answered.current.has(item.id)) return;
    answered.current.add(item.id);
    const note = assistantSaid(smallTalk(item.reply.language, 'dismissed'));
    memory.current = {};
    setThread(previous => [
      ...previous.map(other => other.id === item.id ? { ...item, proposal: 'dismissed' as const } : other),
      ...(said ? [said] : []),
      note,
    ]);
    keepFocus();
  };

  const send = async (raw: string) => {
    const text = raw.trim().slice(0, MAX_ASSISTANT_MESSAGE);
    if (!text || busy) return;
    setDraft('');
    const said = ownerSaid(text);
    const data = salonData();
    const today = getSalonNow(data.timeZone, data.now).date;
    const open = thread.find((item): item is Extract<ThreadItem, { from: 'assistant' }> =>
      item.from === 'assistant' && item.proposal === 'open');
    const reading = read(text, {
      today, services: data.services, employees: data.employees, customers: data.customers,
      expecting: memory.current.asked, language: language.current,
      waiting: Boolean(open || memory.current.asked),
    });
    const heard = reading.request;
    language.current = heard.language;

    // What the message means here is decided in one place (turn), for the panel and the tests alike.
    const step = turn(reading, memory.current, open?.reply.proposal
      ? { kind: open.reply.proposal.action.kind, last: thread.at(-1)?.id === open.id } : undefined);
    if (open && step.kind === 'confirm') { confirm(open, said); return; }
    if (open && step.kind === 'dismiss') { dismiss(open, said); return; }
    if (step.kind === 'askAgain') {
      run(step.task, said, heard.language === 'de' ? 'Damit ich das Richtige ausführe, hier noch einmal:' : 'To be sure I act on the right thing, here it is once more:');
      return;
    }
    if (step.kind === 'say') {
      if (step.forget) memory.current = {};
      const note = assistantSaid(smallTalk(heard.language, step.note));
      setThread(previous => [...previous, said, note]);
      return;
    }
    /** Not understood: repeat the open question if there is one, otherwise show what can be asked. */
    const notUnderstood = (current: AssistantData): AssistantReply => {
      const { task: pending, asked } = memory.current;
      return pending && asked ? askAgain(pending, heard.language, current) : helpReply(heard.language, current, false);
    };

    let task = step.kind === 'answer' ? step.task : null;
    // A bare "yes" or "no" is never sent anywhere to be understood.
    const liveKey = task || heard.reply ? null : readLiveKey();
    if (!task && liveKey) {
      // The built-in interpreter could not read it and the owner has live access: let the model
      // fill in the same request. Its answer is checked like any outside input before use.
      setThread(previous => [...previous, said]);
      setBusy(true);
      const question = assistantQuestion(text, { today, timeZone: data.timeZone, language: heard.language, services: data.services, employees: data.employees });
      const raw = await askAssistantRoute(question, liveKey);
      setBusy(false);
      const fresh = salonData();
      const checked = checkAssistantRequest(raw, {
        serviceIds: fresh.services.map(service => service.id),
        employeeIds: fresh.employees.map(employee => employee.id),
      }, heard.language, text);
      // How the message was put still counts: a question stays a question whatever the model made of it.
      task = checked ? taskFromModel(checked, reading, memory.current) : null;
      const reply = task ? respond(task, fresh) : notUnderstood(fresh);
      const item = assistantSaid(reply);
      const understood = Boolean(task);
      language.current = reply.language;
      if (task && task.intent !== 'help') memory.current = { task: reply.task, asked: reply.asked };
      setThread(previous => [...(understood ? supersede(previous) : previous), item]);
      return;
    }
    if (task) { run(task, said); return; }
    const note = assistantSaid(notUnderstood(data));
    setThread(previous => [...previous, said, note]);
  };

  const sendExample = (example: string) => {
    void send(example);
    keepFocus();
  };

  const choose = (choice: AssistantChoice) => {
    if (busy) return;
    run(choice.task, ownerSaid(choice.label));
    keepFocus();
  };

  const openCalendar = (date: string) => {
    props.onOpenCalendar(date);
    // Where the assistant covers the calendar (a phone's sheet, or the drawer on a smaller
    // laptop) it closes; with room beside the page it can stay.
    if (!docked || !hasRoom) onClose();
  };

  if (!isOpen) return null;

  const examples = assistantExamples('en', props.salon.services);
  const lastId = thread.at(-1)?.id;

  const renderReply = (item: Extract<ThreadItem, { from: 'assistant' }>) => {
    const { reply } = item;
    const de = reply.language === 'de';
    const isLast = item.id === lastId && !busy;
    const tone = reply.tone === 'success' ? 'border border-emerald-200 bg-emerald-50 text-emerald-950'
      : reply.tone === 'problem' ? 'border border-amber-200 bg-amber-50 text-slate-800'
      : 'bg-slate-100 text-slate-800';
    return (
      <div key={item.id} lang={reply.language} className="min-w-0 space-y-2">
        <div className={`w-fit max-w-full rounded-2xl px-4 py-2.5 text-sm leading-snug [overflow-wrap:anywhere] ${tone}`}>
          {reply.text.map((paragraph, index) => (
            <p key={index} className={index > 0 ? 'mt-1.5' : undefined}>
              {index === 0 && <span className="sr-only">Assistant: </span>}
              {index === 0 && reply.tone === 'success' && <CheckCircle2 className="mr-1.5 inline h-4 w-4 align-text-bottom text-emerald-600" aria-hidden="true" />}
              {paragraph}
            </p>
          ))}
          {reply.list && reply.list.length > 0 && (
            <ul className="mt-2 space-y-1 tabular-nums">
              {reply.list.map((line, index) => <li key={index} className="rounded-lg bg-white/70 px-2.5 py-1.5 text-xs">{line}</li>)}
            </ul>
          )}
        </div>

        {reply.proposal && (
          <section aria-label={reply.proposal.title} className="space-y-3 rounded-2xl border border-[#5551FF]/30 bg-indigo-50 p-4">
            <h3 className="text-sm font-bold text-slate-900">{reply.proposal.title}</h3>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              {reply.proposal.rows.map(row => (
                <React.Fragment key={row.label}>
                  <dt className="text-slate-500">{row.label}</dt>
                  <dd className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{row.value}</dd>
                </React.Fragment>
              ))}
            </dl>
            {reply.proposal.warnings.map(warning => (
              <p key={warning} className="flex gap-2 rounded-xl border border-amber-300/70 bg-amber-50 p-2.5 text-xs leading-snug text-amber-950">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{warning}</span>
              </p>
            ))}
            {item.proposal === 'open' ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => confirm(item)}
                  className="min-h-11 flex-1 rounded-xl bg-[#5551FF] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#433fd8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
                  {reply.proposal.confirmLabel}
                </button>
                <button type="button" onClick={() => dismiss(item)}
                  className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
                  {reply.proposal.cancelLabel}
                </button>
              </div>
            ) : item.proposal && (
              <p className="text-xs font-semibold text-slate-500">{PROPOSAL_STATE[item.proposal][reply.language]}</p>
            )}
          </section>
        )}

        {/* Answers to tap belong to the newest message only; older ones would act on an old question. */}
        {isLast && reply.choices && reply.choices.length > 0 && (
          <div role="group" aria-label={de ? 'Antworten zum Antippen' : 'Answers to tap'} className="flex flex-wrap gap-2">
            {reply.choices.map((choice, index) => (
              <button key={`${choice.label}-${index}`} type="button" onClick={() => choose(choice)} className={`${chip} tabular-nums`}>{choice.label}</button>
            ))}
          </div>
        )}
        {isLast && reply.examples && (
          <div role="group" aria-label={de ? 'Beispiele' : 'Examples'} className="flex flex-col items-start gap-2">
            {reply.examples.map(example => (
              <button key={example} type="button" onClick={() => sendExample(example)} className={chip}>{example}</button>
            ))}
          </div>
        )}
        {reply.calendar && (
          <button type="button" onClick={() => openCalendar(reply.calendar!.date)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
            <CalendarDays className="h-4 w-4 text-[#5551FF]" aria-hidden="true" />
            {reply.calendar.label}
          </button>
        )}
      </div>
    );
  };

  const content = (
    <>
      <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 py-3 sm:py-3.5">
        <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5551FF] text-white">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="assistant-title" ref={titleRef} tabIndex={-1} className="text-base font-bold text-slate-900 focus:outline-hidden">Assistant</h2>
          <p id="assistant-about" className="text-xs leading-snug text-slate-500">Free times, bookings and closed days.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close assistant"
          className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
          <X className="h-5 w-5" aria-hidden="true" />
          <span className="xl:hidden">Close</span>
        </button>
      </div>

      {/* Focusable, so the thread can be scrolled with the keyboard. */}
      <div ref={scrollRef} role="log" aria-live="polite" aria-label="Conversation with the assistant" tabIndex={0}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5551FF]/40">
        {thread.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm leading-snug text-slate-600">
              Write what you need, in English or German. Nothing changes in the calendar until you press Confirm. For example:
            </p>
            <div role="group" aria-label="Examples" className="flex flex-col items-start gap-2">
              {examples.map(example => (
                <button key={example} type="button" onClick={() => sendExample(example)} className={chip}>{example}</button>
              ))}
            </div>
            {/* The owner types customers' names here, so the one case in which a message leaves the app is said up front. */}
            {usesAiModel && (
              <p className="text-xs leading-snug text-slate-500">
                A message I cannot read myself is sent to Google's AI service Gemini to be understood, together with the names of your services and staff. Your calendar and your customer list are never sent.
              </p>
            )}
          </div>
        )}
        {thread.map(item => item.from === 'owner' ? (
          <div key={item.id} className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl bg-[#5551FF] px-4 py-2.5 text-sm font-medium leading-snug text-white [overflow-wrap:anywhere]">
              <span className="sr-only">You: </span>{item.text}
            </p>
          </div>
        ) : renderReply(item))}
        {busy && <p role="status" className="w-fit rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-500">{language.current === 'de' ? 'Einen Moment …' : 'One moment …'}</p>}
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void send(draft); }}
        className="flex shrink-0 items-center gap-2 border-t border-slate-100 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)}
          aria-label="Message to the assistant" placeholder="Ask, or say what to do" maxLength={MAX_ASSISTANT_MESSAGE}
          enterKeyHint="send" autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-full border border-transparent bg-slate-100 px-4 py-2.5 text-base text-slate-800 placeholder-slate-400 focus:border-[#5551FF]/40 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#5551FF]/15" />
        <button type="submit" disabled={!draft.trim() || busy} aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#5551FF] text-white transition-colors hover:bg-[#433fd8] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </>
  );

  if (docked) {
    return (
      <aside ref={asideRef} aria-labelledby="assistant-title" aria-describedby="assistant-about" style={{ width: DOCK_WIDTH }}
        onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); } }}
        className="fixed inset-y-0 right-0 z-30 flex max-w-full flex-col border-l border-slate-200 bg-white text-slate-800 shadow-xl">
        {content}
      </aside>
    );
  }
  return (
    <dialog ref={dialogRef} aria-labelledby="assistant-title" aria-describedby="assistant-about"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-none flex-col border-0 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-900/40 open:flex sm:w-[420px]">
      {content}
    </dialog>
  );
};
