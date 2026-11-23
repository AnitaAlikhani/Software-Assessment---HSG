import assert from 'node:assert/strict';
import test from 'node:test';
import { ANSWER_HOLD_MS, holdAnswer, type HoldEnd } from '../src/answerHold';

// An answer that reaches a customer waits a few seconds on Home before it goes out, so that a
// wrong tap can be taken back. These tests turn the clock by hand: nothing here waits for real.

/** What became of a held answer so far: how it ended (or nothing yet), and how often it was sent. */
const watch = (hold: (send: () => Promise<boolean>) => ReturnType<typeof holdAnswer>, sends: boolean | Error = true) => {
  const seen: { ended: HoldEnd | null; sent: number } = { ended: null, sent: 0 };
  const held = hold(() => { seen.sent += 1; return sends instanceof Error ? Promise.reject(sends) : Promise.resolve(sends); });
  void held.ended.then((end) => { seen.ended = end; });
  return { held, seen };
};
/** Lets everything that is ready run: a held answer settles through a few promises. */
const settle = async () => { for (let turn = 0; turn < 5; turn++) await Promise.resolve(); };

test('an answer goes out when the hold is over, and not before', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { held, seen } = watch((send) => holdAnswer(ANSWER_HOLD_MS, () => true, send));
  assert.equal(ANSWER_HOLD_MS, 5000);
  t.mock.timers.tick(ANSWER_HOLD_MS - 1);
  await settle();
  assert.deepEqual(seen, { ended: null, sent: 0 });
  t.mock.timers.tick(1);
  assert.equal(await held.ended, 'done');
  assert.equal(seen.sent, 1);
});

test('"Undo" during the hold keeps the answer back for good', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { held, seen } = watch((send) => holdAnswer(5000, () => true, send));
  t.mock.timers.tick(3000);
  held.undo();
  assert.equal(await held.ended, 'undone');
  // The time of the hold passes, the owner leaves the screen, she presses "Undo" again: nothing goes out.
  t.mock.timers.tick(10_000);
  held.release();
  held.undo();
  await settle();
  assert.deepEqual(seen, { ended: 'undone', sent: 0 });
});

test('leaving the screen ends the hold at once, and the answer goes out exactly once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { held, seen } = watch((send) => holdAnswer(5000, () => true, send));
  t.mock.timers.tick(1000);
  held.release();
  assert.equal(await held.ended, 'done');
  // Neither the timer that was still running, nor a second release, nor a late "Undo" changes that.
  t.mock.timers.tick(10_000);
  held.release();
  held.undo();
  await settle();
  assert.deepEqual(seen, { ended: 'done', sent: 1 });
});

test('a request that changed during the hold is not answered', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // The customer asked for another time two seconds after the owner pressed "Confirm".
  let request = 'Thursday 15:00';
  const { held, seen } = watch((send) => holdAnswer(5000, () => request === 'Thursday 15:00', send));
  t.mock.timers.tick(2000);
  request = 'Friday 10:00';
  t.mock.timers.tick(3000);
  assert.equal(await held.ended, 'changed');
  assert.equal(seen.sent, 0);
  // The same when the owner leaves the screen meanwhile, and when the chat cannot be looked up any more.
  const leaving = watch((send) => holdAnswer(5000, () => false, send));
  leaving.held.release();
  assert.equal(await leaving.held.ended, 'changed');
  const gone = watch((send) => holdAnswer(5000, () => { throw new Error('no such chat'); }, send));
  t.mock.timers.tick(5000);
  assert.equal(await gone.held.ended, 'changed');
  assert.deepEqual([leaving.seen.sent, gone.seen.sent], [0, 0]);
});

test('an answer that goes out and cannot be carried out ends as failed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // The server refused: the one who sent it knows why and says so.
  const refused = watch((send) => holdAnswer(5000, () => true, send), false);
  t.mock.timers.tick(5000);
  assert.equal(await refused.held.ended, 'failed');
  // The connection broke.
  const broken = watch((send) => holdAnswer(5000, () => true, send), new Error('offline'));
  t.mock.timers.tick(5000);
  assert.equal(await broken.held.ended, 'failed');
  assert.deepEqual([refused.seen.sent, broken.seen.sent], [1, 1]);
});
