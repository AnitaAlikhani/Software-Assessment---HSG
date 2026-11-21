import { appointmentIdForRequest } from './appointmentActions';
import { formatDate } from './scheduling';
import type { AppointmentRequest, CalendarEvent } from './types';

/**
 * A booking request seen from two tabs of one browser: the customers' booking page in one
 * ("Open as customer", `?booking=1`) and the owner's app in the other.
 *
 * Both tabs read and write the same stored salon (src/useDemoState.ts), so nothing is handed
 * from tab to tab any more. A request sent on the customers' page is in the owner's list of
 * requests; the owner's answer is in the calendar, or noted with the salon. What is left to
 * work out is here: how the customer's own request stands now, and which requests the owner's
 * tab should announce.
 *
 * This reaches the tabs of one browser. Another device has its own storage and sees none of it.
 */

/**
 * What the owner answered to requests from the booking page, by the id of the request. Kept
 * with the salon (useDemoState key 'requestOutcomes'): an answered request leaves the list of
 * requests, and a rejected one would leave no trace for the customer's tab to find.
 */
export type RequestOutcomes = Record<string, 'accepted' | 'rejected'>;

/** The outcomes after the owner's answer to one request. Null takes the answer back ("Undo"): the request waits again. */
export function withOutcome(outcomes: RequestOutcomes, id: string, outcome: 'accepted' | 'rejected' | null): RequestOutcomes {
  const noted = Object.hasOwn(outcomes, id) ? outcomes[id] : null;
  if (noted === outcome) return outcomes;
  if (outcome !== null) return { ...outcomes, [id]: outcome };
  const { [id]: _takenBack, ...others } = outcomes;
  return others;
}

/** What the salon holds about requests from the booking page. */
export interface SalonRequests {
  /** The requests that wait for the owner. */
  requests: AppointmentRequest[];
  /** The calendar. An accepted request is the appointment `cal-<request id>` in it. */
  events: CalendarEvent[];
  outcomes: RequestOutcomes;
}

/**
 * How the customer's own request stands in the salon now. `own` is what the customer's tab
 * remembers: which request is theirs, and how it stood when the tab last looked.
 *
 * - It still waits: the request as the list has it (the owner may have moved it to another time).
 * - The owner accepted it: confirmed, with the details of the appointment in the calendar, which
 *   the owner may have changed since.
 * - The customer withdrew it, or the owner rejected it: it stays ended.
 * - It was accepted and the appointment has been taken out of the calendar since, or given to
 *   another customer: cancelled by the salon (`cancelledBy`), which the page says in other words
 *   than a withdrawal by the customer. Another person's name or number is never shown.
 * - The salon holds no trace of it (the stored salon was emptied or started again): null. The
 *   page then lets the request go, instead of saying that a request waits which the salon does
 *   not have.
 *
 * Only a request that still waits can be changed or withdrawn by the customer.
 */
export function ownRequestNow(own: AppointmentRequest, salon: SalonRequests): AppointmentRequest | null {
  const waiting = salon.requests.find((request) => request.id === own.id && request.status === 'pending');
  if (waiting) return waiting;
  const appointment = salon.events.find((event) => event.id === appointmentIdForRequest(own.id));
  // The salon gave the appointment to somebody else: for this customer it is taken out of the calendar.
  if (appointment && !isRequestersAppointment(own, appointment)) return { ...own, status: 'cancelled', cancelledBy: 'salon' };
  if (appointment) {
    return {
      ...own, status: 'accepted',
      customerId: appointment.customerId, customerName: appointment.customerName, customerPhone: appointment.customerPhone,
      date: appointment.date, dateStr: formatDate(appointment.date), timeStr: `${appointment.startTime} - ${appointment.endTime}`,
      serviceId: appointment.serviceId, serviceName: appointment.serviceName, employeeId: appointment.employeeId, staffName: appointment.staffName,
    };
  }
  if (own.status === 'cancelled' || own.status === 'rejected') return own;
  const outcome = Object.hasOwn(salon.outcomes, own.id) ? salon.outcomes[own.id] : null;
  if (outcome === 'rejected') return { ...own, status: 'rejected' };
  // Accepted, and the appointment is no longer in the calendar: the salon took it out, not the customer.
  if (outcome === 'accepted') return { ...own, status: 'cancelled', cancelledBy: 'salon' };
  return null;
}

/**
 * True while the appointment `cal-<request id>` is still for the customer who made the request.
 * The customer record decides; a request remembered without one is compared by name.
 */
export function isRequestersAppointment(
  request: Pick<AppointmentRequest, 'customerId' | 'customerName'>, appointment: Pick<CalendarEvent, 'customerId' | 'customerName'>,
): boolean {
  if (request.customerId !== undefined && appointment.customerId !== undefined) return request.customerId === appointment.customerId;
  const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
  return key(request.customerName) === key(appointment.customerName);
}

/**
 * The requests another tab has just added to the list of waiting ones: those the owner's tab
 * says "New booking request from ..." for. `before` and `after` are the list before and after
 * the other tab's change; `seen` holds the ids of every request this tab has shown already, so a
 * request that only comes back (an answer taken back in another tab) is not announced as new.
 */
export function arrivedRequests(before: AppointmentRequest[], after: AppointmentRequest[], seen: ReadonlySet<string>): AppointmentRequest[] {
  const listed = new Set(before.map((request) => request.id));
  return after.filter((request) => request.status === 'pending' && !listed.has(request.id) && !seen.has(request.id));
}
