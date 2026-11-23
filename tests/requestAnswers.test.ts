import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { appointmentFromRequest } from '../src/appointmentActions';
import { getAvailableSlots, validateBookingRequest, validateCalendarEvent, type AvailabilityContext } from '../src/availability';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import {
  checkRequest, chatAppointmentId, freeStartsForRequest, movedRequest, nextFreeDayForRequest, planChatBooking, requestRefusal, wordingForRule,
} from '../src/requestAnswers';
import type { AppointmentRequest, CalendarEvent, Conversation } from '../src/types';
import { demoEvents, demoRequests, demoShifts, FIXED_NOW } from './fixedClock';

// The owner's side of a booking request: whether it can be accepted as it stands, where it can
// be moved to, and what the app says when something is in the way. The moment is fixed (Monday
// 5 October 2026, 12:00 in Zurich). The first request is Petra Meier's wash and blow-dry with
// Selina Keller on Wednesday 7 October, 10:00 to 10:30; the second is Monika Hofer's haircut
// with Anna Weber on Thursday 8 October, 14:30 to 15:00.

const [wash, haircut] = demoRequests;
const salon = (partial: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours, shiftOverview: demoShifts,
  events: demoEvents, requests: demoRequests, now: FIXED_NOW, timeZone: 'Europe/Zurich', ...partial,
});
const withService = (id: string, change: Partial<(typeof initialServices)[number]>) => initialServices.map((service) => service.id === id ? { ...service, ...change } : service);
const withEmployee = (id: string, change: Partial<(typeof initialEmployees)[number]>) => initialEmployees.map((employee) => employee.id === id ? { ...employee, ...change } : employee);
const withShift = (employeeId: string, date: string, shift: { start: string; end: string } | null) =>
  demoShifts.map((entry) => entry.employeeId === employeeId ? { ...entry, shifts: { ...entry.shifts, [date]: shift } } : entry);
const appointment = (id: string, employeeId: string, date: string, startTime: string, endTime: string, customerName = 'Sandra Keller'): CalendarEvent => ({
  ...demoEvents[0], id, employeeId, staffName: initialEmployees.find((employee) => employee.id === employeeId)!.name,
  serviceId: 'srv-2', serviceName: 'Haircut', customerId: `cust-${id}`, customerName, date, startTime, endTime, prepMinutes: 0, postMinutes: 0,
});

test('the starting requests can be accepted as they stand', () => {
  for (const request of demoRequests) assert.deepEqual(checkRequest(salon(), request), { refusal: null, why: null, movable: true }, request.id);
});

test('a request stays acceptable after the owner changed the service, the stylist\'s visibility or the booking page', () => {
  // The service got another length: the customer asked for 10:00 to 10:30 and keeps exactly that.
  const longer = salon({ services: withService('srv-1', { durationMinutes: 45 }) });
  assert.match(validateBookingRequest(longer, wash, wash.id)!, /This service needs 45 minutes/); // what the booking page's rule says
  assert.equal(requestRefusal(longer, wash), null);
  const accepted = appointmentFromRequest(wash, longer.services, longer.employees);
  assert.deepEqual([accepted.startTime, accepted.endTime], ['10:00', '10:30']);
  // The service is no longer offered online, or the stylist is hidden from the booking page: the
  // owner may accept all the same. Only customers are kept from booking it themselves.
  const offline = salon({ services: withService('srv-1', { onlineBooking: false }) });
  assert.match(validateBookingRequest(offline, wash, wash.id)!, /not available for online booking/);
  assert.equal(requestRefusal(offline, wash), null);
  for (const change of [{ hidden: true }, { canBookOnline: false }]) {
    const hidden = salon({ employees: withEmployee('emp-2', change) });
    assert.match(validateBookingRequest(hidden, wash, wash.id)!, /not available for online booking/);
    assert.equal(requestRefusal(hidden, wash), null, JSON.stringify(change));
  }
  // A shift that was changed but still covers the time.
  assert.equal(requestRefusal(salon({ shiftOverview: withShift('emp-2', wash.date, { start: '09:30', end: '12:00' }) }), wash), null);
});

