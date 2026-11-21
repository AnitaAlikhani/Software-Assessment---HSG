import type { CalendarEvent, Customer } from './types';
import { getSalonNow } from './scheduling';

export interface CustomerStats {
  /** Appointments that have started: the times this person has been to the salon. */
  visits: number;
  lastVisit: CalendarEvent | null;
  nextAppointment: CalendarEvent | null;
}

/** One customer's appointments from the calendar, split at the current moment. */
export interface CustomerHistory extends CustomerStats {
  /** Appointments that start now or later, the soonest first. The first one is `nextAppointment`. */
  upcoming: CalendarEvent[];
  /** Appointments that have started, the most recent first. Their number is `visits`. */
  past: CalendarEvent[];
}

const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const moment = (event: CalendarEvent) => `${event.date} ${event.startTime}`;

/**
 * Which customer an appointment belongs to: by id, or, for appointments saved before customers
 * had ids, by a name exactly one customer has.
 */
function ownerOfAppointment(customers: Pick<Customer, 'id' | 'name'>[]): (event: CalendarEvent) => string | undefined {
  const idByName = new Map<string, string | null>();
  for (const customer of customers) {
    const key = nameKey(customer.name);
    idByName.set(key, idByName.has(key) ? null : customer.id);
  }
  return (event) => event.customerId ?? idByName.get(nameKey(event.customerName)) ?? undefined;
}

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
  const ownerOf = ownerOfAppointment(customers);
  for (const event of events) {
    const id = ownerOf(event);
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

/**
 * Everything the calendar holds for one customer, for the customer's profile. The same rules as
 * the list's figures (customerStatsFromCalendar), so the profile and the list always agree:
 * `visits`, `lastVisit` and `nextAppointment` are the list's, and the two lists add up to them.
 * `customers` is the whole list: an appointment with a name only belongs to this customer
 * only when no other customer has the same name.
 */
export function customerHistory(
  customerId: string, customers: Pick<Customer, 'id' | 'name'>[], events: CalendarEvent[], now = new Date(), timeZone?: string,
): CustomerHistory {
  const salonNow = getSalonNow(timeZone, now);
  const current = `${salonNow.date} ${salonNow.time}`;
  const ownerOf = ownerOfAppointment(customers);
  const own = events.filter((event) => ownerOf(event) === customerId);
  const upcoming = own.filter((event) => moment(event) >= current).sort((a, b) => moment(a).localeCompare(moment(b)));
  const past = own.filter((event) => moment(event) < current).sort((a, b) => moment(b).localeCompare(moment(a)));
  return { upcoming, past, visits: past.length, lastVisit: past[0] ?? null, nextAppointment: upcoming[0] ?? null };
}

export const emptyCustomerStats: CustomerStats = { visits: 0, lastVisit: null, nextAppointment: null };
