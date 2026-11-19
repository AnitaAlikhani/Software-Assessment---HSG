import type { AiAssistantSettings, AppointmentAction, ChatLanguage, ChatMessage, Conversation, QuickReply } from './types.js';
import { addDays, addMinutes, formatCalendarDate, getSalonNow } from './scheduling.js';
import { DEMO_CHAT_CHANNEL, demoChatPeople, demoTimeline, type ChatPerson } from './demoSeed.js';
import { initialBookingHours } from './mockData.js';

export { upcomingWeekday } from './demoSeed.js';

/** The chat that is open when the Conversations page is first shown. */
export const DEFAULT_DEMO_CONVERSATION_ID = 'conv-camille';

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

/** One line of a sample chat: what was written, and the same in English and in German. */
interface Line {
  sender: ChatMessage['sender'];
  original: string;
  en: string;
  /** Left out where the original is German already. */
  de?: string;
}
interface Reply { local: string; en: string; de?: string }
interface ChatScript { lines: Line[]; followUp?: Reply; replies?: Reply[] }

// The Friday chat about a late appointment follows the opening hours, so it stays true to them.
const fridayClose = initialBookingHours.find((day) => day.day === 'Friday' && day.isOpen)?.to ?? '18:30';
const fridayLastStart = addMinutes(fridayClose, -30);
const fridayLateStart = addMinutes(fridayClose, 30);
const fridayLateClose = addMinutes(fridayClose, 60);

/**
 * The texts of the sample chats. Each one carries its English and German version, so a rename
 * of a customer or a service can never leave a message without its translation.
 * Weekdays in the texts are fixed; demoTimeline() puts the appointments on those weekdays.
 */
