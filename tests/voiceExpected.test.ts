import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssistantRequest } from '../src/assistant/types';
import { EXPECTED_CALL, expectedFor, scoreReading, type Expected } from '../src/voice/lab/expected';
import { CHECK_CUSTOMER, checkSalon } from '../src/voice/lab/salon';
import { LAB_LANGUAGES, type LabLanguage } from '../src/voice/lab/sentences';

// What a reader (the AI model, or the built-in rules) should understand from each sentence of
// the voice check, and how a reading is scored against it.

const THURSDAY_19_NOV = '2026-11-19';
const salon = (today = THURSDAY_19_NOV) => ({ ...checkSalon(), today });
const idOf = (name: string) => checkSalon().services.find(service => service.name === name)!.id;
const staffId = (firstName: string) => checkSalon().employees.find(employee => employee.name.startsWith(firstName))!.id;
const days = (expected: Expected | null, today: string) => expected?.days?.(today);
const score = (expected: Expected, request: AssistantRequest | null, today?: string) => scoreReading(expected, request, salon(today));
const marks = (expected: Expected, request: AssistantRequest | null, today?: string) => score(expected, request, today).fields.map(field => `${field.label}:${field.right ? 'right' : 'wrong'}`);

test('the salon of the check has the services, the team and the customer the sentences name', () => {
  const { services, employees, customers } = checkSalon();
  for (const name of ['Haircut', 'Colouring']) assert.ok(services.some(service => service.name === name), name);
  for (const name of ['Selina', 'Luca']) assert.ok(employees.some(employee => employee.name.split(' ')[0] === name), name);
  assert.equal(customers.filter(customer => customer.name === CHECK_CUSTOMER).length, 1);
  // The heard name has real neighbours to be told apart from.
  assert.ok(customers.filter(customer => /Brunner$/.test(customer.name)).length >= 2);
  assert.ok(customers.length > 50);
});

test('both languages are scored the same, and two sentences are not scored at all', () => {
  for (const language of Object.keys(LAB_LANGUAGES) as LabLanguage[]) {
    const scored = LAB_LANGUAGES[language].sentences.filter(sentence => expectedFor(sentence.id) !== null).map(sentence => sentence.id.slice(-2));
    assert.deepEqual(scored, ['01', '02', '03', '04', '05', '06', '08', '09', '11', '12'], language);
  }
  assert.equal(expectedFor('en-04'), expectedFor('de-04'));
  // A phone number has no place in a request, and the confirming phrase is not a reader's job.
  assert.equal(expectedFor('en-07'), null);
  assert.equal(expectedFor('de-10'), null);
});

test('the day a sentence means is worked out from the day it is spoken', () => {
  // Spoken on Thursday 19 November 2026, as in the first real round.
  assert.deepEqual(days(expectedFor('en-01'), THURSDAY_19_NOV), ['2026-11-26']);
  assert.deepEqual(days(expectedFor('en-02'), THURSDAY_19_NOV), ['2026-11-27']);
  assert.deepEqual(days(expectedFor('en-03'), THURSDAY_19_NOV), ['2026-11-20']);
  assert.deepEqual(days(expectedFor('en-04'), THURSDAY_19_NOV), ['2026-11-24']);
  assert.deepEqual(days(expectedFor('en-05'), THURSDAY_19_NOV), ['2026-11-21']);
  assert.deepEqual(days(expectedFor('en-08'), THURSDAY_19_NOV), ['2026-11-20']);
  assert.deepEqual(days(expectedFor('en-09'), THURSDAY_19_NOV), ['2026-12-02']);
  assert.deepEqual(days(expectedFor('en-11'), THURSDAY_19_NOV), ['2026-11-20']);
  assert.deepEqual(days(EXPECTED_CALL, THURSDAY_19_NOV), ['2026-11-26']);

  // On a Monday "next Tuesday" can mean tomorrow or the Tuesday of the week after: both count.
  assert.deepEqual(days(expectedFor('en-04'), '2026-11-23'), ['2026-11-24', '2026-12-01']);
  // A date that has passed this year means next year's; on the day itself it means today.
  assert.deepEqual(days(expectedFor('en-02'), '2026-11-28'), ['2027-11-27']);
  assert.deepEqual(days(expectedFor('en-02'), '2026-11-27'), ['2026-11-27']);
  assert.deepEqual(days(expectedFor('en-09'), '2026-12-03'), ['2027-12-02']);
  // "Thursday the twenty-sixth" spoken when the 26th is no Thursday: either reading counts.
  assert.deepEqual(days(EXPECTED_CALL, '2026-12-01'), ['2026-12-03', '2026-12-26']);
  assert.deepEqual(days(EXPECTED_CALL, '2026-11-26'), ['2026-12-03', '2026-11-26']);
});

