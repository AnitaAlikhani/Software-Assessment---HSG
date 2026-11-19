import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  NavigationTab,
  AppointmentRequest,
  AppointmentAction,
  CalendarEvent,
  Customer,
  Employee,
  ServiceItem,
  CompanySettingsData,
  BookingHoursDay,
  ClosedDate,
  StaffAbsence,
  ShiftEntry,
  Conversation,
  AiAssistantSettings,
  SettingsSubTab,
  TeamSubTab,
} from './types';
import { DEFAULT_DEMO_CONVERSATION_ID, initialAiSettings } from './conversationData';
import {
  initialEmployees,
  initialServices,
  initialCompanySettings,
  initialBookingHours,
} from './mockData';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { MoreSheet } from './components/MoreSheet';
import { HomeView } from './views/HomeView';
import { CalendarView } from './views/CalendarView';
import { TeamView } from './views/TeamView';
import { CustomersView } from './views/CustomersView';
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
import { AppRoute, isOldAddress, parseRoute, routeForTab, routeHash, SCREEN_NAMES, type RetiredTab } from './navigation';
import { changeAddress, useBackClosesOverlays } from './backGesture';
import { analyticsReport, type Period } from './analytics';
import { downloadCsv } from './csv';
import { PRODUCT_NAME } from './brand';
import { formatDate } from './scheduling';
import { getSalonNow, isOutsideOpeningHours, validateBookingRequest, validateCalendarEvent } from './availability';
import { appointmentForConversation, appointmentFromRequest, appointmentFromConversationAction, appointmentIdForRequest, upsertAppointment } from './appointmentActions';
import { answerIsShown, openRequestCount, unsettledAnswer, withAnswer, type RequestAnswer } from './inbox';
import { acceptedAppointmentState, checkRequest, movedRequest, planChatBooking } from './requestAnswers';
import { announceRequest, applyBridgedRequest, listenForRequests } from './requestBridge';
import { BookingLinkCompact } from './components/BookingLinkCard';

