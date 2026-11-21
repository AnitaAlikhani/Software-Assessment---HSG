import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANYONE, APPOINTMENT_SOURCES, appointmentFormView, appointmentSave, changeDraft, discardQuestion, draftTouched, findCustomers, knownCustomerLike,
  nearestTimes, nextFreeDay, openDraft, savedMessage, stillNeeded, stylistsFor, timeOptions,
  type AppointmentDraft, type AppointmentSave, type DraftChange,
} from '../src/appointmentForm';
import { appointmentForConversation, appointmentFromConversationAction, belongsToConversation, upsertAppointment } from '../src/appointmentActions';
import { firstFreeEmployee, getAvailableSlots, validateCalendarEvent, type AvailabilityContext } from '../src/availability';
import { customerForAppointment, customerMatches, nameMatches, upsertCustomer } from '../src/bookingData';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { bookingSource, bookingSourceLabel } from '../src/bookingSource';
import { storedShapeProblem } from '../src/storedShapes';
import type { CalendarEvent, Customer, ShiftEntry } from '../src/types';
import { withDayChanges, workingTimeOn, type DayChange } from '../src/workingHours';
import { BrowserStandIn, ClockStandIn, storeFor } from './browserStandIn';
import { demoConversations, demoCustomers, demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';

// The rules of the appointment form (src/appointmentForm.ts), point by point: what it opens with,
// which times it offers and keeps, what it says when nothing can be booked, how an appointment is
// changed afterwards, booking outside the opening hours, where a booking came from, and whose it is.
// The sample salon is the one of tests/fixedClock.ts: closed on Sunday and Monday, three stylists.

/** Wednesday 7 October 2026, 10:02 in Zurich: an open day with the morning half gone. */
const WEDNESDAY = new Date('2026-10-07T08:02:00Z');
const TODAY = '2026-10-07';
const THURSDAY = '2026-10-08';
const FRIDAY = '2026-10-09';
const SATURDAY = '2026-10-10';
const NEXT_MONDAY = '2026-10-12';

const salon = (partial: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
  events: demoEvents, requests: demoRequests, closedDates: [], absences: [], timeZone: 'Europe/Zurich', now: WEDNESDAY, ...partial,
});
const steps = (context: AvailabilityContext, draft: AppointmentDraft, ...changes: DraftChange[]): AppointmentDraft =>
  changes.reduce<AppointmentDraft>((current, change) => changeDraft(context, current, change), draft);
const view = (draft: AppointmentDraft, context = salon()) => appointmentFormView(context, draft);
const starts = (draft: AppointmentDraft, context = salon()) => view(draft, context).times.map((option) => option.time);
const PETRA = demoCustomers.find((customer) => customer.id === 'cust-001')!; // Petra Meier, +41 76 555 62 42
const saved = (result: ReturnType<typeof appointmentSave>): AppointmentSave => {
  assert.ok('save' in result, 'error' in result ? result.error : '');
  return result.save;
};
const refused = (result: ReturnType<typeof appointmentSave>) => {
  assert.ok('error' in result, 'the form was expected to be refused');
  return result;
};
/** What the slot rules say to a save, as the app checks it. */
const rulesSay = (context: AvailabilityContext, save: AppointmentSave, id = save.appointmentId ?? 'cal-new'): string | null =>
  validateCalendarEvent(context, save.event, id);

// ---------- 3. sensible start values ----------

test('from "+" or the header the form opens on today with the next free time, anyone free and Phone', () => {
  const draft = openDraft(salon(), demoCustomers, { kind: 'new' });
  assert.deepEqual(draft, {
    appointmentId: null, customer: { kind: 'search', query: '' }, serviceId: 'srv-1', employeeId: ANYONE, date: TODAY,
    time: '10:30', timeChosen: false, outsideHours: false, source: 'phone', startNote: null,
  });
  // 10:00 has passed and Selina's 10:00 is held by a request: 10:30 with Selina is the next free time.
  const shown = view(draft);
  assert.deepEqual(shown.chosen, { time: '10:30', end: '11:00', employeeId: 'emp-2', outside: false, offShift: false });
  assert.equal(shown.employee?.name, 'Selina Keller');
  // "Anyone free" takes whom the app's own rule takes for a booking without a named stylist.
  assert.equal(firstFreeEmployee(salon(), 'srv-1', TODAY, '10:30')?.id, 'emp-2');
  for (const option of shown.times) assert.equal(firstFreeEmployee(salon(), 'srv-1', TODAY, option.time)?.id, option.employeeId, option.time);
  // Nothing is offered that has begun.
  assert.ok(shown.times.every((option) => option.time > '10:02'));
  assert.deepEqual(stillNeeded(draft, shown), ['a customer']);
});

test('opened without a day when today has no time left, the form starts on the next free day and says why', () => {
  // Monday: the salon is closed.
  const monday = salon({ now: FIXED_NOW });
  const closed = openDraft(monday, demoCustomers, { kind: 'new' });
  assert.equal(closed.date, '2026-10-06');
  assert.equal(closed.time, '08:30');
  assert.equal(closed.startNote, 'The salon is closed on Mondays. The next free time is on Tue, 06.10.2026.');
  assert.equal(view(closed, monday).chosen?.employeeId, 'emp-1');
  // Wednesday evening, twenty minutes after six: the last start of the day has passed.
  const evening = salon({ now: new Date('2026-10-07T16:20:00Z') });
  const late = openDraft(evening, demoCustomers, { kind: 'new' });
  assert.equal(late.date, THURSDAY);
  assert.equal(late.startNote, 'No time is left today for Wash & blow-dry. The next free time is on Thu, 08.10.2026.');
  // Once the owner chooses a day herself, the note has done its work.
  assert.equal(changeDraft(evening, late, { date: FRIDAY }).startNote, null);
  // A day the owner named is never left by itself: the form says what is in the way there.
  const named = openDraft(evening, demoCustomers, { kind: 'new', date: TODAY });
  assert.equal(named.date, TODAY);
  assert.equal(named.time, '');
  assert.equal(view(named, evening).dayProblem?.text, 'No time is left today for Wash & blow-dry.');
  assert.equal(view(named, evening).dayProblem?.nextDay, THURSDAY);
});

test('from a place in the calendar the form takes that day and half hour, with a service and a stylist that are free then', () => {
  // Thursday 13:30: the owner has Marie Dupont then, so the next stylist who is free takes it.
  const place = openDraft(salon(), demoCustomers, { kind: 'new', date: THURSDAY, time: '13:30' });
  assert.deepEqual([place.date, place.time, place.timeChosen, place.serviceId, place.employeeId], [THURSDAY, '13:30', true, 'srv-1', 'emp-2']);
  assert.equal(view(place).chosen?.time, '13:30');
  assert.ok(getAvailableSlots(salon(), { date: THURSDAY, serviceId: 'srv-1', employeeId: 'emp-2', mode: 'owner' }).includes('13:30'));
  // With the stylist of the column that was clicked: a service of hers that fits. Here none does,
  // so the wish stays and the form says who has the time, with the nearest free ones.
  const taken = openDraft(salon(), demoCustomers, { kind: 'new', date: THURSDAY, time: '13:30', employeeId: 'emp-1' });
  assert.equal(taken.employeeId, 'emp-1');
  assert.equal(view(taken).chosen, null);
  assert.equal(view(taken).timeProblem?.text, '13:30–14:00 is not free: Anna Weber has Marie Dupont at 13:30–14:00.');
  assert.deepEqual(view(taken).timeProblem?.nearest.map((option) => option.time), ['12:30', '13:00', '14:00', '15:00']);
  // A filter of the calendar names the service: the stylist is somebody who offers it and is free then.
  const colouring = openDraft(salon(), demoCustomers, { kind: 'new', date: FRIDAY, time: '10:00', serviceId: 'srv-3' });
  assert.deepEqual([colouring.serviceId, colouring.employeeId, view(colouring).chosen?.end], ['srv-3', 'emp-1', '11:30']);
  // A stylist who is named gets a service of their own: Luca does no colour work.
  const luca = openDraft(salon(), demoCustomers, { kind: 'new', date: FRIDAY, time: '10:00', employeeId: 'emp-3' });
  assert.equal(luca.employeeId, 'emp-3');
  assert.ok(stylistsFor(salon(), initialServices.find((service) => service.id === luca.serviceId)!).some((employee) => employee.id === 'emp-3'));
  // A day without a half hour (the calendar's "Add" on a day): that day, and its first free time as a suggestion.
  const day = openDraft(salon(), demoCustomers, { kind: 'new', date: FRIDAY });
  assert.deepEqual([day.date, day.time, day.timeChosen, day.employeeId], [FRIDAY, '08:30', false, ANYONE]);
  // A place that has passed is no place for a new appointment: the form opens on today.
  const past = openDraft(salon(), demoCustomers, { kind: 'new', date: '2026-10-01', time: '10:00' });
  assert.equal(past.date, TODAY);
  assert.equal(view(past).timeProblem?.text, '10:00 has passed.');
  // Values that are no day or no time are left out instead of trusted.
  const odd = openDraft(salon(), demoCustomers, { kind: 'new', date: '2026-02-30', time: '25:00', employeeId: 'nobody', serviceId: 'nothing' });
  assert.deepEqual([odd.date, odd.time, odd.employeeId, odd.serviceId], [TODAY, '10:30', ANYONE, 'srv-1']);
});

