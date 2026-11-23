/**
 * An answer that waits a few seconds before it goes out, so that a wrong tap can be taken back.
 *
 * Home's inbox answers a customer's request with one tap, and in a live chat the customer has
 * the message a moment later: nothing brings it back. So Home holds such an answer for a few
 * seconds and offers "Undo" meanwhile (src/components/ChatBookingCards.tsx, useAnswer). When the
 * hold ends, the answer goes out only if the request is still the one it was given to: a
 * customer who has asked for something else in those seconds is not answered for what they
 * asked before.
 *
 * Nothing here knows about chats or the screen. It is the waiting, the two ways out of it, and
 * how it ended, so it can be tested with a clock that is turned by hand (tests/answerHold.test.ts).
 */

/** How long Home holds an answer that reaches a customer: long enough to notice a wrong tap, short enough not to feel slow. */
export const ANSWER_HOLD_MS = 5000;

export type HoldEnd =
  /** The answer went out and was carried out. */
  | 'done'
  /** It went out and could not be carried out; whoever sent it knows why. */
  | 'failed'
  /** The owner took it back: nothing went out. */
  | 'undone'
  /** What it answered had changed meanwhile: nothing went out. */
  | 'changed';

export interface HeldAnswer {
  /** Ends the hold now and lets the answer go out: the owner leaves the screen or the app. */
  release: () => void;
  /** Takes the answer back. */
  undo: () => void;
  /** How the hold ended. Settles once, whichever way out was taken first. */
  ended: Promise<HoldEnd>;
}

/**
 * Holds an answer for `ms`. Then, or at `release`, `stillTheSame` is asked; only on a yes does
 * `send` run, and its result (true for carried out) decides between 'done' and 'failed'.
 */
export function holdAnswer(ms: number, stillTheSame: () => boolean, send: () => Promise<boolean>): HeldAnswer {
  let settled = false;
  let finish!: (end: HoldEnd) => void;
  const ended = new Promise<HoldEnd>((resolve) => { finish = resolve; });
  const go = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    let same = false;
    try { same = stillTheSame(); } catch { same = false; }
    if (!same) { finish('changed'); return; }
    Promise.resolve().then(send).then((done) => finish(done ? 'done' : 'failed'), () => finish('failed'));
  };
  const timer = setTimeout(go, ms);
  return {
    release: go,
    undo: () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish('undone');
    },
    ended,
  };
}
