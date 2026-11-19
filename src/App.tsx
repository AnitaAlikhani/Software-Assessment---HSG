import React, { useEffect, useRef, useState } from 'react';
import {
  NavigationTab,
  AppointmentRequest,
  AppointmentAction,
  CalendarEvent,
  Customer,
  Employee,
  Resource,
  ServiceItem,
  CompanySettingsData,
  BookingHoursDay,
  ClosedDate,
  StaffAbsence,
  ShiftEntry,
  Conversation,
  AiAssistantSettings,
} from './types';
import { DEFAULT_DEMO_CONVERSATION_ID, initialAiSettings } from './conversationData';
import {
  initialEmployees,
  initialServices,
  initialResources,
  initialCompanySettings,
  initialBookingHours,
} from './mockData';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { HomeView } from './views/HomeView';
import { CalendarView } from './views/CalendarView';
import { ShiftPlanView } from './views/ShiftPlanView';
import { CustomersView } from './views/CustomersView';
import { ResourcesView } from './views/ResourcesView';
import { EmployeesView } from './views/EmployeesView';
import { ServicesView } from './views/ServicesView';
import { AnalyticsView } from './views/AnalyticsView';
import { SettingsView } from './views/SettingsView';
import { BookingPageView, BookingDraft, createBookingDraft } from './views/BookingPageView';
import { ConversationsView } from './views/ConversationsView';
import { AiAssistantView } from './views/AiAssistantView';
import { PilotInterest } from './components/PilotInterest';
import { AssistantPanel } from './components/AssistantPanel';
import { SalonTimeNote } from './components/SalonTimeNote';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { bookingPageHead, ownerPageHead, usePageHead } from './pageHead';
import { AppRoute, parseRoute, routeHash } from './navigation';
import { analyticsPeriods, analyticsReport, type Period } from './analytics';
import { downloadCsv } from './csv';
import { PRODUCT_NAME } from './brand';
import { mostRecentAiAppointment, nextUpcomingAppointment } from './dashboard';
import { addMinutes, formatDate } from './scheduling';
import { firstFreeEmployee, getSalonNow, isEmployeeAssignedToService, isOutsideOpeningHours, validateBookingRequest, validateCalendarEvent } from './availability';
import { appointmentForConversation, appointmentFromRequest, appointmentFromConversationAction, upsertAppointment } from './appointmentActions';

import { createDemoWorkspace, type DemoWorkspace } from './demoWorkspace';
import { createIncomingRequest } from './demoRequests';
import { useDemoState } from './useDemoState';
import { isLiveConversation, useLiveWhatsApp } from './liveWhatsApp';
import { chatBookingName, chatPhoneAfterCustomerEdit, customerForAppointment, customerForRequest, isPhoneNumber, upsertCustomer, validateContact, type ChatContact } from './bookingData';
import { deletionDependency } from './managementDependencies';
import { headerAccount } from './headerModels';

// The starting data that depend on the date (calendar, customers, chats, requests, shifts) are
// built together, for one moment, so that they agree. Only a tab with nothing stored needs them.
let startingWorkspace: DemoWorkspace | null = null;
const startingData = (): DemoWorkspace => (startingWorkspace ??= createDemoWorkspace());

