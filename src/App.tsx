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
  TimeBlock,
  ShiftEntry,
  Conversation,
  AiAssistantSettings,
  SettingsSubTab,
  TeamSubTab,
} from './types';
import { DEFAULT_DEMO_CONVERSATION_ID, initialAiSettings } from './conversationData';
import { sampleChatAfterAi, sampleChatAfterOwnerReply } from './sampleChatFlow';
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
import { AppointmentForm } from './components/AppointmentForm';
import { SalonTimeNote } from './components/SalonTimeNote';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { bookingPageHead, ownerPageHead, usePageHead } from './pageHead';
import { AppRoute, calendarPlace, isOldAddress, parseRoute, routeForTab, routeHash, SCREEN_NAMES, type CalendarPlace, type RetiredTab } from './navigation';
import { changeAddress, useBackClosesOverlays } from './backGesture';
import { analyticsReport, type Period } from './analytics';
import { downloadCsv } from './csv';
import { PRODUCT_NAME } from './brand';
import { formatDate } from './scheduling';
import { getSalonNow, isOutsideOpeningHours, validateBookingRequest, validateCalendarEvent } from './availability';
import { dayChangesSummary, isValidDayChange, undoDayChanges, withDayChanges, withoutRegularDays, type DayChange } from './workingHours';
import { withServicesOf } from './teamBooking';
import { appointmentForConversation, belongsToConversation, appointmentFromRequest, appointmentFromConversationAction, appointmentIdForRequest, upsertAppointment } from './appointmentActions';
import { answerIsShown, openRequestCount, unsettledAnswer, withAnswer, type RequestAnswer } from './inbox';
import { acceptedAppointmentState, chatOfFormBooking, checkRequest, movedRequest, restoreConfirmedBooking } from './requestAnswers';
import { arrivedRequests, isRequestersAppointment, withOutcome, type RequestOutcomes } from './sharedRequests';
import { BookingLinkCompact } from './components/BookingLinkCard';

import { createDemoWorkspace, type DemoWorkspace } from './demoWorkspace';
import { createIncomingRequest } from './demoRequests';
import { forgetRetiredDemoState, useDemoState, watchDemoState } from './useDemoState';
import { isLiveConversation, useLiveWhatsApp } from './liveWhatsApp';
import { chatPhoneAfterCustomerEdit, customerForAppointment, customerForRequest, isPhoneNumber, normalizePhone, upsertCustomer, validateContact, type ChatContact } from './bookingData';
import { deletionDependency } from './managementDependencies';
import { blockTitle, timeBlockProblem } from './timeBlocks';
import { formatTimeRange } from './format';
import { headerAccount } from './headerModels';
import { savedMessage, type AppointmentFormRequest, type AppointmentSave } from './appointmentForm';
import type { ChatBookingAction } from './chatBookingActions';
import { answerChatBooking, chatCustomer, chatCustomerRecord } from './chatBookingAnswers';
import { sampleChatAfter } from './sampleChatFlow';

