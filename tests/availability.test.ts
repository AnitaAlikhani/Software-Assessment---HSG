import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAvailableSlots,
  getNextAvailableDate,
  getSalonNow,
  isBookableEmployee,
  isEmployeeAssignedToService,
  validateBookingRequest,
  validateCalendarEvent,
  type AvailabilityContext,
} from '../src/availability.ts';
import type { AppointmentRequest, CalendarEvent, Employee, ServiceItem } from '../src/types.ts';
import { createDemoShifts } from '../src/demoSeed.ts';
import { initialBookingHours, initialEmployees } from '../src/mockData.ts';
import { addDays } from '../src/scheduling.ts';
import { workingTimeOn } from '../src/workingHours.ts';

const DATE = '2026-10-08';
const employee = (id = 'emp-1', name = 'Alex'): Employee => ({
  id, name, firstName: name, lastName: '', initials: name[0], email: '', phone: '',
  status: 'Active', location: 'Salon', canBookOnline: true, hidden: false,
});
const service = (partial: Partial<ServiceItem> = {}): ServiceItem => ({
  id: 'haircut', name: 'Haircut', durationMinutes: 30, priceCHF: 50,
  onlineBooking: true, assignedEmployeesCount: 2, assignedEmployeeIds: ['emp-1', 'emp-2'], ...partial,
});
const context = (): AvailabilityContext => ({
  employees: [employee(), employee('emp-2', 'Sam')],
  services: [service(), service({ id: 'colour', name: 'Colouring', durationMinutes: 90 })],
  bookingHours: [{ day: 'Thursday', isOpen: true, from: '09:00', to: '18:00' }],
  shiftOverview: [
    { employeeId: 'emp-1', employeeName: 'Alex', initials: 'A', avatarColor: '', shifts: { [DATE]: { start: '09:00', end: '18:00' } } },
    { employeeId: 'emp-2', employeeName: 'Sam', initials: 'S', avatarColor: '', shifts: { [DATE]: { start: '09:00', end: '18:00' } } },
  ],
  events: [], requests: [],
  now: new Date('2026-10-01T00:00:00Z'), timeZone: 'Europe/Zurich',
});
const selection = (partial = {}) => ({ date: DATE, serviceId: 'haircut', employeeId: 'emp-1', ...partial });
const event = (partial: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'event-1', customerName: 'Customer', serviceName: 'Haircut', serviceId: 'haircut',
  staffName: 'Alex', employeeId: 'emp-1', date: DATE, day: 'thu', dateDisplay: 'Thu 08/10',
  startTime: '10:00', endTime: '10:30', colorTheme: 'blue', ...partial,
});
const request = (partial: Partial<AppointmentRequest> = {}): AppointmentRequest => ({
  id: 'request-1', customerName: 'Customer', serviceName: 'Haircut', serviceId: 'haircut',
  staffName: 'Alex', employeeId: 'emp-1', date: DATE, dateStr: '8 October 2026',
  timeStr: '10:00 - 10:30', timeAgo: 'Now', status: 'pending', ...partial,
});

test('slots intersect salon hours and the dated employee shift on half-hour boundaries', () => {
  const c = context();
  c.bookingHours[0] = { day: 'Thursday', isOpen: true, from: '09:15', to: '17:45' };
  c.shiftOverview[0].shifts[DATE] = { start: '10:10', end: '16:20' };
  const slots = getAvailableSlots(c, selection());
  assert.equal(slots[0], '10:30');
  assert.equal(slots.at(-1), '15:30');
  assert.ok(!slots.includes('10:00'));
  assert.ok(!slots.includes('16:00'));
});

test('full service duration fits, including the last 90-minute appointment', () => {
  const c = context();
  const slots = getAvailableSlots(c, selection({ serviceId: 'colour' }));
  assert.ok(slots.includes('16:00'));
  assert.ok(slots.includes('16:30'));
  assert.ok(!slots.includes('17:00'));
  assert.equal(validateBookingRequest(c, request({ serviceId: 'colour', serviceName: 'Colouring', timeStr: '16:00 - 17:30' })), null);
  assert.match(validateBookingRequest(c, request({ serviceId: 'colour', serviceName: 'Colouring', timeStr: '16:00 - 16:30' }))!, /90 minutes/);
});

