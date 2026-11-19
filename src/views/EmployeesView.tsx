import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useHorizontalOverflow } from '../useHorizontalOverflow';
import {
  Plus,
  ArrowLeft,
  ChevronRight,
  Info,
} from 'lucide-react';
import { Employee } from '../types';
import { validateOptionalContact, validatePersonName } from '../managementValidation';
import { formatPhone, normalizePhone } from '../format';
import { useCloseOnBack } from '../backGesture';

interface EmployeesViewProps {
  employees: Employee[];
  onAddEmployee: (emp: Omit<Employee, 'id' | 'initials' | 'name'>) => void;
  onUpdateEmployee: (id: string, employee: Partial<Employee>) => void;
  /** Deletes the person, or returns why that is not possible. */
  onDeleteEmployee: (id: string) => string | null | void;
  /** Why a person cannot be deleted right now (appointments or requests still use them), or null. */
  deletionBlocker?: (employee: Employee) => string | null;
  companyName?: string;
  /** Tells the page around the list that the form for one person is open: it fills the page then. */
  onEditingChange?: (editing: boolean) => void;
  /**
   * While the form holds changes that are not saved: the question to ask before the owner is
   * taken to another screen. Null when there is nothing to lose.
   */
  onUnsavedChange?: (question: string | null) => void;
}

