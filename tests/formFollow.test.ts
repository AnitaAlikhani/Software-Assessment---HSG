import assert from 'node:assert/strict';
import test from 'node:test';
import { initialAiSettings } from '../src/conversationData';
import { BY_KEY, BY_POSITION, followStored } from '../src/formFollow';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData';
import { personFormFor } from '../src/personForm';
import { SALON_TEXTS, SharedSalon } from '../src/sharedSalon';
import type { AiAssistantSettings, BookingHoursDay, CompanySettingsData } from '../src/types';
import { FIXED_NOW } from './fixedClock';
import { SalonRoutesStandIn } from './salonRoutesStandIn';

// An open form that holds a copy of a shared part follows what the server has (src/formFollow.ts):
// a field the owner has not changed shows the new stored value, a field she changed keeps what she
// typed. These are the three-way step itself, the shapes of each form, and the step together
// with the salon on the server (src/sharedSalon.ts).

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

test('the three-way step: untouched fields follow, typed fields stay, a value is never one that nobody has', () => {
  const started = { name: 'Salon A', phone: '1', city: 'St. Gallen' };
  const typed = { ...started, phone: '2' };
  const stored = { ...started, name: 'Salon B', city: 'Wil' };
  assert.deepEqual(followStored(started, typed, stored), { name: 'Salon B', phone: '2', city: 'Wil' });
  // Nothing typed: the form is the stored value.
  assert.deepEqual(followStored(started, started, stored), stored);
  // Typed the same as the other device: nothing left to save.
  assert.deepEqual(followStored(started, { ...started, name: 'Salon B' }, stored), stored);
  // A field the stored value no longer has and the owner did not touch goes with it.
  const { city: _gone, ...withoutCity } = stored;
  assert.deepEqual(followStored(started, started, withoutCity), withoutCity);
  // A plain value is one field.
  assert.equal(followStored('a', 'a', 'b'), 'b');
  assert.equal(followStored('a', 'x', 'b'), 'x');
  assert.deepEqual(followStored([1], [1], [2]), [2]);
});

test('a list of plain values is followed tick by tick: two devices that tick different people both keep theirs', () => {
  // Balayage is offered by Anna. A ticks Selina and has not saved; B ticked Luca and saved.
  const service = { name: 'Balayage', assignedEmployeeIds: ['emp-1'] };
  const shown = followStored(service, { ...service, assignedEmployeeIds: ['emp-1', 'emp-2'] }, { ...service, assignedEmployeeIds: ['emp-1', 'emp-3'] });
  assert.deepEqual(shown.assignedEmployeeIds, ['emp-1', 'emp-3', 'emp-2']);
  // Unticked in the form stays out, whatever the other device ticked beside it.
  assert.deepEqual(followStored(['a', 'b', 'c'], ['a', 'c'], ['a', 'b', 'c', 'd']), ['a', 'c', 'd']);
  // Unticked on the other device goes, unless the owner had only just ticked it herself.
  assert.deepEqual(followStored(['a', 'b'], ['a', 'b', 'c'], ['a']), ['a', 'c']);
  // Both ticked the same one: it is there once, and nothing is left to save.
  assert.deepEqual(followStored(['a'], ['a', 'b'], ['a', 'b']), ['a', 'b']);
  // Nothing typed: the list is the stored one, in its order.
  assert.deepEqual(followStored(['a', 'b'], ['a', 'b'], ['b', 'c']), ['b', 'c']);
  // The services a person offers are the same kind of list.
  const salon = { services: initialServices, bookingHours: initialBookingHours };
  const person = personFormFor(initialEmployees[2], salon);
  const [first, second] = initialServices.filter((item) => !person.serviceIds.includes(item.id)).map((item) => item.id);
  assert.ok(first && second, 'the sample person leaves two services to tick');
  const merged = followStored(person, { ...person, serviceIds: [...person.serviceIds, first] }, { ...person, serviceIds: [...person.serviceIds, second] });
  assert.deepEqual([...merged.serviceIds].sort(), [...person.serviceIds, first, second].sort());
});

