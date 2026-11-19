import { useEffect, useState } from 'react';

// Bump the version whenever the starting data or their shape change, so tabs opened before a
// deploy don't keep stale records (v3: new salon data, customers without stored visit counts,
// chats and bookings linked by id).
export const DEMO_STORAGE_VERSION = 'booking-demo-v3';

/** The sessionStorage key of one piece of demo state. Tests use it instead of repeating the version. */
export const demoStorageKey = (
  key: string,
  pathname = typeof window === 'undefined' ? '/' : window.location.pathname,
): string => `${DEMO_STORAGE_VERSION}:${pathname}:${key}`;

/**
 * State of screens that no longer exist ("Rooms & equipment" kept its list under `resources`).
 * A tab that was open before the screen went still holds the value; nothing reads it any more.
 */
export const RETIRED_DEMO_KEYS = ['resources'];

/** Takes what a removed screen left behind out of a tab's storage. Everything else stays as it is. */
export function forgetRetiredDemoState(
  storage: Pick<Storage, 'removeItem'> | null | undefined = typeof sessionStorage === 'undefined' ? null : sessionStorage,
  pathname?: string,
): void {
  try { for (const key of RETIRED_DEMO_KEYS) storage?.removeItem(demoStorageKey(key, pathname)); }
  catch { /* Storage can be blocked in privacy modes: then nothing was kept there either. */ }
}

/** A demo stays in this tab's session; another device never receives a booking. */
export function useDemoState<T>(key: string, initial: T | (() => T)) {
  const storageKey = demoStorageKey(key);
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(storageKey);
      if (saved !== null) return JSON.parse(saved) as T;
    } catch { /* Storage can be unavailable in privacy modes. Keep the demo usable. */ }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); }
    catch { /* The in-memory demo still works when storage is unavailable. */ }
  }, [storageKey, value]);
  return [value, setValue] as const;
}
