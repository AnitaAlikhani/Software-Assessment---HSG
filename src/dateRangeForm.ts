import { useState } from 'react';
import { getSalonNow } from './scheduling';

/** True for a real calendar day written as YYYY-MM-DD. */
export const isValidDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** The look of the fields in these forms. */
export const dateRangeFieldClass = 'min-w-0 min-h-11 text-base sm:text-sm w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#5551FF] focus:outline-none focus:ring-2 focus:ring-[#5551FF]/20';

/**
 * What the two lists of days off share: the salon's closed dates (Settings) and the absences of
 * one person (Team). Each entry has a first and a last day and a line of text, and each list
 * saves one entry at a time, at once.
 *
 * `firstFieldId`: the field that gets the cursor when an entry is opened for editing.
 */
export function useDateRangeForm(timeZone: string | undefined, now: Date | undefined, firstFieldId: string) {
  const today = () => getSalonNow(timeZone, now).date;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const reset = () => {
    setEditingId(null); setText('');
    const day = today();
    setStart(day); setEnd(day); setError('');
  };
  /** Puts an entry into the form. On phones the form sits below the list: bring it into view so the tap has a visible result. */
  const edit = (entry: { id: string; start: string; end: string }, entryText: string) => {
    setEditingId(entry.id); setText(entryText); setStart(entry.start); setEnd(entry.end);
    setError(''); setFeedback('');
    requestAnimationFrame(() => {
      const field = document.getElementById(firstFieldId);
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      field?.focus({ preventScroll: true });
    });
  };
  /** A first day cannot lie after the last one: the last day follows. */
  const changeStart = (value: string) => { setStart(value); if (end < value) setEnd(value); };
  const rangeError = (): string | null =>
    !isValidDate(start) || !isValidDate(end) || end < start ? 'Choose valid dates with the last day on or after the first day.' : null;

  return { editingId, text, setText, start, changeStart, end, setEnd, error, setError, feedback, setFeedback, reset, edit, rangeError };
}
