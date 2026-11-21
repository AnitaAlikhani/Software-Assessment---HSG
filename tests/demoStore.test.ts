import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { initialAiSettings } from '../src/conversationData';
import { DemoStore, readStoredSalon } from '../src/demoStore';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData';
import { addDays, getSalonNow } from '../src/scheduling';
import { STANDALONE_PARTS, storedShapeProblem } from '../src/storedShapes';
import type { AppointmentRequest, CalendarEvent, CompanySettingsData, Customer } from '../src/types';
import {
  DEMO_STORAGE_VERSION, demoStorageKey, forgetRetiredDemoState, PER_TAB_KEYS, resetDemoState, salonStorageKey, useDemoState, watchDemoState,
} from '../src/useDemoState';
import { blockedStorage, BrowserStandIn, ClockStandIn, inTab, PREFIX, StorageStandIn, storeFor, type TabStandIn } from './browserStandIn';
import { demoConversations, demoCustomers, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { render } from './renderHelpers';

// What the owner does is kept in the browser's lasting storage, as one entry for the whole salon,
// and every tab of the browser shows the same salon. These tests run "tabs" on a stand-in for
// that storage and for the event that tells the other tabs about a write (tests/browserStandIn.ts).

const SALON = salonStorageKey('/');
const TODAY = '2026-10-05'; // FIXED_NOW in Zurich
const TOMORROW_MORNING = '2026-10-06T07:00:00Z';

const aRequest = (id: string, date: string, partial: Partial<AppointmentRequest> = {}): AppointmentRequest => ({
  id, customerName: 'Sandra Keller', customerId: 'cust-1', customerPhone: '+41791234567', serviceId: 'srv-2', serviceName: 'Haircut',
  employeeId: 'emp-1', staffName: 'Anna Weber', date, dateStr: date, timeStr: '10:00 - 10:30', timeAgo: '', channel: 'Web', isAiBooked: false,
  status: 'pending', ...partial,
});
const anAppointment = (id: string, date: string): CalendarEvent => ({
  id, customerName: 'Petra Meier', customerId: 'cust-2', serviceId: 'srv-2', serviceName: 'Haircut', employeeId: 'emp-1', staffName: 'Anna Weber',
  date, day: 'mon', dateDisplay: date, startTime: '14:00', endTime: '14:30', colorTheme: 'purple',
});
const someCustomers: Customer[] = [
  { id: 'cust-1', name: 'Sandra Keller', initials: 'SK', email: '', phone: '+41791234567', language: 'DE' },
  { id: 'cust-2', name: 'Petra Meier', initials: 'PM', email: '', phone: '+41791112233', language: 'DE' },
];

// A small salon whose starting data say for which day they were built, as the app's own do: the
// request is for the day after, the appointment for the day itself.
const builtFor = (builtAt: Date): string => getSalonNow(undefined, builtAt).date;
const startingRequests = (builtAt: Date): AppointmentRequest[] => [aRequest('req-1', addDays(builtFor(builtAt), 1))];
const startingEvents = (builtAt: Date): CalendarEvent[] => [anAppointment('cal-1', builtFor(builtAt))];

/** What one tab shows of the salon. Reading is what a screen does when it is drawn. */
const shown = (store: DemoStore) => ({
  requests: store.read('requests', startingRequests),
  events: store.read('calendarEvents', startingEvents),
  customers: store.read('customers', someCustomers),
  settings: store.read('companySettings', initialCompanySettings),
  hours: store.read('bookingHours', initialBookingHours),
});
const storedSalon = (browser: BrowserStandIn) => JSON.parse(browser.stored.get(SALON) ?? 'null') as
  { day: string; builtAt: string; changed: boolean; resetAt: string; parts: Record<string, unknown> } | null;
/** A salon that nobody has changed, as it is stored: no parts, only the day and the moment it was built for, and when it was last reset. */
const untouched = (day: string, builtAt: string, resetAt = builtAt) => ({ day, builtAt, changed: false, resetAt, parts: {} });
const MONDAY_NOON = FIXED_NOW.toISOString();
const TUESDAY_MORNING = '2026-10-06T07:00:00.000Z';
/** A change is stored once the action that made it has finished. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const renamed = (name: string) => (settings: CompanySettingsData): CompanySettingsData => ({ ...settings, companyName: name });

function twoTabs() {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const tabA = browser.openTab();
  const tabB = browser.openTab();
  const a = storeFor(tabA, clock);
  const b = storeFor(tabB, clock);
  shown(a);
  shown(b);
  return { browser, clock, tabA, tabB, a, b };
}

// ---------- writing and reading ----------

test('a change is stored once for the browser and is there again in a tab opened later', async () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const store = storeFor(browser.openTab(), clock);
  // Nothing is stored yet: every part has its starting value, built for the moment the salon was started.
  assert.deepEqual(shown(store).requests.map((item) => [item.id, item.date]), [['req-1', '2026-10-06']]);
  assert.equal(store.builtAt.toISOString(), FIXED_NOW.toISOString());
  // That moment and its day are stored at once, in one entry; an untouched salon stores no parts.
  assert.deepEqual([...browser.stored.keys()], [SALON]);
  assert.deepEqual(storedSalon(browser), untouched(TODAY, MONDAY_NOON));

  // The owner changes something: a setter works like the one of useState, with a value or a function.
  store.write<AppointmentRequest[]>('requests', (previous) => [aRequest('req-new', '2026-10-08'), ...previous]);
  store.write('companySettings', { ...initialCompanySettings, companyName: 'Coiffeur Keller' });
  assert.deepEqual(shown(store).requests.map((item) => item.id), ['req-new', 'req-1']);
  // Stored after the action, not in the middle of it ...
  assert.equal(storedSalon(browser)?.changed, false);
  await settled();
  const stored = storedSalon(browser)!;
  assert.equal(stored.changed, true);
  assert.equal(stored.day, TODAY);
  // ... and from the first change on with everything the tab holds, the unchanged parts too.
  assert.deepEqual(Object.keys(stored.parts).sort(), ['bookingHours', 'calendarEvents', 'companySettings', 'customers', 'requests']);
  assert.deepEqual((stored.parts.requests as AppointmentRequest[]).map((item) => item.id), ['req-new', 'req-1']);

  // A tab opened later (or the same one after a reload) reads what was stored.
  const later = shown(storeFor(browser.openTab(), clock));
  assert.deepEqual(later.requests.map((item) => item.id), ['req-new', 'req-1']);
  assert.equal(later.settings.companyName, 'Coiffeur Keller');
  assert.deepEqual(later.events, startingEvents(FIXED_NOW));
});

test('setting the value it already has, or one that says the same, changes nothing and stores nothing', async () => {
  const browser = new BrowserStandIn();
  const tab = browser.openTab();
  const store = storeFor(tab, new ClockStandIn());
  const before = shown(store);
  let drawn = 0;
  store.listen('companySettings', () => drawn++);
  const writes = tab.local.writes;
  // The same object: nothing happens at all.
  store.write('companySettings', (previous: CompanySettingsData) => previous);
  assert.equal(drawn, 0);
  // A new object with the same content ("Save" without a change): the screen gets it, the salon is not changed by it.
  store.write('companySettings', { ...initialCompanySettings });
  assert.equal(drawn, 1);
  assert.notEqual(shown(store).settings, before.settings);
  await settled();
  assert.equal(tab.local.writes, writes);
  assert.equal(store.changed, false);
  assert.equal(storedSalon(browser)?.changed, false);
});

// ---------- the version and the path ----------

test('the key carries the version and the path the app is served from', () => {
  assert.equal(DEMO_STORAGE_VERSION, 'booking-demo-v5');
  assert.equal(SALON, 'booking-demo-v5:/:salon');
  // github.io serves several builds under one address: each path keeps a salon of its own.
  assert.equal(salonStorageKey('/Software-Assessment---HSG/'), 'booking-demo-v5:/Software-Assessment---HSG/:salon');
  assert.equal(demoStorageKey('draft', '/previews/x/'), 'booking-demo-v5:/previews/x/:draft');
  // The same place with and without the name of its file is one place.
  assert.equal(salonStorageKey('/previews/x/index.html'), salonStorageKey('/previews/x/'));
  assert.equal(salonStorageKey('/index.html'), SALON);
});

test('another build under the same address and an older version keep their own data', async () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const tab = browser.openTab();
  const setup = { lasting: tab.local, tab: tab.session, perTabKeys: PER_TAB_KEYS, now: clock.now };
  const main = new DemoStore({ ...setup, prefix: PREFIX });
  const preview = new DemoStore({ ...setup, prefix: `${DEMO_STORAGE_VERSION}:/previews/x/` });
  const earlier = new DemoStore({ ...setup, prefix: 'booking-demo-v3:/' });
  main.read('companySettings', initialCompanySettings);
  main.write('companySettings', renamed('Main build'));
  await settled();
  assert.equal(preview.read('companySettings', initialCompanySettings).companyName, initialCompanySettings.companyName);
  assert.equal(earlier.read('companySettings', initialCompanySettings).companyName, initialCompanySettings.companyName);
  assert.deepEqual([...browser.stored.keys()].sort(), ['booking-demo-v3:/:salon', 'booking-demo-v5:/:salon', 'booking-demo-v5:/previews/x/:salon']);
  assert.equal(new DemoStore({ ...setup, prefix: PREFIX }).read('companySettings', initialCompanySettings).companyName, 'Main build');
});

test('what earlier versions stored for this place is taken out; everything else stays', () => {
  const entries = (names: string[]) => new StorageStandIn(new Map(names.map((name) => [name, '[]'])));
  const names = (storage: StorageStandIn) => Array.from({ length: storage.length }, (_, index) => storage.key(index));
  // An earlier version kept every part under a key of its own, in the tab's storage.
  const session = entries([
    'booking-demo-v3:/:requests', 'booking-demo-v3:/:resources', 'booking-demo-v2:/:requests', 'booking-demo-v3:/previews/x/:requests',
    demoStorageKey('draft', '/'), 'slotbee-interest-dismissed',
  ]);
  const local = entries(['booking-demo-v3:/:salon', SALON, 'booking-demo-v6:/:salon', 'booking-demo-v3:/index.html:requests', 'slotbee-research', 'slotbee-live-key']);
  forgetRetiredDemoState([session, local, null, blockedStorage], '/index.html');
  assert.deepEqual(names(session), ['booking-demo-v3:/previews/x/:requests', demoStorageKey('draft', '/'), 'slotbee-interest-dismissed']);
  // A newer version's salon is never touched: a tab that still runs an older build must not delete it.
  assert.deepEqual(names(local), [SALON, 'booking-demo-v6:/:salon', 'slotbee-research', 'slotbee-live-key']);
});

// ---------- the values that stay with one tab ----------

test('the booking draft, the customer\'s own request and the reply drafts stay with their tab', async () => {
  assert.deepEqual([...PER_TAB_KEYS], ['draft', 'submittedRequest', 'conversationDrafts']);
  const { browser, tabA, tabB, a, b } = twoTabs();
  const emptyDraft = { serviceId: 'srv-2', employeeId: '', date: TODAY, startTime: '', name: '', phone: '' };
  let heardInB = 0;
  for (const key of PER_TAB_KEYS) b.listen(key, () => heardInB++);
  a.read('draft', emptyDraft);
  a.write('draft', { ...emptyDraft, name: 'Sandra Keller' });
  a.read<AppointmentRequest | null>('submittedRequest', null);
  a.write<AppointmentRequest | null>('submittedRequest', aRequest('req-own', '2026-10-08'));
  a.read<Record<string, string>>('conversationDrafts', {});
  a.write<Record<string, string>>('conversationDrafts', { 'conv-1': 'Guten Tag' });
  await settled();
  // Each is one entry in the tab's own storage, under the versioned key with the path ...
  assert.deepEqual(Array.from({ length: tabA.session.length }, (_, index) => tabA.session.key(index)).sort(),
    [demoStorageKey('conversationDrafts', '/'), demoStorageKey('draft', '/'), demoStorageKey('submittedRequest', '/')]);
  assert.equal(JSON.parse(tabA.session.getItem(demoStorageKey('draft', '/'))!).name, 'Sandra Keller');
  // ... and nothing of them is in the storage the tabs share, nor does typing change the salon.
  assert.deepEqual([...browser.stored.keys()], [SALON]);
  assert.deepEqual(storedSalon(browser), untouched(TODAY, MONDAY_NOON));
  // The other tab has its own.
  assert.equal(b.read('draft', emptyDraft).name, '');
  assert.equal(b.read<AppointmentRequest | null>('submittedRequest', null), null);
  assert.deepEqual(b.read<Record<string, string>>('conversationDrafts', {}), {});
  assert.equal(heardInB, 0);
  assert.equal(tabB.session.length, 0);
  // After a reload the tab finds its own again.
  const reloaded = storeFor(tabA, new ClockStandIn());
  assert.equal(reloaded.read('draft', emptyDraft).name, 'Sandra Keller');
  assert.equal(reloaded.read<AppointmentRequest | null>('submittedRequest', null)?.id, 'req-own');
  assert.deepEqual(reloaded.read<Record<string, string>>('conversationDrafts', {}), { 'conv-1': 'Guten Tag' });
});

// ---------- two tabs in step ----------

test('a change made in one tab shows in the other without a reload, and only where something changed', async () => {
  const { tabB, a, b } = twoTabs();
  const before = shown(b);
  const heard: string[] = [];
  for (const key of ['requests', 'calendarEvents', 'customers', 'companySettings', 'bookingHours']) b.listen(key, () => heard.push(key));
  const writesOfB = tabB.local.writes;
  // An open form in the other tab: what is typed into the booking form is that tab's own.
  const typed = { serviceId: 'srv-2', employeeId: 'emp-1', date: TODAY, startTime: '10:00', name: 'Sandra Ke', phone: '079' };
  b.read('draft', { ...typed, name: '', phone: '' });
  b.write('draft', typed);

  a.write<AppointmentRequest[]>('requests', (previous) => [aRequest('req-new', '2026-10-08'), ...previous]);
  await settled();
  const after = shown(b);
  assert.deepEqual(after.requests.map((item) => item.id), ['req-new', 'req-1']);
  // Only the part that changed is announced. The others keep the very object they had, so a
  // screen that shows them is not drawn again and a form that was filled from them keeps its text.
  assert.deepEqual(heard, ['requests']);
  assert.equal(after.settings, before.settings);
  assert.equal(after.events, before.events);
  assert.equal(after.customers, before.customers);
  assert.deepEqual(b.read('draft', typed), typed);
  // Taking over is silent: the other tab writes nothing back, so two tabs cannot keep each other busy.
  assert.equal(tabB.local.writes, writesOfB);
  let heardInA = 0;
  a.listen('requests', () => heardInA++);
  await settled();
  assert.equal(heardInA, 0);
});

test('what one action changes arrives together: the other tab never sees half of it', async () => {
  const { a, b } = twoTabs();
  const seen: Array<{ requests: string[]; events: string[] }> = [];
  const look = () => seen.push({ requests: shown(b).requests.map((item) => item.id), events: shown(b).events.map((item) => item.id) });
  b.listen('requests', look);
  b.listen('calendarEvents', look);
  // Accepting a request takes it off the list and adds its appointment.
  a.write<AppointmentRequest[]>('requests', (previous) => previous.filter((item) => item.id !== 'req-1'));
  a.write<CalendarEvent[]>('calendarEvents', (previous) => [anAppointment('cal-req-1', '2026-10-06'), ...previous]);
  await settled();
  assert.equal(seen.length, 2);
  for (const view of seen) assert.deepEqual(view, { requests: [], events: ['cal-req-1', 'cal-1'] });
});

test('a tab is told about the other tab\'s changes only: not about its own, and not about what was stored when it opened', async () => {
  const { browser, clock, a, b } = twoTabs();
  const told: string[] = [];
  const watch = (name: string, store: DemoStore) => store.watch<AppointmentRequest[]>('requests', (before, after) =>
    told.push(`${name}: ${before.map((item) => item.id).join()} -> ${after.map((item) => item.id).join()}`));
  watch('A', a);
  const stopB = watch('B', b);
  a.write<AppointmentRequest[]>('requests', (previous) => [aRequest('req-2', '2026-10-08'), ...previous]);
  await settled();
  assert.deepEqual(told, ['B: req-1 -> req-2,req-1']);
  // A tab opened afterwards finds the request stored and is told nothing.
  const c = storeFor(browser.openTab(), clock);
  watch('C', c);
  assert.deepEqual(shown(c).requests.map((item) => item.id), ['req-2', 'req-1']);
  assert.equal(told.length, 1);
  // A change to another part concerns nobody who watches the requests.
  a.write('companySettings', renamed('Coiffeur Keller'));
  await settled();
  assert.equal(told.length, 1);
  // Whoever has stopped watching hears no more.
  stopB();
  a.write<AppointmentRequest[]>('requests', []);
  await settled();
  assert.deepEqual(told.slice(1), ['C: req-2,req-1 -> ']);
});

test('two tabs that change different parts at the same moment both keep their change', async () => {
  const { browser, a, b } = twoTabs();
  // Neither tab has heard of the other's write yet when it stores its own.
  browser.holdEvents = true;
  a.write<AppointmentRequest[]>('requests', (previous) => [aRequest('req-new', '2026-10-08'), ...previous]);
  b.write('companySettings', renamed('Coiffeur Keller'));
  await settled();
  browser.deliver();
  for (const store of [a, b]) {
    assert.deepEqual(shown(store).requests.map((item) => item.id), ['req-new', 'req-1']);
    assert.equal(shown(store).settings.companyName, 'Coiffeur Keller');
  }
  const stored = storedSalon(browser)!;
  assert.deepEqual((stored.parts.requests as AppointmentRequest[]).map((item) => item.id), ['req-new', 'req-1']);
  assert.equal((stored.parts.companySettings as CompanySettingsData).companyName, 'Coiffeur Keller');
});

test('a tab that heard nothing while it slept catches up when it comes back to the front', async () => {
  const { tabB, a, b } = twoTabs();
  tabB.asleep = true;
  a.write('companySettings', renamed('Coiffeur Keller'));
  await settled();
  assert.equal(shown(b).settings.companyName, initialCompanySettings.companyName);
  tabB.asleep = false;
  let drawn = 0;
  b.listen('companySettings', () => drawn++);
  tabB.window.fire('visibilitychange');
  assert.equal(shown(b).settings.companyName, 'Coiffeur Keller');
  assert.equal(drawn, 1);
  // Nothing new since: coming to the front again changes nothing.
  tabB.window.fire('focus');
  tabB.window.fire('pageshow');
  assert.equal(drawn, 1);
});

test('a store that is closed stops listening and stores nothing more', async () => {
  const { browser, tabB, a, b } = twoTabs();
  assert.equal(tabB.window.listening('storage'), 1);
  b.close();
  for (const type of ['storage', 'visibilitychange', 'focus', 'pageshow']) assert.equal(tabB.window.listening(type), 0, type);
  a.write('companySettings', renamed('Coiffeur Keller'));
  await settled();
  assert.equal(shown(b).settings.companyName, initialCompanySettings.companyName);
  b.write('companySettings', renamed('From the closed tab'));
  await settled();
  assert.equal((storedSalon(browser)!.parts.companySettings as CompanySettingsData).companyName, 'Coiffeur Keller');
});

// ---------- a new day ----------

test('on a new day a salon that nobody has changed is built again for today', () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  shown(storeFor(browser.openTab(), clock));
  assert.equal(storedSalon(browser)?.day, TODAY);
  // Later the same day nothing is built again: a second tab shows the very same salon.
  clock.set('2026-10-05T16:00:00Z');
  const sameDay = storeFor(browser.openTab(), clock);
  assert.equal(sameDay.builtAt.toISOString(), FIXED_NOW.toISOString());
  clock.set(TOMORROW_MORNING);
  const nextDay = storeFor(browser.openTab(), clock);
  // (When the salon was last reset is not touched by a new day.)
  assert.deepEqual(storedSalon(browser), untouched('2026-10-06', TUESDAY_MORNING, MONDAY_NOON));
  // Everything is built for the new day, together: the request for the day after, the appointment for the day itself.
  assert.deepEqual(shown(nextDay).requests.map((item) => item.date), ['2026-10-07']);
  assert.deepEqual(shown(nextDay).events.map((item) => item.date), ['2026-10-06']);

  // The day is the salon's, not the browser's: 23:59 in Zurich is still Monday, midnight is Tuesday.
  const dayAfterOpeningAt = (moment: string): string => {
    const night = new BrowserStandIn();
    const nightClock = new ClockStandIn();
    storeFor(night.openTab(), nightClock);
    nightClock.set(moment);
    return storeFor(night.openTab(), nightClock).day;
  };
  assert.equal(dayAfterOpeningAt('2026-10-05T21:59:00Z'), TODAY);
  assert.equal(dayAfterOpeningAt('2026-10-05T22:00:00Z'), '2026-10-06');
});

test('on a new day a salon in which anything was changed stays exactly as it was left', async () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const monday = storeFor(browser.openTab(), clock);
  shown(monday);
  // One change is enough, to any part: here only the salon's name.
  monday.write('companySettings', renamed('Coiffeur Keller'));
  await settled();
  const left = browser.stored.get(SALON);
  clock.set(TOMORROW_MORNING);
  const tuesday = storeFor(browser.openTab(), clock);
  assert.equal(tuesday.day, TODAY);
  assert.equal(tuesday.builtAt.toISOString(), FIXED_NOW.toISOString());
  const view = shown(tuesday);
  assert.equal(view.settings.companyName, 'Coiffeur Keller');
  // All or nothing: the parts nobody touched are Monday's too, not built again for Tuesday.
  assert.deepEqual(view.requests.map((item) => item.date), ['2026-10-06']);
  assert.deepEqual(view.events.map((item) => item.date), [TODAY]);
  assert.equal(browser.stored.get(SALON), left);
  // Weeks later it is still the same salon.
  clock.set('2026-11-19T09:00:00Z');
  assert.deepEqual(shown(storeFor(browser.openTab(), clock)).events.map((item) => item.date), [TODAY]);
});

test('a tab left open overnight starts the new day when it comes back to the front, unless something was changed', async () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const tab = browser.openTab();
  const store = storeFor(tab, clock);
  shown(store);
  const heard: string[] = [];
  const told: string[] = [];
  for (const key of ['requests', 'calendarEvents', 'customers', 'companySettings']) store.listen(key, () => heard.push(key));
  store.watch('requests', () => told.push('requests'));
  tab.window.fire('focus');
  assert.deepEqual(heard, []);
  clock.set(TOMORROW_MORNING);
  tab.window.fire('visibilitychange');
  // The parts that depend on the day are built again and drawn again; the others say the same and are left alone.
  assert.deepEqual(heard.sort(), ['calendarEvents', 'requests']);
  assert.deepEqual(shown(store).requests.map((item) => item.date), ['2026-10-07']);
  assert.equal(storedSalon(browser)?.day, '2026-10-06');
  // That is no change by another tab: nobody is told that a request arrived.
  assert.deepEqual(told, []);

  // Changed today, the salon stays when the next day comes.
  store.write('companySettings', renamed('Coiffeur Keller'));
  await settled();
  heard.length = 0;
  clock.set('2026-10-07T07:00:00Z');
  tab.window.fire('focus');
  assert.deepEqual(heard, []);
  assert.equal(store.day, '2026-10-06');
  assert.deepEqual(shown(store).requests.map((item) => item.date), ['2026-10-07']);
});

test('when another tab starts the new day, an open tab follows, and parts of two days are never mixed', async () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const old = storeFor(browser.openTab(), clock);
  shown(old);
  const told: string[] = [];
  old.watch('requests', () => told.push('requests'));
  old.read('draft', { name: '' });
  old.write('draft', { name: 'Sandra Ke' });
  await settled();
  clock.set(TOMORROW_MORNING);
  // The other tab is opened on Tuesday and builds the salon again. The old tab has not heard of it
  // when the owner changes something there, on Monday's data.
  browser.holdEvents = true;
  const fresh = storeFor(browser.openTab(), clock);
  old.write<AppointmentRequest[]>('requests', (previous) => [aRequest('req-on-monday', '2026-10-06'), ...previous]);
  await settled();
  browser.deliver();
  // The change belonged to Monday's salon and goes with it: both tabs show Tuesday's, all of it.
  for (const store of [old, fresh]) {
    assert.equal(store.day, '2026-10-06');
    assert.deepEqual(shown(store).requests.map((item) => [item.id, item.date]), [['req-1', '2026-10-07']]);
    assert.deepEqual(shown(store).events.map((item) => item.date), ['2026-10-06']);
  }
  assert.deepEqual(storedSalon(browser), untouched('2026-10-06', TUESDAY_MORNING, MONDAY_NOON));
  // A salon that started again is no request that arrived.
  assert.deepEqual(told, []);
  // A new day is no reset: what the old tab kept for itself (a booking that is being filled in) stays.
  assert.equal(old.read('draft', { name: '' }).name, 'Sandra Ke');
});

// ---------- the checks per part ----------

test('the data a salon starts with pass the checks, and so do fields a newer build adds', () => {
  const parts: Record<string, unknown> = {
    requests: demoRequests, calendarEvents: demoEvents, customers: demoCustomers, conversations: demoConversations, shifts: demoShifts,
    employees: initialEmployees, services: initialServices, companySettings: initialCompanySettings, bookingHours: initialBookingHours,
    aiSettings: initialAiSettings, closedDates: [{ id: 'closed-1', name: 'Team day', start: '2026-10-07', end: '2026-10-08' }],
    absences: [{ id: 'abs-1', employeeId: 'emp-2', start: '2026-10-09', end: '2026-10-09', reason: 'Course' }],
    requestAnswers: [
      { kind: 'request', id: 'req-1', outcome: 'accepted', at: 1790000000000, request: demoRequests[0], index: 0 },
      { kind: 'chat', id: 'live-web-1', at: 1790000000000, appointmentId: 'cal-live-1', customerName: 'Tom', serviceName: 'Haircut', staffName: 'Anna Weber', date: '2026-10-08', startTime: '10:00', endTime: '10:30', delivery: 'done' },
    ],
    requestOutcomes: { 'req-1': 'accepted', 'req-2': 'rejected' },
    draft: { serviceId: 'srv-2', employeeId: '', date: '', startTime: '', name: '', phone: '', dateChosen: false },
    submittedRequest: null, conversationDrafts: { 'conv-camille': 'Bonjour' },
  };
  for (const [key, value] of Object.entries(parts)) assert.equal(storedShapeProblem(key, value), null, key);
  assert.equal(storedShapeProblem('submittedRequest', demoRequests[0]), null);
  // What comes back from the storage is what JSON makes of it.
  for (const [key, value] of Object.entries(parts)) assert.equal(storedShapeProblem(key, JSON.parse(JSON.stringify(value))), null, key);
  // Fields the checks do not know are not looked at: weekly hours on a person, a note on a customer.
  const weeklyHours = { mon: null, tue: { start: '08:30', end: '17:00' } };
  assert.equal(storedShapeProblem('employees', initialEmployees.map((employee) => ({ ...employee, weeklyHours }))), null);
  assert.equal(storedShapeProblem('customers', demoCustomers.map((customer) => ({ ...customer, note: 'Prefers mornings' }))), null);
  assert.equal(storedShapeProblem('companySettings', { ...initialCompanySettings, industry: 'Hair & Beauty' }), null);
  // An optional field may be missing or empty.
  assert.equal(storedShapeProblem('requests', [{ ...demoRequests[0], customerPhone: null, createdAt: undefined }]), null);
  // A key the checks do not know (another screen's own value) is used as it is.
  assert.equal(storedShapeProblem('somethingNew', { any: ['thing'] }), null);
});

test('a part of the wrong shape is found, with the place where it is wrong', () => {
  const request = demoRequests[0];
  const event = demoEvents[0];
  const wrong: Array<[string, unknown, string]> = [
    ['requests', 'none', 'requests is not a list'],
    ['requests', [request, { ...request, date: '08.10.2026' }], 'requests[1].date is not a date'],
    ['requests', [{ ...request, date: '2026-13-40' }], 'requests[0].date is not a date'],
    ['requests', [{ ...request, status: 'open' }], 'requests[0].status is none of pending, accepted, rejected, cancelled'],
    ['requests', [{ ...request, customerPhone: 791234567 }], 'requests[0].customerPhone is not a text'],
    ['requests', [null], 'requests[0] is not a record'],
    ['calendarEvents', [{ ...event, startTime: '9 o\'clock' }], 'calendarEvents[0].startTime is not a time'],
    ['calendarEvents', [{ ...event, customerName: undefined }], 'calendarEvents[0].customerName is not a text'],
    ['calendarEvents', { 0: event }, 'calendarEvents is not a list'],
    // A time that is no moment would throw as soon as a screen writes it as the salon's time.
    ['calendarEvents', [{ ...event, createdAt: 'last week' }], 'calendarEvents[0].createdAt is not a moment in time'],
    ['conversations', [{ ...demoConversations[0], lastMessageAt: 'yesterday evening' }], 'conversations[0].lastMessageAt is not a moment in time'],
    ['customers', [demoCustomers[0], { id: 'cust-x' }], 'customers[1].name is not a text'],
    ['employees', [{ ...initialEmployees[0], canBookOnline: 'yes' }], 'employees[0].canBookOnline is not yes or no'],
    ['services', [{ ...initialServices[0], durationMinutes: '30' }], 'services[0].durationMinutes is not a number'],
    ['services', [{ ...initialServices[0], assignedEmployeeIds: ['emp-1', 2] }], 'services[0].assignedEmployeeIds[1] is not a text'],
    ['shifts', [{ ...demoShifts[0], shifts: { '2026-10-06': { start: '08:30' } } }], 'shifts[0].shifts.2026-10-06.end is not a time'],
    ['conversations', [{ ...demoConversations[0], messages: [{ id: 'm1', sender: 'robot', original: '', translation: '', time: '' }] }], 'conversations[0].messages[0].sender is none of customer, ai, owner'],
    ['companySettings', { ...initialCompanySettings, customTerms: 'no' }, 'companySettings.customTerms is not yes or no'],
    ['companySettings', [], 'companySettings is not a record'],
    ['bookingHours', [{ day: 'Monday', isOpen: true, from: '8', to: '18:30' }], 'bookingHours[0].from is not a time'],
    ['closedDates', [{ id: 'c', name: 'Team day', start: '2026-10-07' }], 'closedDates[0].end is not a date'],
    ['aiSettings', { ...initialAiSettings, handoverRules: [{ id: 'r1', label: 'Discounts' }] }, 'aiSettings.handoverRules[0].enabled is not yes or no'],
    ['requestAnswers', [{ kind: 'request', id: 'req-1', outcome: 'postponed', at: 1, request, index: 0 }], 'requestAnswers[0].outcome is none of accepted, moved, rejected'],
    ['requestOutcomes', { 'req-1': 'maybe' }, 'requestOutcomes.req-1 is none of accepted, rejected'],
    ['draft', { serviceId: 'srv-2' }, 'draft.employeeId is not a text'],
    ['submittedRequest', 'req-1', 'submittedRequest is not a record'],
    ['conversationDrafts', { 'conv-1': 5 }, 'conversationDrafts.conv-1 is not a text'],
  ];
  for (const [key, value, problem] of wrong) assert.equal(storedShapeProblem(key, value), problem);
});

/** Stores a salon by hand, as an earlier page load (or a fault) could have left it. */
const leave = (browser: BrowserStandIn, parts: Record<string, unknown>, head: Partial<{ day: string; builtAt: string; changed: boolean }> = {}) =>
  browser.stored.set(SALON, JSON.stringify({ day: TODAY, builtAt: FIXED_NOW.toISOString(), changed: true, ...head, parts }));
const leftByTheOwner = () => ({
  requests: [aRequest('req-kept', '2026-10-08')],
  calendarEvents: [anAppointment('cal-kept', '2026-10-09')],
  customers: someCustomers,
  companySettings: { ...initialCompanySettings, companyName: 'Coiffeur Keller' },
  bookingHours: initialBookingHours.map((day) => ({ ...day, isOpen: true })),
});

test('a part that stands alone and has the wrong shape falls back alone; everything else stays', () => {
  assert.deepEqual([...STANDALONE_PARTS].sort(), ['aiSettings', 'bookingHours', 'closedDates', 'companySettings']);
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  leave(browser, { ...leftByTheOwner(), companySettings: { ...initialCompanySettings, customTerms: 'no' } });
  clock.set(TOMORROW_MORNING);
  const reports: string[] = [];
  const store = storeFor(browser.openTab(), clock, reports);
  const view = shown(store);
  assert.deepEqual(reports, ['Stored data were not used: companySettings.customTerms is not yes or no.']);
  // The salon's profile is the starting one again ...
  assert.deepEqual(view.settings, initialCompanySettings);
  // ... and the rest is as the owner left it, still Monday's salon.
  assert.deepEqual(view.requests.map((item) => item.id), ['req-kept']);
  assert.deepEqual(view.events.map((item) => item.id), ['cal-kept']);
  assert.equal(view.hours.every((day) => day.isOpen), true);
  assert.equal(store.day, TODAY);
  assert.equal(store.changed, true);
});

test('a linked part of the wrong shape takes all linked parts with it, so that no two of them disagree', () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  // One appointment has no date. The requests and customers next to it are fine.
  leave(browser, { ...leftByTheOwner(), calendarEvents: [anAppointment('cal-kept', '2026-10-09'), { ...anAppointment('cal-bad', '2026-10-09'), date: 'soon' }] });
  clock.set(TOMORROW_MORNING);
  const reports: string[] = [];
  const store = storeFor(browser.openTab(), clock, reports);
  const view = shown(store);
  assert.deepEqual(reports, ['Stored data were not used: calendarEvents[1].date is not a date.']);
  // Calendar, requests and customers start again together, built for today: none of them is from
  // the day the owner left the salon, so a request cannot wait next to a calendar it was not made for.
  assert.deepEqual(view.events, startingEvents(new Date(TOMORROW_MORNING)));
  assert.deepEqual(view.requests, startingRequests(new Date(TOMORROW_MORNING)));
  assert.equal(view.customers, someCustomers);
  assert.equal(store.day, '2026-10-06');
  // What stands alone is kept: the salon's name and its opening hours.
  assert.equal(view.settings.companyName, 'Coiffeur Keller');
  assert.equal(view.hours.every((day) => day.isOpen), true);
  // The storage holds the same, so a second tab agrees: the bad part is gone, the new day is noted.
  const stored = storedSalon(browser)!;
  assert.deepEqual(Object.keys(stored.parts).sort(), ['bookingHours', 'companySettings']);
  assert.equal(stored.day, '2026-10-06');
  assert.equal(stored.changed, true);
  const second = shown(storeFor(browser.openTab(), clock));
  assert.deepEqual(second.requests, view.requests);
  assert.equal(second.settings.companyName, 'Coiffeur Keller');
});