test('existing appointments block overlaps but allow endpoints to touch', () => {
  const c = context();
  c.events = [event({ startTime: '10:00', endTime: '11:00' })];
  const slots = getAvailableSlots(c, selection());
  assert.ok(slots.includes('09:30'));
  assert.ok(!slots.includes('10:00'));
  assert.ok(!slots.includes('10:30'));
  assert.ok(slots.includes('11:00'));
  assert.ok(!getAvailableSlots(c, selection({ serviceId: 'colour' })).includes('09:00'));
});

test('events for other employees and dates never reserve this employee', () => {
  const c = context();
  c.events = [event({ employeeId: 'emp-2', staffName: 'Sam' }), event({ id: 'other-date', date: '2026-10-15' })];
  assert.ok(getAvailableSlots(c, selection()).includes('10:00'));
});

test('pending requests hold slots, self-exclusion enables acceptance and moving', () => {
  const c = context();
  c.requests = [request()];
  assert.ok(!getAvailableSlots(c, selection()).includes('10:00'));
  assert.ok(getAvailableSlots(c, selection({ excludeRequestId: 'request-1' })).includes('10:00'));
  assert.equal(validateBookingRequest(c, c.requests[0], 'request-1'), null);
  assert.match(validateBookingRequest(c, c.requests[0])!, /no longer available/);
  c.requests.push(request({ id: 'request-2', timeStr: '11:00 - 11:30' }));
  assert.match(validateBookingRequest(c, { ...c.requests[0], timeStr: '11:00 - 11:30' }, 'request-1')!, /no longer available/);
});

test('other employee/date and non-pending requests do not hold capacity', () => {
  const c = context();
  c.requests = [
    request({ id: 'other-person', employeeId: 'emp-2', staffName: 'Sam' }),
    request({ id: 'other-day', date: '2026-10-15' }),
    request({ id: 'rejected', status: 'rejected' }),
    request({ id: 'accepted', status: 'accepted' }),
    request({ id: 'cancelled', status: 'cancelled' }),
  ];
  assert.ok(getAvailableSlots(c, selection()).includes('10:00'));
});

test('missing/null shifts never fall back to salon hours', () => {
  for (const mode of ['missing-date', 'null-date', 'missing-employee'] as const) {
    const c = context();
    if (mode === 'missing-date') delete c.shiftOverview[0].shifts[DATE];
    if (mode === 'null-date') c.shiftOverview[0].shifts[DATE] = null;
    if (mode === 'missing-employee') c.shiftOverview = [];
    assert.deepEqual(getAvailableSlots(c, selection()), []);
    assert.match(validateBookingRequest(c, request())!, /does not work/);
  }
});

test('closed, missing or invalid salon hours and non-overlapping shifts have no slots', () => {
  for (const mode of ['closed', 'missing', 'invalid', 'outside'] as const) {
    const c = context();
    if (mode === 'closed') c.bookingHours[0].isOpen = false;
    if (mode === 'missing') c.bookingHours = [];
    if (mode === 'invalid') c.bookingHours[0].from = '18:00';
    if (mode === 'outside') c.shiftOverview[0].shifts[DATE] = { start: '18:00', end: '20:00' };
    assert.deepEqual(getAvailableSlots(c, selection()), []);
    assert.notEqual(validateBookingRequest(c, request()), null);
  }
});

test('only active, visible employees enabled for online booking are eligible', () => {
  assert.equal(isBookableEmployee(employee()), true);
  for (const changes of [{ hidden: true }, { canBookOnline: false }, { status: 'Inactive' as const }]) {
    const c = context();
    Object.assign(c.employees[0], changes);
    assert.equal(isBookableEmployee(c.employees[0]), false);
    assert.deepEqual(getAvailableSlots(c, selection()), []);
    assert.match(validateBookingRequest(c, request())!, /employee is not available/);
  }
  assert.deepEqual(getAvailableSlots(context(), selection({ employeeId: 'deleted' })), []);
});

test('disabled/deleted services cannot be booked even when their old name matches', () => {
  const c = context();
  c.services[0].onlineBooking = false;
  assert.deepEqual(getAvailableSlots(c, selection()), []);
  assert.match(validateBookingRequest(c, request())!, /not available/);
  assert.deepEqual(getAvailableSlots(c, selection({ serviceId: 'deleted' })), []);
  assert.match(validateBookingRequest(context(), request({ serviceId: 'deleted' }))!, /no longer exists/);
});

