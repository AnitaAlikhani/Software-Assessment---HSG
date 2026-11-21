import assert from 'node:assert/strict';
import test from 'node:test';
import { appointmentAnalytics } from '../src/analytics';
import { appointmentFromConversationAction } from '../src/appointmentActions';
import { firstFreeEmployee, getAvailableSlots, validateBookingRequest, validateCalendarEvent, type AvailabilityContext } from '../src/availability';
import { chatTimeLabel } from '../src/conversationData';
import { customerStatsFromCalendar } from '../src/customerStats';
import { nextUpcomingAppointment } from '../src/dashboard';
import { demoPeople, demoWindow, salonInstant } from '../src/demoSeed';
import { createDemoWorkspace, type DemoWorkspace } from '../src/demoWorkspace';
import { accountOwner, initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData';
import { addDays, getSalonNow, startOfWeek } from '../src/scheduling';
import type { CalendarEvent } from '../src/types';
import { workingTimeOn } from '../src/workingHours';
import { salonContext } from '../server/ai';
import { FIXED_NOW } from './fixedClock';

const ZONE = 'Europe/Zurich';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const hoursOn = (date: string) => initialBookingHours.find((day) => day.day === WEEKDAYS[weekdayOf(date)])!;
const at = (date: string, time: string) => salonInstant(date, time, ZONE);

/**
 * Clocks the salon is built for: every weekday of one week (16 to 22 November 2026, Monday to
 * Sunday) just after midnight, in the morning, in the afternoon, shortly before closing and
 * late at night; plus a summer day, the night of a clock change and the turn of the year.
 */
const CLOCKS: Date[] = [
  ...Array.from({ length: 7 }, (_, day) => addDays('2026-11-16', day))
    .flatMap((date) => ['00:05', '09:00', '14:10', '17:40', '23:50'].map((time) => at(date, time))),
  at('2027-06-03', '10:30'),
  at('2026-10-25', '02:30'),
  at('2026-12-31', '23:55'),
  at('2027-01-01', '00:10'),
  FIXED_NOW,
];
const workspaces = new Map<number, DemoWorkspace>();
const workspaceAt = (now: Date): DemoWorkspace => {
  let workspace = workspaces.get(now.getTime());
  if (!workspace) {
    workspace = createDemoWorkspace(ZONE, now);
    workspaces.set(now.getTime(), workspace);
  }
  return workspace;
};
const contextOf = (workspace: DemoWorkspace, now: Date, withRequests = true): AvailabilityContext => ({
  services: initialServices, employees: initialEmployees, bookingHours: initialBookingHours,
  shiftOverview: workspace.shifts, events: workspace.events, requests: withRequests ? workspace.requests : [],
  timeZone: ZONE, now,
});
// Messages name the clock they failed at. Writing a date out is slow, so each clock is written once.
const labels = new Map<number, string>();
const label = (now: Date): string => {
  let text = labels.get(now.getTime());
  if (!text) {
    const salonNow = getSalonNow(ZONE, now);
    text = `${salonNow.date} ${salonNow.time}`;
    labels.set(now.getTime(), text);
  }
  return text;
};
const core = (event: CalendarEvent) =>
  [event.id, event.date, event.startTime, event.endTime, event.employeeId, event.serviceId, event.customerId, event.isAiBooked].join('|');

test('the same clock always gives the same salon, in separate objects', () => {
  for (const now of [FIXED_NOW, at('2026-11-18', '14:10'), at('2027-06-03', '10:30')]) {
    const first = createDemoWorkspace(ZONE, now);
    const second = createDemoWorkspace(ZONE, new Date(now.getTime()));
    assert.deepEqual(second, first, label(now));
    assert.notEqual(second.events, first.events);
    assert.notEqual(second.events[0], first.events[0]);
    // Changing one copy leaves the next build untouched.
    first.events[0].customerName = 'Changed';
    first.shifts[0].shifts[first.events[0].date] = null;
    assert.deepEqual(createDemoWorkspace(ZONE, now), second);
  }
  // The default zone is the salon's.
  assert.deepEqual(createDemoWorkspace(undefined, FIXED_NOW), createDemoWorkspace(ZONE, FIXED_NOW));
});

test('every tab opened on the same day shows the same calendar, customers, requests and shifts', () => {
  // Only what is a time of day by nature may differ: when the chats and requests came in,
  // and with them the moment at which this morning's chat booked Marie's appointment.
  const withoutClockTimes = (workspace: DemoWorkspace) => ({
    events: workspace.events.map((event) => event.id === 'cal-2' ? { ...event, createdAt: '' } : event),
    customers: workspace.customers,
    shifts: workspace.shifts,
    requests: workspace.requests.map((request) => ({ ...request, createdAt: '', timeAgo: '' })),
    conversations: workspace.conversations.map((conversation) => ({
      ...conversation, lastTime: '', lastMessageAt: '', messages: conversation.messages.map((message) => ({ ...message, time: '', sentAt: '' })),
    })),
  });
  for (const date of ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']) {
    const morning = withoutClockTimes(workspaceAt(at(date, '09:00')));
    for (const time of ['00:05', '14:10', '17:40', '23:50']) {
      assert.deepEqual(withoutClockTimes(workspaceAt(at(date, time))), morning, `${date} ${time}`);
    }
  }
  // Just after midnight "three hours ago" is shortened, so the chats of today stay chats of today.
  // (Giulia's chat also holds her booking of nine days ago: what she wrote today is its last part.)
  const night = workspaceAt(at('2026-11-19', '00:05'));
  for (const id of ['conv-sabrina', 'conv-reto', 'conv-chloe', 'conv-giulia', 'conv-marie']) {
    const conversation = night.conversations.find((item) => item.id === id)!;
    const today = conversation.messages.filter((message) => getSalonNow(ZONE, new Date(message.sentAt!)).date === '2026-11-19');
    assert.equal(today.length, id === 'conv-giulia' ? 2 : conversation.messages.length, id);
  }
  assert.deepEqual(night.conversations.map((conversation) => conversation.id),
    ['conv-sabrina', 'conv-reto', 'conv-chloe', 'conv-giulia', 'conv-marie', 'conv-lara', 'conv-john']);
});

test('the weeks that are over look the same on every later day of the week', () => {
  const tuesday = workspaceAt(at('2026-11-17', '09:00'));
  const saturday = workspaceAt(at('2026-11-21', '17:40'));
  const before = (workspace: DemoWorkspace) => workspace.events.filter((event) => event.date < '2026-11-16').map(core).sort();
  assert.ok(before(tuesday).length > 250);
  assert.deepEqual(before(saturday), before(tuesday));
});

test('no appointment overlaps another, lies outside the working hours or the opening hours, or on a closed day', () => {
  for (const now of CLOCKS) {
    const { events, shifts } = workspaceAt(now);
    const salon = { employees: initialEmployees, shiftOverview: shifts };
    assert.equal(new Set(events.map((event) => event.id)).size, events.length, `${label(now)}: ids repeat`);
    const perStylistAndDay = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const where = `${label(now)}: ${event.id}`;
      const service = initialServices.find((item) => item.id === event.serviceId)!;
      const employee = initialEmployees.find((item) => item.id === event.employeeId)!;
      assert.ok(service && employee, where);
      // Names are the current ones, the stylist offers the service, and the length is the service's.
      assert.equal(event.serviceName, service.name, where);
      assert.equal(event.staffName, employee.name, where);
      assert.ok(service.assignedEmployeeIds!.includes(employee.id), where);
      const [startHour, startMinute] = event.startTime.split(':').map(Number);
      const [endHour, endMinute] = event.endTime.split(':').map(Number);
      assert.ok(startMinute === 0 || startMinute === 30, where);
      assert.equal(endHour * 60 + endMinute - startHour * 60 - startMinute, service.durationMinutes, where);
      // An open day, inside the opening hours ...
      const hours = hoursOn(event.date);
      assert.ok(hours.isOpen, `${where} is on a closed ${hours.day}`);
      assert.ok(hours.from <= event.startTime && event.endTime <= hours.to, `${where} ${event.startTime}-${event.endTime} outside ${hours.from}-${hours.to}`);
      // ... and inside the hours the stylist works that day, also in the eight weeks that are over:
      // asked from the one rule every screen asks (the regular week, unless that day was changed).
      const shift = workingTimeOn(salon, event.employeeId!, event.date);
      assert.ok(shift && shift.start <= event.startTime && event.endTime <= shift.end, `${where} outside the working hours`);
      const list = perStylistAndDay.get(`${event.employeeId}|${event.date}`) ?? [];
      list.push(event);
      perStylistAndDay.set(`${event.employeeId}|${event.date}`, list);
    }
    for (const list of perStylistAndDay.values()) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let index = 1; index < list.length; index++) {
        assert.ok(list[index - 1].endTime <= list[index].startTime, `${label(now)}: ${list[index - 1].id} overlaps ${list[index].id}`);
      }
    }
  }
});