const SCRIPT: Record<ChatPerson, ChatScript> = {
  camille: {
    lines: [
      { sender: 'customer', original: 'Bonjour, je voudrais réserver une coloration pour vendredi.', en: "Hello, I'd like to book a colouring for Friday.", de: 'Hallo, ich möchte für Freitag eine Coloration buchen.' },
      { sender: 'ai', original: 'Bien sûr ! Vendredi à 11h00 est disponible. Souhaitez-vous confirmer ?', en: 'Of course! Friday at 11:00 is available. Would you like to confirm?', de: 'Natürlich! Am Freitag ist um 11:00 Uhr ein Termin frei. Möchten Sie ihn bestätigen?' },
      { sender: 'customer', original: "Oui, parfait. Est-ce possible d'avoir une réduction ? C'est ma première visite.", en: "Yes, perfect. Is it possible to get a discount? It's my first visit.", de: 'Ja, perfekt. Ist ein Rabatt möglich? Es ist mein erster Besuch.' },
    ],
    followUp: { local: 'Parfait, votre rendez-vous de vendredi à 11h00 est confirmé au tarif habituel. À bientôt !', en: 'Perfect, your appointment on Friday at 11:00 is confirmed at the standard price. See you soon!', de: 'Perfekt, Ihr Termin am Freitag um 11:00 Uhr ist zum regulären Preis bestätigt. Bis bald!' },
    replies: [
      { local: "Oui, en guise d'offre de bienvenue, vous bénéficiez de 10 % de réduction sur votre première visite.", en: 'Yes, as a welcome offer you get 10% off your first visit.', de: 'Ja, als Willkommensangebot erhalten Sie bei Ihrem ersten Besuch 10 % Rabatt.' },
      { local: 'Désolé, nous ne pouvons pas offrir de réduction, mais je vous ai réservé vendredi à 11h00.', en: "Sorry, we can't offer a discount, but I've booked you for Friday at 11:00.", de: 'Leider können wir keinen Rabatt anbieten, aber ich habe Sie für Freitag um 11:00 Uhr eingetragen.' },
    ],
  },
  chloe: {
    lines: [
      { sender: 'customer', original: `Hallo, habt ihr am Freitag noch einen Termin nach ${fridayClose} Uhr?`, en: `Hello, do you still have an appointment on Friday after ${fridayClose}?` },
    ],
    followUp: { local: `Unser letzter Termin am Freitag ist um ${fridayLastStart} Uhr. Möchten Sie diesen buchen?`, en: `Our last appointment on Friday is at ${fridayLastStart}. Would you like to book it?` },
    replies: [
      { local: `Ich kann am Freitag bis ${fridayLateClose} Uhr geöffnet bleiben. Soll ich Sie für ${fridayLateStart} Uhr eintragen?`, en: `I can stay open until ${fridayLateClose} on Friday. Shall I book you for ${fridayLateStart}?` },
    ],
  },
  giulia: {
    lines: [
      { sender: 'customer', original: 'Ciao, posso spostare il mio appuntamento a sabato?', en: 'Hi, can I move my appointment to Saturday?', de: 'Hallo, kann ich meinen Termin auf Samstag verschieben?' },
    ],
    followUp: { local: 'Certo! Posso proporle sabato alle 10:00 o alle 11:30. Quale preferisce?', en: 'Of course! I can offer you Saturday at 10:00 or 11:30. Which do you prefer?', de: 'Natürlich! Ich kann Ihnen Samstag um 10:00 oder 11:30 Uhr anbieten. Welcher Termin passt Ihnen besser?' },
    replies: [
      { local: 'Sì, sabato alle 10:00 va bene. Ho spostato il suo appuntamento.', en: 'Yes, Saturday at 10:00 works. I have moved your appointment.', de: 'Ja, Samstag um 10:00 Uhr passt. Ich habe Ihren Termin verschoben.' },
    ],
  },
  marie: {
    lines: [
      { sender: 'customer', original: 'Bonjour, je voudrais un rendez-vous pour une coupe jeudi.', en: "Hello, I'd like an appointment for a haircut on Thursday.", de: 'Hallo, ich hätte gerne am Donnerstag einen Termin zum Haareschneiden.' },
      { sender: 'ai', original: "J'ai vérifié notre agenda. Jeudi à 13h30 est disponible. Cela vous convient ?", en: 'I checked our calendar. Thursday at 13:30 is available. Does that suit you?', de: 'Ich habe in unseren Kalender geschaut. Am Donnerstag ist um 13:30 Uhr ein Termin frei. Passt Ihnen das?' },
      { sender: 'customer', original: "13h30, c'est parfait.", en: '13:30 is perfect.', de: '13:30 Uhr passt perfekt.' },
      { sender: 'ai', original: 'Rendez-vous confirmé ✅ Marie Dupont, Coupe, jeudi 13h30. À bientôt !', en: 'Appointment confirmed ✅ Marie Dupont, Haircut, Thursday 13:30. See you soon!', de: 'Termin bestätigt ✅ Marie Dupont, Haarschnitt, Donnerstag um 13:30 Uhr. Bis bald!' },
    ],
  },
  lea: {
    lines: [
      { sender: 'customer', original: 'Bonsoir, avez-vous de la place vendredi matin pour une coloration ?', en: 'Good evening, do you have room on Friday morning for a colouring?', de: 'Guten Abend, haben Sie am Freitagvormittag Zeit für eine Coloration?' },
      { sender: 'ai', original: 'Bonsoir ! Vendredi à 11h00 est disponible. Souhaitez-vous le réserver ?', en: 'Good evening! Friday at 11:00 is available. Would you like to book it?', de: 'Guten Abend! Am Freitag ist um 11:00 Uhr ein Termin frei. Möchten Sie ihn buchen?' },
      { sender: 'customer', original: 'Oui, merci.', en: 'Yes, thank you.', de: 'Ja, vielen Dank.' },
      { sender: 'ai', original: 'Réservation confirmée : Coloration, vendredi 11h00. À vendredi !', en: 'Booking confirmed: Colouring, Friday 11:00. See you Friday!', de: 'Buchung bestätigt: Coloration, Freitag um 11:00 Uhr. Bis Freitag!' },
    ],
  },
  john: {
    lines: [
      { sender: 'customer', original: 'Hi, can I get a haircut on Wednesday afternoon?', en: 'Hi, can I get a haircut on Wednesday afternoon?', de: 'Hallo, kann ich am Mittwochnachmittag einen Termin zum Haareschneiden bekommen?' },
      { sender: 'ai', original: 'Hi John! Wednesday at 15:00 is free. Shall I book it for you?', en: 'Hi John! Wednesday at 15:00 is free. Shall I book it for you?', de: 'Hallo John! Am Mittwoch ist um 15:00 Uhr ein Termin frei. Soll ich ihn für Sie buchen?' },
      { sender: 'customer', original: 'Yes please, thanks!', en: 'Yes please, thanks!', de: 'Ja, gerne. Danke!' },
      { sender: 'ai', original: 'Booked: Haircut, Wednesday 15:00. See you on Wednesday, John!', en: 'Booked: Haircut, Wednesday 15:00. See you on Wednesday, John!', de: 'Gebucht: Haarschnitt, Mittwoch um 15:00 Uhr. Bis Mittwoch, John!' },
    ],
  },
};

