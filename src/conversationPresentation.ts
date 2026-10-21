import type { AiAssistantSettings, ChatLanguage, ChatMessage, Conversation } from './types';

// Reviewed translations for the scripted demo. Free text is never machine-translated.
const germanTranslations: Record<string, string> = {
  "Hello, I'd like to book a colouring for Friday.": 'Hallo, ich möchte für Freitag eine Coloration buchen.',
  'Of course! Friday at 11:00 is available. Would you like to confirm?': 'Natürlich! Am Freitag ist um 11:00 Uhr ein Termin frei. Möchten Sie ihn bestätigen?',
  "Yes, perfect. Is it possible to get a discount? It's my first visit.": 'Ja, perfekt. Ist ein Rabatt möglich? Es ist mein erster Besuch.',
  'Perfect, your appointment on Friday at 11:00 is confirmed at the standard price. See you soon!': 'Perfekt, Ihr Termin am Freitag um 11:00 Uhr ist zum regulären Preis bestätigt. Bis bald!',
  'Yes, as a welcome offer you get 10% off your first visit.': 'Ja, als Willkommensangebot erhalten Sie bei Ihrem ersten Besuch 10 % Rabatt.',
  "Sorry, we can't offer a discount, but I've booked you for Friday at 11:00.": 'Leider können wir keinen Rabatt anbieten, aber ich habe Sie für Freitag um 11:00 Uhr eingetragen.',
  'Hello, do you still have an appointment on Friday after 18:00?': 'Hallo, haben Sie am Freitag nach 18:00 Uhr noch einen Termin frei?',
  'Our last appointment on Friday is at 17:30. Would you like to book it?': 'Unser letzter Termin am Freitag ist um 17:30 Uhr. Möchten Sie diesen buchen?',
  'I can stay open until 19:00 on Friday. Shall I book you for 18:30?': 'Ich kann am Freitag bis 19:00 Uhr geöffnet bleiben. Soll ich Sie für 18:30 Uhr eintragen?',
  'Hi, can I move my appointment to Saturday?': 'Hallo, kann ich meinen Termin auf Samstag verschieben?',
  'Of course! I can offer you Saturday at 10:00 or 11:30. Which do you prefer?': 'Natürlich! Ich kann Ihnen Samstag um 10:00 oder 11:30 Uhr anbieten. Welcher Termin passt Ihnen besser?',
  'Yes, Saturday at 10:00 works. I have moved your appointment.': 'Ja, Samstag um 10:00 Uhr passt. Ich habe Ihren Termin verschoben.',
  "Hello, I'd like an appointment for a haircut on Thursday.": 'Hallo, ich hätte gerne am Donnerstag einen Termin zum Haareschneiden.',
  'I checked our calendar. Thursday at 13:30 is available. Does that suit you?': 'Ich habe in unseren Kalender geschaut. Am Donnerstag ist um 13:30 Uhr ein Termin frei. Passt Ihnen das?',
  '13:30 is perfect.': '13:30 Uhr passt perfekt.',
  'Appointment confirmed ✅ Marie Dupont, Haircut, Thursday 13:30. See you soon!': 'Termin bestätigt ✅ Marie Dupont, Haarschnitt, Donnerstag um 13:30 Uhr. Bis bald!',
  'Good evening, do you have room on Friday morning for a colouring?': 'Guten Abend, haben Sie am Freitagvormittag Zeit für eine Coloration?',
  'Good evening! Friday at 11:00 is available. Would you like to book it?': 'Guten Abend! Am Freitag ist um 11:00 Uhr ein Termin frei. Möchten Sie ihn buchen?',
  'Yes, thank you.': 'Ja, vielen Dank.',
  'Booking confirmed: Colouring, Friday 11:00. See you Friday!': 'Buchung bestätigt: Coloration, Freitag um 11:00 Uhr. Bis Freitag!',
  'Hi, can I get a haircut on Wednesday afternoon?': 'Hallo, kann ich am Mittwochnachmittag einen Termin zum Haareschneiden bekommen?',
  'Hi John! Wednesday at 15:00 is free. Shall I book it for you?': 'Hallo John! Am Mittwoch ist um 15:00 Uhr ein Termin frei. Soll ich ihn für Sie buchen?',
  'Thanks, see you on Wednesday!': 'Danke, bis Mittwoch!',
};

export const ownerLanguageName = (settings: Pick<AiAssistantSettings, 'ownerLanguage'>) =>
  settings.ownerLanguage === 'German' ? 'German' : 'English';

export function conversationForSelection(conversations: Conversation[], selectedId: string | null): Conversation | null {
  return selectedId === null ? conversations[0] ?? null : conversations.find(item => item.id === selectedId) ?? null;
}

export function messageForOwner(
  message: Pick<ChatMessage, 'original' | 'translation' | 'untranslated'> & { translationDe?: string },
  sourceLanguage: ChatLanguage,
  settings: Pick<AiAssistantSettings, 'translateChats' | 'ownerLanguage'>,
) {
  const original = { text: message.original, showOriginal: false, translationUnavailable: false };
  if (!settings.translateChats) return original;
  if (message.untranslated) return { ...original, translationUnavailable: true };
  const language = ownerLanguageName(settings);
  if (language === 'German' && sourceLanguage === 'DE') return original;
  const translated = language === 'German' ? message.translationDe ?? germanTranslations[message.translation] : message.translation;
  if (!translated) return { ...original, translationUnavailable: true };
  return { text: translated, showOriginal: translated !== message.original, translationUnavailable: false };
}
