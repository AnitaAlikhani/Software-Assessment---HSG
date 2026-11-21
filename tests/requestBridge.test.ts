import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { appointmentFromRequest, appointmentIdForRequest, upsertAppointment } from '../src/appointmentActions';
import { customerForRequest, upsertCustomer } from '../src/bookingData';
import type { DemoStore } from '../src/demoStore';
import { initialEmployees, initialServices } from '../src/mockData';
import { arrivedRequests, ownRequestNow, withOutcome, type RequestOutcomes } from '../src/sharedRequests';
import type { AppointmentRequest, CalendarEvent, Customer } from '../src/types';
import { BrowserStandIn, ClockStandIn, storeFor, type TabStandIn } from './browserStandIn';
import { demoCustomers, demoEvents, demoRequests } from './fixedClock';

// The customers' booking page in one tab ("Open as customer"), the owner's app in another. There
// used to be a bridge between them that handed requests over (src/requestBridge.ts). Now both
// tabs read and write the same stored salon, and these tests walk the same journey through it:
// each "tab" below writes what the app's handlers write (src/App.tsx), and reads what its
// screens read.

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** One tab of the browser with the parts of the salon the journey touches. */
class Tab {
  readonly store: DemoStore;
  /** The owner's tab announces what `arrivedRequests` reports, as the app does with a message. */
  readonly announced: string[] = [];
  private readonly seen = new Set<string>();

  constructor(readonly tab: TabStandIn, clock: ClockStandIn) {
    this.store = storeFor(tab, clock);
    this.draw();
    this.store.watch<AppointmentRequest[]>('requests', (before, after) => {
      this.announced.push(...arrivedRequests(before, after, this.seen).map((request) => request.customerName));
      this.draw();
    });
  }

  get requests() { return this.store.read('requests', demoRequests); }
  get events() { return this.store.read('calendarEvents', demoEvents); }
  get customers() { return this.store.read('customers', demoCustomers); }
  get outcomes() { return this.store.read<RequestOutcomes>('requestOutcomes', {}); }
  /** Which request is this tab's own. It stays with the tab. */
  get own() { return this.store.read<AppointmentRequest | null>('submittedRequest', null); }
  /** What the customers' page shows for its own request. */
  get standing() { return this.own ? ownRequestNow(this.own, { requests: this.requests, events: this.events, outcomes: this.outcomes }) : null; }
  /** Draws the tab's screens: every part is read, and each request in the list counts as shown in this tab. */
  draw() {
    void [this.events, this.customers, this.outcomes, this.own];
    for (const request of this.requests) this.seen.add(request.id);
  }

  // ----- the customers' page -----

  /** "Request appointment": the request joins the list, its customer the customer list. */
  send(request: AppointmentRequest) {
    const customer = customerForRequest(this.customers, request);
    const saved = { ...request, customerId: customer.id, customerPhone: customer.phone, isAiBooked: false };
    this.store.write<AppointmentRequest[]>('requests', (previous) => [saved, ...previous]);
    this.store.write<Customer[]>('customers', (previous) => upsertCustomer(previous, customer));
    this.store.write<AppointmentRequest | null>('submittedRequest', saved);
    this.draw();
  }
  /** "Save request changes". Why it was refused, or null. */
  change(patch: Partial<AppointmentRequest>): string | null {
    const waiting = this.requests.find((item) => item.id === this.own?.id && item.status === 'pending');
    if (!waiting) return 'This request is no longer pending. Check its latest status before making changes.';
    const saved = { ...waiting, ...patch };
    this.store.write<AppointmentRequest[]>('requests', (previous) => previous.map((item) => item.id === saved.id ? saved : item));
    this.store.write<AppointmentRequest | null>('submittedRequest', saved);
    return null;
  }
  /** "Yes, cancel request". Why it was refused, or null. */
  withdraw(): string | null {
    const id = this.own?.id;
    if (!this.requests.some((item) => item.id === id && item.status === 'pending')) return 'This request is no longer pending.';
    this.store.write<AppointmentRequest[]>('requests', (previous) => previous.filter((item) => item.id !== id));
    this.store.write<AppointmentRequest | null>('submittedRequest', (previous) => previous && { ...previous, status: 'cancelled' });
    return null;
  }

  // ----- the owner's Home -----

