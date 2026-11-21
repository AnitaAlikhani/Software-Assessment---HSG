import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { bookingAddress, qrFileName, qrModules, qrPath, qrSide, QR_QUIET_ZONE } from '../src/bookingLink';
import { BookingLinkCard, BookingLinkCompact, BookingQrCode } from '../src/components/BookingLinkCard';
import { initialBookingHours, initialCompanySettings } from '../src/mockData';
import { SettingsView } from '../src/views/SettingsView';
import { decodeQr, modulesFromPath } from './qrDecode';
import { FIXED_NOW } from './fixedClock';
import { readableText, render, TELL_WORDS } from './renderHelpers';

// The booking link: the address customers book at, to copy, to open as a customer and to hand
// out as a QR code. The codes are read back here by a reader of our own (tests/qrDecode.ts),
// which shares nothing with the library that draws them.

const MAIN_SITE = { origin: 'https://slotbee.example', pathname: '/' };
// A preview of a work branch is served under a sub-path.
const PREVIEW = { origin: 'https://example.github.io', pathname: '/Software-Assessment---HSG/previews/anita-launch/' };

test('the booking address is the site\'s own address with ?booking=1, also under a sub-path', () => {
  assert.equal(bookingAddress(MAIN_SITE), 'https://slotbee.example/?booking=1');
  assert.equal(bookingAddress(PREVIEW), 'https://example.github.io/Software-Assessment---HSG/previews/anita-launch/?booking=1');
  // It is built from the place the app is served from only. The page that is open, an access
  // key or the research switch in the owner's own address never reach the link customers get.
  const owner = new URL('https://slotbee.example/sub/?live=owner-key&research=1#/settings?tab=online-booking');
  assert.equal(bookingAddress(owner), 'https://slotbee.example/sub/?booking=1');
  // The customers' page reads exactly this switch.
  assert.equal(new URL(bookingAddress(PREVIEW)).searchParams.get('booking'), '1');
});

test('the QR code holds the booking address, read back module by module', () => {
  for (const address of [
    bookingAddress(MAIN_SITE),
    bookingAddress(PREVIEW),
    // The local stand-in server: digits and punctuation make the library mix its ways of storing text.
    'http://127.0.0.1:4221/?booking=1',
    // A long address needs a larger code, with version information and more alignment patterns.
    bookingAddress({ origin: 'https://a-rather-long-name-for-a-salon-site.example', pathname: '/Software-Assessment---HSG/previews/a-branch-with-a-long-name/and/some/more/folders/below/it/' }),
  ]) {
    const modules = qrModules(address);
    const read = decodeQr(modules);
    assert.equal(read.text, address);
    // Medium error correction, so a printed code survives a crease or a mark.
    assert.equal(read.level, 'M', address);
    assert.equal(modules.length, 17 + 4 * read.version);
  }
  assert.deepEqual(decodeQr(qrModules('http://127.0.0.1:4221/?booking=1')).modes, ['byte', 'alphanumeric', 'byte']);
  assert.ok(decodeQr(qrModules(bookingAddress({ origin: 'https://a-rather-long-name-for-a-salon-site.example', pathname: '/Software-Assessment---HSG/previews/a-branch-with-a-long-name/and/some/more/folders/below/it/' }))).version >= 7);
});

test('the reader accepts only a sound code, so a pass means something', () => {
  const modules = qrModules(bookingAddress(PREVIEW));
  const flipped = (row: number, column: number) => modules.map((line, r) => line.map((dark, c) => (r === row && c === column ? !dark : dark)));
  const middle = Math.floor(modules.length / 2);
  // One wrong data module is caught by the error correction, one wrong format module by its own check.
  assert.throws(() => decodeQr(flipped(middle, middle + 3)), /does not match its error correction/);
  assert.throws(() => decodeQr(flipped(8, 2)), /format information/);
  assert.throws(() => decodeQr(flipped(0, 0)), /finder pattern/);
  assert.throws(() => decodeQr(modules.slice(1)), /not a QR code/);
  // Another address is another code.
  assert.notDeepEqual(qrModules(bookingAddress(PREVIEW)), qrModules(bookingAddress({ ...PREVIEW, pathname: '/Software-Assessment---HSG/previews/another-branch/' })));
});

test('the drawn code is the same code: vector bars inside a white quiet zone', () => {
  const address = bookingAddress(PREVIEW);
  const html = render(React.createElement(BookingQrCode, { address }));
  const side = Number(/viewBox="0 0 (\d+) \1"/.exec(html)?.[1]);
  assert.equal(side, qrSide(qrModules(address)));
  assert.equal(QR_QUIET_ZONE, 4);
  // A white square under black bars: the contrast a scanner needs, whatever the page behind it looks like.
  assert.match(html, new RegExp(`<rect width="${side}" height="${side}" fill="#ffffff"`));
  const path = /<path d="([^"]+)" fill="#000000"/.exec(html)?.[1] ?? '';
  // modulesFromPath fails when a bar reaches into the quiet zone; then the picture is read like a code.
  assert.equal(decodeQr(modulesFromPath(path, side, QR_QUIET_ZONE)).text, address);
  assert.equal(path, qrPath(qrModules(address)));
  // It is one image with a name, not a heap of shapes, to a screen reader.
  assert.match(html, /^<svg role="img" aria-label="QR code of the booking link"/);
});

