import { getSalonNow } from './scheduling';
import { STANDALONE_PARTS, storedShapeProblem } from './storedShapes';

/**
 * Where useDemoState keeps its values (src/useDemoState.ts is the door to it).
 *
 * The salon (requests, calendar, customers, chats, team, services, settings ...) is kept in the
 * browser's lasting storage, as ONE entry, so that it survives a closed tab and every tab of the
 * browser shows the same salon. One entry on purpose: the parts are linked by ids, and an owner's
 * action changes several of them at once (accepting a request takes it off the list, adds an
 * appointment and may add a customer). Written together, another tab can never read half of it.
 *
 * A few values stay with one tab (the booking draft, the customer's own request, the reply
 * drafts): each is one entry in the tab's own storage, as before.
 *
 * Where the browser blocks storage (privacy modes), everything lives in memory for the page load.
 * Nothing here touches `window` or the clock by itself: the page, the two storages and "now" are
 * handed in, so tests can run several "tabs" of one browser.
 */

/** What the store needs of a browser storage. Every call may throw where storage is blocked. */
export type KeptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Where a tab hears about the other tabs and about coming back to the front: the browser's window. */
export interface PageEvents {
  addEventListener?: (type: string, listener: (event: Event) => void) => void;
  removeEventListener?: (type: string, listener: (event: Event) => void) => void;
}

export interface DemoStoreSetup {
  /** The first part of every key: the storage version and the path the app is served from. */
  prefix: string;
  /** The browser's lasting storage, shared by its tabs. Null where it is missing or blocked. */
  lasting: KeptStorage | null;
  /** This tab's own storage. Null where it is missing or blocked. */
  tab: KeptStorage | null;
  /** The keys that stay with one tab. Every other key is a part of the salon. */
  perTabKeys: readonly string[];
  /** The clock. */
  now: () => Date;
  /** The window, for the events of the page. Left out, the store hears nothing and only acts when called. */
  page?: PageEvents | null;
  /** Is told when stored data are not used, and why. */
  report?: (message: string) => void;
}

/** The last part of the key the salon is stored under. */
export const SALON_KEY = 'salon';

/**
 * What stands in front of the salon's parts in the storage.
 *
 * `day` and `builtAt` say for which day and moment the starting data were built. Every tab builds
 * the same starting data from `builtAt`, so a part that nobody has changed need not be stored.
 * `changed` turns true with the first change. Only a salon that nobody has changed is built again
 * on a new day; a changed one stays exactly as it was left.
 * `resetAt` says when the salon was last cleared by hand ("Reset data"), or first stored. A new
 * day leaves it alone. An open tab that meets another value than the one it knew also clears
 * what it kept for itself, so that after a reset every tab starts fresh.
 */
interface SalonHead {
  day: string;
  builtAt: string;
  changed: boolean;
  resetAt: string;
}

/** One part of the salon: its value, and the same as the JSON text it is stored and compared as. */
interface Part {
  value: unknown;
  raw: string;
}

