import type { AssistantLanguage } from '../assistant/types';

/**
 * What the browser sends to /api/voice so the AI model can read what was said in a call.
 *
 * Only the words as the speech recogniser wrote them, the day, and the names of services and
 * staff. No sound, no customer list, no calendar. The server loads this file too, so it holds
 * nothing but this shape and its limits.
 */
export interface VoiceQuestion {
  /** The owner's side of the call so far, oldest first. The last line is the newest. */
  lines: string[];
  /** Other ways the recogniser may have heard the newest line. */
  alternatives: string[];
  /** The salon's today, YYYY-MM-DD, and its English weekday name. */
  today: string;
  weekday: string;
  timeZone: string;
  language: AssistantLanguage;
  services: { id: string; name: string }[];
  staff: { id: string; name: string }[];
}

/** A call is read through its last phrases: what was said before them no longer changes the wish. */
export const MAX_VOICE_LINES = 12;
/** One phrase as the recogniser cuts it. Longer text is cut at this length. */
export const MAX_VOICE_LINE = 300;
export const MAX_VOICE_ALTERNATIVES = 3;
