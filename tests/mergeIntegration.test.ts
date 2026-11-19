import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalyticsView } from '../src/views/AnalyticsView';
import { addDays, formatCalendarDate, getSalonNow } from '../src/scheduling';
import { demoEvents, FIXED_NOW } from './fixedClock';

test('merged Analytics renders supplied appointments in its current date range', () => {
  const template = demoEvents[0];
  // The view is given the clock, so the test does not depend on the day it runs.
  const today = getSalonNow('Europe/Zurich', FIXED_NOW).date;
  const html = renderToStaticMarkup(React.createElement(AnalyticsView, {
    companyName: 'Merge Test Salon', timeZone: 'Europe/Zurich', conversations: [], now: FIXED_NOW,
    events: [
      { ...template, id: 'today-one', date: today },
      { ...template, id: 'today-two', date: today },
      // The view opens on the current month; 31 days back is always in an earlier one.
      { ...template, id: 'outside-range', date: addDays(today, -31) },
    ],
  }));
  assert.match(html, /Merge Test Salon/);
  assert.match(html, /value="2026-10-01"/);
  assert.match(html, /value="2026-10-31"/);
  assert.match(html, /<h2><span[^>]*>2<\/span> <span[^>]*>appointments<\/span><\/h2>/);
  // The chart's table names the day as the Calendar does and gives its count.
  assert.match(html, new RegExp(`<th scope="row"[^>]*>${formatCalendarDate(today)}</th><td[^>]*>2</td>`));
  assert.match(html, /aria-label="From date"/);
  assert.match(html, /aria-label="To date"/);
  assert.match(html, /aria-label="Appointment chart"/);
});

test('merged Analytics shows an empty live dataset instead of seeded chart totals', () => {
  const html = renderToStaticMarkup(React.createElement(AnalyticsView, {
    events: [], conversations: [], companyName: 'Empty Salon', timeZone: 'Europe/London', now: FIXED_NOW,
  }));
  assert.match(html, /<h2><span[^>]*>0<\/span> <span[^>]*>appointments<\/span><\/h2>/);
  // No chart and no bar without appointments.
  assert.doesNotMatch(html, /aria-label="Appointment chart"|style="height:/);
  assert.match(html, /aria-selected="true" aria-controls="analytics-panel"[^>]*>Appointments/);
});
