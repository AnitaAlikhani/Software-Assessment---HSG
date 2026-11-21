import type { AiAssistantSettings, AppointmentAction, ChatLanguage, ChatMessage, Conversation, QuickReply } from './types.js';
import { addDays, addMinutes, formatCalendarDate, getSalonNow } from './scheduling.js';
import { DEMO_CHAT_CHANNEL, demoChatPeople, demoTimeline, upcomingWeekday, type ChatPerson } from './demoSeed.js';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from './mockData.js';
import { answerText } from './customerTexts.js';

export { upcomingWeekday } from './demoSeed.js';

/** The chat that is open when the Conversations page is first shown. */
export const DEFAULT_DEMO_CONVERSATION_ID = 'conv-sabrina';

export const LANGUAGE_NAMES: Record<ChatLanguage, string> = {
  EN: 'English',
  FR: 'French',
  DE: 'German',
  IT: 'Italian',
};

/**
 * How a chat's time is shown in the list: the clock time for today, "Yesterday", then the date.
 * `sentAt` is an ISO time; "today" is the salon's day, not the browser's.
 */
export const chatTimeLabel = (sentAt: string | Date, now: Date, timeZone?: string): string => {
  const sent = getSalonNow(timeZone, typeof sentAt === 'string' ? new Date(sentAt) : sentAt);
  const today = getSalonNow(timeZone, now).date;
  if (sent.date === today) return sent.time;
  if (sent.date === addDays(today, -1)) return 'Yesterday';
  return formatCalendarDate(sent.date);
};

/**
 * The time shown beside a chat in the list. It is worked out when the list is drawn, from the
 * time of the newest message, so a chat from last night reads "Yesterday" the next morning. The
 * label stored with the chat (`lastTime`) is only used for a chat that has no such time.
 */
export const conversationTimeLabel = (
  conversation: { lastMessageAt?: string; lastTime: string },
  now: Date,
  timeZone?: string,
): string => (conversation.lastMessageAt ? chatTimeLabel(conversation.lastMessageAt, now, timeZone) : conversation.lastTime);

/** One text of a chat: what was written, and the same in English and in German. */
export interface ScriptText {
  original: string;
  en: string;
  /** Left out where the original is German already. */
  de?: string;
}
interface Line extends ScriptText { sender: ChatMessage['sender'] }

/**
 * Where the story of a chat goes after the owner sent a suggested reply, or after the AI's
 * follow-up: the customer answers, and a booking request at the time offered waits for the
 * owner's one tap. The day is a weekday (0 = Sunday ... 6 = Saturday) after the day the
 * customer wrote; the service and the stylist are named by id, as in every booking.
 */
export interface ScriptedNextStep {
  customer: ScriptText;
  /** What the AI says to it. Left out after an owner's reply: the AI is paused then. */
  ai?: ScriptText;
  request: { weekday: number; time: string; serviceId: string; employeeId?: string };
}
interface Reply extends ScriptText { next?: ScriptedNextStep }

/**
 * The texts of one chat. `confirmation` stands for the salon's fixed confirmation (the same
 * sentence a live chat gets, see confirmationText below).
 */
interface ChatScript {
  lines: (Line | 'confirmation')[];
  followUp?: Reply;
  replies?: Reply[];
  /** What the customer says to a confirmation the owner sends later. Each language has a default. */
  thanks?: ScriptText;
  /** What the customer says to another time the owner suggests. Each language has a default. */
  agree?: ScriptText;
}

// The Friday chat about a late appointment follows the opening hours, so it stays true to them.
const fridayClose = initialBookingHours.find((day) => day.day === 'Friday' && day.isOpen)?.to ?? '18:30';
const fridayLastStart = addMinutes(fridayClose, -30);
const fridayAsked = addMinutes(fridayClose, 30);
/** The Saturday time the owner can offer Chloé instead (kept free in src/demoSeed.ts). */
const saturdayOffer = '11:30';

const customer = (original: string, en: string, de?: string): Line => ({ sender: 'customer', original, en, ...(de ? { de } : {}) });
const ai = (original: string, en: string, de?: string): Line => ({ sender: 'ai', original, en, ...(de ? { de } : {}) });

