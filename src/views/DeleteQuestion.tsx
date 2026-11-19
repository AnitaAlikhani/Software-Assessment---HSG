import { useEffect, useId, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

interface DeleteQuestionProps {
  /** What is deleted, in one word: "customer", "service". */
  kind: string;
  /** Its name, for the question. */
  name: string;
  /** What deleting does, in one sentence. */
  consequence: string;
  /** Why it cannot be deleted at the moment, or null. Said instead of the question. */
  blocked?: string | null;
  /** Called once the owner has answered the question with "Delete". */
  onDelete: () => void;
  /** Tests start after the first press on "Delete". */
  initiallyAsked?: boolean;
}

/**
 * "Delete" inside an edit form. It never deletes at the first press: it asks in place, with the
 * safe answer in focus, like the customers' own "Delete chat". Where a rule forbids deleting,
 * the press says why instead of asking a question that could only be refused afterwards.
 */
export function DeleteQuestion({ kind, name, consequence, blocked = null, onDelete, initiallyAsked = false }: DeleteQuestionProps) {
  const [asked, setAsked] = useState(initiallyAsked);
  const id = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const asking = asked && !blocked;
  const wasAsking = useRef(false);

  // Focus follows the question: to "Keep" when it is asked, back to "Delete" when it is withdrawn.
  useEffect(() => {
    if (asking) keepRef.current?.focus();
    else if (wasAsking.current) openerRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  if (asking) {
    return (
      <div role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-text`} className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
        <p id={`${id}-title`} className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">Delete {name}?</p>
        <p id={`${id}-text`} className="text-xs text-slate-600">{consequence}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onDelete} className="min-h-11 rounded-xl bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600">
            Delete {kind}
          </button>
          <button ref={keepRef} type="button" onClick={() => setAsked(false)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5551FF]">
            Keep {kind}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button ref={openerRef} type="button" onClick={() => setAsked(true)} aria-describedby={asked && blocked ? `${id}-reason` : undefined} className="-ml-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-rose-600">
        <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        Delete {kind}
      </button>
      {asked && blocked && <p id={`${id}-reason`} role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 [overflow-wrap:anywhere]">{blocked}</p>}
    </div>
  );
}
