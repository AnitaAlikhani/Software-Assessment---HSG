import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  Sparkles,
  Clock,
  User,
  Scissors,
  X,
} from 'lucide-react';
import { AppointmentRequest, BookingHoursDay, CalendarEvent, ClosedDate, Employee, ServiceItem, ShiftEntry, StaffAbsence } from '../types';
import { addDays, addMinutes, calendarHours, calendarTimeZoneOffset, dayKeyForDate, formatCalendarDate, getSalonNow, salonTimeZone, startOfWeek } from '../scheduling';
import { getAvailableSlots, isEmployeeAssignedToService } from '../availability';

interface CalendarViewProps {
  events: CalendarEvent[];
  services: ServiceItem[];
  bookingHours: BookingHoursDay[];
  employees: Employee[];
  shiftOverview: ShiftEntry[];
  requests: AppointmentRequest[];
  closedDates?: ClosedDate[];
  absences?: StaffAbsence[];
  timeZone?: string;
  date: string;
  selectedEventId: string | null;
  onSelectEvent: (event: CalendarEvent | null) => void;
  onDateChange: (date: string) => void;
  onAddEvent: (event: Omit<CalendarEvent, 'id'>) => string | null;
  onUpdateEvent: (id: string, event: Omit<CalendarEvent, 'id'>) => string | null;
  onDeleteEvent: (id: string) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  events,
  services,
  bookingHours,
  employees,
  shiftOverview,
  requests,
  closedDates = [],
  absences = [],
  timeZone,
  date,
  selectedEventId,
  onSelectEvent,
  onDateChange,
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
}) => {
  const [activeView, setActiveView] = useState<'List' | 'Day' | '3-day' | 'Week'>('Week');
  const [showFilters, setShowFilters] = useState(false);
  const [staffFilter, setStaffFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [clock, setClock] = useState(() => new Date());
  const selectedEvent = events.find(event => event.id === selectedEventId) ?? null;
  const setSelectedEvent = onSelectEvent;
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
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [selectedEvent?.id]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const editingEvent = events.find(event => event.id === editingEventId) ?? null;
  const addDialogRef = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const dialog = addDialogRef.current;
    if (!dialog || !showAddModal) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [showAddModal]);
  useEffect(() => {
    if (!showAddModal) return;
    const refresh = () => setClock(new Date());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [showAddModal]);
  const [newSlotDate, setNewSlotDate] = useState(date);
  const [formError, setFormError] = useState('');
  const [newSlotTime, setNewSlotTime] = useState('');
  const [newCustomer, setNewCustomer] = useState('');
  const [newServiceId, setNewServiceId] = useState(services[0]?.id ?? '');
  const newService = services.find((service) => service.id === newServiceId);
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const activeEmployees = employees.filter(employee => employee.status === 'Active');
  const eligibleEmployees = newService ? activeEmployees.filter(employee => isEmployeeAssignedToService(newService, employee)) : [];
  const newEmployee = eligibleEmployees.find(employee => employee.id === newEmployeeId);
  const context = { services, employees, bookingHours, shiftOverview, events, requests, closedDates, absences, timeZone, now: clock };
  const availableSlots = newService && newEmployee && newSlotDate ? getAvailableSlots(context, {
    date: newSlotDate, serviceId: newService.id, employeeId: newEmployee.id,
    mode: 'owner', excludeEventId: editingEventId ?? undefined,
  }) : [];
  const selectedStartTime = availableSlots.includes(newSlotTime) ? newSlotTime : '';
  const createUnavailable = services.length === 0 || activeEmployees.length === 0;
  const fail = (message: string) => {
    setFormError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  };
  const openCreate = (slotDate = date, preferredTime = '') => {
    const service = services.find(item => item.id === serviceFilter) ?? services[0];
    const eligible = service ? activeEmployees.filter(employee => isEmployeeAssignedToService(service, employee)) : [];
    setEditingEventId(null);
    setNewCustomer('');
    setNewSlotDate(slotDate);
    setNewServiceId(service?.id ?? '');
    setNewEmployeeId(eligible.find(employee => employee.id === staffFilter)?.id ?? eligible[0]?.id ?? '');
    setNewSlotTime(preferredTime);
    setFormError('');
    setClock(new Date());
    setShowAddModal(true);
  };
  const openEdit = (event: CalendarEvent) => {
    setEditingEventId(event.id);
    setNewCustomer(event.customerName);
    setNewSlotDate(event.date);
    setNewServiceId(event.serviceId ?? services.find(service => service.name === event.serviceName)?.id ?? '');
    setNewEmployeeId(event.employeeId ?? employees.find(employee => employee.name === event.staffName)?.id ?? '');
    setNewSlotTime(event.startTime);
    setFormError('');
    setClock(new Date());
    setSelectedEvent(null);
    setShowAddModal(true);
  };

  const isOpenDate = (value: string) => {
    const weekday = new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    return !closedDates.some(closure => value >= closure.start && value <= closure.end) &&
      bookingHours.some((day) => day.day === weekday && day.isOpen && day.from < day.to);
  };
  const makeDay = (value: string) => ({
    key: value,
    label: formatCalendarDate(value),
    closed: !isOpenDate(value),
  });
  const weekStart = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, index) => makeDay(addDays(weekStart, index)));
  const visibleDays = activeView === 'Day'
    ? [makeDay(date)]
    : activeView === '3-day'
      ? Array.from({ length: 3 }, (_, index) => makeDay(addDays(date, index)))
      : days;
  const gridStyle = { gridTemplateColumns: `4rem repeat(${visibleDays.length}, minmax(0, 1fr))` };
  const navigationStep = activeView === 'Day' ? 1 : activeView === '3-day' ? 3 : 7;
  const visibleEvents = events
    .filter((event) => visibleDays.some((day) => day.key === event.date))
    .filter(event => !staffFilter || (event.employeeId !== undefined ? event.employeeId === staffFilter : event.staffName === employees.find(employee => employee.id === staffFilter)?.name))
    .filter(event => !serviceFilter || (event.serviceId !== undefined ? event.serviceId === serviceFilter : event.serviceName === services.find(service => service.id === serviceFilter)?.name))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  const dateRange = `${visibleDays[0].label} - ${visibleDays[visibleDays.length - 1].label}`;

  const hours = calendarHours(visibleDays.map(day => day.key), bookingHours, visibleEvents);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomer.trim()) { fail('Enter the customer name.'); return; }
    if (!newService) { fail('Choose an available service. Add a service in Services if none exist.'); return; }
    if (!newEmployee) { fail('Choose an active employee assigned to this service.'); return; }
    if (!newSlotDate || !selectedStartTime) { fail('Choose an available date and start time.'); return; }
    if (editingEventId && !editingEvent) { fail('This appointment no longer exists. Close the editor and return to the calendar.'); return; }
    const { id: _id, ...previous } = editingEvent ?? { id: '' };
    const updatedEvent: Omit<CalendarEvent, 'id'> = {
      ...previous,
      customerName: newCustomer.trim(),
      serviceId: newService.id,
      serviceName: newService.name,
      employeeId: newEmployee.id,
      staffName: newEmployee.name,
      date: newSlotDate,
      day: dayKeyForDate(newSlotDate),
      dateDisplay: formatCalendarDate(newSlotDate),
      startTime: selectedStartTime,
      endTime: addMinutes(selectedStartTime, newService.durationMinutes),
      colorTheme: editingEvent?.colorTheme ?? 'blue',
      isAiBooked: editingEvent?.isAiBooked ?? false,
      outsideHoursApproved: false,
    };
    const error = editingEventId ? onUpdateEvent(editingEventId, updatedEvent) : onAddEvent(updatedEvent);
    if (error) { setClock(new Date()); fail(error); return; }

    onDateChange(newSlotDate);
    setNewCustomer('');
    setShowAddModal(false);
    setEditingEventId(null);
  };

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header / View Controller matching Figma */}
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        {/* Title & Navigation */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Calendar
          </h1>
          <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
            {date.slice(0, 4)}
          </span>

          <div className="flex max-w-full flex-wrap items-center gap-1.5">
            <button onClick={() => onDateChange(getSalonNow(timeZone).date)} className="min-h-11 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
              Today
            </button>
            <div className="flex max-w-full items-center bg-white border border-slate-200 rounded-xl shadow-2xs">
              <button aria-label="Previous date range" onClick={() => onDateChange(addDays(date, -navigationStep))} className="flex size-11 shrink-0 items-center justify-center text-slate-500 hover:text-slate-800 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="min-w-0 text-center text-xs font-medium text-slate-600 px-1">{dateRange}</span>
              <button aria-label="Next date range" onClick={() => onDateChange(addDays(date, navigationStep))} className="flex size-11 shrink-0 items-center justify-center text-slate-500 hover:text-slate-800 transition-colors">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <input type="date" aria-label="Calendar date" value={date} onChange={(e) => { if (e.target.value) onDateChange(e.target.value); }} className="min-h-11 w-40 min-w-0 px-2 py-1.5 text-base sm:text-xs bg-white border border-slate-200 rounded-xl" />
          </div>
        </div>

        {/* View switcher (List, Day, 3-day, Week, Filter) */}
        <div className="flex max-w-full flex-wrap items-center gap-2 self-stretch xl:self-auto">
          <div className="grid w-full grid-cols-4 items-center bg-slate-100/90 p-1 rounded-xl text-xs font-medium text-slate-600 sm:flex sm:w-auto">
            {(['List', 'Day', '3-day', 'Week'] as const).map((view) => (
              <button
                key={view}
                aria-pressed={activeView === view}
                onClick={() => setActiveView(view)}
                className={`min-h-11 px-3 py-1.5 rounded-lg transition-all ${
                  activeView === view
                    ? 'bg-[#5551FF] text-white font-semibold shadow-xs'
                    : 'hover:text-slate-900 text-slate-500'
                }`}
              >
                {view}
              </button>
            ))}
          </div>

          <button aria-expanded={showFilters} aria-controls="calendar-filters" onClick={() => setShowFilters(value => !value)} className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Filter{staffFilter || serviceFilter ? ' •' : ''}</span>
          </button>

          <button
            aria-label="Add appointment"
            disabled={createUnavailable}
            onClick={() => openCreate()}
            className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-2xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">Appointment times are in {salonTimeZone(timeZone)}.</p>
      {showFilters && <section id="calendar-filters" aria-label="Calendar filters" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="calendar-staff-filter" className="mb-1 block text-xs font-semibold text-slate-600">Employee</label>
          <select id="calendar-staff-filter" value={staffFilter} onChange={event => setStaffFilter(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-base sm:text-sm">
            <option value="">All employees</option>
            {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="calendar-service-filter" className="mb-1 block text-xs font-semibold text-slate-600">Service</label>
          <select id="calendar-service-filter" value={serviceFilter} onChange={event => setServiceFilter(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-base sm:text-sm">
            <option value="">All services</option>
            {services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
          </select>
        </div>
        <button onClick={() => { setStaffFilter(''); setServiceFilter(''); }} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50">Clear filters</button>
      </section>}
      {(staffFilter || serviceFilter) && <p role="status" className="text-xs text-slate-500">{visibleEvents.length} appointments match the selected filters in this date range.</p>}
      {services.length === 0 && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Add a service in Services before creating an appointment.</p>}
      {services.length > 0 && activeEmployees.length === 0 && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Add an active employee and assign them to a service before creating an appointment.</p>}
      {selectedEventId && !selectedEvent && <p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">This appointment is no longer available. <button className="font-semibold text-[#5551FF] underline" onClick={() => onSelectEvent(null)}>View calendar</button></p>}

      {/* Calendar Grid View */}
      {activeView === 'List' ? (
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-3">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Appointments ({dateRange})</h2>
          {visibleEvents.length === 0 && <p className="text-sm text-slate-500">No appointments in this date range.</p>}
          {visibleEvents.map((ev) => (
            <div
              key={ev.id}
              role="button"
              tabIndex={0}
              aria-label={`Open appointment for ${ev.customerName} on ${formatCalendarDate(ev.date)} at ${ev.startTime}`}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedEvent(ev); } }}
              onClick={() => setSelectedEvent(ev)}
              className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-slate-50 hover:bg-indigo-50/50 border border-slate-100 transition-colors cursor-pointer"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="w-2 h-10 shrink-0 rounded-full bg-[#5551FF]" />
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="text-sm font-bold text-slate-900">{ev.customerName}</p>
                  <p className="text-xs text-slate-500">{ev.serviceName} · Staff: {ev.staffName}</p>
                </div>
              </div>
              <div className="shrink-0 pl-6 sm:pl-0 sm:text-right">
                <p className="text-xs font-semibold text-slate-800">{formatCalendarDate(ev.date)}</p>
                <p className="text-xs text-[#5551FF] font-medium">{ev.startTime} - {ev.endTime}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="min-w-0">
          {activeView !== 'Day' && <p className="mb-2 text-xs text-slate-500 xl:hidden">Scroll sideways to see all days. Use Day for a single-day view.</p>}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto">
          <div className={activeView === 'Day' ? 'min-w-0' : activeView === '3-day' ? 'min-w-[640px]' : 'min-w-[760px]'}>
            {/* Days Column Headers */}
            <div style={gridStyle} className="grid border-b border-slate-200/80 text-xs font-semibold text-slate-600 bg-slate-50/50">
              <div className="sticky left-0 z-10 bg-slate-50 px-1 py-3.5 text-center text-slate-400 border-r border-slate-100">
                Time
              </div>
              {visibleDays.map((d) => (
                <div
                  key={d.key}
                  className={`p-3.5 text-center border-r last:border-r-0 border-slate-100 ${
                    d.closed ? 'text-slate-400 bg-slate-50/80' : 'text-slate-800'
                  }`}
                >
                  <span className="font-semibold">{d.label}</span>
                  <span className="mt-0.5 block text-[10px] font-normal text-slate-400">{calendarTimeZoneOffset(d.key, timeZone)}</span>
                  {events.some((event) => event.date === d.key && event.outsideHoursApproved) && (
                    <span className="block text-[10px] font-medium text-indigo-600 mt-1">Owner-approved appointment</span>
                  )}
                </div>
              ))}
            </div>

            {/* Time grid */}
            <div className="relative divide-y divide-slate-100">
              {hours.map((hour) => (
                <div
                  key={hour}
                  style={gridStyle}
                  className="grid min-h-[58px] group"
                >
                  {/* Left Hour Label */}
                  <div className="sticky left-0 z-10 bg-white p-2.5 text-right text-xs font-medium text-slate-400 border-r border-slate-100 select-none">
                    {hour}
                  </div>

                  {/* Day Slots */}
                  {visibleDays.map((d) => {
                    // Check if there is an event matching day and start hour
                    const slotEvents = visibleEvents.filter(
                      (e) => e.date === d.key && e.startTime.startsWith(hour.slice(0, 2))
                    );

                    return (
                      <div
                        key={d.key}
                        onClick={() => {
                          if (!d.closed && !createUnavailable) openCreate(d.key, hour);
                        }}
                        className={`relative min-w-0 p-1 border-r last:border-r-0 border-slate-100 transition-colors ${
                          d.closed
                            ? 'bg-slate-50/70 cursor-not-allowed flex items-center justify-center'
                            : 'hover:bg-indigo-50/20 cursor-pointer'
                        }`}
                      >
                        {d.closed && slotEvents.length === 0 ? (
                          <span className="text-[11px] font-medium text-slate-400 select-none">
                            Closed
                          </span>
                        ) : (
                          slotEvents.map((ev) => (
                            <div
                              key={ev.id}
                              role="button"
                              tabIndex={0}
                              aria-label={`Open appointment for ${ev.customerName} on ${formatCalendarDate(ev.date)} at ${ev.startTime}`}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setSelectedEvent(ev); } }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedEvent(ev);
                              }}
                              className={`rounded-xl p-2 text-left cursor-pointer transition-transform hover:scale-[1.01] shadow-2xs border ${
                                ev.colorTheme === 'green'
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                                  : ev.colorTheme === 'yellow'
                                  ? 'bg-amber-50/90 border-amber-200 text-amber-950'
                                  : ev.colorTheme === 'purple'
                                  ? 'bg-purple-50 border-purple-200 text-purple-950'
                                  : 'bg-indigo-50 border-indigo-200 text-indigo-950'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="min-w-0 font-bold text-xs truncate">
                                  {ev.customerName}
                                </span>
                                {ev.isAiBooked && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-[#5551FF] text-white font-bold tracking-wider">
                                    AI
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] opacity-80 truncate">{ev.serviceName}</p>
                              <p className="text-[10px] opacity-70 tabular-nums">
                                {ev.startTime} – {ev.endTime}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Event Details Modal */}
      {selectedEvent && (
        <dialog ref={detailsRef} aria-labelledby="appointment-details-title" onCancel={e => { e.preventDefault(); setSelectedEvent(null); }} onClick={e => { if (e.target === e.currentTarget) setSelectedEvent(null); }} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full p-6 animate-in zoom-in-95">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#5551FF]">
                  Appointment Details
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
                <span>Time: <strong className="text-slate-800">{formatCalendarDate(selectedEvent.date)}, {selectedEvent.startTime} - {selectedEvent.endTime}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" />
                <span>Staff: <strong className="text-slate-800">{selectedEvent.staffName}</strong></span>
              </div>
              {selectedEvent.customerPhone && <p className="text-sm text-slate-600">Phone: <strong>{selectedEvent.customerPhone}</strong></p>}
              {selectedEvent.isAiBooked && (
                <div className="flex items-center gap-2 text-indigo-600 font-medium bg-indigo-50 p-2 rounded-xl">
                  <Sparkles className="w-4 h-4" />
                  <span>Booked with the AI Assistant</span>
                </div>
              )}
              {selectedEvent.outsideHoursApproved && (
                <p className="text-xs text-indigo-700 bg-indigo-50 p-2 rounded-xl">Approved by the owner outside regular opening hours.</p>
              )}
            </div>

            <button onClick={() => openEdit(selectedEvent)} className="mb-3 min-h-11 w-full rounded-xl bg-[#5551FF] px-3 py-2 text-sm font-semibold text-white hover:bg-[#433fd8]">Edit appointment</button>
            <div className="pt-2 flex gap-2">
              <button
                onClick={() => {
                  onDeleteEvent(selectedEvent.id);
                  setSelectedEvent(null);
                }}
                className="min-h-11 flex-1 py-2 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors"
              >
                Cancel Appointment
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

      {/* Add New Appointment Modal */}
      {showAddModal && (
        <dialog ref={addDialogRef} aria-labelledby="new-appointment-title" onCancel={e => { e.preventDefault(); setShowAddModal(false); }} onClick={e => { if (e.target === e.currentTarget) setShowAddModal(false); }} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-xs">
          <form
            onSubmit={handleCreateSubmit}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-in zoom-in-95"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 id="new-appointment-title" className="text-base font-bold text-slate-900">{editingEventId ? 'Edit Appointment' : 'New Appointment'}</h3>
              <button
                type="button"
                aria-label="Close appointment editor"
                onClick={() => setShowAddModal(false)}
                className="flex size-11 shrink-0 items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="appointment-customer" className="font-semibold text-slate-700 block mb-1">Customer Name *</label>
                <input
                  id="appointment-customer"
                  autoFocus
                  type="text"
                  required
                  placeholder="e.g. Sophie Martin"
                  value={newCustomer}
                  onChange={(e) => setNewCustomer(e.target.value)}
                  className="min-h-11 w-full min-w-0 px-3 py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="appointment-service" className="font-semibold text-slate-700 block mb-1">Service</label>
                  <select
                    id="appointment-service"
                    required
                    value={newService?.id ?? ''}
                    onChange={(e) => {
                      const service = services.find(item => item.id === e.target.value);
                      setNewServiceId(e.target.value);
                      setNewEmployeeId(previous => activeEmployees.some(employee => employee.id === previous && service && isEmployeeAssignedToService(service, employee)) ? previous : '');
                      setNewSlotTime('');
                      setFormError('');
                    }}
                    className="min-h-11 w-full min-w-0 px-3 py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  >
                    <option value="" disabled>Choose a service</option>
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>{service.name} ({service.durationMinutes} min, CHF {service.priceCHF})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="appointment-staff" className="font-semibold text-slate-700 block mb-1">Staff Member</label>
                  <select
                    id="appointment-staff"
                    required
                    value={newEmployee?.id ?? ''}
                    onChange={(e) => { setNewEmployeeId(e.target.value); setNewSlotTime(''); setFormError(''); }}
                    className="min-h-11 w-full min-w-0 px-3 py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  >
                    <option value="" disabled>Choose an employee</option>
                    {eligibleEmployees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                  </select>
                  {newService && eligibleEmployees.length === 0 && <p className="mt-2 text-xs text-amber-700">No active employee is assigned to this service. Update the service’s employee assignments first.</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="appointment-date" className="font-semibold text-slate-700 block mb-1">Date</label>
                  <input
                    id="appointment-date"
                    type="date"
                    required
                    min={getSalonNow(timeZone, clock).date}
                    value={newSlotDate}
                    onChange={(e) => { setNewSlotDate(e.target.value); setNewSlotTime(''); setFormError(''); }}
                    className="min-h-11 w-full min-w-0 px-3 py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label htmlFor="appointment-time" className="font-semibold text-slate-700 block mb-1">Available start time</label>
                  <select
                    id="appointment-time"
                    required
                    disabled={availableSlots.length === 0}
                    value={selectedStartTime}
                    onChange={(e) => { setNewSlotTime(e.target.value); setFormError(''); }}
                    className="min-h-11 w-full min-w-0 px-3 py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  >
                    <option value="" disabled>{availableSlots.length ? 'Choose a time' : 'No available times'}</option>
                    {availableSlots.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {newEmployee && newSlotDate && availableSlots.length === 0 && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">No times are available for this employee and service on this date. Choose another date or check opening hours, shifts, closures and existing appointments.</p>}
            {newSlotTime && !selectedStartTime && availableSlots.length > 0 && <p role="status" className="text-xs text-amber-700">The previous time is unavailable. Choose another start time.</p>}
            {newService && selectedStartTime && <p className="text-xs text-slate-500">{newService.durationMinutes} minutes · Ends at {addMinutes(selectedStartTime, newService.durationMinutes)} · {salonTimeZone(timeZone)}</p>}
            {formError && <p ref={errorRef} tabIndex={-1} role="alert" className="text-xs text-rose-600 focus:outline-hidden">{formError}</p>}
            <div className="pt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="min-h-11 flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newService || !newEmployee || !selectedStartTime}
                className="min-h-11 flex-1 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingEventId ? 'Save changes' : 'Create Appointment'}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
};