  accept(id: string) {
    const request = this.requests.find((item) => item.id === id)!;
    this.store.write<AppointmentRequest[]>('requests', (previous) => previous.filter((item) => item.id !== id));
    this.store.write<RequestOutcomes>('requestOutcomes', (previous) => withOutcome(previous, id, 'accepted'));
    this.store.write<CalendarEvent[]>('calendarEvents', (previous) => upsertAppointment(previous, appointmentFromRequest(request, initialServices, initialEmployees)));
    return request;
  }
  reject(id: string) {
    const request = this.requests.find((item) => item.id === id)!;
    this.store.write<AppointmentRequest[]>('requests', (previous) => previous.filter((item) => item.id !== id));
    this.store.write<RequestOutcomes>('requestOutcomes', (previous) => withOutcome(previous, id, 'rejected'));
    return request;
  }
  /** "Undo": the request waits again; an appointment the acceptance made goes. */
  undo(before: AppointmentRequest) {
    this.store.write<CalendarEvent[]>('calendarEvents', (previous) => previous.filter((event) => event.id !== appointmentIdForRequest(before.id)));
    this.store.write<AppointmentRequest[]>('requests', (previous) => [before, ...previous]);
    this.store.write<RequestOutcomes>('requestOutcomes', (previous) => withOutcome(previous, before.id, null));
    this.draw();
  }
}

function ownerAndCustomer() {
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const owner = new Tab(browser.openTab(), clock);
  const customer = new Tab(browser.openTab(), clock);
  return { browser, clock, owner, customer };
}

// The request as the booking page builds it. FIXED_NOW is Monday 5 October 2026; Thursday is free at ten.
const fromThePage: AppointmentRequest = {
  id: 'req-from-the-page', customerName: 'Sandra Keller', customerPhone: '+41791234567',
  serviceId: 'srv-2', serviceName: 'Haircut', employeeId: 'emp-1', staffName: 'Anna Weber',
  date: '2026-10-08', dateStr: 'Thu, 08.10.2026', timeStr: '10:00 - 10:30', timeAgo: 'Just now', createdAt: '2026-10-05T09:58:00.000Z',
  channel: 'Web', isAiBooked: false, status: 'pending',
};

test('a request sent on the customers\' page is on Home in the owner\'s tab, and that tab says so once', async () => {
  const { browser, clock, owner, customer } = ownerAndCustomer();
  const before = owner.requests.length;
  customer.send(fromThePage);
  await settled();
  // The request heads the owner's list, still waiting, and the owner's tab announces it by name.
  assert.equal(owner.requests.length, before + 1);
  assert.equal(owner.requests[0].id, 'req-from-the-page');
  assert.equal(owner.requests[0].status, 'pending');
  assert.deepEqual(owner.announced, ['Sandra Keller']);
  // Both tabs share one customer list: the record the request made is the same one in both.
  const record = owner.customers.find((item) => item.id === owner.requests[0].customerId)!;
  assert.equal(record.name, 'Sandra Keller');
  assert.equal(record.phone, '+41791234567');
  assert.equal(owner.customers.length, demoCustomers.length + 1);
  assert.deepEqual(customer.customers, owner.customers);
  // The tab that sent it announces nothing: it made the change itself.
  assert.deepEqual(customer.announced, []);

  // After a reload of the owner's tab the request is simply there. Nothing is announced again.
  const reloaded = new Tab(owner.tab, clock);
  assert.equal(reloaded.requests[0].id, 'req-from-the-page');
  assert.deepEqual(reloaded.announced, []);
  // Nor does a later tab of the owner's announce what was stored before it opened.
  assert.deepEqual(new Tab(browser.openTab(), clock).announced, []);
});

test('a customer the salon already knows is matched by the digits of the phone number', async () => {
  const { owner, customer } = ownerAndCustomer();
  const known = demoCustomers.find((item) => item.phone)!;
  const spelled = `0${known.phone.slice(3, 5)} ${known.phone.slice(5, 8)} ${known.phone.slice(8, 10)} ${known.phone.slice(10)}`;
  customer.send({ ...fromThePage, customerName: known.name, customerPhone: spelled });
  await settled();
  assert.equal(owner.requests[0].customerId, known.id);
  assert.equal(owner.requests[0].customerPhone, known.phone);
  assert.equal(owner.customers.length, demoCustomers.length);
});

