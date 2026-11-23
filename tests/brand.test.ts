import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { PRODUCT_NAME } from '../src/brand';
import { Header } from '../src/components/Header';
import { Logo, MARK_CELL, MARK_CHECK, PoweredBy } from '../src/components/Logo';
import { Sidebar } from '../src/components/Sidebar';
import { SCREEN_NAMES } from '../src/navigation';
import {
  applyPageHead, bookingPageHead, chatPageHead, ownerPageHead, PRODUCT_COLOR, type HeadDocument,
} from '../src/pageHead';
import type { NavigationTab } from '../src/types';
import { readableText, render, withScreen } from './renderHelpers';

// One identity: the product is SlotBee everywhere (logo, browser tab, icons, link preview), the
// salon is the workspace inside it, and the salon's own pages for customers carry the salon's
// name. These tests read the project's files from disk; none of them uses the network.

const file = (path: string) => new URL(`../${path}`, import.meta.url);
const text = (path: string) => readFileSync(file(path), 'utf8');
/** Width and height of a PNG, read from its header. */
const pngSize = (path: string) => {
  const bytes = readFileSync(file(path));
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${path} is a PNG`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
};
const nothing = () => {};

// ---------- logo ----------

test('the logo is one image named after the product, drawn like the icon in the browser tab', () => {
  const html = render(React.createElement(Logo));
  assert.match(html, new RegExp(`^<span role="img" aria-label="${PRODUCT_NAME}"`));
  assert.ok(html.includes(`>${PRODUCT_NAME}</span>`));
  assert.match(html, /<svg[^>]*aria-hidden="true"/);

  // The tab icon is the same drawing in the same two colours as the tokens in index.css.
  const icon = text('public/favicon.svg');
  assert.ok(icon.includes(`d="${MARK_CELL}"`));
  assert.ok(icon.includes(`d="${MARK_CHECK}"`));
  const css = text('src/index.css');
  const token = (name: string) => new RegExp(`--color-${name}: (#[0-9A-Fa-f]{6});`).exec(css)?.[1];
  assert.equal(token('brand'), PRODUCT_COLOR);
  assert.ok(icon.includes(`fill="${PRODUCT_COLOR}"`));
  assert.ok(icon.includes(`stroke="${token('honey')}"`));
});

test('the line on customer pages names the product and is no link', () => {
  const html = render(React.createElement(PoweredBy));
  assert.match(readableText(html), new RegExp(`Powered by\\s+${PRODUCT_NAME}`));
  assert.doesNotMatch(html, /<a\s|<button|href=/);
});

// ---------- owner app: product on top, salon as workspace ----------

const sidebar = (companyName: string, companyLocation = 'Zürich, Switzerland') => render(React.createElement(Sidebar, {
  companyName, companyLocation, currentTab: 'home', onSelectTab: nothing, waitingCount: 0, onOpenPilotInterest: nothing,
}));

test('the menu shows the product on top and the salon from Settings as the workspace under it', () => {
  const html = sidebar('Lumière Salon');
  const logo = html.indexOf(`aria-label="${PRODUCT_NAME}"`);
  const salon = html.indexOf('>Lumière Salon<');
  const firstEntry = html.indexOf('>Home<');
  assert.ok(logo >= 0 && logo < salon && salon < firstEntry, 'logo, then workspace, then the pages');
  assert.match(html, />Zürich, Switzerland</);
  // Name and letter follow the settings: nothing of the sample salon is written into the menu.
  assert.doesNotMatch(html, /Bella/);
  const renamed = sidebar('Coiffeur Keller', '');
  assert.match(renamed, />Coiffeur Keller</);
  assert.equal(renamed.match(/>C</g)?.length, 1);
  assert.doesNotMatch(renamed, />L</);
});

const header: React.ComponentProps<typeof Header> = {
  title: 'Calendar', ownerName: 'Anna Weber', ownerRole: 'Owner', searchQuery: '', onSearchChange: nothing,
  customers: [], appointmentRequests: [], calendarEvents: [], onSelectAppointment: nothing,
};

