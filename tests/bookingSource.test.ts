import assert from 'node:assert/strict';
import test from 'node:test';
import { appointmentFromConversationAction, appointmentFromRequest, appointmentIdForRequest } from '../src/appointmentActions';
import { BOOKING_SOURCES, bookingSource, bookingSourceLabel } from '../src/bookingSource';
import { initialEmployees, initialServices } from '../src/mockData';
import { demoConversations, demoEvents, demoRequests } from './fixedClock';

// How an appointment was booked is read from what it carries today: who booked it (the AI), where
// (a chat), and the id an accepted request gets.

test('the six ways an appointment is booked, each with its name', () => {
  assert.deepEqual([...BOOKING_SOURCES], ['ai', 'chat', 'booking-page', 'phone', 'walk-in', 'manual']);
  assert.deepEqual(BOOKING_SOURCES.map(bookingSourceLabel), ['Booked by the AI', 'Booked in a chat', 'Booked on the booking page', 'Booked by phone', 'Booked as a walk-in', 'Booked by hand']);
  // Each name starts the same way and none is the same as another.
  assert.equal(new Set(BOOKING_SOURCES.map(bookingSourceLabel)).size, 6);
  for (const source of BOOKING_SOURCES) assert.match(bookingSourceLabel(source), /^Booked (by|in|on|as) /);
});

test('what the owner chose in the appointment form is the source; "other" and an unknown word read as by hand', () => {
  assert.equal(bookingSource({ id: 'cal-1', source: 'phone' }), 'phone');
  assert.equal(bookingSource({ id: 'cal-1', source: 'walk-in' }), 'walk-in');
  assert.equal(bookingSource({ id: 'cal-1', source: 'other' }), 'manual');
  assert.equal(bookingSource({ id: 'cal-1', source: 'voicemail' as 'other' }), 'manual');
  // The form never sets a source on an appointment from a chat or the booking page, so nothing competes.
  assert.equal(bookingSource({ id: 'cal-1', isAiBooked: true }), 'ai');
});

test('the source follows who booked, then where, then the id of an accepted request', () => {
  assert.equal(bookingSource({ id: 'cal-1', isAiBooked: true }), 'ai');
  // The AI books in chats too: its bookings stay the AI's.
  assert.equal(bookingSource({ id: 'cal-1', isAiBooked: true, conversationId: 'conv-1' }), 'ai');
  assert.equal(bookingSource({ id: appointmentIdForRequest('req-1'), isAiBooked: true }), 'ai');
  assert.equal(bookingSource({ id: 'cal-giulia', isAiBooked: false, conversationId: 'conv-giulia' }), 'chat');
  assert.equal(bookingSource({ id: 'cal-1', conversationId: 'conv-1' }), 'chat');
  assert.equal(bookingSource({ id: appointmentIdForRequest('req-1') }), 'booking-page');
  assert.equal(bookingSource({ id: appointmentIdForRequest('req-0d9c5a52-6a2f-4c62-9f2b-0f1b3f7c2a11'), isAiBooked: false }), 'booking-page');
  // The calendar's own form and the owner assistant number their appointments "cal-" and a random id.
  assert.equal(bookingSource({ id: 'cal-0d9c5a52-6a2f-4c62-9f2b-0f1b3f7c2a11', isAiBooked: false }), 'manual');
  assert.equal(bookingSource({ id: 'cal-20261006-e1-1000' }), 'manual');
  // "req" somewhere else in an id is no accepted request.
  assert.equal(bookingSource({ id: 'cal-prequel' }), 'manual');
});

test('appointments made the ways the app makes them get the right source', () => {
  // A request from the booking page, accepted on Home.
  const accepted = appointmentFromRequest(demoRequests[0], initialServices, initialEmployees);
  assert.equal(bookingSource(accepted), 'booking-page');
  // The owner books in a chat with a reply (Sabrina's colouring), and a request the AI took is confirmed.
  const sabrina = demoConversations.find((item) => item.id === 'conv-sabrina')!;
  const action = sabrina.quickReplies!.find((reply) => reply.appointmentAction)!.appointmentAction!;
  const byOwner = { ...appointmentFromConversationAction(action, sabrina, demoEvents, initialServices, initialEmployees, false)!, conversationId: sabrina.id };
  assert.equal(bookingSource(byOwner), 'chat');
  const byAi = { ...appointmentFromConversationAction(action, sabrina, demoEvents, initialServices, initialEmployees, true)!, conversationId: sabrina.id };
  assert.equal(bookingSource(byAi), 'ai');
  // The salon as it starts: the appointments the sample chats are about, and the rest by hand or by the AI.
  const byId = (id: string) => bookingSource(demoEvents.find((item) => item.id === id)!);
  assert.equal(byId('cal-2'), 'ai');
  assert.equal(byId('cal-giulia'), 'chat');
  const counts = Object.fromEntries(BOOKING_SOURCES.map((source) => [source, demoEvents.filter((item) => bookingSource(item) === source).length]));
  assert.ok(counts.ai > 0 && counts.manual > counts.ai && counts.chat === 1 && counts['booking-page'] === 0, JSON.stringify(counts));
});