// The AI's own words when a customer accepts a time the owner suggested. The same in every chat.
const PASSED_ON: Record<ChatLanguage, ScriptText> = {
  DE: { original: 'Danke! Ich gebe Ihre Zusage an den Salon weiter. Die Bestätigung erhalten Sie hier im Chat.', en: "Thank you! I'll pass this on to the salon. You'll get the confirmation here in the chat." },
  FR: { original: 'Merci ! Je transmets votre accord au salon. Vous recevrez la confirmation ici, dans le chat.', en: "Thank you! I'll pass this on to the salon. You'll get the confirmation here in the chat.", de: 'Danke! Ich gebe Ihre Zusage an den Salon weiter. Die Bestätigung erhalten Sie hier im Chat.' },
  IT: { original: "Grazie! Comunico al salone che l'orario Le va bene. Riceverà la conferma qui in chat.", en: "Thank you! I'll let the salon know that the time suits you. You'll get the confirmation here in the chat.", de: 'Danke! Ich gebe dem Salon Bescheid, dass Ihnen die Zeit passt. Die Bestätigung erhalten Sie hier im Chat.' },
  EN: { original: "Thank you! I'll pass this on to the salon. You'll get the confirmation here in the chat.", en: "Thank you! I'll pass this on to the salon. You'll get the confirmation here in the chat.", de: 'Danke! Ich gebe Ihre Zusage an den Salon weiter. Die Bestätigung erhalten Sie hier im Chat.' },
};
// What a customer says to a confirmation, to another time the owner suggests, and to a change the
// salon cannot make (the appointment they have stays). Chats in which somebody writes differently override them.
const THANKS: Record<ChatLanguage, ScriptText> = {
  DE: { original: 'Super, vielen Dank!', en: 'Great, thank you very much!' },
  FR: { original: 'Merci beaucoup, à bientôt !', en: 'Thank you very much, see you soon!', de: 'Vielen Dank, bis bald!' },
  IT: { original: 'Perfetto, grazie mille!', en: 'Perfect, thank you very much!', de: 'Perfekt, vielen Dank!' },
  EN: { original: 'Great, thank you!', en: 'Great, thank you!', de: 'Super, danke!' },
};
const AGREE: Record<ChatLanguage, ScriptText> = {
  DE: { original: 'Ja, das passt mir. Vielen Dank!', en: 'Yes, that works for me. Thank you!' },
  FR: { original: 'Oui, cela me convient. Merci beaucoup !', en: 'Yes, that works for me. Thank you very much!', de: 'Ja, das passt mir. Vielen Dank!' },
  IT: { original: 'Sì, mi va bene. Grazie mille!', en: 'Yes, that works for me. Thank you very much!', de: 'Ja, das passt mir. Vielen Dank!' },
  EN: { original: 'Yes, that works for me. Thank you!', en: 'Yes, that works for me. Thank you!', de: 'Ja, das passt mir. Danke!' },
};
const KEEP_CURRENT: Record<ChatLanguage, ScriptText> = {
  DE: { original: 'In Ordnung, dann bleibt es beim bisherigen Termin.', en: "All right, then I'll keep my current appointment." },
  FR: { original: "D'accord, je garde donc mon rendez-vous actuel.", en: "All right, then I'll keep my current appointment.", de: 'In Ordnung, dann bleibt es beim bisherigen Termin.' },
  IT: { original: "Va bene, allora tengo l'appuntamento che ho già.", en: "All right, then I'll keep the appointment I already have.", de: 'In Ordnung, dann behalte ich den Termin, den ich schon habe.' },
  EN: { original: "All right, then I'll keep my current appointment.", en: "All right, then I'll keep my current appointment.", de: 'In Ordnung, dann bleibt es beim bisherigen Termin.' },
};

/** "1st", "2nd", "23rd", "11th": the day of the month as English writes it in a sentence. */
const englishDay = (day: number): string => {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
};

/**
 * The booking Giulia made in her chat nine days ago, for the Thursday she now wants to move.
 * She names the day of the month, as people do when the day is more than a week away.
 */
