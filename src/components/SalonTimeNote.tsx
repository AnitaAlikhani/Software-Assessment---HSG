import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { browserTimeZone, salonTimeNote } from '../format';

interface SalonTimeNoteProps {
  /** The salon's time zone, as stored in Company Settings. */
  timeZone?: string;
  /**
   * The time zone of the person looking at the page. Left out, the browser is asked once the
   * page is shown. Tests pass it, so they do not depend on the machine they run on.
   */
  viewerTimeZone?: string | null;
  /** The moment the two clocks are compared at. Left out, it is now. */
  now?: Date;
  /** Spacing and text size where the note stands. */
  className?: string;
}

/**
 * The one note about time zones: "Salon time (Zurich)". Every time in the app is the salon's
 * time. That only needs saying when the device is set to another time zone, for example for an
 * owner who is travelling. Where both clocks agree, which is nearly always, nothing is shown.
 */
export const SalonTimeNote: React.FC<SalonTimeNoteProps> = ({ timeZone, viewerTimeZone, now, className = 'text-xs' }) => {
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  // Asked after the first paint, not while rendering: a page built without a browser then says nothing.
  useEffect(() => { setBrowserZone(browserTimeZone()); }, []);
  const note = salonTimeNote(timeZone, viewerTimeZone !== undefined ? viewerTimeZone : browserZone, now ?? new Date());
  if (!note) return null;
  return (
    <p role="note" title="Times are shown in the salon's time, not in the time zone of this device."
      className={`flex items-center gap-1.5 font-medium text-slate-500 ${className}`}>
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{note}</span>
      <span className="sr-only">: times are shown in the salon's time, not in the time zone of this device.</span>
    </p>
  );
};