test('the owner\'s tab announces only requests that are new to it, and never its own changes', async () => {
  const { browser, clock, owner, customer } = ownerAndCustomer();
  // The owner's tab sleeps in the background while two customers send a request, one after the
  // other. Back at the front it hears of both at once, and announces both.
  const second = new Tab(browser.openTab(), clock);
  owner.tab.asleep = true;
  customer.send(fromThePage);
  await settled();
  second.send({ ...fromThePage, id: 'req-second', customerName: 'Petra Muster', customerPhone: '+41791112233', timeStr: '11:00 - 11:30' });
  await settled();
  assert.deepEqual(owner.announced, []);
  owner.tab.asleep = false;
  owner.tab.window.fire('focus');
  assert.deepEqual(owner.requests.slice(0, 2).map((item) => item.id), ['req-second', 'req-from-the-page']);
  assert.deepEqual(owner.announced.sort(), ['Petra Muster', 'Sandra Keller']);

  // What the owner does in this tab is no arrival: rejecting, and taking the rejection back.
  const rejected = owner.reject('req-second');
  owner.undo(rejected);
  await settled();
  assert.equal(owner.announced.length, 2);
  // A second owner tab takes an answer back: the request returns to the list, but it is not new here.
  const otherOwnerTab = new Tab(browser.openTab(), clock);
  const again = otherOwnerTab.reject('req-from-the-page');
  await settled();
  otherOwnerTab.undo(again);
  await settled();
  assert.ok(owner.requests.some((item) => item.id === 'req-from-the-page'));
  assert.equal(owner.announced.length, 2);
});

test('the customer\'s tab learns the answer: confirmed after Accept, rejected after Reject', async () => {
  const { browser, clock, owner, customer } = ownerAndCustomer();
  customer.send(fromThePage);
  await settled();
  assert.equal(customer.standing?.status, 'pending');

  owner.accept('req-from-the-page');
  await settled();
  // Confirmed, with the details of the appointment in the calendar. Only a waiting request offers "Edit" and "Cancel".
  const confirmed = customer.standing!;
  assert.equal(confirmed.status, 'accepted');
  assert.deepEqual([confirmed.date, confirmed.timeStr, confirmed.serviceName, confirmed.staffName], ['2026-10-08', '10:00 - 10:30', 'Haircut', 'Anna Weber']);
  // The page keeps the state after a reload of either tab: it is read from the stored salon.
  assert.equal(new Tab(customer.tab, clock).standing?.status, 'accepted');
  assert.equal(new Tab(owner.tab, clock).events.some((event) => event.id === 'cal-req-from-the-page'), true);

  // Which request is the customer's own stays with that tab: the owner's tab and a new tab have none.
  assert.equal(owner.own, null);
  assert.equal(new Tab(browser.openTab(), clock).standing, null);

  // Another customer is rejected.
  const other = new Tab(browser.openTab(), clock);
  other.send({ ...fromThePage, id: 'req-other', customerName: 'Petra Muster', customerPhone: '+41791112233', timeStr: '11:00 - 11:30' });
  await settled();
  const rejected = owner.reject('req-other');
  await settled();
  assert.equal(other.standing?.status, 'rejected');
  assert.equal(customer.standing?.status, 'accepted');
  // The owner takes the rejection back: the request waits again and can be changed again.
  owner.undo(rejected);
  await settled();
  assert.equal(other.standing?.status, 'pending');
  assert.deepEqual(owner.outcomes, { 'req-from-the-page': 'accepted' });
});

test('a change by the customer to a waiting request, and its withdrawal, reach the owner\'s tab', async () => {
  const { owner, customer } = ownerAndCustomer();
  customer.send(fromThePage);
  await settled();
  assert.equal(customer.change({ timeStr: '11:00 - 11:30' }), null);
  await settled();
  const changed = owner.requests.find((item) => item.id === 'req-from-the-page')!;
  assert.equal(changed.timeStr, '11:00 - 11:30');
  assert.equal(changed.status, 'pending');
  // A change is no new request: it is announced once, when it first arrived.
  assert.deepEqual(owner.announced, ['Sandra Keller']);
  // The owner moves it to another time: the customer's page shows the request as the salon has it now.
  owner.store.write<AppointmentRequest[]>('requests', (previous) => previous.map((item) => item.id === changed.id ? { ...item, timeStr: '15:00 - 15:30' } : item));
  await settled();
  assert.equal(customer.standing?.timeStr, '15:00 - 15:30');

  assert.equal(customer.withdraw(), null);
  await settled();
  assert.equal(owner.requests.some((item) => item.id === 'req-from-the-page'), false);
  assert.equal(customer.standing?.status, 'cancelled');
  // Nothing is left to withdraw.
  assert.equal(customer.withdraw(), 'This request is no longer pending.');
});