test('with nothing of the owner\'s left after such a start, the salon counts as unchanged again', () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  leave(browser, { requests: [{ id: 'req-bad' }], customers: someCustomers });
  clock.set('2026-10-05T16:00:00Z');
  const store = storeFor(browser.openTab(), clock);
  // Built again for the moment it was found; that is no reset by hand.
  assert.deepEqual(storedSalon(browser), untouched(TODAY, '2026-10-05T16:00:00.000Z', MONDAY_NOON));
  assert.deepEqual(shown(store).requests, startingRequests(new Date('2026-10-05T16:00:00Z')));
});

test('a stored salon that cannot be read at all is replaced by a new one', () => {
  for (const unreadable of ['{"day":"2026-10-05","parts":', 'null', '[]', '"salon"', JSON.stringify({ day: 'Monday', builtAt: FIXED_NOW.toISOString(), changed: true, parts: {} }),
    JSON.stringify({ day: TODAY, builtAt: 'this morning', changed: true, parts: {} }), JSON.stringify({ day: TODAY, builtAt: FIXED_NOW.toISOString(), changed: true, parts: [] })]) {
    const browser = new BrowserStandIn();
    browser.stored.set(SALON, unreadable);
    const reports: string[] = [];
    const store = storeFor(browser.openTab(), new ClockStandIn(), reports);
    assert.deepEqual(reports, ['The stored salon could not be read.'], unreadable);
    assert.deepEqual(shown(store).requests, startingRequests(FIXED_NOW));
    assert.deepEqual(storedSalon(browser), untouched(TODAY, MONDAY_NOON));
  }
  assert.equal(readStoredSalon(null), null);
});

