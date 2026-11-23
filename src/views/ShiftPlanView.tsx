import React, { useEffect, useRef, useState } from 'react';
import { notSavedText, pendingFormSave, refreshSharedSalon, useServerValue } from '../useDemoState';
import { followStored } from '../formFollow';
import { useFormSave } from '../formSave';
import { useHorizontalOverflow } from '../useHorizontalOverflow';
import { ChevronLeft, ChevronRight, CalendarClock, ArrowLeft, X, Info, Clock, Copy } from 'lucide-react';
import { AppointmentRequest, CalendarEvent, Employee, ShiftEntry, StaffAbsence } from '../types';
import { requestTimes } from '../appointmentActions';
import { addDays, currentSalonWeek, formatCalendarDate, formatDate, getSalonNow, startOfWeek } from '../scheduling';
import { formatDateRange, formatTimeRange, weekdayName } from '../format';
import { useCloseOnBack } from '../backGesture';
import { staffAvatarStyle, staffColorFor } from '../staffColors';
import { validateDayHours } from '../managementValidation';
import {
  copyOfWeekBefore, formatHoursTotal, hasRegularHours, minutesInWeek, timeChoices, weekCopySource, workingDayOn,
  type DayChange, type Hours, type WeekCopy, type WorkingDay,
} from '../workingHours';

interface ShiftPlanViewProps {
  employees: Employee[];
  /** The single days that differ from people's regular hours. Everything else follows the regular week. */
  shiftOverview: ShiftEntry[];
  timeZone?: string;
  /** Stores changes to single days. `note` says what happened when several days change at once. */
  onUpdateShift: (changes: DayChange[], note?: string) => void;
  /** The moment the plan opens on. Tests pass a fixed one; the app leaves it out and gets the current week. */
  now?: Date;
  /** The calendar: a changed day says which appointments it leaves outside the working hours. */
  events?: CalendarEvent[];
  /** The waiting requests: a changed day also says which of them could no longer be confirmed. */
  requests?: AppointmentRequest[];
  /** Days somebody is away (Absences): shown in the week and not counted as working time. */
  absences?: StaffAbsence[];
  /** Opens a person's form at their regular working hours. The way there is offered only where it leads somewhere. */
  onEditRegularHours?: (employeeId: string) => void;
}

const fieldStyle = 'min-h-11 w-full min-w-0 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-base sm:text-sm text-slate-700';
const range = (hours: Hours) => formatTimeRange(hours.start, hours.end);
/** The word that marks today's column or row. Where it stands (beside or below the date) is the caller's choice. */
const TodayMark: React.FC<{ className: string }> = ({ className }) => (
  <span className={`rounded-full bg-[#5551FF] px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white ${className}`}>Today</span>
);

/** A day in words, for the name of the control that changes it: "08:30–17:00, regular hours". */
const dayInWords = (day: WorkingDay, away: boolean): string => {
  const hours = day.hours ? range(day.hours) : 'off';
  if (away) return day.hours ? `away, would work ${hours}` : 'away';
  if (day.kind === 'regular') return day.hours ? `${hours}, regular hours` : 'off, regular day off';
  return `${hours}, changed for this day, ${day.regular ? `instead of ${range(day.regular)}` : 'usually off'}`;
};

/**
 * The hours of one day as the week shows them. Regular hours are plain. A day that was changed
 * is marked and says what it replaces; a day somebody is away says so.
 */
const DayHours: React.FC<{ day: WorkingDay; away: boolean; align?: 'start' | 'center' | 'row' }> = ({ day, away, align = 'center' }) => {
  // 'row': in one person's week the hours stand under the day on a phone and beside it, at the right, on wider screens.
  const column = `flex flex-col gap-0.5 ${{ start: 'items-start text-left', center: 'items-center text-center', row: 'items-start text-left sm:items-end sm:text-right' }[align]}`;
  if (away) {
    return (
      <span className={column}>
        <span className="font-semibold text-sky-800">Away</span>
        {day.hours && <span className="text-[11px] text-sky-800/70 tabular-nums"><span className="sr-only">would work </span><s>{range(day.hours)}</s></span>}
      </span>
    );
  }
  if (day.kind === 'regular') {
    return day.hours
      ? <span className="font-semibold text-slate-700 tabular-nums">{range(day.hours)}</span>
      : <span className="text-slate-500">Off</span>;
  }
  return (
    <span className={column}>
      <span className="font-bold text-amber-950 tabular-nums">{day.hours ? range(day.hours) : 'Off'}</span>
      <span className="text-[11px] text-amber-900/80 tabular-nums">
        {day.regular ? <><span className="sr-only">instead of </span><s>{range(day.regular)}</s></> : 'extra day'}
      </span>
    </span>
  );
};

