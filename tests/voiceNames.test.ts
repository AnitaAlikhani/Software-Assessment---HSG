import assert from 'node:assert/strict';
import test from 'node:test';
import { closestNames, likeness, matchName, soundOf } from '../src/voice/names';

// A speech recogniser spells names by ear. These are the spellings Chrome produced in the first
// real round of the voice check, for "Lea Brunner", "Selina" and "Luca".

const people = ['Lea Brunner', 'Léa Girard', 'Nadja Brunner', 'Leo Brunner', 'Marco Bianchi', 'Sandra Meier', 'Luca Frei', 'Selina Keller', 'Lena Bruderer']
  .map((name, index) => ({ id: `cust-${index}`, name }));
const matched = (heard: string) => matchName(heard, people)?.name ?? null;

test('a name sounds the same however it is spelled', () => {
  assert.equal(soundOf('Leah'), soundOf('Lea'));
  assert.equal(soundOf('Léa'), soundOf('Lea'));
  assert.equal(soundOf('Bruner'), soundOf('Brunner'));
  assert.equal(soundOf('Lucca'), soundOf('Luca'));
  assert.equal(soundOf('Luka'), soundOf('Luca'));
  assert.equal(soundOf('Meyer'), soundOf('Meier'));
  assert.equal(soundOf('Philipp'), soundOf('Filip'));
  assert.equal(soundOf('Sarah'), soundOf('Sara'));
  assert.equal(soundOf('Müller'), soundOf('Muller'));
  assert.equal(soundOf('Mueller'), soundOf('Muller'));
  assert.notEqual(soundOf('Lea'), soundOf('Leo'));
  assert.notEqual(soundOf('Hanna'), soundOf('Anna'), 'an h at the start is heard');
});

test('the spellings from the real round find the customer who was meant', () => {
  for (const heard of ['Leah Bruner', 'Leah Broner', 'Leah Brunner', 'Leah brooner', 'Leah broenner', 'lea brunner', 'LEA BRUNNER']) {
    assert.equal(matched(heard), 'Lea Brunner', heard);
  }
  assert.equal(matched('Salina'), 'Selina Keller');
  assert.equal(matched('Luka'), 'Luca Frei');
  assert.equal(matched('Lucca'), 'Luca Frei');
});

test('when several people fit about equally well nobody is picked, and the owner gets the choices', () => {
  // A first name alone fits everybody with that first name.
  assert.equal(matched('Leah'), null);
  assert.deepEqual(closestNames('Leah', people).map(fit => fit.person.name), ['Lea Brunner', 'Léa Girard']);
  assert.equal(matched('Bruner'), null);
  assert.deepEqual(closestNames('Bruner', people).map(fit => fit.person.name), ['Lea Brunner', 'Leo Brunner', 'Nadja Brunner']);
  // The best fit comes first, with the runner-up behind it.
  assert.deepEqual(closestNames('Leah Bruner', people).map(fit => [fit.person.name, fit.likeness]), [['Lea Brunner', 1], ['Leo Brunner', 0.83]]);
  assert.equal(closestNames('Leah Bruner', people, 1).length, 1);
});

test('somebody else is not taken for a known customer', () => {
  assert.equal(matched('Peter Muster'), null);
  assert.deepEqual(closestNames('Peter Muster', people), []);
  // A little off in both parts is another person, not Sandra Meier.
  assert.equal(matched('Sandro Mayer'), null);
  assert.equal(likeness('Sandro Mayer', 'Sandra Meier'), 0);
  // A full name does not fit somebody who only shares the surname.
  assert.equal(matched('Thomas Brunner'), null);
  assert.equal(matched(''), null);
  assert.equal(matched('078 555 27 40'), null);
});

test('the person is returned as given, so its id can be used', () => {
  assert.deepEqual(matchName('Leah Bruner', people), { id: 'cust-0', name: 'Lea Brunner' });
});