test('every appointment passes the rules the owner calendar applies when saving', () => {
  for (const now of [FIXED_NOW, at('2026-11-18', '14:10'), at('2026-11-21', '09:00'), at('2027-06-03', '10:30')]) {
    const workspace = workspaceAt(now);
    const today = getSalonNow(ZONE, now).date;
    // The calendar refuses dates before "today", so the past is checked as seen from before it began.
    const beforeItAll = contextOf(workspace, at(addDays(demoWindow(today).from, -1), '12:00'), false);
    const current = contextOf(workspace, now);
    for (const event of workspace.events) {
      assert.equal(validateCalendarEvent(beforeItAll, event, event.id), null, `${label(now)}: ${event.id}`);
      // What is still to come can be opened and saved again as it is.
      if (event.date > today) assert.equal(validateCalendarEvent(current, event, event.id), null, `${label(now)}: ${event.id}`);
    }
  }
});

test('every appointment has a customer record, and every customer is in the calendar, a chat or a request', () => {
  for (const now of CLOCKS) {
    const { events, customers, conversations, requests } = workspaceAt(now);
    const byId = new Map(customers.map((customer) => [customer.id, customer]));
    assert.equal(byId.size, customers.length, `${label(now)}: customer ids repeat`);
    for (const event of events) {
      const customer = byId.get(event.customerId!);
      assert.ok(customer, `${label(now)}: ${event.id} has no customer record`);
      assert.equal(event.customerName, customer.name);
      assert.equal(event.customerPhone ?? '', customer.phone);
    }
    for (const request of requests) {
      const customer = byId.get(request.customerId!);
      assert.ok(customer, `${label(now)}: ${request.id} has no customer record`);
      assert.equal(request.customerName, customer.name);
    }
    for (const conversation of conversations) {
      const customer = byId.get(conversation.customerId!);
      assert.ok(customer, `${label(now)}: ${conversation.id} has no customer record`);
      assert.equal(conversation.customerName, customer.name);
      assert.equal(conversation.phone, customer.phone);
      assert.equal(conversation.language, customer.language);
      assert.equal(customer.conversationId, conversation.id);
    }
    const known = new Set([
      ...events.map((event) => event.customerId), ...requests.map((request) => request.customerId),
      ...conversations.map((conversation) => conversation.customerId),
    ]);
    assert.deepEqual(customers.filter((customer) => !known.has(customer.id)), [], label(now));
  }
});

