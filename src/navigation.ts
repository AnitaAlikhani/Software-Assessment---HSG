import type { NavigationTab } from './types';

export interface AppRoute {
  tab: NavigationTab;
  requestId?: string;
  customerId?: string;
  appointmentId?: string;
  conversationId?: string;
}

const tabs: NavigationTab[] = ['home', 'calendar', 'booking-page', 'shift-plan', 'customers', 'resources', 'employees', 'services', 'analytics', 'conversations', 'ai-assistant', 'settings'];
const targetForTab = { home: 'requestId', customers: 'customerId', calendar: 'appointmentId', conversations: 'conversationId' } as const;

export function parseRoute(hash: string): AppRoute {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const tab = tabs.includes(path as NavigationTab) ? path as NavigationTab : 'home';
  const key = targetForTab[tab as keyof typeof targetForTab];
  const id = key ? new URLSearchParams(query).get(key) : null;
  return id ? { tab, [key]: id } : { tab };
}

export function routeHash(route: AppRoute): string {
  const key = targetForTab[route.tab as keyof typeof targetForTab];
  const id = key && route[key];
  const query = id ? `?${new URLSearchParams({ [key]: id })}` : '';
  return `#/${route.tab}${query}`;
}
