import assert from 'node:assert/strict';
import test from 'node:test';
import { changeAddress, createOverlayHistory, type OverlayHistoryHost } from '../src/backGesture';

// The phone's Back gesture closes what is open over a page (a dialog, the "More" sheet, the
// assistant, search) and leaves the page where it is. The bookkeeping behind it is tested here
// against a stand-in for the browser's history: a list of entries and a position in it.

interface Entry { address: string; state: unknown }

function browser(start = '#/home') {
  const entries: Entry[] = [{ address: start, state: null }];
  let at = 0;
  /** What lies open over the page, bottom to top. */
  const open: string[] = [];
  const closed: string[] = [];
  /** Overlays that ask before they close, and are kept open ("no, keep editing"). */
  const stubborn = new Set<string>();
  let routeIsOverlay = false;
  /** Steps the app asked for; the browser carries them out later, like a real one. */
  let pending = 0;
  const host: OverlayHistoryHost<string> = {
    state: () => entries[at].state,
    push: (state) => { entries.splice(at + 1); entries.push({ address: entries[at].address, state }); at += 1; },
    back: () => { pending += 1; },
    topOverlay: () => open.at(-1) ?? null,
    close: (overlay) => { closed.push(overlay); if (!stubborn.has(overlay)) open.splice(open.indexOf(overlay), 1); },
    routeIsOverlay: () => routeIsOverlay,
  };
  const manager = createOverlayHistory(host);
  const settle = () => { while (pending > 0) { pending -= 1; at -= 1; manager.popped(); } };
  return {
    entries, closed, stubborn,
    get at() { return at; },
    get address() { return entries[at].address; },
    get open() { return [...open]; },
    /** Something opens or closes on the page; the app notices, as it does through the page itself. */
    show(overlay: string) { open.push(overlay); manager.sync(); settle(); },
    hide(overlay: string) { open.splice(open.indexOf(overlay), 1); manager.sync(); settle(); },
    /** One overlay gives way to another in the same moment; the browser has not carried out anything yet. */
    swap(from: string, to: string) { open.splice(open.indexOf(from), 1, to); manager.sync(); },
    /** The owner's Back gesture and Forward button. After it the page has changed, so the app looks again. */
    back() { at -= 1; manager.popped(); manager.sync(); settle(); },
    forward() { at += 1; manager.popped(); manager.sync(); settle(); },
    /** The app opens another page: a new entry, as a link does. */
    visit(address: string, state: unknown = null) { entries.splice(at + 1); entries.push({ address, state }); at += 1; manager.moved(); },
    set routeIsOverlay(value: boolean) { routeIsOverlay = value; },
    manager, settle,
    get pending() { return pending; },
  };
}

test('an open overlay gets one history entry with the page\'s own address, and Back closes it', () => {
  const tab = browser('#/calendar');
  tab.show('new appointment');
  assert.deepEqual(tab.entries.map((entry) => entry.address), ['#/calendar', '#/calendar']);
  assert.equal(tab.at, 1);
  tab.back();
  assert.deepEqual(tab.closed, ['new appointment']);
  assert.deepEqual(tab.open, []);
  // The address never changed, so the page stayed. The next Back is the browser's own business.
  assert.equal(tab.address, '#/calendar');
  assert.equal(tab.at, 0);
  assert.equal(tab.pending, 0);
});

test('an overlay closed with its own button takes its entry along, so no Back is wasted', () => {
  const tab = browser('#/home');
  tab.visit('#/calendar');
  tab.show('new appointment');
  assert.equal(tab.at, 2);
  tab.hide('new appointment');
  assert.equal(tab.at, 1);
  assert.equal(tab.address, '#/calendar');
  assert.deepEqual(tab.closed, []);
  // One Back now leaves the Calendar, as if the form had never been open.
  tab.back();
  assert.equal(tab.address, '#/home');
  assert.deepEqual(tab.closed, []);
});

test('of two overlays Back closes the upper one first, and each needs its own Back', () => {
  const tab = browser('#/conversations');
  tab.show('assistant');
  tab.show('confirmation');
  assert.equal(tab.at, 1, 'one entry stands for whatever is open');
  tab.back();
  assert.deepEqual(tab.closed, ['confirmation']);
  assert.deepEqual(tab.open, ['assistant']);
  assert.equal(tab.at, 1, 'the overlay that is still open has its entry again');
  tab.back();
  assert.deepEqual(tab.closed, ['confirmation', 'assistant']);
  assert.equal(tab.at, 0);
  assert.equal(tab.address, '#/conversations');
});