const giuliaBooking = (day: number): Line[] => [
  customer(
    `Buongiorno, sono Giulia Rossi. Vorrei prenotare un taglio con Selina per giovedì ${day} alle 15:00. È possibile?`,
    `Hello, this is Giulia Rossi. I'd like to book a haircut with Selina for Thursday the ${englishDay(day)} at 15:00. Is that possible?`,
    `Guten Tag, hier ist Giulia Rossi. Ich möchte gerne einen Haarschnitt bei Selina für Donnerstag, den ${day}., um 15:00 Uhr buchen. Geht das?`,
  ),
  ai(
    `Buongiorno! Ho inoltrato la Sua richiesta al salone: taglio con Selina, giovedì ${day} alle 15:00. Riceverà la conferma qui in chat.`,
    `Hello! I've passed your request on to the salon: haircut with Selina, Thursday the ${englishDay(day)} at 15:00. You'll get the confirmation here in the chat.`,
    `Guten Tag! Ich habe Ihre Anfrage an den Salon weitergegeben: Haarschnitt bei Selina, Donnerstag, den ${day}., um 15:00 Uhr. Die Bestätigung erhalten Sie hier im Chat.`,
  ),
];

/**
 * The texts of the salon's own chats. Each one carries its English and German version, so a
 * rename of a customer or a service can never leave a message without its translation.
 * Weekdays in the texts are fixed; demoTimeline() puts the appointments on those weekdays.
 *
 * The story is the same in all of them: the AI takes the request and asks for what is missing,
 * passes it on to the salon, and says that the confirmation follows. It never says that a time
 * is free (it cannot see the calendar) and never books by itself; the owner confirms with one tap.
 */
