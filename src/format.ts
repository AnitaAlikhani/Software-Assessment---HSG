/**
 * One way to write dates, times, money and phone numbers: on every screen, in the owner
 * assistant's answers and in the messages the server sends. The forms are the Swiss ones:
 *
 *   Thu, 19.11.2026        a date (formatDate)
 *   Thursday, 19.11.2026   the same inside a sentence (weekday: 'long')
 *   Thu 19.11.             short, where room is tight and the year is clear (formatDateShort)
 *   16.–22.11.2026         a span of days (formatDateRange)
 *   10:00–10:30            24-hour times, and one sign for every range (formatTimeRange)
 *   CHF 55.00              money (formatMoney)
 *   +41 79 123 45 67       a phone number (formatPhone); stored as +41791234567 (normalizePhone)
 *
 * Dates and times stay data (YYYY-MM-DD, HH:MM, a moment with a time zone) and become text only
 * here, when they are shown. The interface is English for now. Every function that writes a word
 * takes the locale, so a German interface passes 'de-CH' and gets "Do., 19.11.2026".
 *
 * Weekday and month names are written out below instead of asked from the browser: the text is
 * then the same on every device, in every Node version and in the tests. The browser's own data
 * is asked for one thing only, what the clock shows in a time zone, and that answer is numbers.
 * This is the only file that uses Intl.
 *
 * The server loads this file too (server/bookingRules.ts and others), so it imports nothing.
 */

export type FormatLocale = 'en-CH' | 'de-CH';
export const DEFAULT_LOCALE: FormatLocale = 'en-CH';

/** The sign between the two ends of every range, without spaces: 10:00–10:30, 16.–22.11.2026, Tuesday–Friday. */
export const RANGE_SEPARATOR = '–';

interface Names {
  /** Sunday first, as Date counts weekdays. */
  weekdays: readonly string[];
  /** Before a full date: "Thu, 19.11.2026", "Do., 19.11.2026". */
  weekdaysShort: readonly string[];
  /** Before a short date: "Thu 19.11.", "Do 19.11.". */
  weekdaysCompact: readonly string[];
  months: readonly string[];
  monthsShort: readonly string[];
  /** The word before a week number. */
  week: string;
}

const NAMES: Record<FormatLocale, Names> = {
  'en-CH': {
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    weekdaysCompact: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    week: 'Week',
  },
  'de-CH': {
    weekdays: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
    weekdaysShort: ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'],
    weekdaysCompact: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
    months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    monthsShort: ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'],
    week: 'KW',
  },
};

/**
 * The names of a locale. A locale the table does not have yet (a later step may pass "fr-CH"
 * before its names are written out) reads in the default language instead of breaking a screen.
 */
const namesFor = (locale: FormatLocale): Names => NAMES[locale] ?? NAMES[DEFAULT_LOCALE];

const two = (value: number): string => String(value).padStart(2, '0');

// ---------- dates ----------

interface DateParts { year: number; month: number; day: number; weekday: number }

/**
 * The parts of a date written as YYYY-MM-DD, or null for anything else. Read in UTC, so the
 * browser's time zone can never move a date onto the day before or after.
 */
const dateParts = (date: string): DateParts | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date) return null;
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate(), weekday: value.getUTCDay() };
};

const numericDate = (parts: DateParts): string => `${two(parts.day)}.${two(parts.month)}.${parts.year}`;

export interface DateFormat {
  /** 'short' (the default) "Thu, 19.11.2026"; 'long' "Thursday, 19.11.2026", for sentences; 'none' "19.11.2026". */
  weekday?: 'short' | 'long' | 'none';
  locale?: FormatLocale;
}

/** "Thu, 19.11.2026". Anything that is not a date is handed back as it came, so a screen never breaks on old data. */
export function formatDate(date: string, { weekday = 'short', locale = DEFAULT_LOCALE }: DateFormat = {}): string {
  const parts = dateParts(date);
  if (!parts) return date;
  if (weekday === 'none') return numericDate(parts);
  const name = weekday === 'long' ? namesFor(locale).weekdays[parts.weekday] : namesFor(locale).weekdaysShort[parts.weekday];
  return `${name}, ${numericDate(parts)}`;
}