import { createDemoWorkspace, type DemoWorkspace } from './demoWorkspace';
import { createIncomingRequest } from './demoRequests';
import { forgetRetiredDemoState, useDemoState } from './useDemoState';
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
  // A form with changes that are not saved (a person in Team, the salon's settings) leaves its
  // question here. Opening another screen through the app asks it first; `navigate` answers
  // whether the screen was opened.
  const unsavedQuestion = useRef<string | null>(null);
  const noteUnsaved = (question: string | null) => { unsavedQuestion.current = question; };
  // The screen that is open now, also for a `navigate` that an older message still holds (a toast's action).
  const openTab = useRef(currentTab);
  openTab.current = currentTab;
  const openRoute = useRef(route);
  openRoute.current = route;
  /** Asks the question of a form with unsaved changes before another screen opens. True when the screen may open. */
  const mayLeave = (next: AppRoute): boolean => {
    if (next.tab === openTab.current || !unsavedQuestion.current) return true;
    if (!window.confirm(unsavedQuestion.current)) return false;
    // Answered: the change of address that follows must not ask a second time.
    unsavedQuestion.current = null;
    return true;
  };
  const navigate = (next: AppRoute, options: { replace?: boolean } = {}): boolean => {
    if (!mayLeave(next)) return false;
    const hash = routeHash(next);
    if (window.location.hash !== hash) {
      // `replace` (closing an overlay, moving between the tabs of a page) adds no history entry, so the
      // phone's Back gesture neither re-opens the overlay nor walks through the tabs (see changeAddress).
      changeAddress(hash, options.replace);
    } else {
      // The target is the page already shown (a search result, a menu entry): still give focus feedback.
      requestAnimationFrame(focusMainHeading);
    }
    setRoute(next);
    return true;
  };
  // A screen may still be asked for by a name it had before it moved; it opens in its new place.
  const setCurrentTab = (tab: NavigationTab | RetiredTab) => navigate(routeForTab(tab));
  useEffect(() => {
    const onHashChange = () => {
      const next = parseRoute(window.location.hash);
      // Back, Forward and a typed address leave a form with unsaved changes just as the menu
      // would, so they ask the same question. "Stay" brings back the address of the screen that
      // is still shown; the form was never closed and keeps what was typed.
      if (!mayLeave(next)) { changeAddress(routeHash(openRoute.current)); return; }
      // The address of a screen that has moved (a bookmark, a link in a message) is exchanged for
      // the address of its new place, so the address bar shows where the owner really is.
      if (isOldAddress(window.location.hash)) changeAddress(routeHash(next), true);
      setRoute(next);
    };
    if (isOldAddress(window.location.hash)) onHashChange();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  // The phone's Back gesture closes an open dialog, sheet or the assistant and leaves the page.
  // An appointment's details have their own address, so Back closes them by itself.
  useBackClosesOverlays(Boolean(route.appointmentId));
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
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPilotInterestOpen, setIsPilotInterestOpen] = useState(false);
  useEffect(() => {
    // A Back/Forward gesture changes the page behind an open sheet or dialog; close them.
    setIsMoreOpen(false);
    setIsPilotInterestOpen(false);
  }, [route.tab, route.requestId, route.customerId, route.appointmentId, route.conversationId]);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' | 'info'; action?: { label: string; onClick: () => void } } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  // What the owner has just answered on Home. Home shows each answer in its request's place for a
  // while, with "Undo". Kept with the tab's data: a phone that reloads the page after the owner
  // has been in her messenger must not lose the card that says what to tell the customer.
  const [requestAnswers, setRequestAnswers] = useDemoState<RequestAnswer[]>('requestAnswers', []);
  // A confirmation that was on its way to a chat when the page was reloaded: its outcome is not
  // known here any more. The chat itself says whether its request still waits.
  useEffect(() => {
    setRequestAnswers((previous) => previous.some(unsettledAnswer) ? previous.filter((item) => !unsettledAnswer(item)) : previous);
  }, [setRequestAnswers]);
  // Phones and tablets: a message rests just above the tab bar. Inside an open chat the reply box
  // can lie there instead (on a phone the bar is hidden and the box takes the bottom of the
  // screen): a message that would cover the reply box is lifted to just above it, wherever the
  // box is at the moment.
  const chatOpenOnPhone = currentTab === 'conversations' && Boolean(route.conversationId);
  const toastRef = useRef<HTMLDivElement>(null);
  const [toastLift, setToastLift] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!toast || !chatOpenOnPhone || window.matchMedia('(min-width: 1024px)').matches) { setToastLift(null); return; }
    const place = () => {
      const replyBox = document.querySelector('#conversation-thread input[aria-label="Reply as owner"]')?.closest('form')?.parentElement?.getBoundingClientRect();
      const message = toastRef.current;
      if (!replyBox || !message) { setToastLift(null); return; }
      // Where the message rests by itself: 0.75rem above the tab bar, which is 4rem high.
      const restBottom = window.innerHeight - 76;
      const covers = restBottom > replyBox.top && restBottom - message.offsetHeight < replyBox.bottom;
      // Never off the top of the screen, also when the reply box has scrolled far up.
      setToastLift(covers ? Math.min(Math.max(window.innerHeight - replyBox.top + 8, 12), window.innerHeight - 160) : null);
    };
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place); window.removeEventListener('resize', place); };
  }, [toast, chatOpenOnPhone]);
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
  // "Rooms & equipment" is gone: a tab that was open before still holds its list, which is taken out.
  useEffect(() => forgetRetiredDemoState(), []);
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
  // The badge on Home counts what Home lists as requests: those from the booking page and those waiting in a chat.
  const openRequests = openRequestCount(requests, allConversations);
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

  // Home request actions. Each returns null when it is done, or why it could not be done: Home
  // shows that on the request itself. The owner's rules decide (a service that is not offered
  // online can be accepted), and a request keeps the length it was made with.
  const handleAcceptRequest = (id: string): string | null => {
    const index = requests.findIndex((r) => r.id === id);
    if (index < 0) return 'This request is no longer waiting.';
    const accepted = requests[index];
    const { refusal } = checkRequest(availabilityContext, accepted);
    if (refusal) return refusal;

    const newCalEvent = appointmentFromRequest(accepted, services, employees);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    setSubmittedRequest((previous) => previous?.id === id ? { ...accepted, status: 'accepted' } : previous);
    commitCalendarEvent(newCalEvent);
    if (route.requestId === id) navigate({ tab: 'home' });
    setRequestAnswers((previous) => withAnswer(previous, { kind: 'request', id, outcome: 'accepted', at: Date.now(), request: accepted, index }));
    return null;
  };

  const handleRejectRequest = (id: string) => {
    const index = requests.findIndex(request => request.id === id);
    if (index < 0) return;
    const request = requests[index];
    setRequests(previous => previous.filter(item => item.id !== id));
    setSubmittedRequest((previous) => previous?.id === id ? { ...previous, status: 'rejected' } : previous);
    if (route.requestId === id) navigate({ tab: 'home' });
    setRequestAnswers((previous) => withAnswer(previous, { kind: 'request', id, outcome: 'rejected', at: Date.now(), request, index }));
  };

  /** Takes back the answer to a request: the request waits again as it did before. */
  const handleUndoAnswer = (id: string): string | null => {
    const answer = requestAnswers.find((item) => item.kind === 'request' && item.id === id);
    if (!answer || answer.kind !== 'request') return null;
    const before = answer.request;
    if (answer.outcome === 'accepted') {
      const appointment = calendarEvents.find((event) => event.id === appointmentIdForRequest(id));
      const standing = acceptedAppointmentState(before, appointment);
      // Moved or edited in the calendar since: taking the acceptance back would throw that away.
      if (standing === 'changed') return 'The appointment was changed in the calendar after you accepted. Change or cancel it there.';
      // Cancelled in the calendar since (Home no longer shows the answer then): that decision stands.
      if (standing === 'gone') return 'The appointment was cancelled in the calendar after you accepted. If the customer still wants it, add it by hand in the calendar.';
      // The appointment that the acceptance created goes, and with it what held the time.
      setCalendarEvents((previous) => previous.filter((event) => event.id !== appointmentIdForRequest(id)));
      setRequests((previous) => restoreAt(previous, before, answer.index));
    } else {
      // Somebody else may have got the time meanwhile: the request only comes back to a time that is free.
      const { why } = checkRequest(availabilityContext, before);
      if (why) return answer.outcome === 'moved'
        ? `The request cannot go back to the time it had: ${why}`
        : `The request cannot come back: ${why} If the customer still wants an appointment, add it by hand in the calendar.`;
      setRequests((previous) => answer.outcome === 'moved' ? previous.map((item) => item.id === id ? before : item) : restoreAt(previous, before, answer.index));
    }
    setSubmittedRequest((previous) => previous?.id === id ? { ...before, status: 'pending' } : previous);
    setRequestAnswers((previous) => previous.filter((item) => item !== answer));
    return null;
  };

  const handleDismissAnswer = (kind: RequestAnswer['kind'], id: string) =>
    setRequestAnswers((previous) => previous.filter((item) => !(item.kind === kind && item.id === id)));

  const handleMoveRequest = (id: string, date: string, startTime: string): string | null => {
    const index = requests.findIndex(item => item.id === id);
    if (index < 0) return 'This request is no longer available.';
    const request = requests[index];
    const updatedRequest = movedRequest(request, date, startTime);
    const { why } = checkRequest(availabilityContext, updatedRequest);
    if (why) return `${why} Choose another date or time.`;
    setRequests(previous => previous.map(item => item.id === id ? updatedRequest : item));
    setSubmittedRequest((previous) => previous?.id === id ? updatedRequest : previous);
    // Moved twice in a row: "Undo" and the text for the customer still start from the time the
    // customer asked for. Moved back to that time: nothing is left to undo or to tell.
    const earlier = requestAnswers.find((item) => item.kind === 'request' && item.id === id && item.outcome === 'moved' && answerIsShown(item, new Date()));
    const asked = earlier?.kind === 'request' ? earlier.request : request;
    setRequestAnswers((previous) => asked.date === updatedRequest.date && asked.timeStr === updatedRequest.timeStr
      ? previous.filter((item) => !(item.kind === 'request' && item.id === id))
      : withAnswer(previous, { kind: 'request', id, outcome: 'moved', at: Date.now(), request: asked, index }));
    return null;
  };

  // The customers' page in another tab of this browser hands its requests over (requestBridge.ts):
  // a request sent after "Open as customer" appears on Home here. The listener is set up once, so
  // it reads the latest lists from a ref, and it writes its result back to the ref at once: two
  // messages can arrive before the screen is drawn again, and the second must see the first.
  const ownerLists = useRef({ requests, customers });
  ownerLists.current = { requests, customers };
  const calendarNow = useRef(calendarEvents);
  calendarNow.current = calendarEvents;
  const handedOver = useRef(new Set<string>());
  useEffect(() => {
    if (publicMode) return;
    return listenForRequests((message) => {
      // Already handed over in this tab, or already an appointment: a second "new" adds nothing.
      const answered = (id: string) => handedOver.current.has(id) || calendarNow.current.some((event) => event.id === appointmentIdForRequest(id));
      const next = applyBridgedRequest(ownerLists.current, message, answered);
      if (!next) return;
      ownerLists.current = next;
      if (message.kind === 'new') handedOver.current.add(message.request.id);
      setRequests(next.requests);
      setCustomers(next.customers);
      if (message.kind === 'new') showToast(`New booking request from ${message.request.customerName}`, 'info');
    });
  }, [publicMode]);

  const handleNewBookingRequest = (request: AppointmentRequest): string | null => {
    const error = validateContact(request.customerName, request.customerPhone ?? '') ?? validateBookingRequest(availabilityContext, request);
    if (error) return error;
    if (requests.some((item) => item.id === request.id)) return 'This request has already been submitted.';
    const customer = customerForRequest(customers, request);
    const saved = { ...request, customerId: customer.id, customerPhone: customer.phone, isAiBooked: false, createdAt: request.createdAt ?? new Date().toISOString() };
    setRequests((previous) => [saved, ...previous]);
    setCustomers((previous) => upsertCustomer(previous, customer));
    // On the customers' page: hand the request to the owner's tab in this browser (requestBridge.ts).
    if (publicMode) announceRequest({ kind: 'new', request: saved });
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
    if (publicMode) announceRequest({ kind: 'updated', request: saved });
    showToast('Booking request updated');
    return null;
  };

  const handleCancelBookingRequest = (id: string): string | null => {
    if (!requests.some((item) => item.id === id && item.status === 'pending')) return 'This request is no longer pending.';
    setRequests((previous) => previous.filter((item) => item.id !== id));
    setSubmittedRequest((previous) => previous?.id === id ? { ...previous, status: 'cancelled' } : previous);
    if (publicMode) announceRequest({ kind: 'cancelled', id });
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
  // "New appointment" in the header and "+" in the tab bar on phones take the same way, from every screen.
  const newAppointment = () => { if (setCurrentTab('calendar')) setStartNewAppointment(true); };

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

  // "Export CSV" in Analytics writes the report for the period chosen there: the figures on
  // screen and the appointments they are counted from.
  const handleExportReport = (period: Period) => {
    const clock = getSalonNow(companySettings.timeZone, now);
    const report = analyticsReport({
      companyName: companySettings.companyName,
      events: calendarEvents,
      period,
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

  // Shifts (Team › This week)
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

  // A delete asks first, in the form it is started from. It still offers Undo afterwards: a quick
  // second tap on a touch screen should never cost a record.
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

  /** Why a person cannot be deleted right now: appointments or pending requests still use them. */
  const employeeDeletionBlocker = (employee: Employee) => deletionDependency('employee', employee.id, employee.name, calendarEvents, requests);

  // Called from the person's form in Team, after its question. The reason for a refusal goes back to the form.
  const handleDeleteEmployee = (id: string): string | null => {
    const index = employees.findIndex((e) => e.id === id);
    if (index < 0) return null;
    const removed = employees[index];
    const error = employeeDeletionBlocker(removed);
    if (error) return error;
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
    return null;
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
    showToast('Settings saved');
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

  // Taking over happens inside the open chat, and the chat says it at once ("You've taken over.
  // The AI is paused for this chat."). A message on top would only repeat that, and on a small
  // phone it lay over the button that hands the chat back. So only a failure gets a message.
  const handleTakeOver = (id: string) => {
    if (isLiveConversation(id)) {
      void live.takeOver(id).then(error => { if (error) showToast(error, 'error'); });
      return;
    }
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, takenOver: true } : c))
    );
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

  /**
   * A live chat's booking request: add it to the calendar (with the usual checks), then tell the
   * customer in the chat. From Home (`fromHome`) the outcome is shown on the request itself and
   * the function returns why it could not be done; from the chat page it is shown as a message.
   */
  const handleConfirmLiveBooking = (id: string, fromHome = false): string | null => {
    const conversation = allConversations.find((item) => item.id === id);
    // Which service, which stylist (the first who offers it and is free) and whether it can be booked at all.
    const plan = conversation ? planChatBooking(availabilityContext, conversation) : null;
    if (!conversation || !plan) return fromHome ? 'This booking request is no longer waiting.' : null;
    const refuse = (message: string) => { if (!fromHome) showToast(message, 'error'); return message; };
    if (!plan.action || !plan.employee || !plan.endTime) return refuse(plan.refusal ?? 'This booking request cannot be accepted.');
    const { action, booking: request, employee: stylist } = plan;
    const customerName = chatBookingName(conversation.customerName, request.customerName);
    const result = applyConversationAppointment({ ...conversation, customerName }, action, true);
    if ('error' in result) return refuse(result.error);
    if (fromHome) {
      setRequestAnswers((previous) => withAnswer(previous, {
        kind: 'chat', id, at: Date.now(), appointmentId: action.appointmentId, customerName, serviceName: plan.serviceName,
        staffName: stylist.name, date: request.date, startTime: request.time, endTime: plan.endTime!, delivery: 'pending',
      }));
    }
    void live.confirmBooking(id).then((sendError) => {
      if (fromHome) {
        setRequestAnswers((previous) => previous.map((item) => item.kind === 'chat' && item.id === id
          ? { ...item, delivery: sendError ? 'failed' : 'done', problem: sendError ?? undefined } : item));
        return;
      }
      showToast(
        sendError ? `Added to the calendar, but the confirmation was not sent: ${sendError}` : `Booked: ${plan.serviceName}, ${request.time} with ${stylist.name}. The customer got the confirmation.`,
        sendError ? 'error' : 'success',
      );
    });
    return null;
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
      {/* The menu on laptops. Phones and tablets have the tab bar and "More" below. */}
      <Sidebar
        companyName={companySettings.companyName}
        companyLocation={[companySettings.city, companySettings.country].filter(Boolean).join(', ')}
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        pendingRequestsCount={openRequests}
        needsAttentionCount={needsAttention.length}
        onOpenPilotInterest={() => setIsPilotInterestOpen(true)}
      />

      {/* Main App Container */}
      <div id="app-content" className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <Header
          title={SCREEN_NAMES[currentTab]}
          {...headerAccount(employees)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          customers={customers}
          appointmentRequests={requests}
          calendarEvents={calendarEvents}
          onSelectAppointment={openAppointment}
          onSelectCustomer={(cust) => {
            navigate({ tab: 'customers', customerId: cust.id });
            setSearchQuery('');
          }}
          onSelectRequest={(req) => {
            navigate({ tab: 'home', requestId: req.id });
            setSearchQuery('');
          }}
          onNewAppointment={newAppointment}
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
          {currentTab === 'home' && (
            <HomeView
              requests={requests}
              selectedRequestId={route.requestId ?? null}
              availabilityContext={availabilityContext}
              customers={customers}
              salonName={companySettings.companyName}
              answers={requestAnswers}
              onOpenAppointment={openAppointment}
              onAcceptRequest={handleAcceptRequest}
              onRejectRequest={handleRejectRequest}
              onMoveRequest={handleMoveRequest}
              onUndoAnswer={handleUndoAnswer}
              onDismissAnswer={handleDismissAnswer}
              onAcceptChatRequest={(id) => handleConfirmLiveBooking(id, true)}
              onSimulateNewRequest={handleSimulateNewRequest}
              now={now}
              onOpenCalendar={() => { setCalendarDate(getSalonNow(companySettings.timeZone).date); setCurrentTab('calendar'); }}
              onOpenAnalytics={() => setCurrentTab('analytics')}
              conversations={allConversations}
              onOpenConversations={openConversation}
              onOpenCustomer={(id) => navigate({ tab: 'customers', customerId: id })}
              bookingLink={<BookingLinkCompact />}
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

          {currentTab === 'team' && (
            <TeamView
              tab={route.section as TeamSubTab | undefined}
              onTabChange={(section) => navigate({ tab: 'team', section }, { replace: true })}
              employees={employees}
              onAddEmployee={handleAddEmployee}
              onUpdateEmployee={handleUpdateEmployee}
              onDeleteEmployee={handleDeleteEmployee}
              deletionBlocker={employeeDeletionBlocker}
              companyName={companySettings.companyName}
              shiftOverview={shiftOverview}
              onUpdateShift={handleUpdateShift}
              absences={absences}
              onSaveAbsences={setAbsences}
              timeZone={companySettings.timeZone}
              onUnsavedChange={noteUnsaved}
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
              cannotDelete={(customer) => deletionDependency('customer', customer.id, customer.name, calendarEvents, requests)}
              onOpenChat={openChatForCustomer}
            />
          )}

          {currentTab === 'services' && (
            <ServicesView
              services={services}
              employees={employees}
              onAddService={handleAddService}
              onUpdateService={handleUpdateService}
              onDeleteService={handleDeleteService}
              cannotDelete={(service) => deletionDependency('service', service.id, service.name, calendarEvents, requests)}
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
              tab={route.section as SettingsSubTab | undefined}
              onTabChange={(section) => navigate({ tab: 'settings', section }, { replace: true })}
              settings={companySettings}
              bookingHours={bookingHours}
              onSaveSettings={handleSaveSettings}
              closedDates={closedDates}
              onSaveClosedDates={setClosedDates}
              onOpenAbsences={() => navigate({ tab: 'team', section: 'absences' })}
              onUnsavedChange={noteUnsaved}
            />
          )}
        </main>

        {/* Phones and tablets: app-style tab bar. Hidden inside an open chat, like messaging apps. */}
        <BottomNav
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          onNewAppointment={newAppointment}
          onOpenMore={() => setIsMoreOpen(true)}
          isMoreOpen={isMoreOpen}
          homeBadge={openRequests}
          chatsBadge={needsAttention.length}
          hideOnPhone={chatOpenOnPhone}
        />
        {/* What the tab bar has no room for, and who is signed in. */}
        <MoreSheet
          isOpen={isMoreOpen}
          onClose={() => setIsMoreOpen(false)}
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          {...headerAccount(employees)}
          companyName={companySettings.companyName}
          onOpenPilotInterest={() => setIsPilotInterestOpen(true)}
        />
      </div>

      {/* Feedback distinguishes a completed action from a problem or demo information.
          Phones and tablets: just above the tab bar (4rem high, plus the phone's own bottom inset),
          never over it and never over the page's title or buttons at the top.
          On wide screens the assistant can be docked on the right (it sets --assistant-dock to its
          width): the toast then moves left by that much and never lies over the assistant's input.
          While it is docked a long message also has to stay clear of the menu on the left (16rem),
          so it wraps earlier: min(16rem, dock) is the menu's width then, and nothing otherwise. */}
      {toast && (
        <div ref={toastRef} role={toast.kind === 'error' ? 'alert' : 'status'} style={toastLift === null ? undefined : { bottom: toastLift }} className="fixed inset-x-4 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] z-40 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl sm:inset-x-auto sm:right-5 lg:bottom-5 sm:max-w-[calc(100vw-2.5rem)] sm:flex-nowrap xl:right-[calc(1.25rem+var(--assistant-dock,0px))] xl:max-w-[calc(100vw-2.5rem-var(--assistant-dock,0px)-min(16rem,var(--assistant-dock,0px)))]">
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

