import type { Customer, Employee, ServiceItem } from '../types';
import { addDays, startOfWeek } from '../scheduling';
import { weekdayDate, type WeekdayReading } from './dates';
import {
  isChange,
  isRealDate,
  type AssistantIntent,
  type AssistantLanguage,
  type AssistantRequest,
  type AssistantSlot,
  type PartOfDay,
} from './types';

/**
 * The built-in interpreter: turns one typed message into an AssistantRequest with plain code.
 * No model, no server, no clock: "today" is passed in. It knows the common English and German
 * ways to ask for a free time, a booking, a cancellation, a closed day and the agenda.
 *
 * It only reads what the owner wrote. It never looks at the calendar and never decides whether a
 * time is free: that is the job of src/assistant/execute.ts together with src/availability.ts.
 */
export interface InterpreterContext {
  /** The salon's "today" (YYYY-MM-DD). */
  today: string;
  services: Pick<ServiceItem, 'id' | 'name' | 'category'>[];
  employees: Pick<Employee, 'id' | 'name' | 'firstName' | 'lastName'>[];
  customers: Pick<Customer, 'name'>[];
  /** What the assistant asked for last, so a bare "10" or a bare name is read correctly. */
  expecting?: AssistantSlot;
  /** Language of the conversation so far, for messages without telling words ("10:30"). */
  language?: AssistantLanguage;
  /** A proposal or a question of the assistant is open, so a bare "cancel" answers it. */
  waiting?: boolean;
}

