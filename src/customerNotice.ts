import type { ChatLanguage } from './types.js';

/**
 * What the chat tells customers about their data, in one place.
 *
 * The storage (server/store.ts) takes its period from here and every text prints the same
 * number, so the stated period and the real one cannot drift apart.
 *
 * A chat is deleted this many days after its last activity. Every new message, reply or owner
 * action starts the period again; a chat nobody touches is gone after it.
 */
export const CHAT_RETENTION_DAYS = 14;

/**
 * The website chat promises "You can delete your chat at any time". "New chat" leaves the chat
 * before it at the salon until its period is over, so the device has to be able to reach that
 * one too. For that it remembers the ids of its earlier chats, and "Delete chat" deletes this
 * chat and those. What the device keeps is as little as that takes:
 * - ids only (a random string each), never a message or a name;
 * - at most MAX_EARLIER_CHATS of them: with that many set aside, a new chat is only offered after
 *   "Delete chat", so no chat is ever pushed off the list while the salon still has it;
 * - each for the retention period. When that is over the chat is normally gone at the salon and
 *   the id is dropped. The salon's own activity can keep a chat alive for longer, so the device
 *   asks before it drops the id (see settleEarlierChats) and never forgets a chat that still exists.
 */
export const MAX_EARLIER_CHATS = 10;

export interface EarlierChat {
  id: string;
  /** Epoch ms. Until then the id is kept without asking; from then on the salon is asked whether the chat still exists. */
  until: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = CHAT_RETENTION_DAYS * DAY_MS;
/** The same form the chat route accepts for a session id. */
const isChatId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9]{12,40}$/.test(value);

/** The list as the device stored it. Whatever is not an id with a time is dropped. */
export function parseEarlierChats(stored: string | null): EarlierChat[] {
  if (!stored) return [];
  try {
    const list: unknown = JSON.parse(stored);
    if (!Array.isArray(list)) return [];
    const chats: EarlierChat[] = [];
    for (const entry of list as { id?: unknown; until?: unknown }[]) {
      if (!isChatId(entry?.id) || typeof entry.until !== 'number' || !Number.isFinite(entry.until)) continue;
      if (!chats.some(chat => chat.id === entry.id)) chats.push({ id: entry.id, until: entry.until });
    }
    return chats.slice(0, MAX_EARLIER_CHATS);
  } catch {
    return [];
  }
}

/**
 * The list after "New chat" set the chat `id` aside at the time `now`. Null when the list is
 * full: then no further chat may be set aside, because its id could not be remembered.
 */
export function rememberEarlierChat(list: EarlierChat[], id: string, now: number): EarlierChat[] | null {
  if (!isChatId(id)) return list;
  const others = list.filter(chat => chat.id !== id);
  if (others.length >= MAX_EARLIER_CHATS) return null;
  return [...others, { id, until: now + RETENTION_MS }];
}

/**
 * The chats "Delete chat" removes, in the order it asks the salon: the earlier ones first, the
 * chat on screen last. If a request fails on the way, the chat on screen is still there with its
 * menu, so the customer can try again.
 */
export const chatsToDelete = (list: EarlierChat[], current: string): string[] =>
  [...list.map(chat => chat.id).filter(id => id !== current), current];

/** The remembered chats whose period is over: the device asks the salon whether they still exist. */
export const dueEarlierChats = (list: EarlierChat[], now: number): EarlierChat[] => list.filter(chat => chat.until <= now);

/**
 * The list after the salon was asked about the chats that were due.
 * - 'gone': the salon no longer has the chat, so the id is dropped.
 * - 'kept': the salon still has it (somebody wrote in it later), so it is asked about again tomorrow.
 * - no answer: kept for now. After a second period without any answer the id is dropped, because
 *   a chat nobody can be asked about could not be deleted from here either.
 */
export function settleEarlierChats(list: EarlierChat[], answers: Record<string, 'gone' | 'kept' | undefined>, now: number): EarlierChat[] {
  return list.flatMap((chat): EarlierChat[] => {
    if (chat.until > now) return [chat];
    const answer = answers[chat.id];
    if (answer === 'gone') return [];
    if (answer === 'kept') return [{ id: chat.id, until: now + DAY_MS }];
    return now - chat.until > RETENTION_MS ? [] : [chat];
  });
}