const SCRIPT: Record<ChatPerson, ChatScript> = {
  // A new customer asks for a colouring, then for a discount: that is the owner's decision.
  sabrina: {
    lines: [
      customer('Hallo, ich möchte gerne eine Coloration buchen. Haben Sie am Freitag noch etwas frei?', "Hello, I'd like to book a colouring. Do you have anything free on Friday?"),
      ai('Hallo! Gerne nehme ich Ihre Anfrage auf. Eine Coloration dauert 90 Minuten und kostet CHF 120. Um welche Zeit möchten Sie am Freitag kommen, und auf welchen Namen darf ich die Anfrage eintragen?',
        "Hello! I'm happy to take your request. A colouring takes 90 minutes and costs CHF 120. What time would you like to come on Friday, and what name should I put the request under?"),
      customer('Am liebsten um 11 Uhr. Sabrina Lüchinger.', 'Ideally at 11. Sabrina Lüchinger.'),
      ai('Danke! Ich habe Ihre Anfrage an den Salon weitergegeben: Coloration am Freitag um 11:00 Uhr. Sobald der Termin eingetragen ist, erhalten Sie hier die Bestätigung.',
        "Thank you! I've passed your request on to the salon: colouring on Friday at 11:00. As soon as the appointment is in the calendar, you'll get the confirmation here."),
      customer('Super. Gibt es für Neukundinnen eigentlich einen Rabatt? Ich komme zum ersten Mal zu Ihnen.', "Great. Is there a discount for new customers, by the way? It's my first time at your salon."),
    ],
    // Handing the chat back to the AI answers the question the standard way: the listed price.
    followUp: {
      // One sentence: the confirmation may be in the chat already when the AI sends this.
      original: 'Unsere Preise sind für alle Kundinnen und Kunden gleich: Die Coloration kostet CHF 120.',
      en: 'Our prices are the same for every customer: the colouring costs CHF 120.',
    },
    // Either answer also confirms the colouring she asked for: the fixed confirmation follows the reply.
    replies: [
      { original: 'Ja, bei Ihrem ersten Besuch erhalten Sie 10 % Rabatt.', en: 'Yes, on your first visit you get 10% off.' },
      { original: 'Rabatte bieten wir leider nicht an. Die Coloration kostet CHF 120.', en: "Unfortunately we don't offer discounts. The colouring costs CHF 120." },
    ],
  },
  // Swiss German, as many customers write their messages here. The AI answers in standard German.
  reto: {
    lines: [
      customer('Hoi zäme, hetted ihr am Samschtig am Morge no Platz für en Herreschnitt?', 'Hi there, would you have room for a men\'s cut on Saturday morning?'),
      ai('Grüezi! Gerne nehme ich Ihre Anfrage auf. Um welche Zeit möchten Sie kommen, haben Sie einen Wunsch, wer Ihnen die Haare schneidet, und wie ist Ihr Name?',
        "Hello! I'm happy to take your request. What time would you like to come, would you like a particular stylist, and what is your name?"),
      customer('So um nüni, wenns gaht bim Luca. Reto Hollenstein.', 'Around nine, with Luca if possible. Reto Hollenstein.'),
      ai('Danke! Ich habe Ihre Anfrage an den Salon weitergegeben: Herrenschnitt am Samstag um 9:00 Uhr bei Luca. Sobald der Termin eingetragen ist, erhalten Sie hier die Bestätigung.',
        "Thank you! I've passed your request on to the salon: men's cut on Saturday at 9:00 with Luca. As soon as the appointment is in the calendar, you'll get the confirmation here."),
    ],
    thanks: { original: 'Super, merci vielmal!', en: 'Great, thanks a lot!' },
    agree: { original: 'Jo, das passt. Merci!', en: 'Yes, that works. Thanks!' },
  },
  // A time after closing: the AI says so and hands over; the owner offers another time.
  chloe: {
    lines: [
      customer(`Guten Tag, hätten Sie am Freitag um ${fridayAsked} Uhr noch einen Termin für einen Haarschnitt?`, `Hello, would you have an appointment for a haircut on Friday at ${fridayAsked}?`),
      ai(`Guten Tag! Am Freitag haben wir bis ${fridayClose} Uhr geöffnet, um ${fridayAsked} Uhr ist deshalb leider kein Termin möglich. Ich frage im Salon nach, welche Zeit wir Ihnen stattdessen anbieten können.`,
        `Hello! On Friday we are open until ${fridayClose}, so unfortunately an appointment at ${fridayAsked} isn't possible. I'll ask the salon which time we can offer you instead.`),
    ],
    followUp: {
      original: `Unser letzter Termin am Freitag beginnt um ${fridayLastStart} Uhr. Soll ich Ihre Anfrage für ${fridayLastStart} Uhr an den Salon weitergeben?`,
      en: `Our last appointment on Friday starts at ${fridayLastStart}. Shall I pass on your request for ${fridayLastStart} to the salon?`,
      next: {
        customer: { original: 'Ja, gerne. Chloé Favre.', en: 'Yes, please. Chloé Favre.' },
        ai: {
          original: `Danke! Ich habe Ihre Anfrage an den Salon weitergegeben: Haarschnitt am Freitag um ${fridayLastStart} Uhr. Sobald der Termin eingetragen ist, erhalten Sie hier die Bestätigung.`,
          en: `Thank you! I've passed your request on to the salon: haircut on Friday at ${fridayLastStart}. As soon as the appointment is in the calendar, you'll get the confirmation here.`,
        },
        request: { weekday: 5, time: fridayLastStart, serviceId: 'srv-2' },
      },
    },
    replies: [
      {
        original: `Wir können Ihnen am Freitag um ${fridayLastStart} Uhr einen Termin anbieten. Passt Ihnen das?`,
        en: `We can offer you an appointment on Friday at ${fridayLastStart}. Does that suit you?`,
        next: {
          customer: { original: `Ja, ${fridayLastStart} Uhr passt mir gut. Mein Name ist Chloé Favre.`, en: `Yes, ${fridayLastStart} suits me well. My name is Chloé Favre.` },
          request: { weekday: 5, time: fridayLastStart, serviceId: 'srv-2' },
        },
      },
      {
        original: `Am Samstag hätten wir um ${saturdayOffer} Uhr einen Termin frei. Passt Ihnen das?`,
        en: `On Saturday we would have an appointment free at ${saturdayOffer}. Does that suit you?`,
        next: {
          customer: { original: `Samstag um ${saturdayOffer} Uhr ist perfekt, danke! Mein Name ist Chloé Favre.`, en: `Saturday at ${saturdayOffer} is perfect, thanks! My name is Chloé Favre.` },
          request: { weekday: 6, time: saturdayOffer, serviceId: 'srv-2' },
        },
      },
    ],
  },
  // Giulia booked in this chat nine days ago and now asks to move that appointment.
  giulia: {
    lines: [
      customer('Buongiorno, purtroppo giovedì non posso più venire. Posso spostare l\'appuntamento a sabato mattina, verso le 10?',
        'Hello, unfortunately I can no longer come on Thursday. Can I move the appointment to Saturday morning, around 10?',
        'Guten Tag, leider kann ich am Donnerstag nicht mehr kommen. Kann ich den Termin auf Samstagvormittag verschieben, gegen 10 Uhr?'),
      ai('Grazie! Ho inoltrato al salone la Sua richiesta di spostare il taglio a sabato alle 10:00 con Selina. Riceverà la conferma qui in chat.',
        "Thank you! I've passed your request to move the haircut to Saturday at 10:00 with Selina on to the salon. You'll get the confirmation here in the chat.",
        'Danke! Ich habe Ihre Bitte, den Haarschnitt auf Samstag um 10:00 Uhr bei Selina zu verschieben, an den Salon weitergegeben. Die Bestätigung erhalten Sie hier im Chat.'),
    ],
  },
  marie: {
    lines: [
      customer('Bonjour, est-ce que je pourrais avoir un rendez-vous pour une coupe jeudi après-midi ?',
        'Hello, could I have an appointment for a haircut on Thursday afternoon?',
        'Guten Tag, könnte ich am Donnerstagnachmittag einen Termin für einen Haarschnitt bekommen?'),
      ai('Bonjour ! Avec plaisir. Vers quelle heure souhaitez-vous venir, et à quel nom dois-je enregistrer la demande ?',
        'Hello! With pleasure. Around what time would you like to come, and under what name should I put the request?',
        'Guten Tag! Sehr gerne. Um welche Uhrzeit möchten Sie ungefähr kommen, und auf welchen Namen darf ich die Anfrage eintragen?'),
      customer('Vers 13h30, ce serait parfait. Marie Dupont.', 'Around 13:30 would be perfect. Marie Dupont.', 'Gegen 13:30 Uhr wäre perfekt. Marie Dupont.'),
      ai('Merci ! J\'ai transmis votre demande au salon : coupe, jeudi à 13h30. Vous recevrez la confirmation ici dès que le rendez-vous sera inscrit dans notre agenda.',
        "Thank you! I've passed your request on to the salon: haircut, Thursday at 13:30. You'll get the confirmation here as soon as the appointment is in our calendar.",
        'Danke! Ich habe Ihre Anfrage an den Salon weitergegeben: Haarschnitt, Donnerstag um 13:30 Uhr. Sobald der Termin in unserem Kalender steht, erhalten Sie hier die Bestätigung.'),
      'confirmation',
      customer('Merci beaucoup, à jeudi !', 'Thank you very much, see you on Thursday!', 'Vielen Dank, bis Donnerstag!'),
    ],
  },
  lara: {
    lines: [
      customer('Guten Abend, hätten Sie am Freitagvormittag Zeit für eine Coloration?', 'Good evening, would you have time for a colouring on Friday morning?'),
      ai('Guten Abend! Gerne nehme ich Ihre Anfrage auf. Eine Coloration dauert 90 Minuten und kostet CHF 120. Um welche Zeit möchten Sie kommen, und auf welchen Namen darf ich die Anfrage eintragen?',
        "Good evening! I'm happy to take your request. A colouring takes 90 minutes and costs CHF 120. What time would you like to come, and what name should I put the request under?"),
      customer('Um 11 Uhr, wenn möglich bei Selina. Lara Rüegg.', 'At 11, with Selina if possible. Lara Rüegg.'),
      ai('Danke! Ich habe Ihre Anfrage an den Salon weitergegeben: Coloration am Freitag um 11:00 Uhr bei Selina. Sobald der Termin eingetragen ist, erhalten Sie hier die Bestätigung.',
        "Thank you! I've passed your request on to the salon: colouring on Friday at 11:00 with Selina. As soon as the appointment is in the calendar, you'll get the confirmation here."),
      'confirmation',
      customer('Super, vielen Dank! Bis Freitag.', 'Great, thank you very much! See you on Friday.'),
    ],
  },
  john: {
    lines: [
      customer('Hi, could I get a haircut on Wednesday afternoon?', 'Hi, could I get a haircut on Wednesday afternoon?', 'Hallo, könnte ich am Mittwochnachmittag einen Haarschnitt bekommen?'),
      ai('Hi! Happy to take your request. What time would suit you, and what name should I put the request under?',
        'Hi! Happy to take your request. What time would suit you, and what name should I put the request under?',
        'Hallo! Gerne nehme ich Ihre Anfrage auf. Welche Uhrzeit passt Ihnen, und auf welchen Namen darf ich die Anfrage eintragen?'),
      customer('3 pm would be great. John Bennett.', '3 pm would be great. John Bennett.', '15 Uhr wäre super. John Bennett.'),
      ai("Thanks, John! I've passed your request on to the salon: haircut on Wednesday at 15:00. You'll get the confirmation here as soon as the appointment is in the calendar.",
        "Thanks, John! I've passed your request on to the salon: haircut on Wednesday at 15:00. You'll get the confirmation here as soon as the appointment is in the calendar.",
        'Danke, John! Ich habe Ihre Anfrage an den Salon weitergegeben: Haarschnitt am Mittwoch um 15:00 Uhr. Sobald der Termin eingetragen ist, erhalten Sie hier die Bestätigung.'),
      'confirmation',
      customer('Perfect, thanks!', 'Perfect, thanks!', 'Perfekt, danke!'),
    ],
  },
};

