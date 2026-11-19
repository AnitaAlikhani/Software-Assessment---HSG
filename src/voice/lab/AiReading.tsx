import React, { useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { PRODUCT_NAME } from '../../brand';
import type { RouteProblem } from '../understand';
import type { ReadingScore } from './expected';
import { describeReading, readRound, textsToRead, type RoundToRead } from './readRound';
import type { ReadingRecord, Understanding } from './report';

/**
 * The second question of the voice check: once the browser has turned speech into text, how much
 * of it does the AI reader understand, and how long does that take? The reader is the one that
 * will follow a call. It needs the server and the owner's key, so this part only works on the
 * product's own address.
 */

const seconds = (ms: number | null): string => (ms === null ? 'not measured' : `${(ms / 1000).toFixed(1)} s`);

/** What to tell the person when a text came back without a reading. */
export function readingProblemText(problem: RouteProblem): string {
  switch (problem) {
    case 'no-server': return `This address has no ${PRODUCT_NAME} server behind it, so the AI reader cannot be asked from here. Open this page on the ${PRODUCT_NAME} address instead.`;
    case 'no-access': return 'The owner key in this browser was not accepted. Open this page once with your owner link (the address ends with ?live= and your key), then try again. If the link is right, this copy of the site may not know the key: on the hosting platform it has to be set for preview copies too.';
    case 'refused': return 'The server did not accept the text as it was.';
    case 'failed': return 'The AI service gave no usable answer. Its key may be missing on this copy of the site, or the free questions of this minute are used up.';
    case 'too-slow': return 'The answer took longer than 12 seconds.';
    case 'offline': return 'The server could not be reached. Check the internet connection.';
  }
}

const card = 'rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-7';
const button = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50';

/** Each detail of a reading, marked right or wrong. A wrong one says what it should have been. */
const Fields: React.FC<{ score: ReadingScore }> = ({ score }) => (
  <ul className="flex flex-wrap gap-2">
    {score.fields.map(field => (
      <li
        key={field.label}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${field.right ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
      >
        {field.right ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span>{field.label}: {field.got}</span>
        {!field.right && <span className="font-normal">(should be {field.expected})</span>}
        <span className="sr-only">{field.right ? 'right' : 'wrong'}</span>
      </li>
    ))}
  </ul>
);

const Reading: React.FC<{ reading: ReadingRecord }> = ({ reading }) => (
  <div className="space-y-2">
    {reading.problem ? (
      <p className="text-sm font-medium text-rose-700">{readingProblemText(reading.problem)}</p>
    ) : (
      <p className="text-sm text-slate-600">
        <span className="font-semibold text-slate-800">The AI read:</span> {describeReading(reading.request)}
        <span className="text-slate-500"> ({seconds(reading.ms)})</span>
      </p>
    )}
    {reading.score && <Fields score={reading.score} />}
  </div>
);

export const AiReading: React.FC<{
  round: RoundToRead;
  /** The owner's key, as the app keeps it in this browser. Without it the reader cannot be asked. */
  liveKey: string | null;
  value: Understanding | null;
  onChange: (value: Understanding | null) => void;
  /** Tests pass a stand-in. */
  read?: typeof readRound;
}> = ({ round, liveKey, value, onChange, read = readRound }) => {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const texts = textsToRead(round).length;
  const stopped = value ? [...Object.values(value.sentences), ...value.call].find(reading => reading.problem === 'no-server' || reading.problem === 'no-access')?.problem : undefined;

  const run = async () => {
    if (!liveKey || progress) return;
    setProgress({ done: 0, total: texts });
    try {
      onChange(await read(round, liveKey, { onProgress: (done, total) => setProgress({ done, total }) }));
    } finally {
      setProgress(null);
    }
  };

  return (
    <section className={`${card} space-y-5`} aria-labelledby="ai-title">
      <div className="space-y-2">
        <h2 id="ai-title" className="text-lg font-bold text-slate-900">What the AI reader understands</h2>
        <p className="text-sm text-slate-600">
          The browser has turned speech into text. The AI reader, the one that will follow a call, now fills in what is wanted: the day, the time, the service, with whom and for whom.
          Each detail is marked right or wrong, and each answer is timed.
        </p>
      </div>

      {!liveKey && (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          This part needs the owner link. Open this page on the {PRODUCT_NAME} address once with your link (the address ends with ?live= and your key), then open or repeat the round there.
        </p>
      )}

      {liveKey && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Only the texts are sent: to the {PRODUCT_NAME} server, and from there to Google&apos;s AI service Gemini, together with the names of the salon&apos;s services and team. No sound is sent, and no customer and no appointment.
          </p>
          <button type="button" className={button} onClick={run} disabled={progress !== null || texts === 0}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {value ? 'Let the AI read it again' : 'Let the AI read this round'}
          </button>
          <p role="status" className="text-sm font-medium text-slate-700">
            {progress && `Reading text ${Math.min(progress.done + 1, progress.total)} of ${progress.total}. This takes about a minute.`}
            {!progress && texts === 0 && 'There is no finished text in this round to read.'}
          </p>
        </div>
      )}

      {value && stopped && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{readingProblemText(stopped)}</p>}

      {value && !stopped && (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <dt className="text-xs font-semibold text-slate-500">Details the AI got right</dt>
              <dd className="mt-1 text-2xl font-bold text-slate-900">{value.summary.right} of {value.summary.total}</dd>
              <dd className="text-xs text-slate-500">in {value.summary.asked} texts{value.summary.problems > 0 ? `, ${value.summary.problems} without an answer` : ''}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <dt className="text-xs font-semibold text-slate-500">Wait for an answer</dt>
              <dd className="mt-1 text-2xl font-bold text-slate-900">{seconds(value.summary.medianMs)}</dd>
              <dd className="text-xs text-slate-500">middle value, as you would wait for it</dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <dt className="text-xs font-semibold text-slate-500">Of that, the AI service</dt>
              <dd className="mt-1 text-2xl font-bold text-slate-900">{seconds(value.summary.medianModelMs)}</dd>
              <dd className="text-xs text-slate-500">middle value, measured on the server</dd>
            </div>
          </dl>

          <ul className="space-y-4">
            {round.pack.sentences.filter(sentence => value.sentences[sentence.id]).map(sentence => (
              <li key={sentence.id} className="space-y-2 border-b border-slate-100 pb-4 last:border-b-0 last:pb-0">
                <p lang={round.language} className="text-sm font-semibold text-slate-900">{sentence.text}</p>
                <p lang={round.language} className="text-sm text-slate-600">Heard: {value.sentences[sentence.id].lines.at(-1)}</p>
                <Reading reading={value.sentences[sentence.id]} />
              </li>
            ))}
          </ul>

          {value.call.length > 0 && (
            <div className="space-y-3 border-t border-slate-100 pt-5">
              <h3 className="text-sm font-bold text-slate-900">The short call, phrase by phrase</h3>
              <p className="text-sm text-slate-600">After each phrase the reader gets the call so far, as it would while somebody is on the phone. Only the last reading is scored.</p>
              <ol className="list-decimal space-y-3 pl-6">
                {value.call.map((reading, index) => (
                  <li key={index} className="space-y-1">
                    <p lang={round.language} className="text-sm font-medium text-slate-900">{reading.lines.at(-1)}</p>
                    <Reading reading={reading} />
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </section>
  );
};
