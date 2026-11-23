import React, { useEffect, useRef, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { AppointmentRequest, BookingHoursDay, CalendarEvent, Employee, ServiceItem, ShiftEntry, StaffAbsence, TeamSubTab } from '../types';
import { TEAM_TABS } from '../navigation';
import { formatDateRange } from '../format';
import { dateRangeFieldClass, useDateRangeForm } from '../dateRangeForm';
import { SectionTabs, sectionPanel } from '../components/SectionTabs';
import type { FormSection } from '../teamBooking';
import type { DayChange } from '../workingHours';
import { EmployeesView } from './EmployeesView';
import { ShiftPlanView } from './ShiftPlanView';
import { notSavedText, pendingFormSave, useServerValue, whenSaved } from '../useDemoState';
import { useFormSave } from '../formSave';
import { TEXT_LIMITS } from '../fieldLimits';

interface TeamViewProps {
  /** The tab that is open. The app keeps it in the address, so a link can lead to one tab. */
  tab?: TeamSubTab;
  onTabChange?: (tab: TeamSubTab) => void;
  employees: Employee[];
  /** Adds the person with the services ticked in their form. Gives back the new person's id where the app has one. */
  onAddEmployee: (employee: Omit<Employee, 'id' | 'initials' | 'name'>, serviceIds: string[], id?: string) => string | void;
  onUpdateEmployee: (id: string, employee: Partial<Employee>, serviceIds?: string[]) => void;
  /** Deletes the person, or returns why that is not possible. */
  onDeleteEmployee: (id: string) => string | null | void;
  /** Why a person cannot be deleted right now, or null. */
  deletionBlocker?: (employee: Employee) => string | null;
  companyName?: string;
  /** The salon's services and opening hours: a person's form ticks services and starts with the opening hours. */
  services?: ServiceItem[];
  bookingHours?: BookingHoursDay[];
  /** The calendar: a changed day says which appointments it leaves outside the working hours. */
  events?: CalendarEvent[];
  /** The waiting requests: changed hours also say which of them could no longer be accepted. */
  requests?: AppointmentRequest[];
  /** Leads to Services, from a person's form in a salon that has no service yet. */
  onOpenServices?: () => void;
  /** The single days that differ from people's regular hours. */
  shiftOverview: ShiftEntry[];
  /** Stores changes to single days. `note` says what happened when several days change at once. */
  onUpdateShift: (changes: DayChange[], note?: string) => void;
  absences: StaffAbsence[];
  onSaveAbsences: (items: StaffAbsence[]) => void;
  timeZone?: string;
  /** The moment "today" is taken from. Tests pass a fixed one; the app leaves it out and gets the current time. */
  now?: Date;
  /** While the form of a person holds unsaved changes: the question to ask before another screen is opened. */
  onUnsavedChange?: (question: string | null) => void;
}

/**
 * Team: the one place that decides who works when. "People" is the list of the salon's people,
 * each with their regular working hours and services; "This week" shows the hours of every day
 * and changes single days; "Absences" holds the days somebody is away.
 */
export const TeamView: React.FC<TeamViewProps> = ({
  tab, onTabChange, employees, onAddEmployee, onUpdateEmployee, onDeleteEmployee, deletionBlocker, companyName,
  services, bookingHours, events, requests, onOpenServices,
  shiftOverview, onUpdateShift, absences, onSaveAbsences, timeZone, now, onUnsavedChange,
}) => {
  // Without an owner of the tab (a test, a page that does not keep it in the address) the page keeps it itself.
  const [ownTab, setOwnTab] = useState<TeamSubTab>(tab ?? 'people');
  const activeTab = onTabChange ? tab ?? 'people' : ownTab;
  const showTab = (next: TeamSubTab) => { setOwnTab(next); onTabChange?.(next); };
  // The form for one person takes the whole page: title and tabs step aside until it is closed.
  const [editingPerson, setEditingPerson] = useState(false);
  const formOpen = editingPerson && activeTab === 'people';
  // "This week" leads to a person's regular hours: People opens with that person's form at that part.
  const [personToOpen, setPersonToOpen] = useState<{ id: string; section: FormSection } | null>(null);
  const editRegularHours = (id: string) => { setPersonToOpen({ id, section: 'hours' }); showTab('people'); };

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {!formOpen && (
        <>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Team</h1>
          <SectionTabs label="Team" tabs={TEAM_TABS} active={activeTab} onChange={showTab} idPrefix="team" />
        </>
      )}
      <div {...(formOpen ? {} : sectionPanel('team', activeTab))}>
        {activeTab === 'people' && (
          <EmployeesView employees={employees} onAddEmployee={onAddEmployee} onUpdateEmployee={onUpdateEmployee}
            onDeleteEmployee={onDeleteEmployee} deletionBlocker={deletionBlocker} companyName={companyName}
            services={services} bookingHours={bookingHours} shiftOverview={shiftOverview} events={events} requests={requests} timeZone={timeZone} now={now} onOpenServices={onOpenServices}
            open={personToOpen} onOpened={() => setPersonToOpen(null)}
            onEditingChange={setEditingPerson} onUnsavedChange={onUnsavedChange} />
        )}
        {activeTab === 'week' && (
          <ShiftPlanView employees={employees} shiftOverview={shiftOverview} onUpdateShift={onUpdateShift} timeZone={timeZone} now={now}
            events={events} requests={requests} absences={absences} onEditRegularHours={editRegularHours} />
        )}
        {activeTab === 'absences' && (
          <AbsencesPanel employees={employees} absences={absences} onSaveAbsences={onSaveAbsences} timeZone={timeZone} now={now} />
        )}
      </div>
    </div>
  );
};

