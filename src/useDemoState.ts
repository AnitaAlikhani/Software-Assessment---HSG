import { useEffect, useState } from 'react';

// Bump the version when demo data changes, so tabs opened before a deploy don't keep
// stale chats (e.g. the old fixed 9/10 Oct dates that were rejected as past).
export const DEMO_STORAGE_VERSION = 'booking-demo-v2';

/** The sessionStorage key of one piece of demo state. Tests use it instead of repeating the version. */
export const demoStorageKey = (
  key: string,
  pathname = typeof window === 'undefined' ? '/' : window.location.pathname,
): string => `${DEMO_STORAGE_VERSION}:${pathname}:${key}`;

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
