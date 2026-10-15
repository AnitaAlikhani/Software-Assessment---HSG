import assert from 'node:assert/strict';
import test from 'node:test';
import { getAvailableSlots, validateCalendarEvent, type AvailabilityContext } from '../src/availability';
import { appointmentFromRequest } from '../src/appointmentActions';
import { deletionDependency } from '../src/managementDependencies';
import type { AppointmentRequest, CalendarEvent, Employee, ServiceItem } from '../src/types';

const DATE = '2026-10-08';
const employee = (partial: Partial<Employee> = {}): Employee => ({
  id: 'emp-1', name: 'Alex', firstName: 'Alex', lastName: '', initials: 'A', email: '', phone: '',
  status: 'Active', location: 'Salon', canBookOnline: true, hidden: false, ...partial,
});
const service = (partial: Partial<ServiceItem> = {}): ServiceItem => ({
  id: 'haircut', name: 'Haircut', durationMinutes: 30, priceCHF: 50, onlineBooking: true,
  assignedEmployeesCount: 2, assignedEmployeeIds: ['emp-1', 'emp-2'], ...partial,
});
const context = (): AvailabilityContext => ({
  employees: [employee(), employee({ id: 'emp-2', name: 'Sam' })], services: [service()],
  bookingHours: [{ day: 'Thursday', isOpen: true, from: '09:00', to: '18:00' }],
  shiftOverview: ['emp-1', 'emp-2'].map(employeeId => ({
    employeeId, employeeName: employeeId, initials: '', avatarColor: '',
    shifts: { [DATE]: { start: '09:00', end: '18:00' } },
  })),
  events: [], requests: [], timeZone: 'Europe/Zurich', now: new Date('2026-10-01T00:00:00Z'),
});
const event = (partial: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'event-1', customerId: 'customer-1', customerName: 'Customer', serviceId: 'haircut', serviceName: 'Haircut',
  employeeId: 'emp-1', staffName: 'Alex', date: DATE, day: 'thu', dateDisplay: 'Thu 08/10',
  startTime: '10:00', endTime: '10:30', colorTheme: 'blue', ...partial,
});
const request = (partial: Partial<AppointmentRequest> = {}): AppointmentRequest => ({
  id: 'request-1', customerId: 'customer-1', customerName: 'Customer', serviceId: 'haircut', serviceName: 'Haircut',
  employeeId: 'emp-1', staffName: 'Alex', date: DATE, dateStr: '8 October 2026',
  timeStr: '10:00 - 10:30', timeAgo: 'Now', status: 'pending', ...partial,
});
const selection = { date: DATE, serviceId: 'haircut', employeeId: 'emp-1', mode: 'owner' as const };

test('manual appointments reject both confirmed and pending overlaps while allowing touching endpoints', () => {
  const c = context();
  assert.equal(validateCalendarEvent(c, event()), null);
  c.events = [event({ id: 'occupied', startTime: '10:00', endTime: '11:00' })];
  assert.match(validateCalendarEvent(c, event())!, /not available/);
  assert.equal(validateCalendarEvent(c, event({ startTime: '09:30', endTime: '10:00' })), null);
  assert.equal(validateCalendarEvent(c, event({ startTime: '11:00', endTime: '11:30' })), null);
  c.events = [];
  c.requests = [request()];
  assert.match(validateCalendarEvent(c, event())!, /not available/);
  c.requests = [request({ status: 'cancelled' })];
  assert.equal(validateCalendarEvent(c, event()), null);
});

test('manual appointments respect closures, absences, opening hours and dated shifts', () => {
  const c = context();
  c.closedDates = [{ id: 'closed', name: 'Closed', start: DATE, end: DATE }];
  assert.match(validateCalendarEvent(c, event())!, /salon is closed/);
  c.closedDates = [];
  c.absences = [{ id: 'away', employeeId: 'emp-1', start: DATE, end: DATE }];
  assert.match(validateCalendarEvent(c, event())!, /employee is away/);
  c.absences = [{ id: 'other-away', employeeId: 'emp-2', start: DATE, end: DATE }];
  assert.equal(validateCalendarEvent(c, event()), null);
  c.shiftOverview[0].shifts[DATE] = { start: '11:00', end: '17:00' };
  assert.match(validateCalendarEvent(c, event())!, /not available/);
  assert.equal(validateCalendarEvent(c, event({ startTime: '16:30', endTime: '17:00' })), null);
  delete c.shiftOverview[0].shifts[DATE];
  assert.match(validateCalendarEvent(c, event())!, /no shift/);
  c.shiftOverview[0].shifts[DATE] = { start: '08:00', end: '20:00' };
  assert.match(validateCalendarEvent(c, event({ startTime: '18:00', endTime: '18:30', outsideHoursApproved: true }))!, /not available/);
  c.bookingHours[0].isOpen = false;
  assert.match(validateCalendarEvent(c, event())!, /salon is closed/);
});

test('owner bookings allow offline or hidden options but require active, assigned employees', () => {
  const c = context();
  c.services[0].onlineBooking = false;
  c.employees[0] = employee({ canBookOnline: false, hidden: true });
  assert.ok(getAvailableSlots(c, selection).includes('10:00'));
  assert.equal(validateCalendarEvent(c, event()), null);
  assert.deepEqual(getAvailableSlots(c, { ...selection, mode: 'online' }), []);
  c.employees[0].status = 'Inactive';
  assert.match(validateCalendarEvent(c, event())!, /active employee/);
  c.employees[0].status = 'Active';
  c.services[0].assignedEmployeeIds = ['emp-2'];
  assert.match(validateCalendarEvent(c, event())!, /does not provide/);
});

