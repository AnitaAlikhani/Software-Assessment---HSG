import type {
  AppointmentRequest,
  BookingHoursDay,
  CalendarEvent,
  ClosedDate,
  Employee,
  ServiceItem,
  ShiftEntry,
  StaffAbsence,
} from './types';
import { addDays, getSalonNow } from './scheduling';

export { getSalonNow } from './scheduling';

export interface AvailabilityContext {
  services: ServiceItem[];
  employees: Employee[];
  bookingHours: BookingHoursDay[];
  shiftOverview: ShiftEntry[];
  events: CalendarEvent[];
  requests: AppointmentRequest[];
  closedDates?: ClosedDate[];
  absences?: StaffAbsence[];
  timeZone?: string;
  /** Optional clock for deterministic tests or a live form's refresh cycle. */
  now?: Date;
}

export interface AvailabilitySelection {
  date: string;
  serviceId: string;
  employeeId: string;
  excludeRequestId?: string;
  excludeEventId?: string;
  /** Owner entry can use offline services/staff; physical availability still applies. */
  mode?: 'online' | 'owner';
}

type Interval = { start: number; end: number };
type BufferedService = { duration: number; prep: number; post: number };
type AvailabilityResult = { slots: string[]; error: string | null };

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const isBookableEmployee = (employee: Employee): boolean =>
  employee.status === 'Active' && employee.canBookOnline && !employee.hidden;

export const isEmployeeAssignedToService = (service: ServiceItem, employee: Employee): boolean =>
  service.assignedEmployeeIds?.includes(employee.id) ?? false;

const parseDate = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
};

const parseTime = (value: string): number | null => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const formatTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const parseInterval = (startTime: string, endTime: string): Interval | null => {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  return start !== null && end !== null && end > start ? { start, end } : null;
};

const requestInterval = (request: AppointmentRequest): Interval | null => {
  const match = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(request.timeStr);
  return match ? parseInterval(match[1], match[2]) : null;
};

const serviceTiming = (service: ServiceItem): BufferedService | null => {
  const duration = service.durationMinutes;
  const prep = service.prepMinutes ?? 0;
  const post = service.postMinutes ?? 0;
  if (!Number.isInteger(duration) || duration <= 0 || duration >= 1440) return null;
  if (![prep, post].every((value) => Number.isInteger(value) && value >= 0 && value < 1440)) return null;
  return { duration, prep, post };
};

// Stable IDs are authoritative. Only older records without IDs use names.
const matchesEmployee = (
  record: Pick<AppointmentRequest, 'employeeId' | 'staffName'>,
  employee: Employee,
): boolean => record.employeeId !== undefined
  ? record.employeeId === employee.id
  : record.staffName === employee.name;

const resolveRecordService = (
  context: AvailabilityContext,
  record: Pick<AppointmentRequest, 'serviceId' | 'serviceName'>,
): ServiceItem | undefined => record.serviceId !== undefined
  ? context.services.find((service) => service.id === record.serviceId)
  : context.services.find((service) => service.name === record.serviceName);