/** "Thu 19.11.": for column headers, lists and buttons, where the year is clear from the page. */
export function formatDateShort(date: string, locale: FormatLocale = DEFAULT_LOCALE): string {
  const parts = dateParts(date);
  return parts ? `${namesFor(locale).weekdaysCompact[parts.weekday]} ${two(parts.day)}.${two(parts.month)}.` : date;
}

/** "19.11.", the day of a short date without its weekday, for a tile that shows the weekday above it. */
export function formatDayMonth(date: string): string {
  const parts = dateParts(date);
  return parts ? `${two(parts.day)}.${two(parts.month)}.` : date;
}

/** "Thursday" or "Thu". Empty for anything that is not a date. */
export function weekdayName(date: string, style: 'long' | 'short' = 'long', locale: FormatLocale = DEFAULT_LOCALE): string {
  const parts = dateParts(date);
  if (!parts) return '';
  return style === 'long' ? namesFor(locale).weekdays[parts.weekday] : namesFor(locale).weekdaysCompact[parts.weekday];
}

/**
 * The name the opening hours are stored under for this date's weekday: always the English one
 * ("Monday"), whatever language the interface speaks. This is a key into the data, not wording.
 */
export function openingHoursDay(date: string): string {
  const parts = dateParts(date);
  return parts ? NAMES['en-CH'].weekdays[parts.weekday] : '';
}

/** "November 2026" */
export function formatMonth(date: string, locale: FormatLocale = DEFAULT_LOCALE): string {
  const parts = dateParts(date);
  return parts ? `${namesFor(locale).months[parts.month - 1]} ${parts.year}` : date;
}

/** "Nov 2026", under a bar of a chart. */
export function formatMonthShort(date: string, locale: FormatLocale = DEFAULT_LOCALE): string {
  const parts = dateParts(date);
  return parts ? `${namesFor(locale).monthsShort[parts.month - 1]} ${parts.year}` : date;
}

/**
 * The month or months a span of days lies in, as a title: "November 2026", for a week across
 * two months "November–December 2026", across two years "December 2026–January 2027".
 */
export function formatMonthSpan(from: string, to: string, locale: FormatLocale = DEFAULT_LOCALE): string {
  const first = dateParts(from);
  const last = dateParts(to);
  if (!first || !last) return formatMonth(from, locale);
  if (first.year !== last.year) return `${formatMonth(from, locale)}${RANGE_SEPARATOR}${formatMonth(to, locale)}`;
  if (first.month !== last.month) return `${namesFor(locale).months[first.month - 1]}${RANGE_SEPARATOR}${formatMonth(to, locale)}`;
  return formatMonth(from, locale);
}

/**
 * A span of days, both ends included. What the two ends share is written once:
 * "16.–22.11.2026", "30.11.–06.12.2026", "28.12.2026–03.01.2027". One day alone is a date.
 */
export function formatDateRange(from: string, to: string, locale: FormatLocale = DEFAULT_LOCALE): string {
  const first = dateParts(from);
  const last = dateParts(to);
  if (!first || !last) return `${from}${RANGE_SEPARATOR}${to}`;
  if (from === to) return formatDate(from, { locale });
  const start = first.year !== last.year ? numericDate(first)
    : first.month !== last.month ? `${two(first.day)}.${two(first.month)}.`
      : `${two(first.day)}.`;
  return `${start}${RANGE_SEPARATOR}${numericDate(last)}`;
}

/**
 * The calendar week a date lies in, as Switzerland counts it (ISO 8601): weeks start on Monday
 * and week 1 is the week with the year's first Thursday. `year` is the year the week belongs
 * to, which at the turn of the year is not always the date's own: 01.01.2027 is in week 53 of 2026.
 */
export function isoWeek(date: string): { year: number; week: number } | null {
  const parts = dateParts(date);
  if (!parts) return null;
  const DAY = 86_400_000;
  const mondayFirst = (weekday: number) => (weekday + 6) % 7;
  // The Thursday of the date's week decides which year the week belongs to.
  const thursday = Date.UTC(parts.year, parts.month - 1, parts.day - mondayFirst(parts.weekday) + 3);
  const year = new Date(thursday).getUTCFullYear();
  // 4 January always lies in week 1.
  const fourth = new Date(Date.UTC(year, 0, 4));
  const firstThursday = Date.UTC(year, 0, 4 - mondayFirst(fourth.getUTCDay()) + 3);
  return { year, week: 1 + Math.round((thursday - firstThursday) / (7 * DAY)) };
}