test('a request the owner has answered can no longer be changed or withdrawn by the customer', async () => {
  const { owner, customer } = ownerAndCustomer();
  customer.send(fromThePage);
  await settled();
  // The customer's tab sleeps in the background while the owner accepts, and hears nothing.
  customer.tab.asleep = true;
  owner.accept('req-from-the-page');
  await settled();
  // Back at the front it has caught up before the customer can do anything: the request shows as
  // confirmed, and the page offers neither "Edit request" nor "Cancel request" for it.
  customer.tab.asleep = false;
  customer.tab.window.fire('visibilitychange');
  assert.equal(customer.standing?.status, 'accepted');
  // The handlers refuse as well, should a change be tried all the same.
  assert.equal(customer.change({ timeStr: '12:00 - 12:30' }), 'This request is no longer pending. Check its latest status before making changes.');
  assert.equal(customer.withdraw(), 'This request is no longer pending.');
  await settled();
  // The owner's answer stands: the appointment is in the calendar as accepted, and no request waits.
  const appointment = owner.events.find((event) => event.id === 'cal-req-from-the-page')!;
  assert.equal(`${appointment.startTime} - ${appointment.endTime}`, '10:00 - 10:30');
  assert.equal(owner.requests.some((item) => item.id === 'req-from-the-page'), false);
});

test('a confirmed appointment that the owner changes or removes in the calendar shows as it is now', async () => {
  const { owner, customer } = ownerAndCustomer();
  customer.send(fromThePage);
  await settled();
  owner.accept('req-from-the-page');
  await settled();
  owner.store.write<CalendarEvent[]>('calendarEvents', (previous) => previous.map((event) => event.id === 'cal-req-from-the-page'
    ? { ...event, date: '2026-10-09', startTime: '14:00', endTime: '14:30', employeeId: 'emp-2', staffName: 'Selina Keller' } : event));
  await settled();
  const moved = customer.standing!;
  assert.deepEqual([moved.status, moved.date, moved.dateStr, moved.timeStr, moved.staffName], ['accepted', '2026-10-09', 'Fri, 09.10.2026', '14:00 - 14:30', 'Selina Keller']);
  // Removed from the calendar: the appointment no longer stands.
  owner.store.write<CalendarEvent[]>('calendarEvents', (previous) => previous.filter((event) => event.id !== 'cal-req-from-the-page'));
  await settled();
  assert.equal(customer.standing?.status, 'cancelled');
});

test('after a reset every tab starts fresh: the customer\'s tab shows no request the salon does not hold', async () => {
  const { owner, customer } = ownerAndCustomer();
  customer.send(fromThePage);
  await settled();
  owner.accept('req-from-the-page');
  await settled();
  assert.equal(customer.standing?.status, 'accepted');
  owner.store.reset();
  // The salon is the starting one again, in both tabs ...
  for (const tab of [owner, customer]) {
    assert.deepEqual(tab.requests, demoRequests);
    assert.equal(tab.events.some((event) => event.id === 'cal-req-from-the-page'), false);
    assert.deepEqual(tab.outcomes, {});
  }
  // ... and the customer's tab has let go of its request: the page shows the empty form, not a
  // confirmation for an appointment the salon does not have.
  assert.equal(customer.own, null);
  assert.equal(customer.standing, null);
  // A fresh salon is no arrival of requests.
  assert.deepEqual([...owner.announced, ...customer.announced], ['Sandra Keller']);
});

test('how the customer\'s own request stands is read from the salon', () => {
  const own = { ...fromThePage, customerId: 'cust-1' };
  const appointment = appointmentFromRequest(own, initialServices, initialEmployees);
  const nothing = { requests: demoRequests, events: demoEvents, outcomes: {} };
  // Waiting: the request as the list has it, not as the tab remembers it.
  const listed = { ...own, timeStr: '16:00 - 16:30' };
  assert.equal(ownRequestNow(own, { ...nothing, requests: [listed, ...demoRequests] }), listed);
  // Accepted: the appointment decides, whatever the tab remembers.
  for (const remembered of ['pending', 'accepted', 'rejected', 'cancelled'] as const) {
    assert.equal(ownRequestNow({ ...own, status: remembered }, { ...nothing, events: [appointment, ...demoEvents], outcomes: { [own.id]: 'accepted' } })?.status, 'accepted');
  }
  // Rejected: noted with the salon, for a tab that was not looking when it happened.
  assert.equal(ownRequestNow(own, { ...nothing, outcomes: { [own.id]: 'rejected' } })?.status, 'rejected');
  // Accepted, and the appointment is gone from the calendar since.
  assert.equal(ownRequestNow({ ...own, status: 'accepted' }, { ...nothing, outcomes: { [own.id]: 'accepted' } })?.status, 'cancelled');
  // Ended in this tab: it stays ended, also when the salon has forgotten it.
  assert.equal(ownRequestNow({ ...own, status: 'cancelled' }, nothing)?.status, 'cancelled');
  assert.equal(ownRequestNow({ ...own, status: 'rejected' }, nothing)?.status, 'rejected');
  // No trace in the salon of a request that should wait or stand: nothing to show.
  assert.equal(ownRequestNow(own, nothing), null);
  assert.equal(ownRequestNow({ ...own, status: 'accepted' }, nothing), null);
  // An id that happens to be the name of something every record has is no answer.
  assert.equal(ownRequestNow({ ...own, id: 'constructor' }, nothing), null);
  // A request of the same id that is listed with an answer does not count as waiting.
  assert.equal(ownRequestNow(own, { ...nothing, requests: [{ ...own, status: 'rejected' }] }), null);
});

