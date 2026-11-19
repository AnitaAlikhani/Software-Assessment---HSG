import { validateCalendarEvent, type AvailabilityContext } from '../../availability';
import type { AssistantData, AssistantHandlers } from '../../assistant/execute';
import { createDemoWorkspace } from '../../demoWorkspace';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../../mockData';
import type { CalendarEvent, ClosedDate, Customer } from '../../types';

/**
 * The desk of a live call: the salon's calendar, team, services and customers that the answers
 * come from. It is a copy of the app's own starting data, made when the page opens and kept in
 * this page only: an appointment entered here appears nowhere else and is gone after a reload.
 *
 * Every appointment goes through validateCalendarEvent(), the same check the Calendar page runs.
 */

/** The customer the page's example call names, so that a call can be tried with a known customer. */
export const CALL_CUSTOMER: Customer = { id: 'cust-call-lea', name: 'Lea Brunner', initials: 'LB', email: '', phone: '', language: 'DE' };

export type DeskChange = { kind: 'added' | 'removed'; event: CalendarEvent };

export interface Desk {
  timeZone: string;
  /** The salon's data at this moment, in the form the booking rules and the assistant read. */
  data(now?: Date): AssistantData;
  /** The handlers a confirmed change runs through (see confirmProposal in the assistant). */
  handlers: AssistantHandlers;
  canUndo(): boolean;
  /** Takes back the newest change made on this page and returns it, or null when there is none. */
  undo(): DeskChange | null;
}

export function createDesk(
  clock: () => Date = () => new Date(),
  newId: () => string = () => `cal-${crypto.randomUUID()}`,
): Desk {
  const timeZone = initialCompanySettings.timeZone;
  const workspace = createDemoWorkspace(timeZone, clock());
  const customers = workspace.customers.some(customer => customer.name === CALL_CUSTOMER.name)
    ? workspace.customers
    : [CALL_CUSTOMER, ...workspace.customers];
  let events: CalendarEvent[] = workspace.events;
  let closedDates: ClosedDate[] = [];
  const changes: DeskChange[] = [];

  const context = (now: Date): AvailabilityContext => ({
    services: initialServices,
    employees: initialEmployees,
    bookingHours: initialBookingHours,
    shiftOverview: workspace.shifts,
    events,
    requests: workspace.requests,
    closedDates,
    absences: [],
    timeZone,
    now,
  });

  return {
    timeZone,
    data: (now = clock()) => ({ ...context(now), customers, now }),
    handlers: {
      addEvent(event) {
        const id = newId();
        const refusal = validateCalendarEvent(context(clock()), event, id);
        if (refusal) return refusal;
        const service = event.serviceId
          ? initialServices.find(item => item.id === event.serviceId)
          : initialServices.find(item => item.name === event.serviceName);
        const employee = event.employeeId
          ? initialEmployees.find(item => item.id === event.employeeId)
          : initialEmployees.find(item => item.name === event.staffName);
        const saved: CalendarEvent = {
          ...event,
          serviceId: event.serviceId ?? service?.id, serviceName: service?.name ?? event.serviceName,
          employeeId: event.employeeId ?? employee?.id, staffName: employee?.name ?? event.staffName,
          prepMinutes: service?.prepMinutes ?? 0, postMinutes: service?.postMinutes ?? 0,
          id,
        };
        events = [...events, saved];
        changes.push({ kind: 'added', event: saved });
        return null;
      },
      deleteEvent(id) {
        const event = events.find(item => item.id === id);
        if (!event) return;
        events = events.filter(item => item.id !== id);
        changes.push({ kind: 'removed', event });
      },
      // A call never closes the salon (see CALL_INTENTS); the handler exists because the assistant's rules ask for it.
      saveClosedDates(dates) { closedDates = dates; },
    },
    canUndo: () => changes.length > 0,
    undo() {
      const change = changes.pop();
      if (!change) return null;
      events = change.kind === 'added'
        ? events.filter(item => item.id !== change.event.id)
        : [...events, change.event];
      return change;
    },
  };
}