test('a refusal says what is in the way and what the owner can do', () => {
  const refusal = (partial: Partial<AvailabilityContext>, request = wash) => requestRefusal(salon(partial), request);
  // The four things that change under a request: the shift, the day, the stylist, the calendar.
  assert.equal(refusal({ shiftOverview: withShift('emp-2', wash.date, { start: '13:00', end: '14:00' }) }),
    'Selina Keller works 13:00–14:00 on Wed, 07.10.2026, not at 10:00–10:30. Suggest another time, or decline.');
  assert.equal(refusal({ shiftOverview: withShift('emp-2', wash.date, null) }),
    'Selina Keller does not work on Wed, 07.10.2026. Suggest another day, give Selina Keller working hours for that day in Team, or decline.');
  assert.equal(refusal({ closedDates: [{ id: 'c-1', name: 'Team day', start: '2026-10-07', end: '2026-10-07' }] }),
    'The salon is closed on Wed, 07.10.2026 (Team day). Suggest another day, or decline.');
  assert.equal(refusal({ absences: [{ id: 'a-1', employeeId: 'emp-2', start: '2026-10-06', end: '2026-10-09' }] }),
    'Selina Keller is away on Wed, 07.10.2026. Suggest another day, or decline.');
  assert.equal(refusal({ bookingHours: initialBookingHours.map((day) => day.day === 'Wednesday' ? { ...day, isOpen: false } : day) }),
    'The salon is closed on Wednesdays. Suggest another day, or decline.');
  assert.equal(refusal({ bookingHours: initialBookingHours.map((day) => day.day === 'Wednesday' ? { ...day, from: '10:30' } : day) }),
    'The salon is open 10:30–18:30 on Wed, 07.10.2026, not at 10:00–10:30. Suggest another time, or decline.');
  // Somebody else has the time: the appointment is named, and so is a second request for it.
  assert.equal(refusal({ events: [appointment('cal-x', 'emp-2', wash.date, '10:00', '11:00'), ...demoEvents] }),
    'Selina Keller already has Sandra Keller at 10:00–11:00 on Wed, 07.10.2026. Suggest another time, or decline.');
  const rival: AppointmentRequest = { ...wash, id: 'req-rival', customerId: 'cust-rival', customerName: 'Tobias Wenger', timeStr: '09:30 - 10:30' };
  assert.equal(refusal({ requests: [rival, ...demoRequests] }),
    'Tobias Wenger has asked Selina Keller for 09:30–10:30 on Wed, 07.10.2026 as well. Suggest another time, or decline.');
  // The time a neighbouring booking needs before or after it: no single booking overlaps, so the sentence stays general.
  assert.equal(refusal({ events: [{ ...appointment('cal-x', 'emp-2', wash.date, '09:00', '10:00'), postMinutes: 15 }, ...demoEvents] }),
    '10:00–10:30 on Wed, 07.10.2026 is not free for Selina Keller. Suggest another time, or decline.');
  // The request never stands in its own way, and neither does the appointment it becomes.
  assert.equal(refusal({ events: [appointmentFromRequest(wash, initialServices, initialEmployees), ...demoEvents] }), null);
});

