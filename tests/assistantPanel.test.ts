import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { nextTask } from '../src/assistant/conversation';
import { answer, assistantExamples, helpReply } from '../src/assistant/execute';
import { interpret } from '../src/assistant/interpret';
import { AssistantPanel } from '../src/components/AssistantPanel';
import { FIXED_NOW } from './fixedClock';
import { salon, TODAY, words } from './assistantFixture';

const panel = (partial: Partial<React.ComponentProps<typeof AssistantPanel>> = {}) => {
  const { customers, now: _now, ...data } = salon();
  return renderToStaticMarkup(React.createElement(AssistantPanel, {
    isOpen: true, onClose: () => {}, salon: data, customers,
    onAddEvent: () => null, onDeleteEvent: () => {}, onSaveClosedDates: () => {}, onOpenCalendar: () => {},
    clock: () => FIXED_NOW, ...partial,
  }));
};

test('the open panel has a title, one line about what it does, examples to tap, a thread and an input', () => {
  const html = panel();
  assert.match(html, /<h2 id="assistant-title"[^>]*>Assistant<\/h2>/);
  assert.match(html, /<p id="assistant-about"[^>]*>Free times, bookings and closed days\.<\/p>/);
  assert.match(html, /aria-labelledby="assistant-title"/);
  // Its own top bar with a Close that is named for screen readers and spelled out on small screens.
  assert.match(html, /<button type="button" aria-label="Close assistant"[^>]*>.*?Close<\/span><\/button>/);
  // The examples use the salon's own service, and nothing changes without Confirm.
  for (const example of ['Is Thursday at 15:00 free for a haircut?', 'Book Lea Brunner for a haircut on Tuesday at 10', 'Close Friday', 'What&#x27;s on today?']) {
    assert.ok(html.includes(`>${example}</button>`), example);
  }
  assert.match(html, /Nothing changes in the calendar until you press Confirm/);
  // Answers are added to a live region, so screen readers announce them.
  assert.match(html, /role="log" aria-live="polite" aria-label="Conversation with the assistant"/);
  // Text input: labelled, limited in length, 16 px text on every screen (no zoom on phones).
  const input = /<input[^>]*aria-label="Message to the assistant"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(input, /maxLength="300"|maxlength="300"/);
  assert.match(input, /class="[^"]*\btext-base\b/);
  assert.doesNotMatch(input, /text-(?:xs|sm)\b/);
  assert.match(html, /<button type="submit" disabled="" aria-label="Send"/);
});

test('with live access the panel says which messages go to the AI model, and without it nothing is said', () => {
  // Without live access no message leaves the app, so there is nothing to tell.
  assert.doesNotMatch(panel(), /Gemini/);
  const text = panel({ usesAiModel: true }).replace(/<[^>]+>/g, ' ');
  assert.match(text, /A message I cannot read myself is sent to Google&#x27;s AI service Gemini/);
  assert.match(text, /names of your services and staff/);
  assert.match(text, /calendar and your customer list are never sent/);
});

test('tap targets in the panel are at least 44 px high', () => {
  const html = panel();
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  assert.ok(buttons.length >= 6);
  for (const button of buttons) assert.match(button, /\b(?:min-h-11|h-11)\b/, button);
});

test('a closed panel renders nothing, and the panel text has no leftover build words', () => {
  assert.equal(panel({ isOpen: false }), '');
  const text = panel().replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /\b(?:demo|sample|simulat\w*|scripted|prototype|student|test)\b/i);
});

test('every example the panel offers is understood and answered from the data', () => {
  const data = salon();
  const menus = [data.services, [{ ...data.services[0], id: 'srv-women', name: "Women's cut & blow-dry" }, data.services[1]], []];
  for (const services of menus) {
    for (const language of ['en', 'de'] as const) {
      for (const example of assistantExamples(language, services)) {
        const heard = interpret(example, words({ services }));
        assert.equal(heard.language, language, example);
        const task = nextTask(heard, {});
        assert.ok(task, `not understood: ${example}`);
        const reply = answer(task, { ...data, services });
        assert.equal(reply.language, language, example);
        // A service named in the example is found, so the answer is not a question about the service.
        if (services.length > 0) assert.notEqual(reply.asked, 'service', example);
      }
    }
  }
  // The same examples are shown when a message was not understood.
  const help = helpReply('de', data, false);
  assert.match(help.text[0], /nicht verstanden/);
  assert.deepEqual(help.examples, assistantExamples('de', data.services));
  assert.equal(interpret(help.examples![3], words()).date, TODAY);
});
