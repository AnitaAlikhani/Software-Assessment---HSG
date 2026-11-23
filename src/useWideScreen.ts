import { useEffect, useState } from 'react';

/** From this width on the menu stands beside the page, and Home has room for columns of its own. */
export const WIDE_SCREEN = '(min-width: 1024px)';

/**
 * True on a screen wide enough for Home's columns. It follows the window when it is resized or a
 * tablet is turned. Where no browser can be asked (a page drawn by a test), the answer is the
 * narrow one: the single column a phone shows.
 */
export function useWideScreen(): boolean {
  const canAsk = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [wide, setWide] = useState(() => canAsk && window.matchMedia(WIDE_SCREEN).matches);
  useEffect(() => {
    if (!canAsk) return;
    const list = window.matchMedia(WIDE_SCREEN);
    const update = () => setWide(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [canAsk]);
  return wide;
}
