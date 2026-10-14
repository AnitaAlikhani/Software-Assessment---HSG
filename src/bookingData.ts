import type { AppointmentRequest, Customer } from './types';

export const normalizePhone = (phone: string): string => {
  const compact = phone.trim().replace(/[\s().-]/g, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
};

export function validateContact(name: string, phone: string): string | null {
  if (!name.trim()) return 'Please enter your full name.';
  if (!phone.trim()) return 'Please enter a phone number so the salon can contact you about your request.';
  if (!/^\+?[0-9]{7,15}$/.test(normalizePhone(phone))) {
    return 'Please enter a valid phone number with 7 to 15 digits. You can include a country code, spaces, brackets or hyphens.';
  }
  return null;
}

/** Pending requests create a contact, never a fictitious completed booking. */
export function customerForRequest(customers: Customer[], request: AppointmentRequest): Customer {
  const phone = normalizePhone(request.customerPhone ?? '');
  const existing = customers.find((customer) => customer.id === request.customerId) ??
    customers.find((customer) => phone && normalizePhone(customer.phone) === phone &&
      customer.name.trim().toLowerCase() === request.customerName.trim().toLowerCase());
  return {
    id: existing?.id ?? `cust-${request.id}`,
    name: request.customerName.trim(),
    initials: request.customerName.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    email: existing?.email ?? '',
    phone,
    language: existing?.language ?? 'EN',
    lastBooking: existing?.lastBooking ?? 'No confirmed bookings',
    bookingsCount: existing?.bookingsCount ?? 0,
  };
}

export const upsertCustomer = (customers: Customer[], customer: Customer): Customer[] =>
  customers.some((item) => item.id === customer.id)
    ? customers.map((item) => item.id === customer.id ? customer : item)
    : [customer, ...customers];