/** Lower case, no accents, plain apostrophes: "Léa’s" becomes "lea's", "Färben" becomes "farben". */
export const fold = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[’‘`´]/g, "'").toLowerCase();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- the message as words ----------

/** `after`: the punctuation written right behind the word ("Morning!" has "!"), empty when a space follows. */
interface Token { raw: string; norm: string; start: number; end: number; used: boolean; after: string }

/**
 * The message split into words. `text` is the folded message; `unread` is the same text with
 * everything that was already understood blanked out, so no word is read twice (the "24" of
 * "24 November" must not also become "at 24 o'clock").
 */
class Scan {
  readonly tokens: Token[] = [];
  readonly text: string;
  unread: string;

  constructor(message: string) {
    let text = '';
    for (const part of message.normalize('NFC').split(/\s+/)) {
      // A lone dash ("24 - 26 December") and a lone "@" ("@ 11") carry meaning; other punctuation goes.
      const sign = /^[-–—]+$/.test(part) ? '-' : part === '@' ? '@' : null;
      const raw = sign ?? part.replace(/^[^\p{L}\p{N}@]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
      if (!raw) continue;
      const norm = fold(raw);
      const start = text.length ? text.length + 1 : 0;
      text += (text.length ? ' ' : '') + norm;
      const after = sign ? '' : /[^\p{L}\p{N}]*$/u.exec(part)![0];
      this.tokens.push({ raw, norm, start, end: start + norm.length, used: false, after });
    }
    this.text = text;
    this.unread = text;
  }

  /** The first match in what is still unread that `accept` agrees with; marks it as read. */
  take(pattern: RegExp, accept?: (match: RegExpExecArray) => boolean): RegExpExecArray | null {
    const search = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (let match = search.exec(this.unread); match; match = search.exec(this.unread)) {
      if (match[0].length === 0) { search.lastIndex += 1; continue; }
      if (!accept || accept(match)) {
        this.blank(match.index, match.index + match[0].length);
        return match;
      }
    }
    return null;
  }

  private blank(start: number, end: number) {
    for (const token of this.tokens) if (token.start < end && token.end > start) token.used = true;
    this.unread = this.unread.slice(0, start) + this.unread.slice(start, end).replace(/\S/g, '\u0001') + this.unread.slice(end);
  }

  /** The unread words that directly follow position `index`. */
  after(index: number): string { return this.unread.slice(index); }
  before(index: number): string { return this.text.slice(0, index); }
}

// ---------- language ----------

const GERMAN_WORDS = new Set(('der das den dem ein eine einen einem einer und ist sind hat haben hast habt wir du ich ihr um im fur fuer mit bei von bis ' +
  'wer wann wie wo heute morgen ubermorgen uebermorgen uhr frei freie freien termin termine geschlossen zu offen offnen wieder nachste nachsten nachster ' +
  'naechste naechsten kommenden diesen diese woche montag dienstag mittwoch donnerstag freitag samstag sonntag januar februar marz mai juni juli oktober dezember ' +
  'bitte danke ja nein hallo trag trage eintragen buche absagen storniere losche kunde kundin haarschnitt farben schneiden halb viertel nach vor mittag ' +
  'vormittag nachmittag abend etwas noch gibt geht kann kannst steht kommt doch nicht kein keine hilfe schliessen schliesse ab an gegen fruh sag ' +
  'gebucht abgesagt storniert eingetragen geoffnet offnungszeiten krank ferien urlaub arbeitet ob oder aber').split(' '));
const ENGLISH_WORDS = new Set(('the a an and is are do does have has we you i on at for with by to until who what when how where today tomorrow free ' +
  'appointment appointments closed close open again next this week monday tuesday wednesday thursday friday saturday sunday january february march may june ' +
  'july october december please thanks thank yes no hello hi book cancel customer haircut colour color half quarter past noon morning afternoon evening ' +
  'anything any there can could would time day booking help of it that make add put schedule who\'s what\'s our my').split(' '));

function detectLanguage(tokens: Token[], fallback: AssistantLanguage | undefined): AssistantLanguage {
  let german = 0;
  let english = 0;
  for (const { norm } of tokens) {
    if (GERMAN_WORDS.has(norm)) german += 1;
    if (ENGLISH_WORDS.has(norm)) english += 1;
  }
  if (german > english) return 'de';
  if (english > german) return 'en';
  return fallback ?? 'en';
}

// ---------- days ----------

const WEEKDAY_WORDS: Record<string, number> = {
  sunday: 0, sun: 0, sonntag: 0,
  monday: 1, mon: 1, montag: 1,
  tuesday: 2, tues: 2, tue: 2, dienstag: 2,
  wednesday: 3, weds: 3, wed: 3, mittwoch: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4, donnerstag: 4,
  friday: 5, fri: 5, freitag: 5,
  saturday: 6, sat: 6, samstag: 6, sonnabend: 6,
};
const MONTH_WORDS: Record<string, number> = {
  january: 1, jan: 1, januar: 1, janner: 1,
  february: 2, feb: 2, februar: 2,
  march: 3, mar: 3, marz: 3, maerz: 3,
  april: 4, apr: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, juni: 6,
  july: 7, jul: 7, juli: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, oktober: 10, okt: 10,
  november: 11, nov: 11,
  december: 12, dec: 12, dezember: 12, dez: 12,
};
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  eins: 1, zwei: 2, drei: 3, vier: 4, funf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwolf: 12, zwoelf: 12,
};
const longestFirst = (words: Record<string, number>) => Object.keys(words).sort((a, b) => b.length - a.length).join('|');
const WD = longestFirst(WEEKDAY_WORDS);
const MONTH = longestFirst(MONTH_WORDS);
const NUM = `\\d{1,2}|${longestFirst(NUMBER_WORDS)}`;
const ORDINAL = '(?:st|nd|rd|th)';
const NEXT_WEEK = 'next week|nachste woche|naechste woche|kommende woche|nachster woche|naechster woche';
const THIS_WEEK = 'this week|diese woche|dieser woche';
/** Words between two days that make them one period: "24 to 26 December", "vom 24. bis 26.". */
const RANGE_LINK = '-|to|until|till|through|bis';

const number = (value: string): number => NUMBER_WORDS[value] ?? Number(value);

/** `exact`: a calendar date ("24 November"), as opposed to a day worked out from today ("Friday"). */
interface FoundDay { date: string; index: number; end: number; exact: boolean }

interface DayReading {
  date?: string;
  endDate?: string;
  fromDate?: string;
  /** "Freitag Morgen": the word morgen meant the morning, not tomorrow. */
  morning: boolean;
  found: FoundDay[];
}

function readDays(scan: Scan, today: string, expecting: AssistantSlot | undefined): DayReading {
  const found: FoundDay[] = [];
  const thisYear = Number(today.slice(0, 4));
  const iso = (year: number, month: number, day: number) =>
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  /** A day and month without a year mean the next time that date comes round. */
  const dayOf = (month: number, day: number, year?: string): string | null => {
    if (year) {
      const date = iso(year.length <= 2 ? 2000 + Number(year) : Number(year), month, day);
      return isRealDate(date) ? date : null;
    }
    const sameYear = iso(thisYear, month, day);
    if (isRealDate(sameYear) && sameYear >= today) return sameYear;
    const nextYear = iso(thisYear + 1, month, day);
    return isRealDate(nextYear) ? nextYear : isRealDate(sameYear) ? sameYear : null;
  };
  let exact = true;
  const add = (match: RegExpExecArray, date: string | null) => {
    if (date) found.push({ date, index: match.index, end: match.index + match[0].length, exact });
  };
  /** Takes every match of the pattern; `read` returns the day, or null to leave the words alone. */
  const each = (pattern: RegExp, read: (match: RegExpExecArray) => string | null) => {
    for (let guard = 0; guard < 4; guard += 1) {
      let date: string | null = null;
      const match = scan.take(pattern, candidate => (date = read(candidate)) !== null);
      if (!match) return;
      add(match, date);
    }
  };

  let range: [string, string] | undefined;
  // "24 to 26 December", "24.-26. Dezember"; also "24 and 25 December" when the two days follow each other.
  const wordRange = scan.take(
    new RegExp(`\\b(\\d{1,2})${ORDINAL}?\\.?\\s*(${RANGE_LINK}|and|und)\\s*(?:the\\s+|zum\\s+)?(\\d{1,2})${ORDINAL}?\\.?\\s+(?:of\\s+)?(${MONTH})\\b(?:\\s+(\\d{4})\\b)?`),
    match => !/^(?:and|und)$/.test(match[2]) || Number(match[3]) === Number(match[1]) + 1,
  );
  if (wordRange) {
    const end = dayOf(MONTH_WORDS[wordRange[4]], Number(wordRange[3]), wordRange[5]);
    const start = end && iso(Number(end.slice(0, 4)), MONTH_WORDS[wordRange[4]], Number(wordRange[1]));
    if (start && end && isRealDate(start) && start <= end) { range = [start, end]; add(wordRange, start); }
  }
  // "24.-26.12."
  const numberRange = !range && scan.take(/\b(\d{1,2})\.\s*-\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?!\d)/);
  if (numberRange) {
    const end = dayOf(Number(numberRange[3]), Number(numberRange[2]), numberRange[4]);
    const start = end && iso(Number(end.slice(0, 4)), Number(numberRange[3]), Number(numberRange[1]));
    if (start && end && isRealDate(start) && start <= end) { range = [start, end]; add(numberRange, start); }
  }

  // 2026-11-24
  each(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, match => {
    const date = iso(Number(match[1]), Number(match[2]), Number(match[3]));
    return isRealDate(date) ? date : null;
  });
  // 24.11. / 24.11.2026 / 24/11. With a dot and no year it could also be a time ("15.30"), so
  // "um 10.30" and "10.30 Uhr" are left for the time reader.
  each(/\b(\d{1,2})([./])(\d{1,2})(?:\2(\d{2,4}))?(?![\d:])/, match => {
    const [, day, separator, month, year] = match;
    if (Number(month) < 1 || Number(month) > 12) return null;
    if (separator === '.' && !year) {
      if (/(?:\bum|\bat|\bgegen|@)\s*$/.test(scan.before(match.index))) return null;
      if (/^\s*(?:uhr|h|am|pm)\b/.test(scan.after(match.index + match[0].length))) return null;
    }
    return dayOf(Number(month), Number(day), year);
  });
  // 24 November / 24. Dezember 2026 / 24th of November
  each(new RegExp(`\\b(\\d{1,2})${ORDINAL}?\\.?\\s+(?:of\\s+)?(${MONTH})\\b(?:\\s+(\\d{4})\\b)?`),
    match => dayOf(MONTH_WORDS[match[2]], Number(match[1]), match[3]));
  // November 24 / November 24th, 2026
  each(new RegExp(`\\b(${MONTH})\\s+(?:the\\s+)?(\\d{1,2})${ORDINAL}?\\b(?![:.]\\d|\\s*(?:uhr|h|am|pm)\\b)(?:\\s+(\\d{4})\\b)?`),
    match => dayOf(MONTH_WORDS[match[1]], Number(match[2]), match[3]));

  // "the 24th": the next day with that number.
  const dayOfMonth = (day: number): string | null => {
    for (let offset = 0; offset < 62; offset += 1) {
      const date = addDays(today, offset);
      if (Number(date.slice(8)) === day) return date;
    }
    return null;
  };
  each(new RegExp(`\\b(?:the\\s+)?(\\d{1,2})${ORDINAL}\\b`), match => dayOfMonth(Number(match[1])));
  if (expecting === 'date') each(/^(\d{1,2})$/, match => dayOfMonth(Number(match[1])));

  // Everything from here on is a day counted from today, not a calendar date.
  exact = false;
  // German "morgen" is tomorrow, except right after a day ("Freitag Morgen" is Friday morning).
  // This is read first, while the day before it is still there to be seen.
  const morning = Boolean(scan.take(new RegExp(`(?<=\\b(?:heute|morgen|ubermorgen|uebermorgen|${WD})\\s)morgen\\b|\\bam morgen\\b|\\bmorgens\\b`)));
  each(/\b(?:the\s+)?day after tomorrow\b|\bubermorgen\b|\buebermorgen\b/, () => addDays(today, 2));
  // Past days matter for the agenda ("who came yesterday?"); a booking there is refused by the rules.
  each(/\b(?:the\s+)?day before yesterday\b|\bvorgestern\b/, () => addDays(today, -2));
  each(/\byesterday\b|\bgestern\b/, () => addDays(today, -1));
  each(/\btoday\b|\btonight\b|\bheute\b/, () => today);
  each(/\btomorrow\b|\btmrw\b|\bmorgen\b/, () => addDays(today, 1));

  const weekday = (pattern: string, reading: WeekdayReading) =>
    each(new RegExp(pattern), match => weekdayDate(WEEKDAY_WORDS[match.slice(1).find(Boolean)!], today, reading));
  weekday(`\\b(?:ubernachste[nrs]?|uebernaechste[nrs]?)\\s+(${WD})\\b`, 'afterNext');
  // "last Friday" / "letzten Freitag": the one before today ("Was Lea booked last Friday?").
  each(new RegExp(`\\b(?:last|letzte[nrs]?|vergangene[nrs]?)\\s+(${WD})\\b`), match => {
    const weekBefore = addDays(weekdayDate(WEEKDAY_WORDS[match[1]], today, 'coming'), -7);
    return weekBefore === today ? addDays(today, -7) : weekBefore;
  });
  weekday(`\\b(${WD})\\s+(?:in\\s+)?(?:der\\s+)?(?:${NEXT_WEEK})\\b|\\b(?:${NEXT_WEEK})\\s+(?:on\\s+|am\\s+)?(${WD})\\b`, 'nextWeek');
  weekday(`\\b(${WD})\\s+(?:in\\s+)?(?:${THIS_WEEK})\\b|\\b(?:${THIS_WEEK})\\s+(?:on\\s+|am\\s+)?(${WD})\\b`, 'thisWeek');
  // English "next Friday" is the Friday of next week; German "nächsten Freitag" is the next one to come.
  weekday(`\\bnext\\s+(${WD})\\b`, 'nextWeek');
  weekday(`\\b(?:nachste[nrs]?|naechste[nrs]?)\\s+(${WD})\\b`, 'coming');
  weekday(`\\b(?:this coming|this|coming|diese[nrs]?|kommende[nrs]?)\\s+(${WD})\\b`, 'this');
  // A bare weekday: "this week" or "next week" anywhere in the message still decides which one.
  const nextWeek = new RegExp(`\\b(?:${NEXT_WEEK})\\b`);
  const thisWeek = new RegExp(`\\b(?:${THIS_WEEK})\\b`);
  const bare: WeekdayReading = nextWeek.test(scan.unread) ? 'nextWeek' : thisWeek.test(scan.unread) ? 'thisWeek' : 'coming';
  const before = found.length;
  weekday(`\\b(${WD})\\b`, bare);
  if (found.length > before && bare !== 'coming') scan.take(bare === 'nextWeek' ? nextWeek : thisWeek);

  // in 3 days / in zwei Wochen / in a week
  each(new RegExp(`\\bin\\s+(${NUM}|a|an|einer|einem|einen)\\s+(days?|tag(?:en|e)?|weeks?|wochen?)\\b`), match => {
    const count = /^(?:a|an|einer|einem|einen)$/.test(match[1]) ? 1 : number(match[1]);
    return addDays(today, count * (/^(?:week|woche)/.test(match[2]) ? 7 : 1));
  });
  found.sort((a, b) => a.index - b.index);
  // "Friday 27 November": the calendar date counts, the weekday beside it is only decoration
  // (and on its own would have meant the coming Friday).
  const days = found.some(day => day.exact) ? found.filter(day => day.exact) : found;
  // Two days joined by "to" / "bis" are one period: "from 24 December to 2 January".
  if (!range && days.length >= 2) {
    const between = scan.unread.slice(days[0].end, days[1].index).replace(/\u0001+/g, '');
    if (new RegExp(`^\\.?\\s*(?:${RANGE_LINK})\\s*(?:the\\s+|zum\\s+|am\\s+|den\\s+)?$`).test(between)) {
      // "Monday to Wednesday": the Wednesday after that Monday, also when another Wednesday comes first.
      let end = days[1].date;
      while (!days[1].exact && end < days[0].date) end = addDays(end, 7);
      if (days[0].date <= end) range = [days[0].date, end];
    }
  }

  let fromDate: string | undefined;
  if (found.length === 0) {
    if (scan.take(nextWeek)) fromDate = addDays(startOfWeek(today), 7);
    else if (scan.take(thisWeek)) fromDate = today;
  }
  return {
    date: range ? range[0] : days[0]?.date,
    endDate: range && range[1] !== range[0] ? range[1] : undefined,
    fromDate,
    morning,
    found,
  };
}

// ---------- times ----------

function readPartOfDay(scan: Scan, morningFromDay: boolean): PartOfDay | undefined {
  let part: PartOfDay | undefined = morningFromDay ? 'morning' : undefined;
  if (scan.take(/\b(?:in the |this |am |in der )?(?:mornings?|vormittags?|fruh|frueh)\b/)) part = 'morning';
  if (scan.take(/\b(?:in the |this |am )?(?:afternoons?|nachmittags?)\b/)) part = 'afternoon';
  if (scan.take(/\b(?:in the |this |am )?(?:evenings?|abends?)\b/) || /\btonight\b/.test(scan.text)) part = 'evening';
  return part;
}

/** German words that follow the preposition "am", so "um 3 am Freitag" is not read as 3 a.m. */
const AFTER_GERMAN_AM = /^\s*(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag|morgen|vormittag|nachmittag|abend|mittag|wochenende|\d)/;

function readTime(scan: Scan, days: FoundDay[], partOfDay: PartOfDay | undefined, expecting: AssistantSlot | undefined): string | undefined {
  const clock = (hour: number, minute: number): string | undefined =>
    hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
      ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      : undefined;
  /**
   * A salon works by day, so an hour without "am", "pm" or a 24-hour form is read as daytime:
   * "at 3" and "um 3 Uhr" are 15:00. "8 in the evening" is 20:00.
   */
  const daytime = (hour: number, marker?: string, exact = false): number => {
    const half = marker?.replace(/\./g, '');
    if (half === 'pm') return hour < 12 ? hour + 12 : hour;
    if (half === 'am') return hour === 12 ? 0 : hour;
    if (exact || hour > 12) return hour;
    if (partOfDay === 'evening' || (partOfDay === 'afternoon' && hour <= 7)) return hour < 12 ? hour + 12 : hour;
    if (partOfDay === 'morning') return hour;
    return hour >= 1 && hour <= 6 ? hour + 12 : hour;
  };
  /** "am" after a number is English a.m. unless a German day word follows. */
  const marker = (match: RegExpExecArray, value: string | undefined): string | undefined =>
    value === 'am' && AFTER_GERMAN_AM.test(scan.text.slice(match.index + match[0].length)) ? undefined : value;

  // 15:00 / 15.30 Uhr / 3:30pm
  let match = scan.take(/\b(\d{1,2})[:.](\d{2})(?!\d)(?:\s*(uhr|h|a\.?m|p\.?m)\b)?/);
  if (match) return clock(daytime(Number(match[1]), marker(match, match[3]), match[1].length === 2 && match[1][0] === '0'), Number(match[2]));
  // 3pm / 10 a.m.
  match = scan.take(/\b(\d{1,2})\s*(a\.?m|p\.?m)\b/, candidate => marker(candidate, candidate[2]) !== undefined);
  if (match) return clock(daytime(Number(match[1]), match[2]), 0);
  // 15 Uhr / 15 Uhr 30 / 15h / ein Uhr
  match = scan.take(new RegExp(`\\b(${NUM}|ein)\\s*(?:uhr|h)\\b(?:\\s*(\\d{2})\\b)?`));
  if (match) return clock(daytime(match[1] === 'ein' ? 1 : number(match[1])), Number(match[2] ?? 0));
  match = scan.take(new RegExp(`\\b(${NUM})\\s*o'?\\s?clock\\b`));
  if (match) return clock(daytime(number(match[1])), 0);

  // half past two / quarter to three / halb drei / viertel nach drei
  const spoken: Array<[RegExp, number, number]> = [
    [new RegExp(`\\bhalf\\s+(?:past\\s+)?(${NUM})\\b`), 0, 30],
    [new RegExp(`\\bquarter\\s+past\\s+(${NUM})\\b`), 0, 15],
    [new RegExp(`\\bquarter\\s+(?:to|before)\\s+(${NUM})\\b`), -1, 45],
    [new RegExp(`\\bhalb\\s+(${NUM})\\b`), -1, 30],
    [new RegExp(`\\bviertel\\s+nach\\s+(${NUM})\\b`), 0, 15],
    [new RegExp(`\\b(?:viertel\\s+vor|dreiviertel)\\s+(${NUM})\\b`), -1, 45],
  ];
  for (const [pattern, shift, minute] of spoken) {
    match = scan.take(pattern);
    if (match) {
      const hour = number(match[1]) + shift;
      return clock(daytime(hour === 0 ? 12 : hour), minute);
    }
  }

  // at 3 / um 10 / @ 10
  match = scan.take(new RegExp(`(?:\\bat|\\bum|@|\\bgegen|\\baround)\\s*(${NUM})\\b(?!\\s*[./:]\\d)`));
  if (match) return clock(daytime(number(match[1])), 0);
  if (scan.take(/\b(?:12\s+)?noon\b|\bmidday\b|\bmittags\b|\b(?:am|um|uber|ueber)\s+mittag\b/)) return '12:00';

  // A bare number right after the day: "Tuesday 10".
  for (const day of days) {
    const next = /^\s(\d{1,2})\b(?!\s*[./:]\d)/.exec(scan.after(day.end));
    if (next && Number(next[1]) >= 7 && Number(next[1]) <= 21) {
      scan.take(new RegExp(`\\b${next[1]}\\b`), candidate => candidate.index >= day.end);
      return clock(Number(next[1]), 0);
    }
  }
  // The assistant asked "What time?": the answer is just "10" or "10 30", or has a lone number
  // in it ("let's say 11").
  if (expecting === 'time') {
    match = scan.take(new RegExp(`^(${NUM})(?:\\s+(\\d{2}))?$`)) ?? scan.take(new RegExp(`\\b(${NUM})\\b(?!\\s*[./:]\\d)`));
    if (match) return clock(daytime(number(match[1])), Number(match[2] ?? 0));
  }
  return undefined;
}

