import type { AppointmentAction, AppointmentRequest, CalendarEvent, Conversation, Employee, ServiceItem } from './types';
import { addMinutes, dayKeyForDate, formatCalendarDate } from './scheduling';

/**
 * True while an appointment still belongs to a chat: it was booked in that chat, or it is not for
 * another customer than the chat's. An appointment the owner has given to somebody else since
 * (src/appointmentForm.ts takes the chat off it then) names another customer: it belongs to neither.
 */
export const belongsToConversation = (
  event: Pick<CalendarEvent, 'conversationId' | 'customerId'>, conversation: Pick<Conversation, 'id' | 'customerId'>,
): boolean => event.conversationId === conversation.id
  || event.customerId === undefined || conversation.customerId === undefined || event.customerId === conversation.customerId;

/**
 * The appointment a chat booked or is about, while it is in the calendar and still the chat's
 * own: the one the chat names, else the newest one that was booked in it (new bookings are added
 * at the top of the list). Null when there is none, when it has been cancelled since, or when it
 * is somebody else's appointment now: a chat never leads to another customer's appointment.
 */
export const appointmentForConversation = (
  conversation: Pick<Conversation, 'id' | 'customerId' | 'appointmentId'>, events: CalendarEvent[],
): CalendarEvent | null =>
  events.find((event) => conversation.appointmentId !== undefined && event.id === conversation.appointmentId
    && belongsToConversation(event, conversation))
  ?? events.find((event) => event.conversationId === conversation.id) ?? null;

/** Reuse stable IDs so confirming or moving the same appointment cannot duplicate it. */
export function upsertAppointment(events: CalendarEvent[], appointment: CalendarEvent): CalendarEvent[] {
  const exists = events.some((event) => event.id === appointment.id);
  return exists
    ? events.map((event) => event.id === appointment.id ? appointment : event)
    : [appointment, ...events];
}

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/**
 * Start, end and length of a request as it was made ("10:00 - 10:30"). Null for a text that is no
 * such span, which the app never writes but a tab stored long ago might hold.
 */
export function requestTimes(request: Pick<AppointmentRequest, 'timeStr'>): { start: string; end: string; minutes: number } | null {
  const match = /^((?:[01]\d|2[0-3]):[0-5]\d)\s*-\s*((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(request.timeStr.trim());
  if (!match) return null;
  const minutes = minutesOf(match[2]) - minutesOf(match[1]);
  return minutes > 0 ? { start: match[1], end: match[2], minutes } : null;
}

/** The id of the appointment that accepting a request creates. Undo finds the appointment by it. */
export const appointmentIdForRequest = (requestId: string): string => `cal-${requestId}`;

export function appointmentFromRequest(request: AppointmentRequest, services: ServiceItem[], employees: Employee[] = []): CalendarEvent {
  const times = requestTimes(request);
  const startTime = times?.start ?? request.timeStr.split(/\s*-\s*/)[0];
  const service = request.serviceId !== undefined
    ? services.find((item) => item.id === request.serviceId)
    : services.find((item) => item.name === request.serviceName);
  // The stylist's current name, in case they were renamed after the request came in.
  const employee = request.employeeId !== undefined
    ? employees.find((item) => item.id === request.employeeId)
    : employees.find((item) => item.name === request.staffName);
  // A request keeps the length it was made with: the customer asked for that time, also when
  // the owner has given the service another length since.
  const duration = times?.minutes ?? service?.durationMinutes ?? 30;
  return {
    id: appointmentIdForRequest(request.id),
    serviceId: request.serviceId,
    employeeId: request.employeeId,
    customerName: request.customerName,
    customerPhone: request.customerPhone,
    customerId: request.customerId,
    serviceName: service?.name ?? request.serviceName,
    staffName: employee?.name ?? (request.staffName || 'Unassigned'),
    date: request.date,
    day: dayKeyForDate(request.date),
    dateDisplay: formatCalendarDate(request.date),
    startTime,
    endTime: addMinutes(startTime, duration),
    colorTheme: 'yellow',
    isAiBooked: request.isAiBooked === true,
    prepMinutes: service?.prepMinutes ?? 0,
    postMinutes: service?.postMinutes ?? 0,
  };
}

/**
 * Only structured confirmation actions change the schedule; offers and free text do not.
 * A booking names its service and stylist by id; a move keeps those of the appointment.
 * Returns null when the appointment, the service or the stylist no longer exists, or when the
 * appointment is no longer the chat's own.
 */
export function appointmentFromConversationAction(
  action: AppointmentAction,
  conversation: Pick<Conversation, 'id' | 'customerId' | 'customerName'>,
  events: CalendarEvent[],
  services: ServiceItem[],
  employees: Employee[],
  isAiBooked: boolean,
): CalendarEvent | null {
  const existing = events.find((event) => event.id === action.appointmentId);
  if (action.type === 'reschedule' && !existing) return null;
  // The appointment has been given to another customer since: this chat no longer changes it.
  if (existing && !belongsToConversation(existing, conversation)) return null;
  const service = action.type === 'book'
    ? services.find((item) => item.id === action.serviceId)
    : existing!.serviceId !== undefined
      ? services.find((item) => item.id === existing!.serviceId)
      : services.find((item) => item.name === existing!.serviceName);
  if (!service) return null;
  const employee = action.type === 'book' ? employees.find((item) => item.id === action.employeeId) : undefined;
  if (action.type === 'book' && !employee) return null;
  return {
    ...existing,
    id: action.appointmentId,
    customerName: conversation.customerName,
    serviceName: service.name,
    serviceId: service.id,
    prepMinutes: service.prepMinutes ?? 0,
    postMinutes: service.postMinutes ?? 0,
    employeeId: employee?.id ?? existing?.employeeId,
    staffName: employee?.name ?? existing!.staffName,
    date: action.date,
    day: dayKeyForDate(action.date),
    dateDisplay: formatCalendarDate(action.date),
    startTime: action.startTime,
    endTime: addMinutes(action.startTime, service.durationMinutes),
    colorTheme: existing?.colorTheme ?? 'purple',
    isAiBooked: existing?.isAiBooked ?? isAiBooked,
    // An approval of the old time does not carry over to the new one. Whoever saves the
    // appointment decides it again from that day's opening hours (see isOutsideOpeningHours).
    outsideHoursApproved: false,
  };
}
