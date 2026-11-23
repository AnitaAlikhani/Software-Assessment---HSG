import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { initialAiSettings } from '../src/conversationData';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData';
import { createDemoShifts } from '../src/demoSeed';
import { earlierNotSavedText, SALON_TEXTS, SHARED_PARTS, SharedSalon, salonRequestWith, type SalonStatus } from '../src/sharedSalon';
import type { AppointmentRequest, CompanySettingsData, Employee, ServiceItem } from '../src/types';
import { forgetSalonOnServerForTests, salonStorageKey, useDemoState, whenSaved } from '../src/useDemoState';
import { BrowserStandIn, ClockStandIn, inTab, storeFor } from './browserStandIn';
import { FIXED_NOW } from './fixedClock';
import { render } from './renderHelpers';
import { SalonRoutesStandIn, TabsStandIn } from './salonRoutesStandIn';

// A device signed in with the owner's key shows the salon's settings from the server and sends
// the owner's changes there (src/sharedSalon.ts). These tests run it against an in-memory stand-in
// of the routes (tests/salonRoutesStandIn.ts): no network, no real clock.

/** Lets every answer and every queued step run. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const starting: Record<string, unknown> = {
  companySettings: initialCompanySettings, services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours,
  closedDates: [], absences: [], shifts: (builtAt: Date) => createDemoShifts(undefined, builtAt), aiSettings: initialAiSettings,
};

/** One device: a salon on the server and the screens that read every shared part, as App does. */
function device(server: SalonRoutesStandIn, tabs?: TabsStandIn, reports: string[] = []) {
  const salon = new SharedSalon({ request: server.request, builtAt: () => FIXED_NOW, tabs: tabs?.open() ?? null, now: () => 1000, report: (m) => reports.push(m) });
  const read = <T,>(key: string) => salon.read<T>(key, starting[key] as T);
  for (const key of SHARED_PARTS) read(key);
  const services = () => read<ServiceItem[]>('services');
  const settings = () => read<CompanySettingsData>('companySettings');
  return { salon, read, services, settings };
}
const renamed = (name: string) => (previous: CompanySettingsData): CompanySettingsData => ({ ...previous, companyName: name });
const priced = (id: string, price: number) => (previous: ServiceItem[]) => previous.map((item) => item.id === id ? { ...item, priceCHF: price } : item);
const firstService = initialServices[0];

async function ready(server = new SalonRoutesStandIn(), tabs?: TabsStandIn) {
  const one = device(server, tabs);
  await one.salon.begin(server.key);
  return { server, ...one };
}

// ---------- the start ----------

test('the start loads the record; a part the record lacks is the built-in one, never what the browser had', async () => {
  const server = new SalonRoutesStandIn();
  server.saveElsewhere({ companySettings: { ...initialCompanySettings, companyName: 'Salon Rosa' } });
  const { salon, settings, services, read } = device(server);
  const loading = salon.begin(server.key);
  assert.equal(salon.current.phase, 'loading');
  // While loading, the shared parts are the built-in ones (the app shows "Loading your salon…" over them).
  assert.equal(settings().companyName, initialCompanySettings.companyName);
  await loading;
  assert.equal(salon.current.phase, 'ready');
  assert.equal(settings().companyName, 'Salon Rosa');
  assert.equal(services(), initialServices);
  assert.deepEqual(read('closedDates'), []);
  assert.equal(salon.revision, 1);
  // Loading sent nothing but the one GET.
  assert.deepEqual(server.log.map((item) => item.method), ['GET']);
});

test('a record that cannot be loaded says why; "Try again" loads it; a static copy without a server is the browser\'s salon', async () => {
  const server = new SalonRoutesStandIn();
  const { salon } = device(server);
  server.failNext = [null];
  await salon.begin(server.key);
  assert.equal(salon.current.phase, 'failed');
  assert.equal(salon.current.loadError, SALON_TEXTS.loadFailed);
  await salon.retryLoad();
  assert.equal(salon.current.phase, 'ready');

  server.failNext = [{ status: 429, error: 'Too many wrong access keys were sent from this connection. Please wait 10 minutes and try again.' }];
  await salon.begin(server.key);
  assert.equal(salon.current.phase, 'failed');
  assert.match(salon.current.loadError!, /Please wait 10 minutes/);

  await salon.begin('an old key');
  assert.equal(salon.current.phase, 'failed');
  assert.equal(salon.current.loadError, SALON_TEXTS.keyRefused);

  server.failNext = [{ status: 404 }];
  await salon.begin(server.key);
  assert.equal(salon.current.phase, 'local');
  assert.equal(salon.serves('services'), false);
});

test('a part of a shape the app cannot use is left out and reported: the built-in one shows', async () => {
  const server = new SalonRoutesStandIn();
  server.saveElsewhere({ services: [{ id: 'x', name: 3 }] });
  const reports: string[] = [];
  const one = device(server, undefined, reports);
  await one.salon.begin(server.key);
  assert.equal(one.services(), initialServices);
  assert.match(reports.join(' '), /services/);
});

// ---------- changes ----------

test('a change shows at once, is sent once, and nothing is sent for reading or for a change that changes nothing', async () => {
  const { server, salon, services } = await ready();
  salon.write('services', (previous: ServiceItem[]) => previous);
  salon.write('services', initialServices.map((item) => ({ ...item })));
  await settled();
  assert.equal(server.count('PUT'), 0);
  salon.write('services', priced(firstService.id, 99));
  assert.equal(services()[0].priceCHF, 99);
  assert.equal(salon.current.saving, true);
  await settled();
  assert.equal(server.count('PUT'), 1);
  assert.deepEqual(server.puts[0], { baseRev: 0, parts: { services: services() } });
  assert.equal(salon.current.saving, false);
  assert.equal(salon.current.savedAt, 1000);
  assert.equal(salon.revision, 1);
  assert.equal(server.record?.rev, 1);
});

