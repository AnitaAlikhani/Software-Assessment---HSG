import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoRequests } from '../src/demoRequests.ts';
import { getSalonNow, validateBookingRequest } from '../src/availability.ts';
import {
  createDemoShifts, initialAppointmentRequests, initialBookingHours,
  initialCalendarEvents, initialEmployees, initialServices,
} from '../src/mockData.ts';
import { initialConversations } from '../src/conversationData.ts';

test('fresh sample requests use valid upcoming slots while preserving staff and service', () => {
  for (const instant of ['2026-10-14T13:45:00Z', '2027-01-02T18:00:00Z', '2027-04-18T23:30:00Z']) {
    const now = new Date(instant);
    const requests = createDemoRequests('Europe/Zurich', now);
    assert.equal(requests.length, initialAppointmentRequests.length);
    const context = {
      services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours,
      events: initialCalendarEvents, shiftOverview: createDemoShifts('Europe/Zurich', now),
      requests, now, timeZone: 'Europe/Zurich',
    };
    for (const request of requests) {
      const source = initialAppointmentRequests.find((item) => item.id === request.id)!;
      assert.equal(request.serviceId, source.serviceId);
      assert.equal(request.employeeId, source.employeeId);
      assert.equal(request.status, 'pending');
      assert.equal(validateBookingRequest(context, request, request.id), null);
      assert.match(validateBookingRequest(context, request)!, /no longer available/);
      assert.ok(request.date >= getSalonNow(context.timeZone, now).date);
      const weekday = new Date(`${request.date}T00:00:00Z`).getUTCDay();
      assert.notEqual(weekday, 0); // Salon closed on Sunday.
    }
  }
});

test('seeding requests does not alter historical appointments, requests or conversation dates', () => {
  const before = JSON.stringify({ initialCalendarEvents, initialAppointmentRequests, initialConversations });
  createDemoRequests('Europe/Zurich', new Date('2027-01-01T12:00:00Z'));
  assert.equal(JSON.stringify({ initialCalendarEvents, initialAppointmentRequests, initialConversations }), before);
});
