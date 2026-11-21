import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { initialServices } from '../src/mockData';
import { STAFF_COLORS } from '../src/staffColors';
import type { CalendarEvent } from '../src/types';
import { CalendarView } from '../src/views/CalendarView';
import { ANNA, FRI, HOURS, LUCA, MON, SAT, SELINA, SHIFTS, SUN, TEAM, THU, TUE, WED, WEEK, appointment, moment, person, shifts } from './calendarFixture';
import { TELL_WORDS, readableText, render } from './renderHelpers';

// The calendar as it is drawn: the week and the day on a laptop, the day with its strip and the
// week as a picture on a phone, the list. The arithmetic behind it is in
// tests/calendarLayout.test.ts; the address in tests/navigation.test.ts.
//
// The salon is the small one of tests/calendarFixture.ts, in the week from Monday 5 to Sunday
// 11 October 2026. It is Thursday 8 October, 13:10.

const nothing = () => {};
const NOW = moment(THU, '13:10');
const EVENTS: CalendarEvent[] = [
  appointment('cal-tue', ANNA, TUE, '09:00', '09:30', { customerName: 'Livia Hauser' }),
  // Thursday, today: a cut that is over (booked by the AI), a colouring that is going on, and two with Selina.
  appointment('cal-cut', ANNA, THU, '10:00', '10:30', { customerName: 'Christian Hungerbühler', isAiBooked: true }),
  appointment('cal-colour', ANNA, THU, '13:00', '14:30', { customerName: 'Sabrina Lutz', serviceId: 'srv-3', serviceName: 'Colouring' }),
  appointment('cal-noon', SELINA, THU, '12:30', '13:00', { customerName: 'Blerta Morina' }),
  appointment('cal-chat', SELINA, THU, '14:00', '15:00', { customerName: 'Giulia Rossi', conversationId: 'conv-giulia' }),
  // Friday: Anna and Selina at the same time, then Luca back to back with both; later a request that was accepted.
  appointment('cal-fri-a', ANNA, FRI, '11:00', '12:00', { customerName: 'Roger Manser' }),
  appointment('cal-fri-s', SELINA, FRI, '11:30', '12:00', { customerName: 'Jasmin Stucki', serviceId: 'srv-3', serviceName: 'Colouring' }),
  appointment('cal-fri-l', LUCA, FRI, '12:00', '12:30', { customerName: 'Céline Hug' }),
  appointment('cal-req-7', LUCA, FRI, '15:00', '15:30', { customerName: 'Ruth Wild' }),
  appointment('cal-sat', ANNA, SAT, '09:00', '09:30', { customerName: 'Rita Suter' }),
];

type Props = React.ComponentProps<typeof CalendarView>;
const calendar = (partial: Partial<Props> = {}): string => render(React.createElement(CalendarView, {
  events: EVENTS, services: initialServices, employees: TEAM, bookingHours: HOURS, shiftOverview: SHIFTS, requests: [],
  timeZone: 'Europe/Zurich', date: THU, now: NOW, selectedEventId: null,
  onSelectEvent: nothing, onDateChange: nothing, onOpenAppointmentForm: () => {}, onDeleteEvent: nothing, ...partial,
}));

const count = (html: string, part: string) => html.split(part).length - 1;
const all = (html: string, pattern: RegExp): string[] => Array.from(html.matchAll(pattern), (match) => match[1]);
/** The markup of every column of the grid, by its key (a date in the week, a stylist in the day view). */
const columnsOf = (html: string): Map<string, string> => {
  const grid = html.slice(html.indexOf('data-calendar-grid='));
  return new Map(grid.split('data-column="').slice(1).map((part) => [part.slice(0, part.indexOf('"')), part.split('data-scroll-anchor')[0]]));
};
const slotsIn = (column: string) => all(column, /data-slot="([^"]+)"/g);
/** Top and height of what a column shades or mutes, in hours. */
const bands = (column: string, kind: 'shaded' | 'past'): [number, number][] =>
  Array.from(column.matchAll(new RegExp(`data-${kind}=""[^>]*style="top:calc\\(var\\(--cal-hour\\) \\* ([\\d.]+)\\);height:calc\\(var\\(--cal-hour\\) \\* ([\\d.]+)\\)"`, 'g')), (match) => [Number(match[1]), Number(match[2])]);
