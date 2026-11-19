import React from 'react';
import { PRODUCT_NAME } from '../brand';

// The two shapes of the mark on a 32 x 32 grid. public/favicon.svg holds the same drawing for
// the browser tab and the app icons: change both together (tests/brand.test.ts compares them).
export const MARK_CELL = 'M13.2 2.6Q16 1 18.8 2.6L26.2 6.9Q29 8.5 29 11.7V20.3Q29 23.5 26.2 25.1L18.8 29.4Q16 31 13.2 29.4L5.8 25.1Q3 23.5 3 20.3V11.7Q3 8.5 5.8 6.9Z';
export const MARK_CHECK = 'M9.9 16.5l4.2 4.2 8-8.9';

interface LogoMarkProps {
  /** Size and spacing. The mark is square. */
  className?: string;
}

/**
 * The SlotBee mark: one cell of a honeycomb with a check in it, a slot that is taken.
 * The cell has the product's indigo. The honey of the check is reserved for this mark:
 * nothing else in the interface uses that colour token.
 */
export const LogoMark: React.FC<LogoMarkProps> = ({ className = 'h-7 w-7' }) => (
  <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
    <path className="fill-brand" d={MARK_CELL} />
    <path className="stroke-honey" fill="none" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d={MARK_CHECK} />
  </svg>
);

// Two sizes, so a place that is short of room never has to fight the default classes.
const LOGO_SIZES = {
  /** The menu on laptops. */
  regular: { gap: 'gap-2', name: 'text-lg' },
  /** The top bar on phones and tablets. There the mark stands alone: the name of the screen takes the place of the written name. */
  compact: { gap: 'gap-1.5', name: 'text-base' },
};

interface LogoProps {
  size?: keyof typeof LOGO_SIZES;
  /** Where the logo shows and how it sits in its row. */
  className?: string;
  /** When the written name shows. A narrow place can hide the name and keep the mark. */
  nameClassName?: string;
}

/**
 * Mark and name together. To a screen reader the logo is one image called by the product's
 * name, also where the written name is hidden for lack of room.
 */
export const Logo: React.FC<LogoProps> = ({ size = 'regular', className = '', nameClassName = '' }) => (
  <span role="img" aria-label={PRODUCT_NAME} className={`inline-flex items-center ${LOGO_SIZES[size].gap} ${className}`}>
    <LogoMark />
    <span className={`${LOGO_SIZES[size].name} font-extrabold leading-none tracking-tight text-slate-900 ${nameClassName}`}>{PRODUCT_NAME}</span>
  </span>
);

/**
 * The one line that names the product on a salon's customer pages (booking page, chat).
 * Plain text on purpose: a link would be a way from the salon's page into the owner's app.
 */
export const PoweredBy: React.FC<{ className?: string }> = ({ className = '' }) => (
  // Small, but dark enough to read on the page background and on the chat's input bar.
  <p className={`flex items-center justify-center gap-1.5 text-[11px] leading-4 text-slate-600 ${className}`}>
    <LogoMark className="h-3.5 w-3.5" />
    <span>Powered by <span className="font-semibold">{PRODUCT_NAME}</span></span>
  </p>
);