// ---------- services ----------

/**
 * Everyday words for kinds of services. A word counts for a service when the same kind of word
 * is in the service's own name or category, so "Haarschnitt" finds "Haircut" and "färben" finds
 * "Colouring", whatever the salon calls them.
 */
const SERVICE_WORDS: Array<[string, RegExp]> = [
  ['cut', /\b(?:hair\s?cuts?|cuts?|trims?|\w*schnitt|schneiden|coupe)\b/],
  ['colour', /\b(?:colou?r(?:ing|ation)?s?|dye(?:ing)?|tint|farben|farbe|farbung|koloration|coloration|tonung|tonen)\b/],
  ['highlights', /\b(?:highlights?|balayage|foils?|strahnen|strahnchen|meches)\b/],
  ['blowdry', /\b(?:blow\W?dr(?:y|ied|ying)|blow\W?out|fohnen|fohn|fonen|styling|brushing)\b/],
  ['wash', /\b(?:wash|shampoo|waschen)\b/],
  ['men', /\b(?:men'?s?|mens|gents?|herren\w*|manner\w*)\b/],
  ['women', /\b(?:women'?s?|womens|ladies|lady|damen\w*|frauen\w*)\b/],
  ['kids', /\b(?:kids?|child(?:ren)?(?:'?s)?|kinder\w*)\b/],
  ['beard', /\b(?:beard|shave|bart\w*|rasur)\b/],
  ['updo', /\b(?:up\W?do|hochsteck\w*)\b/],
  ['perm', /\b(?:perm|dauerwelle)\b/],
  ['treatment', /\b(?:treatment|mask|kur|haarkur|pflege)\b/],
  ['gloss', /\b(?:gloss(?:ing)?|glanz\w*)\b/],
  ['consultation', /\b(?:consultation|beratung)\b/],
];

function readService(scan: Scan, services: InterpreterContext['services']): Pick<AssistantRequest, 'serviceId' | 'serviceOptions'> {
  // The service's own name wins, the longest name first ("Cut and colour" before "Cut").
  const byName = services
    .map(service => ({ service, words: fold(service.name).split(/[^a-z0-9]+/).filter(Boolean) }))
    .filter(({ words }) => words.length > 0)
    .sort((a, b) => b.words.join('').length - a.words.join('').length);
  for (const { service, words } of byName) {
    if (scan.take(new RegExp(`\\b${words.map(escapeRegExp).join('\\W*')}\\b`))) return { serviceId: service.id };
  }

  // All kinds are looked up before any is marked as read: "Herrenschnitt" is both "men" and "cut".
  const said = SERVICE_WORDS.filter(([, pattern]) => pattern.test(scan.unread)).map(([kind]) => kind);
  for (const [, pattern] of SERVICE_WORDS) while (scan.take(pattern)) { /* mark every such word as read */ }
  if (said.length === 0) return {};
  const scored = services.map(service => {
    const label = fold(`${service.name} ${service.category ?? ''}`);
    const kinds = SERVICE_WORDS.filter(([, pattern]) => pattern.test(label)).map(([kind]) => kind);
    return { service, kinds: kinds.length, hits: said.filter(kind => kinds.includes(kind)).length };
  }).filter(item => item.hits > 0);
  if (scored.length === 0) return {};
  const most = Math.max(...scored.map(item => item.hits));
  const top = scored.filter(item => item.hits === most);
  // A service that is nothing but what was said wins: "haircut" means "Haircut", not "Cut and colour".
  const exact = top.filter(item => item.kinds === item.hits);
  const chosen = exact.length === 1 ? exact : top;
  return chosen.length === 1 ? { serviceId: chosen[0].service.id } : { serviceOptions: chosen.map(item => item.service.id) };
}

// ---------- people ----------

const nameWords = (name: string): string[] => fold(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** The name as whole words, also as "Lea Brunner's". */
const namePattern = (words: string[]): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])${words.map(escapeRegExp).join("[\\s.'-]+")}(?:'s)?(?![\\p{L}\\p{N}])`, 'u');

function readKnownCustomer(scan: Scan, customers: InterpreterContext['customers']): string | undefined {
  const candidates = customers
    .map(customer => ({ name: customer.name.trim(), words: nameWords(customer.name) }))
    // One-word names are only taken as written by the owner later; here they would match too much.
    .filter(({ words }) => words.length >= 2)
    .sort((a, b) => b.words.length - a.words.length || b.name.length - a.name.length);
  for (const { name, words } of candidates) {
    if (!scan.unread.includes(words[0])) continue;
    if (scan.take(namePattern(words))) return name;
  }
  return undefined;
}

const STAFF_CUE = '(?:with|mit|bei|by)\\s+';

/** Team members with the names they can be called by. A first or last name only counts when one person has it. */
function staffNames(employees: InterpreterContext['employees']) {
  const staff = employees.map(employee => ({
    id: employee.id,
    full: nameWords(employee.name),
    first: nameWords(employee.firstName),
    last: nameWords(employee.lastName),
  }));
  const single = staff.flatMap(({ id, first, last }) => [first, last].filter(words => words.length > 0).map(words => ({ id, words })));
  const unique = single.filter(item => single.filter(other => other.words.join(' ') === item.words.join(' ')).length === 1);
  return { staff, unique };
}

/** "with Selina", "mit Luca Frei", or a full name anywhere. */
function readStaff(scan: Scan, employees: InterpreterContext['employees']): string | undefined {
  const { staff, unique } = staffNames(employees);
  for (const { id, full } of staff) {
    if (full.length >= 2 && scan.take(new RegExp(`(?:${STAFF_CUE})?${namePattern(full).source}`, 'u'))) return id;
  }
  for (const { id, words } of unique) {
    if (scan.take(new RegExp(`\\b${STAFF_CUE}${namePattern(words).source}`, 'u'))) return id;
  }
  return undefined;
}

/**
 * A first name on its own: "Is Selina free on Friday?" names the stylist. Next to another unknown
 * capitalised word it is part of a customer's name instead ("Selina Graf").
 */
function readLoneStaff(scan: Scan, employees: InterpreterContext['employees'], asking = false): string | undefined {
  // A question opens with a verb, which has a capital there and is no name: "Arbeitet Luca am Dienstag?".
  const looksLikeName = (token: Token | undefined) =>
    Boolean(token && !token.used && !STOP_WORDS.has(token.norm) && /^\p{Lu}/u.test(token.raw) && !(asking && token === scan.tokens[0]));
  /** "Frei" is a family name and the German word for free: such a name has to be written with a capital. */
  const everydayWord = (word: string) => STOP_WORDS.has(word) || GERMAN_WORDS.has(word) || ENGLISH_WORDS.has(word) ||
    word in WEEKDAY_WORDS || word in MONTH_WORDS;
  for (const { id, words } of staffNames(employees).unique) {
    const standsAlone = (match: RegExpExecArray) => {
      const end = match.index + match[0].length;
      const own = scan.tokens.filter(token => token.start < end && token.end > match.index);
      // The first word of a sentence has a capital anyway, so there it proves nothing.
      if (words.some(everydayWord) && (match.index === 0 || !own.every(token => /^\p{Lu}/u.test(token.raw)))) return false;
      const next = scan.tokens.find(token => token.start >= end);
      const previous = [...scan.tokens].reverse().find(token => token.end <= match.index);
      return !looksLikeName(next) && !looksLikeName(previous);
    };
    if (scan.take(namePattern(words), standsAlone)) return id;
  }
  return undefined;
}

/**
 * Everyday words that are not read as part of a customer's name. Some of them are names too
 * ("May", "Will", "Frei"): readNewName() takes those when the writing shows that a name is meant.
 */
const STOP_WORDS = new Set((
  // English
  'a an the and or but for on at in of to by with from into as is are am was were be been do does did have has had will would can could should may might ' +
  'i me my we us our you your he she her him his it its they them their that this these those there here what whats what\'s who whos who\'s whom when where ' +
  'why how which any some anything something anyone someone no not yes ok okay please thanks thank hi hello hey ' +
  'book booking bookings booked schedule reserve add make create put enter set new appointment appointments slot slots time times day days week weeks ' +
  'customer customers client clients cancel cancelled delete remove drop close closed closing closure open again reopen free available availability next ' +
  'earliest soonest agenda diary need needs want wants like get got give see show tell check find move squeeze fit pencil let lets let\'s going come comes ' +
  'coming salon shop calendar instead also just still then too it\'s that\'s there\'s don\'t dont up off out all whole everything stylist with named name ' +
  'mr mrs ms miss dr sir madam her\'s today tomorrow tonight morning afternoon evening noon o\'clock oclock half quarter past ' +
  'about called maybe perhaps rather sorry actually well better fine good now so if possible say around only one ' +
  'show list room look looking doing having holiday vacation right ' +
  // German
  'der die das den dem des ein eine einen einem einer eines und oder aber fur fuer am um im an auf aus bei mit von vom zu zum zur bis nach vor uber ueber ' +
  'ist sind war waren sein bin bist hat haben hast habt hatte wird werden kann kannst konnen koennen konnte konntest mochte moechte will soll darf ' +
  'ich mir mich wir uns unser du dir dich dein ihr sie er es ihn man sich das dies diese diesen dieser dieses was wer wen wem wann wo wie warum welche ' +
  'etwas jemand nichts kein keine keinen nicht ja nein bitte danke hallo hoi ' +
  'trag trage tragen eintragen buche buch buchen buchung buchungen reserviere reservieren mach mache machen erstelle erstellen leg lege anlegen neu neue neuen neuer ' +
  'termin termine terminen zeit zeiten tag tage tagen woche wochen kunde kunden kundin kundinnen storniere stornieren absagen sag sage ab losche loesche loschen ' +
  'streiche streichen entferne entfernen schliess schliesse schliessen geschlossen zu zumachen offen offnen oeffnen offne oeffne geoffnet wieder doch frei freie freien ' +
  'verfugbar platz nachste nachsten nachster naechste naechsten kommenden fruh frueh agenda brauche braucht will wollen mal noch auch dann schon gerne gern ' +
  'salon laden kalender stattdessen lieber nur alle alles ganz ganze ganzen frau herr heute morgen ubermorgen mittag vormittag nachmittag abend uhr halb viertel ' +
  'gibt geht ginge passt kommt steht los ein heisst namens vielleicht eher besser gut jetzt also wenn moglich sagen ungefahr etwa halt eben einfach kurz ' +
  'zeig zeige liste nehmen kommen unterbringen einschieben ferien urlaub betriebsferien ruhetag fuge fuege hinzu hinzufugen hinzufuegen'
).split(' '));

const NAME_CUES = new Set(('book schedule reserve for fur fuer cancel delete remove trag trage buche buch storniere losche loesche streiche entferne customer client ' +
  'kunde kundin frau herr mr mrs ms miss named name von fuers').split(' '));
/** Small words inside a family name: "Lea von Arx". */
const NAME_PARTICLES = new Set(['von', 'van', 'de', 'del', 'della', 'di', 'da', 'la', 'le', 'ten', 'ter', 'zu', 'der', 'den']);
const NAME_WORD = /^\p{L}[\p{L}'.-]*$/u;
/**
 * Everyday words that are common first or family names as well. Typed in lower case, only the
 * word beside them can tell which is meant ("may keller", "anna frei"), so only these are tried.
 */
const ALSO_NAMES = new Set('may will frei kurz gut'.split(' '));
/**
 * Everyday words whose capital letter proves nothing: German nouns and the polite "Sie" have one
 * anyway, English "I" too, a title only announces a name, and "Ok" or "Please" are often written so.
 */
const CAPITAL_ANYWAY = new Set(('i i\'m i\'ll i\'d sie ihr ihre ihren ihrem ihrer ihnen du dir dich dein ' +
  'termin termine terminen zeit zeiten tag tage tagen woche wochen kunde kunden kundin kundinnen platz salon laden kalender ' +
  'mittag vormittag nachmittag abend morgen uhr ferien urlaub betriebsferien ruhetag liste agenda buchung buchungen ' +
  'frau herr mr mrs ms miss dr sir madam ok okay yes no please thanks thank hi hello hey ja nein bitte danke hallo hoi').split(' '));

/**
 * "Anna Frei", "Peter Gut": a word like "frei" written with a capital right behind a first name is
 * a family name. Such words are left out when the message is searched for what it asks, so
 * "Is Anna Frei booked on Tuesday?" is not a question about a free time.
 */
function familyNames(scan: Scan): Token[] {
  const everyday = (word: string) => STOP_WORDS.has(word) || GERMAN_WORDS.has(word) || ENGLISH_WORDS.has(word) ||
    word in WEEKDAY_WORDS || word in MONTH_WORDS;
  return scan.tokens.filter((token, index) => {
    const before = scan.tokens[index - 1];
    return ALSO_NAMES.has(token.norm) && !token.used && /^\p{Lu}/u.test(token.raw) &&
      before !== undefined && !before.used && before.after === '' && /^\p{Lu}/u.test(before.raw) &&
      NAME_WORD.test(before.raw) && !everyday(before.norm);
  });
}

interface NameFound { name: string; cued: boolean; tokens: Token[] }

/**
 * Whatever is left of the message and looks like a person's name. `cued`: a word such as "for"
 * or "book" led to it. With `onlyAName` the message is the answer to "Who is it for?": then the
 * leftover words must be one name and nothing else, or "I wonder what ..." would become a customer.
 */
function readNewName(scan: Scan, onlyAName: boolean): NameFound | undefined {
  const typedInLowerCase = !/\p{Lu}/u.test(scan.tokens.map(token => token.raw).join(''));
  const plain = (raw: string) => raw.replace(/['’]s$/i, '');
  const capital = (token: Token) => /^\p{Lu}/u.test(token.raw);
  /** Written like a sentence, not all in capitals or with a capital on every word: only then a capital says something. */
  const capitalsTell = !typedInLowerCase && scan.tokens.some(token => /^\p{Ll}/u.test(token.raw));
  const plainName = (token: Token | undefined): token is Token =>
    Boolean(token && !token.used && !STOP_WORDS.has(token.norm) && NAME_WORD.test(plain(token.raw)) && (typedInLowerCase || capital(token)));
  /**
   * "May Keller", "Will Smith", "Anna Frei": an everyday word is part of a name after all when the
   * writing shows it. Where capitals are used, that is a capital in the middle of a sentence, right
   * beside another name word (or, for a word that is a common name, behind a word that announces
   * a name). "Book Lea in May" and "Will Anna be in on Friday?" have neither, so there the word
   * keeps its everyday meaning.
   */
  const nameAfterAll = (index: number): boolean => {
    const token = scan.tokens[index];
    if (token.used || !STOP_WORDS.has(token.norm) || !NAME_WORD.test(plain(token.raw))) return false;
    const previous = scan.tokens[index - 1];
    const commonName = ALSO_NAMES.has(token.norm);
    // Punctuation between two words means they do not belong to one name.
    const besideName = (token.after === '' && plainName(scan.tokens[index + 1])) || (previous?.after === '' && plainName(previous));
    // Lower case, or the answer to "Who is it for?": there even the first word of the message can be the name.
    if (commonName && (typedInLowerCase || (onlyAName && capital(token)))) {
      if (besideName || (onlyAName && scan.tokens.length === 1)) return true;
    }
    if (!capitalsTell || !capital(token) || CAPITAL_ANYWAY.has(token.norm)) return false;
    // The first word of a sentence has a capital anyway.
    if (!previous || /[.!?:;]/.test(previous.after)) return false;
    return besideName || (commonName && previous.after === '' && NAME_CUES.has(previous.norm));
  };
  const free = (index: number): boolean => {
    const token = scan.tokens[index];
    return Boolean(token) && !token.used && NAME_WORD.test(plain(token.raw)) && (!STOP_WORDS.has(token.norm) || nameAfterAll(index));
  };

  const groups: { tokens: Token[]; cued: boolean; capital: boolean }[] = [];
  for (let index = 0; index < scan.tokens.length; index += 1) {
    if (!free(index)) continue;
    const tokens: Token[] = [];
    const previous = scan.tokens[index - 1];
    let end = index;
    let possessive = false;
    while (end < scan.tokens.length) {
      const token = scan.tokens[end];
      const particle = NAME_PARTICLES.has(token.norm) && !token.used && tokens.length > 0 &&
        end + 1 < scan.tokens.length && free(end + 1);
      if (!free(end) && !particle) break;
      tokens.push(token);
      end += 1;
      if (/['’]s$/i.test(token.raw)) { possessive = true; break; }
    }
    groups.push({
      tokens,
      cued: possessive || Boolean(previous && NAME_CUES.has(previous.norm)),
      capital: tokens.filter(token => !NAME_PARTICLES.has(token.norm)).every(token => /^\p{Lu}/u.test(token.raw)),
    });
    index = end - 1;
  }

  const short = groups.filter(group => group.tokens.length <= 4);
  const usable = onlyAName
    ? (groups.length === 1 ? short : [])
    : short.filter(group => group.capital || (typedInLowerCase && group.cued));
  const chosen = usable.find(group => group.cued) ?? usable[0];
  if (!chosen) return undefined;
  const name = chosen.tokens
    .map(token => plain(token.raw))
    .map(word => (typedInLowerCase && !NAME_PARTICLES.has(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
  return { name, cued: chosen.cued, tokens: chosen.tokens };
}

// ---------- what the owner wants ----------

/**
 * How a question opens, with or without a question mark. "Can you ..." and "Kannst du ..." open
 * one too; isPoliteRequest() below decides whether such a sentence is a request after all.
 */
const QUESTION_START = /^(?:is|isn't|are|aren't|was|wasn't|were|weren't|do|does|doesn't|did|didn't|have|haven't|has|hasn't|had|what|whats|what's|when|who|whos|who's|whom|whose|how|which|where|why|will|won't|would|can|can't|could|shall|should|(?:may|might)\s+(?:i|we|you|he|she|they|it)|ist|sind|war|waren|ware|waere|hat|haben|hast|habt|hatte|hatten|haette|haetten|wurde|wurden|wuerde|wuerden|ginge|gabe|gaebe|sollte|sollten|gibt|kommt|kommen|arbeitet|arbeiten|fehlt|wann|wer|wen|wem|wie|welche[rsnm]?|wo|warum|wieso|weshalb|wird|werden|soll|sollen|darf|durfen|duerfen|kann|kannst|konnen|koennen|konnte|konntest|konnten|koennte|koenntest|koennten|weisst|weiss)\b/;
/** "Tell me if ...", "Check whether ...", "Sag mir, ob ...", "Ich möchte wissen, wann ...": asks to be told something. */
const ASKS_TO_BE_TOLD = new RegExp([
  '^(?:(?:please|bitte|and|und|then|dann|so|also|now|just)\\s+)*(?:tell|show|check|see|look|find out|let me know|verify|zeig|zeige|schau|schaue|guck|gucke|sieh|pruf|prufe|pruef|pruefe|kontrollier|kontrolliere)\\b',
  '\\b(?:whether|ob)\\b',
  '\\b(?:tell|check|see|know|wonder|wondering|ask|asking|asked|find out|look|sure|idea)\\b.*\\bif\\b',
  '\\b(?:know|wonder|wondering|wissen|weisst|weiss|frage mich|idea|ahnung)\\b.*\\b(?:when|who|what|why|how|which|where|wann|wer|was|wie|wo|warum|welche[rsnm]?)\\b',
  '\\bsage?\\s+(?:mir|uns)\\b',
].join('|'));
/**
 * A message can turn into a question although it does not open as one: with the English word
 * order of a question ("Tuesday, are we open then", "Lea Brunner, did she cancel"), or behind
 * "if" ("Lea asked if we are closed on Friday"). A change named from there on is asked about,
 * not asked for; "Close Friday if nobody is booked" names it before and stays a request.
 * (German puts the verb before the subject in plain statements too, so there this proves nothing.)
 */
const ASKS_BY_WORD_ORDER = /\b(?:is|are|was|were|do|does|did|have|has|had|should|shall)\s+(?:we|you|i|he|she|they|it|there|anybody|anyone|somebody|someone|everybody|everyone|nobody)\b|\b(?:will|would)\s+(?:we|i|he|she|they|it|there|anybody|anyone|somebody|someone|everybody|everyone|nobody)\b/;
/** "We are closed on Friday, aren't we": a statement that ends as a question. */
const QUESTION_TAG = /\b(?:isn't it|aren't we|don't we|doesn't (?:she|he)|is that (?:right|correct|true|so)|right|correct|or not|yes or no|oder|oder nicht|ja oder nein|nicht wahr|gell|stimmt das|stimmts|stimmt's|ist das (?:richtig|korrekt|so)|richtig|korrekt)$/;

/**
 * "Can you book ...", "Könntest du den Freitag schliessen?": a request put as a question. It only
 * counts as a request when the thing asked for is the change itself, named right behind "can you"
 * (in German at the end of the clause). "Can you tell me if Friday is closed?" asks to be told
 * something, so it stays a question and can never close the salon.
 */
const POLITE_EN = /^(?:please\s+)?(?:(?:can|could|would|will)\s+(?:you|u)|(?:can|could)\s+(?:we|i))\s+(?:(?:please|kindly|just|also|then|now|quickly|maybe)\s+)*(?:book|schedule|reserve|pencil|put|add|make|create|enter|set|cancel|delete|remove|scrap|call\s+off|close|shut|re-?open|open|unclose|undo|lift|mark|keep|move|change)\b/;
const POLITE_DE = /^(?:bitte\s+)?(?:(?:kannst|konntest|koenntest|wurdest|wuerdest)\s+du|(?:konnen|koennen|konnten|koennten|wurden|wuerden)\s+sie|(?:kann|konnte|koennte)\s+ich|(?:konnen|koennen|konnten|koennten)\s+wir)\b/;
const DE_CHANGE_VERB = /\b(?:eintragen|buchen|einbuchen|einplanen|reservieren|vormerken|anlegen|erstellen|hinzufugen|hinzufuegen|machen|stornieren|absagen|loschen|loeschen|streichen|entfernen|schliessen|zumachen|zulassen|offnen|oeffnen|aufmachen|aufheben|verschieben|andern|aendern)\b/;
/** Between "kannst du" and the verb, these turn the sentence into a question about something. */
const DE_ASKS_INSIDE = /\b(?:ob|wann|wer|wen|wem|warum|wieso|weshalb|welche[rsnm]?|sagen|schauen|nachsehen|nachschauen|prufen|pruefen|checken|zeigen|wissen|sehen|kontrollieren)\b/;

function isPoliteRequest(lead: string): boolean {
  if (/\b(?:whether|ob)\b/.test(lead)) return false;
  if (POLITE_EN.test(lead)) return true;
  const frame = POLITE_DE.exec(lead);
  if (!frame) return false;
  const rest = lead.slice(frame[0].length);
  const verb = DE_CHANGE_VERB.exec(rest);
  return verb !== null && !DE_ASKS_INSIDE.test(rest.slice(0, verb.index));
}

interface ChangeRule { intent: AssistantIntent; verbs: RegExp }

/**
 * Requests that change something. The most specific comes first ("remove the closure" is not a
 * cancellation). A closure is about the salon: "taking Friday off" only counts with "we" or "the
 * salon" as the one who takes it, because "Selina is taking Friday off" is one person's day off.
 */
const CHANGE_RULES: ChangeRule[] = [
  {
    intent: 'reopen',
    verbs: /\b(?:re-?open|unclose)\b|\bopen\b.*\b(?:again|after all|back up)\b|\b(?:remove|delete|undo|cancel|lift)\b.*\bclos(?:ure|ing)\b|\bwieder\s+(?:\w+\s+){0,2}(?:offnen|oeffnen|auf|offen|geoffnet|geoeffnet|aufmachen)\b|\b(?:offnen|oeffnen|offne|oeffne|aufmachen|offen|geoffnet|geoeffnet|auf)\b.*\bwieder\b|\bdoch\s+(?:\w+\s+){0,2}(?:offen|geoffnet|geoeffnet|auf)\b|\bschliessung\b.*\b(?:aufheben|entfernen|loschen|loeschen|streichen|ruckgangig|rueckgaengig)\b|\b(?:aufheben|entfernen|losche|loesche|streiche)\b.*\bschliessung\b/,
  },
  {
    intent: 'close',
    verbs: /\bclose\b(?!\s+to\b)|\bclosed\b|\bshut\b|\b(?:we|we're|salon|shop)\b.*\b(?:take|takes|taking)\b.*\boff\b|\bgeschlossen\b|\bschliesse?n?\b|\b(?:ist|sind|bleibt|bleiben|haben|hat|machen|mach|mache)\b.*\bzu$|\bzu\s?(?:machen|lassen)\b|\bruhetag\b|\bbetriebsferien\b|\b(?:we|we're|salon|shop)\b.*\b(?:on holiday|on vacation)\b|\b(?:wir|salon)\b.*\b(?:ferien|urlaub)\b/,
  },
  {
    intent: 'cancel',
    verbs: /\b(?:cancel|delete|remove|scrap|call off)\b|\b(?:storniere|stornieren|storno|absagen|losche|loesche|loschen|loeschen|streiche|streichen|entferne|entfernen)\b|\bsage?\b.*\bab\b/,
  },
  {
    intent: 'book',
    verbs: /\b(?:book|schedule|reserve|pencil in|put down)\b|\b(?:add|make|create|enter|set up|put in|new)\b.*\b(?:booking|appointment|reservation)\b|\b(?:appointment|booking)\s+for\b|\b(?:trag|trage|tragen)\b.*\bein\b|\b(?:eintragen|einbuchen|einplanen|buche|buch|buchen|reserviere|reservieren|vormerken)\b|\b(?:mach|mache|machen|erstelle|erstellen|leg|lege|anlegen|neuer|neuen|neue|fuge|fuege|hinzufugen|hinzufuegen)\b.*\b(?:termin|buchung)\b|\b(?:termin|buchung)\s+(?:fur|fuer)\b/,
  },
];
/** Things that look like a booking word but are not a request to book. */
const NOT_A_BOOKING = /\b(?:a|the|my|this|that)\s+book\b|\bonline\b|\b(?:my|our|the|today'?s|tomorrow'?s)\s+schedule\b/;
const NEGATION = /^(?:don'?t|not|never|nicht|kein|keine|keinen|nie|niemals)$/;
const NEGATION_INSIDE = /\b(?:not|never|nicht|kein|keine|keinen|nie|niemals)\b/;

const AVAILABILITY = /\b(?:free|available|availability|availabilities|openings?|vacanc(?:y|ies)|gaps?|slots?|space|room|anything|fully booked|booked (?:out|up)|earliest|soonest)\b|\b(?:can|could)\s+(?:\w+\s+){0,3}(?:do|take|manage|see|come)\b|\b(?:kann|kannst|konnen|koennen|konnte|koennte)\s+(?:\w+\s+){0,6}(?:nehmen|machen|kommen|unterbringen|einschieben)\b|\bnoch\s+jemand\w*\b|\b(?:have|has|got)\s+(?:\w+\s+){0,2}time\b|\bwhen\s+(?:can|could|is|are|do|does)\b|\b(?:fit|squeeze)\b.*\bin\b|\b(?:do you|do we|have you|have we|is there|are there)\b.*\b(?:an appointment|a slot|an opening)\b|\b(?:frei|freie|freien|freier|freies|verfugbar|verfuegbar|platz|lucke|luecke|ausgebucht|fruhest\w*|fruehest\w*)\b|\b(?:hast|hat|habt|haben|hatte|hattest|gibt)\b.*\b(?:zeit|einen termin)\b|\bwann\s+(?:kann|konnte|koennte|geht|ginge|hatte|haette|ist|hast|habt|haben)\b|\b(?:geht|ginge|passt)\b|\bnoch\s+(?:was|etwas)\b/;
const AGENDA = /\bwhat(?:'s| is| do we have| have we got)?\s+(?:on|planned|scheduled|happening|coming up|booked)\b|\b(?:show|list)\b|\b(?:zeig|zeige|liste)\b|\bhow\s+(?:does|is|do)\b.*\blook(?:ing)?\b|\bwhat\s+(?:is|are|does|do)\s+(?:\w+\s+)?(?:doing|having|got)\b|\b(?:agenda|schedule|diary|appointments|bookings|lined up)\b|\b(?:my|the|our) day\b|\bwho(?:'s| is| comes| do i have| do we have)\b|\bnext (?:appointment|customer|client|one|booking)\b|\bwhat\s+(?:does|do)\s+(?:\w+\s+)?have\b|\bwas\s+(?:steht|liegt|ist|hat|macht|haben wir|hab ich|habe ich|gibt es|lauft|laeuft)\b|\b(?:termine|tagesplan|tagesubersicht|ubersicht|uebersicht|buchungen)\b|\bwer\s+(?:kommt|ist|hat)\b|\bnachste[rn]?\s+(?:termin|kunde|kundin)\b|\bwie sieht\b/;
const AGENDA_NEXT = /\bwho(?:'s| is| comes)? next\b|\bnext (?:appointment|customer|client|one|booking)\b|\bwer (?:ist|kommt) (?:als |der |die )?nachste[rsn]?\b|\bnachste[rn]? (?:termin|kunde|kundin)\b/;
const HELP = /\b(?:help|hilfe|examples?|beispiele?)\b|\bwhat can (?:you|i)\b|\bwas kannst du\b|\bwas kann ich\b|\bhow does this work\b|\bhow do (?:i|we) (?:book|cancel|close|open|reopen|add|make|delete|remove|change|move)\b|\bwie funktioniert\b|\bwie (?:kann|mache|trage|buche|sage|schliesse) ich\b/;

/**
 * What a question can be about, so that it is answered instead of becoming the change it mentions:
 * the salon's hours, somebody's appointments, or whether somebody cancelled.
 */
const ASKS_ABOUT_HOURS = /\b(?:open|opens|opened|opening|re-?open|close|closes|closed|closing|closures?|shut|geschlossen|schliessen|schliesst|schliesse|schliessung|zumachen|offen|offnen|offnet|geoffnet|geoeffnet|aufmachen|offnungszeit\w*|oeffnungszeit\w*|schliesstag\w*|ruhetag|betriebsferien|business hours|holidays?|vacation|ferien|urlaub)\b|\b(?:ist|sind|haben|hat|habt|bleibt|bleiben|machen|macht|mach)\b.*\b(?:zu|auf)$/;
/** Whether a cancellation happened ("Has Lea cancelled?"), as opposed to whether one should be made. */
const ASKS_ABOUT_CANCELLING = /\b(?:cancelled|canceled|cancellations?|called off|no-?shows?|abgesagt|absage|absagen gab|storniert|stornierung\w*|storno|gestrichen|abgemeldet)\b|\b(?:did|has|have|had)\b.*\bcancel\b|\bsagt\b.*\bab$/;
const ASKS_ABOUT_APPOINTMENTS = /\b(?:booked|booking|bookings|appointments?|reservations?|reserved|scheduled|coming|comes|due|expected|termin|termine|gebucht|buchung|buchungen|reserviert|eingetragen|kommt|angemeldet)\b|\b(?:did|has|have|had)\b.*\bbook\b|\bin (?:the|my|our) (?:calendar|diary|book)\b|\bim kalender\b/;
/** "Opening hours", "Öffnungszeiten": the salon's hours, asked for by name. */
const OPENING_HOURS = /\b(?:opening|business) (?:hours|times)\b|\b(?:offnungszeit|oeffnungszeit)\w*/;
/** Words that ask for a time that can still be booked, as opposed to an appointment that exists. */
const ASKS_FOR_A_TIME = /\b(?:free|available|availability|availabilities|openings?|vacanc(?:y|ies)|gaps?|slots?|space|room|anything|earliest|soonest|frei|freie[nrs]?|verfugbar|verfuegbar|platz|lucke|luecke|fruhest\w*|fruehest\w*|zeit|can|could|kann|kannst|konnen|koennen|konnte|koennte|fit|squeeze|geht|ginge|passt|hast du|habt ihr|do you have|have you got)\b/;
/**
 * Words for a time before today that the day reader does not know ("last week", "vor zwei Wochen").
 * A question with one of them left over is not answered from the coming days as if it asked about those.
 */
const UNREAD_PAST = new Set('last ago previous earlier letzte letzten letzter letztes vergangene vergangenen vorige vorigen vorher fruher frueher neulich'.split(' '));
/** "How many ...": counting and prices are not something the assistant answers. */
const COUNTING = /^(?:how many|how much|wie viele?|wieviele?)\b/;

/**
 * Time off of one person: "is off", "taking Friday off", "on holiday", "sick", "krank", "Ferien".
 * Together with a team member's name (or "I", "she", "my colleague") this is never about the salon.
 */
const TIME_OFF = /\b(?:is|are|am|be|was|were|i'm|im|she's|he's|they're)(?:\s+\w+){0,2}\s+off\b|\b(?:take|takes|taking|took|has|have|having|had|gets?|got|needs?|wants?)\b.*\boff\b|\b(?:days?|time)\s+off\b|\b(?:nimmt|nehme|nehmen|nahm)\b.*\bfrei\b|\b(?:on (?:holiday|holidays|vacation|leave|sick leave)|holidays?|vacation|sick|ill|unwell|absent|absence|away|out of office|not (?:in|here|working|coming|available)|won't be (?:in|here|working|coming|available)|can't (?:come|work|make it)|krank|ferien|urlaub|abwesend|abwesenheit|fehlt|fallt aus|faellt aus|nicht da|kommt nicht|arbeitet nicht|frei nehmen|frei genommen|freigenommen|nimmt frei|freinehmen|freier tag|freien tag|hat frei|frei hat)\b/;
const SOMEBODY = /\b(?:i|i'm|im|i'll|me|my|he|she|they|he's|she's|ich|er|mein|meine|stylist|employee|colleague|apprentice|trainee|staff|mitarbeiter\w*|lehrling|lernende\w*|kolleg\w+|angestellte\w*)\b/;

/**
 * Words that make a message a sentence of its own: verbs, and the words a question opens with.
 * A message with one of them left over is not just a detail added to the request before
 * ("Lea Brunner is booked on Tuesday" does not mean "for Lea Brunner on Tuesday instead").
 */
const SENTENCE_WORDS = new Set((
  // English
  'is are was were be been being isn\'t aren\'t wasn\'t weren\'t do does did doing done don\'t dont doesn\'t didn\'t have has had having haven\'t hasn\'t ' +
  'will won\'t would wouldn\'t can can\'t cannot could couldn\'t should shouldn\'t shall may might must it\'s that\'s there\'s ' +
  'book booked schedule scheduled reserve reserved add make create put enter set cancel cancelled canceled delete remove drop close closed open opened reopen ' +
  'need needs want wants get got give see show tell check find move squeeze fit pencil let going come comes coming look looking doing ' +
  'what whats what\'s who whos who\'s whom when where why how which ' +
  // German
  'ist sind war waren bin bist hat haben hast habt hatte hatten wird werden wurde kann kannst konnen koennen konnte konntest koennte mochte moechte will wollen soll sollen darf muss ' +
  'trag trage tragen eintragen buche buch buchen reserviere reservieren mach mache machen erstelle erstellen leg lege anlegen storniere stornieren absagen sag sage ' +
  'losche loesche loschen streiche streichen entferne entfernen schliesse schliessen geschlossen zumachen offnen oeffnen offne oeffne geoffnet ' +
  'brauche braucht gibt geht ginge passt kommt steht heisst zeig zeige nehmen kommen unterbringen einschieben fuge fuege hinzufugen hinzufuegen ' +
  'was wer wen wem wann warum welche'
).split(' '));
/**
 * Words that say "not", or report something that happened. A message with one of them is neither
 * an answer nor a correction, even when it names the customer or the day the assistant asked for:
 * "Trag Lea Brunner nicht ein" does not answer "Who is it for?" with Lea Brunner.
 */
const DENIES_OR_REPORTS = new Set(('not never don\'t dont doesn\'t didn\'t won\'t can\'t cannot nicht kein keine keinen nie niemals ' +
  'booked cancelled canceled closed coming comes came gebucht abgesagt storniert geschlossen kommt kam').split(' '));
/** Turns of phrase around a detail that are no sentence: "make it 11", "let's say Friday", "it is for Mia Keller", "what about the morning?". */
const DETAIL_PHRASE = /\b(?:it|that|this)(?:'s|\s+is)\s+for\b|\b(?:es|das)\s+ist\s+(?:fur|fuer)\b|\b(?:(?:can|could)\s+(?:you|we)\s+)?(?:make|move|change|switch|shift|set|put)\s+(?:it|that|this)(?:\s+(?:to|on|at))?\b|\blet'?s\s+(?:say|do|make\s+it|try|take)\b|\b(?:what|how)\s+about\b|\b(?:sagen|machen|nehmen)\s+wir\b|\bwie\s+(?:ware|waere|wars|waers)(?:\s+es)?(?:\s+mit)?\b|\bwas\s+ist\s+mit\b|\b(?:verschieb|verschiebe|andere|aendere)\s+(?:es|ihn|sie|das|den)(?:\s+auf)?\b|\bmache?\s+(?:es|das|daraus)\b/;

const GREETING_WORDS = 'hi|hello|hey|hallo|hoi|gruezi|gruessech|servus|moin|guten (?:morgen|tag|abend)|good (?:morning|afternoon|evening)';
/** What is still unread at the start of the message, after anything that was already taken there. */
const atStart = (words: string) => new RegExp(`^[\\u0001\\s]*(?:${words})\\b`);
const GREETING = atStart(GREETING_WORDS);
/** "Guten Morgen" and "good morning" greet wherever they stand: they never mean tomorrow or the morning. */
const GREETING_ANYWHERE = /\b(?:guten (?:morgen|tag|abend)|good (?:morning|afternoon|evening))\b/;
const LONE_GREETING = /^(?:morning|afternoon|evening|morgen|abend)$/;

/**
 * Every greeting in the message, so none of its words is read as a day or a time afterwards:
 * all of them at the start ("Hallo, guten Morgen!"), the two-word ones anywhere, and a first word
 * like "Morning!" when it is written as an exclamation.
 */
function readGreeting(scan: Scan): boolean {
  let greeted = false;
  while (scan.take(GREETING)) greeted = true;
  const first = scan.tokens.find(token => !token.used);
  if (first && LONE_GREETING.test(first.norm) && first.after.includes('!')) {
    greeted = Boolean(scan.take(atStart(first.norm))) || greeted;
  }
  while (scan.take(GREETING_ANYWHERE)) greeted = true;
  return greeted;
}

const YES_WORDS = 'yes|yep|yeah|yup|y|ja|jep|jawohl|confirm|confirmed|confirm it|confirm that|bestatigen|bestaetigen|bestatige|bestaetige|ok|okay|alright|all right|do it|go ahead|mach das|mach es|(?:das )?passt(?: so| gut)?|genau(?: so)?|sure|correct|right|exactly|richtig|stimmt|einverstanden|that\'s right|that is right|that\'s correct|that\'s fine|sounds good|looks good|das stimmt|das ist richtig|alles klar|in ordnung|klingt gut|gut so';
const YES_ONCE_OR_MORE = `(?:${YES_WORDS})(?:\\s+(?:${YES_WORDS}|please|bitte|gerne|gern))*`;
/** A yes and nothing else: one of the words above, also twice or with "please" ("yes please", "ok go ahead", "ja genau"). */
const YES = new RegExp(`^${YES_ONCE_OR_MORE}$`);
/** "Ok thanks", "Ja, danke": a yes while something waits for one, otherwise a thank-you. */
const YES_AND_THANKS = new RegExp(`^${YES_ONCE_OR_MORE}\\s+(?:thanks|thank you|thx|danke|vielen dank|merci)$`);
/** A yes in front of more words: "Yes, book it", "Ja, aber um 12". */
const YES_FIRST = atStart('yes|yep|yeah|yup|ja|jep|jawohl|ok|okay|alright|all right|sure|genau|einverstanden|go ahead|alles klar|in ordnung');
/**
 * "Yes, a new appointment", "Ok, noch einen Termin": the message announces something new, so its
 * yes is not about the request that is open.
 */
const STARTS_NEW = /\b(?:new|another|one more|a second|neu|neue|neuen|neuer|neues|weitere[nrs]?|zweite[nrs]?|noch\s+(?:ein|eine|einen))\b|\b(?:a|an|ein|eine|einen)\s+(?:appointment|booking|reservation|termin|buchung)\b/;

const EN_INSTRUCTION = '(?:book|schedule|reserve|cancel|delete|remove|close|reopen|open)';
const DE_IMPERATIVE = '(?:trag|trage|buch|buche|reserviere|storniere|losch|losche|loesch|loesche|streich|streiche|schliess|schliesse|sag|sage|mach|mache|offne|oeffne)';
const DE_INFINITIVE = '(?:eintragen|einbuchen|buchen|reservieren|absagen|stornieren|loschen|loeschen|streichen|schliessen|zumachen|offnen|oeffnen)';
const DE_THAT_ONE = '(?:(?:den|diesen)\\s+termin|(?:die|diese)\\s+buchung)';
const EN_FILL = '(?:please|then|now|just|so|and)';
const DE_FILL = '(?:bitte|dann|jetzt|einfach|so|und|also|mal|doch)';
/**
 * An instruction that points at the request that is already there instead of naming a new one.
 * Only these forms count, so that "New appointment" or a lone "Book" sent too early is never taken
 * for "book what you just proposed":
 * - the verb with "it" or "es" behind it, anywhere: "Book it", "Then book it at 12", "Trag es ein";
 * - the whole message is the verb with "that" or "the appointment": "Book that", "Cancel this appointment";
 * - in German the verb alone, which is how "Soll ich das so eintragen?" is answered: "Bitte eintragen".
 */
const POINTS_BACK = new RegExp([
  `\\b${EN_INSTRUCTION}\\s+(?:it|them)\\b`,
  `^(?:${EN_FILL}\\s+)*${EN_INSTRUCTION}\\s+(?:that|this|(?:that|this|the)\\s+(?:appointment|booking|one))(?:\\s+(?:in|again))?(?:\\s+${EN_FILL})*$`,
  `\\b${DE_IMPERATIVE}\\s+(?:es|ihn|sie)\\b`,
  // "Trag das am Freitag ein", but not "Schliess das Geschäft": "das" only where no noun follows.
  `\\b${DE_IMPERATIVE}\\s+das(?=$|\\s+(?:ein|ab|zu|so|bitte|am|um|auf|fur|fuer|bei|mit|morgen|heute|dann|jetzt|doch|lieber|stattdessen)\\b)`,
  `\\b(?:es|das|ihn|sie)\\s+(?:(?:so|bitte|dann|jetzt)\\s+)*${DE_INFINITIVE}\\b`,
  `^(?:${DE_FILL}\\s+)*(?:${DE_THAT_ONE}\\s+)?(?:(?:so|bitte|wieder)\\s+)*${DE_INFINITIVE}(?:\\s+${DE_FILL})*$`,
  `^(?:${DE_FILL}\\s+)*${DE_IMPERATIVE}(?:\\s+${DE_THAT_ONE})?(?:\\s+${DE_FILL})*\\s+(?:ein|ab|zu)(?:\\s+bitte)?$`,
].join('|'));
const EN_OBJECT = '(?:it|them|that|this|her|him|(?:the|that|this)\\s+(?:appointment|booking|one|salon|shop|day))';
const DE_OBJECT = '(?:es|das|ihn|sie|(?:(?:den|diesen)\\s+)?termin|(?:(?:die|diese)\\s+)?buchung|(?:den\\s+)?(?:salon|laden)|(?:den|diesen)\\s+tag)';
/**
 * The whole message is an instruction and nothing else (see Reading.direct): the verb, what it is
 * done to, and words like "please". The interpreter does not work out what a "not", an "I will" or
 * a "maybe" does to a sentence, so anything that is not of this shape is never a go-ahead.
 */
const DIRECT = new RegExp([
  `^(?:${EN_FILL}\\s+)*${EN_INSTRUCTION}(?:\\s+${EN_OBJECT})?(?:\\s+(?:in|again))?(?:\\s+${EN_FILL})*$`,
  `^(?:${DE_FILL}\\s+)*(?:${DE_OBJECT}\\s+)?(?:(?:so|bitte|wieder)\\s+)*${DE_INFINITIVE}(?:\\s+${DE_FILL})*$`,
  `^(?:${DE_FILL}\\s+)*${DE_IMPERATIVE}(?:\\s+${DE_OBJECT})?(?:\\s+(?:${DE_FILL}|wieder))*(?:\\s+(?:ein|ab|zu|auf))?(?:\\s+bitte)?$`,
].join('|'));
const NO = /^(?:no|nope|n|nein|ne|nee|stop|stopp|never ?mind|forget it|vergiss es|lieber nicht|doch nicht|not now)(?: thanks| thank you| danke)?$/;
/** "Cancel" answers an open proposal or question; with nothing open it starts a cancellation. */
const CANCEL_WORD = /^(?:cancel|abbrechen)$/;
const THANKS = /^(?:thanks|thank you|thx|cheers|danke|vielen dank|besten dank|merci|super|great|perfect|perfekt|toll)(?:\s+(?:a lot|very much|so much|you|dir|ihnen|vielmals|schon|schoen|sehr|danke|thanks))?$/;


/**
 * What the message asks for. `asksFrom` is where it turns into a question (0 for a question from
 * its first word, Infinity for none). `mentioned` is the change a question names without asking
 * for it ("Should I book Lea on Friday at 10?"): it is then answered with the facts about it.
 */
function readIntent(text: string, asksFrom: number, asking: boolean): { intent?: AssistantIntent; mentioned?: AssistantIntent } {
  // The change that is named first counts: "Book a haircut for Glenn Close" books, although the
  // family name is also a word for closing. Named at the same place, the more specific rule wins.
  const changes = CHANGE_RULES
    .map(rule => ({ intent: rule.intent, match: rule.verbs.exec(text) }))
    .filter((found): found is { intent: AssistantIntent; match: RegExpExecArray } =>
      found.match !== null && !(found.intent === 'book' && NOT_A_BOOKING.test(text)))
    .sort((a, b) => a.match.index - b.match.index);
  let mentioned: AssistantIntent | undefined;
  for (const { intent, match } of changes) {
    // "Don't book ...", "Bitte nicht absagen", "Trag Lea nicht ein": better to understand nothing
    // than the opposite of what was said.
    const wordBefore = text.slice(0, match.index).trim().split(' ').pop() ?? '';
    if (NEGATION.test(wordBefore) || NEGATION_INSIDE.test(match[0]) || /\bnicht$/.test(text)) return {};
    // "Is Lea booked on Tuesday?" asks something; "Can you book Lea?" asks for something to be done.
    if (match.index < asksFrom) return { intent };
    mentioned ??= intent;
  }
  const readOnly = (): AssistantIntent | undefined => {
    if (HELP.test(text)) return 'help';
    // "Who cancelled today?" is not a question about the agenda: the calendar keeps no cancellations.
    if (asking && ASKS_ABOUT_CANCELLING.test(text)) return undefined;
    // "Who booked the 10:00 slot?" is about the agenda, "Who is free?" about free times.
    if (/^(?:who|wer)\b/.test(text) && !/\b(?:free|available|frei|verfugbar)\b/.test(text)) return 'agenda';
    if (COUNTING.test(text)) return undefined;
    if (OPENING_HOURS.test(text)) return 'hours';
    // "When do we close on Friday?" asks about the salon's hours, not for a free time.
    if (asking && ASKS_ABOUT_HOURS.test(text) && !/\b(?:free|available|availability|openings|an opening|slots?|gaps?|anything|frei\w*|verfugbar|verfuegbar|platz|termin\w*|appointments?|bookings?)\b/.test(text)) return undefined;
    if (AVAILABILITY.test(text)) return 'availability';
    if (AGENDA.test(text)) return 'agenda';
    return undefined;
  };
  return { intent: readOnly(), mentioned };
}

// ---------- everything together ----------

/**
 * What a question is about: a detail offered with a question mark ("and on Friday?"), somebody's
 * appointments, whether somebody cancelled, the salon's hours, or something else.
 */
export type Asks = 'detail' | 'appointments' | 'cancelling' | 'hours' | 'other';

export interface Reading {
  request: AssistantRequest;
  /**
   * Words the interpreter could not place. "At 11 instead" has none; "Mia would like a cut at 11"
   * has some, so it is more than a detail added to the request before.
   */
  unread: string[];
  // How the message was put, where that limits what may be done with it. Each of these is left
  // out when it does not apply, so a plain request, detail or answer has none of them.
  /**
   * The message asks whether or when something is or was the case. Such a message is answered;
   * it never becomes a booking, a cancellation or a closure (see nextTask in conversation.ts).
   */
  asks?: Asks;
  /** A sentence of its own that the interpreter found no request in: not a detail for the request before. */
  sentence?: true;
  /** It says "not" or reports something ("has cancelled", "is booked"): never an answer or a correction. */
  denies?: true;
  /** It began with a yes: "Yes, book it", "Ja, aber um 12". */
  agrees?: true;
  /** Its instruction points at the request that is already there: "Book it", "Trag es ein", "Buch es um 12". */
  refers?: true;
  /**
   * Nothing but an instruction, said directly: "Book it", "Please close it", "Bitte eintragen". A
   * request put as a question ("Can you book it?"), a statement ("I will book it") or anything with
   * a "not", "maybe" or "later" in it is not direct. Only a direct message can stand for Confirm.
   */
  direct?: true;
  /** The id of the team member it names. A message about one of the team is not about closing the salon. */
  staff?: string;
}

export function read(message: string, context: InterpreterContext): Reading {
  const scan = new Scan(message);
  const language = detectLanguage(scan.tokens, context.language);
  const request: AssistantRequest = { language };
  const form: Pick<Reading, 'asks' | 'sentence' | 'denies' | 'agrees' | 'refers' | 'direct' | 'staff'> = {};
  const done = (result: AssistantRequest): Reading => ({
    request: result,
    unread: scan.tokens.filter(token => !token.used && !STOP_WORDS.has(token.norm)).map(token => token.raw),
    ...form,
  });
  if (scan.tokens.length === 0) return done(request);

  const questionMark = message.includes('?');
  const yesAndThanks = YES_AND_THANKS.test(scan.text);
  // "Ok?" asks, it does not agree: with a question mark a yes confirms nothing.
  const yes = (YES.test(scan.text) || (yesAndThanks && context.waiting === true)) && !questionMark;
  const no = NO.test(scan.text) || (CANCEL_WORD.test(scan.text) && context.waiting === true);
  if (yes || no || THANKS.test(scan.text) || yesAndThanks) {
    for (const token of scan.tokens) token.used = true;
    return done({ ...request, reply: yes ? 'yes' : no ? 'no' : 'thanks' });
  }

  // "Yes, book it": the yes is noted and the rest is read like any other message. Whether that
  // confirms an open proposal is decided where the proposal is known (conversation.ts).
  while (scan.take(YES_FIRST)) form.agrees = true;
  const greeting = readGreeting(scan);
  /** The yes and the greeting: taken off the front, they are not part of what the message says. */
  const opening = new Set(scan.tokens.filter(token => token.used));

  // Is it a question? Decided on the owner's own words, before any name is taken out of them.
  const lead = scan.unread.replace(/\u0001+/g, ' ').replace(/\s+/g, ' ').trim();
  /**
   * It opens like a question, as opposed to a detail that only ends with a question mark
   * ("Mia Keller?"). One word alone opens nothing: "Will" can be the answer to "Who is it for?".
   */
  const polite = isPoliteRequest(lead);
  const opensAsQuestion = lead.includes(' ') && !polite && (QUESTION_START.test(lead) || ASKS_TO_BE_TOLD.test(lead));
  let asking = opensAsQuestion || (!polite && (questionMark || QUESTION_TAG.test(lead)));

  // Names first: a customer called "April Sommer" must not become a date, and "Luca Frei" must
  // not be read as the German word for "free".
  const knownCustomer = readKnownCustomer(scan, context.customers);
  const namedStaff = readStaff(scan, context.employees);

  const surnames = familyNames(scan);
  const text = scan.tokens.map(token => (token.used || surnames.includes(token) ? '' : token.norm)).join(' ').replace(/\s+/g, ' ').trim();
  // A message that does not open as a question can still turn into one further on (see ASKS_BY_WORD_ORDER).
  const wordOrder = asking ? null : ASKS_BY_WORD_ORDER.exec(text);
  const condition = asking ? null : /\bif\b/.exec(text);
  const asksFrom = asking ? 0 : Math.min(wordOrder?.index ?? Infinity, condition?.index ?? Infinity);
  let { intent, mentioned } = readIntent(text, asksFrom, asking || wordOrder !== null);
  if (!asking && !isChange(intent) && (wordOrder || mentioned)) {
    asking = true;
    // "If" alone asks nothing ("at 11 if possible"); with a change named behind it, it does.
    if (!wordOrder) ({ intent, mentioned } = readIntent(text, asksFrom, true));
  }
  if (intent) request.intent = intent;
  else if (greeting && scan.tokens.every(token => token.used)) request.intent = 'help';
  if (form.agrees && STARTS_NEW.test(text)) delete form.agrees;
  if (isChange(intent)) {
    // The instruction with a mark where a name was taken out: "Trag Lea Brunner ein" is not "Trag ein".
    const shape = scan.tokens.filter(token => !opening.has(token))
      .map(token => (token.used || surnames.includes(token) ? '#' : token.norm)).join(' ');
    if (POINTS_BACK.test(shape)) form.refers = true;
    if (DIRECT.test(shape)) form.direct = true;
  }

  // "Is Lea Brunner booked on Tuesday?", "Hat Lea Brunner einen Termin?": a question that names a
  // customer and an appointment is about that customer's appointments, not about a free time.
  const mentions = ASKS_ABOUT_CANCELLING.test(text) ? 'cancelling'
    : ASKS_ABOUT_APPOINTMENTS.test(text) || mentioned === 'cancel' ? 'appointments'
    : undefined;
  const aboutSomebody = asking && mentions !== undefined && !COUNTING.test(lead) && !/^(?:who|whos|who's|whom|wer|wen|wem)\b/.test(lead) &&
    (!intent || intent === 'agenda' || (intent === 'availability' && !ASKS_FOR_A_TIME.test(text)));

  const days = readDays(scan, context.today, context.expecting);
  if (days.date) request.date = days.date;
  if (days.endDate) request.endDate = days.endDate;
  if (days.fromDate) request.fromDate = days.fromDate;
  const partOfDay = readPartOfDay(scan, days.morning);
  if (partOfDay) request.partOfDay = partOfDay;
  const time = readTime(scan, days.found, partOfDay, context.expecting);
  if (time) request.time = time;

  Object.assign(request, readService(scan, context.services));

  // "Book Selina ..." puts a first name where the customer goes, so there it is not the stylist.
  // The same holds while the assistant is waiting for the customer's name. In a closure a first
  // name is looked for too: "Close Friday, Selina is away" is about Selina.
  // A sentence that opens as a question is not that name either ("Is Selina off on Friday?").
  const answeringName = context.expecting === 'customerName' && !opensAsQuestion;
  const loneNameIsStaff = intent === 'availability' || intent === 'agenda' || intent === 'close' || intent === 'reopen' ||
    (!intent && !answeringName);
  const staff = namedStaff ?? (loneNameIsStaff ? readLoneStaff(scan, context.employees, asking) : undefined);
  if (staff) {
    request.employeeId = staff;
    form.staff = staff;
  }

  if (knownCustomer) {
    // "When can Lea Brunner come for a haircut?": kept, so a booking that follows needs no name.
    if (intent !== 'close' && intent !== 'reopen' && intent !== 'help') request.customerName = knownCustomer;
  } else {
    const nothingElse = !intent && !request.date && !request.time && !request.serviceId && !request.serviceOptions && !request.employeeId;
    const found = readNewName(scan, answeringName && nothingElse);
    // Without "book" or "cancel" a stray word is only a name when the assistant asked for one, or
    // when a word like "for" introduced it and no other question is open ("for Mia Keller instead"),
    // or in a question about somebody's appointments ("Is Esther Hug booked on Tuesday?").
    // Otherwise "Later", or an unknown service after "for", would become a customer.
    if (found && (intent === 'book' || intent === 'cancel' || aboutSomebody || (!intent && (answeringName || (found.cued && !context.expecting && !opensAsQuestion))))) {
      request.customerName = found.name;
      for (const token of found.tokens) token.used = true;
    }
  }

  // One person's time off is not a closure of the salon: "Selina is taking Friday off",
  // "Luca ist morgen krank", and any closure that names a team member.
  const closure = intent === 'close' || intent === 'reopen';
  // Looked for in what is left once names and days are read: Luca Frei's own name is no "hat frei".
  const leftOver = scan.tokens.filter(token => !token.used).map(token => token.norm).join(' ');
  const timeOff = TIME_OFF.test(leftOver) && (staff
    ? !intent || intent === 'agenda' || intent === 'availability'
    : !intent && SOMEBODY.test(lead));
  if (!request.customerName && ((closure && staff) || timeOff)) request.intent = 'absence';

  if (request.intent === 'agenda' && AGENDA_NEXT.test(scan.text) && !request.date) request.scope = 'next';

  // ---- how the message was put ----
  while (scan.take(DETAIL_PHRASE)) { /* words around a detail, not a sentence */ }
  const loose = scan.tokens.some(token => !token.used && SENTENCE_WORDS.has(token.norm));
  const hasDetail = Boolean(request.serviceId || request.serviceOptions?.length || request.employeeId || request.date ||
    request.fromDate || request.time || request.partOfDay || request.customerName);
  if (asking) {
    const aboutThePast = scan.tokens.some(token => !token.used && UNREAD_PAST.has(token.norm));
    if (aboutThePast && (!request.intent || aboutSomebody)) {
      delete request.intent;
      form.asks = 'other';
    } else if (request.customerName && aboutSomebody) {
      delete request.intent;
      form.asks = mentions;
    } else if (request.intent || COUNTING.test(lead)) {
      form.asks = 'other';
    } else if (mentions === 'cancelling') {
      form.asks = 'cancelling';
    } else if (ASKS_ABOUT_HOURS.test(text) || mentioned === 'close' || mentioned === 'reopen') {
      form.asks = 'hours';
    } else if (mentions === 'appointments') {
      form.asks = 'appointments';
    } else if (mentioned === 'book') {
      // "Should I book Lea on Friday at 10?": answered with whether that time is free.
      request.intent = 'availability';
      form.asks = 'other';
    } else {
      // "And on Friday?", "at 11?": nothing but a detail, offered with a question mark.
      const onlyDetails = hasDetail && !loose && scan.tokens.every(token => token.used || STOP_WORDS.has(token.norm));
      form.asks = onlyDetails ? 'detail' : 'other';
    }
  } else if (!request.intent) {
    if (scan.tokens.some(token => !token.used && DENIES_OR_REPORTS.has(token.norm))) form.denies = true;
    // The answer to the assistant's own question may be a whole sentence ("it is for Mia Keller").
    const expected = context.expecting;
    const answers = expected === 'service' ? Boolean(request.serviceId || request.serviceOptions?.length)
      : expected === 'date' ? Boolean(request.date || request.fromDate)
      : expected === 'time' ? Boolean(request.time || request.partOfDay)
      : expected === 'customerName' ? Boolean(request.customerName)
      : false;
    if (loose && !answers) form.sentence = true;
  }
  return done(request);
}

/** The request alone, for callers that do not need to know what was left unread. */
export const interpret = (message: string, context: InterpreterContext): AssistantRequest => read(message, context).request;
