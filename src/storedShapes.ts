/**
 * The shape every stored part of the salon must have before the app uses it (src/demoStore.ts).
 *
 * What the browser hands back was written by an earlier page load: by an older build, by a build
 * with a fault, or by somebody with the developer tools open. A value of the wrong kind would end
 * in a blank page (a date that is no date throws as soon as a day is added to it), so every part
 * is checked once when it is read.
 *
 * The checks follow src/types.ts: a field the type requires must be there and of its kind, a field
 * the type makes optional may be missing. A field the checks do not know is left alone, so a newer
 * build can add one without older data being refused.
 */

/** Where a value is wrong, in a few words ("requests[2].date is not a date"). Null when it has the right shape. */
export type ShapeProblem = string | null;
type Check = (value: unknown, at: string) => ShapeProblem;

const text: Check = (value, at) => typeof value === 'string' ? null : `${at} is not a text`;
const flag: Check = (value, at) => typeof value === 'boolean' ? null : `${at} is not yes or no`;
const amount: Check = (value, at) => typeof value === 'number' && Number.isFinite(value) ? null : `${at} is not a number`;
/** A calendar day as the app stores it, "2026-11-19". Day arithmetic throws on anything else. */
const day: Check = (value, at) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : `${at} is not a date`;
/** A time of day as the app stores it, "09:30". */
const clock: Check = (value, at) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? null : `${at} is not a time`;
/** A moment as the app stores it, "2026-11-19T08:30:00.000Z". Writing the salon's time for anything else throws. */
const moment: Check = (value, at) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? null : `${at} is not a moment in time`;
const oneOf = (...allowed: string[]): Check => (value, at) =>
  typeof value === 'string' && allowed.includes(value) ? null : `${at} is none of ${allowed.join(', ')}`;
/** A field the type marks with "?". JSON has no "undefined", so an empty one may also come back as null. */
const optional = (check: Check): Check => (value, at) => value === undefined || value === null ? null : check(value, at);
const orNothing = (check: Check): Check => (value, at) => value === null ? null : check(value, at);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A record with at least these fields. Fields that are not named here are not looked at. */
const record = (fields: Record<string, Check>): Check => (value, at) => {
  if (!isRecord(value)) return `${at} is not a record`;
  for (const [name, check] of Object.entries(fields)) {
    const problem = check(value[name], `${at}.${name}`);
    if (problem) return problem;
  }
  return null;
};
const listOf = (check: Check): Check => (value, at) => {
  if (!Array.isArray(value)) return `${at} is not a list`;
  for (let index = 0; index < value.length; index++) {
    const problem = check(value[index], `${at}[${index}]`);
    if (problem) return problem;
  }
  return null;
};
/** A record used as a table: any names, every value of one kind. */
const tableOf = (check: Check): Check => (value, at) => {
  if (!isRecord(value)) return `${at} is not a record`;
  for (const [name, item] of Object.entries(value)) {
    const problem = check(item, `${at}.${name}`);
    if (problem) return problem;
  }
  return null;
};

const request = record({
  id: text, customerName: text, serviceName: text, date: day, dateStr: text, timeStr: text, timeAgo: text,
  status: oneOf('pending', 'accepted', 'rejected', 'cancelled'),
  serviceId: optional(text), employeeId: optional(text), customerId: optional(text), customerPhone: optional(text),
  createdAt: optional(moment), staffName: optional(text), channel: optional(text), isAiBooked: optional(flag),
  // The time the customer asked for, while the request stands at a time the salon moved it to.
  movedFrom: optional(record({ date: day, timeStr: text })), cancelledBy: optional(text),
});

const appointment = record({
  id: text, customerName: text, serviceName: text, staffName: text, date: day, day: text, dateDisplay: text,
  startTime: clock, endTime: clock, colorTheme: text,
  serviceId: optional(text), employeeId: optional(text), customerId: optional(text), customerPhone: optional(text),
  conversationId: optional(text), createdAt: optional(moment), isAiBooked: optional(flag), outsideHoursApproved: optional(flag),
  // How a booking by hand came in ("phone", "walk-in", "other"). A word a later build adds is no
  // reason to refuse the calendar: whoever shows the source leaves out a word it does not know.
  source: optional(text),
  prepMinutes: optional(amount), postMinutes: optional(amount),
});

const customer = record({
  id: text, name: text, initials: text, email: text, phone: text, language: text,
  channel: optional(text), conversationId: optional(text), note: optional(text),
});

const employee = record({
  id: text, firstName: text, lastName: text, name: text, initials: text, email: text, phone: text,
  status: text, location: text, canBookOnline: flag, hidden: flag, role: optional(text),
  // The regular week, by weekday: the hours worked, or null for a day the person does not work.
  weeklyHours: optional(tableOf(orNothing(record({ start: clock, end: clock })))),
});

const service = record({
  id: text, name: text, durationMinutes: amount, priceCHF: amount, onlineBooking: flag, assignedEmployeesCount: amount,
  assignedEmployeeIds: optional(listOf(text)), category: optional(text), description: optional(text),
  prepMinutes: optional(amount), postMinutes: optional(amount),
});

