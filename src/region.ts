import type { CompanySettingsData } from './types';

/**
 * The launch market: Switzerland and Liechtenstein. Both pay in Swiss francs and share one
 * clock, so Company Settings offers these two countries and no choice of currency or time zone.
 */
export const COUNTRIES = ['Switzerland', 'Liechtenstein'] as const;
export type Country = typeof COUNTRIES[number];

/** The time zone of every salon in the launch market. Liechtenstein keeps Swiss time. */
export const SALON_TIME_ZONE = 'Europe/Zurich';

/** The country a stored setting names; anything else (a setting saved before the market was narrowed) counts as Switzerland. */
export const countryOf = (value: string | undefined): Country =>
  (COUNTRIES as readonly string[]).includes(value ?? '') ? value as Country : 'Switzerland';

export interface Canton {
  /** The two letters on number plates and in addresses. This is what the settings store. */
  code: string;
  /** The name in English, as the interface shows it. */
  name: string;
  /** How the canton or its main town is written in the country's own languages. */
  also: readonly string[];
}

/** The 26 cantons, in the order of their English names. */
export const CANTONS: readonly Canton[] = [
  { code: 'AG', name: 'Aargau', also: ['Argovie', 'Argovia'] },
  { code: 'AR', name: 'Appenzell Ausserrhoden', also: ['Appenzell Rhodes-Extérieures'] },
  { code: 'AI', name: 'Appenzell Innerrhoden', also: ['Appenzell Rhodes-Intérieures'] },
  { code: 'BL', name: 'Basel-Landschaft', also: ['Baselland', 'Bâle-Campagne'] },
  { code: 'BS', name: 'Basel-Stadt', also: ['Bâle-Ville', 'Basilea'] },
  { code: 'BE', name: 'Bern', also: ['Berne', 'Berna'] },
  { code: 'FR', name: 'Fribourg', also: ['Freiburg', 'Friburgo'] },
  { code: 'GE', name: 'Geneva', also: ['Genève', 'Genf', 'Ginevra'] },
  { code: 'GL', name: 'Glarus', also: ['Glaris', 'Glarona'] },
  { code: 'GR', name: 'Graubünden', also: ['Grisons', 'Grigioni', 'Grischun'] },
  { code: 'JU', name: 'Jura', also: ['Giura'] },
  { code: 'LU', name: 'Lucerne', also: ['Luzern', 'Lucerna'] },
  { code: 'NE', name: 'Neuchâtel', also: ['Neuenburg'] },
  { code: 'NW', name: 'Nidwalden', also: ['Nidwald'] },
  { code: 'OW', name: 'Obwalden', also: ['Obwald'] },
  { code: 'SH', name: 'Schaffhausen', also: ['Schaffhouse', 'Sciaffusa'] },
  { code: 'SZ', name: 'Schwyz', also: ['Svitto'] },
  { code: 'SO', name: 'Solothurn', also: ['Soleure', 'Soletta'] },
  { code: 'SG', name: 'St. Gallen', also: ['Sankt Gallen', 'Saint-Gall', 'San Gallo'] },
  { code: 'TG', name: 'Thurgau', also: ['Thurgovie', 'Turgovia'] },
  { code: 'TI', name: 'Ticino', also: ['Tessin'] },
  { code: 'UR', name: 'Uri', also: [] },
  { code: 'VS', name: 'Valais', also: ['Wallis', 'Vallese'] },
  { code: 'VD', name: 'Vaud', also: ['Waadt'] },
  { code: 'ZG', name: 'Zug', also: ['Zoug', 'Zugo'] },
  { code: 'ZH', name: 'Zurich', also: ['Zürich', 'Zurigo'] },
];

/**
 * What Company Settings stores about the region when the owner saves: one of the two countries,
 * the canton only where there are cantons, and the market's one time zone as a plain id.
 */
export function regionToSave(country: string | undefined, canton: string | undefined): Pick<CompanySettingsData, 'country' | 'canton' | 'timeZone'> {
  const market = countryOf(country);
  const known = CANTONS.some((item) => item.code === canton);
  return { country: market, canton: market === 'Switzerland' && known ? canton : '', timeZone: SALON_TIME_ZONE };
}

/** Letters only, without accents: "St. Gallen" and "st.gallen" both give "stgallen". */
const plain = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');

/**
 * A town with the letters of its canton, as Swiss place names are written where the town alone
 * does not say it: "Wil SG", "Buchs AG". A town that carries its canton's name ("St. Gallen",
 * "Basel", "Genève") stays as it is, and so does any town in Liechtenstein.
 */
export function townWithCanton(city: string, canton: string | undefined, country: string | undefined): string {
  const town = city.trim();
  const entry = countryOf(country) === 'Switzerland' ? CANTONS.find((item) => item.code === canton) : undefined;
  if (!town || !entry) return town;
  const key = plain(town);
  const namesake = [entry.name, ...entry.also].map(plain).some((name) => key.startsWith(name) || name.startsWith(key));
  return namesake ? town : `${town} ${entry.code}`;
}

/** The salon's address in one line, as customers read it: "Tuchgasse 7, 9000 St. Gallen, Switzerland". */
export function salonAddress(settings: Pick<CompanySettingsData, 'street' | 'postalCode' | 'city' | 'canton' | 'country'>): string {
  const town = townWithCanton(settings.city, settings.canton, settings.country);
  return [settings.street, [settings.postalCode, town].filter(Boolean).join(' '), settings.country].filter(Boolean).join(', ');
}
