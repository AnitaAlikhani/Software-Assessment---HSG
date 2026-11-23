import { storedShapeProblem } from './storedShapes.js';

/**
 * The salon's settings as the server keeps them, for a device that is signed in with the owner's
 * key (src/liveWhatsApp.ts). useDemoState (src/useDemoState.ts) reads and writes these parts here
 * instead of in the browser's own storage; everything else (calendar, requests, customers, the
 * built-in chats, time blocks) stays in the browser (src/demoStore.ts) for now.
 *
 * The rules, in short:
 * - The record is loaded once when the app starts. A part that is not in it is the built-in
 *   value the app starts with, never what this browser had stored before.
 * - Only a change of the owner is sent, never a page that loads. A change shows at once. While a
 *   request is on its way nothing else is sent; what is changed meanwhile waits and goes in the
 *   next request, with the latest value of each part (each value already holds the ones before).
 * - Refused or not sent: the screen goes back to what the server has and the owner is told, with
 *   "Try again". A 409 (another device was faster) takes the server's record and sends nothing by itself.
 * - Nothing of the record is kept in the browser's storage, so signing out leaves nothing behind.
 */

/** The parts of the salon the server keeps (the contract of delivery 3B). */
export const SHARED_PARTS: readonly string[] = ['companySettings', 'services', 'employees', 'bookingHours', 'closedDates', 'absences', 'shifts', 'aiSettings'];
const SHARED = new Set(SHARED_PARTS);
export const isSharedPart = (key: string): boolean => SHARED.has(key);

/**
 * - `local`: the device is not signed in; this module is not used.
 * - `loading`: the record is on its way ("Loading your salon…").
 * - `ready`: the screens show the record.
 * - `failed`: the record could not be loaded; the app says so and offers "Try again" and "Sign out".
 */
export type SalonPhase = 'local' | 'loading' | 'ready' | 'failed';

export interface SalonNotice {
  /** Counts up, so a screen can tell a new notice from one it has shown. */
  id: number;
  /** `error`: a change was not saved; `warning`: part of the salon could not be read; `info`: updated from elsewhere. */
  kind: 'error' | 'warning' | 'info';
  text: string;
  /** The change that was not saved can be sent again ("Try again"). */
  retry: boolean;
}

export interface SalonStatus {
  phase: SalonPhase;
  /** Why the record could not be loaded (phase `failed`). */
  loadError: string | null;
  /** Changes are on their way to the server, or waiting to go. */
  saving: boolean;
  /** When the server last took a change of this device (ms), for a short "Saved". */
  savedAt: number | null;
  notice: SalonNotice | null;
  /**
   * Counts the times the salon on screen was replaced as a whole from outside: loaded at the
   * start, taken from the server after a 409, reset. Forms that hold a copy start again then.
   */
  replaced: number;
  /** Counts the times another device or tab changed what is on screen. A form without unsaved changes starts again then. */
  updated: number;
}

/** An answer of the server: its status and its JSON (null when it sent none). Null itself when no answer came. */
export interface ServerAnswer { status: number; data: unknown }
export type SalonRequest = (key: string, method: 'GET' | 'PUT' | 'DELETE', body?: unknown) => Promise<ServerAnswer | null>;

/** What the tabs of one browser tell each other: a save of one of them, or the reset of the shared salon. */
export interface TabMessage { rev: number; baseRev: number; parts?: Record<string, unknown>; updatedAt?: string }
export interface TabChannel {
  post: (message: TabMessage) => void;
  listen: (receive: (message: TabMessage) => void) => () => void;
}

export interface SharedSalonSetup {
  request: SalonRequest;
  /** The moment the browser's own salon was built for: starting values that depend on the date are built for it. */
  builtAt: () => Date;
  /** The other tabs of this browser. Null where there is no such channel. */
  tabs?: TabChannel | null;
  now?: () => number;
  /** Told when a part from the server is not used, and why. */
  report?: (message: string) => void;
}

export const SALON_TEXTS = {
  /** Under the heading "Your salon could not be loaded" (src/components/SalonGate.tsx). */
  loadFailed: 'The server could not be reached. Check your connection and try again.',
  keyRefused: 'The server did not accept the owner link of this device. Sign out here, then open your latest owner link.',
  notSaved: 'Your change was not saved.',
  unreachable: 'The server could not be reached. Check your connection.',
  serverFailed: 'The server could not save it.',
  waitPlease: 'Too many tries from this connection. Please wait a few minutes.',
  conflict: 'Changed on another device. Look at it and save again.',
  /** An earlier change that was waiting for "Try again" when the 409 came. */
  earlierDropped: 'An earlier change that was not saved is not sent either.',
  updated: 'Updated from another device.',
  resetFailed: 'The shared salon could not be reset.',
} as const;

/** How the owner reads the name of a part in a message. */
const PART_NAMES: Record<string, string> = {
  companySettings: 'the salon details', services: 'the services', employees: 'the team', bookingHours: 'the opening hours',
  closedDates: 'the closed dates', absences: 'the absences', shifts: 'the working days', aiSettings: 'the AI receptionist settings',
};
const partNames = (keys: string[]): string => {
  const names = [...new Set(keys.map((key) => PART_NAMES[key] ?? key))];
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};

