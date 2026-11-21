import { appointmentIdForRequest } from './appointmentActions';
import type { CalendarEvent } from './types';

/**
 * How an appointment came into the calendar. Nothing stores this yet: it is read from what an
 * appointment carries today.
 *
 *   ai            the AI receptionist booked it (`isAiBooked`)
 *   chat          the owner booked or moved it in a chat (`conversationId`, and not the AI)
 *   booking-page  the owner accepted a request from the customers' booking page (the id such
 *                 an appointment gets, see appointmentIdForRequest)
 *   manual        the owner entered it in the calendar or told the owner assistant to
 *
 * "phone" and "walk-in" come with the new appointment form, which stores the source on the
 * appointment: they are added to the type, to the labels and at the top of bookingSource().
 */
export type BookingSource = 'ai' | 'chat' | 'booking-page' | 'phone' | 'walk-in' | 'manual';

/** Every source, in the order a legend lists them. */
export const BOOKING_SOURCES: readonly BookingSource[] = ['ai', 'chat', 'booking-page', 'phone', 'walk-in', 'manual'];

const LABELS: Record<BookingSource, string> = {
  ai: 'Booked by the AI',
  chat: 'Booked in a chat',
  'booking-page': 'Booked on the booking page',
  phone: 'Booked by phone',
  'walk-in': 'Booked as a walk-in',
  manual: 'Booked by hand',
};

// Requests are numbered "req-…", and accepting one creates the appointment "cal-req-…".
const ACCEPTED_REQUEST = appointmentIdForRequest('req-');

export function bookingSource(event: Pick<CalendarEvent, 'id' | 'isAiBooked' | 'conversationId' | 'source'>): BookingSource {
  // What the owner chose in the appointment form. "Other", and a word this build does not know, read as "by hand".
  if (event.source === 'phone' || event.source === 'walk-in') return event.source;
  // The AI books in chats too: what counts is who made the booking.
  if (event.isAiBooked) return 'ai';
  if (event.conversationId !== undefined) return 'chat';
  if (event.id.startsWith(ACCEPTED_REQUEST)) return 'booking-page';
  return 'manual';
}

/** The source in words, as the name of its icon and as a line in an appointment's details. */
export const bookingSourceLabel = (source: BookingSource): string => LABELS[source];
