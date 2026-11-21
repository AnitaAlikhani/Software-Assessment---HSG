/**
 * One colour per stylist, the same wherever the calendar shows that person: on appointments,
 * in the legend, in the list.
 *
 * A colour belongs to a person by their place in the team list, so a filter never repaints the
 * people who stay on screen. There are eight colours. They are not cycled: a ninth person gets
 * the neutral grey, because a colour that two people share tells nobody apart.
 *
 * The order is not cosmetic. The first three (violet, green, blue) are the colours the calendar
 * has always used for the salon's three stylists; the order of all eight was chosen so that
 * neighbours stay apart for readers with red-green colour blindness (the first four in any
 * combination). Colour is never the only sign: an appointment's stylist is also in its
 * accessible name and its details, and the day view heads every column with the name.
 *
 * Text never wears the strong colour. It is a near-black of the same hue on a light fill, which
 * keeps small text readable (tests/staffColors.test.ts measures every pair).
 */
export interface StaffColor {
  name: string;
  /** The strong colour: the bar at the edge of an appointment and the dot in the legend. */
  accent: string;
  /** Behind an appointment's text. */
  fill: string;
  /** The text on `fill`. */
  ink: string;
  /** The same three for an appointment that is over: paler, still readable. */
  pastAccent: string;
  pastFill: string;
  pastInk: string;
}

export const STAFF_COLORS: readonly StaffColor[] = [
  { name: 'violet', accent: '#7c3aed', fill: '#ede9fe', ink: '#2e1065', pastAccent: '#c4b5fd', pastFill: '#f5f3ff', pastInk: '#6d28d9' },
  { name: 'green', accent: '#059669', fill: '#d1fae5', ink: '#022c22', pastAccent: '#6ee7b7', pastFill: '#ecfdf5', pastInk: '#047857' },
  { name: 'blue', accent: '#0284c7', fill: '#e0f2fe', ink: '#082f49', pastAccent: '#7dd3fc', pastFill: '#f0f9ff', pastInk: '#0369a1' },
  { name: 'amber', accent: '#b45309', fill: '#fef3c7', ink: '#451a03', pastAccent: '#fcd34d', pastFill: '#fffbeb', pastInk: '#92400e' },
  { name: 'pink', accent: '#ec4899', fill: '#fce7f3', ink: '#500724', pastAccent: '#f9a8d4', pastFill: '#fdf2f8', pastInk: '#be185d' },
  { name: 'lime', accent: '#65a30d', fill: '#ecfccb', ink: '#1a2e05', pastAccent: '#bef264', pastFill: '#f7fee7', pastInk: '#3f6212' },
  { name: 'cyan', accent: '#0891b2', fill: '#cffafe', ink: '#083344', pastAccent: '#67e8f9', pastFill: '#ecfeff', pastInk: '#0e7490' },
  { name: 'magenta', accent: '#a21caf', fill: '#fae8ff', ink: '#4a044e', pastAccent: '#f0abfc', pastFill: '#fdf4ff', pastInk: '#86198f' },
];

/** For a ninth person and for an appointment whose stylist is not in the team. */
export const NEUTRAL_STAFF_COLOR: StaffColor = {
  name: 'grey', accent: '#64748b', fill: '#f1f5f9', ink: '#0f172a', pastAccent: '#cbd5e1', pastFill: '#f8fafc', pastInk: '#475569',
};

/** How a person's initials are drawn in their colour, wherever the app shows them (Calendar, Team). */
export const staffAvatarStyle = (color: StaffColor): { backgroundColor: string; color: string; boxShadow: string } =>
  ({ backgroundColor: color.fill, color: color.ink, boxShadow: `inset 0 0 0 1.5px ${color.accent}` });

/** The colour of the person at this place in the team list (0 is the first). */
export const staffColorAt = (index: number): StaffColor => STAFF_COLORS[index] ?? NEUTRAL_STAFF_COLOR;

/** The colour of a person by id. Somebody who is not in the team list gets the neutral grey. */
export const staffColorFor = (employees: readonly { id: string }[], employeeId: string | undefined): StaffColor =>
  staffColorAt(employeeId === undefined ? -1 : employees.findIndex((employee) => employee.id === employeeId));
