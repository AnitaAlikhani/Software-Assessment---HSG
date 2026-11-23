import { initialAiSettings } from '../src/conversationData.js';
import { timeZoneId, zonedDateTime } from '../src/format.js';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData.js';
import { storedShapeProblem } from '../src/storedShapes.js';
import type {
  AiAssistantSettings, BookingHoursDay, ClosedDate, CompanySettingsData, Employee, ServiceItem, ShiftEntry, StaffAbsence,
} from '../src/types.js';
import { loadConversationWith, loadForUpdateWith, readValues, saveSalonText, salonKey, type LoadedChat } from './store.js';
import type { LiveConversation } from './whatsappCore.js';

/**
 * The salon's settings on the server (delivery 3B): one record per data space, beside the chats,
 * `{ rev, updatedAt, parts }`. A part that is not in the record is the built-in salon
 * (src/mockData.ts and the app's own starting values); a salon nobody saved has no record at all.
 *
 * Everything on the server that needs the salon (the AI's instructions, the check of a booking
 * request, the fixed messages) takes "the salon as it is now" from salonFromRecord, never from
 * src/mockData.ts directly, so the owner's assistant never contradicts what she saved.
 */

/** The parts the record may hold, and nothing else (the bookings side stays in the browser for now). */
export const SALON_PARTS = ['companySettings', 'services', 'employees', 'bookingHours', 'closedDates', 'absences', 'shifts', 'aiSettings'] as const;
export type SalonPartName = typeof SALON_PARTS[number];

export interface Salon {
  companySettings: CompanySettingsData;
  services: ServiceItem[];
  employees: Employee[];
  bookingHours: BookingHoursDay[];
  closedDates: ClosedDate[];
  absences: StaffAbsence[];
  shifts: ShiftEntry[];
  aiSettings: AiAssistantSettings;
}

export interface SalonRecord {
  rev: number;
  updatedAt?: string;
  /** The parts that pass their checks: these are the salon as it is now. */
  parts: Partial<Salon>;
  /**
   * Parts that are stored but no longer pass their checks (written by an earlier version, or by
   * hand), as they are stored. Reading never deletes them: a save of other parts keeps them, and
   * only a save of the part itself replaces it. Until then the built-in part stands in for it.
   */
  kept?: Record<string, unknown>;
}

/**
 * Who customers can book: active, switched on for online booking, and shown. The same rule as the
 * app's (isBookableEmployee in src/availability.ts), for the AI's team and the booking check alike.
 */
export const isBookableStylist = (employee: Pick<Employee, 'status' | 'canBookOnline' | 'hidden'>): boolean =>
  employee.status === 'Active' && employee.canBookOnline === true && !employee.hidden;

/**
 * The salon the app starts with. Closed dates and absences start empty, as in the app. The app's
 * starting shifts are built for the current week in the browser (src/demoSeed.ts); nothing on the
 * server reads shifts, so here they start empty.
 */
export const BUILT_IN_SALON: Readonly<Salon> = Object.freeze({
  companySettings: initialCompanySettings,
  services: initialServices,
  employees: initialEmployees,
  bookingHours: initialBookingHours,
  closedDates: [],
  absences: [],
  shifts: [],
  aiSettings: initialAiSettings,
});

/** The salon as it is now: every part the record holds, over the built-in salon for the rest. */
export function salonFromRecord(record: SalonRecord | null): Salon {
  return { ...BUILT_IN_SALON, ...(record?.parts ?? {}) };
}

// ---------- checking a part ----------

/** How the owner's screens call each part, for the sentence that says what is wrong. */
const PART_LABELS: Record<SalonPartName, string> = {
  companySettings: 'Salon details',
  services: 'Services',
  employees: 'Team',
  bookingHours: 'Opening hours',
  closedDates: 'Closed dates',
  absences: 'Absences',
  shifts: 'Shifts',
  aiSettings: 'AI settings',
};

