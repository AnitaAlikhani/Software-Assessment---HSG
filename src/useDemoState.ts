import { useEffect, useState } from 'react';

/** A demo stays in this tab's session; another device never receives a booking. */
export function useDemoState<T>(key: string, initial: T | (() => T)) {
  const storageKey = `booking-demo-v1:${window.location.pathname}:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
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
