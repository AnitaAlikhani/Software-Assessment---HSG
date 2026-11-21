import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AvailabilityContext } from '../src/availability';
import { bookingDays, closedReason, openingHoursLines } from '../src/bookingDays';
import { PRODUCT_NAME } from '../src/brand';
import CustomerChat from '../src/CustomerChat';
import { setResearchModeForTests } from '../src/flags';
import { addDays } from '../src/scheduling';
import type { AppointmentRequest, BookingHoursDay, CalendarEvent, CompanySettingsData, Employee, ServiceItem, ShiftEntry } from '../src/types';
import { salonStorageKey } from '../src/useDemoState';
import { BookingPageView, createBookingDraft, type BookingDraft } from '../src/views/BookingPageView';
import { movedRequest } from '../src/requestAnswers';
import { BrowserStandIn, inTab } from './browserStandIn';
import { FIXED_NOW } from './fixedClock';

// A salon of its own for these tests, so they do not depend on the sample salon's people,
// services or opening hours. FIXED_NOW is Monday 5 October 2026, 12:00: this salon's closing day.
const TODAY = '2026-10-05';
const services: ServiceItem[] = [
  { id: 's-care', name: 'Care', durationMinutes: 60, priceCHF: 80, onlineBooking: true, assignedEmployeesCount: 1, assignedEmployeeIds: ['e-2'] },
  { id: 's-cut', name: 'Cut', durationMinutes: 30, priceCHF: 50, onlineBooking: true, assignedEmployeesCount: 2, assignedEmployeeIds: ['e-1', 'e-2'] },
  { id: 's-colour', name: 'Colour', durationMinutes: 90, priceCHF: 120, onlineBooking: false, assignedEmployeesCount: 2, assignedEmployeeIds: ['e-1', 'e-2'] },
];
const employee = (id: string, name: string): Employee => ({
  id, firstName: name.split(' ')[0], lastName: name.split(' ')[1], name, initials: name.split(' ').map(part => part[0]).join(''),
  email: '', phone: '', status: 'Active', location: 'Salon Fixture', canBookOnline: true, hidden: false,
});
const employees = [employee('e-1', 'Mara Keller'), employee('e-2', 'Jonas Frei')];
const day = (name: string, isOpen: boolean, from = '09:00', to = '18:00'): BookingHoursDay => ({ day: name, isOpen, from, to });
const bookingHours = [
  day('Monday', false), day('Tuesday', true), day('Wednesday', true), day('Thursday', true), day('Friday', true),
  day('Saturday', true, '09:00', '14:00'), day('Sunday', false),
];
// Mara works Tuesday to Saturday, Jonas on Thursday and Friday.
const shiftsFor = (id: string, weekdays: number[]): ShiftEntry => ({
  employeeId: id, employeeName: id, initials: id, avatarColor: '',
  shifts: Object.fromEntries(Array.from({ length: 28 }, (_, offset) => {
    const date = addDays(TODAY, offset);
    return [date, weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? { start: '09:00', end: '18:00' } : null];
  })),
});
const shiftOverview = [shiftsFor('e-1', [2, 3, 4, 5, 6]), shiftsFor('e-2', [4, 5])];
const context: AvailabilityContext = {
  services, employees, bookingHours, shiftOverview, events: [], requests: [], closedDates: [], absences: [], timeZone: 'Europe/Zurich', now: FIXED_NOW,
};
const companySettings: CompanySettingsData = {
  companyName: 'Salon Fixture', street: 'Example Lane 1', postalCode: '9000', city: 'St. Gallen', country: 'Switzerland',
  businessPhone: '', currency: 'Swiss Franc - CHF', timeZone: 'Europe/Zurich',
  description: '', website: '', facebook: '', xProfile: '', instagram: '', legalNote: '', customTerms: false,
};
const allDay: CalendarEvent = {
  id: 'cal-full', serviceId: 's-cut', employeeId: 'e-1', customerName: 'Booked', serviceName: 'Cut', staffName: 'Mara Keller',
  date: '2026-10-06', day: 'tue', dateDisplay: 'Tue 06/10', startTime: '09:00', endTime: '18:00', colorTheme: 'blue',
};

