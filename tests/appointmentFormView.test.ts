import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import type { AppointmentFormRequest } from '../src/appointmentForm';
import type { AvailabilityContext } from '../src/availability';
import { AppointmentForm } from '../src/components/AppointmentForm';
import { CustomerPicker } from '../src/components/CustomerPicker';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import type { CalendarEvent, Customer, Employee } from '../src/types';
import { demoCustomers, demoEvents, demoRequests, demoShifts } from './fixedClock';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// The appointment form as it is drawn (src/components/AppointmentForm.tsx), in the states the
// owner meets: opened from "+", from a place in the calendar, from a customer's profile and for
// an existing appointment; searching, entering somebody new; a day that cannot be booked; the
// switch for times outside the opening hours. The rules behind it are in tests/appointmentForm.test.ts.

const nothing = () => {};
/** Wednesday 7 October 2026, 10:02 in Zurich. */
const WEDNESDAY = new Date('2026-10-07T08:02:00Z');
const salon = (partial: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
  events: demoEvents, requests: demoRequests, closedDates: [], absences: [], timeZone: 'Europe/Zurich', ...partial,
});
type Props = React.ComponentProps<typeof AppointmentForm>;
const form = (request: AppointmentFormRequest | null, partial: Partial<Props> = {}) => render(React.createElement(AppointmentForm, {
  request, salon: salon(), customers: demoCustomers, onSave: () => null, onClose: nothing, onOpenScreen: nothing, now: WEDNESDAY, ...partial,
}));

/** What a person reads or hears, with every run of spaces as one. */
const shown = (html: string) => readableText(html).replace(/\s+/g, ' ').replace(/&amp;/g, '&');
const buttons = (html: string) => Array.from(html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g), ([, attributes, inner]) =>
  /aria-label="([^"]*)"/.exec(attributes)?.[1] ?? inner.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim());
/** The choices of one group of radio buttons: what each says, and whether it is chosen. */
const choices = (html: string, legend: string): { label: string; checked: boolean }[] => {
  const group = new RegExp(`<fieldset[^>]*><legend[^>]*>${legend}.*?</legend>(.*?)</fieldset>`).exec(html)?.[1] ?? '';
  return Array.from(group.matchAll(/<label[^>]*><input type="radio"([^>]*)\/>(.*?)<\/label>/g), ([, attributes, inner]) => ({
    label: /aria-label="([^"]*)"/.exec(attributes)?.[1] ?? inner.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim(),
    checked: attributes.includes('checked=""'),
  }));
};
const chosenOf = (html: string, legend: string) => choices(html, legend).filter((choice) => choice.checked).map((choice) => choice.label);
const optionsOf = (html: string, label: string): { label: string; selected: boolean }[] => {
  const id = new RegExp(`<label for="([^"]*)"[^>]*>${label}`).exec(html)?.[1] ?? 'none';
  const select = new RegExp(`<select id="${id}"[^>]*>(.*?)</select>`).exec(html)?.[1] ?? '';
  return Array.from(select.matchAll(/<option([^>]*)>([^<]*)<\/option>/g), ([, attributes, text]) =>
    ({ label: text.replace(/&amp;/g, '&'), selected: attributes.includes('selected') }));
};
// The formats that no screen writes any more: ISO dates, slashes, a.m./p.m., a spaced hyphen between times, a bare number.
const OLD_FORMATS = /\b20\d\d-\d\d-\d\d\b|\bGMT\b|Europe\/|\b\d{1,2}:\d{2}\s?(AM|PM)\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\d{2}:\d{2} - \d{2}:\d{2}|\+41\d{9}\b/;

test('closed, the form draws nothing', () => {
  assert.equal(form(null), '');
});