/** The most each list may hold. Far above what a small salon has; they keep one record small enough to read with every message. */
export const SALON_LIMITS = {
  services: 200,
  employees: 100,
  closedDates: 400,
  absences: 2000,
  /** One entry per person. */
  shifts: 100,
  /** Single days per person that differ from the regular week. */
  shiftDays: 1000,
  handoverRules: 50,
  /** A logo as the app stores it: a picture of at most 500 KB, written out as text. */
  logoCharacters: 700_000,
  /** The whole record as it is stored. */
  recordCharacters: 900_000,
} as const;

/** What is wrong, as the end of a sentence ("the price of service 3 must be ..."), or null. */
type Problem = string | null;
/** Checks a value; `what` names it in the sentence ("the price of service 3 (“Haircut”)"). */
type Check = (value: unknown, what: string) => Problem;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A text the owner wrote, short and on one line, to name an entry in a sentence. */
const quoted = (value: unknown) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text ? ` (“${text.length > 40 ? `${text.slice(0, 39)}…` : text}”)` : '';
};

const text = (max: number, { required = false } = {}): Check => (value, what) => {
  if (typeof value !== 'string') return `${what} is not a text`;
  if (required && !value.trim()) return `${what} is empty`;
  return value.length > max ? `${what} is longer than ${max} characters` : null;
};
const flag: Check = (value, what) => typeof value === 'boolean' ? null : `${what} must be yes or no`;
const whole = (min: number, max: number): Check => (value, what) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? null : `${what} must be a whole number from ${min} to ${max}`;
const amount = (min: number, max: number): Check => (value, what) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? null : `${what} must be a number from ${min} to ${max}`;
const oneOf = (...allowed: string[]): Check => (value, what) =>
  typeof value === 'string' && allowed.includes(value) ? null : `${what} must be one of ${allowed.join(', ')}`;

/** A calendar day that exists, "2026-12-24". A JavaScript date would quietly turn 31 November into 1 December. */
export const isDay = (value: unknown): boolean => {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const day: Check = (value, what) => isDay(value) ? null : `${what} is not a date (year-month-day)`;
const clock: Check = (value, what) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? null : `${what} is not a time of day (hours:minutes)`;
/** A time zone the time zone database knows. Settings saved earlier carry a suffix ("Europe/Zurich (GMT+01:00)"); the first word counts. */
const zone: Check = (value, what) => {
  const problem = text(80, { required: true })(value, what);
  if (problem) return problem;
  // timeZoneId gives the salon's default for a name that is no zone, so a zone is one it gives back unchanged.
  const id = (value as string).trim().split(/\s+/)[0];
  return timeZoneId(id) === id ? null : `${what} is not a time zone`;
};
/** A logo as the app stores it: a PNG, JPEG, WebP or GIF picture written out as a data address. */
/** The first bytes every file of a picture type starts with: a logo must be the picture it says it is. */
const PICTURE_STARTS: Record<string, (bytes: Buffer) => boolean> = {
  png: bytes => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpeg: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  webp: bytes => bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP',
  gif: bytes => /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('latin1')),
};
const logo: Check = (value, what) => {
  if (typeof value !== 'string') return `${what} is not a picture`;
  if (value.length > SALON_LIMITS.logoCharacters) return `${what} is too large: choose a picture smaller than 500 KB`;
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return `${what} is not a PNG, JPEG or WebP picture`;
  return PICTURE_STARTS[match[1]](Buffer.from(match[2].slice(0, 32), 'base64')) ? null : `${what} is not the ${match[1].toUpperCase()} picture it says it is`;
};

interface Field { label: string; check: Check; optional?: boolean }
const field = (label: string, check: Check): Field => ({ label, check });
/** A field the type marks with "?". JSON has no "undefined", so an empty one may also come as null. */
const maybe = (label: string, check: Check): Field => ({ label, check, optional: true });

/**
 * A record with exactly these fields: a required one must be there, and a field the salon does not
 * know is refused rather than stored unread. `owner` names the record in the sentence ("service 3").
 */
