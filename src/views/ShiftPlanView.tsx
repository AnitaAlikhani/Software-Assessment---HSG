import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, ArrowLeft, X, Info, Clock } from 'lucide-react';
import { Employee, ShiftEntry } from '../types';
import { addDays, currentSalonWeek, formatCalendarDate, formatDate, salonTimeZone, startOfWeek } from '../scheduling';

interface ShiftPlanViewProps {
  employees: Employee[];
  shiftOverview: ShiftEntry[];
  timeZone?: string;
  onUpdateShift: (employeeId: string, date: string, shift: { start: string; end: string } | null) => void;
}

const minutesAt = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};
const fieldStyle = 'min-h-11 w-full min-w-0 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-base sm:text-sm text-slate-700';

export const ShiftPlanView: React.FC<ShiftPlanViewProps> = ({ employees, shiftOverview, timeZone, onUpdateShift }) => {
  const [weekStart, setWeekStart] = useState(() => currentSalonWeek(timeZone));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editorEmployeeId, setEditorEmployeeId] = useState('');
  const [editorDate, setEditorDate] = useState(weekStart);
  const [available, setAvailable] = useState(true);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const employeeSelectRef = useRef<HTMLSelectElement>(null);

  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId);
  const shiftFor = (employeeId: string, date: string) =>
    shiftOverview.find((entry) => entry.employeeId === employeeId)?.shifts[date] ?? null;
  const selectedShifts = selectedEmployee
    ? days.map((date) => shiftFor(selectedEmployee.id, date)).filter((shift) => shift !== null)
    : [];
  const scheduledHours = selectedShifts.reduce((total, shift) =>
    total + (minutesAt(shift.end) - minutesAt(shift.start)) / 60, 0);

  const loadShift = (employeeId: string, date: string, create = false) => {
    const shift = shiftFor(employeeId, date);
    setEditorEmployeeId(employeeId);
    setEditorDate(date);
    setAvailable(create || shift !== null);
    setStart(shift?.start ?? '09:00');
    setEnd(shift?.end ?? '18:00');
    setError('');
  };
  const openEditor = (employeeId: string, date: string, create = false) => {
    loadShift(employeeId, date, create);
    setShowEditor(true);
  };

  useEffect(() => {
    if (!showEditor) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    employeeSelectRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowEditor(false);
      }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]'
      ) ?? []).filter((element) => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [showEditor]);

  const saveShift = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editorDate || !employees.some((employee) => employee.id === editorEmployeeId)) {
      setError('Choose an employee and a date.');
      return;
    }
    if (available && (!start || !end || minutesAt(end) <= minutesAt(start))) {
      setError('The shift must end after it starts, on the same day.');
      return;
    }
    onUpdateShift(editorEmployeeId, editorDate, available ? { start, end } : null);
    setWeekStart(startOfWeek(editorDate));
    if (selectedEmployeeId) setSelectedEmployeeId(editorEmployeeId);
    setShowEditor(false);
  };

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {selectedEmployee && (
            <button onClick={() => setSelectedEmployeeId(null)} aria-label="Back to Shift Plan overview" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{selectedEmployee?.name ?? 'Shift Plan'}</h1>
            {selectedEmployee && <p className="text-xs text-slate-500 mt-1">Staff availability</p>}
          </div>
        </div>
        <button
          onClick={() => openEditor(selectedEmployee?.id ?? employees[0]?.id ?? '', weekStart, true)}
          disabled={employees.length === 0}
          className="flex min-h-11 shrink-0 items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />New Shift
        </button>
      </div>

      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setWeekStart(currentSalonWeek(timeZone))}
            className="min-h-11 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
          >Today</button>
          <div className="flex max-w-full items-center bg-white border border-slate-200 rounded-xl">
            <button aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))} className="flex size-11 shrink-0 items-center justify-center text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /></button>
            <span className="min-w-0 px-1 text-center text-xs font-semibold text-slate-600 tabular-nums">{formatCalendarDate(weekStart)} - {formatCalendarDate(days[6])}</span>
            <button aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))} className="flex size-11 shrink-0 items-center justify-center text-slate-500 hover:text-slate-800"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <input type="date" aria-label="Choose shift plan week" value={weekStart} onChange={(event) => { if (event.target.value) setWeekStart(startOfWeek(event.target.value)); }} className="min-h-11 max-w-full px-3 py-2 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-600" />
        </div>
        {selectedEmployee && (
          <div className="flex items-center gap-3 px-3 py-2 text-xs text-slate-600 bg-slate-100/80 rounded-xl">
            <Clock className="w-3.5 h-3.5" />
            <span><strong className="text-slate-900">{Number(scheduledHours.toFixed(2))}h</strong> scheduled</span>
            <span><strong className="text-slate-900">{selectedShifts.length}</strong> {selectedShifts.length === 1 ? 'shift' : 'shifts'}</span>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">Shift times are in {salonTimeZone(timeZone)}.</p>
      <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100/90 text-xs sm:text-sm text-indigo-900/80 leading-relaxed flex items-start gap-3">
        <Info className="w-4 h-4 text-[#5551FF] shrink-0 mt-0.5" />
        <p>Booking slots follow salon opening hours and staff shifts. An employee is unavailable on dates without a shift. Select a day to edit their availability.</p>
      </div>

      {employees.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center text-sm text-slate-500">Add an employee before creating a shift.</div>
      ) : selectedEmployee ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs divide-y divide-slate-100 overflow-hidden">
          {days.map((date) => {
            const shift = shiftFor(selectedEmployee.id, date);
            return (
              <div key={date} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{formatCalendarDate(date)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{formatDate(date)}</p>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-4">
                  <span className={`text-xs font-semibold tabular-nums ${shift ? 'text-emerald-700' : 'text-slate-400'}`}>{shift ? `${shift.start} - ${shift.end}` : 'Unavailable'}</span>
                  <button onClick={() => openEditor(selectedEmployee.id, date, !shift)} aria-label={`${shift ? 'Edit' : 'Add'} shift for ${selectedEmployee.name} on ${formatDate(date)}`} className="min-h-11 px-3 py-1.5 text-xs font-semibold text-[#5551FF] bg-[#5551FF]/8 hover:bg-[#5551FF]/15 rounded-xl">{shift ? 'Edit shift' : 'Add shift'}</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="min-w-0">
          <p className="mb-2 text-xs text-slate-500 xl:hidden">Scroll sideways to see all days, or select an employee for their daily schedule.</p>
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto">
          <table className="w-full min-w-[860px] text-xs text-left">
            <thead className="text-slate-400 bg-slate-50/50 border-b border-slate-100">
              <tr><th scope="col" className="sticky left-0 z-10 w-40 min-w-40 max-w-40 bg-slate-50 py-3.5 px-3 font-semibold border-r border-slate-100">Employee</th>{days.map((date) => <th scope="col" key={date} className="py-3.5 px-2 text-center font-semibold whitespace-nowrap">{formatCalendarDate(date)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((employee) => (
                <tr key={employee.id} className="hover:bg-slate-50/60">
                  <th scope="row" className="sticky left-0 z-10 w-40 min-w-40 max-w-40 bg-white py-4 px-3 border-r border-slate-100">
                    <button onClick={() => setSelectedEmployeeId(employee.id)} className="flex min-h-11 w-full min-w-0 items-center gap-2.5 text-left text-slate-800 hover:text-[#5551FF]" aria-label={`View shifts for ${employee.name}`} title={employee.name}>
                      <span className="w-8 h-8 rounded-xl bg-purple-50 text-[#5551FF] flex items-center justify-center font-bold shrink-0">{employee.initials}</span>
                      <span className="min-w-0 font-semibold truncate">{employee.name}</span>
                    </button>
                  </th>
                  {days.map((date) => {
                    const shift = shiftFor(employee.id, date);
                    return (
                      <td key={date} className="py-3 px-1 text-center">
                        <button onClick={() => openEditor(employee.id, date, !shift)} aria-label={`${shift ? 'Edit' : 'Add'} shift for ${employee.name} on ${formatDate(date)}`} className={`min-h-11 w-full whitespace-nowrap px-2 py-2 rounded-lg text-[11px] font-semibold tabular-nums border transition-colors ${shift ? 'bg-emerald-50 text-emerald-800 border-emerald-200/70 hover:bg-emerald-100' : 'bg-slate-50 text-slate-400 border-transparent hover:bg-indigo-50 hover:text-[#5551FF]'}`}>{shift ? `${shift.start} - ${shift.end}` : 'Unavailable'}</button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {showEditor && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end" onClick={(event) => { if (event.target === event.currentTarget) setShowEditor(false); }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="shift-editor-title" className="w-full max-w-md bg-white h-full shadow-2xl p-6 overflow-y-auto">
            <form onSubmit={saveShift} className="flex flex-col min-h-full gap-5 text-xs">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <h2 id="shift-editor-title" className="text-base font-bold text-slate-900">{shiftFor(editorEmployeeId, editorDate) ? 'Edit Shift' : 'New Shift'}</h2>
                <button type="button" aria-label="Close shift editor" onClick={() => setShowEditor(false)} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
              </div>
              <div>
                <label htmlFor="shift-employee" className="font-semibold text-slate-700 block mb-1.5">Employee</label>
                <select ref={employeeSelectRef} id="shift-employee" required value={editorEmployeeId} onChange={(event) => loadShift(event.target.value, editorDate, !shiftFor(event.target.value, editorDate))} className={fieldStyle}>
                  {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="shift-date" className="font-semibold text-slate-700 block mb-1.5">Date</label>
                <input id="shift-date" type="date" required value={editorDate} onChange={(event) => loadShift(editorEmployeeId, event.target.value, !shiftFor(editorEmployeeId, event.target.value))} className={fieldStyle} />
              </div>
              <label className="flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input type="checkbox" checked={available} onChange={(event) => { setAvailable(event.target.checked); setError(''); }} className="w-4 h-4 rounded accent-[#5551FF]" />
                <span className="font-semibold text-slate-700">Available on this date</span>
              </label>
              {available ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label htmlFor="shift-start" className="font-semibold text-slate-700 block mb-1.5">Start time</label><input id="shift-start" type="time" required value={start} onChange={(event) => { setStart(event.target.value); setError(''); }} className={fieldStyle} /></div>
                  <div><label htmlFor="shift-end" className="font-semibold text-slate-700 block mb-1.5">End time</label><input id="shift-end" type="time" required value={end} onChange={(event) => { setEnd(event.target.value); setError(''); }} className={fieldStyle} /></div>
                </div>
              ) : <p className="text-slate-500 leading-relaxed">Saving will remove any shift on this date. No booking slots will be offered for this employee on this date.</p>}
              {error && <p role="alert" className="text-rose-600">{error}</p>}
              <div className="flex gap-2 mt-auto pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowEditor(false)} className="min-h-11 flex-1 py-2.5 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl">Cancel</button>
                <button type="submit" className="min-h-11 flex-1 py-2.5 font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