test('opened from "+": the customer field first, then everything filled in with what is free', () => {
  const html = form({ kind: 'new' });
  assert.match(html, /^<dialog aria-labelledby="([^"]+)"[^>]*><form noValidate=""/);
  assert.match(html, /<h2 id="[^"]+" tabindex="-1"[^>]*>New appointment<\/h2>/);
  // The customer: a search field with a name, and the way to somebody new.
  assert.match(html, /<label for="([^"]+)"[^>]*>Customer<\/label>.*<input id="\1" type="text" inputMode="search" enterKeyHint="search" role="combobox" aria-autocomplete="list" aria-expanded="false"/);
  assert.match(html, /placeholder="Name or phone number"/);
  assert.deepEqual(buttons(html), ['Close', 'New customer', 'Cancel', 'Save appointment']);
  // The service: every service of the salon with its length, the first one chosen.
  const services = optionsOf(html, 'Service');
  assert.equal(services.length, initialServices.length);
  assert.deepEqual(services.find((option) => option.selected), { label: 'Wash & blow-dry · 30 min', selected: true });
  assert.ok(services.some((option) => option.label === 'Balayage · 180 min'));
  // The stylist: "Anyone free" besides the names. Luca does not work on Wednesdays, which the choice says.
  assert.deepEqual(choices(html, 'Stylist'), [
    { label: 'Anyone free', checked: true }, { label: 'Anna Weber', checked: false },
    { label: 'Selina Keller', checked: false }, { label: 'Luca Frei, no free time on this day', checked: false },
  ]);
  // The day: two weeks to tap, today chosen, and a date field for any other day from today on.
  const days = choices(html, 'Day');
  assert.equal(days.length, 14);
  assert.deepEqual(days.slice(0, 3), [
    { label: 'Today, 07.10.2026', checked: true }, { label: 'Tomorrow, 08.10.2026', checked: false }, { label: 'Friday, 09.10.2026', checked: false },
  ]);
  assert.deepEqual(days.filter((day) => day.label.endsWith('no free time')).map((day) => day.label).slice(0, 2), ['Sunday, 11.10.2026, no free time', 'Monday, 12.10.2026, no free time']);
  assert.match(html, /<label for="([^"]+)"[^>]*>Another day<\/label><input id="\1" type="date" min="2026-10-07"[^>]*value="2026-10-07"/);
  // The time: the next free one is chosen, and nothing that has begun is offered.
  const times = choices(html, 'Time');
  assert.deepEqual(times.slice(0, 3), [{ label: '10:30', checked: true }, { label: '11:00', checked: false }, { label: '11:30', checked: false }]);
  assert.equal(times.length, 15);
  assert.deepEqual(Array.from(html.matchAll(/<p class="[^"]*uppercase[^"]*">([^<]+)<\/p>/g), (match) => match[1]), ['Morning', 'Afternoon', 'Evening']);
  // The switch is off, with a line that says what it is for.
  assert.match(html, /<input type="checkbox" role="switch" aria-describedby="([^"]+)" class="peer sr-only"\/>.*Book outside opening hours.*<p id="\1"[^>]*>.*For an appointment you have agreed outside the usual hours/);
  assert.deepEqual(choices(html, 'How the booking came in'), [{ label: 'Phone', checked: true }, { label: 'Walk-in', checked: false }, { label: 'Other', checked: false }]);
  // What would be saved, and what is still needed for it.
  const text = shown(html);
  assert.match(text, /Wed, 07\.10\.2026, 10:30–11:00 Wash & blow-dry with Selina Keller · CHF 45\.00/);
  assert.match(text, /Still needed: a customer\./);
});