test('a form that asks first and is kept open is asked again by the next Back', () => {
  const tab = browser('#/team');
  tab.stubborn.add('person');
  tab.show('person');
  tab.back();
  tab.back();
  assert.deepEqual(tab.closed, ['person', 'person']);
  assert.deepEqual(tab.open, ['person']);
  assert.equal(tab.address, '#/team');
  // Once the owner agrees, it closes and the page is still there.
  tab.stubborn.clear();
  tab.back();
  assert.deepEqual(tab.open, []);
  assert.equal(tab.at, 0);
});

test('an overlay that has an address of its own needs no extra entry and is not closed by hand', () => {
  // An appointment's details: "#/calendar?appointmentId=..." is the entry, and leaving it closes them.
  const tab = browser('#/calendar');
  tab.visit('#/calendar?appointmentId=cal-2');
  tab.routeIsOverlay = true;
  tab.show('details');
  assert.equal(tab.entries.length, 2);
  tab.back();
  assert.deepEqual(tab.closed, [], 'the change of address closes the details; nothing else must');
  assert.equal(tab.address, '#/calendar');
});

test('while the app steps back itself, a newly opened overlay waits for its entry', () => {
  // "Edit" in an appointment's details: the details close (the app steps back from their
  // address to the Calendar) and the edit form opens in the same moment.
  const tab = browser('#/calendar');
  tab.visit('#/calendar?appointmentId=cal-2');
  tab.routeIsOverlay = true;
  tab.show('details');
  assert.equal(tab.entries.length, 2);
  tab.manager.stepBack();
  tab.routeIsOverlay = false;
  tab.swap('details', 'edit form');
  // An entry added now would land on top of the details' address, and the step back would end on it.
  assert.equal(tab.entries.length, 2, 'no entry is added before the step back has arrived');
  tab.settle();
  // The step has arrived on the Calendar; now the form gets its entry there.
  assert.deepEqual(tab.entries.map((entry) => entry.address), ['#/calendar', '#/calendar']);
  assert.equal(tab.at, 1);
  tab.back();
  assert.deepEqual(tab.closed, ['edit form']);
  assert.equal(tab.address, '#/calendar');
  assert.equal(tab.at, 0);
});

test('a page opened while the app still steps back waits for that step', () => {
  // A tap beside "More" closes the sheet; its entry is being taken away when a tap on a screen follows at once.
  const tab = browser('#/home');
  tab.show('more');
  const order: string[] = [];
  tab.manager.stepBack();
  tab.manager.whenSettled(() => order.push(`opened on entry ${tab.at}`));
  assert.equal(order.length, 0, 'not yet: the step back would lead away from the new page again');
  tab.settle();
  assert.equal(order.join(), 'opened on entry 0');
  // With nothing under way a page opens at once.
  tab.manager.whenSettled(() => order.push('at once'));
  assert.equal(order.join(), 'opened on entry 0,at once');
  // A step that is never reported does not hold the app up for good.
  tab.manager.stepBack();
  tab.manager.whenSettled(() => order.push('after giving up'));
  tab.manager.giveUpWaiting();
  assert.equal(order.at(-1), 'after giving up');
});

test('an overlay\'s entry without its overlay is no place to stop', () => {
  const tab = browser('#/home');
  tab.show('more');
  tab.back();
  assert.deepEqual(tab.open, []);
  // Forward leads onto the entry the sheet had. Nothing is open there, so the app steps back again.
  tab.forward();
  assert.equal(tab.at, 0);
  assert.equal(tab.address, '#/home');
  assert.deepEqual(tab.open, []);
});

// ---------- the app's own changes of address ----------

