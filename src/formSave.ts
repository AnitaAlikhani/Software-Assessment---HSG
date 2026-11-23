import { useEffect, useReducer, useRef } from 'react';

/**
 * Waiting for the server's answer to a form's save (src/useDemoState.ts pendingFormSave), for the
 * forms that send what they hold: a service, a person, a day's hours, a closure, an absence.
 *
 * An answer only ever concerns the form that sent it, as it was opened then. Every opening of a
 * form (a new one, the same one again, the next one after "Save and add another") and every
 * closing or cancelling counts as a new opening: an answer to an earlier one does not close, clear
 * or mark it, and the new one is not "Saving…" because of it and can be saved itself (its save
 * queues behind the one on its way). The message at the foot of the screen still says when a save
 * was not taken. A screen that is gone is not touched either.
 */
export interface FormSaveState {
  /** This opening's save is on its way: its Save says "Saving…" and cannot be pressed again. */
  saving: boolean;
  /** Why this opening's last save was not taken (the salon's sentence), or ''. */
  notSaved: string;
}

/** The part without React: which opening an answer concerns, and what the form shows of it. */
export class FormSaves {
  private opening = 0;
  private waiting: number | null = null;
  private failure: { opening: number; text: string } | null = null;
  private gone = false;

  constructor(private readonly changed: () => void = () => {}) {}

  /** A new opening (opened, opened anew, closed, cancelled): earlier answers no longer concern the form. */
  newOpening(): void {
    this.opening += 1;
    this.waiting = null;
    this.failure = null;
    this.changed();
  }

  /**
   * After the form handed its content to the app: `pending` is null where nothing waits for the
   * server (a device that is not signed in), and `done` runs at once. Otherwise `done` runs when
   * the server took it, and `notTaken` gives why it did not; both only while the form is still
   * the opening that sent it and its screen is still there.
   */
  afterSave(pending: Promise<boolean> | null, done: () => void, notTaken: () => string): Promise<void> {
    if (!pending) { done(); return Promise.resolve(); }
    const mine = this.opening;
    this.waiting = mine;
    this.failure = null;
    this.changed();
    return pending.then((saved) => {
      if (this.gone || mine !== this.opening) return;
      this.waiting = null;
      if (saved) done();
      else this.failure = { opening: mine, text: notTaken() };
      this.changed();
    });
  }

  get state(): FormSaveState {
    return {
      saving: this.waiting !== null && this.waiting === this.opening,
      notSaved: this.failure && this.failure.opening === this.opening ? this.failure.text : '',
    };
  }

  /** The screen is gone: answers that still come change nothing. */
  dispose(): void { this.gone = true; }
  /** The screen is there (again). */
  revive(): void { this.gone = false; }
}

/**
 * A list with `entry` in it: in the place of the entry that has its id, or at the end. A form
 * that adds something gives it one id for all its tries, so a save that is sent again (its answer
 * got lost, or the server could not be reached) is the same entry and never a second one.
 */
export const withEntry = <T extends { id: string }>(list: T[], entry: T): T[] =>
  list.some((item) => item.id === entry.id) ? list.map((item) => item.id === entry.id ? entry : item) : [...list, entry];

export function useFormSave() {
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const saves = useRef<FormSaves | null>(null);
  if (!saves.current) saves.current = new FormSaves(redraw);
  const current = saves.current;
  useEffect(() => { current.revive(); return () => current.dispose(); }, [current]);
  return {
    ...current.state,
    newOpening: () => current.newOpening(),
    afterSave: (pending: Promise<boolean> | null, done: () => void, notTaken: () => string) => { void current.afterSave(pending, done, notTaken); },
  };
}
