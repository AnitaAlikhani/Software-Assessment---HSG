import assert from 'node:assert/strict';
import test from 'node:test';
import { CALENDAR_VIEWS, MENU_GROUPS, MORE_TABS, SCREEN_NAMES, SETTINGS_TABS, TAB_BAR_TABS, TEAM_TABS, calendarPlace, isOldAddress, parseRoute, routeForTab, routeHash, type AppRoute } from '../src/navigation';
import { nextUpcomingAppointment } from '../src/dashboard';
import { demoEvents } from './fixedClock';

test('search routes retain exact record IDs across navigation', () => {
  for (const route of [
    { tab: 'home' as const, requestId: 'req-2' },
    { tab: 'customers' as const, customerId: 'customer & 2' },
    { tab: 'calendar' as const, appointmentId: 'cal-2' },
    { tab: 'conversations' as const, conversationId: 'conv-2' },
  ]) assert.deepEqual(parseRoute(routeHash(route)), route);
});

test('unknown routes fall back and unrelated selection IDs are ignored', () => {
  assert.deepEqual(parseRoute('#/missing'), { tab: 'home' });
  assert.deepEqual(parseRoute('#/constructor'), { tab: 'home' });
  assert.deepEqual(parseRoute('#/customers?appointmentId=cal-2'), { tab: 'customers' });
  assert.deepEqual(parseRoute(''), { tab: 'home' });
});

test('the menu has nine screens in three groups, each under one name in sentence case', () => {
  assert.deepEqual(MENU_GROUPS.map((group) => [group.heading, group.tabs.map((tab) => SCREEN_NAMES[tab])]), [
    [undefined, ['Home', 'Calendar', 'Conversations', 'Customers']],
    ['Salon', ['Team', 'Services', 'Analytics']],
    ['Settings', ['AI receptionist', 'Settings']],
  ]);
  // Every screen is in the menu exactly once, and no two share a name.
  const inMenu = MENU_GROUPS.flatMap((group) => group.tabs);
  assert.deepEqual([...inMenu].sort(), Object.keys(SCREEN_NAMES).sort());
  assert.equal(new Set(Object.values(SCREEN_NAMES)).size, 9);
  // Sentence case: one capital at the start, except for the abbreviation "AI".
  for (const name of Object.values(SCREEN_NAMES)) assert.match(name, /^(AI )?[A-Z]?[a-z]+( [a-z]+)*$/, name);
  // What went: the booking page preview, the shift plan and the employees as screens of their own, and the rooms.
  assert.doesNotMatch(Object.values(SCREEN_NAMES).join('|'), /Booking|Shift|Employees|Rooms|Company/);
});

test('the tab bar on phones opens three screens and "More" lists exactly the other six', () => {
  assert.deepEqual(TAB_BAR_TABS, ['home', 'calendar', 'conversations']);
  assert.deepEqual(MORE_TABS.map((tab) => SCREEN_NAMES[tab]), ['Customers', 'Team', 'Services', 'Analytics', 'AI receptionist', 'Settings']);
  // Together they reach every screen: one tap from the bar, two through "More".
  assert.deepEqual([...TAB_BAR_TABS, ...MORE_TABS].sort(), Object.keys(SCREEN_NAMES).sort());
  assert.ok(MORE_TABS.every((tab) => !TAB_BAR_TABS.includes(tab)));
});