test('stable IDs override names; records without IDs retain legacy name support', () => {
  const c = context();
  c.events = [event({ staffName: 'Old name' })];
  assert.ok(!getAvailableSlots(c, selection()).includes('10:00'));
  c.events = [event({ employeeId: 'emp-2', staffName: 'Alex' })];
  assert.ok(getAvailableSlots(c, selection()).includes('10:00'));
  c.events = [event({ employeeId: undefined })];
  assert.ok(!getAvailableSlots(c, selection()).includes('10:00'));
  c.events = [];
  assert.equal(validateBookingRequest(c, request({ employeeId: undefined, serviceId: undefined })), null);
  assert.notEqual(validateBookingRequest(c, request({ employeeId: 'deleted' })), null);
});

test('service preparation and cleanup fit shifts and protect occupied buffers', () => {
  const c = context();
  c.services[0].prepMinutes = 15;
  c.services[0].postMinutes = 15;
  c.events = [event({ startTime: '10:00', endTime: '10:30' })];
  const slots = getAvailableSlots(c, selection());
  assert.ok(!slots.includes('09:00')); // Preparation would begin before opening.
  assert.ok(!slots.includes('09:30')); // Cleanup overlaps the existing preparation.
  assert.ok(!slots.includes('10:30')); // Preparation overlaps the existing cleanup.
  assert.ok(slots.includes('11:00')); // Occupied buffers touch at 10:45.
  assert.ok(!slots.includes('17:30')); // Cleanup would finish after closing.
  assert.ok(slots.includes('17:00'));
});

test('invalid dates, times and durations fail closed without overnight wrapping', () => {
  const c = context();
  for (const date of ['2026-02-30', 'not-a-date', '2026-2-03']) {
    assert.deepEqual(getAvailableSlots(c, selection({ date })), []);
  }
  for (const durationMinutes of [0, -30, 30.5, Number.NaN, Number.POSITIVE_INFINITY, 1440]) {
    const invalid = context();
    invalid.services[0].durationMinutes = durationMinutes;
    assert.deepEqual(getAvailableSlots(invalid, selection()), []);
  }
  for (const prepMinutes of [-1, Number.NaN]) {
    const invalid = context();
    invalid.services[0].prepMinutes = prepMinutes;
    assert.deepEqual(getAvailableSlots(invalid, selection()), []);
  }
  c.shiftOverview[0].shifts[DATE] = { start: '22:00', end: '02:00' };
  assert.deepEqual(getAvailableSlots(c, selection()), []);
  c.shiftOverview[0].shifts[DATE] = { start: '09:60', end: '18:00' };
  assert.deepEqual(getAvailableSlots(c, selection()), []);
  assert.notEqual(validateBookingRequest(context(), request({ timeStr: '23:30 - 00:00' })), null);
  assert.notEqual(validateBookingRequest(context(), request({ timeStr: '10:15 - 10:45' })), null);
});

test('malformed conflicting appointments or pending holds do not expose unsafe slots', () => {
  const c = context();
  c.events = [event({ endTime: '09:00' })];
  assert.deepEqual(getAvailableSlots(c, selection()), []);
  assert.match(validateBookingRequest(c, request())!, /appointment with invalid times/);
  c.events = [];
  c.requests = [request({ timeStr: 'bad' })];
  assert.deepEqual(getAvailableSlots(c, selection()), []);
  assert.match(validateBookingRequest(c, request({ id: 'new' }))!, /pending request with invalid times/);
});

test('deleting an old event service does not remove the event occupancy', () => {
  const c = context();
  c.events = [event({ serviceId: 'deleted-service', serviceName: 'Deleted service' })];
  assert.ok(!getAvailableSlots(c, selection()).includes('10:00'));
  assert.ok(getAvailableSlots(c, selection()).includes('10:30'));
});

test('past dates are rejected against the salon date, even near UTC midnight', () => {
  const c = context();
  c.now = new Date('2026-10-08T22:30:00Z'); // Already Friday in Zurich.
  assert.deepEqual(getSalonNow(c.timeZone, c.now), { date: '2026-10-09', time: '00:30' });
  assert.deepEqual(getAvailableSlots(c, selection()), []);
  assert.match(validateBookingRequest(c, request())!, /today or a future/);
  c.timeZone = 'America/New_York';
  assert.deepEqual(getSalonNow(c.timeZone, c.now), { date: DATE, time: '18:30' });
});