/** The salon's chat on a messenger app. The website chat shows its notice on its start screen. */
export type MessengerChannel = 'Telegram' | 'WhatsApp';

export interface NoticeOptions {
  /** The salon's name from Company Settings. */
  salon: string;
  /** Study wording for research participants (RESEARCH_MODE on the server). */
  study?: boolean;
  /** The product name, only printed in the study wording. */
  product?: string;
}

interface NoticeTexts {
  greeting: (salon: string) => string;
  studyGreeting: (salon: string, product: string) => string;
  /** How to use the chat and who answers. */
  intro: string;
  /** The same in one line, for a customer who wrote without opening the welcome first. */
  whoAnswers: (salon: string) => string;
  studyNote: (product: string) => string;
  /** What is stored, for how long, and who processes it. Server code names Google Gemini (server/ai.ts). */
  data: (stored: string, days: number) => string;
  stored: Record<MessengerChannel, string>;
  deleteHint: string;
  deleted: (salon: string) => string;
  notDeleted: string;
}

// Fixed texts, not written by the AI: a customer must be able to rely on every word.
// German uses Swiss spelling (ss, no ß).
const TEXTS: Record<ChatLanguage, NoticeTexts> = {
  EN: {
    greeting: salon => `Hello! This is the chat of ${salon}.`,
    studyGreeting: (salon, product) => `Hi! This is the test chat of ${salon} (${product}, a student project at HSG).`,
    intro: 'Write to us in any language, for example to ask for an appointment. Our AI assistant answers right away. The salon team reads along and can reply too.',
    whoAnswers: salon => `You are chatting with the AI assistant of ${salon}. The salon team reads along and can reply too.`,
    studyNote: product => `This is a test chat (${product}, a student project at HSG).`,
    data: (stored, days) => `${stored} are stored for the salon and deleted automatically after ${days} days without activity in this chat. To write the answers, the messages are processed by Google's AI service Gemini. Please do not share sensitive personal data.`,
    stored: { Telegram: 'Your messages and your Telegram name', WhatsApp: 'Your messages, your WhatsApp name and your number' },
    deleteHint: 'Send /delete to delete your chat at any time.',
    deleted: salon => `Done. Your chat with ${salon} has been deleted.`,
    notDeleted: 'Sorry, your chat could not be deleted just now. Please send /delete again.',
  },
  DE: {
    greeting: salon => `Grüezi! Das ist der Chat von ${salon}.`,
    studyGreeting: (salon, product) => `Grüezi! Das ist der Test-Chat von ${salon} (${product}, ein Studierendenprojekt der HSG).`,
    intro: 'Schreiben Sie uns in Ihrer Sprache, zum Beispiel für einen Termin. Unser KI-Assistent antwortet sofort. Das Salon-Team liest mit und kann ebenfalls antworten.',
    whoAnswers: salon => `Sie schreiben mit dem KI-Assistenten von ${salon}. Das Salon-Team liest mit und kann ebenfalls antworten.`,
    studyNote: product => `Dies ist ein Test-Chat (${product}, ein Studierendenprojekt der HSG).`,
    data: (stored, days) => `${stored} werden für den Salon gespeichert und nach ${days} Tagen ohne Aktivität in diesem Chat automatisch gelöscht. Für die Antworten werden die Nachrichten vom KI-Dienst Gemini von Google verarbeitet. Bitte teilen Sie keine sensiblen persönlichen Daten.`,
    stored: { Telegram: 'Ihre Nachrichten und Ihr Telegram-Name', WhatsApp: 'Ihre Nachrichten, Ihr WhatsApp-Name und Ihre Nummer' },
    deleteHint: 'Mit /delete löschen Sie Ihren Chat jederzeit.',
    deleted: salon => `Erledigt. Ihr Chat mit ${salon} wurde gelöscht.`,
    notDeleted: 'Entschuldigung, Ihr Chat konnte gerade nicht gelöscht werden. Bitte senden Sie /delete noch einmal.',
  },
  FR: {
    greeting: salon => `Bonjour ! Voici le chat de ${salon}.`,
    studyGreeting: (salon, product) => `Bonjour ! Voici le chat de test de ${salon} (${product}, un projet étudiant de la HSG).`,
    intro: "Écrivez-nous dans votre langue, par exemple pour prendre rendez-vous. Notre assistant IA répond tout de suite. L'équipe du salon lit les messages et peut aussi répondre.",
    whoAnswers: salon => `Vous écrivez avec l'assistant IA de ${salon}. L'équipe du salon lit les messages et peut aussi répondre.`,
    studyNote: product => `Ceci est un chat de test (${product}, un projet étudiant de la HSG).`,
    data: (stored, days) => `${stored} sont enregistrés pour le salon et supprimés automatiquement après ${days} jours sans activité dans ce chat. Pour rédiger les réponses, les messages sont traités par Gemini, le service d'IA de Google. Merci de ne pas partager de données personnelles sensibles.`,
    stored: { Telegram: 'Vos messages et votre nom Telegram', WhatsApp: 'Vos messages, votre nom WhatsApp et votre numéro' },
    deleteHint: 'Envoyez /delete pour supprimer votre chat à tout moment.',
    deleted: salon => `C'est fait. Votre chat avec ${salon} a été supprimé.`,
    notDeleted: "Désolé, votre chat n'a pas pu être supprimé pour le moment. Veuillez envoyer /delete encore une fois.",
  },
  IT: {
    greeting: salon => `Salve! Questa è la chat di ${salon}.`,
    studyGreeting: (salon, product) => `Salve! Questa è la chat di prova di ${salon} (${product}, un progetto studentesco della HSG).`,
    intro: 'Ci scriva nella sua lingua, ad esempio per un appuntamento. Il nostro assistente IA risponde subito. Il team del salone legge i messaggi e può rispondere a sua volta.',
    whoAnswers: salon => `Sta scrivendo con l'assistente IA di ${salon}. Il team del salone legge i messaggi e può rispondere a sua volta.`,
    studyNote: product => `Questa è una chat di prova (${product}, un progetto studentesco della HSG).`,
    data: (stored, days) => `${stored} vengono salvati per il salone ed eliminati automaticamente dopo ${days} giorni senza attività in questa chat. Per scrivere le risposte, i messaggi vengono elaborati da Gemini, il servizio di IA di Google. La preghiamo di non condividere dati personali sensibili.`,
    stored: { Telegram: 'I suoi messaggi e il suo nome Telegram', WhatsApp: 'I suoi messaggi, il suo nome WhatsApp e il suo numero' },
    deleteHint: 'Invii /delete per eliminare la sua chat in qualsiasi momento.',
    deleted: salon => `Fatto. La sua chat con ${salon} è stata eliminata.`,
    notDeleted: 'Ci scusi, in questo momento non è stato possibile eliminare la sua chat. Invii di nuovo /delete.',
  },
};

