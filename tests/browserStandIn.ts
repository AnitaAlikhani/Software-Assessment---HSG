import { DemoStore } from '../src/demoStore';
import { DEMO_STORAGE_VERSION, PER_TAB_KEYS, setDemoClockForTests } from '../src/useDemoState';
import { FIXED_NOW } from './fixedClock';

/**
 * Stand-ins for the tests of the stored salon: a browser with its lasting storage, "tabs" that
 * share it, and the `storage` event that tells the other tabs about a write. Nothing here is a
 * real browser, and the clock is the test's own.
 */

type StorageListener = (event: Event) => void;

/** One storage area as a tab sees it. `writes` counts what this tab wrote, to check that a tab stays quiet. */
export class StorageStandIn {
  writes = 0;
  constructor(private readonly values: Map<string, string>, private readonly changed: (key: string | null) => void = () => {}) {}
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    // As in a browser: writing the value that is already there is no change and tells nobody.
    if (this.values.get(key) === value) return;
    this.values.set(key, value);
    this.writes++;
    this.changed(key);
  }
  removeItem(key: string): void {
    if (!this.values.delete(key)) return;
    this.writes++;
    this.changed(key);
  }
  clear(): void {
    if (this.values.size === 0) return;
    this.values.clear();
    this.writes++;
    this.changed(null);
  }
}

/** A storage the browser blocks (privacy modes): every call throws. */
export const blockedStorage = {
  get length(): number { throw new Error('blocked'); },
  key(): string | null { throw new Error('blocked'); },
  getItem(): string | null { throw new Error('blocked'); },
  setItem(): void { throw new Error('blocked'); },
  removeItem(): void { throw new Error('blocked'); },
};

/** The window of one tab: it only has to pass events on. */
export class WindowStandIn {
  readonly location = { pathname: '/', search: '', origin: 'http://localhost' };
  private readonly listeners = new Map<string, Set<StorageListener>>();
  addEventListener(type: string, listener: StorageListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: StorageListener): void { this.listeners.get(type)?.delete(listener); }
  /** Fires an event of the page, for example 'focus' when the tab comes back to the front. */
  fire(type: string, detail: Record<string, unknown> = {}): void {
    const event = Object.assign(new Event(type), detail);
    for (const listener of [...this.listeners.get(type) ?? []]) listener(event);
  }
  listening(type: string): number { return this.listeners.get(type)?.size ?? 0; }
}

export interface TabStandIn {
  /** The browser's lasting storage, as this tab reaches it. */
  local: StorageStandIn;
  /** The tab's own storage. */
  session: StorageStandIn;
  window: WindowStandIn;
  /** While true the tab hears nothing, like a tab the browser has put to sleep. */
  asleep: boolean;
}

/** One browser: a lasting storage, and the tabs that share it. */
export class BrowserStandIn {
  /** What the lasting storage holds. */
  readonly stored = new Map<string, string>();
  private readonly tabs: TabStandIn[] = [];
  private readonly waiting: Array<() => void> = [];
  /**
   * A real browser tells the other tabs a moment after a write. With this on, the events wait
   * until `deliver()` is called, so a test can let two tabs act before either hears of the other.
   */
  holdEvents = false;

  openTab(): TabStandIn {
    const tab: TabStandIn = {
      local: new StorageStandIn(this.stored, (key) => this.tell(tab, key)),
      session: new StorageStandIn(new Map()),
      window: new WindowStandIn(),
      asleep: false,
    };
    this.tabs.push(tab);
    return tab;
  }

  /** A `storage` event reaches every tab except the one that wrote. */
  private tell(writer: TabStandIn, key: string | null): void {
    const newValue = key === null ? null : this.stored.get(key) ?? null;
    for (const tab of this.tabs) {
      if (tab === writer) continue;
      const send = () => { if (!tab.asleep) tab.window.fire('storage', { key, newValue }); };
      if (this.holdEvents) this.waiting.push(send);
      else send();
    }
  }

  /** Lets the events that were held reach their tabs, in the order of the writes. */
  deliver(): void {
    for (const send of this.waiting.splice(0)) send();
  }
}

/** A clock a test can set. It starts at FIXED_NOW (Monday 5 October 2026, 12:00 in Zurich). */
export class ClockStandIn {
  moment = FIXED_NOW;
  readonly now = (): Date => this.moment;
  /** Moves the clock to a moment, given as an ISO time. */
  set(moment: string): void { this.moment = new Date(moment); }
}

/** The first part of every key for an app served from "/". */
export const PREFIX = `${DEMO_STORAGE_VERSION}:/`;

/** The store of one tab, set up as the app sets it up. `reports` collects what the store says about data it did not use. */
export function storeFor(tab: TabStandIn, clock: ClockStandIn, reports: string[] = []): DemoStore {
  return new DemoStore({
    prefix: PREFIX, lasting: tab.local, tab: tab.session, page: tab.window, perTabKeys: PER_TAB_KEYS,
    now: clock.now, report: (message) => reports.push(message),
  });
}

/**
 * Runs with a browser's globals standing in for one tab: its window and its two storages. What
 * the app's own hook does in there goes by the test's clock (FIXED_NOW unless one is given).
 */
export function inTab<T>(tab: Pick<TabStandIn, 'local' | 'session' | 'window'>, run: () => T, clock?: ClockStandIn): T {
  const globals: Record<string, unknown> = { window: tab.window, localStorage: tab.local, sessionStorage: tab.session };
  const previous = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value });
  setDemoClockForTests(clock ? clock.now : () => FIXED_NOW);
  try {
    return run();
  } finally {
    setDemoClockForTests();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}