const fields = (spec: Record<string, Field>) => (value: unknown, owner: string): Problem => {
  if (!isRecord(value)) return `${owner || 'it'} is not a set of fields`;
  const of = (label: string) => owner ? `${label} of ${owner}` : label;
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(spec, name)) return `${owner || 'it'} has a field the salon does not know (“${name.slice(0, 40)}”)`;
  }
  for (const [name, { label, check, optional }] of Object.entries(spec)) {
    const item = value[name];
    if (item === undefined || item === null) {
      if (optional) continue;
      return `${of(label)} is missing`;
    }
    const problem = check(item, of(label));
    if (problem) return problem;
  }
  return null;
};

/**
 * A list of at most `max` entries, each checked by `item`. `name` names an entry in the sentence
 * ("service 3 (“Haircut”)"); `key` gives what must be unique (an id), with what it is called.
 */
const listOf = (
  max: number, noun: string, item: (value: unknown, owner: string) => Problem,
  { key, keyLabel = 'id', named = 'name' }: { key?: string; keyLabel?: string; named?: string } = {},
) => (value: unknown, what: string): Problem => {
  if (!Array.isArray(value)) return `${what} is not a list`;
  if (value.length > max) return `${what} has ${value.length} entries; at most ${max} can be saved`;
  const seen = new Map<string, number>();
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    const owner = `${noun} ${index + 1}${isRecord(entry) ? quoted(entry[named]) : ''}`;
    const problem = item(entry, owner);
    if (problem) return problem;
    if (key && isRecord(entry)) {
      const id = String(entry[key]);
      const first = seen.get(id);
      if (first !== undefined) return `${owner} has the same ${keyLabel} as ${noun} ${first + 1}`;
      seen.set(id, index);
    }
  }
  return null;
};

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Hours of one day: a start and, after it on the same day, an end. */
const hours = (value: unknown, what: string): Problem => {
  const problem = fields({ start: field('the start', clock), end: field('the end', clock) })(value, what);
  if (problem) return problem;
  const { start, end } = value as { start: string; end: string };
  return end > start ? null : `${what} must end after they start`;
};

const weeklyHours: Check = (value, what) => {
  if (!isRecord(value)) return `${what} is not a set of weekdays`;
  for (const [key, item] of Object.entries(value)) {
    if (!WEEKDAY_KEYS.includes(key)) return `${what} names a day that is no weekday (“${key.slice(0, 20)}”)`;
    if (item === null) continue;
    const problem = hours(item, `${what} on ${WEEKDAYS[WEEKDAY_KEYS.indexOf(key)]}`);
    if (problem) return problem;
  }
  return null;
};

const ID = text(80, { required: true });
const NAME = 120;

const companySettings = fields({
  companyName: field('the salon name', text(NAME, { required: true })),
  street: field('the street', text(200)),
  postalCode: field('the postcode', text(20)),
  city: field('the town', text(NAME)),
  canton: maybe('the canton', text(10)),
  country: field('the country', text(80)),
  businessPhone: field('the phone number', text(40)),
  currency: field('the currency', text(60)),
  timeZone: field('the time zone', zone),
  description: field('the description', text(2000)),
  website: field('the website', text(500)),
  facebook: field('the Facebook page', text(500)),
  xProfile: field('the X profile', text(500)),
  instagram: field('the Instagram profile', text(500)),
  legalNote: field('the legal notice', text(500)),
  customTerms: field('“own terms”', flag),
  termsText: maybe('the terms', text(20_000)),
  logoDataUrl: maybe('the logo', logo),
});