/** A stand-in for the browser window, for the length of one call. */
function withWindow<T>(start: string, state: unknown, run: (tab: { entries: Entry[]; at: () => number; steps: () => number; told: string[] }) => T): T {
  const entries: Entry[] = [{ address: start, state }];
  let at = 0;
  let steps = 0;
  const told: string[] = [];
  const location = {
    pathname: '/sub/', search: '?research=1',
    get hash() { return entries[at].address; },
    set hash(value: string) { entries.splice(at + 1); entries.push({ address: value, state: null }); at += 1; },
    get href() { return `https://slotbee.example/sub/?research=1${entries[at].address}`; },
  };
  const history = {
    get state() { return entries[at].state; },
    pushState: (next: unknown, _: string, url?: string) => { entries.splice(at + 1); entries.push({ address: url ? url.slice(url.indexOf('#')) : entries[at].address, state: next }); at += 1; },
    replaceState: (next: unknown, _: string, url?: string) => { entries[at] = { address: url ? url.slice(url.indexOf('#')) : entries[at].address, state: next }; },
    back: () => { steps += 1; },
  };
  const fake = {
    location, history,
    dispatchEvent: (event: { type: string; newURL: string }) => { told.push(`${event.type} ${event.newURL}`); return true; },
    // The app gives a step back a second to be reported. Here it never is, so the wait ends at once.
    setTimeout: (task: () => void) => { task(); return 0; },
  };
  class FakeHashChangeEvent { type: string; newURL: string; constructor(type: string, init: { newURL: string }) { this.type = type; this.newURL = init.newURL; } }
  const previous = ['window', 'HashChangeEvent', 'document'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fake });
  Object.defineProperty(globalThis, 'HashChangeEvent', { configurable: true, value: FakeHashChangeEvent });
  // A page with nothing open over it.
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelectorAll: () => [] } });
  try {
    return run({ entries, at: () => at, steps: () => steps, told });
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test('opening a page adds an entry; closing what an address stood for steps back to the page below', () => {
  withWindow('#/calendar', null, (tab) => {
    changeAddress('#/calendar?appointmentId=cal-2');
    assert.deepEqual(tab.entries.map((entry) => entry.address), ['#/calendar', '#/calendar?appointmentId=cal-2']);
    // Closing the details: the Calendar lies right below, so the app steps back to it. Replacing
    // the entry instead would leave the Calendar in the history twice, and a Back that does nothing.
    changeAddress('#/calendar', true);
    assert.equal(tab.steps(), 1);
    assert.equal(tab.entries.length, 2);
  });
  withWindow('#/home', null, (tab) => {
    // Opened from Home (a search result): Home lies below, not the Calendar, so the entry is exchanged.
    changeAddress('#/calendar?appointmentId=cal-2');
    changeAddress('#/calendar', true);
    assert.equal(tab.steps(), 0);
    assert.deepEqual(tab.entries.map((entry) => entry.address), ['#/home', '#/calendar']);
  });
});

test('moving between the tabs of a page adds no entry, so Back does not walk through the tabs', () => {
  withWindow('#/home', null, (tab) => {
    changeAddress('#/team');
    changeAddress('#/team?tab=week', true);
    changeAddress('#/team?tab=absences', true);
    assert.deepEqual(tab.entries.map((entry) => entry.address), ['#/home', '#/team?tab=absences']);
    assert.equal(tab.steps(), 0);
    // The rest of the address (the place the app is served from, the research switch) is kept.
    assert.equal((globalThis as unknown as { window: { location: { href: string } } }).window.location.href, 'https://slotbee.example/sub/?research=1#/team?tab=absences');
  });
});

test('a page opened from inside an overlay takes the overlay\'s entry and tells the app\'s listeners', () => {
  // "More" is open on Home (its entry carries the mark); the owner taps Team.
  withWindow('#/home', null, (tab) => {
    (globalThis as unknown as { window: { history: { pushState(state: unknown, title: string): void } } }).window.history.pushState({ slotbeeOverlay: true }, '');
    assert.equal(tab.entries.length, 2);
    changeAddress('#/team');
    // Home, then Team: one Back from Team returns to Home, with no empty stop in between.
    assert.deepEqual(tab.entries.map((entry) => entry.address), ['#/home', '#/team']);
    assert.equal(tab.at(), 1);
    assert.deepEqual(tab.told, ['hashchange https://slotbee.example/sub/?research=1#/team']);
    assert.ok(!(tab.entries[1].state as { slotbeeOverlay?: boolean }).slotbeeOverlay);
  });
});
