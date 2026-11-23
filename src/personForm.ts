import type { BookingHoursDay, Employee, ServiceItem } from './types';
import { formatPhone, normalizePhone, openingHoursDay } from './format';
import { validateOptionalContact, validatePersonName, validateWeeklyHours } from './managementValidation';
import { servicesOf } from './teamBooking';
import { TEXT_LIMITS } from './fieldLimits';
import { dateOfWeekday, isValidHours, WEEKDAY_KEYS, weeklyHoursFromOpeningHours, type WeeklyHours } from './workingHours';

/**
 * What the form of one person in Team holds, and how it becomes the stored person.
 * The screen (src/views/EmployeesView.tsx) only shows these values and changes them; reading a
 * person into the form and checking the form before it is saved happen here, so both can be
 * tested without a browser.
 */

/** One weekday in the form: whether the person works then, and from when to when. */
export interface DayRow {
  works: boolean;
  start: string;
  end: string;
}

export interface PersonForm {
  firstName: string;
  lastName: string;
  email: string;
  /** As typed or as shown ("+41 79 555 31 08"); stored in the international form. */
  phone: string;
  /** The regular week, Monday first. A day off keeps its times, for when it is switched on again. */
  days: DayRow[];
  /** The services the person offers. */
  serviceIds: string[];
  /** The one switch for the booking page. */
  bookableOnline: boolean;
  /** The status: active, or inactive. */
  active: boolean;
}

/** The times a day off starts with when it is switched on: the opening hours of that weekday, else a usual day. */
const usualTimes = (bookingHours: BookingHoursDay[], dayIndex: number): { start: string; end: string } => {
  const opening = bookingHours.find((item) => item.day === openingHoursDay(dateOfWeekday(WEEKDAY_KEYS[dayIndex])));
  const hours = opening ? { start: opening.from, end: opening.to } : null;
  return isValidHours(hours) ? hours : { start: '09:00', end: '18:00' };
};

/**
 * The form as it opens. For a new person (`employee` null) the working hours are the salon's
 * opening hours, so somebody who is added with a service can be booked at once; no service is
 * ticked yet. For a person in the team it shows what is stored: somebody without a regular
 * week opens with every day off, and one switch stands for "can be booked online" (an older
 * record that was hidden opens with the switch off).
 */
export function personFormFor(
  employee: Employee | null, salon: { services: ServiceItem[]; bookingHours: BookingHoursDay[] },
): PersonForm {
  const week = employee ? employee.weeklyHours : weeklyHoursFromOpeningHours(salon.bookingHours);
  return {
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    email: employee?.email ?? '',
    phone: formatPhone(employee?.phone ?? ''),
    days: WEEKDAY_KEYS.map((day, index) => {
      const hours = week?.[day];
      return hours ? { works: true, start: hours.start, end: hours.end } : { works: false, ...usualTimes(salon.bookingHours, index) };
    }),
    serviceIds: employee ? servicesOf(salon.services, employee).map((service) => service.id) : [],
    bookableOnline: employee ? employee.canBookOnline && !employee.hidden : true,
    active: employee ? employee.status === 'Active' : true,
  };
}

/** The regular week the form's rows stand for: null for a day off. */
export const weekFromRows = (days: DayRow[]): WeeklyHours => {
  const week = {} as WeeklyHours;
  WEEKDAY_KEYS.forEach((day, index) => {
    const row = days[index];
    week[day] = row?.works ? { start: row.start, end: row.end } : null;
  });
  return week;
};

export type PersonToSave =
  | { error: string }
  | { details: Omit<Employee, 'id' | 'initials' | 'name'>; serviceIds: string[] };

/**
 * Checks the form and turns it into what is stored: the person's details with their regular
 * week, and the services they offer. Only services the salon still has are kept.
 */
export function personFromForm(form: PersonForm, salon: { services: ServiceItem[]; companyName: string }): PersonToSave {
  if (!form.firstName.trim() || !form.lastName.trim()) return { error: 'Enter the employee’s first and last names.' };
  // The server's limits (server/salon.ts), said here before saving rather than refused after.
  if (form.firstName.trim().length > TEXT_LIMITS.name || form.lastName.trim().length > TEXT_LIMITS.name) return { error: `A first or last name can be at most ${TEXT_LIMITS.name} characters.` };
  if (form.email.trim().length > TEXT_LIMITS.email) return { error: `The email address can be at most ${TEXT_LIMITS.email} characters.` };
  if (form.phone.trim().length > TEXT_LIMITS.phone) return { error: `The phone number can be at most ${TEXT_LIMITS.phone} characters.` };
  const weeklyHours = weekFromRows(form.days);
  const error = validatePersonName(`${form.firstName} ${form.lastName}`, 'the employee’s')
    ?? validateOptionalContact(form.email, form.phone)
    ?? validateWeeklyHours(weeklyHours);
  if (error) return { error };
  return {
    details: {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      // Stored once, in the international form; the list writes it out again.
      phone: form.phone.trim() ? normalizePhone(form.phone) : '',
      status: form.active ? 'Active' : 'Inactive',
      location: salon.companyName,
      // One switch decides about the booking page. "Hidden" did the same thing a second time:
      // it is cleared whenever a person is saved, so the two can no longer disagree.
      canBookOnline: form.bookableOnline,
      hidden: false,
      weeklyHours,
    },
    serviceIds: form.serviceIds.filter((id) => salon.services.some((service) => service.id === id)),
  };
}