export interface StoredSalon extends SalonHead {
  /** The parts that passed their check, by the key of useDemoState. */
  parts: Map<string, Part>;
  /** The keys of the parts that did not pass. */
  refused: string[];
  /** True when a linked part did not pass. No linked part is in `parts` then. */
  linkedRefused: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A value as the JSON text it is stored as. Null for a value JSON cannot hold. */
const asJson = (value: unknown): string | null => {
  try { return JSON.stringify(value) ?? null; } catch { return null; }
};

/** The text the salon is stored as. `parts` are JSON texts already, so an unchanged part is not written out again. */
const salonText = (head: SalonHead, parts: Array<[string, string]>): string =>
  `{"day":${JSON.stringify(head.day)},"builtAt":${JSON.stringify(head.builtAt)},"changed":${head.changed},"resetAt":${JSON.stringify(head.resetAt)},"parts":{${
    parts.map(([key, raw]) => `${JSON.stringify(key)}:${raw}`).join(',')}}}`;

/**
 * Reads the stored salon and checks it part by part. Null when nothing usable is stored at all.
 *
 * What happens to a part of the wrong shape depends on whether other parts point at it:
 *
 * - The salon's profile, opening hours, closed dates and AI settings stand alone. One of them
 *   that does not pass is left out and gets its starting value; everything else stays.
 * - All other parts are linked by ids. If one does not pass, none of them is used. Replacing
 *   only the bad one with its starting value would join parts that never belonged together: a
 *   request that waits again although its appointment is in the calendar, appointments for
 *   customers who are not in the list. Starting the linked parts again together loses what the
 *   owner did, but what is shown afterwards is true in itself.
 */
export function readStoredSalon(raw: string | null, report: (message: string) => void = () => {}): StoredSalon | null {
  if (raw === null) return null;
  let stored: unknown;
  try { stored = JSON.parse(raw); } catch { stored = null; }
  if (!isRecord(stored) || typeof stored.day !== 'string' || !DAY.test(stored.day) || typeof stored.builtAt !== 'string'
    || Number.isNaN(Date.parse(stored.builtAt)) || typeof stored.changed !== 'boolean' || !isRecord(stored.parts)) {
    report('The stored salon could not be read.');
    return null;
  }
  const parts = new Map<string, Part>();
  const refused: string[] = [];
  let linkedRefused = false;
  for (const [key, value] of Object.entries(stored.parts)) {
    const problem = storedShapeProblem(key, value);
    // The text is made again from the value, so that two tabs always compare the same spelling.
    const text = problem ? null : asJson(value);
    if (text !== null) { parts.set(key, { value, raw: text }); continue; }
    report(`Stored data were not used: ${problem ?? `${key} could not be read`}.`);
    refused.push(key);
    if (!STANDALONE_PARTS.has(key)) linkedRefused = true;
  }
  if (linkedRefused) for (const key of [...parts.keys()]) if (!STANDALONE_PARTS.has(key)) parts.delete(key);
  return {
    day: stored.day,
    builtAt: stored.builtAt,
    // A salon with stored parts has been changed, whatever its head says: parts are only stored after a change.
    changed: stored.changed || parts.size > 0 || refused.length > 0,
    resetAt: typeof stored.resetAt === 'string' ? stored.resetAt : stored.builtAt,
    parts, refused, linkedRefused,
  };
}

/** The salon's calendar day at a moment. The starting data are built for the default salon time zone, so the day is taken there. */
const salonDay = (moment: Date): string => getSalonNow(undefined, moment).date;

/**
 * The moment `now` as it is stored, but always later than `earlier`. The tabs tell a salon that
 * was started again by its moment, so the moment must differ from the one before even where
 * the clock has not moved in between.
 */
const laterThan = (earlier: string, now: Date): string => {
  const before = Date.parse(earlier);
  return new Date(Number.isNaN(before) ? now.getTime() : Math.max(now.getTime(), before + 1)).toISOString();
};

/** What the store holds in memory for one key. `raw` is worked out when it is first needed. */
interface Held {
  value: unknown;
  raw?: string | null;
}

type Watcher = (before: unknown, after: unknown) => void;

/** Another tab stored the salon; this tab came back to the front; the page was restored from the browser's cache. */
const PAGE_EVENTS = ['storage', 'visibilitychange', 'focus', 'pageshow'];

export class DemoStore {
  private head: SalonHead;
  /** Everything this tab has in memory, by key: the salon's parts and the tab's own values. */
  private readonly held = new Map<string, Held>();
  /** The starting value of each key that was read, or the function that builds it. */
  private readonly startingValues = new Map<string, unknown>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly watchers = new Map<string, Set<Watcher>>();
  /** Keys changed in this tab and not stored yet. */
  private readonly unsaved = new Set<string>();
  /** The stored salon as this tab last read or wrote it: what another tab stores since then differs from it. */
  private lastSeen: string | null;
  private saveQueued = false;
  private closed = false;
  private readonly perTab: ReadonlySet<string>;
  private readonly salonKey: string;
  private readonly report: (message: string) => void;

