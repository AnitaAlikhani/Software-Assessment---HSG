import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentFromRequest, appointmentFromConversationAction, upsertAppointment } from '../src/appointmentActions';
import { addDays, addMinutes, dayKeyForDate, formatCalendarDate, formatDate, startOfWeek } from '../src/scheduling';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData';
import { isOutsideOpeningHours } from '../src/availability';
import { createDemoConversations, DEFAULT_DEMO_CONVERSATION_ID, upcomingWeekday } from '../src/conversationData';
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

test('appointments use the selected service duration, including 90-minute services', () => {
  const event = appointmentFromRequest({ ...octoberRequest, serviceId: 'srv-3', serviceName: 'Colouring', timeStr: '16:00 - 16:30' }, initialServices);
  assert.equal(event.endTime, '17:30');
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

test('owner and AI booking confirmations reference one stable appointment', () => {
  const camille = demoConversations.find((item) => item.id === 'conv-camille')!;
  const ownerAction = camille.quickReplies!.find((reply) => reply.appointmentAction)!.appointmentAction!;
  const aiAction = camille.aiFollowUp!.appointmentAction!;
  const ownerBooking = appointmentFromConversationAction(ownerAction, camille, demoEvents, initialServices, initialEmployees, false)!;
  // The sample chats are built for Monday 5 October 2026 (tests/fixedClock.ts): "Friday" is the 9th.
  assert.equal(ownerBooking.date, '2026-10-09');
  assert.equal(ownerBooking.startTime, '11:00');
  assert.equal(ownerBooking.endTime, '12:30');
  const events = upsertAppointment(demoEvents, ownerBooking);
  const aiBooking = appointmentFromConversationAction(aiAction, camille, events, initialServices, initialEmployees, true)!;
  const confirmed = upsertAppointment(events, aiBooking);
  assert.equal(confirmed.filter((item) => item.id === ownerAction.appointmentId).length, 1);
  assert.equal(confirmed.length, demoEvents.length + 1);
});

test('rescheduling Giulia moves her existing appointment without adding another', () => {
  const giulia = demoConversations.find((item) => item.id === 'conv-giulia')!;
  const action = giulia.quickReplies![0].appointmentAction!;
  const original = demoEvents.find((item) => item.id === giulia.appointmentId)!;
  const moved = appointmentFromConversationAction(action, giulia, demoEvents, initialServices, initialEmployees, false)!;
  const events = upsertAppointment(demoEvents, moved);
  assert.equal(moved.id, original.id);
  assert.equal(moved.date, '2026-10-10'); // "Saturday" as seen from Monday 5 October 2026
  assert.equal(moved.day, 'sat');
  // The salon is open on Saturdays, so the move needs no approval outside opening hours.
  assert.equal(moved.outsideHoursApproved, false);
  assert.equal(isOutsideOpeningHours(initialBookingHours, moved.date, moved.startTime, moved.endTime), false);
  assert.equal(moved.customerId, original.customerId);
  assert.equal(moved.employeeId, original.employeeId);
  assert.equal(moved.startTime, '10:00');
  assert.equal(moved.endTime, '10:30');
  assert.equal(moved.staffName, original.staffName);
  assert.equal(events.length, demoEvents.length);
  assert.equal(events.filter((item) => item.id === original.id && item.date === original.date).length, 0);
  assert.equal(appointmentFromConversationAction(action, giulia, [], initialServices, initialEmployees, false), null);
});

test('offers do not make bookings before confirmation', () => {
  const chloe = demoConversations.find((item) => item.id === 'conv-chloe')!;
  const giulia = demoConversations.find((item) => item.id === 'conv-giulia')!;
  assert.equal(chloe.aiFollowUp!.appointmentAction, undefined);
  assert.equal(chloe.quickReplies![0].appointmentAction, undefined);
  assert.equal(giulia.aiFollowUp!.appointmentAction, undefined);
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

test('the sample chats depend only on the clock they are given', () => {
  const zurichEvening = new Date('2026-11-18T22:30:00Z'); // 23:30 on Wednesday 18 November in Zurich
  const friday = (list: ReturnType<typeof createDemoConversations>) =>
    list.find((item) => item.id === 'conv-camille')!.aiFollowUp!.appointmentAction!.date;
  const saturday = (list: ReturnType<typeof createDemoConversations>) =>
    list.find((item) => item.id === 'conv-giulia')!.quickReplies![0].appointmentAction!.date;
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