test('from a customer\'s profile the customer is chosen already', () => {
  const draft = openDraft(salon(), demoCustomers, { kind: 'new', customerId: PETRA.id });
  assert.deepEqual(draft.customer, { kind: 'existing', customerId: 'cust-001', phone: '' });
  assert.deepEqual(stillNeeded(draft, view(draft)), []);
  // A customer who has been deleted meanwhile is not carried along: the owner searches.
  assert.deepEqual(openDraft(salon(), demoCustomers, { kind: 'new', customerId: 'cust-gone' }).customer, { kind: 'search', query: '' });
});

test('the chosen time is kept while it stays free when the service, the stylist or the day change', () => {
  let draft = openDraft(salon(), demoCustomers, { kind: 'new', date: THURSDAY, time: '12:00', employeeId: 'emp-2' });
  assert.equal(view(draft).chosen?.end, '12:30');
  draft = changeDraft(salon(), draft, { serviceId: 'srv-4' }); // an hour instead of half an hour
  assert.deepEqual([draft.time, view(draft).chosen?.end, view(draft).chosen?.employeeId], ['12:00', '13:00', 'emp-2']);
  draft = changeDraft(salon(), draft, { employeeId: 'emp-1' });
  assert.deepEqual([draft.time, view(draft).chosen?.employeeId], ['12:00', 'emp-1']);
  draft = changeDraft(salon(), draft, { date: FRIDAY });
  assert.deepEqual([draft.date, draft.time, view(draft).chosen?.time], [FRIDAY, '12:00', '12:00']);
  draft = changeDraft(salon(), draft, { serviceId: 'srv-9' }); // three hours, only the owner offers it
  assert.deepEqual([view(draft).chosen?.time, view(draft).chosen?.end], ['12:00', '15:00']);
  // No longer free: the wish stays in the draft, and the form says why and offers the nearest free times.
  const cut = steps(salon(), draft, { serviceId: 'srv-2' }, { date: THURSDAY }, { time: '13:00' }, { serviceId: 'srv-4' });
  assert.equal(cut.time, '13:00');
  assert.equal(view(cut).chosen, null);
  assert.equal(view(cut).timeProblem?.text, '13:00–14:00 is not free: Anna Weber has Marie Dupont at 13:30–14:00.');
  // Two before and two after, also when the next free time after is hours away.
  assert.deepEqual(view(cut).timeProblem?.nearest.map((option) => option.time), ['12:00', '12:30', '16:30', '17:00']);
  // Back on a day where it is free, it is chosen again without another tap.
  assert.equal(view(changeDraft(salon(), cut, { date: FRIDAY })).chosen?.time, '13:00');
  // A stylist who does not offer the new service makes room for whoever is free.
  const withLuca = openDraft(salon(), demoCustomers, { kind: 'new', date: FRIDAY, time: '10:00', employeeId: 'emp-3' });
  assert.equal(changeDraft(salon(), withLuca, { serviceId: 'srv-3' }).employeeId, ANYONE);
});

test('a time the form only suggested follows every change; one the owner picked does not', () => {
  const opened = openDraft(salon(), demoCustomers, { kind: 'new' });
  // The next free time for a colouring, with whoever is free: nothing is said about 10:30.
  const colouring = changeDraft(salon(), opened, { serviceId: 'srv-3' });
  assert.deepEqual([colouring.time, colouring.timeChosen, view(colouring).timeProblem], ['11:30', false, null]);
  assert.equal(changeDraft(salon(), opened, { date: FRIDAY }).time, '08:30');
  assert.equal(changeDraft(salon(), opened, { employeeId: 'emp-1' }).time, '11:30');
  // Picked: now it is a wish.
  const picked = changeDraft(salon(), opened, { time: '15:00' });
  assert.equal(picked.timeChosen, true);
  assert.equal(changeDraft(salon(), picked, { date: FRIDAY }).time, '15:00');
  // The form stays open while the owner talks: a suggestion that has passed meanwhile is named, never silently replaced.
  const later = salon({ now: new Date('2026-10-07T08:31:00Z') });
  assert.equal(view(opened, later).chosen, null);
  assert.equal(view(opened, later).timeProblem?.text, '10:30 has passed.');
  assert.deepEqual(view(opened, later).timeProblem?.nearest.map((option) => option.time), ['11:00', '11:30', '12:00', '12:30']);
  // A date field that was cleared, and a text that is no time, change nothing.
  assert.equal(changeDraft(salon(), opened, { date: '' }), opened);
  assert.equal(changeDraft(salon(), opened, { time: 'soon' }), opened);
  assert.equal(changeDraft(salon(), opened, { serviceId: 'srv-gone' }), opened);
});

test('the times of a day come from the slot rules, and the nearest ones are found on both sides', () => {
  const selection = { serviceId: 'srv-2', employeeId: 'emp-1', date: THURSDAY, appointmentId: null, outsideHours: false };
  assert.deepEqual(timeOptions(salon(), selection).map((option) => option.time),
    getAvailableSlots(salon(), { date: THURSDAY, serviceId: 'srv-2', employeeId: 'emp-1', mode: 'owner' }));
  // "Anyone free": every time somebody is free, each once.
  const anyone = timeOptions(salon(), { ...selection, employeeId: ANYONE });
  const expected = new Set(stylistsFor(salon(), initialServices[1]).flatMap((employee) =>
    getAvailableSlots(salon(), { date: THURSDAY, serviceId: 'srv-2', employeeId: employee.id, mode: 'owner' })));
  assert.deepEqual(anyone.map((option) => option.time), [...expected].sort());
  assert.deepEqual(timeOptions(salon(), { ...selection, serviceId: 'srv-gone' }), []);
  assert.deepEqual(timeOptions(salon(), { ...selection, date: 'not-a-day' }), []);
  const options = timeOptions(salon(), selection);
  // The nearest times: two before the wish and two after it; where one side has fewer, the other fills up.
  assert.deepEqual(options.map((option) => option.time), ['10:00', '11:00', '11:30', '12:00', '12:30', '13:00', '14:00', '15:00', '16:30', '17:00', '17:30', '18:00']);
  assert.deepEqual(nearestTimes(options, '13:30').map((option) => option.time), ['12:30', '13:00', '14:00', '15:00']);
  assert.deepEqual(nearestTimes(options, '07:00').map((option) => option.time), ['10:00', '11:00', '11:30', '12:00']);
  assert.deepEqual(nearestTimes(options, '17:45').map((option) => option.time), ['16:30', '17:00', '17:30', '18:00']);
  assert.deepEqual(nearestTimes(options, '20:00', 2).map((option) => option.time), ['17:30', '18:00']);
  assert.deepEqual(nearestTimes(options.slice(0, 3), '11:15').map((option) => option.time), ['10:00', '11:00', '11:30']);
  assert.deepEqual(nearestTimes(options, '', 2).map((option) => option.time), ['10:00', '11:00']);
  assert.deepEqual(nearestTimes([], '10:00'), []);
  assert.equal(nextFreeDay(salon(), { serviceId: 'srv-9', employeeId: ANYONE, appointmentId: null, outsideHours: false }, SATURDAY), '2026-10-13');
  assert.equal(nextFreeDay(salon({ employees: [] }), { serviceId: 'srv-2', employeeId: ANYONE, appointmentId: null, outsideHours: false }, TODAY), null);
});

// ---------- 4. no dead ends ----------

test('a salon in which nothing can be booked yet says what is missing and where to put it right', () => {
  const open = (context: AvailabilityContext) => appointmentFormView(context, openDraft(context, demoCustomers, { kind: 'new' }));
  assert.deepEqual(open(salon({ services: [] })).blocked,
    { text: 'You have no services yet. Add a service first: then you can book appointments.', screen: 'services' });
  const inactive = initialEmployees.map((employee) => ({ ...employee, status: 'Inactive' as const }));
  assert.deepEqual(open(salon({ employees: inactive })).blocked,
    { text: 'Nobody in your team is active. Add a person in Team, or set somebody to active: then you can book appointments.', screen: 'team' });
  assert.equal(open(salon({ employees: [] })).blocked?.screen, 'team');
  const unassigned = initialServices.map((service) => ({ ...service, assignedEmployeeIds: [] }));
  assert.deepEqual(open(salon({ services: unassigned })).blocked,
    { text: 'Nobody in your team offers a service yet. Choose in Team who offers which service: then you can book appointments.', screen: 'team' });
  // Nothing of this can be saved, and the reason is the same sentence.
  const empty = salon({ services: [] });
  assert.deepEqual(appointmentSave(empty, demoCustomers, openDraft(empty, demoCustomers, { kind: 'new', customerId: PETRA.id })),
    { error: 'You have no services yet. Add a service first: then you can book appointments.', field: 'form' });
  // The form starts on a service somebody offers. One that nobody offers says so when it is chosen.
  const ownerInactive = salon({ employees: initialEmployees.map((employee) => employee.id === 'emp-1' ? { ...employee, status: 'Inactive' as const } : employee) });
  const draft = openDraft(ownerInactive, demoCustomers, { kind: 'new', customerId: PETRA.id });
  assert.equal(draft.serviceId, 'srv-1');
  const balayage = changeDraft(ownerInactive, draft, { serviceId: 'srv-9' });
  const shown = appointmentFormView(ownerInactive, balayage);
  assert.equal(shown.serviceNote, 'Nobody in your team offers Balayage. Choose another service, or choose in Team who offers it.');
  assert.deepEqual(shown.stylists, []);
  assert.deepEqual(stillNeeded(balayage, shown), ['a time']);
  assert.deepEqual(appointmentSave(ownerInactive, demoCustomers, balayage), { error: shown.serviceNote, field: 'service' });
});

