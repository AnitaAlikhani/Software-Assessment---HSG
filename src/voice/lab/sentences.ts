import type { KeyItem, LabSentence } from './score';

/**
 * What people read aloud in the voice check, and the details that have to arrive.
 *
 * The sentences are what an owner says on the phone while repeating a customer's wish: a day, a
 * time, a service, a name. Each language has the ways of saying a time that matter there
 * ("half past ten", "halb elf"). The names are the salon's team and one customer.
 *
 * Every spelling is tested against the simplified text (score.ts): lower case, no punctuation,
 * "ß" written "ss". So "Färben" is "färben" here, "dreißig" is "dreissig" and "p.m." is "pm".
 * A date such as "27/11" arrives as "27 11", because the stroke is punctuation.
 */

export type LabLanguage = 'en' | 'de';

export interface LabLocale {
  /** What the browser's speech recognition is told, for example "de-CH". */
  code: string;
  label: string;
}

export interface LabLanguagePack {
  name: string;
  /** The first one is used unless the person picks another. */
  locales: LabLocale[];
  sentences: LabSentence[];
  /** A short call, the owner's side only, read in one go with pauses. */
  talk: { lines: string[]; keys: KeyItem[] };
  /** Names and services the engine is asked to favour, where the browser can do that. */
  boost: string[];
}

const key = (label: string, ...accept: RegExp[]): KeyItem => ({ label, accept });

const EN: LabLanguagePack = {
  name: 'English',
  locales: [
    { code: 'en-GB', label: 'English (United Kingdom)' },
    { code: 'en-US', label: 'English (United States)' },
  ],
  sentences: [
    {
      id: 'en-01',
      text: 'Do we have anything free on Thursday at three pm?',
      keys: [key('Thursday', /\bthursday\b/), key('15:00', /\b(3|three)([:.]00)? ?pm\b/, /\b15[:.]00\b/)],
    },
    {
      id: 'en-02',
      text: 'A haircut on Friday the twenty-seventh of November at half past ten.',
      keys: [
        key('Haircut', /\bhair ?cut\b/),
        key('Friday', /\bfriday\b/),
        key('27 November', /\b(27(th)?|twenty seventh)( of)? november\b/, /\bnovember (the )?(27(th)?|twenty seventh)\b/, /\b27[. ]11\b/),
        key('10:30', /\bhalf past (10|ten)\b/, /\b10[:. ]30\b/, /\b(10|ten) thirty\b/),
      ],
    },
    {
      id: 'en-03',
      text: 'Tomorrow morning at nine fifteen for a colouring.',
      keys: [
        key('Tomorrow', /\btomorrow\b/),
        key('Morning', /\bmorning\b/),
        key('09:15', /\b0?9[:. ]15\b/, /\b(9|nine) fifteen\b/, /\bquarter past (9|nine)\b/),
        key('Colouring', /\bcolou?r(ing)?\b/),
      ],
    },
    {
      id: 'en-04',
      text: 'Next Tuesday at quarter to four with Selina.',
      keys: [
        key('Next Tuesday', /\bnext tuesday\b/),
        key('15:45', /\bquarter to (4|four)\b/, /\b(0?3|15)[:. ]45\b/, /\b(3|three) forty ?five\b/),
        key('Selina', /\bselina\b/),
      ],
    },
    {
      id: 'en-05',
      text: 'Is Luca free on Saturday afternoon?',
      keys: [key('Luca', /\bluca\b/), key('Saturday', /\bsaturday\b/), key('Afternoon', /\bafternoon\b/)],
    },
    {
      id: 'en-06',
      text: 'The customer is Lea Brunner.',
      keys: [key('Lea', /\blea\b/), key('Brunner', /\bbrunner\b/)],
    },
    {
      id: 'en-07',
      text: 'Her phone number is 078 555 27 40.',
      keys: [{ label: '078 555 27 40', digits: '0785552740' }],
    },
    {
      id: 'en-08',
      text: 'Move Lea Brunner from Thursday to Friday at eleven.',
      keys: [
        key('Move', /\bmove\b/),
        key('Lea Brunner', /\blea brunner\b/),
        key('Thursday', /\bthursday\b/),
        key('Friday', /\bfriday\b/),
        key('11:00', /\b(11|eleven)\b/),
      ],
    },
    {
      id: 'en-09',
      text: 'Cancel the appointment on the second of December.',
      keys: [
        key('Cancel', /\bcancel\b/),
        key('2 December', /\b(2(nd)?|second)( of)? december\b/, /\bdecember (the )?(2(nd)?|second)\b/, /\b0?2[. ]12\b/),
      ],
    },
    {
      id: 'en-10',
      text: 'Confirm booking.',
      keys: [key('Confirm booking', /\bconfirm booking\b/)],
    },
    {
      id: 'en-11',
      text: 'No, not Thursday, Friday at two thirty.',
      keys: [key('Friday', /\bfriday\b/), key('14:30', /\b(2|two) thirty\b/, /\b(0?2|14)[:. ]30\b/, /\bhalf past (2|two)\b/)],
    },
    {
      id: 'en-12',
      text: 'Yes, of course, no problem, one moment please.',
      keys: [],
    },
  ],
  talk: {
    lines: [
      'Bella Hair Salon, good morning.',
      'A haircut, sure.',
      'Thursday the twenty-sixth at three in the afternoon? One moment, let me check.',
      'Three is taken, but I can offer you three thirty.',
      'Perfect, three thirty on Thursday. And your name, please?',
      'Lea Brunner. Thank you.',
      'Confirm booking.',
    ],
    keys: [
      key('Haircut', /\bhair ?cut\b/),
      key('Thursday', /\bthursday\b/),
      key('The 26th', /\b(26(th)?|twenty sixth)\b/),
      key('15:00', /\b(3|three)([:.]00)? ?(pm|in the afternoon)\b/, /\b15[:.]00\b/),
      key('15:30', /\b(3|three) thirty\b/, /\b(0?3|15)[:. ]30\b/, /\bhalf past (3|three)\b/),
      key('Lea Brunner', /\blea brunner\b/),
      key('Confirm booking', /\bconfirm booking\b/),
    ],
  },
  boost: ['Selina', 'Luca', 'Lea Brunner', 'haircut', 'colouring', 'confirm booking'],
};

