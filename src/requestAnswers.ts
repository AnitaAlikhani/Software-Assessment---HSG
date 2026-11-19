import type { AppointmentAction, AppointmentRequest, CalendarEvent, Conversation, Employee, ServiceItem } from './types';
import { appointmentFromRequest, appointmentIdForRequest, requestTimes } from './appointmentActions';
import {
  firstFreeEmployee, getAvailableSlots, getSalonNow, isEmployeeAssignedToService, validateCalendarEvent,
  type AvailabilityContext,
} from './availability';
import { formatDate, formatStoredTimeRange, formatTimeRange, openingHoursDay, weekdayName } from './format';
import { addDays, addMinutes, dayKeyForDate, formatCalendarDate } from './scheduling';

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
  noShift: 'This employee has no shift on this date.',
  badShift: 'This employee has an invalid shift on this date.',
  badHours: 'The salon opening hours are invalid for this date.',
  shiftOutsideHours: 'This employee has no working time during the salon opening hours.',
  badAppointment: 'This employee has an appointment with invalid times. Please review the calendar.',
  badRequest: 'This employee has a pending request with invalid times. Please review the request.',
  noName: 'Enter a customer name.',
  employeeGone: 'Choose an active employee for this appointment.',
  taken: 'This time is not available. Choose a slot within the employee’s shift and salon hours, without overlapping another booking.',
} as const;
const WRONG_LENGTH = /^Choose a valid \d+-minute slot on the same day\.$/;

