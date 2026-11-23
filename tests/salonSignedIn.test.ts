import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { fetchSalon } from '../src/sharedSalon';
import { forgetSalonOnServerForTests, salonOnServer } from '../src/useDemoState';
import { deletionDependency } from '../src/managementDependencies';
import { CalendarView } from '../src/views/CalendarView';
import { HomeView } from '../src/views/HomeView';
import { AnalyticsView } from '../src/views/AnalyticsView';
import { CustomersView } from '../src/views/CustomersView';
import { ThisDeviceCard, SALON_FROM_SERVER_TEXT } from '../src/components/ThisDeviceCard';
import { SalonGate, SaveIndicator, LOADING_TEXT, LOAD_FAILED_TITLE } from '../src/components/SalonGate';
import { StudyTools } from '../src/components/StudyTools';
import { profileFacts } from '../src/CustomerChat';
import { BrowserStandIn, inTab } from './browserStandIn';
import { demoConversations, demoCustomers, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { readableText, render, TELL_WORDS } from './renderHelpers';

const nothing = () => {};
const ZONE = 'Europe/Zurich';

/** Replaces the global fetch for one run and lists what was asked. */
async function withFetch<T>(answer: (url: string, init?: RequestInit) => Response, run: (asked: Array<{ url: string; init?: RequestInit }>) => Promise<T> | T): Promise<T> {
  const asked: Array<{ url: string; init?: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => { asked.push({ url: String(url), init }); return answer(String(url), init); }) as typeof fetch;
  try { return await run(asked); } finally { globalThis.fetch = original; }
}

// ---------- not signed in: as before ----------

test('without a key (every customer), and on the chat page even with one, nothing is asked of /api/salon', async () => {
  await withFetch(() => Response.json({ rev: 0, parts: {} }), async (asked) => {
    for (const [search, key] of [['', null], ['?booking=1', null], ['?chat=token', 'owner-key']] as const) {
      const browser = new BrowserStandIn();
      const tab = browser.openTab();
      tab.window.location.search = search;
      if (key) browser.stored.set('slotbee-live-key', key);
      inTab(tab, () => {
        forgetSalonOnServerForTests();
        const salon = salonOnServer()!;
        assert.equal(salon.current.phase, 'local');
        assert.equal(salon.serves('services'), false);
        forgetSalonOnServerForTests();
      });
    }
    assert.deepEqual(asked, []);
  });
});

test('8: the booking page of a browser that holds the owner\'s key shows the server\'s salon, read-only: one GET, never a PUT', async () => {
  const services = initialServices.map((item) => item.id === 'srv-2' ? { ...item, priceCHF: 99 } : item);
  const bookingHours = initialBookingHours.map((day) => day.day === 'Saturday' ? { ...day, isOpen: false } : day);
  await withFetch(() => Response.json({ rev: 4, parts: { services, bookingHours } }), async (asked) => {
    const browser = new BrowserStandIn();
    const tab = browser.openTab();
    tab.window.location.search = '?booking=1';
    browser.stored.set('slotbee-live-key', 'owner-key');
    const salon = inTab(tab, () => { forgetSalonOnServerForTests(); return salonOnServer()!; });
    assert.equal(salon.current.phase, 'loading');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(salon.current.phase, 'ready');
    assert.equal(salon.readOnly, true);
    assert.equal(salon.read<typeof services>('services', initialServices).find((item) => item.id === 'srv-2')?.priceCHF, 99);
    assert.equal(salon.read<typeof bookingHours>('bookingHours', initialBookingHours).find((day) => day.day === 'Saturday')?.isOpen, false);
    // The page never changes a shared part.
    salon.write('services', initialServices);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(salon.read<typeof services>('services', initialServices).find((item) => item.id === 'srv-2')?.priceCHF, 99);
    assert.deepEqual(asked.map((item) => `${item.init?.method} ${item.url}`), ['GET /api/salon']);
    assert.equal((asked[0].init?.headers as Record<string, string>)['x-live-key'], 'owner-key');
    // Back in front after a while: the record is asked for again, quietly.
    salon.reload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(asked.map((item) => item.init?.method), ['GET', 'GET']);
    assert.equal(salon.current.notice, null);
    inTab(tab, () => forgetSalonOnServerForTests());
  });
});

test('with a key the owner\'s app starts with "Loading your salon…" and asks for the record, the key in the header only', async () => {
  await withFetch(() => Response.json({ rev: 3, updatedAt: '2026-10-05T09:00:00.000Z', parts: {} }), async (asked) => {
    const browser = new BrowserStandIn();
    const tab = browser.openTab();
    browser.stored.set('slotbee-live-key', 'owner-key');
    const salon = inTab(tab, () => { forgetSalonOnServerForTests(); return salonOnServer()!; });
    assert.equal(salon.current.phase, 'loading');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(salon.current.phase, 'ready');
    assert.equal(salon.revision, 3);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].url, '/api/salon');
    assert.equal(asked[0].init?.method, 'GET');
    assert.equal((asked[0].init?.headers as Record<string, string>)['x-live-key'], 'owner-key');
    inTab(tab, () => forgetSalonOnServerForTests());
  });
});