test('a value of the wrong shape that one tab kept for itself is not used', async () => {
  const browser = new BrowserStandIn();
  const tab = browser.openTab();
  tab.session.setItem(demoStorageKey('draft', '/'), '{"serviceId":7}');
  tab.session.setItem(demoStorageKey('submittedRequest', '/'), '{"id":"req-1"');
  tab.session.setItem(demoStorageKey('conversationDrafts', '/'), JSON.stringify({ 'conv-1': 'Guten Tag' }));
  const reports: string[] = [];
  const store = storeFor(tab, new ClockStandIn(), reports);
  const emptyDraft = { serviceId: 'srv-2', employeeId: '', date: TODAY, startTime: '', name: '', phone: '' };
  assert.equal(store.read('draft', emptyDraft), emptyDraft);
  assert.equal(store.read<AppointmentRequest | null>('submittedRequest', null), null);
  // Each stands alone: the reply drafts next to them are fine and are used.
  assert.deepEqual(store.read<Record<string, string>>('conversationDrafts', {}), { 'conv-1': 'Guten Tag' });
  assert.deepEqual(reports, ['Stored data were not used: draft.serviceId is not a text.', 'Stored data were not used: submittedRequest could not be read.']);
  // The next change replaces what was there.
  store.write('draft', { ...emptyDraft, name: 'Sandra Keller' });
  await settled();
  assert.equal(JSON.parse(tab.session.getItem(demoStorageKey('draft', '/'))!).name, 'Sandra Keller');
});

