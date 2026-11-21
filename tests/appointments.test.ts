import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentFromRequest, appointmentFromConversationAction, appointmentIdForRequest, requestTimes, upsertAppointment } from '../src/appointmentActions';
import { addDays, addMinutes, dayKeyForDate, formatCalendarDate, formatDate, startOfWeek } from '../src/scheduling';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { isOutsideOpeningHours } from '../src/availability';
import { createDemoConversations, DEFAULT_DEMO_CONVERSATION_ID, upcomingWeekday } from '../src/conversationData';
import { chatAppointmentId } from '../src/requestAnswers';
import { demoConversations, demoEvents, demoRequests, FIXED_NOW } from './fixedClock';

// A request for Thursday 1 October 2026, the week before the fixed clock.
const octoberRequest = { ...demoRequests[0], date: '2026-10-01', dateStr: 'Thu, 01.10.2026' };

test('accepting an October 1 request preserves the full date and requested time', () => {
  const event = appointmentFromRequest({ ...octoberRequest, timeStr: '16:00 - 16:30' }, initialServices);
  assert.equal(event.date, '2026-10-01');
  assert.equal(event.dateDisplay, 'Thu 01.10.');
  assert.equal(event.day, 'thu');
  assert.equal(event.startTime, '16:00');
  assert.equal(event.endTime, '16:30');
  assert.notEqual(event.date, demoEvents.find((item) => item.id === 'cal-2')!.date); // another Thursday
});

test('an appointment lasts as long as its request asked for, also after the service got another length', () => {
  // A colouring was asked for from 16:00 to 17:30, the 90 minutes the service had.
  const colouring = { ...octoberRequest, serviceId: 'srv-3', serviceName: 'Colouring', timeStr: '16:00 - 17:30' };
  assert.equal(appointmentFromRequest(colouring, initialServices).endTime, '17:30');
  // The owner has made the service two hours since: the customer still gets the time asked for.
  const longer = initialServices.map((service) => service.id === 'srv-3' ? { ...service, durationMinutes: 120 } : service);
  assert.equal(appointmentFromRequest(colouring, longer).endTime, '17:30');
  assert.deepEqual(requestTimes(colouring), { start: '16:00', end: '17:30', minutes: 90 });
  // A request without a readable span (never written by the app) falls back to the service's length.
  assert.equal(requestTimes({ timeStr: '16:00' }), null);
  assert.equal(requestTimes({ timeStr: '17:00 - 16:00' }), null);
  assert.equal(appointmentFromRequest({ ...colouring, timeStr: '16:00' }, initialServices).endTime, '17:30');
  assert.equal(appointmentIdForRequest('req-1'), 'cal-req-1');
  for (const hour of ['09:00', '10:00', '11:00', '13:30', '14:00', '16:00']) {
    const [h, m] = hour.split(':').map(Number);
    const expected = h * 60 + m + 30;
    assert.equal(addMinutes(hour, 30), `${String(Math.floor(expected / 60)).padStart(2, '0')}:${String(expected % 60).padStart(2, '0')}`);
  }
});

test('accepted requests retain their service identity after a service is renamed', () => {
  const services = initialServices.map((service) => service.id === 'srv-3' ? { ...service, name: 'Full Colour' } : service);
  const event = appointmentFromRequest({ ...octoberRequest, serviceId: 'srv-3', serviceName: 'Colouring', timeStr: '16:00 - 17:30' }, services);
  assert.equal(event.serviceId, 'srv-3');
  assert.equal(event.serviceName, 'Full Colour');
  assert.equal(event.endTime, '17:30');
});

test('the owner\'s reply and the request card book one and the same appointment', () => {
  const sabrina = demoConversations.find((item) => item.id === 'conv-sabrina')!;
  const actions = sabrina.quickReplies!.map((reply) => reply.appointmentAction!);
  // Both answers to the discount question confirm the colouring she asked for, under one id.
  assert.equal(new Set(actions.map((action) => JSON.stringify(action))).size, 1);
  const ownerBooking = appointmentFromConversationAction(actions[0], sabrina, demoEvents, initialServices, initialEmployees, false)!;
  // The chats are built for Monday 5 October 2026 (tests/fixedClock.ts): "Freitag" is the 9th.
  assert.equal(ownerBooking.date, '2026-10-09');
  assert.equal(ownerBooking.startTime, '11:00');
  assert.equal(ownerBooking.endTime, '12:30');
  // Confirming the request on its card gives the appointment the same id: it cannot be added twice.
  assert.equal(ownerBooking.id, chatAppointmentId(sabrina.id, sabrina.bookingRequest!));
  const events = upsertAppointment(demoEvents, ownerBooking);
  const again = upsertAppointment(events, appointmentFromConversationAction(actions[1], sabrina, events, initialServices, initialEmployees, true)!);
  assert.equal(again.filter((item) => item.id === ownerBooking.id).length, 1);
  assert.equal(again.length, demoEvents.length + 1);
});