test('a save goes as PUT with the base revision and the parts as JSON; an answer that is no JSON keeps its status', async () => {
  await withFetch((_url, init) => init?.method === 'PUT' ? new Response('<html>proxy</html>', { status: 502 }) : Response.json({ rev: 1 }), async (asked) => {
    const answer = await fetchSalon('k', 'PUT', { baseRev: 1, parts: { closedDates: [] } });
    assert.deepEqual(answer, { status: 502, data: null });
    assert.equal(asked[0].init?.body, JSON.stringify({ baseRev: 1, parts: { closedDates: [] } }));
    assert.equal((asked[0].init?.headers as Record<string, string>)['Content-Type'], 'application/json');
  });
  await withFetch(() => { throw new TypeError('offline'); }, async () => {
    assert.equal(await fetchSalon('k', 'GET'), null);
  });
});

// ---------- the screens of a signed-in device ----------

test('the start, the failure and the saving sign say what they should, in the salon\'s words', () => {
  const loading = readableText(render(React.createElement(SalonGate, { status: { phase: 'loading', loadError: null, saving: false, savedAt: null, notice: null, replaced: 0, updated: 0 }, onRetry: nothing, onSignOut: nothing })));
  assert.match(loading, new RegExp(LOADING_TEXT));
  const failed = render(React.createElement(SalonGate, { status: { phase: 'failed', loadError: 'The server could not be reached. Check your connection and try again.', saving: false, savedAt: null, notice: null, replaced: 0, updated: 0 }, onRetry: nothing, onSignOut: nothing }));
  assert.match(failed, new RegExp(LOAD_FAILED_TITLE));
  assert.match(failed, />Try again</);
  assert.match(failed, />Sign out on this device</);
  assert.match(failed, /role="alert"/);
  for (const html of [loading, failed]) assert.doesNotMatch(readableText(html), TELL_WORDS);
  const base = { phase: 'ready' as const, loadError: null, notice: null, replaced: 1, updated: 0 };
  assert.match(render(React.createElement(SaveIndicator, { status: { ...base, saving: true, savedAt: null } })), /Saving…/);
  assert.match(render(React.createElement(SaveIndicator, { status: { ...base, saving: false, savedAt: 1000 }, now: () => 2000 })), /Saved/);
  assert.doesNotMatch(render(React.createElement(SaveIndicator, { status: { ...base, saving: false, savedAt: 1000 }, now: () => 9000 })), /Saved/);
  assert.equal(render(React.createElement(SaveIndicator, { status: { ...base, phase: 'local', saving: false, savedAt: null } })), '');
});

test('"This device" says, when signed in, that the salon comes from the server and the calendar is still this browser\'s', () => {
  const signedIn = readableText(render(React.createElement(ThisDeviceCard, { signedIn: true, connection: 'live', onSignOut: nothing, salonFromServer: true })));
  assert.ok(signedIn.includes(SALON_FROM_SERVER_TEXT));
  assert.match(signedIn, /still kept in this browser only/);
  assert.doesNotMatch(signedIn, /\b(19|20)\d\d\b|next week|soon/);
  const signedOut = readableText(render(React.createElement(ThisDeviceCard, { signedIn: false, connection: 'off', onSignOut: nothing, salonFromServer: false })));
  assert.ok(!signedOut.includes(SALON_FROM_SERVER_TEXT));
});