test('the appointments the chats talk about exist, on the weekday and at the time the chat names', () => {
  const mentioned = [
    { chat: 'conv-marie', appointment: 'cal-2', weekday: 'Thursday', start: '13:30', serviceId: 'srv-2', bookedByAi: true },
    { chat: 'conv-lara', appointment: 'cal-3', weekday: 'Friday', start: '11:00', serviceId: 'srv-3', bookedByAi: true },
    { chat: 'conv-john', appointment: 'cal-john', weekday: 'Wednesday', start: '15:00', serviceId: 'srv-2', bookedByAi: true },
    { chat: 'conv-giulia', appointment: 'cal-giulia', weekday: 'Thursday', start: '15:00', serviceId: 'srv-2', bookedByAi: false },
  ];
  for (const now of CLOCKS) {
    const { events, conversations } = workspaceAt(now);
    const salonNow = getSalonNow(ZONE, now);
    for (const expected of mentioned) {
      const where = `${label(now)}: ${expected.chat}`;
      const conversation = conversations.find((item) => item.id === expected.chat)!;
      assert.equal(conversation.appointmentId, expected.appointment, where);
      const event = events.find((item) => item.id === expected.appointment);
      assert.ok(event, `${where}: ${expected.appointment} is missing`);
      assert.equal(WEEKDAYS[weekdayOf(event.date)], expected.weekday, where);
      assert.equal(event.startTime, expected.start, where);
      assert.equal(event.serviceId, expected.serviceId, where);
      assert.equal(event.customerId, conversation.customerId, where);
      assert.equal(event.conversationId, conversation.id, where);
      assert.equal(event.isAiBooked === true, expected.bookedByAi, where);
      // The appointment follows the chat: it is on the first such weekday after the customer asked
      // (today, or nine days ago for Giulia's first booking), so it is never further away than a week
      // from that day, and it was made with the salon's confirmation in the chat.
      const confirmation = conversation.messages.find((message) => message.sender === 'owner')!;
      const askedOn = getSalonNow(ZONE, new Date(confirmation.sentAt!)).date;
      assert.ok(event.date > askedOn && event.date <= addDays(askedOn, expected.chat === 'conv-giulia' ? 16 : 7), `${where}: ${event.date} after a chat on ${askedOn}`);
      assert.equal(event.createdAt, confirmation.sentAt, where);
      // The chat shows the booking it confirmed: the same service, day, time and stylist.
      const booking = expected.chat === 'conv-giulia' ? conversation.bookingRequest!.previous! : conversation.bookingRequest!;
      assert.deepEqual([booking.date, booking.time], [event.date, event.startTime], where);
      if (expected.chat !== 'conv-giulia') {
        assert.equal(conversation.status, 'booked', where);
        assert.deepEqual([conversation.bookingRequest!.status, conversation.bookingRequest!.serviceId, conversation.bookingRequest!.employeeId], ['confirmed', event.serviceId, event.employeeId], where);
      }
    }
    // Giulia asks to move an appointment that is still to come.
    const giulia = events.find((item) => item.id === 'cal-giulia')!;
    assert.ok(`${giulia.date} ${giulia.startTime}` > `${salonNow.date} ${salonNow.time}`, label(now));
    // A chat is "booked" only with its appointment, and every chat that names one finds it: an
    // appointment of the chat's customer that names the chat in return.
    for (const conversation of conversations) {
      assert.equal(conversation.status === 'booked', Boolean(conversation.appointmentId) && conversation.bookingRequest?.status === 'confirmed', `${label(now)}: ${conversation.id}`);
      if (!conversation.appointmentId) continue;
      const event = events.find((item) => item.id === conversation.appointmentId);
      assert.ok(event, `${label(now)}: ${conversation.id}`);
      assert.equal(event.conversationId, conversation.id);
      assert.equal(event.customerId, conversation.customerId);
    }
    // The requests that wait are not in the calendar yet: the owner has not confirmed them.
    for (const id of ['conv-sabrina', 'conv-reto', 'conv-chloe']) {
      assert.equal(conversations.find((item) => item.id === id)!.appointmentId, undefined, id);
      assert.ok(!events.some((event) => event.conversationId === id), id);
    }
  }
});

