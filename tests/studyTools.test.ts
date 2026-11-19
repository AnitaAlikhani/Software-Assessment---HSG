import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { PilotInterest } from '../src/components/PilotInterest';
import { Sidebar } from '../src/components/Sidebar';
import { AccountMenu, Header } from '../src/components/Header';
import { HomeView } from '../src/views/HomeView';
import { ConversationsView } from '../src/views/ConversationsView';
import { WAITLIST_FORM_URL } from '../src/config';
import { initialAiSettings } from '../src/conversationData';
import { readResearchMode, setResearchModeForTests } from '../src/flags';
import { websiteChatUrl } from '../src/liveWhatsApp';
import { clearDemoWorkspace, PILOT_BANNER_DISMISSED_KEY } from '../src/researchTools';
import { demoStorageKey } from '../src/useDemoState';
import type { Conversation } from '../src/types';
import { readableText, render, withScreen } from './renderHelpers';

// Study tools (pilot banner, "Register interest", "Simulate incoming booking", the live-test strip,
// the demo notice) are for the team's studies. A normal visitor must not see any of them; a study
// link (?research=1) brings them back. Each test renders the same screen both ways.

const nothing = () => {};

test('the pilot banner and its interest form appear only on a study link', () => {
  const banner = React.createElement(PilotInterest, { isOpen: false, onOpen: nothing, onClose: nothing });
  assert.equal(render(banner), '');
  const study = render(banner, { research: true });
  assert.match(study, /Interested in a future pilot\?/);
  assert.match(study, />Register interest</);
  // The form is always a link the visitor opens themselves; nothing is sent in the background.
  assert.match(study, /Open interest form/);
  assert.ok(study.includes(`href="${WAITLIST_FORM_URL}"`));
});

const sidebar = React.createElement(Sidebar, {
  companyName: 'Lumière Salon', companyLocation: 'Zürich, Switzerland', currentTab: 'home',
  onSelectTab: nothing, isOpenMobile: false, onCloseMobile: nothing, pendingRequestsCount: 0, onOpenPilotInterest: nothing,
});

test('the menu offers "Register interest" only on a study link', () => {
  assert.doesNotMatch(render(sidebar), /Register interest/);
  assert.match(render(sidebar, { research: true }), />\s*Register interest\s*</);
});

test('the menu hides the unfinished Resources page and keeps what booking depends on', () => {
  const html = render(sidebar);
  assert.doesNotMatch(html, />Resources</);
  for (const page of ['Services', 'Employees', 'Shift Plan', 'Company Settings', 'AI receptionist']) {
    assert.match(html, new RegExp(`>${page}<`));
  }
  // The settings of the customer-facing AI are not called "Assistant": that is the owner's helper in the header.
  assert.doesNotMatch(html, /AI Assistant/);
  // One salon card: it takes its letter from the salon's name and leads to the salon's settings.
  assert.equal(html.match(/>L</g)?.length, 1);
  assert.doesNotMatch(html, />\s*B\s*</);
  assert.equal(html.match(/Open Company Settings/g)?.length, 2); // tooltip and screen-reader text of the one card
});

const home: React.ComponentProps<typeof HomeView> = {
  // Monday 5 October 2026, 12:00 in Zurich, as in tests/fixedClock.ts: Home names the month it counts.
  requests: [], selectedRequestId: null, onSelectRequest: nothing, now: new Date('2026-10-05T10:00:00Z'),
  availabilityContext: { requests: [], events: [], services: [], employees: [], bookingHours: [], shiftOverview: [] },
  onAcceptRequest: nothing, onRejectRequest: nothing, onMoveRequest: () => null,
  onSimulateNewRequest: nothing, onOpenBookingPage: nothing, onNewAppointment: nothing,
  nextAppointment: null, onOpenAppointment: nothing,
  onExportReport: nothing, conversations: [], onOpenConversations: nothing,
};

test('an empty request list on Home reads as a product; simulating a booking is a study tool', () => {
  const html = render(React.createElement(HomeView, home));
  assert.match(html, /All requests handled/);
  assert.match(html, /New booking requests appear here as they come in\./);
  assert.match(html, />Open booking page</);
  assert.match(html, />New appointment</);
  assert.doesNotMatch(html, /Simulate incoming booking/);
  assert.doesNotMatch(html, /WhatsApp and Instagram/);
  assert.match(render(React.createElement(HomeView, home), { research: true }), /Simulate incoming booking/);
});

test('Home offers a next step only when it leads somewhere', () => {
  const html = render(React.createElement(HomeView, { ...home, onOpenBookingPage: undefined, onNewAppointment: undefined }));
  assert.match(html, /All requests handled/);
  assert.doesNotMatch(html, /Open booking page/);
  assert.doesNotMatch(html, /New appointment/);
});

const header: React.ComponentProps<typeof Header> = {
  companyName: 'Bella Hair Salon', companyLocation: 'St. Gallen', ownerName: 'Anna Weber', ownerRole: 'Owner',
  onOpenMobileMenu: nothing, isMobileMenuOpen: false, searchQuery: '', onSearchChange: nothing,
  customers: [], appointmentRequests: [], calendarEvents: [], onSelectAppointment: nothing,
  needsAttentionCount: 0, needsAttentionNames: [], latestAiBooking: null,
  onOpenConversations: nothing, onOpenSettings: nothing,
};

