import type { AppointmentRequest, CalendarEvent, Customer } from './types';
import { normalizePhone, phoneMatches, phoneProblem, samePhone } from './format';

// How a phone number is stored (+41791234567), shown (+41 79 123 45 67) and compared is decided
// in format.ts. The names stay available here, where the customer records are handled.
export { formatPhone, isPhoneNumber, normalizePhone } from './format';

/** The longest name a form takes. A longer one is refused with a message, never cut short. */
export const MAX_NAME_LENGTH = 120;

/**
 * Why a text cannot be a person's name, or null when it can: nothing was typed ('empty'), it
 * has fewer than two letters ('letters': "A", "12345", "!!!"), or it is longer than a form takes ('long').
 */
export function nameProblem(name: string): 'empty' | 'letters' | 'long' | null {
  const typed = name.trim();
  if (!typed) return 'empty';
  if ((typed.match(/\p{L}/gu) ?? []).length < 2) return 'letters';
  return [...typed].length > MAX_NAME_LENGTH ? 'long' : null;
}

/** What is wrong with a phone number, in a sentence that shows a right one. Null when it can be stored. */
export function phoneAdvice(phone: string): string | null {
  switch (phoneProblem(phone)) {
    case null: return null;
    case 'characters': return 'Use digits only, for example 079 123 45 67. Spaces, brackets, slashes and hyphens are fine.';
    case 'prefix': return 'Start with 0 or with a country code, for example 079 123 45 67 or +41 79 123 45 67.';
    case 'swiss': {
      const digits = normalizePhone(phone).length - '+41'.length;
      // Nine digits that are still refused start with a 0, which only stands in front of the national form.
      if (digits === 9) return 'After +41 the number goes on without a 0, for example +41 79 123 45 67.';
      return `This Swiss number is too ${digits < 9 ? 'short' : 'long'}: 9 digits follow the 0 or +41, for example 079 123 45 67.`;
    }
    case 'length': return 'With its country code a number has 7 to 15 digits.';
  }
}

/** Checks what a customer typed into the booking form. The message says what is wrong. */
export function validateContact(name: string, phone: string): string | null {
  const nameIssue = nameProblem(name);
  if (nameIssue === 'empty') return 'Please enter your full name.';
  if (nameIssue === 'letters') return 'Please enter your full name: a name has at least two letters.';
  if (nameIssue === 'long') return `This name is too long (${[...name.trim()].length} characters). Please shorten it to ${MAX_NAME_LENGTH} characters or fewer.`;
  if (!phone.trim()) return 'Please enter a phone number so the salon can contact you about your request.';
  const advice = phoneAdvice(phone);
  return advice ? `Please enter a valid phone number. ${advice}` : null;
}

/**
 * Whether a search text finds a customer: part of the name or of the e-mail address, or the
 * phone number in any spelling ("079 123", "+41 79 123" and "+4179123" find the same person).
 * The header search and the filter of the customer list both ask here.
 */
export function customerMatches(customer: Pick<Customer, 'name' | 'email' | 'phone'>, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return customer.name.toLowerCase().includes(term) || customer.email.toLowerCase().includes(term) || phoneMatches(customer.phone, term);
}

const initialsOf = (name: string): string =>
  name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

/**
 * A number the record already has is never rewritten, whatever spelling it was saved in; a new
 * one is stored in the international form. Screens show both the same way (formatPhone).
 */
const phoneFor = (existing: Customer | undefined, phone: string): string => {
  if (!phone) return existing?.phone ?? '';
  return existing && samePhone(existing.phone, phone) ? existing.phone : normalizePhone(phone);
};

/** Pending requests create a contact, never a fictitious completed booking. */
export function customerForRequest(customers: Customer[], request: AppointmentRequest): Customer {
  const phone = normalizePhone(request.customerPhone ?? '');
  const existing = customers.find((customer) => customer.id === request.customerId) ??
    // The same person may write the number differently each time: only its digits are compared.
    customers.find((customer) => samePhone(customer.phone, phone) &&
      customer.name.trim().toLowerCase() === request.customerName.trim().toLowerCase());
  return {
    ...existing,
    id: existing?.id ?? `cust-${request.id}`,
    name: request.customerName.trim(),
    initials: initialsOf(request.customerName),
    email: existing?.email ?? '',
    phone: phone ? phoneFor(existing, phone) : '',
    language: existing?.language ?? 'EN',
  };
}

