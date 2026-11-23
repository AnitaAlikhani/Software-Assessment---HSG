import { useEffect, useState } from 'react';

/** From this width on the menu stands beside the page, and Home has room for columns of its own. */
export const WIDE_SCREEN = '(min-width: 1024px)';

/**
 * From this width on the month's figures and its line stand side by side: one short band, with
 * which Home can open. Between the two widths (a tablet on its side, a narrow window) the line
 * stands under the figures and the card is as tall as the screen. There it follows the day and
 * the inbox, as on a phone.
 */
export const LAPTOP_SCREEN = '(min-width: 1280px)';

/**
 * Whether the screen answers yes to a question about its width. The answer follows the window
 * when it is resized or a tablet is turned. Where no browser can be asked (a page drawn by a
 * test), the answer is no: the narrow page, the single column a phone shows.
 */
function useScreen(question: string): boolean {
  const canAsk = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [yes, setYes] = useState(() => canAsk && window.matchMedia(question).matches);
  useEffect(() => {
    if (!canAsk) return;
    const list = window.matchMedia(question);
    const update = () => setYes(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [canAsk, question]);
  return yes;
}

/** True on a screen wide enough for Home's columns. */
export const useWideScreen = (): boolean => useScreen(WIDE_SCREEN);

/** True on a screen wide enough for the month's figures and its line to share one band. */
export const useLaptopScreen = (): boolean => useScreen(LAPTOP_SCREEN);
