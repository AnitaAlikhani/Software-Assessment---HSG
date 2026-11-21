import type { AppointmentAction, AppointmentRequest, CalendarEvent, Conversation, Employee, ServiceItem } from './types';
import { appointmentForConversation, appointmentFromRequest, appointmentIdForRequest, belongsToConversation, chatAppointmentId, requestTimes } from './appointmentActions';
import { chatBookingName } from './bookingData';
import {
  getAvailableSlots, getSalonNow, isEmployeeAssignedToService, validateCalendarEvent,
  type AvailabilityContext,
} from './availability';
import { formatDate, formatStoredTimeRange, formatTimeRange, openingHoursDay, weekdayName } from './format';
import { addDays, addMinutes, dayKeyForDate, formatCalendarDate } from './scheduling';
import { workingTimeOn } from './workingHours';
import { blockAt, blockReasonText } from './timeBlocks';

/**
 * The owner's side of a booking request: may it be accepted as it stands, to which times can it
 * be moved, and if something is in the way, what.
 *
 * A request is answered under the owner's rules, not the booking page's. The owner may accept a
 * service that is not offered online and a stylist who is hidden from the page; what still
 * counts is whether the stylist is there and free. And a request keeps the length it was made
 * with: a customer who asked for 10:00 to 10:30 gets that time, also when the owner has given
 * the service another length since.
 *
 * The slot rules themselves stay in availability.ts. This file asks them, and puts their answer
 * into words the owner can act on: what is in the way, and what to do about it.
 */

// The refusals of the slot rules (availability.ts), by what they mean. A test reads that file
// and fails when a refusal there has no wording here.
const RULE = {
  invalidDate: 'Choose a valid appointment date.',
  past: 'Choose today or a future appointment date.',
  serviceGone: 'This service no longer exists. Please choose another service.',
  serviceTiming: 'This service has an invalid duration or preparation time. Please update the service.',
  employeeInactive: 'This employee is not available. Please choose an active employee.',
  notAssigned: 'This employee does not provide the selected service.',
  closure: 'The salon is closed on this date. Please choose another date.',
  away: 'This employee is away on this date. Please choose another date or specialist.',
  closedDay: 'The salon is closed on this date.',
  noShift: 'This employee does not work on this date.',
  badShift: 'This employee’s working hours on this date are invalid.',
  badHours: 'The salon opening hours are invalid for this date.',
  shiftOutsideHours: 'This employee has no working time during the salon opening hours.',
  badAppointment: 'This employee has an appointment with invalid times. Please review the calendar.',
  badRequest: 'This employee has a pending request with invalid times. Please review the request.',
  noName: 'Enter a customer name.',
  employeeGone: 'Choose an active employee for this appointment.',
  taken: 'This time is not available. Choose a time within the employee’s working hours and the opening hours, without overlapping another booking.',
} as const;
const WRONG_LENGTH = /^Choose a valid \d+-minute slot on the same day\.$/;

/** What stands in the way of a request. */
interface Obstacle {
  why: string;
  /** What would get the request through: another time of day, another day, or neither of them. */
  wants: 'time' | 'day' | 'nothing';
  /** What the owner can change in the salon instead, as half a sentence: "give Selina Keller working hours for that day in Team". */
  or?: string;
}

const PASSED: Obstacle = { why: 'This time has passed.', wants: 'time' };
const NO_TIME: Obstacle = { why: 'This request has no valid time.', wants: 'time' };

interface Facts {
  /** The salon without the request that is being looked at. */
  context: AvailabilityContext;
  employee: Employee | null;
  staff: string;
  service: string;
  date: string;
  start: string;
  end: string;
  /** The appointment this request becomes: it never stands in its own way. */
  appointmentId: string;
}

const sameEmployee = (record: Pick<AppointmentRequest, 'employeeId' | 'staffName'>, employee: Employee): boolean =>
  record.employeeId !== undefined ? record.employeeId === employee.id : record.staffName === employee.name;