test('nothing can be changed or sent before the record is there, and a part that is not shared is not handled here', async () => {
  const server = new SalonRoutesStandIn();
  const { salon, services } = device(server);
  server.hold = true;
  const loading = salon.begin(server.key);
  salon.write('services', priced(firstService.id, 1));
  salon.write('calendarEvents', []);
  assert.equal(services(), initialServices);
  server.release();
  await loading;
  await settled();
  assert.equal(server.count('PUT'), 0);
  assert.equal(salon.serves('calendarEvents'), false);
  assert.equal(salon.serves('services'), true);
});

test('quick changes to one part wait for the one on its way; the last wins and none is lost or sent twice', async () => {
  const { server, salon, services } = await ready();
  server.hold = true;
  salon.write('services', priced(firstService.id, 10));
  await settled();
  assert.equal(server.count('PUT'), 1);
  salon.write('services', priced(firstService.id, 20));
  await settled();
  salon.write('services', (previous: ServiceItem[]) => previous.map((item) => item.id === initialServices[1].id ? { ...item, name: 'Fringe' } : item));
  await settled();
  // Still one on its way: nothing else of the part is sent meanwhile.
  assert.equal(server.count('PUT'), 1);
  assert.equal(services()[0].priceCHF, 20);
  server.release();
  await settled();
  server.release();
  await settled();
  assert.equal(server.count('PUT'), 2);
  const stored = server.record!.parts.services as ServiceItem[];
  assert.equal(stored[0].priceCHF, 20);
  assert.equal(stored[1].name, 'Fringe');
  assert.equal(server.puts[1].baseRev, 1);
  assert.equal(salon.revision, 2);
  assert.equal(salon.current.saving, false);
});

test('changes to two parts in one action go in one request; a second part changed meanwhile goes in the next', async () => {
  const { server, salon } = await ready();
  server.hold = true;
  salon.write('employees', (previous: Employee[]) => previous.slice(1));
  salon.write('services', priced(firstService.id, 50));
  await settled();
  assert.equal(server.count('PUT'), 1);
  assert.deepEqual(Object.keys(server.puts[0].parts).sort(), ['employees', 'services']);
  salon.write('companySettings', renamed('Salon Nord'));
  salon.write('closedDates', [{ id: 'c1', name: 'Holiday', start: '2026-12-24', end: '2026-12-26' }]);
  server.release();
  await settled();
  server.release();
  await settled();
  assert.equal(server.count('PUT'), 2);
  assert.deepEqual(Object.keys(server.puts[1].parts).sort(), ['closedDates', 'companySettings']);
  assert.equal(server.record!.rev, 2);
  assert.equal((server.record!.parts.employees as Employee[]).length, initialEmployees.length - 1);
});

// ---------- when the server does not take a change ----------

test('a refused part goes back to what the server has and says the server\'s sentence, without "Try again": it would be refused again', async () => {
  const { server, salon, services } = await ready();
  server.refuse = { part: 'services', sentence: 'A salon can offer at most 200 services.' };
  salon.write('services', priced(firstService.id, 77));
  const saved = salon.pendingSave();
  assert.ok(saved);
  await settled();
  assert.equal(await saved, false);
  assert.equal(services(), initialServices);
  assert.equal(salon.current.notice?.kind, 'error');
  assert.equal(salon.current.notice?.text, `${SALON_TEXTS.notSaved} A salon can offer at most 200 services.`);
  assert.equal(salon.current.notice?.retry, false);
  assert.equal(server.record, null);
  salon.retry();
  await settled();
  assert.equal(server.count('PUT'), 1);
  assert.equal(services(), initialServices);
});

test('a change the server could not take (5xx) goes back and "Try again" sends it again', async () => {
  const { server, salon, services } = await ready();
  server.failNext = [{ status: 503, error: 'The salon could not be saved. Please try again.' }];
  salon.write('services', priced(firstService.id, 77));
  await settled();
  assert.equal(services(), initialServices);
  assert.equal(salon.current.notice?.text, `${SALON_TEXTS.notSaved} The salon could not be saved. Please try again.`);
  assert.equal(salon.current.notice?.retry, true);
  salon.retry();
  assert.equal(services()[0].priceCHF, 77);
  assert.equal(salon.current.notice, null);
  await settled();
  assert.equal(server.count('PUT'), 2);
  assert.equal((server.record!.parts.services as ServiceItem[])[0].priceCHF, 77);
});

test('what waited behind a change that was not taken is not sent on top of it: it goes back too, and "Try again" brings both', async () => {
  const { server, salon, services, settings } = await ready();
  server.hold = true;
  server.failNext = [null];
  salon.write('services', priced(firstService.id, 5));
  await settled();
  salon.write('companySettings', renamed('Salon Ost'));
  server.release();
  await settled();
  assert.equal(server.count('PUT'), 1);
  assert.equal(services(), initialServices);
  assert.equal(settings().companyName, initialCompanySettings.companyName);
  salon.retry();
  await settled();
  assert.equal(server.count('PUT'), 2);
  assert.deepEqual(Object.keys(server.puts[1].parts).sort(), ['companySettings', 'services']);
});