test('Team and Settings keep their open tab in the address, and a page opens on its first tab', () => {
  assert.deepEqual(TEAM_TABS.map((tab) => tab.label), ['People', 'This week', 'Absences']);
  assert.deepEqual(SETTINGS_TABS.map((tab) => tab.label), ['Salon', 'Opening hours', 'Closed dates', 'Online booking']);
  for (const route of [
    { tab: 'team' as const, section: 'week' as const },
    { tab: 'team' as const, section: 'absences' as const },
    { tab: 'settings' as const, section: 'hours' as const },
    { tab: 'settings' as const, section: 'online-booking' as const },
  ]) assert.deepEqual(parseRoute(routeHash(route)), route);
  assert.equal(routeHash({ tab: 'team', section: 'week' }), '#/team?tab=week');
  assert.equal(routeHash({ tab: 'settings', section: 'online-booking' }), '#/settings?tab=online-booking');
  // The first tab needs no mark: the plain address is the page.
  assert.equal(routeHash({ tab: 'team', section: 'people' }), '#/team');
  assert.equal(routeHash({ tab: 'settings', section: 'salon' }), '#/settings');
  assert.deepEqual(parseRoute('#/team?tab=people'), { tab: 'team' });
  assert.deepEqual(parseRoute('#/team'), { tab: 'team' });
  // A tab that the page does not have, or that belongs to the other page, is ignored.
  assert.deepEqual(parseRoute('#/team?tab=hours'), { tab: 'team' });
  assert.deepEqual(parseRoute('#/settings?tab=week'), { tab: 'settings' });
  assert.deepEqual(parseRoute('#/calendar?tab=week'), { tab: 'calendar' });
  assert.equal(routeHash({ tab: 'calendar', section: 'week' }), '#/calendar');
});

test('the calendar keeps its view, day and filters in the address, and reads them back', () => {
  assert.deepEqual(CALENDAR_VIEWS.map((view) => [view.id, view.label]), [['day', 'Day'], ['week', 'Week'], ['list', 'List']]);
  // The address of the task: a day view, a day, a stylist and a service.
  const full: AppRoute = { tab: 'calendar', view: 'day', date: '2026-11-19', staff: 'emp-2', service: 'srv-3' };
  assert.equal(routeHash(full), '#/calendar?view=day&date=2026-11-19&staff=emp-2&service=srv-3');
  assert.deepEqual(parseRoute('#/calendar?view=day&date=2026-11-19&staff=emp-2&service=srv-3'), full);
  // Every combination comes back as it went out: reload, Back and a shared link restore it.
  const places: AppRoute[] = [
    { tab: 'calendar' },
    { tab: 'calendar', view: 'week' },
    { tab: 'calendar', view: 'list', date: '2026-12-31' },
    { tab: 'calendar', date: '2027-01-01' },
    { tab: 'calendar', staff: 'emp-1' },
    { tab: 'calendar', service: 'srv-10', view: 'day' },
    { tab: 'calendar', staff: 'name:Maria Rossi & Co.', service: 'srv 1/2' },
    { tab: 'calendar', view: 'day', date: '2026-11-19', staff: 'emp-2', service: 'srv-3', appointmentId: 'cal-2' },
  ];
  for (const place of places) assert.deepEqual(parseRoute(routeHash(place)), place, routeHash(place));
  // What the calendar decides itself is left out: the plain address is today, in the view that fits the screen.
  assert.equal(routeHash({ tab: 'calendar' }), '#/calendar');
  assert.equal(routeHash({ tab: 'calendar', view: undefined, date: undefined, staff: '', service: '' }), '#/calendar');
  // An appointment's details keep their address, with or without the place around them.
  assert.equal(routeHash({ tab: 'calendar', appointmentId: 'cal-2' }), '#/calendar?appointmentId=cal-2');
  assert.equal(routeHash({ tab: 'calendar', view: 'week', date: '2026-11-19', appointmentId: 'cal-2' }), '#/calendar?view=week&date=2026-11-19&appointmentId=cal-2');
  assert.deepEqual(parseRoute('#/calendar?appointmentId=cal-2&date=2026-11-19'), { tab: 'calendar', date: '2026-11-19', appointmentId: 'cal-2' });
});

