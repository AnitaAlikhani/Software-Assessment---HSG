import React, { useState } from 'react';
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
import { CheckCircle2 } from 'lucide-react';
import { addMinutes, formatDate } from './scheduling';
import { getAvailableSlots, validateBookingRequest } from './availability';
import { appointmentFromRequest, appointmentFromConversationAction, upsertAppointment } from './appointmentActions';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavigationTab>('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPOSOpen, setIsPOSOpen] = useState(false);
  const [isPilotInterestOpen, setIsPilotInterestOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
  const latestAiBookedEvent = calendarEvents.find((e) => e.isAiBooked) ?? null;

  // Next appointment state (matching Figma top right card)
  const [nextAppointment, setNextAppointment] = useState<{
    customerName: string;
    staffName: string;
    time: string;
    dayName: string;
  } | null>({
    customerName: 'Nilufar Ismayilova',
    staffName: 'Eloise Denniese',
    time: '10:00 - 10:30',
    dayName: 'WEDNESDAY',
  });

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

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Home request actions
  const handleAcceptRequest = (id: string) => {
    const accepted = requests.find((r) => r.id === id);
    if (!accepted) return;
    const availabilityError = validateBookingRequest(availabilityContext, accepted, accepted.id);
    if (availabilityError) {
      showToast(availabilityError);
      return;
    }

    const newCalEvent = appointmentFromRequest(accepted, services);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    setNextAppointment({
      customerName: newCalEvent.customerName,
      staffName: newCalEvent.staffName,
      time: `${newCalEvent.startTime} - ${newCalEvent.endTime}`,
      dayName: new Date(`${newCalEvent.date}T12:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'long', timeZone: 'UTC',
      }).toUpperCase(),
    });
    setCalendarEvents((prev) => upsertAppointment(prev, newCalEvent));
    setCalendarDate(newCalEvent.date);

    if (newCalEvent.isAiBooked) {
      setActivityStats((prev) => ({
        ...prev,
        aiBookingsToday: prev.aiBookingsToday + 1,
        aiBookingsMonth: prev.aiBookingsMonth + 1,
      }));
    }

    showToast(`Accepted appointment for ${accepted.customerName}`);
  };

  const handleRejectRequest = (id: string) => {
    const req = requests.find((r) => r.id === id);
    setRequests(requests.filter((r) => r.id !== id));
    showToast(`Declined request from ${req?.customerName || 'customer'}`);
  };

  const handleMoveRequest = (id: string, newTime: string) => {
    const request = requests.find((item) => item.id === id);
    if (!request) return;
    const startTime = newTime.split(' - ')[0];
    const service = request.serviceId
      ? services.find((item) => item.id === request.serviceId)
      : services.find((item) => item.name === request.serviceName);
    if (!service) { showToast('This service is no longer available.'); return; }
    const updatedRequest = { ...request, timeStr: `${startTime} - ${addMinutes(startTime, service.durationMinutes)}` };
    const error = validateBookingRequest(availabilityContext, updatedRequest, id);
    if (error) { showToast(error); return; }
    setRequests((prev) => prev.map((item) => item.id === id ? updatedRequest : item));
    showToast('Appointment request rescheduled');
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
    if (!service) { showToast('No online haircut service is available.'); return; }
    const date = '2026-10-01';
    const available = employees.map((employee) => ({
      employee,
      slots: getAvailableSlots(availabilityContext, { date, serviceId: service.id, employeeId: employee.id }),
    })).find((item) => item.slots.length > 0);
    if (!available) { showToast('There are no available slots for this demo date.'); return; }
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
      salon: 'Bella Hair Salon',
      stats: activityStats,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bella_salon_activity_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('Activity summary exported successfully!');
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
    setCurrentTab('conversations');
  };

  const openChatForCustomer = (customerName: string) => {
    const conv = conversations.find((c) => c.customerName === customerName);
    if (!conv) {
      showToast(`No conversation with ${customerName} yet`);
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
      showToast('This appointment could not be updated. Check the calendar and service before confirming.');
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
    showToast(`Payment of CHF ${amount.toFixed(2)} received for ${serviceName}`);
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
          onSelectCustomer={(cust) => {
            setCurrentTab('customers');
            setSearchQuery('');
          }}
          onSelectRequest={(req) => {
            setCurrentTab('home');
            setSearchQuery('');
          }}
          onOpenPOSModal={() => setIsPOSOpen(true)}
          needsAttentionCount={needsAttention.length}
          needsAttentionNames={needsAttention.map((c) => c.customerName.split(' ')[0])}
          latestAiBooking={
            latestAiBookedEvent
              ? {
                  customerName: latestAiBookedEvent.customerName,
                  detail: `${latestAiBookedEvent.dateDisplay} · ${latestAiBookedEvent.serviceName}`,
                }
              : null
          }
          onOpenConversations={() => openConversation()}
          onOpenCalendar={() => setCurrentTab('calendar')}
        />

        <PilotInterest
          isOpen={isPilotInterestOpen}
          onOpen={() => setIsPilotInterestOpen(true)}
          onClose={() => setIsPilotInterestOpen(false)}
        />

        {/* Main View Body */}
        <main className="flex-1 pb-16">
          {currentTab === 'home' && (
            <HomeView
              requests={requests}
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
              date={calendarDate}
              onDateChange={setCalendarDate}
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
              selectedId={selectedConversationId}
              onSelect={setSelectedConversationId}
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

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 bg-slate-900 text-white text-xs font-semibold rounded-2xl shadow-xl animate-in slide-in-from-bottom duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

