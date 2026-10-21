import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalyticsView } from '../src/views/AnalyticsView';
import { addDays, getSalonNow } from '../src/scheduling';
import { initialCalendarEvents } from '../src/mockData';

test('merged Analytics renders supplied appointments in its current date range', () => {
  const today = getSalonNow('Europe/Zurich').date;
  const template = initialCalendarEvents[0];
  const html = renderToStaticMarkup(React.createElement(AnalyticsView, {
    companyName: 'Merge Test Salon', timeZone: 'Europe/Zurich', conversations: [],
    events: [
      { ...template, id: 'today-one', date: today },
      { ...template, id: 'today-two', date: today },
      { ...template, id: 'outside-range', date: addDays(today, -31) },
    ],
  }));
  assert.match(html, /Merge Test Salon/);
  assert.match(html, /<h2[^>]*>2 Appointments<\/h2>/);
  assert.match(html, new RegExp(`<title>${today}: 2<\/title>`));
  assert.match(html, /aria-label="From date"/);
  assert.match(html, /aria-label="To date"/);
  assert.match(html, /aria-label="Appointment chart"/);
});

test('merged Analytics shows an empty live dataset instead of seeded chart totals', () => {
  const html = renderToStaticMarkup(React.createElement(AnalyticsView, {
    events: [], conversations: [], companyName: 'Empty Salon', timeZone: 'Europe/London',
  }));
  assert.match(html, /<h2[^>]*>0 Appointments<\/h2>/);
  assert.doesNotMatch(html, /<circle/);
  assert.match(html, /aria-selected="true" aria-controls="analytics-panel"[^>]*>Appointments/);
});
