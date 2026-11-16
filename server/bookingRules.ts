import { initialBookingHours, initialServices } from '../src/mockData.js';
import type { BookingRequest } from './ai.js';
import { MAX_WEEKS_AHEAD, MIN_NOTICE_HOURS, SLOT_STEP_MINUTES } from './salonRules.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const toMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };

/** Salon-local date and minutes for a moment in time (Europe/Zurich). */
function zurich(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map(part => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
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

  return { service: service.name, date, time, customerName };
}

/** "Tuesday, 17 November" */
export const bookingDateLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
