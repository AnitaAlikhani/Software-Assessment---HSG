import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_LOCALE, RANGE_SEPARATOR,
  formatClock, formatDate, formatDateRange, formatDateShort, formatDayMonth, formatMoney, formatMonth, formatMonthShort,
  formatMonthSpan, formatPhone, formatStoredTimeRange, formatTime, formatTimeRange, formatWeek, isoWeek, isPhoneNumber,
  normalizePhone, openingHoursDay, phoneDigits, phoneMatches, phoneProblem, salonTimeNote, sameClock, samePhone,
  timeZoneCity, timeZoneId, timeZoneLabel, weekdayName, zonedDateTime,
} from '../src/format';
import { addDays, startOfWeek } from '../src/scheduling';
import { FIXED_NOW } from './fixedClock';

// One Swiss format for dates, times, money and phone numbers (src/format.ts). Every text is
// pinned here letter by letter: the module writes its own weekday and month names, so the
// result does not depend on the machine, its time zone or its version of Node.

// ---------- dates ----------

test('a date reads "Thu, 19.11.2026", short "Thu 19.11.", in a sentence "Thursday, 19.11.2026"', () => {
  assert.equal(DEFAULT_LOCALE, 'en-CH');
  assert.equal(formatDate('2026-11-19'), 'Thu, 19.11.2026');
  assert.equal(formatDate('2026-11-19', { weekday: 'long' }), 'Thursday, 19.11.2026');
  assert.equal(formatDate('2026-11-19', { weekday: 'none' }), '19.11.2026');
  assert.equal(formatDateShort('2026-11-19'), 'Thu 19.11.');
  assert.equal(formatDayMonth('2026-11-19'), '19.11.');
  assert.equal(formatMonth('2026-11-19'), 'November 2026');
  assert.equal(formatMonthShort('2026-11-19'), 'Nov 2026');
  assert.equal(weekdayName('2026-11-19'), 'Thursday');
  assert.equal(weekdayName('2026-11-19', 'short'), 'Thu');
  // Day and month always have two digits, so a column of dates lines up.
  assert.equal(formatDate('2026-01-05'), 'Mon, 05.01.2026');
  assert.equal(formatDateShort('2026-03-01'), 'Sun 01.03.');
});