test('when no other time would help, the card says so and offers no "Suggest another time"', () => {
  const check = (partial: Partial<AvailabilityContext>) => checkRequest(salon(partial), wash);
  assert.deepEqual(check({ employees: withEmployee('emp-2', { status: 'Inactive' }) }), {
    refusal: 'Selina Keller is set to inactive. Set Selina Keller to active in Team, or decline.',
    why: 'Selina Keller is set to inactive.', movable: false,
  });
  assert.deepEqual(check({ services: withService('srv-1', { assignedEmployeeIds: ['emp-1'] }) }), {
    refusal: 'Selina Keller does not offer Wash & blow-dry. Assign Selina Keller to it in Services, or decline.',
    why: 'Selina Keller does not offer Wash & blow-dry.', movable: false,
  });
  assert.deepEqual(check({ services: initialServices.filter((service) => service.id !== 'srv-1') }), {
    refusal: 'Wash & blow-dry is no longer one of your services. Add the appointment by hand in the calendar, or decline.',
    why: 'Wash & blow-dry is no longer one of your services.', movable: false,
  });
  assert.deepEqual(check({ employees: initialEmployees.filter((employee) => employee.id !== 'emp-2') }), {
    refusal: 'Selina Keller is no longer in your team. Add the appointment by hand with someone else, or decline.',
    why: 'Selina Keller is no longer in your team.', movable: false,
  });
  // A request stored long ago that names no stylist at all.
  assert.deepEqual(checkRequest(salon(), { ...wash, employeeId: undefined, staffName: undefined }), {
    refusal: 'This request names no stylist. Add the appointment by hand in the calendar, or decline.',
    why: 'This request names no stylist.', movable: false,
  });
  // Everything else can be solved by another time.
  assert.equal(check({ shiftOverview: withShift('emp-2', wash.date, null) }).movable, true);
});

test('a request whose time has passed says so, at the minute it starts as well', () => {
  const at = (moment: string) => requestRefusal(salon({ now: new Date(moment) }), wash);
  const passed = 'This time has passed. Suggest another time, or decline.';
  assert.equal(at('2026-10-07T07:59:00Z'), null); // 09:59 in Zurich
  assert.equal(at('2026-10-07T08:00:30Z'), passed); // 10:00 and half a minute: the rules give no slot that has begun
  assert.equal(at('2026-10-07T08:01:00Z'), passed);
  assert.equal(at('2026-10-09T10:00:00Z'), passed);
  assert.equal(requestRefusal(salon(), { ...wash, timeStr: 'in the morning' }), 'This request has no valid time. Suggest another time, or decline.');
});

test('every refusal of the slot rules has words for the owner', () => {
  // The rules' own texts, read from their source: a new refusal there must get a wording here.
  const rules = readFileSync(new URL('../src/availability.ts', import.meta.url), 'utf8');
  const upTo = rules.indexOf('/** Find the earliest available date');
  assert.ok(upTo > 0);
  const all = [...rules.slice(0, upTo).matchAll(/(?:unavailable\(|return )'((?:[^'\\]|\\.)+)'/g)].map((match) => match[1])
    .filter((refusal) => /[.]$/.test(refusal));
  // Two refusals belong to the booking page alone. The owner's answer never meets them: that is
  // the point of answering under the owner's rules (see the test above).
  const onlineOnly = all.filter((refusal) => /online booking/.test(refusal));
  assert.deepEqual(onlineOnly, ['This service is not available for online booking.', 'This employee is not available for online booking.']);
  const refusals = all.filter((refusal) => !onlineOnly.includes(refusal));
  assert.ok(refusals.length >= 18, `found ${refusals.length} refusals`);
  assert.ok(refusals.includes('This employee does not work on this date.'));
  const facts = { context: salon(), employee: initialEmployees[1], staff: 'Selina Keller', service: 'Wash & blow-dry', date: wash.date, start: '10:00', end: '10:30' };
  for (const refusal of [...refusals, 'Choose a valid 30-minute slot on the same day.']) {
    const wording = wordingForRule(refusal, facts);
    assert.ok(wording, `no wording for: ${refusal}`);
    assert.notEqual(wording, refusal);
    // The owner is told what to do with the request or where to change something: never to "choose" in a form that is not there.
    assert.match(wording, /(Suggest another (time|day)|decline|in Team|in Services|in Settings|in the calendar)/, refusal);
    // One set of words for every request: nothing speaks of accepting, moving or rejecting any more.
    assert.doesNotMatch(wording, /\b(accept|move the request|reject)/i, refusal);
    assert.doesNotMatch(wording, /^Choose|Please choose|this employee|This employee/, refusal);
  }
  assert.equal(wordingForRule('A refusal nobody has written yet.', facts), null);
});