const germanByEnglish: Record<string, string> = Object.fromEntries(
  Object.values(SCRIPT).flatMap((chat) => [
    ...chat.lines.map((line) => [line.en, line.de] as const),
    ...(chat.followUp ? [[chat.followUp.en, chat.followUp.de] as const] : []),
    ...(chat.replies ?? []).map((reply) => [reply.en, reply.de] as const),
  ]).filter((pair): pair is readonly [string, string] => pair[1] !== undefined),
);

/**
 * The German version of a sample text, found by its English version. Only needed where a text
 * is shown before it became a message (a suggested reply); messages carry their own German.
 */
export const scriptedGerman = (english: string): string | undefined => germanByEnglish[english];

/**
 * The sample chats as they look at `now`: written minutes or hours ago (two of them last
 * evening), newest first, each tied to its customer record and, where one was booked, to its
 * appointment. Nothing here reads the clock when the file is loaded: callers (and tests) decide
 * which moment "now" is.
 */
export const createDemoConversations = (timeZone?: string, now = new Date()): Conversation[] => {
  const timeline = demoTimeline(timeZone, now);
  const clock = (moment: Date) => getSalonNow(timeZone, moment).time;

  const build = (
    key: ChatPerson,
    details: Pick<Conversation, 'avatarColor' | 'status'> & Partial<Pick<Conversation, 'attentionReason' | 'appointmentId'>>,
    actions: { followUp?: AppointmentAction; replies?: (AppointmentAction | undefined)[] } = {},
  ): Conversation => {
    const person = demoChatPeople[key];
    const script = SCRIPT[key];
    const sent = timeline.sent[key];
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
      messages: script.lines.map((line, index): ChatMessage => ({
        id: `m${index + 1}`,
        sender: line.sender,
        original: line.original,
        translation: line.en,
        ...(line.de ? { translationDe: line.de } : {}),
        time: clock(sent[index]),
        sentAt: sent[index].toISOString(),
      })),
      ...(script.followUp ? {
        aiFollowUp: {
          original: script.followUp.local,
          translation: script.followUp.en,
          ...(script.followUp.de ? { translationDe: script.followUp.de } : {}),
          ...(actions.followUp ? { appointmentAction: actions.followUp } : {}),
        },
      } : {}),
      ...(script.replies ? {
        quickReplies: script.replies.map((reply, index): QuickReply => ({
          en: reply.en,
          local: reply.local,
          ...(reply.de ? { de: reply.de } : {}),
          ...(actions.replies?.[index] ? { appointmentAction: actions.replies[index] } : {}),
        })),
      } : {}),
    };
  };

  // Camille's colouring with the owner, on the Friday her chat is about. Services and stylists
  // are named by id: the booking still works after the owner renames either.
  const camilleBooking: AppointmentAction = {
    type: 'book',
    appointmentId: 'cal-camille',
    date: timeline.open.camille.date,
    startTime: timeline.open.camille.start,
    serviceId: 'srv-3',
    employeeId: 'emp-1',
  };
  const giuliaMove: AppointmentAction = {
    type: 'reschedule',
    appointmentId: 'cal-giulia',
    date: timeline.open.giulia.date,
    startTime: timeline.open.giulia.start,
  };

  const conversations = [
    build('camille', {
      avatarColor: 'bg-rose-100 text-rose-700',
      status: 'needs-attention',
      attentionReason: "The customer asked for a discount. The AI can't decide this.",
    }, { followUp: camilleBooking, replies: [undefined, camilleBooking] }),
    build('chloe', {
      avatarColor: 'bg-amber-100 text-amber-700',
      status: 'needs-attention',
      attentionReason: `The request is outside opening hours (we close at ${fridayClose} on Fridays).`,
    }),
    build('giulia', {
      avatarColor: 'bg-emerald-100 text-emerald-700',
      status: 'needs-attention',
      attentionReason: 'The customer wants to change an existing booking.',
      appointmentId: 'cal-giulia',
    }, { replies: [giuliaMove] }),
    build('marie', {
      avatarColor: 'bg-violet-100 text-violet-700',
      status: 'booked',
      appointmentId: 'cal-2',
    }),
    build('lea', {
      avatarColor: 'bg-pink-100 text-pink-700',
      status: 'ai-handled',
      appointmentId: 'cal-3',
    }),
    build('john', {
      avatarColor: 'bg-sky-100 text-sky-700',
      status: 'ai-handled',
      appointmentId: 'cal-john',
    }),
  ];
  // Newest first, like a messenger.
  return conversations.sort((a, b) => b.lastMessageAt!.localeCompare(a.lastMessageAt!));
};

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