const DE: LabLanguagePack = {
  name: 'German',
  locales: [
    { code: 'de-CH', label: 'Deutsch (Schweiz)' },
    { code: 'de-DE', label: 'Deutsch (Deutschland)' },
  ],
  sentences: [
    {
      id: 'de-01',
      text: 'Haben wir am Donnerstag um fünfzehn Uhr noch etwas frei?',
      keys: [key('Donnerstag', /\bdonnerstag\b/), key('15:00', /\b(15|fünfzehn)([:.]00)? uhr\b/, /\b15[:.]00\b/)],
    },
    {
      id: 'de-02',
      text: 'Ein Haarschnitt am Freitag, dem siebenundzwanzigsten November, um halb elf.',
      keys: [
        key('Haarschnitt', /\bhaarschnitt\b/),
        key('Freitag', /\bfreitag\b/),
        key('27. November', /\b(27|siebenundzwanzigste[nr]?) november\b/, /\b27[. ]11\b/),
        key('10:30', /\bhalb (11|elf)\b/, /\b10[:.]30\b/, /\b(10|zehn) uhr (30|dreissig)\b/),
      ],
    },
    {
      id: 'de-03',
      text: 'Morgen Vormittag um Viertel nach neun zum Färben.',
      keys: [
        key('Morgen', /\bmorgen\b/),
        key('Vormittag', /\bvormittag\b/),
        key('09:15', /\bviertel nach (9|neun)\b/, /\b0?9[:.]15\b/, /\b(9|neun) uhr (15|fünfzehn)\b/),
        key('Färben', /\bfärben\b/),
      ],
    },
    {
      id: 'de-04',
      text: 'Nächsten Dienstag um Viertel vor vier bei Selina.',
      keys: [
        key('Nächsten Dienstag', /\bnächsten dienstag\b/),
        key('15:45', /\bviertel vor (4|vier)\b/, /\b(0?3|15)[:.]45\b/, /\b(3|drei|15|fünfzehn) uhr (45|fünfundvierzig)\b/),
        key('Selina', /\bselina\b/),
      ],
    },
    {
      id: 'de-05',
      text: 'Ist Luca am Samstagnachmittag frei?',
      keys: [key('Luca', /\bluca\b/), key('Samstag', /\bsamstag/), key('Nachmittag', /nachmittag\b/)],
    },
    {
      id: 'de-06',
      text: 'Die Kundin heisst Lea Brunner.',
      keys: [key('Lea', /\blea\b/), key('Brunner', /\bbrunner\b/)],
    },
    {
      id: 'de-07',
      text: 'Ihre Telefonnummer ist 078 555 27 40.',
      keys: [{ label: '078 555 27 40', digits: '0785552740' }],
    },
    {
      id: 'de-08',
      text: 'Lea Brunner von Donnerstag auf Freitag um elf Uhr verschieben.',
      keys: [
        key('Verschieben', /\bverschieben\b/),
        key('Lea Brunner', /\blea brunner\b/),
        key('Donnerstag', /\bdonnerstag\b/),
        key('Freitag', /\bfreitag\b/),
        key('11:00', /\b(11|elf)([:.]00)? uhr\b/, /\b11[:.]00\b/),
      ],
    },
    {
      id: 'de-09',
      text: 'Den Termin am zweiten Dezember absagen.',
      keys: [key('Absagen', /\babsagen\b/), key('2. Dezember', /\b(2|zweite[nr]?) dezember\b/, /\b0?2[. ]12\b/)],
    },
    {
      id: 'de-10',
      text: 'Buchung bestätigen.',
      keys: [key('Buchung bestätigen', /\bbuchung bestätigen\b/)],
    },
    {
      id: 'de-11',
      text: 'Nein, nicht Donnerstag, Freitag um halb drei.',
      keys: [key('Freitag', /\bfreitag\b/), key('14:30', /\bhalb (3|drei)\b/, /\b(0?2|14)[:.]30\b/, /\b(2|zwei|14|vierzehn) uhr (30|dreissig)\b/)],
    },
    {
      id: 'de-12',
      text: 'Ja, natürlich, kein Problem, einen Moment bitte.',
      keys: [],
    },
  ],
  talk: {
    lines: [
      'Bella Hair Salon, guten Morgen.',
      'Ein Haarschnitt, gern.',
      'Donnerstag, der sechsundzwanzigste, um fünfzehn Uhr? Einen Moment, ich schaue nach.',
      'Um fünfzehn Uhr ist besetzt, ich kann Ihnen halb vier anbieten.',
      'Perfekt, Donnerstag um halb vier. Und Ihr Name, bitte?',
      'Lea Brunner. Danke.',
      'Buchung bestätigen.',
    ],
    keys: [
      key('Haarschnitt', /\bhaarschnitt\b/),
      key('Donnerstag', /\bdonnerstag\b/),
      key('Der 26.', /\b(26|sechsundzwanzigste[nr]?)\b/),
      key('15:00', /\b(15|fünfzehn)([:.]00)? uhr\b/, /\b15[:.]00\b/),
      key('15:30', /\bhalb (4|vier)\b/, /\b(0?3|15)[:.]30\b/, /\b(3|drei|15|fünfzehn) uhr (30|dreissig)\b/),
      key('Lea Brunner', /\blea brunner\b/),
      key('Buchung bestätigen', /\bbuchung bestätigen\b/),
    ],
  },
  boost: ['Selina', 'Luca', 'Lea Brunner', 'Haarschnitt', 'Färben', 'Buchung bestätigen'],
};

export const LAB_LANGUAGES: Record<LabLanguage, LabLanguagePack> = { en: EN, de: DE };