test('editing excludes only the selected appointment and still checks other reservations', () => {
  const c = context();
  c.events = [event()];
  assert.match(validateCalendarEvent(c, event())!, /not available/);
  assert.equal(validateCalendarEvent(c, event(), 'event-1'), null);
  assert.ok(getAvailableSlots(c, { ...selection, excludeEventId: 'event-1' }).includes('10:00'));
  c.events.push(event({ id: 'other-event' }));
  assert.match(validateCalendarEvent(c, event(), 'event-1')!, /not available/);
  c.events.pop();
  c.requests = [request()];
  assert.match(validateCalendarEvent(c, event(), 'event-1')!, /not available/);
  assert.equal(validateCalendarEvent(c, event({ startTime: '11:00', endTime: '11:30' }), 'event-1'), null);
});

test('accepted appointment buffer snapshots reserve time after their service changes or disappears', () => {
  const c = context();
  const buffered = service({ id: 'buffered', name: 'Colour', prepMinutes: 30, postMinutes: 30 });
  c.events = [appointmentFromRequest(request({ serviceId: buffered.id, serviceName: buffered.name }), [buffered])];
  assert.equal(c.events[0].prepMinutes, 30);
  assert.equal(c.events[0].postMinutes, 30);
  for (const catalog of [
    [service(), { ...buffered, prepMinutes: 0, postMinutes: 0 }],
    [service()],
    [service(), { ...buffered, id: 'replacement', prepMinutes: 120, postMinutes: 120 }],
  ]) {
    c.services = catalog;
    const slots = getAvailableSlots(c, selection);
    assert.ok(slots.includes('09:00'));
    assert.ok(!slots.includes('09:30'));
    assert.ok(!slots.includes('10:30'));
    assert.ok(slots.includes('11:00'));
  }
});

test('manual validation requires a name, a future date, a full service duration and a valid slot boundary', () => {
  const c = context();
  assert.match(validateCalendarEvent(c, event({ customerName: '  ' }))!, /customer name/);
  assert.match(validateCalendarEvent(c, event({ date: '2026-09-24' }))!, /future appointment date/);
  assert.match(validateCalendarEvent(c, event({ endTime: '10:15' }))!, /30-minute/);
  assert.match(validateCalendarEvent(c, event({ startTime: '10:15', endTime: '10:45' }))!, /not available/);
  assert.match(validateCalendarEvent(c, event({ startTime: '23:45', endTime: '00:15' }))!, /same day/);
});

test('employee IDs are authoritative for both occupied time and owner validation', () => {
  const c = context();
  c.events = [event({ employeeId: 'emp-2', staffName: 'Alex' })];
  c.requests = [request({ employeeId: 'emp-2', staffName: 'Alex' })];
  assert.equal(validateCalendarEvent(c, event()), null);
  c.events = [event({ employeeId: 'emp-1', staffName: 'Former name' })];
  assert.match(validateCalendarEvent(c, event())!, /not available/);
  c.events = [];
  assert.match(validateCalendarEvent(c, event({ employeeId: 'deleted-employee', staffName: 'Alex' }))!, /active employee/);
  assert.equal(validateCalendarEvent(c, event({ employeeId: 'emp-1', staffName: 'Former name' })), null);
  c.employees[1].name = 'Alex';
  assert.match(validateCalendarEvent(c, event({ employeeId: undefined }))!, /active employee/);
});

test('service IDs never fall back to a different service with the same name', () => {
  const c = context();
  assert.match(validateCalendarEvent(c, event({ serviceId: 'deleted-service' }))!, /no longer exists/);
  assert.equal(validateCalendarEvent(c, event({ serviceName: 'Former service name' })), null);
  assert.equal(validateCalendarEvent(c, event({ serviceId: undefined })), null);
});

const identities = [
  { kind: 'customer' as const, id: 'customer-1', name: 'Customer', idKey: 'customerId' as const, nameKey: 'customerName' as const },
  { kind: 'employee' as const, id: 'emp-1', name: 'Alex', idKey: 'employeeId' as const, nameKey: 'staffName' as const },
  { kind: 'service' as const, id: 'haircut', name: 'Haircut', idKey: 'serviceId' as const, nameKey: 'serviceName' as const },
];

test('pending requests protect referenced customers, employees and services from deletion', () => {
  for (const { kind, id, name } of identities) {
    assert.match(deletionDependency(kind, id, name, [], [request()])!, /0 appointments and 1 pending request/);
    assert.match(deletionDependency(kind, id, name, [event()], [request()])!, /1 appointment and 1 pending request/);
    for (const status of ['accepted', 'rejected', 'cancelled'] as const) {
      assert.equal(deletionDependency(kind, id, name, [], [request({ status })]), null);
    }
  }
});

test('deletion dependency checks use stable IDs and only fall back to names for legacy records', () => {
  for (const { kind, id, name, idKey, nameKey } of identities) {
    const differentId = { [idKey]: 'other-id' };
    assert.equal(deletionDependency(kind, id, name, [event(differentId)], [request(differentId)]), null);
    const renamed = { [nameKey]: 'Renamed record' };
    assert.match(deletionDependency(kind, id, name, [event(renamed)], [request(renamed)])!, /1 appointment and 1 pending request/);
    const legacy = { [idKey]: undefined };
    assert.match(deletionDependency(kind, id, name, [event(legacy)], [request(legacy)])!, /1 appointment and 1 pending request/);
    assert.equal(deletionDependency(kind, id, name, [event({ ...legacy, ...renamed })], [request({ ...legacy, ...renamed })]), null);
  }
});
