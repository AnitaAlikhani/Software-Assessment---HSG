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
  ShiftEntry,
  Conversation,
  AiAssistantSettings,
} from './types';
import { initialConversations, initialAiSettings } from './conversationData';
import {
  initialAppointmentRequests,
  initialCalendarEvents,
  initialCustomers,
  initialEmployees,
  initialServices,
  initialResources,
  initialShiftOverview,
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
import { BookingPageView } from './views/BookingPageView';
import { ConversationsView } from './views/ConversationsView';
import { AiAssistantView } from './views/AiAssistantView';
import { POSModal } from './components/POSModal';
import { PilotInterest } from './components/PilotInterest';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { AppRoute, parseRoute, routeHash } from './navigation';
import { mostRecentAiAppointment, nextUpcomingAppointment } from './dashboard';
import { addMinutes, formatDate } from './scheduling';
import { getAvailableSlots, validateBookingRequest } from './availability';
import { appointmentFromRequest, appointmentFromConversationAction, upsertAppointment } from './appointmentActions';

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.hash));
  const currentTab = route.tab;
  const navigate = (next: AppRoute) => {
    const hash = routeHash(next);
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute(next);
  };
  const setCurrentTab = (tab: NavigationTab) => navigate({ tab });
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    const frame = requestAnimationFrame(() => {
      if (document.querySelector('dialog[open]')) return;
      const heading = mainRef.current?.querySelector<HTMLElement>('h1');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      else mainRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [route.tab, route.requestId, route.customerId, route.appointmentId, route.conversationId]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPOSOpen, setIsPOSOpen] = useState(false);
  const [isPilotInterestOpen, setIsPilotInterestOpen] = useState(false);
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
  const [requests, setRequests] = useState<AppointmentRequest[]>(initialAppointmentRequests);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(initialCalendarEvents);
  const [calendarDate, setCalendarDate] = useState('2026-10-07');
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [services, setServices] = useState<ServiceItem[]>(initialServices);
  const [resources, setResources] = useState<Resource[]>(initialResources);
  const [shiftOverview, setShiftOverview] = useState<ShiftEntry[]>(initialShiftOverview);
  const [companySettings, setCompanySettings] = useState<CompanySettingsData>(initialCompanySettings);
  const [bookingHours, setBookingHours] = useState<BookingHoursDay[]>(initialBookingHours);
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialConversations[0]?.id ?? null
  );
  const [aiSettings, setAiSettings] = useState<AiAssistantSettings>(initialAiSettings);

  const availabilityContext = { services, employees, bookingHours, shiftOverview, events: calendarEvents, requests };

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
    if (!action) toastTimer.current = setTimeout(() => setToast(null), kind === 'error' ? 7000 : 4000);
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
    showToast('Appointment request rescheduled');
    return null;
  };

  const handleNewBookingRequest = (request: AppointmentRequest): string | null => {
    const error = validateBookingRequest(availabilityContext, request);
    if (error) return error;
    setRequests((prev) => [request, ...prev]);
    showToast(`New booking request submitted for ${request.customerName}!`);
    return null;
  };

  const handleSimulateNewRequest = () => {
    const service = services.find((item) => item.name === 'Haircut' && item.onlineBooking);
    if (!service) { showToast('No online haircut service is available.', 'error'); return; }
    const date = '2026-10-01';
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
      channel: 'WhatsApp',
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
    setCalendarEvents(calendarEvents.filter((e) => e.id !== id));
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
      lastBooking: 'Today, 10:00',
      bookingsCount: 1,
    };
    setCustomers([newCustomer, ...customers]);
    showToast(`Customer ${cust.name} added`);
  };

  const handleDeleteCustomer = (id: string) => {
    setCustomers(customers.filter((c) => c.id !== id));
    showToast('Customer deleted');
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
    setResources(resources.filter((r) => r.id !== id));
    showToast('Resource removed');
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
    setEmployees(employees.filter((e) => e.id !== id));
    showToast('Employee deleted');
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
    setServices(services.filter((s) => s.id !== id));
    showToast('Service deleted');
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

  // POS
  const handleCompleteSale = (amount: number, serviceName: string) => {
    showToast(`Simulated CHF ${amount.toFixed(2)} checkout for ${serviceName}. No payment was taken.`, 'info');
  };

  return (
    <div className="flex min-h-screen bg-[#F8F9FD] text-slate-800">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        pendingRequestsCount={requests.length}
        onOpenPilotInterest={() => setIsPilotInterestOpen(true)}
      />

      {/* Main App Container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <Header
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
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
        <main ref={mainRef} tabIndex={-1} id="main-content" className="flex-1 pb-16 outline-none">
          {currentTab === 'home' && rejectedRequests.length > 0 && (
            <div role="status" className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs sm:mx-8">
              <span>Request from {rejectedRequests.at(-1)?.request.customerName} declined.</span>
              <button onClick={undoReject} className="font-semibold text-[#5551FF] underline">Undo rejection</button>
              <button aria-label="Dismiss undo rejection" onClick={() => setRejectedRequests(previous => previous.slice(0, -1))} className="ml-auto rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
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
              onSelectEvent={event => event ? openAppointment(event) : navigate({ tab: 'calendar' })}
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
            />
          )}

          {currentTab === 'booking-page' && (
            <BookingPageView
              {...availabilityContext}
              onNewBookingRequest={handleNewBookingRequest}
            />
          )}
        </main>
      </div>

      {/* POS Quick Register Modal */}
      <POSModal
        isOpen={isPOSOpen}
        onClose={() => setIsPOSOpen(false)}
        services={services}
        customers={customers}
        onCompleteSale={handleCompleteSale}
      />

      {/* Feedback distinguishes a completed action from a problem or demo information. */}
      {toast && (
        <div role={toast.kind === 'error' ? 'alert' : 'status'} className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] flex-wrap items-center gap-2.5 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-semibold text-white shadow-xl">
          {toast.kind === 'error' ? <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" /> : toast.kind === 'info' ? <Info className="h-4 w-4 shrink-0 text-sky-300" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
          <span>{toast.message}</span>
          {toast.action && <button onClick={toast.action.onClick} className="rounded px-2 py-1 text-indigo-200 underline hover:text-white">{toast.action.label}</button>}
          <button aria-label="Dismiss notification" onClick={() => setToast(null)} className="rounded p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

