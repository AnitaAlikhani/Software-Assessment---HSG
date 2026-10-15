import type { CalendarEvent, Conversation } from './types';
import { addDays } from './scheduling';

export function analyticsRangeError(from: string, to: string): string | null {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) return 'Choose valid dates, with the end on or after the start.';
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365) return 'Choose a date range of up to one year.';
  return null;
}

export function appointmentAnalytics(events: CalendarEvent[], from: string, to: string) {
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
  const dates: string[] = [];
  if (!error) for (let day = from; day <= to; day = addDays(day, 1)) dates.push(day);
  return {
    error, total: selected.length,
    customers: new Set(selected.map(customerKey)).size,
    aiBookings: selected.filter(event => event.isAiBooked).length,
    series: dates.map(date => ({ date, count: selected.filter(event => event.date === date).length })),
  };
}

export function conversationAnalytics(conversations: Conversation[]) {
  const messages = conversations.flatMap(conversation => conversation.messages);
  return {
    total: messages.length,
    customer: messages.filter(message => message.sender === 'customer').length,
    ai: messages.filter(message => message.sender === 'ai').length,
    owner: messages.filter(message => message.sender === 'owner').length,
    languages: (['EN', 'FR', 'DE', 'IT'] as const).map(language => ({
      language, count: conversations.filter(conversation => conversation.language === language).length,
    })),
  };
}