test('a set of switches is followed switch by switch where the form says so: German off here and French off there are both off', () => {
  const started: AiAssistantSettings = { ...initialAiSettings, answerLanguages: { EN: true, FR: true, DE: true, IT: true } };
  const typed = { ...started, answerLanguages: { ...started.answerLanguages, DE: false } };
  const stored = { ...started, answerLanguages: { ...started.answerLanguages, FR: false } };
  const lists = { answerLanguages: BY_KEY };
  assert.deepEqual(followStored(started, typed, stored, { lists }).answerLanguages, { EN: true, FR: false, DE: false, IT: true });
  // The same switch on both devices: the owner's own stays, and counts as unsaved.
  const both = followStored(started, typed, { ...started, answerLanguages: { ...started.answerLanguages, DE: true, IT: false } }, { lists });
  assert.deepEqual(both.answerLanguages, { EN: true, FR: true, DE: false, IT: false });
  // Without the form saying so, a record inside a record is one whole: the two times of a day
  // are never mixed from two devices (a start typed here with an end saved there).
  const day = { works: true, hours: { start: '09:00', end: '18:00' } };
  const mixed = followStored(day, { ...day, hours: { start: '13:00', end: '18:00' } }, { ...day, hours: { start: '09:00', end: '12:00' } });
  assert.deepEqual(mixed.hours, { start: '13:00', end: '18:00' });
  assert.deepEqual(followStored(day, day, { ...day, hours: { start: '09:00', end: '12:00' } }).hours, { start: '09:00', end: '12:00' });
  // The editor of a single day holds its two times as one field for the same reason.
  const editor = (works: boolean, start: string, end: string) => ({ works, times: `${start} ${end}` });
  assert.deepEqual(followStored(editor(true, '09:00', '18:00'), editor(true, '13:00', '18:00'), editor(true, '09:00', '12:00')), editor(true, '13:00', '18:00'));
  assert.deepEqual(followStored(editor(true, '09:00', '18:00'), editor(false, '09:00', '18:00'), editor(true, '09:00', '12:00')), editor(false, '09:00', '12:00'));
  // Handover rules are told apart by their own id, with or without the form naming it.
  const rules = started.handoverRules;
  assert.ok(rules.length >= 2);
  const mine = { ...started, handoverRules: rules.map((rule, index) => index === 0 ? { ...rule, enabled: !rule.enabled } : rule) };
  const theirs = { ...started, handoverRules: rules.map((rule, index) => index === 1 ? { ...rule, enabled: !rule.enabled } : rule) };
  const shown = followStored(started, mine, theirs);
  assert.equal(shown.handoverRules[0].enabled, !rules[0].enabled);
  assert.equal(shown.handoverRules[1].enabled, !rules[1].enabled);
});

test('a person\'s week is followed day by day, and one day is never mixed from two devices', () => {
  const salon = { services: initialServices, bookingHours: initialBookingHours };
  const person = personFormFor(initialEmployees[0], salon);
  const lists = { days: BY_POSITION };
  const day = (index: number, change: Partial<(typeof person.days)[number]>) => person.days.map((row, at) => at === index ? { ...row, ...change } : row);
  // A changes Tuesday (1), B changed Friday (4) and saved.
  const shown = followStored(person, { ...person, days: day(1, { start: '10:00' }) }, { ...person, days: day(4, { end: '16:00' }) }, { lists });
  assert.equal(shown.days[1].start, '10:00');
  assert.equal(shown.days[4].end, '16:00');
  // Both changed Tuesday: the owner's whole day stays, start and end as she set them.
  const clash = followStored(person, { ...person, days: day(1, { start: '10:00' }) }, { ...person, days: day(1, { end: '15:00' }) }, { lists });
  assert.deepEqual(clash.days[1], { ...person.days[1], start: '10:00' });
  // Without the form saying that the places can be trusted, such a list is one whole.
  const whole = followStored(person, { ...person, days: day(1, { start: '10:00' }) }, { ...person, days: day(4, { end: '16:00' }) });
  assert.deepEqual(whole.days, day(1, { start: '10:00' }));
  // A list that grew or shrank has no places to go by: one whole again.
  assert.deepEqual(followStored([{ a: 1 }], [{ a: 2 }], [{ a: 1 }, { a: 3 }], { listId: BY_POSITION }), [{ a: 2 }]);
  assert.deepEqual(followStored([{ a: 1 }], [{ a: 1 }], [{ a: 1 }, { a: 3 }], { listId: BY_POSITION }), [{ a: 1 }, { a: 3 }]);
});