/**
 * The tab "This week" of Team: who works when, day by day. Each day shows the hours that apply:
 * the person's regular hours, or what was entered for that one day (other hours, or off). A tap
 * on a day changes that day only; the regular week is part of the person's form in People.
 * It opens on the current week and can be turned to any other one. A tap on a person shows
 * that person's week by itself.
 */
export const ShiftPlanView: React.FC<ShiftPlanViewProps> = ({
  employees, shiftOverview, timeZone, onUpdateShift, now, events = [], requests = [], absences = [], onEditRegularHours,
}) => {
  const today = getSalonNow(timeZone, now).date;
  const [weekStart, showWeek] = useState(() => currentSalonWeek(timeZone, now));
  const [selectedEmployeeId, selectEmployee] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editorEmployeeId, setEditorEmployeeId] = useState('');
  const [editorDate, setEditorDate] = useState(weekStart);
  const [works, setWorks] = useState(true);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [error, setError] = useState('');
  // The editor's save is on its way to the server (signed-in device): this opening of the editor
  // waits for its answer; another day or person, or the editor opened again, is not touched by it
  // (src/formSave.ts).
  const { saving, notSaved, newOpening, afterSave } = useFormSave();
  /** Closes the editor: its opening ends, and an answer still on its way no longer concerns it. */
  const closeEditor = () => { setShowEditor(false); newOpening(); };
  // "Copy last week": the question before days that are already changed are overwritten, and what it led to.
  const [copyQuestion, setCopyQuestion] = useState<WeekCopy | null>(null);
  const [copyNotice, setCopyNotice] = useState('');
  // Another week or another person: what was asked or said about a copy no longer fits what is shown.
  const forgetCopy = () => { setCopyQuestion(null); setCopyNotice(''); };
  const setWeekStart = (week: string) => { showWeek(week); forgetCopy(); };
  const setSelectedEmployeeId = (id: string | null) => { selectEmployee(id); forgetCopy(); };
  const copyQuestionRef = useRef<HTMLParagraphElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const tableScrolls = useHorizontalOverflow(tableRef, [selectedEmployeeId]);
  const employeeSelectRef = useRef<HTMLSelectElement>(null);

  // Somebody who is set to inactive gets no appointments: the week is planned for the others.
  const team = employees.filter((employee) => employee.status === 'Active');
  const notShown = employees.length - team.length;
  const salon = { employees, shiftOverview };
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const thisWeek = weekStart === startOfWeek(today);
  const selectedEmployee = team.find((employee) => employee.id === selectedEmployeeId);
  const awayOn = (employeeId: string, date: string) =>
    absences.some((absence) => absence.employeeId === employeeId && date >= absence.start && date <= absence.end);
  const dayOf = (employeeId: string, date: string) => workingDayOn(salon, employeeId, date);
  const weekTotal = (employeeId: string) => formatHoursTotal(minutesInWeek(salon, employeeId, weekStart, (date) => awayOn(employeeId, date)));
  const nameOf = (employeeId: string) => employees.find((employee) => employee.id === employeeId)?.name ?? '';
  const changeLabel = (employee: Employee, date: string) =>
    `${employee.name}, ${formatDate(date, { weekday: 'long' })}: ${dayInWords(dayOf(employee.id, date), awayOn(employee.id, date))}. Change this day`;

  // What the editor showed when it was filled for a person and a day. Anything else in it now would be lost on closing.
  const [loaded, setLoaded] = useState('');
  // The editor compares with what the server has of the day, and follows it while open
  // (src/formFollow.ts): a field the owner has not changed shows a change made on another device.
  const storedEmployees = useServerValue('employees', employees);
  const storedShifts = useServerValue('shifts', shiftOverview);
  const storedDay = (employeeId: string, date: string) => {
    const day = workingDayOn({ employees: storedEmployees, shiftOverview: storedShifts }, employeeId, date);
    // A day off opens with the times it would regularly have, ready for "works on this day".
    return [day.hours !== null, (day.hours ?? day.regular)?.start ?? '09:00', (day.hours ?? day.regular)?.end ?? '18:00'] as const;
  };
  if (showEditor && editorEmployeeId && loaded) {
    const stored = JSON.stringify(storedDay(editorEmployeeId, editorDate));
    if (stored !== loaded) {
      const [w0, s0, e0] = JSON.parse(loaded) as [boolean, string, string];
      const [w1, s1, e1] = JSON.parse(stored) as [boolean, string, string];
      // The two times of the day are one field: a start typed here is never paired with an end saved elsewhere.
      const next = followStored({ works: w0, times: `${s0} ${e0}` }, { works, times: `${start} ${end}` }, { works: w1, times: `${s1} ${e1}` });
      const [nextStart, nextEnd] = next.times.split(' ');
      setWorks(next.works); setStart(nextStart); setEnd(nextEnd);
      setLoaded(stored);
    }
  }
  const loadDay = (employeeId: string, date: string) => {
    const shown = storedDay(employeeId, date);
    setEditorEmployeeId(employeeId);
    setEditorDate(date);
    setWorks(shown[0]);
    setStart(shown[1]);
    setEnd(shown[2]);
    setLoaded(JSON.stringify(shown));
    setError('');
    newOpening();
  };
  /** A tap beside the editor, Escape or the Back gesture: quickly done, so changed times ask first. Cancel and X close at once. */
  const dismissEditor = () => {
    if (JSON.stringify([works, start, end]) !== loaded && !window.confirm('Discard the changes to this day?')) return;
    closeEditor();
  };
  const dismissRef = useRef(dismissEditor);
  dismissRef.current = dismissEditor;
  // One person's week is a page inside "This week": the phone's Back gesture leads back to the whole team.
  const panelRef = useRef<HTMLDivElement>(null);
  useCloseOnBack(panelRef, selectedEmployeeId !== null, () => setSelectedEmployeeId(null));
  const openEditor = (employeeId: string, date: string) => {
    refreshSharedSalon();
    loadDay(employeeId, date);
    forgetCopy();
    setShowEditor(true);
  };
  /** "Change a day": the person whose week is open, and today while this week is shown (else the week's first day). */
  const changeADay = () => openEditor(selectedEmployee?.id ?? team[0]?.id ?? '', thisWeek ? today : weekStart);

  useEffect(() => {
    if (!showEditor) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    employeeSelectRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
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
  useEffect(() => { if (copyQuestion) copyQuestionRef.current?.focus(); }, [copyQuestion]);

  const saveDay = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editorDate || !team.some((employee) => employee.id === editorEmployeeId)) {
      setError('Choose an employee and a date.');
      return;
    }
    const problem = works ? validateDayHours({ start, end }) : null;
    if (problem) { setError(problem); return; }
    if (saving) return;
    onUpdateShift([{ employeeId: editorEmployeeId, date: editorDate, hours: works ? { start, end } : null }]);
    const done = () => {
      setWeekStart(startOfWeek(editorDate));
      if (selectedEmployeeId) setSelectedEmployeeId(editorEmployeeId);
      closeEditor();
    };
    closeWhenSaved(done);
  };
  const backToRegular = (employeeId: string, date: string) => {
    if (saving) return;
    onUpdateShift([{ employeeId, date, hours: 'regular' }]);
    closeWhenSaved(closeEditor);
  };
  /**
   * On a signed-in device the editor stays as typed until the server has the day; not taken, it
   * stays open and the message says why. Elsewhere it closes at once.
   */
  const closeWhenSaved = (done: () => void) => {
    afterSave(pendingFormSave(), done, notSavedText);
  };
  // Why the last save was not taken, said only while the editor holds something the server does not have.
  const shownError = error || (notSaved && JSON.stringify([works, start, end]) !== loaded ? notSaved : '');

  // "Copy last week": the days that were changed in the week before the one shown, for the people shown.
  const sourceWeek = formatDateRange(addDays(weekStart, -7), addDays(weekStart, -1));
  const copyLabel = thisWeek ? 'Copy last week' : 'Copy the week before';
  const applyCopy = (copy: WeekCopy) => {
    const count = copy.changes.length;
    onUpdateShift(copy.changes, `${count} changed ${count === 1 ? 'day' : 'days'} copied from ${weekCopySource(copy)}`);
    forgetCopy();
  };
  const copyWeekBefore = () => {
    const copy = copyOfWeekBefore({ employees: selectedEmployee ? [selectedEmployee] : team, shiftOverview }, weekStart);
    if (copy.changes.length === 0) {
      setCopyQuestion(null);
      setCopyNotice(`Nothing to copy: no day ${selectedEmployee ? `of ${selectedEmployee.name} ` : ''}was changed in the week of ${weekCopySource(copy)}, or this week already holds the same.`);
      return;
    }
    setCopyNotice('');
    // Days that are changed in this week already would be replaced: that is asked first.
    if (copy.overwrites.length > 0) setCopyQuestion(copy);
    else applyCopy(copy);
  };
  const keepWeek = () => {
    setCopyQuestion(null);
    requestAnimationFrame(() => copyButtonRef.current?.focus());
  };

  // The editor's own day: what applies now, and what a save would do to the appointments of that day.
  const editorEmployee = team.find((employee) => employee.id === editorEmployeeId);
  const editorDay = dayOf(editorEmployeeId, editorDate);
  const editorAway = awayOn(editorEmployeeId, editorDate);
  const leftOutside = !showEditor || !editorEmployee || editorDate < today ? 0 : events.filter((appointment) =>
    appointment.date === editorDate
    && (appointment.employeeId !== undefined ? appointment.employeeId === editorEmployee.id : appointment.staffName === editorEmployee.name)
    && (!works || appointment.startTime < start || appointment.endTime > end)).length;
  // Requests that wait for that day: with these hours the owner could no longer accept them.
  const waitingOutside = !showEditor || !editorEmployee || editorDate < today ? 0 : requests.filter((request) => {
    const times = requestTimes(request);
    return request.status === 'pending' && request.date === editorDate
      && (request.employeeId !== undefined ? request.employeeId === editorEmployee.id : request.staffName === editorEmployee.name)
      && (!works || !times || times.start < start || times.end > end);
  }).length;

  return (
    <div ref={panelRef} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {selectedEmployee && (
            <button onClick={() => setSelectedEmployeeId(null)} aria-label="Back to the whole team" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h2 className="text-base font-bold text-slate-900">{selectedEmployee?.name ?? 'Working hours'}</h2>
            {selectedEmployee && <p className="text-xs text-slate-500 mt-0.5">Working hours of the week</p>}
          </div>
        </div>
        <button
          onClick={changeADay}
          disabled={team.length === 0}
          className="flex min-h-11 shrink-0 items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <CalendarClock className="w-3.5 h-3.5" />Change a day
        </button>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setWeekStart(currentSalonWeek(timeZone, now))}
            className="min-h-11 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
          >Today</button>
          <div className="flex max-w-full items-center bg-white border border-slate-200 rounded-xl">
            <button aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))} className="flex size-11 shrink-0 items-center justify-center text-slate-500 hover:text-slate-800"><ChevronLeft className="w-4 h-4" /></button>
            <span className="min-w-0 px-1 text-center text-xs font-semibold text-slate-600 tabular-nums">{formatDateRange(weekStart, days[6])}</span>
            <button aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))} className="flex size-11 shrink-0 items-center justify-center text-slate-500 hover:text-slate-800"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <input type="date" aria-label="Choose a week" value={weekStart} onChange={(event) => { if (event.target.value) setWeekStart(startOfWeek(event.target.value)); }} className="min-h-11 max-w-full px-3 py-2 text-base sm:text-xs bg-white border border-slate-200 rounded-xl text-slate-600" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedEmployee && (
            <div className="flex min-h-11 items-center gap-2 px-3 py-2 text-xs text-slate-600 bg-slate-100/80 rounded-xl">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span><strong className="text-slate-900 tabular-nums">{weekTotal(selectedEmployee.id)}</strong> {thisWeek ? 'this week' : 'that week'}</span>
            </div>
          )}
          {team.length > 0 && (
            <button ref={copyButtonRef} type="button" onClick={copyWeekBefore} title={`Copy the changed days of ${sourceWeek} into the week shown`}
              className="flex min-h-11 items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />{copyLabel}
            </button>
          )}
        </div>
      </div>

      {/* Asked before a copy replaces days that are already changed in the week shown. */}
      {copyQuestion && (
        <div role="group" aria-labelledby="copy-week-title" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950"
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); keepWeek(); } }}>
          <p id="copy-week-title" ref={copyQuestionRef} tabIndex={-1} className="text-sm font-semibold focus:outline-hidden">
            Overwrite {copyQuestion.overwrites.length === 1 ? 'a day that is' : `${copyQuestion.overwrites.length} days that are`} already changed?
          </p>
          <p className="mt-1 leading-relaxed">
            The week of {weekCopySource(copyQuestion)} has {copyQuestion.changes.length} changed {copyQuestion.changes.length === 1 ? 'day' : 'days'} to copy. In the week shown, this would replace:
          </p>
          <ul className="mt-2 space-y-1 leading-relaxed">
            {copyQuestion.overwrites.map((now) => {
              const next = copyQuestion.changes.find((change) => change.employeeId === now.employeeId && change.date === now.date);
              const words = (hours: DayChange['hours'] | undefined) => hours && hours !== 'regular' ? range(hours) : 'off';
              return <li key={`${now.employeeId}-${now.date}`}><strong className="font-semibold">{nameOf(now.employeeId)}</strong>, <span className="tabular-nums">{formatCalendarDate(now.date)}</span>: <span className="tabular-nums">{words(now.hours)}</span> becomes <span className="tabular-nums">{words(next?.hours)}</span></li>;
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => applyCopy(copyQuestion)} className="min-h-11 rounded-xl bg-[#5551FF] px-4 py-2 font-semibold text-white hover:bg-[#433fd8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">Copy and overwrite</button>
            <button type="button" onClick={keepWeek} className="min-h-11 rounded-xl bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">Cancel</button>
          </div>
        </div>
      )}
      {copyNotice && <p role="status" className="rounded-xl bg-slate-100 p-3 text-xs leading-relaxed text-slate-700">{copyNotice}</p>}

      <div className="p-3 sm:p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100/90 text-xs sm:text-sm text-indigo-900/80 leading-relaxed flex items-start gap-3">
        <Info className="w-4 h-4 text-[#5551FF] shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p>Everybody works their regular hours, set in People. Select a day to change that one day: other hours, or a day off.</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm border border-slate-300 bg-white" />Regular hours</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm border border-amber-300 bg-amber-100" />Changed for this day</span>
            {absences.length > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm border border-sky-200 bg-sky-100" />Away</span>}
          </p>
        </div>
      </div>

      {employees.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center text-sm text-slate-500">Add an employee in People before planning the week.</div>
      ) : team.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center text-sm text-slate-500">Nobody in the team is active. Set a person to active in People to plan their week.</div>
      ) : selectedEmployee ? (
        <div className="space-y-3">
          {!hasRegularHours(selectedEmployee) && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
              <p className="min-w-0 flex-1 leading-relaxed">{selectedEmployee.name} has no regular working hours: only days entered here count as working time.</p>
              {onEditRegularHours && <button type="button" onClick={() => onEditRegularHours(selectedEmployee.id)} className="min-h-11 shrink-0 rounded-xl bg-white px-3 py-2 font-semibold text-[#5551FF] border border-amber-200 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]">Set regular hours</button>}
            </div>
          )}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs divide-y divide-slate-100 overflow-hidden">
            {days.map((date) => {
              const day = dayOf(selectedEmployee.id, date);
              const away = awayOn(selectedEmployee.id, date);
              return (
                <div key={date} aria-current={date === today ? 'date' : undefined} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 ${date === today ? 'bg-indigo-50/60' : ''}`}>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{weekdayName(date)}{date === today && <TodayMark className="ml-2 inline-block align-middle" />}</p>
                    <p className="text-xs text-slate-400 mt-0.5 tabular-nums">{formatDate(date, { weekday: 'none' })}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between sm:justify-end gap-x-4 gap-y-2">
                    <span className="text-xs"><DayHours day={day} away={away} align="row" /></span>
                    <div className="flex flex-wrap items-center gap-2">
                      {day.kind !== 'regular' && <button type="button" onClick={() => backToRegular(selectedEmployee.id, date)} aria-label={`Back to regular hours for ${selectedEmployee.name} on ${formatDate(date, { weekday: 'long' })}`} className="min-h-11 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl">Back to regular hours</button>}
                      <button type="button" onClick={() => openEditor(selectedEmployee.id, date)} aria-label={changeLabel(selectedEmployee, date)} className="min-h-11 px-3 py-1.5 text-xs font-semibold text-[#5551FF] bg-[#5551FF]/8 hover:bg-[#5551FF]/15 rounded-xl">Change</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {hasRegularHours(selectedEmployee) && onEditRegularHours && (
            <p className="text-xs text-slate-500">
              To change every week at once, <button type="button" onClick={() => onEditRegularHours(selectedEmployee.id)} className="inline-flex min-h-11 items-center font-semibold text-[#5551FF] underline underline-offset-2 hover:text-[#433fd8] focus-visible:outline-2 focus-visible:outline-[#5551FF]">change the regular hours of {selectedEmployee.name}</button>.
            </p>
          )}
        </div>
      ) : (
        <div className="min-w-0">
          {/* Phones and tablets: one card per person with the days as rows, so nothing scrolls sideways. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:hidden">
            {team.map((employee) => (
              <section key={employee.id} aria-label={`${employee.name}, ${formatDateRange(weekStart, days[6])}`} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2">
                  <span style={staffAvatarStyle(staffColorFor(employees, employee.id))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold">{employee.initials}</span>
                  <button type="button" onClick={() => setSelectedEmployeeId(employee.id)} aria-label={`View the week of ${employee.name}`} className="min-h-11 min-w-0 flex-1 text-left text-sm font-semibold text-slate-900 [overflow-wrap:anywhere] hover:text-[#5551FF] focus-visible:outline-2 focus-visible:outline-[#5551FF]">{employee.name}</button>
                  <span className="shrink-0 text-right text-xs text-slate-500"><strong className="block text-sm text-slate-900 tabular-nums">{weekTotal(employee.id)}</strong>{thisWeek ? 'this week' : 'that week'}</span>
                </div>
                {!hasRegularHours(employee) && <p className="border-b border-slate-100 bg-amber-50 px-4 py-2 text-xs leading-relaxed text-amber-950">No regular working hours: only days entered here count.</p>}
                <ul className="divide-y divide-slate-100">
                  {days.map((date) => {
                    const day = dayOf(employee.id, date);
                    const away = awayOn(employee.id, date);
                    return (
                      <li key={date} aria-current={date === today ? 'date' : undefined} className={date === today ? 'bg-indigo-50/60' : ''}>
                        <button type="button" onClick={() => openEditor(employee.id, date)} aria-label={changeLabel(employee, date)}
                          className={`flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-xs hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5551FF] ${day.kind !== 'regular' && !away ? 'bg-amber-50/80 hover:bg-amber-50' : ''}`}>
                          <span className="w-[4.75rem] shrink-0 font-semibold text-slate-600 tabular-nums">
                            {formatCalendarDate(date)}
                            {date === today && <TodayMark className="mt-0.5 block w-fit" />}
                          </span>
                          <span className="min-w-0 flex-1"><DayHours day={day} away={away} align="start" /></span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          {/* Wide screens: the whole team in one table, a column per day. */}
          <div className="hidden xl:block">
            {tableScrolls && <p className="mb-2 text-xs text-slate-500">Scroll sideways to see all days, or select an employee for their week.</p>}
            <div ref={tableRef} className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs text-left">
                <thead className="text-slate-400 bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th scope="col" className="sticky left-0 z-10 w-56 min-w-56 max-w-56 bg-slate-50 py-3.5 px-3 font-semibold border-r border-slate-100">Employee</th>
                    {days.map((date) => (
                      <th scope="col" key={date} aria-current={date === today ? 'date' : undefined} className={`py-2.5 px-2 text-center align-middle font-semibold whitespace-nowrap ${date === today ? 'bg-indigo-50 text-[#5551FF]' : ''}`}>
                        <span className="block">{formatCalendarDate(date)}</span>
                        {date === today && <TodayMark className="mt-0.5 inline-block" />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {team.map((employee) => (
                    <tr key={employee.id} className="group hover:bg-slate-50/60">
                      <th scope="row" className="sticky left-0 z-10 w-56 min-w-56 max-w-56 bg-white group-hover:bg-slate-50 py-3 px-3 border-r border-slate-100 font-normal">
                        <button onClick={() => setSelectedEmployeeId(employee.id)} className="flex min-h-11 w-full min-w-0 items-center gap-2.5 text-left text-slate-800 hover:text-[#5551FF]" aria-label={`View the week of ${employee.name}`} title={employee.name}>
                          <span style={staffAvatarStyle(staffColorFor(employees, employee.id))} className="w-8 h-8 rounded-xl flex items-center justify-center font-bold shrink-0">{employee.initials}</span>
                          <span className="min-w-0 font-semibold line-clamp-2 [overflow-wrap:anywhere]">{employee.name}</span>
                        </button>
                        <p className="pl-[2.625rem] text-slate-500"><strong className="font-semibold text-slate-700 tabular-nums">{weekTotal(employee.id)}</strong> {thisWeek ? 'this week' : 'that week'}</p>
                        {!hasRegularHours(employee) && <p className="mt-1 pl-[2.625rem] leading-snug text-amber-800">No regular working hours</p>}
                      </th>
                      {days.map((date) => {
                        const day = dayOf(employee.id, date);
                        const away = awayOn(employee.id, date);
                        const look = away ? 'bg-sky-50 border-sky-200 hover:bg-sky-100'
                          : day.kind !== 'regular' ? 'bg-amber-50 border-amber-300 hover:bg-amber-100'
                            : day.hours ? 'bg-white border-slate-200 hover:border-[#5551FF]/50 hover:bg-indigo-50/50'
                              : 'bg-slate-50 border-transparent hover:bg-indigo-50';
                        return (
                          <td key={date} className={`py-3 px-1 text-center align-middle ${date === today ? 'bg-indigo-50/60' : ''}`}>
                            <button onClick={() => openEditor(employee.id, date)} aria-label={changeLabel(employee, date)} className={`flex min-h-11 w-full items-center justify-center whitespace-nowrap px-2 py-1.5 rounded-lg text-[11px] border transition-colors ${look}`}>
                              <DayHours day={day} away={away} />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {notShown > 0 && <p className="mt-3 text-xs text-slate-500">{notShown === 1 ? 'One inactive person is' : `${notShown} inactive people are`} not shown here. They are listed in People.</p>}
        </div>
      )}

      {showEditor && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end" onClick={(event) => { if (event.target === event.currentTarget) dismissEditor(); }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="shift-editor-title" className="w-full max-w-md bg-white h-full shadow-2xl p-4 sm:p-6 overflow-y-auto overscroll-contain">
            <form onSubmit={saveDay} className="flex flex-col min-h-full gap-5 text-xs">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <h2 id="shift-editor-title" className="text-base font-bold text-slate-900">Change a day</h2>
                <button type="button" aria-label="Close" onClick={closeEditor} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
              </div>
              <div>
                <label htmlFor="shift-employee" className="font-semibold text-slate-700 block mb-1.5">Employee</label>
                <select ref={employeeSelectRef} id="shift-employee" required value={editorEmployeeId} onChange={(event) => loadDay(event.target.value, editorDate)} className={fieldStyle}>
                  {team.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="shift-date" className="font-semibold text-slate-700 block mb-1.5">Date</label>
                <input id="shift-date" type="date" required value={editorDate} onChange={(event) => loadDay(editorEmployeeId, event.target.value)} className={fieldStyle} />
              </div>
              {/* What the day would be without a change, so the owner sees what she is changing. */}
              {editorEmployee && editorDate && (
                <p className="rounded-xl bg-slate-50 px-3 py-2.5 leading-relaxed text-slate-600">
                  {editorDay.regular
                    ? <>Regular hours on {weekdayName(editorDate)}s: <strong className="font-semibold text-slate-800 tabular-nums">{range(editorDay.regular)}</strong>.</>
                    : <>{weekdayName(editorDate)} is a regular day off for {editorEmployee.name}.</>}
                  {editorDay.kind !== 'regular' && <> This day is changed: <strong className="font-semibold text-amber-900 tabular-nums">{editorDay.hours ? range(editorDay.hours) : 'off'}</strong>.</>}
                </p>
              )}
              <label className="flex min-h-11 items-center gap-3 px-3 py-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input type="checkbox" checked={works} onChange={(event) => { setWorks(event.target.checked); setError(''); }} className="h-5 w-5 rounded accent-[#5551FF]" />
                <span className="font-semibold text-slate-700">Works on this day</span>
              </label>
              {works ? (
                // Lists of 24-hour times, as in the opening hours: the browser's time field would
                // follow the device's language and show "06:00 PM" on an English one.
                <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-4">
                  <div><label htmlFor="shift-start" className="font-semibold text-slate-700 block mb-1.5">From</label>
                    <select id="shift-start" value={start} onChange={(event) => { setStart(event.target.value); setError(''); }} className={`${fieldStyle} tabular-nums`}>
                      {timeChoices(start).map((time) => <option key={time} value={time}>{time}</option>)}
                    </select></div>
                  <div><label htmlFor="shift-end" className="font-semibold text-slate-700 block mb-1.5">To</label>
                    <select id="shift-end" value={end} onChange={(event) => { setEnd(event.target.value); setError(''); }} className={`${fieldStyle} tabular-nums`}>
                      {timeChoices(end).map((time) => <option key={time} value={time}>{time}</option>)}
                    </select></div>
                </div>
              ) : <p className="text-slate-500 leading-relaxed">Off on this day: no times are offered for this employee, online or in the calendar.</p>}
              {editorAway && <p className="rounded-xl bg-sky-50 p-3 leading-relaxed text-sky-900">{editorEmployee?.name} is entered as away on this day (Absences). Nobody can book them then, whatever the hours.</p>}
              {leftOutside > 0 && (
                <p role="status" className="rounded-xl bg-amber-50 p-3 leading-relaxed text-amber-900">
                  {works
                    ? `${leftOutside === 1 ? '1 appointment' : `${leftOutside} appointments`} with ${editorEmployee?.name} on this day ${leftOutside === 1 ? 'lies' : 'lie'} outside these hours.`
                    : `${leftOutside === 1 ? '1 appointment is' : `${leftOutside} appointments are`} booked with ${editorEmployee?.name} on this day.`}
                  {' '}{leftOutside === 1 ? 'It stays' : 'They stay'} in the calendar: move or cancel {leftOutside === 1 ? 'it' : 'them'} yourself.
                </p>
              )}
              {waitingOutside > 0 && (
                <p role="status" className="rounded-xl bg-amber-50 p-3 leading-relaxed text-amber-900">
                  {waitingOutside === 1 ? '1 waiting request' : `${waitingOutside} waiting requests`} for {editorEmployee?.name} on this day could no longer be confirmed at {waitingOutside === 1 ? 'its' : 'their'} time. Answer {waitingOutside === 1 ? 'it' : 'them'} on Home first, or suggest another time there.
                </p>
              )}
              {shownError && <p role="alert" className="text-rose-600">{shownError}</p>}
              <div className="sticky -bottom-4 -mx-4 mt-auto space-y-2 border-t border-slate-100 bg-white px-4 pt-3 pb-4 sm:-bottom-6 sm:-mx-6 sm:px-6 sm:pb-6">
                {editorDay.kind !== 'regular' && (
                  <button type="button" onClick={() => backToRegular(editorEmployeeId, editorDate)} className="min-h-11 w-full py-2.5 font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl">Back to regular hours</button>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={closeEditor} className="min-h-11 flex-1 py-2.5 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl">Cancel</button>
                  <button type="submit" disabled={saving} className="min-h-11 flex-1 py-2.5 font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
