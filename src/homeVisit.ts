/**
 * When the owner last looked at Home, kept in this browser. Home marks what the AI booked since
 * then as new, so a booking that arrived overnight does not look like one from last week.
 *
 * Only a moment is stored, nothing about the salon. A browser that keeps nothing (a private
 * window, blocked storage) simply never marks anything as new.
 */
export const HOME_VISIT_KEY = 'slotbee-home-visit';

type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage = (): VisitStorage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

/** The moment of the last visit (ISO), or null on a first visit and where nothing can be read. */
export function lastHomeVisit(storage: VisitStorage | null = browserStorage()): string | null {
  try {
    const stored = storage?.getItem(HOME_VISIT_KEY) ?? null;
    return stored !== null && Number.isFinite(Date.parse(stored)) ? stored : null;
  } catch { return null; }
}

/** Notes that the owner has looked at Home at this moment. */
export function noteHomeVisit(moment: Date, storage: VisitStorage | null = browserStorage()): void {
  try { storage?.setItem(HOME_VISIT_KEY, moment.toISOString()); } catch { /* Nothing is kept here: nothing will be marked as new. */ }
}

/**
 * True for something that was made after the last visit. On a first visit nothing is new: there
 * is no "last time" to compare with, and marking everything would mark nothing.
 */
export const isNewSince = (madeAt: string | undefined, lastVisit: string | null): boolean => {
  if (!madeAt || lastVisit === null) return false;
  const made = Date.parse(madeAt);
  const seen = Date.parse(lastVisit);
  return Number.isFinite(made) && Number.isFinite(seen) && made > seen;
};

// ---------- whose day Home shows ----------

/** Home's "Today" shows the whole team's day or the owner's own: the choice is kept in this browser. */
export type DayView = 'team' | 'mine';
export const HOME_DAY_VIEW_KEY = 'slotbee-home-day-view';

/** The view chosen last. The team's day where nothing was chosen, and where nothing can be read. */
export function rememberedDayView(storage: Pick<Storage, 'getItem'> | null = browserStorage()): DayView {
  try { return storage?.getItem(HOME_DAY_VIEW_KEY) === 'mine' ? 'mine' : 'team'; } catch { return 'team'; }
}

export function rememberDayView(view: DayView, storage: Pick<Storage, 'setItem'> | null = browserStorage()): void {
  try { storage?.setItem(HOME_DAY_VIEW_KEY, view); } catch { /* The choice then holds for this visit only. */ }
}