test('what the chats and requests are about to book is free, whatever day and time it is', () => {
  for (const now of CLOCKS) {
    const workspace = workspaceAt(now);
    const context = contextOf(workspace, now);
    for (const request of workspace.requests) {
      assert.equal(validateBookingRequest(context, request, request.id), null, `${label(now)}: ${request.id}`);
    }
    for (const conversation of workspace.conversations) {
      const actions = [
        ...(conversation.aiFollowUp?.appointmentAction ? [{ action: conversation.aiFollowUp.appointmentAction, fromAi: true }] : []),
        ...(conversation.quickReplies ?? []).flatMap((reply) => reply.appointmentAction ? [{ action: reply.appointmentAction, fromAi: false }] : []),
      ];
      for (const { action, fromAi } of actions) {
        const appointment = appointmentFromConversationAction(action, conversation, workspace.events, initialServices, initialEmployees, fromAi);
        assert.ok(appointment, `${label(now)}: ${conversation.id}`);
        assert.equal(validateCalendarEvent(context, appointment, appointment.id), null, `${label(now)}: ${conversation.id} ${action.type} on ${action.date} at ${action.startTime}`);
      }
      // A request that waits in a chat can be confirmed as it stands, with the stylist it names.
      const request = conversation.bookingRequest;
      if (request?.status === 'requested') {
        const exclude = request.kind === 'change' ? conversation.appointmentId : undefined;
        const slots = getAvailableSlots(context, { date: request.date, serviceId: request.serviceId!, employeeId: request.employeeId ?? 'emp-1', mode: 'owner', excludeEventId: exclude });
        assert.ok(slots.includes(request.time), `${label(now)}: ${conversation.id} asks for ${request.date} ${request.time}`);
      }
    }
    // The times the owner can offer Chloé instead of 19:00 are free as well: Friday 18:00 and Saturday 11:30.
    const chloe = workspace.conversations.find((item) => item.id === 'conv-chloe')!;
    const chloeDay = getSalonNow(ZONE, new Date(chloe.lastMessageAt!)).date;
    const friday = addDays(chloeDay, ((5 - weekdayOf(chloeDay) + 6) % 7) + 1);
    const saturday = addDays(chloeDay, ((6 - weekdayOf(chloeDay) + 6) % 7) + 1);
    assert.ok(getAvailableSlots(context, { date: friday, serviceId: 'srv-2', employeeId: 'emp-1', mode: 'owner' }).includes('18:00'), `${label(now)}: Friday ${friday} 18:00`);
    assert.ok(getAvailableSlots(context, { date: saturday, serviceId: 'srv-2', employeeId: 'emp-2', mode: 'owner' }).includes('11:30'), `${label(now)}: Saturday ${saturday} 11:30`);
  }
});

test('the week plan starts without a single changed day: the regular hours carry the requests, the past and the chat\'s Saturday', () => {
  for (const now of CLOCKS) {
    const workspace = workspaceAt(now);
    const salon = { employees: initialEmployees, shiftOverview: workspace.shifts };
    // The plan holds only days that differ from somebody's regular week, and the sample salon needs none.
    assert.deepEqual(workspace.shifts.map((entry) => [entry.employeeId, entry.employeeName, Object.keys(entry.shifts).length]),
      initialEmployees.map((employee) => [employee.id, employee.name, 0]), label(now));
    const inside = (employeeId: string, date: string, start: string, end: string) => {
      const hours = workingTimeOn(salon, employeeId, date);
      return hours !== null && hours.start <= start && end <= hours.end;
    };
    // The waiting requests lie inside their stylist's hours ...
    for (const request of workspace.requests) {
      const [start, end] = request.timeStr.split(' - ');
      assert.ok(inside(request.employeeId!, request.date, start, end), `${label(now)}: ${request.id}`);
    }
    // ... the oldest appointment, eight weeks back, has working time behind it like every other one ...
    const today = getSalonNow(ZONE, now).date;
    const oldest = workspace.events.reduce((first, event) => event.date < first.date ? event : first);
    assert.ok(oldest.date < addDays(today, -49), `${label(now)}: the calendar starts on ${oldest.date}`);
    assert.ok(inside(oldest.employeeId!, oldest.date, oldest.startTime, oldest.endTime), `${label(now)}: ${oldest.id}`);
    // ... and on the Saturday that Giulia asks to move her appointment to, Selina works, at that time
    // and at the time the owner can offer Chloé; Luca works at the time Reto asks for.
    const move = workspace.conversations.find((item) => item.id === 'conv-giulia')!.bookingRequest!;
    assert.equal(WEEKDAYS[weekdayOf(move.date)], 'Saturday', label(now));
    assert.deepEqual(workingTimeOn(salon, 'emp-2', move.date), { start: '08:00', end: '16:00' }, label(now));
    assert.ok(inside('emp-2', move.date, '10:00', '10:30') && inside('emp-2', move.date, '11:30', '12:00'), label(now));
    const reto = workspace.conversations.find((item) => item.id === 'conv-reto')!.bookingRequest!;
    assert.ok(inside('emp-3', reto.date, reto.time, '09:30'), label(now));
  }
  // That Saturday is what makes the move possible: without it the rules refuse the very same change.
  const workspace = workspaceAt(FIXED_NOW);
  const giulia = workspace.conversations.find((item) => item.id === 'conv-giulia')!;
  const change = { type: 'reschedule' as const, appointmentId: giulia.appointmentId!, date: giulia.bookingRequest!.date, startTime: giulia.bookingRequest!.time };
  const moved = appointmentFromConversationAction(change, giulia, workspace.events, initialServices, initialEmployees, false)!;
  assert.equal(validateCalendarEvent(contextOf(workspace, FIXED_NOW), moved, moved.id), null);
  const noSaturday = initialEmployees.map((employee) => employee.id === 'emp-2' ? { ...employee, weeklyHours: { ...employee.weeklyHours!, sat: null } } : employee);
  assert.match(validateCalendarEvent({ ...contextOf(workspace, FIXED_NOW), employees: noSaturday }, moved, moved.id)!, /does not work on this date/);
  // The sample team is stored like anybody the owner adds: each with a regular week of their own.
  for (const employee of initialEmployees) assert.ok(employee.weeklyHours && Object.values(employee.weeklyHours).some(Boolean), employee.name);
});