const serviceFields = fields({
  id: field('the id', ID),
  name: field('the name', text(NAME, { required: true })),
  durationMinutes: field('the duration in minutes', whole(1, 1439)),
  priceCHF: field('the price', amount(0, 100_000)),
  onlineBooking: field('“online booking”', flag),
  assignedEmployeesCount: field('the number of people', whole(0, SALON_LIMITS.employees)),
  assignedEmployeeIds: maybe('the people', (value, what) => {
    const problem = listOf(SALON_LIMITS.employees, 'person', ID)(value, what);
    if (problem) return problem;
    const ids = value as string[];
    const twice = ids.find((id, index) => ids.indexOf(id) !== index);
    // An id of a person who is not in the stored team is not refused: the parts are saved one by
    // one, so the team may follow in the next save. Where the ids are used, unknown ones count for nobody.
    return twice ? `${what} name the same person twice (“${twice.slice(0, 40)}”)` : null;
  }),
  category: maybe('the category', text(80)),
  description: maybe('the description', text(1000)),
  prepMinutes: maybe('the preparation time', whole(0, 1439)),
  postMinutes: maybe('the cleanup time', whole(0, 1439)),
});
const service = (value: unknown, owner: string): Problem => {
  const problem = serviceFields(value, owner);
  if (problem) return problem;
  const item = value as ServiceItem;
  return item.durationMinutes + (item.prepMinutes ?? 0) + (item.postMinutes ?? 0) > 1440
    ? `${owner} with its preparation and cleanup is longer than a day` : null;
};

const employee = fields({
  id: field('the id', ID),
  firstName: field('the first name', text(NAME, { required: true })),
  lastName: field('the last name', text(NAME)),
  name: field('the full name', text(2 * NAME + 1)),
  initials: field('the initials', text(8)),
  email: field('the email address', text(254)),
  phone: field('the phone number', text(40)),
  status: field('the status', oneOf('Active', 'Inactive')),
  location: field('the location', text(200)),
  canBookOnline: field('“bookable online”', flag),
  hidden: field('“hidden”', flag),
  role: maybe('the role', text(60)),
  weeklyHours: maybe('the regular hours', weeklyHours),
});

const bookingHours = (value: unknown, what: string): Problem => {
  if (!Array.isArray(value) || value.length !== 7) return `${what} must name each of the seven days of the week once`;
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const name = isRecord(entry) && typeof entry.day === 'string' ? entry.day : `day ${index + 1}`;
    const problem = fields({ day: field('the day', oneOf(...WEEKDAYS)), isOpen: field('“open”', flag), from: field('the opening time', clock), to: field('the closing time', clock) })(entry, name);
    if (problem) return problem;
    const item = entry as BookingHoursDay;
    if (seen.has(item.day)) return `${item.day} is listed twice`;
    seen.add(item.day);
    if (item.isOpen && item.to <= item.from) return `on ${item.day} the closing time must be after the opening time`;
  }
  return null;
};

/** A stretch of days, first and last included: the last may not lie before the first. */
const stretch = (spec: Record<string, Field>) => (value: unknown, owner: string): Problem => {
  const problem = fields(spec)(value, owner);
  if (problem) return problem;
  const { start, end } = value as { start: string; end: string };
  return end < start ? `${owner} ends before it starts` : null;
};
const closedDate = stretch({ id: field('the id', ID), name: field('the name', text(NAME)), start: field('the first day', day), end: field('the last day', day) });
const absence = stretch({ id: field('the id', ID), employeeId: field('the person', ID), start: field('the first day', day), end: field('the last day', day), reason: maybe('the reason', text(200)) });

const shiftDay = (value: unknown, what: string): Problem => {
  const problem = fields({ start: field('the start', clock), end: field('the end', clock), label: maybe('the label', text(80)), type: maybe('the kind', oneOf('shift', 'service')) })(value, what);
  if (problem) return problem;
  const { start, end } = value as { start: string; end: string };
  return end > start ? null : `${what} must end after they start`;
};
const shiftDays: Check = (value, what) => {
  if (!isRecord(value)) return `${what} is not a set of days`;
  const days = Object.entries(value);
  if (days.length > SALON_LIMITS.shiftDays) return `${what} has ${days.length} days; at most ${SALON_LIMITS.shiftDays} can be saved`;
  for (const [date, item] of days) {
    if (!isDay(date)) return `${what} names a day that is no date (“${date.slice(0, 20)}”)`;
    if (item === null) continue;
    const problem = shiftDay(item, `${what} on ${date}`);
    if (problem) return problem;
  }
  return null;
};
const shiftEntry = fields({
  employeeId: field('the person', ID),
  employeeName: field('the name', text(2 * NAME + 1)),
  initials: field('the initials', text(8)),
  avatarColor: field('the colour', text(120)),
  shifts: field('the days', shiftDays),
});