test('phones and tablets, which show no menu, get the product\'s mark and the name of the screen in the top bar', () => {
  const html = withScreen(() => render(React.createElement(Header, header)));
  // The mark is the logo without its written name: one image called by the product's name.
  const bar = new RegExp(`<div class="([^"]*)"><span role="img" aria-label="${PRODUCT_NAME}"[^>]*>.*?</span><span class="[^"]*">Calendar</span>`).exec(html);
  assert.ok(bar, 'mark, then the name of the screen');
  assert.match(html, new RegExp(`aria-label="${PRODUCT_NAME}"[^>]*><svg[^>]*>.*?</svg><span class="[^"]*\\bhidden\\b[^"]*">${PRODUCT_NAME}</span>`));
  // From the width where the menu is on screen, the logo in the menu is the only one.
  assert.match(bar[1], /\blg:hidden\b/);
  assert.equal(html.split(`aria-label="${PRODUCT_NAME}"`).length - 1, 1);
  // On a study link the mark stays, and the notice stands next to the name of the screen.
  const study = withScreen(() => render(React.createElement(Header, header), { research: true }));
  assert.match(study, new RegExp(`aria-label="${PRODUCT_NAME}"`));
});

// ---------- browser tab ----------

test('the owner\'s browser tab names the screen, the salon and the product', () => {
  const salon = 'Bella Hair Salon';
  assert.equal(ownerPageHead('calendar', salon).title, 'Calendar · Bella Hair Salon – SlotBee');
  assert.equal(ownerPageHead('home', salon).title, 'Home · Bella Hair Salon – SlotBee');
  assert.equal(ownerPageHead('conversations', salon).title, 'Conversations · Bella Hair Salon – SlotBee');
  assert.equal(ownerPageHead('ai-assistant', salon).title, 'AI receptionist · Bella Hair Salon – SlotBee');
  assert.equal(ownerPageHead('settings', salon).title, 'Settings · Bella Hair Salon – SlotBee');
  assert.equal(ownerPageHead('team', salon).title, 'Team · Bella Hair Salon – SlotBee');
  // The salon's name is whatever Settings holds, also none at all.
  assert.equal(ownerPageHead('calendar', ' Coiffeur Keller ').title, 'Calendar · Coiffeur Keller – SlotBee');
  assert.equal(ownerPageHead('calendar', '').title, 'Calendar – SlotBee');
  // While something waits for the owner on Home, its number stands in front on every screen, so a
  // tab in the background shows it. Nobody waiting, or a number that is none, adds nothing.
  assert.equal(ownerPageHead('home', salon, 3).title, '(3) Home · Bella Hair Salon – SlotBee');
  assert.equal(ownerPageHead('calendar', salon, 12).title, '(12) Calendar · Bella Hair Salon – SlotBee');
  assert.equal(ownerPageHead('calendar', '', 1).title, '(1) Calendar – SlotBee');
  for (const none of [0, -1, Number.NaN]) assert.equal(ownerPageHead('home', salon, none).title, 'Home · Bella Hair Salon – SlotBee');

  // Every screen of the menu, under the name the menu gives it.
  const tabs = Object.keys(SCREEN_NAMES) as NavigationTab[];
  assert.equal(tabs.length, 9);
  for (const tab of tabs) assert.equal(ownerPageHead(tab, salon).title, `${SCREEN_NAMES[tab]} · Bella Hair Salon – SlotBee`);
  const titles = tabs.map(tab => ownerPageHead(tab, salon).title);
  assert.equal(new Set(titles).size, tabs.length, 'every screen has a title of its own');
  for (const title of titles) assert.match(title, /^\S.* · Bella Hair Salon – SlotBee$/);
  assert.ok(tabs.every(tab => ownerPageHead(tab, salon).ownerApp && ownerPageHead(tab, salon).homeScreenName === PRODUCT_NAME));
});

test('the customers\' pages are titled with the salon\'s name, not the product\'s', () => {
  const booking = bookingPageHead('Bella Hair Salon');
  const chat = chatPageHead('Bella Hair Salon', '#075e54');
  assert.equal(booking.title, 'Book an appointment – Bella Hair Salon');
  assert.equal(chat.title, 'Chat with Bella Hair Salon');
  for (const head of [booking, chat]) {
    assert.equal(head.homeScreenName, 'Bella Hair Salon');
    assert.equal(head.ownerApp, false);
    assert.doesNotMatch(`${head.title} ${head.homeScreenName}`, new RegExp(PRODUCT_NAME));
  }
  assert.equal(chat.themeColor, '#075e54');
  assert.equal(chatPageHead('Bella Hair Salon').themeColor, PRODUCT_COLOR);
  // A salon without a name still gets a title that says what the page is.
  assert.equal(bookingPageHead('  ').title, 'Book an appointment');
  assert.equal(chatPageHead('').title, 'Chat');
});