test('no connection, a server error and a waiting address each say why the change was not saved', async () => {
  // "Try again" only where it can help: no answer, a server failure, a wait.
  const cases: Array<[null | { status: number; error?: string }, string, boolean]> = [
    [null, SALON_TEXTS.unreachable, true],
    [{ status: 500 }, SALON_TEXTS.serverFailed, true],
    [{ status: 429, error: 'Too many wrong access keys were sent from this connection. Please wait 10 minutes and try again.' }, 'Please wait 10 minutes and try again.', true],
    [{ status: 401 }, 'did not accept the owner link', false],
    [{ status: 413, error: 'The salon is too large to save.' }, 'The salon is too large to save.', false],
  ];
  for (const [failure, why, retry] of cases) {
    const { server, salon, settings } = await ready();
    server.failNext = [failure];
    salon.write('companySettings', renamed('Salon Süd'));
    await settled();
    assert.equal(settings().companyName, initialCompanySettings.companyName);
    assert.ok(salon.current.notice?.text.startsWith(SALON_TEXTS.notSaved));
    assert.ok(salon.current.notice?.text.includes(why), salon.current.notice?.text);
    assert.equal(salon.current.notice?.retry, retry);
  }
});

test('409: another device was faster; its record shows, the owner is told, and the lost change is not sent by itself', async () => {
  const server = new SalonRoutesStandIn();
  const phone = await ready(server);
  const laptop = await ready(server);
  laptop.salon.write('companySettings', renamed('From the laptop'));
  await settled();
  phone.salon.write('services', priced(firstService.id, 12));
  await settled();
  assert.equal(phone.settings().companyName, 'From the laptop');
  assert.equal(phone.services(), initialServices);
  assert.equal(phone.salon.current.notice?.text, SALON_TEXTS.conflict);
  assert.equal(phone.salon.current.notice?.retry, false);
  assert.equal(phone.salon.revision, 1);
  // Forms that hold a copy of the salon start again from the server's record (src/App.tsx).
  assert.equal(phone.salon.current.replaced, 2);
  await settled();
  assert.equal(server.count('PUT'), 2);
  // The next change builds on the record the phone holds now, and is taken.
  phone.salon.write('services', priced(firstService.id, 12));
  await settled();
  assert.equal(server.record!.rev, 2);
  assert.equal(server.record!.parts.companySettings && (server.record!.parts.companySettings as CompanySettingsData).companyName, 'From the laptop');
});

// ---------- other devices and other tabs ----------

test('a revision from the chats\' answer that differs loads the record again and says so; the same one loads nothing', async () => {
  const { server, salon, settings } = await ready();
  salon.noteRevision(0);
  await settled();
  assert.equal(server.count('GET'), 1);
  const rev = server.saveElsewhere({ companySettings: { ...initialCompanySettings, companyName: 'Salon West' } });
  salon.noteRevision(rev);
  await settled();
  assert.equal(server.count('GET'), 2);
  assert.equal(settings().companyName, 'Salon West');
  assert.equal(salon.current.notice?.text, SALON_TEXTS.updated);
  assert.equal(salon.current.notice?.kind, 'info');
  assert.equal(salon.current.updated, 1);
  assert.equal(salon.current.replaced, 1);
  assert.equal(server.count('PUT'), 0);
});

test('while a change of this device is on its way, a new revision waits; a report from before its own save changes nothing on screen', async () => {
  const { server, salon, services } = await ready();
  server.hold = true;
  salon.write('services', priced(firstService.id, 30));
  await settled();
  // The chats' answer was asked before the save: it still says 0... then 1 is reported, which is this device's own.
  salon.noteRevision(1);
  assert.equal(server.count('GET'), 1);
  server.release();
  await settled();
  assert.equal(server.count('GET'), 1);
  salon.noteRevision(0);
  await settled();
  assert.equal(server.count('GET'), 2);
  assert.equal(services()[0].priceCHF, 30);
  assert.equal(salon.current.notice, null);
});

test('a second tab of the browser takes over a save of the first without asking the server', async () => {
  const server = new SalonRoutesStandIn();
  const tabs = new TabsStandIn();
  const first = await ready(server, tabs);
  const second = await ready(server, tabs);
  first.salon.write('services', priced(firstService.id, 44));
  await settled();
  assert.equal(second.services()[0].priceCHF, 44);
  assert.equal(second.salon.revision, 1);
  assert.equal(server.count('GET'), 2);
  // The second tab's next change builds on it and is taken.
  second.salon.write('companySettings', renamed('Salon Tab'));
  await settled();
  assert.equal(server.record!.rev, 2);
  assert.equal(first.settings().companyName, 'Salon Tab');
  assert.equal(second.salon.current.notice, null);
});

// ---------- signing out, the study tools ----------

test('signing out returns to the browser\'s salon and drops what was on its way; signing in loads again', async () => {
  const { server, salon } = await ready();
  server.hold = true;
  salon.write('services', priced(firstService.id, 8));
  const saved = salon.pendingSave()!;
  await settled();
  salon.signOut();
  assert.equal(await saved, false);
  assert.equal(salon.current.phase, 'local');
  assert.equal(salon.serves('services'), false);
  server.release();
  await settled();
  assert.equal(salon.current.notice, null);
  await salon.begin(server.key);
  assert.equal(salon.current.phase, 'ready');
  assert.equal(server.count('GET'), 2);
});