test('a tab does not take over a salon with a broken linked part from another tab, and its next change repairs the storage', async () => {
  const { browser, tabA, a, b } = twoTabs();
  a.write('companySettings', renamed('Coiffeur Keller'));
  await settled();
  const good = shown(b);
  // Something writes a calendar that cannot be used (a fault in another tab, a hand in the developer tools).
  const broken = storedSalon(browser)!;
  tabA.local.setItem(SALON, JSON.stringify({ ...broken, parts: { ...broken.parts, calendarEvents: [{ id: 'cal-x' }], requests: [] } }));
  assert.equal(shown(b).events, good.events);
  assert.equal(shown(b).requests, good.requests);
  // The tab that still holds the good salon stores all of it with its next change.
  b.write<AppointmentRequest[]>('requests', (previous) => [aRequest('req-new', '2026-10-08'), ...previous]);
  await settled();
  const repaired = storedSalon(browser)!;
  assert.deepEqual(repaired.parts.calendarEvents, startingEvents(FIXED_NOW));
  assert.deepEqual((repaired.parts.requests as AppointmentRequest[]).map((item) => item.id), ['req-new', 'req-1']);
  assert.equal((repaired.parts.companySettings as CompanySettingsData).companyName, 'Coiffeur Keller');
});

test('from another tab\'s salon a part that stands alone and is broken is left out; the rest is taken over', async () => {
  const { browser, tabA, a, b } = twoTabs();
  a.write('companySettings', renamed('Coiffeur Keller'));
  await settled();
  const stored = storedSalon(browser)!;
  // The other tab stores a new request together with a salon profile that cannot be used.
  tabA.local.setItem(SALON, JSON.stringify({ ...stored, parts: { ...stored.parts, companySettings: { companyName: 7 }, requests: [aRequest('req-new', '2026-10-08')] } }));
  assert.deepEqual(shown(b).requests.map((item) => item.id), ['req-new']);
  assert.equal(shown(b).settings.companyName, 'Coiffeur Keller');
});