test('a day that cannot be booked says why and offers the way out: the weekly closed day', () => {
  const draft = openDraft(salon(), demoCustomers, { kind: 'new', date: NEXT_MONDAY, customerId: PETRA.id });
  assert.deepEqual(view(draft).dayProblem, {
    text: 'The salon is closed on Mondays.',
    advice: 'Choose another day, or switch on “Book outside opening hours”.',
    nextDay: '2026-10-13', othersFree: false, outsideHelps: true, ownDay: null,
  });
  assert.deepEqual(starts(draft), []);
  assert.deepEqual(stillNeeded(draft, view(draft)), ['a time']);
  assert.deepEqual(appointmentSave(salon(), demoCustomers, draft), { error: 'The salon is closed on Mondays. Choose another time or day.', field: 'time' });
  // The offer leads to a day with a time, which is suggested at once.
  const next = changeDraft(salon(), draft, { date: view(draft).dayProblem!.nextDay! });
  assert.equal(view(next).dayProblem, null);
  assert.equal(view(next).chosen?.time, next.time);
  assert.ok('save' in appointmentSave(salon(), demoCustomers, next));
});

test('a closed date, an absence and a day off each have their own sentence', () => {
  const closedDate = salon({ closedDates: [{ id: 'c1', name: ' Team day ', start: THURSDAY, end: THURSDAY }] });
  const onClosedDate = openDraft(closedDate, demoCustomers, { kind: 'new', date: THURSDAY });
  assert.deepEqual(appointmentFormView(closedDate, onClosedDate).dayProblem, {
    text: 'The salon is closed on Thu, 08.10.2026 (Team day).',
    advice: 'To book on this day, remove the closed date in Settings first.',
    nextDay: FRIDAY, othersFree: false, outsideHelps: false, ownDay: null,
  });
  // The switch does not open a closed date: the rules refuse it, and the form does not pretend otherwise.
  const switched = changeDraft(closedDate, onClosedDate, { outsideHours: true });
  assert.deepEqual(appointmentFormView(closedDate, switched).times, []);
  assert.equal(appointmentFormView(closedDate, switched).dayProblem?.outsideHelps, false);
  assert.equal(appointmentFormView(salon({ closedDates: [{ id: 'c2', name: '', start: THURSDAY, end: THURSDAY }] }), onClosedDate).dayProblem?.text,
    'The salon is closed on Thu, 08.10.2026.');

  const away = salon({ absences: [{ id: 'a1', employeeId: 'emp-2', start: THURSDAY, end: FRIDAY }] });
  const withSelina = openDraft(away, demoCustomers, { kind: 'new', date: THURSDAY, employeeId: 'emp-2' });
  assert.deepEqual(appointmentFormView(away, withSelina).dayProblem, {
    text: 'Selina Keller is away on Thu, 08.10.2026.', advice: 'Choose another stylist or another day.',
    nextDay: SATURDAY, othersFree: true, outsideHelps: false, ownDay: null,
  });
  // "Anyone free on this day" is the second way out: the owner is there.
  assert.equal(appointmentFormView(away, changeDraft(away, withSelina, { employeeId: ANYONE })).chosen?.employeeId, 'emp-1');
  const allAway = salon({ absences: initialEmployees.map((employee) => ({ id: employee.id, employeeId: employee.id, start: THURSDAY, end: THURSDAY })) });
  assert.equal(appointmentFormView(allAway, openDraft(allAway, demoCustomers, { kind: 'new', date: THURSDAY })).dayProblem?.text,
    'Everybody who offers Wash & blow-dry is away on Thu, 08.10.2026.');

  // Luca does not work on Thursdays.
  const withLuca = openDraft(salon(), demoCustomers, { kind: 'new', date: THURSDAY, time: '13:30', employeeId: 'emp-3' });
  assert.deepEqual(view(withLuca).dayProblem, {
    text: 'Luca Frei does not work on Thu, 08.10.2026.',
    advice: 'Choose another stylist or another day, or switch on “Book outside opening hours”.',
    nextDay: FRIDAY, othersFree: true, outsideHelps: true, ownDay: null,
  });
  assert.equal(view(withLuca).stylists.find((item) => item.employee.id === 'emp-3')?.free, false);
  assert.equal(view(withLuca).stylists.find((item) => item.employee.id === 'emp-1')?.free, true);
  // Nobody at all works: every stylist without a regular week.
  const noHours = salon({ employees: initialEmployees.map((employee) => ({ ...employee, weeklyHours: undefined })) });
  const nobody = appointmentFormView(noHours, openDraft(noHours, demoCustomers, { kind: 'new', date: THURSDAY })).dayProblem;
  assert.equal(nobody?.text, 'Nobody who offers Wash & blow-dry works on Thu, 08.10.2026.');
  assert.equal(nobody?.nextDay, null); // nor on any other day
  // Working hours that lie outside the opening hours.
  const early = salon({ shiftOverview: withDayChanges(demoShifts, initialEmployees, [{ employeeId: 'emp-1', date: THURSDAY, hours: { start: '06:00', end: '08:00' } }]) });
  assert.equal(appointmentFormView(early, openDraft(early, demoCustomers, { kind: 'new', date: THURSDAY, employeeId: 'emp-1' })).dayProblem?.text,
    'Anna Weber’s working hours on Thu, 08.10.2026 lie outside the opening hours.');
});

test('a full day offers the next free day; a day whose times have passed says that instead', () => {
  // The owner's Saturday has no room for three hours of balayage.
  const full = openDraft(salon(), demoCustomers, { kind: 'new', date: SATURDAY, serviceId: 'srv-9' });
  assert.deepEqual(view(full).dayProblem, {
    text: 'No free time is left on Sat, 10.10.2026 for Balayage.',
    advice: 'For a time outside the usual hours, switch on “Book outside opening hours”.',
    nextDay: '2026-10-13', othersFree: false, outsideHelps: true, ownDay: null,
  });
  assert.equal(view(changeDraft(salon(), full, { employeeId: 'emp-1' })).dayProblem?.text, 'No free time is left on Sat, 10.10.2026 for Balayage with Anna Weber.');
  assert.ok(view(changeDraft(salon(), full, { date: '2026-10-13' })).chosen);
  // The days of the quick choice show where a time is free: two weeks from today, the closed days drawn back.
  const days = view(full).days;
  assert.equal(days.length, 14);
  assert.deepEqual(days.slice(0, 2).map((day) => [day.date, day.name]), [[TODAY, 'Today'], [THURSDAY, 'Tomorrow']]);
  assert.deepEqual(days.filter((day) => !day.free).map((day) => day.date).slice(0, 4), [THURSDAY, SATURDAY, '2026-10-11', NEXT_MONDAY]);
  // Today, after the last start: "left", not "fully booked".
  const evening = salon({ now: new Date('2026-10-07T16:20:00Z') });
  assert.equal(appointmentFormView(evening, openDraft(evening, demoCustomers, { kind: 'new', date: TODAY, employeeId: 'emp-1' })).dayProblem?.text,
    'No time is left today for Wash & blow-dry with Anna Weber.');
  // A rule about the whole day that the form has no words of its own for is passed on as the rules say it.
  const broken = salon({ services: initialServices.map((service) => service.id === 'srv-1' ? { ...service, durationMinutes: 0 } : service) });
  assert.equal(appointmentFormView(broken, openDraft(broken, demoCustomers, { kind: 'new', date: THURSDAY })).dayProblem?.text,
    'This service has an invalid duration or preparation time. Please update the service.');
});

// ---------- 5. editing ----------

const PAST_ID = 'cal-20261003-e1-1200'; // Saturday 3 October, 12:00–13:00: Corinne Fischer, Cut & blow-dry with the owner
const PAST = demoEvents.find((event) => event.id === PAST_ID)!;

test('an appointment in the past opens with its own day and time, and can be saved as it is', () => {
  const draft = openDraft(salon(), demoCustomers, { kind: 'edit', appointmentId: PAST_ID });
  assert.deepEqual(draft, {
    appointmentId: PAST_ID, customer: { kind: 'existing', customerId: 'cust-061', phone: '' }, serviceId: 'srv-4', employeeId: 'emp-1',
    date: '2026-10-03', time: '12:00', timeChosen: true, outsideHours: false, source: null, startNote: null,
  });
  const shown = view(draft);
  assert.equal(shown.editing, PAST);
  // Its own time is the one time of that day: nothing else in the past can be chosen.
  assert.deepEqual(shown.times, [{ time: '12:00', end: '13:00', employeeId: 'emp-1', outside: false, offShift: false }]);
  assert.deepEqual([shown.dayProblem, shown.timeProblem], [null, null]);
  const save = saved(appointmentSave(salon(), demoCustomers, draft));
  // Nothing of the appointment is lost: when it was booked, who booked it, its colour.
  assert.deepEqual(save.event, { ...Object.fromEntries(Object.entries(PAST).filter(([key]) => key !== 'id')), outsideHoursApproved: false });
  assert.equal(save.appointmentId, PAST_ID);
  assert.equal(rulesSay(salon(), save), null);
  // The same time for a new appointment stays refused.
  assert.equal(validateCalendarEvent(salon(), save.event, 'cal-new'), 'Choose today or a future appointment date.');
});