test('7: "Reset the shared salon" at revision 2 leaves the device at 3 with every part built in; the next save goes on 3, and other tabs follow', async () => {
  const server = new SalonRoutesStandIn();
  const tabs = new TabsStandIn();
  const { salon, settings, services, read } = await ready(server, tabs);
  const other = await ready(server, tabs);
  salon.write('companySettings', renamed('Salon Alt'));
  await settled();
  salon.write('services', priced(firstService.id, 70));
  await settled();
  assert.equal(salon.revision, 2);
  assert.equal(await salon.resetShared(), null);
  assert.equal(salon.revision, 3);
  assert.deepEqual(server.record?.parts, {});
  assert.equal(settings().companyName, initialCompanySettings.companyName);
  assert.equal(services(), initialServices);
  for (const key of SHARED_PARTS) assert.equal(read(key), key === 'shifts' ? read('shifts') : starting[key]);
  // The other tab does not hold revision 3 yet: it loads the record again.
  await settled();
  assert.equal(other.salon.revision, 3);
  assert.equal(other.settings().companyName, initialCompanySettings.companyName);
  salon.write('companySettings', renamed('Salon Neu'));
  await settled();
  assert.equal(server.puts.at(-1)!.baseRev, 3);
  assert.equal(server.record?.rev, 4);
  // Nothing was stored: the answer names revision 0, and so does the device.
  const empty = await ready();
  assert.equal(await empty.salon.resetShared(), null);
  assert.equal(empty.salon.revision, 0);
});

// ---------- the store of the page ----------

test('on a signed-in device the shared parts never reach the browser\'s storage; the bookings stay there, and the day\'s rebuild still works', async () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const tab = browser.openTab();
  const server = new SalonRoutesStandIn();
  server.saveElsewhere({ companySettings: { ...initialCompanySettings, companyName: 'Salon Server' } });
  const salon = new SharedSalon({ request: server.request, builtAt: () => clock.now() });
  let setSettings: React.Dispatch<React.SetStateAction<CompanySettingsData>> | undefined;
  let setRequests: React.Dispatch<React.SetStateAction<AppointmentRequest[]>> | undefined;
  const seen: string[] = [];
  const Screen = () => {
    const [settings, set] = useDemoState('companySettings', initialCompanySettings);
    setSettings = set;
    setRequests = useDemoState<AppointmentRequest[]>('requests', [])[1];
    seen.push(settings.companyName);
    return null;
  };
  // A browser that had renamed its own salon before signing in.
  const local = storeFor(browser.openTab(), clock);
  local.read('companySettings', initialCompanySettings);
  local.write('companySettings', renamed('Browser salon'));
  local.save();
  try {
    await salon.begin(server.key);
    inTab(tab, () => {
      forgetSalonOnServerForTests(salon);
      render(React.createElement(Screen));
    }, clock);
    assert.deepEqual(seen, ['Salon Server']);
    setSettings!(renamed('Salon Server 2'));
    setRequests!([]);
    await settled();
    assert.equal(server.count('PUT'), 1);
    const stored = browser.stored.get(salonStorageKey('/'))!;
    assert.doesNotMatch(stored, /Salon Server/);
    assert.match(stored, /Browser salon/);
    // Signed out, the screens read the browser's own salon again.
    salon.signOut();
    seen.length = 0;
    inTab(tab, () => render(React.createElement(Screen)), clock);
    assert.deepEqual(seen, ['Browser salon']);
  } finally {
    inTab(tab, () => forgetSalonOnServerForTests());
  }
});

test('an untouched salon of the browser is still built again on a new day while the device is signed in', async () => {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const tab = browser.openTab();
  const server = new SalonRoutesStandIn();
  const salon = new SharedSalon({ request: server.request, builtAt: () => clock.now() });
  await salon.begin(server.key);
  const store = storeFor(tab, clock);
  store.read('requests', [] as AppointmentRequest[]);
  salon.read('companySettings', initialCompanySettings);
  salon.write('companySettings', renamed('Salon Server'));
  await settled();
  // A change of a shared part leaves the browser's salon untouched, so a new day still rebuilds it.
  assert.equal(store.changed, false);
  clock.set('2026-10-06T07:00:00Z');
  store.refresh();
  assert.equal(store.day, '2026-10-06');
  assert.equal(JSON.parse(browser.stored.get(salonStorageKey('/'))!).changed, false);
});

test('a message that says a change is done waits for the server; without a pending save it shows at once', async () => {
  const shownMessages: string[] = [];
  whenSaved(() => shownMessages.push('at once'));
  assert.deepEqual(shownMessages, ['at once']);
  const server = new SalonRoutesStandIn();
  const browser = new BrowserStandIn();
  const tab = browser.openTab();
  const salon = new SharedSalon({ request: server.request, builtAt: () => FIXED_NOW });
  await salon.begin(server.key);
  salon.read('companySettings', initialCompanySettings);
  salon.read('aiSettings', initialAiSettings);
  try {
    inTab(tab, () => {
      forgetSalonOnServerForTests(salon);
      salon.write('companySettings', renamed('Salon Eins'));
      whenSaved(() => shownMessages.push('saved'));
      server.refuse = { part: 'companySettings', sentence: 'The name is too long.' };
      salon.write('aiSettings', (previous: typeof initialAiSettings) => ({ ...previous, tone: previous.tone === 'formal' ? 'friendly' as const : 'formal' as const }));
    });
    assert.deepEqual(shownMessages, ['at once']);
    await settled();
    // One request held both changes; the server refused it, so "saved" never shows.
    assert.deepEqual(shownMessages, ['at once']);
    server.refuse = null;
    inTab(tab, () => {
      salon.write('companySettings', renamed('Salon Zwei'));
      whenSaved(() => shownMessages.push('saved'));
    });
    await settled();
    assert.deepEqual(shownMessages, ['at once', 'saved']);
  } finally {
    inTab(tab, () => forgetSalonOnServerForTests());
  }
});

test('the status is one object until something in it changes', async () => {
  const { salon } = await ready();
  const seen = new Set<SalonStatus>();
  for (let i = 0; i < 3; i++) seen.add(salon.current);
  assert.equal(seen.size, 1);
});

// ---------- review of 3B: races and actions that are one whole ----------