test('same-day availability excludes elapsed starts and elapsed preparation time', () => {
  const c = context();
  c.now = new Date('2026-10-08T08:00:00Z'); // 10:00 local.
  assert.ok(!getAvailableSlots(c, selection()).includes('09:30'));
  assert.ok(getAvailableSlots(c, selection()).includes('10:00'));
  c.now = new Date('2026-10-08T08:00:01Z');
  assert.ok(!getAvailableSlots(c, selection()).includes('10:00'));
  assert.match(validateBookingRequest(c, request())!, /no longer available/);
  c.services[0].prepMinutes = 15;
  c.now = new Date('2026-10-08T08:20:00Z');
  assert.ok(!getAvailableSlots(c, selection()).includes('10:30'));
  assert.ok(getAvailableSlots(c, selection()).includes('11:00'));
  c.now = new Date('2026-10-08T16:00:00Z');
  assert.deepEqual(getAvailableSlots(c, selection()), []);
});

test('an appointment that is being changed keeps its own day and start after they have passed, and nothing more', () => {
  // A week after the appointment (Thursday 8 October, 10:00 with Alex): the owner corrects it.
  const c = context();
  c.now = new Date('2026-10-15T09:00:00Z');
  c.events = [event()];
  const own = { mode: 'owner' as const, excludeEventId: 'event-1' };
  // Its own start is the one time of that day; no other time in the past opens.
  assert.deepEqual(getAvailableSlots(c, selection(own)), ['10:00']);
  assert.equal(validateCalendarEvent(c, event(), 'event-1'), null);
  assert.match(validateCalendarEvent(c, event({ startTime: '11:00', endTime: '11:30' }), 'event-1')!, /not available/);
  // Another service or another stylist at the same start: corrected afterwards.
  assert.deepEqual(getAvailableSlots(c, selection({ ...own, serviceId: 'colour' })), ['10:00']);
  assert.equal(validateCalendarEvent(c, event({ serviceId: 'colour', serviceName: 'Colouring', endTime: '11:30' }), 'event-1'), null);
  assert.deepEqual(getAvailableSlots(c, selection({ ...own, employeeId: 'emp-2' })), ['10:00']);
  assert.equal(validateCalendarEvent(c, event({ employeeId: 'emp-2', staffName: 'Sam' }), 'event-1'), null);
  // Another customer's name is no question for the slot rules at all.
  assert.equal(validateCalendarEvent(c, event({ customerName: 'Somebody else' }), 'event-1'), null);

  // Without naming the appointment, the past stays closed: for a new appointment, and for the booking page.
  assert.deepEqual(getAvailableSlots(c, selection({ mode: 'owner' })), []);
  assert.equal(validateCalendarEvent(c, event()), 'Choose today or a future appointment date.');
  assert.equal(validateCalendarEvent(c, event(), 'event-new'), 'Choose today or a future appointment date.');
  assert.deepEqual(getAvailableSlots(c, selection({ excludeEventId: 'event-1' })), []); // the customers' rules
  assert.match(validateBookingRequest(c, request())!, /today or a future/);
  // Another day in the past is not its own day, and another appointment's day is not its own either.
  assert.deepEqual(getAvailableSlots(c, selection({ ...own, date: '2026-10-07' })), []);
  assert.equal(validateCalendarEvent(c, event({ date: '2026-10-07', day: 'wed' }), 'event-1'), 'Choose today or a future appointment date.');
  c.events.push(event({ id: 'event-2', date: '2026-10-01', startTime: '14:00', endTime: '14:30' }));
  assert.equal(validateCalendarEvent(c, event({ date: '2026-10-01', startTime: '14:00', endTime: '14:30' }), 'event-1'), 'Choose today or a future appointment date.');
  c.events.pop();

  // Every other rule still decides about that one start.
  c.events.push(event({ id: 'neighbour', startTime: '10:30', endTime: '11:00' }));
  assert.deepEqual(getAvailableSlots(c, selection({ ...own, serviceId: 'colour' })), []); // would run into the next customer
  assert.match(validateCalendarEvent(c, event({ serviceId: 'colour', serviceName: 'Colouring', endTime: '11:30' }), 'event-1')!, /not available/);
  assert.deepEqual(getAvailableSlots(c, selection(own)), ['10:00']);
  c.events.pop();
  c.events.push(event({ id: 'sams', employeeId: 'emp-2', staffName: 'Sam' }));
  assert.deepEqual(getAvailableSlots(c, selection({ ...own, employeeId: 'emp-2' })), []); // Sam had somebody then
  c.events.pop();
  c.shiftOverview[1].shifts[DATE] = { start: '12:00', end: '18:00' };
  assert.deepEqual(getAvailableSlots(c, selection({ ...own, employeeId: 'emp-2' })), []); // Sam started at noon
  c.shiftOverview[1].shifts[DATE] = null;
  assert.match(validateCalendarEvent(c, event({ employeeId: 'emp-2', staffName: 'Sam' }), 'event-1')!, /does not work/);
  // A closed date or an absence entered afterwards keeps the appointment in its place with its
  // own stylist (see the test below), but it is no way onto that day for another stylist.
  c.closedDates = [{ id: 'closure', name: 'Holiday', start: DATE, end: DATE }];
  assert.equal(validateCalendarEvent(c, event(), 'event-1'), null);
  c.shiftOverview[1].shifts[DATE] = { start: '08:00', end: '18:00' };
  assert.match(validateCalendarEvent(c, event({ employeeId: 'emp-2', staffName: 'Sam' }), 'event-1')!, /salon is closed/);
  c.closedDates = [];
  c.absences = [{ id: 'absence', employeeId: 'emp-2', start: DATE, end: DATE }];
  assert.match(validateCalendarEvent(c, event({ employeeId: 'emp-2', staffName: 'Sam' }), 'event-1')!, /employee is away/);
  c.absences = [];
  c.employees[0].status = 'Inactive';
  assert.match(validateCalendarEvent(c, event(), 'event-1')!, /active employee/);
});