test('the service, the stylist and the customer of a past appointment are corrected afterwards', () => {
  const opened = openDraft(salon(), demoCustomers, { kind: 'edit', appointmentId: PAST_ID });
  // A haircut instead: half an hour at the same start.
  const haircut = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { serviceId: 'srv-2' })));
  assert.deepEqual([haircut.event.serviceName, haircut.event.startTime, haircut.event.endTime, haircut.event.date], ['Haircut', '12:00', '12:30', '2026-10-03']);
  assert.equal(rulesSay(salon(), haircut), null);
  // Selina did it: she was free then.
  const selina = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { employeeId: 'emp-2' })));
  assert.deepEqual([selina.event.employeeId, selina.event.staffName], ['emp-2', 'Selina Keller']);
  assert.equal(rulesSay(salon(), selina), null);
  // It was Petra Meier who came: the appointment moves to her record, and neither record is rewritten.
  const petra = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { customer: { kind: 'existing', customerId: PETRA.id, phone: '' } })));
  assert.deepEqual([petra.event.customerId, petra.event.customerName, petra.event.customerPhone], ['cust-001', 'Petra Meier', '+41765556242']);
  assert.equal(petra.customer, PETRA);
  assert.equal(petra.addsPhone, false);
  // Luca had a customer at 12:30: the form says that the time does not fit, and how to go on.
  const luca = changeDraft(salon(), opened, { employeeId: 'emp-3' });
  assert.deepEqual(view(luca).dayProblem, {
    text: 'This appointment was on Sat, 03.10.2026. Its time, 12:00–13:00, is not free for Cut & blow-dry with Luca Frei.',
    advice: 'Choose another stylist or service, or move the appointment to today or a later day.',
    nextDay: FRIDAY, othersFree: true, outsideHelps: false, ownDay: null,
  });
  assert.equal(refused(appointmentSave(salon(), demoCustomers, luca)).field, 'time');
});

test('a past appointment can move to today or later, but to no other day in the past', () => {
  const opened = openDraft(salon(), demoCustomers, { kind: 'edit', appointmentId: PAST_ID });
  const friday = changeDraft(salon(), opened, { date: FRIDAY });
  assert.equal(view(friday).chosen?.time, '12:00'); // its time of day is kept where it is free
  assert.equal(rulesSay(salon(), saved(appointmentSave(salon(), demoCustomers, friday))), null);
  const otherPast = changeDraft(salon(), opened, { date: '2026-10-02' });
  assert.deepEqual(view(otherPast).dayProblem, {
    text: 'Fri, 02.10.2026 is over.', advice: 'The appointment can stay on its own day, or move to today or a later day.',
    nextDay: TODAY, othersFree: false, outsideHelps: false, ownDay: '2026-10-03',
  });
  // "Back to its own day" is one tap.
  assert.equal(view(changeDraft(salon(), otherPast, { date: view(otherPast).dayProblem!.ownDay! })).chosen?.time, '12:00');
  // A new appointment has no day in the past at all.
  const fresh = changeDraft(salon(), openDraft(salon(), demoCustomers, { kind: 'new' }), { date: '2026-10-02' });
  assert.equal(view(fresh).dayProblem?.text, 'Fri, 02.10.2026 is over.');
  assert.equal(view(fresh).dayProblem?.advice, 'Choose today or a later day.');
  assert.equal(view(fresh).dayProblem?.nextDay, TODAY);
});

test('an appointment that has started today keeps its time among the times still to come', () => {
  const running: CalendarEvent = { ...PAST, id: 'cal-running', date: TODAY, day: 'wed', dateDisplay: 'Wed 07.10.', startTime: '09:30', endTime: '10:30' };
  const context = salon({ events: [running, ...demoEvents] });
  const draft = openDraft(context, demoCustomers, { kind: 'edit', appointmentId: 'cal-running' });
  const offered = starts(draft, context);
  assert.equal(offered[0], '09:30');
  assert.ok(offered.slice(1).every((time) => time > '10:02'), offered.join(' '));
  assert.equal(appointmentFormView(context, draft).chosen?.time, '09:30');
  assert.equal(rulesSay(context, saved(appointmentSave(context, demoCustomers, draft))), null);
  // Its own time is not kept against the other rules. A colouring would run into the owner's next
  // customer at 10:30, and Selina only starts at ten on Wednesdays: neither is offered at 09:30.
  const colouring = changeDraft(context, draft, { serviceId: 'srv-3' });
  assert.ok(!starts(colouring, context).includes('09:30'));
  assert.ok(!starts(changeDraft(context, draft, { employeeId: 'emp-2' }), context).includes('09:30'));
  // The reason given is the real one, not that the time has passed.
  assert.equal(appointmentFormView(context, colouring).timeProblem?.text, '09:30–11:00 is not free: Anna Weber has Laura Roth at 10:30–11:30.');
});

test('a stylist or a service that is gone is named, and the form asks for another one', () => {
  const lucas = demoEvents.find((event) => event.employeeId === 'emp-3' && event.date < TODAY)!;
  const inactive = salon({ employees: initialEmployees.map((employee) => employee.id === 'emp-3' ? { ...employee, status: 'Inactive' as const } : employee) });
  const draft = openDraft(inactive, demoCustomers, { kind: 'edit', appointmentId: lucas.id });
  assert.equal(draft.employeeId, 'emp-3');
  const shown = appointmentFormView(inactive, draft);
  assert.equal(shown.employeeId, '');
  assert.equal(shown.stylistNote, 'Luca Frei is set to inactive and takes no appointments. Choose another stylist, or set Luca Frei to active in Team.');
  assert.deepEqual(stillNeeded(draft, shown), ['a stylist', 'a time']);
  assert.deepEqual(appointmentSave(inactive, demoCustomers, draft), { error: shown.stylistNote, field: 'stylist' });
  // No longer assigned to the service.
  const unassigned = salon({ services: initialServices.map((service) => ({ ...service, assignedEmployeeIds: service.assignedEmployeeIds?.filter((id) => id !== 'emp-3') })) });
  assert.match(appointmentFormView(unassigned, openDraft(unassigned, demoCustomers, { kind: 'edit', appointmentId: lucas.id })).stylistNote!, /^Luca Frei does not offer .+\. Choose another stylist\.$/);
  // The service was deleted.
  const withoutService = salon({ services: initialServices.filter((service) => service.id !== 'srv-4') });
  const orphan = openDraft(withoutService, demoCustomers, { kind: 'edit', appointmentId: PAST_ID });
  assert.equal(orphan.serviceId, '');
  assert.equal(appointmentFormView(withoutService, orphan).serviceNote, '“Cut & blow-dry” is no longer one of your services. Choose the service this appointment is for.');
  assert.equal(refused(appointmentSave(withoutService, demoCustomers, orphan)).field, 'service');
  // The appointment itself is gone (cancelled in another tab while the form was open).
  const gone = openDraft(salon(), demoCustomers, { kind: 'edit', appointmentId: 'cal-gone' });
  assert.deepEqual(view(gone).blocked, { text: 'This appointment is no longer in the calendar. It may have been cancelled in the meantime.', screen: null });
  assert.equal(refused(appointmentSave(salon(), demoCustomers, gone)).field, 'form');
});

// ---------- 6. book outside opening hours ----------

test('with the switch, a time after closing can be chosen, and nobody\'s working hours change', () => {
  // Friday: the salon closes at 18:30, the owner works 10:00–18:30.
  const opened = openDraft(salon(), demoCustomers, { kind: 'new', date: FRIDAY, employeeId: 'emp-1', customerId: 'cust-chloe' });
  assert.equal(starts(opened).at(-1), '18:00');
  const switched = changeDraft(salon(), opened, { outsideHours: true });
  const offered = view(switched).times;
  assert.deepEqual([offered[0].time, offered.at(-1)!.time], ['06:00', '22:30']);
  // The usual times stay as they are; before her start and after closing a time is marked, nothing more.
  assert.deepEqual(offered.find((option) => option.time === '10:00'), { time: '10:00', end: '10:30', employeeId: 'emp-1', outside: false, offShift: false });
  assert.deepEqual(offered.find((option) => option.time === '08:30'), { time: '08:30', end: '09:00', employeeId: 'emp-1', outside: false, offShift: true });
  assert.deepEqual(offered.find((option) => option.time === '19:00'), { time: '19:00', end: '19:30', employeeId: 'emp-1', outside: true, offShift: true });
  assert.deepEqual(view(switched).groups.map((group) => [group.label, group.options.length]), [['Before opening', 5], ['During opening hours', 19], ['After closing', 9]]);
  // Switching on suggests nothing outside the usual hours: that is for the owner to pick.
  assert.equal(switched.time, '10:00');
  const late = changeDraft(salon(), switched, { time: '19:00' });
  const save = saved(appointmentSave(salon(), demoCustomers, late));
  assert.equal(save.event.outsideHoursApproved, true);
  assert.equal('dayChanges' in save, false);
  // The rules accept it as it is, with Anna's hours unchanged.
  assert.equal(rulesSay(salon(), save), null);
  assert.deepEqual(workingTimeOn(salon(), 'emp-1', FRIDAY), { start: '10:00', end: '18:30' });
  assert.equal(savedMessage(save, { ...save.event }), 'Appointment added for Chloé Favre: Fri, 09.10.2026, 19:00.');
  // Inside the opening hours but before her start: also booked outside the usual hours, her hours stay.
  const early = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), switched, { time: '08:30' })));
  assert.equal(early.event.outsideHoursApproved, true);
  assert.equal(rulesSay(salon(), early), null);
  // Without the approval the same times are refused: they lie outside her working hours.
  assert.match(validateCalendarEvent(salon(), { ...early.event, outsideHoursApproved: false }, 'cal-new')!, /^This time is not available/);
  // Switched off again, the late time is a wish that is not free: the form says so.
  const off = changeDraft(salon(), late, { outsideHours: false });
  assert.equal(view(off).chosen, null);
  assert.equal(view(off).timeProblem?.text, '19:00–19:30 is not free: Anna Weber works 10:00–18:30 that day.');
  assert.equal(refused(appointmentSave(salon(), demoCustomers, off)).field, 'time');
});

