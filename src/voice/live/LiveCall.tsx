import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Mic, RotateCcw, Square, Undo2, X } from 'lucide-react';
import type { AssistantLanguage, AssistantTask } from '../../assistant/types';
import { PRODUCT_NAME } from '../../brand';
import { LogoMark } from '../../components/Logo';
import { formatDate, zonedDateTime } from '../../format';
import { readLiveKey } from '../../liveWhatsApp';
import { LAB_LANGUAGES, type LabLanguage } from '../lab/sentences';
import type { VoiceQuestion } from '../question';
import { browserSpeech, createTranscriber, speechSupport, type SpeechEnvironment, type Transcriber } from '../transcriber';
import { askVoiceRoute, type RouteAnswer, type RouteProblem } from '../understand';
import { createCall, type Call, type CallLine, type CallState, type Understood } from './call';
import { createDesk, type Desk } from './desk';

/**
 * The live call: a page of its own (voice-call.html) where the owner presses Start, talks as on
 * the phone and sees, phrase by phrase, what was heard, what the AI reader understood and what
 * the calendar answers. Nothing in the app links to it.
 *
 * The page works on its own copy of the salon's calendar (desk.ts). Nothing is stored.
 */

/** Longer than the voice check allows: an answer that comes late is still worth seeing during a call. */
export const ANSWER_LIMIT_MS = 20_000;
/** An open microphone that nobody stops is closed after this time. */
const CALL_LIMIT_MS = 10 * 60_000;
const SLOW_START_MS = 8_000;

type ListenStatus = 'idle' | 'starting' | 'listening';

const EMPTY: CallState = { lines: [], understood: null, reply: null, proposal: 'none', canUndo: false };

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const middle = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[half] : Math.round((sorted[half - 1] + sorted[half]) / 2);
};

/** What to tell the person when listening went wrong. The first problem that needs an action wins. */
export function listeningProblem(errors: string[], wasOpened: boolean): string | null {
  const has = (code: string) => errors.includes(code);
  if (has('unsupported')) return 'This browser has no speech recognition. Please open this page in Chrome, Edge or Safari, or type the phrases below.';
  if (has('not-allowed')) return 'The browser did not allow the microphone. Allow it for this page (the icon next to the address), then press Start again.';
  if (has('audio-capture')) return 'No microphone was found. Plug one in or check the sound settings of this device.';
  if (has('service-not-allowed')) return 'The browser blocked speech recognition on this page. Check the microphone and speech settings of the browser.';
  if (has('language-not-supported')) return 'This browser cannot recognise the chosen language. Pick another one above.';
  if (has('network')) return 'The browser could not reach its speech service. Check the internet connection and press Start again.';
  if (has('start-failed') || has('keeps-closing')) return 'Listening could not start properly. Reload the page and try again.';
  if (!wasOpened && errors.length > 0) return 'Listening never began. If the browser asks about the microphone, allow it. If it does not ask, please try Chrome, Edge or Safari.';
  return null;
}

/** Why a phrase got no reading, in a few words next to the phrase. */
export function readingProblem(problem: RouteProblem): string {
  switch (problem) {
    case 'no-server': return `no ${PRODUCT_NAME} server behind this address`;
    case 'no-access': return 'the owner key was not accepted';
    case 'refused': return 'the server did not accept the text';
    case 'failed': return 'the AI service gave no usable answer';
    case 'too-slow': return `no answer within ${ANSWER_LIMIT_MS / 1000} seconds`;
    case 'offline': return 'the server could not be reached';
  }
}

const WISHES: Record<string, string> = {
  availability: 'Asks for a free time',
  book: 'Wants to book',
  cancel: 'Wants to cancel',
  appointments: 'Asks about appointments',
  hours: 'Asks about opening hours',
};

const EXAMPLE: Record<LabLanguage, string[]> = {
  en: [
    'A haircut, sure.',
    'Thursday at three in the afternoon, one moment, let me check.',
    'Three is taken, but I can offer you three thirty.',
    'And your name, please? Lea Brunner, thank you.',
    'Confirm booking.',
  ],
  de: [
    'Ein Haarschnitt, gern.',
    'Donnerstag um drei Uhr nachmittags, einen Moment, ich schaue nach.',
    'Um drei ist besetzt, aber ich kann Ihnen halb vier anbieten.',
    'Und Ihr Name, bitte? Lea Brunner, danke.',
    'Buchung bestätigen.',
  ],
};