/** "Your change was not saved: the services changed elsewhere in the meantime. …" */
export const changedElsewhereText = (keys: string[]): string =>
  `Your change was not saved: ${partNames(keys)} changed elsewhere in the meantime. Look again and make your change once more.`;

/**
 * "An earlier change of the services was not saved and can no longer be sent. …": a change that
 * waited for "Try again" when this device saved the same part again. That save was made on the
 * screen after the change had gone back, so it does not hold it.
 */
export const earlierNotSavedText = (keys: string[]): string =>
  `An earlier change of ${partNames(keys)} was not saved and can no longer be sent. Look again and make it once more.`;

/** "Part of your salon could not be read: the services. …" */
export const unreadableText = (keys: string[]): string =>
  `Part of your salon could not be read: ${partNames(keys)}. The built-in version is shown until you save ${keys.length === 1 ? 'that part' : 'those parts'} again.`;

type Waiter = (saved: boolean) => void;

/**
 * A change of this browser's own parts (calendar, requests, …) made in the same action as a
 * change of a shared part. The action is one whole: when the server does not take the shared
 * part, the browser's part goes back too; "Try again" makes it again (src/useDemoState.ts).
 */
export interface LocalChange {
  before: unknown;
  after: unknown;
  read: () => unknown;
  write: (value: unknown) => void;
}

interface Batch {
  done: Promise<boolean>;
  settle: Waiter;
  local: LocalChange[];
  /** The shared parts this action changed. */
  keys: Set<string>;
  /**
   * Sent by a form that stays open until the server has it (src/useDemoState.ts pendingFormSave):
   * not taken, the form itself is the way to try again, so nothing of it is kept for "Try again".
   */
  form: boolean;
}

/**
 * Changes the server did not take, for "Try again": the parts, the server's value of each part
 * when the change failed (a lost change belongs to that record and to no later one), and the
 * browser's own changes of the same actions.
 */
interface Lost {
  parts: Map<string, unknown>;
  bases: Map<string, string | null>;
  local: LocalChange[];
  /**
   * The parts "Try again" may send. A part a form sent is not among them: the form keeps it and
   * its own Save tries again. It is kept here only to learn whether the server has it after all.
   */
  sendable: Set<string>;
}

