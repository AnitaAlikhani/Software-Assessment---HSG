import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { deletionDependency } from '../src/managementDependencies';
import { initialEmployees, initialServices } from '../src/mockData';
import { DeleteQuestion } from '../src/views/DeleteQuestion';
import { ServicesView } from '../src/views/ServicesView';
import { demoCustomers, demoEvents, demoRequests } from './fixedClock';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// Deleting a customer or a service happens in its edit form and asks first; the lists themselves
// hold no bin. Opening a form and pressing its buttons needs a browser. These tests read what a
// page holds before the first press on "Delete" and after it.

const nothing = () => {};
const count = (html: string, part: string) => html.split(part).length - 1;
const question = (partial: Partial<React.ComponentProps<typeof DeleteQuestion>> = {}) => render(React.createElement(DeleteQuestion, {
  kind: 'customer', name: 'Camille Bernard', consequence: 'Their contact details are removed from your customer list.', onDelete: nothing, ...partial,
}));

test('"Delete" in an edit form is one quiet button until it is pressed', () => {
  const html = question();
  assert.equal(count(html, '<button'), 1);
  assert.match(html, /<button type="button"[^>]*>.*Delete customer<\/button>/);
  // Nothing is asked and nothing is refused before the press.
  assert.doesNotMatch(html, /\?|Keep|role="alert"|role="group"/);
  // A tap target of 44 px, and a button that cannot send the form it stands in.
  assert.match(/<button type="button"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '', /\bmin-h-11\b/);
});

test('the first press asks, names the record and what goes, and offers the way back', () => {
  const html = question({ initiallyAsked: true });
  // The question is a labelled group, so a screen reader hears it when focus moves to "Keep".
  const [, title, text] = /<div role="group" aria-labelledby="([^"]+)" aria-describedby="([^"]+)"/.exec(html) ?? [];
  assert.ok(title && text && title !== text);
  assert.ok(html.includes(`<p id="${title}"`) && html.includes(`<p id="${text}"`));
  assert.match(html, />Delete Camille Bernard\?<\/p>/);
  assert.match(html, />Their contact details are removed from your customer list\.<\/p>/);
  const buttons = Array.from(html.matchAll(/<button type="button"[^>]*>([^<]*)<\/button>/g), (match) => match[1].trim());
  assert.deepEqual(buttons, ['Delete customer', 'Keep customer']);
  for (const classes of html.matchAll(/<button type="button" class="([^"]*)"/g)) assert.match(classes[1], /\bmin-h-11\b/);
  assert.doesNotMatch(readableText(html), TELL_WORDS);
  // The same question for a service, in its own words.
  const service = question({ kind: 'service', name: 'Updo', consequence: 'It is removed from your list of services.', initiallyAsked: true });
  assert.match(service, />Delete Updo\?<\/p>/);
  assert.match(service, />Keep service<\/button>/);
});

test('a record that appointments or requests still use is not asked about: the press says why', () => {
  // The rule the app applies when it deletes, with its own sentence.
  const haircut = initialServices.find((service) => service.name === 'Haircut')!;
  const reason = deletionDependency('service', haircut.id, haircut.name, demoEvents, demoRequests);
  assert.match(reason ?? '', /^Cannot delete Haircut: \d+ appointments? and \d+ pending requests? still use this service\. Cancel or reassign them first\.$/);
  // Before the press the form is as quiet as for any other service ...
  assert.equal(question({ kind: 'service', name: haircut.name, blocked: reason }), question({ kind: 'service', name: haircut.name }));
  // ... and after it the reason stands under the button, announced, with no question to answer.
  const html = question({ kind: 'service', name: haircut.name, blocked: reason, initiallyAsked: true });
  const said = /<p id="([^"]+)" role="alert"[^>]*>([^<]*)<\/p>/.exec(html);
  assert.equal(said?.[2], reason);
  // The button names the reason as its description, so it is heard again when focus returns to it.
  assert.ok(html.includes(`aria-describedby="${said?.[1]}"`));
  assert.equal(count(html, '<button'), 1);
  assert.doesNotMatch(html, /Delete Haircut\?|Keep service|role="group"/);

  // A customer with a visit in the calendar is held back in the same way, one without is not.
  const regular = demoCustomers.find((customer) => demoEvents.some((event) => event.customerId === customer.id))!;
  assert.match(deletionDependency('customer', regular.id, regular.name, demoEvents, demoRequests) ?? '', /still use this customer/);
  const newcomer = demoCustomers.find((customer) => !demoEvents.some((event) => event.customerId === customer.id) && !demoRequests.some((request) => request.customerId === customer.id))!;
  assert.equal(deletionDependency('customer', newcomer.id, newcomer.name, demoEvents, demoRequests), null);
});

test('the service list has one way into the edit form and no bin', () => {
  const html = render(React.createElement(ServicesView, {
    services: initialServices, employees: initialEmployees, onAddService: nothing, onUpdateService: nothing, onDeleteService: nothing,
    cannotDelete: () => 'never asked while the form is closed',
  }));
  assert.doesNotMatch(html, /Delete|lucide-trash|never asked/i);
  // "Edit" opens the form: once per card on phones and once per row of the table. The name is text.
  assert.equal(count(html, '>Edit</button>'), initialServices.length * 2);
  for (const service of initialServices) {
    const name = service.name.replace(/&/g, '&amp;').replace(/'/g, '&#x27;');
    assert.equal(count(html, `aria-label="Edit ${name}"`), 2, service.name);
    assert.equal(count(html, `>${name}</button>`), 0, service.name);
    assert.equal(count(html, `>${name}<`), 2, service.name);
  }
  // Beside "Edit" a row holds its online-booking switch and nothing else to press.
  assert.equal(count(html, '<button'), initialServices.length * 2 + 1); // and "New Service"
  assert.equal(count(html, 'type="checkbox"'), initialServices.length * 2);
});
