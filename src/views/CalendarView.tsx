import React, { useState } from 'react';
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
import { CalendarEvent, ServiceItem } from '../types';
import { addDays, addMinutes, dayKeyForDate, formatCalendarDate, startOfWeek } from '../scheduling';

interface CalendarViewProps {
  events: CalendarEvent[];
  services: ServiceItem[];
  date: string;
  onDateChange: (date: string) => void;
  onAddEvent: (event: Omit<CalendarEvent, 'id'>) => void;
  onDeleteEvent: (id: string) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  events,
  services,
  date,
  onDateChange,
  onAddEvent,
  onDeleteEvent,
}) => {
  const [activeView, setActiveView] = useState<'List' | 'Day' | '3-day' | 'Week'>('Week');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSlotDate, setNewSlotDate] = useState(date);
  const [formError, setFormError] = useState('');
  const [newSlotTime, setNewSlotTime] = useState('11:00');
  const [newCustomer, setNewCustomer] = useState('');
  const [newServiceId, setNewServiceId] = useState(services[0]?.id ?? '');
  const newService = services.find((service) => service.id === newServiceId) ?? services[0];
  const [newStaff, setNewStaff] = useState('Nilufar Ismayilova');

  const makeDay = (value: string) => ({
    key: value,
    label: formatCalendarDate(value),
    closed: ['sat', 'sun'].includes(dayKeyForDate(value)),
  });
  const weekStart = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, index) => makeDay(addDays(weekStart, index)));
  const visibleDays = activeView === 'Day'
    ? [makeDay(date)]
    : activeView === '3-day'
      ? Array.from({ length: 3 }, (_, index) => makeDay(addDays(date, index)))
      : days;
  const gridColumns = activeView === 'Day' ? 'grid-cols-2' : activeView === '3-day' ? 'grid-cols-4' : 'grid-cols-8';
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
    if (['sat', 'sun'].includes(dayKeyForDate(newSlotDate))) {
      setFormError('Please choose a weekday. The salon is closed at weekends.');
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header / View Controller matching Figma */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Title & Navigation */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Calendar
          </h1>
          <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
            {date.slice(0, 4)}
          </span>

          <div className="flex flex-wrap items-center gap-1.5 ml-2">
            <button onClick={() => onDateChange(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }))} className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
              Today
            </button>
            <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-2xs">
              <button aria-label="Previous date range" onClick={() => onDateChange(addDays(date, -navigationStep))} className="p-1.5 text-slate-500 hover:text-slate-800 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-medium text-slate-600 px-2">{dateRange}</span>
              <button aria-label="Next date range" onClick={() => onDateChange(addDays(date, navigationStep))} className="p-1.5 text-slate-500 hover:text-slate-800 transition-colors">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <input type="date" aria-label="Calendar date" value={date} onChange={(e) => { if (e.target.value) onDateChange(e.target.value); }} className="w-32 px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-xl" />
          </div>
        </div>

        {/* View switcher (List, Day, 3-day, Week, Filter) */}
        <div className="flex items-center gap-2 self-stretch sm:self-auto justify-between sm:justify-end">
          <div className="flex items-center bg-slate-100/90 p-1 rounded-xl text-xs font-medium text-slate-600">
            {(['List', 'Day', '3-day', 'Week'] as const).map((view) => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeView === view
                    ? 'bg-[#5551FF] text-white font-semibold shadow-xs'
                    : 'hover:text-slate-900 text-slate-500'
                }`}
              >
                {view}
              </button>
            ))}
          </div>

          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Filter</span>
          </button>

          <button
            onClick={() => { setNewSlotDate(date); setFormError(''); setShowAddModal(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-2xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Add</span>
          </button>
        </div>
      </div>

      {/* Calendar Grid View */}
      {activeView === 'List' ? (
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-3">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Appointments ({dateRange})</h2>
          {visibleEvents.length === 0 && <p className="text-sm text-slate-500">No appointments in this date range.</p>}
          {visibleEvents.map((ev) => (
            <div
              key={ev.id}
              onClick={() => setSelectedEvent(ev)}
              className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 hover:bg-indigo-50/50 border border-slate-100 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="w-2 h-10 rounded-full bg-[#5551FF]" />
                <div>
                  <p className="text-sm font-bold text-slate-900">{ev.customerName}</p>
                  <p className="text-xs text-slate-500">{ev.serviceName} · Staff: {ev.staffName}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-slate-800">{formatCalendarDate(ev.date)}</p>
                <p className="text-xs text-[#5551FF] font-medium">{ev.startTime} - {ev.endTime}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Days Column Headers */}
            <div className={`grid ${gridColumns} border-b border-slate-200/80 text-xs font-semibold text-slate-600 bg-slate-50/50`}>
              <div className="p-3.5 text-center text-slate-400 border-r border-slate-100">
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
                  className={`grid ${gridColumns} min-h-[58px] group`}
                >
                  {/* Left Hour Label */}
                  <div className="p-2.5 text-right text-xs font-medium text-slate-400 border-r border-slate-100 select-none">
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
                        className={`relative p-1 border-r last:border-r-0 border-slate-100 transition-colors ${
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
                                <span className="font-bold text-xs truncate">
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
      )}

      {/* Event Details Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full p-6 animate-in zoom-in-95">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#5551FF]">
                  Appointment Details
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  {selectedEvent.customerName}
                </h3>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs text-slate-600">
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
                className="flex-1 py-2 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors"
              >
                Cancel Appointment
              </button>
              <button
                onClick={() => setSelectedEvent(null)}
                className="flex-1 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Appointment Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSubmit}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-in zoom-in-95"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">New Appointment</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Customer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sophie Martin"
                  value={newCustomer}
                  onChange={(e) => setNewCustomer(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Service</label>
                  <select
                    value={newService?.id ?? ''}
                    onChange={(e) => setNewServiceId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  >
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>{service.name} ({service.durationMinutes} min, CHF {service.priceCHF})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Staff Member</label>
                  <select
                    value={newStaff}
                    onChange={(e) => setNewStaff(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  >
                    <option value="Nilufar Ismayilova">Nilufar Ismayilova</option>
                    <option value="Eloise Denniese">Eloise Denniese</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="appointment-date" className="font-semibold text-slate-700 block mb-1">Date</label>
                  <input
                    id="appointment-date"
                    type="date"
                    required
                    value={newSlotDate}
                    onChange={(e) => { setNewSlotDate(e.target.value); setFormError(''); }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Start Time</label>
                  <select
                    value={newSlotTime}
                    onChange={(e) => setNewSlotTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-hidden"
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
                className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl transition-colors"
              >
                Create Appointment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