test('an appointment that has started today keeps its start among the times still to come', () => {
  const c = context();
  c.now = new Date('2026-10-08T08:20:00Z'); // 10:20 on the day: the 10:00 appointment is running
  c.events = [event()];
  const own = { mode: 'owner' as const, excludeEventId: 'event-1' };
  const slots = getAvailableSlots(c, selection(own));
  assert.equal(slots[0], '10:00');
  assert.equal(slots[1], '10:30');
  assert.ok(!slots.includes('09:30'));
  assert.equal(validateCalendarEvent(c, event(), 'event-1'), null);
  assert.match(validateCalendarEvent(c, event({ startTime: '09:30', endTime: '10:00' }), 'event-1')!, /not available/);
  // For anybody else the time has passed, as before.
  assert.ok(!getAvailableSlots(c, selection({ mode: 'owner' })).includes('10:00'));
  assert.match(validateCalendarEvent(c, event({ id: 'other' }), 'other')!, /not available/);
  // Preparation time that has begun does not stand in the way of its own start either.
  c.services[0].prepMinutes = 15;
  assert.equal(getAvailableSlots(c, selection(own))[0], '10:00');
  // An appointment still to come gains nothing: its start is free because it is its own, like before.
  c.now = new Date('2026-10-01T00:00:00Z');
  c.services[0].prepMinutes = 0;
  assert.deepEqual(getAvailableSlots(c, selection(own)), getAvailableSlots({ ...c, events: [] }, selection({ mode: 'owner' })));
});

test('salon clock uses daylight savings, IANA zones and legacy zone labels', () => {
  assert.deepEqual(getSalonNow('Europe/Zurich', new Date('2026-10-25T00:30:00Z')), { date: '2026-10-25', time: '02:30' });
  assert.deepEqual(getSalonNow('Europe/Zurich', new Date('2026-10-25T01:30:00Z')), { date: '2026-10-25', time: '02:30' });
  assert.deepEqual(getSalonNow('Europe/Zurich (GMT+01:00)', new Date('2026-07-01T22:30:00Z')), { date: '2026-07-02', time: '00:30' });
  assert.deepEqual(getSalonNow('Asia/Singapore', new Date('2026-12-31T18:30:00Z')), { date: '2027-01-01', time: '02:30' });
});