test('a part the checks do not know is stored and shared like the others', async () => {
  const { browser, clock, a, b } = twoTabs();
  a.read('teamNotes', ['first']);
  b.read('teamNotes', ['first']);
  a.write<string[]>('teamNotes', (previous) => [...previous, 'second']);
  await settled();
  assert.deepEqual(b.read('teamNotes', ['first']), ['first', 'second']);
  assert.deepEqual(storeFor(browser.openTab(), clock).read('teamNotes', ['first']), ['first', 'second']);
});

// ---------- the reset ----------

test('the reset clears the stored salon and what the tab kept for itself, and every open tab starts fresh', async () => {
  const { browser, clock, tabA, tabB, a, b } = twoTabs();
  const emptyDraft = { serviceId: 'srv-2', employeeId: '', date: TODAY, startTime: '', name: '', phone: '' };
  a.read('draft', emptyDraft);
  a.write('draft', { ...emptyDraft, name: 'Sandra Keller' });
  a.write<AppointmentRequest[]>('requests', []);
  a.write<CalendarEvent[]>('calendarEvents', (previous) => [anAppointment('cal-req-1', '2026-10-06'), ...previous]);
  b.read('draft', emptyDraft);
  b.write('draft', { ...emptyDraft, name: 'Typed in the other tab' });
  await settled();
  assert.equal(storedSalon(browser)?.changed, true);
  assert.deepEqual(shown(b).requests, []);

  const heardInA: string[] = [];
  const heardInB: string[] = [];
  const toldInB: string[] = [];
  for (const key of ['requests', 'calendarEvents', 'companySettings', 'draft']) {
    a.listen(key, () => heardInA.push(key));
    b.listen(key, () => heardInB.push(key));
  }
  b.watch('requests', () => toldInB.push('requests'));
  clock.set('2026-10-05T14:00:00Z');
  a.reset();
  // The salon starts again, built for the moment of the reset, and nothing of it counts as changed.
  assert.deepEqual(storedSalon(browser), untouched(TODAY, '2026-10-05T14:00:00.000Z'));
  assert.equal(tabA.session.length, 0);
  assert.deepEqual(heardInA.sort(), ['calendarEvents', 'draft', 'requests']);
  assert.deepEqual(shown(a).requests.map((item) => item.id), ['req-1']);
  assert.deepEqual(shown(a).events.map((item) => item.id), ['cal-1']);
  assert.equal(a.read('draft', emptyDraft).name, '');
  // The other open tab follows at once, to the same salon ...
  assert.deepEqual(shown(b).requests, shown(a).requests);
  assert.equal(b.builtAt.toISOString(), '2026-10-05T14:00:00.000Z');
  // ... and starts fresh as well: what it kept for itself is cleared too, so nothing of the
  // session before is left in any tab (a name typed into the booking form, for example).
  assert.deepEqual(heardInB.sort(), ['calendarEvents', 'draft', 'requests']);
  assert.equal(b.read('draft', emptyDraft).name, '');
  assert.equal(tabB.session.length, 0);
  // It is not told that requests arrived: a fresh salon is no arrival.
  assert.deepEqual(toldInB, []);
  // A tab opened afterwards starts from the same fresh salon, and what was reset never comes back.
  await settled();
  assert.deepEqual(shown(storeFor(browser.openTab(), clock)).events.map((item) => item.id), ['cal-1']);
  assert.equal(storedSalon(browser)?.changed, false);
});