test('the study tools of a browser that is not signed in keep their one reset', () => {
  const html = render(React.createElement(StudyTools, { onOpenPilotInterest: nothing }), { research: true });
  assert.match(html, />Reset demo data</);
  assert.doesNotMatch(html, /Reset the shared salon/);
});

test('the customer page takes the salon\'s name, time zone and phone from the profile, whatever else it holds', () => {
  assert.deepEqual(profileFacts({ companyName: ' Salon Rosa ', timeZone: 'Europe/Zurich', phone: '+41711234567', services: [] }),
    { name: 'Salon Rosa', timeZone: 'Europe/Zurich', phone: '+41711234567' });
  // The salon has no number: none is shown, not the built-in one.
  assert.deepEqual(profileFacts({ companyName: 'Salon Blau', phone: '' }), { name: 'Salon Blau', timeZone: null, phone: '' });
  // Only `companyName` names the salon; an answer without a phone says nothing about it.
  assert.deepEqual(profileFacts({ name: 'Salon Grün', salon: { name: 'x' } }), { name: null, timeZone: null, phone: null });
  assert.deepEqual(profileFacts(null), { name: null, timeZone: null, phone: null });
});

test('the browser\'s calendar with a stylist and a service the server no longer has: every screen still shows those appointments', () => {
  // Another device removed Anna (emp-1) and the haircut (srv-2); this browser's calendar still names them.
  const gonePerson = initialEmployees[0];
  const employees = initialEmployees.filter((item) => item.id !== gonePerson.id);
  const goneService = demoEvents.find((event) => event.employeeId === gonePerson.id)!.serviceId!;
  const services = initialServices.filter((item) => item.id !== goneService);
  const theirs = demoEvents.filter((event) => event.employeeId === gonePerson.id);
  assert.ok(theirs.length > 0);
  const shiftOverview = demoShifts.filter((entry) => entry.employeeId !== gonePerson.id);
  for (const view of ['day', 'week', 'list'] as const) {
    for (const date of [...new Set(theirs.map((event) => event.date))]) {
      const html = render(React.createElement(CalendarView, {
        events: demoEvents, services, employees, bookingHours: initialBookingHours, shiftOverview, requests: demoRequests,
        timeZone: ZONE, date, view, now: FIXED_NOW, selectedEventId: theirs[0].id,
        onSelectEvent: nothing, onDateChange: nothing, onOpenAppointmentForm: () => {}, onDeleteEvent: nothing,
      }));
      assert.ok(html.length > 0);
      if (view !== 'day') for (const event of theirs.filter((item) => item.date === date)) assert.ok(html.includes(event.customerName), `${view} ${date} shows ${event.customerName}`);
    }
  }
  const salon = { requests: demoRequests, events: demoEvents, services, employees, bookingHours: initialBookingHours, shiftOverview, now: FIXED_NOW, timeZone: ZONE };
  render(React.createElement(HomeView, {
    requests: demoRequests, selectedRequestId: demoRequests[0]?.id ?? null, now: FIXED_NOW, availabilityContext: salon,
    onAcceptRequest: () => null, onRejectRequest: nothing, onMoveRequest: () => null, onSimulateNewRequest: nothing,
    onOpenAppointment: nothing, onOpenAnalytics: nothing, conversations: demoConversations, onOpenConversations: nothing,
  }));
  render(React.createElement(AnalyticsView, { events: demoEvents, conversations: demoConversations, companyName: 'Salon', timeZone: ZONE, now: FIXED_NOW, onExportReport: nothing }));
  const customer = theirs[0].customerId!;
  const profile = render(React.createElement(CustomersView, {
    customers: demoCustomers, events: demoEvents, now: FIXED_NOW, timeZone: ZONE, selectedCustomerId: customer, customersWithChat: new Set<string>(),
    onClearSelection: nothing, onAddCustomer: nothing, onUpdateCustomer: nothing, onDeleteCustomer: nothing,
    onOpenChat: nothing, onOpenAppointment: nothing, onNewAppointment: nothing,
    cannotDelete: (item) => deletionDependency('customer', item.id, item.name, demoEvents, demoRequests),
  }));
  assert.ok(profile.includes(theirs.find((event) => event.customerId === customer)!.serviceName));
});
