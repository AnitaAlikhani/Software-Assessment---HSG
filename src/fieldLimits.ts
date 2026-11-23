import type { CompanySettingsData } from './types';

/**
 * The limits the server puts on the salon's settings (server/salon.ts, the checks of each part).
 * The forms use the same ones and say so before saving, so a save the form let through is not
 * refused by the server afterwards.
 */
export const TEXT_LIMITS = {
  /** The salon's, a service's, a person's (first and last), a closure's name; the town. */
  name: 120,
  street: 200,
  postalCode: 20,
  phone: 40,
  email: 254,
  salonDescription: 2000,
  serviceDescription: 1000,
  link: 500,
  terms: 20_000,
  absenceReason: 200,
} as const;

/** The highest price a service can have, in CHF. */
export const MAX_PRICE_CHF = 100_000;

/** The salon's details: which field, its name in a sentence, its limit. */
const SALON_TEXTS: Array<[keyof CompanySettingsData, string, number]> = [
  ['companyName', 'The company name', TEXT_LIMITS.name],
  ['street', 'The street', TEXT_LIMITS.street],
  ['postalCode', 'The postcode', TEXT_LIMITS.postalCode],
  ['city', 'The town', TEXT_LIMITS.name],
  ['businessPhone', 'The business phone', TEXT_LIMITS.phone],
  ['description', 'The description', TEXT_LIMITS.salonDescription],
  ['website', 'The website', TEXT_LIMITS.link],
  ['facebook', 'The Facebook page', TEXT_LIMITS.link],
  ['xProfile', 'The X profile', TEXT_LIMITS.link],
  ['instagram', 'The Instagram profile', TEXT_LIMITS.link],
  ['legalNote', 'The legal notice', TEXT_LIMITS.link],
  ['termsText', 'The terms', TEXT_LIMITS.terms],
];

/** The first of the salon's texts that is longer than the server takes, as a sentence; null when all fit. */
export function salonTextTooLong(settings: CompanySettingsData): string | null {
  for (const [field, label, limit] of SALON_TEXTS) {
    const value = settings[field];
    if (typeof value === 'string' && value.trim().length > limit) return `${label} can be at most ${String(limit).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} characters.`;
  }
  return null;
}
