import { formatDate, formatDateRange, formatDateShort, openingHoursDay, weekdayName as weekdayNameIn, type FormatLocale } from '../format';
import { addDays, startOfWeek } from '../scheduling';
import type { AssistantLanguage } from './types';

/**
 * Day names and day arithmetic for the assistant. How a date is written is decided in
 * src/format.ts, the same place the screens ask: the assistant only chooses the language.
 * What the owner may type ("6 October", "6.10.", "next Friday") is read in interpret.ts and
 * does not depend on this.
 */
const LOCALE: Record<AssistantLanguage, FormatLocale> = { en: 'en-CH', de: 'de-CH' };

/** 0 = Sunday ... 6 = Saturday */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00.000Z`).getUTCDay();

export const weekdayName = (date: string, language: AssistantLanguage): string => weekdayNameIn(date, 'long', LOCALE[language]);

/** The English weekday name the booking hours use ("Monday"). */
export const bookingHoursDay = (date: string): string => openingHoursDay(date);

/** "Tuesday, 06.10.2026" / "Dienstag, 06.10.2026": a date inside a sentence, always with its year. */
export function dayLabel(date: string, language: AssistantLanguage): string {
  return formatDate(date, { weekday: 'long', locale: LOCALE[language] });
}

/** Like dayLabel, but says "today" and "tomorrow" first, because that is how people check a date. */
export function dayPhrase(date: string, language: AssistantLanguage, today: string): string {
  const label = dayLabel(date, language);
  if (date === today) return language === 'de' ? `heute (${label})` : `today (${label})`;
  if (date === addDays(today, 1)) return language === 'de' ? `morgen (${label})` : `tomorrow (${label})`;
  return label;
}

/** "Tue 06.10." / "Di 06.10." for buttons and lists. */
export function shortDay(date: string, language: AssistantLanguage): string {
  return formatDateShort(date, LOCALE[language]);
}

/** A span of days as one text, "24.–31.12.2026"; a single day reads "Thu, 24.12.2026". */
export function dayRange(start: string, end: string, language: AssistantLanguage): string {
  return formatDateRange(start, end, LOCALE[language]);
}

export type WeekdayReading =
  /** "Friday": the next one, one to seven days ahead. */
  | 'coming'
  /** "this Friday": today if today is a Friday, otherwise the next one. */
  | 'this'
  /** "Friday this week": the Friday of the week that contains today, even if it has passed. */
  | 'thisWeek'
  /** "Friday next week": the Friday of the week after this one (weeks start on Monday). */
  | 'nextWeek'
  /** "übernächsten Freitag": the one after the next one. */
  | 'afterNext';

export function weekdayDate(weekday: number, today: string, reading: WeekdayReading): string {
  const ahead = (weekday - weekdayOf(today) + 7) % 7;
  if (reading === 'this') return addDays(today, ahead);
  if (reading === 'coming') return addDays(today, ahead === 0 ? 7 : ahead);
  if (reading === 'afterNext') return addDays(today, (ahead === 0 ? 7 : ahead) + 7);
  const mondayBased = (weekday + 6) % 7;
  return addDays(startOfWeek(today), mondayBased + (reading === 'nextWeek' ? 7 : 0));
}

/** Every day from start to end, both included. */
export function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end && days.length < 400; day = addDays(day, 1)) days.push(day);
  return days;
}
