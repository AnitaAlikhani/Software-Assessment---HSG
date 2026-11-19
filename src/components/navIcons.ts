import { BarChart3, Bot, Calendar, House, MessageSquare, Scissors, Settings, UserCheck, Users, type LucideIcon } from 'lucide-react';
import type { NavigationTab } from '../types';

/**
 * One icon per screen, the same in the menu, in the tab bar and in "More". The sparkles stay with
 * the owner's Assistant in the header; the AI receptionist, which answers customers, has the bot.
 */
export const NAV_ICONS: Record<NavigationTab, LucideIcon> = {
  home: House,
  calendar: Calendar,
  conversations: MessageSquare,
  customers: Users,
  team: UserCheck,
  services: Scissors,
  analytics: BarChart3,
  'ai-assistant': Bot,
  settings: Settings,
};