test('nothing in the form gives a class exercise away, formats a date by itself or is too small for a finger', () => {
  const states = [
    form({ kind: 'new' }),
    form({ kind: 'new', customerId: 'cust-001' }),
    form({ kind: 'new', date: '2026-10-12' }),
    form({ kind: 'new', date: '2026-10-08', time: '13:30', employeeId: 'emp-1' }),
    form({ kind: 'new' }, { initially: { customer: { kind: 'search', query: '076 555' } } }),
    form({ kind: 'new' }, { initially: { customer: { kind: 'new', name: 'Petra Meier', phone: '079 123 45 67', language: 'DE' } } }),
    form({ kind: 'new', date: '2026-10-09', employeeId: 'emp-1' }, { initially: { outsideHours: true, time: '19:00', timeChosen: true } }),
    form({ kind: 'edit', appointmentId: 'cal-20261003-e1-1200' }),
    form({ kind: 'edit', appointmentId: 'cal-gone' }),
    form({ kind: 'new' }, { salon: salon({ services: [] }) }),
  ];
  for (const [index, html] of states.entries()) {
    const text = shown(html);
    assert.doesNotMatch(text, TELL_WORDS, `state ${index}`);
    assert.doesNotMatch(text, OLD_FORMATS, `state ${index}`);
    // Nothing claims that anybody was told about the appointment.
    assert.doesNotMatch(text, /\b(sent|notif\w*|remind\w*|confirmation|will be told|we tell)\b/i, `state ${index}`);
    // One word for one thing.
    assert.doesNotMatch(text, /\b(employee|staff member|client|shift)\b/i, `state ${index}`);
    // Fields: 16 px text on phones and a height a finger can hit. Buttons and choices: 44 px high.
    for (const [field] of html.matchAll(/<(?:input(?![^>]*type="(?:radio|checkbox)")|select)\b[^>]*>/g)) {
      assert.match(field, /class="[^"]*\bmin-h-11\b[^"]*\btext-base\b/, `state ${index}: ${field.slice(0, 80)}`);
    }
    for (const [button] of html.matchAll(/<button\b[^>]*>/g)) assert.match(button, /\b(min-h-11|min-h-12|h-11 w-11)\b/, `state ${index}: ${button.slice(0, 120)}`);
    for (const [, look] of html.matchAll(/<input type="radio"[^>]*\/><span class="([^"]*)"/g)) assert.match(look, /\b(min-h-11|h-14)\b/, `state ${index}`);
    // Every control has a name: a label, a legend with a label around it, or an aria-label.
    assert.doesNotMatch(html, /<button\b[^>]*>\s*<\/button>/, `state ${index}`);
    for (const [, id] of html.matchAll(/<(?:input|select)\b(?![^>]*(?:type="radio"|type="checkbox"|aria-label=))[^>]*\bid="([^"]+)"/g)) {
      assert.ok(html.includes(`<label for="${id}"`), `state ${index}: no label for ${id}`);
    }
    // Enter never saves from a required field: the form checks itself and says what is missing.
    assert.doesNotMatch(html, /\brequired\b/, `state ${index}`);
    assert.doesNotMatch(html, /disabled=""(?![^>]*>Choose a)/, `state ${index}`);
  }
});

test('searching: a few letters list the customers with their numbers, written the one way', () => {
  const html = form({ kind: 'new' }, { initially: { customer: { kind: 'search', query: 'mei' } } });
  assert.match(html, /role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="([^"]+)"[^>]*value="mei"/);
  const options = Array.from(html.matchAll(/<button id="[^"]+" type="button" role="option" aria-selected="false" tabindex="-1"[^>]*>(.*?)<\/button>/g), ([, inner]) =>
    inner.replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.deepEqual(options, ['Petra Meier +41 76 555 62 42', 'Ruth Meier +41 79 555 40 60', 'Roland Meier +41 76 555 40 10']);
  assert.match(html, /<div id="[^"]+" role="listbox" aria-label="Customers found"/);
  // Nobody found, and too many found: each says so.
  assert.match(shown(form({ kind: 'new' }, { initially: { customer: { kind: 'search', query: 'zz' } } })), /No customer found for “zz”\./);
  assert.match(shown(form({ kind: 'new' }, { initially: { customer: { kind: 'search', query: '079 555' } } })), /\d+ more customers match\. Type more of the name or number\./);
  // The search itself never dials: a number in the list is text.
  assert.doesNotMatch(html, /href="tel:/);
});

test('a chosen customer is shown with number, language, visits and next appointment, and can be changed', () => {
  const html = form({ kind: 'new', customerId: 'cust-marie' });
  const text = shown(html);
  assert.match(text, /Customer MD Marie Dupont \+41 79 555 61 12 · French 1 visit · next appointment Thu, 08\.10\.2026, 13:30/);
  assert.ok(buttons(html).includes('Change customer (Marie Dupont)'));
  assert.doesNotMatch(html, /role="combobox"/);
  // Complete: the summary names her, and nothing is said to be missing.
  assert.match(text, /Wed, 07\.10\.2026, 10:30–11:00 Marie Dupont · Wash & blow-dry with Selina Keller · CHF 45\.00/);
  assert.doesNotMatch(text, /Still needed/);
  // The owner's note on the customer stands with her: an allergy has to be seen before anything is booked.
  const withNote = demoCustomers.map((customer) => customer.id === 'cust-marie' ? { ...customer, note: 'Allergic to PPD.\nPrefers Anna.' } : customer);
  assert.match(form({ kind: 'new', customerId: 'cust-marie' }, { customers: withNote }), /<span class="sr-only">Note: <\/span>Allergic to PPD\.\nPrefers Anna\.<\/span>/);
  // Somebody without a number: the form offers to add one, and says where it goes.
  const tom: Customer = { id: 'cust-tom', name: 'Tom', initials: 'T', email: '', phone: '', language: 'DE', channel: 'Website' };
  const withoutNumber = form({ kind: 'new', customerId: 'cust-tom' }, { customers: [tom, ...demoCustomers] });
  assert.match(shown(withoutNumber), /Tom No phone number · German No visits yet/);
  assert.match(withoutNumber, /<label for="([^"]+)"[^>]*>Mobile number <span[^>]*>\(optional\)<\/span><\/label><input id="\1" type="tel" inputMode="tel"/);
  assert.match(shown(withoutNumber), /Tom has no number yet\. One you enter here is saved with the customer\./);
  // Somebody with a number gets no such field: a number the salon has is not replaced from here.
  assert.doesNotMatch(html, /type="tel"/);
});

