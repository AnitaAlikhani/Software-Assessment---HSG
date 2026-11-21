import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { getAvailableSlots, getNextAvailableDate, isBookableEmployee, type AvailabilityContext } from '../src/availability';
import { bookingDays } from '../src/bookingDays';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData';
import { personFormFor, personFromForm, weekFromRows, type PersonForm } from '../src/personForm';
import { BOOKING_GAP_REASON, bookingGaps, servicesOf, setupSteps, withServicesOf } from '../src/teamBooking';
import type { Employee, ServiceItem, ShiftEntry } from '../src/types';
import { BookingPageView, createBookingDraft } from '../src/views/BookingPageView';
import { AddedPersonSteps, EmployeesView, PersonFields } from '../src/views/EmployeesView';
import { TeamView } from '../src/views/TeamView';
import { demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// People in Team: a person's form holds their regular working hours, their services, one switch
// for the booking page and a status. Somebody who is added with a service can be booked at once,
// and while somebody cannot be booked online the list says why. The moment is fixed: Monday
// 5 October 2026, 12:00 in Zurich; the salon opens Tuesday to Saturday.

const nothing = () => {};
const ZONE = 'Europe/Zurich';
const TODAY = '2026-10-05';
const TUESDAY = '2026-10-06';
const salon = { services: initialServices, bookingHours: initialBookingHours, companyName: 'Bella Hair Salon' };
const shown = (html: string) => readableText(html).replace(/\s+/g, ' ');
/** The text between the tags only: what stands on the screen, without labels for screen readers. */
const onScreen = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const count = (html: string, part: string) => html.split(part).length - 1;

/** What the app does when the form is saved for a new person: the person gets an id, and the ticked services get that id. */
const addPerson = (form: PersonForm, id = 'emp-new') => {
  const saved = personFromForm(form, salon);
  if ('error' in saved) throw new Error(saved.error);
  const [first, last] = [saved.details.firstName, saved.details.lastName];
  const employee: Employee = { ...saved.details, id, name: `${first} ${last}`, initials: `${first[0]}${last[0]}` };
  return { employee, employees: [...initialEmployees, employee], services: withServicesOf(initialServices, id, saved.serviceIds) };
};
const context = (employees: Employee[], services: ServiceItem[], shiftOverview: ShiftEntry[] = demoShifts): AvailabilityContext => ({
  services, employees, bookingHours: initialBookingHours, shiftOverview, events: demoEvents, requests: demoRequests, now: FIXED_NOW, timeZone: ZONE,
});
const filled = (partial: Partial<PersonForm> = {}): PersonForm => ({ ...personFormFor(null, salon), firstName: 'Mira', lastName: 'Probst', ...partial });

// ---------- the new-person journey ----------

test('a new person\'s form starts with the opening hours as working hours, no service, bookable online and active', () => {
  const form = personFormFor(null, salon);
  assert.deepEqual(form.days.map((day) => day.works), [false, true, true, true, true, true, false]);
  assert.deepEqual(form.days.filter((day) => day.works).map((day) => `${day.start}-${day.end}`), ['08:30-18:30', '08:30-18:30', '08:30-18:30', '08:30-18:30', '08:00-16:00']);
  assert.deepEqual(form.serviceIds, []);
  assert.equal(form.bookableOnline, true);
  assert.equal(form.active, true);
  assert.deepEqual([form.firstName, form.lastName, form.email, form.phone], ['', '', '', '']);
  // A day off keeps times ready for when it is switched on: the opening hours of that weekday.
  assert.deepEqual([form.days[0].start, form.days[0].end], ['08:30', '18:30']);
  // A salon that has not entered opening hours yet: every day off, with a usual day ready.
  const bare = personFormFor(null, { services: [], bookingHours: [] });
  assert.deepEqual(bare.days.map((day) => [day.works, day.start, day.end]), Array(7).fill([false, '09:00', '18:00']));
});

test('somebody who is added with a service can be booked at once, by the rule the booking page uses', () => {
  const { employee, employees, services } = addPerson(filled({ serviceIds: ['srv-2', 'srv-5'] }));
  // The person carries their own regular week: the opening hours, copied when the form was saved.
  assert.deepEqual(employee.weeklyHours, {
    mon: null, tue: { start: '08:30', end: '18:30' }, wed: { start: '08:30', end: '18:30' }, thu: { start: '08:30', end: '18:30' },
    fri: { start: '08:30', end: '18:30' }, sat: { start: '08:00', end: '16:00' }, sun: null,
  });
  assert.deepEqual(servicesOf(services, employee).map((service) => service.name), ['Haircut', "Men's cut"]);
  assert.equal(services.find((service) => service.id === 'srv-2')!.assignedEmployeesCount, 4);

  // The booking page asks getAvailableSlots as a customer (no owner mode), and finds times on the
  // very next open day. The week plan holds nothing for this person: no shift had to be entered.
  const page = context(employees, services);
  assert.equal(demoShifts.some((entry) => entry.employeeId === employee.id), false);
  const tuesday = getAvailableSlots(page, { date: TUESDAY, serviceId: 'srv-2', employeeId: employee.id });
  assert.equal(tuesday[0], '08:30');
  assert.equal(tuesday.at(-1), '18:00');
  assert.equal(tuesday.length, 20);
  assert.equal(getNextAvailableDate(page, 'srv-2', TODAY, employee.id), TUESDAY);
  assert.equal(bookingDays(page, 'srv-5', TODAY, 3)[1].state, 'free');
  // Far beyond the ninety days a shift plan used to cover: a Tuesday next summer.
  assert.equal(getAvailableSlots({ ...page, now: new Date('2027-06-01T06:00:00Z') }, { date: '2027-06-08', serviceId: 'srv-2', employeeId: employee.id }).length, 20);
  // Not for a service that was not ticked.
  assert.deepEqual(getAvailableSlots(page, { date: TUESDAY, serviceId: 'srv-1', employeeId: employee.id }), []);
  // And the list calls the person what the booking page makes of them.
  assert.deepEqual(bookingGaps({ ...salon, services, shiftOverview: demoShifts }, employee, TODAY), []);

  // The page itself: the new person is offered for the haircut, with free times on Tuesday.
  const html = render(React.createElement(BookingPageView, {
    ...page, companySettings: initialCompanySettings, setDraft: nothing, setSubmittedRequest: nothing, submittedRequest: null,
    onNewBookingRequest: () => null, onUpdateBookingRequest: () => null, onCancelBookingRequest: () => null, onViewRequest: nothing, publicMode: true,
    draft: { ...createBookingDraft(services, ZONE, FIXED_NOW), serviceId: 'srv-2', employeeId: employee.id, date: TUESDAY, dateChosen: true },
  }));
  assert.match(onScreen(html), /Mira Probst Available on this date/);
  assert.match(onScreen(html), /Free times with Mira Probst on Tuesday, 06\.10\.2026: 08:30–09:00 09:00–09:30/);
});

test('the same person without working hours finds no date in ninety days: what the regular week is for', () => {
  const { employee, employees, services } = addPerson(filled({ serviceIds: ['srv-2'] }));
  const without = employees.map((item) => item.id === employee.id ? { ...item, weeklyHours: undefined } : item);
  assert.equal(getNextAvailableDate(context(without, services), 'srv-2', TODAY, employee.id), null);
  assert.deepEqual(bookingGaps({ ...salon, services, shiftOverview: demoShifts }, without.at(-1)!, TODAY), ['no-hours']);
  // With every day switched off in the form the person is saved, and the list says what is missing.
  const allOff = addPerson(filled({ serviceIds: ['srv-2'], days: filled().days.map((day) => ({ ...day, works: false })) }));
  assert.deepEqual(Object.values(allOff.employee.weeklyHours!), Array(7).fill(null));
  assert.equal(getNextAvailableDate(context(allOff.employees, allOff.services), 'srv-2', TODAY, allOff.employee.id), null);
  assert.deepEqual(bookingGaps({ ...salon, services: allOff.services, shiftOverview: demoShifts }, allOff.employee, TODAY), ['no-hours']);
});

test('after adding somebody who is not bookable yet, at most two steps say what is missing and where it is done', () => {
  const setup = (services: ServiceItem[]) => ({ ...salon, services, shiftOverview: demoShifts });
  // No service ticked: one step.
  const noService = addPerson(filled());
  assert.deepEqual(bookingGaps(setup(noService.services), noService.employee, TODAY), ['no-service']);
  assert.deepEqual(setupSteps(setup(noService.services), noService.employee, TODAY), [
    { section: 'services', text: 'Choose the services Mira offers.', action: 'Choose services' },
  ]);
  // Neither a service nor a working day: two steps, services first.
  const nothingYet = addPerson(filled({ days: filled().days.map((day) => ({ ...day, works: false })) }));
  assert.deepEqual(setupSteps(setup(nothingYet.services), nothingYet.employee, TODAY).map((step) => [step.section, step.action]), [
    ['services', 'Choose services'], ['hours', 'Set working hours'],
  ]);
  // Only services that are not offered online (colour work): the step says which kind is missing.
  const colourOnly = addPerson(filled({ serviceIds: ['srv-3', 'srv-8'] }));
  assert.deepEqual(bookingGaps(setup(colourOnly.services), colourOnly.employee, TODAY), ['no-online-service']);
  assert.deepEqual(setupSteps(setup(colourOnly.services), colourOnly.employee, TODAY).map((step) => step.text), ['Choose a service for Mira that customers can book online.']);
  // Hours that never meet the opening hours (Monday and Sunday only): the hours step.
  const closedDays = addPerson(filled({ serviceIds: ['srv-2'], days: filled().days.map((day, index) => ({ ...day, works: index === 0 || index === 6 })) }));
  assert.deepEqual(bookingGaps(setup(closedDays.services), closedDays.employee, TODAY), ['closed-hours']);
  assert.deepEqual(setupSteps(setup(closedDays.services), closedDays.employee, TODAY).map((step) => step.action), ['Set working hours']);
  assert.equal(getNextAvailableDate(context(closedDays.employees, closedDays.services), 'srv-2', TODAY, closedDays.employee.id), null);
  // Never more than two steps, whatever is missing.
  for (const person of [noService, nothingYet, colourOnly, closedDays]) assert.ok(setupSteps(setup(person.services), person.employee, TODAY).length <= 2);
  // Complete: nothing to do. Switched off or inactive on purpose: nothing is "missing" either.
  const complete = addPerson(filled({ serviceIds: ['srv-2'] }));
  assert.deepEqual(setupSteps(setup(complete.services), complete.employee, TODAY), []);
  const offline = addPerson(filled({ bookableOnline: false }));
  assert.deepEqual(bookingGaps(setup(offline.services), offline.employee, TODAY), ['switched-off', 'no-service']);
  assert.deepEqual(setupSteps(setup(offline.services), offline.employee, TODAY), []);

  // The panel above the list: the steps as buttons that open the form at that part.
  const panel = (person: ReturnType<typeof addPerson>) => render(React.createElement(AddedPersonSteps, {
    employee: person.employee, steps: setupSteps(setup(person.services), person.employee, TODAY),
    bookable: bookingGaps(setup(person.services), person.employee, TODAY).length === 0, onOpen: nothing, onDismiss: nothing,
  }));
  const twoSteps = panel(nothingYet);
  assert.match(onScreen(twoSteps), /Mira Probst is not bookable yet Two things are missing before customers can book Mira online\. 1 Choose the services Mira offers\. Choose services 2 Set the days and hours Mira works\. Set working hours/);
  assert.match(twoSteps, /^<section role="status" aria-labelledby="added-person-title"/);
  assert.equal(count(twoSteps, '<li '), 2);
  assert.match(onScreen(panel(noService)), /One thing is missing before customers can book Mira online\./);
  // Every control is a tap target of 44 px and has a name.
  for (const button of twoSteps.match(/<button[^>]*>/g) ?? []) assert.match(button, /\b(min-h-11|h-11 w-11)\b/);
  assert.match(twoSteps, /aria-label="Dismiss"/);
  // Once nothing is missing, it says so; for a person who is switched off on purpose it stays away.
  assert.match(onScreen(panel(complete)), /Mira Probst can be booked online Customers can choose Mira on your booking page from now on\./);
  assert.doesNotMatch(panel(complete), /<ol|<li/);
  assert.equal(panel(offline), '');
  for (const html of [twoSteps, panel(complete)]) assert.doesNotMatch(readableText(html), TELL_WORDS);
});

// ---------- one switch and one status ----------

test('one switch decides about the booking page; "hidden" is no second control and is cleared on saving', () => {
  const anna = initialEmployees[0];
  // An older record could be hidden with the switch still on: the form shows what was true, off.
  const hidden = { ...anna, hidden: true, canBookOnline: true };
  assert.equal(isBookableEmployee(hidden), false);
  assert.equal(personFormFor(hidden, salon).bookableOnline, false);
  assert.equal(personFormFor({ ...anna, canBookOnline: false }, salon).bookableOnline, false);
  assert.equal(personFormFor(anna, salon).bookableOnline, true);
  // Saved as it opened, the person stays off the booking page, now through the one switch.
  const kept = personFromForm(personFormFor(hidden, salon), salon);
  assert.ok('details' in kept);
  assert.deepEqual([kept.details.canBookOnline, kept.details.hidden], [false, false]);
  assert.equal(isBookableEmployee({ ...hidden, ...kept.details }), false);
  // Switched on, the person is bookable: nothing hidden is left to contradict the switch.
  const on = personFromForm({ ...personFormFor(hidden, salon), bookableOnline: true }, salon);
  assert.ok('details' in on);
  assert.equal(isBookableEmployee({ ...hidden, ...on.details }), true);

  // The form: exactly one switch for it, the status as two choices, and no "Hide this employee".
  const html = render(React.createElement(PersonFields, { form: personFormFor(anna, salon), onChange: nothing, services: initialServices, bookingHours: initialBookingHours, employees: initialEmployees, editingId: anna.id }));
  const text = onScreen(html);
  assert.equal(count(text, 'Bookable online'), 1);
  assert.doesNotMatch(text, /Hide this employee|Can be booked online by customers/);
  assert.match(text, /Bookable online Customers can choose this person on your booking page\./);
  assert.match(html, /<div role="radiogroup" aria-labelledby="employee-status-label"/);
  const radios = Array.from(html.matchAll(/<input type="radio"[^>]*name="employee-status"([^>]*)\/>/g), (match) => match[1].includes('checked'));
  assert.deepEqual(radios, [true, false]);
  assert.match(text, /Status Active Inactive Works at the salon and can get appointments\./);
  // Switched off and set to inactive, each says what it means.
  const off = onScreen(render(React.createElement(PersonFields, { form: { ...personFormFor(anna, salon), bookableOnline: false, active: false }, onChange: nothing, services: initialServices, bookingHours: initialBookingHours })));
  assert.match(off, /Customers do not see this person on your booking page\. You can still book them by hand in the calendar\./);
  assert.match(off, /Gets no new appointments and is not on your booking page\. The appointments this person already has stay in the calendar\./);
});

test('an inactive person gets no new appointments and keeps the old ones', () => {
  const luca = initialEmployees[2];
  const saved = personFromForm({ ...personFormFor(luca, salon), active: false }, salon);
  assert.ok('details' in saved);
  assert.equal(saved.details.status, 'Inactive');
  const employees = initialEmployees.map((employee) => employee.id === luca.id ? { ...employee, ...saved.details } : employee);
  // Nobody can book them: not online and not by hand. The regular week stays on the person.
  const friday = '2026-10-09';
  assert.deepEqual(getAvailableSlots(context(employees, initialServices), { date: friday, serviceId: 'srv-2', employeeId: luca.id }), []);
  assert.deepEqual(getAvailableSlots(context(employees, initialServices), { date: friday, serviceId: 'srv-2', employeeId: luca.id, mode: 'owner' }), []);
  assert.deepEqual(employees[2].weeklyHours, luca.weeklyHours);
  // Saving a person touches no appointment: what is in the calendar under their name stays there.
  assert.ok(demoEvents.filter((event) => event.employeeId === luca.id).length > 50);
  assert.deepEqual(bookingGaps({ ...salon, shiftOverview: demoShifts }, employees[2], TODAY), ['inactive']);
  // Active again: bookable as before.
  assert.ok(getAvailableSlots(context(initialEmployees, initialServices), { date: friday, serviceId: 'srv-2', employeeId: luca.id }).length > 0);
});

// ---------- the form ----------

test('the form shows the regular week as seven rows with 24-hour lists, and every service as a checkbox', () => {
  const selina = initialEmployees[1];
  const form = personFormFor(selina, salon);
  // What is stored is what the form shows: Wednesday to Saturday, and the services she offers.
  assert.deepEqual(form.days.map((day) => day.works), [false, false, true, true, true, true, false]);
  assert.deepEqual(weekFromRows(form.days), selina.weeklyHours);
  assert.deepEqual(form.serviceIds, initialServices.filter((service) => service.assignedEmployeeIds!.includes(selina.id)).map((service) => service.id));
  assert.equal(form.phone, '+41 78 555 64 27');

  const html = render(React.createElement(PersonFields, { form, onChange: nothing, services: initialServices, bookingHours: initialBookingHours, employees: initialEmployees, editingId: selina.id }));
  const text = onScreen(html);
  // Three parts with their headings, in this order.
  assert.deepEqual(Array.from(html.matchAll(/<h2 id="employee-(\w+)-title"[^>]*>([^<]*)<\/h2>/g), (match) => `${match[1]}: ${match[2]}`), ['hours: Working hours', 'services: Services', 'booking: Booking']);
  // Working hours: a switch per weekday, Monday first, on for the days she works.
  const days = Array.from(html.matchAll(/<input type="checkbox" aria-label="Works on (\w+)"([^>]*)\/>/g), (match) => `${match[1]}${match[2].includes('checked') ? '*' : ''}`);
  assert.deepEqual(days, ['Monday', 'Tuesday', 'Wednesday*', 'Thursday*', 'Friday*', 'Saturday*', 'Sunday']);
  // From and To for each working day, as lists of half hours: never the device's 12-hour clock.
  assert.equal(count(html, '<select'), 8);
  assert.doesNotMatch(html, /type="time"/);
  const list = (label: string) => Array.from((new RegExp(`<select aria-label="${label}"[^>]*>(.*?)</select>`).exec(html)?.[1] ?? '').matchAll(/<option([^>]*)>([^<]*)<\/option>/g), ([, attributes, time]) => ({ time, selected: attributes.includes('selected') }));
  assert.equal(list('Wednesday: from').length, 48);
  assert.deepEqual(list('Wednesday: from').filter((option) => option.selected).map((option) => option.time), ['10:00']);
  assert.deepEqual(list('Saturday: to').filter((option) => option.selected).map((option) => option.time), ['16:00']);
  for (const classes of html.matchAll(/<select[^>]*class="([^"]*)"/g)) { assert.match(classes[1], /\btext-base\b/); assert.match(classes[1], /\bmin-h-11\b/); }
  assert.doesNotMatch(text, /\b(AM|PM)\b/);
  assert.match(text, /A single day is changed in This week\./);
  // Services: one checkbox each, ticked for what she offers; colour work is marked as not offered online.
  const group = /<div role="group" aria-labelledby="employee-services-title"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? '';
  assert.equal(count(group, 'type="checkbox"'), initialServices.length);
  assert.equal(count(group, 'checked=""'), form.serviceIds.length);
  assert.match(text, /Haircut 30 min · CHF 55\.00 Colouring 90 min · CHF 120\.00 · not offered online/);
  // Each checkbox sits in a label a thumb can hit.
  assert.equal(count(group, '<label class="flex min-h-11'), initialServices.length);
  assert.doesNotMatch(readableText(html), TELL_WORDS);

  // A new person: the hint that a service is needed, and for a salon without services the way to add one.
  const fresh = onScreen(render(React.createElement(PersonFields, { form: personFormFor(null, salon), onChange: nothing, services: initialServices, bookingHours: initialBookingHours })));
  assert.match(fresh, /Without a service nobody can book this person, online or by hand\./);
  const noServices = render(React.createElement(PersonFields, { form: personFormFor(null, { services: [], bookingHours: initialBookingHours }), onChange: nothing, services: [], bookingHours: initialBookingHours, onOpenServices: nothing }));
  assert.match(onScreen(noServices), /Your salon has no services yet\. Add one in Services, then tick it here\. Open Services/);
  assert.doesNotMatch(render(React.createElement(PersonFields, { form: personFormFor(null, { services: [], bookingHours: [] }), onChange: nothing, services: [], bookingHours: [] })), /Open Services/);
  // Unticking the only person of an online service says what that means for customers.
  const anna = initialEmployees[0];
  const onlyAnna = initialServices.map((service) => service.id === 'srv-10' ? { ...service, assignedEmployeeIds: [anna.id] } : service);
  const annaForm = personFormFor(anna, { ...salon, services: onlyAnna });
  const unticked = onScreen(render(React.createElement(PersonFields, { form: { ...annaForm, serviceIds: annaForm.serviceIds.filter((id) => id !== 'srv-10') }, onChange: nothing, services: onlyAnna, bookingHours: initialBookingHours, employees: initialEmployees, editingId: anna.id })));
  assert.match(unticked, /Nobody else offers Updo\. Customers cannot book it until somebody does\./);
});

test('the form is checked before it is saved: names, contact, and an end after the start on every working day', () => {
  const error = (form: PersonForm) => { const saved = personFromForm(form, salon); return 'error' in saved ? saved.error : null; };
  assert.equal(error(filled()), null);
  assert.equal(error(filled({ firstName: ' ' })), 'Enter the employee’s first and last names.');
  assert.match(error(filled({ email: 'not-an-address' }))!, /valid email/);
  // Wednesday ends before it starts: refused, with the day named.
  const wrong = filled();
  wrong.days = wrong.days.map((day, index) => index === 2 ? { ...day, start: '18:00', end: '09:00' } : day);
  assert.equal(error(wrong), 'Wednesday: working hours must end after they start, on the same day.');
  // The same times on a day that is switched off are nobody's working hours: nothing to refuse.
  wrong.days = wrong.days.map((day, index) => index === 2 ? { ...day, works: false } : day);
  assert.equal(error(wrong), null);
  // What is saved: the number in the stored form, trimmed names, the salon as location.
  const saved = personFromForm(filled({ firstName: ' Mira ', phone: '079 555 12 34', serviceIds: ['srv-2', 'srv-gone'] }), salon);
  assert.ok('details' in saved);
  assert.deepEqual([saved.details.firstName, saved.details.phone, saved.details.location, saved.details.status], ['Mira', '+41795551234', 'Bella Hair Salon', 'Active']);
  // A service that was deleted while the form was open is not written.
  assert.deepEqual(saved.serviceIds, ['srv-2']);
});

test('a person\'s services are the same list the Services screen writes', () => {
  const after = withServicesOf(initialServices, 'emp-3', ['srv-2', 'srv-3']);
  // Luca keeps the haircut, gains colouring and loses everything else; counts follow.
  assert.deepEqual(servicesOf(after, { id: 'emp-3' }).map((service) => service.id), ['srv-2', 'srv-3']);
  const colouring = after.find((service) => service.id === 'srv-3')!;
  assert.deepEqual(colouring.assignedEmployeeIds, ['emp-1', 'emp-2', 'emp-3']);
  assert.equal(colouring.assignedEmployeesCount, 3);
  assert.deepEqual(after.find((service) => service.id === 'srv-1')!.assignedEmployeeIds, ['emp-1', 'emp-2']);
  // Nobody else's services change, and a service that does not change stays the same object.
  for (const id of ['emp-1', 'emp-2']) assert.deepEqual(servicesOf(after, { id }).map((service) => service.id), servicesOf(initialServices, { id }).map((service) => service.id));
  assert.equal(after[1], initialServices[1]);
  assert.equal(withServicesOf(initialServices, 'emp-3', servicesOf(initialServices, { id: 'emp-3' }).map((service) => service.id)).every((service, index) => service === initialServices[index]), true);
  // A service stored without a list of people gets one.
  const bare = [{ ...initialServices[0], assignedEmployeeIds: undefined }];
  assert.deepEqual(withServicesOf(bare, 'emp-9', ['srv-1'])[0].assignedEmployeeIds, ['emp-9']);
});

// ---------- the list ----------

test('the list shows the status, the role and whether customers can book each person', () => {
  const mira = addPerson(filled()).employee;
  const employees = [...initialEmployees.map((employee) => employee.id === 'emp-3' ? { ...employee, status: 'Inactive' as const } : employee), mira];
  const html = render(React.createElement(EmployeesView, {
    employees, onAddEmployee: nothing, onUpdateEmployee: nothing, onDeleteEmployee: nothing,
    services: initialServices, bookingHours: initialBookingHours, shiftOverview: demoShifts, timeZone: ZONE, now: FIXED_NOW,
  }));
  // Phones get cards and wide screens a table: each person is in both, with the same badges.
  const [cards, table] = [html.slice(0, html.indexOf('role="region"')), html.slice(html.indexOf('role="region"'))];
  for (const part of [cards, table]) {
    const text = onScreen(part);
    assert.equal(count(text, 'Bookable online'), 2);
    assert.match(text, /Anna Weber .*?Owner/);
    assert.equal(count(text, 'Owner'), 1);
    assert.equal(count(part, '>Active</span>'), 3);
    assert.equal(count(part, '>Inactive</span>'), 1);
    // While somebody cannot be booked online: the chip, and the reason in plain words.
    assert.equal(count(part, '>Not bookable yet</span>'), 2);
    assert.match(text, /Luca Frei .*?Inactive .*?Not bookable yet Set to inactive/);
    assert.match(text, /Mira Probst .*?Active .*?Not bookable yet No service chosen/);
  }
  assert.match(onScreen(table), /Name Status Online booking Email Phone/);
  assert.doesNotMatch(readableText(html), TELL_WORDS);
  // Every reason has plain words, and none of them is a code.
  for (const reason of Object.values(BOOKING_GAP_REASON)) assert.match(reason, /^[A-Z“][^_]+$/);

  // Without the salon's services and opening hours the list cannot know, and claims nothing.
  const plain = render(React.createElement(EmployeesView, { employees, onAddEmployee: nothing, onUpdateEmployee: nothing, onDeleteEmployee: nothing }));
  assert.doesNotMatch(plain, /Bookable online|Not bookable yet/);
  // Team hands both to the list.
  const team = render(React.createElement(TeamView, {
    employees, onAddEmployee: nothing, onUpdateEmployee: nothing, onDeleteEmployee: nothing, services: initialServices, bookingHours: initialBookingHours,
    shiftOverview: demoShifts, onUpdateShift: nothing, absences: [], onSaveAbsences: nothing, timeZone: ZONE, now: FIXED_NOW,
  }));
  assert.equal(count(team, '>Not bookable yet</span>'), 4);
});

test('why somebody cannot be booked online is found for every case, the most basic reason first', () => {
  const setup = { ...salon, shiftOverview: demoShifts };
  const anna = initialEmployees[0];
  const gaps = (employee: Employee, partial: Partial<typeof setup> = {}, today = TODAY) => bookingGaps({ ...setup, ...partial }, employee, today);
  for (const employee of initialEmployees) assert.deepEqual(gaps(employee), [], employee.name);
  assert.deepEqual(gaps({ ...anna, status: 'Inactive' }), ['inactive']);
  assert.deepEqual(gaps({ ...anna, canBookOnline: false }), ['switched-off']);
  assert.deepEqual(gaps({ ...anna, hidden: true }), ['switched-off']);
  assert.deepEqual(gaps(anna, { services: [] }), ['no-service']);
  assert.deepEqual(gaps(anna, { services: initialServices.map((service) => ({ ...service, onlineBooking: false })) }), ['no-online-service']);
  assert.deepEqual(gaps({ ...anna, weeklyHours: undefined }), ['no-hours']);
  // Several things at once: all of them, in the order they have to be solved.
  assert.deepEqual(gaps({ ...anna, status: 'Inactive', weeklyHours: undefined }, { services: [] }), ['inactive', 'no-service', 'no-hours']);
  // Working hours that never meet the opening hours do not make somebody bookable.
  const evenings = { ...anna, weeklyHours: { ...anna.weeklyHours!, tue: { start: '19:00', end: '22:00' }, wed: null, thu: null, fri: null, sat: null } };
  assert.deepEqual(gaps(evenings), ['closed-hours']);
  // Somebody without a regular week who has a day entered that is still to come can be booked on it ...
  const noWeek = { ...anna, weeklyHours: undefined };
  const entered = (date: string, hours: { start: string; end: string } | null): ShiftEntry[] => [{ employeeId: anna.id, employeeName: anna.name, initials: 'AW', avatarColor: '', shifts: { [date]: hours } }];
  assert.deepEqual(gaps(noWeek, { shiftOverview: entered('2026-10-09', { start: '10:00', end: '16:00' }) }), []);
  // ... but not on a day that is over, a day off, or a day the salon is closed.
  assert.deepEqual(gaps(noWeek, { shiftOverview: entered('2026-10-02', { start: '10:00', end: '16:00' }) }), ['no-hours']);
  assert.deepEqual(gaps(noWeek, { shiftOverview: entered('2026-10-09', null) }), ['no-hours']);
  assert.deepEqual(gaps(noWeek, { shiftOverview: entered('2026-10-11', { start: '10:00', end: '16:00' }) }), ['closed-hours']);
  // What the list says agrees with the booking page for each of the sample stylists.
  for (const employee of initialEmployees) {
    const service = servicesOf(initialServices, employee).find((item) => item.onlineBooking)!;
    assert.notEqual(getNextAvailableDate(context(initialEmployees, initialServices), service.id, TODAY, employee.id), null, employee.name);
  }
});
