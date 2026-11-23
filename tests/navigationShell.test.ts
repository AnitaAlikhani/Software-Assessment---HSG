import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { BottomNav } from '../src/components/BottomNav';
import { Header } from '../src/components/Header';
import { MoreSheet, initialsOf } from '../src/components/MoreSheet';
import { Sidebar } from '../src/components/Sidebar';
import { MORE_TABS, SCREEN_NAMES } from '../src/navigation';
import type { NavigationTab } from '../src/types';
import { demoCustomers, demoEvents, demoRequests } from './fixedClock';
import { readableText, render, TELL_WORDS, withScreen } from './renderHelpers';

// The frame around every owner screen: the menu on laptops, the bar on top, and on phones the
// tab bar with "More". Every place does one job, and nothing is on screen twice.

const nothing = () => {};
/** What the buttons of a piece of the frame are called, by their label or their text. */
const buttons = (html: string) => Array.from(html.matchAll(/<button([^>]*)>(.*?)<\/button>/g), ([, attributes, content]) =>
  /aria-label="([^"]*)"/.exec(attributes)?.[1] ?? content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

// ---------- the menu on laptops ----------

const sidebar = (partial: Partial<React.ComponentProps<typeof Sidebar>> = {}) => render(React.createElement(Sidebar, {
  companyName: 'Bella Hair Salon', companyLocation: 'St. Gallen, Switzerland', currentTab: 'home',
  onSelectTab: nothing, waitingCount: 0, onOpenPilotInterest: nothing, ...partial,
}));

