import { customerForRequest, upsertCustomer, validateContact } from './bookingData';
import type { AppointmentRequest, Customer } from './types';

/**
 * A stopgap until the workspace is shared between tabs. The customers' booking page, opened in
 * another tab ("Open as customer"), keeps its own copy of the salon, so a request sent there
 * would never reach the owner's tab. This hands such a request over, and the changes the
 * customer makes to it while it waits.
 *
 * What it does not do: it reaches the tabs of this browser only, never another device, and it
 * carries nothing back. The customer's page does not learn the owner's answer, so it may still
 * offer "Edit request" for a request the owner has answered: such a late change is ignored here.
 */
export type BridgedRequest =
  | { kind: 'new' | 'updated'; request: AppointmentRequest }
  | { kind: 'cancelled'; id: string };

/** One channel per place the app is served from, so two builds under one address do not mix. */
const channelName = (path: string) => `slotbee-booking-requests:${path}`;
const openChannel = (path: string): BroadcastChannel | null =>
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName(path));

/** The customers' page tells the other tabs of this browser what happened to a request. */
export function announceRequest(message: BridgedRequest, path: string = window.location.pathname): void {
  const channel = openChannel(path);
  if (!channel) return;
  channel.postMessage(message);
  channel.close();
}

/** The owner's tab listens. Returns the function that stops listening. */
export function listenForRequests(handler: (message: BridgedRequest) => void, path: string = window.location.pathname): () => void {
  const channel = openChannel(path);
  if (!channel) return () => {};
  channel.onmessage = (event: MessageEvent) => {
    const message = readBridgedRequest(event.data);
    if (message) handler(message);
  };
  return () => channel.close();
}

const text = (value: unknown, longest = 200): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= longest ? value : null;
const optionalText = (value: unknown, longest = 200): string | undefined =>
  typeof value === 'string' && value.length <= longest && value.length > 0 ? value : undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The stored form of a time range, which the booking rules read: "10:00 - 10:30". */
const TIME_RANGE = /^([01]\d|2[0-3]):[0-5]\d - ([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A message from another tab is outside input. Nothing of it is taken over as it is: a request
 * is built again from the fields the app knows, each one checked, and everything else is
 * dropped. Null when the message is not a complete, waiting request (or a withdrawal).
 */
export function readBridgedRequest(value: unknown): BridgedRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const message = value as { kind?: unknown; id?: unknown; request?: unknown };
  if (message.kind === 'cancelled') {
    const id = text(message.id);
    return id ? { kind: 'cancelled', id } : null;
  }
  if (message.kind !== 'new' && message.kind !== 'updated') return null;
  if (typeof message.request !== 'object' || message.request === null) return null;
  const raw = message.request as Record<string, unknown>;
  const id = text(raw.id);
  const customerName = text(raw.customerName);
  const serviceName = text(raw.serviceName);
  const dateStr = text(raw.dateStr);
  const customerPhone = typeof raw.customerPhone === 'string' ? raw.customerPhone : '';
  if (!id || !customerName || !serviceName || !dateStr || raw.status !== 'pending') return null;
  if (typeof raw.date !== 'string' || !DATE.test(raw.date) || Number.isNaN(Date.parse(`${raw.date}T00:00:00Z`))) return null;
  if (typeof raw.timeStr !== 'string' || !TIME_RANGE.test(raw.timeStr)) return null;
  if (validateContact(customerName, customerPhone) !== null) return null;
  const createdAt = typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt)) ? new Date(raw.createdAt).toISOString() : undefined;
  const request: AppointmentRequest = {
    id,
    customerName,
    customerPhone: customerPhone || undefined,
    serviceId: optionalText(raw.serviceId, 64),
    serviceName,
    employeeId: optionalText(raw.employeeId, 64),
    staffName: optionalText(raw.staffName),
    date: raw.date,
    dateStr,
    timeStr: raw.timeStr,
    timeAgo: '',
    createdAt,
    // A request from the booking page: never one the AI took, whatever the message says.
    channel: 'Web',
    isAiBooked: false,
    status: 'pending',
  };
  return { kind: message.kind, request };
}

/** True when the message could be read (kept for callers that only want to know). */
export const isBridgedRequest = (value: unknown): boolean => readBridgedRequest(value) !== null;

interface OwnerLists { requests: AppointmentRequest[]; customers: Customer[] }

/**
 * What the owner's lists look like after a message, or null when nothing changes.
 *
 * - The customer is looked up in the owner's own list: the other tab's ids mean nothing here.
 * - A change or a withdrawal only counts for a request that still waits in this tab. Accepting
 *   or rejecting takes a request off the list, so a late change from the customer's page finds
 *   nothing to change and is dropped: it must never bring an answered request back as open.
 * - `answered` names the requests this tab has already handed over or answered, so a message
 *   that arrives twice, or a "new" for a request that was answered meanwhile, adds nothing.
 */
export function applyBridgedRequest(lists: OwnerLists, message: BridgedRequest, answered: (id: string) => boolean = () => false): OwnerLists | null {
  if (message.kind === 'cancelled') {
    const waiting = lists.requests.some((item) => item.id === message.id && item.status === 'pending');
    return waiting ? { ...lists, requests: lists.requests.filter((item) => item.id !== message.id) } : null;
  }
  const known = lists.requests.find((item) => item.id === message.request.id);
  if (message.kind === 'new' ? Boolean(known) || answered(message.request.id) : known?.status !== 'pending') return null;
  const customer = customerForRequest(lists.customers, { ...message.request, customerId: known?.customerId });
  const request: AppointmentRequest = {
    ...message.request,
    customerId: customer.id,
    customerPhone: customer.phone,
    createdAt: message.request.createdAt ?? known?.createdAt,
  };
  return {
    requests: known ? lists.requests.map((item) => item.id === request.id ? request : item) : [request, ...lists.requests],
    customers: upsertCustomer(lists.customers, customer),
  };
}
