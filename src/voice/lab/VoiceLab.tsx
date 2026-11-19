import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Mic, RotateCcw, Square, X } from 'lucide-react';
import { LogoMark } from '../../components/Logo';
import { PRODUCT_NAME } from '../../brand';
import {
  browserSpeech, createTranscriber, installOnDevice, onDeviceState, speechSupport,
  type OnDeviceState, type SpeechEnvironment, type Transcriber, type TranscriberOptions,
} from '../transcriber';
import {
  attemptFrom, buildReport, heardText, reportFileName, summarise, talkFrom,
  type Attempt, type LabSettings, type Microphone, type Noise, type Recording, type TalkRecord, type Variety,
} from './report';
import type { KeyItem, SentenceScore } from './score';
import { LAB_LANGUAGES, type LabLanguage } from './sentences';

/**
 * The voice check: a page of its own where people on the team read set sentences aloud and see
 * what their browser heard. It answers one question before the listening feature is built: is
 * the browser's own speech recognition good enough for our voices, rooms and languages?
 *
 * Nothing is stored. The results stay on this page until the person copies or downloads them.
 */

/** A sentence that gets no finished text within this time is ended, so nobody waits in front of a silent page. */
const SENTENCE_LIMIT_MS = 15_000;
const TALK_LIMIT_MS = 90_000;
/** The first Start makes the browser ask for the microphone. The limits above only count once it is open. */
const WAIT_FOR_MICROPHONE_MS = 60_000;
/** A microphone that is not open after this time gets a word of advice. */
const SLOW_START_MS = 8_000;

type Phase = 'setup' | 'sentences' | 'talk' | 'results';
type ListenStatus = 'idle' | 'starting' | 'listening';

const seconds = (ms: number | null): string => (ms === null ? 'not measured' : `${(ms / 1000).toFixed(1)} s`);
const share = (found: number, total: number): string => (total === 0 ? 'none' : `${Math.round((found / total) * 100)}%`);

/** Whether the engine ever opened the microphone during a try. */
export const opened = (events: { name: string }[]): boolean => events.some(event => event.name === 'start');

/**
 * What to tell the person when listening went wrong. The first problem that needs an action wins.
 * "wasOpened" is false when the engine never opened the microphone and gave no reason: some
 * browsers have the speech feature but no speech service behind it.
 */
export function problemText(errors: string[], onDevice: boolean, wasOpened = true): string | null {
  const has = (code: string) => errors.includes(code);
  if (has('unsupported')) return 'This browser has no speech recognition. Please open this page in Chrome, Edge or Safari.';
  if (has('not-allowed')) return 'The browser did not allow the microphone. Allow it for this page (the icon next to the address), then press Start again.';
  if (has('audio-capture')) return 'No microphone was found. Plug one in or check the sound settings of this device.';
  if (has('service-not-allowed')) {
    return onDevice
      ? 'The language pack for recognising on this device is not installed. Download it under More options, or switch that option off.'
      : 'The browser blocked speech recognition on this page. Check the microphone and speech settings of the browser.';
  }
  if (has('language-not-supported')) return 'This browser cannot recognise the chosen language. Pick another one under More options.';
  if (has('network')) return 'The browser could not reach its speech service. Check the internet connection and try again.';
  if (has('start-failed') || has('keeps-closing')) return 'Listening could not start properly. Reload the page and try again.';
  if (has('no-speech')) return 'Nothing was heard. Check that the right microphone is in use, and speak right after pressing Start.';
  if (!wasOpened) return 'Listening never began. If the browser asks about the microphone, allow it. If it does not ask, this browser may have no working speech service: please try Chrome, Edge or Safari.';
  return null;
}

// ---------- listening ----------

/**
 * Opens the microphone through the transcriber and gathers what happens until listening ends.
 * The page gets one Recording per press of Start.
 */
