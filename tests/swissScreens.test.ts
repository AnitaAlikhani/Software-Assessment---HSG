import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { SalonTimeNote } from '../src/components/SalonTimeNote';
import { initialAiSettings } from '../src/conversationData';
import { getHeaderSearchResults } from '../src/headerModels';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData';
import { CANTONS, COUNTRIES, SALON_TIME_ZONE, regionToSave, salonAddress, townWithCanton } from '../src/region';
import type { BookingHoursDay, CompanySettingsData, Conversation } from '../src/types';
import { AiAssistantView } from '../src/views/AiAssistantView';
import { AnalyticsView } from '../src/views/AnalyticsView';
import { BookingPageView, createBookingDraft } from '../src/views/BookingPageView';
import { CalendarView } from '../src/views/CalendarView';
import { ConversationsView } from '../src/views/ConversationsView';
import { CustomersView } from '../src/views/CustomersView';
import { EmployeesView } from '../src/views/EmployeesView';
import { HomeView } from '../src/views/HomeView';
import { ServicesView } from '../src/views/ServicesView';
import { SettingsView } from '../src/views/SettingsView';
import { ShiftPlanView } from '../src/views/ShiftPlanView';
import { TeamView } from '../src/views/TeamView';
import { demoConversations, demoCustomers, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';
import { readableText, render } from './renderHelpers';

// What the Swiss formats look like on the screens: the region in Settings, the opening
// hours as 24-hour lists, the one note about time zones, and a sweep over every screen for a
// format that does not belong. The formats themselves are pinned in tests/format.test.ts.

const nothing = () => {};
const ZONE = 'Europe/Zurich';
/** What a person reads or hears on a rendered screen, with every run of spaces as one. */
const shown = (html: string) => readableText(html).replace(/\s+/g, ' ');
const count = (html: string, part: string) => html.split(part).length - 1;

const settings = (partial: Partial<React.ComponentProps<typeof SettingsView>> = {}) => render(React.createElement(SettingsView, {
  settings: initialCompanySettings, bookingHours: initialBookingHours, onSaveSettings: nothing,
  closedDates: [], onSaveClosedDates: nothing, now: FIXED_NOW, bookingLink: 'https://slotbee.example/?booking=1', ...partial,
}));
const team = (partial: Partial<React.ComponentProps<typeof TeamView>> = {}) => render(React.createElement(TeamView, {
  employees: initialEmployees, onAddEmployee: nothing, onUpdateEmployee: nothing, onDeleteEmployee: nothing,
  shiftOverview: demoShifts, onUpdateShift: nothing, absences: [], onSaveAbsences: nothing, timeZone: ZONE, now: FIXED_NOW, ...partial,
}));
const optionsOf = (html: string, id: string): { value: string; label: string; selected: boolean }[] => {
  const select = new RegExp(`<select[^>]*id="${id}"[^>]*>(.*?)</select>`).exec(html)?.[1] ?? '';
  return Array.from(select.matchAll(/<option([^>]*)>([^<]*)<\/option>/g), ([, attributes, label]) =>
    ({ value: /value="([^"]*)"/.exec(attributes)?.[1] ?? label, label, selected: attributes.includes('selected') }));
};

// ---------- the region ----------

test('the salon starts in Switzerland, in the canton of St. Gallen, on Swiss time without an offset', () => {
  assert.equal(initialCompanySettings.country, 'Switzerland');
  assert.equal(initialCompanySettings.canton, 'SG');
  assert.equal(initialCompanySettings.timeZone, 'Europe/Zurich');
  assert.equal(SALON_TIME_ZONE, 'Europe/Zurich');
  assert.deepEqual([...COUNTRIES], ['Switzerland', 'Liechtenstein']);
  assert.equal(CANTONS.length, 26);
  assert.equal(new Set(CANTONS.map((canton) => canton.code)).size, 26);
  for (const canton of CANTONS) assert.match(canton.code, /^[A-Z]{2}$/, canton.name);
});

test('Settings offers the launch market only: two countries, a canton, no choice of time zone', () => {
  const html = settings();
  assert.deepEqual(optionsOf(html, 'company-country').map((option) => option.label), ['Switzerland', 'Liechtenstein']);
  assert.equal(optionsOf(html, 'company-country').find((option) => option.selected)?.value, 'Switzerland');
  // The canton: all 26, by name with their letters, the salon's own selected.
  const cantons = optionsOf(html, 'company-canton');
  assert.equal(cantons.length, 27); // "Choose a canton" and the 26
  assert.deepEqual(cantons.find((option) => option.selected), { value: 'SG', label: 'St. Gallen (SG)', selected: true });
  assert.ok(cantons.some((option) => option.label === 'Zurich (ZH)') && cantons.some((option) => option.label === 'Geneva (GE)'));
  assert.match(html, /<label for="company-canton"[^>]*>\s*Canton\s*<\/label>/);
  // Time zone and currency follow from the country: plain text, no field, no offset, no zone id.
  assert.match(html, />Time zone<\/p><p[^>]*>Central European Time \(Zurich\)<\/p>/);
  assert.doesNotMatch(html, /id="company-timeZone"|disabled=""/);
  assert.doesNotMatch(shown(html), /GMT|UTC|Europe\/|Paris|London|Germany|Austria|France|State\/Province|EUR/);
  assert.equal(count(html, '<select'), 2);
});

test('Liechtenstein has no canton, and what is saved is the country, its canton and one time zone', () => {
  const html = settings({ settings: { ...initialCompanySettings, country: 'Liechtenstein', canton: '', city: 'Vaduz', postalCode: '9490' } });
  assert.equal(optionsOf(html, 'company-country').find((option) => option.selected)?.value, 'Liechtenstein');
  assert.doesNotMatch(html, /company-canton|Canton/);
  assert.match(html, /Central European Time \(Zurich\)/);

  assert.deepEqual(regionToSave('Switzerland', 'SG'), { country: 'Switzerland', canton: 'SG', timeZone: 'Europe/Zurich' });
  assert.deepEqual(regionToSave('Liechtenstein', 'SG'), { country: 'Liechtenstein', canton: '', timeZone: 'Europe/Zurich' });
  // Settings saved before the market was narrowed: another country counts as Switzerland, a
  // made-up canton is dropped, and the time zone loses its fixed offset.
  assert.deepEqual(regionToSave('Germany', 'Bayern'), { country: 'Switzerland', canton: '', timeZone: 'Europe/Zurich' });
  assert.deepEqual(regionToSave(undefined, undefined), { country: 'Switzerland', canton: '', timeZone: 'Europe/Zurich' });
});

test('settings saved in the old form still open; only a real difference counts as unsaved', () => {
  // The old time zone text is the same zone: nothing to save.
  const sameZone = settings({ settings: { ...initialCompanySettings, timeZone: 'Europe/Zurich (GMT+01:00)' } });
  assert.doesNotMatch(sameZone, /You have unsaved salon details/);
  assert.doesNotMatch(shown(sameZone), /GMT/);
  // A stored number is shown written out, and that alone is not a change either.
  const withPhone = settings({ settings: { ...initialCompanySettings, businessPhone: '+41712223344' } });
  assert.match(withPhone, /id="company-businessPhone"[^>]*value="\+41 71 222 33 44"/);
  assert.doesNotMatch(withPhone, /You have unsaved salon details/);
  // A country or a time zone that is no longer offered shows as the market's, and waits to be saved.
  for (const old of [{ country: 'Germany' }, { timeZone: 'Europe/London (GMT+00:00)' }]) {
    const html = settings({ settings: { ...initialCompanySettings, ...old } });
    assert.equal(optionsOf(html, 'company-country').find((option) => option.selected)?.value, 'Switzerland');
    assert.match(html, /Central European Time \(Zurich\)/);
    assert.match(html, /You have unsaved salon details/);
    assert.doesNotMatch(shown(html), /Germany|London|GMT/);
  }
});

test('the canton follows a town in the address only where the town does not say it', () => {
  assert.equal(salonAddress(initialCompanySettings), 'Tuchgasse 7, 9000 St. Gallen, Switzerland');
  assert.equal(townWithCanton('Wil', 'SG', 'Switzerland'), 'Wil SG');
  assert.equal(townWithCanton('Rapperswil-Jona', 'SG', 'Switzerland'), 'Rapperswil-Jona SG');
  assert.equal(townWithCanton('Buchs', 'AG', 'Switzerland'), 'Buchs AG');
  // A town that carries its canton's name, in any of the country's languages, stays as it is.
  for (const [town, canton] of [['St. Gallen', 'SG'], ['St.Gallen', 'SG'], ['Sankt Gallen', 'SG'], ['Zürich', 'ZH'], ['Zurich', 'ZH'], ['Basel', 'BS'],
    ['Genève', 'GE'], ['Genf', 'GE'], ['Bern', 'BE'], ['Luzern', 'LU'], ['Appenzell', 'AI'], ['Neuchâtel', 'NE'], ['Freiburg', 'FR'], ['Zug', 'ZG']]) {
    assert.equal(townWithCanton(town, canton, 'Switzerland'), town, town);
  }
  // No canton chosen, an unknown one, or Liechtenstein: the town alone.
  assert.equal(townWithCanton('Wil', '', 'Switzerland'), 'Wil');
  assert.equal(townWithCanton('Wil', undefined, 'Switzerland'), 'Wil');
  assert.equal(townWithCanton('Wil', 'XX', 'Switzerland'), 'Wil');
  assert.equal(townWithCanton('Vaduz', 'SG', 'Liechtenstein'), 'Vaduz');
  assert.equal(salonAddress({ street: 'Bahnhofstrasse 3', postalCode: '9500', city: 'Wil', canton: 'SG', country: 'Switzerland' }), 'Bahnhofstrasse 3, 9500 Wil SG, Switzerland');
  assert.equal(salonAddress({ street: '', postalCode: '', city: 'Vaduz', canton: '', country: 'Liechtenstein' }), 'Vaduz, Liechtenstein');

  // The booking page shows the address built this way, so the field in Settings changes something.
  const page = render(React.createElement(BookingPageView, {
    services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
    events: [], requests: [], timeZone: ZONE, now: FIXED_NOW,
    companySettings: { ...initialCompanySettings, street: 'Bahnhofstrasse 3', postalCode: '9500', city: 'Wil', canton: 'SG' },
    draft: createBookingDraft(initialServices, ZONE, FIXED_NOW), setDraft: nothing, submittedRequest: null, setSubmittedRequest: nothing,
    onNewBookingRequest: () => null, onUpdateBookingRequest: () => null, onCancelBookingRequest: () => null, onViewRequest: nothing, publicMode: true,
  }));
  assert.match(page, />Bahnhofstrasse 3, 9500 Wil SG, Switzerland</);
});

// ---------- opening hours ----------

const hoursTab = (bookingHours: BookingHoursDay[] = initialBookingHours) => settings({ bookingHours, tab: 'hours' });
const timeSelect = (html: string, label: string) => {
  const select = new RegExp(`<select[^>]*aria-label="${label}"[^>]*>(.*?)</select>`).exec(html)?.[1] ?? '';
  return Array.from(select.matchAll(/<option([^>]*)>([^<]*)<\/option>/g), ([, attributes, time]) => ({ time, selected: attributes.includes('selected') }));
};

test('opening hours are chosen from 24-hour lists in half-hour steps, Monday first', () => {
  const html = hoursTab(initialBookingHours.map((day) => ({ ...day, isOpen: true })));
  // Seven days, two lists each, and no field that would follow the device's 12-hour clock.
  assert.equal(count(html, '<select'), 14);
  assert.doesNotMatch(html, /type="time"/);
  const days = Array.from(html.matchAll(/aria-label="(\w+) opening time"/g), (match) => match[1]);
  assert.deepEqual(days, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  const times = timeSelect(html, 'Tuesday opening time');
  assert.equal(times.length, 48);
  assert.deepEqual(times.slice(0, 3).map((option) => option.time), ['00:00', '00:30', '01:00']);
  assert.equal(times.at(-1)?.time, '23:30');
  assert.ok(times.every((option) => /^([01]\d|2[0-3]):(00|30)$/.test(option.time)));
  assert.deepEqual(times.filter((option) => option.selected).map((option) => option.time), ['08:30']);
  assert.deepEqual(timeSelect(html, 'Saturday closing time').filter((option) => option.selected).map((option) => option.time), ['16:00']);
  assert.doesNotMatch(shown(html), /\b(AM|PM)\b|not on the half hour/);
  // A list on a phone must not zoom the page: 16 px text, and a tap target of 44 px.
  for (const classes of html.matchAll(/<select[^>]*class="([^"]*)"/g)) {
    assert.match(classes[1], /\btext-base\b/);
    assert.match(classes[1], /\bmin-h-11\b/);
  }
});

test('a time saved off the half hour is still shown, is kept, and the page says so', () => {
  const stored = initialBookingHours.map((day) => day.day === 'Tuesday' ? { ...day, from: '09:07' } : day.day === 'Friday' ? { ...day, from: '08:45', to: '18:15' } : day);
  const html = hoursTab(stored);
  // The stored time is one more choice in its own list, in its place, and it is the one selected.
  const tuesday = timeSelect(html, 'Tuesday opening time');
  assert.equal(tuesday.length, 49);
  assert.deepEqual(tuesday.slice(18, 21).map((option) => option.time), ['09:00', '09:07', '09:30']);
  assert.deepEqual(tuesday.filter((option) => option.selected).map((option) => option.time), ['09:07']);
  // Other lists do not offer it.
  assert.equal(timeSelect(html, 'Tuesday closing time').length, 48);
  assert.equal(timeSelect(html, 'Wednesday opening time').length, 48);
  assert.match(shown(html), /09:07 is not on the half hour\. It stays as saved until you choose another time\. Appointments start on the half hour\./);
  assert.match(shown(html), /08:45 and 18:15 are not on the half hour\. They stay as saved until you choose another time\./);
  // Nothing was changed by opening the page: no unsaved changes are reported.
  assert.doesNotMatch(html, /You have unsaved salon details/);
});

test('closures and absences are listed with their dates in the Swiss form', () => {
  const html = settings({
    tab: 'closed-dates',
    closedDates: [
      { id: 'c-1', name: 'Team day', start: '2026-10-08', end: '2026-10-08' },
      { id: 'c-2', name: 'Christmas', start: '2026-12-24', end: '2027-01-02' },
    ],
  });
  assert.match(html, />Thu, 08\.10\.2026</);
  assert.match(html, />24\.12\.2026–02\.01\.2027</);
  // Absences are listed in Team, in the same form.
  const absences = team({ tab: 'absences', absences: [{ id: 'a-1', employeeId: 'emp-2', start: '2026-12-28', end: '2027-01-02', reason: 'Holiday' }] });
  assert.match(absences, />Selina Keller: Holiday</);
  assert.match(absences, />28\.12\.2026–02\.01\.2027</);
});

// ---------- the note about time zones ----------

test('"Salon time (Zurich)" appears only on a device that shows another time than the salon', () => {
  const note = (viewerTimeZone: string | null | undefined, timeZone = ZONE) =>
    render(React.createElement(SalonTimeNote, { timeZone, viewerTimeZone, now: FIXED_NOW }));
  // The salon's own zone, and a neighbour on the same clock: nothing at all.
  assert.equal(note('Europe/Zurich'), '');
  assert.equal(note('Europe/Berlin'), '');
  assert.equal(note('Europe/Zurich', 'Europe/Zurich (GMT+01:00)'), '');
  // Another clock: one note, with the town and neither an offset nor a zone id.
  const abroad = note('America/New_York');
  assert.match(abroad, /^<p role="note"/);
  assert.match(abroad, /<span>Salon time \(Zurich\)<\/span>/);
  assert.equal(count(abroad, 'Salon time (Zurich)'), 1);
  assert.doesNotMatch(readableText(abroad), /GMT|UTC|Europe\/|America\//);
  // Where the device's zone is not known, and before the browser was asked, nothing is claimed.
  assert.equal(note(null), '');
  assert.equal(note(undefined), '');
});

// ---------- every screen ----------

const liveBooking: Conversation = {
  id: 'live-web-1', live: true, customerName: 'Tom', initials: 'T', avatarColor: 'bg-green-100 text-green-700', language: 'EN', languageLabel: 'English',
  phone: '', channel: 'Website', status: 'needs-attention', attentionReason: 'Booking request: Haircut on Thursday, 08.10.2026 at 15:00 for Tom. Please confirm.',
  lastTime: '11:58', messages: [{ id: 'm-1', sender: 'customer', original: 'A haircut on Thursday at 3?', translation: 'A haircut on Thursday at 3?', time: '11:58' }],
  bookingRequest: { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-08', time: '15:00', customerName: 'Tom', status: 'requested' },
};

/** The owner's screens and the customers' booking page, built for the fixed moment from the salon's starting data. */
const screens = (): Record<string, string> => {
  const context = { requests: demoRequests, events: demoEvents, services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts, now: FIXED_NOW, timeZone: ZONE };
  const appointment = demoEvents.find((event) => event.id === 'cal-2')!;
  const conversationProps = {
    mobileDetailOpen: false, onBackToList: nothing, onSelect: nothing, onTakeOver: nothing, onLetAiContinue: () => null,
    onOwnerReply: () => true, aiSettings: initialAiSettings, onOpenAiSettings: nothing, onConfirmBooking: nothing,
  };
  const calendarProps = {
    events: demoEvents, services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
    requests: demoRequests, timeZone: ZONE, now: FIXED_NOW, onSelectEvent: nothing, onDateChange: nothing, onOpenAppointmentForm: () => {}, onDeleteEvent: nothing,
  };
  const bookingProps = {
    ...context, companySettings: initialCompanySettings, setDraft: nothing, setSubmittedRequest: nothing,
    onNewBookingRequest: () => null, onUpdateBookingRequest: () => null, onCancelBookingRequest: () => null, onViewRequest: nothing,
  };
  const draft = createBookingDraft(initialServices, ZONE, FIXED_NOW);
  const closures: Partial<React.ComponentProps<typeof SettingsView>> = {
    closedDates: [{ id: 'c-1', name: 'Team day', start: '2026-10-08', end: '2026-10-09' }],
  };
  const absences = [{ id: 'a-1', employeeId: 'emp-2', start: '2026-10-13', end: '2026-10-13', reason: 'Course' }];
  return {
    home: render(React.createElement(HomeView, {
      requests: demoRequests, selectedRequestId: null, now: FIXED_NOW, availabilityContext: context,
      onAcceptRequest: nothing, onRejectRequest: nothing, onMoveRequest: () => null, onSimulateNewRequest: nothing,
      onOpenAppointment: nothing, conversations: [liveBooking, ...demoConversations], onOpenConversations: nothing,
      customers: demoCustomers, salonName: initialCompanySettings.companyName,
      // The second request was moved a minute ago (it had been for Friday at 11:00), so the note
      // that tells the owner what to pass on is swept as well.
      answers: [{
        kind: 'request', id: demoRequests[1].id, outcome: 'moved', at: FIXED_NOW.getTime() - 60_000, index: 1,
        request: { ...demoRequests[1], date: '2026-10-09', dateStr: 'Fri, 09.10.2026', timeStr: '11:00 - 11:30' },
      }],
    })),
    calendar: render(React.createElement(CalendarView, { ...calendarProps, date: '2026-10-05', selectedEventId: null })),
    'calendar, an appointment open': render(React.createElement(CalendarView, { ...calendarProps, date: appointment.date, selectedEventId: appointment.id })),
    conversations: render(React.createElement(ConversationsView, { ...conversationProps, conversations: demoConversations, selectedId: demoConversations[0].id })),
    'conversations, a booking request': render(React.createElement(ConversationsView, { ...conversationProps, conversations: [liveBooking, ...demoConversations], selectedId: liveBooking.id })),
    customers: render(React.createElement(CustomersView, {
      customers: demoCustomers, events: demoEvents, now: FIXED_NOW, timeZone: ZONE, selectedCustomerId: null,
      onClearSelection: nothing, onAddCustomer: nothing, onUpdateCustomer: nothing, onDeleteCustomer: nothing,
    })),
    'customer profile': render(React.createElement(CustomersView, {
      customers: demoCustomers, events: demoEvents, now: FIXED_NOW, timeZone: ZONE, selectedCustomerId: 'cust-002',
      onClearSelection: nothing, onAddCustomer: nothing, onUpdateCustomer: nothing, onDeleteCustomer: nothing,
      onOpenAppointment: nothing, onNewAppointment: nothing,
    })),
    employees: render(React.createElement(EmployeesView, { employees: initialEmployees, onAddEmployee: nothing, onUpdateEmployee: nothing, onDeleteEmployee: nothing })),
    services: render(React.createElement(ServicesView, { services: initialServices, employees: initialEmployees, onAddService: nothing, onUpdateService: nothing, onDeleteService: nothing })),
    analytics: render(React.createElement(AnalyticsView, { events: demoEvents, conversations: demoConversations, companyName: initialCompanySettings.companyName, timeZone: ZONE, now: FIXED_NOW })),
    'shift plan': render(React.createElement(ShiftPlanView, { employees: initialEmployees, shiftOverview: demoShifts, timeZone: ZONE, onUpdateShift: nothing, now: FIXED_NOW })),
    'AI receptionist': render(React.createElement(AiAssistantView, { settings: initialAiSettings, onSave: nothing, channels: { live: 'off', businessPhone: '0712223344' } })),
    'team, people': team(),
    'team, this week': team({ tab: 'week' }),
    'team, absences': team({ tab: 'absences', absences }),
    'settings, salon': settings(),
    'settings, hours': settings({ tab: 'hours' }),
    'settings, closed dates': settings({ tab: 'closed-dates', ...closures }),
    'settings, online booking': settings({ tab: 'online-booking' }),
    'booking page': render(React.createElement(BookingPageView, { ...bookingProps, draft, submittedRequest: null, publicMode: true })),
    'booking page, a specialist chosen': render(React.createElement(BookingPageView, {
      ...bookingProps, draft: { ...draft, serviceId: 'srv-2', employeeId: 'emp-1', date: '2026-10-06', dateChosen: true }, submittedRequest: null, publicMode: true,
    })),
    'booking page, a request sent': render(React.createElement(BookingPageView, { ...bookingProps, draft, submittedRequest: demoRequests[0], publicMode: true })),
    'booking page, the owner\'s preview': render(React.createElement(BookingPageView, { ...bookingProps, draft, submittedRequest: null, publicMode: false })),
  };
};

test('no screen shows a technical date, an offset, a zone id, a 12-hour time or a second date format', () => {
  const months = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
  const unwanted: [string, RegExp][] = [
    ['a date as it is stored (2026-10-05)', /\b20\d\d-\d\d-\d\d\b/],
    ['an offset', /\b(GMT|UTC)\b/],
    ['a time zone id', /\b(Europe|America|Asia|Africa)\//],
    // With its minutes: "0 PM" alone is a visit count next to the initials of Petra Meier.
    ['a 12-hour time', /\b\d{1,2}:\d\d ?(AM|PM|am|pm)\b/],
    ['a date with a slash (19/11)', /\b\d{1,2}\/\d{1,2}\b/],
    ['a date with a month name (19 November, Nov 19)', new RegExp(`\\b\\d{1,2}\\.? (${months})\\b|\\b(${months}) \\d{1,2}\\b(?!\\d)(?! \\d{4})`)],
    ['a month on a date tile (NOV 19)', /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) \d/],
    // The long dash alone ("—") stands for an empty value in a table and is no range.
    ['a range with a hyphen or with spaces (10:00 - 10:30)', /\d ?- ?\d\d[:.]|\d – \d/],
    ['a price without its two decimals', /CHF \d+(?![\d.'])/],
    ['a phone number without its groups', /\+41\d{9}/],
  ];
  for (const [name, html] of Object.entries(screens())) {
    const text = shown(html);
    for (const [what, pattern] of unwanted) assert.doesNotMatch(text, pattern, `${name} shows ${what}`);
    // No screen names the time zone itself: that is the app's one note, and it is only shown when needed.
    assert.doesNotMatch(text, /Salon time|time zone of this device|Appointment times are in|Shift times are in/, name);
  }
});

test('the screens show the Swiss forms where the old ones stood', () => {
  const all = screens();
  // Home: the day it is about, the next appointment (Tuesday 6 October, the day after the fixed moment,
  // a Monday on which the salon is closed), the requests with their date tiles, and what the AI booked.
  const home = shown(all.home);
  assert.match(home, /Today Monday, 05\.10\.2026 The salon is closed today\. No appointments\./);
  assert.match(home, /Next appointment Tue, 06\.10\.2026, \d\d:\d\d–\d\d:\d\d/);
  assert.match(home, /WED 07\.10\. Booking request · 12 minutes ago/);
  assert.match(home, /· 10:00–10:30 with Selina Keller \+41 7\d 555 \d\d \d\d · Booking page/);
  // A request that waits in a chat, with the time it would take; and one the owner has just moved, with its ready text.
  assert.match(home, /THU 08\.10\. Booking request from a chat · 11:58 Tom Haircut · 15:00–15:30/);
  assert.match(home, /Moved from Fri, 09\.10\.2026, 11:00–11:30/);
  assert.match(home, /(am|on|le|,) \S+,? 08\.10\.2026 (um|at|à|alle) 14:30/);
  assert.match(home, /Booked by the AI .*Haircut · Thu, 08\.10\.2026, 13:30–14:00/);
  assert.match(home, /This month October 2026 · past and upcoming appointments/);
  // Calendar: month, calendar week and the week's span as its title; an appointment with date, range and number.
  const calendar = shown(all.calendar);
  assert.match(calendar, /Calendar October 2026 Week 41 Day Week List Add Today 05\.–11\.10\.2026/);
  // The week's columns: each day with its short date and how many appointments it has. Monday 5 October is today, and closed.
  assert.match(calendar, /Mon 05\.10\. Today Tue 06\.10\. \d+ appointments Wed 07\.10\. \d+ appointments Thu 08\.10\. \d+ appointments Fri 09\.10\. \d+ appointments Sat 10\.10\. \d+ appointments Sun 11\.10\./);
  assert.match(shown(all['calendar, an appointment open']), /Time: Thu, 08\.10\.2026, 13:30–14:00 .*Phone: \+41 79 555 61 12/);
  // Conversations: a booking request collected in a chat.
  assert.match(shown(all['conversations, a booking request']), /Haircut · Thu, 08\.10\.2026 · 15:00 · Tom/);
  // Customers: last visit and next appointment.
  assert.match(shown(all.customers), /Marie Dupont .*?\+41 79 555 61 12 .*?Thu, 27\.08\.2026 .*?Thu, 08\.10\.2026, 13:30/);
  // Services and the booking page: prices.
  assert.match(shown(all.services), /Haircut 30 min CHF 55\.00/);
  assert.match(shown(all['booking page']), /Haircut CHF 55\.00 30 minutes/);
  assert.match(shown(all['booking page']), /Opening hours Tuesday–Friday 08:30–18:30 Saturday 08:00–16:00 Monday and Sunday Closed/);
  assert.match(shown(all['booking page, a specialist chosen']), /Free times with Anna Weber on Tuesday, 06\.10\.2026: 08:30–09:00 09:00–09:30/);
  assert.match(shown(all['booking page, a request sent']), /Date and time Wed, 07\.10\.2026 10:00–10:30 Contact .*? \+41 7\d 555 \d\d \d\d/);
  // The week in Team: the week as a span, the days as short dates (today marked), the working hours as ranges.
  const shifts = shown(all['shift plan']);
  assert.match(shifts, /05\.–11\.10\.2026/);
  assert.match(shifts, /Employee Mon 05\.10\. Today Tue 06\.10\./);
  assert.match(shifts, /08:30–17:00/);
  // Analytics: the period, and the days of the chart's table.
  assert.match(shown(all.analytics), /appointments October 2026/);
  assert.match(all.analytics, /<th scope="row"[^>]*>Thu 01\.10\.<\/th>/);
  // The salon's own number, typed by the owner as 0712223344.
  assert.match(shown(all['AI receptionist']), /your salon number \(\+41 71 222 33 44\)/);
  // Settings: a closure of two days. Team: an absence of one, and the week as the shift plan writes it.
  assert.match(shown(all['settings, closed dates']), /Team day 08\.–09\.10\.2026/);
  assert.match(shown(all['team, absences']), /Selina Keller: Course Tue, 13\.10\.2026/);
  assert.match(shown(all['team, this week']), /05\.–11\.10\.2026 .*Employee Mon 05\.10\. Today Tue 06\.10\./);
});

test('the header finds appointments by the date as the screens write it', () => {
  // Marie's haircut on Thursday 8 October 2026, 13:30 (cal-2), in the forms of the calendar and of the lists.
  const found = (query: string) => getHeaderSearchResults([], demoRequests, demoEvents, query);
  for (const query of ['Thu, 08.10.2026', 'Thu 08.10.', '08.10.2026', '08.10.']) {
    const results = found(query);
    assert.ok(results.some((result) => result.kind === 'appointment' && result.record.id === 'cal-2'), query);
    assert.ok(results.every((result) => result.kind !== 'customer' && result.record.date === '2026-10-08'), query);
  }
  // The first request is for Wednesday 7 October, 10:00 to 10:30: found by its day and by its time range.
  assert.ok(found('Wed 07.10.').some((result) => result.kind === 'request' && result.record.id === demoRequests[0].id));
  assert.ok(found('10:00–10:30').some((result) => result.kind === 'request' && result.record.id === demoRequests[0].id));
  // The old forms find nothing any more: no record still shows them.
  assert.deepEqual(found('08/10'), []);
  assert.deepEqual(found('8 October'), []);
});