/** Puts a browser's part back to `to` if it still holds `from`: what was changed since stays. */
const swap = (change: LocalChange, from: unknown, to: unknown): boolean => {
  if (asJsonOf(change.read()) !== asJsonOf(from)) return false;
  change.write(to);
  return true;
};
const asJsonOf = (value: unknown): string | null => {
  try { return JSON.stringify(value) ?? null; } catch { return null; }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const asJson = (value: unknown): string | null => {
  try { return JSON.stringify(value) ?? null; } catch { return null; }
};
/** The server's sentence in an answer, if it sent one. */
export const sentenceOf = (data: unknown): string | null => {
  const error = isRecord(data) ? data.error : undefined;
  return typeof error === 'string' && error.trim() ? error.trim() : null;
};

/** Whether sending the same change again can help: no answer, the server failed, or it asked to wait. */
const retryable = (answer: ServerAnswer | null): boolean => !answer || answer.status >= 500 || answer.status === 429;

/** Why a save did not happen, in the owner's words. */
export function saveProblem(answer: ServerAnswer | null): string {
  if (!answer) return SALON_TEXTS.unreachable;
  const sentence = sentenceOf(answer.data);
  if (answer.status === 401 || answer.status === 403) return 'The server did not accept the owner link of this device.';
  if (answer.status === 429) return sentence ?? SALON_TEXTS.waitPlease;
  if (answer.status >= 500) return sentence ?? SALON_TEXTS.serverFailed;
  return sentence ?? SALON_TEXTS.serverFailed;
}

/** Why the record could not be loaded, in the owner's words. */
export function loadProblem(answer: ServerAnswer | null): string {
  if (!answer) return SALON_TEXTS.loadFailed;
  if (answer.status === 401 || answer.status === 403) return SALON_TEXTS.keyRefused;
  if (answer.status === 429) return sentenceOf(answer.data) ?? SALON_TEXTS.waitPlease;
  return sentenceOf(answer.data) ?? SALON_TEXTS.loadFailed;
}

export class SharedSalon {
  private phase: SalonPhase = 'local';
  private readOnlyPage = false;
  private key: string | null = null;
  /** Counts each start and sign-out: an answer to an earlier one is dropped. */
  private generation = 0;
  private rev = 0;
  private updatedAt: string | null = null;
  /** The parts as the server has them (only those in its record). */
  private record = new Map<string, unknown>();
  /** What the screens show of a part while a change of it is not saved yet. */
  private shown = new Map<string, unknown>();
  /** Changes not sent yet, by part: the latest value of each. */
  private queued = new Map<string, unknown>();
  /** The request on its way: its parts. */
  private inflight: Map<string, unknown> | null = null;
  /** The changes the last failures threw away, for "Try again". */
  private lost: Lost | null = null;
  /** The browser's own changes made in the action that is running before it changed a shared part. */
  private tickLocal: LocalChange[] = [];
  private tickClearPlanned = false;
  /** Counts every change of the record this device holds, so an answer asked for before one is known as old. */
  private recordStamp = 0;
  /** The parts the server said it could not read, already told for this load. */
  private unreadableTold = new Set<string>();
  /** The changes made in the action that is running, not handed to a request yet. */
  private openBatch: Batch | null = null;
  private queuedBatches: Batch[] = [];
  private sendingBatches: Batch[] = [];
  private flushPlanned = false;
  /** A revision another device reported that this device has not loaded yet. */
  private otherRev: number | null = null;
  private reloading = false;
  private quietReload = false;
  private loadError: string | null = null;
  private savedAt: number | null = null;
  private replacedCount = 0;
  private updatedCount = 0;
  private notice: SalonNotice | null = null;
  /** The notice that speaks of the lost changes: it goes when they are settled. */
  private lostNoticeId = 0;
  /**
   * The parts a message is about whose save was not taken and is not kept (another device was
   * faster, a refusal): this device's next save of them that IS taken settles the message.
   */
  private noticeParts: Set<string> | null = null;
  private noticeCount = 0;
  /** The starting value of each part read, or the function that builds it, and what it built. */
  private readonly starting = new Map<string, unknown>();
  private readonly built = new Map<string, { at: number; value: unknown }>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly statusListeners = new Set<() => void>();
  private status: SalonStatus;
  private readonly now: () => number;
  private readonly report: (message: string) => void;
  private stopTabs: (() => void) | null = null;

  constructor(private readonly setup: SharedSalonSetup) {
    this.now = setup.now ?? (() => Date.now());
    this.report = setup.report ?? (() => {});
    this.status = this.makeStatus();
    this.stopTabs = setup.tabs?.listen((message) => this.fromOtherTab(message)) ?? null;
  }

  /** Whether useDemoState reads and writes `key` here: a shared part, on a signed-in device. */
  serves(key: string): boolean {
    return this.phase !== 'local' && SHARED.has(key);
  }

  get current(): SalonStatus { return this.status; }
  /** The record's revision as this device holds it. */
  get revision(): number { return this.rev; }
  get signedInWith(): string | null { return this.key; }
  /** The customers' booking page in the owner's browser: it shows the record and never changes it. */
  get readOnly(): boolean { return this.readOnlyPage; }

  /**
   * Loads the record again, quietly: for a page that has no chats' answer to learn of a later
   * save from (the booking page, when its tab comes back to the front).
   */
  reload(): void {
    if (this.phase !== 'ready') return;
    this.otherRev = Number.NaN;
    this.quietReload = true;
    this.reloadWhenIdle();
  }

  /**
   * Starts with the owner's key: loads the record. Nothing is sent but this one request; a
   * change on screen can only be made once the record is there.
   */
  begin(key: string, { readOnly = false }: { readOnly?: boolean } = {}): Promise<void> {
    this.dropAll();
    this.unreadableTold = new Set();
    this.readOnlyPage = readOnly;
    this.key = key;
    this.phase = 'loading';
    this.loadError = null;
    this.notifyAll();
    return this.load();
  }

  /** "Try again" on the screen that says the record could not be loaded. */
  retryLoad(): Promise<void> {
    if (!this.key || this.phase !== 'failed') return Promise.resolve();
    this.phase = 'loading';
    this.loadError = null;
    this.changed();
    return this.load();
  }

  /**
   * "Sign out on this device": back to the browser's own salon. What was not saved yet is not
   * sent any more, and nothing of the record stays (it was never put in the browser's storage).
   */
  signOut(): void {
    if (this.phase === 'local' && !this.key) return;
    this.dropAll();
    this.key = null;
    this.phase = 'local';
    this.loadError = null;
    this.notifyAll();
  }

  /** Stops listening to the other tabs. */
  close(): void {
    this.stopTabs?.();
    this.stopTabs = null;
  }

  /**
   * The value the server has of a shared part (its record's, else the built-in one), not a change
   * on its way. A form compares with it: what differs is what the owner typed and has not saved.
   * Listeners of the part are told when it changes.
   */
  serverValue<T>(key: string, fallback: T): T {
    if (this.record.has(key)) return this.record.get(key) as T;
    // The built-in value, as the screens' own reading registered it; the fallback before any did.
    return (this.starting.has(key) ? this.builtIn(key) : fallback) as T;
  }

  /** The value of a shared part: a change not saved yet, else the server's, else the built-in one. */
  read<T>(key: string, starting: T | ((builtAt: Date) => T)): T {
    this.starting.set(key, starting);
    if (this.shown.has(key)) return this.shown.get(key) as T;
    if (this.record.has(key)) return this.record.get(key) as T;
    return this.builtIn(key) as T;
  }

  /**
   * A change of the owner, as the setter of useState makes it. It shows at once and is sent with
   * the other changes of the same action. Before the record is there nothing can be changed.
   */
  write<T>(key: string, next: T | ((previous: T) => T)): void {
    if (this.phase !== 'ready' || !SHARED.has(key) || this.readOnlyPage) return;
    const previous = this.valueOf(key);
    const value = typeof next === 'function' ? (next as (previous: T) => T)(previous as T) : next;
    if (Object.is(value, previous) || asJson(value) === asJson(previous)) return;
    this.shown.set(key, value);
    this.queued.set(key, value);
    if (!this.openBatch) {
      let settle: Waiter = () => {};
      const done = new Promise<boolean>((resolve) => { settle = resolve; });
      // What the same action changed of the browser's own parts before this belongs to it.
      this.openBatch = { done, settle, local: this.tickLocal.splice(0), keys: new Set(), form: false };
    }
    this.openBatch.keys.add(key);
    this.notify(key);
    this.planFlush();
  }

  /**
   * For a message that says something is done: while the action that is running has changed a
   * shared part, the promise says whether the server took it (true) or not (false). Null when
   * nothing of it waits for the server, so the message can show at once.
   */
  pendingSave(): Promise<boolean> | null {
    return this.openBatch?.done ?? null;
  }

  /**
   * As pendingSave, for a form that sends what it holds and stays open until the server has
   * taken it. When it is not taken, the form keeps what was typed and its own Save is the one way
   * to try again: the message offers no "Try again" and no lost change of it is kept.
   */
  pendingFormSave(): Promise<boolean> | null {
    if (!this.openBatch) return null;
    this.openBatch.form = true;
    return this.openBatch.done;
  }

  /**
   * A change of one of the browser's own parts (src/useDemoState.ts). Made in the same action as
   * a change of a shared part, it goes back with it when the server does not take that one.
   */
  noteLocalChange(change: LocalChange): void {
    if (this.phase !== 'ready') return;
    if (this.openBatch) { this.openBatch.local.push(change); return; }
    this.tickLocal.push(change);
    if (this.tickClearPlanned) return;
    this.tickClearPlanned = true;
    // An action that changes no shared part: nothing of it waits for the server.
    queueMicrotask(() => { this.tickClearPlanned = false; this.tickLocal = []; });
  }

  /**
   * "Try again" on the message that says a change was not saved. It sends the change only over
   * the record it was made on: a part that was changed elsewhere since is not overwritten.
   */
  retry(): void {
    if (!this.lost || this.phase !== 'ready') return;
    if (this.lostIsOld() || !this.lost || this.lost.sendable.size === 0) { this.changed(); return; }
    const lost = this.lost;
    this.lost = null;
    this.notice = null; this.noticeParts = null;
    for (const [key, value] of lost.parts) if (lost.sendable.has(key)) this.write(key, () => value);
    for (const change of lost.local) if (swap(change, change.before, change.after)) this.openBatch?.local.push(change);
    this.changed();
  }

  dismissNotice(): void {
    if (!this.notice) return;
    this.notice = null;
    this.noticeParts = null;
    this.lost = null;
    this.changed();
  }

  /**
   * The revision the chats' answer reports (`salonRev`). When it is not the one this device holds,
   * another device has saved: the record is loaded again once nothing of this device is on its way.
   */
  noteRevision(rev: number | null | undefined): void {
    if (this.phase !== 'ready' || typeof rev !== 'number' || !Number.isFinite(rev)) return;
    if (rev === this.rev) { this.otherRev = null; return; }
    this.otherRev = rev;
    this.reloadWhenIdle();
  }

  /**
   * Study tools: empties the record (DELETE). Afterwards every part is the built-in one. Returns
   * why it could not be done, or null.
   */
  async resetShared(): Promise<string | null> {
    const key = this.key;
    if (!key || this.phase === 'local') return SALON_TEXTS.resetFailed;
    const generation = this.generation;
    const answer = await this.setup.request(key, 'DELETE');
    if (generation !== this.generation) return null;
    if (!answer || answer.status < 200 || answer.status >= 300) return `${SALON_TEXTS.resetFailed} ${saveProblem(answer)}`;
    const before = this.rev;
    // The record stays with the next revision and no parts, so a device that still holds an old
    // revision never meets the same number again; 0 only where nothing was stored.
    const data = isRecord(answer.data) ? answer.data : {};
    const rev = typeof data.rev === 'number' && Number.isFinite(data.rev) ? data.rev : 0;
    this.dropAll();
    this.phase = 'ready';
    this.takeRecord({ rev, parts: {}, ...(typeof data.updatedAt === 'string' ? { updatedAt: data.updatedAt } : {}) });
    this.replacedCount += 1;
    // The other tabs load the record again: they do not hold this revision yet.
    this.setup.tabs?.post({ rev, baseRev: before });
    this.notifyAll();
    return null;
  }

  listen(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) { set = new Set(); this.listeners.set(key, set); }
    set.add(listener);
    return () => { set.delete(listener); };
  }

  /** Calls `listener` whenever the status changes. */
  watchStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  // ---------- inside ----------

  private valueOf(key: string): unknown {
    if (this.shown.has(key)) return this.shown.get(key);
    if (this.record.has(key)) return this.record.get(key);
    return this.builtIn(key);
  }

  /** The value the app starts with for a part, built once for the moment the browser's salon was built for. */
  private builtIn(key: string): unknown {
    const starting = this.starting.get(key);
    if (typeof starting !== 'function') return starting;
    const at = this.setup.builtAt().getTime();
    const cached = this.built.get(key);
    if (cached?.at === at) return cached.value;
    const value = (starting as (builtAt: Date) => unknown)(new Date(at));
    this.built.set(key, { at, value });
    return value;
  }

  private async load(): Promise<void> {
    const key = this.key;
    if (!key) return;
    const generation = ++this.generation;
    const answer = await this.setup.request(key, 'GET');
    if (generation !== this.generation) return;
    if (answer && answer.status === 404) {
      // This address has no server for the salon (a static copy of the site): the device is not
      // signed in here, as the chats say too. The browser's own salon is shown, as without a key.
      this.phase = 'local';
      this.notifyAll();
      return;
    }
    if (!answer || answer.status < 200 || answer.status >= 300 || !isRecord(answer.data)) {
      this.phase = 'failed';
      this.loadError = loadProblem(answer);
      this.notifyAll();
      return;
    }
    this.phase = 'ready';
    this.takeRecord(answer.data);
    this.replacedCount += 1;
    this.tellUnreadable(answer.data);
    this.notifyAll();
  }

  /** Says once per load which stored parts the server could not read (`unreadable`). Never over a change that waits for "Try again". */
  private tellUnreadable(data: Record<string, unknown>): void {
    const listed = Array.isArray(data.unreadable) ? data.unreadable.filter((item): item is string => typeof item === 'string') : [];
    const fresh = listed.filter((item) => !this.unreadableTold.has(item));
    if (fresh.length === 0 || this.lost) return;
    for (const item of fresh) this.unreadableTold.add(item);
    this.say('warning', unreadableText(fresh), false);
  }

  /** What the server has of a part, as this device last learned it: its record's value, else the built-in one. */
  private serverJson(key: string): string | null {
    return asJson(this.record.has(key) ? this.record.get(key) : this.builtIn(key));
  }

  /**
   * Settles the lost changes against what the device has just learned of the server. A part
   * whose lost value the server has now IS saved (an answer that got lost on the way, another
   * tab that saved the same): it leaves the lost changes. A part the server still has as before
   * waits for "Try again". A part that differs from both was changed elsewhere: then the lost
   * changes are dropped and one message says both. When nothing is left the "not saved" message
   * goes, and the top bar may say "Saved". Returns whether the lost changes were dropped as old.
   */
  private lostIsOld(): boolean {
    const lost = this.lost;
    if (!lost) return false;
    const moved: string[] = [];
    for (const [key, value] of [...lost.parts]) {
      const now = this.serverJson(key);
      if (now === asJson(value)) { lost.parts.delete(key); lost.bases.delete(key); lost.sendable.delete(key); continue; }
      if (now !== lost.bases.get(key)) moved.push(key);
    }
    if (moved.length > 0) {
      this.lost = null;
      this.say('error', changedElsewhereText(moved), false);
      return true;
    }
    if (lost.parts.size === 0) {
      // Everything of it is on the server after all: the browser's own part of those actions is made again.
      for (const change of lost.local) swap(change, change.before, change.after);
      this.lost = null;
      if (this.notice?.id === this.lostNoticeId) { this.notice = null; this.noticeParts = null; }
      this.savedAt = this.now();
    }
    return false;
  }

  /** Takes out of the lost changes every part whose lost value the server has now: that part is saved after all. */
  private dropSavedFromLost(): void {
    const lost = this.lost;
    if (!lost) return;
    for (const [key, value] of [...lost.parts]) {
      if (this.serverJson(key) === asJson(value)) { lost.parts.delete(key); lost.bases.delete(key); lost.sendable.delete(key); }
    }
  }

  /**
   * This device's own save of some parts was taken (or is the newest thing that was tried): what
   * it means for an earlier change of the same parts that was not saved.
   * - What a form had sent is settled by it: the form shows what it holds and whether that is saved.
   * - A change of a switch or a delete button that waited for "Try again" is NOT in the new save:
   *   that one was made on the screen after the change had gone back. It can no longer be sent
   *   (it would put an older value over the newer save), so it is dropped. Returns those parts, for
   *   the message that tells the owner to make the change once more.
   */
  private supersedeLost(keys: Iterable<string>): string[] {
    const lost = this.lost;
    if (!lost) return [];
    const forgotten: string[] = [];
    for (const key of keys) {
      if (!lost.parts.has(key)) continue;
      // The save happens to hold the lost change (the owner made it again herself): nothing is forgotten.
      if (lost.sendable.has(key) && this.serverJson(key) !== asJson(lost.parts.get(key))) forgotten.push(key);
      lost.parts.delete(key); lost.bases.delete(key); lost.sendable.delete(key);
    }
    if (forgotten.length > 0) {
      // What else waited belongs to the same message and goes with it: one message, one thing to do.
      forgotten.push(...[...lost.sendable].filter((key) => !forgotten.includes(key)));
      this.lost = null;
      return forgotten;
    }
    if (lost.parts.size === 0) {
      this.lost = null;
      if (this.notice?.id === this.lostNoticeId) { this.notice = null; this.noticeParts = null; }
    }
    return [];
  }

  /**
   * After a save of this device was taken: a message about an earlier save of the same parts that
   * was not taken and not kept (another device was faster, a refusal) is settled by it, and an
   * earlier change that waited for "Try again" is settled or, where the new save does not hold it,
   * dropped with a message of its own.
   */
  private settleAfterOwnSave(keys: Iterable<string>): void {
    const saved = new Set(keys);
    if (this.notice?.kind === 'error' && this.noticeParts && [...this.noticeParts].every((key) => saved.has(key))) {
      this.notice = null;
      this.noticeParts = null;
    }
    const forgotten = this.supersedeLost(saved);
    if (forgotten.length > 0) this.say('error', earlierNotSavedText(forgotten), false);
    else this.lostIsOld();
  }

  /**
   * Makes the server's record the one this device holds. Parts of a shape the app cannot use are
   * left out (the built-in value shows) and reported. Returns the parts whose value changed.
   */
  private takeRecord(data: Record<string, unknown>): string[] {
    const before = new Map(SHARED_PARTS.map((key) => [key, asJson(this.valueOf(key))]));
    this.rev = typeof data.rev === 'number' && Number.isFinite(data.rev) ? data.rev : 0;
    this.updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null;
    this.record = new Map();
    const parts = isRecord(data.parts) ? data.parts : {};
    for (const [key, value] of Object.entries(parts)) {
      if (!SHARED.has(key)) continue;
      const problem = storedShapeProblem(key, value);
      if (problem) { this.report(`The server's ${key} were not used: ${problem}.`); continue; }
      this.record.set(key, value);
    }
    this.otherRev = null;
    this.recordStamp += 1;
    const changed = SHARED_PARTS.filter((key) => !this.shown.has(key) && before.get(key) !== asJson(this.valueOf(key)));
    return changed;
  }

  private planFlush(): void {
    if (this.flushPlanned) return;
    this.flushPlanned = true;
    // After the action that is running: everything it changes goes in one request.
    queueMicrotask(() => {
      this.flushPlanned = false;
      if (this.openBatch) { this.queuedBatches.push(this.openBatch); this.openBatch = null; }
      this.send();
    });
    this.changed();
  }

  private send(): void {
    const key = this.key;
    if (!key || this.phase !== 'ready' || this.inflight || this.queued.size === 0) { this.changed(); return; }
    const parts = this.queued;
    this.queued = new Map();
    this.inflight = parts;
    this.sendingBatches = this.queuedBatches;
    this.queuedBatches = [];
    const baseRev = this.rev;
    const generation = this.generation;
    this.changed();
    void this.setup.request(key, 'PUT', { baseRev, parts: Object.fromEntries(parts) })
      .catch(() => null)
      .then((answer) => { if (generation === this.generation) this.answered(answer, parts, baseRev); });
  }

  private answered(answer: ServerAnswer | null, parts: Map<string, unknown>, baseRev: number): void {
    this.inflight = null;
    const batches = this.sendingBatches;
    this.sendingBatches = [];
    if (answer && answer.status >= 200 && answer.status < 300) {
      const data = isRecord(answer.data) ? answer.data : {};
      this.rev = typeof data.rev === 'number' ? data.rev : baseRev + 1;
      this.updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : this.updatedAt;
      for (const [key, value] of parts) {
        this.record.set(key, value);
        // Nothing newer waits: the screen's value is now the server's.
        if (!this.queued.has(key) && this.shown.get(key) === value) this.shown.delete(key);
        // What the server has changed: a form that compares with it learns of it (src/formFollow.ts).
        this.notify(key);
      }
      this.recordStamp += 1;
      this.savedAt = this.now();
      this.settleAfterOwnSave(parts.keys());
      // This device's own save: what the chats reported before it says nothing new.
      this.otherRev = null;
      this.setup.tabs?.post({ rev: this.rev, baseRev, parts: Object.fromEntries(parts), ...(this.updatedAt ? { updatedAt: this.updatedAt } : {}) });
      for (const batch of batches) batch.settle(true);
      if (this.queued.size > 0) this.send();
      else this.changed();
      return;
    }
    // Not saved. Whatever waited is not sent either: it was made on top of what failed.
    const waiting = this.queuedBatches;
    this.queuedBatches = [];
    const thrownAway = new Map([...parts, ...this.queued]);
    this.queued = new Map();
    const touched = [...this.shown.keys()];
    this.shown = new Map();
    // The sign in the top bar speaks of the latest thing that happened: no "Saved" next to "not saved".
    this.savedAt = null;
    // The browser's own parts of the same actions go back too, the latest first.
    const local = [...batches, ...waiting].flatMap((batch) => batch.local);
    for (const change of [...local].reverse()) swap(change, change.after, change.before);
    if (answer?.status === 409 && isRecord(answer.data)) {
      // Another device was faster: its record is the salon now. The lost change is not sent again by itself.
      this.takeRecord(answer.data);
      this.replacedCount += 1;
      // An earlier lost change the server turns out to have is settled. One that waited for "Try
      // again" and is not there is dropped with this one, and said; what a form had sent stays in the form.
      this.dropSavedFromLost();
      const earlier = Boolean(this.lost && this.lost.sendable.size > 0);
      this.lost = null;
      this.say('error', earlier ? `${SALON_TEXTS.conflict} ${SALON_TEXTS.earlierDropped}` : SALON_TEXTS.conflict, false, thrownAway.keys());
      this.tellUnreadableQuietly(answer.data);
    } else if (!retryable(answer)) {
      // Refused (400, 413, …): the same change would be refused again, so there is nothing to try
      // again. The message says why; a form that is open keeps what was typed (src/formFollow.ts).
      this.say('error', `${SALON_TEXTS.notSaved} ${saveProblem(answer)}`, false, thrownAway.keys());
    } else {
      // What a form sent stays in the form, whose own Save is the way to try again; the rest is kept for "Try again".
      const failed = [...batches, ...waiting];
      const formKeys = new Set(failed.filter((batch) => batch.form).flatMap((batch) => [...batch.keys]));
      const kept = thrownAway;
      const sendable = new Set([...thrownAway.keys()].filter((key) => !formKeys.has(key)));
      const keptLocal = failed.filter((batch) => !batch.form).flatMap((batch) => batch.local);
      // Kept with the server's value of each part now, which is what the change was made on.
      const bases = new Map([...kept.keys()].map((key) => [key, this.serverJson(key)]));
      // An earlier change of the same part that waited for "Try again" is not in this one (it was
      // made after that change had gone back): it cannot be kept beside it, and the message says so.
      const forgotten = this.supersedeLost(thrownAway.keys());
      const stillEarlier = this.lost && !this.lostIsOld() ? this.lost : null;
      const merged = stillEarlier
        ? { parts: new Map([...stillEarlier.parts, ...kept]), bases: new Map([...bases, ...stillEarlier.bases]), local: [...stillEarlier.local, ...keptLocal], sendable: new Set([...stillEarlier.sendable, ...sendable]) }
        : { parts: kept, bases, local: keptLocal, sendable };
      this.lost = merged.parts.size > 0 ? merged : null;
      this.say('error', `${SALON_TEXTS.notSaved} ${saveProblem(answer)}${forgotten.length > 0 ? ` ${SALON_TEXTS.earlierDropped}` : ''}`, Boolean(this.lost && this.lost.sendable.size > 0));
      if (this.lost) this.lostNoticeId = this.noticeCount;
    }
    for (const batch of [...batches, ...waiting]) batch.settle(false);
    for (const key of new Set([...touched, ...SHARED_PARTS])) this.notify(key);
    this.changed();
  }

  private reloadWhenIdle(): void {
    if (this.reloading || this.inflight || this.queued.size > 0 || this.openBatch || this.flushPlanned) return;
    const key = this.key;
    if (!key || this.otherRev === null) return;
    this.reloading = true;
    const generation = this.generation;
    const stamp = this.recordStamp;
    const quiet = this.quietReload;
    this.quietReload = false;
    void this.setup.request(key, 'GET').catch(() => null).then((answer) => {
      this.reloading = false;
      if (generation !== this.generation || this.phase !== 'ready') return;
      // A change was made meanwhile: it goes first, and its answer tells whether the record moved on.
      if (this.inflight || this.queued.size > 0 || this.openBatch) return;
      // The record this device holds moved on while the answer was on its way (its own save,
      // another tab's): the answer is older than what is on screen and is not used. If another
      // device is still reported ahead, the record is asked for again.
      if (stamp !== this.recordStamp) { this.reloadWhenIdle(); return; }
      // Not loaded: the screens keep what they show; the next answer of the chats tries again.
      if (!answer || answer.status < 200 || answer.status >= 300 || !isRecord(answer.data)) return;
      const changed = this.takeRecord(answer.data);
      if (changed.length > 0) this.updatedCount += 1;
      // A change that waits for "Try again" is never passed over in silence: either it still
      // stands (its message stays) or its part moved on (one message says both).
      // A change of this device the server turns out to have (its answer got lost) is no news from another device.
      const hadLost = Boolean(this.lost);
      const spoke = this.lostIsOld() || hadLost;
      if (!spoke) this.tellUnreadableQuietly(answer.data);
      if (changed.length > 0 && !quiet && !spoke && this.notice?.kind !== 'warning') this.say('info', SALON_TEXTS.updated, false);
      for (const key of changed) this.notify(key);
      this.changed();
    });
  }

  /** As tellUnreadable, for an answer that is not the start (a reload, a 409): no new message over one that is shown. */
  private tellUnreadableQuietly(data: Record<string, unknown>): void {
    if (this.notice && this.notice.kind !== 'info') return;
    this.tellUnreadable(data);
  }

  /** Another tab of this browser saved, or reset the shared salon. */
  private fromOtherTab(message: TabMessage): void {
    if (this.phase !== 'ready' || typeof message?.rev !== 'number') return;
    const idle = !this.inflight && this.queued.size === 0 && !this.openBatch;
    if (idle && message.parts && message.baseRev === this.rev) {
      // The other tab's save follows straight on what this tab holds: take it over as it is.
      this.rev = message.rev;
      if (message.updatedAt) this.updatedAt = message.updatedAt;
      const changed: string[] = [];
      for (const [key, value] of Object.entries(message.parts)) {
        if (!SHARED.has(key) || storedShapeProblem(key, value)) continue;
        const before = asJson(this.valueOf(key));
        this.record.set(key, value);
        if (before !== asJson(value)) changed.push(key);
      }
      this.recordStamp += 1;
      if (changed.length > 0) this.updatedCount += 1;
      // A change of this tab that waits for "Try again" and was made on the part the other tab changed is dropped, with a word.
      this.lostIsOld();
      for (const key of changed) this.notify(key);
      this.changed();
      return;
    }
    if (message.rev === this.rev && !message.parts) return;
    // Anything else (a reset, or a save this tab has not seen the step before): load the record again, quietly.
    this.otherRev = message.rev;
    this.quietReload = true;
    this.reloadWhenIdle();
  }

  private say(kind: SalonNotice['kind'], text: string, retry: boolean, parts?: Iterable<string>): void {
    // A message that a change was not saved stays until the owner closes it, tries again, or
    // another such message takes its place: an update or a warning never covers it.
    if (kind !== 'error' && this.notice?.kind === 'error') return;
    this.noticeCount += 1;
    this.notice = { id: this.noticeCount, kind, text, retry };
    this.noticeParts = parts ? new Set(parts) : null;
  }

  /** Forgets everything of the record and of the changes on their way. Promises of open saves end with "not saved". */
  private dropAll(): void {
    this.generation += 1;
    const open = [...this.sendingBatches, ...this.queuedBatches, ...(this.openBatch ? [this.openBatch] : [])];
    // Not saved: the browser's own parts of those actions go back, so none is left half done.
    for (const change of open.flatMap((batch) => batch.local).reverse()) swap(change, change.after, change.before);
    for (const batch of open) batch.settle(false);
    this.tickLocal = [];
    this.sendingBatches = [];
    this.queuedBatches = [];
    this.openBatch = null;
    this.record = new Map();
    this.shown = new Map();
    this.queued = new Map();
    this.inflight = null;
    this.lost = null;
    this.rev = 0;
    this.updatedAt = null;
    this.otherRev = null;
    this.reloading = false;
    this.notice = null; this.noticeParts = null;
    this.savedAt = null;
  }

  private notify(key: string): void {
    for (const listener of [...this.listeners.get(key) ?? []]) listener();
  }

  private notifyAll(): void {
    for (const key of SHARED_PARTS) this.notify(key);
    this.changed();
  }

  private makeStatus(): SalonStatus {
    return {
      phase: this.phase,
      loadError: this.loadError,
      saving: Boolean(this.inflight) || this.queued.size > 0 || this.flushPlanned,
      savedAt: this.savedAt,
      notice: this.notice,
      replaced: this.replacedCount,
      updated: this.updatedCount,
    };
  }

  /** Builds the status again and tells its watchers, if anything in it changed. */
  private changed(): void {
    const next = this.makeStatus();
    const before = this.status;
    if (before.phase === next.phase && before.loadError === next.loadError && before.saving === next.saving
      && before.savedAt === next.savedAt && before.notice === next.notice && before.replaced === next.replaced && before.updated === next.updated) return;
    this.status = next;
    for (const listener of [...this.statusListeners]) listener();
    // A reload that waited for this device's own changes can go now.
    if (!next.saving && this.otherRev !== null) this.reloadWhenIdle();
  }
}

