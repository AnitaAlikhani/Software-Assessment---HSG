import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * A form that holds a copy of a stored value (the salon's details, the opening hours, a service,
 * a person, the AI receptionist's settings) and follows that value while it is open: another
 * device, another tab, a 409 or a save that went back can change it meanwhile.
 *
 * The rule, per field:
 * - a field the owner has not changed shows the new stored value;
 * - a field she has changed keeps what she typed.
 * So "unsaved changes" are only ever what she typed, and Save sends the stored value with her
 * changes on top, never an old value of a field she did not touch.
 *
 * What one field is:
 * - of a record: each of its fields. A field that is itself a record is one whole (the two times
 *   of a day are never mixed from two devices), unless the form says it is a set of switches
 *   (BY_KEY: the languages the AI answers in), where each switch is a field;
 * - of a list of plain values (the people who offer a service, the services a person offers): each
 *   entry, as a tick: what the owner ticked stays ticked, what she unticked stays out, and every
 *   other tick is as the server has it;
 * - of a list of records: each entry as one whole, told apart by its id (`listId`, `lists`, or the
 *   entries' own `id`), or by its place where the form says so (BY_POSITION: a week of seven days).
 *   One weekday's hours are never mixed from two devices;
 * - anything else is one whole.
 */

const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPlain = (value: unknown): boolean => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/** For a list whose entries have no id and never move: the regular week of a person, Monday first. */
export const BY_POSITION = 'by position' as const;
/** For a field that is a set of switches, each one named by its key: the languages the AI answers in. */
export const BY_KEY = 'by key' as const;
/** How the entries of a list are told apart: by what this gives for an entry, or by their place. */
export type EntryId = ((entry: never) => string) | typeof BY_POSITION;
/**
 * How the parts of the fields of a record are told apart: the entries of a list field (handover
 * rules by id, a week by place), or the switches of a record field (BY_KEY).
 */
export type ListIds = Record<string, EntryId | typeof BY_KEY>;

/** The three-way step for a list of records: entries by id, each one whole. */
function followById<E>(started: E[], typed: E[], stored: E[], idOf: (entry: E) => string): E[] {
  const startedById = new Map(started.map((entry) => [idOf(entry), entry]));
  const typedById = new Map(typed.map((entry) => [idOf(entry), entry]));
  const result: E[] = [];
  for (const entry of stored) {
    const id = idOf(entry);
    const before = startedById.get(id);
    const mine = typedById.get(id);
    // Taken out by the owner while it was there when the form was started: stays out.
    if (before !== undefined && mine === undefined) continue;
    result.push(mine !== undefined && before !== undefined && !same(mine, before) ? mine : entry);
  }
  // Added by the owner in the form: stays.
  for (const entry of typed) if (!startedById.has(idOf(entry)) && !stored.some((item) => idOf(item) === idOf(entry))) result.push(entry);
  return result;
}

/** The three-way step for a list of plain values: each one is a tick the owner set, took out, or left alone. */
function followTicks<E>(started: E[], typed: E[], stored: E[]): E[] {
  const takenOut = started.filter((entry) => !typed.includes(entry));
  const added = typed.filter((entry) => !started.includes(entry) && !stored.includes(entry));
  return [...stored.filter((entry) => !takenOut.includes(entry)), ...added];
}

/** The three-way step for a list. Without a way to tell its entries apart, the list is one whole. */
function followList(started: unknown[], typed: unknown[], stored: unknown[], entryId?: EntryId): unknown[] {
  const all = [...started, ...typed, ...stored];
  if (entryId === BY_POSITION) {
    // The same places in all three, or the list is one whole: a list that grew or shrank has no places to go by.
    if (started.length !== typed.length || started.length !== stored.length) return same(typed, started) ? stored : typed;
    return stored.map((entry, index) => same(typed[index], started[index]) ? entry : typed[index]);
  }
  if (entryId) return followById(started, typed, stored, entryId as (entry: unknown) => string);
  if (all.every(isPlain)) return followTicks(started, typed, stored);
  if (all.every((entry) => isRecord(entry) && typeof entry.id === 'string')) return followById(started, typed, stored, (entry) => (entry as { id: string }).id);
  return same(typed, started) ? stored : typed;
}

/** The three-way step for a set of switches: each one by its name, as one whole. */
function followSwitches(started: Record<string, unknown>, typed: Record<string, unknown>, stored: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...typed };
  for (const key of new Set([...Object.keys(stored), ...Object.keys(started)])) {
    if (!same(typed[key], started[key])) continue;
    if (key in stored) result[key] = stored[key];
    else delete result[key];
  }
  return result;
}

/**
 * What an open form shows after the stored value changed: `startedFrom` is the stored value the
 * form was started from (or last followed), `typed` what the form holds now, `stored` the new
 * stored value. `listId` says how the entries of a list are told apart, `lists` the same for the
 * list fields of a record; without either, see "what one field is" above.
 */
export function followStored<T>(startedFrom: T, typed: T, stored: T, options: { listId?: EntryId; lists?: ListIds } = {}): T {
  if (Array.isArray(startedFrom) && Array.isArray(typed) && Array.isArray(stored)) return followList(startedFrom, typed, stored, options.listId) as T;
  if (!isRecord(startedFrom) || !isRecord(typed) || !isRecord(stored)) return same(typed, startedFrom) ? stored : typed;
  const result: Record<string, unknown> = { ...typed };
  for (const field of new Set([...Object.keys(stored), ...Object.keys(startedFrom)])) {
    const [before, mine, theirs] = [startedFrom[field], typed[field], stored[field]];
    const how = options.lists?.[field];
    if (how !== BY_KEY && Array.isArray(before) && Array.isArray(mine) && Array.isArray(theirs)) result[field] = followList(before, mine, theirs, how);
    else if (how === BY_KEY && isRecord(before) && isRecord(mine) && isRecord(theirs)) result[field] = followSwitches(before, mine, theirs);
    else if (same(mine, before)) {
      if (field in stored) result[field] = theirs;
      else delete result[field];
    }
  }
  return result as T;
}

/**
 * The state of a form that follows its stored value: `stored` is the stored value in the form's
 * own shape. Returns what the form shows, its setter, the stored value it now stands on (to tell
 * what the owner typed), and `restart` for a form that is opened anew on another value.
 */
export function useStoredForm<T>(stored: T, options: { listId?: EntryId; lists?: ListIds } = {}) {
  const [state, setState] = useState(() => ({ started: stored, startedJson: JSON.stringify(stored), form: stored }));
  const storedJson = JSON.stringify(stored);
  let current = state;
  if (state.startedJson !== storedJson) {
    // Followed while drawing, so no screen is ever drawn on the old copy (it would report changes nobody typed).
    current = { started: stored, startedJson: storedJson, form: followStored(state.started, state.form, stored, options) };
    setState(current);
  }
  const setForm: Dispatch<SetStateAction<T>> = (next) => setState((previous) => ({
    ...previous, form: typeof next === 'function' ? (next as (previous: T) => T)(previous.form) : next,
  }));
  const restart = (value: T) => setState({ started: value, startedJson: JSON.stringify(value), form: value });
  return { form: current.form, setForm, startedFrom: current.started, restart };
}