test('somebody new: name, mobile number and language, German unless the owner says otherwise', () => {
  const html = form({ kind: 'new' }, { initially: { customer: { kind: 'new', name: '', phone: '', language: 'DE' } } });
  assert.match(html, /<p id="[^"]+" class="[^"]*">New customer<\/p>/);
  assert.match(html, /<label for="([^"]+)"[^>]*>Name<\/label><input id="\1" type="text" autoComplete="off" autoCapitalize="words" placeholder="First and last name"/);
  assert.match(html, /<label for="([^"]+)"[^>]*>Mobile number <span[^>]*>\(optional\)<\/span><\/label><input id="\1" type="tel" inputMode="tel" autoComplete="off" placeholder="079 123 45 67"/);
  assert.deepEqual(optionsOf(html, 'Language'), [
    { label: 'German', selected: true }, { label: 'French', selected: false }, { label: 'Italian', selected: false }, { label: 'English', selected: false },
  ]);
  assert.ok(buttons(html).includes('Search instead'));
  assert.match(shown(html), /Still needed: the customer’s name\./);
  assert.doesNotMatch(html, /is already a customer/);
  // A name or a number the salon knows: the record is offered, and the owner decides.
  const known = form({ kind: 'new' }, { initially: { customer: { kind: 'new', name: 'petra meier', phone: '', language: 'DE' } } });
  assert.match(shown(known), /Petra Meier \( ?\+41 76 555 62 42 ?\) is already a customer\. Use this customer/);
  const sameNumber = form({ kind: 'new' }, { initially: { customer: { kind: 'new', name: 'Lena Meier', phone: '076 555 62 42', language: 'DE' } } });
  assert.match(shown(sameNumber), /Petra Meier \( ?\+41 76 555 62 42 ?\) is already a customer\./);
  // The summary is read out whenever it changes: a name that is still being typed is not part of it.
  assert.match(shown(known), /10:30–11:00 Wash & blow-dry with Selina Keller/);
});

test('the picker alone: a customer who is gone, and one that an old appointment only names', () => {
  const picker = (value: React.ComponentProps<typeof CustomerPicker>['value']) => render(React.createElement(CustomerPicker, {
    customers: demoCustomers, value, onChange: nothing, id: 'who', events: demoEvents, now: WEDNESDAY, timeZone: 'Europe/Zurich',
  }));
  assert.match(shown(picker({ kind: 'kept', name: 'Walk-in guest' })), /Customer Walk-in guest Not in your customer list Change/);
  assert.match(shown(picker({ kind: 'existing', customerId: 'cust-gone', phone: '' })), /This customer No longer in your customer list/);
  assert.match(picker({ kind: 'search', query: '' }), /<label for="who-search"[^>]*>Customer<\/label>/);
});