test('lists by id: each entry is a field; added entries stay, removed ones stay out', () => {
  type Rule = { id: string; label: string; enabled: boolean };
  const id = (rule: Rule) => rule.id;
  const started: Rule[] = [{ id: 'a', label: 'A', enabled: true }, { id: 'b', label: 'B', enabled: true }, { id: 'c', label: 'C', enabled: true }];
  const typed: Rule[] = [{ id: 'a', label: 'A', enabled: false }, { id: 'c', label: 'C', enabled: true }, { id: 'd', label: 'D', enabled: true }];
  const stored: Rule[] = [{ id: 'a', label: 'A', enabled: true }, { id: 'b', label: 'B!', enabled: true }, { id: 'c', label: 'C!', enabled: true }];
  assert.deepEqual(followStored(started, typed, stored, { listId: id }), [
    { id: 'a', label: 'A', enabled: false }, // typed: stays
    { id: 'c', label: 'C!', enabled: true }, // untouched: follows
    { id: 'd', label: 'D', enabled: true }, // added in the form: stays
  ]); // b was taken out in the form: stays out
});

test('Settings › Salon: an untouched open form shows the other device\'s name; a typed phone stays, and Save sends both', () => {
  const started: CompanySettingsData = { ...initialCompanySettings };
  const stored = { ...started, companyName: 'Salon Rosa' };
  const untouched = followStored(started, started, stored);
  assert.equal(untouched.companyName, 'Salon Rosa');
  assert.ok(same(untouched, stored), 'nothing unsaved');
  const typed = followStored(started, { ...started, businessPhone: '+41 71 000 00 01' }, stored);
  assert.equal(typed.companyName, 'Salon Rosa');
  assert.equal(typed.businessPhone, '+41 71 000 00 01');
  assert.ok(!same(typed, stored), 'the phone is unsaved, and only the phone');
  assert.deepEqual(Object.keys(typed).filter((key) => !same(typed[key as keyof CompanySettingsData], stored[key as keyof CompanySettingsData])), ['businessPhone']);
});

test('Settings › Opening hours: one weekday is one field', () => {
  const day = (hours: BookingHoursDay) => hours.day;
  const started = initialBookingHours;
  const typed = started.map((item) => item.day === 'Monday' ? { ...item, from: '10:00' } : item);
  const stored = started.map((item) => item.day === 'Saturday' ? { ...item, isOpen: false } : item.day === 'Monday' ? { ...item, to: '17:00' } : item);
  const shown = followStored(started, typed, stored, { listId: day });
  assert.equal(shown.find((item) => item.day === 'Saturday')?.isOpen, false);
  // Monday was changed in the form: it keeps the owner's whole day.
  assert.deepEqual(shown.find((item) => item.day === 'Monday'), typed.find((item) => item.day === 'Monday'));
  assert.deepEqual(followStored(started, started, stored, { listId: day }), stored);
});

test('AI receptionist: an untouched switch follows; a switched one stays; handover rules one by one', () => {
  const started: AiAssistantSettings = initialAiSettings;
  const lists = { handoverRules: (rule: AiAssistantSettings['handoverRules'][number]) => rule.id };
  const stored: AiAssistantSettings = { ...started, translateChats: !started.translateChats, handoverRules: started.handoverRules.map((rule, index) => index === 0 ? { ...rule, enabled: !rule.enabled } : rule) };
  assert.deepEqual(followStored(started, started, stored, { lists }), stored);
  const typed = { ...started, askBeforeSending: !started.askBeforeSending, handoverRules: started.handoverRules.map((rule, index) => index === 1 ? { ...rule, enabled: !rule.enabled } : rule) };
  const shown = followStored(started, typed, stored, { lists });
  assert.equal(shown.translateChats, stored.translateChats);
  assert.equal(shown.askBeforeSending, typed.askBeforeSending);
  assert.equal(shown.handoverRules[0].enabled, stored.handoverRules[0].enabled);
  assert.equal(shown.handoverRules[1].enabled, typed.handoverRules[1].enabled);
});