const page = (props: Partial<React.ComponentProps<typeof BookingPageView>> = {}, draft: Partial<BookingDraft> = {}) =>
  renderToStaticMarkup(React.createElement(BookingPageView, {
    ...context, companySettings,
    draft: { ...createBookingDraft(services, 'Europe/Zurich', FIXED_NOW), ...draft }, setDraft: () => {},
    submittedRequest: null, setSubmittedRequest: () => {},
    onNewBookingRequest: () => null, onUpdateBookingRequest: () => null, onCancelBookingRequest: () => null, onViewRequest: () => {},
    publicMode: true, ...props,
  }));
/** What a person reads: the text without the markup, attributes or styles. */
const visible = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const hrefs = (html: string) => [...html.matchAll(/<a[^>]*href="([^"]*)"/g)].map(match => match[1]);
const dateShown = (html: string) => /id="booking-date"[^>]*value="([^"]*)"/.exec(html)?.[1];
// Words that would tell a customer this is not a salon's own page.
const TELLS = /\b(demo|sample|simulat\w*|scripted|prototype|student|test|preview|owner|dashboard)\b/i;

test('opening hours are summed up in as few lines as a customer needs', () => {
  assert.deepEqual(openingHoursLines(bookingHours), [
    { days: 'Tuesday–Friday', hours: '09:00–18:00' },
    { days: 'Saturday', hours: '09:00–14:00' },
    { days: 'Monday and Sunday', hours: 'Closed' },
  ]);
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(name => day(name, true));
  assert.deepEqual(openingHoursLines([...weekdays, day('Saturday', false), day('Sunday', false)]), [
    { days: 'Monday–Friday', hours: '09:00–18:00' },
    { days: 'Saturday and Sunday', hours: 'Closed' },
  ]);
  // Settings saved in another order read the same; a salon that is never open shows no hours at all.
  assert.deepEqual(openingHoursLines([...bookingHours].reverse()), openingHoursLines(bookingHours));
  assert.deepEqual(openingHoursLines(bookingHours.map(item => ({ ...item, isOpen: false }))), []);
});

test('a day without bookings is explained: weekly closing day or the closure the owner named', () => {
  const closedDates = [{ id: 'c-1', name: 'Team day', start: '2026-10-07', end: '2026-10-08' }, { id: 'c-2', name: ' ', start: '2026-10-20', end: '2026-10-20' }];
  assert.equal(closedReason({ bookingHours, closedDates }, '2026-10-12'), 'The salon is closed on Mondays.');
  assert.equal(closedReason({ bookingHours, closedDates }, '2026-10-08'), 'The salon is closed on Thursday, 08.10.2026 (Team day).');
  assert.equal(closedReason({ bookingHours, closedDates }, '2026-10-20'), 'The salon is closed on Tuesday, 20.10.2026.');
  assert.equal(closedReason({ bookingHours, closedDates }, '2026-10-09'), null);
  assert.equal(closedReason({ bookingHours }, '2026-10-10'), null);
});

test('the coming days say which can be booked, and "full" only when bookings are the reason', () => {
  const states = (serviceId: string, extra: Partial<AvailabilityContext> = {}) =>
    bookingDays({ ...context, ...extra }, serviceId, TODAY, 8).map(item => item.state);
  //                               Mon 5     Tue 6   Wed 7   Thu 8   Fri 9   Sat 10  Sun 11    Mon 12
  assert.deepEqual(states('s-cut'), ['closed', 'free', 'free', 'free', 'free', 'free', 'closed', 'closed']);
  // Only Jonas offers Care, and he works Thursday and Friday: the other open days have no time, but are not "full".
  assert.deepEqual(states('s-care'), ['closed', 'none', 'none', 'free', 'free', 'none', 'closed', 'closed']);
  // Mara is booked all Tuesday and nobody else works then: that day is full.
  assert.deepEqual(states('s-cut', { events: [allDay] }).slice(0, 3), ['closed', 'full', 'free']);
  assert.deepEqual(states('s-cut', { closedDates: [{ id: 'c-1', name: 'Team day', start: '2026-10-07', end: '2026-10-07' }] }).slice(0, 4), ['closed', 'free', 'closed', 'free']);
  // Late on Tuesday evening today has no time left: not bookable, and not called full.
  assert.equal(bookingDays({ ...context, now: new Date('2026-10-06T19:00:00Z') }, 's-cut', '2026-10-06', 1)[0].state, 'none');
  assert.deepEqual(bookingDays(context, 'missing-service', TODAY, 2).map(item => item.state), ['closed', 'none']);
});