/** Why a time that the rules refuse is not free: the working hours, the opening hours, or who has it already. */
function conflict(facts: Facts): Obstacle {
  const { context, employee, staff, date, start, end } = facts;
  const clock = getSalonNow(context.timeZone, context.now ?? new Date());
  if (date === clock.date && start <= clock.time) return PASSED;
  const day = formatDate(date);
  const span = formatTimeRange(start, end);
  const shift = employee ? workingTimeOn(context, employee.id, date) : null;
  if (shift && (start < shift.start || end > shift.end)) {
    return { why: `${staff} works ${formatTimeRange(shift.start, shift.end)} on ${day}, not at ${span}.`, wants: 'time' };
  }
  const hours = context.bookingHours.find((item) => item.day === openingHoursDay(date));
  if (hours?.isOpen && (start < hours.from || end > hours.to)) {
    return { why: `The salon is open ${formatTimeRange(hours.from, hours.to)} on ${day}, not at ${span}.`, wants: 'time' };
  }
  const booked = employee ? context.events.find((event) => event.id !== facts.appointmentId && event.date === date &&
    sameEmployee(event, employee) && event.startTime < end && event.endTime > start) : undefined;
  if (booked) {
    return { why: `${staff} already has ${booked.customerName} at ${formatTimeRange(booked.startTime, booked.endTime)} on ${day}.`, wants: 'time' };
  }
  const asked = employee ? context.requests.find((other) => {
    const times = requestTimes(other);
    return other.status === 'pending' && other.date === date && sameEmployee(other, employee) && times !== null && times.start < end && times.end > start;
  }) : undefined;
  if (asked) {
    return { why: `${asked.customerName} has asked ${staff} for ${formatStoredTimeRange(asked.timeStr)} on ${day} as well.`, wants: 'time' };
  }
  // Time the owner keeps free for the stylist (a break, lunch): named with its reason.
  const blocked = employee ? blockAt(context.timeBlocks, employee.id, date, start, end) : undefined;
  if (blocked) {
    const reason = blockReasonText(blocked);
    return { why: `${staff} is not available ${formatTimeRange(blocked.startTime, blocked.endTime)} on ${day}${reason ? ` (${reason})` : ''}.`, wants: 'time' };
  }
  // What is left: the time needed before or after a neighbouring booking, or a start off the half hour.
  return { why: `${span} on ${day} is not free for ${staff}.`, wants: 'time' };
}

