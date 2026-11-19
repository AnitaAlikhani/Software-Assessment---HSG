import type { AssistantData } from '../src/assistant/execute';
import type { InterpreterContext } from '../src/assistant/interpret';
import { addDays, addMinutes, dayKeyForDate, formatCalendarDate } from '../src/scheduling';
import type { AppointmentRequest, CalendarEvent, Customer, Employee, ServiceItem, ShiftEntry } from '../src/types';
import { FIXED_NOW } from './fixedClock';

/**
 * A small invented salon for the assistant tests, independent of the app's sample data.
 * "Today" is Monday 5 October 2026, 12:00 in Zurich (FIXED_NOW).
 *
 * Selina works Monday to Friday 09:00-18:00, Luca Wednesday to Friday 10:00-18:00.
 * The salon is closed on Saturday and Sunday.
 */
export const TODAY = '2026-10-05';
export const TUESDAY = '2026-10-06';
export const WEDNESDAY = '2026-10-07';
export const THURSDAY = '2026-10-08';
export const FRIDAY = '2026-10-09';
export const SATURDAY = '2026-10-10';

const employee = (id: string, firstName: string, lastName: string, partial: Partial<Employee> = {}): Employee => ({
  id, firstName, lastName, name: `${firstName} ${lastName}`, initials: `${firstName[0]}${lastName[0]}`, email: '', phone: '',
  status: 'Active', location: 'Salon', canBookOnline: true, hidden: false, ...partial,
});
const service = (id: string, name: string, durationMinutes: number, assignedEmployeeIds: string[], partial: Partial<ServiceItem> = {}): ServiceItem => ({
  id, name, durationMinutes, priceCHF: 50, onlineBooking: true, assignedEmployeesCount: assignedEmployeeIds.length, assignedEmployeeIds, ...partial,
});
const customer = (id: string, name: string, phone: string): Customer => ({
  id, name, initials: name.split(' ').map(part => part[0]).join(''), email: '', phone, language: 'DE',
});

export const SELINA = employee('emp-1', 'Selina', 'Keller');
export const LUCA = employee('emp-2', 'Luca', 'Frei');
export const HAIRCUT = service('srv-cut', 'Haircut', 30, ['emp-1', 'emp-2'], { category: 'Haircut' });
/** The owner books colour work herself: it is not offered online, which the assistant must not mind. */
export const COLOURING = service('srv-colour', 'Colouring', 90, ['emp-1', 'emp-2'], { category: 'Colour', onlineBooking: false });
export const BLOW_DRY = service('srv-blow', 'Wash & blow-dry', 30, ['emp-2'], { category: 'Styling' });

export const appointment = (id: string, customerName: string, item: ServiceItem, staff: Employee, date: string, startTime: string, partial: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, customerName, serviceId: item.id, serviceName: item.name, employeeId: staff.id, staffName: staff.name,
  date, day: dayKeyForDate(date), dateDisplay: formatCalendarDate(date), startTime, endTime: addMinutes(startTime, item.durationMinutes),
  colorTheme: 'blue', ...partial,
});

const shifts = (staff: Employee, weekdays: number[], start: string): ShiftEntry => {
  const days: ShiftEntry['shifts'] = {};
  for (let offset = 0; offset < 120; offset += 1) {
    const date = addDays(TODAY, offset);
    days[date] = weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? { start, end: '18:00' } : null;
  }
  return { employeeId: staff.id, employeeName: staff.name, initials: staff.initials, avatarColor: '', shifts: days };
};

const pendingRequest: AppointmentRequest = {
  id: 'req-tom', customerName: 'Tom Graf', serviceId: HAIRCUT.id, serviceName: HAIRCUT.name, employeeId: SELINA.id, staffName: SELINA.name,
  date: FRIDAY, dateStr: '9 October 2026', timeStr: '11:00 - 11:30', timeAgo: 'Now', status: 'pending',
};

/** A fresh copy of the salon for every test, so no test sees another test's changes. */
export function salon(partial: Partial<AssistantData> = {}): AssistantData {
  return {
    services: [HAIRCUT, COLOURING, BLOW_DRY],
    employees: [SELINA, LUCA],
    customers: [
      customer('cust-lea', 'Lea Brunner', '+41 00 000 00 01'),
      customer('cust-marco', 'Marco Bianchi', '+41 00 000 00 02'),
      customer('cust-sandra', 'Sandra Meier', '+41 00 000 00 03'),
      customer('cust-girard', 'Léa Girard', '+41 00 000 00 04'),
    ],
    bookingHours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      .map(day => ({ day, isOpen: day !== 'Saturday' && day !== 'Sunday', from: '09:00', to: '18:00' })),
    shiftOverview: [shifts(SELINA, [1, 2, 3, 4, 5], '09:00'), shifts(LUCA, [3, 4, 5], '10:00')],
    events: [
      appointment('cal-lea', 'Lea Brunner', HAIRCUT, SELINA, TUESDAY, '10:00', { customerId: 'cust-lea' }),
      // Thursday 15:00 is taken with both stylists.
      appointment('cal-marco', 'Marco Bianchi', HAIRCUT, SELINA, THURSDAY, '15:00', { customerId: 'cust-marco' }),
      appointment('cal-sandra', 'Sandra Meier', COLOURING, LUCA, THURSDAY, '15:00', { customerId: 'cust-sandra' }),
      appointment('cal-fri-1', 'Léa Girard', HAIRCUT, SELINA, FRIDAY, '09:00', { customerId: 'cust-girard' }),
      appointment('cal-fri-2', 'Marco Bianchi', HAIRCUT, LUCA, FRIDAY, '14:00', { customerId: 'cust-marco' }),
      appointment('cal-fri-3', 'Sandra Meier', BLOW_DRY, LUCA, FRIDAY, '16:00', { customerId: 'cust-sandra' }),
    ],
    requests: [pendingRequest],
    closedDates: [],
    absences: [],
    timeZone: 'Europe/Zurich',
    now: FIXED_NOW,
    ...partial,
  };
}

/** What the interpreter is told about the same salon. */
export function words(partial: Partial<InterpreterContext> = {}): InterpreterContext {
  const data = salon();
  return { today: TODAY, services: data.services, employees: data.employees, customers: data.customers, ...partial };
}
