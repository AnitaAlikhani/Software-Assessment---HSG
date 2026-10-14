import { getAvailableSlots, getNextAvailableDate, getSalonNow, type AvailabilityContext } from './availability';
import {
  createDemoShifts,
  initialAppointmentRequests,
  initialBookingHours,
  initialCalendarEvents,
  initialEmployees,
  initialServices,
} from './mockData';
import { addMinutes, formatDate } from './scheduling';
import type { AppointmentRequest } from './types';

/** Give a fresh demo a usable pending queue without rewriting historical chats. */
export const createDemoRequests = (timeZone?: string, now = new Date()): AppointmentRequest[] => {
  const requests: AppointmentRequest[] = [];
  const context: AvailabilityContext = {
    services: initialServices,
    employees: initialEmployees,
    bookingHours: initialBookingHours,
    shiftOverview: createDemoShifts(timeZone, now),
    events: initialCalendarEvents,
    requests,
    timeZone,
    now,
  };
  const today = getSalonNow(timeZone, now).date;

  for (const seed of initialAppointmentRequests) {
    const service = initialServices.find((item) => item.id === seed.serviceId);
    if (!service || !seed.employeeId) continue;
    const date = getNextAvailableDate(context, service.id, today, seed.employeeId);
    if (!date) continue;
    const slots = getAvailableSlots(context, { date, serviceId: service.id, employeeId: seed.employeeId });
    const preferredTime = seed.timeStr.split(' - ')[0];
    const startTime = slots.includes(preferredTime) ? preferredTime : slots[0];
    if (!startTime) continue;
    // The same array is in context: every seeded request holds capacity for the next.
    requests.push({
      ...seed,
      date,
      dateStr: formatDate(date),
      timeStr: `${startTime} - ${addMinutes(startTime, service.durationMinutes)}`,
      timeAgo: 'Just now',
      status: 'pending',
    });
  }
  return requests;
};
