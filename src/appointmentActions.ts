import type { AppointmentAction, AppointmentRequest, CalendarEvent, Conversation, ServiceItem } from './types';
import { addMinutes, dayKeyForDate, formatCalendarDate } from './scheduling';

/** Reuse stable IDs so confirming or moving the same appointment cannot duplicate it. */
export function upsertAppointment(events: CalendarEvent[], appointment: CalendarEvent): CalendarEvent[] {
  const exists = events.some((event) => event.id === appointment.id);
  return exists
    ? events.map((event) => event.id === appointment.id ? appointment : event)
    : [appointment, ...events];
}

export function appointmentFromRequest(request: AppointmentRequest, services: ServiceItem[]): CalendarEvent {
  const startTime = request.timeStr.split(' - ')[0];
  const duration = services.find((service) => service.name === request.serviceName)?.durationMinutes ?? 30;
  return {
    id: `cal-${request.id}`,
    customerName: request.customerName,
    serviceName: request.serviceName,
    staffName: request.staffName || 'Eloise Denniese',
    date: request.date,
    day: dayKeyForDate(request.date),
    dateDisplay: formatCalendarDate(request.date),
    startTime,
    endTime: addMinutes(startTime, duration),
    colorTheme: 'yellow',
    isAiBooked: request.channel === 'WhatsApp' || request.channel === 'Instagram',
  };
}

/** Only structured confirmation actions change the schedule; offers and free text do not. */
export function appointmentFromConversationAction(
  action: AppointmentAction,
  conversation: Pick<Conversation, 'customerName'>,
  events: CalendarEvent[],
  services: ServiceItem[],
  isAiBooked: boolean,
): CalendarEvent | null {
  const existing = events.find((event) => event.id === action.appointmentId);
  if (action.type === 'reschedule' && !existing) return null;
  const serviceName = action.type === 'book' ? action.serviceName : existing!.serviceName;
  const service = services.find((item) => item.name === serviceName);
  if (!service) return null;
  return {
    ...existing,
    id: action.appointmentId,
    customerName: conversation.customerName,
    serviceName,
    staffName: action.type === 'book' ? action.staffName : existing!.staffName,
    date: action.date,
    day: dayKeyForDate(action.date),
    dateDisplay: formatCalendarDate(action.date),
    startTime: action.startTime,
    endTime: addMinutes(action.startTime, service.durationMinutes),
    colorTheme: existing?.colorTheme ?? 'purple',
    isAiBooked: existing?.isAiBooked ?? isAiBooked,
    outsideHoursApproved: action.type === 'reschedule'
      ? action.outsideHoursApproved ?? false
      : existing?.outsideHoursApproved,
  };
}