test('from a place in the calendar that is taken, the form says who has it and offers the nearest free times', () => {
  const html = form({ kind: 'new', date: '2026-10-08', time: '13:30', employeeId: 'emp-1' });
  assert.deepEqual(chosenOf(html, 'Stylist'), ['Anna Weber']);
  assert.deepEqual(chosenOf(html, 'Day'), ['Tomorrow, 08.10.2026']);
  assert.deepEqual(chosenOf(html, 'Time'), []);
  assert.match(html, /<div role="status"[^>]*><p[^>]*>13:30–14:00 is not free: Anna Weber has Marie Dupont at 13:30–14:00\.<\/p><p[^>]*>Nearest free times<\/p>/);
  assert.deepEqual(buttons(html).filter((label) => /^\d\d:\d\d$/.test(label)), ['12:30', '13:00', '14:00', '15:00']);
  assert.match(shown(html), /Still needed: a customer and a time\./);
  // A free place: the half hour that was clicked is the chosen one.
  const free = form({ kind: 'new', date: '2026-10-08', time: '13:30' });
  assert.deepEqual([chosenOf(free, 'Stylist'), chosenOf(free, 'Time')], [['Selina Keller'], ['13:30']]);
});

test('a closed day says so and offers the next free day; so does a day that is full', () => {
  const closed = form({ kind: 'new', date: '2026-10-12', customerId: 'cust-001' });
  assert.match(closed, /<div role="status"[^>]*><p[^>]*>The salon is closed on Mondays\.<\/p><p[^>]*>Choose another day, or switch on “Book outside opening hours”\.<\/p>/);
  assert.ok(buttons(closed).includes('Next free day: Tue, 13.10.2026'));
  assert.deepEqual(choices(closed, 'Time'), []);
  assert.match(shown(closed), /Still needed: a time\./);
  // The switch the sentence names is in the form, right below.
  assert.match(closed, /role="switch"/);
  assert.deepEqual(chosenOf(closed, 'Day'), ['Monday, 12.10.2026, no free time']);

  const full = form({ kind: 'new', date: '2026-10-10', serviceId: 'srv-9', employeeId: 'emp-1' });
  assert.match(shown(full), /No free time is left on Sat, 10\.10\.2026 for Balayage with Anna Weber\. For a time outside the usual hours, switch on “Book outside opening hours”\./);
  assert.ok(buttons(full).includes('Next free day: Tue, 13.10.2026'));
  // A stylist who is off while others are free: "Anyone free on this day" is one tap.
  const off = form({ kind: 'new', date: '2026-10-08', employeeId: 'emp-3' });
  assert.match(shown(off), /Luca Frei does not work on Thu, 08\.10\.2026\./);
  assert.deepEqual(buttons(off).filter((label) => /Next free day|Anyone free on this day/.test(label)), ['Next free day: Fri, 09.10.2026', 'Anyone free on this day']);
  // A closed date: the switch would not help, and the form does not say it would.
  const holiday = form({ kind: 'new', date: '2026-10-08' }, { salon: salon({ closedDates: [{ id: 'c', name: 'Team day', start: '2026-10-08', end: '2026-10-08' }] }) });
  assert.match(shown(holiday), /The salon is closed on Thu, 08\.10\.2026 \(Team day\)\. To book on this day, remove the closed date in Settings first\./);
  // Opened without a day on an evening when nothing is left: the form is on the next day and says why.
  const evening = form({ kind: 'new' }, { now: new Date('2026-10-07T16:20:00Z') });
  assert.match(evening, /<p role="status"[^>]*>No time is left today for Wash &amp; blow-dry\. The next free time is on Thu, 08\.10\.2026\.<\/p>/);
  assert.deepEqual(chosenOf(evening, 'Day'), ['Tomorrow, 08.10.2026']);
});

