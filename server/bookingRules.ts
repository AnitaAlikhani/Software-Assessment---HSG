import { formatDate, zonedDateTime } from '../src/format.js';
import { initialBookingHours, initialEmployees, initialServices } from '../src/mockData.js';
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
 * "2026-11-17" when the text is exactly a date that exists, otherwise null. A JavaScript date
 * quietly turns 31 November into 1 December, so the parts are read back and compared.
 */
export function strictDate(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : null;
}

/**
 * "09:30" for a clock time written as hours and two-digit minutes ("9:30" gets its leading zero),
 * otherwise null: "25:00", "9:5", "9.30" and "09:30:00" are no times here.
 */
export function strictTime(value: unknown): string | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(typeof value === 'string' ? value.trim() : '');
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

/**
 * A name as people write it, made safe to show and to put into a message: no markup, no line
 * breaks or other control characters, single spaces, at most `max` characters. Empty when nothing
 * like a name is left (no letter at all, or a link).
 */
export function cleanName(value: unknown, max = 40): string {
  const text = (typeof value === 'string' ? value : '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>{}\[\]\\`*_#|]/g, ' ')
    // Control characters and line breaks of every kind, including the Unicode separators.
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  if (!/\p{L}/u.test(text) || /https?:|www\.|@/i.test(text)) return '';
  return text;
}

/** The salon's stylists who can be booked: active and shown. */
const bookableStylists = () => initialEmployees.filter(employee => employee.status === 'Active' && !employee.hidden);

/** The stylist a customer named ("Selina", "selina keller"), or null when nobody on the team has that name. */
export function matchStylist(name: unknown): { employeeId: string; staffName: string } | null {
  const wanted = cleanName(name, 60).toLowerCase();
  if (!wanted) return null;
  const employee = bookableStylists().find(item => item.name.toLowerCase() === wanted || item.firstName.toLowerCase() === wanted);
  return employee ? { employeeId: employee.id, staffName: employee.name } : null;
}

/** What the check found: a request the owner can confirm, or the reason in plain words why it was not passed on as one. */
export type BookingCheck =
  | {
    ok: true;
    request: BookingRequest;
    /** The service is not offered for online booking: the owner books it personally. */
    ownerOnly: boolean;
    /** The customer named a stylist who is not on the team: said to the owner, never guessed. */
    unknownStylist?: string;
  }
  | { ok: false; reason: string };

/**
 * Checks an AI booking request against the salon rules in code, so a wrong AI answer can never
 * reach the owner as a "ready to confirm" request. Every refusal says why, so the owner can tell
 * the customer.
 */
export function checkBookingRequest(request: BookingRequest | undefined, now = new Date()): BookingCheck {
  if (!request) return { ok: false, reason: 'the request was empty' };
  const asked = typeof request.service === 'string' ? request.service.trim() : '';
  const service = initialServices.find(item => item.name.toLowerCase() === asked.toLowerCase());
  if (!service) return { ok: false, reason: asked ? `"${cleanName(asked, 40) || 'that'}" is not one of the salon's services` : 'no service was named' };
  const customerName = cleanName(request.customerName);
  if (!customerName) return { ok: false, reason: "the customer's first name is missing or unclear" };
  const date = strictDate(request.date);
  if (!date) return { ok: false, reason: `"${String(request.date ?? '').slice(0, 20)}" is not a date that exists` };
  const time = strictTime(request.time);
  if (!time) return { ok: false, reason: `"${String(request.time ?? '').slice(0, 20)}" is not a valid time` };

  const weekday = DAYS[dayIndex(date)];
  const hours = initialBookingHours.find(day => day.day === weekday);
  if (!hours?.isOpen) return { ok: false, reason: `the salon is closed on ${weekday}s` };
  const start = toMinutes(time);
  if (start % SLOT_STEP_MINUTES !== 0) return { ok: false, reason: `${time} is not on the ${SLOT_STEP_MINUTES}-minute steps appointments start on` };
  if (start < toMinutes(hours.from) || start + service.durationMinutes > toMinutes(hours.to)) {
    return { ok: false, reason: `${service.name} at ${time} does not fit into the opening hours on ${weekday}s (${hours.from}–${hours.to})` };
  }

  const today = zurich(now);
  const ahead = daysBetween(today.date, date);
  if (ahead < 0) return { ok: false, reason: 'the date is in the past' };
  if (ahead > MAX_WEEKS_AHEAD * 7) return { ok: false, reason: `the date is more than ${MAX_WEEKS_AHEAD} weeks ahead` };
  if (ahead === 0 && start < today.minutes + MIN_NOTICE_HOURS * 60) return { ok: false, reason: `the time is less than ${MIN_NOTICE_HOURS} hours from now` };

  // The id travels with the request, so the owner's confirmation still finds the service after a rename.
  const cleaned: BookingRequest = { service: service.name, serviceId: service.id, date, time, customerName };
  const named = cleanName(request.staffName, 60);
  const stylist = named ? matchStylist(named) : null;
  if (stylist) Object.assign(cleaned, stylist);
  return { ok: true, request: cleaned, ownerOnly: !service.onlineBooking, ...(named && !stylist ? { unknownStylist: named } : {}) };
}

/** The cleaned request, or null when the rules refuse it. */
export function validBookingRequest(request: BookingRequest | undefined, now = new Date()): BookingRequest | null {
  const check = checkBookingRequest(request, now);
  return check.ok ? check.request : null;
}

/**
 * "Tuesday, 17.11.2026": the date in the owner's notes about a booking, written like on every
 * screen. What the customer reads comes from the fixed texts in src/chatTemplates.ts.
 */
export const bookingDateLabel = (date: string) => formatDate(date, { weekday: 'long' });