/** A refusal of the slot rules as an obstacle the owner understands. Null for a refusal this file does not know. */
function obstacleFor(rule: string, facts: Facts): Obstacle | null {
  const { context, staff, service, date } = facts;
  const day = formatDate(date);
  switch (rule) {
    case RULE.past: return PASSED;
    case RULE.invalidDate: return { why: 'This request has no valid date.', wants: 'time' };
    case RULE.serviceGone: return { why: `${service} is no longer one of your services.`, wants: 'nothing', or: 'add the appointment by hand in the calendar' };
    case RULE.serviceTiming: return { why: `${service} has an invalid duration or preparation time.`, wants: 'nothing', or: 'correct it in Services' };
    case RULE.employeeGone: return { why: `${staff} is no longer in your team.`, wants: 'nothing', or: 'add the appointment by hand with someone else' };
    case RULE.employeeInactive: return { why: `${staff} is set to inactive.`, wants: 'nothing', or: `set ${staff} to active in Team` };
    case RULE.notAssigned: return { why: `${staff} does not offer ${service}.`, wants: 'nothing', or: `assign ${staff} to it in Services` };
    case RULE.noName: return { why: 'This request has no customer name.', wants: 'nothing', or: 'add the appointment by hand in the calendar' };
    case RULE.closure: {
      const name = context.closedDates?.find((closure) => date >= closure.start && date <= closure.end)?.name.trim();
      return { why: `The salon is closed on ${day}${name ? ` (${name})` : ''}.`, wants: 'day' };
    }
    case RULE.closedDay: return { why: `The salon is closed on ${weekdayName(date)}s.`, wants: 'day' };
    case RULE.away: return { why: `${staff} is away on ${day}.`, wants: 'day' };
    case RULE.noShift: return { why: `${staff} does not work on ${day}.`, wants: 'day', or: `give ${staff} working hours for that day in Team` };
    case RULE.badShift: return { why: `The working hours of ${staff} on ${day} have invalid times.`, wants: 'day', or: 'correct them in Team' };
    case RULE.shiftOutsideHours: return { why: `The working hours of ${staff} on ${day} lie outside the opening hours.`, wants: 'day', or: 'change them in Team' };
    case RULE.badHours: return { why: `The opening hours for ${weekdayName(date)}s have invalid times.`, wants: 'day', or: 'correct them in Settings' };
    case RULE.badAppointment: return { why: `${staff} has an appointment with invalid times on ${day}.`, wants: 'day', or: 'correct that appointment in the calendar' };
    case RULE.badRequest: return { why: `${staff} has another request with invalid times on ${day}.`, wants: 'day', or: 'reject that request first' };
    case RULE.taken: return conflict(facts);
    default: return WRONG_LENGTH.test(rule) ? NO_TIME : null;
  }
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Two sentences: what is in the way, and what the owner can do. A request on Home can be moved
 * or rejected. (A chat's request has answers of its own: see adviseChat.)
 */
function advise(found: Obstacle): string {
  const elsewhere = found.wants === 'time' ? 'a new time' : 'another day';
  const steps = found.wants === 'nothing' ? [found.or, 'reject the request'] : [`move the request to ${elsewhere}`, found.or ?? 'reject it'];
  return `${found.why} ${capital(steps.filter(Boolean).join(', or '))}.`;
}

const serviceOf = (services: ServiceItem[], request: Pick<AppointmentRequest, 'serviceId' | 'serviceName'>): ServiceItem | undefined =>
  request.serviceId !== undefined ? services.find((item) => item.id === request.serviceId) : services.find((item) => item.name === request.serviceName);

const employeeOf = (employees: Employee[], request: Pick<AppointmentRequest, 'employeeId' | 'staffName'>): Employee | null => {
  const matching = request.employeeId !== undefined
    ? employees.filter((item) => item.id === request.employeeId)
    : employees.filter((item) => item.name === request.staffName);
  return matching.length === 1 ? matching[0] : null;
};

/**
 * The salon as an answer to this request has to see it: without the request itself, which holds
 * its own time, and with the service as long as the request was made for.
 */
const salonFor = (context: AvailabilityContext, request: AppointmentRequest, service: ServiceItem, minutes: number): AvailabilityContext => ({
  ...context,
  requests: context.requests.filter((item) => item.id !== request.id),
  services: context.services.map((item) => item.id === service.id ? { ...item, durationMinutes: minutes } : item),
});

function requestObstacle(context: AvailabilityContext, request: AppointmentRequest): Obstacle | string | null {
  const times = requestTimes(request);
  if (!times) return NO_TIME;
  const clock = getSalonNow(context.timeZone, context.now ?? new Date());
  if (`${request.date} ${times.start}` < `${clock.date} ${clock.time}`) return PASSED;
  const service = serviceOf(context.services, request);
  const employee = employeeOf(context.employees, request);
  const appointmentId = appointmentIdForRequest(request.id);
  const facts: Facts = {
    context, employee, appointmentId,
    staff: employee?.name ?? (request.staffName?.trim() || 'The employee'),
    service: service?.name ?? request.serviceName,
    date: request.date, start: times.start, end: times.end,
  };
  if (!service) return obstacleFor(RULE.serviceGone, facts);
  // A request stored long ago can name nobody: there is nobody to check the time for.
  if (!employee && request.employeeId === undefined && !request.staffName?.trim()) {
    return { why: 'This request names no stylist.', wants: 'nothing', or: 'add the appointment by hand in the calendar' };
  }
  if (!employee) return obstacleFor(RULE.employeeGone, facts);
  const salon = salonFor(context, request, service, times.minutes);
  const rule = validateCalendarEvent(salon, appointmentFromRequest(request, context.services, context.employees), appointmentId);
  if (!rule) return null;
  // A refusal without a wording here is still a true reason: it is shown as the rules give it.
  return obstacleFor(rule, { ...facts, context: salon }) ?? rule;
}

export interface RequestCheck {
  /** Null when the request can be accepted as it stands. Otherwise why not, and what the owner can do. */
  refusal: string | null;
  /** The first half of the refusal alone: what is in the way. For places that give their own advice. */
  why: string | null;
  /** False when no other time would help either: the service or the stylist is gone, or no longer offers it. */
  movable: boolean;
}

/** Whether the owner can accept a request now, under the owner's rules and with the request's own length. */
export function checkRequest(context: AvailabilityContext, request: AppointmentRequest): RequestCheck {
  const found = requestObstacle(context, request);
  if (found === null) return { refusal: null, why: null, movable: true };
  if (typeof found === 'string') return { refusal: found, why: found, movable: true };
  return { refusal: advise(found), why: found.why, movable: found.wants !== 'nothing' };
}

/** Why a request cannot be accepted, or null when it can. */
export const requestRefusal = (context: AvailabilityContext, request: AppointmentRequest): string | null =>
  checkRequest(context, request).refusal;

/** The times on a day to which the owner can move a request: its own stylist, its own length. */
export function freeStartsForRequest(context: AvailabilityContext, request: AppointmentRequest, date: string): string[] {
  const times = requestTimes(request);
  const service = serviceOf(context.services, request);
  const employee = employeeOf(context.employees, request);
  if (!times || !service || !employee) return [];
  return getAvailableSlots(salonFor(context, request, service, times.minutes), {
    date, serviceId: service.id, employeeId: employee.id, mode: 'owner',
  });
}

/** The first day from `from` on, within 90 days, on which the request's stylist has a free time for it. */
export function nextFreeDayForRequest(context: AvailabilityContext, request: AppointmentRequest, from: string): string | null {
  // One clock for the whole search, so that every day is judged at the same moment.
  const salon = { ...context, now: context.now ?? new Date() };
  for (let offset = 0; offset < 90; offset++) {
    const date = addDays(from, offset);
    if (freeStartsForRequest(salon, request, date).length > 0) return date;
  }
  return null;
}

/** The request at another time. It keeps its length, whatever length the service has today. */
export function movedRequest(request: AppointmentRequest, date: string, startTime: string): AppointmentRequest {
  const minutes = requestTimes(request)?.minutes ?? 30;
  const { movedFrom, ...rest } = request;
  const moved: AppointmentRequest = { ...rest, date, dateStr: formatDate(date), timeStr: `${startTime} - ${addMinutes(startTime, minutes)}` };
  // What the customer asked for stays with the request, however often the salon moves it. Back at
  // that time, nothing is moved any more.
  const asked = movedFrom ?? { date: request.date, timeStr: request.timeStr };
  return asked.date === moved.date && asked.timeStr === moved.timeStr ? moved : { ...moved, movedFrom: asked };
}

/**
 * How the appointment that an acceptance created stands now, compared with the request it came
 * from: 'same', 'changed' (the owner moved or edited it in the calendar since) or 'gone' (it was
 * cancelled there). The card on Home and its Undo follow this: what the owner is offered to tell
 * the customer must be the appointment as it is, and Undo must not throw a later change away.
 */
export function acceptedAppointmentState(request: AppointmentRequest, appointment: CalendarEvent | undefined): 'same' | 'changed' | 'gone' {
  if (!appointment) return 'gone';
  const asked = requestTimes(request);
  const same = asked !== null && appointment.date === request.date && appointment.startTime === asked.start && appointment.endTime === asked.end
    && (request.employeeId === undefined || appointment.employeeId === request.employeeId)
    && (request.serviceId === undefined ? appointment.serviceName === request.serviceName : appointment.serviceId === request.serviceId);
  return same ? 'same' : 'changed';
}

// ---------- booking requests that wait in a chat ----------

/** A booking request the AI collected in a chat. */
export type ChatBooking = NonNullable<Conversation['bookingRequest']>;
/** A chat's request to cancel the appointment that was confirmed in it. */
export type ChatCancellation = NonNullable<Conversation['cancellationRequest']>;

// Lives in appointmentActions.ts, where the rule for a chat's appointment needs it; kept here for its callers.
export { chatAppointmentId };

/** What of a chat the answers to its requests read. */
export type ChatForBooking = Pick<Conversation, 'id' | 'bookingRequest'> & Partial<Pick<Conversation, 'customerName' | 'customerId' | 'appointmentId' | 'cancellationRequest'>>;

export interface ChatBookingPlan {
  conversationId: string;
  booking: ChatBooking;
  /** The service's id in the salon's list. Null when the service is gone. */
  serviceId: string | null;
  /** Who the appointment is for: the chat's fuller name where the AI noted a first name only. */
  customerName: string;
  /** The service by the salon's own name; what the chat called it when the salon no longer has it. */
  serviceName: string;
  /** When the appointment would end. Null when the service is gone. */
  endTime: string | null;
  /**
   * Who takes it when the owner confirms as it stands: the stylist the customer asked for, else
   * the first who offers the service and is free. Null when it cannot be confirmed as it stands.
   */
  employee: Employee | null;
  /** Everybody who offers the service and is free at that time: the owner may give it to any of them. */
  freeEmployees: Employee[];
  /** The stylist the customer asked for, by the salon's record where it still has one. */
  asked: { name: string; employee: Employee | null } | null;
  /** For a change: the appointment that moves, while it is in the calendar. */
  previous: CalendarEvent | null;
  /**
   * The appointment this chat already holds at the time asked for (booked by hand from the chat,
   * or confirmed before): Confirm then only answers the request and books nothing a second time.
   */
  held: CalendarEvent | null;
  /** The booking that "Confirm" makes as it stands. Null when it cannot be made. */
  action: AppointmentAction | null;
  /** What was checked, in plain words, when it can be confirmed. */
  checked: string | null;
  /** Why it cannot be confirmed as it stands, and what the owner can do. Null when it can. */
  refusal: string | null;
  /** False when no other time would help either: the service is gone, or nobody offers it. */
  movable: boolean;
}

/** "a", "a, or b", "a, b, or c". */
const orList = (steps: (string | undefined)[]): string => {
  const given = steps.filter((step): step is string => Boolean(step));
  return given.length <= 2 ? given.join(', or ') : `${given.slice(0, -1).join(', ')}, or ${given[given.length - 1]}`;
};

/** What is in the way of a chat's request, and the owner's ways out: another time, the salon's settings, or declining. */
const adviseChat = (found: Obstacle): string =>
  `${found.why} ${capital(orList([found.wants === 'nothing' ? undefined : found.wants === 'time' ? 'suggest another time' : 'suggest another day', found.or, 'decline']))}.`;

const findService = (services: ServiceItem[], booking: Pick<ChatBooking, 'serviceId' | 'service'>): ServiceItem | undefined =>
  booking.serviceId !== undefined
    ? services.find((item) => item.id === booking.serviceId)
    // A chat stored before the server sent ids names the service only.
    : services.find((item) => item.name.toLowerCase() === booking.service.trim().toLowerCase());

/** The appointment a change or a cancellation is about: the one at that time that was booked in this chat. */
function chatAppointmentAt(chat: ChatForBooking, events: CalendarEvent[], at: { date: string; time: string }): CalendarEvent | null {
  const own = { id: chat.id, customerId: chat.customerId, appointmentId: chat.appointmentId, bookingRequest: chat.bookingRequest };
  const ofChat = (event: CalendarEvent) => event.conversationId === chat.id || (event.id === chat.appointmentId && belongsToConversation(event, own));
  // Moved in the calendar since: the chat's own appointment is still the one meant.
  return events.find((event) => ofChat(event) && event.date === at.date && event.startTime === at.time) ?? appointmentForConversation(own, events);
}

/**
 * The appointment a chat already holds at the day and start time of its request: one booked in
 * this chat, or one with the id that confirming the request gives it. The appointment a change
 * moves away from never counts: it is what the request wants to leave.
 */
export function heldByChat(
  chat: Pick<ChatForBooking, 'id'>, events: CalendarEvent[], booking: Pick<ChatBooking, 'date' | 'time' | 'serviceId' | 'service'>, previous: CalendarEvent | null = null,
): CalendarEvent | null {
  const confirmingId = chatAppointmentId(chat.id, booking);
  // Only the service asked for: Confirm tells the customer that this service is booked. Another
  // service at that time is just an appointment the stylist has, and the card says so as usual.
  const sameService = (event: CalendarEvent) => booking.serviceId !== undefined
    ? event.serviceId === booking.serviceId
    : event.serviceName.trim().toLowerCase() === booking.service.trim().toLowerCase();
  return events.find((event) => (event.conversationId === chat.id || event.id === confirmingId)
    && event.id !== previous?.id && event.date === booking.date && event.startTime === booking.time && sameService(event)) ?? null;
}

/** The salon as a chat's request has to see it: the appointment a change moves away from holds no time. */
const salonForChat = (context: AvailabilityContext, previous: CalendarEvent | null): AvailabilityContext =>
  previous ? { ...context, events: context.events.filter((event) => event.id !== previous.id) } : context;

const offersService = (service: ServiceItem) => (employee: Employee) => employee.status === 'Active' && isEmployeeAssignedToService(service, employee);

/**
 * What answering a chat's booking request would do: who takes it, what is in the way, what
 * "Confirm" books. Null for a chat without a waiting request. The server knows the opening hours
 * only; whether a stylist is free is decided here, by the rules of every booking the owner makes.
 */
export function planChatBooking(context: AvailabilityContext, conversation: ChatForBooking): ChatBookingPlan | null {
  const booking = conversation.bookingRequest;
  if (!booking || booking.status !== 'requested') return null;
  const customerName = chatBookingName(conversation.customerName ?? booking.customerName, booking.customerName);
  const previous = booking.kind === 'change' && booking.previous ? chatAppointmentAt(conversation, context.events, booking.previous) : null;
  const askedName = (booking.employeeId !== undefined ? context.employees.find((item) => item.id === booking.employeeId)?.name : undefined) ?? booking.staffName?.trim();
  const askedEmployee = booking.employeeId !== undefined
    ? context.employees.find((item) => item.id === booking.employeeId) ?? null
    : askedName ? employeeOf(context.employees, { staffName: askedName }) : null;
  const asked = askedName ? { name: askedName, employee: askedEmployee } : null;
  const empty = { conversationId: conversation.id, booking, customerName, previous, asked, held: null, freeEmployees: [] as Employee[], employee: null, action: null, checked: null };

  const service = findService(context.services, booking);
  if (!service) {
    return {
      ...empty, serviceId: null, serviceName: booking.service, endTime: null, movable: false,
      refusal: adviseChat({ why: `"${booking.service}" is no longer one of your services.`, wants: 'nothing', or: 'add the appointment by hand in the calendar' }),
    };
  }
  const endTime = addMinutes(booking.time, service.durationMinutes);
  const appointmentId = chatAppointmentId(conversation.id, booking);
  const refuse = (found: Obstacle, freeEmployees: Employee[] = []): ChatBookingPlan => ({
    ...empty, serviceId: service.id, serviceName: service.name, endTime, freeEmployees, refusal: adviseChat(found), movable: found.wants !== 'nothing',
  });
  const clock = getSalonNow(context.timeZone, context.now ?? new Date());
  if (`${booking.date} ${booking.time}` <= `${clock.date} ${clock.time}`) return refuse(PASSED);

  // The owner may have booked the time already (by hand, from the chat's "Book"). Looking for a
  // stylist then would offer a second appointment for the same customer at the same time.
  const held = heldByChat(conversation, context.events, booking, previous);
  if (held) {
    return {
      ...empty, serviceId: service.id, serviceName: service.name, endTime: held.endTime, held,
      employee: context.employees.find((item) => item.id === held.employeeId) ?? null,
      refusal: null, movable: true,
      checked: `${held.staffName} already has ${held.customerName} at that time in your calendar.`,
    };
  }

  const salon = salonForChat(context, previous);
  const offering = context.employees.filter(offersService(service));
  if (offering.length === 0) return refuse({ why: `Nobody in your team offers ${service.name}.`, wants: 'nothing', or: 'assign someone to it in Services' });
  const freeEmployees = offering.filter((employee) => getAvailableSlots(salon, {
    date: booking.date, serviceId: service.id, employeeId: employee.id, mode: 'owner', excludeEventId: appointmentId,
  }).includes(booking.time));

  /** The appointment as it would be with this stylist, for the slot rules to judge. */
  const withStylist = (employee: Employee): Omit<CalendarEvent, 'id'> => ({
    customerName: customerName.trim() || 'Customer', serviceId: service.id, serviceName: service.name,
    employeeId: employee.id, staffName: employee.name, date: booking.date, day: dayKeyForDate(booking.date),
    dateDisplay: formatCalendarDate(booking.date), startTime: booking.time, endTime, colorTheme: 'purple',
  });
  const factsFor = (employee: Employee): Facts => ({
    context: salon, employee, staff: employee.name, service: service.name, date: booking.date, start: booking.time, end: endTime, appointmentId,
  });
  // Reasons that hold for the whole salon, whoever would take it.
  const WHOLE_SALON: string[] = [RULE.closure, RULE.closedDay, RULE.past, RULE.invalidDate, RULE.badHours, RULE.serviceTiming];
  /** Why this stylist cannot take it, in the words of the slot rules, and whether that holds for everybody. */
  const whyNot = (employee: Employee): { found: Obstacle; everybody: boolean } => {
    const rule = validateCalendarEvent(salon, withStylist(employee), appointmentId);
    const found = (rule ? obstacleFor(rule, factsFor(employee)) : null) ?? { why: `${employee.name} is not free then.`, wants: 'time' as const };
    return { found, everybody: WHOLE_SALON.includes(rule ?? '') };
  };
  const when = `${formatDate(booking.date)} at ${formatTimeRange(booking.time, endTime)}`;

  // The customer named a stylist: confirmed as it stands, it is theirs. Somebody else only when the owner chooses so.
  if (asked) {
    const free = asked.employee ? freeEmployees.find((employee) => employee.id === asked.employee!.id) : undefined;
    if (!free) {
      const { found, everybody } = asked.employee ? whyNot(asked.employee) : { found: { why: `${asked.name} is no longer in your team.`, wants: 'time' as const }, everybody: false };
      // A reason that holds for the whole salon (it is closed that day) is said on its own.
      if (everybody) return refuse(found);
      const others = freeEmployees.length > 0
        ? `${freeEmployees.map((employee) => employee.name).join(', ')} ${freeEmployees.length === 1 ? 'is' : 'are'} free then.`
        : `Nobody else who offers ${service.name} is free then either.`;
      const steps = freeEmployees.length > 0
        ? `Confirm with ${freeEmployees.length === 1 ? freeEmployees[0].name : 'one of them'}, suggest another time, or decline.`
        : `${capital(orList([found.wants === 'day' ? 'suggest another day' : 'suggest another time', found.or, 'decline']))}.`;
      return {
        ...empty, serviceId: service.id, serviceName: service.name, endTime, freeEmployees, movable: true,
        refusal: `${customerName} asked for ${asked.name}. ${found.why} ${others} ${steps}`,
      };
    }
  }
  // A change stays with the stylist of the appointment where that one is free; otherwise the first who is.
  const employee = (asked?.employee ? freeEmployees.find((item) => item.id === asked.employee!.id) : undefined)
    ?? (previous ? freeEmployees.find((item) => item.id === previous.employeeId) : undefined)
    ?? freeEmployees[0] ?? null;
  if (employee) {
    const plan = { ...empty, serviceId: service.id, serviceName: service.name, endTime, freeEmployees, employee, refusal: null, movable: true };
    return {
      ...plan,
      action: chatBookingAction(plan, employee.id),
      checked: `${asked ? `${employee.name}, whom ${customerName} asked for,` : employee.name} is free then. Checked against the opening hours, the working hours, time off and your calendar.`,
    };
  }
  // Nobody is free. A reason that holds for the whole salon (it is closed, the time has passed)
  // is named. Otherwise each stylist has a reason of their own, and the sentence says the sum of them.
  const first = whyNot(offering[0]);
  return refuse(first.everybody ? first.found : { why: `Nobody who offers ${service.name} is free on ${when}.`, wants: 'time' });
}

/**
 * What "Confirm" books with a stylist: the new appointment, or for a change that stays with the
 * stylist of the appointment, that appointment moved to the new time. Null when this stylist is
 * not free then, or the service is gone.
 */
export function chatBookingAction(plan: Pick<ChatBookingPlan, 'conversationId' | 'booking' | 'serviceId' | 'freeEmployees' | 'previous'>, employeeId: string): AppointmentAction | null {
  const { booking, previous, serviceId } = plan;
  if (!serviceId || !plan.freeEmployees.some((employee) => employee.id === employeeId)) return null;
  if (previous && previous.employeeId === employeeId && previous.serviceId === serviceId) {
    return { type: 'reschedule', appointmentId: previous.id, date: booking.date, startTime: booking.time };
  }
  return { type: 'book', appointmentId: chatAppointmentId(plan.conversationId, booking), date: booking.date, startTime: booking.time, serviceId, employeeId };
}

/** A free time the owner can suggest instead: the day, the start, the end, and who would take it. */
export interface ChatTimeOption {
  date: string;
  time: string;
  endTime: string;
  employee: Employee;
}

/**
 * The free times on one day for a chat's request: its service, its length, and the stylist the
 * customer asked for where that one still offers it (else anybody who does). Each time with the
 * stylist who would take it: the one asked for, else the one of the appointment a change moves,
 * else the first who is free. The time asked for itself is left out: it is what is being answered.
 */
export function chatTimeOptionsOn(context: AvailabilityContext, conversation: ChatForBooking, date: string): ChatTimeOption[] {
  const booking = conversation.bookingRequest;
  if (!booking) return [];
  const service = findService(context.services, booking);
  if (!service) return [];
  const previous = booking.kind === 'change' && booking.previous ? chatAppointmentAt(conversation, context.events, booking.previous) : null;
  const salon = salonForChat(context, previous);
  const offering = context.employees.filter(offersService(service));
  const asked = booking.employeeId !== undefined
    ? offering.find((employee) => employee.id === booking.employeeId)
    : booking.staffName?.trim() ? offering.find((employee) => employee.name === booking.staffName!.trim()) : undefined;
  const preferred = previous ? offering.find((employee) => employee.id === previous.employeeId) : undefined;
  const people = asked ? [asked] : [...(preferred ? [preferred] : []), ...offering.filter((employee) => employee !== preferred)];
  const appointmentId = chatAppointmentId(conversation.id, booking);
  const byTime = new Map<string, Employee>();
  for (const employee of people) {
    for (const time of getAvailableSlots(salon, { date, serviceId: service.id, employeeId: employee.id, mode: 'owner', excludeEventId: appointmentId })) {
      if (!byTime.has(time)) byTime.set(time, employee);
    }
  }
  const clock = getSalonNow(context.timeZone, context.now ?? new Date());
  return [...byTime.entries()]
    .filter(([time]) => !(date === booking.date && time === booking.time) && `${date} ${time}` > `${clock.date} ${clock.time}`)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, employee]) => ({ date, time, endTime: addMinutes(time, service.durationMinutes), employee }));
}

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/**
 * The free times nearest to the one asked for, in the order of the day: first on the day asked
 * for (the closest to the time asked for), then on the days around it, alternately after and
 * before, never before today. At most two from each other day, so the choice spans a few days.
 */
