import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useHorizontalOverflow } from '../useHorizontalOverflow';
import {
  Plus,
  ArrowLeft,
  ChevronRight,
  CheckCircle2,
  X,
} from 'lucide-react';
import { AppointmentRequest, BookingHoursDay, CalendarEvent, Employee, ServiceItem, ShiftEntry } from '../types';
import { formatDate, formatMoney, formatPhone, formatTimeRange, normalizePhone, weekdayName } from '../format';
import { requestTimes } from '../appointmentActions';
import { getSalonNow } from '../scheduling';
import { useCloseOnBack } from '../backGesture';
import { staffAvatarStyle, staffColorFor } from '../staffColors';
import { notSavedText, pendingFormSave, refreshSharedSalon, useServerValue } from '../useDemoState';
import { BY_POSITION, useStoredForm } from '../formFollow';
import { useFormSave } from '../formSave';
import { personFormFor, personFromForm, weekFromRows, type DayRow, type PersonForm } from '../personForm';
import { BOOKING_GAP_REASON, bookingGaps, setupSteps, type BookingGap, type FormSection, type SetupStep } from '../teamBooking';
import { bookingsLeftOutside, dateOfWeekday, timeChoices, WEEKDAY_KEYS, weeklyHoursFromOpeningHours } from '../workingHours';

interface EmployeesViewProps {
  employees: Employee[];
  /** Adds the person with the services ticked in their form. Gives back the new person's id where the app has one. */
  /** `id`: the id the form chose for this new person, the same for every try of one opening of the form. */
  onAddEmployee: (emp: Omit<Employee, 'id' | 'initials' | 'name'>, serviceIds: string[], id?: string) => string | void;
  onUpdateEmployee: (id: string, employee: Partial<Employee>, serviceIds?: string[]) => void;
  /** Deletes the person, or returns why that is not possible. */
  onDeleteEmployee: (id: string) => string | null | void;
  /** Why a person cannot be deleted right now (appointments or requests still use them), or null. */
  deletionBlocker?: (employee: Employee) => string | null;
  companyName?: string;
  /**
   * The salon's services and opening hours. A person's form ticks the services they offer and a
   * new person starts with the opening hours as working hours. With both, the list also says who
   * can be booked online and what is missing for those who cannot.
   */
  services?: ServiceItem[];
  bookingHours?: BookingHoursDay[];
  /** The single days entered in "This week": somebody without a regular week may still work on those. */
  shiftOverview?: ShiftEntry[];
  /** The calendar and the waiting requests: a changed regular week says which bookings it leaves outside the hours. */
  events?: CalendarEvent[];
  requests?: AppointmentRequest[];
  timeZone?: string;
  /** The moment "today" is taken from. Tests pass a fixed one; the app leaves it out and gets the current time. */
  now?: Date;
  /** Leads to Services. The way there is offered only where it leads somewhere. */
  onOpenServices?: () => void;
  /** A person whose form opens at once, at one part of it ("Set regular hours" in This week). */
  open?: { id: string; section: FormSection } | null;
  /** Called when that form has opened, so it does not open a second time. */
  onOpened?: () => void;
  /** Tells the page around the list that the form for one person is open: it fills the page then. */
  onEditingChange?: (editing: boolean) => void;
  /**
   * While the form holds changes that are not saved: the question to ask before the owner is
   * taken to another screen. Null when there is nothing to lose.
   */
  onUnsavedChange?: (question: string | null) => void;
}

/** Whether two fillings of the person form say the same once saved: a number typed with or without spaces is one number. */
const samePerson = (a: PersonForm, b: PersonForm): boolean => {
  const saved = (form: PersonForm) => JSON.stringify({
    ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(),
    phone: form.phone.trim() ? normalizePhone(form.phone) : '',
  });
  return saved(a) === saved(b);
};
const NO_SERVICES: ServiceItem[] = [];
const NO_HOURS: BookingHoursDay[] = [];
const fieldClass = 'min-h-11 w-full px-3.5 py-2.5 bg-slate-50 border-b border-slate-300 focus:border-[#5551FF] focus:bg-white focus:outline-hidden text-base sm:text-sm transition-all rounded-t-lg';
const timeFieldClass = 'block min-h-11 w-full min-w-[7.75rem] px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-base sm:text-sm text-slate-900 tabular-nums';
const switchTrack = "relative w-11 h-6 shrink-0 bg-slate-200 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-[#5551FF] peer-focus-visible:ring-offset-2 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#5551FF]";
/** The smaller switch of a row in the working hours, as in Settings › Opening hours. */
const smallSwitchTrack = "relative w-9 h-5 shrink-0 bg-slate-200 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-[#5551FF] peer-focus-visible:ring-offset-2 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5551FF]";
const badge = 'inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold';

/**
 * The tab "People" of Team: the list of the salon's people and the form for one of them.
 * The form holds everything that decides whether somebody can be booked: their regular working
 * hours, the services they offer, whether customers can book them online, and their status.
 * Deleting a person is part of that form, not of the list: it asks first, and it says why
 * when it is not possible.
 */