const scriptOfConversation = (conversationId: string): ChatScript | undefined => {
  const key = conversationId.replace(/^conv-/, '') as ChatPerson;
  return Object.prototype.hasOwnProperty.call(SCRIPT, key) && conversationId === `conv-${key}` ? SCRIPT[key] : undefined;
};

const germanByEnglish: Record<string, string> = Object.fromEntries(
  Object.values(SCRIPT).flatMap((chat) => [
    ...chat.lines.flatMap((line) => line === 'confirmation' ? [] : [[line.en, line.de] as const]),
    ...(chat.followUp ? [[chat.followUp.en, chat.followUp.de] as const] : []),
    ...(chat.replies ?? []).map((reply) => [reply.en, reply.de] as const),
  ]).filter((pair): pair is readonly [string, string] => pair[1] !== undefined),
);

/**
 * The German version of a text of the salon's chats, found by its English version. Only needed
 * where a text is shown before it became a message (a suggested reply); messages carry their own German.
 */
export const scriptedGerman = (english: string): string | undefined => germanByEnglish[english];

/**
 * What one of the salon's chats goes on with, for src/sampleChatFlow.ts: the customer's answer to
 * a suggested reply (found by its English text) or to the AI's follow-up, and what the customer
 * says to a confirmation, to another time and to a change that cannot be made.
 * Null for a chat that is not one of the salon's own (a live chat, or one that no longer exists).
 */