test('1: "Try again" in a tab never writes over a newer save of another tab: the owner is told and looks again', async () => {
  const server = new SalonRoutesStandIn();
  const tabs = new TabsStandIn();
  const a = await ready(server, tabs);
  const b = await ready(server, tabs);
  server.failNext = [null];
  a.salon.write('services', priced(firstService.id, 11));
  await settled();
  assert.equal(a.salon.current.notice?.retry, true);
  b.salon.write('services', priced(firstService.id, 99));
  await settled();
  // Tab A took tab B's save over; its own change was made on the record before.
  assert.equal(a.services()[0].priceCHF, 99);
  assert.equal(a.salon.current.notice?.kind, 'error');
  assert.equal(a.salon.current.notice?.retry, false);
  assert.match(a.salon.current.notice!.text, /^Your change was not saved: the services changed elsewhere in the meantime\./);
  a.salon.retry();
  await settled();
  assert.equal((server.record!.parts.services as ServiceItem[])[0].priceCHF, 99);
  assert.equal(server.count('PUT'), 2);
});

test('1: a lost change whose part nobody else touched can still be sent again after another tab saved something else', async () => {
  const server = new SalonRoutesStandIn();
  const tabs = new TabsStandIn();
  const a = await ready(server, tabs);
  const b = await ready(server, tabs);
  server.failNext = [null];
  a.salon.write('services', priced(firstService.id, 11));
  await settled();
  b.salon.write('companySettings', renamed('Salon Tab B'));
  await settled();
  assert.equal(a.salon.current.notice?.retry, true);
  a.salon.retry();
  await settled();
  assert.equal((server.record!.parts.services as ServiceItem[])[0].priceCHF, 11);
  assert.equal((server.record!.parts.companySettings as CompanySettingsData).companyName, 'Salon Tab B');
});

test('2: a reload answered after this device\'s own later save is not used: no old record, no false message, no 409 after', async () => {
  const server = new SalonRoutesStandIn();
  let lateGet: (() => void) | null = null;
  let holdGets = false;
  const request: typeof server.request = (key, method, body) => {
    if (method === 'GET' && holdGets && !lateGet) {
      const snapshot = JSON.parse(JSON.stringify(server.record));
      return new Promise((resolve) => { lateGet = () => resolve({ status: 200, data: snapshot }); });
    }
    return server.request(key, method, body);
  };
  const salon = new SharedSalon({ request, builtAt: () => FIXED_NOW });
  salon.read('services', initialServices);
  await salon.begin(server.key);
  salon.write('services', priced(firstService.id, 50));
  await settled();
  holdGets = true;
  // A report from before that save starts a reload; its answer comes late.
  salon.noteRevision(0);
  salon.write('services', priced(firstService.id, 70));
  await settled();
  assert.equal(salon.revision, 2);
  lateGet!();
  await settled();
  assert.equal(salon.revision, 2);
  assert.equal(salon.read<ServiceItem[]>('services', initialServices)[0].priceCHF, 70);
  assert.equal(salon.current.notice, null);
  salon.write('services', priced(firstService.id, 80));
  await settled();
  assert.equal(salon.current.notice, null);
  assert.equal((server.record!.parts.services as ServiceItem[])[0].priceCHF, 80);
});

test('4: a change that was not saved is never passed over in silence when another device saves', async () => {
  // Another device changes another part: the "not saved" message stays, with "Try again".
  const { server, salon, settings } = await ready();
  server.failNext = [null];
  salon.write('services', priced(firstService.id, 12));
  await settled();
  const notSaved = salon.current.notice;
  salon.noteRevision(server.saveElsewhere({ companySettings: { ...initialCompanySettings, companyName: 'Other' } }));
  await settled();
  assert.equal(settings().companyName, 'Other');
  assert.equal(salon.current.notice, notSaved);
  salon.retry();
  await settled();
  assert.equal((server.record!.parts.services as ServiceItem[])[0].priceCHF, 12);

  // Another device changes the same part: one message says both, and nothing is sent again.
  const second = await ready();
  second.server.failNext = [null];
  second.salon.write('services', priced(firstService.id, 13));
  await settled();
  second.salon.noteRevision(second.server.saveElsewhere({ services: initialServices.map((item) => ({ ...item, priceCHF: 1 })) }));
  await settled();
  assert.match(second.salon.current.notice!.text, /not saved: the services changed elsewhere/);
  assert.equal(second.salon.current.notice!.retry, false);
  assert.notEqual(second.salon.current.notice!.text, SALON_TEXTS.updated);
});

test('5: parts the server could not read are named once per load, in plain words', async () => {
  const server = new SalonRoutesStandIn();
  server.unreadable = ['services', 'closedDates'];
  const { salon } = device(server);
  await salon.begin(server.key);
  assert.equal(salon.current.notice?.kind, 'warning');
  assert.equal(salon.current.notice?.text, 'Part of your salon could not be read: the services and the closed dates. The built-in version is shown until you save those parts again.');
  salon.dismissNotice();
  // A reload of the same load does not say it again.
  salon.noteRevision(server.saveElsewhere({ companySettings: { ...initialCompanySettings, companyName: 'Other' } }));
  await settled();
  assert.notEqual(salon.current.notice?.kind, 'warning');
  // The next load says it again.
  await salon.begin(server.key);
  assert.equal(salon.current.notice?.kind, 'warning');
  server.unreadable = [];
  await salon.begin(server.key);
  assert.equal(salon.current.notice, null);
});

