/**
 * The salon's settings on the server (delivery 3B, contract points 2 and 3): the record and its
 * routes, who may call what, what a refused part reads, the check on `rev` that two saves at once
 * cannot beat, the customer's profile, and what each costs in storage commands. The storage is
 * the one in memory; the clock is frozen.
 */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { DELETE as deleteSalon, GET as readSalon, PUT as putSalon } from '../api/salon';
import { GET as readProfile } from '../api/salon/profile';
import { GET as ownerInbox } from '../api/whatsapp/conversations';
import { LIMIT_TEXTS, LIMITS } from '../server/limits';
import { BUILT_IN_SALON, readSalonRecord, SALON_LIMITS, salonPartProblem } from '../server/salon';
import { LIST_READ_SCRIPT, SALON_SAVE_SCRIPT } from '../server/store';
import { initialAiSettings } from '../src/conversationData';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData';
import type { ServiceItem } from '../src/types';
import { deployedWith, FakeStore } from './fakeStore';
import { CHAT_TOKEN, freezeClock, NOW, ownerInboxRequest, quietly, SETTINGS } from './liveChatHarness';

const SALON_KEY = 'slotbee:live:salon';
const ADDRESS = '203.0.113.9';
const OWNER = { 'x-live-key': 'right-key' };
const CUSTOMER = { 'x-chat-token': CHAT_TOKEN };