/** A stand-in for the browser's document that holds the tags of index.html. */
const fakeDocument = (tags: string[]) => {
  const attributes = new Map<string, string>();
  const removed: string[] = [];
  const doc: HeadDocument = {
    title: '',
    querySelector: (selector) => tags.includes(selector) && !removed.includes(selector) ? {
      setAttribute: (name, value) => { attributes.set(`${selector} ${name}`, value); },
      remove: () => { removed.push(selector); },
    } : null,
  };
  return { doc, attributes, removed };
};
const HEAD_TAGS = ['meta[name="application-name"]', 'meta[name="apple-mobile-web-app-title"]', 'meta[name="theme-color"]', 'link[rel="manifest"]'];

test('a customer page does not offer the owner app for the phone\'s home screen', () => {
  const owner = fakeDocument(HEAD_TAGS);
  applyPageHead(ownerPageHead('calendar', 'Bella Hair Salon'), owner.doc);
  assert.equal(owner.doc.title, 'Calendar · Bella Hair Salon – SlotBee');
  assert.equal(owner.attributes.get('meta[name="apple-mobile-web-app-title"] content'), PRODUCT_NAME);
  assert.equal(owner.attributes.get('meta[name="theme-color"] content'), PRODUCT_COLOR);
  assert.deepEqual(owner.removed, []);

  // The manifest opens the owner app. On the salon's pages it is taken out, so a customer who
  // adds the page to the home screen gets this page under the salon's name.
  for (const head of [bookingPageHead('Bella Hair Salon'), chatPageHead('Bella Hair Salon', '#075e54')]) {
    const customer = fakeDocument(HEAD_TAGS);
    applyPageHead(head, customer.doc);
    assert.equal(customer.doc.title, head.title);
    assert.deepEqual(customer.removed, ['link[rel="manifest"]']);
    assert.equal(customer.attributes.get('meta[name="application-name"] content'), 'Bella Hair Salon');
    assert.equal(customer.attributes.get('meta[name="apple-mobile-web-app-title"] content'), 'Bella Hair Salon');
    assert.equal(customer.attributes.get('meta[name="theme-color"] content'), head.themeColor);
  }
  // A page without these tags still gets its title.
  const bare = fakeDocument([]);
  applyPageHead(chatPageHead('Bella Hair Salon'), bare.doc);
  assert.equal(bare.doc.title, 'Chat with Bella Hair Salon');
});

// ---------- index.html, icons, manifest, share image ----------

const html = text('index.html');
const meta = (key: string) => new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(html)?.[1];

test('index.html names the product and says what it is, without the sample salon', () => {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  assert.equal(title, `${PRODUCT_NAME} – AI receptionist and booking manager for salons`);
  assert.equal(meta('og:title'), title);
  assert.equal(meta('og:site_name'), PRODUCT_NAME);
  assert.equal(meta('application-name'), PRODUCT_NAME);
  assert.equal(meta('apple-mobile-web-app-title'), PRODUCT_NAME);
  assert.equal(meta('theme-color'), PRODUCT_COLOR);
  const description = meta('description') ?? '';
  assert.equal(meta('og:description'), description);
  assert.match(description, /^AI receptionist and booking manager for salons\./);
  assert.ok(description.length <= 160, 'short enough for a search result');
  // What the product is, and nothing that would need proof.
  assert.doesNotMatch(`${title} ${description}`, /Bella|\d|award|trusted|best|leading|#1|thousands|hundreds/i);
});

test('index.html loads everything from the app itself', () => {
  const addresses = [...html.matchAll(/<(?:link|script)\b[^>]*?\s(?:href|src)="([^"]*)"/g)].map(match => match[1]);
  assert.ok(addresses.length >= 6);
  for (const address of addresses) {
    // Root paths, which the build moves under its base path. Nothing from another host.
    assert.match(address, /^\/[^/]/, address);
    if (!address.startsWith('/src/')) assert.ok(existsSync(file(`public${address}`)), `public${address} exists`);
  }
  assert.doesNotMatch(html, /googleapis|gstatic|\/\/fonts\./);
  assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.equal(pngSize('public/apple-touch-icon.png'), '180x180');
});

test('the link preview has a picture with a full https address on the production host', () => {
  const image = meta('og:image') ?? '';
  assert.match(image, /^https:\/\/slotbee\.vercel\.app\/[\w-]+\.png$/);
  assert.equal(meta('twitter:image'), image);
  assert.equal(meta('twitter:card'), 'summary_large_image');
  const name = image.slice(image.lastIndexOf('/') + 1);
  assert.equal(pngSize(`public/${name}`), `${meta('og:image:width')}x${meta('og:image:height')}`);
  assert.equal(pngSize(`public/${name}`), '1200x630');
});

test('the web manifest uses relative addresses, so a copy in a sub-folder opens itself', () => {
  const manifest = JSON.parse(text('public/manifest.webmanifest')) as {
    name: string; short_name: string; start_url: string; scope: string; display: string; theme_color: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };
  assert.equal(manifest.name, PRODUCT_NAME);
  assert.equal(manifest.short_name, PRODUCT_NAME);
  assert.equal(manifest.start_url, '.');
  assert.equal(manifest.scope, '.');
  assert.equal(manifest.theme_color, PRODUCT_COLOR);
  // Not "standalone" yet: the headers have no safe-area padding, so an app window without browser
  // bars would put them under an iPhone's status bar. A browser tab also keeps Reload.
  assert.equal(manifest.display, 'browser');
  assert.deepEqual(manifest.icons.map(icon => `${icon.sizes} ${icon.purpose ?? 'any'}`), ['192x192 any', '512x512 any', '512x512 maskable']);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^[\w-]+\.png$/, 'a file name next to the manifest, no leading slash');
    assert.equal(icon.type, 'image/png');
    assert.equal(pngSize(`public/${icon.src}`), icon.sizes);
  }
});