test('with the switch, a closed day can be booked, and the stylist still does not work that day', () => {
  const opened = openDraft(salon(), demoCustomers, { kind: 'new', date: NEXT_MONDAY, employeeId: 'emp-2', customerId: PETRA.id });
  const switched = changeDraft(salon(), opened, { outsideHours: true });
  // Nothing is suggested: on a closed day every time is the owner's decision.
  assert.deepEqual([switched.time, view(switched).chosen, view(switched).dayProblem], ['', null, null]);
  assert.ok(view(switched).times.every((option) => option.outside && option.offShift));
  assert.deepEqual(view(switched).groups.map((group) => group.label), ['Morning', 'Afternoon', 'Evening']);
  assert.deepEqual(stillNeeded(switched, view(switched)), ['a time']);
  const picked = changeDraft(salon(), switched, { time: '10:00' });
  const save = saved(appointmentSave(salon(), demoCustomers, picked));
  assert.equal(save.event.outsideHoursApproved, true);
  assert.equal(rulesSay(salon(), save), null);
  // Without the approval the rules refuse it: Selina does not work that day, and stays so.
  assert.equal(validateCalendarEvent(salon(), { ...save.event, outsideHoursApproved: false }, 'cal-new'), 'The salon is closed on this date.');
  // A second appointment that day: the first is in the way, nothing else.
  const after = salon({ events: upsertAppointment(demoEvents, { ...save.event, id: 'cal-monday' }) });
  assert.equal(workingTimeOn(after, 'emp-2', NEXT_MONDAY), null);
  const second = steps(after, openDraft(after, demoCustomers, { kind: 'new', date: NEXT_MONDAY, employeeId: 'emp-2', customerId: PETRA.id }), { outsideHours: true }, { time: '11:00' });
  assert.ok(!appointmentFormView(after, second).times.some((option) => option.time === '10:00')); // taken by the first
  assert.equal(rulesSay(after, saved(appointmentSave(after, demoCustomers, second))), null);
  // The customers' page offers nothing on that day afterwards.
  assert.deepEqual(getAvailableSlots(after, { date: NEXT_MONDAY, serviceId: 'srv-1', employeeId: 'emp-2' }), []);
});

test('every time the switch offers is one the slot rules accept as it is', () => {
  for (const [date, employeeId, serviceId] of [[FRIDAY, 'emp-1', 'srv-3'], [NEXT_MONDAY, ANYONE, 'srv-2'], [SATURDAY, 'emp-3', 'srv-4'], [TODAY, ANYONE, 'srv-9']] as const) {
    const draft = steps(salon(), openDraft(salon(), demoCustomers, { kind: 'new', date, serviceId, customerId: PETRA.id }), { employeeId }, { outsideHours: true });
    const offered = view(draft).times;
    assert.ok(offered.length > 0, `${date} ${employeeId}`);
    for (const option of offered) {
      const save = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), draft, { time: option.time })));
      assert.equal(rulesSay(salon(), save), null, `${date} ${option.time} ${option.employeeId}`);
      // Marked exactly where the time is not inside the usual hours, and never earlier than six or later than eleven.
      assert.equal(save.event.outsideHoursApproved, option.outside || option.offShift);
      assert.ok(option.time >= '06:00' && option.end <= '23:00', option.time);
    }
  }
  // With a service that needs time before and after, that time lies inside the window too.
  const buffered = salon({ services: initialServices.map((service) => service.id === 'srv-2' ? { ...service, prepMinutes: 15, postMinutes: 10 } : service) });
  const draft = steps(buffered, openDraft(buffered, demoCustomers, { kind: 'new', date: NEXT_MONDAY, serviceId: 'srv-2', employeeId: 'emp-1', customerId: PETRA.id }), { outsideHours: true });
  assert.equal(view(draft, buffered).times[0].time, '06:30');
  assert.ok(view(draft, buffered).times.at(-1)!.end <= '22:50');
  const save = saved(appointmentSave(buffered, demoCustomers, changeDraft(buffered, draft, { time: '10:00' })));
  assert.equal(rulesSay(buffered, save), null);
});

test('with "Anyone free" and the switch, somebody who works then comes before somebody who does not', () => {
  const draft = steps(salon(), openDraft(salon(), demoCustomers, { kind: 'new', date: FRIDAY }), { outsideHours: true });
  const offered = new Map(view(draft).times.map((option) => [option.time, option]));
  // 08:30: Selina works then and is free. 09:00: she has a customer, so the owner takes it before her start.
  assert.deepEqual(offered.get('08:30'), { time: '08:30', end: '09:00', employeeId: 'emp-2', outside: false, offShift: false });
  assert.deepEqual(offered.get('09:00'), { time: '09:00', end: '09:30', employeeId: 'emp-1', outside: false, offShift: true });
  // After closing nobody works: the first of the team.
  assert.equal(offered.get('19:00')?.employeeId, 'emp-1');
  // An appointment that was approved outside the opening hours opens with the switch on and keeps its time.
  const lateEvent: CalendarEvent = { ...PAST, id: 'cal-late', date: FRIDAY, day: 'fri', dateDisplay: 'Fri 09.10.', startTime: '19:00', endTime: '20:00', outsideHoursApproved: true, source: 'phone' };
  const extended = salon({ events: [lateEvent, ...demoEvents] });
  const edit = openDraft(extended, demoCustomers, { kind: 'edit', appointmentId: 'cal-late' });
  assert.equal(edit.outsideHours, true);
  assert.deepEqual(appointmentFormView(extended, edit).chosen, { time: '19:00', end: '20:00', employeeId: 'emp-1', outside: true, offShift: true });
  const again = saved(appointmentSave(extended, demoCustomers, edit));
  assert.equal(again.event.outsideHoursApproved, true);
  // Moved back into the usual hours, the mark goes: an approval belongs to the time it was given for.
  const moved = saved(appointmentSave(extended, demoCustomers, changeDraft(extended, edit, { time: '12:00' })));
  assert.equal(moved.event.outsideHoursApproved, false);
});

test('the message after saving names the customer, the day and the time, and no change of working hours', () => {
  const draft = steps(salon(), openDraft(salon(), demoCustomers, { kind: 'new', date: NEXT_MONDAY, employeeId: 'emp-3', customerId: PETRA.id }), { outsideHours: true }, { time: '10:00' });
  const save = saved(appointmentSave(salon(), demoCustomers, draft));
  assert.equal(savedMessage(save, save.event), 'Appointment added for Petra Meier: Mon, 12.10.2026, 10:00.');
  assert.equal(savedMessage({ ...save, appointmentId: 'cal-x' }, save.event), 'Appointment updated for Petra Meier: Mon, 12.10.2026, 10:00.');
  assert.deepEqual(Object.keys(save).sort(), ['addsPhone', 'appointmentId', 'customer', 'event']);
  assert.ok(!Object.keys(appointmentFormView(salon(), draft)).some((key) => /hours/i.test(key)));
});

// ---------- 7. where the booking came from ----------

test('a new appointment is marked Phone unless the owner chooses another source; no source is recorded that she did not choose', () => {
  assert.deepEqual(APPOINTMENT_SOURCES, [{ id: 'phone', label: 'Phone' }, { id: 'walk-in', label: 'Walk-in' }, { id: 'other', label: 'Other' }]);
  const opened = openDraft(salon(), demoCustomers, { kind: 'new', customerId: PETRA.id });
  assert.equal(saved(appointmentSave(salon(), demoCustomers, opened)).event.source, 'phone');
  assert.equal(saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { source: 'walk-in' }))).event.source, 'walk-in');
  assert.equal(saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { source: 'other' }))).event.source, 'other');
  // An appointment the AI booked in a chat has no source, and changing it gives it none.
  const chat = openDraft(salon(), demoCustomers, { kind: 'edit', appointmentId: 'cal-2' });
  assert.equal(chat.source, null);
  const chatSave = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), chat, { time: '14:00' })));
  assert.ok(!('source' in chatSave.event));
  assert.deepEqual([chatSave.event.isAiBooked, chatSave.event.conversationId], [true, 'conv-marie']);
  // One that was entered by hand keeps the source it was given, and it can be corrected.
  const byHand = salon({ events: [{ ...PAST, id: 'cal-hand', source: 'walk-in' }, ...demoEvents.filter((event) => event.id !== PAST_ID)] });
  const hand = openDraft(byHand, demoCustomers, { kind: 'edit', appointmentId: 'cal-hand' });
  assert.equal(hand.source, 'walk-in');
  assert.equal(saved(appointmentSave(byHand, demoCustomers, hand)).event.source, 'walk-in');
  assert.equal(saved(appointmentSave(byHand, demoCustomers, changeDraft(byHand, hand, { source: 'phone' }))).event.source, 'phone');
  // A word a later build stored is neither shown as a choice nor thrown away.
  const later = salon({ events: [{ ...PAST, id: 'cal-later', source: 'voicemail' as CalendarEvent['source'] }, ...demoEvents.filter((event) => event.id !== PAST_ID)] });
  const unknown = openDraft(later, demoCustomers, { kind: 'edit', appointmentId: 'cal-later' });
  assert.equal(unknown.source, null);
  assert.equal(saved(appointmentSave(later, demoCustomers, unknown)).event.source, 'voicemail');
});

