import type { AppointmentRequest, CalendarEvent } from './types';

/** Do not orphan reservations or their recorded service buffers. */
export function deletionDependency(
  kind: 'customer' | 'employee' | 'service', id: string, name: string,
  events: CalendarEvent[], requests: AppointmentRequest[],
): string | null {
  const matches = (record: CalendarEvent | AppointmentRequest) => {
    if (kind === 'customer') return record.customerId !== undefined ? record.customerId === id : record.customerName === name;
    if (kind === 'employee') return record.employeeId !== undefined ? record.employeeId === id : record.staffName === name;
    return record.serviceId !== undefined ? record.serviceId === id : record.serviceName === name;
  };
  const appointments = events.filter(matches).length;
  const pending = requests.filter(request => request.status === 'pending' && matches(request)).length;
  if (!appointments && !pending) return null;
  return `Cannot delete ${name}: ${appointments} appointment${appointments === 1 ? '' : 's'} and ${pending} pending request${pending === 1 ? '' : 's'} still use this ${kind}. Cancel or reassign them first.`;
}
