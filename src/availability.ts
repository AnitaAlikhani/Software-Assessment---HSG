import type {
  AppointmentRequest,
  BookingHoursDay,
  CalendarEvent,
  ClosedDate,
  Employee,
  ServiceItem,
  ShiftEntry,
  StaffAbsence,
  TimeBlock,
} from './types';
import { addDays, getSalonNow } from './scheduling';
import { workingTimeOn } from './workingHours';

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
  /** Time the owner keeps free for a stylist (src/timeBlocks.ts). */
  timeBlocks?: TimeBlock[];
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
  /**
   * The owner booked this appointment outside the usual hours on purpose: neither the opening
   * hours nor the stylist's working hours of that day limit it, only OUTSIDE_HOURS_WINDOW.
   */
  outsideHoursApproved?: boolean;
}

/**
 * The part of the day an appointment the owner books outside the usual hours may lie in: from six
 * in the morning until eleven at night. Wide enough for an early bridal styling or a late evening,
 * and it changes nobody's working hours, so online booking never offers a time nobody planned.
 */
export const OUTSIDE_HOURS_WINDOW = { start: '06:00', end: '23:00' } as const;

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
  // An appointment the owner is changing keeps its own day and its own start, also when they
  // have passed: the service, the stylist or the customer is corrected afterwards. That one
  // start is all that is let through. The rules below still decide about it (with the one
  // allowance of `keepsOwnPlace`), and no other time in the past opens.
  const own = selection.mode === 'owner' && selection.excludeEventId !== undefined
    ? context.events.find((event) => event.id === selection.excludeEventId) : undefined;
  const ownStart = own !== undefined && own.date === selection.date ? parseTime(own.startTime) : null;
  if (selection.date < salonNow.date && ownStart === null) return unavailable('Choose today or a future appointment date.');

  const service = context.services.find((item) => item.id === selection.serviceId);
  if (!service) return unavailable('This service no longer exists. Please choose another service.');
  if (selection.mode !== 'owner' && !service.onlineBooking) return unavailable('This service is not available for online booking.');
  const timing = serviceTiming(service);
  if (!timing) return unavailable('This service has an invalid duration or preparation time. Please update the service.');

  const employee = context.employees.find((item) => item.id === selection.employeeId);
  if (!employee || employee.status !== 'Active') return unavailable('This employee is not available. Please choose an active employee.');
  if (selection.mode !== 'owner' && !isBookableEmployee(employee)) return unavailable('This employee is not available for online booking.');
  if (!isEmployeeAssignedToService(service, employee)) return unavailable('This employee does not provide the selected service.');

  // The same allowance goes one step further for an appointment that keeps its day, its start and
  // its stylist: a closed date, an absence or other hours entered after it was booked do not take
  // its place away (Team › Absences says existing appointments are kept). Only its own start gets
  // through, and other bookings, waiting requests and time blocks still decide about it.
  const keepsOwnPlace = ownStart !== null && matchesEmployee(own!, employee);
  const ownSpan = keepsOwnPlace ? parseInterval(own!.startTime, own!.endTime) : null;
  // What refuses the whole day. For the appointment that keeps its place it only means that no
  // other time of that day opens.
  let dayRefusal: AvailabilityResult | null = null;
  let window: Interval | null = null;

  if (context.closedDates?.some((closure) => selection.date >= closure.start && selection.date <= closure.end)) {
    dayRefusal = unavailable('The salon is closed on this date. Please choose another date.');
  } else if (context.absences?.some((absence) => absence.employeeId === employee.id &&
      selection.date >= absence.start && selection.date <= absence.end)) {
    dayRefusal = unavailable('This employee is away on this date. Please choose another date or specialist.');
  }
  if (dayRefusal && !keepsOwnPlace) return dayRefusal;

  const outsideHours = selection.mode === 'owner' && selection.outsideHoursApproved === true;
  if (outsideHours) {
    // Booked outside the usual hours on purpose: neither the opening hours nor the working hours
    // of that day count, so nobody's working hours have to change for it.
    window = { start: parseTime(OUTSIDE_HOURS_WINDOW.start)!, end: parseTime(OUTSIDE_HOURS_WINDOW.end)! };
  } else {
    const hours = context.bookingHours.find((day) => day.day === weekdays[date.getUTCDay()]);
    const shift = workingTimeOn(context, employee.id, selection.date);
    const shiftInterval = shift ? parseInterval(shift.start, shift.end) : null;
    const salonInterval = hours?.isOpen ? parseInterval(hours.from, hours.to) : null;
    if (shiftInterval && salonInterval) {
      const overlap = { start: Math.max(salonInterval.start, shiftInterval.start), end: Math.min(salonInterval.end, shiftInterval.end) };
      if (overlap.end > overlap.start) window = overlap;
    }
    const hoursRefusal = !hours || !hours.isOpen ? unavailable('The salon is closed on this date.')
      : !shift ? unavailable('This employee does not work on this date.')
        : !shiftInterval ? unavailable('This employee’s working hours on this date are invalid.')
          : !salonInterval ? unavailable('The salon opening hours are invalid for this date.')
            : !window ? unavailable('This employee has no working time during the salon opening hours.')
              : null;
    if (hoursRefusal && !keepsOwnPlace) return hoursRefusal;
    dayRefusal ??= hoursRefusal;
  }

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

  // A block is kept free exactly from its start to its end: it has no preparation time around it.
  for (const block of context.timeBlocks ?? []) {
    if (block.employeeId !== employee.id || block.date !== selection.date) continue;
    const interval = parseInterval(block.startTime, block.endTime);
    if (interval) occupied.push(interval);
  }

  const currentMinute = parseTime(salonNow.time)! + now.getUTCSeconds() / 60 + now.getUTCMilliseconds() / 60000;
  const free = (start: number): boolean => {
    const candidate = { start: start - timing.prep, end: start + timing.duration + timing.post };
    // Preparation also needs to happen in the future, not just the service start.
    const passed = selection.date < salonNow.date || (selection.date === salonNow.date && candidate.start < currentMinute);
    if (passed && start !== ownStart) return false;
    // Strict inequalities allow one appointment to start exactly when another ends.
    return !occupied.some((interval) => candidate.start < interval.end && candidate.end > interval.start);
  };
  const fits = (start: number, bounds: Interval): boolean =>
    start - timing.prep >= bounds.start && start + timing.duration + timing.post <= bounds.end;

  const starts = new Set<number>();
  // On a day that is closed, or that the stylist is away, nothing but the own start opens.
  if (window && !dayRefusal) {
    for (let start = Math.ceil((window.start + timing.prep) / 30) * 30; fits(start, window); start += 30) starts.add(start);
  }
  if (keepsOwnPlace && ownSpan && ownStart !== null) {
    // The own start may reach as far as the hours of the day, or as far as the appointment itself
    // reached when it was booked, whichever is wider. A day without hours any more (a day off, a
    // weekday the salon now keeps closed) is bounded like a booking outside the usual hours. So a
    // longer service still fits, but it never runs into another booking (see `free`).
    const reached = { start: ownSpan.start - (own!.prepMinutes ?? timing.prep), end: ownSpan.end + (own!.postMinutes ?? timing.post) };
    const day = window ?? { start: parseTime(OUTSIDE_HOURS_WINDOW.start)!, end: parseTime(OUTSIDE_HOURS_WINDOW.end)! };
    const bounds = { start: Math.min(day.start, reached.start), end: Math.max(day.end, reached.end) };
    if (fits(ownStart, bounds)) starts.add(ownStart);
  }
  const slots = [...starts].sort((a, b) => a - b).filter(free).map(formatTime);
  return { slots, error: null };
};

