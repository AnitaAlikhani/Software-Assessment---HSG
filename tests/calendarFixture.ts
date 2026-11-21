import type { CalendarSalon } from '../src/calendarLayout';
import { spanOf, type Span } from '../src/calendarLayout';
import type { BookingHoursDay, CalendarEvent, Employee, ShiftEntry } from '../src/types';

/**
 * A small salon for the calendar's tests: three stylists and one week, Monday 5 to Sunday
 * 11 October 2026, with every working day written out. The tests then say themselves who works
 * when, and do not depend on how the sample salon stores its working hours.
 */

export const person = (id: string, firstName: string, lastName: string, status: Employee['status'] = 'Active'): Employee => ({
  id, firstName, lastName, name: `${firstName} ${lastName}`, initials: `${firstName[0]}${lastName[0]}`, email: '', phone: '',
  status, location: '', canBookOnline: true, hidden: false,
});
export const ANNA = person('emp-1', 'Anna', 'Weber');
export const SELINA = person('emp-2', 'Selina', 'Keller');
export const LUCA = person('emp-3', 'Luca', 'Frei');
export const TEAM = [ANNA, SELINA, LUCA];

/** A person's working hours by date: hours, or null for a day off. */
export const shifts = (employee: Employee, days: Record<string, [string, string] | null>): ShiftEntry => ({
  employeeId: employee.id, employeeName: employee.name, initials: employee.initials, avatarColor: '',
  shifts: Object.fromEntries(Object.entries(days).map(([date, hours]) => [date, hours ? { start: hours[0], end: hours[1] } : null])),
});

export const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
export const [MON, TUE, WED, THU, FRI, SAT, SUN] = WEEK;

// Anna works whole days, Selina part of Thursday, Luca on Tuesday, Friday and Saturday only.
export const SHIFTS: ShiftEntry[] = [
  shifts(ANNA, { [MON]: null, [TUE]: ['08:30', '17:00'], [WED]: ['08:30', '17:00'], [THU]: ['10:00', '18:30'], [FRI]: ['10:00', '18:30'], [SAT]: ['08:00', '14:00'], [SUN]: null }),
  shifts(SELINA, { [MON]: null, [TUE]: null, [WED]: ['10:00', '18:30'], [THU]: ['12:00', '15:30'], [FRI]: ['08:30', '17:00'], [SAT]: ['08:00', '16:00'], [SUN]: null }),
  shifts(LUCA, { [MON]: null, [TUE]: ['10:00', '18:30'], [WED]: null, [THU]: null, [FRI]: ['10:00', '18:30'], [SAT]: ['09:00', '16:00'], [SUN]: null }),
];

// Closed on Sunday and Monday, shorter on Saturday.
export const HOURS: BookingHoursDay[] = [
  { day: 'Monday', isOpen: false, from: '08:30', to: '18:30' },
  { day: 'Tuesday', isOpen: true, from: '08:30', to: '18:30' },
  { day: 'Wednesday', isOpen: true, from: '08:30', to: '18:30' },
  { day: 'Thursday', isOpen: true, from: '08:30', to: '18:30' },
  { day: 'Friday', isOpen: true, from: '08:30', to: '18:30' },
  { day: 'Saturday', isOpen: true, from: '08:00', to: '16:00' },
  { day: 'Sunday', isOpen: false, from: '08:30', to: '18:30' },
];

export const SALON: CalendarSalon = { employees: TEAM, shiftOverview: SHIFTS, bookingHours: HOURS };

/** An appointment with one of the team, or with a name that belongs to nobody in it. */
export const appointment = (
  id: string, employee: Employee | string, date: string, startTime: string, endTime: string, partial: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id, customerName: id, serviceName: 'Haircut', serviceId: 'srv-2', date, day: 'mon', dateDisplay: '', startTime, endTime, colorTheme: 'blue',
  ...(typeof employee === 'string' ? { staffName: employee } : { employeeId: employee.id, staffName: employee.name }),
  ...partial,
});

export const span = (start: string, end: string): Span => spanOf(start, end)!;

/** The moment at which the salon's clock (Zurich, summer time) shows this date and time in that week. */
export const moment = (date: string, time: string): Date => new Date(`${date}T${time}:00+02:00`);