const aiSettings = fields({
  askBeforeSending: field('“ask before sending”', flag),
  translateChats: field('“translate chats”', flag),
  ownerLanguage: field('the owner’s language', text(40, { required: true })),
  answerLanguages: field('the answer languages', (value, what) => {
    if (!isRecord(value)) return `${what} is not a set of languages`;
    for (const [code, on] of Object.entries(value)) {
      if (!['EN', 'FR', 'DE', 'IT'].includes(code)) return `${what} names a language the AI does not offer (“${code.slice(0, 10)}”)`;
      const problem = flag(on, `${code} in ${what}`);
      if (problem) return problem;
    }
    const missing = ['EN', 'FR', 'DE', 'IT'].find(code => !Object.hasOwn(value, code));
    return missing ? `${what} must say for each of EN, FR, DE and IT whether it is on (${missing} is missing)` : null;
  }),
  tone: field('the tone', oneOf('friendly', 'formal')),
  handoverRules: field('the handover rules', listOf(SALON_LIMITS.handoverRules, 'handover rule',
    fields({ id: field('the id', ID), label: field('the text', text(200, { required: true })), enabled: field('“on”', flag) }), { key: 'id', named: 'label' })),
});

const PART_CHECKS: Record<SalonPartName, Check> = {
  companySettings: (value) => companySettings(value, ''),
  services: listOf(SALON_LIMITS.services, 'service', service, { key: 'id' }),
  employees: listOf(SALON_LIMITS.employees, 'person', employee, { key: 'id' }),
  bookingHours,
  closedDates: listOf(SALON_LIMITS.closedDates, 'closed date', closedDate, { key: 'id' }),
  absences: listOf(SALON_LIMITS.absences, 'absence', absence, { key: 'id', named: 'reason' }),
  shifts: listOf(SALON_LIMITS.shifts, 'person', shiftEntry, { key: 'employeeId', keyLabel: 'person', named: 'employeeName' }),
  aiSettings: (value) => aiSettings(value, ''),
};

const isPart = (name: string): name is SalonPartName => (SALON_PARTS as readonly string[]).includes(name);

/**
 * Why a part cannot be saved, as one sentence the owner can read that names the part and what
 * is wrong ("Services: the price of service 3 (“Haircut”) must be a number from 0 to 100000."),
 * or null when it can. The app's own check of stored data (src/storedShapes.ts) runs as well, so
 * nothing is saved that the app would refuse to read.
 */
export function salonPartProblem(name: string, value: unknown): string | null {
  if (!isPart(name)) return `“${name.slice(0, 40)}” is not a part of the salon's settings.`;
  const label = PART_LABELS[name];
  const problem = PART_CHECKS[name](value, 'the list');
  if (problem) return `${label}: ${problem}.`;
  const shape = storedShapeProblem(name, value);
  return shape ? `${label}: the app could not read it (${shape}).` : null;
}

/**
 * Reads a stored record. A part that is unknown, or no longer passes the checks (a record written
 * by an earlier version), is left out, so the built-in part stands in for it; this is written to
 * the log by its name only. Null when nothing is stored.
 */
export function readSalonRecord(value: unknown): SalonRecord | null {
  if (typeof value !== 'string') return null;
  let stored: unknown;
  try { stored = JSON.parse(value); } catch {
    console.error('The stored salon could not be read: the built-in salon is used.');
    // The revision still counts, so the next save goes over it instead of being refused for ever.
    return { rev: Number(/^\{"rev":(\d+),/.exec(value)?.[1] ?? 0), parts: {} };
  }
  const record = isRecord(stored) ? stored : {};
  const rev = typeof record.rev === 'number' && Number.isInteger(record.rev) && record.rev >= 0 ? record.rev : 0;
  const parts: Partial<Salon> = {};
  const kept: Record<string, unknown> = {};
  const given = isRecord(record.parts) ? record.parts : {};
  for (const [name, part] of Object.entries(given)) {
    if (isPart(name) && !salonPartProblem(name, part)) Object.assign(parts, { [name]: derived(name, part) });
    else {
      kept[name] = part;
      console.error(`The stored salon part "${name.slice(0, 40)}" could not be used: the built-in one stands in for it.`);
    }
  }
  return { rev, ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {}), parts, ...(Object.keys(kept).length ? { kept } : {}) };
}