test('chats and requests come in over the web on every day, never through a channel that is not connected', () => {
  for (const now of CLOCKS) {
    const { conversations, requests, customers } = workspaceAt(now);
    for (const conversation of conversations) {
      assert.equal(conversation.channel, 'Website', `${label(now)}: ${conversation.id}`);
      // The customer record remembers the same channel as the chat.
      assert.equal(customers.find((customer) => customer.id === conversation.customerId)!.channel, 'Website', conversation.id);
    }
    for (const request of requests) assert.equal(request.channel, 'Web', `${label(now)}: ${request.id}`);
    // Only the people of the chats came in through a chat; everybody else was booked at the salon or online.
    assert.equal(customers.filter((customer) => customer.channel !== undefined).length, conversations.length, label(now));
  }
  // No record, message or name in the starting data mentions the two channels that are not there.
  const everything = JSON.stringify([workspaceAt(FIXED_NOW), demoPeople()]);
  const found = /whatsapp|instagram/i.exec(everything);
  assert.equal(found && everything.slice(Math.max(0, found.index - 60), found.index + 60), null);
});

test('chats are recent, never in the future, newest first, and labelled from their time stamps', () => {
  for (const now of CLOCKS) {
    const { conversations } = workspaceAt(now);
    assert.equal(conversations[0].id, 'conv-sabrina', label(now));
    const lastTimes = conversations.map((conversation) => conversation.lastMessageAt!);
    assert.deepEqual([...lastTimes].sort().reverse(), lastTimes, `${label(now)}: not newest first`);
    for (const conversation of conversations) {
      const times = conversation.messages.map((message) => message.sentAt!);
      assert.deepEqual([...times].sort(), times, conversation.id);
      for (const message of conversation.messages) {
        assert.ok(Date.parse(message.sentAt!) <= now.getTime(), `${label(now)}: ${conversation.id} ${message.id} is in the future`);
        assert.equal(message.time, getSalonNow(ZONE, new Date(message.sentAt!)).time);
      }
      assert.equal(conversation.lastMessageAt, times[times.length - 1]);
      assert.equal(conversation.lastTime, chatTimeLabel(conversation.lastMessageAt!, now, ZONE));
      assert.ok(now.getTime() - Date.parse(conversation.lastMessageAt!) < 31 * 3_600_000, `${label(now)}: ${conversation.id} is old`);
    }
  }
  // At noon the list reads like a messenger: clock times for today, "Yesterday" for last evening.
  assert.deepEqual(workspaceAt(FIXED_NOW).conversations.map((conversation) => conversation.lastTime),
    ['11:54', '11:32', '11:18', '10:25', '09:02', 'Yesterday', 'Yesterday']);
  assert.equal(chatTimeLabel('2026-10-01T08:00:00Z', FIXED_NOW, ZONE), 'Thu 01.10.');
});

test('bookings are dated before now, the newest first, with the last AI booking on top', () => {
  for (const now of CLOCKS) {
    const { events } = workspaceAt(now);
    const created = events.map((event) => event.createdAt!);
    assert.deepEqual([...created].sort().reverse(), created, label(now));
    assert.ok(created.every((moment) => Date.parse(moment) <= now.getTime()), label(now));
    // Every booking was made on a day before the appointment.
    for (const event of events) assert.ok(event.createdAt!.slice(0, 10) < event.date, `${label(now)}: ${event.id} booked ${event.createdAt} for ${event.date}`);
  }
  // During the day the bell's "AI booked ..." is Marie's booking from this morning's chat.
  assert.equal(workspaceAt(FIXED_NOW).events.find((event) => event.isAiBooked)!.id, 'cal-2');
  assert.equal(workspaceAt(at('2026-11-18', '14:10')).events.find((event) => event.isAiBooked)!.id, 'cal-2');
});

