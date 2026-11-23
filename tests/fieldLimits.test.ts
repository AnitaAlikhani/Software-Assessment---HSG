import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MAX_PRICE_CHF, salonTextTooLong, TEXT_LIMITS } from '../src/fieldLimits';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData';
import { personFormFor, personFromForm } from '../src/personForm';
import { SharedSalon } from '../src/sharedSalon';
import { FIXED_NOW } from './fixedClock';
import { SalonRoutesStandIn } from './salonRoutesStandIn';

// The forms' limits are the server's (server/salon.ts): the owner is told before she saves.

test('the limits are the server\'s', () => {
  const server = readFileSync(new URL('../server/salon.ts', import.meta.url), 'utf8');
  assert.match(server, /const NAME = 120;/);
  assert.ok(server.includes(`priceCHF: field('the price', amount(0, 100_000))`));
  for (const [field, limit] of [['description', TEXT_LIMITS.salonDescription], ['termsText', TEXT_LIMITS.terms], ['businessPhone', TEXT_LIMITS.phone], ['street', TEXT_LIMITS.street], ['website', TEXT_LIMITS.link]] as const) {
    assert.match(server, new RegExp(`${field}: (field|maybe)\\([^)]*text\\(${String(limit).replace(/(\d)(?=(\d{3})+$)/g, '$1_?')}\\)`), field);
  }
  assert.match(server, /description: maybe\('the description', text\(1000\)\)/);
  assert.match(server, /email: field\('the email address', text\(254\)\)/);
});

test('a salon name of 130 characters is stopped by the form, with its sentence', () => {
  assert.equal(salonTextTooLong({ ...initialCompanySettings, companyName: 'x'.repeat(130) }), 'The company name can be at most 120 characters.');
  assert.equal(salonTextTooLong({ ...initialCompanySettings, termsText: 'x'.repeat(20_001) }), 'The terms can be at most 20,000 characters.');
  assert.equal(salonTextTooLong(initialCompanySettings), null);
});

test('a person\'s names, email and phone are stopped by the form at the server\'s limits', () => {
  const form = personFormFor(initialEmployees[0], { services: initialServices, bookingHours: initialBookingHours });
  const salon = { services: initialServices, companyName: 'Salon' };
  assert.deepEqual(personFromForm({ ...form, firstName: 'x'.repeat(121) }, salon), { error: 'A first or last name can be at most 120 characters.' });
  assert.ok('details' in personFromForm(form, salon));
});

test('a failure ends the "Saved" sign at once: it never stands next to "not saved"', async () => {
  const server = new SalonRoutesStandIn();
  const salon = new SharedSalon({ request: server.request, builtAt: () => FIXED_NOW, now: () => 1000 });
  salon.read('companySettings', initialCompanySettings);
  await salon.begin(server.key);
  salon.write('companySettings', { ...initialCompanySettings, companyName: 'Salon A' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(salon.current.savedAt, 1000);
  server.failNext = [null];
  salon.write('companySettings', { ...initialCompanySettings, companyName: 'Salon B' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(salon.current.savedAt, null);
  assert.equal(salon.current.notice?.kind, 'error');
});