function useListening(speech: SpeechEnvironment | undefined) {
  const [status, setStatus] = useState<ListenStatus>('idle');
  const [live, setLive] = useState('');
  const [heard, setHeard] = useState('');
  const [slow, setSlow] = useState(false);
  const active = useRef<{ transcriber: Transcriber; limit: ReturnType<typeof setTimeout>; patience: ReturnType<typeof setTimeout> } | null>(null);
  const gone = useRef(false);

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

  const start = useCallback((options: TranscriberOptions, limitMs: number, done: (recording: Recording) => void) => {
    if (active.current) return;
    const began = performance.now();
    const at = () => Math.round(performance.now() - began);
    const recording: Recording = { startedAt: new Date().toISOString(), events: [], finals: [], alternatives: [], interimCount: 0, errors: [], durationMs: 0 };
    let timed = false;
    setLive('');
    setHeard('');
    setSlow(false);
    setStatus('starting');
    const transcriber = createTranscriber(options, (event) => {
      if (gone.current) return;
      switch (event.type) {
        case 'engine':
          recording.events.push({ ms: at(), name: event.name });
          break;
        case 'listening':
          setStatus('listening');
          // In a call the engine opens several times: the limit runs from the first opening.
          if (!timed && active.current) {
            timed = true;
            clearTimeout(active.current.limit);
            clearTimeout(active.current.patience);
            active.current.limit = setTimeout(() => transcriber.stop(), limitMs);
          }
          setSlow(false);
          break;
        case 'interim':
          recording.events.push({ ms: at(), name: 'interim' });
          recording.interimCount += 1;
          setLive(event.text);
          break;
        case 'final': {
          const ms = at();
          recording.events.push({ ms, name: 'final' });
          recording.finals.push({ ms, text: event.text });
          recording.alternatives = event.alternatives;
          setLive('');
          setHeard(heardText(recording));
          break;
        }
        case 'error':
          recording.events.push({ ms: at(), name: `error:${event.code}` });
          recording.errors.push(event.code);
          break;
        case 'stopped':
          if (active.current) {
            clearTimeout(active.current.limit);
            clearTimeout(active.current.patience);
          }
          active.current = null;
          recording.durationMs = at();
          setStatus('idle');
          setLive('');
          setSlow(false);
          done(recording);
          break;
      }
    }, speech);
    active.current = {
      transcriber,
      limit: setTimeout(() => transcriber.stop(), WAIT_FOR_MICROPHONE_MS),
      patience: setTimeout(() => setSlow(true), SLOW_START_MS),
    };
    transcriber.start();
  }, [speech]);

  const stop = useCallback(() => active.current?.transcriber.stop(), []);

  return { status, live, heard, slow, start, stop };
}

// ---------- small parts ----------

const card = 'rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-7';
const primaryButton = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50';
const quietButton = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50';
const field = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-hidden';
const fieldLabel = 'mb-1.5 block text-sm font-semibold text-slate-800';

