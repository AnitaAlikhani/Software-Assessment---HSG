import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setResearchModeForTests } from '../src/flags';

/** Renders as a normal visitor sees it (study tools off) or as on a study link (research on). */
export function render(element: ReactElement, { research = false }: { research?: boolean } = {}): string {
  setResearchModeForTests(research);
  try {
    return renderToStaticMarkup(element);
  } finally {
    setResearchModeForTests(undefined);
  }
}

/**
 * The header asks the browser for the screen width. Tests have no browser, so they get a wide
 * screen for the length of one call; the global is removed again afterwards.
 */
export function withScreen<T>(run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
      location: { pathname: '/', search: '' },
    },
  });
  try {
    return run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

/** What a person can read or hear on a page: the text between the tags plus labels, tooltips and placeholders. */
export const readableText = (html: string): string => [
  html.replace(/<[^>]+>/g, ' '),
  ...Array.from(html.matchAll(/\s(?:aria-label|title|placeholder|alt)="([^"]*)"/g), match => match[1]),
].join(' ');

/** Words that give a product away as a class exercise. No page for a normal visitor may show one. */
export const TELL_WORDS = /\b(demo|sample|simulat\w*|scripted|prototype|student|tester\w*|test)\b/i;
