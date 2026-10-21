import { useEffect, useState, type RefObject } from 'react';

/** True while the element's content is wider than its box, so a "swipe sideways" hint is warranted.
 *  Pass the values that cause the element to mount or unmount in `deps` so a remounted element is observed again. */
export function useHorizontalOverflow(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) { setOverflows(false); return; }
    const update = () => setOverflows(element.isConnected && element.scrollWidth > element.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);
  return overflows;
}