// ---------- storage that is blocked ----------

test('where the browser blocks storage the salon lives in memory, as before', async () => {
  for (const blocked of [null, blockedStorage]) {
    const clock = new ClockStandIn();
    const reports: string[] = [];
    const store = new DemoStore({ prefix: PREFIX, lasting: blocked, tab: blocked, perTabKeys: PER_TAB_KEYS, now: clock.now, report: (message) => reports.push(message) });
    let drawn = 0;
    store.listen('requests', () => drawn++);
    assert.deepEqual(shown(store).requests.map((item) => item.id), ['req-1']);
    store.write<AppointmentRequest[]>('requests', (previous) => [aRequest('req-new', '2026-10-08'), ...previous]);
    store.read('draft', { name: '' });
    store.write('draft', { name: 'Sandra Keller' });
    await settled();
    // Every screen of the page reads the same values; they last until the page is loaded again.
    assert.deepEqual(shown(store).requests.map((item) => item.id), ['req-new', 'req-1']);
    assert.equal(store.read('draft', { name: '' }).name, 'Sandra Keller');
    assert.equal(drawn, 1);
    assert.equal(store.changed, true);
    // Coming back to the front and the reset work without a storage too.
    store.refresh();
    store.reset();
    assert.deepEqual(shown(store).requests.map((item) => item.id), ['req-1']);
    assert.equal(store.read('draft', { name: '' }).name, '');
    assert.deepEqual(reports, []);
  }
});

