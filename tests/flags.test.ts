import assert from 'node:assert/strict';
import test from 'node:test';
import { readResearchMode, researchMode, RESEARCH_STORAGE_KEY, setResearchModeForTests } from '../src/flags';

const memory = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

test('study tools are off for a normal visitor and stay on after a study link', () => {
  const storage = memory();
  assert.equal(readResearchMode('', storage), false);
  assert.equal(readResearchMode('?live=key', storage), false);
  // The study link switches them on and the browser remembers it ...
  assert.equal(readResearchMode('?live=key&research=1', storage), true);
  assert.equal(storage.values.get(RESEARCH_STORAGE_KEY), '1');
  assert.equal(readResearchMode('', storage), true);
  assert.equal(readResearchMode('?booking=1', storage), true);
  // ... until ?research=0 switches them off again.
  assert.equal(readResearchMode('?research=0', storage), false);
  assert.equal(storage.values.has(RESEARCH_STORAGE_KEY), false);
  assert.equal(readResearchMode('', storage), false);
  // Other values change nothing.
  assert.equal(readResearchMode('?research=yes', storage), false);
});

test('study tools work without storage and are off outside a browser', () => {
  assert.equal(readResearchMode('?research=1', null), true);
  assert.equal(readResearchMode('', null), false);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(readResearchMode('?research=1', broken), true);
  assert.equal(readResearchMode('', broken), false);
  setResearchModeForTests(undefined);
  assert.equal(researchMode(), false); // no window in the test runner
  setResearchModeForTests(true);
  assert.equal(researchMode(), true);
  setResearchModeForTests(undefined);
});