test('a new visitor starts with the service most specialists offer', () => {
  const draft = createBookingDraft(services, 'Europe/Zurich', FIXED_NOW);
  assert.equal(draft.serviceId, 's-cut');
  assert.equal(draft.date, TODAY);
  assert.equal(draft.dateChosen, undefined);
  assert.equal(createBookingDraft([], 'Europe/Zurich', FIXED_NOW).serviceId, '');
});

test('the public booking page opens on the first day with free times and reads like the salon\'s own page', () => {
  const html = page();
  const text = visible(html);
  // Today is the closing day: the page shows Tuesday instead of "no times", and says so.
  assert.equal(dateShown(html), '2026-10-06');
  assert.match(text, /First day with free times for Cut: Tuesday, 06\.10\.2026\./);
  assert.match(html, /aria-label="Monday, 05\.10\.2026, closed"/);
  assert.match(html, /disabled=""[^>]*aria-pressed="false"[^>]*aria-label="Monday, 05\.10\.2026, closed"/);
  assert.match(html, /aria-pressed="true"[^>]*aria-label="Tuesday, 06\.10\.2026"/);
  assert.match(text, /Opening hours Tuesday–Friday 09:00–18:00 Saturday 09:00–14:00 Monday and Sunday Closed/);
  // The day buttons carry the weekday and the short date; prices are written as CHF with two decimals.
  assert.match(text, /Today 05\.10\. Closed Tue 06\.10\. Wed 07\.10\./);
  assert.match(text, /Cut CHF 50\.00 30 minutes/);
  assert.match(text, /Mara Keller Available on this date/);
  assert.match(html, /max="2027-01-02"/); // the date field ends where the planned shifts end
  // The salon's name is the page's heading, and nothing calls the page a demo.
  assert.match(html, /<h1[^>]*>Salon Fixture<\/h1>/);
  assert.doesNotMatch(text, TELLS);
  assert.doesNotMatch(text, /Europe\/Zurich|web booking page|No call or message/);
  assert.match(text, /The salon uses your number for questions about this appointment\./);
  // The product is named once, at the foot of the page, in plain text.
  assert.match(text, new RegExp(`Powered by ${PRODUCT_NAME}\\s*$`));
  // No door into the owner's app: this salon has no links at all on its page.
  assert.deepEqual(hrefs(html), []);
});

test('the day follows the service until the customer picks a day or a time', () => {
  // Care is offered on Thursday and Friday only.
  assert.equal(dateShown(page({}, { serviceId: 's-care' })), '2026-10-08');
  assert.match(visible(page({}, { serviceId: 's-care' })), /First day with free times for Care: Thursday, 08\.10\.2026\./);
  // A picked day stays, whatever the service ...
  const picked = page({}, { serviceId: 's-care', date: '2026-10-10', dateChosen: true });
  assert.equal(dateShown(picked), '2026-10-10');
  assert.match(visible(picked), /Saturday, 10\.10\.2026: no free times for Care\. Please choose another day\./);
  // ... and a picked time settles the day too, also in a draft saved before days could be "chosen".
  assert.equal(dateShown(page({}, { employeeId: 'e-1', date: '2026-10-09', startTime: '10:00' })), '2026-10-09');
  // An emptied date field hands the choice back to the page.
  assert.equal(dateShown(page({}, { date: '', dateChosen: false })), '2026-10-06');
  // If a busy day fills up, the page moves on to the next free one.
  assert.equal(dateShown(page({ events: [allDay] })), '2026-10-07');
});