test('only explicit employee assignments grant access to a service', () => {
  const c = context();
  c.services[0].assignedEmployeeIds = ['emp-2'];
  assert.equal(isEmployeeAssignedToService(c.services[0], c.employees[0]), false);
  assert.equal(isEmployeeAssignedToService(c.services[0], c.employees[1]), true);
  assert.deepEqual(getAvailableSlots(c, selection()), []);
  assert.match(validateBookingRequest(c, request())!, /does not provide/);
  assert.ok(getAvailableSlots(c, selection({ employeeId: 'emp-2' })).length > 0);
  for (const assignedEmployeeIds of [[], undefined, ['deleted']]) {
    c.services[0].assignedEmployeeIds = assignedEmployeeIds;
    assert.deepEqual(getAvailableSlots(c, selection()), []);
    assert.deepEqual(getAvailableSlots(c, selection({ employeeId: 'emp-2' })), []);
  }
});

test('one-off salon closures block their whole inclusive date range', () => {
  for (const [start, end] of [[DATE, DATE], ['2026-10-07', DATE], [DATE, '2026-10-09']]) {
    const c = context();
    c.closedDates = [{ id: 'closure', name: 'Holiday', start, end }];
    assert.deepEqual(getAvailableSlots(c, selection()), []);
    assert.match(validateBookingRequest(c, request())!, /salon is closed/);
  }
  const c = context();
  c.closedDates = [{ id: 'closure', name: 'Holiday', start: '2026-10-09', end: '2026-10-10' }];
  assert.ok(getAvailableSlots(c, selection()).length > 0);
});

test('staff absences only block the absent employee and include both date bounds', () => {
  for (const [start, end] of [[DATE, DATE], ['2026-10-07', DATE], [DATE, '2026-10-09']]) {
    const c = context();
    c.absences = [{ id: 'absence', employeeId: 'emp-1', start, end, reason: 'Leave' }];
    assert.deepEqual(getAvailableSlots(c, selection()), []);
    assert.match(validateBookingRequest(c, request())!, /employee is away/);
    assert.ok(getAvailableSlots(c, selection({ employeeId: 'emp-2' })).length > 0);
  }
});

test('next available date respects service, employee, closures and editing self-exclusion', () => {
  const c = context();
  c.now = new Date('2026-10-08T06:00:00Z');
  c.shiftOverview[0].shifts[DATE] = { start: '10:00', end: '10:30' };
  c.requests = [request()];
  assert.equal(getNextAvailableDate(c, 'haircut', DATE, 'emp-1'), null);
  assert.equal(getNextAvailableDate(c, 'haircut', DATE, 'emp-1', 'request-1'), DATE);
  assert.equal(getNextAvailableDate(c, 'haircut', '2026-10-01'), DATE);
  c.closedDates = [{ id: 'closed', name: 'Closed', start: DATE, end: DATE }];
  assert.equal(getNextAvailableDate(c, 'haircut', DATE), null);
  c.closedDates = [];
  c.services[0].assignedEmployeeIds = [];
  assert.equal(getNextAvailableDate(c, 'haircut', DATE), null);
  assert.equal(getNextAvailableDate(c, 'missing', DATE), null);
  assert.equal(getNextAvailableDate(c, 'colour', 'bad-date'), null);
});

test('next-date search reaches day 90 and never exceeds its 90-day window', () => {
  const c = context();
  c.now = new Date('2026-10-08T06:00:00Z');
  c.bookingHours = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    .map((day) => ({ day, isOpen: true, from: '09:00', to: '18:00' }));
  c.shiftOverview = [c.shiftOverview[0]];
  c.shiftOverview[0].shifts = { [addDays(DATE, 89)]: { start: '09:00', end: '18:00' } };
  assert.equal(getNextAvailableDate(c, 'haircut', DATE), addDays(DATE, 89));
  c.shiftOverview[0].shifts = { [addDays(DATE, 90)]: { start: '09:00', end: '18:00' } };
  assert.equal(getNextAvailableDate(c, 'haircut', DATE), null);
});