test('a salon in which nothing can be booked yet: one sentence, the way to put it right, and no Save', () => {
  const noServices = form({ kind: 'new' }, { salon: salon({ services: [] }) });
  assert.match(noServices, /<div role="status"[^>]*><p[^>]*>You have no services yet\. Add a service first: then you can book appointments\.<\/p>/);
  assert.deepEqual(buttons(noServices), ['Close', 'Open Services', 'Close']);
  const noTeam = form({ kind: 'new' }, { salon: salon({ employees: [] }) });
  assert.deepEqual(buttons(noTeam), ['Close', 'Open Team', 'Close']);
  // Without a way to another screen the sentence still stands.
  assert.deepEqual(buttons(form({ kind: 'new' }, { salon: salon({ services: [] }), onOpenScreen: undefined })), ['Close', 'Close']);
  // A service nobody offers: said under the service, where another one is chosen.
  const ownerInactive = salon({ employees: initialEmployees.map((employee) => employee.id === 'emp-1' ? { ...employee, status: 'Inactive' as const } : employee) });
  const balayage = form({ kind: 'new', serviceId: 'srv-9' }, { salon: ownerInactive });
  assert.match(balayage, /<p role="status"[^>]*>Nobody in your team offers Balayage\. Choose another service, or choose in Team who offers it\.<\/p>/);
  assert.deepEqual(choices(balayage, 'Stylist'), []);
  assert.ok(buttons(balayage).includes('Save appointment'));
});

test('editing a past appointment: its own day and time, "Save changes", and no source it never had', () => {
  const html = form({ kind: 'edit', appointmentId: 'cal-20261003-e1-1200' });
  assert.match(html, /<h2[^>]*>Edit appointment<\/h2>/);
  assert.deepEqual(buttons(html), ['Close', 'Change customer (Corinne Fischer)', 'Cancel', 'Save changes']);
  assert.deepEqual(optionsOf(html, 'Service').find((option) => option.selected)?.label, 'Cut & blow-dry · 60 min');
  assert.deepEqual(chosenOf(html, 'Stylist'), ['Anna Weber']);
  // The day lies before the two weeks of the quick choice: the date field shows it, and lets it stay.
  assert.deepEqual(chosenOf(html, 'Day'), []);
  assert.match(html, /<label for="([^"]+)"[^>]*>Chosen day<\/label><input id="\1" type="date" min="2026-10-03"[^>]*value="2026-10-03"/);
  assert.deepEqual(choices(html, 'Time'), [{ label: '12:00', checked: true }]);
  const text = shown(html);
  assert.match(text, /Sat, 03\.10\.2026, 12:00–13:00 Corinne Fischer · Cut & blow-dry with Anna Weber · CHF 89\.00/);
  assert.doesNotMatch(text, /Still needed|How the booking came in|next appointment/);
  // An appointment that was entered by hand shows its source, which can be corrected.
  const byHand: CalendarEvent = { ...demoEvents.find((event) => event.id === 'cal-2')!, id: 'cal-hand', isAiBooked: false, conversationId: undefined, date: '2026-10-09', startTime: '12:00', endTime: '12:30', source: 'walk-in' };
  const withSource = form({ kind: 'edit', appointmentId: 'cal-hand' }, { salon: salon({ events: [byHand, ...demoEvents] }) });
  assert.deepEqual(chosenOf(withSource, 'How the booking came in'), ['Walk-in']);
  // One that is gone says so and offers nothing to fill in.
  const gone = form({ kind: 'edit', appointmentId: 'cal-gone' });
  assert.match(shown(gone), /This appointment is no longer in the calendar\. It may have been cancelled in the meantime\./);
  assert.deepEqual(buttons(gone), ['Close', 'Close']);
});