test('3: an action that changes shared parts and the browser\'s own parts is one whole: undone together, made again together', async () => {
  const anna = initialEmployees[0];
  type Block = { id: string; employeeId: string; date: string; startTime: string; endTime: string; reason: 'Break' };
  type Booking = { id: string; serviceId: string; serviceName: string; employeeId: string; staffName: string };
  const blocks: Block[] = [{ id: 'b1', employeeId: anna.id, date: '2026-10-06', startTime: '12:00', endTime: '12:30', reason: 'Break' }];
  const events: Booking[] = [{ id: 'cal-1', serviceId: firstService.id, serviceName: firstService.name, employeeId: anna.id, staffName: anna.name }];

  /** A signed-in tab whose screens hold the shared parts and the browser's own, as App does. */
  async function signedInTab() {
    const browser = new BrowserStandIn();
    const clock = new ClockStandIn();
    const tab = browser.openTab();
    const server = new SalonRoutesStandIn();
    const salon = new SharedSalon({ request: server.request, builtAt: () => clock.now() });
    const set: Record<string, unknown> = {};
    const Screen = () => {
      for (const [key, initial] of [['employees', initialEmployees], ['services', initialServices], ['timeBlocks', blocks], ['calendarEvents', events], ['requests', [] as AppointmentRequest[]]] as const) {
        set[key] = useDemoState<unknown>(key, initial)[1];
      }
      return null;
    };
    await salon.begin(server.key);
    inTab(tab, () => { forgetSalonOnServerForTests(salon); render(React.createElement(Screen)); }, clock);
    const write = <T,>(key: string, next: (previous: T) => T) => (set[key] as React.Dispatch<React.SetStateAction<T>>)(next);
    /** What the tab's screens hold of a part: read through its setter, which changes nothing. */
    const held = (key: string) => { let value: unknown; write<unknown>(key, (previous) => { value = previous; return previous; }); return value; };
    const local = () => JSON.stringify({ blocks: held('timeBlocks'), events: held('calendarEvents') });
    const close = () => inTab(tab, () => forgetSalonOnServerForTests());
    return { server, salon, write, local, close };
  }
  // The three actions of App.tsx (delete a person, rename a service, edit a person), in the order their handlers write.
  const actions: Record<string, (write: Awaited<ReturnType<typeof signedInTab>>['write']) => void> = {
    'delete a person': (write) => {
      write<Employee[]>('employees', (previous) => previous.filter((item) => item.id !== anna.id));
      write<Block[]>('timeBlocks', (previous) => previous.filter((item) => item.employeeId !== anna.id));
      write<ServiceItem[]>('services', (previous) => previous.map((item) => ({ ...item, assignedEmployeeIds: item.assignedEmployeeIds?.filter((id) => id !== anna.id) })));
    },
    'rename a service': (write) => {
      write<Booking[]>('calendarEvents', (previous) => previous.map((item) => item.serviceId === firstService.id ? { ...item, serviceName: 'Blow-dry' } : item));
      write<AppointmentRequest[]>('requests', (previous) => previous);
      write<ServiceItem[]>('services', (previous) => previous.map((item) => item.id === firstService.id ? { ...item, name: 'Blow-dry' } : item));
    },
    'edit a person': (write) => {
      write<ServiceItem[]>('services', (previous) => previous.map((item) => item.id === initialServices[2].id ? { ...item, assignedEmployeeIds: [anna.id] } : item));
      write<Employee[]>('employees', (previous) => previous.map((item) => item.id === anna.id ? { ...item, firstName: 'Anne', name: `Anne ${item.lastName}` } : item));
      write<Booking[]>('calendarEvents', (previous) => previous.map((item) => item.employeeId === anna.id ? { ...item, staffName: `Anne ${anna.lastName}` } : item));
    },
  };
  for (const [name, act] of Object.entries(actions)) {
    // Saved: the browser's parts stay changed, and the message with "Undo" shows once the server has it.
    const ok = await signedInTab();
    try {
      const before = ok.local();
      const shown: string[] = [];
      act(ok.write);
      whenSaved(() => shown.push('Undo'));
      assert.equal(shown.length, 0, `${name}: nothing says it was done before the server has it`);
      await settled();
      assert.notEqual(ok.local(), before, `${name}: a successful save keeps the browser's parts changed`);
      assert.deepEqual(shown, ['Undo'], `${name}: the message with "Undo" shows once saved`);
      assert.equal(ok.server.record?.rev, 1);
    } finally { ok.close(); }

    // Not saved: the browser's parts go back with the shared ones; "Try again" makes the whole action again.
    const failing = await signedInTab();
    try {
      const before = failing.local();
      const shown: string[] = [];
      failing.server.failNext = [null];
      act(failing.write);
      const changed = failing.local();
      assert.notEqual(changed, before, `${name}: the action changes the browser's parts at once`);
      whenSaved(() => shown.push('Undo'));
      await settled();
      assert.equal(failing.local(), before, `${name}: a failed save leaves the browser's parts as they were`);
      assert.equal(shown.length, 0, `${name}: nothing says it was done`);
      failing.salon.retry();
      await settled();
      assert.equal(failing.local(), changed, `${name}: "Try again" makes the browser's part of it again`);
      assert.equal(failing.server.record?.rev, 1);
    } finally { failing.close(); }
  }
});

// ---------- second review of 3B ----------

