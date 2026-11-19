import type { CalendarEvent, Conversation } from './types';
import { LANGUAGE_NAMES } from './conversationData';
import { fileSlug } from './csv';
import { formatDate, formatDateRange, formatMonth } from './format';
import { addDays, startOfWeek } from './scheduling';

/**
 * The figures on Home and in Analytics, and the report that both export.
 *
 * Every number is counted here, from the appointments in the calendar and from the chats, so
 * the two screens and the exported file cannot disagree. Nothing in this file reads the clock:
 * callers pass the salon's date and time.
 */

/** A span of salon days, both ends included (YYYY-MM-DD). */
export interface Period { from: string; to: string }

/** The salon's date and clock time, as getSalonNow gives them. */
export interface SalonClock { date: string; time: string }

export function analyticsRangeError(from: string, to: string): string | null {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) return 'Choose valid dates, with the end on or after the start.';
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365) return 'Choose a date range of up to one year.';
  return null;
}

const isWholeMonth = ({ from, to }: Period): boolean =>
  from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01') && addDays(to, 1).endsWith('-01');

/**
 * The periods Home and Analytics offer for a salon date: that day, its week (Monday to Sunday)
 * and its calendar month. Each includes the days still to come, so a booking made a minute ago
 * for next week counts at once.
 */
export function analyticsPeriods(today: string): { today: Period; week: Period; month: Period } {
  const [year, month] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekStart = startOfWeek(today);
  return {
    today: { from: today, to: today },
    week: { from: weekStart, to: addDays(weekStart, 6) },
    month: { from: `${today.slice(0, 8)}01`, to: `${today.slice(0, 8)}${String(lastDay).padStart(2, '0')}` },
  };
}

/** A period in words: "Thu, 19.11.2026", "November 2026" for a whole month, otherwise both ends ("16.–22.11.2026"). */
export function periodLabel(period: Period): string {
  const { from, to } = period;
  if (from === to) return formatDate(from);
  return isWholeMonth(period) ? formatMonth(from) : formatDateRange(from, to);
}

/**
 * The appointments of a period, by the date they take place on.
 * With the salon's clock it also tells how many of them are still to come.
 */
export function appointmentAnalytics(events: CalendarEvent[], from: string, to: string, clock?: SalonClock) {
  const error = analyticsRangeError(from, to);
  const selected = error ? [] : events.filter(event => event.date >= from && event.date <= to);
  const normalizeName = (name: string) => name.trim().toLowerCase();
  const idsByName = new Map<string, Set<string>>();
  for (const event of events) if (event.customerId) {
    const name = normalizeName(event.customerName);
    const ids = idsByName.get(name) ?? new Set<string>();
    ids.add(event.customerId);
    idsByName.set(name, ids);
  }
  const customerKey = (event: CalendarEvent) => {
    if (event.customerId) return `id:${event.customerId}`;
    const name = normalizeName(event.customerName);
    const ids = idsByName.get(name);
    return ids?.size === 1 ? `id:${[...ids][0]}` : `name:${name}`;
  };
  const perDay = new Map<string, { count: number; aiBookings: number }>();
  for (const event of selected) {
    const day = perDay.get(event.date) ?? { count: 0, aiBookings: 0 };
    day.count += 1;
    if (event.isAiBooked) day.aiBookings += 1;
    perDay.set(event.date, day);
  }
  const series: { date: string; count: number; aiBookings: number }[] = [];
  if (!error) for (let day = from; day <= to; day = addDays(day, 1)) series.push({ date: day, ...(perDay.get(day) ?? { count: 0, aiBookings: 0 }) });
  const aiBookings = selected.filter(event => event.isAiBooked).length;
  const current = clock ? `${clock.date} ${clock.time}` : null;
  return {
    error, total: selected.length,
    customers: new Set(selected.map(customerKey)).size,
    aiBookings,
    otherBookings: selected.length - aiBookings,
    /** The share the AI booked, in whole per cent. Null while there is no appointment to take a share of. */
    aiShare: selected.length > 0 ? Math.round(aiBookings / selected.length * 100) : null,
    /** Appointments that start now or later, the rule "Next appointment" uses. Null when no clock was given. */
    stillToCome: current === null ? null : selected.filter(event => `${event.date} ${event.startTime}` >= current).length,
    series,
  };
}

export type AppointmentFigures = ReturnType<typeof appointmentAnalytics>;

/** One bar of the appointment chart: a day, or the days of a week or a month that lie in the period. */
export interface AppointmentBucket extends Period { count: number; aiBookings: number }

/**
 * The bars of the chart: one per day up to a month, one per week up to half a year, one per
 * month beyond that. A year of single days would be 365 hairlines on a phone.
 */
