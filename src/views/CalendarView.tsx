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
import { BookingHoursDay, CalendarEvent, ServiceItem } from '../types';
import { addDays, addMinutes, dayKeyForDate, formatCalendarDate, startOfWeek } from '../scheduling';

interface CalendarViewProps {
  events: CalendarEvent[];
  services: ServiceItem[];
  bookingHours: BookingHoursDay[];
  date: string;
  selectedEventId: string | null;
  onSelectEvent: (event: CalendarEvent | null) => void;
  onDateChange: (date: string) => void;
  onAddEvent: (event: Omit<CalendarEvent, 'id'>) => void;
  onDeleteEvent: (id: string) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  events,
  services,
  bookingHours,
  date,
  selectedEventId,
  onSelectEvent,
  onDateChange,
  onAddEvent,
  onDeleteEvent,
}) => {
  const [activeView, setActiveView] = useState<'List' | 'Day' | '3-day' | 'Week'>('Week');
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
  const addDialogRef = useRef<HTMLDialogElement>(null);
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
  const [newSlotDate, setNewSlotDate] = useState(date);
  const [formError, setFormError] = useState('');
  const [newSlotTime, setNewSlotTime] = useState('11:00');
  const [newCustomer, setNewCustomer] = useState('');
  const [newServiceId, setNewServiceId] = useState(services[0]?.id ?? '');
  const newService = services.find((service) => service.id === newServiceId) ?? services[0];
  const [newStaff, setNewStaff] = useState('Nilufar Ismayilova');

  const isOpenDate = (value: string) => {
    const weekday = new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    return bookingHours.some((day) => day.day === weekday && day.isOpen && day.from < day.to);
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
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  const dateRange = `${visibleDays[0].label} - ${visibleDays[visibleDays.length - 1].label}`;

  const hours = [
    '09:00',
    '10:00',
    '11:00',
    '12:00',
    '13:00',
    '14:00',
    '15:00',
    '16:00',
    '17:00',
  ];

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomer.trim() || !newSlotDate || !newService) return;
    if (!isOpenDate(newSlotDate)) {
      setFormError('The salon is closed on this date. Please choose an open day.');
      return;
    }
    const endTime = addMinutes(newSlotTime, newService.durationMinutes);
    if (endTime <= newSlotTime) {
      setFormError('Please choose a start time that lets the appointment finish on the same day.');
      return;
    }
    setFormError('');

    onAddEvent({
      customerName: newCustomer.trim(),
      serviceName: newService.name,
      staffName: newStaff,
      date: newSlotDate,
      day: dayKeyForDate(newSlotDate),
      dateDisplay: formatCalendarDate(newSlotDate),
      startTime: newSlotTime,
      endTime,
      colorTheme: 'blue',
      isAiBooked: false,
    });

    onDateChange(newSlotDate);
    setNewCustomer('');
    setShowAddModal(false);
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
            <button onClick={() => onDateChange(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }))} className="min-h-11 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
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

          <button className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Filter</span>
          </button>

          <button
            aria-label="Add appointment"
            onClick={() => { setNewSlotDate(date); setFormError(''); setShowAddModal(true); }}
            className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-2xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </div>
      </div>

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
                GMT+2
              </div>
              {visibleDays.map((d) => (
                <div
                  key={d.key}
                  className={`p-3.5 text-center border-r last:border-r-0 border-slate-100 ${
                    d.closed ? 'text-slate-400 bg-slate-50/80' : 'text-slate-800'
                  }`}
                >
                  <span className="font-semibold">{d.label}</span>
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
                    const slotEvents = events.filter(
                      (e) => e.date === d.key && e.startTime.startsWith(hour.slice(0, 2))
                    );

                    return (
                      <div
                        key={d.key}
                        onClick={() => {
                          if (!d.closed) {
                            setNewSlotDate(d.key);
                            setFormError('');
                            setNewSlotTime(hour);
                            setShowAddModal(true);
                          }
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
              <h3 id="new-appointment-title" className="text-base font-bold text-slate-900">New Appointment</h3>
              <button
                type="button"
                aria-label="Close new appointment"
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
                    value={newService?.id ?? ''}
                    onChange={(e) => setNewServiceId(e.target.value)}
                    className="min-h-11 w-full min-w-0 px-3 py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  >
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>{service.name} ({service.durationMinutes} min, CHF {service.priceCHF})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="appointment-staff" className="font-semibold text-slate-700 block mb-1">Staff Member</label>
                  <select
                    id="appointment-staff"
                    value={newStaff}
                    onChange={(e) => setNewStaff(e.target.value)}
                    className="min-h-11 w-full min-w-0 px-3 py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  >
                    <option value="Nilufar Ismayilova">Nilufar Ismayilova</option>
                    <option value="Eloise Denniese">Eloise Denniese</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="appointment-date" className="font-semibold text-slate-700 block mb-1">Date</label>
                  <input
                    id="appointment-date"
                    type="date"
                    required
                    value={newSlotDate}
                    onChange={(e) => { setNewSlotDate(e.target.value); setFormError(''); }}
                    className="min-h-11 w-full min-w-0 px-3 py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label htmlFor="appointment-time" className="font-semibold text-slate-700 block mb-1">Start Time</label>
                  <select
                    id="appointment-time"
                    value={newSlotTime}
                    onChange={(e) => setNewSlotTime(e.target.value)}
                    className="min-h-11 w-full min-w-0 px-3 py-2 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  >
                    {hours.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {newService && <p className="text-xs text-slate-500">{newService.durationMinutes} minutes · Ends at {addMinutes(newSlotTime, newService.durationMinutes)}</p>}
            {formError && <p role="alert" className="text-xs text-rose-600">{formError}</p>}
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
                className="min-h-11 flex-1 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors"
              >
                Create Appointment
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
};
