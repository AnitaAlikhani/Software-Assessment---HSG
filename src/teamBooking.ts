import type { BookingHoursDay, Employee, ServiceItem, ShiftEntry } from './types';
import { isBookableEmployee, isEmployeeAssignedToService } from './availability';
import { openingHoursDay } from './format';
import { dateOfWeekday, enteredWorkingDays, isValidHours, WEEKDAY_KEYS, type Hours } from './workingHours';

/**
 * Whether customers can book a person online, and what is in the way while they cannot.
 *
 * The booking page offers a person when four things hold: they are active, "Bookable online" is
 * on, they offer a service that is offered online, and they have working hours while the salon
 * is open. The slot rules (src/availability.ts) decide each booking; this file names the one
 * thing that is missing, so the team list can say it instead of the booking page finding no date.
 */

export type BookingGap =
  /** Set to inactive: nobody can book them, the owner neither. */
  | 'inactive'
  /** "Bookable online" is switched off: only the owner books them. */
  | 'switched-off'
  /** They offer no service at all. */
  | 'no-service'
  /** They offer services, but none of them is offered online. */
  | 'no-online-service'
  /** They have no regular working hours and no day entered for them. */
  | 'no-hours'
  /** They have working hours, but only at times the salon is closed. */
  | 'closed-hours';

/** What the booking page needs of the salon to offer a person. */
export interface BookingSetup {
  services: ServiceItem[];
  bookingHours: BookingHoursDay[];
  shiftOverview: ShiftEntry[];
}

/** The services a person offers, in the order of the service list. */
export const servicesOf = (services: ServiceItem[], employee: Pick<Employee, 'id'>): ServiceItem[] =>
  services.filter((service) => service.assignedEmployeeIds?.includes(employee.id));

/** Whether the person's hours on some day overlap the salon's opening hours of that weekday. */
function workingHoursGap(salon: BookingSetup, employee: Employee, today: string): 'no-hours' | 'closed-hours' | null {
  const openDuring = (date: string, hours: Hours): boolean => {
    const opening = salon.bookingHours.find((day) => day.day === openingHoursDay(date));
    return Boolean(opening?.isOpen) && hours.start < opening!.to && hours.end > opening!.from;
  };
  // The regular week, and the single days still to come that were entered for this person.
  const days: [date: string, hours: Hours][] = [];
  for (const day of WEEKDAY_KEYS) {
    const hours = employee.weeklyHours?.[day];
    if (isValidHours(hours)) days.push([dateOfWeekday(day), hours]);
  }
  for (const { date, hours } of enteredWorkingDays(salon.shiftOverview, employee.id, today)) days.push([date, hours]);
  if (days.length === 0) return 'no-hours';
  return days.some(([date, hours]) => openDuring(date, hours)) ? null : 'closed-hours';
}

/**
 * True when the person works at some time the salon is open. The booking page offers nobody
 * else: a specialist who could never have a free time is no choice for a customer.
 */
export const hasBookableHours = (salon: BookingSetup, employee: Employee, today: string): boolean =>
  workingHoursGap(salon, employee, today) === null;

/**
 * Everything that keeps customers from booking this person online, the most basic reason first.
 * Empty when the booking page offers them. `today` is the salon's date: days entered for the
 * past no longer count as working hours.
 */
export function bookingGaps(salon: BookingSetup, employee: Employee, today: string): BookingGap[] {
  const gaps: BookingGap[] = [];
  if (employee.status !== 'Active') gaps.push('inactive');
  // isBookableEmployee also asks for an active person; the switch alone is the second reason.
  else if (!isBookableEmployee(employee)) gaps.push('switched-off');
  const offered = salon.services.filter((service) => isEmployeeAssignedToService(service, employee));
  if (offered.length === 0) gaps.push('no-service');
  else if (!offered.some((service) => service.onlineBooking)) gaps.push('no-online-service');
  const hours = workingHoursGap(salon, employee, today);
  if (hours) gaps.push(hours);
  return gaps;
}

/** The reason in plain words, as the team list shows it beside "Not bookable yet". */
export const BOOKING_GAP_REASON: Record<BookingGap, string> = {
  'inactive': 'Set to inactive',
  'switched-off': '“Bookable online” is switched off',
  'no-service': 'No service chosen',
  'no-online-service': 'None of their services is offered online',
  'no-hours': 'No working hours',
  'closed-hours': 'Works only while the salon is closed',
};

/** The part of a person's form in which a gap is closed. */
export type FormSection = 'services' | 'hours' | 'booking';
export const BOOKING_GAP_SECTION: Record<BookingGap, FormSection> = {
  'inactive': 'booking',
  'switched-off': 'booking',
  'no-service': 'services',
  'no-online-service': 'services',
  'no-hours': 'hours',
  'closed-hours': 'hours',
};

export interface SetupStep {
  section: 'services' | 'hours';
  /** What to do, as a sentence. */
  text: string;
  /** What the button that leads there says. */
  action: string;
}

/**
 * What is still to do after a person was added before customers can book them: at most two
 * steps, the services they offer and their working hours. A person the owner set to inactive or
 * switched off for online booking on purpose has nothing missing, so the list is empty for them.
 */
export function setupSteps(salon: BookingSetup, employee: Employee, today: string): SetupStep[] {
  const gaps = bookingGaps(salon, employee, today);
  if (gaps.includes('inactive') || gaps.includes('switched-off')) return [];
  const name = employee.firstName.trim() || employee.name;
  const steps: SetupStep[] = [];
  if (gaps.includes('no-service')) steps.push({ section: 'services', text: `Choose the services ${name} offers.`, action: 'Choose services' });
  if (gaps.includes('no-online-service')) steps.push({ section: 'services', text: `Choose a service for ${name} that customers can book online.`, action: 'Choose services' });
  if (gaps.includes('no-hours')) steps.push({ section: 'hours', text: `Set the days and hours ${name} works.`, action: 'Set working hours' });
  if (gaps.includes('closed-hours')) steps.push({ section: 'hours', text: `Set working hours for ${name} that lie inside your opening hours.`, action: 'Set working hours' });
  return steps;
}

/**
 * The service list after a person's form was saved: the person offers exactly the ticked
 * services. Everybody else's services stay as they are, and a service that does not change
 * keeps its place and its object.
 */
export function withServicesOf(services: ServiceItem[], employeeId: string, serviceIds: string[]): ServiceItem[] {
  return services.map((service) => {
    const assigned = service.assignedEmployeeIds ?? [];
    const offers = assigned.includes(employeeId);
    if (offers === serviceIds.includes(service.id)) return service;
    const assignedEmployeeIds = offers ? assigned.filter((id) => id !== employeeId) : [...assigned, employeeId];
    return { ...service, assignedEmployeeIds, assignedEmployeesCount: assignedEmployeeIds.length };
  });
}