/**
 * The name for a booking made in a chat. The AI asks for a first name only; where the chat's own
 * name is that first name plus more ("Ana" in the chat of "Ana Silva"), the fuller name is used.
 */
export const chatBookingName = (chatName: string, bookingName: string): string => {
  const given = bookingName.trim();
  const profile = chatName.trim().replace(/\s+/g, ' ');
  return profile.toLowerCase().startsWith(`${given.toLowerCase()} `) ? profile : given;
};

/** What a chat knows about the person who books in it. */
export interface ChatContact {
  language?: Customer['language'];
  channel?: Customer['channel'];
  conversationId?: string;
}

/**
 * The customer record for a confirmed appointment: the existing one where the appointment
 * points to it or the name (and phone) is unambiguous, otherwise a new one.
 * `chat` is given for a booking made in a chat: a new record then takes the chat's language
 * and remembers the chat, instead of a phone number the salon does not have.
 */
export function customerForAppointment(
  customers: Customer[], event: CalendarEvent, previousEvent?: CalendarEvent, chat?: ChatContact,
): { customer: Customer; previousCustomerId?: string } {
  const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
  const uniqueMatch = (name: string, phone = '') => {
    const matches = customers.filter(customer => nameKey(customer.name) === nameKey(name) &&
      (!phone || samePhone(customer.phone, phone)));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const previousCustomer = previousEvent?.customerId !== undefined
    ? customers.find(customer => customer.id === previousEvent.customerId)
    : previousEvent ? uniqueMatch(previousEvent.customerName, normalizePhone(previousEvent.customerPhone ?? '')) : undefined;
  const nameChanged = previousEvent !== undefined && nameKey(previousEvent.customerName) !== nameKey(event.customerName);
  // The editor retains appointment metadata. A different name must not inherit
  // the previous customer's ID or phone from that metadata.
  const phone = nameChanged ? '' : normalizePhone(event.customerPhone ?? '');
  const fromSameChat = chat?.conversationId
    ? customers.find(customer => customer.conversationId === chat.conversationId && nameKey(customer.name) === nameKey(event.customerName))
    : undefined;
  // A first name alone, without a phone ("Tom" from a website chat), says too little to
  // join the booking to the record of another Tom.
  const tooVague = chat !== undefined && !phone && !nameKey(event.customerName).includes(' ');
  const existing = nameChanged
    ? uniqueMatch(event.customerName)
    : customers.find(customer => customer.id === event.customerId && nameKey(customer.name) === nameKey(event.customerName))
      ?? fromSameChat
      ?? (tooVague ? undefined : uniqueMatch(event.customerName, phone));
  const channel = existing?.channel ?? chat?.channel;
  const conversationId = existing?.conversationId ?? chat?.conversationId;
  return {
    customer: {
      ...existing,
      id: existing?.id ?? `cust-${crypto.randomUUID()}`,
      name: event.customerName.trim(),
      initials: initialsOf(event.customerName),
      email: existing?.email ?? '',
      phone: phoneFor(existing, phone),
      language: existing?.language ?? chat?.language ?? 'EN',
      ...(channel ? { channel } : {}),
      ...(conversationId ? { conversationId } : {}),
    },
    previousCustomerId: previousCustomer?.id,
  };
}

export const upsertCustomer = (customers: Customer[], customer: Customer): Customer[] =>
  customers.some((item) => item.id === customer.id)
    ? customers.map((item) => item.id === customer.id ? customer : item)
    : [customer, ...customers];

/**
 * The number in a chat's header after its customer's record was edited. It follows the record
 * when the edit changed the number, also when the owner removed it. An edit that leaves the
 * number alone leaves the chat's own number alone too: a messenger chat can know a number that
 * the record does not have.
 */
export const chatPhoneAfterCustomerEdit = (chatPhone: string, before: Pick<Customer, 'phone'>, after: Pick<Customer, 'phone'>): string =>
  after.phone !== before.phone ? after.phone : chatPhone;