test('a German interface passes de-CH and gets the same forms in German', () => {
  assert.equal(formatDate('2026-11-19', { locale: 'de-CH' }), 'Do., 19.11.2026');
  assert.equal(formatDate('2026-11-19', { weekday: 'long', locale: 'de-CH' }), 'Donnerstag, 19.11.2026');
  assert.equal(formatDateShort('2026-11-19', 'de-CH'), 'Do 19.11.');
  assert.equal(formatMonth('2026-03-07', 'de-CH'), 'März 2026');
  assert.equal(formatMonthShort('2026-09-07', 'de-CH'), 'Sept. 2026');
  assert.equal(formatWeek('2026-11-19', 'de-CH'), 'KW 47');
  assert.equal(formatDateRange('2026-11-16', '2026-11-22', 'de-CH'), '16.–22.11.2026');
  assert.equal(formatDateRange('2026-11-18', '2026-11-18', 'de-CH'), 'Mi., 18.11.2026');
  assert.equal(formatMonthSpan('2026-11-30', '2026-12-06', 'de-CH'), 'November–Dezember 2026');
  // The names every weekday and month gets, Sunday and January first.
  const week = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];
  assert.deepEqual(week.map((day) => weekdayName(day, 'short')), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  assert.deepEqual(week.map((day) => weekdayName(day, 'long', 'de-CH')), ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']);
  const months = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}-15`);
  assert.deepEqual(months.map((day) => formatMonthShort(day).slice(0, 3)), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
});

test('dates keep their day across the change to summer and winter time and across the year end', () => {
  // The clocks change on Sunday 29 March and Sunday 25 October 2026. A date is a calendar day:
  // it is written the same whatever the hour and whatever zone the machine is set to.
  assert.deepEqual(['2026-03-28', '2026-03-29', '2026-03-30'].map((day) => formatDate(day)), ['Sat, 28.03.2026', 'Sun, 29.03.2026', 'Mon, 30.03.2026']);
  assert.deepEqual(['2026-10-24', '2026-10-25', '2026-10-26'].map((day) => formatDateShort(day)), ['Sat 24.10.', 'Sun 25.10.', 'Mon 26.10.']);
  assert.deepEqual(['2026-12-31', '2027-01-01'].map((day) => formatDate(day)), ['Thu, 31.12.2026', 'Fri, 01.01.2027']);
  assert.equal(formatDate('2028-02-29'), 'Tue, 29.02.2028');
  // Every day of a year follows the day before it, weekday by weekday, with no day skipped or doubled.
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let day = '2026-01-01', index = 4; day <= '2027-01-10'; day = addDays(day, 1), index = (index + 1) % 7) {
    const [dayOfMonth, month, year] = day.split('-').reverse();
    assert.equal(formatDate(day), `${names[index]}, ${dayOfMonth}.${month}.${year}`, day);
  }

  // A moment becomes the salon's date and time first, then text. Around the clock changes:
  const zurich = (iso: string) => zonedDateTime(new Date(iso), 'Europe/Zurich');
  assert.deepEqual(zurich('2026-03-29T00:59:00Z'), { date: '2026-03-29', time: '01:59' });
  assert.deepEqual(zurich('2026-03-29T01:00:00Z'), { date: '2026-03-29', time: '03:00' }); // 02:00 to 03:00 does not exist
  assert.deepEqual(zurich('2026-10-25T00:30:00Z'), { date: '2026-10-25', time: '02:30' });
  assert.deepEqual(zurich('2026-10-25T01:30:00Z'), { date: '2026-10-25', time: '02:30' }); // 02:30 comes twice
  // Late in the evening in UTC it is already the next day in Zurich, also on New Year's Eve.
  assert.equal(formatDate(zurich('2026-10-24T22:30:00Z').date), 'Sun, 25.10.2026');
  assert.equal(formatDate(zurich('2026-12-31T23:30:00Z').date), 'Fri, 01.01.2027');
  assert.equal(formatClock(new Date('2026-12-31T23:30:00Z'), 'Europe/Zurich'), '00:30');
  assert.equal(formatClock(Date.parse('2026-07-01T12:05:00Z'), 'Europe/Zurich'), '14:05');
});

test('a locale without names of its own keeps the form and reads in English', () => {
  // French and Italian are not written out yet. A later step may pass them all the same.
  const french = 'fr-CH' as 'en-CH';
  assert.equal(formatDate('2026-11-19', { locale: french }), 'Thu, 19.11.2026');
  assert.equal(formatDateShort('2026-11-19', french), 'Thu 19.11.');
  assert.equal(formatMonth('2026-11-19', french), 'November 2026');
  assert.equal(formatWeek('2026-11-19', french), 'Week 47');
  assert.equal(timeZoneCity('Europe/Zurich', french), 'Zurich');
});

test('text that is no date is handed back unchanged instead of breaking a screen', () => {
  for (const value of ['', 'tomorrow', '2026-02-30', '19.11.2026', '2026-11-19T10:00:00Z']) {
    assert.equal(formatDate(value), value);
    assert.equal(formatDateShort(value), value);
  }
  assert.equal(weekdayName('not a date'), '');
  assert.equal(isoWeek('2026-13-01'), null);
});

// ---------- weeks ----------

test('weeks start on Monday and are numbered the Swiss way, also at the turn of the year', () => {
  // The week from Monday 28.12.2026 to Sunday 03.01.2027 is week 53 of 2026 on every one of its days.
  for (let day = '2026-12-28'; day <= '2027-01-03'; day = addDays(day, 1)) {
    assert.deepEqual(isoWeek(day), { year: 2026, week: 53 }, day);
    assert.equal(startOfWeek(day), '2026-12-28', day);
  }
  assert.deepEqual(isoWeek('2026-12-27'), { year: 2026, week: 52 }); // the Sunday before
  assert.deepEqual(isoWeek('2027-01-04'), { year: 2027, week: 1 });  // the Monday after
  // Other turns of the year: week 1 can begin in December, and a year can end in week 52.
  assert.deepEqual(isoWeek('2025-12-29'), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek('2026-01-01'), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek('2024-12-30'), { year: 2025, week: 1 });
  assert.deepEqual(isoWeek('2021-01-03'), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek('2027-12-31'), { year: 2027, week: 52 });
  assert.deepEqual(isoWeek('2028-01-02'), { year: 2027, week: 52 });
  assert.deepEqual(isoWeek('2028-01-03'), { year: 2028, week: 1 });
  // The number changes from Sunday to Monday, never from Saturday to Sunday.
  assert.equal(formatWeek('2026-11-14'), 'Week 46');
  assert.equal(formatWeek('2026-11-15'), 'Week 46');
  assert.equal(formatWeek('2026-11-16'), 'Week 47');
  assert.equal(formatWeek('2026-11-22'), 'Week 47');
  // Through two years every Monday starts a new number, and all seven days share it.
  let previous = isoWeek('2025-12-29')!;
  for (let monday = '2026-01-05'; monday <= '2027-12-27'; monday = addDays(monday, 7)) {
    const week = isoWeek(monday)!;
    assert.ok(week.week === previous.week + 1 || (week.week === 1 && week.year === previous.year + 1), monday);
    assert.deepEqual(isoWeek(addDays(monday, 6)), week, monday);
    previous = week;
  }
  // The opening hours are stored under English day names, whatever language the interface speaks.
  assert.equal(openingHoursDay('2026-11-16'), 'Monday');
  assert.equal(openingHoursDay('2026-11-22'), 'Sunday');
});

// ---------- ranges ----------

test('every range uses the same sign, without spaces, and says what both ends share once', () => {
  assert.equal(RANGE_SEPARATOR, '–');
  assert.equal(formatTimeRange('10:00', '10:30'), '10:00–10:30');
  assert.equal(formatDateRange('2026-11-16', '2026-11-22'), '16.–22.11.2026');
  assert.equal(formatDateRange('2026-11-30', '2026-12-06'), '30.11.–06.12.2026');
  assert.equal(formatDateRange('2026-12-28', '2027-01-03'), '28.12.2026–03.01.2027');
  assert.equal(formatDateRange('2026-11-18', '2026-11-18'), 'Wed, 18.11.2026'); // one day is a date, not "18.–18."
  assert.equal(formatMonthSpan('2026-11-16', '2026-11-22'), 'November 2026');
  assert.equal(formatMonthSpan('2026-11-30', '2026-12-06'), 'November–December 2026');
  assert.equal(formatMonthSpan('2026-12-28', '2027-01-03'), 'December 2026–January 2027');
  // A request keeps "10:00 - 10:30" as data (the slot rules read it); on screen it is a range like any other.
  assert.equal(formatStoredTimeRange('10:00 - 10:30'), '10:00–10:30');
  assert.equal(formatStoredTimeRange('10:00-10:30'), '10:00–10:30');
  assert.equal(formatStoredTimeRange('10:00 – 10:30'), '10:00–10:30');
  assert.equal(formatStoredTimeRange('by arrangement'), 'by arrangement');
  // Times are 24-hour, from minutes since midnight.
  assert.deepEqual([0, 510, 615, 780, 1110, 1439].map(formatTime), ['00:00', '08:30', '10:15', '13:00', '18:30', '23:59']);
  assert.equal(formatTime(1440), '00:00');
});

// ---------- money ----------

test('prices are written "CHF 55.00"', () => {
  assert.equal(formatMoney(55), 'CHF 55.00');
  assert.equal(formatMoney(45), 'CHF 45.00');
  assert.equal(formatMoney(0), 'CHF 0.00');
  assert.equal(formatMoney(89.5), 'CHF 89.50');
  assert.equal(formatMoney(19.999), 'CHF 20.00');
  assert.equal(formatMoney(1234.5), "CHF 1'234.50");
  assert.equal(formatMoney(1234567), "CHF 1'234'567.00");
  // No space that a narrow phone could break the price at: the currency and the amount share a line in the views.
  assert.doesNotMatch(formatMoney(240), /\s{2}|\u00a0/);
  // Something that is no amount gives no made-up price.
  assert.equal(formatMoney(Number.NaN), '');
});

// ---------- phone numbers ----------

test('a phone number is stored once, in the international form, however it was typed', () => {
  const stored = '+41791234567';
  for (const typed of [
    '+41 79 123 45 67', '+41791234567',
    '079 123 45 67', '0791234567',         // a leading 0 becomes +41
    '079/123 45 67', '+41/79/123 45 67',   // slashes
    '079-123-45-67', '079.123.45.67', '(079) 123 45 67', ' 079\u00a0123\u00a045\u00a067 ',
    '0041 79 123 45 67', '0041 (79) 123-45-67', // 00 becomes +
    '+41 (0)79 123 45 67', '+41 (0) 79 123 45 67', '0041 (0)79 123 45 67', // "(0)" after a country code is dropped
    '+41 079 123 45 67',                   // and so is a 0 typed without brackets
  ]) {
    assert.equal(normalizePhone(typed), stored, typed);
    assert.equal(phoneProblem(typed), null, typed);
    assert.equal(formatPhone(typed), '+41 79 123 45 67', typed);
  }
  // The record the old form stored for "+41 (0)79 123 45 67" is read as the number that was meant.
  assert.equal(normalizePhone('+410791234567'), stored);
  // Landlines and other countries.
  assert.equal(normalizePhone('071 222 33 44'), '+41712223344');
  assert.equal(normalizePhone('+49 (0)151 23456789'), '+4915123456789');
  assert.equal(normalizePhone('0049 151 23456789'), '+4915123456789');
  assert.equal(normalizePhone('+423 235 12 34'), '+4232351234');
  // Nothing typed stays nothing; text that is no number is not turned into one.
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone('  '), '');
  assert.equal(phoneDigits('Telegram user'), '');
});

test('a phone number is shown grouped: "+41 79 123 45 67"', () => {
  assert.equal(formatPhone('+41791234567'), '+41 79 123 45 67');
  assert.equal(formatPhone('0791234567'), '+41 79 123 45 67');       // stored by the old form without a country code
  assert.equal(formatPhone('+41785550019'), '+41 78 555 00 19');
  assert.equal(formatPhone('+41 78 555 00 19'), '+41 78 555 00 19');
  assert.equal(formatPhone('+41712223344'), '+41 71 222 33 44');
  assert.equal(formatPhone('0800 123 456'), '+41 800 123 456');      // free numbers are read in threes
  // Other countries: the country code, then plain groups.
  assert.equal(formatPhone('+4915123456789'), '+49 151 234 567 89');
  assert.equal(formatPhone('+4232351234'), '+423 235 12 34');
  assert.equal(formatPhone('+33 6 12 34 56 78'), '+33 612 345 678');
  assert.equal(formatPhone('+1 212 555 1234'), '+1 212 555 12 34');
  assert.equal(formatPhone('+351 912 345 678'), '+351 912 345 678');
  // What a chat shows in place of a number is left alone, and never taken for one.
  for (const label of ['+41 ••• ••• 67', '@salonfan', 'Test visitor', 'Telegram user', '']) {
    assert.equal(formatPhone(label), label, label);
    assert.equal(isPhoneNumber(label), false, label);
  }
  assert.equal(isPhoneNumber('+41 79 123 45 67'), true);
  assert.equal(isPhoneNumber(undefined), false);
});

test('the length is checked: 9 digits after +41, 7 to 15 digits for other countries', () => {
  assert.equal(phoneProblem('+41 79 123 45'), 'swiss');       // two digits short
  assert.equal(phoneProblem('079 123 45 6'), 'swiss');
  assert.equal(phoneProblem('079 123 45 678'), 'swiss');      // one too many
  assert.equal(phoneProblem('+41 079 123 45 6'), 'swiss');    // nine digits, but the first is the national 0
  assert.equal(phoneProblem('1234567'), 'prefix');            // neither a 0 nor a country code
  assert.equal(phoneProblem('79 123 45 67'), 'prefix');
  assert.equal(phoneProblem('abc'), 'characters');
  assert.equal(phoneProblem('++41791234567'), 'characters');
  assert.equal(phoneProblem('079 123 45 67 ext. 2'), 'characters');
  assert.equal(phoneProblem(''), 'characters');
  assert.equal(phoneProblem('+49 151 23456789'), null);
  assert.equal(phoneProblem('+423 235 12 34'), null);
  assert.equal(phoneProblem('+49 12345'), null);              // 7 digits with the country code
  assert.equal(phoneProblem('+49 1234'), 'length');
  assert.equal(phoneProblem('+1 234 567 890 123 456'), 'length'); // 16 digits
});

test('numbers are compared on their digits, so two spellings are one number', () => {
  assert.equal(phoneDigits('+41 79 123 45 67'), '41791234567');
  assert.equal(phoneDigits('079 123 45 67'), '41791234567');
  assert.ok(samePhone('079 444 55 66', '+41 79 444 55 66'));
  assert.ok(samePhone('0794445566', '+41794445566'));
  assert.ok(samePhone('+41 (0)79 444 55 66', '0041794445566'));
  assert.ok(samePhone('+41 78 555 00 19', '+41785550019'));
  assert.ok(!samePhone('079 444 55 66', '079 444 55 67'));
  // No number is not "the same number" as no number.
  assert.ok(!samePhone('', ''));
  assert.ok(!samePhone(undefined, null));
  assert.ok(!samePhone('Test visitor', 'Test visitor'));
});

test('a search finds a number in any spelling, and only when the search is a number', () => {
  for (const stored of ['+41791234567', '+41 79 123 45 67', '079 123 45 67', '0791234567']) {
    for (const query of ['079 123', '+41 79 123', '+4179123', '0041 79 123', '+41 (0)79 123', '(079) 123', '079/123', '0791234567', '123 45', '45 67', '+41 79', '+4179', ' 079 ', '0']) {
      assert.ok(phoneMatches(stored, query), `"${query}" finds ${stored}`);
    }
    for (const query of ['078', '+41 78', '079 124', 'Keller', '079 abc', '19.11.', '19.11.2026', '10:00', '', '   ', '+', '00', '()', '+49']) {
      assert.ok(!phoneMatches(stored, query), `"${query}" does not find ${stored}`);
    }
  }
  // The numbers the salon starts with.
  for (const query of ['078 555 00 19', '+41 78 555 00 19', '+41785550019', '+41 78', '078', '00 19', '555']) {
    assert.ok(phoneMatches('+41785550019', query), query);
  }
  assert.ok(!phoneMatches('+41785550019', '+41 79'));
  assert.ok(!phoneMatches('', '079'));
  assert.ok(!phoneMatches('+41 ••• ••• 67', '67'));
});

// ---------- time zones ----------

test('a stored time zone is read as a plain id, and a name that is no zone counts as Zurich', () => {
  assert.equal(timeZoneId('Europe/Zurich'), 'Europe/Zurich');
  assert.equal(timeZoneId('Europe/Zurich (GMT+01:00)'), 'Europe/Zurich'); // as settings were saved before
  assert.equal(timeZoneId(' Europe/London (GMT+00:00) '), 'Europe/London');
  for (const value of ['', '   ', 'Nowhere/Land', '(GMT+01:00)', undefined, null]) assert.equal(timeZoneId(value), 'Europe/Zurich', String(value));
  assert.deepEqual(zonedDateTime(FIXED_NOW, 'Nowhere/Land'), zonedDateTime(FIXED_NOW, 'Europe/Zurich'));
  assert.deepEqual(zonedDateTime(FIXED_NOW), { date: '2026-10-05', time: '12:00' });
  assert.deepEqual(zonedDateTime(FIXED_NOW, 'America/New_York'), { date: '2026-10-05', time: '06:00' });
  assert.equal(timeZoneCity('Europe/Zurich'), 'Zurich');
  assert.equal(timeZoneCity('Europe/Zurich (GMT+01:00)'), 'Zurich');
  assert.equal(timeZoneCity('Europe/Zurich', 'de-CH'), 'Zürich');
  assert.equal(timeZoneCity('America/New_York'), 'New York');
  // A zone is called by its name, never by an offset that is only right for half of the year.
  assert.equal(timeZoneLabel('Europe/Zurich'), 'Central European Time (Zurich)');
  assert.equal(timeZoneLabel('Europe/Zurich', 'de-CH'), 'Mitteleuropäische Zeit (Zürich)');
  assert.equal(timeZoneLabel('Europe/London'), 'London');
  assert.doesNotMatch(timeZoneLabel('Europe/Zurich'), /GMT|UTC|\+0|Europe\//);
});

test('whose clock the times follow is said only when the device shows another time than the salon', () => {
  const salon = 'Europe/Zurich';
  // The same zone, and zones on the same clock all year: nothing to say.
  assert.equal(salonTimeNote(salon, 'Europe/Zurich', FIXED_NOW), null);
  assert.equal(salonTimeNote('Europe/Zurich (GMT+01:00)', 'Europe/Zurich', FIXED_NOW), null);
  assert.equal(salonTimeNote(salon, 'Europe/Berlin', FIXED_NOW), null);
  assert.equal(salonTimeNote(salon, 'Europe/Vaduz', FIXED_NOW), null);
  assert.ok(sameClock(salon, 'Europe/Paris', FIXED_NOW));
  // Another clock: one short note, with the salon's town and no offset or zone id.
  assert.equal(salonTimeNote(salon, 'America/New_York', FIXED_NOW), 'Salon time (Zurich)');
  assert.equal(salonTimeNote(salon, 'Europe/London', FIXED_NOW), 'Salon time (Zurich)');
  assert.equal(salonTimeNote(salon, 'Asia/Tokyo', FIXED_NOW, 'de-CH'), 'Salonzeit (Zürich)');
  // Lagos shows Zurich's time in winter only. Bookings reach into the summer, so it counts as
  // another clock on every day of the year.
  for (const now of ['2026-01-15T12:00:00Z', '2026-04-15T12:00:00Z', '2026-07-15T12:00:00Z', '2026-10-28T12:00:00Z']) {
    assert.ok(!sameClock(salon, 'Africa/Lagos', new Date(now)), now);
    assert.equal(salonTimeNote(salon, 'Africa/Lagos', new Date(now)), 'Salon time (Zurich)', now);
  }
  // Where the viewer's zone is not known (the server, a test, an odd browser) nothing is claimed.
  for (const unknown of [null, undefined, '', 'Not/AZone']) assert.equal(salonTimeNote(salon, unknown, FIXED_NOW), null, String(unknown));
});

// ---------- one place ----------

test('only src/format.ts asks the browser or the server for a format', () => {
  // A second toLocaleDateString somewhere would bring back a second date format, and one that
  // changes with the device. Everything that writes a date, time or price asks src/format.ts.
  const root = path.resolve(import.meta.dirname, '..');
  const files = (folder: string): string[] => readdirSync(path.join(root, folder)).flatMap((name) => {
    const relative = path.join(folder, name);
    return statSync(path.join(root, relative)).isDirectory() ? files(relative) : /\.tsx?$/.test(name) ? [relative] : [];
  });
  const offenders = ['src', 'server', 'api'].flatMap(files)
    .filter((file) => file !== path.join('src', 'format.ts'))
    .filter((file) => /\.toLocale(Date|Time)?String\(|\bIntl\./.test(readFileSync(path.join(root, file), 'utf8')));
  assert.deepEqual(offenders, []);
});
