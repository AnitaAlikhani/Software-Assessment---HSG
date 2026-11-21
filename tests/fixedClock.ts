import { createDemoConversations } from '../src/conversationData';
import { createDemoRequests } from '../src/demoRequests';
import { createDemoCustomers, createDemoEvents, createDemoShifts } from '../src/demoSeed';

/**
 * Monday 5 October 2026, 12:00 in Zurich. Tests that need a "today" use this moment and never
 * the real clock, so the suite gives the same result on every day and in every time zone.
 */
export const FIXED_NOW = new Date('2026-10-05T10:00:00Z');

/** The sample chats as they look at FIXED_NOW: Camille's Friday is 9 October, Giulia's Saturday 10 October. */
export const demoConversations = createDemoConversations('Europe/Zurich', FIXED_NOW);

/**
 * The salon as it looks at FIXED_NOW. The appointments the chats talk about fall on
 * Wed 7 (cal-john), Thu 8 (cal-2, cal-giulia) and Fri 9 October (cal-3); the two pending
 * requests are for Wed 7 and Thu 8 October.
 */
export const demoEvents = createDemoEvents('Europe/Zurich', FIXED_NOW);
export const demoCustomers = createDemoCustomers('Europe/Zurich', FIXED_NOW, demoEvents);
export const demoRequests = createDemoRequests('Europe/Zurich', FIXED_NOW, demoEvents);
/**
 * The week plan the salon starts with: one list per stylist for the single days that differ from
 * their regular week, and none of them holds a day. Who works when comes from the stylists'
 * regular hours (weeklyHours on initialEmployees) through workingTimeOn. A test that needs
 * other hours or a day off on one date adds it to a copy of these lists.
 */
export const demoShifts = createDemoShifts('Europe/Zurich', FIXED_NOW);