  constructor(private readonly setup: DemoStoreSetup) {
    this.perTab = new Set(setup.perTabKeys);
    this.salonKey = `${setup.prefix}:${SALON_KEY}`;
    this.report = setup.report ?? (() => {});
    const now = setup.now();
    const today = salonDay(now);
    this.lastSeen = this.storedSalon() ?? null;
    const stored = readStoredSalon(this.lastSeen, this.report);
    if (!stored || (!stored.changed && stored.day !== today)) {
      // Nothing usable is stored, or a salon that nobody has changed and that was built for
      // another day: a new salon starts, for today. Its moment is stored at once, so that a
      // second tab builds the same starting data.
      this.head = { day: today, builtAt: now.toISOString(), changed: false, resetAt: stored?.resetAt ?? now.toISOString() };
      this.storeSalon();
    } else {
      this.head = { day: stored.day, builtAt: stored.builtAt, changed: stored.changed, resetAt: stored.resetAt };
      for (const [key, part] of stored.parts) if (!this.perTab.has(key)) this.held.set(key, { value: part.value, raw: part.raw });
      if (stored.linkedRefused) {
        // A linked part had the wrong shape, so no linked part is used (see readStoredSalon):
        // they start again together, built for today. What stands alone is kept; if nothing is
        // left of what the owner did, the salon counts as unchanged again.
        const builtAt = laterThan(stored.builtAt, now);
        this.head = { ...this.head, day: salonDay(new Date(builtAt)), builtAt, changed: this.held.size > 0 };
        this.storeSalon();
      }
    }
    for (const type of PAGE_EVENTS) setup.page?.addEventListener?.(type, this.onPageEvent);
  }

  /** The moment the starting data of the salon are built for. */
  get builtAt(): Date { return new Date(this.head.builtAt); }
  /** The salon's day the starting data were built for (YYYY-MM-DD). */
  get day(): string { return this.head.day; }
  /** Whether anything has been changed since the salon was started. */
  get changed(): boolean { return this.head.changed; }

  /**
   * The value of a key. `starting` is used while nothing is stored for the key: the value itself,
   * or a function that builds it for the moment the salon was started.
   */
  read<T>(key: string, starting: T | ((builtAt: Date) => T)): T {
    // The latest one counts: it may be built from what the page shows now.
    this.startingValues.set(key, starting);
    return this.hold(key).value as T;
  }

  /** Changes a value, as the setter of useState does: to a new value, or by a function of the value so far. */
  write<T>(key: string, next: T | ((previous: T) => T)): void {
    const held = this.hold(key);
    const value = typeof next === 'function' ? (next as (previous: T) => T)(held.value as T) : next;
    if (Object.is(value, held.value)) return;
    const before = this.rawOf(held);
    held.value = value;
    held.raw = asJson(value);
    this.notify(key);
    // A new object that says the same as the one before is nothing to store, and no change to the salon.
    if (held.raw === before || this.closed) return;
    this.unsaved.add(key);
    // Stored once the action that is running has finished: everything it changes goes into one
    // write, and the other tabs are told once.
    if (!this.saveQueued) {
      this.saveQueued = true;
      queueMicrotask(() => this.save());
    }
  }

  /** Calls `listener` whenever the value of `key` changes, from this tab or from another. Returns the way to stop. */
  listen(key: string, listener: () => void): () => void {
    return subscribe(this.listeners, key, listener);
  }

  /**
   * Calls `watcher` with the value before and after when ANOTHER tab has changed `key` in the
   * salon this tab shows. Not for this tab's own changes, not for what was stored when the tab
   * opened, and not when the whole salon was started again. Returns the way to stop.
   */
  watch<T>(key: string, watcher: (before: T, after: T) => void): () => void {
    return subscribe(this.watchers, key, watcher as Watcher);
  }

  /** Stores what was changed in this tab. Runs by itself after every change; tests call it to store at once. */
  save(): void {
    this.saveQueued = false;
    if (this.closed || this.unsaved.size === 0) return;
    for (const key of this.unsaved) if (this.perTab.has(key)) this.storeForTab(key);
    const changedSalon = () => [...this.unsaved].some((key) => !this.perTab.has(key));
    // Another tab may have stored something a moment ago that this tab has not been told about
    // yet. That is taken over first, except for the parts changed here, so one write never undoes
    // what the other tab did to other parts.
    if (changedSalon()) this.catchUp();
    if (changedSalon()) {
      this.head.changed = true;
      this.storeSalon();
    }
    this.unsaved.clear();
  }

  /**
   * For the moment the tab comes back to the front: takes over what other tabs stored meanwhile
   * (a tab the browser had put to sleep hears nothing), and builds a salon that nobody has
   * changed again when a new day has begun.
   */
  refresh(): void {
    if (this.closed) return;
    this.catchUp();
    if (!this.head.changed && this.head.day !== salonDay(this.setup.now())) this.startAgain(false);
  }

