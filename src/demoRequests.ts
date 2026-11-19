import { getAvailableSlots, getNextAvailableDate, getSalonNow, type AvailabilityContext } from './availability';
import { createDemoEvents, createDemoShifts, demoRequestPlan, demoRequesters, unusedDemoPerson } from './demoSeed';
import { initialBookingHours, initialEmployees, initialServices } from './mockData';
import { addDays, addMinutes, formatDate } from './scheduling';
import type { AppointmentRequest, CalendarEvent, Customer } from './types';

/** "12 minutes ago" for a moment in the past, as the request card shows it. */
export const timeAgoLabel = (createdAt: string, now: Date): string => {
  // Rounded, not cut off: 11 minutes and 59 seconds read as "12 minutes ago".
  const minutes = Math.round((now.getTime() - Date.parse(createdAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
};

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const nearest = (slots: string[], wanted: string): string | undefined =>
  [...slots].sort((a, b) => Math.abs(toMinutes(a) - toMinutes(wanted)) - Math.abs(toMinutes(b) - toMinutes(wanted)))[0];

/**
 * The pending requests a new workspace starts with: from two regular customers, for the next
 * two working days, with two stylists. Never for today, so a request cannot expire while the
 * owner is looking at it. `events` is the calendar they have to fit into.
 */
export const createDemoRequests = (
  timeZone?: string, now = new Date(), events: CalendarEvent[] = createDemoEvents(timeZone, now),
): AppointmentRequest[] => {
  const requests: AppointmentRequest[] = [];
  const context: AvailabilityContext = {
    services: initialServices,
    employees: initialEmployees,
    bookingHours: initialBookingHours,
    shiftOverview: createDemoShifts(timeZone, now),
    events,
    // The same array is in context: every seeded request holds capacity for the next.
    requests,
    timeZone,
    now,
  };
  const today = getSalonNow(timeZone, now).date;
  const people = demoRequesters(events, today);

  demoRequestPlan(today).forEach((plan, index) => {
    const service = initialServices.find((item) => item.id === plan.serviceId);
    const employee = initialEmployees.find((item) => item.id === plan.employeeId);
    if (!service || !employee) return;
    // The calendar seed keeps the planned time free. If it is taken all the same (a changed
    // calendar was passed in), take the nearest free time, from tomorrow on.
    let date = plan.date;
    let slots = getAvailableSlots(context, { date, serviceId: service.id, employeeId: employee.id });
    if (slots.length === 0) {
      const next = getNextAvailableDate(context, service.id, addDays(today, 1), employee.id);
      if (!next) return;
      date = next;
      slots = getAvailableSlots(context, { date, serviceId: service.id, employeeId: employee.id });
    }
    const startTime = slots.includes(plan.start) ? plan.start : nearest(slots, plan.start);
    if (!startTime) return;
    const person = people[index];
    const createdAt = new Date(now.getTime() - plan.minutesAgo * 60_000).toISOString();
    requests.push({
      id: plan.id,
      serviceId: service.id,
      employeeId: employee.id,
      customerId: person.id,
      customerName: person.name,
      customerPhone: person.phone || undefined,
      serviceName: service.name,
      date,
      dateStr: formatDate(date),
      timeStr: `${startTime} - ${addMinutes(startTime, service.durationMinutes)}`,
      timeAgo: timeAgoLabel(createdAt, now),
      createdAt,
      staffName: employee.name,
      channel: plan.channel,
      // They come from the booking page and wait for the owner: nothing here was booked by the AI.
      // What the AI collects waits in its chat (see src/inbox.ts) and counts as its booking once confirmed.
      isAiBooked: false,
      status: 'pending',
    });
  });
  return requests;
};

/**
 * A new web request for the research tools ("an incoming booking"): from an invented person who
 * is not a customer yet, for the first service that can be booked online, at the first free
 * time from tomorrow on. Null when no such time exists in the next 90 days.
 */
export const createIncomingRequest = (
  context: AvailabilityContext, customers: Pick<Customer, 'id' | 'name'>[], id: string,
): AppointmentRequest | null => {
  const now = context.now ?? new Date();
  const tomorrow = addDays(getSalonNow(context.timeZone, now).date, 1);
  const person = unusedDemoPerson(customers);
  if (!person) return null;
  for (const service of context.services.filter((item) => item.onlineBooking)) {
    const date = getNextAvailableDate({ ...context, now }, service.id, tomorrow);
    if (!date) continue;
    for (const employee of context.employees) {
      const startTime = getAvailableSlots({ ...context, now }, { date, serviceId: service.id, employeeId: employee.id })[0];
      if (!startTime) continue;
      return {
        id,
        serviceId: service.id,
        employeeId: employee.id,
        customerName: person.name,
        customerPhone: person.phone || undefined,
        serviceName: service.name,
        date,
        dateStr: formatDate(date),
        timeStr: `${startTime} - ${addMinutes(startTime, service.durationMinutes)}`,
        timeAgo: 'Just now',
        createdAt: now.toISOString(),
        staffName: employee.name,
        channel: 'Web',
        isAiBooked: false,
        status: 'pending',
      };
    }
  }
  return null;
};