test('the salon is filled to a believable size: about forty appointments a week and under two hundred customers', () => {
  for (const now of [FIXED_NOW, at('2026-11-18', '14:10'), at('2027-06-03', '10:30'), at('2026-12-31', '23:55')]) {
    const { events, customers } = workspaceAt(now);
    const today = getSalonNow(ZONE, now).date;
    const window = demoWindow(today);
    assert.ok(events.every((event) => event.date >= window.from && event.date <= window.to), label(now));
    assert.equal(window.from, addDays(startOfWeek(today), -56));
    assert.equal(window.to, addDays(startOfWeek(today), 27));
    // Each of the eight weeks that are over: 35 to 45 appointments, give or take two.
    for (let week = 1; week <= 8; week++) {
      const monday = addDays(startOfWeek(today), -7 * week);
      const count = events.filter((event) => event.date >= monday && event.date < addDays(monday, 7)).length;
      assert.ok(count >= 33 && count <= 47, `${label(now)}: ${count} appointments in the week of ${monday}`);
    }
    // The weeks ahead fill up as they come closer: fewer bookings the further away.
    const ahead = [1, 2, 3].map((week) => {
      const monday = addDays(startOfWeek(today), 7 * week);
      return events.filter((event) => event.date >= monday && event.date < addDays(monday, 7)).length;
    });
    assert.ok(ahead[0] > ahead[2] && ahead[2] > 0, `${label(now)}: ${ahead}`);
    assert.ok(events.length >= 370 && events.length <= 480, `${label(now)}: ${events.length} appointments`);
    assert.ok(customers.length >= 150 && customers.length <= 200, `${label(now)}: ${customers.length} customers`);
    // A mix of services and stylists, and a share booked by the AI (never colour work, which is not offered online).
    assert.ok(new Set(events.map((event) => event.serviceId)).size >= 8, label(now));
    for (const employee of initialEmployees) assert.ok(events.filter((event) => event.employeeId === employee.id).length > 50, employee.name);
    const aiShare = events.filter((event) => event.isAiBooked).length / events.length;
    assert.ok(aiShare > 0.15 && aiShare < 0.4, `${label(now)}: AI share ${aiShare}`);
    for (const event of events.filter((item) => item.isAiBooked && item.id !== 'cal-3')) {
      assert.ok(initialServices.find((service) => service.id === event.serviceId)!.onlineBooking, event.id);
    }
    // Nobody comes twice in a week, except the regulars with a weekly wash and blow-dry, once a week.
    const seen = new Set<string>();
    for (const event of events) {
      const key = `${event.customerId}|${startOfWeek(event.date)}`;
      assert.ok(!seen.has(key), `${label(now)}: ${event.customerName} twice in the week of ${startOfWeek(event.date)}`);
      seen.add(key);
    }
  }
});

test('an open day has appointments, and there is always a next one', () => {
  for (const now of CLOCKS) {
    const { events } = workspaceAt(now);
    const today = getSalonNow(ZONE, now).date;
    const todays = events.filter((event) => event.date === today);
    if (hoursOn(today).isOpen) assert.ok(todays.length >= 4, `${label(now)}: only ${todays.length} appointments today`);
    else assert.equal(todays.length, 0, label(now));
    const next = nextUpcomingAppointment(events, now, ZONE);
    assert.ok(next, label(now));
    assert.ok(next.date <= addDays(today, 3), `${label(now)}: next appointment only on ${next.date}`);
  }
});

test('tomorrow has room: where two or more stylists are on duty, one of them is free for a haircut', () => {
  for (const now of CLOCKS) {
    const workspace = workspaceAt(now);
    const context = contextOf(workspace, now);
    const today = getSalonNow(ZONE, now).date;
    let checkedDays = 0;
    for (let date = addDays(today, 1); checkedDays < 3; date = addDays(date, 1)) {
      const hours = hoursOn(date);
      if (!hours.isOpen) continue;
      checkedDays++;
      for (let minute = 8 * 60; minute < 19 * 60; minute += 30) {
        const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
        const end = `${String(Math.floor((minute + 30) / 60)).padStart(2, '0')}:${String((minute + 30) % 60).padStart(2, '0')}`;
        const onDuty = initialEmployees.filter((employee) => {
          const shift = workingTimeOn(context, employee.id, date);
          return shift && shift.start <= time && end <= shift.end && hours.from <= time && end <= hours.to;
        });
        if (onDuty.length >= 2) assert.ok(firstFreeEmployee(context, 'srv-2', date, time), `${label(now)}: nobody free on ${date} at ${time}`);
      }
      // And the booking page has something to offer, for a short and for a one-hour service.
      const free = (serviceId: string) => initialEmployees.flatMap((employee) => getAvailableSlots(context, { date, serviceId, employeeId: employee.id }));
      assert.ok(free('srv-2').length >= 8, `${label(now)}: only ${free('srv-2').length} free times for a haircut on ${date}`);
      assert.ok(free('srv-4').length >= 3, `${label(now)}: only ${free('srv-4').length} free times for a cut and blow-dry on ${date}`);
    }
  }
});