// ---------- 2. the customer ----------

test('customers are found by a few letters of the name, with or without accents', () => {
  const names = (query: string, limit?: number) => findCustomers(demoCustomers, query, limit).matches.map((customer) => customer.name);
  assert.deepEqual(names('mei'), ['Petra Meier', 'Ruth Meier', 'Roland Meier']);
  assert.deepEqual(names('MEI'), names('mei'));
  assert.deepEqual(names('pet mei'), ['Petra Meier']);
  assert.deepEqual(names('meier p'), ['Petra Meier']);
  assert.deepEqual(names('chloe'), ['Chloé Favre']);
  assert.deepEqual(names('Chloé'), ['Chloé Favre']);
  assert.deepEqual(names('kunzle'), ['Michael Künzle', 'Tamara Künzle']);
  assert.deepEqual(names('kuenzle'), names('kunzle'));
  assert.deepEqual(names('Künzl'), names('kunzle'));
  assert.deepEqual(names('kunz'), ['Michael Künzle', 'Michelle Kunz', 'Tamara Künzle']);
  assert.deepEqual(names('yilmaz'), ['Elif Yılmaz']);
  assert.deepEqual(names('sahin'), ['Ayşe Şahin', 'Emre Şahin']);
  assert.deepEqual(names('jovanovic'), ['Jelena Jovanović']);
  assert.deepEqual(names('zz'), []);
  assert.deepEqual(names('   '), []);
  assert.deepEqual(names('-'), []);
  // A name in which the letters begin a word comes before one that only contains them.
  const list: Customer[] = ['Margrit Petermann', 'Hanspeter Graf', 'Peter Bühler', 'Anne-Petra Roth'].map((name, index) =>
    ({ id: `c${index}`, name, initials: 'XX', email: '', phone: '', language: 'DE' }));
  assert.deepEqual(findCustomers(list, 'pet').matches.map((customer) => customer.name), ['Margrit Petermann', 'Peter Bühler', 'Anne-Petra Roth', 'Hanspeter Graf']);
  // Many matches: the first few, and how many more there are.
  const many = findCustomers(demoCustomers, 'er');
  assert.equal(many.matches.length, 6);
  assert.ok(many.more > 20);
  assert.equal(findCustomers(demoCustomers, 'er', 3).matches.length, 3);
  // The same tolerance in the header search and the filter of the customer list.
  const chloe = demoCustomers.find((customer) => customer.id === 'cust-chloe')!;
  for (const query of ['chloe', 'CHLOÉ', 'Chloé Fav', 'favre']) assert.equal(customerMatches(chloe, query), true, query);
  assert.equal(customerMatches(chloe, 'chlo e'), false);
  assert.equal(nameMatches('Müller', 'mueller'), true);
  assert.equal(nameMatches('Müller', 'muller'), true);
  assert.equal(nameMatches('Mu\u0308ller', 'mueller'), true); // the umlaut typed as a letter and a separate sign
  assert.equal(nameMatches('Strauß', 'strauss'), true);
  assert.equal(nameMatches('Miller', 'muller'), false);
});

test('customers are found by their number in any spelling', () => {
  const names = (query: string) => findCustomers(demoCustomers, query).matches.map((customer) => customer.name);
  for (const query of ['076 555 62 42', '0765556242', '+41 76 555 62 42', '+41765556242', '0041 76 555 62 42', '076/555 62 42', '555 62 42', '6242']) {
    assert.deepEqual(names(query), ['Petra Meier'], query);
  }
  // The start of a number finds everybody whose number starts that way, the most recent contacts first.
  const start = findCustomers(demoCustomers, '079 555');
  assert.equal(start.matches.length, 6);
  assert.ok(start.more > 30);
  assert.ok(start.matches.every((customer) => customer.phone.startsWith('+4179555')));
  assert.deepEqual(names('079 999 99'), []);
  // Somebody without a number is never found by digits.
  const chatOnly: Customer = { id: 'chat', name: 'Tom', initials: 'T', email: '', phone: '', language: 'DE' };
  assert.deepEqual(findCustomers([chatOnly], '079').matches, []);
  assert.deepEqual(findCustomers([chatOnly], 'to').matches, [chatOnly]);
});

test('an existing customer is stored as picked: the record is not rewritten, whatever the appointment said before', () => {
  const opened = openDraft(salon(), demoCustomers, { kind: 'new' });
  assert.deepEqual(appointmentSave(salon(), demoCustomers, opened), { error: 'Choose a customer, or add a new one.', field: 'customer' });
  const save = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { customer: { kind: 'existing', customerId: PETRA.id, phone: '' } })));
  assert.equal(save.customer, PETRA);
  assert.deepEqual([save.event.customerId, save.event.customerName, save.event.customerPhone], ['cust-001', 'Petra Meier', '+41765556242']);
  assert.equal(save.addsPhone, false);
  // A number typed for somebody who has one already is ignored: the form has no field for it, and no way around.
  const sneaky = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { customer: { kind: 'existing', customerId: PETRA.id, phone: '079 000 00 00' } })));
  assert.equal(sneaky.customer, PETRA);
  // The app stores the record through customerForAppointment: with the record given, nothing is looked up by name.
  const twin: Customer = { ...PETRA, id: 'cust-twin', phone: '+41790000001' };
  const both = [twin, ...demoCustomers];
  assert.equal(customerForAppointment(both, { ...save.event, id: 'cal-new' }, undefined, { record: PETRA }).customer, PETRA);
  // The appointment was somebody else's before (an edit): still exactly the record that was picked.
  const before: CalendarEvent = { ...save.event, id: 'cal-new', customerId: 'cust-061', customerName: 'Corinne Fischer', customerPhone: '+41775559600' };
  const resolved = customerForAppointment(both, { ...save.event, id: 'cal-new' }, before, { record: PETRA });
  assert.equal(resolved.customer, PETRA);
  assert.equal(resolved.previousCustomerId, 'cust-061');
  // Without the record, the same edit would have found no single Petra Meier and made a third one.
  assert.notEqual(customerForAppointment(both, { ...save.event, id: 'cal-new' }, before).customer.id, PETRA.id);
  // A customer who was deleted while the form was open.
  assert.deepEqual(appointmentSave(salon(), [], changeDraft(salon(), opened, { customer: { kind: 'existing', customerId: PETRA.id, phone: '' } })),
    { error: 'This customer is no longer in your customer list. Choose another customer.', field: 'customer' });
});

test('a customer without a number can be given one, and only then', () => {
  const tom: Customer = { id: 'cust-tom', name: 'Tom', initials: 'T', email: '', phone: '', language: 'DE', channel: 'Website', conversationId: 'web-1' };
  const customers = [tom, ...demoCustomers];
  const opened = openDraft(salon(), customers, { kind: 'new', customerId: 'cust-tom' });
  // Nothing typed: nothing changes.
  const plain = saved(appointmentSave(salon(), customers, opened));
  assert.equal(plain.customer, tom);
  assert.equal(plain.addsPhone, false);
  const typed = (phone: string) => appointmentSave(salon(), customers, changeDraft(salon(), opened, { customer: { kind: 'existing', customerId: 'cust-tom', phone } }));
  const withNumber = saved(typed(' 079 123 45 67 '));
  assert.deepEqual(withNumber.customer, { ...tom, phone: '+41791234567' });
  assert.equal(withNumber.addsPhone, true);
  assert.equal(withNumber.event.customerPhone, '+41791234567');
  assert.equal(saved(typed('+41 (0)79 123 45 67')).customer?.phone, '+41791234567');
  assert.deepEqual(typed('079 123'), {
    error: 'Enter a valid mobile number, or leave the field empty. This Swiss number is too short: 9 digits follow the 0 or +41, for example 079 123 45 67.', field: 'customer',
  });
});