export const EmployeesView: React.FC<EmployeesViewProps> = ({
  employees,
  onAddEmployee,
  onUpdateEmployee,
  onDeleteEmployee,
  deletionBlocker,
  companyName = '',
  services,
  bookingHours,
  shiftOverview = [],
  events = [],
  requests = [],
  timeZone,
  now,
  onOpenServices,
  open,
  onOpened,
  onEditingChange,
  onUnsavedChange,
}) => {
  const [isAddingMode, setIsAddingMode] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [formError, setFormError] = useState('');
  // The form's save is on its way to the server (signed-in device): this opening of the form waits
  // for its answer; another opening (another person, the same one again, the next new one) is not
  // touched by it (src/formSave.ts).
  const { saving, notSaved, newOpening, afterSave } = useFormSave();
  /** Back to the list: the form's opening ends, and an answer still on its way no longer concerns it. */
  const leaveEditor = () => { setIsAddingMode(false); newOpening(); };
  // Before the screen is drawn, so that the page's own title and tabs never show next to the form.
  useLayoutEffect(() => {
    onEditingChange?.(isAddingMode);
    return () => onEditingChange?.(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAddingMode]);

  const salon = { services: services ?? [], bookingHours: bookingHours ?? [], shiftOverview };
  // Without the salon's services and opening hours the list cannot know who is bookable, and says nothing about it.
  const knowsSalon = services !== undefined && bookingHours !== undefined;
  const today = getSalonNow(timeZone, now).date;
  const tableRef = useRef<HTMLDivElement>(null);
  const tableScrolls = useHorizontalOverflow(tableRef, [isAddingMode]);
  // The open form compares with what the server has of the person and follows it (src/formFollow.ts):
  // a field the owner has not changed shows a change made on another device, one she changed keeps
  // what she typed. A new person starts from fixed values and follows nothing.
  const storedEmployees = useServerValue('employees', employees);
  const storedServices = useServerValue('services', services ?? NO_SERVICES);
  const storedHours = useServerValue('bookingHours', bookingHours ?? NO_HOURS);
  const storedPerson = editingEmployee ? storedEmployees.find((item) => item.id === editingEmployee.id) : undefined;
  const [newFrom, setNewFrom] = useState<PersonForm>(() => personFormFor(null, salon));
  // The week is followed day by day (its seven rows never move); the services as ticks.
  const { form, setForm, startedFrom, restart } = useStoredForm<PersonForm>(storedPerson ? personFormFor(storedPerson, { services: storedServices, bookingHours: storedHours }) : newFrom, { lists: { days: BY_POSITION } });
  // The person whose form is open was deleted on another device: the form closes and says so.
  const [removedNote, setRemovedNote] = useState('');
  const openGone = Boolean(isAddingMode && editingEmployee && !storedPerson && !employees.some((item) => item.id === editingEmployee.id));
  useEffect(() => {
    if (!openGone || !editingEmployee) return;
    setRemovedNote(`${editingEmployee.name} was removed on another device.`);
    leaveEditor();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGone]);
  // A changed regular week may leave bookings of this person outside their hours. The form says
  // so before saving, as the editor of a single day does; the bookings themselves are not touched.
  const hoursWarning = (() => {
    if (!editingEmployee) return null;
    const theirs = (record: { employeeId?: string; staffName?: string }) =>
      record.employeeId !== undefined ? record.employeeId === editingEmployee.id : record.staffName === editingEmployee.name;
    const week = weekFromRows(form.days);
    const source = { employees, shiftOverview };
    const appointments = bookingsLeftOutside(source, editingEmployee.id, week, events.filter(theirs), today);
    const waiting = bookingsLeftOutside(source, editingEmployee.id, week, requests.filter((request) => request.status === 'pending' && theirs(request))
      .flatMap((request) => { const times = requestTimes(request); return times ? [{ date: request.date, startTime: times.start, endTime: times.end }] : []; }), today);
    if (appointments.length === 0 && waiting.length === 0) return null;
    const parts: string[] = [];
    if (appointments.length > 0) {
      const [next] = appointments;
      parts.push(`${appointments.length === 1 ? '1 upcoming appointment' : `${appointments.length} upcoming appointments`} with ${editingEmployee.name} would lie outside these hours, the next on ${formatDate(next.date)}, ${formatTimeRange(next.startTime, next.endTime)}. ${appointments.length === 1 ? 'It stays' : 'They stay'} in the calendar: move or cancel ${appointments.length === 1 ? 'it' : 'them'} yourself.`);
    }
    if (waiting.length > 0) {
      parts.push(`${waiting.length === 1 ? '1 waiting request' : `${waiting.length} waiting requests`} could no longer be confirmed at ${waiting.length === 1 ? 'its' : 'their'} time.`);
    }
    return parts.join(' ');
  })();
  // The part of the form to bring into view when it opens (from the list of what is missing).
  const [openSection, setOpenSection] = useState<FormSection | null>(null);
  // The person who was just added: the list says what is still missing before customers can book them.
  const [addedId, setAddedId] = useState<string | null>(null);
  const added = addedId ? employees.find((employee) => employee.id === addedId) : undefined;

  // What the server has (or the form opened with, for a new person): anything else in it is a change that would be lost.
  const formChanged = isAddingMode && JSON.stringify(form) !== JSON.stringify(startedFrom);
  // Why the last save was not taken, said only while the form still holds something the server does
  // not have: once the server has exactly this (its answer got lost), the sentence goes.
  const shownError = formError || (notSaved && isAddingMode && !samePerson(form, startedFrom) ? notSaved : '');
  const discardQuestion = editingEmployee
    ? `Discard your changes to ${editingEmployee.name}? They are not saved yet.`
    : 'Discard this new employee? It is not saved yet.';

  // What opened the form: a person's name in the list, or "New employee". Focus goes back there when the form closes.
  const openedFrom = useRef('new');
  // The id a new person gets: one per opening of the form. A save that is tried again (its answer
  // got lost, or the server could not be reached) is then the same person and never a second one.
  const [newPersonId, setNewPersonId] = useState('');
  const openEditor = (employee: Employee | null = null, section: FormSection | null = null) => {
    openedFrom.current = employee?.id ?? 'new';
    if (!employee) setNewPersonId(`emp-${Date.now()}`);
    refreshSharedSalon();
    const stored = employee ? storedEmployees.find((item) => item.id === employee.id) ?? employee : null;
    const shown = stored ? personFormFor(stored, { services: storedServices, bookingHours: storedHours }) : personFormFor(null, salon);
    setEditingEmployee(stored);
    if (!stored) setNewFrom(shown);
    restart(shown);
    setRemovedNote('');
    setOpenSection(section);
    setFormError(''); setIsAddingMode(true);
    newOpening();
  };
  /** Back to the list. A form with changes asks first: a tap on the arrow or the Back gesture is quickly done. */
  const closeEditor = () => {
    if (formChanged && !window.confirm(discardQuestion)) return;
    leaveEditor();
  };
  // The form is a page inside Team: the phone's Back gesture leads back to the list, not out of Team.
  const editorRef = useRef<HTMLDivElement>(null);
  useCloseOnBack(editorRef, isAddingMode, closeEditor);
  // Leaving for another screen through the menu or the tab bar asks the same question.
  useEffect(() => {
    onUnsavedChange?.(formChanged ? discardQuestion : null);
    return () => onUnsavedChange?.(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formChanged, discardQuestion]);
  // The list and the form are two pages of different length: each opens at its top, so that what
  // the list says after a save (what is still missing) is in view. Opened at one part, the form
  // shows that part instead, and its heading takes the focus: a screen reader says where the owner has landed.
  const firstDraw = useRef(true);
  useEffect(() => {
    if (firstDraw.current) { firstDraw.current = false; return; }
    const heading = isAddingMode && openSection ? document.getElementById(`employee-${openSection}-title`) : null;
    if (heading) {
      heading.scrollIntoView({ block: 'start' });
      heading.focus({ preventScroll: true });
      return;
    }
    window.scrollTo({ top: 0 });
    if (isAddingMode) return;
    // Back in the list: the control that opened the form gets the focus back (the one of the layout that is shown).
    Array.from(document.querySelectorAll<HTMLElement>(`[data-opens-form="${openedFrom.current}"]`))
      .find((control) => control.offsetParent !== null)?.focus({ preventScroll: true });
  }, [isAddingMode, openSection]);
  // Another tab of Team asks for one person's form ("Set regular hours" in This week).
  useEffect(() => {
    if (!open) return;
    const employee = employees.find((item) => item.id === open.id);
    if (employee) openEditor(employee, open.section);
    onOpened?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const person = personFromForm(form, { services: salon.services, companyName });
    if ('error' in person) { setFormError(person.error); return; }
    if (saving) return;
    let addedNow: string | null = null;
    if (editingEmployee) onUpdateEmployee(editingEmployee.id, person.details, person.serviceIds);
    else {
      const id = onAddEmployee(person.details, person.serviceIds, newPersonId || undefined);
      addedNow = typeof id === 'string' ? id : null;
    }
    const addAnother = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'another';
    const formElement = event.currentTarget;
    const pending = pendingFormSave();
    // On a signed-in device the form stays as typed until the server has it; not taken, it stays
    // open and says why, so nothing typed is lost. Taken, it goes back to the list or, for "Save
    // and add another", starts the next person. Elsewhere that happens at once.
    afterSave(pending, () => {
      if (!editingEmployee) setAddedId(addedNow);
      if (addAnother) {
        openEditor();
        formElement.querySelector<HTMLInputElement>('#employee-first-name')?.focus();
      } else {
        leaveEditor();
      }
    }, notSavedText);
  };

  // The new person turns out to be on the server although the save was reported as not taken (its
  // answer got lost on the way). The form has done its work and goes back to the list, which shows
  // them. If the owner has typed more into the form since, nothing of that is dropped: the form
  // goes on as that person's form, with what she typed, still to save.
  const arrived = isAddingMode && !editingEmployee && Boolean(newPersonId) && !saving ? storedEmployees.find((item) => item.id === newPersonId) : undefined;
  useEffect(() => {
    if (!arrived) return;
    if (samePerson(form, personFormFor(arrived, { services: storedServices, bookingHours: storedHours }))) {
      setAddedId(arrived.id);
      leaveEditor();
      return;
    }
    setEditingEmployee(arrived);
    setFormError('');
    newOpening();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived?.id]);

  /** What the list says about one person and the booking page: bookable, or what is in the way. */
  const gapsOf = (employee: Employee): BookingGap[] => bookingGaps(salon, employee, today);

  return (
    <div className="min-w-0 space-y-6">
      {isAddingMode ? (
        /* The form for one person. It takes the whole page: Team's title and tabs step aside. */
        <div ref={editorRef} className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <button
              onClick={closeEditor}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors"
              aria-label="Back to the team"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {editingEmployee ? 'Edit employee' : 'Add an employee'}
            </h1>
          </div>

          <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs space-y-8">
            <PersonFields
              form={form}
              hoursWarning={hoursWarning}
              onChange={(next) => { setForm(next); setFormError(''); }}
              services={salon.services}
              bookingHours={salon.bookingHours}
              employees={employees}
              editingId={editingEmployee?.id}
              onOpenServices={onOpenServices}
              focusName={!openSection}
            />

            {/* Buttons matching Figma */}
            {shownError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{shownError}</p>}
            <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row gap-3 justify-end">
              <button
                type="submit"
                name="intent"
                value="save"
                disabled={saving}
                className="min-h-11 px-6 py-2.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors sm:order-last disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save employee'}
              </button>
              {!editingEmployee && <button
                type="submit"
                name="intent"
                value="another"
                disabled={saving}
                className="min-h-11 px-5 py-2.5 text-xs font-semibold text-[#5551FF] bg-[#5551FF]/10 hover:bg-[#5551FF]/18 rounded-xl transition-colors disabled:opacity-60"
              >
                Save and add another employee
              </button>}

            </div>
          </form>

          {/* Deleting lives here, away from the list, and asks first. */}
          {editingEmployee && (
            <DeleteEmployee key={editingEmployee.id} employee={editingEmployee}
              blocked={deletionBlocker?.(editingEmployee) ?? null}
              onDelete={() => onDeleteEmployee(editingEmployee.id)} onDeleted={leaveEditor} />
          )}
        </div>
      ) : (
        /* The list of people */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">People</h2>
            <button
              onClick={() => openEditor()}
              data-opens-form="new"
              className="flex min-h-11 items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New employee</span>
            </button>
          </div>

          {/* Right after somebody was added: what is still missing before customers can book them, at most two steps. */}
          {removedNote && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{removedNote}</p>}
          {added && knowsSalon && (
            <AddedPersonSteps
              employee={added}
              steps={setupSteps(salon, added, today)}
              bookable={gapsOf(added).length === 0}
              onOpen={(section) => openEditor(added, section)}
              onDismiss={() => setAddedId(null)}
            />
          )}

          {/* The list, as cards on phones and as a table on wider screens */}
          {/* Phones: one card per employee so every field is readable without sideways scrolling */}
          <div className="space-y-2 md:hidden" aria-label="People">
            {employees.map((emp) => (
              <div key={emp.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 text-xs text-slate-700 shadow-xs">
                <div className="flex items-center gap-3">
                  <div style={staffAvatarStyle(staffColorFor(employees, emp.id))} className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-[11px] shrink-0">
                    {emp.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <button onClick={() => openEditor(emp)} data-opens-form={emp.id} aria-label={`Edit ${emp.name}`} title={`Edit ${emp.name}`} className="block min-h-11 w-full text-left text-sm font-semibold text-slate-900 [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-[#5551FF]">{emp.name}</button>
                  </div>
                  {/* No bin in the list: a person is deleted in their own form, which asks first. */}
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusBadge employee={emp} />
                  {emp.role && <RoleBadge role={emp.role} />}
                  {knowsSalon && <OnlineBadge gaps={gapsOf(emp)} />}
                </div>
                {knowsSalon && <GapReason gaps={gapsOf(emp)} className="mt-1.5" />}
                <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
                  <dt className="text-slate-400">Email</dt><dd className="min-w-0 text-slate-600">{emp.email || '—'}</dd>
                  <dt className="text-slate-400">Phone</dt><dd className="min-w-0 tabular-nums text-slate-600">{emp.phone ? formatPhone(emp.phone) : '—'}</dd>
                </dl>
              </div>
            ))}
            {employees.length === 0 && (
              <p className="rounded-2xl border border-slate-200/80 bg-white py-10 text-center text-xs text-slate-400">No employees yet. Add the first team member above.</p>
            )}
          </div>

          {tableScrolls && <p id="employees-scroll-hint" className="hidden text-xs text-slate-500 md:block">Swipe horizontally to see contact details. Names stay visible.</p>}
          <div ref={tableRef} role="region" aria-label="People" aria-describedby={tableScrolls ? 'employees-scroll-hint' : undefined} tabIndex={tableScrolls ? 0 : undefined} className="relative hidden max-w-full bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto focus-visible:outline-2 focus-visible:outline-[#5551FF] md:block">
            <div className="min-w-[680px]">
              {/* Table Header */}
              <div className={`grid ${tableColumns} border-b border-slate-100 text-xs font-semibold text-slate-400 py-3.5 pr-4 bg-slate-50`}>
                <div className="sticky left-0 z-10 bg-slate-50 -my-3.5 py-3.5 pl-4 pr-3">Name</div>
                <div>Status</div>
                <div className="pr-3">Online booking</div>
                <div>Email</div>
                <div>Phone</div>
              </div>

              {/* Table Rows */}
              <div className="divide-y divide-slate-100">
                {employees.map((emp) => (
                  <div
                    key={emp.id}
                    className={`grid ${tableColumns} items-center py-4 pr-4 bg-white hover:bg-slate-50 transition-colors text-xs text-slate-700 group`}
                  >
                    {/* Name with initials circle */}
                    <div className="sticky left-0 z-10 flex items-center gap-3 self-stretch bg-white group-hover:bg-slate-50 -my-4 py-4 pl-4 pr-3">
                      <div style={staffAvatarStyle(staffColorFor(employees, emp.id))} className="w-7 h-7 rounded-xl flex items-center justify-center font-bold text-[11px] shrink-0">
                        {emp.initials}
                      </div>
                      {/* Where the column is narrow the role moves under the name instead of squeezing it. */}
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                        <button onClick={() => openEditor(emp)} data-opens-form={emp.id} aria-label={`Edit ${emp.name}`} title={`Edit ${emp.name}`} className="min-h-11 max-w-full font-semibold text-slate-900 truncate text-left hover:underline">
                          {emp.name}
                        </button>
                        {emp.role && <RoleBadge role={emp.role} />}
                      </div>
                    </div>

                    {/* Status */}
                    <div>
                      <StatusBadge employee={emp} />
                    </div>

                    {/* Whether customers can book them, and what is in the way */}
                    <div className="min-w-0 pr-3">
                      {knowsSalon ? <><OnlineBadge gaps={gapsOf(emp)} /><GapReason gaps={gapsOf(emp)} className="mt-1" /></> : '—'}
                    </div>

                    {/* Email */}
                    <div className="text-slate-600 truncate pr-2" title={emp.email}>
                      {emp.email || '—'}
                    </div>

                    {/* Phone */}
                    <div className="text-slate-600 tabular-nums truncate" title={formatPhone(emp.phone)}>
                      {emp.phone ? formatPhone(emp.phone) : '—'}
                    </div>
                  </div>
                ))}
              </div>
              {/* A workspace without a team says so on wide screens too, as the phone list does. */}
              {employees.length === 0 && (
                <p className="py-10 text-center text-xs text-slate-400">No employees yet. Add the first team member above.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** The columns of the list on wide screens: name, status, online booking, e-mail, phone. */
const tableColumns = 'grid-cols-[minmax(10rem,1.3fr)_5.5rem_minmax(10rem,1.3fr)_minmax(8rem,1.4fr)_8.75rem]';

const StatusBadge: React.FC<{ employee: Employee }> = ({ employee }) => (
  <span className={`${badge} ${employee.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{employee.status}</span>
);

const RoleBadge: React.FC<{ role: string }> = ({ role }) => (
  <span className={`${badge} bg-indigo-50 text-[#5551FF] border-indigo-100`}>{role}</span>
);

/** "Bookable online" for a person the booking page offers, "Not bookable yet" for everybody else. */
const OnlineBadge: React.FC<{ gaps: BookingGap[] }> = ({ gaps }) => gaps.length === 0
  ? <span className={`${badge} bg-sky-50 text-sky-800 border-sky-200/70`}>Bookable online</span>
  : <span className={`${badge} bg-amber-50 text-amber-900 border-amber-300/70`}>Not bookable yet</span>;

/** Why a person cannot be booked online, in plain words. Nothing for somebody who can. */
const GapReason: React.FC<{ gaps: BookingGap[]; className?: string }> = ({ gaps, className = '' }) => gaps.length === 0 ? null : (
  <p className={`leading-snug text-slate-600 ${className}`}>{gaps.map((gap) => BOOKING_GAP_REASON[gap]).join(' · ')}</p>
);

interface AddedPersonStepsProps {
  employee: Employee;
  /** What is still missing: at most the services and the working hours. */
  steps: SetupStep[];
  /** True when the booking page offers the person. */
  bookable: boolean;
  /** Opens the person's form at the part where a step is done. */
  onOpen: (section: FormSection) => void;
  onDismiss: () => void;
}

/**
 * Shown above the list right after a person was added. While something is missing before
 * customers can book them, it lists the steps, each with the way to where it is done. Once
 * nothing is missing it says so. Somebody the owner set to inactive or switched off for online
 * booking has nothing missing: the list says why they are not offered, and this stays away.
 */
export const AddedPersonSteps: React.FC<AddedPersonStepsProps> = ({ employee, steps, bookable, onOpen, onDismiss }) => {
  if (steps.length === 0 && !bookable) return null;
  const first = employee.firstName.trim() || employee.name;
  return (
    <section role="status" aria-labelledby="added-person-title"
      className={`rounded-2xl border p-4 text-xs sm:p-5 ${bookable ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950' : 'border-amber-200 bg-amber-50/70 text-amber-950'}`}>
      <div className="flex items-start gap-3">
        {bookable && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <h3 id="added-person-title" className="text-sm font-bold [overflow-wrap:anywhere]">
            {bookable ? `${employee.name} can be booked online` : `${employee.name} is not bookable yet`}
          </h3>
          <p className="mt-1 leading-relaxed">
            {bookable
              ? `Customers can choose ${first} on your booking page from now on.`
              : `${steps.length === 1 ? 'One thing is' : 'Two things are'} missing before customers can book ${first} online.`}
          </p>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {steps.length > 0 && (
        <ol className="mt-3 space-y-2">
          {steps.map((step, index) => (
            <li key={step.section} className="flex flex-col gap-2 rounded-xl bg-white/80 p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-start gap-2.5 leading-relaxed">
                <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[11px] font-bold text-amber-950">{index + 1}</span>
                <span>{step.text}</span>
              </span>
              <button type="button" onClick={() => onOpen(step.section)}
                className="min-h-11 shrink-0 rounded-xl bg-[#5551FF] px-4 py-2 font-semibold text-white hover:bg-[#433fd8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
                {step.action}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

interface PersonFieldsProps {
  form: PersonForm;
  /** What the working hours in the form would do to bookings that exist, in a sentence. */
  hoursWarning?: string | null;
  onChange: (form: PersonForm) => void;
  services: ServiceItem[];
  bookingHours: BookingHoursDay[];
  /** The team, to say when nobody else offers a service that this person no longer does. */
  employees?: Employee[];
  /** The person whose form this is; left out for a new person. */
  editingId?: string;
  onOpenServices?: () => void;
  /** The first name takes the cursor when the form opens, unless it opens at one of its parts. */
  focusName?: boolean;
}

/**
 * The fields of a person's form: name and contact, their regular working hours, the services
 * they offer, and how they can be booked. It only shows the form's values and reports changes;
 * the form itself is held by the list (EmployeesView) and checked in src/personForm.ts.
 */
export const PersonFields: React.FC<PersonFieldsProps> = ({ form, hoursWarning = null, onChange, services, bookingHours, employees = [], editingId, onOpenServices, focusName = false }) => {
  const set = (partial: Partial<PersonForm>) => onChange({ ...form, ...partial });
  const setDay = (index: number, partial: Partial<DayRow>) =>
    set({ days: form.days.map((day, position) => position === index ? { ...day, ...partial } : day) });
  const openingWeek = weeklyHoursFromOpeningHours(bookingHours);
  const useOpeningHours = () => set({
    days: form.days.map((day, index) => {
      const hours = openingWeek[WEEKDAY_KEYS[index]];
      return hours ? { works: true, start: hours.start, end: hours.end } : { ...day, works: false };
    }),
  });
  const sameAsOpeningHours = form.days.every((day, index) => {
    const hours = openingWeek[WEEKDAY_KEYS[index]];
    return hours ? day.works && day.start === hours.start && day.end === hours.end : !day.works;
  });
  const worksAtAll = form.days.some((day) => day.works);
  // An online service that only this person offered and that is no longer ticked: nobody is left for it.
  const leftWithoutAnybody = !editingId ? [] : services.filter((service) =>
    service.onlineBooking && service.assignedEmployeeIds?.includes(editingId) && !form.serviceIds.includes(service.id)
    && !service.assignedEmployeeIds.some((id) => id !== editingId && employees.some((employee) => employee.id === id)));

  return (
    <>
      {/* Name Fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="employee-first-name" className="text-xs font-semibold text-slate-700 block mb-1.5">
            First name *
          </label>
          <input
            id="employee-first-name" maxLength={120}
            autoFocus={focusName}
            type="text"
            required
            placeholder="e.g. Jessica"
            value={form.firstName}
            onChange={(e) => set({ firstName: e.target.value })}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="employee-last-name" className="text-xs font-semibold text-slate-700 block mb-1.5">
            Last name *
          </label>
          <input
            id="employee-last-name" maxLength={120}
            type="text"
            required
            placeholder="e.g. Schmid"
            value={form.lastName}
            onChange={(e) => set({ lastName: e.target.value })}
            className={fieldClass}
          />
        </div>
      </div>

      {/* Contact Fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="employee-email" className="text-xs font-semibold text-slate-700 block mb-1.5">
            Email
          </label>
          <input
            id="employee-email" maxLength={254}
            type="email"
            placeholder="jessica.schmid@example.com"
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="employee-phone" className="text-xs font-semibold text-slate-700 block mb-1.5">
            Mobile phone
          </label>
          <input
            id="employee-phone" maxLength={40}
            type="tel"
            placeholder="079 123 45 67"
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
            className={fieldClass}
          />
        </div>
      </div>

      {/* Working hours: the regular week. Single days that differ are changed in "This week". */}
      <section aria-labelledby="employee-hours-title" className="space-y-3 text-xs">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 id="employee-hours-title" tabIndex={-1} className="scroll-mt-24 text-sm font-bold text-slate-900">Working hours</h2>
            <p className="mt-1 leading-relaxed text-slate-500">The days and times this person usually works. Customers can book inside these hours and your opening hours. A single day is changed in This week.</p>
          </div>
          {!sameAsOpeningHours && bookingHours.length > 0 && (
            <button type="button" onClick={useOpeningHours} className="min-h-11 shrink-0 rounded-xl px-3 py-2 font-semibold text-[#5551FF] bg-[#5551FF]/8 hover:bg-[#5551FF]/15 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
              Use the opening hours
            </button>
          )}
        </div>
        <div className="max-w-2xl">
          {form.days.map((day, index) => {
            const name = weekdayName(dateOfWeekday(WEEKDAY_KEYS[index]));
            return (
              <div key={name} className="flex flex-col sm:flex-row sm:items-center justify-between gap-x-3 gap-y-1 py-2 border-b border-slate-100">
                <div className="flex w-full max-w-xs items-center justify-between gap-4">
                  <span className="w-24 font-bold text-slate-800">{name}</span>
                  <label className="relative flex min-h-11 items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      aria-label={`Works on ${name}`}
                      checked={day.works}
                      onChange={(event) => setDay(index, { works: event.target.checked })}
                      className="sr-only peer"
                    />
                    <div className={smallSwitchTrack} />
                    <span className="w-9 text-xs font-semibold text-slate-600">{day.works ? 'Works' : 'Off'}</span>
                  </label>
                </div>
                {day.works ? (
                  // Lists of 24-hour times, not the browser's time field: that one follows the
                  // device's language and shows "06:00 PM" on an English one.
                  <div className="grid w-full max-w-sm grid-cols-1 gap-3 pb-1 min-[360px]:grid-cols-2 sm:pb-0">
                    <label className="min-w-0 space-y-1 text-slate-500"><span>From</span>
                      <select value={day.start} aria-label={`${name}: from`} onChange={(event) => setDay(index, { start: event.target.value })} className={timeFieldClass}>
                        {timeChoices(day.start).map((time) => <option key={time} value={time}>{time}</option>)}
                      </select></label>
                    <label className="min-w-0 space-y-1 text-slate-500"><span>To</span>
                      <select value={day.end} aria-label={`${name}: to`} onChange={(event) => setDay(index, { end: event.target.value })} className={timeFieldClass}>
                        {timeChoices(day.end).map((time) => <option key={time} value={time}>{time}</option>)}
                      </select></label>
                    {day.end <= day.start && <p className="text-rose-700 min-[360px]:col-span-2">Choose an end after the start.</p>}
                  </div>
                ) : (
                  <span className="hidden text-slate-400 text-xs italic sm:inline">Does not work</span>
                )}
              </div>
            );
          })}
        </div>
        {!worksAtAll && <p className="rounded-xl bg-amber-50 p-3 leading-relaxed text-amber-900">Without working hours this person can only be booked on days you enter for them in This week.</p>}
        {hoursWarning && <p role="status" className="rounded-xl bg-amber-50 p-3 leading-relaxed text-amber-900">{hoursWarning}</p>}
      </section>

      {/* Services: the same list a service's own form writes ("Employees who provide this service"). */}
      <section aria-labelledby="employee-services-title" className="space-y-3 text-xs">
        <div>
          <h2 id="employee-services-title" tabIndex={-1} className="scroll-mt-24 text-sm font-bold text-slate-900">Services</h2>
          <p className="mt-1 leading-relaxed text-slate-500">Tick what this person offers. They can only be booked for these services.</p>
        </div>
        {services.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-slate-600">
            <p className="min-w-0 flex-1 leading-relaxed">Your salon has no services yet. Add one in Services, then tick it here.</p>
            {onOpenServices && <button type="button" onClick={onOpenServices} className="min-h-11 shrink-0 rounded-xl bg-white px-3 py-2 font-semibold text-[#5551FF] border border-slate-200 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]">Open Services</button>}
          </div>
        ) : (
          <div role="group" aria-labelledby="employee-services-title" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {services.map((service) => (
              <label key={service.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 has-[:checked]:border-[#5551FF]/40 has-[:checked]:bg-indigo-50/60">
                <input
                  type="checkbox"
                  checked={form.serviceIds.includes(service.id)}
                  onChange={(event) => set({ serviceIds: event.target.checked ? [...form.serviceIds, service.id] : form.serviceIds.filter((id) => id !== service.id) })}
                  className="h-5 w-5 shrink-0 accent-[#5551FF]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-800 [overflow-wrap:anywhere]">{service.name}</span>
                  <span className="mt-0.5 block text-slate-500 tabular-nums">{service.durationMinutes} min · {formatMoney(service.priceCHF)}{!service.onlineBooking && ' · not offered online'}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {services.length > 0 && form.serviceIds.length === 0 && <p className="rounded-xl bg-amber-50 p-3 leading-relaxed text-amber-900">Without a service nobody can book this person, online or by hand.</p>}
        {leftWithoutAnybody.length > 0 && (
          <p role="status" className="rounded-xl bg-amber-50 p-3 leading-relaxed text-amber-900">
            Nobody else offers {leftWithoutAnybody.map((service) => service.name).join(', ')}. Customers cannot book {leftWithoutAnybody.length === 1 ? 'it' : 'them'} until somebody does.
          </p>
        )}
      </section>

      {/* A salon has one location here, so there is no branch to choose: only how this person can be booked. */}
      <section aria-labelledby="employee-booking-title" className="space-y-4 text-xs">
        <h2 id="employee-booking-title" tabIndex={-1} className="scroll-mt-24 text-sm font-bold text-slate-900">Booking</h2>
        <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/60">
          <label className="relative flex min-h-11 items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.bookableOnline}
              onChange={(e) => set({ bookableOnline: e.target.checked })}
              aria-describedby="employee-online-help"
              className="sr-only peer"
            />
            <div className={switchTrack} />
            <span className="text-xs font-semibold text-slate-700">
              Bookable online
            </span>
          </label>
          <p id="employee-online-help" className="mt-1 leading-relaxed text-slate-500">
            {form.bookableOnline
              ? 'Customers can choose this person on your booking page.'
              : 'Customers do not see this person on your booking page. You can still book them by hand in the calendar.'}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/60">
          <p id="employee-status-label" className="text-xs font-semibold text-slate-700">Status</p>
          <div role="radiogroup" aria-labelledby="employee-status-label" aria-describedby="employee-status-help" className="flex flex-wrap gap-x-6">
            {([['Active', true], ['Inactive', false]] as const).map(([label, value]) => (
              <label key={label} className="flex min-h-11 cursor-pointer items-center gap-2.5 font-semibold text-slate-700">
                <input type="radio" name="employee-status" checked={form.active === value} onChange={() => set({ active: value })} className="h-5 w-5 accent-[#5551FF]" />
                {label}
              </label>
            ))}
          </div>
          <p id="employee-status-help" className="leading-relaxed text-slate-500">
            {form.active
              ? 'Works at the salon and can get appointments.'
              : 'Gets no new appointments and is not on your booking page. The appointments this person already has stay in the calendar.'}
          </p>
        </div>
      </section>
    </>
  );
};

interface DeleteEmployeeProps {
  employee: Employee;
  /** Why the person cannot be deleted right now (appointments or requests still use them), or null. */
  blocked: string | null;
  /** Deletes the person, or returns why that was not possible. */
  onDelete: () => string | null | void;
  /** Called once the person is deleted: their form has nothing left to show. */
  onDeleted: () => void;
}

/**
 * The last part of a person's form: deleting them. It asks before it does anything, and it says
 * what goes with the person. Somebody whom appointments or requests still use cannot be deleted:
 * the reason stands in the button's place, so there is no button that would only refuse.
 */
export const DeleteEmployee: React.FC<DeleteEmployeeProps> = ({ employee, blocked, onDelete, onDeleted }) => {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const questionRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) questionRef.current?.focus(); }, [asking]);
  const confirm = () => {
    const refused = onDelete();
    if (refused) { setError(refused); setAsking(false); return; }
    onDeleted();
  };
  const keep = () => {
    setAsking(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };
  return (
    <section aria-labelledby="delete-employee-title" className="rounded-2xl border border-slate-200/80 bg-white p-6 text-xs shadow-xs sm:p-8">
      <h2 id="delete-employee-title" className="text-sm font-bold text-slate-900">Delete this employee</h2>
      {blocked ? (
        <>
          <p className="mt-2 leading-relaxed text-slate-600">{blocked}</p>
          {/* Somebody who has left keeps their appointments: the status does that, deleting cannot. */}
          {employee.status === 'Active' && <p className="mt-2 leading-relaxed text-slate-600">To stop new bookings and keep these appointments, set the status above to Inactive.</p>}
        </>
      ) : asking ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); keep(); } }}>
          <p ref={questionRef} tabIndex={-1} className="text-sm font-semibold text-rose-900 focus:outline-hidden">
            Delete {employee.name}?
          </p>
          <p className="mt-1 leading-relaxed text-rose-900">
            Their working hours and absences are deleted too, and they are taken off their services. Right afterwards you can still undo it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={confirm} className="min-h-11 rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700">Delete employee</button>
            <button type="button" onClick={keep} className="min-h-11 rounded-xl bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">Keep</button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 leading-relaxed text-slate-600">Removes {employee.name} from the team, with their working hours and absences.</p>
          {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-rose-700">{error}</p>}
          <button ref={buttonRef} type="button" onClick={() => { setError(''); setAsking(true); }}
            className="mt-3 min-h-11 rounded-xl border border-rose-200 px-4 py-2 font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700">
            Delete…
          </button>
        </>
      )}
    </section>
  );
};