/** How an appointment is placed: top and height in hours, and its left edge and width as shares of the column. */
const placeOf = (html: string, id: string) => {
  const style = new RegExp(`<button type="button" data-event="${id}"[^>]*style="([^"]*)"`).exec(html)?.[1] ?? '';
  const number = (pattern: RegExp) => Number(pattern.exec(style)?.[1]);
  return {
    top: number(/top:calc\(calc\(var\(--cal-hour\) \* ([\d.]+)\) \+ 1px\)/),
    height: number(/height:calc\(calc\(var\(--cal-hour\) \* ([\d.]+)\) - 2px\)/),
    left: number(/left:calc\(\(100% - \d+px\) \* ([\d.]+) \+ 1px\)/),
    width: number(/width:calc\(\(100% - \d+px\) \* ([\d.]+) - 2px\)/),
    fill: /background-color:(#[0-9a-f]{6})/.exec(style)?.[1],
    ink: /;color:(#[0-9a-f]{6})/.exec(style)?.[1],
    accent: /border-left:3px solid (#[0-9a-f]{6})/.exec(style)?.[1],
  };
};
const labelOf = (html: string, id: string) => new RegExp(`data-event="${id}" aria-label="([^"]*)"`).exec(html)?.[1];
/** The view switcher: which of Day, Week and List is pressed. */
const pressed = (html: string) => Object.fromEntries(Array.from(html.matchAll(/<button type="button" aria-pressed="(true|false)" class="[^"]*">(Day|Week|List)<\/button>/g), (match) => [match[2], match[1] === 'true']));
/** What a person reads or hears, with every run of spaces as one. */
const words = (html: string) => readableText(html).replace(/\s+/g, ' ');

// ---------- to scale ----------

test('appointments are drawn to scale: by their start, and as tall as they are long', () => {
  const html = calendar();
  const cut = placeOf(html, 'cal-cut');         // 10:00–10:30
  const colouring = placeOf(html, 'cal-colour'); // 13:00–14:30
  // The grid starts at 08:00: the cut two hours down, the colouring five.
  assert.deepEqual([cut.top, cut.height], [2, 0.5]);
  assert.deepEqual([colouring.top, colouring.height], [5, 1.5]);
  assert.equal(colouring.height, 3 * cut.height);
  // Every hour has its line and its label; the half hours have a fainter line between them.
  assert.deepEqual(all(html, /<span class="absolute right-1\.5 [^"]*"[^>]*>(\d\d:\d\d)<\/span>/g), ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
  assert.match(html, /background-size:100% var\(--cal-hour\), 100% calc\(var\(--cal-hour\) \/ 2\)/);
  // One hour is taller where fingers tap: half an hour is then 44 px (5.75rem are 92 px, less 2 px between two appointments).
  assert.match(html, /\[--cal-hour:5\.75rem\] [^"]*md:\[--cal-hour:4\.5rem\] md:pointer-coarse:\[--cal-hour:5\.75rem\]/);
});

test('in the week, appointments at the same time stand side by side, and back to back they do not overlap', () => {
  const html = calendar();
  const anna = placeOf(html, 'cal-fri-a');    // 11:00–12:00
  const selina = placeOf(html, 'cal-fri-s');  // 11:30–12:00
  const luca = placeOf(html, 'cal-fri-l');    // 12:00–12:30, starts when both end
  assert.deepEqual([anna.left, anna.width], [0, 0.5]);
  assert.deepEqual([selina.left, selina.width], [0.5, 0.5]);
  assert.deepEqual([luca.left, luca.width], [0, 1]);
  assert.equal(anna.top + anna.height, luca.top);
  // The day has seven columns, Monday first, and the appointments lie in their day's column.
  const columns = columnsOf(html);
  assert.deepEqual([...columns.keys()], WEEK);
  assert.deepEqual(all(columns.get(FRI)!, /data-event="([^"]+)"/g), ['cal-fri-a', 'cal-fri-s', 'cal-fri-l', 'cal-req-7']);
  assert.deepEqual(all(columns.get(TUE)!, /data-event="([^"]+)"/g), ['cal-tue']);
  assert.deepEqual(all(columns.get(MON)!, /data-event="([^"]+)"/g), []);
});

test('a narrow appointment still shows a time and a name, and says everything to a screen reader and on hover', () => {
  const html = calendar();
  const block = new RegExp('<button type="button" data-event="cal-cut".*?</button>').exec(html)![0];
  // The start alone or start and end, and initials, the first name or the full name: the width of the block decides.
  assert.match(block, /<span class="@\[7rem\]:hidden">10:00<\/span><span class="hidden @\[7rem\]:inline">10:00–10:30<\/span>/);
  assert.match(block, /<span class="@\[2\.75rem\]:hidden">CH<\/span><span class="hidden @\[2\.75rem\]:inline @\[6\.5rem\]:hidden">Christian<\/span><span class="hidden @\[6\.5rem\]:inline">Christian Hungerbühler<\/span>/);
  assert.match(block, /class="@container /);
  // The whole of it: customer, service, day, time, stylist and how it was booked.
  assert.equal(labelOf(html, 'cal-cut'), 'Open appointment for Christian Hungerbühler: Haircut, Thursday, 08.10.2026, 10:00–10:30, with Anna Weber. Booked by the AI.');
  assert.match(block, /title="Christian Hungerbühler · Haircut · 10:00–10:30 · Anna Weber"/);
  // Appointments stay buttons, so the keyboard reaches each of them; and "Add" stays.
  assert.equal(count(html, '<button type="button" data-event="'), EVENTS.length);
  assert.match(html, /aria-label="Add appointment"[^>]*><svg[^>]*>.*?<\/svg><span>Add<\/span><\/button>/);
});

// ---------- today and now ----------

test('today is marked, a line stands at the current time, and what is past is muted', () => {
  const html = calendar();
  const columns = columnsOf(html);
  // Today's heading, and only today's.
  assert.equal(count(html, 'aria-current="date"'), 1);
  assert.match(html, /<button type="button" data-date="2026-10-08" aria-current="date" aria-label="Thursday, 08\.10\.2026, today, 4 appointments\. Open this day"/);
  assert.match(columns.get(THU)!, /^2026-10-08" data-date="2026-10-08" class="[^"]*bg-indigo-50\/40"/);
  // 13:10 is 5 hours and 10 minutes below 08:00. The line is in today's column, the time in the margin.
  assert.equal(count(html, 'data-now=""'), 1);
  assert.match(columns.get(THU)!, /data-now="" class="[^"]*" style="top:calc\(var\(--cal-hour\) \* 5\.1667\)"/);
  assert.match(html, /data-now-time=""[^>]*style="top:calc\(var\(--cal-hour\) \* 5\.1667\)"><span class="sr-only">Now <\/span>13:10<\/span>/);
  // On opening the grid scrolls to an hour before now.
  assert.match(html, /data-scroll-anchor=""[^>]*style="top:calc\(var\(--cal-hour\) \* 4\.1667\)"/);
  // Past: all of Monday to Wednesday, Thursday up to the line, nothing of Friday.
  for (const day of [MON, TUE, WED]) assert.deepEqual(bands(columns.get(day)!, 'past'), [[0, 11]], day);
  assert.deepEqual(bands(columns.get(THU)!, 'past'), [[0, 5.1667]]);
  for (const day of [FRI, SAT, SUN]) assert.deepEqual(bands(columns.get(day)!, 'past'), [], day);
  // An appointment that is over wears its stylist's paler colours; one that is going on or to come the full ones.
  const [violet, green] = STAFF_COLORS;
  assert.deepEqual(placeOf(html, 'cal-cut').fill, violet.pastFill);
  assert.deepEqual(placeOf(html, 'cal-colour').fill, violet.fill);
  assert.deepEqual(placeOf(html, 'cal-noon').fill, green.pastFill);
  assert.deepEqual(placeOf(html, 'cal-chat').fill, green.fill);
  // Another week has no today, no line and nothing to scroll to.
  const nextWeek = calendar({ date: '2026-10-15' });
  for (const mark of ['aria-current="date"', 'data-now=""', 'data-now-time', 'data-scroll-anchor', 'data-past=""']) assert.equal(count(nextWeek, mark), 0, mark);
});

// ---------- colour and source ----------

test('a stylist has one colour everywhere: in the legend, on appointments and in the list', () => {
  const [violet, green, blue] = STAFF_COLORS;
  const html = calendar();
  // The legend: one button per stylist, with the dot in their colour.
  const legend = /<div role="group" aria-label="Stylists"[^>]*>(.*?)<\/div>/.exec(html)![1];
  assert.deepEqual(all(legend, /aria-label="Only ([^"]+)"/g), ['Anna Weber', 'Selina Keller', 'Luca Frei']);
  assert.deepEqual(all(legend, /<span aria-hidden="true" class="[^"]*" style="background-color:(#[0-9a-f]{6})">/g), [violet.accent, green.accent, blue.accent]);
  assert.deepEqual(all(legend, /<\/span>([^<]+)<\/button>/g), ['Anna', 'Selina', 'Luca']);
  // Their appointments: the same strong colour at the edge, text in the dark ink on the light fill.
  const anna = placeOf(html, 'cal-fri-a');
  assert.deepEqual([anna.accent, anna.fill, anna.ink], [violet.accent, violet.fill, violet.ink]);
  assert.deepEqual(placeOf(html, 'cal-fri-s').accent, green.accent);
  assert.deepEqual(placeOf(html, 'cal-fri-l').accent, blue.accent);
  // A filter does not repaint who stays: Luca alone is still blue.
  assert.deepEqual(placeOf(calendar({ staffFilter: LUCA.id }), 'cal-fri-l').accent, blue.accent);
  // The list marks each appointment with the same colour.
  const list = calendar({ view: 'list' });
  assert.match(list, new RegExp(`data-event="cal-fri-l"[^>]*><span aria-hidden="true" class="[^"]*" style="background-color:${blue.accent}">`));
  // Two people with one first name are told apart in the legend.
  const twoAnnas = calendar({ employees: [...TEAM, person('emp-4', 'Anna', 'Keller')] });
  assert.deepEqual(all(/<div role="group" aria-label="Stylists"[^>]*>(.*?)<\/div>/.exec(twoAnnas)![1], /<\/span>([^<]+)<\/button>/g), ['Anna W.', 'Selina', 'Luca', 'Anna K.']);
});

test('how an appointment was booked is a small icon with a name', () => {
  const html = calendar();
  const source = (id: string) => new RegExp(`data-event="${id}".*?<span role="img" aria-label="([^"]+)" title="\\1" data-source="([^"]+)"`).exec(html)?.slice(1, 3);
  assert.deepEqual(source('cal-cut'), ['Booked by the AI', 'ai']);
  assert.deepEqual(source('cal-chat'), ['Booked in a chat', 'chat']);
  assert.deepEqual(source('cal-req-7'), ['Booked on the booking page', 'booking-page']);
  assert.deepEqual(source('cal-sat'), ['Booked by hand', 'manual']);
  // Every appointment has one, and the name is part of what a screen reader says for the appointment.
  assert.equal(count(html, '<span role="img" aria-label="Booked '), EVENTS.length);
  assert.match(labelOf(html, 'cal-chat')!, /with Selina Keller\. Booked in a chat\.$/);
  assert.match(labelOf(html, 'cal-req-7')!, /Booked on the booking page\.$/);
  // The details say it in words, for all four.
  for (const [id, words] of [['cal-cut', 'Booked by the AI'], ['cal-chat', 'Booked in a chat'], ['cal-req-7', 'Booked on the booking page'], ['cal-sat', 'Booked by hand']]) {
    const details = /<dialog.*?<\/dialog>/.exec(calendar({ selectedEventId: id }))![0];
    assert.match(readableText(details), new RegExp(`${words}\\s+Edit appointment`), id);
  }
});

test('the legend filters: one stylist, and with it the working hours of that stylist', () => {
  const selina = calendar({ staffFilter: SELINA.id });
  assert.deepEqual(all(selina, /data-stylist="([^"]+)" aria-pressed="true"/g), [SELINA.id]);
  assert.equal(count(selina, 'aria-pressed="false" aria-label="Only '), 2);
  assert.deepEqual(all(selina, /<button type="button" data-event="([^"]+)"/g), ['cal-noon', 'cal-chat', 'cal-fri-s']);
  assert.match(readableText(selina), /Only Selina Keller: 3 appointments in this week\.\s+Show all/);
  // Her week: Tuesday off, Wednesday from 10:00, Thursday 12:00 to 15:30 only.
  const columns = columnsOf(selina);
  assert.match(columns.get(TUE)!, /<p data-shade-label=""[^>]*>Not working<\/p>/);
  assert.deepEqual(bands(columns.get(TUE)!, 'shaded'), [[0, 11]]);
  assert.deepEqual(bands(columns.get(THU)!, 'shaded'), [[0, 4], [7.5, 3.5]]);
  assert.deepEqual(slotsIn(columns.get(THU)!), ['13:30', '14:00', '14:30', '15:00']);
  assert.deepEqual(slotsIn(columns.get(FRI)!).slice(0, 2).concat(slotsIn(columns.get(FRI)!).slice(-1)), ['08:30', '09:00', '16:30']);
  // Away for a course on Friday: her day says so, once.
  const away = columnsOf(calendar({ staffFilter: SELINA.id, absences: [{ id: 'a-1', employeeId: SELINA.id, start: FRI, end: FRI, reason: 'Course' }] })).get(FRI)!;
  assert.match(away, /<p data-shade-label=""[^>]*>Away<span class="block truncate font-normal">Course<\/span><\/p>/);
  assert.deepEqual(slotsIn(away), []);
  // The service filter, alone and together with a stylist.
  const colourings = calendar({ serviceFilter: 'srv-3' });
  assert.deepEqual(all(colourings, /<button type="button" data-event="([^"]+)"/g), ['cal-colour', 'cal-fri-s']);
  assert.match(colourings, /<select aria-label="Service"[^>]*>.*?<option value="srv-3" selected="">Colouring<\/option>/);
  assert.match(readableText(calendar({ serviceFilter: 'srv-3', staffFilter: ANNA.id })), /Only Anna Weber · Colouring: 1 appointment in this week\./);
  assert.match(readableText(calendar({ serviceFilter: 'srv-10', staffFilter: LUCA.id })), /Only Luca Frei · Updo: no appointments in this week\./);
  // A filter that names nobody and nothing filters nothing.
  const unknown = calendar({ staffFilter: 'emp-gone', serviceFilter: 'srv-gone' });
  assert.equal(count(unknown, '<button type="button" data-event="'), EVENTS.length);
  assert.doesNotMatch(unknown, /Show all/);
});

// ---------- free and not free ----------

test('a free half hour takes a click; shaded and past places are not there to be clicked', () => {
  const columns = columnsOf(calendar());
  // Monday and Sunday are closed, Tuesday and Wednesday are over: no place at all.
  for (const day of [MON, TUE, WED, SUN]) assert.deepEqual(slotsIn(columns.get(day)!), [], day);
  // Today from the next half hour that has not begun, to the last one before closing.
  const today = slotsIn(columns.get(THU)!);
  assert.deepEqual([today[0], today.at(-1), today.length], ['13:30', '18:00', 10]);
  // Friday all day inside the opening hours, Saturday inside its shorter ones.
  const friday = slotsIn(columns.get(FRI)!);
  assert.deepEqual([friday[0], friday.at(-1), friday.length], ['08:30', '18:00', 20]);
  const saturday = slotsIn(columns.get(SAT)!);
  assert.deepEqual([saturday[0], saturday.at(-1), saturday.length], ['08:00', '15:30', 16]);
  // Outside the opening hours the column is shaded: half an hour before 08:30 and after 18:30, on Saturday from 16:00.
  assert.deepEqual(bands(columns.get(FRI)!, 'shaded'), [[0, 0.5], [10.5, 0.5]]);
  assert.deepEqual(bands(columns.get(SAT)!, 'shaded'), [[8, 3]]);
  // A place is half an hour tall and looks like something to click; what is shaded or past takes no pointer at all.
  assert.match(columns.get(FRI)!, /<div data-slot="08:30" class="[^"]*cursor-pointer[^"]*" style="top:calc\(var\(--cal-hour\) \* 0\.5\);height:calc\(var\(--cal-hour\) \* 0\.5\)">/);
  assert.match(columns.get(FRI)!, /data-shaded="" class="pointer-events-none /);
  assert.match(columns.get(THU)!, /data-past="" class="pointer-events-none /);
  // Without a service nothing can be added: the grid offers no place, and the page says why.
  const noServices = calendar({ services: [] });
  assert.equal(count(noServices, 'data-slot="'), 0);
  assert.match(noServices, /Add a service in Services before creating an appointment/);
});

test('a closed day is one shaded column with a single label', () => {
  const html = calendar();
  const columns = columnsOf(html);
  for (const day of [MON, SUN]) {
    const column = columns.get(day)!;
    assert.deepEqual(bands(column, 'shaded'), [[0, 11]], day);
    assert.equal(count(column, 'data-shade-label'), 1, day);
    assert.equal(count(column, '>Closed<'), 1, day);
    assert.match(column, /^[^>]*class="relative /);
  }
  // Twice in the whole week, once per closed day: no "Closed" in every hour, none in the headings.
  assert.equal(count(html, '>Closed<'), 2);
  assert.equal(count(html, 'data-shade-label'), 2);
  assert.match(html, /role="group" aria-label="Monday, 05\.10\.2026, closed" data-column="2026-10-05"/);
  // A closed date carries its name, and the appointments that were booked before stay visible on it.
  const teamDay = calendar({ closedDates: [{ id: 'c-1', name: 'Team day', start: FRI, end: FRI }] });
  const friday = columnsOf(teamDay).get(FRI)!;
  assert.match(friday, /<p data-shade-label=""[^>]*>Closed<span class="block truncate font-normal">Team day<\/span><\/p>/);
  assert.deepEqual(slotsIn(friday), []);
  assert.equal(count(friday, 'data-event="'), 4);
  // In the day view such a day is a single column for everybody, not one per stylist.
  const day = calendar({ view: 'day', date: FRI, closedDates: [{ id: 'c-1', name: 'Team day', start: FRI, end: FRI }] });
  assert.deepEqual([...columnsOf(day).keys()], [FRI]);
  assert.equal(count(day, 'data-person='), 0);
  assert.equal(count(columnsOf(day).get(FRI)!, '>Closed<'), 1);
  assert.equal(count(day, 'data-shade-label'), 1);
  assert.equal(count(columnsOf(day).get(FRI)!, 'data-event="'), 4);
});

// ---------- the day view ----------

test('the day view on a laptop has one column per stylist who works that day', () => {
  const html = calendar({ view: 'day' });
  assert.match(html, /data-calendar-grid="day"/);
  // Thursday: Anna and Selina. Luca does not work on Thursdays.
  assert.deepEqual(all(html, /<div data-person="([^"]+)"/g), [ANNA.id, SELINA.id]);
  assert.deepEqual([...columnsOf(html).keys()], [ANNA.id, SELINA.id]);
  // Each heading names the stylist, the hours and the number of appointments.
  assert.match(readableText(html), /Anna Weber\s+10:00–18:30\s+· 2 appointments\s+S?K?\s*Selina\s+Selina Keller\s+12:00–15:30\s+· 2 appointments/);
  // Each column is shaded outside that stylist's working hours, and offers the free half hours inside them.
  const columns = columnsOf(html);
  assert.deepEqual(bands(columns.get(ANNA.id)!, 'shaded'), [[0, 2], [10.5, 0.5]]);
  assert.deepEqual(bands(columns.get(SELINA.id)!, 'shaded'), [[0, 4], [7.5, 3.5]]);
  assert.deepEqual(slotsIn(columns.get(SELINA.id)!), ['13:30', '14:00', '14:30', '15:00']);
  assert.equal(slotsIn(columns.get(ANNA.id)!).length, 10);
  // An appointment fills its stylist's column.
  assert.deepEqual(all(columns.get(ANNA.id)!, /data-event="([^"]+)"/g), ['cal-cut', 'cal-colour']);
  assert.deepEqual([placeOf(html, 'cal-colour').left, placeOf(html, 'cal-colour').width], [0, 1]);
  // Today: the line runs across all columns.
  assert.equal(count(html, 'data-now=""'), 1);
  // The corner of the grid names the day, so the day stays in view with the columns while the hours scroll.
  assert.match(html, /<div data-grid-corner=""[^>]*><span class="[^"]*">Thu<\/span><span class="[^"]*">08<\/span><\/div>/);
  assert.match(calendar(), /<div data-grid-corner=""[^>]*><\/div>/);
  // The headings stick to the top of the grid's own frame, which the keyboard can scroll.
  assert.match(html, /data-calendar-grid="day" role="region" aria-label="Appointments by time of day" tabindex="0" class="[^"]*overflow-auto/);
  assert.match(html, /<div class="sticky top-0 z-30 [^"]*"[^>]*><div data-grid-corner=""/);
  // Friday has all three; with a stylist chosen in the legend only that column is left.
  assert.deepEqual([...columnsOf(calendar({ view: 'day', date: FRI })).keys()], [ANNA.id, SELINA.id, LUCA.id]);
  assert.deepEqual([...columnsOf(calendar({ view: 'day', date: FRI, staffFilter: LUCA.id })).keys()], [LUCA.id]);
  // The arrows turn one day on a laptop.
  assert.match(html, /aria-label="Previous day".*aria-label="Next day"/);
  assert.match(calendar(), /aria-label="Previous week".*aria-label="Next week"/);
});

test('whoever has an appointment gets a column, and an absence shows on the person\'s column', () => {
  // Luca has an appointment on Thursday, a day on which he does not work.
  const events = [...EVENTS, appointment('cal-luca', LUCA, THU, '16:00', '16:30', { customerName: 'Ruth Wild' })];
  const html = calendar({ view: 'day', events });
  const columns = columnsOf(html);
  assert.deepEqual([...columns.keys()], [ANNA.id, SELINA.id, LUCA.id]);
  assert.match(columns.get(LUCA.id)!, /<p data-shade-label=""[^>]*>Not working<\/p>/);
  assert.deepEqual(slotsIn(columns.get(LUCA.id)!), []);
  assert.deepEqual(all(columns.get(LUCA.id)!, /data-event="([^"]+)"/g), ['cal-luca']);
  // Selina is away on Thursday: her column stays and says why.
  const away = calendar({ view: 'day', absences: [{ id: 'a-1', employeeId: SELINA.id, start: THU, end: THU, reason: 'Course' }] });
  const selina = columnsOf(away).get(SELINA.id)!;
  assert.match(selina, /<p data-shade-label=""[^>]*>Away<span class="block truncate font-normal">Course<\/span><\/p>/);
  assert.deepEqual(bands(selina, 'shaded'), [[0, 11]]);
  assert.match(readableText(away), /Selina Keller\s+Away\s+· 2 appointments/);
  // In the week for everybody, the day's heading says who is away.
  const week = calendar({ absences: [{ id: 'a-1', employeeId: SELINA.id, start: FRI, end: SAT, reason: 'Course' }] });
  assert.equal(count(week, '>Selina away<'), 2);
  assert.match(week, /aria-label="Friday, 09\.10\.2026, 4 appointments, Selina away\. Open this day"/);
});

// ---------- phones ----------

test('on a phone the calendar opens on the day view, with a strip from Monday to Sunday above it', () => {
  const html = calendar({ phone: true });
  assert.match(html, /data-calendar-grid="day"/);
  assert.deepEqual(pressed(html), { Day: true, Week: false, List: false });
  // The strip: seven days, Monday first; the day shown is pressed, today is marked.
  const strip = /<div role="group" aria-label="Days of week 41" data-week-strip=""[^>]*>(.*?)<\/div>/.exec(html)![1];
  assert.deepEqual(all(strip, /data-day="([^"]+)"/g), WEEK);
  assert.deepEqual(all(strip, /<button type="button" data-day="[^"]+" aria-pressed="(true|false)"/g), ['false', 'false', 'false', 'true', 'false', 'false', 'false']);
  assert.deepEqual(all(strip, /data-day="([^"]+)" aria-pressed="[^"]+" aria-current="date"/g), [THU]);
  // It says which days have appointments, in words and with a dot.
  assert.deepEqual(all(strip, /aria-label="([^"]+)"/g), [
    'Monday, 05.10.2026, closed, no appointments', 'Tuesday, 06.10.2026, 1 appointment', 'Wednesday, 07.10.2026, no appointments',
    'Thursday, 08.10.2026, today, 4 appointments', 'Friday, 09.10.2026, 4 appointments', 'Saturday, 10.10.2026, 1 appointment', 'Sunday, 11.10.2026, closed, no appointments',
  ]);
  const dots = all(strip, /<span aria-hidden="true" class="h-1\.5 w-1\.5 rounded-full md:hidden ([^"]+)">/g);
  assert.deepEqual(dots.map((dot) => dot !== 'bg-transparent'), [false, true, false, true, true, true, false]);
  assert.deepEqual(all(strip, />(MON|TUE|WED|THU|FRI|SAT|SUN|Mon|Tue|Wed|Thu|Fri|Sat|Sun)<\/span><span class="[^"]*md:hidden">(\d+)</g).length, 7);
  // Every day is a tap target of 44 px and more in height.
  assert.equal(count(strip, 'min-h-[3.25rem]'), 7);
  // Above the strip: which day it is. One row of controls: the arrows with "Today", and the three views.
  assert.match(readableText(html), /Thursday, 08\.10\.2026\s+Today\s+· 4 appointments/);
  assert.match(html, /aria-label="Previous week".*?>Today<\/button>.*?aria-label="Next week"/);
  // The tab bar has "+" for a new appointment: the calendar adds no button of its own.
  assert.doesNotMatch(html, /Add appointment/);
  assert.equal(count(html, 'type="date"'), 0);
  // A wider screen opens on the week; a chosen view wins on both.
  assert.match(calendar(), /data-calendar-grid="week"/);
  assert.deepEqual(pressed(calendar()), { Day: false, Week: true, List: false });
  assert.match(calendar({ phone: true, view: 'week' }), /data-calendar-grid="week"/);
  assert.match(calendar({ view: 'day' }), /data-calendar-grid="day"/);
  assert.match(calendar({ view: 'day' }), /data-week-strip=""/);
});

test('on a phone the headings of the day\'s columns are the legend, and they filter', () => {
  const html = calendar({ phone: true });
  // One column per stylist, each heading a button; no second row repeats the names.
  assert.deepEqual(all(html, /<button type="button" data-person="([^"]+)" data-stylist="\1" aria-pressed="false" aria-label="Only [^"]+"/g), [ANNA.id, SELINA.id]);
  assert.doesNotMatch(html, /aria-label="Stylists"/);
  assert.match(html, /data-person="emp-1"[^>]*class="[^"]*min-h-11/);
  // Selina alone: her heading is pressed and wears her colour, and her column is the only one.
  const selina = calendar({ phone: true, staffFilter: SELINA.id });
  assert.deepEqual(all(selina, /data-person="([^"]+)" data-stylist="[^"]+" aria-pressed="true"/g), [SELINA.id]);
  assert.match(selina, new RegExp(`data-person="emp-2"[^>]*style="background-color:${STAFF_COLORS[1].fill}"`));
  assert.deepEqual([...columnsOf(selina).keys()], [SELINA.id]);
  // The service filter is behind its button; the week and the list show the legend as a row.
  assert.match(html, /<button type="button" aria-expanded="false" aria-controls="calendar-filters" aria-label="Filter by service"/);
  assert.match(calendar({ phone: true, serviceFilter: 'srv-3' }), /aria-label="Service: Colouring"/);
  for (const view of ['week', 'list'] as const) assert.match(calendar({ phone: true, view }), /<div role="group" aria-label="Stylists"/, view);
});

test('the week on a phone is a picture of the week: no sideways table, and a tap on a day opens it', () => {
  const html = calendar({ phone: true, view: 'week' });
  // Seven columns that share the width, however narrow: nothing has a width of its own.
  assert.match(html, /grid-template-columns:repeat\(7, minmax\(0px, 1fr\)\)/);
  assert.doesNotMatch(html, /min-w-\[\d+px\]/);
  assert.doesNotMatch(html, /Scroll sideways/);
  // Appointments are coloured bars to scale, in their stylist's colour. They are not buttons: too narrow to tap or read.
  assert.equal(count(html, 'data-bar="'), EVENTS.length);
  assert.equal(count(html, 'data-event="'), 0);
  assert.equal(count(html, 'data-slot="'), 0);
  assert.match(html, new RegExp(`<span aria-hidden="true" data-bar="cal-fri-l" class="[^"]*" style="[^"]*height:calc\\(calc\\(var\\(--cal-hour\\) \\* 0\\.5\\) - 2px\\)[^"]*background-color:${STAFF_COLORS[2].accent}"`));
  assert.match(html, new RegExp(`data-bar="cal-cut"[^>]*background-color:${STAFF_COLORS[0].pastAccent}"`));
  // Each day's heading is the button that opens the day, and says what the day holds.
  assert.deepEqual(all(html, /<button type="button" data-date="([^"]+)"/g), WEEK);
  assert.match(html, /aria-label="Friday, 09\.10\.2026, 4 appointments\. Open this day"/);
  // Today, the line at now and the closed days are there as on a laptop.
  assert.equal(count(html, 'aria-current="date"'), 1);
  assert.equal(count(html, 'data-now=""'), 1);
  assert.equal(count(html, 'data-shade-label'), 2);
  assert.match(readableText(html), /05\.–11\.10\.2026\s+Week 41 · 10 appointments/);
});

// ---------- the list and the details ----------

test('the list shows the week day by day', () => {
  const html = calendar({ view: 'list' });
  assert.doesNotMatch(html, /data-calendar-grid/);
  assert.deepEqual(pressed(html), { Day: false, Week: false, List: true });
  // A heading per day that has appointments, in the Swiss form, with today marked.
  assert.deepEqual(all(html, /<h2 id="calendar-list-(\d{4}-\d\d-\d\d)"/g), [TUE, THU, FRI, SAT]);
  assert.match(readableText(html), /Tue, 06\.10\.2026\s+1 appointment\s/);
  assert.match(readableText(html), /Thu, 08\.10\.2026\s+Today\s+4 appointments\s/);
  // Every appointment is a button with time, customer, service and stylist, and how it was booked.
  assert.deepEqual(all(html, /<button type="button" data-event="([^"]+)"/g), ['cal-tue', 'cal-cut', 'cal-noon', 'cal-colour', 'cal-chat', 'cal-fri-a', 'cal-fri-s', 'cal-fri-l', 'cal-req-7', 'cal-sat']);
  assert.match(readableText(html), /11:30–12:00\s+Jasmin Stucki\s+Colouring · Selina Keller\s+Booked by hand/);
  assert.match(html, /data-event="cal-req-7" aria-label="Open appointment for Ruth Wild: Haircut, Friday, 09\.10\.2026, 15:00–15:30, with Luca Frei\. Booked on the booking page\."/);
  // The filters apply, and an empty week says so.
  assert.deepEqual(all(calendar({ view: 'list', staffFilter: LUCA.id }), /<button type="button" data-event="([^"]+)"/g), ['cal-fri-l', 'cal-req-7']);
  assert.match(calendar({ view: 'list', date: '2026-10-15' }), /No appointments in this week\./);
});

test('an appointment\'s details keep their actions', () => {
  const html = calendar({ selectedEventId: 'cal-chat', conversationFor: () => ({ id: 'conv-giulia', channel: 'Website' }), onOpenConversation: nothing });
  const details = /<dialog.*?<\/dialog>/.exec(html)![0];
  assert.match(words(details), /Appointment details Giulia Rossi Service: Haircut Time: Thu, 08\.10\.2026, 14:00–15:00 Stylist: Selina Keller Contact: via web chat Booked in a chat Edit appointment Open conversation Cancel appointment Close /);
  // The appointment behind the details is marked in the grid.
  assert.match(html, /data-event="cal-chat"[^>]*class="[^"]*ring-2 ring-\[#5551FF\]/);
  assert.doesNotMatch(calendar(), /<dialog/);
});

// ---------- wording ----------

test('no view of the calendar shows a stored date, a word that gives the salon away, or a title in capitals', () => {
  const views: Record<string, string> = {
    week: calendar(),
    day: calendar({ view: 'day' }),
    list: calendar({ view: 'list' }),
    'phone, day': calendar({ phone: true }),
    'phone, week': calendar({ phone: true, view: 'week' }),
    'phone, list': calendar({ phone: true, view: 'list' }),
    details: calendar({ selectedEventId: 'cal-cut' }),
    filtered: calendar({ staffFilter: SELINA.id, serviceFilter: 'srv-3' }),
    'closed date': calendar({ view: 'day', date: FRI, closedDates: [{ id: 'c-1', name: 'Team day', start: FRI, end: FRI }] }),
    'nobody works': calendar({ view: 'day', date: FRI, shiftOverview: [shifts(ANNA, { [FRI]: null })], events: [] }),
  };
  for (const [name, html] of Object.entries(views)) {
    const text = readableText(html);
    assert.doesNotMatch(text, /\b20\d\d-\d\d-\d\d\b/, name);
    assert.doesNotMatch(text, TELL_WORDS, name);
    assert.doesNotMatch(text, /\b(GMT|UTC)\b|Europe\//, name);
    // The calendar's own labels are in sentence case. (The form for a new appointment keeps its wording until it is rebuilt.)
    assert.doesNotMatch(text, /Appointment Details|Cancel Appointment/, name);
  }
  assert.match(readableText(views['nobody works']), /Nobody is working/);
});