test('no service worker: a build that changes daily must not be served from a cache', () => {
  const sources = (folder: string): string[] => readdirSync(file(folder), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? sources(`${folder}/${entry.name}`) : [`${folder}/${entry.name}`]);
  assert.deepEqual(sources('public').filter(path => /(^|\/)(sw|service-?worker)[\w.-]*\.js$/i.test(path)), []);
  for (const path of ['index.html', ...sources('src')]) assert.doesNotMatch(text(path), /serviceWorker/, path);
});

test('the files the app serves as they are stay small', () => {
  const size = (folder: string): number => readdirSync(file(folder), { withFileTypes: true }).reduce((sum, entry) =>
    sum + (entry.isDirectory() ? size(`${folder}/${entry.name}`) : statSync(file(`${folder}/${entry.name}`)).size), 0);
  assert.ok(size('public') < 400_000, `public/ holds ${size('public')} bytes`);
});

// ---------- typeface and focus ring ----------

test('the typeface is served by the app, with its licence', () => {
  const css = text('src/index.css');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(match => match[1]);
  assert.equal(faces.length, 2);
  for (const face of faces) {
    assert.match(face, /font-family: 'Plus Jakarta Sans';/);
    assert.match(face, /font-display: swap;/);
    // One variable file covers the weights the interface uses: regular 400 to extra bold 800.
    assert.match(face, /font-weight: 400 800;/);
    const address = /src: url\('([^']*)'\) format\('woff2'\);/.exec(face)?.[1] ?? '';
    assert.match(address, /^\/fonts\/[\w-]+\.woff2$/);
    assert.equal(readFileSync(file(`public${address}`)).subarray(0, 4).toString('latin1'), 'wOF2');
  }
  assert.doesNotMatch(css, /https?:\/\//);
  assert.match(css, /--font-sans: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif/);
  // The file the page fetches first is one of them.
  const preload = /<link rel="preload" href="([^"]*)" as="font" type="font\/woff2" crossorigin/.exec(html)?.[1] ?? '';
  assert.ok(faces.some(face => face.includes(`url('${preload}')`)), 'the preloaded file is declared in the CSS');
  const licence = text('public/fonts/OFL.txt');
  assert.match(licence, /The Plus Jakarta Sans Project Authors/);
  assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/);
});

test('a page heading that receives focus after navigation shows no focus ring', () => {
  // In the base layer, so the deliberate outline of the booking page's error box still wins.
  const base = /@layer base \{([\s\S]*)\n\}/.exec(text('src/index.css'))?.[1] ?? '';
  assert.match(base, /h1\[tabindex='-1'\]:focus,\s*h2\[tabindex='-1'\]:focus \{\s*outline: none;\s*\}/);
});

// ---------- package ----------

test('the package is called after the product', () => {
  const lock = JSON.parse(text('package-lock.json')) as { name: string; packages: Record<string, { name?: string }> };
  assert.equal(JSON.parse(text('package.json')).name, 'slotbee');
  assert.equal(lock.name, 'slotbee');
  assert.equal(lock.packages[''].name, 'slotbee');
});