/** A call to /api/salon as the owner's app makes it. */
const salonRequest = (method: 'GET' | 'PUT' | 'DELETE', { body, access = OWNER, address = ADDRESS, raw }: { body?: unknown; access?: Record<string, string>; address?: string; raw?: string } = {}) =>
  new Request('https://site.invalid/api/salon', {
    method,
    headers: { 'Content-Type': 'application/json', ...access, ...(address ? { 'x-forwarded-for': address } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
const profileRequest = (access: Record<string, string> = CUSTOMER, address = ADDRESS) =>
  new Request('https://site.invalid/api/salon/profile', { headers: { ...access, 'x-forwarded-for': address } });

const call = async (handler: (request: Request) => Promise<Response>, request: Request) => {
  const response = await handler(request);
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, cache: response.headers.get('Cache-Control') };
};
const get = () => call(readSalon, salonRequest('GET'));
const put = (body: unknown) => call(putSalon, salonRequest('PUT', { body }));
const stored = (store: FakeStore) => JSON.parse(store.text(SALON_KEY) ?? 'null') as { rev: number; updatedAt: string; parts: Record<string, unknown> } | null;
const run = (store: FakeStore, work: () => Promise<unknown>) => deployedWith(SETTINGS, work, { store });
const fresh = (t: TestContext) => { freezeClock(t); return new FakeStore(NOW); };

const NOW_ISO = new Date(NOW).toISOString();
const renamed = { ...initialCompanySettings, companyName: 'Salon Rosa' };
const cheaperCut = initialServices.map(item => item.id === 'srv-2' ? { ...item, priceCHF: 49 } : item);
/** The start of a real PNG file: a logo has to be the picture it says it is. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA';
const christmas = [{ id: 'closed-1', name: 'Christmas', start: '2026-12-24', end: '2026-12-26' }];

test('GET without a record answers the built-in salon as no parts at revision 0, and stores nothing', async (t) => {
  const store = fresh(t);
  await run(store, async () => {
    assert.deepEqual(await get(), { status: 200, body: { rev: 0, parts: {} }, cache: 'no-store' });
  });
  assert.equal(store.text(SALON_KEY), null);
});

test('PUT of one part, then of several: each replaces only the parts it names, and the revision goes up by one', async (t) => {
  const store = fresh(t);
  await run(store, async () => {
    assert.deepEqual(await put({ baseRev: 0, parts: { companySettings: renamed } }), { status: 200, body: { rev: 1, updatedAt: NOW_ISO }, cache: 'no-store' });
    assert.deepEqual((await get()).body, { rev: 1, updatedAt: NOW_ISO, parts: { companySettings: renamed } });
    t.mock.timers.tick(60_000);
    const later = new Date(NOW + 60_000).toISOString();
    assert.deepEqual((await put({ baseRev: 1, parts: { services: cheaperCut, closedDates: christmas } })).body, { rev: 2, updatedAt: later });
    assert.deepEqual((await get()).body, { rev: 2, updatedAt: later, parts: { companySettings: renamed, services: cheaperCut, closedDates: christmas } });
  });
  // One value, its revision first, so the storage can read it without reading the rest.
  assert.match(store.text(SALON_KEY)!, /^\{"rev":2,"updatedAt":/);
  assert.deepEqual(Object.keys(stored(store)!.parts).sort(), ['closedDates', 'companySettings', 'services']);
});

test('every part of the built-in salon passes its own check, so the app can save what it starts with', () => {
  for (const [name, value] of Object.entries(BUILT_IN_SALON)) assert.equal(salonPartProblem(name, value), null, name);
  assert.equal(salonPartProblem('closedDates', christmas), null);
  assert.equal(salonPartProblem('absences', [{ id: 'absence-1', employeeId: 'emp-2', start: '2026-10-12', end: '2026-10-16', reason: 'Holiday' }]), null);
  assert.equal(salonPartProblem('shifts', [{ employeeId: 'emp-1', employeeName: 'Anna Weber', initials: 'AW', avatarColor: 'bg-rose-100 text-rose-700', shifts: { '2026-10-06': { start: '10:00', end: '14:00' }, '2026-10-07': null } }]), null);
  // An optional field the app leaves empty may come as null, as storedShapes.ts allows.
  assert.equal(salonPartProblem('services', [{ ...initialServices[0], category: null }]), null);
});

test('a wrong baseRev gets 409 with the record as it is now, and nothing is saved', async (t) => {
  const store = fresh(t);
  await run(store, async () => {
    await put({ baseRev: 0, parts: { companySettings: renamed } });
    const before = store.text(SALON_KEY);
    for (const baseRev of [0, 2, 7]) {
      const refused = await put({ baseRev, parts: { services: cheaperCut } });
      assert.deepEqual(refused, {
        status: 409, cache: 'no-store',
        body: { error: 'The salon was changed on another device. Look at it and save again.', rev: 1, updatedAt: NOW_ISO, parts: { companySettings: renamed } },
      }, `baseRev ${baseRev}`);
    }
    assert.equal(store.text(SALON_KEY), before);
  });
  // Without a record, only baseRev 0 saves.
  const empty = new FakeStore(NOW);
  await run(empty, async () => {
    assert.deepEqual((await put({ baseRev: 3, parts: { companySettings: renamed } })).body, { error: 'The salon was changed on another device. Look at it and save again.', rev: 0, parts: {} });
  });
  assert.equal(empty.text(SALON_KEY), null);
});

test('two PUTs on the same revision at once: exactly one wins, the other gets 409 with the winner\'s record', async (t) => {
  const store = fresh(t);
  await run(store, async () => {
    await put({ baseRev: 0, parts: { companySettings: renamed } });
    // Both read revision 1 before either saves: the storage's own check decides.
    const [a, b] = await Promise.all([
      put({ baseRev: 1, parts: { services: cheaperCut } }),
      put({ baseRev: 1, parts: { closedDates: christmas } }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const [won, lost] = a.status === 200 ? [a, b] : [b, a];
    assert.equal(won.body.rev, 2);
    assert.equal(lost.body.rev, 2);
    assert.equal(lost.body.error, 'The salon was changed on another device. Look at it and save again.');
    assert.deepEqual(lost.body.parts, stored(store)!.parts);
    // The lost change is not in the record; the winner's is.
    const parts = stored(store)!.parts;
    assert.equal(Object.hasOwn(parts, 'services') !== Object.hasOwn(parts, 'closedDates'), true);
    // Ten at once on the same revision: still exactly one.
    const many = await Promise.all(Array.from({ length: 10 }, (_, index) => put({ baseRev: 2, parts: { companySettings: { ...renamed, companyName: `Salon ${index}` } } })));
    assert.equal(many.filter(item => item.status === 200).length, 1);
    assert.equal(stored(store)!.rev, 3);
  });
});

test('DELETE resets to the built-in salon and keeps counting: the revision never goes back', async (t) => {
  const store = fresh(t);
  await run(store, async () => {
    // Without a record there is nothing to reset, and nothing is written.
    assert.deepEqual(await call(deleteSalon, salonRequest('DELETE')), { status: 200, body: { rev: 0 }, cache: 'no-store' });
    assert.equal(store.text(SALON_KEY), null);
    await put({ baseRev: 0, parts: { companySettings: renamed } });
    t.mock.timers.tick(60_000);
    const later = new Date(NOW + 60_000).toISOString();
    assert.deepEqual(await call(deleteSalon, salonRequest('DELETE')), { status: 200, body: { rev: 2, updatedAt: later }, cache: 'no-store' });
    assert.deepEqual((await get()).body, { rev: 2, updatedAt: later, parts: {} });
    // A save made on the record before the reset is refused, with the reset record.
    assert.deepEqual((await put({ baseRev: 1, parts: { closedDates: christmas } })).body, { error: 'The salon was changed on another device. Look at it and save again.', rev: 2, updatedAt: later, parts: {} });
    assert.equal((await put({ baseRev: 2, parts: { companySettings: renamed } })).body.rev, 3);
    // A reset of a reset counts on too.
    assert.equal((await call(deleteSalon, salonRequest('DELETE'))).body.rev, 4);
    assert.equal((await call(deleteSalon, salonRequest('DELETE'))).body.rev, 5);
  });
});

test('a device that held revision 1 before a reset and one save never finds revision 1 again', async (t) => {
  const store = fresh(t);
  const revision = async () => ((await (await ownerInbox(ownerInboxRequest({ address: ADDRESS }))).json()) as { salonRev: number }).salonRev;
  await run(store, async () => {
    await put({ baseRev: 0, parts: { companySettings: renamed } });
    const held = await revision();
    assert.equal(held, 1);
    // Meanwhile, on other devices: a reset, then one save.
    await call(deleteSalon, salonRequest('DELETE'));
    await put({ baseRev: 2, parts: { closedDates: christmas } });
    // The device that comes back sees another revision, reloads, and its old save is refused.
    assert.equal(await revision(), 3);
    assert.notEqual(await revision(), held);
    assert.equal((await put({ baseRev: held, parts: { services: cheaperCut } })).status, 409);
  });
});

test('a reset that meets other saves reads again and wins in the end', async (t) => {
  const store = fresh(t);
  await run(store, async () => {
    await put({ baseRev: 0, parts: { companySettings: renamed } });
    const [reset, saved] = await Promise.all([call(deleteSalon, salonRequest('DELETE')), put({ baseRev: 1, parts: { closedDates: christmas } })]);
    assert.equal(reset.status, 200);
    // Whichever came first, the reset is the last word and its revision is the stored one.
    assert.deepEqual(stored(store)!.parts, {});
    assert.equal(stored(store)!.rev, reset.body.rev);
    assert.ok([200, 409].includes(saved.status));
  });
});

test('only the owner\'s key in its header opens /api/salon; only the customer\'s token opens the profile', async (t) => {
  const store = fresh(t);
  await run(store, async () => {
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const handler = { GET: readSalon, PUT: putSalon, DELETE: deleteSalon }[method];
      const body = method === 'PUT' ? { baseRev: 0, parts: { companySettings: renamed } } : undefined;
      for (const access of [{}, { 'x-live-key': 'wrong' }, CUSTOMER, { 'x-live-key': CHAT_TOKEN }] as Record<string, string>[]) {
        assert.deepEqual(await call(handler, salonRequest(method, { body, access })), { status: 401, body: { error: 'No access' }, cache: 'no-store' }, `${method} ${JSON.stringify(access)}`);
      }
      // A key in the address is no key.
      const inAddress = new Request('https://site.invalid/api/salon?key=right-key&live=right-key', { method, body: body && JSON.stringify(body) });
      assert.equal((await handler(inAddress)).status, 401, method);
    }
    for (const access of [{}, OWNER, { 'x-chat-token': 'guess' }] as Record<string, string>[]) {
      assert.deepEqual(await call(readProfile, profileRequest(access)), { status: 401, body: { error: 'This chat link is no longer valid. Please ask the salon for a new one.' }, cache: 'no-store' });
    }
    assert.equal((await call(readProfile, profileRequest())).status, 200);
  });
  assert.equal(store.text(SALON_KEY), null);
});

test('wrong keys on the new routes are counted, and a waiting address is refused on every one of them', async (t) => {
  const store = fresh(t);
  await run(store, async () => {
    for (let i = 1; i <= LIMITS.wrongTries.most; i += 1) {
      const handler = [readSalon, putSalon, deleteSalon][i % 3];
      assert.equal((await handler(salonRequest(['GET', 'PUT', 'DELETE'][i % 3] as 'GET', { access: { 'x-live-key': `guess-${i}` } }))).status, 401, `try ${i}`);
    }
    // One more wrong one, here a wrong token on the profile: the address now waits.
    assert.deepEqual((await call(readProfile, profileRequest({ 'x-chat-token': 'guess' }))).body, { error: LIMIT_TEXTS.wrongTriesCustomer });
    for (const [handler, method] of [[readSalon, 'GET'], [putSalon, 'PUT'], [deleteSalon, 'DELETE']] as const) {
      const refused = await call(handler, salonRequest(method, { body: method === 'PUT' ? { baseRev: 0, parts: { companySettings: renamed } } : undefined }));
      assert.deepEqual([refused.status, refused.body], [429, { error: LIMIT_TEXTS.wrongTriesOwner }], method);
    }
    assert.deepEqual(await call(readProfile, profileRequest()), { status: 429, body: { error: LIMIT_TEXTS.wrongTriesCustomer }, cache: 'no-store' });
    // Another address is not held up; this one is free again after the window.
    assert.equal((await call(readSalon, salonRequest('GET', { address: '198.51.100.4' }))).status, 200);
    t.mock.timers.tick(10 * 60_000);
    store.advance(10 * 60_000);
    assert.equal((await get()).status, 200);
    assert.equal((await call(readProfile, profileRequest())).status, 200);
  });
  // Nothing was saved by a refused PUT.
  assert.equal(store.text(SALON_KEY), null);
});

const service = (extra: Partial<ServiceItem> & Record<string, unknown> = {}) => ({ ...initialServices[1], ...extra });
const person = (extra: Record<string, unknown> = {}) => ({ ...initialEmployees[1], ...extra });

/** Each kind of part the server refuses, with the sentence the owner reads. */
const REFUSED: [string, unknown, string][] = [
  ['an unknown part', { baseRev: 0, parts: { customers: [] } }, '“customers” is not a part of the salon\'s settings.'],
  ['no part', { baseRev: 0, parts: {} }, 'There is nothing to save: the change names no part of the salon.'],
  ['no revision', { parts: { companySettings: renamed } }, 'The change does not say which version of the salon it was made on. Reload the page and try again.'],
  ['a revision that is no whole number', { baseRev: -1, parts: { companySettings: renamed } }, 'The change does not say which version of the salon it was made on. Reload the page and try again.'],
  ['a part of the wrong kind', { baseRev: 0, parts: { services: { srv: 1 } } }, 'Services: the list is not a list.'],
  ['too many services', { baseRev: 0, parts: { services: Array.from({ length: 201 }, (_, index) => service({ id: `s${index}` })) } }, 'Services: the list has 201 entries; at most 200 can be saved.'],
  ['too many people', { baseRev: 0, parts: { employees: Array.from({ length: 101 }, (_, index) => person({ id: `e${index}` })) } }, 'Team: the list has 101 entries; at most 100 can be saved.'],
  ['too many closed dates', { baseRev: 0, parts: { closedDates: Array.from({ length: 401 }, (_, index) => ({ ...christmas[0], id: `c${index}` })) } }, 'Closed dates: the list has 401 entries; at most 400 can be saved.'],
  ['two services with one id', { baseRev: 0, parts: { services: [service(), service({ name: 'Second cut' })] } }, 'Services: service 2 (“Second cut”) has the same id as service 1.'],
  ['a field the salon does not know', { baseRev: 0, parts: { services: [service({ secret: 'x' })] } }, 'Services: service 1 (“Haircut”) has a field the salon does not know (“secret”).'],
  ['a missing field', { baseRev: 0, parts: { services: [{ ...service(), priceCHF: undefined }] } }, 'Services: the price of service 1 (“Haircut”) is missing.'],
  ['a price out of range', { baseRev: 0, parts: { services: [service({ priceCHF: -5 })] } }, 'Services: the price of service 1 (“Haircut”) must be a number from 0 to 100000.'],
  ['a price that is no number', { baseRev: 0, parts: { services: [service({ priceCHF: '55' as unknown as number })] } }, 'Services: the price of service 1 (“Haircut”) must be a number from 0 to 100000.'],
  ['a duration that is no whole number', { baseRev: 0, parts: { services: [service({ durationMinutes: 30.5 })] } }, 'Services: the duration in minutes of service 1 (“Haircut”) must be a whole number from 1 to 1439.'],
  ['a service longer than a day', { baseRev: 0, parts: { services: [service({ durationMinutes: 1400, prepMinutes: 30, postMinutes: 30 })] } }, 'Services: service 1 (“Haircut”) with its preparation and cleanup is longer than a day.'],
  ['a service without a name', { baseRev: 0, parts: { services: [service({ name: '  ' })] } }, 'Services: the name of service 1 is empty.'],
  ['a name that is too long', { baseRev: 0, parts: { services: [service({ name: 'x'.repeat(121) })] } }, `Services: the name of service 1 (“${'x'.repeat(39)}…”) is longer than 120 characters.`],
  ['a status the app does not know', { baseRev: 0, parts: { employees: [person({ status: 'Away' })] } }, 'Team: the status of person 1 (“Selina Keller”) must be one of Active, Inactive.'],
  ['regular hours that end before they start', { baseRev: 0, parts: { employees: [person({ weeklyHours: { ...initialEmployees[1].weeklyHours, wed: { start: '18:00', end: '10:00' } } })] } }, 'Team: the regular hours of person 1 (“Selina Keller”) on Wednesday must end after they start.'],
  ['regular hours on a day that is no weekday', { baseRev: 0, parts: { employees: [person({ weeklyHours: { holiday: null } })] } }, 'Team: the regular hours of person 1 (“Selina Keller”) names a day that is no weekday (“holiday”).'],
  ['a week without Sunday', { baseRev: 0, parts: { bookingHours: initialBookingHours.slice(0, 6) } }, 'Opening hours: the list must name each of the seven days of the week once.'],
  ['a day listed twice', { baseRev: 0, parts: { bookingHours: [...initialBookingHours.slice(0, 6), initialBookingHours[0]] } }, 'Opening hours: Monday is listed twice.'],
  ['closing before opening', { baseRev: 0, parts: { bookingHours: initialBookingHours.map(day => day.day === 'Friday' ? { ...day, to: '08:00' } : day) } }, 'Opening hours: on Friday the closing time must be after the opening time.'],
  ['a time that is no time', { baseRev: 0, parts: { bookingHours: initialBookingHours.map(day => day.day === 'Friday' ? { ...day, to: '25:00' } : day) } }, 'Opening hours: the closing time of Friday is not a time of day (hours:minutes).'],
  ['a date that does not exist', { baseRev: 0, parts: { closedDates: [{ ...christmas[0], end: '2026-11-31' }] } }, 'Closed dates: the last day of closed date 1 (“Christmas”) is not a date (year-month-day).'],
  ['a closed date that ends before it starts', { baseRev: 0, parts: { closedDates: [{ ...christmas[0], start: '2026-12-27' }] } }, 'Closed dates: closed date 1 (“Christmas”) ends before it starts.'],
  ['an absence that ends before it starts', { baseRev: 0, parts: { absences: [{ id: 'a1', employeeId: 'emp-1', start: '2026-10-10', end: '2026-10-09' }] } }, 'Absences: absence 1 ends before it starts.'],
  ['a shift on a day that is no date', { baseRev: 0, parts: { shifts: [{ employeeId: 'emp-1', employeeName: 'Anna Weber', initials: 'AW', avatarColor: 'x', shifts: { tomorrow: null } }] } }, 'Shifts: the days of person 1 (“Anna Weber”) names a day that is no date (“tomorrow”).'],
  ['two shift entries for one person', { baseRev: 0, parts: { shifts: [1, 2].map(() => ({ employeeId: 'emp-1', employeeName: 'Anna Weber', initials: 'AW', avatarColor: 'x', shifts: {} })) } }, 'Shifts: person 2 (“Anna Weber”) has the same person as person 1.'],
  ['a salon without a name', { baseRev: 0, parts: { companySettings: { ...initialCompanySettings, companyName: '' } } }, 'Salon details: the salon name is empty.'],
  ['a time zone that does not exist', { baseRev: 0, parts: { companySettings: { ...initialCompanySettings, timeZone: 'Mars/Olympus' } } }, 'Salon details: the time zone is not a time zone.'],
  ['a logo that is no picture', { baseRev: 0, parts: { companySettings: { ...initialCompanySettings, logoDataUrl: 'javascript:alert(1)' } } }, 'Salon details: the logo is not a PNG, JPEG or WebP picture.'],
  ['a logo that is too large', { baseRev: 0, parts: { companySettings: { ...initialCompanySettings, logoDataUrl: `data:image/png;base64,${'A'.repeat(SALON_LIMITS.logoCharacters)}` } } }, 'Salon details: the logo is too large: choose a picture smaller than 500 KB.'],
  ['a tone the AI does not know', { baseRev: 0, parts: { aiSettings: { ...initialAiSettings, tone: 'rude' } } }, 'AI settings: the tone must be one of friendly, formal.'],
  ['a language the AI does not offer', { baseRev: 0, parts: { aiSettings: { ...initialAiSettings, answerLanguages: { ...initialAiSettings.answerLanguages, ES: true } } } }, 'AI settings: the answer languages names a language the AI does not offer (“ES”).'],
  ['a handover rule without text', { baseRev: 0, parts: { aiSettings: { ...initialAiSettings, handoverRules: [{ id: 'r', label: '', enabled: true }] } } }, 'AI settings: the text of handover rule 1 is empty.'],
];

test('each kind of refused part: 400 with one sentence that names the part and what is wrong, and nothing is saved', async (t) => {
  const store = fresh(t);
  await run(store, async () => {
    await put({ baseRev: 0, parts: { companySettings: renamed } });
    const before = store.text(SALON_KEY);
    for (const [kind, body, error] of REFUSED) {
      const withRev = { ...(body as Record<string, unknown>), ...('baseRev' in (body as object) && (body as { baseRev: number }).baseRev === 0 ? { baseRev: 1 } : {}) };
      assert.deepEqual(await put(withRev), { status: 400, body: { error }, cache: 'no-store' }, kind);
    }
    // One good part beside a refused one: the whole change is refused.
    assert.equal((await put({ baseRev: 1, parts: { closedDates: christmas, services: [service({ priceCHF: -1 })] } })).status, 400);
    // A body that is no JSON, or too large to keep.
    assert.deepEqual((await call(putSalon, salonRequest('PUT', { raw: '{"baseRev":1,' }))).body, { error: 'The change could not be read. Reload the page and try again.' });
    const huge = await call(putSalon, salonRequest('PUT', { raw: JSON.stringify({ baseRev: 1, parts: { companySettings: { ...renamed, description: 'x'.repeat(1_000_000) } } }) }));
    assert.deepEqual([huge.status, huge.body], [413, { error: 'This change is too large to save. A smaller logo may help.' }]);
    assert.equal(store.text(SALON_KEY), before);
  });
});

test('a record that grows too large with a new part is refused with 413 and stays as it was', async (t) => {
  const store = fresh(t);
  const logo = `${PNG}${'A'.repeat(SALON_LIMITS.logoCharacters - 100)}`;
  await run(store, async () => {
    assert.equal((await put({ baseRev: 0, parts: { companySettings: { ...renamed, logoDataUrl: logo } } })).status, 200);
    const before = store.text(SALON_KEY);
    const tooMuch = Array.from({ length: 200 }, (_, index) => service({ id: `s${index}`, description: 'x'.repeat(1000) }));
    const refused = await put({ baseRev: 1, parts: { services: tooMuch } });
    assert.deepEqual([refused.status, refused.body], [413, { error: 'The salon’s settings would be too large to save. A smaller logo may help.' }]);
    assert.equal(store.text(SALON_KEY), before);
  });
});

test('the profile gives the name, the bookable services, the hours, the closed dates ahead and the time zone, and nothing else', async (t) => {
  const store = fresh(t);
  await run(store, async () => {
    // Without a record: the built-in salon.
    const builtIn = await call(readProfile, profileRequest());
    assert.deepEqual(builtIn.body, {
      companyName: 'Bella Hair Salon',
      phone: '',
      services: initialServices.filter(item => item.onlineBooking).map(({ name, durationMinutes, priceCHF }) => ({ name, durationMinutes, priceCHF })),
      bookingHours: initialBookingHours,
      closedDates: [],
      timeZone: 'Europe/Zurich',
    });
    assert.ok(!(builtIn.body.services as { name: string }[]).some(item => item.name === 'Colouring'));
    await put({
      baseRev: 0,
      parts: {
        companySettings: { ...renamed, businessPhone: '+41715550000', timeZone: 'Europe/Zurich (GMT+01:00)', termsText: 'Our terms', logoDataUrl: `${PNG}AAAA` },
        services: cheaperCut.map(item => item.id === 'srv-1' ? { ...item, onlineBooking: false } : item),
        closedDates: [{ id: 'past', name: 'Summer break', start: '2026-08-01', end: '2026-08-14' }, { id: 'today', name: 'Inventory', start: '2026-10-01', end: '2026-10-05' }, ...christmas],
        employees: initialEmployees.map(item => ({ ...item, email: 'someone@bella-hair.example' })),
        absences: [{ id: 'absence-1', employeeId: 'emp-2', start: '2026-10-12', end: '2026-10-16', reason: 'Surgery' }],
        aiSettings: { ...initialAiSettings, tone: 'formal' },
      },
    });
    const { body } = await call(readProfile, profileRequest());
    assert.deepEqual(Object.keys(body), ['companyName', 'phone', 'services', 'bookingHours', 'closedDates', 'timeZone']);
    assert.equal(body.companyName, 'Salon Rosa');
    // The customer's chat page shows the salon's phone number.
    assert.equal(body.phone, '+41715550000');
    assert.deepEqual((body.services as { name: string }[]).map(item => item.name), ['Haircut', 'Cut & blow-dry', "Men's cut", "Children's cut", 'Updo']);
    assert.deepEqual((body.services as unknown[])[0], { name: 'Haircut', durationMinutes: 30, priceCHF: 49 });
    // Closed dates that have ended are not shown; one that ends today is.
    assert.deepEqual(body.closedDates, [{ name: 'Inventory', start: '2026-10-01', end: '2026-10-05' }, { name: 'Christmas', start: '2026-12-24', end: '2026-12-26' }]);
    assert.equal(body.timeZone, 'Europe/Zurich');
    const text = JSON.stringify(body);
    for (const secret of ['Anna', 'Selina', 'emp-', '@', 'Surgery', 'formal', 'Our terms', 'base64', 'srv-', 'right-key', CHAT_TOKEN, 'Shampoo']) {
      assert.ok(!text.includes(secret), secret);
    }
  });
});

test('the profile holds nothing else when the record holds odd extra data, and a broken part falls back to the built-in one', async (t) => {
  const store = fresh(t);
  // Written past the checks: an earlier version, a hand-made record, a part from a later delivery.
  store.run(['SET', SALON_KEY, JSON.stringify({
    rev: 4, updatedAt: NOW_ISO, extra: 'top-level',
    parts: {
      companySettings: { ...renamed, secretNote: 'the door code is 1234' },
      services: [{ ...initialServices[1], internalCost: 12, supplier: 'Wholesale AG' }],
      customers: [{ name: 'Eva Muster', phone: '+41790000000' }],
      bookingHours: 'always open',
      closedDates: christmas,
    },
  })]);
  await run(store, async () => {
    const { body } = await call(readProfile, profileRequest());
    assert.deepEqual(Object.keys(body), ['companyName', 'phone', 'services', 'bookingHours', 'closedDates', 'timeZone']);
    const text = JSON.stringify(body);
    for (const secret of ['door code', '1234', 'internalCost', 'Wholesale', 'Eva Muster', '+4179', 'always open', 'top-level']) assert.ok(!text.includes(secret), secret);
    // The broken parts are the built-in ones; the good one counts.
    assert.equal(body.companyName, 'Bella Hair Salon');
    assert.deepEqual(body.bookingHours, initialBookingHours);
    assert.deepEqual(body.closedDates, [{ name: 'Christmas', start: '2026-12-24', end: '2026-12-26' }]);
    // The owner's GET gives the parts that can be used, at the stored revision so her next save goes
    // over it, and names the shared parts that are stored but cannot be read.
    assert.deepEqual((await get()).body, { rev: 4, updatedAt: NOW_ISO, parts: { closedDates: christmas }, unreadable: ['companySettings', 'services', 'bookingHours'] });
    assert.equal((await put({ baseRev: 4, parts: { companySettings: renamed } })).body.rev, 5);
    assert.deepEqual((await get()).body.unreadable, ['services', 'bookingHours']);
  });
  // Reading deletes nothing: the save of one part kept the others as they were stored, unreadable ones too.
  const after = stored(store)!.parts;
  assert.deepEqual(Object.keys(after).sort(), ['bookingHours', 'closedDates', 'companySettings', 'customers', 'services']);
  assert.equal(after.bookingHours, 'always open');
  assert.deepEqual(after.companySettings, renamed);
  // A record that is no JSON at all keeps its revision and gives the built-in salon.
  assert.deepEqual(await quietly(async () => assert.deepEqual(readSalonRecord('{"rev":9,"parts":'), { rev: 9, parts: {} }))
    .then(errors => errors.length), 1);
});

test('storage commands: GET and the profile cost one read with the wrong-tries check, a PUT one read and one save, the chats\' poll no command more', async (t) => {
  const store = fresh(t);
  const getCommands = await run(store, async () => { await get(); });
  assert.deepEqual(getCommands.map(command => command[0]), ['MGET']);
  assert.equal(getCommands[0][1], SALON_KEY);
  const profileCommands = await run(store, async () => { await call(readProfile, profileRequest()); });
  assert.deepEqual(profileCommands.map(command => command[0]), ['MGET']);
  const putCommands = await run(store, async () => { await put({ baseRev: 0, parts: { companySettings: renamed } }); });
  assert.deepEqual(putCommands.map(command => [command[0], command[1]]), [['MGET', SALON_KEY], ['EVAL', SALON_SAVE_SCRIPT]]);
  // A stale revision is refused after the read, without a save.
  const staleCommands = await run(store, async () => { await put({ baseRev: 0, parts: { companySettings: renamed } }); });
  assert.deepEqual(staleCommands.map(command => command[0]), ['MGET']);
  // The owner's poll of the chats: a listing step and one script that reads the chats, the gate and the salon's revision.
  const pollCommands = await run(store, async () => { await ownerInbox(ownerInboxRequest({ address: ADDRESS })); });
  assert.deepEqual(pollCommands.map(command => [command[0], command[1]]), [['SCAN', '0'], ['EVAL', LIST_READ_SCRIPT]]);
  assert.equal(pollCommands[1].at(-1), SALON_KEY);
});

test('the chats\' answer says the salon\'s revision: 0 without a record, the new one after a save, and after a reset the next one', async (t) => {
  const store = fresh(t);
  const revision = async () => ((await (await ownerInbox(ownerInboxRequest({ address: ADDRESS }))).json()) as { salonRev: number }).salonRev;
  await run(store, async () => {
    assert.equal(await revision(), 0);
    await put({ baseRev: 0, parts: { companySettings: renamed } });
    assert.equal(await revision(), 1);
    await put({ baseRev: 1, parts: { closedDates: christmas } });
    assert.equal(await revision(), 2);
    await call(deleteSalon, salonRequest('DELETE'));
    // A reset keeps counting: the next revision, with no parts.
    assert.equal(await revision(), 3);
    // A refused poll says nothing about the salon.
    const refused = (await (await ownerInbox(ownerInboxRequest({ access: { 'x-live-key': 'wrong' } }))).json()) as Record<string, unknown>;
    assert.equal('salonRev' in refused, false);
  });
});

test('nothing secret reaches the record or an error: no key, no token, no address', async (t) => {
  const store = fresh(t);
  const errors = await quietly(() => run(store, async () => {
    await put({ baseRev: 0, parts: { companySettings: renamed } });
    await put({ baseRev: 0, parts: { companySettings: renamed } });
    await put({ baseRev: 1, parts: { services: [service({ priceCHF: -1 })] } });
  }));
  assert.deepEqual(errors, []);
  for (const secret of ['right-key', CHAT_TOKEN, ADDRESS]) assert.ok(!store.text(SALON_KEY)!.includes(secret), secret);
});
