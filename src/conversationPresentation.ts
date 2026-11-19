import type { AiAssistantSettings, ChatLanguage, ChatMessage, Conversation } from './types';
import { scriptedGerman } from './conversationData';

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
  // Messages carry their own German text. A suggested reply is shown before it becomes a message,
  // so its German is looked up among the sample texts. Free text is never machine-translated here.
  const translated = language === 'German' ? message.translationDe ?? scriptedGerman(message.translation) : message.translation;
  if (!translated) return { ...original, translationUnavailable: true };
  return { text: translated, showOriginal: translated !== message.original, translationUnavailable: false };
}
