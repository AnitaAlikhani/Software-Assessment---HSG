import { useEffect } from 'react';
import { PRODUCT_NAME } from './brand';
import { SCREEN_NAMES } from './navigation';
import type { NavigationTab } from './types';

/**
 * What the browser shows around a page: the title in the tab, the name a phone puts under the
 * icon on its home screen, and the colour of the browser bar.
 *
 * One HTML file serves three audiences. The owner works in SlotBee, so the owner's tabs name the
 * screen, the salon and the product. A customer visits the salon: the booking page and the chat
 * name the salon only, and they do not offer the owner app for a phone's home screen.
 */
export interface PageHead {
  /** Browser tab, history and bookmarks. */
  title: string;
  /** The name under the icon when someone adds the page to a phone's home screen. */
  homeScreenName: string;
  /** Colour of the browser bar on phones. */
  themeColor: string;
  /** False on customer pages: see applyPageHead. */
  ownerApp: boolean;
}

/** The product colour. The same value as --color-brand in index.css and theme-color in index.html. */
export const PRODUCT_COLOR = '#5551FF';

/**
 * An owner screen, for example "Calendar · Bella Hair Salon – SlotBee". The screen is called what
 * the menu calls it (src/navigation.ts); the salon's name comes from Settings.
 */
export function ownerPageHead(tab: NavigationTab, salon: string): PageHead {
  const screenAndSalon = [SCREEN_NAMES[tab], salon.trim()].filter(Boolean).join(' · ');
  return { title: `${screenAndSalon} – ${PRODUCT_NAME}`, homeScreenName: PRODUCT_NAME, themeColor: PRODUCT_COLOR, ownerApp: true };
}

/** The customers' booking page: "Book an appointment – Bella Hair Salon". */
export function bookingPageHead(salon: string): PageHead {
  const name = salon.trim();
  return { title: name ? `Book an appointment – ${name}` : 'Book an appointment', homeScreenName: name || 'Book an appointment', themeColor: PRODUCT_COLOR, ownerApp: false };
}

/** The customers' chat: "Chat with Bella Hair Salon". The chat passes the colour of its own header. */
export function chatPageHead(salon: string, themeColor: string = PRODUCT_COLOR): PageHead {
  const name = salon.trim();
  return { title: name ? `Chat with ${name}` : 'Chat', homeScreenName: name || 'Chat', themeColor, ownerApp: false };
}

interface HeadElement {
  setAttribute(name: string, value: string): void;
  remove(): void;
}
/** The part of the browser's document this module touches. Tests pass a stand-in. */
export interface HeadDocument {
  title: string;
  querySelector(selector: string): HeadElement | null;
}

/** Writes a page's details into the document. */
export function applyPageHead(head: PageHead, doc: HeadDocument = document): void {
  doc.title = head.title;
  for (const name of ['application-name', 'apple-mobile-web-app-title']) {
    doc.querySelector(`meta[name="${name}"]`)?.setAttribute('content', head.homeScreenName);
  }
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', head.themeColor);
  // index.html links the web manifest of the owner app. On a customer page it would make
  // "Add to Home Screen" open the owner's app instead of the page the customer is on, so
  // customer pages take the link out: the phone then keeps the page's own address.
  if (!head.ownerApp) doc.querySelector('link[rel="manifest"]')?.remove();
}

/** Keeps the browser tab in step with the page that is shown. */
export function usePageHead(head: PageHead): void {
  const { title, homeScreenName, themeColor, ownerApp } = head;
  useEffect(() => {
    applyPageHead({ title, homeScreenName, themeColor, ownerApp });
  }, [title, homeScreenName, themeColor, ownerApp]);
}