const getAvailability = (context: AvailabilityContext, selection: AvailabilitySelection): AvailabilityResult => {
  const unavailable = (error: string): AvailabilityResult => ({ slots: [], error });
  const date = parseDate(selection.date);
  if (!date) return unavailable('Choose a valid appointment date.');
  const now = context.now ?? new Date();
  const salonNow = getSalonNow(context.timeZone, now);
  if (selection.date < salonNow.date) return unavailable('Choose today or a future appointment date.');

  const service = context.services.find((item) => item.id === selection.serviceId);
  if (!service) return unavailable('This service no longer exists. Please choose another service.');
  if (selection.mode !== 'owner' && !service.onlineBooking) return unavailable('This service is not available for online booking.');
  const timing = serviceTiming(service);
  if (!timing) return unavailable('This service has an invalid duration or preparation time. Please update the service.');

  const employee = context.employees.find((item) => item.id === selection.employeeId);
  if (!employee || employee.status !== 'Active') return unavailable('This employee is not available. Please choose an active employee.');
  if (selection.mode !== 'owner' && !isBookableEmployee(employee)) return unavailable('This employee is not available for online booking.');
  if (!isEmployeeAssignedToService(service, employee)) return unavailable('This employee does not provide the selected service.');

  if (context.closedDates?.some((closure) => selection.date >= closure.start && selection.date <= closure.end)) {
    return unavailable('The salon is closed on this date. Please choose another date.');
  }
  if (context.absences?.some((absence) => absence.employeeId === employee.id &&
      selection.date >= absence.start && selection.date <= absence.end)) {
    return unavailable('This employee is away on this date. Please choose another date or specialist.');
  }

  const hours = context.bookingHours.find((day) => day.day === weekdays[date.getUTCDay()]);
  if (!hours || !hours.isOpen) return unavailable('The salon is closed on this date.');
  const salonInterval = parseInterval(hours.from, hours.to);
  if (!salonInterval) return unavailable('The salon opening hours are invalid for this date.');

  const shift = context.shiftOverview.find((entry) => entry.employeeId === employee.id)?.shifts[selection.date];
  if (!shift) return unavailable('This employee has no shift on this date.');
  const shiftInterval = parseInterval(shift.start, shift.end);
  if (!shiftInterval) return unavailable('This employee has an invalid shift on this date.');

  const window = {
    start: Math.max(salonInterval.start, shiftInterval.start),
    end: Math.min(salonInterval.end, shiftInterval.end),
  };
  if (window.end <= window.start) return unavailable('This employee has no working time during the salon opening hours.');

  const occupied: Interval[] = [];
  const addOccupied = (record: CalendarEvent | AppointmentRequest, interval: Interval | null): boolean => {
    if (!interval) return false;
    const occupiedService = resolveRecordService(context, record);
    const snapshot = 'startTime' in record && record.prepMinutes !== undefined && record.postMinutes !== undefined
      ? { prep: record.prepMinutes, post: record.postMinutes } : null;
    const buffers = snapshot ?? (occupiedService ? serviceTiming(occupiedService) : { prep: 0, post: 0 });
    if (!buffers) return false;
    if (![buffers.prep, buffers.post].every(value => Number.isInteger(value) && value >= 0 && value < 1440)) return false;
    occupied.push({ start: interval.start - buffers.prep, end: interval.end + buffers.post });
    return true;
  };

  for (const event of context.events) {
    if (event.id !== selection.excludeEventId && event.date === selection.date && matchesEmployee(event, employee)) {
      if (!addOccupied(event, parseInterval(event.startTime, event.endTime))) {
        return unavailable('This employee has an appointment with invalid times. Please review the calendar.');
      }
    }
  }
  for (const request of context.requests) {
    if (request.id !== selection.excludeRequestId && request.status === 'pending' &&
        request.date === selection.date && matchesEmployee(request, employee)) {
      if (!addOccupied(request, requestInterval(request))) {
        return unavailable('This employee has a pending request with invalid times. Please review the request.');
      }
    }
  }

  const slots: string[] = [];
  const firstStart = Math.ceil((window.start + timing.prep) / 30) * 30;
  const lastStart = window.end - timing.duration - timing.post;
  const currentMinute = parseTime(salonNow.time)! + now.getUTCSeconds() / 60 + now.getUTCMilliseconds() / 60000;
  for (let start = firstStart; start <= lastStart; start += 30) {
    const candidate = { start: start - timing.prep, end: start + timing.duration + timing.post };
    // Preparation also needs to happen in the future, not just the service start.
    if (selection.date === salonNow.date && candidate.start < currentMinute) continue;
    // Strict inequalities allow one appointment to start exactly when another ends.
    if (!occupied.some((interval) => candidate.start < interval.end && candidate.end > interval.start)) {
      slots.push(formatTime(start));
    }
  }
  return { slots, error: null };
};