test('a closed day that was picked says why', () => {
  const closedDates = [{ id: 'c-1', name: 'Team day', start: '2026-10-07', end: '2026-10-07' }];
  const closure = visible(page({ closedDates }, { date: '2026-10-07', dateChosen: true }));
  assert.match(closure, /The salon is closed on Wednesday, 07\.10\.2026 \(Team day\)\. Please choose another day\./);
  assert.match(closure, /The salon is closed on Wednesday, 07\.10\.2026 \(Team day\)\. Choose another date above\./);
  assert.match(visible(page({}, { date: '2026-10-12', dateChosen: true })), /The salon is closed on Mondays\. Please choose another day\./);
});

test('the status of a request is told in the salon\'s words, from what the salon holds about it', () => {
  const request: AppointmentRequest = {
    id: 'req-1', serviceId: 's-cut', employeeId: 'e-1', customerName: 'Tamara Keller', customerPhone: '+41790000000', serviceName: 'Cut',
    date: '2026-10-06', dateStr: 'Tue, 06.10.2026', timeStr: '10:00 - 10:30', timeAgo: 'Just now', staffName: 'Mara Keller', channel: 'Web', status: 'pending',
  };
  // The appointment that accepting the request puts into the calendar.
  const appointment: CalendarEvent = {
    id: 'cal-req-1', serviceId: 's-cut', employeeId: 'e-1', customerName: 'Tamara Keller', customerPhone: '+41790000000', serviceName: 'Cut',
    staffName: 'Mara Keller', date: '2026-10-06', day: 'tue', dateDisplay: 'Tue 06.10.', startTime: '10:00', endTime: '10:30', colorTheme: 'yellow',
  };
  // The tab remembers which request is the customer's own; how it stands is read from the salon.
  const status = (props: Partial<React.ComponentProps<typeof BookingPageView>> = {}, own: AppointmentRequest = request) =>
    visible(page({ submittedRequest: own, ...props }));

  const waiting = status({ requests: [request] });
  assert.match(waiting, /Appointment requested Thank you! Your appointment is not confirmed yet: Salon Fixture must accept your request first\./);
  // The request is shown back in the formats of every screen, whatever form it is stored in.
  assert.match(waiting, /Date and time Tue, 06\.10\.2026 10:00–10:30 Contact Tamara Keller \+41 79 000 00 00/);
  // A request made on another device does not reach the salon yet: while it waits, the page
  // promises neither that the salon has it nor that an answer will come.
  assert.doesNotMatch(waiting, /\b(received|sent|delivered|shortly|soon)\b|has your request|will (confirm|answer|reply|contact)|get back to you/i);
  // Only a request that still waits can be changed or withdrawn.
  assert.match(waiting, /Edit request Cancel request/);
  // The owner has moved it to another time: the page shows the new time as the salon's suggestion,
  // not as something the customer asked for, and says what was asked. It can still be changed or withdrawn.
  const moved = status({ requests: [movedRequest(request, '2026-10-06', '11:30')] });
  assert.match(moved, /The salon suggests another time Salon Fixture suggests the time below instead of the one you asked for \(Tue, 06\.10\.2026, 10:00–10:30\)\. It is not confirmed yet\./);
  assert.match(moved, /Date and time Tue, 06\.10\.2026 11:30–12:00/);
  assert.match(moved, /Edit request Cancel request/);
  assert.doesNotMatch(moved, /Appointment requested|must accept your request/);
  // Accepted at the moved time: confirmed, with a word that it is not the time first asked for.
  assert.match(status({ events: [{ ...appointment, startTime: '11:30', endTime: '12:00' }] }, movedRequest(request, '2026-10-06', '11:30')),
    /Appointment confirmed Salon Fixture has confirmed your appointment at the time below\. You had asked for Tue, 06\.10\.2026, 10:00–10:30\./);

  // The owner accepted in the other tab: the request has left the list and its appointment is in the calendar.
  const accepted = status({ events: [appointment] });
  assert.match(accepted, /Appointment confirmed Salon Fixture has confirmed your appointment\. See you then!/);
  assert.doesNotMatch(accepted, /Edit request|Cancel request/);
  assert.match(accepted, /To change a confirmed appointment, contact the salon\./);
  // An appointment the owner has changed in the calendar since is shown as it is now.
  assert.match(status({ events: [{ ...appointment, date: '2026-10-08', startTime: '14:00', endTime: '14:30', staffName: 'Jonas Frei' }] }),
    /Appointment confirmed .* Specialist Jonas Frei Date and time Thu, 08\.10\.2026 14:00–14:30/);

  // The owner rejected: the answer is noted with the stored salon, where this tab reads it.
  const browser = new BrowserStandIn();
  browser.stored.set(salonStorageKey('/'), JSON.stringify({ day: '2026-10-05', builtAt: FIXED_NOW.toISOString(), changed: true, parts: { requestOutcomes: { 'req-1': 'rejected' } } }));
  const rejected = inTab(browser.openTab(), () => status());
  assert.match(rejected, /Request declined Sorry, Salon Fixture cannot offer this time\. Please choose another one\./);
  assert.doesNotMatch(rejected, /Edit request|Cancel request/);
  // A tab that has seen the answer remembers it, and so it does a withdrawal of its own.
  assert.match(status({}, { ...request, status: 'rejected' }), /Request declined Sorry, Salon Fixture cannot offer this time\./);
  const cancelled = status({}, { ...request, status: 'cancelled' });
  assert.match(cancelled, /Request cancelled Your request has been cancelled\. The time is free again\./);
  assert.doesNotMatch(cancelled, /Edit request|Cancel request/);
  // An answered request that waits again (the owner took the answer back) can be changed again.
  assert.match(status({ requests: [request] }, { ...request, status: 'rejected' }), /Appointment requested .* Edit request Cancel request/);

  // Accepted, and then the owner took the appointment out of the calendar: the page does not say
  // that the customer cancelled a request.
  browser.stored.set(salonStorageKey('/'), JSON.stringify({ day: '2026-10-05', builtAt: FIXED_NOW.toISOString(), changed: true, parts: { requestOutcomes: { 'req-1': 'accepted' } } }));
  const removed = inTab(browser.openTab(), () => status({}, { ...request, status: 'accepted' }));
  assert.match(removed, /Appointment cancelled Salon Fixture has taken this appointment out of its calendar\. Please contact the salon, or request a new time\./);
  assert.doesNotMatch(removed, /Your request has been cancelled|Edit request|Cancel request/);

  // A request the salon holds no trace of (its stored data were reset): the page does not go on
  // saying that it waits. The form is back.
  const gone = status();
  assert.doesNotMatch(gone, /Appointment requested|Appointment confirmed|Edit request/);
  assert.match(gone, /Request an appointment Choose a service, a date and a specialist\./);

  for (const text of [waiting, accepted, rejected, cancelled, gone]) assert.doesNotMatch(text, TELLS);
  // A customer gets no button into the owner's app; the owner's preview has one.
  assert.doesNotMatch(waiting, /View request/);
  assert.match(status({ requests: [request], publicMode: false }), /View request/);
});

