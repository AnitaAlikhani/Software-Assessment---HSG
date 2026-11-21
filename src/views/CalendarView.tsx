import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  Clock,
  User,
  Scissors,
  X,
  MessageSquare,
  Ban,
} from 'lucide-react';
import { AppointmentRequest, BookingHoursDay, CalendarEvent, ClosedDate, Conversation, Employee, ServiceItem, ShiftEntry, StaffAbsence, TimeBlock } from '../types';
import { addDays, calendarHours, formatCalendarDate, getSalonNow, startOfWeek } from '../scheduling';
import { formatDate, formatDateRange, formatMonthSpan, formatPhone, formatTimeRange, formatWeek, weekdayName } from '../format';
import { firstFreeEmployee } from '../availability';
import { CALENDAR_VIEWS, type CalendarPlace, type CalendarViewMode } from '../navigation';
import { calendarPeople, columnPlan, countByDate, dayColumns, gridSpan, isOver, personKeyOf, weekColumns, type CalendarPerson, type CalendarSalon } from '../calendarLayout';
import type { AppointmentFormRequest } from '../appointmentForm';
import { bookingSource, bookingSourceLabel } from '../bookingSource';
import { staffColorAt } from '../staffColors';
import { BLOCK_STRIPES, CalendarGrid, SourceIcon, appointmentSummary, dayOfMonth, firstNameOf, initialsOfName, timeBlockSummary, type PersonLook } from './CalendarGrid';
import { TimeBlockDialog } from '../components/TimeBlockDialog';
import { blockTitle } from '../timeBlocks';

interface CalendarViewProps {
  events: CalendarEvent[];
  services: ServiceItem[];
  bookingHours: BookingHoursDay[];
  employees: Employee[];
  shiftOverview: ShiftEntry[];
  requests: AppointmentRequest[];
  closedDates?: ClosedDate[];
  absences?: StaffAbsence[];
  /** Time kept free for a stylist (a break, lunch). Drawn in the grid and the list; a click changes or removes one. */
  timeBlocks?: TimeBlock[];
  /** Keeps a new block, or the changed `original`. Returns why it cannot be kept, or null. */
  onSaveTimeBlock?: (block: Omit<TimeBlock, 'id'>, original?: TimeBlock) => string | null;
  onRemoveTimeBlock?: (id: string) => void;
  timeZone?: string;
  /** The day shown (day view), or any day of the week shown. */
  date: string;
  /** Day, week or list. Left out, a phone shows the day and a wider screen the week. */
  view?: CalendarViewMode;
  /** Only this stylist's appointments (an employee's id), or empty for everybody's. */
  staffFilter?: string;
  /** Only appointments for this service (a service's id), or empty for every service. */
  serviceFilter?: string;
  /** The current moment, refreshed by the app every minute: today, the line at "now", what is past. */
  now?: Date;
  /** Tests name the kind of screen. Left out, the width of the window decides (a phone is below 768 px). */
  phone?: boolean;
  selectedEventId: string | null;
  onSelectEvent: (event: CalendarEvent | null) => void;
  onDateChange: (date: string) => void;
  /** Another view or filter, or a day together with its view. The app keeps all of them in the address. */
  onPlaceChange?: (change: CalendarPlace) => void;
  onDeleteEvent: (id: string) => void;
  /** The chat an appointment was booked in, if there is one. */
  conversationFor?: (event: CalendarEvent) => Pick<Conversation, 'id' | 'channel'> | null;
  onOpenConversation?: (conversationId: string) => void;
  /** Opens the app's appointment form: for a new appointment at a place in the calendar, or for an existing one. */
  onOpenAppointmentForm: (request: AppointmentFormRequest) => void;
}

const PHONE_SCREEN = '(max-width: 767px)';