export const getAvailableSlots = (context: AvailabilityContext, selection: AvailabilitySelection): string[] =>
  getAvailability(context, selection).slots;

/** All owner and scripted-chat calendar writes use the same physical booking rules. */
export const validateCalendarEvent = (
  context: AvailabilityContext,
  event: Omit<CalendarEvent, 'id'>,
  excludeEventId?: string,
): string | null => {
  if (!event.customerName.trim()) return 'Enter a customer name.';
  const service = resolveRecordService(context, event);
  if (!service) return 'This service no longer exists. Please choose another service.';
  const employees = event.employeeId !== undefined
    ? context.employees.filter(employee => employee.id === event.employeeId)
    : context.employees.filter(employee => employee.name === event.staffName);
  if (employees.length !== 1) return 'Choose an active employee for this appointment.';
  const availability = getAvailability(context, {
    date: event.date, serviceId: service.id, employeeId: employees[0].id,
    excludeEventId, mode: 'owner',
  });
  if (availability.error) return availability.error;
  const interval = parseInterval(event.startTime, event.endTime);
  if (!interval || interval.end - interval.start !== service.durationMinutes) {
    return `Choose a valid ${service.durationMinutes}-minute slot on the same day.`;
  }
  if (!availability.slots.includes(event.startTime)) {
    return 'This time is not available. Choose a slot within the employee’s shift and salon hours, without overlapping another booking.';
  }
  return null;
};

/** Find the earliest available date in the 90-day window beginning at fromDate. */
export const getNextAvailableDate = (
  context: AvailabilityContext,
  serviceId: string,
  fromDate: string,
  employeeId?: string,
  excludeRequestId?: string,
): string | null => {
  if (!parseDate(fromDate)) return null;
  const snapshot = { ...context, now: context.now ?? new Date() };
  const today = getSalonNow(context.timeZone, snapshot.now).date;
  const firstDate = fromDate < today ? today : fromDate;
  const service = context.services.find((item) => item.id === serviceId);
  if (!service?.onlineBooking) return null;
  const eligible = context.employees.filter((employee) =>
    (!employeeId || employee.id === employeeId) && isBookableEmployee(employee) && isEmployeeAssignedToService(service, employee));
  if (eligible.length === 0) return null;
  for (let offset = 0; offset < 90; offset++) {
    const date = addDays(firstDate, offset);
    if (eligible.some((employee) => getAvailableSlots(snapshot, {
      date, serviceId, employeeId: employee.id, excludeRequestId,
    }).length > 0)) return date;
  }
  return null;
};

export const validateBookingRequest = (
  context: AvailabilityContext,
  request: AppointmentRequest,
  excludeRequestId?: string,
): string | null => {
  const service = resolveRecordService(context, request);
  if (!service) return 'This service no longer exists. Please choose another service.';

  const matchingEmployees = request.employeeId !== undefined
    ? context.employees.filter((employee) => employee.id === request.employeeId)
    : context.employees.filter((employee) => employee.name === request.staffName);
  if (matchingEmployees.length !== 1) return 'Please select an available employee for this request.';
  const employee = matchingEmployees[0];

  const availability = getAvailability(context, {
    date: request.date,
    serviceId: service.id,
    employeeId: employee.id,
    excludeRequestId,
  });
  if (availability.error) return availability.error;

  const interval = requestInterval(request);
  if (!interval) return 'Choose a valid start and end time on the same day.';
  if (interval.end - interval.start !== service.durationMinutes) {
    return `This service needs ${service.durationMinutes} minutes. Please choose a new time slot.`;
  }
  if (!availability.slots.includes(formatTime(interval.start))) {
    return 'This time is no longer available for the selected employee and service. Please choose another slot.';
  }
  return null;
};
