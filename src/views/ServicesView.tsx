import React, { useEffect, useRef, useState } from 'react';
import { useHorizontalOverflow } from '../useHorizontalOverflow';
import { Plus, X } from 'lucide-react';
import { Employee, ServiceItem } from '../types';
import { formatMoney } from '../format';
import { DeleteQuestion } from './DeleteQuestion';
import { notSavedText, pendingFormSave, refreshSharedSalon, useServerValue } from '../useDemoState';
import { useStoredForm } from '../formFollow';
import { useFormSave } from '../formSave';
import { MAX_PRICE_CHF, TEXT_LIMITS } from '../fieldLimits';

interface ServicesViewProps {
  services: ServiceItem[];
  employees: Employee[];
  /** `id`: the id the form chose for this new service, the same for every try of one opening of the form. */
  onAddService: (srv: Omit<ServiceItem, 'id'>, id?: string) => void;
  onUpdateService: (id: string, srv: Partial<ServiceItem>) => void;
  onDeleteService: (id: string) => void;
  /**
   * Why a service cannot be deleted at the moment (appointments or requests still use it), or
   * null. The edit form then says so instead of asking whether to delete.
   */
  cannotDelete?: (service: ServiceItem) => string | null;
}

/** What the service form holds, as typed. */
interface ServiceFields {
  name: string; showInBooking: boolean; category: string; description: string;
  price: string; duration: string; prepTime: string; postTime: string; assignedEmployeeIds: string[];
}
const NEW_SERVICE: ServiceFields = {
  name: '', showInBooking: true, category: 'No category', description: '', price: '50.00', duration: '30', prepTime: '0', postTime: '0', assignedEmployeeIds: [],
};

/** Whether two fillings of the form say the same once saved: "70" and "70.00" are one price. */
const sameService = (a: ServiceFields, b: ServiceFields): boolean => {
  const saved = (fields: ServiceFields) => JSON.stringify({
    ...fields, name: fields.name.trim(), description: fields.description.trim(),
    price: Math.round(Number(fields.price) * 100), duration: Number(fields.duration), prepTime: Number(fields.prepTime), postTime: Number(fields.postTime),
  });
  return saved(a) === saved(b);
};

