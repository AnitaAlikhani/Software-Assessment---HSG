import { useCallback, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { DemoStore, SALON_KEY, type PageEvents } from './demoStore';
import { currentLiveKey } from './liveWhatsApp';
import { browserTabs, fetchSalon, SharedSalon, type SalonStatus } from './sharedSalon';

// Bump the version whenever the starting data or their shape change, so that what an earlier
// build stored is not read by the new one (v4: the salon moved from each tab's own storage to
// the browser's lasting storage, as one entry; employees and customers got new fields).
export const DEMO_STORAGE_VERSION = 'booking-demo-v5';

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
 * The salon on the server, for the page that is open (src/sharedSalon.ts): one per page load, as
 * the store above. It starts loading at once when this browser holds the owner's key, so that the
 * first screen is "Loading your salon…" and never the browser's own salon for a moment. The
 * customers' booking page ("?booking=1") of such a browser reads it too and never writes to it; the
 * customer's chat ("?chat=") never uses it.
 */
let pageSalon: { salon: SharedSalon; page: PageEvents } | null = null;

export function salonOnServer(): SharedSalon | null {
  if (typeof window === 'undefined') return null;
  const page: PageEvents = window;
  if (pageSalon && pageSalon.page === page) return pageSalon.salon;
  const salon = new SharedSalon({
    request: fetchSalon,
    builtAt: () => demoStore().builtAt,
    tabs: browserTabs(),
    report: (message) => console.warn(`[booking data] ${message}`),
  });
  pageSalon?.salon.close();
  pageSalon = { salon, page };
  const search = new URLSearchParams(window.location?.search ?? '');
  // The customer's chat never uses the owner's key. The customers' booking page in a browser that
  // holds it shows the same salon as the owner's app there, read-only (src/App.tsx).
  const key = search.has('chat') ? null : currentLiveKey();
  if (key) void salon.begin(key, { readOnly: search.get('booking') === '1' });
  return salon;
}

/** Tests only: forget the salon of the page, so the next call builds it again (with the stand-ins of the test). */
export function forgetSalonOnServerForTests(salon?: SharedSalon): void {
  pageSalon?.salon.close();
  pageSalon = salon && typeof window !== 'undefined' ? { salon, page: window } : null;
}

const noSalon: SalonStatus = { phase: 'local', loadError: null, saving: false, savedAt: null, notice: null, replaced: 0, updated: 0 };
const noWatch = () => () => {};

/** Where the salon on the server stands: loading, ready, saving, a message for the owner. */
export function useSalonStatus(): SalonStatus {
  const [salon] = useState(salonOnServer);
  const subscribe = useCallback((listener: () => void) => salon?.watchStatus(listener) ?? noWatch(), [salon]);
  const read = () => salon?.current ?? noSalon;
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * What the server has of a shared part on a signed-in device (src/sharedSalon.ts serverValue),
 * or `shown` everywhere else (a browser that is not signed in saves at once; a test without a
 * page). An open form compares with it (src/formFollow.ts): its own save counts only once taken.
 */
export function useServerValue<T>(key: string, shown: T): T {
  const [salon] = useState(salonOnServer);
  const subscribe = useCallback((listener: () => void) => salon?.listen(key, listener) ?? noWatch(), [salon, key]);
  const read = () => salon && salon.serves(key) && salon.current.phase === 'ready' ? salon.serverValue<T>(key, shown) : shown;
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * For a message that says a change is done: while the action that is running has changed a part
 * the server keeps, whether the server took it. Null when nothing waits for the server.
 */
export const pendingSalonSave = (): Promise<boolean> | null => pageSalon?.salon.pendingSave() ?? null;

/**
 * For a form that sends what it holds (a service, a person, a day's hours, a closure, an
 * absence): call it right after the form's save. Null when nothing waits for the server (a
 * browser that is not signed in): the form closes at once. Otherwise the form stays as typed until
 * the promise says the server took it; not taken, it stays open and its own Save is the way to try
 * again (the message offers no "Try again", src/sharedSalon.ts).
 */
export const pendingFormSave = (): Promise<boolean> | null => pageSalon?.salon.pendingFormSave() ?? null;

/**
 * Why the form's save was not taken, for the form itself to say: an open form or sheet covers the
 * message at the foot of the screen, so the form shows the same sentence where the owner looks.
 */
export const notSavedText = (): string => pageSalon?.salon.current.notice?.text ?? 'Your change was not saved.';

/**
 * A form that holds a copy of the salon opens: the record is asked for again, quietly, so the form
 * starts from the latest save of another device and its own save does not meet a 409 it could
 * have avoided. Nothing on a device that is not signed in.
 */
export const refreshSharedSalon = (): void => { if (pageSalon && !pageSalon.salon.readOnly) pageSalon.salon.reload(); };

/**
 * Shows `message` once the change it speaks of is saved: at once in this browser, after the
 * server's answer on a signed-in device. A change the server did not take shows its own message
 * instead (src/sharedSalon.ts), so `message` is then not shown at all.
 */
export function whenSaved(message: () => void): void {
  const pending = pendingSalonSave();
  if (!pending) { message(); return; }
  void pending.then((saved) => { if (saved) message(); });
}

/**
 * As whenSaved, for a page form that keeps what it holds on screen whatever happens (Settings ›
 * Salon and Opening hours, the AI receptionist): a save that is not taken stays in the form,
 * shown as unsaved, and the form's own Save is the way to try again. So the message offers no
 * "Try again", and no copy of the change is kept that a later "Try again" could send over a newer save.
 */
export function whenFormSaved(message: () => void): void {
  const pending = pendingFormSave();
  if (!pending) { message(); return; }
  void pending.then((saved) => { if (saved) message(); });
}

/**
 * State that outlives the page. It reads and sets like useState.
 *
 * The salon's data are kept in the browser's lasting storage: they survive a closed tab, and a
 * change made in one tab shows in the others without a reload. A few keys stay with one tab
 * (PER_TAB_KEYS). Where storage is blocked, the values live in memory for this page load.
 *
 * On a device signed in with the owner's key, the parts of the salon the server keeps (services,
 * team, hours, closed dates, absences, single days, the salon's details and the AI's settings)
 * are read from and written to the server instead (src/sharedSalon.ts). The calendar, requests,
 * customers and the built-in chats stay in this browser either way.
 *
 * `initial` is the value while nothing is stored: the value itself, or a function that builds
 * it. The function is given the moment the stored salon was started, the same in every tab, so
 * starting data that depend on the date come out the same everywhere.
 */
export function useDemoState<T>(key: string, initial: T | ((builtAt: Date) => T)) {
  const [store] = useState(demoStore);
  const [salon] = useState(salonOnServer);
  const read = () => salon?.serves(key) ? salon.read<T>(key, initial) : store.read<T>(key, initial);
  const subscribe = useCallback((listener: () => void) => {
    const stopLocal = store.listen(key, listener);
    const stopServer = salon?.listen(key, listener);
    return () => { stopLocal(); stopServer?.(); };
  }, [store, salon, key]);
  const value = useSyncExternalStore(subscribe, read, read);
  const setValue: Dispatch<SetStateAction<T>> = useCallback((next) => {
    if (salon?.serves(key)) { salon.write<T>(key, next); return; }
    const before = store.read<T>(key, initial);
    store.write<T>(key, next);
    const after = store.read<T>(key, initial);
    // On a signed-in device an action may change a shared part and this browser's own parts
    // together: the browser's part goes back with the shared one when the server does not take it.
    if (salon && !Object.is(before, after)) {
      salon.noteLocalChange({ before, after, read: () => store.read<T>(key, initial), write: (value) => store.write<T>(key, value as T) });
    }
  // `initial` is read again where needed; a new function of it each render is no new setter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, salon, key]);
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