/** True on a phone-sized screen. It follows the window when it is resized or the phone is turned. */
const usePhoneScreen = (forced?: boolean): boolean => {
  const canAsk = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [matches, setMatches] = useState(() => canAsk && window.matchMedia(PHONE_SCREEN).matches);
  useEffect(() => {
    if (!canAsk) return;
    const list = window.matchMedia(PHONE_SCREEN);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [canAsk]);
  return forced ?? matches;
};

/** First names, with the surname's initial where two people share one: "Anna W." and "Anna K.". */
const shortNamesOf = (names: string[]): string[] => {
  const firsts = names.map(firstNameOf);
  return names.map((name, index) => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const shared = firsts.filter((first) => first === firsts[index]).length > 1;
    return shared && parts.length > 1 ? `${firsts[index]} ${parts[parts.length - 1][0]}.` : firsts[index] || name;
  });
};
const appointments = (count: number): string => count === 0 ? 'no appointments' : `${count} ${count === 1 ? 'appointment' : 'appointments'}`;
const startOfSentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const CalendarView: React.FC<CalendarViewProps> = ({
  events,
  services,
  bookingHours,
  employees,
  shiftOverview,
  requests,
  closedDates = [],
  absences = [],
  timeBlocks = [],
  onSaveTimeBlock,
  onRemoveTimeBlock,
  timeZone,
  date,
  view,
  staffFilter = '',
  serviceFilter = '',
  now,
  phone: phoneScreen,
  selectedEventId,
  onSelectEvent,
  onDateChange,
  onPlaceChange,
  onDeleteEvent,
  conversationFor,
  onOpenConversation,
  onOpenAppointmentForm,
}) => {
  const phone = usePhoneScreen(phoneScreen);
  // Phones open on one day, wider screens on the week, until the owner chooses a view.
  const activeView: CalendarViewMode = view ?? (phone ? 'day' : 'week');
  const [showFilters, setShowFilters] = useState(false);
  // "Today" brings the current time back into view, also when today is already shown.
  const [scrollSignal, setScrollSignal] = useState(0);
  // The moment the grid is drawn for. Shown without the app's clock, the calendar keeps time itself.
  const [ownNow, setOwnNow] = useState(() => new Date());
  const keepsTime = now === undefined;
  useEffect(() => {
    if (!keepsTime) return;
    const timer = window.setInterval(() => setOwnNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [keepsTime]);
  const salonNow = getSalonNow(timeZone, now ?? ownNow);
  const selectedEvent = events.find(event => event.id === selectedEventId) ?? null;
  const selectedEventChat = selectedEvent ? conversationFor?.(selectedEvent) ?? null : null;
  const setSelectedEvent = onSelectEvent;
  // Where the keyboard focus goes when what had it is gone (a removed block) or was nothing (the
  // details were opened from another screen): the first thing of the calendar that can take it.
  const rootRef = useRef<HTMLDivElement>(null);
  const focusCalendar = () => requestAnimationFrame(() => {
    const target = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('h1, button') ?? []).find((element) => element.getClientRects().length > 0);
    if (!target) return;
    if (target.tagName === 'H1') target.tabIndex = -1;
    target.focus({ preventScroll: true });
  });
  const detailsRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = detailsRef.current;
    if (!dialog || !selectedEvent) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus();
      else focusCalendar();
    };
  }, [selectedEvent?.id]);
  const activeEmployees = employees.filter(employee => employee.status === 'Active');
  const context = { services, employees, bookingHours, shiftOverview, events, requests, closedDates, absences, timeBlocks, timeZone, now: now ?? ownNow };
  // Without a service or an active person nothing can be booked: the grid then offers no place to
  // click (the page says why above it). "Add" still opens the form, which says the same.
  const canAddHere = services.length > 0 && activeEmployees.length > 0;
  // A click in a stylist's column of the day view names that stylist; without one, the stylist
  // chosen in the legend is taken, as before.
  const openCreate = (slotDate = date, preferredTime = '', preferredEmployeeId = staffFilter) => {
    // "Add" without a place on today's calendar starts at the next free time, like "+" everywhere else.
    const place = preferredTime !== '' || slotDate !== salonNow.date;
    onOpenAppointmentForm({
      kind: 'new', ...(place ? { date: slotDate } : {}), ...(preferredTime ? { time: preferredTime } : {}),
      ...(preferredEmployeeId ? { employeeId: preferredEmployeeId } : {}), ...(serviceFilter ? { serviceId: serviceFilter } : {}),
    });
  };
  const openEdit = (event: CalendarEvent) => {
    setSelectedEvent(null);
    onOpenAppointmentForm({ kind: 'edit', appointmentId: event.id });
  };

  // ---------- time blocks ----------

  // The block dialog: a new block (`block` null) with what the form starts with, or a block that is changed.
  const [blockForm, setBlockForm] = useState<{ block: TimeBlock | null; initial: Omit<TimeBlock, 'id'> } | null>(null);
  const canBlock = Boolean(onSaveTimeBlock) && activeEmployees.length > 0;
  const openNewBlock = () => {
    const stylist = activeEmployees.find((employee) => employee.id === staffFilter) ?? activeEmployees[0];
    setBlockForm({ block: null, initial: {
      employeeId: stylist?.id ?? '', date: date < salonNow.date ? salonNow.date : date, startTime: '12:00', endTime: '12:30', reason: 'Break',
    } });
  };
  const openBlock = (block: TimeBlock) => {
    const { id: _id, ...initial } = block;
    setBlockForm({ block, initial });
  };

  // ---------- what is on screen: the week around the date, the people, the filters ----------

  const weekStart = startOfWeek(date);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const shownDates = activeView === 'day' ? [date] : weekDates;
  const salon: CalendarSalon = { employees, shiftOverview, bookingHours, closedDates, absences };
  const weekEvents = events.filter((event) => event.date >= weekDates[0] && event.date <= weekDates[6]);
  // Everybody with a colour: the team, and names on this week's appointments that match nobody in it.
  const people = calendarPeople(employees, weekEvents);
  const shortNames = shortNamesOf(people.map((person) => person.name));
  const looks = new Map<string, PersonLook>(people.map((person, index) =>
    [person.key, { person, color: staffColorAt(person.index), shortName: shortNames[index], initials: initialsOfName(person.name) }]));
  const lookOfPerson = (person: CalendarPerson): PersonLook =>
    looks.get(person.key) ?? { person, color: staffColorAt(person.index), shortName: firstNameOf(person.name) || person.name, initials: initialsOfName(person.name) };
  const lookOf = (event: CalendarEvent): PersonLook => {
    const key = personKeyOf(event, employees);
    return looks.get(key) ?? lookOfPerson({ key, name: event.staffName, index: -1 });
  };
  const lookOfBlock = (block: TimeBlock): PersonLook =>
    looks.get(block.employeeId) ?? lookOfPerson({ key: block.employeeId, employeeId: block.employeeId, name: employees.find((item) => item.id === block.employeeId)?.name ?? 'Unassigned', index: -1 });

  // A filter that names nobody (a link from another salon, a deleted service) filters nothing.
  const chosenPerson = people.find((person) => person.key === staffFilter) ?? null;
  const chosenService = services.find((service) => service.id === serviceFilter) ?? null;
  const matchesFilters = (event: CalendarEvent) =>
    (!chosenPerson || personKeyOf(event, employees) === chosenPerson.key)
    && (!chosenService || (event.serviceId !== undefined ? event.serviceId === chosenService.id : event.serviceName === chosenService.name));
  const shownWeekEvents = weekEvents.filter(matchesFilters)
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  const visibleEvents = activeView === 'day' ? shownWeekEvents.filter((event) => event.date === date) : shownWeekEvents;
  const counts = countByDate(shownWeekEvents);
  const filtered = Boolean(chosenPerson || chosenService);

  // The legend: everybody who works at the salon, and anybody else with an appointment this week.
  const legend = people.filter((person) => person.key === chosenPerson?.key
    || employees.some((employee) => employee.id === person.employeeId && employee.status === 'Active')
    || weekEvents.some((event) => personKeyOf(event, employees) === person.key));

  const firstDay = shownDates[0];
  const lastDay = shownDates[shownDates.length - 1];
  // "16.–22.11.2026" for several days; one day reads "Wed, 18.11.2026".
  const dateRange = formatDateRange(firstDay, lastDay);
  // The page's title: the month or months on screen, and the calendar week of the first day.
  const monthTitle = formatMonthSpan(firstDay, lastDay);
  const weekLabel = formatWeek(firstDay);

  // The grid covers the same hours on every day of a week, so it does not jump from day to day
  // or when a filter is set.
  const grid = gridSpan(calendarHours(weekDates, bookingHours, weekEvents));
  // Blocks follow the stylist filter. They belong to no service, so a service filter leaves them in view.
  const weekBlocks = timeBlocks.filter((block) => block.date >= weekDates[0] && block.date <= weekDates[6]
    && (!chosenPerson || block.employeeId === chosenPerson.employeeId))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  const columns = activeView === 'week' ? weekColumns(salon, weekDates, shownWeekEvents, chosenPerson?.employeeId, weekBlocks)
    : activeView === 'day' ? dayColumns(salon, date, people, shownWeekEvents, chosenPerson?.key, weekBlocks) : [];
  // Week view for everybody: who is away is said in the day's heading. With one stylist chosen the day itself says it.
  const awayOn = (day: string): string[] => chosenPerson ? [] : [...new Set(absences
    .filter((absence) => day >= absence.start && day <= absence.end)
    .map((absence) => looks.get(absence.employeeId)?.shortName ?? '').filter(Boolean))];

  // On a phone the strip of days chooses the day, so the arrows turn the week.
  const step = activeView === 'day' && !phone ? 1 : 7;
  const stepName = step === 1 ? 'day' : 'week';
  const show = (change: CalendarPlace) => onPlaceChange?.(change);
  const goToday = () => { onDateChange(salonNow.date); setScrollSignal((count) => count + 1); };
  /**
   * A click on a free half hour. In a stylist's column of the day view the form opens for that
   * stylist. In the week a place belongs to nobody, so the form opens with the first stylist who
   * is free then for the service it starts with, instead of one who is busy at that time.
   */
  const addAt = (slotDate: string, time: string, employeeId?: string) => {
    const service = services.find(item => item.id === serviceFilter) ?? services[0];
    const free = employeeId ?? (!chosenPerson && service ? firstFreeEmployee({ ...context, now: new Date() }, service.id, slotDate, time)?.id : undefined);
    openCreate(slotDate, time, free);
  };

  // ---------- the controls ----------

  const arrowClass = 'flex size-11 shrink-0 items-center justify-center text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF]';
  const dateNavigation = (
    <div className="flex shrink-0 items-center rounded-xl border border-slate-200 bg-white shadow-2xs">
      <button type="button" aria-label={`Previous ${stepName}`} onClick={() => onDateChange(addDays(date, -step))} className={`${arrowClass} rounded-l-xl`}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      {phone
        ? <button type="button" onClick={goToday} className="min-h-11 px-2 text-xs font-semibold text-slate-700 hover:text-slate-900 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF]">Today</button>
        : <span className="min-w-[7.5rem] px-1 text-center text-xs font-medium tabular-nums text-slate-700">{dateRange}</span>}
      <button type="button" aria-label={`Next ${stepName}`} onClick={() => onDateChange(addDays(date, step))} className={`${arrowClass} rounded-r-xl`}>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );

  // Day, Week, List: the same three buttons on every screen.
  const viewSwitcher = (
    <div role="group" aria-label="View" className={`grid grid-cols-3 items-center rounded-xl bg-slate-200/60 p-0.5 text-xs font-medium ${phone ? 'min-w-0 flex-1' : ''}`}>
      {CALENDAR_VIEWS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={activeView === id}
          onClick={() => show({ view: id })}
          className={`min-h-11 whitespace-nowrap rounded-[10px] px-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5551FF] md:min-h-10 md:px-4 md:pointer-coarse:min-h-11 ${
            activeView === id ? 'bg-[#5551FF] font-semibold text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // One colour per stylist. A tap shows only that stylist's appointments; a second tap shows everybody's again.
  const stylistLegend = (
    <div role="group" aria-label="Stylists" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {legend.map((person) => {
        const look = lookOfPerson(person);
        const chosen = chosenPerson?.key === person.key;
        return (
          <button
            key={person.key}
            type="button"
            data-stylist={person.key}
            aria-pressed={chosen}
            aria-label={`Only ${person.name}`}
            title={chosen ? 'Show everybody’s appointments' : `Show only ${person.name}’s appointments`}
            onClick={() => show({ staff: chosen ? '' : person.key })}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5551FF] md:min-h-9 md:pointer-coarse:min-h-11 ${
              chosen ? 'text-slate-900' : chosenPerson ? 'border-slate-200 bg-white text-slate-500 hover:text-slate-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            style={chosen ? { backgroundColor: look.color.fill, borderColor: look.color.accent } : undefined}
          >
            <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${chosenPerson && !chosen ? 'opacity-40' : ''}`} style={{ backgroundColor: look.color.accent }} />
            {look.shortName}
          </button>
        );
      })}
    </div>
  );

  const serviceOptions = (
    <>
      <option value="">All services</option>
      {services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
    </>
  );

  const todayChip = <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-[#5551FF]">Today</span>;

  return (
    <div ref={rootRef} className={`mx-auto min-w-0 max-w-7xl space-y-3 px-3 pt-3 sm:px-6 sm:pt-5 lg:px-8 lg:pt-7 ${
      // The grid fills the screen down to the tab bar (phones) or the window's edge (laptops):
      // the page gives back the room it otherwise keeps free below a screen's content
      // (the main area's bottom padding, 7rem and from lg 4rem).
      activeView === 'list' ? 'pb-3 sm:pb-6 lg:pb-8' : '-mb-12 pb-3 lg:-mb-10 lg:pb-0'
    }`}>
      {/* Title, the view and "Add". On phones the top bar names the page already, so the row holds the date arrows and the view. */}
      <div className={phone ? 'flex items-center gap-2' : 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2'}>
        <div className={phone ? 'sr-only' : 'flex flex-wrap items-center gap-x-3 gap-y-1'}>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Calendar
          </h1>
          {!phone && (
            <p aria-live="polite" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-slate-700">
              <span>{monthTitle}</span>
              <span className="whitespace-nowrap text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                {weekLabel}
              </span>
            </p>
          )}
        </div>
        {phone && dateNavigation}
        {phone ? viewSwitcher : (
          <div className="flex items-center gap-2">
            {viewSwitcher}
            {canBlock && (
              <button type="button" onClick={openNewBlock}
                className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5551FF]">
                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Block time</span>
              </button>
            )}
            <button
              type="button"
              aria-label="Add appointment"
              onClick={() => openCreate()}
              className="flex min-h-11 items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-2xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add</span>
            </button>
          </div>
        )}
      </div>

      {/* Laptops: the date on the left; the stylists and the service on the right. */}
      {!phone && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex max-w-full flex-wrap items-center gap-1.5">
            <button type="button" onClick={goToday} className="min-h-11 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
              Today
            </button>
            {dateNavigation}
            <input type="date" aria-label="Calendar date" value={date} onChange={(e) => { if (e.target.value) onDateChange(e.target.value); }} className="min-h-11 w-40 min-w-0 px-2 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl" />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {stylistLegend}
            <select aria-label="Service" value={chosenService?.id ?? ''} onChange={event => show({ service: event.target.value })}
              className={`min-h-11 max-w-[11rem] min-w-0 rounded-xl border bg-white px-2.5 text-base font-semibold sm:text-xs md:min-h-9 md:pointer-coarse:min-h-11 ${chosenService ? 'border-[#5551FF] text-[#5551FF]' : 'border-slate-200 text-slate-700'}`}>
              {serviceOptions}
            </select>
          </div>
        </div>
      )}

      {/* Phones: which day or week this is, and the service filter behind its button. */}
      {phone && (
        <div className="flex items-center gap-2">
          <p aria-live="polite" className="min-w-0 flex-1 px-1">
            <span className="block truncate text-sm font-semibold text-slate-900">{activeView === 'day' ? formatDate(date, { weekday: 'long' }) : dateRange}</span>
            <span className="block truncate text-xs text-slate-500">
              {activeView !== 'day' ? `${weekLabel} · ${appointments(visibleEvents.length)}`
                : date === salonNow.date ? <><span className="font-semibold text-[#5551FF]">Today</span> · {appointments(visibleEvents.length)}</>
                  : startOfSentence(appointments(visibleEvents.length))}
            </span>
          </p>
          {canBlock && (
            // On the narrowest phones the button keeps its name for a screen reader and shows the icon only.
            <button type="button" onClick={openNewBlock}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5551FF] max-[359px]:px-0">
              <Ban className="h-4 w-4" aria-hidden="true" />
              <span className="max-[359px]:sr-only">Block time</span>
            </button>
          )}
          <button type="button" aria-expanded={showFilters} aria-controls="calendar-filters" aria-label={chosenService ? `Service: ${chosenService.name}` : 'Filter by service'}
            onClick={() => setShowFilters(value => !value)}
            className={`relative flex size-11 shrink-0 items-center justify-center rounded-full border bg-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5551FF] ${chosenService ? 'border-[#5551FF] text-[#5551FF]' : 'border-slate-200 text-slate-500'}`}>
            <Filter className="h-4 w-4" aria-hidden="true" />
            {chosenService && <span aria-hidden="true" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#5551FF] ring-2 ring-white" />}
          </button>
        </div>
      )}
      {phone && showFilters && (
        <section id="calendar-filters" aria-label="Calendar filters" className="rounded-2xl border border-slate-200 bg-white p-3">
          <label htmlFor="calendar-service-filter" className="mb-1 block text-xs font-semibold text-slate-600">Service</label>
          <select id="calendar-service-filter" value={chosenService?.id ?? ''} onChange={event => { show({ service: event.target.value }); setShowFilters(false); }} className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-base">
            {serviceOptions}
          </select>
        </section>
      )}

      {/* The week as a strip, Monday to Sunday: a tap chooses the day. A dot (on laptops the number) says which days have appointments. */}
      {activeView === 'day' && (
        <div role="group" aria-label={`Days of ${weekLabel.toLowerCase()}`} data-week-strip="" className="-mx-3 grid grid-cols-7 border-y border-slate-200/80 bg-white px-0.5 py-1 shadow-xs sm:mx-0 sm:gap-0.5 sm:rounded-2xl sm:border sm:px-1">
          {weekDates.map((day) => {
            const count = counts.get(day) ?? 0;
            const isToday = day === salonNow.date;
            const selected = day === date;
            const closed = columnPlan(salon, day).open === null;
            return (
              <button
                key={day}
                type="button"
                data-day={day}
                aria-pressed={selected}
                aria-current={isToday ? 'date' : undefined}
                aria-label={[formatDate(day, { weekday: 'long' }), isToday ? 'today' : '', closed ? 'closed' : '', appointments(count)].filter(Boolean).join(', ')}
                onClick={() => onDateChange(day)}
                className={`flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5551FF] md:min-h-11 md:flex-row md:gap-2 ${
                  selected ? `${isToday ? 'bg-[#5551FF]' : 'bg-slate-800'} text-white shadow-xs`
                    : isToday ? 'bg-indigo-50 text-[#5551FF] ring-1 ring-inset ring-[#5551FF]/30'
                      : closed ? 'text-slate-500 hover:bg-slate-50' : 'text-slate-900 hover:bg-slate-50'
                }`}
              >
                <span className={`text-[10px] font-semibold uppercase leading-none tracking-wide md:hidden ${selected || isToday ? '' : 'text-slate-500'}`}>{weekdayName(day, 'short')}</span>
                <span className="text-[15px] font-bold leading-none tabular-nums md:hidden">{dayOfMonth(day)}</span>
                <span className="hidden whitespace-nowrap text-xs font-semibold tabular-nums md:inline">{formatCalendarDate(day)}</span>
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full md:hidden ${count === 0 ? 'bg-transparent' : selected ? 'bg-white' : isToday ? 'bg-[#5551FF]' : 'bg-slate-400'}`} />
                <span aria-hidden="true" className={`hidden min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none tabular-nums md:inline ${
                  count === 0 ? (closed ? '' : 'invisible') : selected ? 'bg-white/20' : isToday ? 'bg-white' : 'bg-slate-100 text-slate-600'
                }`}>{count > 0 ? count : closed ? 'Closed' : '0'}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Phones: the stylists. In the day view the headings of the columns are the legend, so no second row repeats them. */}
      {phone && activeView !== 'day' && stylistLegend}

      {filtered && (
        <p role="status" className="flex flex-wrap items-center gap-x-2 text-xs text-slate-600">
          <span>Only {[chosenPerson?.name, chosenService?.name].filter(Boolean).join(' · ')}: {appointments(visibleEvents.length)} {activeView === 'day' ? 'on this day' : 'in this week'}.</span>
          <button type="button" onClick={() => show({ staff: '', service: '' })} className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-[#5551FF] hover:bg-indigo-50 md:min-h-8">Show all</button>
        </p>
      )}
      {services.length === 0 && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Add a service in Services before creating an appointment.</p>}
      {services.length > 0 && activeEmployees.length === 0 && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Add an active employee and assign them to a service before creating an appointment.</p>}
      {selectedEventId && !selectedEvent && <p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">This appointment is no longer available. <button className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-[#5551FF] underline hover:bg-slate-50" onClick={() => onSelectEvent(null)}>View calendar</button></p>}

      {activeView === 'list' ? (
        // The week's appointments as a list, day by day.
        <div className="space-y-3">
          {visibleEvents.length === 0 && <p className="rounded-2xl border border-slate-200/80 bg-white p-6 text-sm text-slate-500 shadow-xs">No appointments in this week.</p>}
          {weekDates.map((day) => {
            const onDay = visibleEvents.filter((event) => event.date === day);
            const blocksOnDay = weekBlocks.filter((block) => block.date === day);
            if (onDay.length === 0 && blocksOnDay.length === 0) return null;
            // Appointments and blocks in the order of the day.
            const rows: { at: string; event?: CalendarEvent; block?: TimeBlock }[] = [...onDay.map((event) => ({ at: event.startTime, event })), ...blocksOnDay.map((block) => ({ at: block.startTime, block }))]
              .sort((a, b) => a.at.localeCompare(b.at));
            return (
              <section key={day} aria-labelledby={`calendar-list-${day}`} className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
                <h2 id={`calendar-list-${day}`} className="flex flex-wrap items-center justify-between gap-x-3 border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
                  <span className="flex items-center gap-2">{formatDate(day)}{day === salonNow.date && todayChip}</span>
                  <span className="text-xs font-normal text-slate-500">{appointments(onDay.length)}</span>
                </h2>
                <ul className="divide-y divide-slate-100">
                  {rows.map(({ event: ev, block }) => {
                    if (block) {
                      const look = lookOfBlock(block);
                      return (
                        <li key={block.id}>
                          <button type="button" data-block={block.id} aria-label={`Change blocked time: ${timeBlockSummary(block, look.person.name)}`} onClick={() => openBlock(block)}
                            className="flex min-h-11 w-full cursor-pointer items-center gap-3 bg-slate-50/70 px-4 py-2 text-left text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF]">
                            <span aria-hidden="true" className="h-7 w-1 shrink-0 rounded-full ring-1 ring-inset ring-slate-300" style={{ backgroundImage: BLOCK_STRIPES }} />
                            <span className="w-[5.5rem] shrink-0 text-sm tabular-nums">{formatTimeRange(block.startTime, block.endTime)}</span>
                            <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                              <span className="font-semibold text-slate-600">{blockTitle(block)}</span> · {look.person.name}
                              {block.reason !== 'Other' && block.note?.trim() && <span className="block text-xs">{block.note.trim()}</span>}
                            </span>
                            <span className="shrink-0 text-xs">Blocked</span>
                          </button>
                        </li>
                      );
                    }
                    if (!ev) return null;
                    const look = lookOf(ev);
                    const over = isOver(ev, salonNow);
                    return (
                      <li key={ev.id}>
                        <button
                          type="button"
                          data-event={ev.id}
                          aria-label={`Open appointment for ${ev.customerName}: ${appointmentSummary(ev)}`}
                          onClick={() => setSelectedEvent(ev)}
                          className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF]"
                        >
                          <span aria-hidden="true" className="h-9 w-1 shrink-0 rounded-full" style={{ backgroundColor: over ? look.color.pastAccent : look.color.accent }} />
                          <span className={`w-[5.5rem] shrink-0 text-sm tabular-nums ${over ? 'text-slate-500' : 'font-semibold text-slate-900'}`}>{formatTimeRange(ev.startTime, ev.endTime)}</span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm [overflow-wrap:anywhere] ${over ? 'text-slate-500' : 'font-semibold text-slate-900'}`}>{ev.customerName}</span>
                            <span className="block text-xs text-slate-500 [overflow-wrap:anywhere]">{ev.serviceName} · {ev.staffName}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                            <SourceIcon event={ev} className="h-3.5 w-3.5" />
                            <span className="hidden md:inline">{bookingSourceLabel(bookingSource(ev))}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <CalendarGrid
          mode={activeView}
          overview={phone && activeView === 'week'}
          columns={columns}
          grid={grid}
          now={salonNow}
          lookOf={lookOf}
          lookOfPerson={lookOfPerson}
          lookOfBlock={lookOfBlock}
          onOpenBlock={onSaveTimeBlock ? openBlock : undefined}
          awayOn={awayOn}
          selectedEventId={selectedEventId}
          canAdd={canAddHere}
          onOpenEvent={setSelectedEvent}
          onAdd={addAt}
          onOpenDay={(day) => show({ view: 'day', date: day })}
          onTogglePerson={phone && activeView === 'day' ? (key) => show({ staff: chosenPerson?.key === key ? '' : key }) : undefined}
          chosenKey={chosenPerson?.key}
          scrollSignal={scrollSignal}
        />
      )}

      {/* Event Details Modal */}
      {selectedEvent && (
        <dialog ref={detailsRef} aria-labelledby="appointment-details-title" onCancel={e => { e.preventDefault(); setSelectedEvent(null); }} onClick={e => { if (e.target === e.currentTarget) setSelectedEvent(null); }} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full p-6 animate-in zoom-in-95">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#5551FF]">
                  Appointment details
                </span>
                <h3 id="appointment-details-title" className="text-base font-bold text-slate-900 mt-0.5">
                  {selectedEvent.customerName}
                </h3>
              </div>
              <button
                aria-label="Close appointment details"
                autoFocus
                onClick={() => setSelectedEvent(null)}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs text-slate-600 [overflow-wrap:anywhere]">
              <div className="flex items-center gap-2">
                <Scissors className="w-4 h-4 text-slate-400" />
                <span>Service: <strong className="text-slate-800">{selectedEvent.serviceName}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span>Time: <strong className="text-slate-800">{formatDate(selectedEvent.date)}, {formatTimeRange(selectedEvent.startTime, selectedEvent.endTime)}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" />
                <span>Stylist: <strong className="text-slate-800">{selectedEvent.staffName}</strong></span>
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: lookOf(selectedEvent).color.accent }} />
              </div>
              {selectedEvent.customerPhone
                ? <p className="text-sm text-slate-600">Phone: <strong className="whitespace-nowrap">{formatPhone(selectedEvent.customerPhone)}</strong></p>
                // Booked in a chat without a phone number: say how the customer can be reached.
                : selectedEventChat && <p className="text-sm text-slate-600">Contact: <strong>via {selectedEventChat.channel === 'Website' ? 'web chat' : selectedEventChat.channel}</strong></p>}
              {/* How the appointment was booked: by the AI, in a chat, on the booking page or by hand. */}
              <div className={`flex items-center gap-2 font-medium p-2 rounded-xl ${selectedEvent.isAiBooked ? 'text-indigo-600 bg-indigo-50' : 'text-slate-600 bg-slate-50'}`}>
                <SourceIcon event={selectedEvent} className="w-4 h-4" />
                <span>{bookingSourceLabel(bookingSource(selectedEvent))}</span>
              </div>
              {selectedEvent.outsideHoursApproved && (
                <p className="text-xs text-indigo-700 bg-indigo-50 p-2 rounded-xl">Approved by the owner outside the usual hours.</p>
              )}
            </div>

            <button onClick={() => openEdit(selectedEvent)} className="mb-3 min-h-11 w-full rounded-xl bg-[#5551FF] px-3 py-2 text-sm font-semibold text-white hover:bg-[#433fd8]">Edit appointment</button>
            {selectedEventChat && onOpenConversation && (
              <button onClick={() => onOpenConversation(selectedEventChat.id)} className="mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-[#5551FF] hover:bg-indigo-50">
                <MessageSquare className="h-4 w-4" aria-hidden="true" />Open conversation
              </button>
            )}
            <div className="pt-2 flex gap-2">
              <button
                onClick={() => {
                  onDeleteEvent(selectedEvent.id);
                  setSelectedEvent(null);
                }}
                className="min-h-11 flex-1 py-2 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors"
              >
                Cancel appointment
              </button>
              <button
                onClick={() => setSelectedEvent(null)}
                className="min-h-11 flex-1 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </dialog>
      )}

      {blockForm && onSaveTimeBlock && (
        <TimeBlockDialog
          employees={employees}
          block={blockForm.block}
          initial={blockForm.initial}
          today={salonNow.date}
          onSave={(values) => {
            const problem = onSaveTimeBlock(values, blockForm.block ?? undefined);
            if (!problem) onDateChange(values.date);
            return problem;
          }}
          onRemove={() => { if (blockForm.block) onRemoveTimeBlock?.(blockForm.block.id); setBlockForm(null); focusCalendar(); }}
          onClose={() => setBlockForm(null)}
        />
      )}
    </div>
  );
};