export const sampleChatScript = (conversation: Pick<Conversation, 'id' | 'language' | 'live'>): {
  afterReply: (english: string) => ScriptedNextStep | undefined;
  afterFollowUp?: ScriptedNextStep;
  thanks: ScriptText;
  agree: ScriptText;
  keepCurrent: ScriptText;
  passedOn: ScriptText;
} | null => {
  if (conversation.live) return null;
  const script = scriptOfConversation(conversation.id);
  const language = LANGUAGE_NAMES[conversation.language] ? conversation.language : 'EN';
  return {
    afterReply: (english) => script?.replies?.find((reply) => reply.en === english)?.next,
    afterFollowUp: script?.followUp?.next,
    thanks: script?.thanks ?? THANKS[language],
    agree: script?.agree ?? AGREE[language],
    keepCurrent: KEEP_CURRENT[language],
    passedOn: PASSED_ON[language],
  };
};

/** A text as a message: the original, its English and, where it is not German already, its German. */
export const scriptMessage = (text: ScriptText, language: ChatLanguage): Pick<ChatMessage, 'original' | 'translation' | 'translationDe'> => ({
  original: text.original,
  translation: text.en,
  ...(language !== 'DE' && text.de ? { translationDe: text.de } : {}),
});

/**
 * The salon's confirmation in a chat: the fixed sentence of src/chatTemplates.ts (chatBookingMessage
 * with 'confirmed'), built here from the same source, src/customerTexts.ts. The server loads this
 * file, and chatTemplates.ts does not import with the endings the server needs yet; a test checks
 * that both give the same words.
 */
export const confirmationText = (
  language: ChatLanguage,
  details: { customerName: string; salonName: string; serviceName: string; staffName?: string; date: string; time: string },
): Pick<ChatMessage, 'original' | 'translation' | 'translationDe'> => {
  const inLanguage = (wanted: ChatLanguage) => answerText({
    language: wanted, outcome: 'accepted', customerName: details.customerName, salonName: details.salonName,
    serviceName: details.serviceName, staffName: details.staffName, date: details.date, startTime: details.time,
  });
  return { original: inLanguage(language), translation: inLanguage('EN'), ...(language !== 'DE' ? { translationDe: inLanguage('DE') } : {}) };
};