test('the menu lists the nine screens in three groups, in sentence case, with plain group headings', () => {
  const html = sidebar();
  assert.deepEqual(buttons(html), ['Home', 'Calendar', 'Conversations', 'Customers', 'Team', 'Services', 'Analytics', 'AI receptionist', 'Settings']);
  // Two headings; the first group needs none. A heading is words only, so every icon stands for one screen.
  const headings = Array.from(html.matchAll(/<p id="menu-group-\d"[^>]*>(.*?)<\/p>/g), (match) => match[1]);
  assert.deepEqual(headings, ['Salon', 'Settings']);
  assert.equal(html.match(/<svg/g)?.length, 9 + 1); // nine entries and the product's mark
  assert.equal(html.match(/role="group" aria-labelledby="menu-group-\d"/g)?.length, 2);
  // What went: the booking page preview, Shift Plan and Employees as entries of their own, the rooms.
  assert.doesNotMatch(readableText(html), /Booking Page|Shift Plan|Employees|Rooms|Resources|Company Settings|Management/i);
  // It is a menu for laptops only: below 1024 px the tab bar and "More" take over, and it is no drawer.
  assert.match(html, /^<aside class="[^"]*\bhidden\b[^"]*\blg:flex\b/);
  assert.doesNotMatch(html, /role="dialog"|aria-modal|Close sidebar/);
});

test('the menu marks the open screen in one way, whichever group it is in', () => {
  const active = (tab: NavigationTab) => {
    const html = sidebar({ currentTab: tab });
    const marked = Array.from(html.matchAll(/<button type="button" aria-current="page" class="([^"]*)">(.*?)<\/button>/g));
    assert.equal(marked.length, 1, tab);
    assert.ok(marked[0][2].includes(`>${SCREEN_NAMES[tab]}<`), tab);
    return marked[0][1];
  };
  const styles = (Object.keys(SCREEN_NAMES) as NavigationTab[]).map(active);
  assert.equal(new Set(styles).size, 1, 'one active style');
  // A tint, the brand colour, semibold and a bar on the left. The text takes the darker brand
  // tone: the lighter one on the tint falls short of the contrast small text needs (4.3 to 1).
  assert.match(styles[0], /bg-\[#5551FF\]\/10/);
  assert.match(styles[0], /text-\[#433fd8\]/);
  assert.doesNotMatch(styles[0], /text-\[#5551FF\]/);
  assert.match(styles[0], /font-semibold/);
  assert.match(styles[0], /before:w-\[3px\]/);
});

test('the menu counts everything that waits on Home and the waiting chats on Conversations', () => {
  // Home's number is the one beside "Waiting for you" on Home itself: requests and chats together.
  const html = sidebar({ waitingCount: 6, needsAttentionCount: 1 });
  assert.match(html, />Home<\/span><span[^>]*>6<span class="sr-only"> waiting for you<\/span><\/span>/);
  assert.match(html, />Conversations<\/span><span[^>]*>1<span class="sr-only"> chat is waiting for you<\/span><\/span>/);
  assert.match(sidebar({ waitingCount: 1, needsAttentionCount: 4 }), />1<span class="sr-only"> waiting for you<\/span>.*>4<span class="sr-only"> chats are waiting for you<\/span>/s);
  // Nothing waiting, no badge.
  assert.doesNotMatch(sidebar(), /waiting for you|open request|needs? you/);
});

// ---------- the bar on top ----------

const header = (partial: Partial<React.ComponentProps<typeof Header>> = {}, research = false) => withScreen(() => render(React.createElement(Header, {
  title: 'Calendar', ownerName: 'Anna Weber', ownerRole: 'Owner', searchQuery: '', onSearchChange: nothing,
  customers: demoCustomers, appointmentRequests: demoRequests, calendarEvents: demoEvents, onSelectAppointment: nothing,
  onNewAppointment: nothing, onOpenAssistant: nothing, ...partial,
}), { research }));

test('the header has search, New appointment, the Assistant and a plain account block', () => {
  const html = header();
  // In reading order. "Close search" and "Search" belong to the phone's bar (see the next test).
  assert.deepEqual(buttons(html), ['Close search', 'Search', 'New appointment', 'Open assistant']);
  assert.match(html, /<input[^>]*id="header-search"[^>]*role="combobox"/);
  // "New appointment" is the one filled button of the bar, and it is the laptop's: phones have "+" below.
  const newAppointment = /<button type="button" class="([^"]*)">(?:<svg.*?<\/svg>)?New appointment<\/button>/.exec(html);
  assert.ok(newAppointment);
  assert.match(newAppointment[1], /\bhidden\b.*\blg:inline-flex\b/);
  assert.match(newAppointment[1], /bg-\[#5551FF\] /);
  assert.equal(html.match(/bg-\[#5551FF\] /g)?.length, 1, 'one primary action');
  // The account: who is signed in, as text. No button around it, no menu behind it.
  assert.match(html, /<p[^>]*><span class="sr-only">Signed in as <\/span><span[^>]*>Anna Weber<\/span><span[^>]*>Owner<\/span><\/p>/);
  // The role is small text on white: it wears the grey that is dark enough to read (4.8 to 1), not the paler one.
  assert.match(html, /<span class="[^"]*text-slate-500">Owner<\/span>/);
  assert.doesNotMatch(html, /text-slate-400">Owner</);
  assert.doesNotMatch(html, /aria-controls="header-account"|Account and salon settings|aria-haspopup="menu"/);
});

test('the bell, the chat shortcut, the hamburger and the account menu are gone', () => {
  const html = header();
  const text = readableText(html);
  assert.doesNotMatch(text, /Notifications|unread|Mark all as read|View all conversations/);
  assert.doesNotMatch(text, /Conversations|need attention/);
  assert.doesNotMatch(text, /navigation menu/);
  assert.doesNotMatch(text, /Company Settings/);
  assert.doesNotMatch(html, /mobile-menu-trigger|mobile-sidebar|header-notifications/);
  assert.doesNotMatch(text, TELL_WORDS);
});

test('phones get one slim bar: the mark, the name of the screen, a search button and the Assistant', () => {
  const html = header({ title: 'AI receptionist' });
  // One row of 56 px (h-14); on laptops the bar takes the height of its content.
  assert.match(html, /^<header class="[^"]*\bh-14\b[^"]*\blg:h-auto\b/);
  // The name of the screen is text next to the mark, not a second page heading.
  assert.match(html, /<span class="[^"]*\btruncate\b[^"]*">AI receptionist<\/span>/);
  assert.doesNotMatch(html, /<h1|<h2/);
  // The field is in the page but not on screen until the search button is used; laptops always show it.
  const field = /<div class="([^"]*)"><button type="button" aria-label="Close search"/.exec(html);
  assert.ok(field);
  assert.match(field[1], /\bhidden\b/);
  assert.match(field[1], /\blg:flex\b/);
  const search = /<button type="button" aria-label="Search" aria-expanded="false" aria-controls="header-search" class="([^"]*)"/.exec(html);
  assert.ok(search);
  assert.match(search[1], /\blg:hidden\b/);
  // Both buttons of the phone's bar are 44 px targets, and the field is 16 px text (no zoom on focus).
  assert.match(search[1], /\bh-11 w-11\b/);
  assert.match(/<button id="assistant-trigger"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '', /\bh-11 min-w-11\b/);
  assert.match(/<input[^>]*id="header-search"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '', /\btext-base\b/);
  // The account block is the laptop's; on a phone it is in "More".
  assert.match(html, /<div class="hidden [^"]*\blg:flex\b[^"]*"><span aria-hidden="true"[^>]*>AW<\/span>/);
});

test('the header works without an owner, without the Assistant and without New appointment', () => {
  const html = header({ ownerName: '', ownerRole: '', onOpenAssistant: undefined, onNewAppointment: undefined });
  assert.deepEqual(buttons(html), ['Close search', 'Search']);
  assert.doesNotMatch(html, /Signed in as/);
});

// ---------- the tab bar on phones ----------

const tabBar = (partial: Partial<React.ComponentProps<typeof BottomNav>> = {}) => render(React.createElement(BottomNav, {
  currentTab: 'home', onSelectTab: nothing, onNewAppointment: nothing, onOpenMore: nothing, isMoreOpen: false, homeBadge: 0, chatsBadge: 0, ...partial,
}));

test('the tab bar is Home, Calendar, + for a new appointment, Chats and More', () => {
  const html = tabBar();
  assert.deepEqual(buttons(html), ['Home', 'Calendar', 'New appointment', 'Chats', 'More']);
  assert.equal(html.match(/<li>/g)?.length, 5);
  assert.match(html, /^<nav aria-label="Quick navigation" class="[^"]*\blg:hidden\b/);
  // Every place is a full-height target; "+" is the one filled button.
  for (const control of html.match(/<button\b[^>]*>/g) ?? []) assert.match(control, /\bh-16 w-full\b/, control);
  assert.match(html, /aria-label="New appointment" title="New appointment"[^>]*><span class="[^"]*\bh-12 w-12\b[^"]*\bbg-\[#5551FF\]/);
  // Customers moved to "More"; search finds them from every screen.
  assert.doesNotMatch(html, /Customers/);
});

test('the tab bar keeps the counts on Home and Chats and marks where the owner is', () => {
  const html = tabBar({ currentTab: 'conversations', homeBadge: 2, chatsBadge: 12 });
  // The number is drawn on the icon, and read out after the name of the tab with the full count.
  assert.match(html, /<span aria-hidden="true"[^>]*>2<\/span><\/span>Home<span class="sr-only">, 2 waiting for you<\/span><\/button>/);
  assert.match(html, /<span aria-hidden="true"[^>]*>9\+<\/span><\/span>Chats<span class="sr-only">, 12 chats are waiting for you<\/span><\/button>/);
  assert.match(tabBar({ homeBadge: 1, chatsBadge: 1 }), /Home<span class="sr-only">, 1 waiting for you<\/span>.*Chats<span class="sr-only">, 1 chat is waiting for you<\/span>/s);
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
  assert.match(html, /aria-current="page"[^>]*>(?:(?!<\/button>).)*Chats<span class="sr-only">[^<]*<\/span><\/button>/);
  // On a screen that is not in the bar, "More" is the marked place.
  const elsewhere = tabBar({ currentTab: 'team' });
  assert.doesNotMatch(elsewhere, /aria-current="page"/);
  assert.match(/<button id="more-trigger"[^>]*class="([^"]*)"/.exec(elsewhere)?.[1] ?? '', /text-\[#5551FF\]/);
  assert.doesNotMatch(/<button id="more-trigger"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '', /text-\[#5551FF\]/);
  // Inside an open chat the reply box needs the bottom of a phone's screen.
  assert.match(tabBar({ hideOnPhone: true }), /^<nav aria-label="Quick navigation" class="hidden md:block /);
});

test('"More" says that it opens a sheet, and whether the sheet is open', () => {
  assert.match(tabBar(), /<button id="more-trigger" type="button" aria-haspopup="dialog" aria-expanded="false" class=/);
  assert.match(tabBar({ isMoreOpen: true }), /<button id="more-trigger" type="button" aria-haspopup="dialog" aria-expanded="true" aria-controls="more-sheet"/);
});

// ---------- the "More" sheet ----------

const more = (partial: Partial<React.ComponentProps<typeof MoreSheet>> = {}) => render(React.createElement(MoreSheet, {
  isOpen: true, onClose: nothing, currentTab: 'home', onSelectTab: nothing,
  ownerName: 'Anna Weber', ownerRole: 'Owner', companyName: 'Bella Hair Salon', onOpenPilotInterest: nothing, ...partial,
}));

test('"More" lists only what the tab bar lacks, and shows who is signed in', () => {
  const html = more();
  assert.deepEqual(buttons(html), ['Close menu', 'Customers', 'Team', 'Services', 'Analytics', 'AI receptionist', 'Settings']);
  assert.deepEqual(buttons(html).slice(1), MORE_TABS.map((tab) => SCREEN_NAMES[tab]));
  // Home, Calendar and Chats are one tap away in the bar: they are not repeated.
  assert.doesNotMatch(readableText(html), /\b(Home|Calendar|Chats|Conversations)\b/);
  assert.match(html, /<span class="sr-only">Signed in as <\/span><span[^>]*>Anna Weber<\/span><span[^>]*>Owner · Bella Hair Salon<\/span>/);
  assert.match(html, /<span aria-hidden="true"[^>]*>AW<\/span>/);
  // A proper sheet: a dialog with a name, which the tab bar's button points to.
  assert.match(html, /^<dialog id="more-sheet" aria-labelledby="more-sheet-title"/);
  assert.match(html, /<h2 id="more-sheet-title" class="sr-only">More<\/h2>/);
  // Rows of at least 48 px, the close button 44 px.
  for (const row of html.match(/<button type="button" (?:aria-current="page" )?class="flex min-h-12[^"]*"/g) ?? []) assert.match(row, /min-h-12 w-full/);
  assert.equal(html.match(/class="flex min-h-12 w-full/g)?.length, 6);
  assert.match(html, /aria-label="Close menu" class="[^"]*\bh-11 w-11\b/);
  assert.doesNotMatch(readableText(html), TELL_WORDS);
});

test('"More" marks the open screen and draws nothing while it is closed', () => {
  const html = more({ currentTab: 'team' });
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
  assert.match(html, /aria-current="page"[^>]*>.*?<span class="min-w-0 flex-1">Team<\/span>/);
  // On the tint the open screen is written in the darker brand tone, as in the laptop's menu.
  assert.match(html, /aria-current="page" class="[^"]*bg-\[#5551FF\]\/10 font-semibold text-\[#433fd8\]/);
  assert.equal(more({ isOpen: false }), '');
  // Without a name there is still a line, and no role is made up.
  const anonymous = more({ ownerName: '', ownerRole: '', companyName: '' });
  assert.match(anonymous, />Account<\/span>/);
  assert.doesNotMatch(anonymous, /Owner/);
});

test('initials are the first letters of up to two names', () => {
  assert.equal(initialsOf('Anna Weber'), 'AW');
  assert.equal(initialsOf('  selina   keller-graf  '), 'SK');
  assert.equal(initialsOf('Luca'), 'L');
  assert.equal(initialsOf('Anna Maria Weber'), 'AM');
  assert.equal(initialsOf(''), '');
});
