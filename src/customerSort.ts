import type { CalendarEvent, Customer } from './types';
import type { CustomerStats } from './customerStats';

/**
 * The order of the customer list. On wide screens the column headers set it, on phones one
 * "Sort by" list; both read and write the same value, so the list and the export agree.
 */

/** The columns the list can be sorted by. */
export type CustomerSortKey = 'name' | 'lastVisit' | 'nextAppointment' | 'visits';
export type SortDirection = 'ascending' | 'descending';
/** Null is the list as it is kept: the most recent contact first, a new customer on top. */
export type CustomerSort = { key: CustomerSortKey; direction: SortDirection } | null;

/**
 * The direction a column takes when it is chosen, the one an owner looks for first: names from
 * A, the latest visit, the next appointment, the most visits.
 */
export const FIRST_DIRECTION: Record<CustomerSortKey, SortDirection> = {
  name: 'ascending',
  lastVisit: 'descending',
  nextAppointment: 'ascending',
  visits: 'descending',
};

const opposite = (direction: SortDirection): SortDirection => direction === 'ascending' ? 'descending' : 'ascending';

/** A press on a column header: its first direction, then the other one, then the list as it is kept again. */
export function nextCustomerSort(current: CustomerSort, key: CustomerSortKey): CustomerSort {
  if (current?.key !== key) return { key, direction: FIRST_DIRECTION[key] };
  return current.direction === FIRST_DIRECTION[key] ? { key, direction: opposite(current.direction) } : null;
}

/** The choices of the "Sort by" list on phones: every column in both directions, in words. */
export const CUSTOMER_SORT_OPTIONS: { value: string; label: string; sort: CustomerSort }[] = [
  { value: '', label: 'Default order', sort: null },
  { value: 'name:ascending', label: 'Name A–Z', sort: { key: 'name', direction: 'ascending' } },
  { value: 'name:descending', label: 'Name Z–A', sort: { key: 'name', direction: 'descending' } },
  { value: 'lastVisit:descending', label: 'Last visit, newest first', sort: { key: 'lastVisit', direction: 'descending' } },
  { value: 'lastVisit:ascending', label: 'Last visit, oldest first', sort: { key: 'lastVisit', direction: 'ascending' } },
  { value: 'nextAppointment:ascending', label: 'Next appointment, soonest first', sort: { key: 'nextAppointment', direction: 'ascending' } },
  { value: 'nextAppointment:descending', label: 'Next appointment, latest first', sort: { key: 'nextAppointment', direction: 'descending' } },
  { value: 'visits:descending', label: 'Most visits', sort: { key: 'visits', direction: 'descending' } },
  { value: 'visits:ascending', label: 'Fewest visits', sort: { key: 'visits', direction: 'ascending' } },
];

export const customerSortValue = (sort: CustomerSort): string => sort ? `${sort.key}:${sort.direction}` : '';

const moment = (event: CalendarEvent | null): string | null => event ? `${event.date} ${event.startTime}` : null;

/**
 * The customers in the chosen order; the given list is not changed. Names are compared the
 * German way ("Ä" beside "A", not after "Z") and without regard to capitals, on every device
 * alike. A customer without a last visit or a next appointment comes after everybody who has
 * one, in both directions. Equal visits or dates are settled by name, and namesakes keep the
 * order they were given in.
 */
export function sortCustomers<T extends Pick<Customer, 'name'>>(
  customers: readonly T[], statsOf: (customer: T) => CustomerStats, sort: CustomerSort,
): T[] {
  if (!sort) return [...customers];
  const sign = sort.direction === 'ascending' ? 1 : -1;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'de-CH', { sensitivity: 'base' });
  return [...customers].sort((a, b) => {
    if (sort.key === 'name') return sign * byName(a, b);
    if (sort.key === 'visits') return sign * (statsOf(a).visits - statsOf(b).visits) || byName(a, b);
    const first = moment(statsOf(a)[sort.key]);
    const second = moment(statsOf(b)[sort.key]);
    if (first === null || second === null) return first === second ? byName(a, b) : first === null ? 1 : -1;
    return sign * first.localeCompare(second) || byName(a, b);
  });
}