const shiftEntry = record({
  employeeId: text, employeeName: text, initials: text, avatarColor: text,
  // By date: the hours worked that day, or null for a day off.
  shifts: tableOf(orNothing(record({ start: clock, end: clock, label: optional(text), type: optional(text) }))),
});

const timeBlock = record({
  id: text, employeeId: text, date: day, startTime: clock, endTime: clock,
  reason: oneOf('Break', 'Lunch', 'Private', 'Other'), note: optional(text),
});

const appointmentAction = record({
  type: oneOf('book', 'reschedule'), appointmentId: text, date: day, startTime: clock,
  serviceId: optional(text), employeeId: optional(text),
});
const chatMessage = record({
  id: text, sender: oneOf('customer', 'ai', 'owner'), original: text, translation: text, time: text,
  translationDe: optional(text), sentAt: optional(moment), untranslated: optional(flag),
});
const conversation = record({
  id: text, customerName: text, initials: text, avatarColor: text, language: text, phone: text, channel: text,
  status: text, lastTime: text, messages: listOf(chatMessage),
  customerId: optional(text), attentionReason: optional(text), takenOver: optional(flag), appointmentId: optional(text),
  lastMessageAt: optional(moment), live: optional(flag), languageLabel: optional(text),
  aiFollowUp: optional(record({ original: text, translation: text, translationDe: optional(text), appointmentAction: optional(appointmentAction) })),
  quickReplies: optional(listOf(record({ en: text, local: text, de: optional(text), appointmentAction: optional(appointmentAction) }))),
  bookingRequest: optional(record({ service: text, date: text, time: text, customerName: text, status: text, serviceId: optional(text) })),
});

const companySettings = record({
  companyName: text, street: text, postalCode: text, city: text, country: text, businessPhone: text, currency: text,
  timeZone: text, description: text, website: text, facebook: text, xProfile: text, instagram: text, legalNote: text,
  customTerms: flag, canton: optional(text), termsText: optional(text), logoDataUrl: optional(text),
});

const aiSettings = record({
  askBeforeSending: flag, translateChats: flag, ownerLanguage: text, answerLanguages: tableOf(flag), tone: text,
  handoverRules: listOf(record({ id: text, label: text, enabled: flag })),
});

/** An answer the owner gave on Home a moment ago (src/inbox.ts): to a request from the booking page or to one from a chat. */
const requestAnswer: Check = (value, at) => {
  if (!isRecord(value)) return `${at} is not a record`;
  return value.kind === 'chat'
    ? record({
        kind: text, id: text, at: amount, appointmentId: text, customerName: text, serviceName: text, staffName: text,
        date: day, startTime: clock, endTime: clock, delivery: oneOf('pending', 'done', 'failed'), problem: optional(text),
      })(value, at)
    : record({ kind: oneOf('request'), id: text, outcome: oneOf('accepted', 'moved', 'rejected'), at: amount, request, index: amount })(value, at);
};

const bookingDraft = record({
  // The date is empty while the customer has cleared the date field.
  serviceId: text, employeeId: text, date: text, startTime: text, name: text, phone: text,
  dateChosen: optional(flag), editingRequestId: optional(text),
});

/** One check per key of useDemoState. A key that is not listed is stored and read as it is. */
const SHAPES: Record<string, Check> = {
  requests: listOf(request),
  calendarEvents: listOf(appointment),
  customers: listOf(customer),
  employees: listOf(employee),
  services: listOf(service),
  shifts: listOf(shiftEntry),
  conversations: listOf(conversation),
  requestAnswers: listOf(requestAnswer),
  requestOutcomes: tableOf(oneOf('accepted', 'rejected')),
  absences: listOf(record({ id: text, employeeId: text, start: day, end: day, reason: optional(text) })),
  timeBlocks: listOf(timeBlock),
  closedDates: listOf(record({ id: text, name: text, start: day, end: day })),
  bookingHours: listOf(record({ day: text, isOpen: flag, from: clock, to: clock })),
  companySettings,
  aiSettings,
  draft: bookingDraft,
  submittedRequest: orNothing(request),
  conversationDrafts: tableOf(text),
};

/** What is wrong with a stored value of this key, or null when the app can use it. */
export const storedShapeProblem = (key: string, value: unknown): ShapeProblem => SHAPES[key]?.(value, key) ?? null;

/**
 * The parts that stand alone: the salon's profile, its opening hours, its closed dates and the
 * settings of the AI receptionist. Nothing else points at them by id, so one of them can fall
 * back to its starting value without the rest disagreeing with it.
 *
 * Every other part is linked to others by ids: a request names its customer, service and stylist,
 * an appointment its chat, a chat its appointment, a shift, an absence and a time block their employee. Those
 * parts are only ever used together (see readStoredSalon in src/demoStore.ts).
 */
export const STANDALONE_PARTS: ReadonlySet<string> = new Set(['companySettings', 'bookingHours', 'closedDates', 'aiSettings']);
