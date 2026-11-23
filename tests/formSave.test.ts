import assert from 'node:assert/strict';
import test from 'node:test';
import { FormSaves, withEntry } from '../src/formSave';
import { initialServices } from '../src/mockData';
import { SharedSalon } from '../src/sharedSalon';
import type { ServiceItem } from '../src/types';
import { FIXED_NOW } from './fixedClock';
import { SalonRoutesStandIn } from './salonRoutesStandIn';

// A form that waits for the server's answer to its save (src/formSave.ts): the answer only ever
// concerns the opening of the form that sent it. These run the openings and answers by hand.

/** A save on its way, answered when the test says so. */
function answerLater() {
  let answer: (saved: boolean) => void = () => {};
  const pending = new Promise<boolean>((resolve) => { answer = resolve; });
  return { pending, answer };
}
const WHY = 'Your change was not saved. The server could not be reached. Check your connection.';

test('the form that sent the save waits, closes when it is taken, says why when it is not', async () => {
  const saves = new FormSaves();
  saves.newOpening();
  const closed = [] as string[];
  const first = answerLater();
  const answered = saves.afterSave(first.pending, () => closed.push('closed'), () => WHY);
  assert.deepEqual(saves.state, { saving: true, notSaved: '' });
  first.answer(false);
  await answered;
  assert.deepEqual(saves.state, { saving: false, notSaved: WHY });
  assert.equal(closed.length, 0);
  const second = answerLater();
  const again = saves.afterSave(second.pending, () => closed.push('closed'), () => WHY);
  assert.deepEqual(saves.state, { saving: true, notSaved: '' });
  second.answer(true);
  await again;
  assert.deepEqual(closed, ['closed']);
  // A device that is not signed in: done at once.
  saves.afterSave(null, () => closed.push('at once'), () => WHY);
  assert.deepEqual(closed, ['closed', 'at once']);
});

test('cancel and open another (or the same one again): the answer to the first touches neither', async () => {
  for (const outcome of [true, false]) {
    const saves = new FormSaves();
    saves.newOpening(); // Haircut
    const closed = [] as string[];
    const haircut = answerLater();
    const answered = saves.afterSave(haircut.pending, () => closed.push('Haircut closed'), () => WHY);
    saves.newOpening(); // Cancel
    saves.newOpening(); // Updo (or Haircut again)
    assert.deepEqual(saves.state, { saving: false, notSaved: '' }, 'the new form is not "Saving…" and can be saved');
    haircut.answer(outcome);
    await answered;
    assert.equal(closed.length, 0);
    assert.deepEqual(saves.state, { saving: false, notSaved: '' });
    // The new form saves for itself.
    const updo = answerLater();
    const own = saves.afterSave(updo.pending, () => closed.push('Updo closed'), () => WHY);
    updo.answer(true);
    await own;
    assert.deepEqual(closed, ['Updo closed']);
  }
});

test('"Save and add another": the first person\'s answer arrives while the second is typed and leaves that form alone', async () => {
  const saves = new FormSaves();
  saves.newOpening();
  const first = answerLater();
  const answered = saves.afterSave(first.pending, () => {}, () => WHY);
  saves.newOpening(); // the next person's form, opened at once
  first.answer(false);
  await answered;
  assert.deepEqual(saves.state, { saving: false, notSaved: '' });
});

test('leaving the screen while a save waits: the answer changes nothing', async () => {
  let redraws = 0;
  const saves = new FormSaves(() => { redraws += 1; });
  saves.newOpening();
  const pending = answerLater();
  const closed = [] as string[];
  const answered = saves.afterSave(pending.pending, () => closed.push('closed'), () => WHY);
  const before = redraws;
  saves.dispose();
  pending.answer(true);
  await answered;
  assert.equal(closed.length, 0);
  assert.equal(redraws, before);
});

// ---------- a save that is tried again is the same entry ----------

test('a new entry keeps its id over every try: sent again, it takes the place of the first try and is never there twice', () => {
  const list = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const added = withEntry(list, { id: 'c', name: 'C' });
  assert.deepEqual(added.map((item) => item.id), ['a', 'b', 'c']);
  // The same form saves again, with a word changed: still three entries, the third as typed now, in its place.
  assert.deepEqual(withEntry(added, { id: 'c', name: 'C!' }), [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C!' }]);
  assert.deepEqual(withEntry(withEntry(added, { id: 'b', name: 'B!' }), { id: 'b', name: 'B!' }).map((item) => item.name), ['A', 'B!', 'C']);
  assert.deepEqual(list.map((item) => item.id), ['a', 'b'], 'the list given is not changed');
});

test('a new service whose answer got lost, though the server took it: the device learns it is saved, and saving the form again leaves one service', async () => {
  const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const server = new SalonRoutesStandIn();
  const salon = new SharedSalon({ request: server.request, builtAt: () => FIXED_NOW });
  const services = () => salon.read<ServiceItem[]>('services', initialServices);
  services();
  await salon.begin(server.key);
  const created: ServiceItem = { ...initialServices[0], id: 'srv-new-1', name: 'Scalp ritual' };
  // The form's first save: the server takes it, but the device gets no answer.
  server.failNext = [null];
  salon.write<ServiceItem[]>('services', (previous) => withEntry(previous, created));
  const first = salon.pendingFormSave();
  await settled();
  assert.equal(await first, false);
  assert.equal(salon.current.notice?.kind, 'error');
  server.saveElsewhere({ services: withEntry(initialServices, created) });
  // The device loads the record again (the chats' answer reports the new revision): the service is there.
  salon.noteRevision(server.record!.rev);
  await settled();
  assert.equal(salon.current.notice, null, 'saved after all: nothing says "not saved" any more');
  assert.ok(salon.serverValue<ServiceItem[]>('services', initialServices).some((item) => item.id === created.id), 'the form can see that the server has its service');
  // The owner presses Save in the form once more, with the id of this opening of the form.
  salon.write<ServiceItem[]>('services', (previous) => withEntry(previous, { ...created, priceCHF: 70 }));
  const second = salon.pendingFormSave();
  await settled();
  // Nothing may be left to save (the same content) or one more save (the price): either way one service.
  if (second) assert.equal(await second, true);
  const stored = server.record!.parts.services as ServiceItem[];
  assert.equal(stored.filter((item) => item.name === 'Scalp ritual').length, 1);
  assert.equal(stored.find((item) => item.id === created.id)?.priceCHF, 70);
  assert.equal(services().filter((item) => item.name === 'Scalp ritual').length, 1);
});
