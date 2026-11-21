import { resetDemoState } from './useDemoState';

/** Where the browser remembers that the pilot banner was closed with "Not now". */
export const PILOT_BANNER_DISMISSED_KEY = 'slotbee-interest-dismissed';

/** This tab's own storage; null where it is missing or blocked. */
function tabStorage(): Pick<Storage, 'removeItem'> | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/**
 * Behind "Reset demo data" (study tools only): the sample salon this browser keeps starts again
 * in every open tab, and each tab forgets what it kept for itself (a booking that was being
 * filled in, replies that were being typed). This tab also forgets "Not now" on the pilot banner.
 * The next participant starts from the same bookings and chats and sees the pilot banner again.
 * The research switch and the access key for live chats are kept.
 *
 * `resetSalon` and `ownStorage` are the browser's; tests hand in stand-ins.
 */
export function clearDemoWorkspace(
  resetSalon: () => void = resetDemoState,
  ownStorage: Pick<Storage, 'removeItem'> | null = tabStorage(),
): void {
  resetSalon();
  try { ownStorage?.removeItem(PILOT_BANNER_DISMISSED_KEY); } catch { /* Storage can be blocked in privacy modes: then nothing is kept there either. */ }
}
