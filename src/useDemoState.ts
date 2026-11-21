import { useCallback, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { DemoStore, SALON_KEY, type PageEvents } from './demoStore';

// Bump the version whenever the starting data or their shape change, so that what an earlier
// build stored is not read by the new one (v4: the salon moved from each tab's own storage to
// the browser's lasting storage, as one entry; employees and customers got new fields).
export const DEMO_STORAGE_VERSION = 'booking-demo-v4';

/**
 * The values that stay with one tab: what a customer has filled in on the booking page, which
 * request is that customer's own, and the replies the owner has begun to type. Everything else
 * useDemoState keeps is a part of the salon, stored once for all tabs of the browser.
 */
export const PER_TAB_KEYS: readonly string[] = ['draft', 'submittedRequest', 'conversationDrafts'];

/** The path the app is served from. "/shop/index.html" and "/shop/" are the same place. */
const servedFrom = (pathname: string): string => pathname.replace(/index\.html$/, '');
const pagePath = (): string => (typeof window === 'undefined' ? undefined : window.location?.pathname) ?? '/';

/**
 * The key of one stored value. It starts with the version and the path the app is served from:
 * github.io serves several builds under one address, and each keeps its own salon.
 * A value that stays with one tab is stored under this key in the tab's own storage.
 */
export const demoStorageKey = (key: string, pathname = pagePath()): string => `${DEMO_STORAGE_VERSION}:${servedFrom(pathname)}:${key}`;

/** The key of the salon in the browser's lasting storage: one entry that holds all its parts (src/demoStore.ts). */
export const salonStorageKey = (pathname?: string): string => demoStorageKey(SALON_KEY, pathname);

/** One of the browser's storages; null where it is missing or blocked (asking for it can throw in privacy modes). */
const browserStorage = (name: 'localStorage' | 'sessionStorage'): Storage | null => {
  try { return (globalThis as { localStorage?: Storage; sessionStorage?: Storage })[name] ?? null; } catch { return null; }
};

type ListedStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

/**
 * Takes out of the browser's storage what earlier versions of the app kept there for this place:
 * their copy of the salon, and with it the list of the "Rooms & equipment" screen that is gone.
 * What the current version stores, what belongs to another place under the same address and
 * everything that is not the app's stay as they are.
 */
export function forgetRetiredDemoState(
  storages: Array<ListedStorage | null | undefined> = [browserStorage('sessionStorage'), browserStorage('localStorage')],
  pathname = pagePath(),
): void {
  const current = Number(/\d+$/.exec(DEMO_STORAGE_VERSION)?.[0]);
  // Earlier versions wrote the path as the browser gave it.
  const places = [pathname, servedFrom(pathname)];
  for (const storage of storages) {
    try {
      if (!storage) continue;
      // Collect first: removing while walking the index would skip entries.
      const retired: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        const version = key ? /^booking-demo-v(\d+):/.exec(key) : null;
        // Only older versions: a tab that still runs an older build must not delete what a newer one stores.
        if (!key || !version || Number(version[1]) >= current) continue;
        if (places.some((place) => key.startsWith(`${version[0]}${place}:`))) retired.push(key);
      }
      retired.forEach((key) => storage.removeItem(key));
    } catch { /* Storage can be blocked in privacy modes: then nothing was kept there either. */ }
  }
}

let clock = (): Date => new Date();

/** Tests only: the clock the stored salon goes by, or nothing to go by the real one again. */
export function setDemoClockForTests(now?: () => Date): void {
  clock = now ?? (() => new Date());
}

/**
 * The store of the page that is open: one for the whole page load, so that every screen, every
 * watcher and every event from another tab meets the same values.
 */
let pageStore: { store: DemoStore; page: PageEvents; prefix: string } | null = null;

function demoStore(): DemoStore {
  const page: PageEvents | null = typeof window === 'undefined' ? null : window;
  const prefix = `${DEMO_STORAGE_VERSION}:${servedFrom(pagePath())}`;
  if (pageStore && pageStore.page === page && pageStore.prefix === prefix) return pageStore.store;
  const store = new DemoStore({
    prefix, page, perTabKeys: PER_TAB_KEYS, now: () => clock(),
    lasting: browserStorage('localStorage'),
    tab: browserStorage('sessionStorage'),
    report: page ? (message) => console.warn(`[booking data] ${message}`) : undefined,
  });
  // Outside a browser (a test that draws one screen) there is no page to share values on and
  // nothing to hear from: each caller gets a store of its own.
  if (!page) return store;
  // A browser keeps its window for the life of the page. Tests swap it, and each such "page" gets a new store.
  pageStore?.store.close();
  pageStore = { store, page, prefix };
  return store;
}

/**
 * State that outlives the page. It reads and sets like useState.
 *
 * The salon's data are kept in the browser's lasting storage: they survive a closed tab, and a
 * change made in one tab shows in the others without a reload. A few keys stay with one tab
 * (PER_TAB_KEYS). Another device or browser is never reached. Where storage is blocked, the
 * values live in memory for this page load.
 *
 * `initial` is the value while nothing is stored: the value itself, or a function that builds
 * it. The function is given the moment the stored salon was started, the same in every tab, so
 * starting data that depend on the date come out the same everywhere.
 */
export function useDemoState<T>(key: string, initial: T | ((builtAt: Date) => T)) {
  const [store] = useState(demoStore);
  const read = () => store.read<T>(key, initial);
  const subscribe = useCallback((listener: () => void) => store.listen(key, listener), [store, key]);
  const value = useSyncExternalStore(subscribe, read, read);
  const setValue: Dispatch<SetStateAction<T>> = useCallback((next) => store.write<T>(key, next), [store, key]);
  return [value, setValue] as const;
}

/**
 * Calls `watcher` with the value before and after when ANOTHER tab of this browser has changed
 * one part of the salon. This tab's own changes do not call it, nor does what was already stored
 * when the tab opened, nor a salon that was started again. Returns the way to stop watching.
 */
export function watchDemoState<T>(key: string, watcher: (before: T, after: T) => void): () => void {
  return demoStore().watch<T>(key, watcher);
}

/**
 * Clears the salon this browser has stored and what this tab keeps for itself, and starts the
 * salon again from its starting data. Other open tabs follow at once, and clear what they kept
 * for themselves as well. The caller loads the page again, so that its screens start fresh too.
 */
export function resetDemoState(): void {
  try {
    demoStore().reset();
  } catch {
    // The store itself failed, which it should never do. The reset is the last way out of a page
    // that cannot be drawn, so the entries are taken out by hand and the next load starts fresh.
    for (const key of PER_TAB_KEYS) {
      try { browserStorage('sessionStorage')?.removeItem(demoStorageKey(key)); } catch { /* blocked */ }
    }
    try { browserStorage('localStorage')?.removeItem(salonStorageKey()); } catch { /* blocked */ }
  }
}
