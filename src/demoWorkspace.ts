import { createDemoConversations } from './conversationData';
import { createDemoRequests } from './demoRequests';
import { createDemoCustomers, createDemoEvents, createDemoShifts } from './demoSeed';
import type { AppointmentRequest, CalendarEvent, Conversation, Customer, ShiftEntry } from './types';

export interface DemoWorkspace {
  events: CalendarEvent[];
  customers: Customer[];
  conversations: Conversation[];
  requests: AppointmentRequest[];
  shifts: ShiftEntry[];
}

/**
 * Everything in a new workspace that depends on the date, built for one moment so that the
 * parts agree: the customers are the people in the calendar and the chats, the requests fit
 * into the calendar, and the chats talk about appointments that exist.
 */
export const createDemoWorkspace = (timeZone?: string, now = new Date()): DemoWorkspace => {
  const events = createDemoEvents(timeZone, now);
  return {
    events,
    customers: createDemoCustomers(timeZone, now, events),
    conversations: createDemoConversations(timeZone, now),
    requests: createDemoRequests(timeZone, now, events),
    shifts: createDemoShifts(timeZone, now),
  };
};
