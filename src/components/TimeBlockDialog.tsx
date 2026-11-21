import React, { useEffect, useId, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Employee, TimeBlock } from '../types';
import { BLOCK_NOTE_LENGTH, BLOCK_STEP_MINUTES, TIME_BLOCK_REASONS, blockTimes } from '../timeBlocks';
import { addMinutes } from '../scheduling';

interface TimeBlockDialogProps {
  /** The stylists a block can be for. */
  employees: Employee[];
  /** The block that is changed, or null for a new one. */
  block: TimeBlock | null;
  /** What the form starts with. */
  initial: Omit<TimeBlock, 'id'>;
  /** The salon's date: a new block cannot lie before it. */
  today: string;
  /** Keeps the block. Returns why it cannot be kept, or null when it was. */
  onSave: (values: Omit<TimeBlock, 'id'>) => string | null;
  /** Removes the block that is changed. The message afterwards offers Undo, so nothing is asked first. */
  onRemove: () => void;
  onClose: () => void;
}

// The day of a salon, in quarter hours. A block that was stored with another time keeps it as a choice.
const DAY_TIMES = blockTimes().filter((time) => time >= '06:00' && time <= '22:00');
const timesWith = (time: string): string[] => DAY_TIMES.includes(time) || !time ? DAY_TIMES : [...DAY_TIMES, time].sort();

const fieldClass = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base focus:border-[#5551FF] focus:outline-hidden sm:text-sm';
const labelClass = 'mb-1 block text-xs font-semibold text-slate-700';

/**
 * Blocking time for a stylist: who, when, and why. The same form changes a block or removes it.
 * A native dialog, so it takes focus, gives it back, closes on Escape and on the phone's Back.
 */
export const TimeBlockDialog: React.FC<TimeBlockDialogProps> = ({ employees, block, initial, today, onSave, onRemove, onClose }) => {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [values, setValues] = useState(initial);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const change = (partial: Partial<Omit<TimeBlock, 'id'>>) => {
    setError('');
    setValues((previous) => {
      const next = { ...previous, ...partial };
      // A later start pushes the end along, so the block never ends before it begins.
      if (partial.startTime && next.endTime <= next.startTime) next.endTime = addMinutes(next.startTime, 2 * BLOCK_STEP_MINUTES);
      return next;
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const note = values.note?.trim();
    const problem = onSave({ ...values, note: note ? note : undefined });
    if (problem) {
      setError(problem);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    onClose();
  };

  // A stylist who is no longer active can still be named on a block that exists.
  const people = employees.filter((employee) => employee.status === 'Active' || employee.id === block?.employeeId);
  const title = block ? 'Change blocked time' : 'Block time';

  return (
    <dialog ref={dialogRef} aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40">
      <form onSubmit={submit} noValidate className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="min-w-0">
            <h3 id={`${id}-title`} className="text-base font-bold text-slate-900">{title}</h3>
            <p id={`${id}-help`} className="mt-0.5 text-xs text-slate-500">Nothing can be booked with this stylist in this time.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-[#5551FF]">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor={`${id}-stylist`} className={labelClass}>Stylist</label>
            <select id={`${id}-stylist`} autoFocus value={values.employeeId} onChange={(event) => change({ employeeId: event.target.value })} className={fieldClass}>
              {!people.some((employee) => employee.id === values.employeeId) && <option value="">Choose a stylist</option>}
              {people.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-date`} className={labelClass}>Date</label>
            <input id={`${id}-date`} type="date" value={values.date} min={block && block.date < today ? block.date : today}
              onChange={(event) => change({ date: event.target.value })} className={fieldClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor={`${id}-from`} className={labelClass}>From</label>
              <select id={`${id}-from`} value={values.startTime} onChange={(event) => change({ startTime: event.target.value })} className={fieldClass}>
                {timesWith(values.startTime).map((time) => <option key={time} value={time}>{time}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-to`} className={labelClass}>To</label>
              <select id={`${id}-to`} value={values.endTime} onChange={(event) => change({ endTime: event.target.value })} className={fieldClass}>
                {timesWith(values.endTime).map((time) => <option key={time} value={time}>{time}</option>)}
              </select>
            </div>
          </div>
          <fieldset>
            <legend className={labelClass}>Reason</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TIME_BLOCK_REASONS.map((reason) => (
                <label key={reason} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-2 text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-[#5551FF] ${
                  values.reason === reason ? 'border-[#5551FF] bg-indigo-50 text-[#5551FF]' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}>
                  <input type="radio" name={`${id}-reason`} value={reason} checked={values.reason === reason} onChange={() => change({ reason })} className="sr-only" />
                  {reason}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${id}-note`} className={labelClass}>Note <span className="font-normal text-slate-500">(optional)</span></label>
            <input id={`${id}-note`} type="text" maxLength={BLOCK_NOTE_LENGTH} value={values.note ?? ''} placeholder={values.reason === 'Other' ? 'What the time is for' : ''}
              onChange={(event) => change({ note: event.target.value })} className={fieldClass} />
          </div>
        </div>

        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 focus:outline-hidden">{error}</p>}

        <div className="flex flex-wrap gap-2 pt-1">
          {block && (
            <button type="button" onClick={() => { onRemove(); onClose(); }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-rose-600">
              <Trash2 className="h-4 w-4" aria-hidden="true" />Remove block
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose}
              className="min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-[#5551FF]">Cancel</button>
            <button type="submit"
              className="min-h-11 rounded-xl bg-[#5551FF] px-4 text-sm font-semibold text-white hover:bg-[#433fd8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
              {block ? 'Save changes' : 'Block time'}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
};