test('a storage that is full keeps the old salon; the tab goes on in memory and tries again with the next change', async () => {
  const browser = new BrowserStandIn();
  const tab = browser.openTab();
  let full = false;
  const lasting = {
    getItem: (key: string) => tab.local.getItem(key),
    removeItem: (key: string) => tab.local.removeItem(key),
    setItem: (key: string, value: string) => { if (full) throw new Error('QuotaExceededError'); tab.local.setItem(key, value); },
  };
  const store = new DemoStore({ prefix: PREFIX, lasting, tab: tab.session, perTabKeys: PER_TAB_KEYS, now: new ClockStandIn().now });
  shown(store);
  full = true;
  store.write('companySettings', renamed('Coiffeur Keller'));
  await settled();
  assert.equal(storedSalon(browser)?.changed, false);
  assert.equal(shown(store).settings.companyName, 'Coiffeur Keller');
  full = false;
  store.write<AppointmentRequest[]>('requests', []);
  await settled();
  assert.equal((storedSalon(browser)!.parts.companySettings as CompanySettingsData).companyName, 'Coiffeur Keller');
  assert.deepEqual(storedSalon(browser)!.parts.requests, []);
});

// ---------- through the app's own hook ----------

test('useDemoState reads the stored salon and the tab\'s own values when a screen is first drawn', () => {
  const browser = new BrowserStandIn();
  const tab = browser.openTab();
  leave(browser, leftByTheOwner());
  tab.session.setItem(demoStorageKey('conversationDrafts', '/'), JSON.stringify({ 'conv-1': 'Guten Tag' }));
  let seen: { name: string; requests: string[]; events: string[]; drafts: Record<string, string>; services: number } | undefined;
  const Screen = () => {
    const [settings] = useDemoState('companySettings', initialCompanySettings);
    const [requests] = useDemoState('requests', startingRequests);
    const [events] = useDemoState('calendarEvents', startingEvents);
    const [drafts] = useDemoState<Record<string, string>>('conversationDrafts', {});
    // Nothing is stored for the services: they have their starting value.
    const [services] = useDemoState('services', initialServices);
    seen = { name: settings.companyName, requests: requests.map((item) => item.id), events: events.map((item) => item.id), drafts, services: services.length };
    return null;
  };
  inTab(tab, () => render(React.createElement(Screen)));
  assert.deepEqual(seen, { name: 'Coiffeur Keller', requests: ['req-kept'], events: ['cal-kept'], drafts: { 'conv-1': 'Guten Tag' }, services: initialServices.length });
});

