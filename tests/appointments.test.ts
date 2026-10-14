import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentFromRequest, appointmentFromConversationAction, upsertAppointment } from '../src/appointmentActions';
import { addDays, addMinutes, dayKeyForDate, formatCalendarDate, formatDate, startOfWeek } from '../src/scheduling';
import { initialAppointmentRequests, initialCalendarEvents, initialServices } from '../src/mockData';
import { initialConversations } from '../src/conversationData';

test('accepting an October 1 request preserves the full date and requested time', () => {
  const event = appointmentFromRequest({ ...initialAppointmentRequests[0], timeStr: '16:00 - 16:30' }, initialServices);
  assert.equal(event.date, '2026-10-01');
  assert.equal(event.dateDisplay, 'Thu 01/10');
  assert.equal(event.day, 'thu');
  assert.equal(event.startTime, '16:00');
  assert.equal(event.endTime, '16:30');
  assert.notEqual(event.date, initialCalendarEvents.find((item) => item.day === 'thu')!.date);
});

test('appointments use the selected service duration, including 90-minute services', () => {
  const event = appointmentFromRequest({ ...initialAppointmentRequests[0], serviceId: 'srv-3', serviceName: 'Colouring', timeStr: '16:00 - 16:30' }, initialServices);
  assert.equal(event.endTime, '17:30');
  for (const hour of ['09:00', '10:00', '11:00', '13:30', '14:00', '16:00']) {
    const [h, m] = hour.split(':').map(Number);
    const expected = h * 60 + m + 30;
    assert.equal(addMinutes(hour, 30), `${String(Math.floor(expected / 60)).padStart(2, '0')}:${String(expected % 60).padStart(2, '0')}`);
  }
});

test('accepted requests retain their service identity after a service is renamed', () => {
  const services = initialServices.map((service) => service.id === 'srv-3' ? { ...service, name: 'Full Colour' } : service);
  const event = appointmentFromRequest({ ...initialAppointmentRequests[0], serviceId: 'srv-3', serviceName: 'Colouring', timeStr: '16:00 - 17:30' }, services);
  assert.equal(event.serviceId, 'srv-3');
  assert.equal(event.serviceName, 'Full Colour');
  assert.equal(event.endTime, '17:30');
});

test('owner and AI booking confirmations reference one stable appointment', () => {
  const camille = initialConversations.find((item) => item.id === 'conv-camille')!;
  const ownerAction = camille.quickReplies!.find((reply) => reply.appointmentAction)!.appointmentAction!;
  const aiAction = camille.aiFollowUp!.appointmentAction!;
  const ownerBooking = appointmentFromConversationAction(ownerAction, camille, initialCalendarEvents, initialServices, false)!;
  assert.equal(ownerBooking.date, '2026-10-09');
  assert.equal(ownerBooking.startTime, '11:00');
  assert.equal(ownerBooking.endTime, '12:30');
  const events = upsertAppointment(initialCalendarEvents, ownerBooking);
  const aiBooking = appointmentFromConversationAction(aiAction, camille, events, initialServices, true)!;
  const confirmed = upsertAppointment(events, aiBooking);
  assert.equal(confirmed.filter((item) => item.id === ownerAction.appointmentId).length, 1);
  assert.equal(confirmed.length, initialCalendarEvents.length + 1);
});

test('rescheduling Giulia moves her existing appointment without adding another', () => {
  const giulia = initialConversations.find((item) => item.id === 'conv-giulia')!;
  const action = giulia.quickReplies![0].appointmentAction!;
  const original = initialCalendarEvents.find((item) => item.id === giulia.appointmentId)!;
  const moved = appointmentFromConversationAction(action, giulia, initialCalendarEvents, initialServices, false)!;
  const events = upsertAppointment(initialCalendarEvents, moved);
  assert.equal(moved.id, original.id);
  assert.equal(moved.date, '2026-10-10');
  assert.equal(moved.day, 'sat');
  assert.equal(moved.outsideHoursApproved, true);
  assert.equal(moved.startTime, '10:00');
  assert.equal(moved.endTime, '10:30');
  assert.equal(moved.staffName, original.staffName);
  assert.equal(events.length, initialCalendarEvents.length);
  assert.equal(events.filter((item) => item.id === original.id && item.date === original.date).length, 0);
  assert.equal(appointmentFromConversationAction(action, giulia, [], initialServices, false), null);
});

test('offers do not make bookings before confirmation', () => {
  const chloe = initialConversations.find((item) => item.id === 'conv-chloe')!;
  const giulia = initialConversations.find((item) => item.id === 'conv-giulia')!;
  assert.equal(chloe.aiFollowUp!.appointmentAction, undefined);
  assert.equal(chloe.quickReplies![0].appointmentAction, undefined);
  assert.equal(giulia.aiFollowUp!.appointmentAction, undefined);
});

test('date helpers preserve calendar dates across week, year and DST boundaries', () => {
  assert.equal(formatDate('2026-10-01'), '1 October 2026');
  assert.equal(formatCalendarDate('2026-10-01'), 'Thu 01/10');
  assert.equal(dayKeyForDate('2026-10-01'), 'thu');
  assert.equal(startOfWeek('2026-10-01'), '2026-09-28');
  assert.equal(addDays('2026-10-01', 7), '2026-10-08');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
});