  /**
   * Clears the stored salon and what this tab keeps for itself, and starts a new salon for now.
   * The other open tabs follow: they take the new salon over like any other change, and clear
   * what they kept for themselves too.
   */
  reset(): void {
    if (this.closed) return;
    const own = this.forgetOwn();
    this.startAgain(true);
    for (const key of own) this.notify(key);
  }

  /** Stops listening to the page and stores nothing more. What is in memory stays readable. */
  close(): void {
    this.closed = true;
    for (const type of PAGE_EVENTS) this.setup.page?.removeEventListener?.(type, this.onPageEvent);
  }

  private readonly onPageEvent = (event: Event): void => {
    if (event.type !== 'storage') { this.refresh(); return; }
    // A cleared storage reports no key at all. Any other key belongs to something else.
    const key = (event as StorageEvent).key ?? null;
    if (key === null || key === this.salonKey) this.catchUp();
  };

  /** Takes over what another tab has stored since this tab last looked. */
  private catchUp(): void {
    if (this.closed) return;
    const stored = this.storedSalon();
    if (stored !== undefined && stored !== this.lastSeen) this.takeOver(stored);
  }

  /**
   * Makes this tab show the salon as another tab stored it. Only the parts that differ are
   * changed and announced, so a screen that shows other parts is not drawn again and an open form
   * keeps what is typed in it. Nothing is written here: taking over never answers with a write of
   * its own, so two tabs cannot keep each other busy.
   */
  private takeOver(raw: string | null): void {
    this.lastSeen = raw;
    const theirs = readStoredSalon(raw, this.report);
    // Removed, unreadable, or with a linked part of the wrong shape: this tab keeps the salon it
    // holds, and its next change stores all of it again.
    if (!theirs || theirs.linkedRefused) return;
    const startedAgain = theirs.builtAt !== this.head.builtAt;
    const wasReset = theirs.resetAt !== this.head.resetAt;
    // The other tab has started the salon again (a new day, a reset). What this tab was about to
    // store belongs to the salon before: parts of two salons are never mixed.
    if (startedAgain) this.dropUnsavedSalon();
    this.head = { day: theirs.day, builtAt: theirs.builtAt, changed: theirs.changed, resetAt: theirs.resetAt };
    const changes: Array<{ key: string; before: unknown; after: unknown }> = [];
    for (const key of new Set([...this.held.keys(), ...theirs.parts.keys()])) {
      if (this.perTab.has(key) || this.unsaved.has(key) || theirs.refused.includes(key)) continue;
      const held = this.held.get(key);
      const part = theirs.parts.get(key);
      if (!held) {
        if (part) this.held.set(key, { value: part.value, raw: part.raw });
        continue;
      }
      // A part that is not stored has its starting value, built for the moment the stored salon was started.
      if (!part && !this.startingValues.has(key)) { this.held.delete(key); continue; }
      const before = held.value;
      if (this.replace(held, part ?? this.startingOf(key))) changes.push({ key, before, after: held.value });
    }
    // After a reset in another tab this tab starts fresh as well: its own values go too.
    const own = wasReset ? this.forgetOwn() : [];
    for (const key of [...changes.map((change) => change.key), ...own]) this.notify(key);
    if (startedAgain) return;
    for (const { key, before, after } of changes) for (const watcher of [...this.watchers.get(key) ?? []]) watcher(before, after);
  }

  /**
   * Starts the salon again, for now: every part goes back to its starting value, built for this
   * moment. For a new day `resetAt` stays as it was; a reset by hand gives it a new value.
   */
  private startAgain(reset: boolean): void {
    const now = this.setup.now();
    const builtAt = laterThan(this.head.builtAt, now);
    this.head = { day: salonDay(new Date(builtAt)), builtAt, changed: false, resetAt: reset ? laterThan(this.head.resetAt, now) : this.head.resetAt };
    this.dropUnsavedSalon();
    const changed: string[] = [];
    for (const [key, held] of [...this.held]) {
      if (this.perTab.has(key)) continue;
      if (!this.startingValues.has(key)) this.held.delete(key);
      else if (this.replace(held, this.startingOf(key))) changed.push(key);
    }
    this.storeSalon();
    for (const key of changed) this.notify(key);
  }