test('Home, Calendar, Customers and Analytics count the same appointments', () => {
  for (const now of [FIXED_NOW, at('2026-11-18', '14:10'), at('2026-11-21', '09:00')]) {
    const { events, customers } = workspaceAt(now);
    const today = getSalonNow(ZONE, now).date;
    const stats = customerStatsFromCalendar(customers, events, now, ZONE);
    // Home's next appointment is that customer's next appointment in Customers.
    const next = nextUpcomingAppointment(events, now, ZONE)!;
    assert.equal(stats.get(next.customerId!)!.nextAppointment!.id, next.id, label(now));
    // Every appointment is either somebody's visit or still to come: together they are the calendar.
    const visits = [...stats.values()].reduce((sum, entry) => sum + entry.visits, 0);
    const salonNow = getSalonNow(ZONE, now);
    const upcoming = events.filter((event) => `${event.date} ${event.startTime}` >= `${salonNow.date} ${salonNow.time}`);
    assert.equal(visits + upcoming.length, events.length, label(now));
    assert.equal([...stats.values()].filter((entry) => entry.nextAppointment).length, new Set(upcoming.map((event) => event.customerId)).size);
    // Analytics for today and for this month shows what the calendar holds.
    assert.equal(appointmentAnalytics(events, today, today).total, events.filter((event) => event.date === today).length);
    const month = events.filter((event) => event.date.slice(0, 7) === today.slice(0, 7));
    const analytics = appointmentAnalytics(events, `${today.slice(0, 8)}01`, `${today.slice(0, 8)}31`.replace(/31$/, String(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate())));
    assert.equal(analytics.total, month.length, label(now));
    assert.equal(analytics.customers, new Set(month.map((event) => event.customerId)).size);
    assert.equal(analytics.aiBookings, month.filter((event) => event.isAiBooked).length);
  }
});

test('people and contact details are invented, varied and never those of a team member or a stranger', () => {
  const people = demoPeople();
  const staffNames = initialEmployees.map((employee) => employee.name);
  // Unique names, and nobody is both customer and employee.
  assert.equal(new Set(people.map((person) => person.name)).size, people.length);
  assert.equal(new Set(people.map((person) => person.id)).size, people.length);
  for (const person of people) {
    assert.ok(!staffNames.includes(person.name), person.name);
    assert.ok(!initialEmployees.some((employee) => employee.phone === person.phone || (person.email && employee.email === person.email)), person.name);
  }
  // Phone numbers: the invented 555 block, each one once, no two ending on neighbouring numbers.
  // They are stored like every number, in the international form (shown as "+41 79 555 12 34").
  const phones = [...people, ...initialEmployees].map((person) => person.phone);
  for (const phone of phones) assert.match(phone, /^\+417[6-9]555\d{4}$/);
  assert.equal(new Set(phones).size, phones.length);
  const endings = phones.map((phone) => Number(phone.replace(/\D/g, '').slice(-4))).sort((a, b) => a - b);
  for (let index = 1; index < endings.length; index++) assert.ok(endings[index] - endings[index - 1] > 1, `${endings[index - 1]} and ${endings[index]}`);
  assert.ok(new Set(phones.map((phone) => phone.slice(3, 5))).size >= 3, 'the numbers use several prefixes');
  // E-mail: most customers have none; the rest use a reserved example domain. Staff use the salon's own, which is reserved too.
  const withEmail = people.filter((person) => person.email);
  assert.ok(withEmail.length > 5 && withEmail.length < people.length / 4, `${withEmail.length} of ${people.length}`);
  for (const person of withEmail) assert.match(person.email, /^[a-z]+\.[a-z]+@example\.com$/);
  assert.equal(new Set(withEmail.map((person) => person.email)).size, withEmail.length);
  for (const employee of initialEmployees) assert.match(employee.email, /^[a-z]+\.[a-z]+@bella-hair\.example$/);
  // Mostly German-speaking customers, as in St. Gallen, with the other three languages present.
  const languages = people.reduce<Record<string, number>>((count, person) => ({ ...count, [person.language]: (count[person.language] ?? 0) + 1 }), {});
  assert.ok(languages.DE / people.length > 0.7, JSON.stringify(languages));
  assert.ok(languages.FR > 0 && languages.IT > 0 && languages.EN > 0, JSON.stringify(languages));
});

