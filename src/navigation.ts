import type { NavigationTab, SettingsSubTab, TeamSubTab } from './types';

export interface AppRoute {
  tab: NavigationTab;
  requestId?: string;
  customerId?: string;
  appointmentId?: string;
  conversationId?: string;
  /** The tab that is open inside Team or Settings. Left out on a page's first tab. */
  section?: TeamSubTab | SettingsSubTab;
}

/**
 * Every screen under the one name it has everywhere: in the menu, in the top bar on phones and in
 * the browser tab. Sentence case. (The tab bar on phones shortens Conversations to "Chats".)
 */
export const SCREEN_NAMES: Record<NavigationTab, string> = {
  home: 'Home',
  calendar: 'Calendar',
  conversations: 'Conversations',
  customers: 'Customers',
  team: 'Team',
  services: 'Services',
  analytics: 'Analytics',
  'ai-assistant': 'AI receptionist',
  settings: 'Settings',
};

/** The menu on laptops: three groups, the first one without a heading. */
export const MENU_GROUPS: { heading?: string; tabs: NavigationTab[] }[] = [
  { tabs: ['home', 'calendar', 'conversations', 'customers'] },
  { heading: 'Salon', tabs: ['team', 'services', 'analytics'] },
  { heading: 'Settings', tabs: ['ai-assistant', 'settings'] },
];

/** The screens the tab bar on phones opens directly. "+" (New appointment) and "More" are its other two places. */
export const TAB_BAR_TABS: NavigationTab[] = ['home', 'calendar', 'conversations'];

/** What "More" lists: every screen of the menu that the tab bar lacks, in the menu's order. */
export const MORE_TABS: NavigationTab[] = MENU_GROUPS.flatMap((group) => group.tabs).filter((tab) => !TAB_BAR_TABS.includes(tab));

/** The tabs of Team and of Settings, in their order. The first one is the tab a page opens on. */
export const TEAM_TABS: { id: TeamSubTab; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'week', label: 'This week' },
  { id: 'absences', label: 'Absences' },
];
export const SETTINGS_TABS: { id: SettingsSubTab; label: string }[] = [
  { id: 'salon', label: 'Salon' },
  { id: 'hours', label: 'Opening hours' },
  { id: 'closed-dates', label: 'Closed dates' },
  { id: 'online-booking', label: 'Online booking' },
];
const sectionsOf: Partial<Record<NavigationTab, { id: string }[]>> = { team: TEAM_TABS, settings: SETTINGS_TABS };

/** Screens that moved or went, by the name their address had. */
export type RetiredTab = 'employees' | 'shift-plan' | 'booking-page' | 'resources';

/**
 * Old addresses keep working: a bookmark or a link in a message leads to the place the screen
 * moved to. "Rooms & equipment" has no successor, so its address leads Home.
 */
const MOVED = new Map<string, AppRoute>([
  ['employees', { tab: 'team' }],
  ['shift-plan', { tab: 'team', section: 'week' }],
  ['booking-page', { tab: 'settings', section: 'online-booking' }],
  ['resources', { tab: 'home' }],
]);

const tabs = Object.keys(SCREEN_NAMES) as NavigationTab[];
const targetForTab = { home: 'requestId', customers: 'customerId', calendar: 'appointmentId', conversations: 'conversationId' } as const;

const pathOf = (hash: string): string => hash.replace(/^#\/?/, '').split('?')[0];

/** A page's tab as the address carries it: only a tab the page has, and not its first one. */
const sectionFor = (tab: NavigationTab, section: string | null | undefined): AppRoute['section'] | undefined => {
  const known = sectionsOf[tab];
  return known && section && known.slice(1).some((item) => item.id === section) ? section as AppRoute['section'] : undefined;
};

/** True for the address of a screen that moved. The app then shows the new address in its place. */
export const isOldAddress = (hash: string): boolean => MOVED.has(pathOf(hash));

/** Where a screen is today, also when it is asked for by a name it no longer has. */
export const routeForTab = (tab: NavigationTab | RetiredTab): AppRoute => ({ ...(MOVED.get(tab) ?? { tab: tab as NavigationTab }) });

export function parseRoute(hash: string): AppRoute {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const moved = MOVED.get(path);
  if (moved) return { ...moved };
  const tab = tabs.includes(path as NavigationTab) ? path as NavigationTab : 'home';
  const parameters = new URLSearchParams(query);
  const key = targetForTab[tab as keyof typeof targetForTab];
  const id = key ? parameters.get(key) : null;
  const section = sectionFor(tab, parameters.get('tab'));
  return { tab, ...(id ? { [key]: id } : {}), ...(section ? { section } : {}) };
}

export function routeHash(route: AppRoute): string {
  const parameters = new URLSearchParams();
  const key = targetForTab[route.tab as keyof typeof targetForTab];
  const id = key && route[key];
  if (id) parameters.set(key, id);
  const section = sectionFor(route.tab, route.section);
  if (section) parameters.set('tab', section);
  const query = parameters.toString();
  return `#/${route.tab}${query ? `?${query}` : ''}`;
}