test('the saved picture is named after the salon', () => {
  assert.equal(qrFileName('Bella Hair Salon'), 'bella-hair-salon-booking-qr.png');
  // Named like the exports: an umlaut becomes ae, oe or ue.
  assert.equal(qrFileName('Coiffure Élégance & Söhne'), 'coiffure-elegance-soehne-booking-qr.png');
  assert.equal(qrFileName('  '), 'booking-qr.png');
});

const ADDRESS = bookingAddress(PREVIEW);

test('the card in Settings offers the address, Copy, "Open as customer" and the code to save or print', () => {
  const html = render(React.createElement(BookingLinkCard, { address: ADDRESS, salonName: 'Bella Hair Salon' }));
  const text = readableText(html);
  // The address is written out in full, not cut off in a field.
  assert.ok(html.includes(`>${ADDRESS}</span>`));
  assert.match(text, /Customer booking link:/);
  const buttons = Array.from(html.matchAll(/<button[^>]*>(.*?)<\/button>/g), (match) => match[1].replace(/<[^>]+>/g, ''));
  assert.deepEqual(buttons, ['Copy link', 'Save picture', 'Print']);
  // Opening as a customer is a link to the address itself, in a new tab.
  const link = /<a href="([^"]+)" target="_blank" rel="noopener"[^>]*>(.*?)<\/a>/.exec(html);
  assert.equal(link?.[1], ADDRESS);
  assert.match(link?.[2].replace(/<[^>]+>/g, '') ?? '', /^Open as customer \(opens in a new tab\)$/);
  // The code on the card is the address.
  const path = /<path d="([^"]+)" fill="#000000"/.exec(html)?.[1] ?? '';
  assert.equal(decodeQr(modulesFromPath(path, qrSide(qrModules(ADDRESS)), QR_QUIET_ZONE)).text, ADDRESS);
  // One line says what happens to a request, and claims nothing about what the customer is told.
  assert.match(text, /Requests from this page wait on Home for your answer\. Nothing is booked until you accept\./);
  assert.doesNotMatch(text, /confirm|notif|sent|e-?mail|SMS/i);
  assert.doesNotMatch(text, TELL_WORDS);
  // Controls are large enough for a thumb, and success is announced without moving anything.
  for (const control of html.match(/<(?:button|a)\b[^>]*>/g) ?? []) assert.match(control, /\bmin-h-11\b/, control);
  assert.match(html, /<span role="status" class="sr-only"><\/span>/);
  // The sheet for the printer is put into the page only while printing.
  assert.doesNotMatch(html, /booking-link-sheet/);
});

test('on a study link the card says how far the sample workspace reaches: the tabs of this browser', () => {
  const card = React.createElement(BookingLinkCard, { address: ADDRESS, salonName: 'Bella Hair Salon' });
  assert.doesNotMatch(render(card), /Demo workspace|this browser|other tab/);
  const note = readableText(render(card, { research: true }));
  assert.match(note, /Demo workspace: its data are kept in this browser and shared by all its tabs\./);
  // What is true between two tabs now: the request arrives on Home, and the customer's tab learns the answer.
  assert.match(note, /A request sent in the tab that “Open as customer” opens shows up on Home here, and that tab shows your answer once you accept or reject\./);
  // Another device is still not reached, and the note does not claim it.
  assert.match(note, /Another browser or device is not reached\./);
  assert.doesNotMatch(note, /every browser tab keeps its own data|does not learn your answer|handed to this tab/);
});

test('the short form for Home has the address, Copy and the code behind a button', () => {
  const html = render(React.createElement(BookingLinkCompact, { address: ADDRESS }));
  assert.match(html, /^<section aria-label="Booking link"/);
  assert.ok(html.includes(`>${ADDRESS}</p>`));
  const buttons = Array.from(html.matchAll(/<button[^>]*>(.*?)<\/button>/g), (match) => match[1].replace(/<[^>]+>/g, ''));
  assert.deepEqual(buttons, ['Copy', 'QR code']);
  // The code is not drawn until it is asked for, and the button says so.
  assert.match(html, /aria-expanded="false"[^>]*>.*?QR code<\/button>/);
  assert.doesNotMatch(html, /QR code of the booking link/);
  for (const control of html.match(/<button\b[^>]*>/g) ?? []) assert.match(control, /\bmin-h-11\b/, control);
  assert.doesNotMatch(readableText(html), TELL_WORDS);
  // Without an address (no browser and none given) there is nothing to show.
  assert.equal(render(React.createElement(BookingLinkCompact, {})), '');
  assert.equal(render(React.createElement(BookingLinkCard, {})), '');
});

test('Settings › Online booking holds the card, and no copy of the customers\' booking form', () => {
  const html = render(React.createElement(SettingsView, {
    settings: { ...initialCompanySettings, companyName: 'Coiffeur Keller' }, bookingHours: initialBookingHours, onSaveSettings: () => {},
    closedDates: [], onSaveClosedDates: () => {}, now: FIXED_NOW, tab: 'online-booking', bookingLink: ADDRESS,
  }));
  assert.match(html, /<h2[^>]*>Online booking<\/h2>/);
  assert.match(html, /<h3[^>]*>Booking link<\/h3>/);
  assert.ok(html.includes(ADDRESS));
  assert.match(html, /Requests from this page wait on Home/);
  // The owner needs the link, not the form: no service list, no date field, no "Request appointment".
  assert.doesNotMatch(html, /<form|<input|<select|Choose a service|Request appointment|Your booking page|Preview/);
  // Nothing on this tab is saved with the page's Save button, so it is not offered here.
  assert.doesNotMatch(html, />Save<\/span>/);
});