const dataParagraph = (texts: NoticeTexts, channel: MessengerChannel) =>
  `${texts.data(texts.stored[channel], CHAT_RETENTION_DAYS)} ${texts.deleteHint}`;

/** The answer to /start on Telegram: who answers, what is stored and for how long. */
export function telegramWelcome(language: ChatLanguage, { salon, study = false, product = '' }: NoticeOptions): string {
  const texts = TEXTS[language];
  return [
    study ? texts.studyGreeting(salon, product) : texts.greeting(salon),
    texts.intro,
    dataParagraph(texts, 'Telegram'),
  ].join('\n\n');
}

/**
 * Sent once before the first AI answer on a channel that has no start screen (WhatsApp): the
 * customer learns that an AI answers and what happens to the messages before the chat goes on.
 */
export function firstContactNotice(language: ChatLanguage, channel: MessengerChannel, { salon, study = false, product = '' }: NoticeOptions): string {
  const texts = TEXTS[language];
  return [
    study ? `${texts.whoAnswers(salon)} ${texts.studyNote(product)}` : texts.whoAnswers(salon),
    dataParagraph(texts, channel),
  ].join('\n\n');
}

/** The answer to /delete, after the chat has really been deleted. */
export const chatDeletedNotice = (language: ChatLanguage, salon: string): string => TEXTS[language].deleted(salon);

/** The answer to /delete when the storage did not respond: the chat is still there, and we say so. */
export const chatNotDeletedNotice = (language: ChatLanguage): string => TEXTS[language].notDeleted;