  private dropUnsavedSalon(): void {
    for (const key of [...this.unsaved]) if (!this.perTab.has(key)) this.unsaved.delete(key);
  }

  /** Clears what this tab kept for itself, in memory and in its storage. Returns the keys whose value changed by it. */
  private forgetOwn(): string[] {
    const changed: string[] = [];
    for (const key of this.perTab) {
      this.unsaved.delete(key);
      try { this.setup.tab?.removeItem(this.tabKey(key)); } catch { /* Blocked: nothing was kept there either. */ }
      const held = this.held.get(key);
      if (held && this.replace(held, this.startingOf(key))) changed.push(key);
    }
    return changed;
  }

  /** Gives `held` the value of `fresh`. False, and nothing changes, when both say the same: the screens keep the object they have. */
  private replace(held: Held, fresh: Held): boolean {
    const raw = this.rawOf(fresh);
    if (raw === this.rawOf(held)) return false;
    held.value = fresh.value;
    held.raw = raw;
    return true;
  }

  private hold(key: string): Held {
    let held = this.held.get(key);
    if (!held) {
      held = (this.perTab.has(key) ? this.readForTab(key) : null) ?? this.startingOf(key);
      this.held.set(key, held);
    }
    return held;
  }

  private startingOf(key: string): Held {
    const starting = this.startingValues.get(key);
    return { value: typeof starting === 'function' ? (starting as (builtAt: Date) => unknown)(this.builtAt) : starting };
  }

  private rawOf(held: Held): string | null {
    if (held.raw === undefined) held.raw = asJson(held.value);
    return held.raw;
  }

  private notify(key: string): void {
    for (const listener of [...this.listeners.get(key) ?? []]) listener();
  }

  private tabKey(key: string): string { return `${this.setup.prefix}:${key}`; }

  /** A value this tab stored for itself, if it has the right shape. One that has not is left alone and replaced by the next change. */
  private readForTab(key: string): Held | null {
    let raw: string | null;
    try { raw = this.setup.tab?.getItem(this.tabKey(key)) ?? null; } catch { return null; }
    if (raw === null) return null;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { this.report(`Stored data were not used: ${key} could not be read.`); return null; }
    const problem = storedShapeProblem(key, value);
    if (problem) { this.report(`Stored data were not used: ${problem}.`); return null; }
    return { value };
  }

  private storeForTab(key: string): void {
    const held = this.held.get(key);
    if (!held) return;
    const raw = this.rawOf(held);
    try {
      if (raw === null) this.setup.tab?.removeItem(this.tabKey(key));
      else this.setup.tab?.setItem(this.tabKey(key), raw);
    } catch { /* Full or blocked: the value stays in memory for this page load. */ }
  }

  /** The stored salon as text; null when nothing is stored, undefined when the storage cannot be read. */
  private storedSalon(): string | null | undefined {
    if (!this.setup.lasting) return undefined;
    try { return this.setup.lasting.getItem(this.salonKey) ?? null; } catch { return undefined; }
  }

  /**
   * Writes the salon to the lasting storage. A salon that nobody has changed is stored without
   * parts: every tab builds them from `builtAt`. From the first change on, everything this tab
   * holds is stored, the unchanged parts too, so a changed salon no longer depends on how a later
   * build of the app builds its starting data.
   */
  private storeSalon(): void {
    if (!this.setup.lasting) return;
    const parts: Array<[string, string]> = [];
    if (this.head.changed) {
      for (const [key, held] of this.held) {
        if (this.perTab.has(key)) continue;
        const raw = this.rawOf(held);
        if (raw !== null) parts.push([key, raw]);
      }
    }
    const text = salonText(this.head, parts);
    try {
      this.setup.lasting.setItem(this.salonKey, text);
      this.lastSeen = text;
    } catch { /* Full or blocked: the salon stays in this tab's memory, and the next change tries again. */ }
  }
}

function subscribe<T>(all: Map<string, Set<T>>, key: string, entry: T): () => void {
  let entries = all.get(key);
  if (!entries) { entries = new Set(); all.set(key, entries); }
  entries.add(entry);
  return () => { entries.delete(entry); };
}