test('only the owner\'s own browser tab gets a way back from the public page', () => {
  assert.doesNotMatch(page(), /Back to dashboard/);
  // "Open booking page" in the dashboard leaves a mark in that tab. A link sent to a customer cannot carry it.
  const globals = globalThis as { sessionStorage?: unknown };
  globals.sessionStorage = { getItem: (key: string) => key === 'slotbee-booking-from-dashboard' ? '1' : null };
  try {
    const html = page();
    assert.match(visible(html), /Back to dashboard/);
    assert.deepEqual(hrefs(html), ['/#/booking-page']);
  } finally {
    delete globals.sessionStorage;
  }
});

test('the owner sees the same page as a preview, without a promise that it reaches customers yet', () => {
  const html = page({ publicMode: false });
  const text = visible(html);
  assert.match(text, /Preview Your booking page This is what your customers see\. Try it: a request you send here appears in Home\./);
  assert.match(text, /Copy link/);
  assert.match(text, /Open booking page/);
  assert.doesNotMatch(text, /Share this link|is live|demo/i);
  assert.match(html, /aria-label="Customer booking link"[^>]*value="http:\/\/localhost\/\?booking=1"/);
  assert.deepEqual(hrefs(html), ['http://localhost/?booking=1']);
  // In the dashboard the page title above stays the main heading.
  assert.match(html, /<h2[^>]*>Salon Fixture<\/h2>/);
});