export const getAvailableSlots = (context: AvailabilityContext, selection: AvailabilitySelection): string[] =>
  getAvailability(context, selection).slots;

/**
 * The first active employee who offers the service and is free at that time. Used when a chat
 * booking names no stylist: the owner's rules apply, so services that are not offered online count.
 */
export const firstFreeEmployee = (
  context: AvailabilityContext, serviceId: string, date: string, startTime: string, excludeEventId?: string,
): Employee | null => context.employees.find((employee) => getAvailableSlots(context, {
  date, serviceId, employeeId: employee.id, mode: 'owner', excludeEventId,
}).includes(startTime)) ?? null;

/**
 * True when the time is not completely inside the salon's regular hours of that weekday.
 * The owner may still book it on purpose (outsideHoursApproved); this says whether that is the case.
 */
export const isOutsideOpeningHours = (
  bookingHours: BookingHoursDay[], date: string, startTime: string, endTime: string,
): boolean => {
  const day = parseDate(date);
  const interval = parseInterval(startTime, endTime);
  if (!day || !interval) return false;
  const hours = bookingHours.find((item) => item.day === weekdays[day.getUTCDay()]);
  const open = hours?.isOpen ? parseInterval(hours.from, hours.to) : null;
  return !open || interval.start < open.start || interval.end > open.end;
};

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
    excludeEventId, mode: 'owner', outsideHoursApproved: event.outsideHoursApproved,
  });
  if (availability.error) return availability.error;
  const interval = parseInterval(event.startTime, event.endTime);
  if (!interval || interval.end - interval.start !== service.durationMinutes) {
    return `Choose a valid ${service.durationMinutes}-minute slot on the same day.`;
  }
  if (!availability.slots.includes(event.startTime)) {
    return 'This time is not available. Choose a time within the employee’s working hours and the opening hours, without overlapping another booking.';
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