test('somebody new becomes a customer record when the appointment is saved: name, mobile number, language', () => {
  const opened = openDraft(salon(), demoCustomers, { kind: 'new' });
  const entered = (name: string, phone = '', language: Customer['language'] = 'DE') =>
    appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { customer: { kind: 'new', name, phone, language } }), () => 'cust-new');
  const sandra = saved(entered('  Sandra   Keller ', '079 123 45 67'));
  assert.deepEqual(sandra.customer, { id: 'cust-new', name: 'Sandra Keller', initials: 'SK', email: '', phone: '+41791234567', language: 'DE' });
  assert.deepEqual([sandra.event.customerId, sandra.event.customerName, sandra.event.customerPhone], ['cust-new', 'Sandra Keller', '+41791234567']);
  // The number is optional, the language is the one chosen.
  assert.deepEqual(saved(entered('Aurélie Dubois', '', 'FR')).customer, { id: 'cust-new', name: 'Aurélie Dubois', initials: 'AD', email: '', phone: '', language: 'FR' });
  assert.equal(saved(entered('Aurélie Dubois', '', 'FR')).event.customerPhone, '');
  // Without the id of a test, each new customer gets one of their own.
  const first = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { customer: { kind: 'new', name: 'Sandra Keller', phone: '', language: 'DE' } })));
  assert.match(first.customer!.id, /^cust-[0-9a-f-]{36}$/);
  // What cannot be a name or a number is refused, in words that show what is expected.
  assert.deepEqual(entered(''), { error: 'Enter the customer’s name.', field: 'customer' });
  assert.deepEqual(entered('S'), { error: 'Enter the customer’s name: it needs at least two letters.', field: 'customer' });
  assert.match(refused(entered('Sandra Keller', 'abc')).error, /^Enter a valid mobile number, or leave the field empty\. Use digits only/);
  // The same name with the same number is the same person: no second record.
  assert.equal(saved(entered('petra  meier', '076 555 62 42')).customer, PETRA);
  // The same name alone can be somebody else: the form offers the record it knows (knownCustomerLike) and leaves the decision to the owner.
  assert.equal(saved(entered('Petra Meier')).customer?.id, 'cust-new');
  assert.equal(knownCustomerLike(demoCustomers, 'petra meier', ''), PETRA);
  assert.equal(knownCustomerLike(demoCustomers, 'Chloe Favre', '')?.id, 'cust-chloe');
  assert.equal(knownCustomerLike(demoCustomers, 'Somebody Else', '+41 76 555 62 42'), PETRA);
  assert.equal(knownCustomerLike(demoCustomers, 'Somebody Else', '079 123 45 67'), null);
  assert.equal(knownCustomerLike(demoCustomers, 'P', ''), null);
  assert.deepEqual(stillNeeded(changeDraft(salon(), opened, { customer: { kind: 'new', name: ' ', phone: '', language: 'DE' } }), view(opened)), ['the customer’s name']);
});

test('an appointment whose customer has no record keeps the name it has', () => {
  const nameOnly: CalendarEvent = { ...PAST, id: 'cal-name-only', customerId: undefined, customerPhone: undefined, customerName: 'Walk-in guest' };
  const others = demoEvents.filter((event) => event.id !== PAST_ID);
  const context = salon({ events: [nameOnly, ...others] });
  const draft = openDraft(context, demoCustomers, { kind: 'edit', appointmentId: 'cal-name-only' });
  assert.deepEqual(draft.customer, { kind: 'kept', name: 'Walk-in guest' });
  const save = saved(appointmentSave(context, demoCustomers, draft));
  assert.equal(save.customer, null);
  assert.deepEqual([save.event.customerName, save.event.customerId], ['Walk-in guest', undefined]);
  // An appointment from before customers had ids belongs to the one customer of that name.
  const legacy: CalendarEvent = { ...PAST, id: 'cal-legacy', customerId: undefined, customerName: 'petra  meier' };
  const old = salon({ events: [legacy, ...others] });
  assert.deepEqual(openDraft(old, demoCustomers, { kind: 'edit', appointmentId: 'cal-legacy' }).customer, { kind: 'existing', customerId: 'cust-001', phone: '' });
});

// ---------- what saving stores ----------

test('the message after saving says whose appointment it is and when', () => {
  const opened = openDraft(salon(), demoCustomers, { kind: 'new', customerId: PETRA.id });
  const save = saved(appointmentSave(salon(), demoCustomers, opened));
  assert.equal(savedMessage(save, { ...save.event }), 'Appointment added for Petra Meier: Wed, 07.10.2026, 10:30.');
  const edit = saved(appointmentSave(salon(), demoCustomers, openDraft(salon(), demoCustomers, { kind: 'edit', appointmentId: PAST_ID })));
  assert.equal(savedMessage(edit, { ...edit.event }), 'Appointment updated for Corinne Fischer: Sat, 03.10.2026, 12:00.');
  // Nothing in it claims that anybody was told.
  assert.doesNotMatch(savedMessage(save, { ...save.event }), /sent|told|notified|confirm|remind/i);
});

test('what the app stores for a booking by hand is in every tab of the browser, and survives being read back', () => {
  // The owner books a late Friday for somebody new. The tab writes what the app's handlers write
  // (src/App.tsx): the customer's record, the appointment, and the stylist's hours for that day.
  const browser = new BrowserStandIn();
  const clock = new ClockStandIn();
  const owner = storeFor(browser.openTab(), clock);
  const draft = steps(salon(), openDraft(salon(), demoCustomers, { kind: 'new', date: FRIDAY, employeeId: 'emp-1' }),
    { customer: { kind: 'new', name: 'Sandra Keller', phone: '079 123 45 67', language: 'DE' } }, { outsideHours: true }, { time: '19:00' }, { source: 'walk-in' });
  const save = saved(appointmentSave(salon(), demoCustomers, draft, () => 'cust-sandra'));
  const appointment: CalendarEvent = { ...save.event, id: 'cal-by-hand', customerId: save.customer!.id, customerPhone: save.customer!.phone };
  const record = customerForAppointment(owner.read('customers', demoCustomers), appointment, undefined, { record: save.customer! }).customer;
  owner.read('calendarEvents', demoEvents);
  owner.read('shifts', demoShifts);
  owner.write<Customer[]>('customers', (previous) => upsertCustomer(previous, record));
  owner.write<CalendarEvent[]>('calendarEvents', (previous) => upsertAppointment(previous, appointment));
  owner.save();

  // A second tab, opened afterwards, reads the same salon.
  const reports: string[] = [];
  const second = storeFor(browser.openTab(), clock, reports);
  const events = second.read<CalendarEvent[]>('calendarEvents', []);
  const stored = events.find((event) => event.id === 'cal-by-hand')!;
  assert.deepEqual([stored.source, stored.outsideHoursApproved, stored.customerId, stored.startTime, stored.endTime], ['walk-in', true, 'cust-sandra', '19:00', '19:30']);
  assert.deepEqual(second.read<Customer[]>('customers', [])[0], { id: 'cust-sandra', name: 'Sandra Keller', initials: 'SK', email: '', phone: '+41791234567', language: 'DE' });
  assert.equal(second.read<Customer[]>('customers', []).length, demoCustomers.length + 1);
  const shifts = second.read<ShiftEntry[]>('shifts', []);
  // Booked outside the usual hours, the appointment left Anna's working hours as they were.
  assert.deepEqual(workingTimeOn({ employees: initialEmployees, shiftOverview: shifts }, 'emp-1', FRIDAY), { start: '10:00', end: '18:30' });
  assert.deepEqual(reports, []);
  // The salon the second tab read lets the rules accept the appointment as it stands.
  const read = salon({ events, shiftOverview: shifts });
  assert.equal(validateCalendarEvent(read, stored, stored.id), null);

  // The stored shape: an appointment with or without a source, never one of another kind.
  assert.equal(storedShapeProblem('calendarEvents', events), null);
  assert.equal(storedShapeProblem('calendarEvents', demoEvents), null);
  assert.equal(storedShapeProblem('calendarEvents', [{ ...stored, source: 7 }]), 'calendarEvents[0].source is not a text');
  assert.equal(storedShapeProblem('calendarEvents', [{ ...stored, source: null }]), null);
  // A word a later build stores does not cost the owner her calendar.
  assert.equal(storedShapeProblem('calendarEvents', [{ ...stored, source: 'voicemail' }]), null);
});

test('saving twice in a row cannot book the same time twice: the second save is refused by the rules', () => {
  const opened = openDraft(salon(), demoCustomers, { kind: 'new', date: FRIDAY, time: '12:00', employeeId: 'emp-1', customerId: PETRA.id });
  const save = saved(appointmentSave(salon(), demoCustomers, opened));
  assert.equal(rulesSay(salon(), save), null);
  const after = salon({ events: upsertAppointment(demoEvents, { ...save.event, id: 'cal-first' }) });
  assert.match(rulesSay(after, save, 'cal-second')!, /^This time is not available/);
  // The form that is still open shows the time as taken once the calendar has the first appointment.
  assert.equal(appointmentFormView(after, opened).timeProblem?.text, '12:00–12:30 is not free: Anna Weber has Petra Meier at 12:00–12:30.');
});

// ---------- changes to an appointment after it was booked ----------