export const ServicesView: React.FC<ServicesViewProps> = ({ services, employees, onAddService, onUpdateService, onDeleteService, cannotDelete }) => {
  const [editingService, setEditingService] = useState<ServiceItem | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const tableScrolls = useHorizontalOverflow(tableRef);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  // The form's save is on its way to the server (signed-in device): this opening of the form waits
  // for its answer; another opening is not touched by it (src/formSave.ts).
  const { saving, notSaved, newOpening, afterSave } = useFormSave();
  // The open form follows what the server has of the service (src/formFollow.ts): a field the
  // owner has not changed shows a change made on another device, one she changed keeps her text.
  const storedServices = useServerValue('services', services);
  const storedService = editingService ? storedServices.find((item) => item.id === editingService.id) : undefined;
  const resolveAssignments = (service: ServiceItem) => (
    service.assignedEmployeeIds ?? []
  ).filter((id) => employees.some((employee) => employee.id === id));

  const fieldsOf = (service: ServiceItem): ServiceFields => ({
    name: service.name, showInBooking: service.onlineBooking, category: service.category || 'No category', description: service.description || '',
    price: service.priceCHF.toFixed(2), duration: String(service.durationMinutes), prepTime: String(service.prepMinutes || 0),
    postTime: String(service.postMinutes || 0), assignedEmployeeIds: resolveAssignments(service),
  });
  const [createdFrom, setCreatedFrom] = useState(NEW_SERVICE);
  // The id a new service gets: one per opening of the form. A save that is tried again (its answer
  // got lost, or the server could not be reached) then takes the place of the first try and never
  // adds a second service.
  const [newId, setNewId] = useState('');
  const { form: fields, setForm: setFields, restart, startedFrom } = useStoredForm<ServiceFields>(storedService ? fieldsOf(storedService) : createdFrom);
  // Why the last save was not taken, said only while the form still holds something the server
  // does not have: once the server has exactly this (its answer got lost), the sentence goes.
  const shownError = error || (notSaved && (!editingService || !sameService(fields, startedFrom)) ? notSaved : '');
  const { name, showInBooking, category, description, price, duration, prepTime, postTime, assignedEmployeeIds } = fields;
  const field = <K extends keyof ServiceFields>(key: K) => (value: React.SetStateAction<ServiceFields[K]>) =>
    setFields((previous) => ({ ...previous, [key]: typeof value === 'function' ? (value as (old: ServiceFields[K]) => ServiceFields[K])(previous[key]) : value }));
  const setName = field('name');
  const setShowInBooking = field('showInBooking');
  const setCategory = field('category');
  const setDescription = field('description');
  const setPrice = field('price');
  const setDuration = field('duration');
  const setPrepTime = field('prepTime');
  const setPostTime = field('postTime');
  const setAssignedEmployeeIds = field('assignedEmployeeIds');
  // The service that is open was deleted on another device: the form closes and says so.
  const [removedNote, setRemovedNote] = useState('');
  const dialogRef = useRef<HTMLFormElement>(null);
  const isOpen = Boolean(editingService || isCreating);
  const inputClass = 'min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-none focus:ring-2 focus:ring-[#5551FF]/20';

  const closeModal = () => { setEditingService(null); setIsCreating(false); setError(''); newOpening(); };

  useEffect(() => {
    if (!isOpen) return;
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.querySelector<HTMLInputElement>('#service-name')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
      // The service whose "Edit" opened the form was deleted: the page's heading takes the focus.
      else if (headingRef.current) { headingRef.current.tabIndex = -1; headingRef.current.focus({ preventScroll: true }); }
    };
  }, [isOpen]);

  const startEdit = (service: ServiceItem) => {
    refreshSharedSalon();
    const stored = storedServices.find((item) => item.id === service.id) ?? service;
    setEditingService(stored);
    setIsCreating(false);
    restart(fieldsOf(stored));
    setError(''); setRemovedNote('');
    newOpening();
  };

  const startCreate = () => {
    setEditingService(null); setIsCreating(true);
    setNewId(`srv-${Date.now()}`);
    setCreatedFrom(NEW_SERVICE); restart(NEW_SERVICE);
    setError(''); setRemovedNote('');
    newOpening();
  };

  // The new service turns out to be on the server although its save was reported as not taken (the
  // answer got lost on the way). The form has done its work and closes; the list shows the service.
  // If the owner has typed more into the form since, nothing of that is dropped: the form goes on
  // as the form of that service, with what she typed, still to save.
  const arrived = isCreating && Boolean(newId) && !saving ? storedServices.find((item) => item.id === newId) : undefined;
  useEffect(() => {
    if (!arrived) return;
    if (sameService(fields, fieldsOf(arrived))) { closeModal(); return; }
    setEditingService(arrived);
    setIsCreating(false);
    setError('');
    newOpening();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived?.id]);

  // Gone from the server and from the screen: deleted elsewhere (a delete made here closes the form itself).
  const openGone = Boolean(editingService && !storedService && !services.some((item) => item.id === editingService.id));
  useEffect(() => {
    if (!openGone || !editingService) return;
    setRemovedNote(`${editingService.name} was removed on another device.`);
    closeModal();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGone]);

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    const priceCHF = Number(price);
    const durationMinutes = Number(duration);
    const prepMinutes = Number(prepTime);
    const postMinutes = Number(postTime);
    const assignments = assignedEmployeeIds.filter((id) => employees.some((employee) => employee.id === id));
    if (!name.trim()) { setError('Enter a service name.'); return; }
    if (name.trim().length > TEXT_LIMITS.name) { setError(`The service name can be at most ${TEXT_LIMITS.name} characters.`); return; }
    if (description.trim().length > TEXT_LIMITS.serviceDescription) { setError(`The description can be at most ${TEXT_LIMITS.serviceDescription} characters.`); return; }
    if (!price.trim() || !Number.isFinite(priceCHF) || priceCHF < 0) { setError('Enter a price of CHF 0 or more.'); return; }
    if (priceCHF > MAX_PRICE_CHF) { setError('Enter a price of at most CHF 100,000.'); return; }
    if (!duration.trim() || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1439) { setError('Duration must be a whole number between 1 and 1439 minutes.'); return; }
    if (![prepTime, postTime].every((value) => value.trim() !== '') || ![prepMinutes, postMinutes].every((value) => Number.isInteger(value) && value >= 0 && value < 1440)) { setError('Preparation and cleanup must be nonnegative whole minutes.'); return; }
    if (durationMinutes + prepMinutes + postMinutes > 1440) { setError('The service and its preparation and cleanup must fit within one day.'); return; }
    if (showInBooking && assignments.length === 0) { setError('Choose at least one employee before showing this service in online booking.'); return; }
    const details: Omit<ServiceItem, 'id'> = {
      name: name.trim(), priceCHF: Math.round(priceCHF * 100) / 100, durationMinutes,
      onlineBooking: showInBooking, category, description: description.trim(), prepMinutes,
      postMinutes, assignedEmployeeIds: assignments, assignedEmployeesCount: assignments.length,
    };
    if (saving) return;
    if (editingService) onUpdateService(editingService.id, details);
    else onAddService(details, newId || undefined);
    // On a signed-in device the form stays as typed until the server has it; not taken, it stays
    // open and the message says why. Elsewhere it closes at once.
    const pending = pendingFormSave();
    afterSave(pending, closeModal, notSavedText);
  };

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 ref={headingRef} className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Services</h1>
        <button onClick={startCreate} className="flex min-h-11 items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl">
          <Plus className="w-3.5 h-3.5" /><span>New Service</span>
        </button>
      </div>
      <p className="text-sm text-slate-500">Choose which employees provide each service. Their working hours and the preparation time decide which times can be booked.</p>
      {removedNote && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{removedNote}</p>}
      {/* Phones: one card per service with every setting reachable without sideways scrolling */}
      <div className="space-y-2 md:hidden" aria-label="Services">
        {services.map((service) => {
          const assignments = resolveAssignments(service);
          const unassigned = assignments.length === 0;
          return <div key={service.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 text-xs text-slate-700 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{service.name}</p>
                <p className="mt-1 text-slate-500 tabular-nums">{service.durationMinutes} min{Boolean(service.prepMinutes || service.postMinutes) && ` (+ ${(service.prepMinutes || 0) + (service.postMinutes || 0)} min staff time)`} · {assignments.length} {assignments.length === 1 ? 'employee' : 'employees'}</p>
              </div>
              <span className="shrink-0 font-semibold tabular-nums">{formatMoney(service.priceCHF)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold text-slate-700">
                <input type="checkbox" checked={service.onlineBooking}
                  onChange={(event) => onUpdateService(service.id, { onlineBooking: event.target.checked, assignedEmployeeIds: assignments, assignedEmployeesCount: assignments.length })}
                  disabled={!service.onlineBooking && unassigned} aria-describedby={unassigned ? `service-${service.id}-hint` : undefined}
                  className="h-5 w-5 accent-[#5551FF]" />
                Online booking
              </label>
              {/* One way into the form. Deleting is in there too, and asks first. */}
              <button onClick={() => startEdit(service)} className="-mr-2 min-h-11 min-w-11 rounded-lg px-2 font-semibold text-[#5551FF] hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]" aria-label={`Edit ${service.name}`}>Edit</button>
            </div>
            {unassigned && <p id={`service-${service.id}-hint`} className="text-slate-500">Assign an employee in Edit service to offer it online.</p>}
          </div>;
        })}
        {services.length === 0 && <p className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center text-xs text-slate-500">No services yet. Add a service and assign the employees who provide it.</p>}
      </div>

      {tableScrolls && <p id="services-scroll-hint" className="hidden text-xs text-slate-500 md:block">Swipe horizontally to see booking settings and actions. Service names stay visible.</p>}
      <div ref={tableRef} role="region" aria-label="Services" aria-describedby={tableScrolls ? 'services-scroll-hint' : undefined} tabIndex={tableScrolls ? 0 : undefined} className="relative hidden max-w-full bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto focus-visible:outline-2 focus-visible:outline-[#5551FF] md:block">
        <table className="w-full min-w-[700px] text-xs text-left">
          <thead className="text-slate-500 bg-slate-50 border-b border-slate-100">
            <tr><th className="sticky left-0 z-10 w-40 min-w-40 bg-slate-50 py-3.5 px-4">Name</th><th className="py-3.5 px-4">Duration</th><th className="py-3.5 px-4">Price</th><th className="py-3.5 px-4">Online booking</th><th className="py-3.5 px-4">Employees</th><th className="relative py-3.5 px-4"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {services.map((service) => {
              const assignments = resolveAssignments(service);
              return <tr key={service.id} className="group hover:bg-slate-50">
                <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 py-4 px-4"><span className="block max-w-40 [overflow-wrap:anywhere] font-semibold text-slate-900">{service.name}</span></td>
                <td className="py-4 px-4 text-slate-600 tabular-nums">{service.durationMinutes} min{Boolean(service.prepMinutes || service.postMinutes) && <span className="block text-[11px] text-slate-400">+ {(service.prepMinutes || 0) + (service.postMinutes || 0)} min staff time</span>}</td>
                <td className="py-4 px-4 font-semibold tabular-nums whitespace-nowrap">{formatMoney(service.priceCHF)}</td>
                <td className="py-4 px-4">
                  <label className="relative inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                  <input type="checkbox" aria-label={`Show ${service.name} in online booking`} checked={service.onlineBooking}
                    onChange={(event) => onUpdateService(service.id, { onlineBooking: event.target.checked, assignedEmployeeIds: assignments, assignedEmployeesCount: assignments.length })}
                    disabled={!service.onlineBooking && assignments.length === 0} aria-describedby={assignments.length === 0 ? `service-${service.id}-table-hint` : undefined}
                    className="h-4 w-4 accent-[#5551FF]" />
                  </label>
                  {assignments.length === 0 && <span id={`service-${service.id}-table-hint`} className="block max-w-28 text-[10px] leading-tight text-slate-400">Assign an employee first</span>}
                </td>
                <td className="py-4 px-4 text-slate-500 whitespace-nowrap">{assignments.length} {assignments.length === 1 ? 'employee' : 'employees'}</td>
                <td className="py-4 px-2 text-right sm:px-4"><button onClick={() => startEdit(service)} className="min-h-11 min-w-11 rounded-lg px-2 font-semibold text-[#5551FF] hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-[#5551FF]" aria-label={`Edit ${service.name}`}>Edit</button></td>
              </tr>;
            })}
          </tbody>
        </table>
        {services.length === 0 && <p className="p-8 text-center text-xs text-slate-500">No services yet. Add a service and assign the employees who provide it.</p>}
      </div>
      {isOpen && <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end" onClick={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
        <form ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="service-title" onSubmit={handleSave} className="w-full max-w-lg bg-white h-full shadow-2xl p-6 sm:p-7 overflow-y-auto overscroll-contain space-y-5 flex flex-col text-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100"><h2 id="service-title" className="text-base font-bold text-slate-900">{isCreating ? 'Create Service' : 'Edit Service'}</h2><button type="button" aria-label="Close service editor" onClick={closeModal} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button></div>
          <label className="flex min-h-11 items-center justify-between font-semibold text-slate-700">Show in online booking<input type="checkbox" checked={showInBooking} onChange={(event) => setShowInBooking(event.target.checked)} className="h-4 w-4 accent-[#5551FF]" /></label>
          <div><label htmlFor="service-name" className="font-semibold text-slate-700 block mb-1">Name</label><input id="service-name" maxLength={120} required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></div>
          <div><label htmlFor="service-category" className="font-semibold text-slate-700 block mb-1">Category</label><select id="service-category" value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass}>{['No category', 'Cut', 'Colour', 'Styling', 'Treatment'].map((item) => <option key={item}>{item}</option>)}</select></div>
          <div><label htmlFor="service-description" className="font-semibold text-slate-700 block mb-1">Description</label><textarea id="service-description" maxLength={1000} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Help customers choose the right service." className={inputClass} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label htmlFor="service-price" className="font-semibold text-slate-700 block mb-1">Price (CHF)</label><input id="service-price" type="number" inputMode="decimal" required min="0" max="100000" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className={inputClass} /></div>
            <div><label htmlFor="service-duration" className="font-semibold text-slate-700 block mb-1">Duration (minutes)</label><input id="service-duration" type="number" inputMode="numeric" required min="1" max="1439" step="1" value={duration} onChange={(event) => setDuration(event.target.value)} className={inputClass} /></div>
            <div><label htmlFor="service-preparation" className="font-semibold text-slate-700 block mb-1">Preparation (minutes)</label><input id="service-preparation" type="number" inputMode="numeric" required min="0" max="1439" step="1" value={prepTime} onChange={(event) => setPrepTime(event.target.value)} className={inputClass} /></div>
            <div><label htmlFor="service-cleanup" className="font-semibold text-slate-700 block mb-1">Cleanup (minutes)</label><input id="service-cleanup" type="number" inputMode="numeric" required min="0" max="1439" step="1" value={postTime} onChange={(event) => setPostTime(event.target.value)} className={inputClass} /></div>
          </div>
          <p className="text-slate-500">Preparation is reserved before the appointment and cleanup afterwards. Customers see the appointment duration.</p>
          <fieldset className="space-y-2"><legend className="font-semibold text-slate-700 mb-2">Employees who provide this service</legend>
            {employees.map((employee) => <label key={employee.id} className="flex min-h-11 items-center gap-3 rounded-xl p-3 bg-slate-50 border border-slate-200"><input type="checkbox" checked={assignedEmployeeIds.includes(employee.id)} onChange={(event) => setAssignedEmployeeIds((previous) => event.target.checked ? [...previous, employee.id] : previous.filter((id) => id !== employee.id))} className="h-4 w-4 accent-[#5551FF]" /><span className="flex-1"><span className="font-semibold text-slate-700">{employee.name}</span>{(employee.hidden || employee.status !== 'Active' || !employee.canBookOnline) && <span className="block text-slate-500 mt-0.5">Currently unavailable for online booking</span>}</span></label>)}
            {employees.length === 0 && <p className="text-slate-500">Add employees first, or hide this service from online booking until someone is assigned.</p>}
          </fieldset>
          {shownError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-700">{shownError}</p>}
          <div className="pt-4 border-t border-slate-100 flex gap-2 mt-auto"><button type="button" onClick={closeModal} className="min-h-11 flex-1 py-2 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl">Cancel</button><button type="submit" disabled={saving} className="min-h-11 flex-1 py-2 font-semibold text-white bg-[#5551FF] hover:bg-[#433fd8] rounded-xl disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button></div>
          {/* Deleting lives here, with the service open, and asks first. A service that appointments or requests still use says so instead. */}
          {editingService && (
            <div className="border-t border-slate-100 pt-3">
              <DeleteQuestion
                kind="service"
                name={editingService.name}
                consequence="It is removed from your list of services."
                blocked={cannotDelete?.(editingService) ?? null}
                onDelete={() => { onDeleteService(editingService.id); closeModal(); }}
              />
            </div>
          )}
        </form>
      </div>}
    </div>
  );
};