const serviceName = (serviceId: string) => initialServices.find((service) => service.id === serviceId)!.name;
const staffName = (employeeId: string) => initialEmployees.find((employee) => employee.id === employeeId)!.name;

/** What a chat waits for: the AI took a booking request, and the owner confirms it or offers another time. */
export const ATTENTION = {
  request: 'The AI took a booking request. Confirm it or suggest another time.',
  change: 'The customer asks to move an appointment. Confirm the new time or suggest another one.',
  accepted: 'The customer accepted the time you offered. Confirm it to book the appointment.',
  cancellation: 'The customer asks to cancel an appointment.',
} as const;

/**
 * The salon's own chats as they look at `now`: written minutes or hours ago (two of them last
 * evening), newest first, each tied to its customer record and, where a booking was confirmed,
 * to its appointment. Four wait for the owner (a discount question, two new requests, a change),
 * three end in an appointment that the owner confirmed. Nothing here reads the clock when the
 * file is loaded: callers (and tests) decide which moment "now" is.
 */
export const createDemoConversations = (timeZone?: string, now = new Date()): Conversation[] => {
  const timeline = demoTimeline(timeZone, now);
  const clock = (moment: Date) => getSalonNow(timeZone, moment).time;
  const salonName = initialCompanySettings.companyName;

  type Booking = NonNullable<Conversation['bookingRequest']>;
  /** A request as the AI passes it on: the service and the stylist by id and by name. */
  const request = (key: ChatPerson, serviceId: string, date: string, time: string, employeeId?: string, extra: Partial<Booking> = {}): Booking => ({
    service: serviceName(serviceId), serviceId, date, time, customerName: demoChatPeople[key].name, status: 'requested',
    ...(employeeId ? { employeeId, staffName: staffName(employeeId) } : {}), kind: 'new', ...extra,
  });

  const build = (
    key: ChatPerson,
    details: Pick<Conversation, 'avatarColor' | 'status'> & Partial<Pick<Conversation, 'attentionReason' | 'appointmentId' | 'bookingRequest'>>,
    options: { before?: (Line | 'confirmation')[]; confirmed?: Booking; replyAction?: AppointmentAction } = {},
  ): Conversation => {
    const person = demoChatPeople[key];
    const script = SCRIPT[key];
    const sent = timeline.sent[key];
    const lines = [...(options.before ?? []), ...script.lines];
    if (lines.length !== sent.length) throw new Error(`The chat with ${person.name} has ${lines.length} messages and ${sent.length} times.`);
    const last = sent[sent.length - 1];
    return {
      id: `conv-${key}`,
      customerId: person.id,
      customerName: person.name,
      initials: person.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
      language: person.language,
      phone: person.phone,
      channel: DEMO_CHAT_CHANNEL,
      ...details,
      lastTime: chatTimeLabel(last, now, timeZone),
      lastMessageAt: last.toISOString(),
      messages: lines.map((line, index): ChatMessage => {
        const time = { time: clock(sent[index]), sentAt: sent[index].toISOString() };
        if (line !== 'confirmation') return { id: `m${index + 1}`, sender: line.sender, ...scriptMessage(line, person.language), ...time };
        const booking = options.confirmed!;
        // The salon's message: sent with the owner's tap, so it is shown as the salon's, not the AI's.
        return {
          id: `m${index + 1}`, sender: 'owner',
          ...confirmationText(person.language, { customerName: booking.customerName, salonName, serviceName: booking.service, staffName: booking.staffName, date: booking.date, time: booking.time }),
          ...time,
        };
      }),
      ...(script.followUp ? { aiFollowUp: scriptMessage(script.followUp, person.language) } : {}),
      ...(script.replies ? {
        quickReplies: script.replies.map((reply): QuickReply => ({
          en: reply.en,
          local: reply.original,
          ...(reply.de ? { de: reply.de } : {}),
          ...(options.replyAction ? { appointmentAction: options.replyAction } : {}),
        })),
      } : {}),
    };
  };

  const confirmed = (booking: Booking): Booking => ({ ...booking, status: 'confirmed' });
  const { open, booked } = timeline;

  // Sabrina's colouring, as she asked for it. Either suggested reply confirms it with Anna, who does
  // colour work and is free then; the appointment gets the id that confirming the request gives it,
  // so a second confirmation cannot add it twice (chatAppointmentId in src/requestAnswers.ts, which
  // the server must not load: a test checks that both give the same id).
  const sabrinaRequest = request('sabrina', 'srv-3', open.sabrina.date, open.sabrina.start);
  const sabrinaBooking: AppointmentAction = {
    type: 'book',
    appointmentId: `live-appt-conv-sabrina-${sabrinaRequest.date}-${sabrinaRequest.time.replace(':', '')}`,
    date: sabrinaRequest.date,
    startTime: sabrinaRequest.time,
    serviceId: 'srv-3',
    employeeId: 'emp-1',
  };
  const giuliaFirst = request('giulia', 'srv-2', booked.giulia.date, booked.giulia.start, 'emp-2');

  const conversations = [
    build('sabrina', {
      avatarColor: 'bg-rose-100 text-rose-700',
      status: 'needs-attention',
      attentionReason: "The customer asked for a discount. The AI can't decide this.",
      bookingRequest: sabrinaRequest,
    }, { replyAction: sabrinaBooking }),
    build('reto', {
      avatarColor: 'bg-sky-100 text-sky-700',
      status: 'needs-attention',
      attentionReason: ATTENTION.request,
      bookingRequest: request('reto', 'srv-5', open.reto.date, open.reto.start, 'emp-3'),
    }),
    build('chloe', {
      avatarColor: 'bg-amber-100 text-amber-700',
      status: 'needs-attention',
      attentionReason: `The customer asked for Friday at ${fridayAsked}, after closing time (${fridayClose}). Offer another time.`,
    }),
    build('giulia', {
      avatarColor: 'bg-emerald-100 text-emerald-700',
      status: 'needs-attention',
      attentionReason: ATTENTION.change,
      appointmentId: 'cal-giulia',
      bookingRequest: request('giulia', 'srv-2', open.giulia.date, open.giulia.start, 'emp-2', {
        kind: 'change', previous: { date: booked.giulia.date, time: booked.giulia.start },
      }),
    }, { before: [...giuliaBooking(Number(booked.giulia.date.slice(8))), 'confirmation'], confirmed: giuliaFirst }),
    build('marie', {
      avatarColor: 'bg-violet-100 text-violet-700',
      status: 'booked',
      appointmentId: 'cal-2',
      bookingRequest: confirmed(request('marie', 'srv-2', booked.marie.date, booked.marie.start, 'emp-1')),
    }, { confirmed: request('marie', 'srv-2', booked.marie.date, booked.marie.start, 'emp-1') }),
    build('lara', {
      avatarColor: 'bg-pink-100 text-pink-700',
      status: 'booked',
      appointmentId: 'cal-3',
      bookingRequest: confirmed(request('lara', 'srv-3', booked.lara.date, booked.lara.start, 'emp-2')),
    }, { confirmed: request('lara', 'srv-3', booked.lara.date, booked.lara.start, 'emp-2') }),
    build('john', {
      avatarColor: 'bg-teal-100 text-teal-700',
      status: 'booked',
      appointmentId: 'cal-john',
      bookingRequest: confirmed(request('john', 'srv-2', booked.john.date, booked.john.start, 'emp-1')),
    }, { confirmed: request('john', 'srv-2', booked.john.date, booked.john.start, 'emp-1') }),
  ];
  // Newest first, like a messenger.
  return conversations.sort((a, b) => b.lastMessageAt!.localeCompare(a.lastMessageAt!));
};

/** The day a scripted next step asks for: the first such weekday after the day the customer wrote. */
export const nextStepDate = (step: ScriptedNextStep, writtenOn: string): string => upcomingWeekday(step.request.weekday, writtenOn);

export const initialAiSettings: AiAssistantSettings = {
  askBeforeSending: false,
  translateChats: true,
  ownerLanguage: 'English',
  answerLanguages: { DE: true, FR: true, IT: true, EN: true },
  tone: 'friendly',
  handoverRules: [
    { id: 'rule-discounts', label: 'Discounts and price changes', enabled: true },
    { id: 'rule-complaints', label: 'Complaints', enabled: true },
    { id: 'rule-hours', label: 'Bookings outside opening hours', enabled: true },
    { id: 'rule-cancellations', label: 'Cancellations and refunds', enabled: true },
  ],
};