test('the header shows the person it is given and no checkout; the demo notice is a study tool', () => {
  const html = withScreen(() => render(React.createElement(Header, header)));
  assert.match(html, />AW</);
  assert.match(html, />Anna</);
  assert.match(html, />Owner</);
  assert.doesNotMatch(readableText(html), /POS|cash register|checkout|demo/i);
  const study = withScreen(() => render(React.createElement(Header, header), { research: true }));
  assert.match(study, /title="Changes stay in this browser tab"/);
  assert.match(readableText(study), /Demo\s+workspace\s+· sample data/);
});

const accountMenu = React.createElement(AccountMenu, {
  ownerName: 'Anna Weber', ownerRole: 'Owner', companyName: 'Bella Hair Salon', companyLocation: 'St. Gallen', onOpenSettings: nothing,
});

test('the account menu names the owner and holds only entries that lead somewhere', () => {
  const html = render(accountMenu);
  assert.match(html, />Anna Weber</);
  assert.match(html, />Owner · Bella Hair Salon · St\. Gallen</);
  // One entry: Company Settings. Profile, billing, help or log-out come with their pages.
  assert.equal(html.match(/<button/g)?.length, 1);
  assert.match(html, />Company Settings</);
  assert.doesNotMatch(readableText(html), /simulated|demo|this tab/i);
});

test('"Reset demo data" is offered only on a study link', () => {
  assert.doesNotMatch(render(accountMenu), /Reset demo data/);
  const study = render(accountMenu, { research: true });
  assert.match(study, />Reset demo data</);
  assert.match(study, /Demo workspace with sample data\. Changes stay in this browser tab\./);
});

const liveChat: Conversation = {
  id: 'live-web-abc123def456', live: true, customerName: 'Tomás', initials: 'T', avatarColor: 'bg-green-100 text-green-700',
  language: 'EN', languageLabel: 'Spanish', phone: 'Test visitor', channel: 'Website', status: 'ai-handled', lastTime: '10:02',
  messages: [{ id: 'm1', sender: 'customer', original: 'Hola', translation: 'Hello', time: '10:02' }],
};
const inbox: React.ComponentProps<typeof ConversationsView> = {
  conversations: [liveChat], selectedId: liveChat.id, mobileDetailOpen: false,
  onBackToList: nothing, onSelect: nothing, onTakeOver: nothing, onLetAiContinue: () => null, onOwnerReply: () => true,
  aiSettings: initialAiSettings, onOpenAiSettings: nothing,
  liveChannels: { telegram: 'slotbee_bella_bot', websiteChatUrl: 'https://example.test/?chat=1&live=owner-key' },
};

test('the live-test strip and the "Live" mark are for moderators only', () => {
  const html = render(React.createElement(ConversationsView, inbox));
  assert.doesNotMatch(html, /Live test/);
  assert.doesNotMatch(html, />Live</);
  assert.doesNotMatch(html, /@slotbee_bella_bot/);
  // The website chat link carries the owner's access key: a normal visitor's page never contains it.
  assert.doesNotMatch(html, /owner-key|chat=1/);
  const study = render(React.createElement(ConversationsView, inbox), { research: true });
  assert.match(study, /Live test is on/);
  assert.match(study, />Live</);
  assert.match(study, /@slotbee_bella_bot/);
});

test('the website-chat link for testers switches the study tools on for them too', () => {
  // The owner copies this link in the live-test strip. A tester who opens it must read the study
  // notice, so the link carries the switch whenever the owner's own study tools are on.
  const study = websiteChatUrl('https://slotbee.example', 'owner key/1', true);
  assert.equal(study, 'https://slotbee.example/?chat=1&live=owner%20key%2F1&research=1');
  const address = new URL(study);
  assert.equal(address.searchParams.get('chat'), '1');
  assert.equal(address.searchParams.get('live'), 'owner key/1');
  // The customer chat reads the switch from its address in the same way as every other page.
  assert.equal(readResearchMode(address.search, null), true);
  // Without study tools the link is the plain chat link, with the salon's wording.
  const plain = websiteChatUrl('https://slotbee.example', 'owner key/1', false);
  assert.equal(plain, 'https://slotbee.example/?chat=1&live=owner%20key%2F1');
  assert.equal(readResearchMode(new URL(plain).search, null), false);
  // Left to itself, the link follows the switch of the browser it is made in.
  try {
    setResearchModeForTests(true);
    assert.match(websiteChatUrl('https://slotbee.example', 'key'), /&research=1$/);
    setResearchModeForTests(false);
    assert.doesNotMatch(websiteChatUrl('https://slotbee.example', 'key'), /research/);
  } finally {
    setResearchModeForTests(undefined);
  }
});

const storage = (entries: Record<string, string>) => {
  const values = new Map(Object.entries(entries));
  return {
    values,
    get length() { return values.size; },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
  };
};

test('"Reset demo data" forgets the sample workspace and keeps the study link and the live key', () => {
  const session = storage({
    [demoStorageKey('requests', '/')]: '[]',
    [demoStorageKey('conversations', '/previews/x/')]: '[]',
    [PILOT_BANNER_DISMISSED_KEY]: 'true',
  });
  const local = storage({ 'slotbee-research': '1', 'slotbee-live-key': 'key', 'slotbee-chat-session': 'abc' });
  const blocked = { get length(): number { throw new Error('blocked'); }, key: () => null, removeItem: () => {} };
  assert.equal(clearDemoWorkspace([session, local, null, blocked]), 3);
  assert.equal(session.values.size, 0);
  assert.deepEqual(Array.from(local.values.keys()), ['slotbee-research', 'slotbee-live-key', 'slotbee-chat-session']);
});