test('the service form and the person form: untouched fields follow, typed ones stay', () => {
  const service = { name: 'Haircut', price: '55.00', duration: '30', description: '' };
  assert.deepEqual(followStored(service, { ...service, description: 'Short' }, { ...service, price: '60.00' }), { ...service, price: '60.00', description: 'Short' });
  const salon = { services: initialServices, bookingHours: initialBookingHours };
  const person = personFormFor(initialEmployees[2], salon);
  const stored = personFormFor({ ...initialEmployees[2], phone: '+41791112233' }, salon);
  const typed = { ...person, email: 'luca@example.ch' };
  const shown = followStored(person, typed, stored);
  assert.equal(shown.phone, stored.phone);
  assert.equal(shown.email, 'luca@example.ch');
  assert.ok(same(followStored(person, person, stored), stored));
});

// ---------- with the salon on the server: what a form compares with is what the server has ----------

/** One open Settings form on a signed-in device, run through the same steps as the screen. */
async function openForm() {
  const server = new SalonRoutesStandIn();
  const salon = new SharedSalon({ request: server.request, builtAt: () => FIXED_NOW });
  salon.read('companySettings', initialCompanySettings);
  await salon.begin(server.key);
  const stored = () => salon.serverValue<CompanySettingsData>('companySettings', initialCompanySettings);
  let startedFrom = stored();
  let form = startedFrom;
  /** What the screen does on every drawing: follow the server's value when it changed. */
  const draw = () => {
    if (!same(stored(), startedFrom)) { form = followStored(startedFrom, form, stored()); startedFrom = stored(); }
    return { form, unsaved: !same(form, stored()) };
  };
  const type = (change: Partial<CompanySettingsData>) => { form = { ...form, ...change }; };
  const save = () => salon.write('companySettings', form);
  return { server, salon, draw, type, save };
}

test('a save the server refuses: the open form keeps what was typed, shows it as unsaved, and offers no "Try again"', async () => {
  const { server, salon, draw, type, save } = await openForm();
  server.refuse = { part: 'companySettings', sentence: 'The salon name can be at most 120 characters.' };
  type({ companyName: 'x'.repeat(130) });
  save();
  await settled();
  const { form, unsaved } = draw();
  assert.equal(form.companyName, 'x'.repeat(130));
  assert.equal(unsaved, true);
  assert.equal(salon.current.notice?.text, `${SALON_TEXTS.notSaved} The salon name can be at most 120 characters.`);
  assert.equal(salon.current.notice?.retry, false);
  // What the screen shows outside the form went back to the server's value.
  assert.equal(salon.read<CompanySettingsData>('companySettings', initialCompanySettings).companyName, initialCompanySettings.companyName);
});

test('a save that got no answer: the typed text stays, unsaved, and "Try again" sends it; taken, the form is clean', async () => {
  const { server, salon, draw, type, save } = await openForm();
  server.failNext = [null];
  type({ description: 'A long text typed on a phone.' });
  save();
  await settled();
  assert.equal(draw().form.description, 'A long text typed on a phone.');
  assert.equal(draw().unsaved, true);
  assert.equal(salon.current.notice?.retry, true);
  salon.retry();
  await settled();
  assert.equal((server.record!.parts.companySettings as CompanySettingsData).description, 'A long text typed on a phone.');
  assert.deepEqual(draw(), { form: draw().form, unsaved: false });
});

test('a 409 with one typed and one untouched field: the untouched one follows, the typed one stays and counts as unsaved; Save sends both', async () => {
  const { server, salon, draw, type, save } = await openForm();
  server.saveElsewhere({ companySettings: { ...initialCompanySettings, companyName: 'Salon Nord' } });
  type({ city: 'Wil' });
  save();
  await settled();
  assert.equal(salon.current.notice?.text, SALON_TEXTS.conflict);
  const after = draw();
  assert.equal(after.form.companyName, 'Salon Nord');
  assert.equal(after.form.city, 'Wil');
  assert.equal(after.unsaved, true);
  save();
  await settled();
  const record = server.record!.parts.companySettings as CompanySettingsData;
  assert.equal(record.companyName, 'Salon Nord');
  assert.equal(record.city, 'Wil');
  assert.equal(draw().unsaved, false);
});

test('a save on its way does not count as saved: the form stays unsaved until the server has taken it', async () => {
  const { server, draw, type, save } = await openForm();
  server.hold = true;
  type({ city: 'Wil' });
  save();
  await settled();
  assert.equal(draw().unsaved, true);
  server.release();
  await settled();
  assert.equal(draw().unsaved, false);
});
