import type { AppointmentRequest, CalendarEvent, Customer } from './types';

export type HeaderSearchResult =
  | { kind: 'customer'; record: Customer }
  | { kind: 'request'; record: AppointmentRequest }
  | { kind: 'appointment'; record: CalendarEvent };

export function getHeaderSearchResults(
  customers: Customer[],
  requests: AppointmentRequest[],
  appointments: CalendarEvent[],
  query: string,
): HeaderSearchResult[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const matches = (...values: string[]) => values.some((value) => value.toLowerCase().includes(term));
  return [
    ...customers.filter((customer) => matches(customer.name, customer.email, customer.phone))
      .map((record) => ({ kind: 'customer' as const, record })),
    ...requests.filter((request) => request.status === 'pending' &&
      matches(request.customerName, request.serviceName, request.date, request.dateStr, request.timeStr))
      .map((record) => ({ kind: 'request' as const, record })),
    ...appointments.filter((appointment) => matches(appointment.customerName, appointment.serviceName,
      appointment.date, appointment.dateDisplay, appointment.startTime, appointment.staffName))
      .map((record) => ({ kind: 'appointment' as const, record })),
  ];
}

interface NotificationDetails {
  id: string;
  revision: string;
  revisionTokens?: string[];
  title: string;
  detail: string;
}

export type HeaderNotification = NotificationDetails & (
  | { kind: 'attention' }
  | { kind: 'request'; record: AppointmentRequest }
  | { kind: 'appointment'; record: CalendarEvent }
);

export function getHeaderNotifications(
  requests: AppointmentRequest[],
  needsAttentionCount: number,
  needsAttentionNames: string[],
  latestAiBooking: CalendarEvent | null,
  needsAttentionRevision?: string,
  needsAttentionUpdates?: string[],
): HeaderNotification[] {
  const notifications: HeaderNotification[] = [];
  if (needsAttentionCount > 0) {
    notifications.push({
      kind: 'attention',
      id: 'attention',
      revision: needsAttentionRevision ?? JSON.stringify([needsAttentionCount, [...needsAttentionNames].sort()]),
      revisionTokens: needsAttentionUpdates,
      title: `${needsAttentionCount} ${needsAttentionCount === 1 ? 'chat needs' : 'chats need'} your attention`,
      detail: `${needsAttentionNames.join(', ')} ${needsAttentionCount === 1 ? 'is' : 'are'} waiting`,
    });
  }
  for (const request of requests.filter((item) => item.status === 'pending')) {
    notifications.push({
      kind: 'request',
      id: `request:${request.id}`,
      revision: JSON.stringify([request.customerName, request.serviceId, request.serviceName,
        request.employeeId, request.staffName, request.date, request.timeStr]),
      title: 'Appointment request',
      detail: `${request.customerName} · ${request.dateStr} · ${request.timeStr}`,
      record: request,
    });
  }
  if (latestAiBooking) {
    notifications.push({
      kind: 'appointment',
      id: `appointment:${latestAiBooking.id}`,
      revision: JSON.stringify([latestAiBooking.customerName, latestAiBooking.serviceId,
        latestAiBooking.serviceName, latestAiBooking.employeeId, latestAiBooking.staffName,
        latestAiBooking.date, latestAiBooking.startTime, latestAiBooking.endTime]),
      title: `AI booked ${latestAiBooking.customerName}`,
      detail: `${latestAiBooking.dateDisplay} · ${latestAiBooking.startTime} · ${latestAiBooking.serviceName}`,
      record: latestAiBooking,
    });
  }
  return notifications;
}

export const notificationReadTokens = (notification: HeaderNotification): string[] =>
  notification.revisionTokens ?? [notification.revision];

export const isHeaderNotificationUnread = (
  notification: HeaderNotification,
  readRevisions: Record<string, string[]>,
): boolean => notificationReadTokens(notification).some((token) =>
  !readRevisions[notification.id]?.includes(token));