/**
 * A part as it is used and saved: a field that only repeats what another one says is worked out
 * from that one, never taken as sent (a service's number of people is the length of its list).
 */
function derived<T>(name: SalonPartName, part: T): T {
  if (name !== 'services') return part;
  return (part as ServiceItem[]).map(item => ({ ...item, assignedEmployeesCount: item.assignedEmployeeIds?.length ?? 0 })) as T;
}

/** What a PUT asked for, or the sentence why it cannot be saved. */
export type SalonChange = { ok: true; baseRev: number; parts: Partial<Salon> } | { ok: false; error: string };

/** Reads and checks the body of a PUT: `{ baseRev, parts: { <name>: value, ... } }`. */
export function readSalonChange(body: unknown): SalonChange {
  if (!isRecord(body)) return { ok: false, error: 'The change could not be read. Reload the page and try again.' };
  const { baseRev, parts } = body;
  if (typeof baseRev !== 'number' || !Number.isInteger(baseRev) || baseRev < 0) {
    return { ok: false, error: 'The change does not say which version of the salon it was made on. Reload the page and try again.' };
  }
  if (!isRecord(parts) || Object.keys(parts).length === 0) return { ok: false, error: 'There is nothing to save: the change names no part of the salon.' };
  const checked: Partial<Salon> = {};
  for (const [name, value] of Object.entries(parts)) {
    const problem = salonPartProblem(name, value);
    if (problem) return { ok: false, error: problem };
    Object.assign(checked, { [name]: derived(name as SalonPartName, value) });
  }
  return { ok: true, baseRev, parts: checked };
}

// ---------- the storage ----------

/** The record as the routes answer it: `{ rev, updatedAt, parts }`, and `{ rev: 0, parts: {} }` when there is none. */
export const recordAnswer = (record: SalonRecord | null) => {
  if (!record) return { rev: 0, parts: {} };
  // The shared parts that are stored but cannot be used, so the app can tell the owner (they are not in `parts`).
  const unreadable = Object.keys(record.kept ?? {}).filter(isPart);
  return { rev: record.rev, ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}), parts: record.parts, ...(unreadable.length ? { unreadable } : {}) };
};

/** The record and, in the same command, one counter (the wrong-tries gate of server/limits.ts). */
export async function loadSalonRecordAnd(counterKey: string | null): Promise<{ record: SalonRecord | null; count: number }> {
  const [record, counter] = await readValues([salonKey(), ...(counterKey ? [counterKey] : [])]);
  return { record: readSalonRecord(record), count: Number(counter) || 0 };
}

/** The salon as it is now, in one command of its own. Where a chat is read anyway, use loadChatAndSalon. */
export async function loadSalon(): Promise<Salon> {
  return salonFromRecord((await loadSalonRecordAnd(null)).record);
}

/** A chat that is going to be changed (store.ts loadForUpdate) and the salon as it is now, in one command. */
export async function loadChatAndSalon(waId: string): Promise<{ loaded: LoadedChat; salon: Salon }> {
  const { loaded, other } = await loadForUpdateWith(waId, salonKey());
  return { loaded, salon: salonFromRecord(readSalonRecord(other)) };
}

/** A chat to read (store.ts loadConversation) and the salon as it is now, in one command. */
export async function loadConversationAndSalon(waId: string): Promise<{ conversation: LiveConversation | null; salon: Salon }> {
  const { conversation, other } = await loadConversationWith(waId, salonKey());
  return { conversation, salon: salonFromRecord(readSalonRecord(other)) };
}

