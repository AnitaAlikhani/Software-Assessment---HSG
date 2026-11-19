/**
 * The owner assistant: the shapes every part of it shares.
 *
 * One message from the owner becomes one AssistantRequest. The built-in interpreter builds it in
 * the browser (src/assistant/interpret.ts). Only when that fails, the server route /api/assistant
 * lets the AI model fill in the same shape. Either way the request only says what the owner asked
 * for. Whether a time is free is decided afterwards, by the booking rules in src/availability.ts.
 *
 * The server loads this file too, so it must not import anything from the browser app.
 */
export type AssistantLanguage = 'en' | 'de';

export const ASSISTANT_INTENTS = ['availability', 'book', 'cancel', 'close', 'reopen', 'agenda', 'appointments', 'hours', 'absence', 'help'] as const;
export type AssistantIntent = typeof ASSISTANT_INTENTS[number];

/**
 * The requests that change the calendar. Each of them is only ever proposed for the owner to
 * confirm, and none of them is ever the answer to a question (see nextTask in conversation.ts).
 * Every other intent only reads the salon's data.
 */
export const CHANGE_INTENTS = ['book', 'cancel', 'close', 'reopen'] as const;
export type ChangeIntent = typeof CHANGE_INTENTS[number];
export const isChange = (intent: AssistantIntent | undefined): intent is ChangeIntent =>
  (CHANGE_INTENTS as readonly string[]).includes(intent ?? '');

export const PARTS_OF_DAY = ['morning', 'afternoon', 'evening'] as const;
export type PartOfDay = typeof PARTS_OF_DAY[number];

/** The detail the assistant asks for next when a request is incomplete. */
export type AssistantSlot = 'service' | 'date' | 'time' | 'customerName';

/** Longest message the assistant reads. The input field and the server route use the same limit. */
export const MAX_ASSISTANT_MESSAGE = 300;
export const MAX_CUSTOMER_NAME = 60;

export interface AssistantRequest {
  /** Missing when the message only adds a detail to the request before it ("at 10", "Lea Brunner"). */
  intent?: AssistantIntent;
  /** Language of the message; the answer uses the same one. */
  language: AssistantLanguage;
  serviceId?: string;
  employeeId?: string;
  /** YYYY-MM-DD */
  date?: string;
  /** Last day of a closure that covers several days. */
  endDate?: string;
  /** "next week": no day yet, but the search for a free time starts here. */
  fromDate?: string;
  /** HH:MM, 24 hours */
  time?: string;
  partOfDay?: PartOfDay;
  customerName?: string;
  /** "Who is next?": only the next appointment instead of a whole day. */
  scope?: 'next';

  // The fields below are only ever set inside the browser (by the interpreter or by a choice the
  // owner taps). checkAssistantRequest() never accepts them from outside.
  /** Several services fit the words used ("cut"); the owner picks one. */
  serviceOptions?: string[];
  /** The appointment chosen from a list, for a cancellation. */
  appointmentId?: string;
  /** The customer record chosen from a list. */
  customerId?: string;
  /** The owner said this is a new customer, although a similar name exists. */
  newCustomer?: boolean;
  /** The question was whether somebody cancelled: the answer then says that cancellations are not kept. */
  cancellations?: boolean;
  /** "yes" / "no" typed as an answer to an open proposal, or a plain "thanks". */
  reply?: 'yes' | 'no' | 'thanks';
}

/**
 * Everything the browser sends to /api/assistant when the built-in interpreter did not understand
 * a message. Only what the model needs to read the message: no customers, no calendar.
 */
export interface AssistantQuestion {
  message: string;
  /** The salon's today, YYYY-MM-DD, and its English weekday name. */
  today: string;
  weekday: string;
  timeZone: string;
  language: AssistantLanguage;
  services: { id: string; name: string }[];
  staff: { id: string; name: string }[];
}

/** A request that names what to do. Only these reach the booking rules. */
export type AssistantTask = AssistantRequest & { intent: AssistantIntent };

export interface KnownIds {
  serviceIds: readonly string[];
  employeeIds: readonly string[];
}

/** A real calendar day written as YYYY-MM-DD (so not 2026-02-30). */
export const isRealDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const isClockTime = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Keeps what can be part of a person's name and drops everything else. */
export const cleanCustomerName = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const name = value.normalize('NFC').replace(/[^\p{L}\p{M}\s.'’-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CUSTOMER_NAME).trim();
  return /\p{L}/u.test(name) ? name : '';
};

const word = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const plainWords = (value: string): string[] =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Checks a request that did not come from our own interpreter (the model's answer) before
 * anything is done with it: only known fields, only ids the salon really has, only real dates and
 * times, and only a customer name the owner really wrote. Whatever does not pass is dropped.
 * Returns null when nothing usable is left.
 */
export function checkAssistantRequest(
  value: unknown,
  known: KnownIds,
  fallbackLanguage: AssistantLanguage = 'en',
  /** The owner's message. When given, a customer name must be made of words from it. */
  message?: string,
): AssistantRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const request: AssistantRequest = {
    language: raw.language === 'en' || raw.language === 'de' ? raw.language : fallbackLanguage,
  };

  const intent = word(raw.intent);
  if ((ASSISTANT_INTENTS as readonly string[]).includes(intent)) request.intent = intent as AssistantIntent;

  const serviceId = word(raw.serviceId);
  if (serviceId && known.serviceIds.includes(serviceId)) request.serviceId = serviceId;
  const employeeId = word(raw.employeeId);
  if (employeeId && known.employeeIds.includes(employeeId)) request.employeeId = employeeId;

  if (isRealDate(raw.date)) request.date = raw.date;
  if (isRealDate(raw.endDate) && request.date && raw.endDate > request.date) request.endDate = raw.endDate;
  if (isRealDate(raw.fromDate)) request.fromDate = raw.fromDate;
  if (isClockTime(raw.time)) request.time = raw.time;

  const partOfDay = word(raw.partOfDay);
  if ((PARTS_OF_DAY as readonly string[]).includes(partOfDay)) request.partOfDay = partOfDay as PartOfDay;
  if (raw.scope === 'next') request.scope = 'next';

  const customerName = cleanCustomerName(raw.customerName);
  const written = message === undefined ? null : plainWords(message);
  if (customerName && (!written || plainWords(customerName).every(part => written.includes(part)))) {
    request.customerName = customerName;
  }

  const hasDetail = Boolean(request.serviceId || request.employeeId || request.date || request.fromDate ||
    request.time || request.partOfDay || request.customerName);
  return request.intent || hasDetail ? request : null;
}
