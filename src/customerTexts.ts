import type { CalendarEvent, ChatLanguage } from './types.js';
import { formatDate } from './format.js';
import { dayKeyForDate } from './scheduling.js';

/**
 * The ready texts for a customer whose booking request the owner has answered.
 *
 * Nothing in the app tells a customer who booked on the booking page that the request was
 * accepted, moved or rejected. The owner does that herself, by phone or by message. Home offers
 * these sentences to copy, so that she does not have to write them: in the customer's language,
 * with the salon's name, the service, the day and the time.
 *
 * They are fixed sentences, not written by the AI: the owner passes them on under her own name
 * and must be able to rely on every word. So a text about a move says that the time asked for is
 * not possible, and no more: why, only the owner knows. The address is the polite one (Sie, vous,
 * Lei) with the name as the customer gave it, because the app knows no title. German uses the
 * Swiss spelling (ss, no ß). Dates and times are written as on every screen.
 */

export type AnswerOutcome = 'accepted' | 'moved' | 'rejected';

interface AnswerTextBase {
  language: ChatLanguage;
  customerName: string;
  /** The salon's name from Settings. Left out of the sentence when it is empty. */
  salonName: string;
  serviceName: string;
  /** Left out when the request names nobody. */
  staffName?: string;
  /** The time the text is about: the confirmed one, the new one after a move, or the refused one. */
  date: string;
  startTime: string;
}

/** What a text is written from. A text about a move also names the time the customer had asked for. */
export type AnswerTextDetails = AnswerTextBase & (
  | { outcome: 'accepted' | 'rejected' }
  | { outcome: 'moved'; askedDate: string; askedStartTime: string }
);

type DayKey = CalendarEvent['day'];

// French and Italian weekdays, by the day key the calendar uses. English and German names come
// from format.ts, which has no French or Italian yet.
const WEEKDAYS: Record<'FR' | 'IT', Record<DayKey, string>> = {
  FR: { mon: 'lundi', tue: 'mardi', wed: 'mercredi', thu: 'jeudi', fri: 'vendredi', sat: 'samedi', sun: 'dimanche' },
  IT: { mon: 'lunedì', tue: 'martedì', wed: 'mercoledì', thu: 'giovedì', fri: 'venerdì', sat: 'sabato', sun: 'domenica' },
};

/** "Friday, 20.11.2026", "Freitag, 20.11.2026", "vendredi 20.11.2026", "venerdì 20.11.2026". */
function dayIn(language: ChatLanguage, date: string): string {
  if (language === 'EN') return formatDate(date, { weekday: 'long' });
  if (language === 'DE') return formatDate(date, { weekday: 'long', locale: 'de-CH' });
  const numeric = formatDate(date, { weekday: 'none' });
  // Anything that is no date comes back unchanged from format.ts: then there is no weekday to name.
  return numeric === date ? date : `${WEEKDAYS[language][dayKeyForDate(date)]} ${numeric}`;
}

interface Words {
  name: string;
  /** " at Bella Hair Salon", or nothing when the salon has no name. */
  salon: string;
  service: string;
  /** " with Selina Keller", or nothing. */
  staff: string;
  day: string;
  time: string;
  askedDay: string;
  askedTime: string;
}

// In French a thin gap stands before ":", "!" and "?". It is written as a no-break space, so the
// sign never starts a line of its own.
const GAP = ' ';

