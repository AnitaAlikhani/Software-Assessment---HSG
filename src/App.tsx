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
import { initialConversations, initialAiSettings } from './conversationData';
import {
  initialCalendarEvents,
  initialCustomers,
  initialEmployees,
  initialServices,
  initialResources,
  createDemoShifts,
  initialCompanySettings,
  initialBookingHours,
} from './mockData';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
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
import { POSModal } from './components/POSModal';
import { PilotInterest } from './components/PilotInterest';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { AppRoute, parseRoute, routeHash } from './navigation';
import { mostRecentAiAppointment, nextUpcomingAppointment } from './dashboard';
import { addMinutes, formatDate } from './scheduling';
import { getAvailableSlots, getNextAvailableDate, getSalonNow, validateBookingRequest } from './availability';
import { appointmentFromRequest, appointmentFromConversationAction, upsertAppointment } from './appointmentActions';

import { createDemoRequests } from './demoRequests';
import { useDemoState } from './useDemoState';
import { customerForRequest, upsertCustomer, validateContact } from './bookingData';

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
    window.scrollTo({ top: 0, left: 0 });
    const frame = requestAnimationFrame(focusMainHeading);
    return () => cancelAnimationFrame(frame);
  }, [route.tab]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPOSOpen, setIsPOSOpen] = useState(false);
  const [isPilotInterestOpen, setIsPilotInterestOpen] = useState(false);
  useEffect(() => {
    // A Back/Forward gesture changes the page behind an open drawer or dialog; close them.
    setIsMobileMenuOpen(false);
    setIsPOSOpen(false);
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
  const [requests, setRequests] = useDemoState<AppointmentRequest[]>('requests', () => createDemoRequests());
  const [calendarEvents, setCalendarEvents] = useDemoState<CalendarEvent[]>('calendarEvents', initialCalendarEvents);
  const [calendarDate, setCalendarDate] = useState(() => getSalonNow().date);
  const [customers, setCustomers] = useDemoState<Customer[]>('customers', initialCustomers);
  const [employees, setEmployees] = useDemoState<Employee[]>('employees', initialEmployees);
  const [services, setServices] = useDemoState<ServiceItem[]>('services', initialServices);
  const [resources, setResources] = useState<Resource[]>(initialResources);
  const [shiftOverview, setShiftOverview] = useDemoState<ShiftEntry[]>('shifts', () => createDemoShifts());
  const [companySettings, setCompanySettings] = useDemoState<CompanySettingsData>('companySettings', initialCompanySettings);
  const [bookingHours, setBookingHours] = useDemoState<BookingHoursDay[]>('bookingHours', initialBookingHours);
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialConversations[0]?.id ?? null
  );
  const [aiSettings, setAiSettings] = useState<AiAssistantSettings>(initialAiSettings);

  const [closedDates, setClosedDates] = useDemoState<ClosedDate[]>('closedDates', []);
  const [absences, setAbsences] = useDemoState<StaffAbsence[]>('absences', []);
  const [bookingDraft, setBookingDraft] = useDemoState<BookingDraft>('draft', () => createBookingDraft(services, companySettings.timeZone));
  const [submittedRequest, setSubmittedRequest] = useDemoState<AppointmentRequest | null>('submittedRequest', null);
  const availabilityContext = { services, employees, bookingHours, shiftOverview, events: calendarEvents, requests, closedDates, absences, timeZone: companySettings.timeZone };

  const needsAttention = conversations.filter((c) => c.status === 'needs-attention');
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

  // Activity stats matching Figma Page 1-3
  const [activityStats, setActivityStats] = useState({
    messagesToday: 4,
    messagesMonth: 24,
    aiBookingsToday: 1,
    aiBookingsMonth: 3,
    afterHoursToday: 2,
    afterHoursMonth: 9,
    replyTimeSec: 12,
  });

  const showToast = (message: string, kind: 'success' | 'error' | 'info' = 'success', action?: { label: string; onClick: () => void }) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, kind, action });
    // Action toasts stay longer, but never forever: on phones the toast covers the next controls.
    toastTimer.current = setTimeout(() => setToast(null), action ? 10000 : kind === 'error' ? 7000 : 4000);
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

    const newCalEvent = appointmentFromRequest(accepted, services);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    setSubmittedRequest((previous) => previous?.id === id ? { ...accepted, status: 'accepted' } : previous);
    if (accepted.customerId) setCustomers((previous) => previous.map((customer) => customer.id === accepted.customerId
      ? { ...customer, bookingsCount: customer.bookingsCount + 1, lastBooking: `${formatDate(accepted.date)}, ${newCalEvent.startTime}` }
      : customer));
    setCalendarEvents((prev) => upsertAppointment(prev, newCalEvent));
    setCalendarDate(newCalEvent.date);
    if (route.requestId === id) navigate({ tab: 'home' });

    if (newCalEvent.isAiBooked) {
      setActivityStats((prev) => ({
        ...prev,
        aiBookingsToday: prev.aiBookingsToday + 1,
        aiBookingsMonth: prev.aiBookingsMonth + 1,
      }));
    }

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
    const saved = { ...request, customerId: customer.id, customerPhone: customer.phone, isAiBooked: false };
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
    const saved = { ...request, customerId: customer.id, customerPhone: customer.phone, isAiBooked: false };
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

  const handleSimulateNewRequest = () => {
    const service = services.find((item) => item.name === 'Haircut' && item.onlineBooking);
    if (!service) { showToast('No online haircut service is available.', 'error'); return; }
    const date = getNextAvailableDate(availabilityContext, service.id, getSalonNow(companySettings.timeZone).date);
    if (!date) { showToast('No appointment slots are available in the next 90 days.', 'error'); return; }
    const available = employees.map((employee) => ({
      employee,
      slots: getAvailableSlots(availabilityContext, { date, serviceId: service.id, employeeId: employee.id }),
    })).find((item) => item.slots.length > 0);
    if (!available) { showToast('There are no available slots for this demo date.', 'error'); return; }
    const names = ['Léa Girard', 'Chloé Favre', 'Camille Bonnet', 'Elena Rossi'];
    const startTime = available.slots[0];
    handleNewBookingRequest({
      id: `req-${Date.now()}`,
      serviceId: service.id,
      employeeId: available.employee.id,
      customerName: names[Math.floor(Math.random() * names.length)],
      serviceName: service.name,
      date,
      dateStr: formatDate(date),
      timeStr: `${startTime} - ${addMinutes(startTime, service.durationMinutes)}`,
      timeAgo: 'Just now',
      staffName: available.employee.name,
      channel: 'Web',
      customerPhone: '+41 79 555 99 99',
      isAiBooked: false,
      status: 'pending',
    });
  };

  const handleExportActivity = () => {
    const report = {
      date: new Date().toISOString(),
      salon: companySettings.companyName,
      dataType: 'sample-demo-activity',
      note: 'Illustrative demo figures. This export does not measure participant behaviour.',
      stats: activityStats,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bella_salon_sample_activity_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Sample activity exported');
  };

  // Calendar
  const handleAddCalendarEvent = (ev: Omit<CalendarEvent, 'id'>) => {
    const newEv: CalendarEvent = {
      ...ev,
      serviceId: ev.serviceId ?? services.find((service) => service.name === ev.serviceName)?.id,
      employeeId: ev.employeeId ?? employees.find((employee) => employee.name === ev.staffName)?.id,
      id: `cal-${Date.now()}`,
    };
    setCalendarEvents((prev) => upsertAppointment(prev, newEv));
    setCalendarDate(newEv.date);
    showToast(`Appointment added for ${ev.customerName}`);
  };

  const handleDeleteCalendarEvent = (id: string) => {
    const removed = calendarEvents.find((event) => event.id === id);
    setCalendarEvents(calendarEvents.filter((e) => e.id !== id));
    setSubmittedRequest((previous) => previous && `cal-${previous.id}` === id ? { ...previous, status: 'cancelled' } : previous);
    if (removed?.customerId) setCustomers((previous) => previous.map((customer) => customer.id === removed.customerId
      ? { ...customer, bookingsCount: Math.max(0, customer.bookingsCount - 1), lastBooking: 'Appointment cancelled' }
      : customer));
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
    showToast(shift ? `Shift saved for ${employee.name}` : `${employee.name} is unavailable on ${formatDate(date)}`);
  };

  // Customers
  const handleAddCustomer = (
    cust: Omit<Customer, 'id' | 'initials' | 'lastBooking' | 'bookingsCount'>
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
      lastBooking: 'No confirmed bookings',
      bookingsCount: 0,
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
    setCustomers((previous) => previous.filter((c) => c.id !== id));
    showToast(`Customer ${removed.name} deleted`, 'info', { label: 'Undo', onClick: () => { setCustomers((previous) => restoreAt(previous, removed, index)); setToast(null); } });
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
    setEmployees((previous) => previous.filter((e) => e.id !== id));
    showToast(`Employee ${removed.name} deleted`, 'info', { label: 'Undo', onClick: () => { setEmployees((previous) => restoreAt(previous, removed, index)); setToast(null); } });
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
    setServices(
      services.map((s) => (s.id === id ? { ...s, ...partial } : s))
    );
    showToast('Service updated');
  };

  const handleDeleteService = (id: string) => {
    const index = services.findIndex((s) => s.id === id);
    if (index < 0) return;
    const removed = services[index];
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
      ? conversations.find((c) => c.id === id)
      : conversations.find((c) => c.status === 'needs-attention') ?? conversations[0];
    if (target) setSelectedConversationId(target.id);
    navigate({ tab: 'conversations', conversationId: target?.id });
  };

  const openChatForCustomer = (customerName: string) => {
    const conv = conversations.find((c) => c.customerName === customerName);
    if (!conv) {
      showToast(`No conversation with ${customerName} yet`, 'info');
      return;
    }
    openConversation(conv.id);
  };

  const handleTakeOver = (id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, takenOver: true } : c))
    );
    showToast('You took over this conversation. The AI is paused.');
  };

  const applyConversationAppointment = (conversation: Conversation, action: AppointmentAction, fromAi: boolean) => {
    const appointment = appointmentFromConversationAction(action, conversation, calendarEvents, services, fromAi);
    if (!appointment) {
      showToast('This appointment could not be updated. Check the calendar and service before confirming.', 'error');
      return false;
    }
    setCalendarEvents((prev) => upsertAppointment(prev, appointment));
    setCalendarDate(appointment.date);
    return true;
  };

  const handleLetAiContinue = (id: string) => {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    const followUp = conversation.aiFollowUp;
    const action = followUp?.appointmentAction;
    if (action && !applyConversationAppointment(conversation, action, true)) return;

    setConversations((prev) => prev.map((c) => c.id !== id ? c : {
      ...c,
      takenOver: false,
      status: action || c.appointmentId ? 'booked' : 'ai-handled',
      appointmentId: action?.appointmentId ?? c.appointmentId,
      aiFollowUp: undefined,
      messages: followUp ? [...c.messages, {
        id: `msg-${Date.now()}`,
        sender: 'ai' as const,
        original: followUp.original,
        translation: followUp.translation,
        time: 'now',
      }] : c.messages,
      lastTime: followUp ? 'now' : c.lastTime,
    }));
    showToast('The AI is continuing this conversation');
  };

  const handleOwnerReply = (id: string, english: string, local?: string, action?: AppointmentAction) => {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return false;
    if (action && !applyConversationAppointment(conversation, action, false)) return false;

    setConversations((prev) => prev.map((c) => c.id !== id ? c : {
      ...c,
      takenOver: true,
      status: 'owner-handled' as const,
      appointmentId: action?.appointmentId ?? c.appointmentId,
      // The scripted follow-up predates this reply and may now contradict the owner.
      aiFollowUp: undefined,
      messages: [...c.messages, {
        id: `msg-${Date.now()}`,
        sender: 'owner' as const,
        original: local ?? english,
        translation: english,
        time: 'now',
        untranslated: c.language !== 'EN' && !local,
      }],
      lastTime: 'now',
    }));
    return true;
  };

  const handleSaveAiSettings = (settings: AiAssistantSettings) => {
    setAiSettings(settings);
    showToast('AI Assistant settings saved');
  };

  // POS: the dialog shows its own confirmation; the toast would render behind the modal backdrop,
  // so it is deferred until the dialog closes.
  const pendingSaleToast = useRef<string | null>(null);
  const handleCompleteSale = (amount: number, serviceName: string) => {
    pendingSaleToast.current = `Simulated CHF ${amount.toFixed(2)} checkout for ${serviceName}. No payment was taken.`;
  };
  const closePOS = () => {
    setIsPOSOpen(false);
    if (pendingSaleToast.current) { showToast(pendingSaleToast.current, 'info'); pendingSaleToast.current = null; }
  };

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
          onOpenPOSModal={() => setIsPOSOpen(true)}
          needsAttentionCount={needsAttention.length}
          needsAttentionNames={needsAttention.map((c) => c.customerName.split(' ')[0])}
          latestAiBooking={latestAiBookedEvent}
          needsAttentionUpdates={needsAttention.map(c => `${c.id}:${c.messages.at(-1)?.id}:${c.attentionReason}`).sort()}
          onOpenConversations={() => openConversation()}

        />

        <PilotInterest
          isOpen={isPilotInterestOpen}
          onOpen={() => setIsPilotInterestOpen(true)}
          onClose={() => setIsPilotInterestOpen(false)}
        />

        {/* Main View Body */}
        <main ref={mainRef} tabIndex={-1} id="main-content" className="flex-1 overflow-x-clip pb-16 outline-none">
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
              nextAppointment={nextAppointment}
              activityStats={activityStats}
              onExportActivity={handleExportActivity}
              conversations={conversations}
              onOpenConversations={openConversation}
            />
          )}

          {currentTab === 'calendar' && (
            <CalendarView
              events={calendarEvents}
              bookingHours={bookingHours}
              services={services}
              date={selectedCalendarEvent?.date ?? calendarDate}
              selectedEventId={route.appointmentId ?? null}
              onSelectEvent={event => event ? openAppointment(event) : navigate({ tab: 'calendar' }, { replace: true })}
              onDateChange={date => { setCalendarDate(date); if (route.appointmentId) navigate({ tab: 'calendar' }); }}
              onAddEvent={handleAddCalendarEvent}
              onDeleteEvent={handleDeleteCalendarEvent}
            />
          )}

          {currentTab === 'shift-plan' && (
            <ShiftPlanView
              employees={employees}
              shiftOverview={shiftOverview}
              onUpdateShift={handleUpdateShift}
            />
          )}

          {currentTab === 'customers' && (
            <CustomersView
              customers={customers}
              selectedCustomerId={route.customerId ?? null}
              onClearSelection={() => navigate({ tab: 'customers' })}
              onAddCustomer={handleAddCustomer}
              onDeleteCustomer={handleDeleteCustomer}
              onOpenChat={openChatForCustomer}
            />
          )}

          {currentTab === 'resources' && (
            <ResourcesView
              resources={resources}
              onAddResource={handleAddResource}
              onDeleteResource={handleDeleteResource}
            />
          )}

          {currentTab === 'employees' && (
            <EmployeesView
              employees={employees}
              onAddEmployee={handleAddEmployee}
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

          {currentTab === 'analytics' && <AnalyticsView />}

          {currentTab === 'conversations' && (
            <ConversationsView
              conversations={conversations}
              selectedId={route.conversationId ?? selectedConversationId}
              mobileDetailOpen={Boolean(route.conversationId)}
              onBackToList={() => navigate({ tab: 'conversations' })}
              onSelect={id => { setSelectedConversationId(id); navigate({ tab: 'conversations', conversationId: id }); }}
              onTakeOver={handleTakeOver}
              onLetAiContinue={handleLetAiContinue}
              onOwnerReply={handleOwnerReply}
              aiSettings={aiSettings}
              onOpenAiSettings={() => setCurrentTab('ai-assistant')}
            />
          )}

          {currentTab === 'ai-assistant' && (
            <AiAssistantView settings={aiSettings} onSave={handleSaveAiSettings} />
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
      </div>

      {/* POS Quick Register Modal */}
      <POSModal
        isOpen={isPOSOpen}
        onClose={closePOS}
        services={services}
        customers={customers}
        onCompleteSale={handleCompleteSale}
      />

      {/* Feedback distinguishes a completed action from a problem or demo information. */}
      {toast && (
        <div role={toast.kind === 'error' ? 'alert' : 'status'} className="fixed inset-x-4 top-[7.5rem] z-40 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl min-[480px]:top-[4.5rem] sm:inset-x-auto sm:top-auto sm:bottom-5 sm:right-5 sm:max-w-[calc(100vw-2.5rem)] sm:flex-nowrap">
          {toast.kind === 'error' ? <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" /> : toast.kind === 'info' ? <Info className="h-4 w-4 shrink-0 text-sky-300" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
          <span className="min-w-0 flex-1 py-1 [overflow-wrap:anywhere]">{toast.message}</span>
          {/* On phones an action gets its own row so the message keeps the full width. */}
          <div className={`flex shrink-0 items-center justify-end gap-1 ${toast.action ? 'basis-full sm:basis-auto' : ''}`}>
            {toast.action && <button onClick={toast.action.onClick} className="min-h-11 shrink-0 rounded-lg px-2 text-indigo-200 underline hover:bg-white/10 hover:text-white">{toast.action.label}</button>}
            <button aria-label="Dismiss notification" onClick={() => setToast(null)} className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-white/10"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