/** How long a request may take. A form waits for its save: without an end it would say "Saving…" for ever on a connection that hangs. */
export const SALON_REQUEST_MS = 20_000;

/**
 * The requests to the four routes, with the owner's key in the header and never in the address.
 * A request that has no answer after `within` milliseconds is given up and counts as "no answer"
 * (the server may still have taken it: the device learns that when it next loads the record).
 */
export const salonRequestWith = (send: typeof fetch = (...args) => fetch(...args), within = SALON_REQUEST_MS): SalonRequest => async (key, method, body) => {
  const stop = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = stop ? setTimeout(() => stop.abort(), within) : null;
  try {
    const response = await send('/api/salon', {
      method,
      headers: { 'x-live-key': key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      ...(stop ? { signal: stop.signal } : {}),
    });
    let data: unknown = null;
    // Reading the answer counts too: a body that never ends is no answer either.
    try { data = await response.json(); } catch { if (stop?.signal.aborted) return null; /* else not the server's answer: the status says enough */ }
    return { status: response.status, data };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
};
export const fetchSalon: SalonRequest = salonRequestWith();

/** The tabs of this browser, through a BroadcastChannel: nothing goes through the browser's storage. */
export function browserTabs(): TabChannel | null {
  // Only in a browser page: in a test without one an open channel would keep the process running.
  if (typeof BroadcastChannel === 'undefined' || typeof document === 'undefined') return null;
  let channel: BroadcastChannel;
  try { channel = new BroadcastChannel('slotbee-salon'); } catch { return null; }
  return {
    post: (message) => { try { channel.postMessage(message); } catch { /* closed */ } },
    listen: (receive) => {
      const handler = (event: MessageEvent) => receive(event.data as TabMessage);
      channel.addEventListener('message', handler);
      return () => { channel.removeEventListener('message', handler); channel.close(); };
    },
  };
}