test('a request is moved under the owner\'s rules and keeps its length', () => {
  // Wednesday with Selina Keller: every free half hour of her shift, the request's own time included.
  const free = freeStartsForRequest(salon(), wash, wash.date);
  assert.ok(free.includes('10:00') && free.includes('10:30'));
  assert.deepEqual(free, getAvailableSlots({ ...salon(), requests: [haircut] }, { date: wash.date, serviceId: 'srv-1', employeeId: 'emp-2', mode: 'owner' }));
  // The service now lasts 45 minutes and is offline: the request still moves in its own 30 minutes.
  const changed = salon({ services: withService('srv-1', { durationMinutes: 45, onlineBooking: false }) });
  assert.deepEqual(freeStartsForRequest(changed, wash, wash.date), free);
  const moved = movedRequest(wash, '2026-10-08', '12:00');
  assert.deepEqual([moved.date, moved.dateStr, moved.timeStr], ['2026-10-08', 'Thu, 08.10.2026', '12:00 - 12:30']);
  assert.equal(requestRefusal(changed, moved), null);
  // A time that another booking has is not offered, and moving there is refused with its reason.
  assert.ok(!free.includes('11:30'));
  assert.match(requestRefusal(salon(), movedRequest(wash, wash.date, '11:30'))!, /^Selina Keller already has Valentina Colombo at 11:30–13:00 on Wed, 07\.10\.2026\./);
  // Nothing is offered on a day she does not work; the next day with a free time is found from there.
  assert.deepEqual(freeStartsForRequest(salon(), wash, '2026-10-06'), []);
  assert.equal(nextFreeDayForRequest(salon(), wash, '2026-10-06'), '2026-10-07');
  // Somebody without working hours has no free day at all: nothing falls back to the opening hours.
  assert.equal(nextFreeDayForRequest(salon({ employees: withEmployee('emp-2', { weeklyHours: undefined }) }), wash, '2026-10-06'), null);
  // A request without its service or its stylist cannot be moved anywhere.
  assert.deepEqual(freeStartsForRequest(salon({ employees: [] }), wash, wash.date), []);
});

// ---------- booking requests that wait in a chat ----------