/** What stands in the way of a request. */
interface Obstacle {
  why: string;
  /** What would get the request through: another time of day, another day, or neither of them. */
  wants: 'time' | 'day' | 'nothing';
  /** What the owner can change in the salon instead, as half a sentence: "add a shift for Selina Keller in Team". */
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

/** Why a time that the rules refuse is not free: the shift, the opening hours, or who has it already. */
function conflict(facts: Facts): Obstacle {
  const { context, employee, staff, date, start, end } = facts;
  const clock = getSalonNow(context.timeZone, context.now ?? new Date());
  if (date === clock.date && start <= clock.time) return PASSED;
  const day = formatDate(date);
  const span = formatTimeRange(start, end);
  const shift = employee ? context.shiftOverview.find((entry) => entry.employeeId === employee.id)?.shifts[date] : null;
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
    case RULE.noShift: return { why: `${staff} has no shift on ${day}.`, wants: 'day', or: `add a shift for ${staff} in Team` };
    case RULE.badShift: return { why: `The shift of ${staff} on ${day} has invalid times.`, wants: 'day', or: 'correct the shift in Team' };
    case RULE.shiftOutsideHours: return { why: `The shift of ${staff} on ${day} lies outside the opening hours.`, wants: 'day', or: 'change the shift in Team' };
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
 * or rejected. One that waits in a chat can only be talked about there: the server has no way
 * yet to move or decline it.
 */
function advise(found: Obstacle, source: 'request' | 'chat'): string {
  const elsewhere = found.wants === 'time' ? 'a new time' : 'another day';
  const steps = source === 'request'
    ? found.wants === 'nothing' ? [found.or, 'reject the request'] : [`move the request to ${elsewhere}`, found.or ?? 'reject it']
    : found.wants === 'nothing' ? [found.or, 'open the chat to agree something else'] : [`open the chat to agree ${elsewhere}`, found.or];
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
  return { refusal: advise(found, 'request'), why: found.why, movable: found.wants !== 'nothing' };
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
  return { ...request, date, dateStr: formatDate(date), timeStr: `${startTime} - ${addMinutes(startTime, minutes)}` };
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

/** The id of the appointment a chat's booking request becomes: the same for every try, so a second one cannot book twice. */
export const chatAppointmentId = (conversationId: string, booking: Pick<ChatBooking, 'date' | 'time'>): string =>
  `live-appt-${conversationId}-${booking.date}-${booking.time.replace(':', '')}`;

export interface ChatBookingPlan {
  booking: ChatBooking;
  /** The service by the salon's own name; what the chat called it when the salon no longer has it. */
  serviceName: string;
  /** When the appointment would end. Null when the service is gone. */
  endTime: string | null;
  /** Who would take it. The customer named nobody: it is the first stylist who offers the service and is free. */
  employee: Employee | null;
  /** The booking that "Accept" makes. Null when it cannot be made. */
  action: Extract<AppointmentAction, { type: 'book' }> | null;
  /** Why it cannot be made, and what the owner can do. Null when it can. */
  refusal: string | null;
}

/**
 * What accepting a chat's booking request would do. Null for a chat without a waiting request.
 * The server has checked the request against the opening hours only; whether a stylist is free
 * is decided here, by the same rules as every booking the owner makes.
 */
export function planChatBooking(context: AvailabilityContext, conversation: Pick<Conversation, 'id' | 'bookingRequest'>): ChatBookingPlan | null {
  const booking = conversation.bookingRequest;
  if (!booking || booking.status !== 'requested') return null;
  // The server sends the service's id. A chat stored before it did names the service only.
  const service = booking.serviceId !== undefined
    ? context.services.find((item) => item.id === booking.serviceId)
    : context.services.find((item) => item.name.toLowerCase() === booking.service.trim().toLowerCase());
  if (!service) {
    return {
      booking, serviceName: booking.service, endTime: null, employee: null, action: null,
      refusal: advise({ why: `"${booking.service}" is no longer one of your services.`, wants: 'nothing', or: 'add the appointment by hand in the calendar' }, 'chat'),
    };
  }
  const endTime = addMinutes(booking.time, service.durationMinutes);
  const appointmentId = chatAppointmentId(conversation.id, booking);
  const plan = (employee: Employee | null, refusal: string | null): ChatBookingPlan => ({
    booking, serviceName: service.name, endTime, employee, refusal,
    action: employee && !refusal
      ? { type: 'book', appointmentId, date: booking.date, startTime: booking.time, serviceId: service.id, employeeId: employee.id }
      : null,
  });
  const clock = getSalonNow(context.timeZone, context.now ?? new Date());
  if (`${booking.date} ${booking.time}` < `${clock.date} ${clock.time}`) return plan(null, advise(PASSED, 'chat'));

  const free = firstFreeEmployee(context, service.id, booking.date, booking.time, appointmentId);
  if (free) return plan(free, null);

  const offering = context.employees.filter((employee) => employee.status === 'Active' && isEmployeeAssignedToService(service, employee));
  if (offering.length === 0) {
    return plan(null, advise({ why: `Nobody in your team offers ${service.name}.`, wants: 'nothing', or: 'assign someone to it in Services' }, 'chat'));
  }
  // Nobody is free. A reason that holds for the whole salon (it is closed, the time has passed)
  // is named. Otherwise each stylist has a reason of their own, and the sentence says the sum of them.
  const asked: Omit<CalendarEvent, 'id'> = {
    customerName: booking.customerName.trim() || 'Customer', serviceId: service.id, serviceName: service.name,
    employeeId: offering[0].id, staffName: offering[0].name, date: booking.date, day: dayKeyForDate(booking.date),
    dateDisplay: formatCalendarDate(booking.date), startTime: booking.time, endTime, colorTheme: 'purple',
  };
  const rule = validateCalendarEvent(context, asked, appointmentId);
  const facts: Facts = {
    context, employee: offering[0], staff: offering[0].name, service: service.name,
    date: booking.date, start: booking.time, end: endTime, appointmentId,
  };
  const wholeSalon = ([RULE.closure, RULE.closedDay, RULE.past, RULE.invalidDate, RULE.badHours, RULE.serviceTiming] as string[]).includes(rule ?? '')
    ? obstacleFor(rule!, facts)
    : booking.date === clock.date && booking.time <= clock.time ? PASSED : null;
  return plan(null, advise(wholeSalon ?? {
    why: `Nobody who offers ${service.name} is free on ${formatDate(booking.date)} at ${formatTimeRange(booking.time, endTime)}.`, wants: 'time',
  }, 'chat'));
}

/** Tests only: the wording for one refusal of the slot rules, for a request on Home. Null when there is none. */
export function wordingForRule(rule: string, facts: Omit<Facts, 'appointmentId'>): string | null {
  const found = obstacleFor(rule, { ...facts, appointmentId: '' });
  return found ? advise(found, 'request') : null;
}
