import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAvailableSlots,
  isBookableEmployee,
  validateBookingRequest,
  type AvailabilityContext,
} from '../src/availability.ts';
import type { AppointmentRequest, CalendarEvent, Employee, ServiceItem } from '../src/types.ts';

const DATE = '2026-10-08';
const employee = (id = 'emp-1', name = 'Alex'): Employee => ({
  id, name, firstName: name, lastName: '', initials: name[0], email: '', phone: '',
  status: 'Active', location: 'Salon', canBookOnline: true, hidden: false,
});
const service = (partial: Partial<ServiceItem> = {}): ServiceItem => ({
  id: 'haircut', name: 'Haircut', durationMinutes: 30, priceCHF: 50,
  onlineBooking: true, assignedEmployeesCount: 2, ...partial,
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
    assert.match(validateBookingRequest(c, request())!, /no shift/);
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