export function appointmentBuckets(series: AppointmentFigures['series']): { unit: 'day' | 'week' | 'month'; buckets: AppointmentBucket[] } {
  const unit = series.length <= 31 ? 'day' : series.length <= 183 ? 'week' : 'month';
  const keyOf = (date: string) => unit === 'day' ? date : unit === 'week' ? startOfWeek(date) : date.slice(0, 7);
  const buckets: AppointmentBucket[] = [];
  let currentKey = '';
  for (const point of series) {
    const key = keyOf(point.date);
    if (key !== currentKey) {
      buckets.push({ from: point.date, to: point.date, count: 0, aiBookings: 0 });
      currentKey = key;
    }
    const bucket = buckets[buckets.length - 1];
    bucket.to = point.date;
    bucket.count += point.count;
    bucket.aiBookings += point.aiBookings;
  }
  return { unit, buckets };
}

/** Round steps for the chart's scale, from 0 to the first step at or above the highest bar: 11 gives 0, 5, 10, 15. */
export function axisTicks(highest: number): number[] {
  for (let magnitude = 1; ; magnitude *= 10) {
    for (const factor of [1, 2, 5]) {
      const step = factor * magnitude;
      if (highest <= step * 5) {
        const ticks = [0];
        while (ticks[ticks.length - 1] < Math.max(highest, 1)) ticks.push(ticks[ticks.length - 1] + step);
        return ticks;
      }
    }
  }
}

/** Chats in which a customer is waiting for the owner: the rule behind every "needs you" count. */
export const conversationsWaiting = (conversations: Conversation[]): Conversation[] =>
  conversations.filter(conversation => conversation.status === 'needs-attention');

/**
 * The language a chat is in, by name. A live chat can be in any language: it carries the name
 * the AI detected, while its language code falls back to English for everything unknown.
 */
const languageName = (conversation: Conversation): string => {
  const detected = conversation.live ? conversation.languageLabel?.trim() : undefined;
  return detected ? detected[0].toUpperCase() + detected.slice(1) : LANGUAGE_NAMES[conversation.language];
};

/**
 * Messages and languages of the given chats. Pass every chat the owner sees, live ones
 * included. Messages are counted without a period: not every message carries a date yet.
 */
export function conversationAnalytics(conversations: Conversation[]) {
  const messages = conversations.flatMap(conversation => conversation.messages);
  // The four languages the salon answers in are always listed; any other appears once a chat is in it.
  const languages = new Map<string, { name: string; count: number }>(
    Object.values(LANGUAGE_NAMES).map(name => [name.toLowerCase(), { name, count: 0 }]),
  );
  for (const conversation of conversations) {
    const name = languageName(conversation);
    const entry = languages.get(name.toLowerCase()) ?? { name, count: 0 };
    entry.count += 1;
    languages.set(name.toLowerCase(), entry);
  }
  return {
    conversations: conversations.length,
    waiting: conversationsWaiting(conversations).length,
    total: messages.length,
    customer: messages.filter(message => message.sender === 'customer').length,
    ai: messages.filter(message => message.sender === 'ai').length,
    owner: messages.filter(message => message.sender === 'owner').length,
    languages: [...languages.values()],
  };
}

export interface AnalyticsReport { fileName: string; rows: (string | number)[][] }

/**
 * The report behind "Export CSV" on Home and in Analytics: the period's figures as the screen
 * shows them, then every appointment they are counted from. Null for a period that is not valid.
 *
 * Dates stay in the form YYYY-MM-DD, which spreadsheets read as dates in every language.
 * `fallbackName` names the file when the salon's name has no letter a file name can carry.
 */
export function analyticsReport(
  { companyName, events, period, clock, fallbackName = 'salon' }:
  { companyName: string; events: CalendarEvent[]; period: Period; clock: SalonClock; fallbackName?: string },
): AnalyticsReport | null {
  const figures = appointmentAnalytics(events, period.from, period.to, clock);
  if (figures.error) return null;
  const appointments = events
    .filter(event => event.date >= period.from && event.date <= period.to)
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`) || a.staffName.localeCompare(b.staffName) || a.id.localeCompare(b.id));
  const span = period.from === period.to ? period.from : isWholeMonth(period) ? period.from.slice(0, 7) : `${period.from}-to-${period.to}`;
  return {
    fileName: `${fileSlug(companyName, fallbackName)}-appointments-${span}.csv`,
    rows: [
      ['Salon', companyName],
      ['Period', period.from, period.to],
      ['Exported', `${clock.date} ${clock.time}`],
      [],
      ['Appointments', figures.total],
      ['Booked by AI', figures.aiBookings],
      ...(figures.aiShare === null ? [] : [['Booked by AI (%)', figures.aiShare]]),
      ['Other bookings', figures.otherBookings],
      ['Customers with appointments', figures.customers],
      ['Still to come', figures.stillToCome ?? 0],
      [],
      ['Date', 'Start', 'End', 'Customer', 'Service', 'Staff', 'Booked by AI'],
      ...appointments.map(event => [event.date, event.startTime, event.endTime, event.customerName, event.serviceName, event.staffName, event.isAiBooked ? 'Yes' : 'No']),
    ],
  };
}