// The starting data that depend on the date (calendar, customers, chats, requests, shifts) are
// built together, for one moment, so that they agree: the moment the stored salon was started,
// which useDemoState hands in and every tab of this browser shares. Built once per such moment.
let startingWorkspace: { builtAt: number; data: DemoWorkspace } | null = null;
const startingData = (builtAt: Date): DemoWorkspace => {
  if (startingWorkspace?.builtAt !== builtAt.getTime()) startingWorkspace = { builtAt: builtAt.getTime(), data: createDemoWorkspace(undefined, builtAt) };
  return startingWorkspace.data;
};

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
  // while, with "Undo". Kept with the stored salon: a phone that reloads the page after the owner
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
    // The phone's keyboard moves the reply box (the chat screen takes the visible part of the screen).
    const viewport = window.visualViewport;
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    viewport?.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place); window.removeEventListener('resize', place); viewport?.removeEventListener('resize', place); };
  }, [toast, chatOpenOnPhone]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    const refreshClock = () => { if (!document.hidden) setNow(new Date()); };
    document.addEventListener('visibilitychange', refreshClock);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refreshClock); };
  }, []);

  // Core application states
  const [requests, setRequests] = useDemoState<AppointmentRequest[]>('requests', (builtAt) => startingData(builtAt).requests);
  const [calendarEvents, setCalendarEvents] = useDemoState<CalendarEvent[]>('calendarEvents', (builtAt) => startingData(builtAt).events);
  const [customers, setCustomers] = useDemoState<Customer[]>('customers', (builtAt) => startingData(builtAt).customers);
  const [employees, setEmployees] = useDemoState<Employee[]>('employees', initialEmployees);
  const [services, setServices] = useDemoState<ServiceItem[]>('services', initialServices);
  // "Rooms & equipment" is gone: a tab that was open before still holds its list, which is taken out.
  useEffect(() => forgetRetiredDemoState(), []);
  const [shiftOverview, setShiftOverview] = useDemoState<ShiftEntry[]>('shifts', (builtAt) => startingData(builtAt).shifts);
  const [companySettings, setCompanySettings] = useDemoState<CompanySettingsData>('companySettings', initialCompanySettings);
  const [bookingHours, setBookingHours] = useDemoState<BookingHoursDay[]>('bookingHours', initialBookingHours);
  const [conversations, setConversations] = useDemoState<Conversation[]>('conversations', (builtAt) => startingData(builtAt).conversations);
  // Real chats from the live channels (on a device signed in with the owner link); shown above the built-in chats.
  // The public booking page is a customer's page: it never asks the server for them.
  const live = useLiveWhatsApp(!publicMode);
  const allConversations = [...live.conversations, ...conversations];
  /** "Sign out on this device" (Settings and the chat screen): the browser forgets the owner key. */
  const signOutHere = () => {
    live.signOut();
    showToast('Signed out on this device. Live chats are no longer shown here.', 'info');
  };
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
  // Time the owner keeps free for a stylist (a break, lunch): nothing can be booked in it.
  const [timeBlocks, setTimeBlocks] = useDemoState<TimeBlock[]>('timeBlocks', []);
  const [bookingDraft, setBookingDraft] = useDemoState<BookingDraft>('draft', () => createBookingDraft(services, companySettings.timeZone));
  const [submittedRequest, setSubmittedRequest] = useDemoState<AppointmentRequest | null>('submittedRequest', null);
  // What the owner answered to each request from the booking page. The customers' page, in
  // another tab of this browser, reads it there: that is how it learns the answer (sharedRequests.ts).
  const [, setRequestOutcomes] = useDemoState<RequestOutcomes>('requestOutcomes', {});
  const availabilityContext = { services, employees, bookingHours, shiftOverview, events: calendarEvents, requests, closedDates, absences, timeBlocks, timeZone: companySettings.timeZone };
  // The salon as it is now, for an Undo that is pressed a few seconds after its message appeared.
  const latestSalon = useRef(availabilityContext);
  latestSalon.current = availabilityContext;

  const needsAttention = allConversations.filter((c) => c.status === 'needs-attention');
  // The badge on Home counts what Home lists as requests: those from the booking page and those waiting in a chat.
  const openRequests = openRequestCount(requests, allConversations);
  // The calendar's day, view and filters are part of the address (src/navigation.ts), so reload,
  // Back and a shared link restore them. An address without a day means today. While an
  // appointment's details are open, the calendar behind them shows that appointment's day.
  const selectedCalendarEvent = calendarEvents.find(event => event.id === route.appointmentId);
  const salonToday = getSalonNow(companySettings.timeZone, now).date;
  const calendarDate = selectedCalendarEvent?.date ?? route.date ?? salonToday;
  /**
   * Shows another day, view or filter in the calendar that is open. The address follows without
   * a new history entry: Back leaves the calendar instead of walking through every day that was
   * looked at. On another screen nothing happens; the calendar opens on today from there.
   */
  const showInCalendar = (change: CalendarPlace) => {
    const current = openRoute.current;
    if (current.tab !== 'calendar') return;
    const { date, ...place } = calendarPlace({ ...current, ...change });
    const next: AppRoute = { tab: 'calendar', ...place, ...(date && date !== getSalonNow(companySettings.timeZone).date ? { date } : {}) };
    const hash = routeHash(next);
    if (hash === routeHash(current)) return;
    // At once, so that a second change in the same moment builds on this one.
    openRoute.current = next;
    setRoute(next);
    // The address follows a moment later. The appointment form saves and closes in one step,
    // and its own history entry has to be taken away first: written now, the new address would
    // land on that entry and stay behind as a second calendar to go Back through.
    window.setTimeout(() => { if (routeHash(openRoute.current) === hash) changeAddress(hash, true); }, 0);
  };
  const showCalendarDate = (date: string) => showInCalendar({ date });
  const openAppointment = (event: CalendarEvent) => {
    setSearchQuery('');
    // The address names the appointment's day, so the calendar stays on it once the details are closed.
    navigate({ tab: 'calendar', ...(event.date !== salonToday ? { date: event.date } : {}), appointmentId: event.id });
  };

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
    // Booked beside the open calendar (the assistant in its drawer): the calendar shows the day at
    // once. Under a form or a sheet it stays put: what covers it says where to go when it closes.
    if (!document.querySelector('dialog[open]')) showCalendarDate(saved.date);
    // The customers' page follows its accepted request, but only while the appointment is still
    // that customer's: given to somebody else, it must not take over the other person's details.
    setSubmittedRequest(previous => previous && `cal-${previous.id}` === saved.id && isRequestersAppointment(previous, saved) ? {
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
    setRequestOutcomes((previous) => withOutcome(previous, id, 'accepted'));
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
    setRequestOutcomes((previous) => withOutcome(previous, id, 'rejected'));
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
    setRequestOutcomes((previous) => withOutcome(previous, id, null));
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
    // Moved twice in a row: "Undo" and the text for the customer still start from the time the
    // customer asked for. Moved back to that time: nothing is left to undo or to tell.
    const earlier = requestAnswers.find((item) => item.kind === 'request' && item.id === id && item.outcome === 'moved' && answerIsShown(item, new Date()));
    const asked = earlier?.kind === 'request' ? earlier.request : request;
    setRequestAnswers((previous) => asked.date === updatedRequest.date && asked.timeStr === updatedRequest.timeStr
      ? previous.filter((item) => !(item.kind === 'request' && item.id === id))
      : withAnswer(previous, { kind: 'request', id, outcome: 'moved', at: Date.now(), request: asked, index }));
    return null;
  };

  // The customers' page in another tab of this browser ("Open as customer") shares the stored
  // salon with this tab (useDemoState): a request sent there is in the list here by itself, and so
  // are a change to it and its withdrawal. This tab only says that one has come in: for a request
  // it has not shown before, never for its own changes and never for what was stored when it opened.
  const seenRequests = useRef(new Set<string>());
  for (const item of requests) seenRequests.current.add(item.id);
  useEffect(() => {
    if (publicMode) return;
    return watchDemoState<AppointmentRequest[]>('requests', (before, after) => {
      const arrived = arrivedRequests(before, after, seenRequests.current);
      if (arrived.length > 0) showToast(arrived.length === 1 ? `New booking request from ${arrived[0].customerName}` : `${arrived.length} new booking requests`, 'info');
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
    showToast(`Booking request saved for ${request.customerName}`);
    return null;
  };

  const handleUpdateBookingRequest = (request: AppointmentRequest): string | null => {
    const existing = requests.find((item) => item.id === request.id && item.status === 'pending');
    if (!existing) return 'This request is no longer pending. Check its latest status before making changes.';
    const error = validateContact(request.customerName, request.customerPhone ?? '') ?? validateBookingRequest(availabilityContext, request, request.id);
    if (error) return error;
    const customer = customerForRequest(customers, { ...request, customerId: existing.customerId });
    // The customer's own change is a new wish: the request no longer stands at a time the salon suggested.
    const { movedFrom: _suggestedBefore, ...wish } = request;
    const saved = { ...wish, customerId: customer.id, customerPhone: customer.phone, isAiBooked: false, createdAt: request.createdAt ?? existing.createdAt };
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

  // The appointment form (src/components/AppointmentForm.tsx) is one form for the whole app, shown
  // over the screen the owner is on: nothing jumps to the Calendar. Whoever wants an appointment
  // added or changed calls openAppointmentForm, with what is known already: a customer, a place in
  // the calendar (day, half hour, stylist, service), or the appointment to change.
  const [appointmentForm, setAppointmentForm] = useState<{ request: AppointmentFormRequest; opening: number } | null>(null);
  // Counted, so that every opening starts a fresh form.
  const formOpenings = useRef(0);
  const openAppointmentForm = (request: AppointmentFormRequest) => {
    formOpenings.current += 1;
    setAppointmentForm({ request, opening: formOpenings.current });
  };
  // "New appointment" in the header and "+" in the tab bar on phones, from every screen.
  const newAppointment = () => openAppointmentForm({ kind: 'new' });
  // The Calendar page still carries its own form and this wish to open it. Nothing sets the wish
  // any more; it goes when the calendar hands its "Add" and "Edit" to openAppointmentForm.

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
  /** Says that an appointment is stored. "View" opens it in the calendar, from whatever screen the owner is on. */
  const announceAppointment = (message: string, saved: CalendarEvent) =>
    showToast(message, 'success', { label: 'View', onClick: () => { setToast(null); openAppointment(saved); } });
  const saveCalendarEvent = (ev: Omit<CalendarEvent, 'id'>, id: string): string | null => {
    const adding = !calendarEvents.some(event => event.id === id);
    const result = storeCalendarEvent(ev, id);
    if ('error' in result) return result.error;
    announceAppointment(`Appointment ${adding ? 'added' : 'updated'} for ${ev.customerName}`, result.saved);
    return null;
  };
  const handleAddCalendarEvent = (ev: Omit<CalendarEvent, 'id'>): string | null => saveCalendarEvent(ev, `cal-${crypto.randomUUID()}`);
  const handleUpdateCalendarEvent = (id: string, ev: Omit<CalendarEvent, 'id'>): string | null => {
    if (!calendarEvents.some(event => event.id === id)) return 'This appointment no longer exists.';
    return saveCalendarEvent(ev, id);
  };
  /**
   * Saves what the appointment form holds: the appointment with the customer's record as the
   * owner picked or entered it. A time outside the usual hours changes nobody's working hours.
   * Returns why it could not be saved; the form shows that.
   */
  const handleSaveAppointment = (save: AppointmentSave): string | null => {
    if (save.appointmentId !== null && !calendarEvents.some(event => event.id === save.appointmentId)) {
      return 'This appointment is no longer in the calendar. It may have been cancelled in the meantime.';
    }
    // Booked from a chat's "Book" for that chat's customer: the appointment belongs to the chat, so a
    // request waiting there sees it and is not booked a second time.
    const conversationId = chatOfFormBooking(chatFormLink.current, appointmentForm?.opening, save);
    const result = storeCalendarEvent(conversationId ? { ...save.event, conversationId } : save.event, save.appointmentId ?? `cal-${crypto.randomUUID()}`,
      save.customer ? { record: save.customer } : undefined);
    if ('error' in result) return result.error;
    // A first number goes onto the customer's other appointments, requests and chat too, as an edit in Customers does.
    if (save.customer && save.addsPhone) handleUpdateCustomer(save.customer.id, { phone: save.customer.phone });
    // Last, so that this is the message that stays: the change above announces itself.
    announceAppointment(savedMessage(save, result.saved), result.saved);
    return null;
  };

  const handleDeleteCalendarEvent = (id: string) => {
    const index = calendarEvents.findIndex((e) => e.id === id);
    if (index < 0) return;
    const removed = calendarEvents[index];
    setCalendarEvents((previous) => previous.filter((e) => e.id !== id));
    setSubmittedRequest((previous) => previous && `cal-${previous.id}` === id ? { ...previous, status: 'cancelled' } : previous);
    // A chat in which this appointment was confirmed: nothing goes out to the customer from here, so say so.
    const confirmedIn = allConversations.find((chat) => (removed.conversationId === chat.id || chat.appointmentId === removed.id)
      && chat.bookingRequest?.status === 'confirmed');
    // One tap removes an appointment, so the message offers the way back, as it does for customers and blocks.
    showToast(`Appointment of ${removed.customerName} removed from the calendar${confirmedIn ? `. ${confirmedIn.customerName} was not told.` : ''}`, 'info', { label: 'Undo', onClick: () => {
      const now = latestSalon.current;
      if (now.events.some((event) => event.id === removed.id)) { setToast(null); return; }
      // Somebody else may have got the time meanwhile: then the appointment cannot simply come back.
      const sameStylist = (record: { employeeId?: string; staffName?: string }) =>
        removed.employeeId !== undefined ? record.employeeId === removed.employeeId : record.staffName === removed.staffName;
      const taken = now.events.some((event) => event.date === removed.date && sameStylist(event) && event.startTime < removed.endTime && event.endTime > removed.startTime)
        || (now.timeBlocks ?? []).some((block) => block.date === removed.date && block.employeeId === removed.employeeId && block.startTime < removed.endTime && block.endTime > removed.startTime);
      if (taken) { showToast('The appointment cannot be put back: the time has been taken meanwhile. Add it again at another time.', 'error'); return; }
      setCalendarEvents((previous) => previous.some((event) => event.id === removed.id) ? previous : restoreAt(previous, removed, index));
      setToast(null);
    } });
  };

  // Time blocks (Calendar › Block time). A block is checked like a booking would be: it may not
  // cover an appointment or a waiting request. Removing one asks nothing and offers Undo instead.
  const handleSaveTimeBlock = (values: Omit<TimeBlock, 'id'>, original?: TimeBlock): string | null => {
    if (original && !timeBlocks.some((item) => item.id === original.id)) return 'This block no longer exists.';
    const problem = timeBlockProblem({ ...availabilityContext, now: new Date() }, values, original);
    if (problem) return problem;
    const name = employees.find((item) => item.id === values.employeeId)?.name ?? 'the stylist';
    if (original) {
      setTimeBlocks((previous) => previous.map((item) => item.id === original.id ? { ...values, id: original.id } : item));
      showToast(`Block changed: ${name}, ${formatDate(values.date)}, ${formatTimeRange(values.startTime, values.endTime)}`);
    } else {
      setTimeBlocks((previous) => [...previous, { ...values, id: `block-${crypto.randomUUID()}` }]);
      showToast(`${blockTitle(values)} blocked for ${name}: ${formatDate(values.date)}, ${formatTimeRange(values.startTime, values.endTime)}`);
    }
    return null;
  };
  const handleRemoveTimeBlock = (id: string) => {
    const index = timeBlocks.findIndex((item) => item.id === id);
    if (index < 0) return;
    const removed = timeBlocks[index];
    setTimeBlocks((previous) => previous.filter((item) => item.id !== id));
    showToast('Block removed', 'info', { label: 'Undo', onClick: () => {
      // Something may have been booked into the freed time meanwhile: then the block cannot come back.
      const problem = timeBlockProblem({ ...latestSalon.current, now: new Date() }, removed, removed);
      if (problem) { showToast(`The block cannot be put back. ${problem}`, 'error'); return; }
      setTimeBlocks((previous) => restoreAt(previous, removed, index));
      setToast(null);
    } });
  };

  // Working hours of single days (Team › This week). A person's regular week is part of the
  // person; what is stored here are the days that differ: other hours, or a day off. A day that
  // is set back to its regular hours is taken out again. `note` says what happened when several
  // days change at once ("Copy last week"); such a change can be undone in one tap.
  const handleUpdateShift = (changes: DayChange[], note?: string) => {
    const valid = changes.filter((change) => isValidDayChange(change) && employees.some((item) => item.id === change.employeeId));
    if (valid.length === 0) return;
    const before = undoDayChanges(shiftOverview, valid);
    setShiftOverview((prev) => withDayChanges(prev, employees, valid));
    showToast(note ?? dayChangesSummary(valid, employees), 'success', note !== undefined || valid.length > 1 ? {
      label: 'Undo',
      onClick: () => { setShiftOverview((prev) => withDayChanges(prev, employees, before)); setToast(null); },
    } : undefined);
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
    // The note concerns the record alone; the profile says itself that it was saved.
    if (Object.keys(partial).every(key => key === 'note')) {
      setCustomers(previous => previous.map(item => item.id === id ? { ...item, note: partial.note } : item));
      return;
    }
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
  // `serviceIds`: the services ticked in the person's form. The new person's id goes back to the
  // form, which then says what is still missing before customers can book them.
  const handleAddEmployee = (
    emp: Omit<Employee, 'id' | 'initials' | 'name'>,
    serviceIds: string[] = [],
  ): string => {
    const fullName = `${emp.firstName} ${emp.lastName}`.trim();
    const initials = `${emp.firstName[0] || ''}${emp.lastName[0] || ''}`.toUpperCase();
    const newEmployee: Employee = {
      ...emp,
      id: `emp-${Date.now()}`,
      name: fullName,
      initials: initials || 'EM',
    };
    setEmployees([...employees, newEmployee]);
    assignServices(newEmployee.id, serviceIds);
    showToast(`Employee ${fullName} added`);
    return newEmployee.id;
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
    // Blocked times belong to the person: they go with them, and come back with "Undo".
    const removedBlocks = timeBlocks.filter(block => block.employeeId === id);
    setTimeBlocks(previous => previous.filter(block => block.employeeId !== id));
    setServices(previous => previous.map(service => {
      const assignedEmployeeIds = service.assignedEmployeeIds?.filter(employeeId => employeeId !== id);
      return { ...service, assignedEmployeeIds, assignedEmployeesCount: assignedEmployeeIds?.length ?? 0 };
    }));
    showToast(`Employee ${removed.name} deleted`, 'info', { label: 'Undo', onClick: () => {
      setEmployees(previous => restoreAt(previous, removed, index));
      setShiftOverview(previous => removedShifts.reduce((restored, { entry, index }) =>
        restored.some(item => item.employeeId === entry.employeeId) ? restored : [...restored.slice(0, index), entry, ...restored.slice(index)], previous));
      setAbsences(previous => removedAbsences.reduce((restored, { entry, index }) => restoreAt(restored, entry, index), previous));
      setTimeBlocks(previous => [...previous, ...removedBlocks.filter(block => !previous.some(item => item.id === block.id))]);
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

  const handleUpdateEmployee = (id: string, partial: Partial<Employee>, serviceIds?: string[]) => {
    const employee = employees.find(item => item.id === id);
    if (!employee) return;
    if (serviceIds) assignServices(id, serviceIds);
    const updated = { ...employee, ...partial, id };
    updated.name = `${updated.firstName} ${updated.lastName}`.trim();
    updated.initials = `${updated.firstName[0] ?? ''}${updated.lastName[0] ?? ''}`.toUpperCase();
    setEmployees(previous => previous.map(item => item.id === id ? updated : item));
    // A changed regular week can make a single day that was entered earlier regular again: such days leave the plan.
    setShiftOverview(previous => withoutRegularDays(previous.map(item => item.employeeId === id ? { ...item, employeeName: updated.name, initials: updated.initials } : item), updated));
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

  // The services a person offers, as ticked in their form in Team. A service's own form writes the same list.
  const assignServices = (employeeId: string, serviceIds: string[]) =>
    setServices((previous) => withServicesOf(previous, employeeId, serviceIds));

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
  // With a chat named (Home, a customer, an appointment) that chat opens; Back leads to where the
  // owner came from. Without one, the list opens; on wide screens the chat that waits longest for
  // the owner stands beside it. A live chat may still be loading: its address opens all the same,
  // and the chat screen says that it is loading.
  const openConversation = (id?: string) => {
    const target = id
      ? allConversations.find((c) => c.id === id)
      : allConversations.find((c) => c.status === 'needs-attention') ?? allConversations[0];
    if (target) setSelectedConversationId(target.id);
    navigate({ tab: 'conversations', conversationId: id && (target || isLiveConversation(id)) ? id : undefined });
  };

  // Chats and customers are linked by id, in both directions: a sample chat names its customer,
  // and a customer created from a live chat remembers that chat. Names are never compared.
  const conversationOfCustomer = (customer: Customer) => allConversations.find((c) =>
    c.customerId === customer.id || (customer.conversationId !== undefined && c.id === customer.conversationId));
  const customersWithChat = new Set(customers.filter(conversationOfCustomer).map((customer) => customer.id));
  /** The chat an appointment was booked or changed in, if it still exists and the appointment is still its own. */
  const conversationOfAppointment = (event: CalendarEvent) => allConversations.find((c) =>
    (event.conversationId !== undefined && c.id === event.conversationId) || (c.appointmentId === event.id && belongsToConversation(event, c))) ?? null;

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
      // "Sending…" and a failure (with "Try again") show on the chat itself (src/liveWhatsApp.ts).
      void live.takeOver(id);
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
   * The owner's answer to what waits in a chat: confirm, suggest another time or decline a booking
   * request or a change; cancel or keep an appointment the customer wants to cancel. A live chat
   * goes through the server, and the calendar changes only once the server has taken the answer;
   * one of the salon's own chats changes the calendar and then shows the answer (sampleChatAfter).
   * The calendar is checked as it is at this moment (src/chatBookingAnswers.ts). Resolves to why
   * it could not be done, or null. The cards show that; elsewhere a message says what was done.
   */
  const chatAnswersOnTheirWay = useRef(new Set<string>());
  const latestChats = useRef({ conversations: allConversations, apply: applyConversationAppointment });
  latestChats.current = { conversations: allConversations, apply: applyConversationAppointment };
  const handleChatBooking = async (conversationId: string, action: ChatBookingAction): Promise<string | null> => {
    const result = await answerChatBooking(conversationId, action, {
      salon: () => ({ ...latestSalon.current, now: new Date() }),
      conversation: (id) => latestChats.current.conversations.find((item) => item.id === id),
      server: live,
      // The AI took the request and the owner confirmed it: the appointment counts among those the
      // AI brought in (Home, Analytics), and its chat says "Confirmed by you". A request in a chat
      // the owner had taken over is hers alone. A time outside the opening hours is never
      // confirmed this way: the card offers no stylist for it.
      applyAppointment: (conversation, booking) => latestChats.current.apply(conversation, booking, !conversation.takenOver),
      removeAppointment: (id) => setCalendarEvents((previous) => previous.filter((event) => event.id !== id)),
      updateOwnChat: (id, answer, saved) => setConversations((previous) => previous.map((item) => item.id !== id ? item : {
        ...sampleChatAfter(item, answer, new Date(), companySettings.timeZone, companySettings.companyName),
        ...(saved ? { appointmentId: saved.id, customerId: saved.customerId } : {}),
      })),
      busy: chatAnswersOnTheirWay.current,
    });
    if ('error' in result) return result.error;
    const { done } = result;
    setRequestAnswers((previous) => withAnswer(previous, {
      kind: 'chat', id: conversationId, at: Date.now(), outcome: done.outcome, live: done.live, appointmentId: done.appointment?.id ?? '',
      customerName: done.customerName, serviceName: done.serviceName, staffName: done.staffName,
      date: done.date, startTime: done.startTime, endTime: done.endTime, asked: done.asked, delivery: 'done',
    }));
    if (done.warning) { showToast(done.warning, 'error'); return null; }
    // Home shows the answer in the request's own place; elsewhere a message says what was done.
    if (openRoute.current.tab === 'home') return null;
    const when = `${formatDate(done.date)}, ${done.startTime}`;
    const told = (what: string) => done.live ? ` ${done.customerName} has ${what} in the chat.` : '';
    if (done.outcome === 'confirmed' && done.appointment) {
      announceAppointment(`${done.moved ? 'Moved' : 'Booked'}: ${done.serviceName}, ${when} with ${done.staffName}.${told('the confirmation')}`, done.appointment);
    } else {
      showToast({
        confirmed: `Booked: ${done.serviceName}, ${when}.`,
        suggested: `Suggested ${when} with ${done.staffName}.${told('the suggestion')}`,
        declined: `Request declined.${told('the answer')}`,
        cancelled: `Appointment cancelled and removed from your calendar.${told('the cancellation')}`,
        kept: `The appointment stays. Nothing was sent: write to ${done.customerName} yourself.`,
      }[done.outcome]);
    }
    return null;
  };

  /**
   * "Book for this customer" in a chat: the appointment form with the chat's customer chosen. A
   * chat without a record yet gets one now, made from the chat and linked to it, so the booking
   * cannot make a second record of the same person.
   */
  // The chat whose "Book" opened the form, for that one opening (see handleSaveAppointment).
  const chatFormLink = useRef<{ opening: number; conversationId: string; customerId: string } | null>(null);
  const openBookingForChat = (conversationId: string) => {
    const conversation = allConversations.find((item) => item.id === conversationId);
    if (!conversation) return;
    const openFor = (customerId: string) => {
      openAppointmentForm({ kind: 'new', customerId });
      chatFormLink.current = { opening: formOpenings.current, conversationId, customerId };
    };
    const known = chatCustomer(customers, conversation, calendarEvents);
    if (known) { openFor(known.id); return; }
    const record = chatCustomerRecord(conversation, `cust-${crypto.randomUUID()}`, isPhoneNumber(conversation.phone) ? normalizePhone(conversation.phone) : '');
    setCustomers((previous) => upsertCustomer(previous, record));
    if (!isLiveConversation(conversationId)) setConversations((previous) => previous.map((item) => item.id === conversationId ? { ...item, customerId: record.id } : item));
    openFor(record.id);
  };

  /**
   * "Add to calendar" on a chat whose confirmed appointment was cancelled in the calendar: books the
   * confirmed time again under the usual rules. Nothing is sent: the customer has the confirmation.
   */
  const handleAddConfirmedToCalendar = (conversationId: string): string | null => {
    const conversation = allConversations.find((item) => item.id === conversationId);
    if (!conversation) return 'This chat is no longer available.';
    const planned = restoreConfirmedBooking({ ...latestSalon.current, now: new Date() }, conversation);
    if ('error' in planned) return planned.error;
    const result = applyConversationAppointment(conversation, planned.action, !conversation.takenOver);
    if ('error' in result) return result.error;
    if (!isLiveConversation(conversationId)) {
      setConversations((previous) => previous.map((item) => item.id === conversationId ? { ...item, appointmentId: result.saved.id, customerId: result.saved.customerId ?? item.customerId } : item));
    }
    announceAppointment(`Added to your calendar: ${result.saved.serviceName}, ${formatDate(result.saved.date)}, ${result.saved.startTime} with ${result.saved.staffName}. Nothing was sent to ${conversation.customerName}.`, result.saved);
    return null;
  };

  const handleLetAiContinue = (id: string, answerNow?: boolean): string | null => {
    if (isLiveConversation(id)) {
      // A failure shows on the chat with "Try again"; the AI's answer appears in the chat when it is sent.
      void live.letAiContinue(id, answerNow).then(error => { if (!error) showToast('The AI answers in this chat again.'); });
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

    // The AI sends its prepared answer and the chat goes on as its story says (src/sampleChatFlow.ts);
    // a booking request that waits still waits for the owner.
    const sentAt = new Date();
    const booked = action && result ? { action, staffName: result.saved.staffName } : undefined;
    setConversations((prev) => prev.map((c) => c.id !== id ? c : {
      ...sampleChatAfterAi(c, sentAt, companySettings.timeZone, booked),
      customerId: result?.saved.customerId ?? c.customerId,
    }));
    showToast('The AI is continuing this conversation');
    return null;
  };

  const handleOwnerReply = (id: string, english: string, local?: string, action?: AppointmentAction) => {
    if (isLiveConversation(id)) {
      // The reply shows in the chat as "Sending…" until the server has it, or as "Not sent" with "Try again".
      void live.reply(id, english);
      return true;
    }
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return false;
    const result = action ? applyConversationAppointment(conversation, action, false) : null;
    if (result && 'error' in result) { showToast(result.error, 'error'); return false; }

    // The reply, then what follows from it (src/sampleChatFlow.ts): a reply that booked confirms the
    // waiting request with the fixed confirmation; a suggested reply that offers a time gets the
    // customer's answer and a request at that time. The suggestions and the AI's prepared answer
    // are gone: they answered the customer's earlier message.
    const sentAt = new Date();
    const booked = action && result ? { action, staffName: result.saved.staffName } : undefined;
    setConversations((prev) => prev.map((c) => c.id !== id ? c : {
      ...sampleChatAfterOwnerReply(c, { english, local }, booked, sentAt, companySettings.timeZone, companySettings.companyName),
      customerId: result?.saved.customerId ?? c.customerId,
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
              onChatBooking={handleChatBooking}
              onSimulateNewRequest={handleSimulateNewRequest}
              now={now}
              onOpenCalendar={() => setCurrentTab('calendar')}
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
              timeBlocks={timeBlocks}
              onSaveTimeBlock={handleSaveTimeBlock}
              onRemoveTimeBlock={handleRemoveTimeBlock}
              timeZone={companySettings.timeZone}
              date={calendarDate}
              view={route.view}
              staffFilter={route.staff}
              serviceFilter={route.service}
              now={now}
              selectedEventId={route.appointmentId ?? null}
              onSelectEvent={event => navigate({ ...route, appointmentId: event?.id }, { replace: !event })}
              onDateChange={showCalendarDate}
              onPlaceChange={showInCalendar}
              onDeleteEvent={handleDeleteCalendarEvent}
              conversationFor={conversationOfAppointment}
              onOpenConversation={openConversation}
              onOpenAppointmentForm={openAppointmentForm}
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
              services={services}
              bookingHours={bookingHours}
              events={calendarEvents}
              requests={requests}
              onOpenServices={() => setCurrentTab('services')}
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
              onClearSelection={(options) => navigate({ tab: 'customers' }, options)}
              onOpenCustomer={(id) => navigate({ tab: 'customers', customerId: id })}
              onAddCustomer={handleAddCustomer}
              onUpdateCustomer={handleUpdateCustomer}
              onDeleteCustomer={handleDeleteCustomer}
              cannotDelete={(customer) => deletionDependency('customer', customer.id, customer.name, calendarEvents, requests)}
              onOpenChat={openChatForCustomer}
              onNewAppointment={(customerId) => openAppointmentForm({ kind: 'new', customerId })}
              onOpenAppointment={openAppointment}
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
              onBackToList={(viaHistory) => { if (viaHistory) window.history.back(); else navigate({ tab: 'conversations' }, { replace: true }); }}
              onSelect={id => { setSelectedConversationId(id); navigate({ tab: 'conversations', conversationId: id }); }}
              onTakeOver={handleTakeOver}
              onLetAiContinue={handleLetAiContinue}
              onOwnerReply={handleOwnerReply}
              aiSettings={aiSettings}
              onOpenAiSettings={() => setCurrentTab('ai-assistant')}
              liveChannels={live.channels}
              liveInbox={live.inbox}
              onSignOut={signOutHere}
              onTeamCheck={live.teamCheck}
              salon={availabilityContext}
              onChatBooking={handleChatBooking}
              onBookForCustomer={openBookingForChat}
              onOpenAppointment={openAppointment}
              onAddConfirmedToCalendar={handleAddConfirmedToCalendar}
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
              thisDevice={{ signedIn: live.signedIn, connection: live.connection, waitNotice: live.inbox.waitNotice, onSignOut: signOutHere }}
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
        usesAiModel={live.signedIn}
        onClose={() => setIsAssistantOpen(false)}
        salon={availabilityContext}
        customers={customers}
        onAddEvent={handleAddCalendarEvent}
        onDeleteEvent={handleDeleteCalendarEvent}
        onSaveClosedDates={setClosedDates}
        onOpenCalendar={(date) => { if (currentTab === 'calendar') showCalendarDate(date); else navigate({ tab: 'calendar', ...(date !== salonToday ? { date } : {}) }); }}
        onResultShown={() => setToast(null)}
      />

      {/* The appointment form: one for the whole app, over whatever screen is open (see openAppointmentForm). */}
      <AppointmentForm
        key={appointmentForm?.opening}
        request={appointmentForm?.request ?? null}
        salon={availabilityContext}
        customers={customers}
        onSave={handleSaveAppointment}
        onClose={() => setAppointmentForm(null)}
        onOpenScreen={(screen) => { setAppointmentForm(null); setCurrentTab(screen); }}
      />
    </div>
  );
}