test('useDemoState hands the starting data the moment the stored salon was started, the same in every tab', () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const built: string[] = [];
  const Screen = ({ tab }: { tab: string }) => {
    useDemoState('requests', (builtAt) => { built.push(`${tab} tab: ${builtAt.toISOString()}`); return startingRequests(builtAt); });
    return null;
  };
  const draw = (tab: string) => inTab(browser.openTab(), () => render(React.createElement(Screen, { tab })), clock);
  draw('first');
  // A second tab, hours later: the same moment, so the same starting data.
  clock.set('2026-10-05T16:00:00Z');
  draw('second');
  // The next day a third tab builds the untouched salon again, and the tab that is still open follows.
  clock.set(TOMORROW_MORNING);
  draw('third');
  assert.deepEqual(built, [
    `first tab: ${FIXED_NOW.toISOString()}`,
    `second tab: ${FIXED_NOW.toISOString()}`,
    'second tab: 2026-10-06T07:00:00.000Z',
    'third tab: 2026-10-06T07:00:00.000Z',
  ]);
});

test('the page has one store: a watcher and the reset meet the values the screens show', async () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const tab: TabStandIn = browser.openTab();
  const other = storeFor(browser.openTab(), clock);
  shown(other);
  const told: string[] = [];
  let setRequests: React.Dispatch<React.SetStateAction<AppointmentRequest[]>> | undefined;
  let setDraft: React.Dispatch<React.SetStateAction<{ name: string }>> | undefined;
  const Screen = () => {
    setRequests = useDemoState('requests', startingRequests)[1];
    setDraft = useDemoState('draft', { name: '' })[1];
    return null;
  };
  inTab(tab, () => {
    render(React.createElement(Screen));
    watchDemoState<AppointmentRequest[]>('requests', (before, after) => told.push(`${before.length} -> ${after.length}`));
  }, clock);
  setDraft!({ name: 'Sandra Keller' });
  await settled();
  assert.equal(JSON.parse(tab.session.getItem(demoStorageKey('draft', '/'))!).name, 'Sandra Keller');
  // The other tab adds a request: the page's watcher is told.
  other.write<AppointmentRequest[]>('requests', (previous) => [aRequest('req-new', '2026-10-08'), ...previous]);
  await settled();
  assert.deepEqual(told, ['1 -> 2']);
  // The page's own change is stored for the other tab, and the page's watcher is not told about it.
  setRequests!((previous) => previous.filter((item) => item.id !== 'req-1'));
  await settled();
  assert.deepEqual(shown(other).requests.map((item) => item.id), ['req-new']);
  assert.equal(told.length, 1);
  // The reset of the page clears both storages for every tab.
  inTab(tab, () => resetDemoState(), clock);
  assert.equal(storedSalon(browser)?.changed, false);
  assert.equal(tab.session.length, 0);
  assert.deepEqual(shown(other).requests.map((item) => item.id), ['req-1']);
});