/**
 * The tab "People" of Team: the list of the salon's people and the form for one of them.
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
  onEditingChange,
  onUnsavedChange,
}) => {
  const [isAddingMode, setIsAddingMode] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [formError, setFormError] = useState('');
  // Before the screen is drawn, so that the page's own title and tabs never show next to the form.
  useLayoutEffect(() => {
    onEditingChange?.(isAddingMode);
    return () => onEditingChange?.(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAddingMode]);

  // Form State matching Figma Page 19, 33
  const [firstName, setFirstName] = useState('');
  const tableRef = useRef<HTMLDivElement>(null);
  const tableScrolls = useHorizontalOverflow(tableRef, [isAddingMode]);
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [hidden, setHidden] = useState(false);
  const [canBookOnline, setCanBookOnline] = useState(true);

  // What the form showed when it was opened. Anything else in it now is a change that would be lost.
  const [openedWith, setOpenedWith] = useState('');
  const formChanged = isAddingMode && JSON.stringify([firstName, lastName, email, mobilePhone, hidden, canBookOnline]) !== openedWith;
  const discardQuestion = editingEmployee
    ? `Discard your changes to ${editingEmployee.name}? They are not saved yet.`
    : 'Discard this new employee? It is not saved yet.';

  const openEditor = (employee: Employee | null = null) => {
    const shown = [employee?.firstName ?? '', employee?.lastName ?? '', employee?.email ?? '', formatPhone(employee?.phone ?? ''), employee?.hidden ?? false, employee?.canBookOnline ?? true] as const;
    setEditingEmployee(employee); setFirstName(shown[0]); setLastName(shown[1]);
    setEmail(shown[2]); setMobilePhone(shown[3]);
    setHidden(shown[4]); setCanBookOnline(shown[5]);
    setOpenedWith(JSON.stringify(shown));
    setFormError(''); setIsAddingMode(true);
  };
  /** Back to the list. A form with changes asks first: a tap on the arrow or the Back gesture is quickly done. */
  const closeEditor = () => {
    if (formChanged && !window.confirm(discardQuestion)) return;
    setIsAddingMode(false);
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

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) { setFormError('Enter the employee’s first and last names.'); return; }
    const error = validatePersonName(`${firstName} ${lastName}`, 'the employee’s') ?? validateOptionalContact(email, mobilePhone);
    if (error) { setFormError(error); return; }
    const details: Omit<Employee, 'id' | 'initials' | 'name'> = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      // Stored once, in the international form; the list writes it out again.
      phone: mobilePhone.trim() ? normalizePhone(mobilePhone) : '',
      status: editingEmployee?.status ?? 'Active',
      location: companyName,
      canBookOnline,
      hidden,
    };
    if (editingEmployee) onUpdateEmployee(editingEmployee.id, details);
    else onAddEmployee(details);
    const addAnother = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'another';
    if (addAnother) {
      openEditor();
      event.currentTarget.querySelector<HTMLInputElement>('#employee-first-name')?.focus();
    } else {
      setIsAddingMode(false);
      setFirstName('');
      setLastName('');
      setEmail('');
      setMobilePhone('');
    }
  };

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

          <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs space-y-6">
            {/* Name Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label htmlFor="employee-first-name" className="text-xs font-semibold text-slate-700 block mb-1.5">
                  First name *
                </label>
                <input
                  id="employee-first-name"
                  autoFocus
                  type="text"
                  required
                  placeholder="e.g. Jessica"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border-b border-slate-300 focus:border-[#5551FF] focus:bg-white focus:outline-hidden text-base sm:text-sm transition-all rounded-t-lg"
                />
              </div>

              <div>
                <label htmlFor="employee-last-name" className="text-xs font-semibold text-slate-700 block mb-1.5">
                  Last name *
                </label>
                <input
                  id="employee-last-name"
                  type="text"
                  required
                  placeholder="e.g. Schmid"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border-b border-slate-300 focus:border-[#5551FF] focus:bg-white focus:outline-hidden text-base sm:text-sm transition-all rounded-t-lg"
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
                  id="employee-email"
                  type="email"
                  placeholder="jessica.schmid@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border-b border-slate-300 focus:border-[#5551FF] focus:bg-white focus:outline-hidden text-base sm:text-sm transition-all rounded-t-lg"
                />
              </div>

              <div>
                <label htmlFor="employee-phone" className="text-xs font-semibold text-slate-700 block mb-1.5">
                  Mobile phone
                </label>
                <input
                  id="employee-phone"
                  type="tel"
                  placeholder="079 123 45 67"
                  value={mobilePhone}
                  onChange={(e) => setMobilePhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border-b border-slate-300 focus:border-[#5551FF] focus:bg-white focus:outline-hidden text-base sm:text-sm transition-all rounded-t-lg"
                />
              </div>
            </div>

            {/* Hide Employee Switch */}
            <div className="pt-2">
              <label className="relative flex min-h-11 items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="relative w-11 h-6 shrink-0 bg-slate-200 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-[#5551FF] peer-focus-visible:ring-offset-2 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#5551FF]" />
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  Hide this employee
                  <Info className="w-3.5 h-3.5 text-slate-400" />
                </span>
              </label>
            </div>

            {/* A salon has one location here, so there is no branch to choose: only whether customers can book this person. */}
            <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/60 space-y-3">
              <label className="relative flex min-h-11 items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={canBookOnline}
                  onChange={(e) => setCanBookOnline(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="relative w-11 h-6 shrink-0 bg-slate-200 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-[#5551FF] peer-focus-visible:ring-offset-2 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#5551FF]" />
                <span className="text-xs font-semibold text-slate-700">
                  Can be booked online by customers
                </span>
              </label>
            </div>

            {/* Buttons matching Figma */}
            {formError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{formError}</p>}
            <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row gap-3 justify-end">
              <button
                type="submit"
                name="intent"
                value="save"
                className="min-h-11 px-6 py-2.5 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors sm:order-last"
              >
                Save employee
              </button>
              {!editingEmployee && <button
                type="submit"
                name="intent"
                value="another"
                className="min-h-11 px-5 py-2.5 text-xs font-semibold text-[#5551FF] bg-[#5551FF]/10 hover:bg-[#5551FF]/18 rounded-xl transition-colors"
              >
                Save and add another employee
              </button>}

            </div>
          </form>

          {/* Deleting lives here, away from the list, and asks first. */}
          {editingEmployee && (
            <DeleteEmployee key={editingEmployee.id} employee={editingEmployee}
              blocked={deletionBlocker?.(editingEmployee) ?? null}
              onDelete={() => onDeleteEmployee(editingEmployee.id)} onDeleted={() => setIsAddingMode(false)} />
          )}
        </div>
      ) : (
        /* The list of people */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">People</h2>
            <button
              onClick={() => openEditor()}
              className="flex min-h-11 items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New employee</span>
            </button>
          </div>

          {/* The list, as cards on phones and as a table on wider screens */}
          {/* Phones: one card per employee so every field is readable without sideways scrolling */}
          <div className="space-y-2 md:hidden" aria-label="People">
            {employees.map((emp) => (
              <div key={emp.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 text-xs text-slate-700 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-purple-50 text-[#5551FF] flex items-center justify-center font-bold text-[11px] shrink-0 border border-purple-100">
                    {emp.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <button onClick={() => openEditor(emp)} aria-label={`Edit ${emp.name}`} title={`Edit ${emp.name}`} className="block min-h-11 w-full text-left text-sm font-semibold text-slate-900 [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-[#5551FF]">{emp.name}</button>
                    <span className="mt-0.5 inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">{emp.status}</span>
                    {emp.role && <span className="ml-1.5 mt-0.5 inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-[#5551FF] border border-indigo-100">{emp.role}</span>}
                  </div>
                  {/* No bin in the list: a person is deleted in their own form, which asks first. */}
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                </div>
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
            <div className="min-w-[700px]">
              {/* Table Header */}
              <div className="grid grid-cols-12 border-b border-slate-100 text-xs font-semibold text-slate-400 py-3.5 pr-4 bg-slate-50">
                <div className="col-span-3 sticky left-0 z-10 bg-slate-50 -my-3.5 py-3.5 pl-4 pr-3">Name</div>
                <div className="col-span-4">Email</div>
                <div className="col-span-2 text-center">Account</div>
                <div className="col-span-3">Phone</div>
              </div>

              {/* Table Rows */}
              <div className="divide-y divide-slate-100">
                {employees.map((emp) => (
                  <div
                    key={emp.id}
                    className="grid grid-cols-12 items-center py-4 pr-4 bg-white hover:bg-slate-50 transition-colors text-xs text-slate-700 group"
                  >
                    {/* Name with initials circle */}
                    <div className="col-span-3 sticky left-0 z-10 flex items-center gap-3 self-stretch bg-white group-hover:bg-slate-50 -my-4 py-4 pl-4 pr-3">
                      <div className="w-7 h-7 rounded-xl bg-purple-50 text-[#5551FF] flex items-center justify-center font-bold text-[11px] shrink-0 border border-purple-100">
                        {emp.initials}
                      </div>
                      <button onClick={() => openEditor(emp)} aria-label={`Edit ${emp.name}`} title={`Edit ${emp.name}`} className="min-h-11 min-w-0 font-semibold text-slate-900 truncate text-left hover:underline">
                        {emp.name}
                      </button>
                      {emp.role && <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-[#5551FF] border border-indigo-100">{emp.role}</span>}
                    </div>

                    {/* Email */}
                    <div className="col-span-4 text-slate-600 truncate pr-2" title={emp.email}>
                      {emp.email || '—'}
                    </div>

                    {/* Account Status Badge */}
                    <div className="col-span-2 flex justify-center">
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                        {emp.status}
                      </span>
                    </div>

                    {/* Phone */}
                    <div className="col-span-3 text-slate-600 tabular-nums truncate pr-2" title={formatPhone(emp.phone)}>
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
        <p className="mt-2 leading-relaxed text-slate-600">{blocked}</p>
      ) : asking ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); keep(); } }}>
          <p ref={questionRef} tabIndex={-1} className="text-sm font-semibold text-rose-900 focus:outline-hidden">
            Delete {employee.name}?
          </p>
          <p className="mt-1 leading-relaxed text-rose-900">
            Their shifts and absences are deleted too, and they are taken off their services. Right afterwards you can still undo it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={confirm} className="min-h-11 rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700">Delete employee</button>
            <button type="button" onClick={keep} className="min-h-11 rounded-xl bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">Keep</button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 leading-relaxed text-slate-600">Removes {employee.name} from the team, with their shifts and absences.</p>
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