export default function App() {
  const [publicMode, setPublicMode] = useState(new URLSearchParams(window.location.search).get('booking') === '1');
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.hash));
  const currentTab = route.tab;
  const mainRef = useRef<HTMLElement>(null);
  const focusMainHeading = () => {
    if (document.querySelector('dialog[open]')) return;
    const heading = mainRef.current?.querySelector<HTMLElement>('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    else mainRef.current?.focus({ preventScroll: true });
  };
  const navigate = (next: AppRoute, options: { replace?: boolean } = {}) => {
    const hash = routeHash(next);
    if (window.location.hash !== hash) {
      // Closing an overlay replaces the entry so the phone's Back gesture does not re-open it.
      if (options.replace) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
      else window.location.hash = hash;
    } else {
      // The target is the page already shown (search result, notification, account menu): still give focus feedback.
      requestAnimationFrame(focusMainHeading);
    }
    setRoute(next);
  };
  const setCurrentTab = (tab: NavigationTab) => navigate({ tab });
  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  // Only a change of page resets the scroll position and moves focus to its heading.
  // Selecting a record inside a page (request, customer, appointment, conversation) keeps the
  // user's scroll position; on phones that selection is often several screens down.
  useEffect(() => {
    // A directly opened phone conversation manages its own heading and scroll position.
    if (route.tab === 'conversations' && route.conversationId && window.matchMedia('(max-width: 767px)').matches && mainRef.current?.querySelector('#conversation-thread')) return;
    window.scrollTo({ top: 0, left: 0 });
    const frame = requestAnimationFrame(focusMainHeading);
    return () => cancelAnimationFrame(frame);
  }, [route.tab]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPilotInterestOpen, setIsPilotInterestOpen] = useState(false);
  useEffect(() => {
    // A Back/Forward gesture changes the page behind an open drawer or dialog; close them.
    setIsMobileMenuOpen(false);
    setIsPilotInterestOpen(false);
  }, [route.tab, route.requestId, route.customerId, route.appointmentId, route.conversationId]);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' | 'info'; action?: { label: string; onClick: () => void } } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const [rejectedRequests, setRejectedRequests] = useState<{ request: AppointmentRequest; index: number }[]>([]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    const refreshClock = () => { if (!document.hidden) setNow(new Date()); };
    document.addEventListener('visibilitychange', refreshClock);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refreshClock); };
  }, []);

  // Core application states
  const [requests, setRequests] = useDemoState<AppointmentRequest[]>('requests', () => startingData().requests);
  const [calendarEvents, setCalendarEvents] = useDemoState<CalendarEvent[]>('calendarEvents', () => startingData().events);
  const [customers, setCustomers] = useDemoState<Customer[]>('customers', () => startingData().customers);
  const [employees, setEmployees] = useDemoState<Employee[]>('employees', initialEmployees);
  const [services, setServices] = useDemoState<ServiceItem[]>('services', initialServices);
  const [resources, setResources] = useDemoState<Resource[]>('resources', initialResources);
  const [shiftOverview, setShiftOverview] = useDemoState<ShiftEntry[]>('shifts', () => startingData().shifts);
  const [companySettings, setCompanySettings] = useDemoState<CompanySettingsData>('companySettings', initialCompanySettings);
  const [calendarDate, setCalendarDate] = useState(() => getSalonNow(companySettings.timeZone).date);
  const [bookingHours, setBookingHours] = useDemoState<BookingHoursDay[]>('bookingHours', initialBookingHours);
  const [conversations, setConversations] = useDemoState<Conversation[]>('conversations', () => startingData().conversations);
  // Real WhatsApp chats from the test number (only with a "?live=KEY" link); shown above the demo chats.
  // The public booking page is a customer's page: it never asks the server for them.
  const live = useLiveWhatsApp(!publicMode);
  const allConversations = [...live.conversations, ...conversations];
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(DEFAULT_DEMO_CONVERSATION_ID);
  const [aiSettings, setAiSettings] = useDemoState<AiAssistantSettings>('aiSettings', initialAiSettings);

  // Freeze legacy booking buffers before service edits can change their reservation.
  useEffect(() => {
    setCalendarEvents(previous => {
      if (previous.every(event => event.prepMinutes !== undefined && event.postMinutes !== undefined)) return previous;
      return previous.map(event => {
        const service = event.serviceId ? services.find(item => item.id === event.serviceId) : services.find(item => item.name === event.serviceName);
        return { ...event, prepMinutes: event.prepMinutes ?? service?.prepMinutes ?? 0, postMinutes: event.postMinutes ?? service?.postMinutes ?? 0 };
      });
    });
  }, [services, setCalendarEvents]);

  const [closedDates, setClosedDates] = useDemoState<ClosedDate[]>('closedDates', []);
  const [absences, setAbsences] = useDemoState<StaffAbsence[]>('absences', []);
  const [bookingDraft, setBookingDraft] = useDemoState<BookingDraft>('draft', () => createBookingDraft(services, companySettings.timeZone));
  const [submittedRequest, setSubmittedRequest] = useDemoState<AppointmentRequest | null>('submittedRequest', null);
  const availabilityContext = { services, employees, bookingHours, shiftOverview, events: calendarEvents, requests, closedDates, absences, timeZone: companySettings.timeZone };

  const needsAttention = allConversations.filter((c) => c.status === 'needs-attention');
  const latestAiBookedEvent = mostRecentAiAppointment(calendarEvents);
  const nextAppointment = nextUpcomingAppointment(calendarEvents, now, companySettings.timeZone.split(' ')[0]);
  const openAppointment = (event: CalendarEvent) => {
    setCalendarDate(event.date);
    setSearchQuery('');
    navigate({ tab: 'calendar', appointmentId: event.id });
  };
  const selectedCalendarEvent = calendarEvents.find(event => event.id === route.appointmentId);
  useEffect(() => {
    if (selectedCalendarEvent) setCalendarDate(selectedCalendarEvent.date);
  }, [route.appointmentId, selectedCalendarEvent?.date]);

  const showToast = (message: string, kind: 'success' | 'error' | 'info' = 'success', action?: { label: string; onClick: () => void }) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, kind, action });
    // Action toasts stay longer, but never forever: on phones the toast covers the next controls.
    toastTimer.current = setTimeout(() => setToast(null), action ? 10000 : kind === 'error' ? 7000 : 4000);
  };

  const commitCalendarEvent = (event: CalendarEvent, chat?: ChatContact) => {
    const previousEvent = calendarEvents.find(item => item.id === event.id);
    const { customer } = customerForAppointment(customers, event, previousEvent, chat);
    const saved = {
      ...event, customerId: customer.id, customerPhone: customer.phone,
      createdAt: previousEvent?.createdAt ?? event.createdAt ?? new Date().toISOString(),
    };
    // Only the contact is stored. Visits and last appointments are counted from the calendar.
    setCustomers(previous => upsertCustomer(previous, customer));
    setCalendarEvents(previous => upsertAppointment(previous, saved));
    setCalendarDate(saved.date);
    setSubmittedRequest(previous => previous && `cal-${previous.id}` === saved.id ? {
      ...previous, customerId: saved.customerId, customerName: saved.customerName, customerPhone: saved.customerPhone,
      date: saved.date, dateStr: formatDate(saved.date), timeStr: `${saved.startTime} - ${saved.endTime}`,
      serviceId: saved.serviceId, serviceName: saved.serviceName, employeeId: saved.employeeId, staffName: saved.staffName,
    } : previous);
    return saved;
  };

  // Home request actions
  const handleAcceptRequest = (id: string) => {
    const accepted = requests.find((r) => r.id === id);
    if (!accepted) return;
    const availabilityError = validateBookingRequest(availabilityContext, accepted, accepted.id);
    if (availabilityError) {
      showToast(availabilityError, 'error');
      return;
    }

    const newCalEvent = appointmentFromRequest(accepted, services, employees);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    setSubmittedRequest((previous) => previous?.id === id ? { ...accepted, status: 'accepted' } : previous);
    commitCalendarEvent(newCalEvent);
    if (route.requestId === id) navigate({ tab: 'home' });

    showToast(`Accepted appointment for ${accepted.customerName}`, 'success', { label: 'View appointment', onClick: () => { openAppointment(newCalEvent); setToast(null); } });
  };

  const handleRejectRequest = (id: string) => {
    const index = requests.findIndex(request => request.id === id);
    if (index < 0) return;
    const request = requests[index];
    setRejectedRequests(previous => [...previous, { request, index }]);
    setRequests(previous => previous.filter(item => item.id !== id));
    setSubmittedRequest((previous) => previous?.id === id ? { ...previous, status: 'rejected' } : previous);
    if (route.requestId === id) navigate({ tab: 'home' });
    showToast(`Declined request from ${request.customerName}`, 'info');
  };

  const undoReject = () => {
    const rejected = rejectedRequests.at(-1);
    if (!rejected) return;
    const error = validateBookingRequest(availabilityContext, rejected.request);
    if (error) { showToast(`Cannot restore this request: ${error}`, 'error'); return; }
    setRequests(previous => {
      const restored = [...previous];
      restored.splice(Math.min(rejected.index, restored.length), 0, rejected.request);
      return restored;
    });
    setRejectedRequests(previous => previous.slice(0, -1));
    setSubmittedRequest(previous => previous?.id === rejected.request.id ? { ...rejected.request, status: 'pending' } : previous);
    navigate({ tab: 'home', requestId: rejected.request.id });
    showToast(`Restored request from ${rejected.request.customerName}`);
  };

  const handleMoveRequest = (id: string, date: string, startTime: string): string | null => {
    const request = requests.find(item => item.id === id);
    if (!request) return 'This request is no longer available.';
    const service = request.serviceId
      ? services.find(item => item.id === request.serviceId)
      : services.find(item => item.name === request.serviceName);
    if (!service) return 'This service is no longer available.';
    const updatedRequest = { ...request, date, dateStr: formatDate(date), timeStr: `${startTime} - ${addMinutes(startTime, service.durationMinutes)}` };
    const error = validateBookingRequest(availabilityContext, updatedRequest, id);
    if (error) return error;
    setRequests(previous => previous.map(item => item.id === id ? updatedRequest : item));
    setSubmittedRequest((previous) => previous?.id === id ? updatedRequest : previous);
    showToast('Appointment request rescheduled');
    return null;
  };

  const handleNewBookingRequest = (request: AppointmentRequest): string | null => {
    const error = validateContact(request.customerName, request.customerPhone ?? '') ?? validateBookingRequest(availabilityContext, request);
    if (error) return error;
    if (requests.some((item) => item.id === request.id)) return 'This request has already been submitted.';
    const customer = customerForRequest(customers, request);
    const saved = { ...request, customerId: customer.id, customerPhone: customer.phone, isAiBooked: false, createdAt: request.createdAt ?? new Date().toISOString() };
    setRequests((previous) => [saved, ...previous]);
    setCustomers((previous) => upsertCustomer(previous, customer));
    showToast(`Booking request saved for ${request.customerName}`);
    return null;
  };

  const handleUpdateBookingRequest = (request: AppointmentRequest): string | null => {
    const existing = requests.find((item) => item.id === request.id && item.status === 'pending');
    if (!existing) return 'This request is no longer pending. Check its latest status before making changes.';
    const error = validateContact(request.customerName, request.customerPhone ?? '') ?? validateBookingRequest(availabilityContext, request, request.id);
    if (error) return error;
    const customer = customerForRequest(customers, { ...request, customerId: existing.customerId });
    const saved = { ...request, customerId: customer.id, customerPhone: customer.phone, isAiBooked: false, createdAt: request.createdAt ?? existing.createdAt };
    setRequests((previous) => previous.map((item) => item.id === saved.id ? saved : item));
    setCustomers((previous) => upsertCustomer(previous, customer));
    setSubmittedRequest(saved);
    showToast('Booking request updated');
    return null;
  };

  const handleCancelBookingRequest = (id: string): string | null => {
    if (!requests.some((item) => item.id === id && item.status === 'pending')) return 'This request is no longer pending.';
    setRequests((previous) => previous.filter((item) => item.id !== id));
    setSubmittedRequest((previous) => previous?.id === id ? { ...previous, status: 'cancelled' } : previous);
    showToast('Booking request cancelled. The slot is available again.');
    return null;
  };

  const handleViewRequest = (id: string) => {
    setPublicMode(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('booking');
    window.history.replaceState(null, '', url);
    const appointment = calendarEvents.find((event) => event.id === `cal-${id}`);
    if (appointment) {
      openAppointment(appointment);
    } else {
      navigate({ tab: 'home', requestId: id });
    }
  };

  // Home's "New appointment" ends in the appointment form, which lives inside the Calendar page:
  // the page is opened with the wish to start adding, and takes it once (see CalendarView).
  // Where no appointment can be added yet, the owner lands on the Calendar, which says why.
  const [startNewAppointment, setStartNewAppointment] = useState(false);

  // Study tool (shown with the research switch only): a made-up request from the booking page,
  // so a study session has a fresh request to accept or decline.
  const handleSimulateNewRequest = () => {
    // The request is built like the starting data: one of the salon's own services that can be
    // booked online, the first free time from tomorrow on, and an invented person with a number
    // of their own. Whoever has a record or a pending request already is never used again.
    const known = [...customers, ...requests.map((item) => ({ id: item.customerId ?? '', name: item.customerName }))];
    const request = createIncomingRequest(availabilityContext, known, `req-${Date.now()}`);
    if (!request) {
      showToast('No request could be simulated: no service is bookable online, no time is free in the next 90 days, or every sample person is a customer already.', 'info');
      return;
    }
    const error = handleNewBookingRequest(request);
    if (error) showToast(error, 'error');
  };

  // "Export CSV" on Home (the current month) and in Analytics (the period chosen there) write
  // the same report: the figures on screen and the appointments they are counted from.
  const handleExportReport = (period?: Period) => {
    const clock = getSalonNow(companySettings.timeZone, now);
    const report = analyticsReport({
      companyName: companySettings.companyName,
      events: calendarEvents,
      period: period ?? analyticsPeriods(clock.date).month,
      clock,
      fallbackName: PRODUCT_NAME.toLowerCase(),
    });
    if (!report) { showToast('Choose a valid date range before exporting.', 'error'); return; }
    downloadCsv(report.fileName, report.rows);
    showToast(`Exported ${report.fileName}`);
  };

  // Calendar
  const storeCalendarEvent = (ev: Omit<CalendarEvent, 'id'>, id: string, chat?: ChatContact): { error: string } | { saved: CalendarEvent } => {
    const validationError = validateCalendarEvent(availabilityContext, ev, id);
    if (validationError) return { error: validationError };
    const service = ev.serviceId ? services.find(item => item.id === ev.serviceId) : services.find(item => item.name === ev.serviceName);
    const employee = ev.employeeId ? employees.find(item => item.id === ev.employeeId) : employees.find(item => item.name === ev.staffName);
    const newEv: CalendarEvent = {
      ...ev,
      serviceId: ev.serviceId ?? service?.id, serviceName: service?.name ?? ev.serviceName,
      employeeId: ev.employeeId ?? employee?.id, staffName: employee?.name ?? ev.staffName,
      prepMinutes: service?.prepMinutes ?? 0, postMinutes: service?.postMinutes ?? 0,
      id,
    };
    return { saved: commitCalendarEvent(newEv, chat) };
  };
  const saveCalendarEvent = (ev: Omit<CalendarEvent, 'id'>, id: string): string | null => {
    const result = storeCalendarEvent(ev, id);
    return 'error' in result ? result.error : null;
  };
  const handleAddCalendarEvent = (ev: Omit<CalendarEvent, 'id'>): string | null => {
    const error = saveCalendarEvent(ev, `cal-${crypto.randomUUID()}`);
    if (!error) showToast(`Appointment added for ${ev.customerName}`);
    return error;
  };
  const handleUpdateCalendarEvent = (id: string, ev: Omit<CalendarEvent, 'id'>): string | null => {
    if (!calendarEvents.some(event => event.id === id)) return 'This appointment no longer exists.';
    const error = saveCalendarEvent(ev, id);
    if (!error) showToast(`Appointment updated for ${ev.customerName}`);
    return error;
  };

  const handleDeleteCalendarEvent = (id: string) => {
    setCalendarEvents(calendarEvents.filter((e) => e.id !== id));
    setSubmittedRequest((previous) => previous && `cal-${previous.id}` === id ? { ...previous, status: 'cancelled' } : previous);
    showToast('Appointment removed from calendar');
  };

  // Shift Plan
  const handleUpdateShift = (employeeId: string, date: string, shift: { start: string; end: string } | null) => {
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee || (shift && shift.end <= shift.start)) return;
    setShiftOverview((prev) => {
      if (!prev.some((item) => item.employeeId === employeeId)) {
        return [...prev, {
          employeeId,
          employeeName: employee.name,
          initials: employee.initials,
          avatarColor: 'bg-indigo-100 text-indigo-700',
          shifts: { [date]: shift },
        }];
      }
      return prev.map((item) => item.employeeId === employeeId
        ? { ...item, shifts: { ...item.shifts, [date]: shift } }
        : item);
    });
    showToast(shift ? `Shift saved for ${employee.name}` : `${employee.name} is unavailable on ${formatDate(date, { weekday: 'long' })}`);
  };

  // Customers
  const handleAddCustomer = (
    cust: Omit<Customer, 'id' | 'initials'>
  ) => {
    const initials = cust.name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    const newCustomer: Customer = {
      ...cust,
      id: `cust-${Date.now()}`,
      initials: initials || 'CU',
    };
    setCustomers([newCustomer, ...customers]);
    showToast(`Customer ${cust.name} added`);
  };

  // Deleting is a single tap on touch screens, so every delete offers an Undo instead of a confirm dialog.
  const restoreAt = <T extends { id: string }>(list: T[], item: T, index: number) =>
    list.some((entry) => entry.id === item.id) ? list : [...list.slice(0, index), item, ...list.slice(index)];

  const handleDeleteCustomer = (id: string) => {
    const index = customers.findIndex((c) => c.id === id);
    if (index < 0) return;
    const removed = customers[index];
    const error = deletionDependency('customer', id, removed.name, calendarEvents, requests);
    if (error) { showToast(error, 'error'); return; }
    setCustomers((previous) => previous.filter((c) => c.id !== id));
    showToast(`Customer ${removed.name} deleted`, 'info', { label: 'Undo', onClick: () => { setCustomers((previous) => restoreAt(previous, removed, index)); setToast(null); } });
  };

  const handleUpdateCustomer = (id: string, partial: Partial<Customer>) => {
    const customer = customers.find(item => item.id === id);
    if (!customer) return;
    const updated = { ...customer, ...partial, id };
    updated.initials = updated.name.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    setCustomers(previous => previous.map(item => item.id === id ? updated : item));
    const rename = <T extends AppointmentRequest | CalendarEvent>(item: T): T =>
      item.customerId === id || (!item.customerId && item.customerName === customer.name) ? { ...item, customerId: id, customerName: updated.name, customerPhone: updated.phone } : item;
    setRequests(previous => previous.map(rename));
    setCalendarEvents(previous => previous.map(rename));
    setSubmittedRequest(previous => previous ? rename(previous) : previous);
    // The chat belongs to the same person: its header follows the record.
    setConversations(previous => previous.map(item => item.customerId === id
      ? { ...item, customerName: updated.name, initials: updated.initials, phone: chatPhoneAfterCustomerEdit(item.phone, customer, updated) } : item));
    showToast('Customer updated');
  };

  // Resources
  const handleAddResource = (res: Omit<Resource, 'id'>) => {
    const newRes: Resource = {
      ...res,
      id: `res-${Date.now()}`,
    };
    setResources([...resources, newRes]);
    showToast(`Resource ${res.name} created`);
  };

  const handleDeleteResource = (id: string) => {
    const index = resources.findIndex((r) => r.id === id);
    if (index < 0) return;
    const removed = resources[index];
    setResources((previous) => previous.filter((r) => r.id !== id));
    showToast(`Resource ${removed.name} removed`, 'info', { label: 'Undo', onClick: () => { setResources((previous) => restoreAt(previous, removed, index)); setToast(null); } });
  };

  const handleUpdateResource = (id: string, partial: Partial<Resource>) => {
    setResources(previous => previous.map(item => item.id === id ? { ...item, ...partial, id } : item));
    showToast('Resource updated');
  };

  // Employees
  const handleAddEmployee = (
    emp: Omit<Employee, 'id' | 'initials' | 'name'>
  ) => {
    const fullName = `${emp.firstName} ${emp.lastName}`.trim();
    const initials = `${emp.firstName[0] || ''}${emp.lastName[0] || ''}`.toUpperCase();
    const newEmployee: Employee = {
      ...emp,
      id: `emp-${Date.now()}`,
      name: fullName,
      initials: initials || 'EM',
    };
    setEmployees([...employees, newEmployee]);
    showToast(`Employee ${fullName} added`);
  };

  const handleDeleteEmployee = (id: string) => {
    const index = employees.findIndex((e) => e.id === id);
    if (index < 0) return;
    const removed = employees[index];
    const error = deletionDependency('employee', id, removed.name, calendarEvents, requests);
    if (error) { showToast(error, 'error'); return; }
    const removedShifts = shiftOverview.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.employeeId === id);
    const removedAbsences = absences.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.employeeId === id);
    const serviceAssignments = new Map(services.filter(service => service.assignedEmployeeIds?.includes(id))
      .map(service => [service.id, service.assignedEmployeeIds!.indexOf(id)]));
    setEmployees((previous) => previous.filter((e) => e.id !== id));
    setShiftOverview(previous => previous.filter(item => item.employeeId !== id));
    setAbsences(previous => previous.filter(item => item.employeeId !== id));
    setServices(previous => previous.map(service => {
      const assignedEmployeeIds = service.assignedEmployeeIds?.filter(employeeId => employeeId !== id);
      return { ...service, assignedEmployeeIds, assignedEmployeesCount: assignedEmployeeIds?.length ?? 0 };
    }));
    showToast(`Employee ${removed.name} deleted`, 'info', { label: 'Undo', onClick: () => {
      setEmployees(previous => restoreAt(previous, removed, index));
      setShiftOverview(previous => removedShifts.reduce((restored, { entry, index }) =>
        restored.some(item => item.employeeId === entry.employeeId) ? restored : [...restored.slice(0, index), entry, ...restored.slice(index)], previous));
      setAbsences(previous => removedAbsences.reduce((restored, { entry, index }) => restoreAt(restored, entry, index), previous));
      setServices(previous => previous.map(service => {
        const assignmentIndex = serviceAssignments.get(service.id);
        if (assignmentIndex === undefined || service.assignedEmployeeIds?.includes(id)) return service;
        const assignedEmployeeIds = [...(service.assignedEmployeeIds ?? [])];
        assignedEmployeeIds.splice(assignmentIndex, 0, id);
        return { ...service, assignedEmployeeIds, assignedEmployeesCount: assignedEmployeeIds.length };
      }));
      setToast(null);
    } });
  };

  const handleUpdateEmployee = (id: string, partial: Partial<Employee>) => {
    const employee = employees.find(item => item.id === id);
    if (!employee) return;
    const updated = { ...employee, ...partial, id };
    updated.name = `${updated.firstName} ${updated.lastName}`.trim();
    updated.initials = `${updated.firstName[0] ?? ''}${updated.lastName[0] ?? ''}`.toUpperCase();
    setEmployees(previous => previous.map(item => item.id === id ? updated : item));
    setShiftOverview(previous => previous.map(item => item.employeeId === id ? { ...item, employeeName: updated.name, initials: updated.initials } : item));
    const rename = <T extends AppointmentRequest | CalendarEvent>(item: T): T =>
      item.employeeId === id || (!item.employeeId && item.staffName === employee.name) ? { ...item, employeeId: id, staffName: updated.name } : item;
    setRequests(previous => previous.map(rename));
    setCalendarEvents(previous => previous.map(rename));
    setSubmittedRequest(previous => previous ? rename(previous) : previous);
    showToast('Employee updated');
  };

  // Services
  const handleAddService = (srv: Omit<ServiceItem, 'id'>) => {
    const newService: ServiceItem = {
      ...srv,
      id: `srv-${Date.now()}`,
    };
    setServices([...services, newService]);
    showToast(`Service ${srv.name} created`);
  };

  const handleUpdateService = (id: string, partial: Partial<ServiceItem>) => {
    const service = services.find(item => item.id === id);
    if (!service) return;
    setCalendarEvents(previous => previous.map(event => event.serviceId === id || (!event.serviceId && event.serviceName === service.name) ? {
      ...event, serviceId: id, serviceName: partial.name ?? service.name,
      prepMinutes: event.prepMinutes ?? service.prepMinutes ?? 0,
      postMinutes: event.postMinutes ?? service.postMinutes ?? 0,
    } : event));
    setRequests(previous => previous.map(request => request.serviceId === id || (!request.serviceId && request.serviceName === service.name)
      ? { ...request, serviceId: id, serviceName: partial.name ?? service.name } : request));
    setSubmittedRequest(previous => previous && (previous.serviceId === id || (!previous.serviceId && previous.serviceName === service.name))
      ? { ...previous, serviceId: id, serviceName: partial.name ?? service.name } : previous);
    setServices(
      services.map((s) => (s.id === id ? { ...s, ...partial } : s))
    );
    showToast('Service updated');
  };

  const handleDeleteService = (id: string) => {
    const index = services.findIndex((s) => s.id === id);
    if (index < 0) return;
    const removed = services[index];
    const error = deletionDependency('service', id, removed.name, calendarEvents, requests);
    if (error) { showToast(error, 'error'); return; }
    setServices((previous) => previous.filter((s) => s.id !== id));
    showToast(`Service ${removed.name} deleted`, 'info', { label: 'Undo', onClick: () => { setServices((previous) => restoreAt(previous, removed, index)); setToast(null); } });
  };

  // Settings
  const handleSaveSettings = (
    settings: CompanySettingsData,
    hours: BookingHoursDay[]
  ) => {
    setCompanySettings(settings);
    setBookingHours(hours);
    showToast('Company settings successfully saved');
  };

  // Conversations
  const openConversation = (id?: string) => {
    const target = id
      ? allConversations.find((c) => c.id === id)
      : allConversations.find((c) => c.status === 'needs-attention') ?? allConversations[0];
    if (target) setSelectedConversationId(target.id);
    navigate({ tab: 'conversations', conversationId: target?.id });
  };

  // Chats and customers are linked by id, in both directions: a sample chat names its customer,
  // and a customer created from a live chat remembers that chat. Names are never compared.
  const conversationOfCustomer = (customer: Customer) => allConversations.find((c) =>
    c.customerId === customer.id || (customer.conversationId !== undefined && c.id === customer.conversationId));
  const customersWithChat = new Set(customers.filter(conversationOfCustomer).map((customer) => customer.id));
  /** The chat an appointment was booked or changed in, if it still exists. */
  const conversationOfAppointment = (event: CalendarEvent) => allConversations.find((c) =>
    (event.conversationId !== undefined && c.id === event.conversationId) || c.appointmentId === event.id) ?? null;

  const openChatForCustomer = (customerId: string) => {
    const customer = customers.find((item) => item.id === customerId);
    const conv = customer && conversationOfCustomer(customer);
    if (!conv) {
      showToast(`No conversation with ${customer?.name ?? 'this customer'} yet`, 'info');
      return;
    }
    openConversation(conv.id);
  };

  const handleTakeOver = (id: string) => {
    if (isLiveConversation(id)) {
      void live.takeOver(id).then(error => showToast(error ?? 'You took over this chat. The AI is paused.', error ? 'error' : 'success'));
      return;
    }
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, takenOver: true } : c))
    );
    showToast('You took over this conversation. The AI is paused.');
  };

  const applyConversationAppointment = (conversation: Conversation, action: AppointmentAction, fromAi: boolean): { error: string } | { saved: CalendarEvent } => {
    const appointment = appointmentFromConversationAction(action, conversation, calendarEvents, services, employees, fromAi);
    if (!appointment) {
      return { error: 'This appointment could not be updated. Check the calendar and service before confirming.' };
    }
    return storeCalendarEvent({
      ...appointment,
      // A time outside opening hours is the owner's decision, taken by sending this reply. The AI never books one.
      outsideHoursApproved: !fromAi && isOutsideOpeningHours(bookingHours, appointment.date, appointment.startTime, appointment.endTime),
      customerId: appointment.customerId ?? conversation.customerId,
      // A chat shows a masked number or none at all. Only a real number goes into the records.
      customerPhone: isPhoneNumber(conversation.phone) ? conversation.phone : appointment.customerPhone,
      conversationId: conversation.id,
    }, appointment.id, { language: conversation.language, channel: conversation.channel, conversationId: conversation.id });
  };

  /** A live chat's booking request: add it to the calendar (with the usual checks), then tell the customer. */
  const handleConfirmLiveBooking = (id: string) => {
    const conversation = allConversations.find((item) => item.id === id);
    const request = conversation?.bookingRequest;
    if (!conversation || !request || request.status !== 'requested') return;
    // The server sends the service's id. A chat stored before it did names the service only.
    const service = request.serviceId !== undefined
      ? services.find((item) => item.id === request.serviceId)
      : services.find((item) => item.name.toLowerCase() === request.service.trim().toLowerCase());
    if (!service) { showToast(`"${request.service}" is no longer one of your services. Reply to the customer or add the appointment in the calendar.`, 'error'); return; }
    const appointmentId = `live-appt-${id}-${request.date}-${request.time.replace(':', '')}`;
    // The customer asked for no particular stylist: take the first one who offers the service and is
    // free at that time. If nobody is, the booking is checked for the first who offers it, which gives the reason.
    const stylist = firstFreeEmployee(availabilityContext, service.id, request.date, request.time, appointmentId)
      ?? employees.find((item) => item.status === 'Active' && isEmployeeAssignedToService(service, item));
    if (!stylist) { showToast(`No active employee offers ${service.name}. Assign someone in Services first.`, 'error'); return; }
    const action: AppointmentAction = {
      type: 'book',
      appointmentId,
      date: request.date,
      startTime: request.time,
      serviceId: service.id,
      employeeId: stylist.id,
    };
    const result = applyConversationAppointment({ ...conversation, customerName: chatBookingName(conversation.customerName, request.customerName) }, action, true);
    if ('error' in result) { showToast(result.error, 'error'); return; }
    void live.confirmBooking(id).then((sendError) => showToast(
      sendError ? `Added to the calendar, but the confirmation was not sent: ${sendError}` : `Booked: ${service.name}, ${request.time} with ${stylist.name}. The customer got the confirmation.`,
      sendError ? 'error' : 'success',
    ));
  };

  const handleLetAiContinue = (id: string): string | null => {
    if (isLiveConversation(id)) {
      void live.letAiContinue(id).then(error => showToast(error ?? 'The AI answers new messages in this chat again.', error ? 'error' : 'success'));
      return null;
    }
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return 'This conversation no longer exists.';
    const followUp = conversation.aiFollowUp;
    if (followUp && !aiSettings.answerLanguages[conversation.language]) {
      const error = 'Enable this customer’s language on the AI receptionist page, or take over and reply yourself.';
      showToast(error, 'error');
      return error;
    }
    const action = followUp?.appointmentAction;
    const result = action ? applyConversationAppointment(conversation, action, true) : null;
    if (result && 'error' in result) { showToast(result.error, 'error'); return result.error; }

    const sentAt = new Date();
    const sentLabel = getSalonNow(companySettings.timeZone, sentAt).time;
    setConversations((prev) => prev.map((c) => c.id !== id ? c : {
      ...c,
      takenOver: false,
      status: action || c.appointmentId ? 'booked' : 'ai-handled',
      appointmentId: action?.appointmentId ?? c.appointmentId,
      customerId: result?.saved.customerId ?? c.customerId,
      aiFollowUp: undefined,
      messages: followUp ? [...c.messages, {
        id: `msg-${Date.now()}`,
        sender: 'ai' as const,
        original: followUp.original,
        translation: followUp.translation,
        ...(followUp.translationDe ? { translationDe: followUp.translationDe } : {}),
        time: sentLabel,
        sentAt: sentAt.toISOString(),
      }] : c.messages,
      lastTime: followUp ? sentLabel : c.lastTime,
      lastMessageAt: followUp ? sentAt.toISOString() : c.lastMessageAt,
    }));
    showToast('The AI is continuing this conversation');
    return null;
  };

  const handleOwnerReply = (id: string, english: string, local?: string, action?: AppointmentAction) => {
    if (isLiveConversation(id)) {
      void live.reply(id, english).then(error => error && showToast(error, 'error'));
      return true;
    }
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return false;
    const result = action ? applyConversationAppointment(conversation, action, false) : null;
    if (result && 'error' in result) { showToast(result.error, 'error'); return false; }

    const sentAt = new Date();
    const sentLabel = getSalonNow(companySettings.timeZone, sentAt).time;
    // A suggested reply brings its German text along; a typed one has none.
    const german = local ? conversation.quickReplies?.find((reply) => reply.en === english && reply.local === local)?.de : undefined;
    setConversations((prev) => prev.map((c) => c.id !== id ? c : {
      ...c,
      takenOver: true,
      status: 'owner-handled' as const,
      appointmentId: action?.appointmentId ?? c.appointmentId,
      customerId: result?.saved.customerId ?? c.customerId,
      // The scripted follow-up predates this reply and may now contradict the owner.
      aiFollowUp: undefined,
      // Suggestions answer the customer's last message; once the owner has replied they
      // are stale, and tapping one again sent a duplicate (or re-ran the booking).
      quickReplies: undefined,
      messages: [...c.messages, {
        id: `msg-${Date.now()}`,
        sender: 'owner' as const,
        original: local ?? english,
        translation: english,
        ...(german ? { translationDe: german } : {}),
        time: sentLabel,
        sentAt: sentAt.toISOString(),
        untranslated: !local,
      }],
      lastTime: sentLabel,
      lastMessageAt: sentAt.toISOString(),
    }));
    return true;
  };

  const handleSaveAiSettings = (settings: AiAssistantSettings) => {
    setAiSettings(settings);
    showToast('AI receptionist settings saved');
  };
  // The browser tab names the screen, the salon and the product; the customers' booking page names the salon only.
  usePageHead(publicMode ? bookingPageHead(companySettings.companyName) : ownerPageHead(currentTab, companySettings.companyName));

  const bookingPage = <BookingPageView {...availabilityContext}
    companySettings={companySettings} draft={bookingDraft} setDraft={setBookingDraft}
    submittedRequest={submittedRequest} setSubmittedRequest={setSubmittedRequest}
    onNewBookingRequest={handleNewBookingRequest} onUpdateBookingRequest={handleUpdateBookingRequest}
    onCancelBookingRequest={handleCancelBookingRequest} onViewRequest={handleViewRequest} publicMode={publicMode} />;
  if (publicMode) return <main className="min-h-screen bg-[#F8F9FD] text-slate-800">{bookingPage}</main>;

  return (
    <div className="flex min-h-screen bg-[#F8F9FD] text-slate-800">
      {/* Sidebar Navigation */}
      <Sidebar
        companyName={companySettings.companyName}
        companyLocation={[companySettings.city, companySettings.country].filter(Boolean).join(', ')}
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        pendingRequestsCount={requests.length}
        onOpenPilotInterest={() => setIsPilotInterestOpen(true)}
      />

      {/* Main App Container */}
      <div id="app-content" className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <Header
          companyName={companySettings.companyName}
          companyLocation={companySettings.city}
          {...headerAccount(employees)}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          isMobileMenuOpen={isMobileMenuOpen}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          customers={customers}
          appointmentRequests={requests}
          calendarEvents={calendarEvents}
          onSelectAppointment={openAppointment}
          onOpenSettings={() => setCurrentTab('settings')}
          onSelectCustomer={(cust) => {
            navigate({ tab: 'customers', customerId: cust.id });
            setSearchQuery('');
          }}
          onSelectRequest={(req) => {
            navigate({ tab: 'home', requestId: req.id });
            setSearchQuery('');
          }}
          needsAttentionCount={needsAttention.length}
          needsAttentionNames={needsAttention.map((c) => c.customerName.split(' ')[0])}
          latestAiBooking={latestAiBookedEvent}
          needsAttentionUpdates={needsAttention.map(c => `${c.id}:${c.messages.at(-1)?.id}:${c.attentionReason}`).sort()}
          onOpenConversations={() => openConversation()}
          onOpenAssistant={() => setIsAssistantOpen(true)}

        />

        <PilotInterest
          isOpen={isPilotInterestOpen}
          onOpen={() => setIsPilotInterestOpen(true)}
          onClose={() => setIsPilotInterestOpen(false)}
        />

        {/* Main View Body */}
        <main ref={mainRef} tabIndex={-1} id="main-content" className="flex-1 overflow-x-clip pb-28 lg:pb-16 outline-none">
          {/* Every time in the app is the salon's. This says so, and only on a device set to another time zone. */}
          <SalonTimeNote timeZone={companySettings.timeZone} className="mx-4 mt-3 text-xs sm:mx-6 lg:mx-8" />
          {currentTab === 'home' && rejectedRequests.length > 0 && (
            <div role="status" className="mx-4 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-1.5 text-xs sm:mx-8">
              <span>Request from {rejectedRequests.at(-1)?.request.customerName} declined.</span>
              <button onClick={undoReject} className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-[#5551FF] underline hover:bg-slate-100">Undo rejection</button>
              <button aria-label="Dismiss undo rejection" onClick={() => setRejectedRequests(previous => previous.slice(0, -1))} className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
          )}
          {currentTab === 'home' && (
            <HomeView
              requests={requests}
              selectedRequestId={route.requestId ?? null}
              onSelectRequest={id => navigate({ tab: 'home', requestId: id })}
              availabilityContext={availabilityContext}
              onOpenAppointment={openAppointment}
              onAcceptRequest={handleAcceptRequest}
              onRejectRequest={handleRejectRequest}
              onMoveRequest={handleMoveRequest}
              onSimulateNewRequest={handleSimulateNewRequest}
              now={now}
              nextAppointment={nextAppointment}
              onExportReport={() => handleExportReport()}
              onOpenAnalytics={() => setCurrentTab('analytics')}
              conversations={allConversations}
              onOpenConversations={openConversation}
              onOpenBookingPage={() => setCurrentTab('booking-page')}
              onNewAppointment={() => { setStartNewAppointment(true); setCurrentTab('calendar'); }}
            />
          )}

          {currentTab === 'calendar' && (
            <CalendarView
              events={calendarEvents}
              bookingHours={bookingHours}
              services={services}
              employees={employees}
              shiftOverview={shiftOverview}
              requests={requests}
              closedDates={closedDates}
              absences={absences}
              timeZone={companySettings.timeZone}
              date={selectedCalendarEvent?.date ?? calendarDate}
              selectedEventId={route.appointmentId ?? null}
              onSelectEvent={event => event ? openAppointment(event) : navigate({ tab: 'calendar' }, { replace: true })}
              onDateChange={date => { setCalendarDate(date); if (route.appointmentId) navigate({ tab: 'calendar' }); }}
              onAddEvent={handleAddCalendarEvent}
              onUpdateEvent={handleUpdateCalendarEvent}
              onDeleteEvent={handleDeleteCalendarEvent}
              conversationFor={conversationOfAppointment}
              onOpenConversation={openConversation}
              startAdding={startNewAppointment}
              onStartedAdding={() => setStartNewAppointment(false)}
            />
          )}

          {currentTab === 'shift-plan' && (
            <ShiftPlanView
              employees={employees}
              shiftOverview={shiftOverview}
              onUpdateShift={handleUpdateShift}
              timeZone={companySettings.timeZone}
            />
          )}

          {currentTab === 'customers' && (
            <CustomersView
              customers={customers}
              events={calendarEvents}
              now={now}
              timeZone={companySettings.timeZone}
              customersWithChat={customersWithChat}
              selectedCustomerId={route.customerId ?? null}
              onClearSelection={() => navigate({ tab: 'customers' })}
              onAddCustomer={handleAddCustomer}
              onUpdateCustomer={handleUpdateCustomer}
              onDeleteCustomer={handleDeleteCustomer}
              onOpenChat={openChatForCustomer}
            />
          )}

          {currentTab === 'resources' && (
            <ResourcesView
              resources={resources}
              onAddResource={handleAddResource}
              onUpdateResource={handleUpdateResource}
              onDeleteResource={handleDeleteResource}
            />
          )}

          {currentTab === 'employees' && (
            <EmployeesView
              employees={employees}
              onAddEmployee={handleAddEmployee}
              onUpdateEmployee={handleUpdateEmployee}
              companyName={companySettings.companyName}
              onDeleteEmployee={handleDeleteEmployee}
            />
          )}

          {currentTab === 'services' && (
            <ServicesView
              services={services}
              employees={employees}
              onAddService={handleAddService}
              onUpdateService={handleUpdateService}
              onDeleteService={handleDeleteService}
            />
          )}

          {currentTab === 'analytics' && <AnalyticsView events={calendarEvents} conversations={allConversations} companyName={companySettings.companyName} timeZone={companySettings.timeZone} now={now} onExportReport={handleExportReport} />}

          {currentTab === 'conversations' && (
            <ConversationsView
              conversations={allConversations}
              selectedId={route.conversationId ?? selectedConversationId}
              mobileDetailOpen={Boolean(route.conversationId)}
              onBackToList={() => navigate({ tab: 'conversations' })}
              onSelect={id => { setSelectedConversationId(id); navigate({ tab: 'conversations', conversationId: id }); }}
              onTakeOver={handleTakeOver}
              onLetAiContinue={handleLetAiContinue}
              onOwnerReply={handleOwnerReply}
              aiSettings={aiSettings}
              onOpenAiSettings={() => setCurrentTab('ai-assistant')}
              liveChannels={live.channels}
              onConfirmBooking={handleConfirmLiveBooking}
              appointmentFor={(conversation) => appointmentForConversation(conversation, calendarEvents)}
              onOpenAppointment={openAppointment}
              timeZone={companySettings.timeZone}
            />
          )}

          {currentTab === 'ai-assistant' && (
            <AiAssistantView
              settings={aiSettings}
              onSave={handleSaveAiSettings}
              channels={{
                live: live.status,
                telegramBot: live.telegram,
                whatsappChats: live.conversations.some((item) => item.channel === 'WhatsApp'),
                businessPhone: companySettings.businessPhone,
              }}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsView
              settings={companySettings}
              bookingHours={bookingHours}
              onSaveSettings={handleSaveSettings}
              closedDates={closedDates} absences={absences} employees={employees}
              onSaveClosedDates={setClosedDates} onSaveAbsences={setAbsences}
            />
          )}

          {currentTab === 'booking-page' && bookingPage}
        </main>

        {/* Phones and tablets: app-style tab bar. Hidden inside an open chat, like messaging apps. */}
        <BottomNav
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          onOpenMore={() => setIsMobileMenuOpen(true)}
          isMoreOpen={isMobileMenuOpen}
          homeBadge={requests.length}
          chatsBadge={needsAttention.length}
          hideOnPhone={currentTab === 'conversations' && Boolean(route.conversationId)}
        />
      </div>

      {/* Feedback distinguishes a completed action from a problem or demo information.
          On wide screens the assistant can be docked on the right (it sets --assistant-dock to its
          width): the toast then moves left by that much and never lies over the assistant's input.
          While it is docked a long message also has to stay clear of the menu on the left (16rem),
          so it wraps earlier: min(16rem, dock) is the menu's width then, and nothing otherwise. */}
      {toast && (
        <div role={toast.kind === 'error' ? 'alert' : 'status'} className="fixed inset-x-4 top-[7.5rem] z-40 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl min-[480px]:top-[4.5rem] sm:inset-x-auto sm:top-auto sm:bottom-24 sm:right-5 lg:bottom-5 sm:max-w-[calc(100vw-2.5rem)] sm:flex-nowrap xl:right-[calc(1.25rem+var(--assistant-dock,0px))] xl:max-w-[calc(100vw-2.5rem-var(--assistant-dock,0px)-min(16rem,var(--assistant-dock,0px)))]">
          {toast.kind === 'error' ? <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" /> : toast.kind === 'info' ? <Info className="h-4 w-4 shrink-0 text-sky-300" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
          <span className="min-w-0 flex-1 py-1 [overflow-wrap:anywhere]">{toast.message}</span>
          {/* On phones an action gets its own row so the message keeps the full width. */}
          <div className={`flex shrink-0 items-center justify-end gap-1 ${toast.action ? 'basis-full sm:basis-auto' : ''}`}>
            {toast.action && <button onClick={toast.action.onClick} className="min-h-11 shrink-0 rounded-lg px-2 text-indigo-200 underline hover:bg-white/10 hover:text-white">{toast.action.label}</button>}
            <button aria-label="Dismiss notification" onClick={() => setToast(null)} className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-white/10"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {/* Owner assistant: answers from the data above and changes it only through the handlers the screens use. */}
      <AssistantPanel
        isOpen={isAssistantOpen}
        onClose={() => setIsAssistantOpen(false)}
        salon={availabilityContext}
        customers={customers}
        onAddEvent={handleAddCalendarEvent}
        onDeleteEvent={handleDeleteCalendarEvent}
        onSaveClosedDates={setClosedDates}
        onOpenCalendar={(date) => { setCalendarDate(date); navigate({ tab: 'calendar' }); }}
        onResultShown={() => setToast(null)}
      />
    </div>
  );
}

