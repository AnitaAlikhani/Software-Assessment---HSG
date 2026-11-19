import { weekdayDate } from '../../assistant/dates';
import type { AssistantIntent, AssistantRequest, PartOfDay } from '../../assistant/types';
import { formatDate } from '../../format';
import { addDays } from '../../scheduling';
import type { Customer, Employee, ServiceItem } from '../../types';
import { matchName } from '../names';

/**
 * What a reader should understand from each sentence of the voice check, so a reading by the AI
 * model can be scored the same way for everybody.
 *
 * A day in a sentence depends on the day it is spoken: "tomorrow", "on Thursday". Each expected
 * day is therefore worked out from the day of the round. Only what the sentence really says is
 * expected: where a sentence leaves open what is to be done with the appointment, that is not scored.
 */
export interface Expected {
  intent?: AssistantIntent;
  /** The days that count as right, worked out from the day the sentence was spoken. */
  days?: (today: string) => string[];
  time?: string;
  partOfDay?: PartOfDay;
  /** A service of the salon, by its name. */
  service?: string;
  /** A member of the team, by first name. */
  staff?: string;
  /** A customer, by full name. The name counts when the heard spelling finds this customer. */
  customer?: string;
  /** Small talk: the right reading is that there is nothing to note. */
  nothing?: true;
}

const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;
const TUESDAY = 2;

const coming = (weekday: number) => (today: string): string[] => [weekdayDate(weekday, today, 'coming')];
/** "Next Tuesday" is said for the Tuesday that comes next and for the one in the week after. Both count. */
const next = (weekday: number) => (today: string): string[] =>
  [...new Set([weekdayDate(weekday, today, 'coming'), weekdayDate(weekday, today, 'nextWeek')])];
const two = (value: number): string => String(value).padStart(2, '0');
/** The next time this day of this month comes round, today included. */
const dayOf = (day: number, month: number) => (today: string): string[] => {
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${two(month)}-${two(day)}`;
  return [thisYear >= today ? thisYear : `${year + 1}-${two(month)}-${two(day)}`];
};
/** The next day with this number in any month, today included. */
const nextDayNumbered = (day: number) => (today: string): string[] => {
  for (let ahead = 0; ahead < 62; ahead++) {
    const date = addDays(today, ahead);
    if (Number(date.slice(8)) === day) return [date];
  }
  return [];
};

/** By the number of the sentence: "en-04" and "de-04" say the same thing. */
const SENTENCES: Record<number, Expected> = {
  1: { intent: 'availability', days: coming(THURSDAY), time: '15:00' },
  2: { service: 'Haircut', days: dayOf(27, 11), time: '10:30' },
  3: { days: today => [addDays(today, 1)], time: '09:15', service: 'Colouring' },
  4: { days: next(TUESDAY), time: '15:45', staff: 'Selina' },
  5: { intent: 'availability', staff: 'Luca', days: coming(SATURDAY), partOfDay: 'afternoon' },
  6: { customer: 'Lea Brunner' },
  // 7 is a phone number: a request has no place for one, so there is nothing to score.
  8: { customer: 'Lea Brunner', days: coming(FRIDAY), time: '11:00' },
  9: { intent: 'cancel', days: dayOf(2, 12) },
  // 10 is the phrase that confirms a booking. The page itself listens for it; no reader is asked.
  11: { days: coming(FRIDAY), time: '14:30' },
  12: { nothing: true },
};

/** What a sentence of the check should be read as, or null when it is not scored. */
export const expectedFor = (sentenceId: string): Expected | null => SENTENCES[Number(sentenceId.slice(-2))] ?? null;

/**
 * The short call, read as a whole: a haircut for Lea Brunner on Thursday the 26th at half past
 * three, the time that was agreed after three o'clock turned out to be taken. "Thursday the
 * twenty-sixth" only names one day when the 26th is a Thursday, so either reading counts.
 */
export const EXPECTED_CALL: Expected = {
  service: 'Haircut',
  days: today => [...new Set([...coming(THURSDAY)(today), ...nextDayNumbered(26)(today)])],
  time: '15:30',
  customer: 'Lea Brunner',
};

export interface FieldCheck {
  label: string;
  expected: string;
  got: string;
  right: boolean;
}

export interface ReadingScore {
  fields: FieldCheck[];
  right: number;
  total: number;
}

/** The salon a reading is checked against: its services, its team and its customers. */
export interface ReadingSalon {
  today: string;
  services: Pick<ServiceItem, 'id' | 'name'>[];
  employees: Pick<Employee, 'id' | 'name'>[];
  customers: Pick<Customer, 'name'>[];
}

const day = (date: string | undefined): string => (date ? formatDate(date, { weekday: 'short' }) : 'none');

/** Compares a reading with what the sentence says, detail by detail. `request` is null when the reader noted nothing. */
export function scoreReading(expected: Expected, request: AssistantRequest | null, salon: ReadingSalon): ReadingScore {
  const fields: FieldCheck[] = [];
  const add = (label: string, wanted: string, got: string | undefined, right: boolean) =>
    fields.push({ label, expected: wanted, got: got || 'none', right });

  if (expected.nothing) {
    const details = request ? [request.intent, request.date, request.time, request.serviceId, request.employeeId, request.customerName, request.partOfDay].filter(Boolean) : [];
    add('Nothing to note', 'nothing', details.length === 0 ? 'nothing' : details.join(', '), details.length === 0);
  }
  if (expected.intent) add('What', expected.intent, request?.intent, request?.intent === expected.intent);
  if (expected.days) {
    const wanted = expected.days(salon.today);
    add('Day', wanted.map(day).join(' or '), day(request?.date), request?.date !== undefined && wanted.includes(request.date));
  }
  if (expected.time) add('Time', expected.time, request?.time, request?.time === expected.time);
  if (expected.partOfDay) add('Part of day', expected.partOfDay, request?.partOfDay, request?.partOfDay === expected.partOfDay);
  if (expected.service) {
    const name = salon.services.find(service => service.id === request?.serviceId)?.name;
    add('Service', expected.service, name, name === expected.service);
  }
  if (expected.staff) {
    const name = salon.employees.find(employee => employee.id === request?.employeeId)?.name;
    add('With', expected.staff, name, name?.split(' ')[0] === expected.staff);
  }
  if (expected.customer) {
    const heard = request?.customerName;
    const found = heard ? matchName(heard, salon.customers)?.name : undefined;
    // The name as it was heard, and the customer it finds in the salon's own list.
    add('Customer', expected.customer, heard ? `${heard} (${found ? `found: ${found}` : 'not found'})` : undefined, found === expected.customer);
  }
  return { fields, right: fields.filter(field => field.right).length, total: fields.length };
}