test('confirming Giulia\'s change moves her existing appointment without adding another', () => {
  const giulia = demoConversations.find((item) => item.id === 'conv-giulia')!;
  const change = giulia.bookingRequest!;
  assert.equal(change.kind, 'change');
  const action = { type: 'reschedule' as const, appointmentId: giulia.appointmentId!, date: change.date, startTime: change.time };
  const original = demoEvents.find((item) => item.id === giulia.appointmentId)!;
  assert.deepEqual(change.previous, { date: original.date, time: original.startTime });
  const moved = appointmentFromConversationAction(action, giulia, demoEvents, initialServices, initialEmployees, false)!;
  const events = upsertAppointment(demoEvents, moved);
  assert.equal(moved.id, original.id);
  assert.equal(moved.date, '2026-10-10'); // "sabato" as seen from Monday 5 October 2026
  assert.equal(moved.day, 'sat');
  // The salon is open on Saturdays, so the move needs no approval outside opening hours.
  assert.equal(moved.outsideHoursApproved, false);
  assert.equal(isOutsideOpeningHours(initialBookingHours, moved.date, moved.startTime, moved.endTime), false);
  assert.equal(moved.customerId, original.customerId);
  assert.equal(moved.employeeId, change.employeeId);
  assert.equal(moved.startTime, '10:00');
  assert.equal(moved.endTime, '10:30');
  assert.equal(moved.staffName, original.staffName);
  assert.equal(events.length, demoEvents.length);
  assert.equal(events.filter((item) => item.id === original.id && item.date === original.date).length, 0);
  assert.equal(appointmentFromConversationAction(action, giulia, [], initialServices, initialEmployees, false), null);
});

test('nothing the AI or an offer says books anything before the owner confirms', () => {
  // The AI never books by itself: no prepared AI answer carries a booking.
  for (const conversation of demoConversations) assert.equal(conversation.aiFollowUp?.appointmentAction, undefined, conversation.id);
  // Offering Chloé another time books nothing yet: she answers first.
  const chloe = demoConversations.find((item) => item.id === 'conv-chloe')!;
  assert.ok(chloe.quickReplies!.length > 0);
  for (const reply of chloe.quickReplies!) assert.equal(reply.appointmentAction, undefined);
  assert.equal(chloe.bookingRequest, undefined);
});

test('date helpers preserve calendar dates across week, year and DST boundaries', () => {
  // The two names the screens import from scheduling.ts give the Swiss forms (tests/format.test.ts has the rest).
  assert.equal(formatDate('2026-10-01'), 'Thu, 01.10.2026');
  assert.equal(formatCalendarDate('2026-10-01'), 'Thu 01.10.');
  assert.equal(dayKeyForDate('2026-10-01'), 'thu');
  assert.equal(startOfWeek('2026-10-01'), '2026-09-28');
  assert.equal(addDays('2026-10-01', 7), '2026-10-08');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
});

test('chat dates point at the next weekday, one to seven days ahead, whatever day it is', () => {
  // 5 to 11 October 2026 is a Monday-to-Sunday week.
  for (const today of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']) {
    for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
      const date = upcomingWeekday(weekday, today);
      assert.equal(new Date(`${date}T00:00:00Z`).getUTCDay(), weekday);
      assert.ok(date > today, `${date} must be after ${today}`);
      assert.ok(date <= addDays(today, 7), `${date} must be within a week of ${today}`);
    }
  }
  assert.equal(upcomingWeekday(5, '2026-10-09'), '2026-10-16'); // on a Friday, "Friday" is next week
  assert.equal(upcomingWeekday(6, '2026-12-31'), '2027-01-02'); // across the year end
});

test('the salon\'s chats depend only on the clock they are given', () => {
  const zurichEvening = new Date('2026-11-18T22:30:00Z'); // 23:30 on Wednesday 18 November in Zurich
  const friday = (list: ReturnType<typeof createDemoConversations>) => list.find((item) => item.id === 'conv-sabrina')!.bookingRequest!.date;
  const saturday = (list: ReturnType<typeof createDemoConversations>) => list.find((item) => item.id === 'conv-giulia')!.bookingRequest!.date;
  assert.equal(friday(createDemoConversations('Europe/Zurich', zurichEvening)), '2026-11-20');
  assert.equal(saturday(createDemoConversations('Europe/Zurich', zurichEvening)), '2026-11-21');
  // A day later, at the same moment, it is already Friday in Zurich and still Thursday in New York:
  // "Friday" is next week for the first salon and tomorrow for the second.
  const later = new Date('2026-11-19T23:30:00Z');
  assert.equal(friday(createDemoConversations('Europe/Zurich', later)), '2026-11-27');
  assert.equal(friday(createDemoConversations('America/New_York', later)), '2026-11-20');
  // Two calls with the same clock give equal data and separate objects.
  assert.deepEqual(createDemoConversations('Europe/Zurich', FIXED_NOW), demoConversations);
  assert.notEqual(createDemoConversations('Europe/Zurich', FIXED_NOW), demoConversations);
  assert.equal(demoConversations[0].id, DEFAULT_DEMO_CONVERSATION_ID);
});
