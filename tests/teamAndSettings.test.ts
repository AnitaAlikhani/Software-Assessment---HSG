import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { SectionTabs } from '../src/components/SectionTabs';
import { isValidDate } from '../src/dateRangeForm';
import { deletionDependency } from '../src/managementDependencies';
import { initialBookingHours, initialCompanySettings, initialEmployees } from '../src/mockData';
import { SETTINGS_TABS, TEAM_TABS } from '../src/navigation';
import { DeleteEmployee, EmployeesView } from '../src/views/EmployeesView';
import { SettingsView } from '../src/views/SettingsView';
import { TeamView } from '../src/views/TeamView';
import { demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// Team is the one place that decides who works when: the people, their week and their days off.
// Settings holds what is true for the whole salon. Each of the two is one page with tabs.

const nothing = () => {};
const ZONE = 'Europe/Zurich';
/** The tabs of a page, with a star on the open one. */
const tabsOf = (html: string) => Array.from(html.matchAll(/<button type="button" role="tab"[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/button>/g), ([, selected, label]) => `${label}${selected === 'true' ? '*' : ''}`);
const headings = (html: string, level: 1 | 2 | 3) => Array.from(html.matchAll(new RegExp(`<h${level}[^>]*>\\s*(.*?)\\s*</h${level}>`, 'g')), (match) => match[1]);

// ---------- Team ----------

const team = (partial: Partial<React.ComponentProps<typeof TeamView>> = {}) => render(React.createElement(TeamView, {
  employees: initialEmployees, onAddEmployee: nothing, onUpdateEmployee: nothing, onDeleteEmployee: nothing,
  shiftOverview: demoShifts, onUpdateShift: nothing, absences: [], onSaveAbsences: nothing, timeZone: ZONE, now: FIXED_NOW, ...partial,
}));

test('Team is one page with the tabs People, This week and Absences', () => {
  const html = team();
  assert.deepEqual(headings(html, 1), ['Team']);
  assert.deepEqual(tabsOf(html), ['People*', 'This week', 'Absences']);
  assert.match(html, /<div role="tablist" aria-label="Team"/);
  // The open tab is tied to its panel, and only the open tab is in the tab order.
  assert.match(html, /id="team-tab-people" aria-selected="true" aria-controls="team-panel" tabindex="0"/);
  assert.match(html, /id="team-tab-week" aria-selected="false" tabindex="-1"/);
  assert.match(html, /<div role="tabpanel" id="team-panel" aria-labelledby="team-tab-people">/);
  assert.deepEqual(tabsOf(team({ tab: 'week' })), ['People', 'This week*', 'Absences']);
  assert.deepEqual(tabsOf(team({ tab: 'absences' })), ['People', 'This week', 'Absences*']);
  for (const tab of ['people', 'week', 'absences'] as const) {
    assert.deepEqual(headings(team({ tab }), 1), ['Team'], tab);
    assert.doesNotMatch(readableText(team({ tab })), TELL_WORDS, tab);
    // The old names of the three places are gone.
    assert.doesNotMatch(readableText(team({ tab })), /Shift Plan|Company Settings|Employees\b/, tab);
  }
});

test('People is the list of the team, without a bin in its rows', () => {
  const html = team();
  for (const person of initialEmployees) {
    assert.ok(html.includes(`aria-label="Edit ${person.name}"`), person.name);
    assert.ok(html.includes(person.email), person.email);
  }
  assert.match(html, />\+41 79 555 31 08</);
  assert.match(html, />Owner</);
  assert.match(html, /<span>New employee<\/span>/);
  // Deleting is not a tap in a list any more.
  assert.doesNotMatch(html, /Delete|lucide-trash/);
  assert.doesNotMatch(html, /Actions/);
});

test('a person is deleted in their own form, which asks first and says why when it cannot', () => {
  const selina = initialEmployees[1];
  const section = render(React.createElement(DeleteEmployee, { employee: selina, blocked: null, onDelete: () => null, onDeleted: nothing }));
  assert.match(section, /<h2[^>]*>Delete this employee<\/h2>/);
  assert.match(section, /Removes Selina Keller from the team, with their shifts and absences\./);
  // One button, and it does not delete yet: the ellipsis says that a question follows.
  const controls = Array.from(section.matchAll(/<button[^>]*>\s*(.*?)\s*<\/button>/g), (match) => match[1]);
  assert.deepEqual(controls, ['Delete…']);
  assert.match(section, /<button type="button" class="[^"]*\bmin-h-11\b/);

  // The salon's rule stays: somebody whom appointments or requests still use cannot be deleted.
  const reason = deletionDependency('employee', selina.id, selina.name, demoEvents, demoRequests);
  assert.match(reason ?? '', /^Cannot delete Selina Keller: \d+ appointments? and \d+ pending requests? still use this employee\. Cancel or reassign them first\.$/);
  const blocked = render(React.createElement(DeleteEmployee, { employee: selina, blocked: reason, onDelete: () => reason, onDeleted: nothing }));
  assert.ok(blocked.includes(`>${reason}</p>`));
  // The reason stands in the button's place: no control that would only refuse.
  assert.doesNotMatch(blocked, /<button/);
  // Somebody new, with nothing booked, can be deleted.
  assert.equal(deletionDependency('employee', 'emp-new', 'Mira Probst', demoEvents, demoRequests), null);
});

test('the list of people works by itself, and names nothing that the page around it names', () => {
  const html = render(React.createElement(EmployeesView, { employees: [], onAddEmployee: nothing, onUpdateEmployee: nothing, onDeleteEmployee: nothing }));
  // Team gives the page its title; the list has a heading of the second order.
  assert.deepEqual(headings(html, 1), []);
  assert.deepEqual(headings(html, 2), ['People']);
  assert.match(html, /No employees yet\. Add the first team member above\./);
});

test('This week is the shift plan: the week, the people and their shifts', () => {
  const html = team({ tab: 'week' });
  const text = readableText(html).replace(/\s+/g, ' ');
  assert.match(text, /05\.–11\.10\.2026/);
  assert.match(text, /Employee Mon 05\.10\. Tue 06\.10\./);
  for (const person of initialEmployees) assert.ok(html.includes(`aria-label="View shifts for ${person.name}"`), person.name);
  assert.match(text, /New shift/);
  assert.match(text, /Booking slots follow salon opening hours and staff shifts\./);
  assert.deepEqual(headings(html, 2), ['Shifts']);
});

test('Absences moved to Team with the list and the form they had in the settings', () => {
  const html = team({
    tab: 'absences',
    absences: [
      { id: 'a-1', employeeId: 'emp-2', start: '2026-10-13', end: '2026-10-13', reason: 'Course' },
      { id: 'a-2', employeeId: 'emp-3', start: '2026-12-24', end: '2027-01-02' },
      { id: 'a-3', employeeId: 'emp-gone', start: '2026-11-02', end: '2026-11-03', reason: 'Holiday' },
    ],
  });
  const text = readableText(html).replace(/\s+/g, ' ');
  assert.match(text, /Block booking for one employee while they are away\. Both the first and last day are included\. Changes save immediately; existing appointments are kept\./);
  assert.match(text, /Selina Keller: Course Tue, 13\.10\.2026/);
  assert.match(text, /Luca Frei 24\.12\.2026–02\.01\.2027/);
  // An absence of somebody who is no longer in the team is still listed, so it can be removed.
  assert.match(text, /Removed employee: Holiday/);
  for (const name of ['Edit absence for Selina Keller', 'Delete absence for Selina Keller', 'Edit absence for Luca Frei']) assert.ok(html.includes(`aria-label="${name}"`), name);
  // The form: who, why, from when to when.
  assert.match(html, /<label for="absence-employee"[^>]*>Employee<\/label><select id="absence-employee" required=""/);
  for (const person of initialEmployees) assert.ok(html.includes(`<option value="${person.id}">${person.name}</option>`), person.name);
  assert.match(html, /<label for="absence-reason"[^>]*>Reason \(optional\)<\/label>/);
  assert.match(html, /<input id="absence-start" type="date" required="" [^>]*value="2026-10-05"/);
  assert.match(html, /<input id="absence-end" type="date" required="" min="2026-10-05" [^>]*value="2026-10-05"/);
  assert.match(html, />Save absence<\/button>/);
  // Fields a thumb can use: 44 px high, 16 px text on phones.
  for (const field of html.match(/<(?:select|input) id="absence-[^>]*>/g) ?? []) { assert.match(field, /\bmin-h-11\b/); assert.match(field, /\btext-base\b/); }
  // Closures of the whole salon are not here.
  assert.doesNotMatch(text, /Closure|closure|whole salon/);
  // An empty list says so.
  assert.match(team({ tab: 'absences' }), /No staff absences added\./);
});

// ---------- Settings ----------

const settings = (partial: Partial<React.ComponentProps<typeof SettingsView>> = {}) => render(React.createElement(SettingsView, {
  settings: initialCompanySettings, bookingHours: initialBookingHours, onSaveSettings: nothing,
  closedDates: [], onSaveClosedDates: nothing, now: FIXED_NOW, bookingLink: 'https://slotbee.example/?booking=1', ...partial,
}));

test('Settings is one page with the tabs Salon, Opening hours, Closed dates and Online booking', () => {
  const html = settings();
  assert.deepEqual(headings(html, 1), ['Settings']);
  assert.deepEqual(tabsOf(html), ['Salon*', 'Opening hours', 'Closed dates', 'Online booking']);
  assert.match(html, /<div role="tablist" aria-label="Settings"/);
  assert.match(html, /<div role="tabpanel" id="settings-panel" aria-labelledby="settings-tab-salon"/);
  for (const [tab, heading] of [['salon', 'Salon'], ['hours', 'Opening hours'], ['closed-dates', 'Closed dates'], ['online-booking', 'Online booking']] as const) {
    const page = settings({ tab });
    assert.deepEqual(headings(page, 1), ['Settings'], tab);
    assert.deepEqual(headings(page, 2), [heading], tab);
    // The names the page and its parts had before are gone.
    assert.doesNotMatch(readableText(page), /Company Settings|Basic Information|Booking Hours|Company Profile|Closed Dates and Absences/, tab);
  }
});

test('Salon holds everything that Basic Information and Company Profile held, in one form', () => {
  const html = settings();
  const ids = Array.from(html.matchAll(/id="company-(\w+)"/g), (match) => match[1]);
  assert.deepEqual(ids, [
    // what was Basic Information
    'companyName', 'street', 'postalCode', 'city', 'country', 'canton', 'businessPhone',
    // what was Company Profile
    'description', 'website', 'facebook', 'xProfile', 'instagram', 'legalNote',
  ]);
  const text = readableText(html).replace(/\s+/g, ' ');
  for (const part of ['Time zone Central European Time (Zurich)', 'Currency Swiss franc (CHF)', 'Company logo', 'Upload logo', 'Define custom terms & conditions and data privacy text for the booking page']) {
    assert.ok(text.includes(part.replace('&', '&amp;')), part);
  }
  // The profile part says what it is for.
  assert.deepEqual(headings(html, 3), ['On your booking page']);
  // The custom terms open their text field, as before.
  const withTerms = settings({ settings: { ...initialCompanySettings, customTerms: true, termsText: 'Our terms.' } });
  assert.match(withTerms, /<textarea id="company-termsText"[^>]*>Our terms\.<\/textarea>/);
  // One Save for all of it.
  assert.equal(html.match(/<span>Save<\/span>/g)?.length, 1);
});

test('Opening hours is the regular week', () => {
  const html = settings({ tab: 'hours' });
  const days = Array.from(html.matchAll(/aria-label="(\w+) open for booking"/g), (match) => match[1]);
  assert.deepEqual(days, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  assert.equal(html.match(/<span>Save<\/span>/g)?.length, 1);
});

test('Closed dates holds the closures of the whole salon, and says where absences went', () => {
  const html = settings({ tab: 'closed-dates', closedDates: [{ id: 'c-1', name: 'Team day', start: '2026-10-08', end: '2026-10-09' }] });
  const text = readableText(html).replace(/\s+/g, ' ');
  assert.match(text, /Close the whole salon for a holiday or another one-off event\./);
  assert.match(text, /Team day 08\.–09\.10\.2026/);
  assert.match(html, /<label for="closure-name"[^>]*>Closure name<\/label><input id="closure-name" required=""/);
  assert.match(html, />Save closure<\/button>/);
  // No absences here any more: no switch between the two lists, no choice of an employee.
  assert.doesNotMatch(html, /aria-pressed|absence-employee|Choose employee|staff absence/);
  assert.match(text, /Days off for one person are entered in Team, under Absences\./);
  // The way there is offered only where it leads somewhere.
  assert.doesNotMatch(html, /Open Absences/);
  assert.match(settings({ tab: 'closed-dates', onOpenAbsences: nothing }), /<button type="button" class="[^"]*\bmin-h-11\b[^"]*">Open Absences<\/button>/);
  assert.match(settings({ tab: 'closed-dates' }), /No one-off closures added\./);
});

test('Save is offered where it applies, and wherever something waits to be saved', () => {
  const save = /<span>Save<\/span>/;
  // Closures save one by one and the booking link has nothing to save: no page Save on those tabs.
  assert.match(settings({ tab: 'salon' }), save);
  assert.match(settings({ tab: 'hours' }), save);
  assert.doesNotMatch(settings({ tab: 'closed-dates' }), save);
  assert.doesNotMatch(settings({ tab: 'online-booking' }), save);
  // Settings stored before the market was narrowed open with a change to save: then Save and the
  // notice are in reach on every tab.
  const old = { ...initialCompanySettings, country: 'Germany' };
  for (const tab of ['salon', 'hours', 'closed-dates', 'online-booking'] as const) {
    const html = settings({ tab, settings: old });
    assert.match(html, save, tab);
    assert.match(html, /You have unsaved salon details or opening hours\. Select Save to apply them\./, tab);
  }
});

// ---------- what the two pages share ----------

test('the tabs of a page are a real tab list', () => {
  const html = render(React.createElement(SectionTabs, { label: 'Settings', tabs: SETTINGS_TABS, active: 'hours', onChange: nothing, idPrefix: 'settings' }));
  assert.match(html, /^<div role="tablist" aria-label="Settings" class="grid grid-cols-2 /);
  assert.equal(html.match(/role="tab"/g)?.length, 4);
  assert.equal(html.match(/aria-selected="true"/g)?.length, 1);
  assert.equal(html.match(/tabindex="0"/g)?.length, 1);
  // Four names fit a 320 px phone as two rows of two; three names as one row.
  assert.match(render(React.createElement(SectionTabs, { label: 'Team', tabs: TEAM_TABS, active: 'people', onChange: nothing, idPrefix: 'team' })), /class="grid grid-cols-3 /);
  for (const tab of html.match(/<button[^>]*>/g) ?? []) assert.match(tab, /\bmin-h-11\b/);
});

test('a day in a closure or an absence has to be a real day', () => {
  assert.equal(isValidDate('2026-10-05'), true);
  assert.equal(isValidDate('2028-02-29'), true);
  for (const wrong of ['2026-02-30', '2026-13-01', '5.10.2026', '2026-10-5', '']) assert.equal(isValidDate(wrong), false, wrong);
});
