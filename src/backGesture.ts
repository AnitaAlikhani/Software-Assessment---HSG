import { useEffect, useRef, type RefObject } from 'react';

/**
 * The Back gesture and what lies on top of a page.
 *
 * On a phone, Back should close what is open over the page (a dialog, the "More" sheet, the
 * assistant, the search bar) and leave the page where it is. The browser only knows history
 * entries, so an open overlay gets an entry of its own with the page's address: Back then
 * leaves that entry, the address stays, and this module closes the overlay.
 *
 * Overlays are found in the page itself, so every dialog takes part without code of its own:
 * a native <dialog> that is open and an element with role="dialog" and aria-modal="true" are
 * closed the way Escape closes them. Anything else that Back should close (the search bar, the
 * form of one person inside Team) says so with useCloseOnBack().
 *
 * The app's own changes of address go through changeAddress(), so that no entry is left
 * behind that Back would stop at without anything happening.
 */

/** An entry that only stands for an open overlay. */
const MARKER = 'slotbeeOverlay';
/** On an entry the app added: the address of the entry right below it. */
const BELOW = 'slotbeeBelow';

type EntryState = { [MARKER]?: boolean; [BELOW]?: string } | null | undefined;
const isMarker = (state: unknown): boolean => Boolean((state as EntryState)?.[MARKER]);

/** What the bookkeeping needs of the browser. Tests pass stand-ins. */
export interface OverlayHistoryHost<Overlay> {
  /** The state of the history entry on top. */
  state(): unknown;
  /** Adds an entry for the address that is open. */
  push(state: unknown): void;
  /** One step back. The browser carries it out later and then reports it like any other (popped). */
  back(): void;
  /** The overlay that lies on top right now, or null. */
  topOverlay(): Overlay | null;
  close(overlay: Overlay): void;
  /** True while the address itself stands for the open overlay (an appointment's details): it needs no entry of its own. */
  routeIsOverlay(): boolean;
}

export function createOverlayHistory<Overlay>(host: OverlayHistoryHost<Overlay>) {
  const onMarker = () => isMarker(host.state());
  let open = false;
  let wasOnMarker = onMarker();
  // Steps back taken by the app itself are reported like the user's. They are counted, so that
  // they are not mistaken for the gesture.
  let ownSteps = 0;
  // What has to wait until those steps have arrived (see whenSettled).
  let waiting: (() => void)[] = [];

  const stepBack = () => { ownSteps += 1; host.back(); };
  const settled = () => {
    const run = waiting;
    waiting = [];
    run.forEach((task) => task());
    sync();
  };
  /**
   * Runs `task` once no step back of the app's own is under way: at once, or when the last one
   * has arrived. A new address opened in between would otherwise be left again by that step.
   */
  const whenSettled = (task: () => void) => { if (ownSteps > 0) waiting.push(task); else task(); };
  /** The browser never reported a step (it is leaving the page, say): carry on as if it had arrived. */
  const giveUpWaiting = () => { if (ownSteps > 0) { ownSteps = 0; settled(); } };

  /** Brings the history in line with what is open. Called whenever the page has changed. */
  const sync = () => {
    // A step back is under way: the history is looked at again when it has arrived.
    if (ownSteps > 0) return;
    const nowOpen = host.topOverlay() !== null;
    if (nowOpen && !onMarker() && !host.routeIsOverlay()) host.push({ [MARKER]: true });
    // Closed with its own button: its entry goes too, or the next Back would do nothing.
    else if (!nowOpen && open && onMarker()) stepBack();
    open = nowOpen;
    wasOnMarker = onMarker();
  };

  /** The history moved: the Back gesture, the Forward button, or a step of the app's own. */
  const popped = () => {
    const leftMarker = wasOnMarker;
    wasOnMarker = onMarker();
    if (ownSteps > 0) {
      ownSteps -= 1;
      if (ownSteps === 0) settled();
      return;
    }
    const overlay = host.topOverlay();
    // Back from an overlay's entry: close the overlay. The address has not changed, so the page stays.
    if (overlay !== null && leftMarker && !wasOnMarker) host.close(overlay);
    // An overlay's entry without its overlay (reached with Forward, for example) is no place to stop.
    else if (overlay === null && wasOnMarker) stepBack();
  };

  /** The address changed in another way (a link, a typed address). */
  const moved = () => { wasOnMarker = onMarker(); };

  return { sync, popped, moved, stepBack, whenSettled, giveUpWaiting };
}

// ---------- the browser ----------