test('an accepted request whose appointment the owner gives to somebody else reads as taken out by the salon', () => {
  const own = { ...fromThePage, customerId: 'cust-1' };
  const appointment = appointmentFromRequest(own, initialServices, initialEmployees);
  const salon = (event: CalendarEvent) => ({ requests: demoRequests, events: [event, ...demoEvents], outcomes: { [own.id]: 'accepted' as const } });
  // Still the customer's: confirmed, also after the owner moved it.
  assert.equal(ownRequestNow(own, salon({ ...appointment, startTime: '17:00', endTime: '17:30' }))?.status, 'accepted');
  // Given to Petra Meier: for the customer it is cancelled by the salon, and nothing of Petra shows.
  const petras = { ...appointment, customerId: 'cust-001', customerName: 'Petra Meier', customerPhone: '+41765556242' };
  const standing = ownRequestNow({ ...own, status: 'accepted' }, salon(petras))!;
  assert.deepEqual([standing.status, standing.cancelledBy], ['cancelled', 'salon']);
  assert.deepEqual([standing.customerId, standing.customerName, standing.customerPhone], [own.customerId, own.customerName, own.customerPhone]);
  assert.doesNotMatch(JSON.stringify(standing), /Petra|76555/);
  // Given back to the customer: confirmed again.
  assert.equal(ownRequestNow(standing, salon(appointment))?.status, 'accepted');
  // A request remembered without a customer record is compared by name.
  const { customerId: _none, ...anonymous } = own;
  assert.equal(ownRequestNow(anonymous, salon({ ...appointment, customerId: 'cust-9' }))?.status, 'accepted');
  assert.equal(ownRequestNow(anonymous, salon(petras))?.status, 'cancelled');
});

test('the owner\'s answers are noted per request, and "Undo" takes the note away', () => {
  const none: RequestOutcomes = {};
  const accepted = withOutcome(none, 'req-1', 'accepted');
  assert.deepEqual(accepted, { 'req-1': 'accepted' });
  assert.deepEqual(none, {});
  const both = withOutcome(accepted, 'req-2', 'rejected');
  assert.deepEqual(both, { 'req-1': 'accepted', 'req-2': 'rejected' });
  // The same answer again, or taking back an answer that was never given, changes nothing: the
  // very same record comes back, so nothing is stored for it.
  assert.equal(withOutcome(both, 'req-2', 'rejected'), both);
  assert.equal(withOutcome(both, 'req-3', null), both);
  assert.deepEqual(withOutcome(both, 'req-1', null), { 'req-2': 'rejected' });
  assert.deepEqual(withOutcome(both, 'req-1', 'rejected'), { 'req-1': 'rejected', 'req-2': 'rejected' });
});

test('only a waiting request that this tab has never shown counts as arrived', () => {
  const [first, second] = demoRequests;
  const fresh = { ...fromThePage };
  assert.deepEqual(arrivedRequests([first, second], [fresh, first, second], new Set([first.id, second.id])), [fresh]);
  // Nothing new: a request changed, or one left the list.
  assert.deepEqual(arrivedRequests([first, second], [{ ...first, timeStr: '16:00 - 16:30' }, second], new Set()), []);
  assert.deepEqual(arrivedRequests([first, second], [second], new Set()), []);
  // A request this tab showed before and that comes back (an answer taken back elsewhere) is not new.
  assert.deepEqual(arrivedRequests([second], [first, second], new Set([first.id])), []);
  // Only a request that waits is announced.
  assert.deepEqual(arrivedRequests([], [{ ...fresh, status: 'cancelled' }], new Set()), []);
});

test('the owner\'s tab does not hand the customer\'s page another person\'s details', () => {
  // The app keeps the customer's page in step with an accepted request (src/App.tsx), but only
  // while the appointment is still that customer's.
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /setSubmittedRequest\(previous => previous && `cal-\$\{previous\.id\}` === saved\.id && isRequestersAppointment\(previous, saved\) \?/);
});