/** "Week 47" (German: "KW 47") */
export function formatWeek(date: string, locale: FormatLocale = DEFAULT_LOCALE): string {
  const week = isoWeek(date);
  return week ? `${namesFor(locale).week} ${week.week}` : '';
}

// ---------- times ----------

/** Minutes since midnight as a 24-hour time: 615 gives "10:15". */
export function formatTime(minutes: number): string {
  const inDay = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${two(Math.floor(inDay / 60))}:${two(inDay % 60)}`;
}

/** "10:00–10:30" */
export const formatTimeRange = (start: string, end: string): string => `${start}${RANGE_SEPARATOR}${end}`;

/**
 * A request keeps its time as one text, "10:00 - 10:30", because the slot rules read it that
 * way. On screen it is written like every other range. Any other text is handed back unchanged.
 */
export function formatStoredTimeRange(value: string): string {
  const match = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.exec(value.trim());
  return match ? formatTimeRange(match[1], match[2]) : value;
}

// ---------- time zones ----------

export const DEFAULT_TIME_ZONE = 'Europe/Zurich';

// Asking the time zone database is slow, and the same few zones are asked thousands of times
// while the calendar is built. One clock per zone is kept; null marks a name that is no zone.
const clocks = new Map<string, Intl.DateTimeFormat | null>();
const clockFor = (timeZone: string): Intl.DateTimeFormat | null => {
  let clock = clocks.get(timeZone);
  if (clock === undefined) {
    try {
      // The locale only decides the order of the parts, which are picked by name below.
      clock = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      });
    } catch {
      clock = null;
    }
    clocks.set(timeZone, clock);
  }
  return clock;
};

/**
 * The time zone a setting names, as the id the time zone database knows ("Europe/Zurich").
 * Settings saved earlier carry a display suffix ("Europe/Zurich (GMT+01:00)"): it is dropped.
 * A name that is no zone gives the salon's default.
 */
export function timeZoneId(value: string | null | undefined): string {
  const zone = (value ?? '').trim().split(/\s+/)[0];
  return zone && clockFor(zone) ? zone : DEFAULT_TIME_ZONE;
}

/** The calendar date and clock time a moment has in a time zone, as data: { date: '2026-11-19', time: '14:05' }. */
export function zonedDateTime(moment: Date, timeZone?: string | null): { date: string; time: string } {
  const parts = Object.fromEntries(clockFor(timeZoneId(timeZone))!.formatToParts(moment).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** What the clock shows in a time zone at a moment: "14:05". */
export const formatClock = (moment: Date | number, timeZone?: string | null): string =>
  zonedDateTime(typeof moment === 'number' ? new Date(moment) : moment, timeZone).time;

/** How many minutes a zone's clock is ahead of UTC at a moment. */
const minutesAheadOfUtc = (timeZone: string, moment: Date): number => {
  const shown = zonedDateTime(moment, timeZone);
  return Math.round((Date.parse(`${shown.date}T${shown.time}:00Z`) - moment.getTime()) / 60_000);
};

/**
 * True when two zones show the same time now and through the coming year, summer and winter:
 * Zurich and Berlin do, Zurich and London never, Zurich and Lagos only in winter (so: false).
 */
export function sameClock(zoneA: string, zoneB: string, now: Date): boolean {
  const a = timeZoneId(zoneA);
  const b = timeZoneId(zoneB);
  if (a === b) return true;
  // Four moments a quarter of a year apart always include both halves of the year.
  return [0, 91, 182, 273].every((days) => {
    const moment = new Date(now.getTime() + days * 86_400_000);
    return minutesAheadOfUtc(a, moment) === minutesAheadOfUtc(b, moment);
  });
}

const CITY_NAMES: Record<FormatLocale, Record<string, string>> = {
  'en-CH': {},
  'de-CH': { 'Europe/Zurich': 'Zürich' },
};

/** The town a time zone is named after, in words: "Zurich" (German: "Zürich"), "New York". */
export function timeZoneCity(timeZone: string | null | undefined, locale: FormatLocale = DEFAULT_LOCALE): string {
  const zone = timeZoneId(timeZone);
  return CITY_NAMES[locale]?.[zone] ?? zone.slice(zone.lastIndexOf('/') + 1).replace(/_/g, ' ');
}

/**
 * A time zone as a person calls it, without an offset that is only right for half of the year:
 * "Central European Time (Zurich)". A zone on another clock is called by its town alone.
 */
export function timeZoneLabel(timeZone: string | null | undefined, locale: FormatLocale = DEFAULT_LOCALE): string {
  const city = timeZoneCity(timeZone, locale);
  // Which zones share Zurich's clock does not depend on the day asked, so any fixed day will do.
  if (!sameClock(timeZoneId(timeZone), DEFAULT_TIME_ZONE, new Date(Date.UTC(2026, 0, 15)))) return city;
  return locale === 'de-CH' ? `Mitteleuropäische Zeit (${city})` : `Central European Time (${city})`;
}

/**
 * The one note about time zones: whose clock the times on a page follow. It is only needed when
 * that is in doubt, so it is null while the viewer's device shows the same time as the salon,
 * and null where the viewer's zone is not known.
 */
export function salonTimeNote(
  salonTimeZone: string | null | undefined, viewerTimeZone: string | null | undefined, now: Date, locale: FormatLocale = DEFAULT_LOCALE,
): string | null {
  if (!viewerTimeZone || !clockFor(viewerTimeZone)) return null;
  if (sameClock(timeZoneId(salonTimeZone), viewerTimeZone, now)) return null;
  const city = timeZoneCity(salonTimeZone, locale);
  return locale === 'de-CH' ? `Salonzeit (${city})` : `Salon time (${city})`;
}

/** The time zone this device is set to, or null where there is no browser (the server, a test). */
export function browserTimeZone(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// ---------- money ----------

/** The launch market pays in Swiss francs. Prices are stored as plain numbers of francs. */
export const CURRENCY = 'CHF';

/**
 * "CHF 55.00", thousands set off the Swiss way: "CHF 1'234.50". Swiss English and Swiss German
 * write it alike. Something that is no amount gives no text, rather than a made-up price.
 */
export function formatMoney(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  const [whole, cents] = Math.abs(amount).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, "'");
  return `${CURRENCY} ${amount < 0 ? '-' : ''}${grouped}.${cents}`;
}

// ---------- phone numbers ----------

/** A number written without a country code is taken as a Swiss one. */
const SWISS = '41';

const isDigits = (value: string): boolean => /^\+?\d+$/.test(value);

/**
 * A phone number in the one form it is stored in: international, digits only, "+41791234567".
 * It accepts the ways people write numbers here:
 *   079 123 45 67, 079/123 45 67, 079-123-45-67    a leading 0 becomes +41
 *   0041 79 123 45 67                              00 becomes +
 *   +41 (0)79 123 45 67, +41 079 123 45 67         the 0 after a country code is dropped
 * Text that is no number comes back without its spaces, for the caller to refuse (phoneProblem).
 */
export function normalizePhone(phone: string): string {
  let text = phone.trim();
  // "+41 (0)79 ...": the 0 in brackets is only dialled inside the country.
  if (/^(\+|00)/.test(text)) text = text.replace(/\(\s*0\s*\)/, '');
  const compact = text.replace(/[\s()./\-–]/g, '');
  if (!isDigits(compact)) return compact;
  const international = compact.startsWith('+') ? compact
    : compact.startsWith('00') ? `+${compact.slice(2)}`
      : compact.startsWith('0') ? `+${SWISS}${compact.slice(1)}`
        // Neither a leading 0 nor a country code: nothing says which country this number is in.
        : compact;
  // "+41 079 ...": a Swiss number never starts with 0 after the country code.
  return international.replace(/^\+410(?=\d{9}$)/, `+${SWISS}`);
}

/**
 * The digits of a number in international order ("41791234567"): what every spelling of one
 * number shares. Numbers are compared, de-duplicated and searched on these. Empty for text that
 * is no number.
 */
export function phoneDigits(phone: string | null | undefined): string {
  const normal = normalizePhone(phone ?? '');
  return isDigits(normal) ? normal.replace('+', '') : '';
}

/** True when two spellings are the same number. Two missing numbers are not "the same". */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const digits = phoneDigits(a);
  return digits !== '' && digits === phoneDigits(b);
}

/** True for a phone number, false for anything else a chat may show in its place (a masked number, a label). */
export const isPhoneNumber = (value: string | null | undefined): boolean =>
  /^\+?\d{7,15}$/.test(normalizePhone(value ?? ''));

/**
 * Why a number cannot be stored, or null when it can:
 *   'characters'  it holds something that is neither a digit nor a usual separator
 *   'prefix'      it starts with neither 0 nor a country code
 *   'swiss'       a Swiss number that does not have 9 digits after +41 (or after the leading 0)
 *   'length'      another country's number with fewer than 7 or more than 15 digits
 */
export type PhoneProblem = 'characters' | 'prefix' | 'swiss' | 'length';

export function phoneProblem(phone: string): PhoneProblem | null {
  const normal = normalizePhone(phone);
  if (!isDigits(normal)) return 'characters';
  if (!normal.startsWith('+')) return 'prefix';
  const digits = normal.slice(1);
  if (digits.startsWith(SWISS)) return /^[1-9]\d{8}$/.test(digits.slice(SWISS.length)) ? null : 'swiss';
  return digits.length >= 7 && digits.length <= 15 ? null : 'length';
}

/**
 * Where the country code of an international number ends. Country codes have one, two or
 * three digits and no code starts another, so the first digits decide (ITU-T E.164).
 */
const countryCodeLength = (digits: string): number =>
  /^[17]/.test(digits) ? 1
    : /^(20|27|3[0-469]|4[013-9]|5[1-8]|6[0-6]|8[1246]|9[0-58])/.test(digits) ? 2
      : 3;

/** Digits in threes that end in pairs, the way Swiss numbers are grouped: 7 gives 3 2 2, 9 gives 3 3 3, 10 gives 3 3 2 2. */
const inGroups = (digits: string): string => {
  const groups: string[] = [];
  let rest = digits;
  while (rest.length > 4) { groups.push(rest.slice(0, 3)); rest = rest.slice(3); }
  if (rest.length === 4) groups.push(rest.slice(0, 2), rest.slice(2));
  else if (rest) groups.push(rest);
  return groups.join(' ');
};

/**
 * A phone number as it is shown everywhere: "+41 79 123 45 67". Whatever spelling is stored,
 * the same number reads the same. Numbers of other countries get their country code and plain
 * groups ("+49 151 234 567 89"). Text that is no number (a masked number, a label) is left alone.
 */
export function formatPhone(phone: string): string {
  const normal = normalizePhone(phone);
  if (!/^\+\d{4,}$/.test(normal)) return phone.trim();
  const digits = normal.slice(1);
  const code = digits.slice(0, countryCodeLength(digits));
  const national = digits.slice(code.length);
  if (code === SWISS && national.length === 9) {
    // Free and shared-cost numbers are read in threes: 0800 123 456.
    const pattern = /^(800|84\d|90\d)/.test(national) ? /^(\d{3})(\d{3})(\d{3})$/ : /^(\d{2})(\d{3})(\d{2})(\d{2})$/;
    return `+${code} ${pattern.exec(national)!.slice(1).join(' ')}`;
  }
  return `+${code} ${inGroups(national)}`;
}

/**
 * Whether a search text finds a phone number. Only digits count, so "079 123", "+41 79 123" and
 * "+4179123" all find +41 79 123 45 67. A search that starts like a number (0, 00 or +) is also
 * read from the start of the number, which is how "079" finds the Swiss numbers stored as +41 79.
 * A text with letters in it, a date (19.11.) or a time (10:00) is not a search for a number.
 */
export function phoneMatches(phone: string | null | undefined, query: string): boolean {
  const text = query.trim();
  const stored = phoneDigits(phone);
  if (!stored || !/\d/.test(text) || !/^[+(\d][\d\s()./\-–]*$/.test(text)) return false;
  if (/^\d{1,2}\.\d{1,2}\.?(\d{2}|\d{4})?$/.test(text)) return false;
  if (stored.includes(text.replace(/\D/g, ''))) return true;
  // "079", "(079) 123", "0041 79", "+41 (0)79": typed from the start of the number.
  const fromStart = normalizePhone(text);
  return /^\+\d+$/.test(fromStart) && stored.startsWith(fromStart.slice(1));
}