test('a stylist who can no longer be booked is named, and nobody is chosen in their place', () => {
  const lucas = demoEvents.find((event) => event.employeeId === 'emp-3' && event.date < '2026-10-07')!;
  const inactive = salon({ employees: initialEmployees.map((employee) => employee.id === 'emp-3' ? { ...employee, status: 'Inactive' as const } : employee) });
  const html = form({ kind: 'edit', appointmentId: lucas.id }, { salon: inactive });
  assert.match(html, /<p role="status"[^>]*>Luca Frei is set to inactive and takes no appointments\. Choose another stylist, or set Luca Frei to active in Team\.<\/p>/);
  assert.deepEqual(chosenOf(html, 'Stylist'), []);
  assert.ok(choices(html, 'Stylist').length >= 2);
  // No day and no time before somebody is chosen: they would be nobody's.
  assert.doesNotMatch(html, /<legend[^>]*>\s*(Day|Time)\b/);
  assert.match(shown(html), /Still needed: a stylist and a time\./);
});

test('"Book outside opening hours": a plain warning, the day in three parts, and no change of working hours', () => {
  const html = form({ kind: 'new', date: '2026-10-09', employeeId: 'emp-1', customerId: 'cust-chloe' }, { initially: { outsideHours: true, time: '19:00', timeChosen: true } });
  assert.match(html, /<input type="checkbox" role="switch" aria-describedby="[^"]+" class="peer sr-only" checked=""\/>/);
  const text = shown(html);
  assert.match(text, /Book outside opening hours You can now choose times while the salon is closed or the stylist is not working\. Only use this for an appointment you have agreed yourself, and make sure the stylist knows\./);
  assert.deepEqual(Array.from(html.matchAll(/<p class="[^"]*uppercase[^"]*">([^<]+)<\/p>/g), (match) => match[1]), ['Before opening', 'During opening hours', 'After closing']);
  assert.deepEqual(chosenOf(html, 'Time'), ['19:00']);
  const times = choices(html, 'Time').map((choice) => choice.label);
  assert.deepEqual([times[0], times.at(-1)], ['06:00', '22:30']);
  // Times outside the usual hours are drawn apart, and the form says what the line means.
  assert.equal(html.match(/border-dashed/g)?.length, 17); // 5 before opening, 3 before her start, 9 after closing
  assert.match(text, /A dashed time lies outside your opening hours or the stylist’s working hours\./);
  // Before saving: where the time lies, and not a word about changing anybody's working hours.
  assert.match(text, /Fri, 09\.10\.2026, 19:00–19:30 Chloé Favre · Wash & blow-dry with Anna Weber · CHF 45\.00 This time is outside your opening hours\. Cancel/);
  assert.doesNotMatch(text, /This also changes|now works|adds working hours/);
  // Inside the opening hours but before Anna's start: the form names her working hours instead.
  const early = shown(form({ kind: 'new', date: '2026-10-09', employeeId: 'emp-1', customerId: 'cust-chloe' }, { initially: { outsideHours: true, time: '08:30', timeChosen: true } }));
  assert.match(early, /This time is outside Anna Weber’s working hours\. Cancel/);
  assert.doesNotMatch(early, /outside your opening hours\.|This also changes/);
  // Off: none of it.
  const off = form({ kind: 'new', date: '2026-10-09', employeeId: 'emp-1' });
  assert.doesNotMatch(off, /border-dashed|checked=""\/><span class="relative h-6/);
  assert.doesNotMatch(shown(off), /dashed time|outside your opening hours\.|This also changes/);
});

test('a large team is chosen from a list, with "Anyone free" first', () => {
  const more: Employee[] = Array.from({ length: 5 }, (_, index) => ({ ...initialEmployees[2], id: `emp-x${index}`, firstName: 'Mia', lastName: `Graf ${index + 1}`, name: `Mia Graf ${index + 1}`, role: undefined }));
  const large = salon({
    employees: [...initialEmployees, ...more],
    services: initialServices.map((service) => ({ ...service, assignedEmployeeIds: [...(service.assignedEmployeeIds ?? []), ...more.map((employee) => employee.id)] })),
  });
  const html = form({ kind: 'new' }, { salon: large });
  const list = /<select aria-label="Stylist"[^>]*>(.*?)<\/select>/.exec(html)?.[1] ?? '';
  const options = Array.from(list.matchAll(/<option([^>]*)>([^<]*)<\/option>/g), ([, attributes, text]) => `${text}${attributes.includes('selected') ? ' *' : ''}`);
  assert.deepEqual(options.slice(0, 3), ['Anyone free *', 'Anna Weber', 'Selina Keller']);
  assert.equal(options.length, 9);
  assert.ok(options.includes('Luca Frei (no free time that day)'));
  assert.deepEqual(choices(html, 'Stylist'), []);
});

test('the app has one form, opened over the screen the owner is on: from the header, the tab bar and a customer\'s profile', () => {
  // The app itself cannot be drawn without a browser, so its wiring is read: one mount, one
  // function that opens it, and no way that leads through the Calendar page any more.
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.equal(app.match(/<AppointmentForm\b/g)?.length, 1);
  assert.match(app, /const openAppointmentForm = \(request: AppointmentFormRequest\) => \{/);
  assert.match(app, /const newAppointment = \(\) => openAppointmentForm\(\{ kind: 'new' \}\);/);
  // The header, and "+" in the tab bar. A link on another screen takes the same function.
  assert.ok((app.match(/onNewAppointment=\{newAppointment\}/g)?.length ?? 0) >= 2);
  assert.match(app, /onNewAppointment=\{\(customerId\) => openAppointmentForm\(\{ kind: 'new', customerId \}\)\}/);
  assert.doesNotMatch(app, /setStartNewAppointment\(true\)/);
  // After saving: a message with "View", which opens the appointment in the calendar.
  assert.match(app, /label: 'View', onClick: \(\) => \{ setToast\(null\); openAppointment\(saved\); \}/);
  // What the form stores goes through the slot rules as the salon stands, and changes nobody's working hours.
  assert.match(app, /const storeCalendarEvent = \(ev: Omit<CalendarEvent, 'id'>, id: string, chat\?: ChatContact\)[^\n]*\n\s*const validationError = validateCalendarEvent\(availabilityContext, ev, id\);/);
  const saving = app.slice(app.indexOf('const handleSaveAppointment'), app.indexOf('const handleDeleteCalendarEvent'));
  assert.ok(saving.length > 0);
  assert.doesNotMatch(saving, /handleUpdateShift|withDayChanges|dayChanges/);
});

test('moving a past visit shows a plain note above the buttons; Save stays as it is', () => {
  // Saturday 3 October, 12:00 with the owner: Corinne Fischer's visit, moved to Friday.
  const html = form({ kind: 'edit', appointmentId: 'cal-20261003-e1-1200' }, { initially: { date: '2026-10-09', time: '12:00', timeChosen: true } });
  const text = shown(html);
  assert.match(text, /The visit on Sat, 03\.10\.2026 will no longer be in the calendar or in Corinne Fischer’s history\. Cancel Save changes/);
  assert.doesNotMatch(html, /role="alert"/);
  // Opened as it is: no note.
  assert.doesNotMatch(shown(form({ kind: 'edit', appointmentId: 'cal-20261003-e1-1200' })), /will no longer be/);
});

test('closing the form with something entered asks first; Escape in the customer search closes the list first', () => {
  // Static drawing cannot press keys, so the wiring is read; the rules are in tests/appointmentForm.test.ts.
  const source = readFileSync(new URL('../src/components/AppointmentForm.tsx', import.meta.url), 'utf8');
  // Every way of closing goes through close(): Escape and Back (the dialog's cancel), the X, Cancel.
  assert.match(source, /onCancel=\{\(event\) => \{ event\.preventDefault\(\); close\(\); \}\}/);
  assert.match(source, /if \(!saved && draftTouched\(opened, draft\) && !window\.confirm\(discardQuestion\(draft\)\)\) return;/);
  // Saving closes without the question.
  assert.match(source, /close\(onClose, true\);/);
  const picker = readFileSync(new URL('../src/components/CustomerPicker.tsx', import.meta.url), 'utf8');
  assert.match(picker, /if \(event\.key === 'Escape' && listOpen\) \{\s*\/\/[^\n]*\n\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  // Nothing typed yet: the list is closed and says so.
  const opened = form({ kind: 'new' });
  assert.match(opened, /role="combobox" aria-autocomplete="list" aria-expanded="false"/);
});