test('nothing in the starting data is a placeholder, a team member\'s name or a link to somebody else\'s page', () => {
  const everything = JSON.stringify([
    workspaceAt(FIXED_NOW), demoPeople(), initialEmployees, initialServices, initialCompanySettings, initialBookingHours,
  ]);
  for (const tell of [
    // First line: the names of the people who build this app, and the people of the earlier sample
    // data. They are common names, so a longer name list could bring one back without anyone noticing.
    /Nilufar/i, /Ismayilova/i, /Atilla/i, /\bNina\b/i, /Krebs/i, /\bAnita\b/i, /Alikhani/i, /Denniese/i, /John Smith/i,
    /Sample/i, /Musterstrasse/i, /000 00 00/, /Tell customers about your salon/i, /bellahair/i, /example\.ch/i, /\.demo@/i,
    /Test visitor/i, /Telegram user/i, /https?:\/\//i, /facebook\.com|instagram\.com|x\.com/i,
  ]) {
    // Not doesNotMatch: on a failure it would print the whole data set.
    const found = tell.exec(everything);
    assert.equal(found && everything.slice(Math.max(0, found.index - 60), found.index + 60), null, String(tell));
  }
  // The profile the booking page prints: a real description, an address, and no phone or link the salon does not have.
  // Two sentences ("St. Gallen" is not the end of one).
  assert.equal(initialCompanySettings.description.replace(/St\. /g, 'St ').split('. ').length, 2);
  assert.ok(initialCompanySettings.description.length > 80);
  assert.ok(initialCompanySettings.street.trim() && initialCompanySettings.city === 'St. Gallen');
  for (const empty of ['businessPhone', 'website', 'facebook', 'xProfile', 'instagram', 'legalNote'] as const) assert.equal(initialCompanySettings[empty], '');
  // The owner is the first employee.
  assert.equal(accountOwner(initialEmployees)?.id, 'emp-1');
  assert.equal(accountOwner(initialEmployees)?.name, 'Anna Weber');
  assert.equal(accountOwner([]), null);
});

test('the service menu keeps its linked ids and names, in half-hour steps, each with somebody who offers it', () => {
  assert.ok(initialServices.length >= 8 && initialServices.length <= 10);
  assert.deepEqual(initialServices.slice(0, 3).map((service) => [service.id, service.name]),
    [['srv-1', 'Wash & blow-dry'], ['srv-2', 'Haircut'], ['srv-3', 'Colouring']]);
  assert.equal(new Set(initialServices.map((service) => service.id)).size, initialServices.length);
  assert.equal(new Set(initialServices.map((service) => service.name)).size, initialServices.length);
  for (const service of initialServices) {
    assert.equal(service.durationMinutes % 30, 0, service.name);
    assert.ok(service.priceCHF > 0 && Number.isInteger(service.priceCHF), service.name);
    assert.ok(service.description && service.category, service.name);
    assert.equal(service.assignedEmployeesCount, service.assignedEmployeeIds!.length, service.name);
    assert.ok(service.assignedEmployeeIds!.length > 0 && service.assignedEmployeeIds!.every((id) => initialEmployees.some((employee) => employee.id === id)), service.name);
  }
  // Every service offered online can be booked on every open day: somebody who offers it works then.
  for (const service of initialServices.filter((item) => item.onlineBooking)) {
    for (const day of initialBookingHours.filter((item) => item.isOpen)) {
      const weekday = (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[WEEKDAYS.indexOf(day.day)];
      assert.ok(service.assignedEmployeeIds!.some((id) => initialEmployees.find((employee) => employee.id === id)!.weeklyHours![weekday]), `${service.name} on ${day.day}`);
    }
  }
  // The salon keeps the hours of a hair salon: closed on Sunday and Monday, shorter on Saturday.
  assert.deepEqual(initialBookingHours.filter((day) => !day.isOpen).map((day) => day.day), ['Monday', 'Sunday']);
  assert.ok(initialBookingHours.find((day) => day.day === 'Saturday')!.to < initialBookingHours.find((day) => day.day === 'Friday')!.to);
});

test('the AI is told the new services, the hours of each day and the team, and no placeholder', () => {
  const context = salonContext();
  for (const service of initialServices) {
    assert.ok(context.includes(`- ${service.name}: ${service.durationMinutes} min, CHF ${service.priceCHF.toFixed(2)}.`), service.name);
  }
  assert.match(context, /a small hair salon at Tuchgasse 7, 9000 St\. Gallen\. Your tone is/);
  assert.match(context, /- Monday: closed\n- Tuesday: 08:30–18:30\n- Wednesday: 08:30–18:30\n- Thursday: 08:30–18:30\n- Friday: 08:30–18:30\n- Saturday: 08:00–16:00\n- Sunday: closed/);
  // The latest start follows each day's closing time: a haircut at 18:00 on weekdays, 15:30 on Saturday.
  assert.match(context, /- Haircut: .* Latest start 18:00 \(Tuesday to Friday\), 15:30 \(Saturday\)\./);
  assert.match(context, /- Colouring: .* Latest start 17:00 \(Tuesday to Friday\), 14:30 \(Saturday\)\. The owner books this one personally/);
  assert.match(context, /Three stylists work at the salon: Anna, Selina and Luca\./);
  for (const tell of [/Sample Service/, /Musterstrasse/, /000 00 00/, /Salon phone/, /Tell customers/, /Two stylists/, /undefined|null|NaN/]) {
    assert.doesNotMatch(context, tell);
  }
});
