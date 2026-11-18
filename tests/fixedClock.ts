import { createDemoConversations } from '../src/conversationData';

/**
 * Monday 5 October 2026, 12:00 in Zurich. Tests that need a "today" use this moment and never
 * the real clock, so the suite gives the same result on every day and in every time zone.
 */
export const FIXED_NOW = new Date('2026-10-05T10:00:00Z');

/** The sample chats as they look at FIXED_NOW: Camille's Friday is 9 October, Giulia's Saturday 10 October. */
export const demoConversations = createDemoConversations('Europe/Zurich', FIXED_NOW);