test('an address may carry anything: the calendar takes only a view it has and a day that exists', () => {
  assert.deepEqual(parseRoute('#/calendar?view=month&date=2026-11-19'), { tab: 'calendar', date: '2026-11-19' });
  assert.deepEqual(parseRoute('#/calendar?view=Day'), { tab: 'calendar' });
  for (const day of ['2026-02-30', '2026-13-01', '19.11.2026', '2026-11-19T10:00', 'today', '']) {
    assert.deepEqual(parseRoute(`#/calendar?view=week&date=${encodeURIComponent(day)}`), { tab: 'calendar', view: 'week' }, day);
  }
  assert.deepEqual(parseRoute('#/calendar?staff=&service='), { tab: 'calendar' });
  // The same check writes an address, so a route that holds nonsense never produces a link that cannot be read.
  assert.equal(routeHash({ tab: 'calendar', view: 'month' as never, date: '2026-02-30' }), '#/calendar');
  assert.deepEqual(calendarPlace({ view: 'list', date: '2026-11-19', staff: null, service: undefined }), { view: 'list', date: '2026-11-19' });
  // The calendar's words mean nothing on other screens, in both directions.
  assert.deepEqual(parseRoute('#/home?view=day&date=2026-11-19&staff=emp-2'), { tab: 'home' });
  assert.deepEqual(parseRoute('#/customers?date=2026-11-19&customerId=c-1'), { tab: 'customers', customerId: 'c-1' });
  assert.equal(routeHash({ tab: 'team', view: 'day', date: '2026-11-19', staff: 'emp-2', section: 'week' }), '#/team?tab=week');
});

test('the addresses of screens that moved lead to their new place', () => {
  const leadsTo = (old: string) => routeHash(parseRoute(old));
  assert.equal(leadsTo('#/employees'), '#/team');
  assert.equal(leadsTo('#/shift-plan'), '#/team?tab=week');
  assert.equal(leadsTo('#/booking-page'), '#/settings?tab=online-booking');
  assert.equal(leadsTo('#/resources'), '#/home');
  // Also when something is attached to the old address.
  assert.equal(leadsTo('#/shift-plan?week=2026-10-05'), '#/team?tab=week');
  for (const old of ['#/employees', '#/shift-plan', '#/booking-page', '#/resources', '#resources']) assert.equal(isOldAddress(old), true, old);
  for (const current of ['', '#/home', '#/team', '#/team?tab=week', '#/settings?tab=online-booking', '#/missing', '#/constructor']) assert.equal(isOldAddress(current), false, current);
  // A part of the app that still asks for a screen by its old name gets the new place too.
  assert.deepEqual(routeForTab('booking-page'), { tab: 'settings', section: 'online-booking' });
  assert.deepEqual(routeForTab('shift-plan'), { tab: 'team', section: 'week' });
  assert.deepEqual(routeForTab('customers'), { tab: 'customers' });
  // The answer is a route of its own each time: changing it does not change where the address leads.
  routeForTab('employees').tab = 'home';
  assert.deepEqual(parseRoute('#/employees'), { tab: 'team' });
});

test('next appointment is derived from the earliest upcoming calendar record', () => {
  const base = demoEvents[0];
  const events = [
    { ...base, id: 'later', date: '2026-10-15', startTime: '09:00' },
    { ...base, id: 'past', date: '2026-10-14', startTime: '10:00' },
    { ...base, id: 'next', date: '2026-10-14', startTime: '15:00' },
  ];
  const now = new Date('2026-10-14T12:00:00Z'); // 14:00 in Zurich
  assert.equal(nextUpcomingAppointment(events, now)?.id, 'next');
  assert.equal(nextUpcomingAppointment(events.filter(e => e.id !== 'next'), now)?.id, 'later');
  assert.equal(nextUpcomingAppointment(events.filter(e => e.id === 'past'), now), null);
  assert.equal(nextUpcomingAppointment([], now), null);
});

test('next appointment uses salon timezone across midnight and does not mutate calendar order', () => {
  const events = [{ ...demoEvents[0], id: 'tomorrow', date: '2026-10-15', startTime: '00:30' }];
  assert.equal(nextUpcomingAppointment(events, new Date('2026-10-14T22:45:00Z')), null);
  assert.equal(events[0].id, 'tomorrow');
});