test('the sample stylists work their regular week on every date; the week plan holds only days that differ', () => {
  const now = new Date('2027-01-03T23:30:00Z'); // Monday 4 January in Zurich.
  const shifts = createDemoShifts('Europe/Zurich', now);
  assert.deepEqual(shifts.map((entry) => entry.employeeId), ['emp-1', 'emp-2', 'emp-3']);
  // The plan stores no date at all: the sample salon needs no day that differs from the regular week.
  for (const entry of shifts) assert.deepEqual(entry.shifts, {}, entry.employeeName);
  const salon = { employees: initialEmployees, shiftOverview: shifts };
  const on = (employeeId: string, date: string) => workingTimeOn(salon, employeeId, date);
  assert.equal(on('emp-1', '2027-01-04'), null); // the salon is closed on Mondays
  assert.deepEqual(on('emp-1', '2027-01-05'), { start: '08:30', end: '17:00' });
  assert.equal(on('emp-2', '2027-01-05'), null); // her day off
  assert.deepEqual(on('emp-2', '2027-01-06'), { start: '10:00', end: '18:30' });
  assert.deepEqual(on('emp-3', '2027-01-09'), { start: '09:00', end: '16:00' });
  assert.equal(on('emp-1', '2027-01-10'), null); // Sunday
  // The regular week has no first and no last day: the eight weeks of history behind the past
  // appointments, and dates far beyond the ninety days the plan once ended at.
  assert.deepEqual(on('emp-1', '2026-11-10'), { start: '08:30', end: '17:00' });
  assert.deepEqual(on('emp-1', '2025-01-07'), { start: '08:30', end: '17:00' });
  assert.deepEqual(on('emp-1', addDays('2027-01-05', 91)), { start: '08:30', end: '17:00' });
  assert.deepEqual(on('emp-1', addDays('2027-01-05', 700)), { start: '08:30', end: '17:00' });
  // Every working day lies inside the opening hours of its weekday: nobody is rostered while the salon is closed.
  const names = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' } as const;
  for (const person of initialEmployees) {
    assert.ok(person.weeklyHours, person.name);
    for (const [day, hours] of Object.entries(person.weeklyHours) as [keyof typeof names, { start: string; end: string } | null][]) {
      if (!hours) continue;
      const opening = initialBookingHours.find((item) => item.day === names[day])!;
      assert.ok(opening.isOpen && opening.from <= hours.start && hours.end <= opening.to, `${person.name} ${day}`);
    }
  }
  // The same clock gives equal data in separate objects.
  const again = createDemoShifts('Europe/Zurich', now);
  assert.deepEqual(again, shifts);
  again[0].shifts['2027-01-05'] = { start: '12:00', end: '13:00' };
  assert.deepEqual(shifts[0].shifts, {});
  // A person without regular hours never falls back to the opening hours, with the same empty plan ...
  const c = context();
  c.now = now;
  c.bookingHours = [{ day: 'Tuesday', isOpen: true, from: '09:00', to: '18:00' }];
  c.shiftOverview = shifts;
  assert.equal(c.employees[0].weeklyHours, undefined);
  assert.deepEqual(getAvailableSlots(c, selection({ date: '2027-01-05' })), []);
  // ... and the moment the person has a regular week, the times of that weekday are there.
  c.employees[0].weeklyHours = initialEmployees[0].weeklyHours;
  const tuesday = getAvailableSlots(c, selection({ date: '2027-01-05' }));
  assert.equal(tuesday[0], '09:00');
  assert.equal(tuesday.at(-1), '16:30');
  // One changed day decides for its date only.
  c.shiftOverview = [{ ...shifts[0], shifts: { '2027-01-05': null } }, ...shifts.slice(1)];
  assert.deepEqual(getAvailableSlots(c, selection({ date: '2027-01-05' })), []);
  assert.deepEqual(getAvailableSlots(c, selection({ date: '2027-01-12' })), tuesday);
});

