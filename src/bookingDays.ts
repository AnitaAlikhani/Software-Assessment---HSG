import type { BookingHoursDay } from './types';
import { AvailabilityContext, getAvailableSlots, isBookableEmployee, isEmployeeAssignedToService } from './availability';
import { formatDate, formatTimeRange, openingHoursDay, RANGE_SEPARATOR } from './format';
import { addDays } from './scheduling';

// What the public booking page tells a customer about days: when the salon is open, which of
// the coming days have a free time, and why a day has none. The slot rules themselves stay in
// availability.ts; this file only asks them.

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const nameList = (names: string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

export interface OpeningLine {
  days: string;
  hours: string;
}

/**
 * The week's opening hours in as few lines as possible: neighbouring days with the same hours
 * share a line ("Monday–Friday"), and all closed days share the last one.
 */
export function openingHoursLines(bookingHours: BookingHoursDay[]): OpeningLine[] {
  const week = WEEK.map(name => bookingHours.find(day => day.day === name)).filter((day): day is BookingHoursDay => day !== undefined);
  const lines: OpeningLine[] = [];
  let group: BookingHoursDay[] = [];
  const closeGroup = () => {
    if (group.length === 0) return;
    const names = group.map(day => day.day);
    lines.push({
      days: names.length > 2 ? `${names[0]}${RANGE_SEPARATOR}${names.at(-1)}` : nameList(names),
      hours: formatTimeRange(group[0].from, group[0].to),
    });
    group = [];
  };
  for (const day of week) {
    if (!day.isOpen) { closeGroup(); continue; }
    if (group.length > 0 && (group[0].from !== day.from || group[0].to !== day.to)) closeGroup();
    group.push(day);
  }
  closeGroup();
  const closed = week.filter(day => !day.isOpen).map(day => day.day);
  if (closed.length > 0 && lines.length > 0) lines.push({ days: nameList(closed), hours: 'Closed' });
  return lines;
}

/**
 * Why the salon takes no bookings on this date, as a sentence for a customer: its weekly closing
 * day, or a closure the owner entered (with the name the owner gave it). Null on an open day.
 */
export function closedReason(context: Pick<AvailabilityContext, 'bookingHours' | 'closedDates'>, date: string): string | null {
  const closure = context.closedDates?.find(item => date >= item.start && date <= item.end);
  if (closure) return `The salon is closed on ${formatDate(date, { weekday: 'long' })}${closure.name.trim() ? ` (${closure.name.trim()})` : ''}.`;
  const weekday = openingHoursDay(date);
  return context.bookingHours.find(day => day.day === weekday)?.isOpen ? null : `The salon is closed on ${weekday}s.`;
}

export interface BookingDay {
  date: string;
  /**
   * free: at least one specialist has a time.
   * full: there were times, and bookings have taken them all.
   * none: open, but nobody offers this service then, or it is too late today.
   * closed: the salon takes no bookings on this day.
   * "Full" is only said when bookings are the reason, so the page never claims demand that is not there.
   */
  state: 'free' | 'full' | 'none' | 'closed';
}

/** The coming days for one service, starting at `from`: which can be booked and which cannot. */
export function bookingDays(
  context: AvailabilityContext,
  serviceId: string,
  from: string,
  count: number,
  excludeRequestId?: string,
): BookingDay[] {
  const service = context.services.find(item => item.id === serviceId);
  const specialists = service
    ? context.employees.filter(employee => isBookableEmployee(employee) && isEmployeeAssignedToService(service, employee))
    : [];
  const withoutBookings: AvailabilityContext = { ...context, events: [], requests: [] };
  const anyTime = (source: AvailabilityContext, date: string) => specialists.some(employee =>
    getAvailableSlots(source, { date, serviceId, employeeId: employee.id, excludeRequestId }).length > 0);
  return Array.from({ length: count }, (_, offset): BookingDay => {
    const date = addDays(from, offset);
    if (closedReason(context, date)) return { date, state: 'closed' };
    if (anyTime(context, date)) return { date, state: 'free' };
    return { date, state: anyTime(withoutBookings, date) ? 'full' : 'none' };
  });
}