export type SaveOutcome =
  | { status: 'saved'; rev: number; updatedAt: string }
  | { status: 'changed'; record: SalonRecord | null }
  | { status: 'too-large' };

/**
 * Saves the given parts over `current` (the record the request read), at the revision after it.
 * The storage saves only while that revision is still the one stored (store.ts
 * SALON_SAVE_SCRIPT), so of two saves made on the same revision exactly one wins and the other
 * gets the record as it is now.
 */
export async function saveSalonParts(current: SalonRecord | null, parts: Partial<Salon>, now = Date.now()): Promise<SaveOutcome> {
  const baseRev = current?.rev ?? 0;
  const rev = baseRev + 1;
  const updatedAt = new Date(now).toISOString();
  // The revision goes first: the storage reads it from the start of the text.
  // A stored part that cannot be read is kept as it is stored, unless this save replaces it.
  const text = JSON.stringify({ rev, updatedAt, parts: { ...(current?.kept ?? {}), ...(current?.parts ?? {}), ...parts } });
  if (text.length > SALON_LIMITS.recordCharacters) return { status: 'too-large' };
  const outcome = await saveSalonText(baseRev, text);
  return outcome.saved ? { status: 'saved', rev, updatedAt } : { status: 'changed', record: readSalonRecord(outcome.current) };
}

export type ResetOutcome = { status: 'reset'; rev: number; updatedAt?: string } | { status: 'busy' };
/** How often a reset is tried again when other saves keep coming in between. */
const RESET_TRIES = 5;

/**
 * Resets the salon to the built-in one, without letting its revision go back: the record is
 * stored with the next revision and no parts. A device that held an earlier revision must never
 * find its number again on a record it has not seen (a reset to 0 and one save would give 1 again).
 * The save goes through the same check on `rev` as any other; when another save came in between,
 * the record is read again and the reset tried again. Without a record there is nothing to reset:
 * revision 0, and nothing is written.
 */
export async function resetSalonRecord(now = Date.now()): Promise<ResetOutcome> {
  let [value] = await readValues([salonKey()]);
  for (let attempt = 1; attempt <= RESET_TRIES; attempt += 1) {
    const current = readSalonRecord(value);
    if (!current) return { status: 'reset', rev: 0 };
    const rev = current.rev + 1;
    const updatedAt = new Date(now).toISOString();
    const outcome = await saveSalonText(current.rev, JSON.stringify({ rev, updatedAt, parts: {} }));
    if (outcome.saved) return { status: 'reset', rev, updatedAt };
    value = outcome.current;
  }
  return { status: 'busy' };
}

// ---------- what a customer may see ----------

export interface SalonProfile {
  companyName: string;
  /** The salon's phone number as saved, empty when it has none. */
  phone: string;
  services: { name: string; durationMinutes: number; priceCHF: number }[];
  bookingHours: { day: string; isOpen: boolean; from: string; to: string }[];
  closedDates: { name: string; start: string; end: string }[];
  timeZone: string;
}

/**
 * What a customer's page may show, and nothing else (contract point 3): the salon's name and phone, the
 * services a customer may book (name, minutes, price), the opening hours, the closed dates that
 * have not ended, the time zone. Each field is copied by name, so nothing else of the record (a
 * person, an absence, the AI's settings, a field somebody added) can reach a customer.
 */
export function salonProfile(salon: Salon, now = new Date()): SalonProfile {
  const timeZone = timeZoneId(salon.companySettings.timeZone);
  const today = zonedDateTime(now, timeZone).date;
  return {
    companyName: salon.companySettings.companyName,
    phone: salon.companySettings.businessPhone.trim(),
    services: salon.services.filter(item => item.onlineBooking).map(({ name, durationMinutes, priceCHF }) => ({ name, durationMinutes, priceCHF })),
    bookingHours: salon.bookingHours.map(({ day: weekday, isOpen, from, to }) => ({ day: weekday, isOpen, from, to })),
    closedDates: salon.closedDates.filter(item => item.end >= today).map(({ name, start, end }) => ({ name, start, end })),
    timeZone,
  };
}