test('a reading is scored detail by detail', () => {
  // What the built-in rules made of "a haircut on Friday the 27th of November at half past 10:10".
  const rules = score(expectedFor('en-02')!, { language: 'en', date: '2026-11-27', time: '10:10', serviceId: idOf('Haircut') });
  assert.deepEqual(rules.fields, [
    { label: 'Day', expected: 'Fri, 27.11.2026', got: 'Fri, 27.11.2026', right: true },
    { label: 'Time', expected: '10:30', got: '10:10', right: false },
    { label: 'Service', expected: 'Haircut', got: 'Haircut', right: true },
  ]);
  assert.equal(rules.right, 2);
  assert.equal(rules.total, 3);

  assert.deepEqual(marks(expectedFor('en-01')!, { language: 'en', intent: 'availability', date: '2026-11-26', time: '15:00' }), ['What:right', 'Day:right', 'Time:right']);
  assert.deepEqual(marks(expectedFor('en-01')!, { language: 'en', intent: 'book', date: '2026-11-19', time: '15:00' }), ['What:wrong', 'Day:wrong', 'Time:right']);
  assert.deepEqual(marks(expectedFor('en-05')!, { language: 'en', intent: 'availability', employeeId: staffId('Luca'), date: '2026-11-21', partOfDay: 'afternoon' }), ['What:right', 'Day:right', 'Part of day:right', 'With:right']);
  assert.deepEqual(marks(expectedFor('en-04')!, { language: 'en', date: '2026-11-24', time: '17:45', employeeId: staffId('Anna') }), ['Day:right', 'Time:wrong', 'With:wrong']);
  // Nothing was read at all: every detail is missing.
  assert.deepEqual(score(expectedFor('en-09')!, null).fields, [
    { label: 'What', expected: 'cancel', got: 'none', right: false },
    { label: 'Day', expected: 'Wed, 02.12.2026', got: 'none', right: false },
  ]);
});

test('a customer counts when the heard spelling finds the right person in the list', () => {
  const customer = (heard: string) => score(expectedFor('en-06')!, { language: 'en', customerName: heard }).fields[0];
  assert.deepEqual(customer('Leah Bruner'), { label: 'Customer', expected: 'Lea Brunner', got: 'Leah Bruner (found: Lea Brunner)', right: true });
  assert.equal(customer('Leah Broner').right, true);
  assert.equal(customer('Lea Brunner').right, true);
  // A first name alone fits several customers: nobody is found.
  assert.deepEqual(customer('Leah'), { label: 'Customer', expected: 'Lea Brunner', got: 'Leah (not found)', right: false });
  assert.equal(customer('Nadja Brunner').right, false);
  assert.equal(score(expectedFor('en-06')!, null).fields[0].got, 'none');
});

test('small talk is read right when nothing is noted', () => {
  assert.deepEqual(score(expectedFor('en-12')!, null).fields, [{ label: 'Nothing to note', expected: 'nothing', got: 'nothing', right: true }]);
  assert.deepEqual(marks(expectedFor('en-12')!, { language: 'en' }), ['Nothing to note:right']);
  assert.deepEqual(marks(expectedFor('en-12')!, { language: 'en', intent: 'availability' }), ['Nothing to note:wrong']);
  assert.deepEqual(marks(expectedFor('en-12')!, { language: 'en', time: '13:00' }), ['Nothing to note:wrong']);
});

test('the call is scored on what was agreed in the end', () => {
  const agreed = { language: 'en' as const, intent: 'availability' as const, serviceId: idOf('Haircut'), date: '2026-11-26', time: '15:30', customerName: 'Leah Bruner' };
  assert.deepEqual(marks(EXPECTED_CALL, agreed), ['Day:right', 'Time:right', 'Service:right', 'Customer:right']);
  // The time that turned out to be taken is not the answer.
  assert.deepEqual(marks(EXPECTED_CALL, { ...agreed, time: '15:00' }), ['Day:right', 'Time:wrong', 'Service:right', 'Customer:right']);
});