test('the customer chat reads like the salon\'s chat, and like a study only on a research link', () => {
  const chat = () => renderToStaticMarkup(React.createElement(CustomerChat, { liveKey: 'chat-key' }));
  setResearchModeForTests(false);
  try {
    const html = chat();
    const text = visible(html);
    assert.match(text, /AI assistant · the salon team reads along/);
    assert.match(text, /Write to us in any language\./);
    assert.match(text, /stored for the salon and deleted automatically after 14 days without activity in this chat/);
    assert.match(text, /processed by Google&#x27;s AI service Gemini/);
    assert.match(text, /You can delete your chat at any time\./);
    assert.match(text, /More about your data/);
    // The product is named once, at the foot of the page, in plain text (no link: see below).
    assert.match(text, new RegExp(`Powered by ${PRODUCT_NAME}\\s*$`));
    assert.doesNotMatch(text, TELLS);
    assert.doesNotMatch(text, /HSG|two weeks|WhatsApp/);
    // The chat page has no link at all, so none can lead into the owner's app.
    assert.deepEqual(hrefs(html), []);
    assert.doesNotMatch(html, /<a\s/);

    setResearchModeForTests(true);
    const study = visible(chat());
    assert.match(study, /Test chat · answers by AI assistant/);
    assert.match(study, /This is a student test \(HSG\)\. Your messages and first name are saved for 14 days after the last activity in this chat and then deleted\./);
    assert.match(study, /processed by Google&#x27;s AI service Gemini/);
    assert.doesNotMatch(study, /two weeks/);
  } finally {
    setResearchModeForTests(undefined);
  }
});

test('without a working link the chat page says what to do and offers nothing else', () => {
  const chat = () => renderToStaticMarkup(React.createElement(CustomerChat, { liveKey: null }));
  setResearchModeForTests(false);
  try {
    const html = chat();
    assert.match(visible(html), /This chat link is no longer valid\. Please ask the salon for a new one\./);
    assert.doesNotMatch(visible(html), TELLS);
    assert.doesNotMatch(html, /<a\s|<button|<input/);
    setResearchModeForTests(true);
    assert.match(visible(chat()), new RegExp(`This test chat needs the invitation link from the ${PRODUCT_NAME} team\\.`));
  } finally {
    setResearchModeForTests(undefined);
  }
});

test('the booking page offers only people who have working hours, as Team says', () => {
  // A new person with a service but no working hours yet: Team calls her "not bookable yet".
  const nora = employee('e-3', 'Nora Ohnezeit');
  const withNora = services.map((service) => service.id === 's-cut' ? { ...service, assignedEmployeeIds: [...service.assignedEmployeeIds!, 'e-3'] } : service);
  const offered = visible(page({ employees: [...employees, nora], services: withNora }, { serviceId: 's-cut' }));
  assert.match(offered, /Mara Keller/);
  assert.doesNotMatch(offered, /Nora Ohnezeit/);
  // With a regular week she is offered at once.
  const working = { ...nora, weeklyHours: { mon: null, tue: { start: '09:00', end: '18:00' }, wed: null, thu: null, fri: null, sat: null, sun: null } };
  assert.match(visible(page({ employees: [...employees, working], services: withNora }, { serviceId: 's-cut' })), /Nora Ohnezeit/);
});
