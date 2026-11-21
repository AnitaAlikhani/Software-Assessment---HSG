import type { AppointmentRequest, CalendarEvent, Employee, ServiceItem, TimeBlock } from './types';
import { formatDate, formatStoredTimeRange, formatTimeRange } from './format';
import { getSalonNow } from './scheduling';

/**
 * Time the owner keeps free for one stylist: a break, lunch, something private.
 *
 * A block counts as occupied for that stylist on that day, exactly from its start to its end
 * (src/availability.ts counts it next to appointments and waiting requests). This file holds the
 * plain rules for making or changing one, and the words the screens use for it.
 */

export const TIME_BLOCK_REASONS: readonly TimeBlock['reason'][] = ['Break', 'Lunch', 'Private', 'Other'];

/** Blocks start and end on the quarter hour: finer steps add nothing in a salon and only make mistakes. */
export const BLOCK_STEP_MINUTES = 15;

/** The longest note a block takes: it is a reminder, not a text. */
export const BLOCK_NOTE_LENGTH = 80;

/** What a block is for, in a sentence ("lunch"), or the note of an "Other" block. Empty when there is nothing to say. */
export function blockReasonText(block: Pick<TimeBlock, 'reason' | 'note'>): string {
  if (block.reason === 'Other') return block.note?.trim() ?? '';
  return block.reason.toLowerCase();
}

/** What a block is called on its own: "Lunch", or the note of an "Other" block, else "Blocked". */
export function blockTitle(block: Pick<TimeBlock, 'reason' | 'note'>): string {
  if (block.reason !== 'Other') return block.reason;
  return block.note?.trim() || 'Blocked';
}

const minutesOf = (time: string): number | null =>
  /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null;

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean => a.start < b.end && a.end > b.start;

/** The block of this stylist that lies over the given time on that day, if there is one. */
export function blockAt(
  blocks: readonly TimeBlock[] | undefined, employeeId: string, date: string, startTime: string, endTime: string,
): TimeBlock | undefined {
  const start = minutesOf(startTime);
  const end = minutesOf(endTime);
  if (start === null || end === null) return undefined;
  return blocks?.find((block) => {
    const from = minutesOf(block.startTime);
    const to = minutesOf(block.endTime);
    return block.employeeId === employeeId && block.date === date && from !== null && to !== null && overlaps({ start, end }, { start: from, end: to });
  });
}

/** What the rules need to know about the salon to judge a block. */
export interface TimeBlockSalon {
  employees: Employee[];
  services: ServiceItem[];
  events: CalendarEvent[];
  requests: AppointmentRequest[];
  timeBlocks?: TimeBlock[];
  timeZone?: string;
  now?: Date;
}

// Ids decide; only an older record without an id is matched by the name.
const isWith = (record: { employeeId?: string; staffName?: string }, employee: Employee): boolean =>
  record.employeeId !== undefined ? record.employeeId === employee.id : record.staffName === employee.name;

const serviceOf = (services: ServiceItem[], record: Pick<CalendarEvent, 'serviceId' | 'serviceName'>): ServiceItem | undefined =>
  record.serviceId !== undefined ? services.find((item) => item.id === record.serviceId) : services.find((item) => item.name === record.serviceName);

/**
 * Whether a block can be kept as entered. Null when it can; otherwise what is wrong, in a
 * sentence the owner can act on.
 *
 * `original` is the stored block that is being changed (or put back after a removal): it never
 * stands in its own way, and it may keep a date that has passed. A new block starts today or later.
 * A block may lie outside the stylist's working hours: there it keeps nothing free, but harms nothing either.
 */
export function timeBlockProblem(salon: TimeBlockSalon, block: Omit<TimeBlock, 'id'>, original?: TimeBlock): string | null {
  const employee = salon.employees.find((item) => item.id === block.employeeId);
  if (!employee) return 'Choose a stylist.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(block.date) || Number.isNaN(Date.parse(`${block.date}T00:00:00Z`))) return 'Choose a date.';
  const today = getSalonNow(salon.timeZone, salon.now ?? new Date()).date;
  if (block.date < today && block.date !== original?.date) return 'Choose today or a later date.';
  const start = minutesOf(block.startTime);
  const end = minutesOf(block.endTime);
  if (start === null || end === null) return 'Choose a start and an end time.';
  if (start % BLOCK_STEP_MINUTES !== 0 || end % BLOCK_STEP_MINUTES !== 0) return 'Choose times on the quarter hour, for example 12:00 or 12:15.';
  if (end <= start) return 'The end must be after the start.';
  if (!TIME_BLOCK_REASONS.includes(block.reason)) return 'Choose a reason.';
  if ((block.note ?? '').length > BLOCK_NOTE_LENGTH) return `Keep the note to ${BLOCK_NOTE_LENGTH} characters.`;

  const wanted = { start, end };
  const day = formatDate(block.date);
  // An appointment holds its time and the minutes to prepare and clear up around it, as the slot rules count it.
  for (const event of salon.events) {
    if (event.date !== block.date || !isWith(event, employee)) continue;
    const from = minutesOf(event.startTime);
    const to = minutesOf(event.endTime);
    if (from === null || to === null) continue;
    const service = serviceOf(salon.services, event);
    const prep = event.prepMinutes ?? service?.prepMinutes ?? 0;
    const post = event.postMinutes ?? service?.postMinutes ?? 0;
    if (!overlaps(wanted, { start: from - prep, end: to + post })) continue;
    const around = overlaps(wanted, { start: from, end: to }) ? '' : ' (with the time to prepare and clear up around it)';
    return `${employee.name} has an appointment with ${event.customerName} at ${formatTimeRange(event.startTime, event.endTime)}${around} on ${day}. Choose another time, or move the appointment first.`;
  }
  for (const request of salon.requests) {
    if (request.status !== 'pending' || request.date !== block.date || !isWith(request, employee)) continue;
    const match = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(request.timeStr);
    const from = match ? minutesOf(match[1]) : null;
    const to = match ? minutesOf(match[2]) : null;
    if (from === null || to === null) continue;
    const service = serviceOf(salon.services, request);
    if (!overlaps(wanted, { start: from - (service?.prepMinutes ?? 0), end: to + (service?.postMinutes ?? 0) })) continue;
    return `${request.customerName} has asked for ${employee.name} at ${formatStoredTimeRange(request.timeStr)} on ${day}. Answer that request on Home first, or choose another time.`;
  }
  const other = (salon.timeBlocks ?? []).find((item) => item.id !== original?.id && item.employeeId === employee.id && item.date === block.date
    && overlaps(wanted, { start: minutesOf(item.startTime) ?? 0, end: minutesOf(item.endTime) ?? 0 }));
  if (other) {
    const why = blockReasonText(other);
    return `${employee.name} already has ${formatTimeRange(other.startTime, other.endTime)} blocked on ${day}${why ? ` (${why})` : ''}. Change that block instead.`;
  }
  return null;
}

/** The times a block can start or end at: every quarter hour of the day. */
export const blockTimes = (): string[] => Array.from({ length: (24 * 60) / BLOCK_STEP_MINUTES }, (_, index) => {
  const minutes = index * BLOCK_STEP_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});