test('B: a message that a change was not saved is never replaced by "Updated" or a warning, after a 409, a refusal, no answer or "changed elsewhere"', async () => {
  const kinds: Array<[string, (server: SalonRoutesStandIn) => void]> = [
    ['409', (server) => { server.saveElsewhere({ services: initialServices.map((item) => ({ ...item, priceCHF: 1 })) }); }],
    ['refusal', (server) => { server.refuse = { part: 'services', sentence: 'The price is too high.' }; }],
    ['no answer', (server) => { server.failNext = [null]; }],
  ];
  for (const [name, prepare] of kinds) {
    const { server, salon } = await ready();
    prepare(server);
    salon.write('services', priced(firstService.id, 66));
    await settled();
    const notSaved = salon.current.notice;
    assert.equal(notSaved?.kind, 'error', name);
    server.refuse = null;
    // Another device saves something else, and the record has a part it could not read.
    server.unreadable = ['closedDates'];
    salon.noteRevision(server.saveElsewhere({ companySettings: { ...initialCompanySettings, companyName: `Other ${name}` } }));
    await settled();
    assert.equal(salon.current.notice, notSaved, `${name}: the message stays`);
  }
  // "Changed elsewhere" stays too.
  const server = new SalonRoutesStandIn();
  const tabs = new TabsStandIn();
  const a = await ready(server, tabs);
  const b = await ready(server, tabs);
  server.failNext = [null];
  a.salon.write('services', priced(firstService.id, 11));
  await settled();
  b.salon.write('services', priced(firstService.id, 99));
  await settled();
  const elsewhere = a.salon.current.notice;
  assert.match(elsewhere!.text, /changed elsewhere/);
  b.salon.write('companySettings', renamed('Salon B'));
  await settled();
  a.salon.noteRevision(server.record!.rev + 0);
  await settled();
  assert.equal(a.salon.current.notice, elsewhere);
  // Closed by the owner, it goes; then "Updated" may show again.
  a.salon.dismissNotice();
  assert.equal(a.salon.current.notice, null);
});

test('C: a change whose answer got lost but that the server stored is saved: no "not saved" once the device learns it', async () => {
  const server = new SalonRoutesStandIn();
  let loseAnswer = true;
  const request: typeof server.request = async (key, method, body) => {
    const answer = await server.request(key, method, body);
    if (method === 'PUT' && loseAnswer) { loseAnswer = false; return null; }
    return answer;
  };
  const salon = new SharedSalon({ request, builtAt: () => FIXED_NOW, now: () => 5000 });
  salon.read('services', initialServices);
  await salon.begin(server.key);
  salon.write('services', priced(firstService.id, 66));
  await settled();
  assert.equal((server.record!.parts.services as ServiceItem[])[0].priceCHF, 66);
  assert.equal(salon.current.notice?.retry, true);
  salon.noteRevision(server.record!.rev);
  await settled();
  assert.equal(salon.read<ServiceItem[]>('services', initialServices)[0].priceCHF, 66);
  assert.equal(salon.current.notice, null);
  assert.equal(salon.current.savedAt, 5000);
  salon.retry();
  await settled();
  assert.equal(server.count('PUT'), 1);
});

test('C: a lost change the server has after a 409 or another tab\'s save is settled, not called "changed elsewhere"', async () => {
  const server = new SalonRoutesStandIn();
  const tabs = new TabsStandIn();
  const a = await ready(server, tabs);
  const b = await ready(server, tabs);
  server.failNext = [null];
  a.salon.write('services', priced(firstService.id, 44));
  await settled();
  // The other tab saves the very same price.
  b.salon.write('services', priced(firstService.id, 44));
  await settled();
  assert.equal(a.salon.current.notice, null);
  assert.equal(a.services()[0].priceCHF, 44);
});

const switched = (index: number) => (previous: ServiceItem[]) => previous.map((item, at) => at === index ? { ...item, onlineBooking: !item.onlineBooking } : item);

test('E: a switch that was not saved is not forgotten when another switch of the same part is saved: the owner is told to make it once more', async () => {
  const { server, salon, services } = await ready();
  const before = initialServices[0].onlineBooking;
  server.failNext = [null];
  salon.write('services', switched(0));
  await settled();
  assert.equal(salon.current.notice?.retry, true);
  assert.equal(services()[0].onlineBooking, before, 'the switch went back on screen');
  // Another service's switch, made on the screen as it is now: it does not hold the first one.
  salon.write('services', switched(1));
  await settled();
  const stored = server.record!.parts.services as ServiceItem[];
  assert.equal(stored[1].onlineBooking, !initialServices[1].onlineBooking);
  assert.equal(stored[0].onlineBooking, before, 'the first switch is not on the server');
  // The message does not go quietly: it says what is still to do, and offers nothing that would send the older list.
  assert.equal(salon.current.notice?.kind, 'error');
  assert.equal(salon.current.notice?.text, earlierNotSavedText(['services']));
  assert.equal(salon.current.notice?.retry, false);
  salon.retry();
  await settled();
  assert.equal(server.count('PUT'), 2);
  assert.equal((server.record!.parts.services as ServiceItem[])[1].onlineBooking, !initialServices[1].onlineBooking, 'the newer save stands');
  // It stays until she closes it; an update from another device does not take its place.
  server.saveElsewhere({ companySettings: { ...initialCompanySettings, companyName: 'Salon Rosa' } });
  salon.noteRevision(server.record!.rev);
  await settled();
  assert.equal(salon.current.notice?.text, earlierNotSavedText(['services']));
});

test('E: the owner makes the lost change again herself: the message goes and nothing more is said', async () => {
  const { server, salon } = await ready();
  server.failNext = [null];
  salon.write('services', switched(0));
  await settled();
  assert.equal(salon.current.notice?.retry, true);
  salon.write('services', switched(0));
  await settled();
  assert.equal((server.record!.parts.services as ServiceItem[])[0].onlineBooking, !initialServices[0].onlineBooking);
  assert.equal(salon.current.notice, null);
  assert.ok(salon.current.savedAt !== null);
});

