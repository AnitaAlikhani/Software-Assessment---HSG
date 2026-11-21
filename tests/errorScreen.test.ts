import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { PRODUCT_NAME } from '../src/brand';
import { ErrorBoundary, ErrorScreen } from '../src/components/ErrorScreen';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// One bad value must not leave a blank page. Whatever fails while a page is drawn ends on a
// screen that says so and offers the two ways on: load the page again, or clear what this
// browser has stored for the salon.

const nothing = () => {};
const buttons = (html: string) => Array.from(html.matchAll(/<button[^>]*>(.*?)<\/button>/g), (match) => match[1].replace(/<[^>]+>/g, ''));

test('the error screen says what happened and offers "Reload" and "Reset data"', () => {
  const html = render(React.createElement(ErrorScreen, { onReload: nothing, onResetData: nothing }));
  const text = readableText(html).replace(/\s+/g, ' ');
  assert.match(html, /<h1[^>]*>This page could not be shown<\/h1>/);
  assert.match(text, new RegExp(`Something went wrong in ${PRODUCT_NAME}\\. Reload the page to try again\\.`));
  assert.deepEqual(buttons(html), ['Reload', 'Reset data']);
  // What the reset does is said before anybody chooses it.
  assert.match(text, /Reset data clears them: appointments, customers, chats and settings go back to their starting state\./);
  // It reads like a product: no word that gives the class exercise away, on this screen either.
  assert.doesNotMatch(text, TELL_WORDS);
  // It is announced, its heading can take focus, and every control is large enough for a thumb.
  assert.match(html, /role="alert"/);
  assert.match(html, /<h1 tabindex="-1"/);
  for (const control of html.match(/<button\b[^>]*>/g) ?? []) assert.match(control, /\bmin-h-11\b/, control);
  for (const control of html.match(/<button\b[^>]*>/g) ?? []) assert.match(control, /type="button"/, control);
});

test('a page that keeps nothing of the salon in the browser offers Reload only', () => {
  // The customer chat: there is nothing to reset, so the screen does not offer it.
  const html = render(React.createElement(ErrorScreen, { onReload: nothing }));
  assert.deepEqual(buttons(html), ['Reload']);
  assert.doesNotMatch(readableText(html), /Reset|starting state/);
  assert.doesNotMatch(readableText(html), TELL_WORDS);
});

test('the boundary shows the page while it works, and the error screen once something in it has failed', () => {
  const page = React.createElement('p', null, 'The page');
  assert.equal(render(React.createElement(ErrorBoundary, { resetData: nothing, children: page })), '<p>The page</p>');
  // React asks the boundary what to remember when a screen below it throws.
  assert.deepEqual(ErrorBoundary.getDerivedStateFromError(), { failed: true });

  const calls: string[] = [];
  const globals = globalThis as { window?: unknown };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  globals.window = { location: { reload: () => calls.push('reload') } };
  try {
    const failed = (resetData?: () => void) => {
      const boundary = new ErrorBoundary({ resetData, children: page });
      boundary.state = { failed: true };
      return boundary.render() as React.ReactElement<React.ComponentProps<typeof ErrorScreen>>;
    };
    const screen = failed(() => calls.push('reset data'));
    assert.equal(screen.type, ErrorScreen);
    assert.deepEqual(buttons(render(screen)), ['Reload', 'Reset data']);
    screen.props.onReload();
    assert.deepEqual(calls, ['reload']);
    // "Reset data" clears first and then loads the page again.
    screen.props.onResetData!();
    assert.deepEqual(calls, ['reload', 'reset data', 'reload']);
    // Should clearing fail, the page is loaded again all the same.
    failed(() => { throw new Error('blocked'); }).props.onResetData!();
    assert.deepEqual(calls, ['reload', 'reset data', 'reload', 'reload']);
    // Without anything to reset the screen is given no reset.
    assert.equal(failed().props.onResetData, undefined);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
