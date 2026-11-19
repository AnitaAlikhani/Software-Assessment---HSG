import { salonTimeZone } from '../scheduling';
import type { Employee, ServiceItem } from '../types';
import { bookingHoursDay } from './dates';
import { MAX_ASSISTANT_MESSAGE, type AssistantLanguage, type AssistantQuestion } from './types';

/**
 * The second way to understand a message: the server route /api/assistant asks the AI model.
 * It is only used when the built-in interpreter could not make sense of a message and the owner
 * has live access. The route only reads the message; it never books anything and never sees the
 * customer list or the calendar.
 */
export function assistantQuestion(
  message: string,
  salon: {
    today: string;
    timeZone?: string;
    language: AssistantLanguage;
    services: Pick<ServiceItem, 'id' | 'name'>[];
    employees: Pick<Employee, 'id' | 'name' | 'status'>[];
  },
): AssistantQuestion {
  // Built field by field: nothing else from the app's data can slip into the request.
  return {
    message: message.trim().slice(0, MAX_ASSISTANT_MESSAGE),
    today: salon.today,
    weekday: bookingHoursDay(salon.today),
    timeZone: salonTimeZone(salon.timeZone),
    language: salon.language,
    services: salon.services.map(service => ({ id: service.id, name: service.name })),
    staff: salon.employees.filter(employee => employee.status === 'Active').map(employee => ({ id: employee.id, name: employee.name })),
  };
}

/** The owner waits for this answer, so it gives up well before the server's own time limit. */
const ROUTE_TIMEOUT_MS = 15_000;

/**
 * Sends the question to the route. Returns the route's raw answer, to be checked with
 * checkAssistantRequest() before use, or null when the route is missing, refuses or fails.
 */
export async function askAssistantRoute(
  question: AssistantQuestion,
  liveKey: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = ROUTE_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-live-key': liveKey },
      body: JSON.stringify(question),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { request?: unknown };
    return data.request ?? null;
  } catch {
    // No server (static hosting), no connection, or too slow: the assistant says it did not understand.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