/** Set by useCloseOnBack on what Back should close, and the event that asks it to close. */
const CLOSES_ON_BACK = 'data-back-closes';
const BACK_EVENT = 'slotbee:back';
const OVERLAYS = `dialog[open], [role="dialog"][aria-modal="true"], [${CLOSES_ON_BACK}]`;

let routeOverlay = false;

const browserHost: OverlayHistoryHost<Element> = {
  state: () => window.history.state,
  push: (state) => window.history.pushState(state, ''),
  back: () => {
    window.history.back();
    // The step is reported within moments. Should it never be, nothing may wait for it for good.
    window.setTimeout(() => overlayHistory().giveUpWaiting(), 1000);
  },
  topOverlay: () => {
    const found = document.querySelectorAll(OVERLAYS);
    return found.length > 0 ? found[found.length - 1] : null;
  },
  close: (overlay) => {
    if (overlay.hasAttribute(CLOSES_ON_BACK)) {
      overlay.dispatchEvent(new Event(BACK_EVENT));
    } else if (overlay instanceof HTMLDialogElement) {
      // What the browser does on Escape: ask the dialog, and close it unless it has seen to that itself.
      if (overlay.dispatchEvent(new Event('cancel', { cancelable: true })) && overlay.open) overlay.close();
    } else {
      overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }
    // A form may ask before it closes and be kept open: then it gets its entry back, so that
    // the next Back asks again instead of leaving the page with the form still open.
    window.setTimeout(() => overlayHistory().sync(), 0);
  },
  routeIsOverlay: () => routeOverlay,
};

let browserHistory: ReturnType<typeof createOverlayHistory<Element>> | undefined;
const overlayHistory = () => (browserHistory ??= createOverlayHistory(browserHost));

/**
 * Makes the Back gesture close what is open over the page. Used once, by the app.
 * `routeIsOverlay`: the address that is open stands for an overlay by itself.
 */
export function useBackClosesOverlays(routeIsOverlay: boolean): void {
  routeOverlay = routeIsOverlay;
  useEffect(() => {
    const manager = overlayHistory();
    const observer = new MutationObserver(manager.sync);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'aria-modal', CLOSES_ON_BACK] });
    window.addEventListener('popstate', manager.popped);
    window.addEventListener('hashchange', manager.moved);
    // A page that was reloaded while something was open starts on that overlay's entry, with nothing open.
    if (isMarker(window.history.state) && browserHost.topOverlay() === null) manager.stepBack();
    else manager.sync();
    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', manager.popped);
      window.removeEventListener('hashchange', manager.moved);
    };
  }, []);
}

/**
 * For what is no dialog but should close on Back all the same: while `active`, the element
 * behind `ref` counts as open over the page, and Back calls `close` instead of leaving the page.
 * `close` may decide to keep it open (a form that asks before it discards changes).
 */
export function useCloseOnBack(ref: RefObject<HTMLElement | null>, active: boolean, close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const onBack = () => latest.current();
    element.setAttribute(CLOSES_ON_BACK, '');
    element.addEventListener(BACK_EVENT, onBack);
    return () => {
      element.removeAttribute(CLOSES_ON_BACK);
      element.removeEventListener(BACK_EVENT, onBack);
    };
  }, [ref, active]);
}

/**
 * Shows another address of the app: the page behind `hash`.
 *
 * Normally that adds a history entry. `replace` is for closing something the address stood for
 * (an appointment's details) and for moving between the tabs of one page: no entry is added, and
 * where the page it was opened from lies right below, the app steps back to it instead of leaving
 * the same page in the history twice.
 */
export function changeAddress(hash: string, replace = false): void {
  // An overlay was closed a moment ago and its entry is still being taken away (a tap beside
  // "More" or the search bar, then at once a tap on a screen): the new address waits for that.
  overlayHistory().whenSettled(() => showAddress(hash, replace));
}

function showAddress(hash: string, replace: boolean): void {
  const state = window.history.state as EntryState;
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (isMarker(state)) {
    // Another address is opened from inside an overlay (a screen from "More", a tab while one
    // person's week is open): it takes the overlay's entry, so that Back returns to the page the
    // overlay was opened on. Replacing an entry is silent, so the listeners for a change of page
    // are told here.
    const oldURL = window.location.href;
    window.history.replaceState({ [BELOW]: window.location.hash }, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }));
    return;
  }
  if (replace) {
    if (state?.[BELOW] === hash) { overlayHistory().stepBack(); return; }
    // The entry stays what it was, under its new address.
    window.history.replaceState(state ?? null, '', url);
    return;
  }
  const below = window.location.hash;
  window.location.hash = hash;
  // Remember what lies below, for a later `replace` back to it.
  window.history.replaceState({ [BELOW]: below }, '');
}