/** The details of a sentence, each marked as heard or missing. */
const KeyChips: React.FC<{ keys: KeyItem[]; score: SentenceScore }> = ({ keys, score }) => (
  <ul className="flex flex-wrap gap-2">
    {keys.map((item, index) => {
      const found = score.found[index] === true;
      return (
        <li
          key={item.label}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${found ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
        >
          {found ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
          <span>{item.label}</span>
          <span className="sr-only">{found ? 'heard' : 'missing'}</span>
        </li>
      );
    })}
  </ul>
);

/** Start and Stop, and the words as they arrive. */
const ListenBox: React.FC<{
  status: ListenStatus;
  live: string;
  heard: string;
  onStart: () => void;
  onStop: () => void;
  startLabel: string;
  /** After a first try the way on is the main action, and starting again steps back. */
  again?: boolean;
  /** The microphone has not opened for a while. */
  slow?: boolean;
}> = ({ status, live, heard, onStart, onStop, startLabel, again = false, slow = false }) => (
  <div className="space-y-4">
    {status === 'idle' ? (
      <button type="button" onClick={onStart} className={again ? quietButton : primaryButton}>
        <Mic className="h-5 w-5" aria-hidden="true" />
        {startLabel}
      </button>
    ) : (
      <button type="button" onClick={onStop} className={`${primaryButton} bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600`}>
        <Square className="h-4 w-4" aria-hidden="true" />
        Stop
      </button>
    )}
    <div aria-live="polite" className="min-h-16 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-base text-slate-900">
      {status === 'starting' && <p className="text-sm text-slate-500">Opening the microphone. The browser may ask for permission.</p>}
      {status === 'starting' && slow && (
        <p className="mt-1 text-sm font-medium text-amber-800">
          Still waiting. If the browser shows a question about the microphone, allow it. If nothing happens, press Stop: this browser may have no working speech service, so try Chrome, Edge or Safari.
        </p>
      )}
      {status === 'listening' && !live && !heard && <p className="text-sm font-medium text-brand">Listening. Speak now.</p>}
      {heard && <p>{heard}</p>}
      {live && <p className="text-slate-500">{live}</p>}
      {status === 'idle' && !heard && <p className="text-sm text-slate-500">What the browser hears shows here.</p>}
    </div>
  </div>
);

const Steps: React.FC<{ phase: Phase }> = ({ phase }) => {
  const steps: { id: Phase; label: string }[] = [
    { id: 'setup', label: 'Set up' },
    { id: 'sentences', label: 'Sentences' },
    { id: 'talk', label: 'Short call' },
    { id: 'results', label: 'Results' },
  ];
  const current = steps.findIndex(step => step.id === phase);
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
      {steps.map((step, index) => (
        <li key={step.id} aria-current={index === current ? 'step' : undefined} className={index === current ? 'text-brand' : index < current ? 'text-slate-700' : ''}>
          {index + 1}. {step.label}
        </li>
      ))}
    </ol>
  );
};

// ---------- the page ----------

const firstSettings = (): LabSettings => ({
  label: '',
  language: 'en',
  locale: LAB_LANGUAGES.en.locales[0].code,
  variety: 'standard',
  noise: 'quiet',
  microphone: 'built-in',
  onDevice: false,
  boost: false,
});

export default function VoiceLab({ speech }: { speech?: SpeechEnvironment }) {
  const [found] = useState(() => speech ?? browserSpeech());
  const support = useMemo(() => speechSupport(found), [found]);
  const [settings, setSettings] = useState<LabSettings>(firstSettings);
  const [phase, setPhase] = useState<Phase>('setup');
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Record<string, Attempt[]>>({});
  const [talk, setTalk] = useState<TalkRecord | null>(null);
  const [device, setDevice] = useState<OnDeviceState | 'checking' | 'installing' | null>(null);
  const [exported, setExported] = useState<'copied' | 'downloaded' | 'manual' | null>(null);
  const listening = useListening(found);

  const pack = LAB_LANGUAGES[settings.language];
  const sentence = pack.sentences[Math.min(index, pack.sentences.length - 1)];
  const tries = attempts[sentence.id] ?? [];
  const last = tries.at(-1);
  /** Something was heard: the way on becomes the main action. After a failed try, starting again stays it. */
  const sentenceDone = Boolean(last?.heard);
  const talkDone = Boolean(talk?.heard);
  const busy = listening.status !== 'idle';
  const options: TranscriberOptions = { lang: settings.locale, onDevice: settings.onDevice, boost: settings.boost ? pack.boost : undefined };

  const change = <Key extends keyof LabSettings>(name: Key, value: LabSettings[Key]) => setSettings(previous => ({ ...previous, [name]: value }));
  const chooseLanguage = (language: LabLanguage) => {
    setSettings(previous => ({ ...previous, language, locale: LAB_LANGUAGES[language].locales[0].code, variety: 'standard' }));
    setDevice(null);
  };

  const begin = () => {
    setAttempts({});
    setTalk(null);
    setIndex(0);
    setExported(null);
    setPhase('sentences');
  };
  const startSentence = () => listening.start(options, SENTENCE_LIMIT_MS, (recording) => {
    const attempt = attemptFrom(sentence, recording);
    setAttempts(previous => ({ ...previous, [sentence.id]: [...(previous[sentence.id] ?? []), attempt] }));
  });
  const next = () => {
    if (index + 1 < pack.sentences.length) setIndex(index + 1);
    else setPhase('talk');
  };
  const startTalk = () => listening.start({ ...options, continuous: true }, TALK_LIMIT_MS, recording => setTalk(talkFrom(pack.talk, recording)));

  const checkDevice = async () => {
    setDevice('checking');
    setDevice(await onDeviceState(settings.locale, found));
  };
  const downloadPack = async () => {
    setDevice('installing');
    setDevice((await installOnDevice(settings.locale, found)) ? 'available' : 'unavailable');
  };

  const report = () => buildReport({
    createdAt: new Date().toISOString(),
    browser: {
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      languages: typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? [])],
    },
    support,
    settings,
    sentences: pack.sentences,
    attempts,
    script: pack.talk,
    talk,
  });
  const copyResults = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report(), null, 1));
      setExported('copied');
    } catch {
      // No clipboard access (an older browser, or a page that is not in front): show the text to copy by hand.
      setExported('manual');
    }
  };
  const downloadResults = () => {
    const current = report();
    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 1)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = reportFileName(current);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported('downloaded');
  };

  const summary = summarise(pack.sentences, attempts);

  return (
    <main className="min-h-screen bg-[#F8F9FD] px-4 py-6 text-slate-800 sm:py-10">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <LogoMark className="h-6 w-6" />
            {PRODUCT_NAME}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Voice check</h1>
          <Steps phase={phase} />
        </header>

        {!support.recognition && (
          <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">This browser has no speech recognition.</p>
            <p className="mt-1">Please open this page in Chrome, Edge or Safari on a laptop or tablet.</p>
          </div>
        )}

        {phase === 'setup' && (
          <section className={`${card} space-y-6`} aria-labelledby="setup-title">
            <div className="space-y-2">
              <h2 id="setup-title" className="text-lg font-bold text-slate-900">Before you start</h2>
              <p className="text-sm text-slate-600">
                We want to know how well a browser hears booking details: a day, a time, a service, a name.
                You read {pack.sentences.length} short sentences aloud, then one short call. It takes about five minutes.
              </p>
              <p className="text-sm text-slate-600">
                Speak the way you would on the phone in the salon. Do not slow down or raise your voice for the computer.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="lab-language" className={fieldLabel}>Language you will speak</label>
                <select id="lab-language" className={field} value={settings.language} onChange={event => chooseLanguage(event.target.value as LabLanguage)}>
                  {(Object.keys(LAB_LANGUAGES) as LabLanguage[]).map(language => <option key={language} value={language}>{LAB_LANGUAGES[language].name}</option>)}
                </select>
              </div>
              {settings.language === 'de' && (
                <div>
                  <label htmlFor="lab-variety" className={fieldLabel}>How you will speak</label>
                  <select id="lab-variety" className={field} value={settings.variety} onChange={event => change('variety', event.target.value as Variety)}>
                    <option value="standard">Standard German</option>
                    <option value="dialect">Swiss German (dialect)</option>
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="lab-noise" className={fieldLabel}>Around you</label>
                <select id="lab-noise" className={field} value={settings.noise} onChange={event => change('noise', event.target.value as Noise)}>
                  <option value="quiet">Quiet room</option>
                  <option value="some">Some noise (people talking, music)</option>
                  <option value="loud">Loud (for example a hair dryer)</option>
                </select>
              </div>
              <div>
                <label htmlFor="lab-microphone" className={fieldLabel}>Microphone</label>
                <select id="lab-microphone" className={field} value={settings.microphone} onChange={event => change('microphone', event.target.value as Microphone)}>
                  <option value="built-in">Built into this device</option>
                  <option value="headset">Headset or earphones</option>
                  <option value="other">Another microphone</option>
                </select>
              </div>
              <div>
                <label htmlFor="lab-label" className={fieldLabel}>Your initials (optional)</label>
                <input id="lab-label" className={field} value={settings.label} maxLength={40} autoComplete="off" onChange={event => change('label', event.target.value)} />
              </div>
            </div>

            <details className="rounded-xl border border-slate-200 px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">More options</summary>
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="lab-locale" className={fieldLabel}>What the browser is told to expect</label>
                  <select id="lab-locale" className={field} value={settings.locale} onChange={event => { change('locale', event.target.value); setDevice(null); }}>
                    {pack.locales.map(locale => <option key={locale.code} value={locale.code}>{locale.label}</option>)}
                  </select>
                </div>
                {support.boost && (
                  <label className="flex min-h-11 items-start gap-3 text-sm text-slate-700">
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#5551FF]" checked={settings.boost} onChange={event => change('boost', event.target.checked)} />
                    <span><span className="font-semibold text-slate-800">Favour salon words.</span> The browser is given the names and services in the sentences, so it expects them.</span>
                  </label>
                )}
                {support.onDevice && (
                  <div className="space-y-2">
                    <label className="flex min-h-11 items-start gap-3 text-sm text-slate-700">
                      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#5551FF]" checked={settings.onDevice} onChange={event => change('onDevice', event.target.checked)} />
                      <span><span className="font-semibold text-slate-800">Recognise on this device.</span> No sound leaves the device. It needs a language pack, downloaded once.</span>
                    </label>
                    {settings.onDevice && (
                      <div className="flex flex-wrap items-center gap-3 pl-7 text-sm text-slate-600">
                        <button type="button" className={quietButton} onClick={checkDevice} disabled={device === 'checking' || device === 'installing'}>Check language pack</button>
                        {device === 'downloadable' && <button type="button" className={quietButton} onClick={downloadPack}>Download it</button>}
                        <span role="status">
                          {device === 'checking' && 'Checking.'}
                          {device === 'installing' && 'Downloading. This can take a minute.'}
                          {device === 'available' && 'Installed and ready.'}
                          {device === 'downloadable' && 'Not installed yet.'}
                          {device === 'downloading' && 'The browser is downloading it. Check again in a minute.'}
                          {device === 'unavailable' && 'This browser has no pack for this language. Switch the option off.'}
                          {device === 'unknown' && 'The browser did not say. Try a round; if it fails, switch the option off.'}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {!support.boost && !support.onDevice && support.recognition && (
                  <p className="text-sm text-slate-500">This browser offers no further speech options.</p>
                )}
              </div>
            </details>

            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-800">What happens to your voice</p>
              <p className="mt-1">
                Your browser turns speech into text. For that, most browsers send the sound to the speech service of their maker
                (Google for Chrome, Apple for Safari), unless you choose to recognise on this device. {PRODUCT_NAME} keeps no sound and stores nothing:
                the results stay on this page until you copy or download them. They hold the text that was heard, timings, the name of
                your browser and the choices above.
              </p>
            </div>

            <button type="button" className={primaryButton} onClick={begin} disabled={!support.recognition}>Start the check</button>
          </section>
        )}

        {phase === 'sentences' && (
          <section className={`${card} space-y-5`} aria-labelledby="sentence-title">
            <p id="sentence-title" className="text-sm font-semibold text-slate-500">Sentence {index + 1} of {pack.sentences.length}</p>
            <p lang={settings.language} className="text-2xl font-semibold leading-snug text-slate-900">{sentence.text}</p>
            <p className="text-sm text-slate-600">Press Start, then read the sentence aloud once. Listening ends by itself when you stop speaking.</p>

            <ListenBox
              status={listening.status}
              live={listening.live}
              heard={busy ? listening.heard : last?.heard ?? ''}
              onStart={startSentence}
              onStop={listening.stop}
              startLabel={last ? 'Start again' : 'Start'}
              again={sentenceDone}
              slow={listening.slow}
            />

            {!busy && last && (
              <div className="space-y-3">
                {!last.heard && <p role="alert" className="text-sm font-medium text-rose-700">{problemText(last.errors, settings.onDevice, opened(last.events)) ?? 'Nothing was heard. Press Start again and speak right away.'}</p>}
                {last.heard && sentence.keys.length > 0 && (
                  <>
                    <p className="text-sm text-slate-600">Details that arrived: {last.score.foundCount} of {last.score.total}. Wait for the finished text: {seconds(last.timings.finalDelayMs)}.</p>
                    <KeyChips keys={sentence.keys} score={last.score} />
                  </>
                )}
                {last.heard && sentence.keys.length === 0 && (
                  <p className="text-sm text-slate-600">This one is small talk with nothing to book. We only note what the browser makes of it.</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
              <button type="button" className={sentenceDone ? primaryButton : quietButton} onClick={next} disabled={busy}>
                {sentenceDone ? (index + 1 < pack.sentences.length ? 'Next sentence' : 'Go on to the short call') : 'Skip this one'}
              </button>
            </div>
          </section>
        )}

        {phase === 'talk' && (
          <section className={`${card} space-y-5`} aria-labelledby="talk-title">
            <div className="space-y-2">
              <h2 id="talk-title" className="text-lg font-bold text-slate-900">A short call</h2>
              <p className="text-sm text-slate-600">
                This is your side of a phone call. Press Start and read all the lines in one go. Pause for a second or two after each line,
                as if the customer were answering. Press Stop after the last line.
              </p>
            </div>
            <ol lang={settings.language} className="list-decimal space-y-2 pl-6 text-lg font-medium leading-snug text-slate-900">
              {pack.talk.lines.map(line => <li key={line}>{line}</li>)}
            </ol>

            <ListenBox
              status={listening.status}
              live={listening.live}
              heard={busy ? listening.heard : talk?.heard ?? ''}
              onStart={startTalk}
              onStop={listening.stop}
              startLabel={talk ? 'Start again' : 'Start'}
              again={talkDone}
              slow={listening.slow}
            />

            {!busy && talk && (
              <div className="space-y-3">
                {!talk.heard && <p role="alert" className="text-sm font-medium text-rose-700">{problemText(talk.errors, settings.onDevice, opened(talk.events)) ?? 'Nothing was heard. Press Start again and speak right away.'}</p>}
                {talk.heard && (
                  <>
                    <p className="text-sm text-slate-600">Details that arrived: {talk.score.foundCount} of {talk.score.total}.</p>
                    <KeyChips keys={pack.talk.keys} score={talk.score} />
                  </>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
              <button type="button" className={talkDone ? primaryButton : quietButton} onClick={() => setPhase('results')} disabled={busy}>
                {talkDone ? 'See the results' : 'Skip the call'}
              </button>
            </div>
          </section>
        )}

        {phase === 'results' && (
          <>
            <section className={`${card} space-y-5`} aria-labelledby="results-title">
              <h2 id="results-title" className="text-lg font-bold text-slate-900">Results of this round</h2>
              <dl className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold text-slate-500">Details that arrived</dt>
                  <dd className="mt-1 text-2xl font-bold text-slate-900">{summary.keysFound} of {summary.keysTotal}</dd>
                  <dd className="text-xs text-slate-500">{share(summary.keysFound, summary.keysTotal)} in {summary.sentencesDone} of {summary.sentencesTotal} sentences</dd>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold text-slate-500">Wait for the finished text</dt>
                  <dd className="mt-1 text-2xl font-bold text-slate-900">{seconds(summary.medianFinalDelayMs)}</dd>
                  <dd className="text-xs text-slate-500">after you stop speaking, middle value</dd>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold text-slate-500">Short call</dt>
                  <dd className="mt-1 text-2xl font-bold text-slate-900">{talk ? `${talk.score.foundCount} of ${talk.score.total}` : 'skipped'}</dd>
                  <dd className="text-xs text-slate-500">details that arrived</dd>
                </div>
              </dl>

              <div className="space-y-3 rounded-xl border border-brand/20 bg-brand-soft px-4 py-4">
                <p className="text-sm font-semibold text-slate-900">Send us this round</p>
                <p className="text-sm text-slate-700">Copy the results and paste them into a message to the team, or download them as a file. Nothing has been sent anywhere yet.</p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" className={primaryButton} onClick={copyResults}><Copy className="h-4 w-4" aria-hidden="true" />Copy results</button>
                  <button type="button" className={quietButton} onClick={downloadResults}><Download className="h-4 w-4" aria-hidden="true" />Download file</button>
                </div>
                <p role="status" className="text-sm font-medium text-emerald-800">
                  {exported === 'copied' && 'Copied. Paste it into your message.'}
                  {exported === 'downloaded' && 'Downloaded. Attach the file to your message.'}
                </p>
                {exported === 'manual' && (
                  <div className="space-y-2">
                    <p className="text-sm text-slate-700">Copying was not possible here. Select all the text below and copy it yourself.</p>
                    <textarea readOnly rows={6} aria-label="Results as text" className={`${field} font-mono text-xs`} value={JSON.stringify(report(), null, 1)} onFocus={event => event.currentTarget.select()} />
                  </div>
                )}
              </div>

              <button type="button" className={quietButton} onClick={() => setPhase('setup')}><RotateCcw className="h-4 w-4" aria-hidden="true" />Do another round</button>
              <p className="text-sm text-slate-500">A second round in another language, with noise around you or in another browser tells us the most. Starting a round clears this one, so copy or download it first.</p>
            </section>

            <section className={`${card} space-y-4`} aria-labelledby="detail-title">
              <h2 id="detail-title" className="text-lg font-bold text-slate-900">Sentence by sentence</h2>
              <ul className="space-y-4">
                {pack.sentences.map((item) => {
                  const attempt = attempts[item.id]?.at(-1);
                  return (
                    <li key={item.id} className="space-y-2 border-b border-slate-100 pb-4 last:border-b-0 last:pb-0">
                      <p lang={settings.language} className="text-sm font-semibold text-slate-900">{item.text}</p>
                      {!attempt && <p className="text-sm text-slate-500">Skipped.</p>}
                      {attempt && <p lang={settings.language} className="text-sm text-slate-600">Heard: {attempt.heard || 'nothing'}</p>}
                      {attempt && item.keys.length > 0 && <KeyChips keys={item.keys} score={attempt.score} />}
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
