import { DEMO_STORAGE_VERSION } from './useDemoState';

/** Where the browser remembers that the pilot banner was closed with "Not now". */
export const PILOT_BANNER_DISMISSED_KEY = 'slotbee-interest-dismissed';

type KeyedStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

/**
 * Behind "Reset demo data" (study tools only): forgets the sample workspace this browser keeps,
 * so the next participant starts from the same bookings and chats and sees the pilot banner again.
 * The research switch and the access key for live chats are kept. Returns how many entries went.
 */
export function clearDemoWorkspace(storages: Array<KeyedStorage | null | undefined>): number {
  let removed = 0;
  for (const storage of storages) {
    if (!storage) continue;
    try {
      // Collect first: removing while walking the index would skip entries.
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key && (key.startsWith(`${DEMO_STORAGE_VERSION}:`) || key === PILOT_BANNER_DISMISSED_KEY)) keys.push(key);
      }
      keys.forEach(key => storage.removeItem(key));
      removed += keys.length;
    } catch { /* Storage can be blocked in privacy modes: then nothing is kept there either. */ }
  }
  return removed;
}

/** The browser's two storages; null where one is missing or blocked. */
export function browserStorages(): Array<Storage | null> {
  const safely = (pick: () => Storage | undefined) => { try { return pick() ?? null; } catch { return null; } };
  return [
    safely(() => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)),
    safely(() => (typeof localStorage === 'undefined' ? undefined : localStorage)),
  ];
}