const SENTENCES: Record<ChatLanguage, {
  salon: (name: string) => string;
  staff: (name: string) => string;
} & Record<AnswerOutcome, (words: Words) => string>> = {
  EN: {
    salon: name => ` at ${name}`,
    staff: name => ` with ${name}`,
    accepted: w => `Hello ${w.name}, your appointment${w.salon} is confirmed: ${w.service} on ${w.day} at ${w.time}${w.staff}. See you then!`,
    moved: w => `Hello ${w.name}, thank you for your booking request${w.salon}. Unfortunately ${w.askedDay} at ${w.askedTime} is not possible. We can offer you ${w.service} on ${w.day} at ${w.time}${w.staff} instead. Does that suit you?`,
    rejected: w => `Hello ${w.name}, thank you for your booking request${w.salon}. Unfortunately we cannot offer you ${w.service} on ${w.day} at ${w.time}. Please get in touch to find another time.`,
  },
  DE: {
    salon: name => ` bei ${name}`,
    // "mit", not "bei": the salon's name already takes "bei" in the same sentence.
    staff: name => ` mit ${name}`,
    accepted: w => `Guten Tag ${w.name}, Ihr Termin${w.salon} ist bestätigt: ${w.service} am ${w.day} um ${w.time} Uhr${w.staff}. Wir freuen uns auf Sie!`,
    moved: w => `Guten Tag ${w.name}, vielen Dank für Ihre Terminanfrage${w.salon}. Leider ist der Termin am ${w.askedDay} um ${w.askedTime} Uhr nicht möglich. Wir können Ihnen ${w.service} am ${w.day} um ${w.time} Uhr${w.staff} anbieten. Passt Ihnen das?`,
    rejected: w => `Guten Tag ${w.name}, vielen Dank für Ihre Terminanfrage${w.salon}. Leider können wir Ihnen ${w.service} am ${w.day} um ${w.time} Uhr nicht anbieten. Bitte melden Sie sich, damit wir einen anderen Termin finden.`,
  },
  FR: {
    salon: name => ` chez ${name}`,
    staff: name => ` avec ${name}`,
    accepted: w => `Bonjour ${w.name}, votre rendez-vous${w.salon} est confirmé${GAP}: ${w.service}, le ${w.day} à ${w.time}${w.staff}. À bientôt${GAP}!`,
    moved: w => `Bonjour ${w.name}, merci pour votre demande de rendez-vous${w.salon}. Malheureusement, le rendez-vous du ${w.askedDay} à ${w.askedTime} n'est pas possible. Nous pouvons vous proposer ${w.service} le ${w.day} à ${w.time}${w.staff}. Est-ce que cela vous convient${GAP}?`,
    rejected: w => `Bonjour ${w.name}, merci pour votre demande de rendez-vous${w.salon}. Malheureusement, nous ne pouvons pas vous proposer ${w.service} le ${w.day} à ${w.time}. N'hésitez pas à nous contacter pour trouver une autre date.`,
  },
  IT: {
    salon: name => ` presso ${name}`,
    staff: name => ` con ${name}`,
    accepted: w => `Buongiorno ${w.name}, il Suo appuntamento${w.salon} è confermato: ${w.service}, ${w.day} alle ${w.time}${w.staff}. A presto!`,
    moved: w => `Buongiorno ${w.name}, grazie per la Sua richiesta di appuntamento${w.salon}. Purtroppo ${w.askedDay} alle ${w.askedTime} non è possibile. Possiamo proporLe ${w.service} ${w.day} alle ${w.time}${w.staff}. Le va bene?`,
    rejected: w => `Buongiorno ${w.name}, grazie per la Sua richiesta di appuntamento${w.salon}. Purtroppo non possiamo offrirLe ${w.service} ${w.day} alle ${w.time}. Ci contatti pure per trovare un'altra data.`,
  },
};

// An appointment that is cancelled: its own short table, because it is said about an appointment,
// not in answer to a request.
const CANCELLED: Record<ChatLanguage, (words: Pick<Words, 'name' | 'salon' | 'day' | 'time'>) => string> = {
  EN: w => `Hello ${w.name}, your appointment${w.salon} on ${w.day} at ${w.time} is cancelled. Get in touch whenever you would like a new one.`,
  DE: w => `Guten Tag ${w.name}, Ihr Termin${w.salon} am ${w.day} um ${w.time} Uhr ist abgesagt. Melden Sie sich gern, wenn Sie einen neuen Termin möchten.`,
  FR: w => `Bonjour ${w.name}, votre rendez-vous${w.salon} du ${w.day} à ${w.time} est annulé. N'hésitez pas à nous contacter pour un nouveau rendez-vous.`,
  IT: w => `Buongiorno ${w.name}, il Suo appuntamento${w.salon} di ${w.day} alle ${w.time} è annullato. Ci contatti pure per un nuovo appuntamento.`,
};

/** The sentence that tells a customer that their appointment is cancelled. */
export function cancelledText(details: Pick<AnswerTextBase, 'language' | 'customerName' | 'salonName' | 'date' | 'startTime'>): string {
  const language: ChatLanguage = SENTENCES[details.language] ? details.language : 'EN';
  const salonName = details.salonName.trim();
  return CANCELLED[language]({
    name: details.customerName.trim(), salon: salonName ? SENTENCES[language].salon(salonName) : '',
    day: dayIn(language, details.date), time: details.startTime,
  });
}

/** The sentence for the customer: the appointment is confirmed, another time is offered, or the request cannot be met. */
export function answerText(details: AnswerTextDetails): string {
  // A record can hold a language the texts do not know (a tab stored long ago): English then.
  const language: ChatLanguage = SENTENCES[details.language] ? details.language : 'EN';
  const sentences = SENTENCES[language];
  const salonName = details.salonName.trim();
  const staffName = details.staffName?.trim() ?? '';
  const asked = details.outcome === 'moved' ? { date: details.askedDate, startTime: details.askedStartTime } : details;
  return sentences[details.outcome]({
    name: details.customerName.trim(),
    salon: salonName ? sentences.salon(salonName) : '',
    service: details.serviceName.trim(),
    staff: staffName ? sentences.staff(staffName) : '',
    day: dayIn(language, details.date),
    time: details.startTime,
    askedDay: dayIn(language, asked.date),
    askedTime: asked.startTime,
  });
}
