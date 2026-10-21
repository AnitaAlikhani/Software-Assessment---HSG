import test from 'node:test';
import assert from 'node:assert/strict';
import { createCsv, csvCell } from '../src/csv';
import { normalizeWebsiteUrl, validateLogoFile, validateOptionalContact } from '../src/managementValidation';

test('CSV keeps hashes, quoted names, commas, newlines and Unicode in complete records', () => {
  const csv = createCsv([['Name', 'Phone'], ['Jane #1 "JJ", Müller\nJr.', '+41 79 123 45 67'], ['Following customer', '']]);
  assert.equal(csv, '\uFEFF"Name","Phone"\r\n"Jane #1 ""JJ"", Müller\nJr.","\'+41 79 123 45 67"\r\n"Following customer",""');
  assert.equal(csvCell(12), '"12"');
});

test('CSV text is safe from spreadsheet formula evaluation without changing numeric counts', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', ' \t=1+1']) assert.equal(csvCell(value), `"'${value}"`);
  assert.equal(csvCell(-1), '"-1"');
});

test('optional contacts remain optional but populated invalid values are rejected', () => {
  assert.equal(validateOptionalContact('', ''), null);
  assert.equal(validateOptionalContact('jane@example.ch', '0041 (79) 123-45-67'), null);
  assert.match(validateOptionalContact('not-an-email', '')!, /email/);
  assert.match(validateOptionalContact('', 'invalid')!, /phone/);
});

test('website validation rejects incomplete and unsafe URLs and normalizes social links', () => {
  for (const value of ['https://', 'https://word', 'https:example.com', 'https://bad..example', 'https://bad-.example', 'javascript:alert(1)', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com/a b']) assert.equal(normalizeWebsiteUrl(value), null, value);
  assert.equal(normalizeWebsiteUrl(''), '');
  assert.equal(normalizeWebsiteUrl('https://example.com/legal'), 'https://example.com/legal');
  assert.equal(normalizeWebsiteUrl('instagram.com/salon', true), 'https://instagram.com/salon');
});

test('logo input accepts bounded raster images and rejects unsupported or oversized files', () => {
  assert.equal(validateLogoFile({type:'image/png', size:1000}), null);
  assert.match(validateLogoFile({type:'image/svg+xml', size:1000})!, /PNG/);
  assert.match(validateLogoFile({type:'image/jpeg', size:600 * 1024})!, /500 KB/);
  assert.match(validateLogoFile({type:'image/webp', size:0})!, /500 KB/);
});
