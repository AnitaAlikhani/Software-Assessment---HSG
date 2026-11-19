import type { AppointmentRequest, CalendarEvent, Customer, Employee } from './types';
import { customerMatches } from './bookingData';
import { formatDate, formatDateShort, formatPhone, formatStoredTimeRange } from './format';
import { accountOwner } from './mockData';

/**
 * The account shown in the header and in "More": the person who runs the salon account, taken
 * from the team data, so a rename in Team shows here at once. Empty texts when the team is empty;
 * no role is invented for somebody who has none.
 */
export const headerAccount = (employees: Employee[]): { ownerName: string; ownerRole: string } => {
  const owner = accountOwner(employees);
  return { ownerName: owner?.name ?? '', ownerRole: owner?.role ?? '' };
};

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
  // A date is found in both forms the screens write it in ("Thu, 19.11.2026" and the short
  // "Thu 19.11."), read from the record's own date each time. A phone number is found in any
  // spelling (see customerMatches).
  const dates = (date: string) => [date, formatDate(date), formatDateShort(date)];
  return [
    ...customers.filter((customer) => customerMatches(customer, term))
      .map((record) => ({ kind: 'customer' as const, record })),
    ...requests.filter((request) => request.status === 'pending' &&
      matches(request.customerName, request.serviceName, ...dates(request.date), formatStoredTimeRange(request.timeStr)))
      .map((record) => ({ kind: 'request' as const, record })),
    ...appointments.filter((appointment) => matches(appointment.customerName, appointment.serviceName,
      ...dates(appointment.date), appointment.startTime, appointment.staffName))
      .map((record) => ({ kind: 'appointment' as const, record })),
  ];
}

/**
 * The line under the name of a search result. Only the parts that exist are shown: a customer
 * without an e-mail address gets no separator with nothing behind it.
 */
export const headerSearchDetail = (result: HeaderSearchResult): string => {
  const parts = result.kind === 'customer' ? [formatPhone(result.record.phone), result.record.email]
    : result.kind === 'request' ? [result.record.serviceName, formatDate(result.record.date), formatStoredTimeRange(result.record.timeStr)]
      : [result.record.serviceName, formatDate(result.record.date), result.record.startTime];
  return parts.filter(Boolean).join(' · ');
};
