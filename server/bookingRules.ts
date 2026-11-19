import { formatDate, zonedDateTime } from '../src/format.js';
import { initialBookingHours, initialServices } from '../src/mockData.js';
import type { BookingRequest } from './ai.js';
import { MAX_WEEKS_AHEAD, MIN_NOTICE_HOURS, SLOT_STEP_MINUTES } from './salonRules.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const toMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };

/** Salon-local date and minutes for a moment in time (Europe/Zurich). */
function zurich(now: Date) {
  const { date, time } = zonedDateTime(now, 'Europe/Zurich');
  return { date, minutes: toMinutes(time) };
}

const dayIndex = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/**
 * Checks an AI booking request against the salon rules in code, so a wrong AI answer can never
 * reach the owner as a "ready to confirm" request. Returns the cleaned request, or null.
 */
export function validBookingRequest(request: BookingRequest | undefined, now = new Date()): BookingRequest | null {
  if (!request) return null;
  const service = initialServices.find(item => item.name.toLowerCase() === request.service?.trim().toLowerCase());
  const date = request.date?.trim();
  const time = request.time?.trim();
  const customerName = request.customerName?.trim().slice(0, 40);
  if (!service || !customerName || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !/^\d{2}:\d{2}$/.test(time ?? '')) return null;
  if (Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return null;

  const hours = initialBookingHours.find(day => day.day === DAYS[dayIndex(date)]);
  if (!hours?.isOpen) return null;
  const start = toMinutes(time);
  if (start % SLOT_STEP_MINUTES !== 0 || start < toMinutes(hours.from) || start + service.durationMinutes > toMinutes(hours.to)) return null;

  const today = zurich(now);
  const ahead = daysBetween(today.date, date);
  if (ahead < 0 || ahead > MAX_WEEKS_AHEAD * 7) return null;
  if (ahead === 0 && start < today.minutes + MIN_NOTICE_HOURS * 60) return null;

  // The id travels with the request, so the owner's confirmation still finds the service after a rename.
  return { service: service.name, serviceId: service.id, date, time, customerName };
}

/**
 * "Tuesday, 17.11.2026": the date in the sentences about a booking, written like on every screen.
 * The confirmation to the customer is translated afterwards; the weekday is a word a translation
 * carries over, and the numbers read the same in every language the salon answers in.
 */
export const bookingDateLabel = (date: string) => formatDate(date, { weekday: 'long' });
