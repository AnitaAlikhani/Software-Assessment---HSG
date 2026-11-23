import type { AiAssistantSettings, Conversation } from '../types';
import { isLiveConversation, type LiveConnection } from '../liveWhatsApp';

/** The customer's messages after the salon's last reply (by the AI or the owner). */
export const messagesSinceReply = (conversation: Conversation): number => {
  let count = 0;
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    if (conversation.messages[index].sender !== 'customer') break;
    count += 1;
  }
  return count;
};

/**
 * In a chat the owner has taken over the AI stays silent, so what the customer wrote since the
 * salon's last reply waits for her. The list shows that number; other chats show none.
 */
export const messagesWaitingForOwner = (conversation: Conversation): number =>
  conversation.takenOver ? messagesSinceReply(conversation) : 0;

/** True when the customer's last message has no answer yet. */
export const customerWaits = (conversation: Conversation): boolean => messagesSinceReply(conversation) > 0;

/** What the AI is doing in this chat, in the words of the chat's bar. */
export const aiStatusLabel = (conversation: Conversation, settings: AiAssistantSettings): string => {
  if (conversation.takenOver) return 'AI paused in this chat';
  // The approval setting acts when a chat is handed back to the AI; a live chat has no such waiting reply.
  const asks = !conversation.live && settings.askBeforeSending;
  if (conversation.status === 'needs-attention') return asks && conversation.aiFollowUp ? 'AI asks before sending' : 'AI waits for you';
  return asks ? 'AI asks before sending' : 'AI replies automatically';
};

/**
 * Where the back button of an open chat leads. A chat opened from the list goes back one step in
 * the browser's history, so the list is where it was and the browser's Back does not return to
 * the chat. A chat opened from elsewhere (Home, a customer, an appointment, a link) is replaced by
 * the list: the browser's Back then still leads to where the owner came from.
 */
export type ChatBack = 'history' | 'list';
export const chatBackTarget = (openedFromList: boolean): ChatBack => (openedFromList ? 'history' : 'list');

/** What the place of the open chat shows. */
export type OpenChatState = 'open' | 'none' | 'loading' | 'no-access' | 'waiting' | 'gone';

/**
 * A live chat is in the browser only after the server has answered. While the first answer is on
 * its way (or the app is still trying to reach the server) its address shows a loading state
 * instead of "no longer available"; a refused key says that the access link does not work.
 */
export const openChatState = (selectedId: string | null, found: boolean, connection: LiveConnection = 'off'): OpenChatState => {
  if (found) return 'open';
  if (selectedId === null) return 'none';
  if (isLiveConversation(selectedId)) {
    if (connection === 'loading' || connection === 'reconnecting') return 'loading';
    if (connection === 'denied') return 'no-access';
    // The server makes this connection wait: the chat may well exist, it just cannot be fetched now.
    if (connection === 'waiting') return 'waiting';
  }
  return 'gone';
};

/** The words for a refused access key, the same in the list and in a chat. */
export const NO_ACCESS_TITLE = 'No access to live chats';
export const NO_ACCESS_TEXT = 'The access link you opened is wrong or has expired. Open the latest link you were given.';
/** The button that makes this browser forget its owner key (src/liveWhatsApp.ts, signOut). */
export const SIGN_OUT_LABEL = 'Sign out on this device';