export function nearestChatTimes(context: AvailabilityContext, conversation: ChatForBooking, count = 4): ChatTimeOption[] {
  const booking = conversation.bookingRequest;
  if (!booking) return [];
  // One clock for the whole search, so that every day is judged at the same moment.
  const salon = { ...context, now: context.now ?? new Date() };
  const today = getSalonNow(salon.timeZone, salon.now).date;
  const asked = minutesOf(booking.time);
  const closest = (options: ChatTimeOption[]) => [...options].sort((a, b) => Math.abs(minutesOf(a.time) - asked) - Math.abs(minutesOf(b.time) - asked) || a.time.localeCompare(b.time));
  const found: ChatTimeOption[] = [];
  const start = booking.date < today ? today : booking.date;
  found.push(...closest(chatTimeOptionsOn(salon, conversation, start)).slice(0, count));
  for (let offset = 1; offset <= 21 && found.length < count; offset++) {
    for (const date of [addDays(start, offset), addDays(start, -offset)]) {
      if (date < today || found.length >= count) continue;
      found.push(...closest(chatTimeOptionsOn(salon, conversation, date)).slice(0, Math.min(2, count - found.length)));
    }
  }
  return found.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export interface ChatCancellationPlan {
  request: ChatCancellation;
  /** The appointment that would leave the calendar. Null when it is not in the calendar (any more). */
  appointment: CalendarEvent | null;
  customerName: string;
}

/** What agreeing to a chat's cancellation request would take out of the calendar. Null for a chat without one. */
export function planChatCancellation(context: Pick<AvailabilityContext, 'events'>, conversation: ChatForBooking): ChatCancellationPlan | null {
  const request = conversation.cancellationRequest;
  if (!request) return null;
  const appointment = chatAppointmentAt(conversation, context.events, request);
  return { request, appointment, customerName: appointment?.customerName ?? conversation.customerName ?? '' };
}

/** Tests only: the wording for one refusal of the slot rules, for a request on Home. Null when there is none. */
export function wordingForRule(rule: string, facts: Omit<Facts, 'appointmentId'>): string | null {
  const found = obstacleFor(rule, { ...facts, appointmentId: '' });
  return found ? advise(found) : null;
}

/**
 * The chat an appointment saved from the form is linked to: the chat whose "Book" opened this very
 * form, and only when the form still books that chat's customer. A customer changed inside the
 * form is somebody else's appointment, so it gets no link.
 */
export function chatOfFormBooking(
  link: { opening: number; conversationId: string; customerId: string } | null,
  opening: number | undefined,
  save: { appointmentId: string | null; customer: { id: string } | null },
): string | undefined {
  if (!link || opening === undefined || link.opening !== opening) return undefined;
  if (save.appointmentId !== null || save.customer?.id !== link.customerId) return undefined;
  return link.conversationId;
}

/**
 * How to put a confirmed chat booking back into the calendar after its appointment was removed
 * there: the confirmed request read as a new one that waits, with the stylist it was confirmed
 * with, under the usual rules. Sends nothing; the customer has the confirmation already.
 * Gives the booking to make, or why it cannot be made as it stands.
 */
export function restoreConfirmedBooking(context: AvailabilityContext, conversation: ChatForBooking): { action: AppointmentAction } | { error: string } {
  const booking = conversation.bookingRequest;
  if (!booking || booking.status !== 'confirmed') return { error: 'This chat has no confirmed booking.' };
  // The confirmed appointment is still there (also when it was moved in the calendar and kept its
  // id): adding it again would book the customer twice.
  if (appointmentForConversation(conversation, context.events)) return { error: 'This appointment is in your calendar already.' };
  const { previous: _previous, ...rest } = booking;
  const plan = planChatBooking(context, { ...conversation, bookingRequest: { ...rest, status: 'requested', kind: 'new' } });
  if (plan?.held) return { error: 'This appointment is in your calendar already.' };
  const action = plan?.employee ? chatBookingAction(plan, plan.employee.id) : null;
  if (action) return { action };
  // The card's advice (suggest another time, decline) does not fit here: only the reason stays.
  const why = (plan?.refusal ?? 'This time is not free.').split(/(?<=\.)\s+/)
    .filter((sentence) => !/^(Suggest|Confirm|Decline|Assign|Add)\b|, or decline\.$/.test(sentence)).join(' ');
  return { error: why };
}