const card = 'rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-7';
const primaryButton = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50';
const quietButton = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50';
const field = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-hidden';
const fieldLabel = 'mb-1.5 block text-sm font-semibold text-slate-800';
const chip = 'inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700';

// ---------- small parts ----------

const lineNote = (line: CallLine): { text: string; tone: 'quiet' | 'good' | 'bad' } => {
  const outcome = line.outcome;
  switch (outcome.state) {
    case 'reading': return { text: 'reading…', tone: 'quiet' };
    case 'confirmed': return { text: 'confirmation, carried out at once', tone: 'good' };
    case 'problem': return { text: `${readingProblem(outcome.problem)} (${seconds(outcome.waitMs)})`, tone: 'bad' };
    case 'read':
      if (!outcome.noted) return { text: `nothing to note (${seconds(outcome.waitMs)})`, tone: 'quiet' };
      return outcome.shown
        ? { text: `answer after ${seconds(outcome.waitMs)}`, tone: 'good' }
        : { text: `answered after ${seconds(outcome.waitMs)}, a newer answer was already shown`, tone: 'quiet' };
  }
};

const UnderstoodChips: React.FC<{ understood: Understood; desk: Desk }> = ({ understood, desk }) => {
  const request: AssistantTask = understood.request;
  const data = desk.data();
  const service = data.services.find(item => item.id === request.serviceId)?.name;
  const staff = data.employees.find(item => item.id === request.employeeId)?.name;
  const parts: [string, string][] = [
    ['What', WISHES[request.intent] ?? request.intent],
    ...(request.date ? [['Day', formatDate(request.date, { weekday: 'short' })] as [string, string]] : []),
    ...(request.time ? [['Time', request.time] as [string, string]] : []),
    ...(request.partOfDay ? [['Part of day', request.partOfDay] as [string, string]] : []),
    ...(service ? [['Service', service] as [string, string]] : []),
    ...(staff ? [['With', staff] as [string, string]] : []),
    ...(request.customerName ? [['For', understood.heardName ? `${request.customerName} (heard: ${understood.heardName})` : request.customerName] as [string, string]] : []),
  ];
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
      {parts.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-sm text-slate-500">{label}</dt>
          <dd className="text-sm font-semibold text-slate-900">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
};

// ---------- the page ----------

export interface LiveCallProps {
  /** The browser's speech recognition. Tests pass a stand-in. */
  speech?: SpeechEnvironment;
  /** Asks the AI reader. Tests pass a stand-in. */
  ask?: (question: VoiceQuestion) => Promise<RouteAnswer>;
}

export default function LiveCall({ speech, ask }: LiveCallProps) {
  const [found] = useState(() => speech ?? browserSpeech());
  const support = useMemo(() => speechSupport(found), [found]);
  const [liveKey] = useState(() => readLiveKey());
  const [language, setLanguage] = useState<LabLanguage>('en');
  const [locale, setLocale] = useState(LAB_LANGUAGES.en.locales[0].code);
  const [view, setView] = useState<CallState>(EMPTY);
  const [status, setStatus] = useState<ListenStatus>('idle');
  const [live, setLive] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [opened, setOpened] = useState(false);
  const [slow, setSlow] = useState(false);
  const [typed, setTyped] = useState('');

  const deskRef = useRef<Desk | null>(null);
  const desk = (deskRef.current ??= createDesk());
  const callRef = useRef<{ call: Call; language: AssistantLanguage } | null>(null);
  const askRef = useRef(ask);
  askRef.current = ask;
  const active = useRef<{ transcriber: Transcriber; limit: ReturnType<typeof setTimeout>; patience: ReturnType<typeof setTimeout> } | null>(null);
  const gone = useRef(false);

  const call = useCallback((): Call => {
    if (callRef.current?.language !== language) {
      callRef.current = {
        language,
        call: createCall({
          desk,
          language,
          ask: question => (askRef.current ?? (asked => askVoiceRoute(asked, liveKey ?? '', (input, init) => fetch(input, init), ANSWER_LIMIT_MS)))(question),
          onChange: next => { if (!gone.current) setView(next); },
        }),
      };
    }
    return callRef.current.call;
  }, [desk, language, liveKey]);

  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      if (active.current) {
        clearTimeout(active.current.limit);
        clearTimeout(active.current.patience);
        active.current.transcriber.abort();
      }
    };
  }, []);

  const start = () => {
    if (active.current) return;
    setErrors([]);
    setOpened(false);
    setSlow(false);
    setLive('');
    setStatus('starting');
    const heard = call();
    const transcriber = createTranscriber({ lang: locale, continuous: true }, (event) => {
      if (gone.current) return;
      switch (event.type) {
        case 'listening':
          setStatus('listening');
          setOpened(true);
          setSlow(false);
          if (active.current) clearTimeout(active.current.patience);
          break;
        case 'interim':
          setLive(event.text);
          break;
        case 'final':
          setLive('');
          heard.heard({ text: event.text, alternatives: event.alternatives.map(other => other.text) });
          break;
        case 'unfinished':
          // Words that never became a finished phrase because listening ended: still part of the call.
          setLive('');
          heard.heard({ text: event.text });
          break;
        case 'error':
          setErrors(previous => [...previous, event.code]);
          break;
        case 'stopped':
          if (active.current) {
            clearTimeout(active.current.limit);
            clearTimeout(active.current.patience);
          }
          active.current = null;
          setStatus('idle');
          setLive('');
          setSlow(false);
          break;
        default:
          break;
      }
    }, found);
    active.current = {
      transcriber,
      limit: setTimeout(() => transcriber.stop(), CALL_LIMIT_MS),
      patience: setTimeout(() => setSlow(true), SLOW_START_MS),
    };
    transcriber.start();
  };

  const stop = () => active.current?.transcriber.stop();

  const changeLanguage = (next: LabLanguage) => {
    if (status !== 'idle') return;
    setLanguage(next);
    setLocale(LAB_LANGUAGES[next].locales[0].code);
    callRef.current = null;
    setView(EMPTY);
  };

  const sendTyped = (event: React.FormEvent) => {
    event.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped('');
    call().heard({ text });
  };

  const download = () => {
    const at = zonedDateTime(new Date());
    const report = {
      kind: 'slotbee-live-call',
      version: 1,
      savedAt: new Date().toISOString(),
      language,
      locale,
      browser: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      answerLimitMs: ANSWER_LIMIT_MS,
      lines: view.lines,
      understood: view.understood,
      answer: view.reply ? { tone: view.reply.tone ?? null, text: view.reply.text, list: view.reply.list ?? [] } : null,
      proposal: view.proposal,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `live-call-${language}-${at.date}-${at.time.replace(':', '')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const pack = LAB_LANGUAGES[language];
  const problem = listeningProblem(support.recognition ? errors : ['unsupported'], opened);
  const waits = view.lines.flatMap(line => (line.outcome.state === 'read' ? [line.outcome.waitMs] : []));
  const unanswered = view.lines.filter(line => line.outcome.state === 'problem').length;
  const middleWait = middle(waits);
  const reply = view.reply;
  const times = (reply?.choices ?? []).map(choice => choice.label).filter(label => /^\d{2}:\d{2}$/.test(label));
  const options = reply?.asked === 'service' || reply?.asked === 'customerName' ? (reply.choices ?? []).map(choice => choice.label) : [];
  const waiting = reply?.proposal;
  const noServer = view.lines.some(line => line.outcome.state === 'problem' && line.outcome.problem === 'no-server');
  const noAccess = view.lines.some(line => line.outcome.state === 'problem' && line.outcome.problem === 'no-access');

  return (
    <div className="min-h-dvh bg-[#F8F9FD] px-4 py-6 sm:py-10">
      <main className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-8 w-8" />
            <span className="text-base font-bold text-slate-900">{PRODUCT_NAME}</span>
          </div>
          <a className="text-sm font-semibold text-brand hover:underline" href="voice-lab.html">Voice check</a>
        </header>

        <section className={card} aria-labelledby="live-title">
          <h1 id="live-title" className="text-2xl font-bold tracking-tight text-slate-900">Live call</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Press Start and talk as you would on the phone. You only speak your own side: repeat what the customer wants.
          </p>
          {!liveKey && (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              This browser has no owner key yet, so the AI reader will not answer. Open this page once with your owner link: the address ends with ?live= and your key.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {status === 'idle'
              ? <button type="button" className={primaryButton} onClick={start} disabled={!support.recognition}><Mic className="h-4 w-4" aria-hidden="true" />Start listening</button>
              : <button type="button" className={primaryButton} onClick={stop}><Square className="h-4 w-4" aria-hidden="true" />Stop</button>}
            <p className="text-sm text-slate-600" role="status">
              {status === 'listening' && 'Listening. Speak now.'}
              {status === 'starting' && (slow ? 'Still waiting for the microphone. If the browser asks, allow it.' : 'Opening the microphone…')}
              {status === 'idle' && view.lines.length === 0 && 'Not listening.'}
              {status === 'idle' && view.lines.length > 0 && 'Stopped. Press Start to go on with this call.'}
            </p>
          </div>
          {problem && <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{problem}</p>}

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={fieldLabel} htmlFor="live-language">Language you speak</label>
              <select id="live-language" className={field} value={language} disabled={status !== 'idle'} onChange={event => changeLanguage(event.target.value as LabLanguage)}>
                {(Object.keys(LAB_LANGUAGES) as LabLanguage[]).map(item => <option key={item} value={item}>{LAB_LANGUAGES[item].name}</option>)}
              </select>
            </div>
            <div>
              <label className={fieldLabel} htmlFor="live-locale">Variety</label>
              <select id="live-locale" className={field} value={locale} disabled={status !== 'idle'} onChange={event => setLocale(event.target.value)}>
                {pack.locales.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </div>
            <form className="sm:col-span-2" onSubmit={sendTyped}>
              <label className={fieldLabel} htmlFor="live-typed">Or type a phrase</label>
              <div className="flex gap-3">
                <input id="live-typed" className={`${field} min-w-0 flex-1`} value={typed} onChange={event => setTyped(event.target.value)} placeholder="Do you have anything free on Friday at ten for a haircut?" autoComplete="off" />
                <button type="submit" className={`${quietButton} shrink-0`} disabled={!typed.trim()}>Add phrase</button>
              </div>
            </form>
          </div>
        </section>

        {noServer && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
            This address has no {PRODUCT_NAME} server behind it, so the AI reader cannot be asked from here. Open this page on the {PRODUCT_NAME} address instead.
          </p>
        )}
        {noAccess && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
            The owner key in this browser was not accepted. Open this page once with your owner link (the address ends with ?live= and your key), then start again.
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <section className={card} aria-labelledby="heard-title">
            <h2 id="heard-title" className="text-lg font-bold text-slate-900">Heard</h2>
            {view.lines.length === 0 && !live && <p className="mt-3 text-sm text-slate-500">Nothing yet. What you say appears here, phrase by phrase.</p>}
            <ol className="mt-3 space-y-3">
              {view.lines.map((line) => {
                const note = lineNote(line);
                return (
                  <li key={line.id} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-sm font-medium text-slate-900">{line.text}</p>
                    <p className={`mt-1 text-xs ${note.tone === 'good' ? 'text-emerald-700' : note.tone === 'bad' ? 'text-rose-700' : 'text-slate-500'}`}>{note.text}</p>
                  </li>
                );
              })}
              {live && <li className="rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-500">{live}</li>}
            </ol>
          </section>

          <div className="flex flex-col gap-5">
            <section className={card} aria-labelledby="understood-title">
              <h2 id="understood-title" className="text-lg font-bold text-slate-900">Understood</h2>
              {view.understood
                ? <div className="mt-3"><UnderstoodChips understood={view.understood} desk={desk} /></div>
                : <p className="mt-3 text-sm text-slate-500">What the AI reader takes from the call so far appears here.</p>}
            </section>

            <section className={card} aria-labelledby="answer-title" aria-live="polite">
              <h2 id="answer-title" className="text-lg font-bold text-slate-900">Calendar</h2>
              {!reply && <p className="mt-3 text-sm text-slate-500">The answer from the calendar appears here.</p>}
              {reply && (
                <div className={`mt-3 rounded-xl border p-4 ${reply.tone === 'success' ? 'border-emerald-200 bg-emerald-50' : reply.tone === 'problem' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50/70'}`}>
                  {reply.text.map((line, index) => (
                    <p key={`${index}-${line}`} className={index === 0 ? 'text-base font-semibold text-slate-900' : 'mt-2 text-sm text-slate-700'}>{line}</p>
                  ))}
                  {reply.list && reply.list.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{reply.list.map(item => <li key={item}>{item}</li>)}</ul>
                  )}
                  {times.length > 0 && <ul className="mt-3 flex flex-wrap gap-2" aria-label="Free times">{times.map(time => <li key={time} className={chip}>{time}</li>)}</ul>}
                  {options.length > 0 && <ul className="mt-3 flex flex-wrap gap-2" aria-label="Choices">{options.map(option => <li key={option} className={chip}>{option}</li>)}</ul>}
                </div>
              )}
              {waiting && (
                <div className="mt-4 rounded-xl border border-slate-200 p-4">
                  <h3 className="text-sm font-bold text-slate-900">{waiting.title}</h3>
                  <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
                    {waiting.rows.map(row => (
                      <React.Fragment key={row.label}>
                        <dt className="text-sm text-slate-500">{row.label}</dt>
                        <dd className="text-sm font-semibold text-slate-900">{row.value}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                  {view.proposal === 'open' && waiting.warnings.map(warning => <p key={warning} className="mt-2 text-sm text-amber-800">{warning}</p>)}
                  {view.proposal === 'open' && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button type="button" className={primaryButton} onClick={() => call().confirm()}><Check className="h-4 w-4" aria-hidden="true" />{waiting.confirmLabel}</button>
                      <button type="button" className={quietButton} onClick={() => call().dismiss()}><X className="h-4 w-4" aria-hidden="true" />{waiting.cancelLabel}</button>
                    </div>
                  )}
                  {view.proposal === 'confirmed' && <p className="mt-3 text-sm font-semibold text-emerald-700">Done, in the calendar of this page.</p>}
                  {view.proposal === 'failed' && <p className="mt-3 text-sm font-semibold text-amber-800">Not carried out.</p>}
                  {view.proposal === 'dismissed' && <p className="mt-3 text-sm font-semibold text-slate-600">Set aside. Nothing was changed.</p>}
                </div>
              )}
              {view.canUndo && (
                <button type="button" className={`${quietButton} mt-4`} onClick={() => call().undo()}><Undo2 className="h-4 w-4" aria-hidden="true" />Take back the last change</button>
              )}
            </section>
          </div>
        </div>

        <section className={card} aria-labelledby="call-title">
          <h2 id="call-title" className="text-lg font-bold text-slate-900">This call</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-slate-500">Phrases</dt>
              <dd className="text-2xl font-bold text-slate-900">{view.lines.length}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Wait for an answer</dt>
              <dd className="text-2xl font-bold text-slate-900">{middleWait === null ? 'not measured' : seconds(middleWait)}</dd>
              <dd className="text-xs text-slate-500">middle value</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Without an answer</dt>
              <dd className="text-2xl font-bold text-slate-900">{unanswered}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className={quietButton} onClick={download} disabled={view.lines.length === 0}><Download className="h-4 w-4" aria-hidden="true" />Download this call</button>
            <button type="button" className={quietButton} onClick={() => call().clear()} disabled={view.lines.length === 0 || status !== 'idle'}><RotateCcw className="h-4 w-4" aria-hidden="true" />New call</button>
          </div>
          <p className="mt-3 text-sm text-slate-500">The file holds the phrases, the readings and the waiting times of this call, so they can be sent to the team.</p>
        </section>
        <section className={card} aria-labelledby="about-title">
          <h2 id="about-title" className="text-lg font-bold text-slate-900">How this page works</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            After each phrase this page shows what was heard, what the AI reader understood and what the calendar says.
            The AI reader only notes what the call is about. Whether a time is free is decided by the booking rules of the calendar,
            and nothing is entered before you say &quot;confirm booking&quot; or press Confirm.
          </p>
          <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">Lines to try</summary>
            <ol lang={language} className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
              {EXAMPLE[language].map(line => <li key={line}>{line}</li>)}
            </ol>
            <p className="mt-3 text-sm text-slate-500">Pause for a moment between the lines. The days and times are yours to choose: the answers come from the calendar.</p>
          </details>
          <p className="mt-4 text-sm leading-6 text-slate-500">
            The sound goes to the speech service of your browser (Google for Chrome, Apple for Safari). Only the written phrases go on:
            to the {PRODUCT_NAME} server, and from there to Google&apos;s AI service Gemini, together with the names of the salon&apos;s services and team.
            The customer list and the calendar stay in this page. This page works on its own copy of the salon&apos;s calendar:
            an appointment entered here appears nowhere else and is gone when the page is reloaded.
          </p>
        </section>
      </main>
    </div>
  );
}
