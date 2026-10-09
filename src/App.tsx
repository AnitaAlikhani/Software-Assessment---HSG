import React, { useState } from 'react';
import {
  NavigationTab,
  AppointmentRequest,
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
import { CheckCircle2 } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavigationTab>('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPOSOpen, setIsPOSOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Core application states
  const [requests, setRequests] = useState<AppointmentRequest[]>(initialAppointmentRequests);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(initialCalendarEvents);
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

    setRequests(requests.filter((r) => r.id !== id));
    setNextAppointment({
      customerName: accepted.customerName,
      staffName: accepted.staffName || 'Eloise Denniese',
      time: accepted.timeStr,
      dayName: 'THURSDAY',
    });

    // Add to calendar
    const newCalEvent: CalendarEvent = {
      id: `cal-${Date.now()}`,
      customerName: accepted.customerName,
      serviceName: accepted.serviceName,
      staffName: accepted.staffName || 'Eloise Denniese',
      day: 'thu',
      dateDisplay: 'Thu 08/10',
      startTime: accepted.timeStr.split(' - ')[0] || '10:00',
      endTime: accepted.timeStr.split(' - ')[1] || '10:30',
      colorTheme: 'yellow',
      isAiBooked: accepted.channel === 'WhatsApp' || accepted.channel === 'Instagram',
    };
    setCalendarEvents([newCalEvent, ...calendarEvents]);

    setActivityStats((prev) => ({
      ...prev,
      aiBookingsToday: prev.aiBookingsToday + 1,
      aiBookingsMonth: prev.aiBookingsMonth + 1,
    }));

    showToast(`Accepted appointment for ${accepted.customerName}`);
  };

  const handleRejectRequest = (id: string) => {
    const req = requests.find((r) => r.id === id);
    setRequests(requests.filter((r) => r.id !== id));
    showToast(`Declined request from ${req?.customerName || 'customer'}`);
  };

  const handleMoveRequest = (id: string, newTime: string) => {
    setRequests(
      requests.map((r) => (r.id === id ? { ...r, timeStr: newTime } : r))
    );
    showToast(`Appointment rescheduled to ${newTime}`);
  };

  const handleSimulateNewRequest = () => {
    const names = ['L\u00e9a Girard', 'Chlo\u00e9 Favre', 'Camille Bonnet', 'Elena Rossi'];
    const randomName = names[Math.floor(Math.random() * names.length)];
    const newReq: AppointmentRequest = {
      id: `req-${Date.now()}`,
      customerName: randomName,
      serviceName: 'Haircut',
      dateStr: '1 October 2026',
      timeStr: '14:00 - 14:30',
      timeAgo: 'Just now',
      staffName: 'Nilufar Ismayilova',
      channel: 'WhatsApp',
      status: 'pending',
    };
    setRequests([newReq, ...requests]);
    showToast(`New booking request arrived from ${randomName} via WhatsApp!`);
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
      id: `cal-${Date.now()}`,
    };
    setCalendarEvents([newEv, ...calendarEvents]);
    showToast(`Appointment added for ${ev.customerName}`);
  };

  const handleDeleteCalendarEvent = (id: string) => {
    setCalendarEvents(calendarEvents.filter((e) => e.id !== id));
    showToast('Appointment removed from calendar');
  };

  // Shift Plan
  const handleUpdateShift = (
    employeeId: string,
    dayKey: string,
    start: string,
    end: string
  ) => {
    setShiftOverview((prev) =>
      prev.map((item) => {
        if (item.employeeId === employeeId) {
          return {
            ...item,
            shifts: {
              ...item.shifts,
              [dayKey]: { start, end },
            },
          };
        }
        return item;
      })
    );
    showToast(`Shift updated: ${start} - ${end}`);
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

  const handleLetAiContinue = (id: string) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const messages = c.aiFollowUp
          ? [
              ...c.messages,
              {
                id: `msg-${Date.now()}`,
                sender: 'ai' as const,
                original: c.aiFollowUp.original,
                translation: c.aiFollowUp.translation,
                time: 'now',
              },
            ]
          : c.messages;
        return {
          ...c,
          takenOver: false,
          status: 'ai-handled' as const,
          messages,
          lastTime: 'now',
        };
      })
    );
    showToast('The AI is continuing this conversation');
  };

  const handleOwnerReply = (id: string, english: string, local?: string) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        return {
          ...c,
          status: c.status === 'needs-attention' ? ('owner-handled' as const) : c.status,
          messages: [
            ...c.messages,
            {
              id: `msg-${Date.now()}`,
              sender: 'owner' as const,
              original: local ?? english,
              translation: english,
              time: 'now',
              untranslated: c.language !== 'EN' && !local,
            },
          ],
          lastTime: 'now',
        };
      })
    );
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
              onAddEvent={handleAddCalendarEvent}
              onDeleteEvent={handleDeleteCalendarEvent}
            />
          )}

          {currentTab === 'shift-plan' && (
            <ShiftPlanView
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
              services={services}
              employees={employees}
              onNewBookingRequest={(req) => {
                setRequests([req, ...requests]);
                showToast(`New booking request submitted for ${req.customerName}!`);
              }}
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