test('given to another customer, an appointment leaves the chat it was booked in and reads as booked by hand', () => {
  // Marie's haircut on Thursday, booked by the AI in her chat.
  const opened = openDraft(salon(), demoCustomers, { kind: 'edit', appointmentId: 'cal-2' });
  const toPetra = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { customer: { kind: 'existing', customerId: PETRA.id, phone: '' } })));
  assert.equal(toPetra.event.customerId, PETRA.id);
  assert.equal('conversationId' in toPetra.event, false);
  assert.equal(toPetra.event.isAiBooked, false);
  assert.equal(bookingSourceLabel(bookingSource({ ...toPetra.event, id: 'cal-2' })), 'Booked by hand');
  // Somebody new is another customer too.
  const toNew = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { customer: { kind: 'new', name: 'Sandra Keller', phone: '', language: 'DE' } }), () => 'cust-sandra'));
  assert.deepEqual([toNew.event.conversationId, toNew.event.isAiBooked], [undefined, false]);
  // Anything else changed, Marie's appointment stays her chat's, booked by the AI.
  const moved = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { time: '14:00' })));
  assert.deepEqual([moved.event.conversationId, moved.event.isAiBooked], ['conv-marie', true]);
  // Changed away and back to Marie in one go is no change of customer.
  const back = steps(salon(), opened, { customer: { kind: 'search', query: 'Mar' } }, { customer: { kind: 'existing', customerId: 'cust-marie', phone: '' } });
  assert.deepEqual([saved(appointmentSave(salon(), demoCustomers, back)).event.conversationId], ['conv-marie']);
});

test('a chat never leads to an appointment that has been given to another customer', () => {
  const marie = demoConversations.find((conversation) => conversation.id === 'conv-marie')!;
  const own = demoEvents.find((event) => event.id === 'cal-2')!;
  assert.equal(appointmentForConversation(marie, demoEvents), own);
  const opened = openDraft(salon(), demoCustomers, { kind: 'edit', appointmentId: 'cal-2' });
  const save = saved(appointmentSave(salon(), demoCustomers, changeDraft(salon(), opened, { customer: { kind: 'existing', customerId: PETRA.id, phone: '' } })));
  const after = upsertAppointment(demoEvents, { ...save.event, id: 'cal-2' });
  // The chat still names cal-2, but it is Petra's now: no "View appointment" from Marie's chat.
  assert.equal(marie.appointmentId, 'cal-2');
  assert.equal(appointmentForConversation(marie, after), null);
  assert.equal(belongsToConversation(after.find((event) => event.id === 'cal-2')!, marie), false);
  // Nor can a reply in Marie's chat move Petra's appointment.
  const move = { type: 'reschedule' as const, appointmentId: 'cal-2', date: FRIDAY, startTime: '12:00' };
  assert.equal(appointmentFromConversationAction(move, marie, after, initialServices, initialEmployees, false), null);
  assert.notEqual(appointmentFromConversationAction(move, marie, demoEvents, initialServices, initialEmployees, false), null);
});

const LUCAS_FRIDAY = 'cal-20261009-e3-1330'; // Friday 9 October, 13:30–14:00: Céline Hug with Luca Frei

test('an appointment on a day its stylist is away since can still be changed, as long as its day, start and stylist stay', () => {
  const away = salon({ absences: [{ id: 'away', employeeId: 'emp-3', start: FRIDAY, end: FRIDAY }] });
  const opened = openDraft(away, demoCustomers, { kind: 'edit', appointmentId: LUCAS_FRIDAY });
  assert.deepEqual(view(opened, away).times.map((option) => option.time), ['13:30']);
  assert.equal(view(opened, away).dayProblem, null);
  // Another customer, or a longer service: saved, and the rules agree.
  const toPetra = saved(appointmentSave(away, demoCustomers, changeDraft(away, opened, { customer: { kind: 'existing', customerId: PETRA.id, phone: '' } })));
  assert.equal(rulesSay(away, toPetra), null);
  const longer = saved(appointmentSave(away, demoCustomers, changeDraft(away, opened, { serviceId: 'srv-4' })));
  assert.deepEqual([longer.event.startTime, longer.event.endTime], ['13:30', '14:30']);
  assert.equal(rulesSay(away, longer), null);
  // The same with a closed date entered for that day, or other working hours.
  const closed = salon({ closedDates: [{ id: 'closed', name: 'Inventory', start: FRIDAY, end: FRIDAY }] });
  assert.equal(rulesSay(closed, saved(appointmentSave(closed, demoCustomers, changeDraft(closed, openDraft(closed, demoCustomers, { kind: 'edit', appointmentId: LUCAS_FRIDAY }), { customer: { kind: 'existing', customerId: PETRA.id, phone: '' } })))), null);
  const shorter = salon({ shiftOverview: withDayChanges(demoShifts, initialEmployees, [{ employeeId: 'emp-3', date: FRIDAY, hours: { start: '15:00', end: '18:00' } }]) });
  assert.equal(rulesSay(shorter, saved(appointmentSave(shorter, demoCustomers, changeDraft(shorter, openDraft(shorter, demoCustomers, { kind: 'edit', appointmentId: LUCAS_FRIDAY }), { serviceId: 'srv-2' })))), null);
  // A longer service still may not run into another booking: the form says what is in the way.
  const blocked = salon({ ...away, timeBlocks: [{ id: 'b', employeeId: 'emp-3', date: FRIDAY, startTime: '14:00', endTime: '15:00', reason: 'Private' }] });
  const tooLong = changeDraft(blocked, openDraft(blocked, demoCustomers, { kind: 'edit', appointmentId: LUCAS_FRIDAY }), { serviceId: 'srv-4' });
  assert.equal(view(tooLong, blocked).dayProblem?.text, 'This appointment is on Fri, 09.10.2026. Its time, 13:30–14:30, is not free for Cut & blow-dry with Luca Frei.');
  assert.equal(view(tooLong, blocked).dayProblem?.advice, 'Choose another service, or move the appointment to another day.');
  assert.equal(refused(appointmentSave(blocked, demoCustomers, tooLong)).field, 'time');
  // Another start, another stylist or another day on which he is away: the absence decides again.
  const otherTime = changeDraft(away, opened, { time: '15:00' });
  assert.equal(view(otherTime, away).chosen, null);
  const lucaAwayAgain = salon({ absences: [{ id: 'away', employeeId: 'emp-3', start: FRIDAY, end: SATURDAY }] });
  const saturday = changeDraft(lucaAwayAgain, openDraft(lucaAwayAgain, demoCustomers, { kind: 'edit', appointmentId: LUCAS_FRIDAY }), { date: SATURDAY });
  assert.equal(view(saturday, lucaAwayAgain).dayProblem?.text, 'Luca Frei is away on Sat, 10.10.2026.');
  // A new appointment with Luca on that Friday is refused as before.
  const fresh = openDraft(away, demoCustomers, { kind: 'new', date: FRIDAY, employeeId: 'emp-3', customerId: PETRA.id });
  assert.equal(view(fresh, away).dayProblem?.text, 'Luca Frei is away on Fri, 09.10.2026.');
});

test('moving a visit that has taken place says what that does to the record, and does not stop the saving', () => {
  const opened = openDraft(salon(), demoCustomers, { kind: 'edit', appointmentId: PAST_ID });
  assert.equal(view(opened).pastMoveNote, null);
  // Another service at its own time is a correction: no note.
  assert.equal(view(changeDraft(salon(), opened, { serviceId: 'srv-2' })).pastMoveNote, null);
  const friday = changeDraft(salon(), opened, { date: FRIDAY });
  assert.equal(view(friday).pastMoveNote, 'The visit on Sat, 03.10.2026 will no longer be in the calendar or in Corinne Fischer’s history.');
  assert.equal(rulesSay(salon(), saved(appointmentSave(salon(), demoCustomers, friday))), null);
  // A future appointment moves without a note.
  const future = openDraft(salon(), demoCustomers, { kind: 'edit', appointmentId: LUCAS_FRIDAY });
  assert.equal(view(changeDraft(salon(), future, { date: SATURDAY })).pastMoveNote, null);
  // One that has started today counts as a visit already.
  const running: CalendarEvent = { ...PAST, id: 'cal-running', date: TODAY, day: 'wed', dateDisplay: 'Wed 07.10.', startTime: '09:30', endTime: '10:30' };
  const today = salon({ events: [running, ...demoEvents] });
  const later = steps(today, openDraft(today, demoCustomers, { kind: 'edit', appointmentId: 'cal-running' }), { date: FRIDAY }, { time: '12:00' });
  assert.match(view(later, today).pastMoveNote ?? '', /^The visit on Wed, 07\.10\.2026 will no longer be/);
});

test('the form knows when closing it would lose something, and asks in a short question', () => {
  const opened = openDraft(salon(), demoCustomers, { kind: 'new' });
  assert.equal(draftTouched(opened, opened), false);
  // A customer typed or picked, or any field changed.
  for (const change of [
    { customer: { kind: 'search', query: 'P' } }, { customer: { kind: 'existing', customerId: PETRA.id, phone: '' } },
    { customer: { kind: 'new', name: '', phone: '079', language: 'DE' } },
    { serviceId: 'srv-2' }, { employeeId: 'emp-1' }, { date: FRIDAY }, { time: '15:00' }, { outsideHours: true }, { source: 'walk-in' },
  ] as DraftChange[]) {
    assert.equal(draftTouched(opened, changeDraft(salon(), opened, change)), true, JSON.stringify(change));
  }
  assert.equal(discardQuestion(opened), 'Discard this appointment? It is not saved yet.');
  const edit = openDraft(salon(), demoCustomers, { kind: 'edit', appointmentId: 'cal-2' });
  assert.equal(draftTouched(edit, edit), false);
  assert.equal(discardQuestion(edit), 'Discard your changes to this appointment? They are not saved yet.');
});
