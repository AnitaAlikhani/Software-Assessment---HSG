import type { CalendarEvent, Customer } from './types';
import { getSalonNow } from './scheduling';

export interface CustomerStats {
  /** Appointments that have started: the times this person has been to the salon. */
  visits: number;
  lastVisit: CalendarEvent | null;
  nextAppointment: CalendarEvent | null;
}

const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const moment = (event: CalendarEvent) => `${event.date} ${event.startTime}`;

/**
 * Visits, last visit and next appointment of every customer, counted from the calendar.
 * Nothing of this is stored with the customer, so a booking, a move or a cancellation shows
 * in the customer list at once and the two can never disagree.
 * "Next" uses the same rule as the Home page: an appointment that starts now or later.
 */
export function customerStatsFromCalendar(
  customers: Pick<Customer, 'id' | 'name'>[], events: CalendarEvent[], now = new Date(), timeZone?: string,
): Map<string, CustomerStats> {
  const salonNow = getSalonNow(timeZone, now);
  const current = `${salonNow.date} ${salonNow.time}`;
  const stats = new Map<string, CustomerStats>(
    customers.map((customer) => [customer.id, { visits: 0, lastVisit: null, nextAppointment: null }]),
  );
  // Appointments saved before customers had ids carry a name only. They count for a customer
  // when exactly one customer has that name.
  const idByName = new Map<string, string | null>();
  for (const customer of customers) {
    const key = nameKey(customer.name);
    idByName.set(key, idByName.has(key) ? null : customer.id);
  }
  for (const event of events) {
    const id = event.customerId ?? idByName.get(nameKey(event.customerName));
    const entry = id ? stats.get(id) : undefined;
    if (!entry) continue;
    if (moment(event) >= current) {
      if (!entry.nextAppointment || moment(event) < moment(entry.nextAppointment)) entry.nextAppointment = event;
    } else {
      entry.visits += 1;
      if (!entry.lastVisit || moment(event) > moment(entry.lastVisit)) entry.lastVisit = event;
    }
  }
  return stats;
}

export const emptyCustomerStats: CustomerStats = { visits: 0, lastVisit: null, nextAppointment: null };