test('an appointment keeps its own day, start and stylist after an absence, a closed date or other hours are entered', () => {
  // Thursday 8 October, 10:00 with Alex, booked a week ahead; then something is entered for that day.
  const c = context();
  c.events = [event()];
  const own = { mode: 'owner' as const, excludeEventId: 'event-1' };
  const obstacles: [string, (salon: AvailabilityContext) => void][] = [
    ['absence', (salon) => { salon.absences = [{ id: 'away', employeeId: 'emp-1', start: DATE, end: DATE }]; }],
    ['closed date', (salon) => { salon.closedDates = [{ id: 'closure', name: 'Holiday', start: DATE, end: DATE }]; }],
    ['day off', (salon) => { salon.shiftOverview[0].shifts[DATE] = null; }],
    ['later start', (salon) => { salon.shiftOverview[0].shifts[DATE] = { start: '13:00', end: '18:00' }; }],
    ['closed weekday', (salon) => { salon.bookingHours[0].isOpen = false; }],
  ];
  for (const [name, enter] of obstacles) {
    const salon = { ...context(), events: [event()] };
    enter(salon);
    // Its own start stays, also with another customer or another service ...
    assert.deepEqual(getAvailableSlots(salon, selection(own)).filter((time) => time < '13:00'), ['10:00'], name);
    assert.equal(validateCalendarEvent(salon, event({ customerName: 'Somebody else' }), 'event-1'), null, name);
    assert.equal(validateCalendarEvent(salon, event({ serviceId: 'colour', serviceName: 'Colouring', endTime: '11:30' }), 'event-1'), null, name);
    // ... but no other start opens, and a new appointment gets nothing there.
    assert.match(validateCalendarEvent(salon, event({ startTime: '11:00', endTime: '11:30' }), 'event-1')!, /./, name);
    assert.notEqual(validateCalendarEvent(salon, event({ id: 'new' }), 'new'), null, name);
    // A longer service still must not run into another booking.
    salon.events.push(event({ id: 'neighbour', startTime: '10:30', endTime: '11:00' }));
    assert.match(validateCalendarEvent(salon, event({ serviceId: 'colour', serviceName: 'Colouring', endTime: '11:30' }), 'event-1')!, /not available/, name);
    // Another stylist, or another day, is no longer the appointment's own place.
    salon.events.pop();
    salon.absences = [...(salon.absences ?? []), { id: 'sam-away', employeeId: 'emp-2', start: DATE, end: DATE }];
    assert.match(validateCalendarEvent(salon, event({ employeeId: 'emp-2', staffName: 'Sam' }), 'event-1')!, /away|closed/, name);
  }
  // Nothing has been entered: the normal rules, the own start among the others.
  assert.ok(getAvailableSlots(c, selection(own)).includes('10:00'));
  assert.ok(getAvailableSlots(c, selection(own)).includes('11:00'));
  // The customers' page never gets the allowance.
  c.absences = [{ id: 'away', employeeId: 'emp-1', start: DATE, end: DATE }];
  assert.deepEqual(getAvailableSlots(c, selection({ excludeEventId: 'event-1' })), []);
});

test('an appointment the owner books outside the usual hours needs neither the opening hours nor the working hours', () => {
  const c = context();
  c.bookingHours[0].isOpen = false;
  c.shiftOverview[0].shifts[DATE] = null;
  const approved = { mode: 'owner' as const, outsideHoursApproved: true };
  const slots = getAvailableSlots(c, selection(approved));
  // From six in the morning until eleven at night, and nobody's hours change for it.
  assert.equal(slots[0], '06:00');
  assert.equal(slots[slots.length - 1], '22:30');
  assert.equal(validateCalendarEvent(c, event({ startTime: '07:00', endTime: '07:30', outsideHoursApproved: true })), null);
  assert.match(validateCalendarEvent(c, event({ startTime: '05:30', endTime: '06:00', outsideHoursApproved: true }))!, /not available/);
  assert.match(validateCalendarEvent(c, event({ startTime: '22:45', endTime: '23:15', outsideHoursApproved: true }))!, /not available/);
  assert.equal(workingTimeOn(c, 'emp-1', DATE), null);
  // Without the owner's approval, or on the customers' page, the day stays closed.
  assert.deepEqual(getAvailableSlots(c, selection({ mode: 'owner' })), []);
  assert.deepEqual(getAvailableSlots(c, selection({ outsideHoursApproved: true })), []);
  // Another booking, a waiting request and a time block are still in the way ...
  c.events = [event({ id: 'other', startTime: '07:00', endTime: '07:30' })];
  c.requests = [request({ timeStr: '08:00 - 08:30' })];
  c.timeBlocks = [{ id: 'b', employeeId: 'emp-1', date: DATE, startTime: '09:00', endTime: '09:30', reason: 'Other' }];
  const busy = getAvailableSlots(c, selection(approved));
  for (const time of ['07:00', '08:00', '09:00']) assert.ok(!busy.includes(time), time);
  assert.ok(busy.includes('07:30'));
  // ... and a closed date or an absence still refuse it.
  c.closedDates = [{ id: 'closure', name: 'Holiday', start: DATE, end: DATE }];
  assert.match(validateCalendarEvent(c, event({ startTime: '07:30', endTime: '08:00', outsideHoursApproved: true }))!, /salon is closed/);
  c.closedDates = [];
  c.absences = [{ id: 'away', employeeId: 'emp-1', start: DATE, end: DATE }];
  assert.match(validateCalendarEvent(c, event({ startTime: '07:30', endTime: '08:00', outsideHoursApproved: true }))!, /away/);
});