const chat = (booking: Partial<NonNullable<Conversation['bookingRequest']>> = {}): Pick<Conversation, 'id' | 'bookingRequest'> => ({
  id: 'live-web-tom',
  bookingRequest: { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-08', time: '15:00', customerName: 'Tom', status: 'requested', ...booking },
});
const emptyCalendar = (partial: Partial<AvailabilityContext> = {}) => salon({ events: [], requests: [], ...partial });

test('a chat\'s booking request goes to the first stylist who offers the service and is free', () => {
  const plan = planChatBooking(emptyCalendar(), chat())!;
  assert.equal(plan.refusal, null);
  assert.deepEqual([plan.serviceName, plan.employee?.name, plan.endTime], ['Haircut', 'Anna Weber', '15:30']);
  assert.deepEqual(plan.action, {
    type: 'book', appointmentId: 'live-appt-live-web-tom-2026-10-08-1500', date: '2026-10-08', startTime: '15:00', serviceId: 'srv-2', employeeId: 'emp-1',
  });
  assert.equal(plan.action?.appointmentId, chatAppointmentId('live-web-tom', { date: '2026-10-08', time: '15:00' }));
  // Anna is taken: the next one who is free. A second try on the same request finds its own appointment and keeps the stylist.
  const annaBusy = [appointment('cal-a', 'emp-1', '2026-10-08', '14:30', '15:30')];
  assert.equal(planChatBooking(emptyCalendar({ events: annaBusy }), chat())!.employee?.name, 'Selina Keller');
  const booked = { ...appointment(plan.action!.appointmentId, 'emp-1', '2026-10-08', '15:00', '15:30'), customerName: 'Tom' };
  assert.equal(planChatBooking(emptyCalendar({ events: [booked] }), chat())!.employee?.name, 'Anna Weber');
  // What the plan books passes the rules every booking of the owner passes.
  assert.equal(validateCalendarEvent(emptyCalendar(), { ...booked, staffName: 'Anna Weber' }, booked.id), null);
  // A chat stored before services had ids names the service only.
  assert.equal(planChatBooking(emptyCalendar(), chat({ serviceId: undefined, service: ' haircut ' }))!.serviceName, 'Haircut');
  // No waiting request: nothing to plan.
  assert.equal(planChatBooking(emptyCalendar(), chat({ status: 'confirmed' })), null);
  assert.equal(planChatBooking(emptyCalendar(), { id: 'live-web-tom' }), null);
});

test('a chat\'s booking request that cannot be booked says why, and offers another time or declining', () => {
  const refusal = (partial: Partial<AvailabilityContext>, booking: Parameters<typeof chat>[0] = {}) => {
    const plan = planChatBooking(emptyCalendar(partial), chat(booking))!;
    assert.equal(plan.action, null);
    assert.equal(plan.employee, null);
    return plan.refusal;
  };
  // Thursday 15:00: Anna and Selina are taken, Luca does not work on Thursdays.
  const bothBusy = [appointment('cal-a', 'emp-1', '2026-10-08', '14:30', '15:30'), appointment('cal-s', 'emp-2', '2026-10-08', '15:00', '15:30')];
  assert.equal(refusal({ events: bothBusy }), 'Nobody who offers Haircut is free on Thu, 08.10.2026 at 15:00–15:30. Suggest another time, or decline.');
  // Reasons that hold for the whole salon are named.
  assert.equal(refusal({ closedDates: [{ id: 'c-1', name: 'Team day', start: '2026-10-08', end: '2026-10-08' }] }),
    'The salon is closed on Thu, 08.10.2026 (Team day). Suggest another day, or decline.');
  assert.equal(refusal({ bookingHours: initialBookingHours.map((day) => day.day === 'Thursday' ? { ...day, isOpen: false } : day) }),
    'The salon is closed on Thursdays. Suggest another day, or decline.');
  assert.equal(refusal({}, { date: '2026-10-03' }), 'This time has passed. Suggest another time, or decline.');
  assert.equal(refusal({ now: new Date('2026-10-08T13:00:20Z') }), 'This time has passed. Suggest another time, or decline.');
  // The service is gone, or nobody offers it: another time would not help, so none is offered.
  assert.equal(refusal({}, { serviceId: 'srv-gone', service: 'Perm' }),
    '"Perm" is no longer one of your services. Add the appointment by hand in the calendar, or decline.');
  assert.equal(planChatBooking(emptyCalendar(), chat({ serviceId: 'srv-gone', service: 'Perm' }))!.movable, false);
  assert.equal(refusal({ services: withService('srv-2', { assignedEmployeeIds: [] }) }),
    'Nobody in your team offers Haircut. Assign someone to it in Services, or decline.');
  assert.equal(planChatBooking(emptyCalendar({ events: bothBusy }), chat())!.movable, true);
});

test('a moved request remembers the time the customer asked for, however often it is moved', () => {
  const asked = { date: wash.date, timeStr: wash.timeStr };
  const once = movedRequest(wash, '2026-10-09', '10:00');
  assert.deepEqual(once.movedFrom, asked);
  // Moved again: still the customer's own time, not the salon's first suggestion.
  const twice = movedRequest(once, '2026-10-10', '09:00');
  assert.deepEqual(twice.movedFrom, asked);
  assert.equal(twice.date, '2026-10-10');
  // Back at the time asked for: nothing is moved any more.
  const back = movedRequest(twice, asked.date, asked.timeStr.slice(0, 5));
  assert.equal(back.movedFrom, undefined);
  assert.equal('movedFrom' in back, false);
  assert.equal(back.timeStr, wash.timeStr);
});