test('E: a second change of the same part that is not saved either: "Try again" sends the newer one, and the message says the earlier one is gone', async () => {
  const { server, salon } = await ready();
  server.failNext = [null, null];
  salon.write('services', switched(0));
  await settled();
  salon.write('services', switched(1));
  await settled();
  assert.equal(salon.current.notice?.text, `${SALON_TEXTS.notSaved} ${SALON_TEXTS.unreachable} ${SALON_TEXTS.earlierDropped}`);
  assert.equal(salon.current.notice?.retry, true);
  salon.retry();
  await settled();
  const stored = server.record!.parts.services as ServiceItem[];
  assert.equal(stored[1].onlineBooking, !initialServices[1].onlineBooking);
  assert.equal(stored[0].onlineBooking, initialServices[0].onlineBooking);
  assert.equal(salon.current.notice, null);
});

test('E: what a form sent and did not get through is settled by the form\'s next save, without a word', async () => {
  const { server, salon } = await ready();
  server.failNext = [null];
  salon.write('services', priced(firstService.id, 10));
  assert.ok(salon.pendingFormSave());
  await settled();
  assert.equal(salon.current.notice?.retry, false);
  // The form still holds what was typed; the owner changes it once more and saves from the form.
  salon.write('services', priced(firstService.id, 20));
  assert.ok(salon.pendingFormSave());
  await settled();
  assert.equal((server.record!.parts.services as ServiceItem[])[0].priceCHF, 20);
  assert.equal(salon.current.notice, null);
});

test('a message about a save another device was faster than, or the server refused, goes when the next save of that part is taken', async () => {
  for (const kind of ['409', 'refusal'] as const) {
    const { server, salon } = await ready();
    if (kind === '409') server.saveElsewhere({ services: initialServices.map((item, index) => index === 3 ? { ...item, priceCHF: 99 } : item) });
    else server.refuse = { part: 'services', sentence: 'Services: the price of service 1 must be a number from 0 to 100000.' };
    salon.write('services', priced(firstService.id, 70));
    assert.ok(salon.pendingFormSave());
    await settled();
    assert.equal(salon.current.notice?.kind, 'error', kind);
    assert.equal(salon.current.notice?.retry, false, kind);
    // A save of another part leaves the message: it says nothing about the services.
    salon.write('companySettings', renamed('Salon Rosa'));
    await settled();
    assert.equal(salon.current.notice?.kind, 'error', `${kind}: still there after a save of another part`);
    // Saving the services again, and taken: the message has nothing left to say.
    server.refuse = null;
    salon.write('services', priced(firstService.id, 71));
    assert.ok(salon.pendingFormSave());
    await settled();
    assert.equal((server.record!.parts.services as ServiceItem[])[0].priceCHF, 71, kind);
    assert.equal(salon.current.notice, null, kind);
  }
});

test('a request that never answers is given up after its time and counts as no answer; one that answers in time is read', async () => {
  const sent: Array<{ url: string; method?: string; key?: string }> = [];
  // A server that never answers: the request only ends when it is given up.
  const hangs = ((url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    sent.push({ url, method: init?.method, key: (init?.headers as Record<string, string>)['x-live-key'] });
    init?.signal?.addEventListener('abort', () => reject(new Error('given up')));
  })) as typeof fetch;
  assert.equal(await salonRequestWith(hangs, 5)('owner-key', 'PUT', { baseRev: 0, parts: {} }), null);
  assert.deepEqual(sent, [{ url: '/api/salon', method: 'PUT', key: 'owner-key' }]);
  const answers = (async () => new Response(JSON.stringify({ rev: 3 }), { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await salonRequestWith(answers, 5)('owner-key', 'GET'), { status: 200, data: { rev: 3 } });
  // A device whose save got no answer in time: the form's save promise says "not saved", and nothing waits for ever.
  const server = new SalonRoutesStandIn();
  const { salon } = await ready(server);
  server.failNext = [null];
  salon.write('services', priced(firstService.id, 12));
  const pending = salon.pendingFormSave();
  await settled();
  assert.equal(await pending, false);
  assert.equal(salon.current.saving, false);
});

test('D: a form\'s save that is not taken keeps nothing for "Try again": the form is the way to try again; a list switch keeps it', async () => {
  const { server, salon } = await ready();
  server.failNext = [null];
  salon.write('services', priced(firstService.id, 30));
  const formSave = salon.pendingFormSave();
  assert.ok(formSave);
  await settled();
  assert.equal(await formSave, false);
  assert.equal(salon.current.notice?.kind, 'error');
  assert.equal(salon.current.notice?.retry, false);
  salon.retry();
  await settled();
  assert.equal(server.count('PUT'), 1);
  // A switch in a list (no form): "Try again" as before.
  server.failNext = [null];
  salon.write('services', (previous: ServiceItem[]) => previous.map((item, index) => index === 1 ? { ...item, onlineBooking: !item.onlineBooking } : item));
  await settled();
  assert.equal(salon.current.notice?.retry, true);
  // Taken: the form's promise says so, so it closes.
  salon.write('services', priced(firstService.id, 31));
  const taken = salon.pendingFormSave();
  await settled();
  assert.equal(await taken, true);
});

test('C and D: a form\'s save whose answer got lost is settled too once the device learns the server has it', async () => {
  const server = new SalonRoutesStandIn();
  let loseAnswer = true;
  const request: typeof server.request = async (key, method, body) => {
    const answer = await server.request(key, method, body);
    if (method === 'PUT' && loseAnswer) { loseAnswer = false; return null; }
    return answer;
  };
  const salon = new SharedSalon({ request, builtAt: () => FIXED_NOW, now: () => 7000 });
  salon.read('services', initialServices);
  await salon.begin(server.key);
  salon.write('services', priced(firstService.id, 66));
  const formSave = salon.pendingFormSave();
  await settled();
  assert.equal(await formSave, false);
  assert.equal(salon.current.notice?.retry, false);
  salon.noteRevision(server.record!.rev);
  await settled();
  assert.equal(salon.current.notice, null);
  assert.equal(salon.current.savedAt, 7000);
});