interface AbsencesPanelProps {
  employees: Employee[];
  absences: StaffAbsence[];
  onSaveAbsences: (items: StaffAbsence[]) => void;
  timeZone?: string;
  now?: Date;
}

/**
 * The tab "Absences": days on which one person is away. Customers cannot book that person then;
 * the salon stays open. (Days on which the whole salon is closed are in Settings › Closed dates.)
 */
const AbsencesPanel: React.FC<AbsencesPanelProps> = ({ employees, absences, onSaveAbsences, timeZone, now }) => {
  const form = useDateRangeForm(timeZone, now, 'absence-employee');
  const [employeeId, setEmployeeId] = useState('');
  // The form's save waits for the server: only this filling of the form is concerned by its answer
  // (src/formSave.ts). Editing another absence, Cancel and a cleared form start a new one.
  const absenceSave = useFormSave();
  const saving = absenceSave.saving;
  // A new absence keeps one id for every try of this filling of the form, so a save that is sent
  // again takes the place of the first try and never adds a second absence.
  const newAbsenceId = useRef<string | null>(null);
  const [sent, setSent] = useState<StaffAbsence | null>(null);
  const reset = () => { form.reset(); setEmployeeId(''); absenceSave.newOpening(); newAbsenceId.current = null; setSent(null); };
  /** The server has the absence of the form: the form is cleared for the next one and says so. */
  const taken = () => { reset(); form.setFeedback('Absence saved. Online booking availability is updated.'); };
  const storedAbsences = useServerValue('absences', absences);
  // Why the last save was not taken, said only while the form holds what the server does not have.
  const held = sent !== null && storedAbsences.some((item) => item.id === sent.id && item.employeeId === employeeId && item.start === form.start && item.end === form.end && (item.reason ?? '') === form.text.trim());
  const shownError = form.error || (absenceSave.notSaved && !held ? absenceSave.notSaved : '');
  // Reported as not taken, but the server has it after all (the answer got lost on the way): the form is done.
  const arrived = held && Boolean(absenceSave.notSaved);
  useEffect(() => {
    if (arrived) taken();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const rangeError = form.rangeError();
    if (rangeError) { form.setError(rangeError); return; }
    if (!employees.some((employee) => employee.id === employeeId)) { form.setError('Choose the employee who will be absent.'); return; }
    if (form.text.trim().length > TEXT_LIMITS.absenceReason) { form.setError(`The reason can be at most ${TEXT_LIMITS.absenceReason} characters.`); return; }
    const id = form.editingId || (newAbsenceId.current ??= `absence-${crypto.randomUUID()}`);
    if (absences.some((item) => item.id !== id && item.employeeId === employeeId && item.start === form.start && item.end === form.end)) { form.setError('This employee already has an absence for these dates.'); return; }
    const entry: StaffAbsence = { id, employeeId, start: form.start, end: form.end, reason: form.text.trim() };
    if (saving) return;
    onSaveAbsences([...absences.filter((item) => item.id !== id), entry].sort((a, b) => a.start.localeCompare(b.start)));
    setSent(entry);
    const done = taken;
    // On a signed-in device the form keeps what was typed until the server has it; not taken, it
    // stays as typed and says why. Elsewhere it clears at once.
    absenceSave.afterSave(pendingFormSave(), done, notSavedText);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs space-y-6">
      <div className="border-b border-slate-100 pb-3">
        <h2 className="text-base font-bold text-slate-900">Absences</h2>
      </div>
      <p className="text-xs text-slate-500">Block booking for one employee while they are away. Both the first and last day are included. Changes save immediately; existing appointments are kept.</p>
      <div className="space-y-2">
        {absences.map((item) => {
          const employeeName = employees.find((employee) => employee.id === item.employeeId)?.name || 'Removed employee';
          return <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <div className="flex-1 min-w-0"><p className="font-semibold text-slate-800">{employeeName}{item.reason && `: ${item.reason}`}</p><p className="text-slate-500 mt-1 tabular-nums">{formatDateRange(item.start, item.end)}</p></div>
            <button className="min-h-11 min-w-11 font-semibold text-[#5551FF]" aria-label={`Edit absence for ${employeeName}`} onClick={() => { setEmployeeId(item.employeeId); form.edit(item, item.reason || ''); absenceSave.newOpening(); }}>Edit</button>
            <button className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]" aria-label={`Delete absence for ${employeeName}`} onClick={() => { onSaveAbsences(absences.filter((absence) => absence.id !== item.id)); if (form.editingId === item.id) reset(); whenSaved(() => form.setFeedback('Absence removed. Booking availability is updated.')); }}><Trash2 className="w-4 h-4" /></button>
          </div>;
        })}
        {absences.length === 0 && <p className="py-4 text-sm text-slate-500">No staff absences added.</p>}
      </div>
      {form.feedback && <p role="status" className="rounded-xl bg-emerald-50 text-emerald-800 p-3 text-xs">{form.feedback}</p>}
      <form onSubmit={save} className="border-t border-slate-100 pt-5 space-y-4 text-xs">
        <h3 className="font-semibold text-slate-800">{form.editingId ? 'Edit' : 'Add'} staff absence</h3>
        <div><label htmlFor="absence-employee" className="block mb-1 font-semibold text-slate-700">Employee</label><select id="absence-employee" required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className={dateRangeFieldClass}><option value="">Choose employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></div>
        <div><label htmlFor="absence-reason" className="block mb-1 font-semibold text-slate-700">Reason (optional)</label><input id="absence-reason" maxLength={200} value={form.text} onChange={(event) => form.setText(event.target.value)} placeholder="For example, annual leave" className={dateRangeFieldClass} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label htmlFor="absence-start" className="block mb-1 font-semibold text-slate-700">First day</label><input id="absence-start" type="date" required value={form.start} onChange={(event) => form.changeStart(event.target.value)} className={dateRangeFieldClass} /></div>
          <div><label htmlFor="absence-end" className="block mb-1 font-semibold text-slate-700">Last day</label><input id="absence-end" type="date" required min={form.start} value={form.end} onChange={(event) => form.setEnd(event.target.value)} className={dateRangeFieldClass} /></div>
        </div>
        {shownError && <p role="alert" className="rounded-xl p-3 bg-rose-50 text-rose-700">{shownError}</p>}
        <div className="flex gap-3"><button type="submit" disabled={employees.length === 0 || saving} className="inline-flex min-h-11 items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5551FF] text-white font-semibold disabled:opacity-50">{form.editingId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}{saving ? 'Saving…' : 'Save absence'}</button>{form.editingId && <button type="button" onClick={reset} className="min-h-11 px-4 py-2 rounded-xl text-slate-600 bg-slate-100 font-semibold">Cancel</button>}</div>
      </form>
    </div>
  );
};
