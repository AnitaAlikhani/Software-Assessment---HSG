import type { AssistantLanguage } from './types';

/**
 * The booking rules (src/availability.ts) word their refusals in English. The assistant passes a
 * refusal on in the owner's language: in English as the rules say it, in German from this list.
 *
 * The list has a line for every refusal the rules can give for an appointment. A test reads the
 * rules' own texts and fails when one has no German wording here, so a new refusal cannot reach
 * a German reply in English.
 */
const GERMAN: Record<string, string> = {
  'Enter a customer name.': 'Bitte gib einen Kundennamen ein.',
  'This service no longer exists. Please choose another service.': 'Diese Dienstleistung gibt es nicht mehr. Bitte wähle eine andere.',
  'Choose an active employee for this appointment.': 'Bitte wähle für diesen Termin jemanden aus dem Team, der aktiv ist.',
  'Choose a valid appointment date.': 'Bitte wähle ein gültiges Datum für den Termin.',
  'Choose today or a future appointment date.': 'Bitte wähle heute oder einen späteren Tag.',
  'This service is not available for online booking.': 'Diese Dienstleistung kann nicht online gebucht werden.',
  'This service has an invalid duration or preparation time. Please update the service.': 'Die Dauer oder die Vorbereitungszeit dieser Dienstleistung ist ungültig. Bitte korrigiere sie unter Services.',
  'This employee is not available. Please choose an active employee.': 'Diese Person ist nicht verfügbar. Bitte wähle jemanden aus dem Team, der aktiv ist.',
  'This employee is not available for online booking.': 'Diese Person kann nicht online gebucht werden.',
  'This employee does not provide the selected service.': 'Diese Person bietet die gewählte Dienstleistung nicht an.',
  'The salon is closed on this date. Please choose another date.': 'An diesem Tag ist der Salon geschlossen. Bitte wähle einen anderen Tag.',
  'This employee is away on this date. Please choose another date or specialist.': 'Diese Person ist an diesem Tag abwesend. Bitte wähle einen anderen Tag oder jemand anderen.',
  'The salon is closed on this date.': 'An diesem Tag ist der Salon geschlossen.',
  // "Shift" in the rules' wording means the hours a person works on a date: their regular hours
  // of that weekday, or what was entered for that one day (src/workingHours.ts).
  'This employee does not work on this date.': 'Diese Person arbeitet an diesem Tag nicht.',
  'This employee’s working hours on this date are invalid.': 'Die Arbeitszeit dieser Person an diesem Tag ist ungültig.',
  'The salon opening hours are invalid for this date.': 'Die Öffnungszeiten des Salons für diesen Tag sind ungültig.',
  'This employee has no working time during the salon opening hours.': 'Diese Person arbeitet an diesem Tag nicht während der Öffnungszeiten des Salons.',
  'This employee has an appointment with invalid times. Please review the calendar.': 'Bei dieser Person ist ein Termin mit ungültigen Zeiten eingetragen. Bitte prüfe den Kalender.',
  'This employee has a pending request with invalid times. Please review the request.': 'Bei dieser Person wartet eine Anfrage mit ungültigen Zeiten. Bitte prüfe die Anfrage.',
  'This time is not available. Choose a time within the employee’s working hours and the opening hours, without overlapping another booking.':
    'Diese Zeit ist nicht verfügbar. Bitte wähle eine Zeit innerhalb der Arbeitszeit und der Öffnungszeiten, die sich mit keinem anderen Termin überschneidet.',
};
/** The one refusal that carries a number: the length of the service. */
const SLOT_LENGTH = /^Choose a valid (\d+)-minute slot on the same day\.$/;

/** Said in a German reply when the rules give a refusal this file does not know. Never the English text. */
export const UNKNOWN_REFUSAL_DE = 'Die Buchungsregeln lassen diesen Termin so nicht zu.';

/** The rules' refusal in the language of the reply. */
export function refusalIn(refusal: string, language: AssistantLanguage): string {
  if (language !== 'de') return refusal;
  const minutes = SLOT_LENGTH.exec(refusal);
  if (minutes) return `Bitte wähle eine gültige Zeit von ${minutes[1]} Minuten am selben Tag.`;
  return GERMAN[refusal] ?? UNKNOWN_REFUSAL_DE;
}
