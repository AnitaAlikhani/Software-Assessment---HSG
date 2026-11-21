import assert from 'node:assert/strict';
import test from 'node:test';
import { nextTask, type AssistantMemory } from '../src/assistant/conversation';
import { answer, askAgain, confirmProposal, type AssistantData, type AssistantHandlers, type AssistantReply } from '../src/assistant/execute';
import { read } from '../src/assistant/interpret';
import type { AssistantLanguage, AssistantTask } from '../src/assistant/types';
import { getAvailableSlots, validateCalendarEvent } from '../src/availability';
import type { CalendarEvent, ClosedDate } from '../src/types';
import {
  appointment, BLOW_DRY, COLOURING, FRIDAY, HAIRCUT, LUCA, salon, SATURDAY, SELINA, THURSDAY, TODAY, TUESDAY, WEDNESDAY,
} from './assistantFixture';

/**
 * The executor against the invented test salon, on a fixed clock (Monday 5 October 2026, 12:00).
 * The handlers below do what the app's own handlers do for the calendar: ask the booking rules,
 * then save. So "the rules refuse" in these tests is the real rules refusing.
 */
function app(initial: AssistantData = salon()) {
  const state = { data: initial, added: [] as Omit<CalendarEvent, 'id'>[], deleted: [] as string[], closures: [] as ClosedDate[][] };
  const handlers: AssistantHandlers = {
    addEvent: event => {
      const refusal = validateCalendarEvent(state.data, event);
      if (refusal) return refusal;
      state.added.push(event);
      state.data = { ...state.data, events: [{ ...event, id: `cal-new-${state.added.length}` }, ...state.data.events] };
      return null;
    },
    deleteEvent: id => {
      state.deleted.push(id);
      state.data = { ...state.data, events: state.data.events.filter(event => event.id !== id) };
    },
    saveClosedDates: dates => {
      state.closures.push(dates);
      state.data = { ...state.data, closedDates: dates };
    },
  };
  return { state, handlers };
}

/** A conversation as the panel runs it: read the message, add it to what was said before, answer. */
function conversation(state: { data: AssistantData }) {
  let memory: AssistantMemory = {};
  let language: AssistantLanguage = 'en';
  let last: AssistantReply | null = null;
  const keep = (reply: AssistantReply) => {
    last = reply;
    memory = { task: reply.task, asked: reply.asked };
    return reply;
  };
  return {
    say(message: string): AssistantReply | null {
      const { data } = state;
      const { request: heard, unread } = read(message, { today: TODAY, services: data.services, employees: data.employees, customers: data.customers, expecting: memory.asked, language });
      language = heard.language;
      const task = nextTask(heard, memory, unread.length);
      return task ? keep(answer(task, data)) : null;
    },
    tap(label: string): AssistantReply {
      const choice = last?.choices?.find(item => item.label === label);
      assert.ok(choice, `no choice "${label}" in: ${last?.choices?.map(item => item.label).join(', ')}`);
      return keep(answer(choice.task, state.data));
    },
  };
}

const ask = (task: Omit<AssistantTask, 'language'> & { language?: AssistantLanguage }, data: AssistantData = salon()) =>
  answer({ language: 'en', ...task }, data);
const labels = (reply: AssistantReply) => reply.choices?.map(choice => choice.label) ?? [];
const said = (reply: AssistantReply) => reply.text.join(' ');
/** What the rules offer on a day, for any of the given stylists. */
const offeredByRules = (data: AssistantData, date: string, serviceId: string, employeeIds: string[]) =>
  [...new Set(employeeIds.flatMap(employeeId => getAvailableSlots(data, { date, serviceId, employeeId, mode: 'owner' })))].sort();

test('a free time is confirmed and a taken time refused, both by the booking rules', () => {
  const free = ask({ intent: 'availability', serviceId: HAIRCUT.id, date: FRIDAY, time: '15:00' });
  assert.match(said(free), /^Yes\. Friday, 09\.10\.2026 at 15:00 is free for Haircut \(30 min\) with Selina or Luca\.$/);
  assert.deepEqual(labels(free), ['Book this time']);
  assert.deepEqual(free.choices![0].task, { language: 'en', intent: 'book', serviceId: HAIRCUT.id, date: FRIDAY, time: '15:00' });

  // Thursday 15:00: Selina has a haircut, Luca a colouring.
  const taken = ask({ intent: 'availability', serviceId: HAIRCUT.id, date: THURSDAY, time: '15:00' });
  assert.equal(taken.tone, 'problem');
  assert.match(said(taken), /^No\. Thursday, 08\.10\.2026 at 15:00 is not free for Haircut/);
  assert.match(said(taken), /Selina is not free at 15:00; Luca is not free at 15:00\./);
  assert.ok(!labels(taken).includes('15:00'));
  assert.ok(labels(taken).includes('15:30'), 'Selina is free again at 15:30');
  assert.deepEqual(labels(taken), offeredByRules(salon(), THURSDAY, HAIRCUT.id, [SELINA.id, LUCA.id]));
  assert.equal(taken.proposal, undefined);

  // A question about one stylist is answered for that stylist only.
  const luca = ask({ intent: 'availability', serviceId: HAIRCUT.id, date: THURSDAY, time: '15:30', employeeId: LUCA.id });
  assert.match(said(luca), /^No\. .* is not free for Haircut \(30 min\) with Luca\./);
  assert.deepEqual(labels(luca), offeredByRules(salon(), THURSDAY, HAIRCUT.id, [LUCA.id]));
});

test('a day view lists exactly the times the rules offer, also for a service that is not bookable online', () => {
  const data = salon();
  for (const [service, staff] of [[HAIRCUT, [SELINA.id, LUCA.id]], [COLOURING, [SELINA.id, LUCA.id]], [BLOW_DRY, [LUCA.id]]] as const) {
    for (const date of [TODAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY]) {
      const reply = ask({ intent: 'availability', serviceId: service.id, date }, data);
      const times = labels(reply).filter(label => /^\d{2}:\d{2}$/.test(label));
      assert.deepEqual(times, offeredByRules(data, date, service.id, [...staff]), `${service.name} on ${date}`);
    }
  }
  const friday = ask({ intent: 'availability', serviceId: HAIRCUT.id, date: FRIDAY });
  assert.match(said(friday), /^Friday, 09\.10\.2026: 17 free times for Haircut \(30 min\) with Selina or Luca, from 09:30 to 17:30\./);
  // The pending request for Selina at 11:00 holds that time, as on the booking page.
  assert.ok(!offeredByRules(data, FRIDAY, HAIRCUT.id, [SELINA.id]).includes('11:00'));
  const afternoon = ask({ intent: 'availability', serviceId: HAIRCUT.id, date: FRIDAY, partOfDay: 'afternoon' });
  assert.ok(labels(afternoon).every(time => time >= '12:00'));
});

test('a closed day, a closed date, an absence, a missing shift and a past day are explained and never offered', () => {
  const saturday = ask({ intent: 'availability', serviceId: HAIRCUT.id, date: SATURDAY });
  assert.equal(saturday.tone, 'problem');
  assert.match(said(saturday), /There is no free time for Haircut \(30 min\) on Saturday, 10\.10\.2026\. The salon is closed on Saturdays\./);
  assert.deepEqual(labels(saturday), ['Next free time']);

  const closed = salon({ closedDates: [{ id: 'closed-1', name: 'Team day', start: FRIDAY, end: FRIDAY }] });
  assert.match(said(ask({ intent: 'availability', serviceId: HAIRCUT.id, date: FRIDAY, time: '10:00' }, closed)),
    /^No\. .* The salon is closed on that day \(closed date\)\.$/);

  // Luca does not work on Tuesdays.
  const noShift = ask({ intent: 'availability', serviceId: HAIRCUT.id, date: TUESDAY, time: '11:00', employeeId: LUCA.id });
  assert.match(said(noShift), /not free for Haircut \(30 min\) with Luca\. Luca is not working that day\./);
  assert.deepEqual(labels(noShift), ['Next free time']);

  const away = salon({ absences: [{ id: 'away-1', employeeId: SELINA.id, start: TUESDAY, end: TUESDAY }] });
  assert.match(said(ask({ intent: 'availability', serviceId: HAIRCUT.id, date: TUESDAY }, away)),
    /Selina is away; Luca is not working that day\./);

  assert.match(said(ask({ intent: 'availability', serviceId: HAIRCUT.id, date: '2026-10-02' })), /That day is already over\./);

  // It is 12:00: this morning is refused by the rules, and the answer says why.
  const morning = ask({ intent: 'availability', serviceId: HAIRCUT.id, date: TODAY, time: '10:00' });
  assert.match(said(morning), /^No\. Today \(Monday, 05\.10\.2026\) at 10:00 is not free for Haircut \(30 min\)\. That time has already passed today\./);
  assert.ok(labels(morning).every(time => time >= '12:00'));
});

test('the next free time is found by asking the rules day by day', () => {
  const next = ask({ intent: 'availability', serviceId: COLOURING.id, fromDate: '2026-10-12' });
  assert.match(said(next), /^The next free time for Colouring \(90 min\) is on Monday, 12\.10\.2026 at 09:00 with Selina\./);
  assert.equal(next.choices![0].task.date, '2026-10-12');

  // Selina is away that week: the first free time is Luca's first shift.
  const away = salon({ absences: [{ id: 'away-1', employeeId: SELINA.id, start: '2026-10-12', end: '2026-10-18' }] });
  assert.match(said(ask({ intent: 'availability', serviceId: COLOURING.id, fromDate: '2026-10-12' }, away)),
    /is on Wednesday, 14\.10\.2026 at 10:00 with Luca\./);

  // Nobody has working hours: nothing falls back to the opening hours.
  const noHours = salon({ employees: [SELINA, LUCA].map(person => ({ ...person, weeklyHours: undefined })) });
  const none = ask({ intent: 'availability', serviceId: HAIRCUT.id }, noHours);
  assert.equal(none.tone, 'problem');
  assert.match(said(none), /no free time for Haircut in the next 90 days/);
});

test('missing details are asked for one at a time and what was said is kept', () => {
  const { state, handlers } = app();
  const chat = conversation(state);

  let reply = chat.say('Book an appointment')!;
  assert.equal(reply.asked, 'service');
  assert.deepEqual(labels(reply), ['Haircut (30 min)', 'Colouring (90 min)', 'Wash & blow-dry (30 min)']);

  reply = chat.say('Haircut')!;
  assert.equal(reply.asked, 'date');
  assert.deepEqual(labels(reply), ['Today', 'Tomorrow']);

  reply = chat.say('tomorrow')!;
  assert.equal(reply.asked, 'time');
  assert.match(said(reply), /^What time tomorrow \(Tuesday, 06\.10\.2026\)\? Free for Haircut \(30 min\):/);
  assert.ok(!labels(reply).includes('10:00'), 'Lea Brunner is booked at 10:00');

  reply = chat.say('9')!;
  assert.equal(reply.asked, 'customerName');
  assert.match(said(reply), /at 09:00 is free for Haircut \(30 min\) with Selina\. Who is the appointment for\?/);

  reply = chat.say('Mia Keller')!;
  assert.equal(reply.asked, undefined);
  assert.equal(reply.proposal?.title, 'Book appointment');
  assert.deepEqual(reply.proposal?.rows, [
    { label: 'What', value: 'Haircut (30 min)' },
    { label: 'When', value: 'Tomorrow (Tuesday, 06.10.2026), 09:00–09:30' },
    { label: 'Who', value: 'Mia Keller (new customer)' },
    { label: 'With', value: 'Selina Keller' },
  ]);
  assert.deepEqual([reply.proposal?.confirmLabel, reply.proposal?.cancelLabel], ['Confirm', 'Cancel']);
  // Nothing has changed yet: a proposal is only a proposal.
  assert.equal(state.added.length, 0);

  const done = confirmProposal(reply.proposal!, 'en', state.data, handlers);
  assert.equal(done.tone, 'success');
  assert.equal(said(done), 'Booked: Haircut for Mia Keller tomorrow (Tuesday, 06.10.2026), 09:00–09:30, with Selina Keller.');
  assert.deepEqual(done.calendar, { date: TUESDAY, label: 'Open calendar on Tue 06.10.' });
  // The appointment is the one the Calendar page's own form would have saved.
  assert.deepEqual(state.added, [{
    customerName: 'Mia Keller', serviceId: HAIRCUT.id, serviceName: 'Haircut', employeeId: SELINA.id, staffName: 'Selina Keller',
    date: TUESDAY, day: 'tue', dateDisplay: 'Tue 06.10.', startTime: '09:00', endTime: '09:30',
    colorTheme: 'blue', isAiBooked: false, outsideHoursApproved: false,
  }]);
});

test('one sentence can say everything; a change afterwards changes the proposal', () => {
  const { state } = app();
  const chat = conversation(state);
  let reply = chat.say('Book Mia Keller for a haircut on Wednesday at 10')!;
  assert.equal(reply.proposal?.rows[1].value, 'Wednesday, 07.10.2026, 10:00–10:30');
  assert.equal(reply.proposal?.rows[3].value, 'Selina Keller');
  // Both stylists are free: the other one is one tap away.
  assert.deepEqual(labels(reply), ['With Luca instead']);
  reply = chat.tap('With Luca instead');
  assert.equal(reply.proposal?.rows[3].value, 'Luca Frei');

  reply = chat.say('at 11 instead')!;
  assert.equal(reply.proposal?.rows[1].value, 'Wednesday, 07.10.2026, 11:00–11:30');
  assert.equal(reply.proposal?.rows[3].value, 'Luca Frei');
  reply = chat.say('on Thursday')!;
  assert.equal(reply.proposal?.rows[1].value, 'Thursday, 08.10.2026, 11:00–11:30');
});

test('a time the rules refuse never becomes a proposal', () => {
  const { state } = app();
  const chat = conversation(state);
  // Tuesday 10:00: Selina has Lea Brunner, Luca does not work.
  let reply = chat.say('Book Mia Keller for a haircut on Tuesday at 10')!;
  assert.equal(reply.proposal, undefined);
  assert.equal(reply.tone, 'problem');
  assert.match(said(reply), /at 10:00 is not free for Haircut \(30 min\)\. Selina is not free at 10:00; Luca is not working that day\. Free that day:/);
  assert.equal(reply.asked, 'time');
  assert.deepEqual(labels(reply), offeredByRules(state.data, TUESDAY, HAIRCUT.id, [SELINA.id]));
  // The name and the service are kept; only the time is asked again.
  reply = chat.tap('10:30');
  assert.equal(reply.proposal?.rows[2].value, 'Mia Keller (new customer)');
  assert.equal(reply.proposal?.rows[1].value, 'Tomorrow (Tuesday, 06.10.2026), 10:30–11:00');

  // An answer that cannot be read gets the same question again, with the same choices.
  const stuck = conversation(state);
  const question = stuck.say('Book Mia Keller for a haircut tomorrow')!;
  assert.equal(stuck.say('whenever you like'), null);
  const again = askAgain(question.task!, 'en', state.data);
  assert.deepEqual(again.text, ['I did not understand that.', ...question.text]);
  assert.deepEqual(labels(again), labels(question));
  assert.equal(again.asked, 'time');
  // A booking in the past is refused by the rules like any other.
  assert.match(said(conversation(state).say('Book Mia Keller for a haircut yesterday at 10')!), /That day is already over\. Which other day works\?/);

  // A closed day is refused before any time is asked.
  reply = conversation(state).say('Book Mia Keller for a haircut on Saturday at 10')!;
  assert.equal(reply.proposal, undefined);
  assert.match(said(reply), /The salon is closed on Saturdays\. Which other day works\?/);
  assert.equal(reply.asked, 'date');

  // Selina does not do blow-dries: the assistant says so and offers who does.
  reply = conversation(state).say('Book Mia Keller for a blow-dry with Selina on Friday at 10')!;
  assert.equal(reply.proposal, undefined);
  assert.match(said(reply), /Selina Keller does not do Wash & blow-dry\./);
  assert.deepEqual(labels(reply), ['Luca Frei']);
});

test('a slot that was taken between proposal and Confirm is refused by the rules, in their words', () => {
  const { state, handlers } = app();
  const reply = conversation(state).say('Book Mia Keller for a haircut on Wednesday at 10 with Selina')!;
  assert.ok(reply.proposal);
  // Meanwhile somebody books the same time on the Calendar page.
  state.data = { ...state.data, events: [appointment('cal-other', 'Tom Graf', HAIRCUT, SELINA, WEDNESDAY, '10:00'), ...state.data.events] };

  const result = confirmProposal(reply.proposal!, 'en', state.data, handlers);
  assert.equal(result.tone, 'problem');
  assert.equal(result.text[0], 'The appointment was not booked:');
  assert.equal(result.text[1], validateCalendarEvent(state.data, (reply.proposal!.action as { event: Omit<CalendarEvent, 'id'> }).event));
  assert.match(result.text[1], /This time is not available/);
  assert.equal(state.added.length, 0);
  assert.equal(result.calendar, undefined);
  // It offers the times that are still free with Selina and remembers the rest.
  assert.ok(!labels(result).includes('10:00'));
  assert.deepEqual(labels(result), offeredByRules(state.data, WEDNESDAY, HAIRCUT.id, [SELINA.id]));
  assert.equal(result.asked, 'time');
  assert.equal(result.task?.customerName, 'Mia Keller');
});

test('customers already in the list are recognised; an unclear name is asked about', () => {
  const { state, handlers } = app();
  const chat = conversation(state);
  // "Lea" could be Lea Brunner or Léa Girard.
  let reply = chat.say('Book Lea for a haircut on Wednesday at 10')!;
  assert.equal(reply.proposal, undefined);
  assert.match(said(reply), /Several customers in your list match “Lea”/);
  assert.deepEqual(labels(reply), ['Lea Brunner', 'Léa Girard', 'New customer “Lea”']);
  reply = chat.tap('Léa Girard');
  assert.equal(reply.proposal?.rows[2].value, 'Léa Girard (in your customer list)');
  confirmProposal(reply.proposal!, 'en', state.data, handlers);
  // The booking carries the customer's record, so the Calendar handler adds the visit to that customer.
  assert.equal(state.added[0].customerId, 'cust-girard');
  assert.equal(state.added[0].customerName, 'Léa Girard');

  reply = conversation(state).say('Book Frau Meier for a haircut on Wednesday at 11')!;
  assert.equal(reply.proposal?.rows[2].value, 'Sandra Meier (in your customer list)');

  reply = conversation(state).say('Book Lea for a haircut on Wednesday at 12')!;
  reply = answer(reply.choices!.at(-1)!.task, state.data);
  assert.equal(reply.proposal?.rows[2].value, 'Lea (new customer)');

  // A second visit on the same day is pointed out, not forbidden.
  reply = conversation(state).say('Book Marco Bianchi for a haircut on Friday at 10')!;
  assert.deepEqual(reply.proposal?.warnings, ['Marco Bianchi already has an appointment that day: 14:00, Haircut.']);
});

test('closing a day shows what is booked on it and saves through the Settings setter', () => {
  const { state, handlers } = app();
  const reply = conversation(state).say('Close Friday')!;
  assert.equal(reply.proposal?.title, 'Close the salon');
  assert.deepEqual(reply.proposal?.rows[0], { label: 'When', value: 'Friday, 09.10.2026, all day' });
  assert.deepEqual(reply.proposal?.warnings, [
    '3 appointments are booked on that day. They stay in the calendar: move or cancel them yourself.',
    '1 request for that day still waits for your answer.',
  ]);
  assert.equal(state.closures.length, 0);

  const done = confirmProposal(reply.proposal!, 'en', state.data, handlers);
  assert.equal(done.tone, 'success');
  assert.match(said(done), /^Done\. The salon is closed on Friday, 09\.10\.2026\. The entry is listed in Settings under Closed dates\.$/);
  assert.equal(state.closures.length, 1);
  assert.deepEqual(state.closures[0].map(({ name, start, end }) => ({ name, start, end })), [{ name: 'Closed', start: FRIDAY, end: FRIDAY }]);
  assert.match(state.closures[0][0].id, /^closed-/);
  // The rules now refuse that day, and the three appointments are still in the calendar.
  assert.deepEqual(offeredByRules(state.data, FRIDAY, HAIRCUT.id, [SELINA.id, LUCA.id]), []);
  assert.equal(state.data.events.filter(event => event.date === FRIDAY).length, 3);

  assert.match(said(conversation(state).say('Close Friday')!), /Friday, 09\.10\.2026 is already closed \(“Closed”\)\./);
  assert.equal(confirmProposal(reply.proposal!, 'en', state.data, handlers).tone, undefined, 'a second Confirm adds nothing');
  assert.equal(state.closures.length, 1);

  // The app only knows whole closed days; a request for half a day says so before anything is confirmed.
  assert.match(conversation(state).say('We will be closed on Thursday afternoon')!.proposal!.warnings[0], /only be closed for whole days/);

  // Nothing to do, so no proposal.
  const saturday = conversation(state).say('Close Saturday')!;
  assert.equal(saturday.proposal, undefined);
  assert.match(said(saturday), /closed on Saturdays anyway/);
  assert.equal(ask({ intent: 'close', date: '2026-10-01' }).tone, 'problem');
  assert.equal(ask({ intent: 'close' }).asked, 'date');

  // Several days in one closure, kept in date order like in Settings.
  const holidays = conversation(state).say('We are closed from 24 December to 2 January')!;
  assert.deepEqual(holidays.proposal?.rows[0], { label: 'When', value: 'Thursday, 24.12.2026 to Saturday, 02.01.2027 (10 days)' });
  assert.match(said(confirmProposal(holidays.proposal!, 'en', state.data, handlers)),
    /^Done\. The salon is closed from Thursday, 24\.12\.2026 to Saturday, 02\.01\.2027 \(10 days\)\./);
  assert.deepEqual(state.data.closedDates?.map(({ start, end }) => [start, end]), [[FRIDAY, FRIDAY], ['2026-12-24', '2027-01-02']]);
});

test('opening a day again removes the closure or shortens it', () => {
  const { state, handlers } = app(salon({ closedDates: [
    { id: 'closed-fri', name: 'Closed', start: FRIDAY, end: FRIDAY },
    { id: 'closed-xmas', name: 'Christmas', start: '2026-12-24', end: '2026-12-31' },
  ] }));
  let reply = conversation(state).say('Open Friday again')!;
  assert.equal(reply.proposal?.title, 'Open the salon again');
  assert.deepEqual(reply.proposal?.rows[1], { label: 'Change', value: 'Removes the closed date “Closed” (Fri, 09.10.2026).' });
  let done = confirmProposal(reply.proposal!, 'en', state.data, handlers);
  assert.match(said(done), /^Done\. The salon is open again on Friday, 09\.10\.2026\.$/);
  assert.deepEqual(state.data.closedDates?.map(closure => closure.id), ['closed-xmas']);
  assert.ok(offeredByRules(state.data, FRIDAY, HAIRCUT.id, [SELINA.id]).length > 0);

  // One day in the middle: the days before and after stay closed.
  reply = conversation(state).say('Open 28 December again')!;
  assert.match(reply.proposal!.rows[1].value, /^Shortens “Christmas” \(24\.–31\.12\.2026\)\. The other days stay closed\.$/);
  done = confirmProposal(reply.proposal!, 'en', state.data, handlers);
  assert.equal(done.tone, 'success');
  assert.deepEqual(state.data.closedDates?.map(({ name, start, end }) => [name, start, end]),
    [['Christmas', '2026-12-24', '2026-12-27'], ['Christmas', '2026-12-29', '2026-12-31']]);
  assert.equal(new Set(state.data.closedDates?.map(closure => closure.id)).size, 2);

  assert.match(said(conversation(state).say('Open Friday again')!), /^Friday, 09\.10\.2026 is not closed\.$/);
  assert.match(said(conversation(state).say('Open Saturday again')!), /closed on Saturdays in the opening hours\. You change that in Settings under Opening hours\./);
});

test('a cancellation goes through the Calendar handler and frees the time', () => {
  const { state, handlers } = app();
  const reply = conversation(state).say("Cancel Lea Brunner's appointment on Tuesday.")!;
  assert.equal(reply.proposal?.title, 'Cancel appointment');
  assert.deepEqual(reply.proposal?.rows, [
    { label: 'What', value: 'Haircut' },
    { label: 'When', value: 'Tomorrow (Tuesday, 06.10.2026), 10:00–10:30' },
    { label: 'Who', value: 'Lea Brunner' },
    { label: 'With', value: 'Selina Keller' },
  ]);
  // "Cancel" next to "Cancel appointment" would be unclear, so the way out is named.
  assert.deepEqual([reply.proposal?.confirmLabel, reply.proposal?.cancelLabel], ['Confirm', 'Keep appointment']);
  assert.match(reply.proposal!.warnings[0], /No message is sent to the customer/);
  assert.equal(state.deleted.length, 0);
  assert.ok(!offeredByRules(state.data, TUESDAY, HAIRCUT.id, [SELINA.id]).includes('10:00'));

  const done = confirmProposal(reply.proposal!, 'en', state.data, handlers);
  assert.equal(said(done), 'Cancelled: Haircut for Lea Brunner tomorrow (Tuesday, 06.10.2026) at 10:00. The time is free again.');
  assert.deepEqual(state.deleted, ['cal-lea']);
  assert.ok(offeredByRules(state.data, TUESDAY, HAIRCUT.id, [SELINA.id]).includes('10:00'));
  // Confirming the same proposal again finds nothing to remove.
  assert.equal(confirmProposal(reply.proposal!, 'en', state.data, handlers).tone, 'problem');
  assert.deepEqual(state.deleted, ['cal-lea']);

  // Two appointments match: the owner picks one.
  const chat = conversation(state);
  let which = chat.say("Cancel Marco Bianchi's appointment")!;
  assert.equal(which.proposal, undefined);
  assert.deepEqual(labels(which), ['Thu 08.10., 15:00 · Marco Bianchi · Haircut', 'Fri 09.10., 14:00 · Marco Bianchi · Haircut']);
  which = chat.tap('Fri 09.10., 14:00 · Marco Bianchi · Haircut');
  assert.equal((which.proposal?.action as { appointmentId: string }).appointmentId, 'cal-fri-2');

  // The right name with the wrong day: the assistant shows what there is.
  const wrongDay = conversation(state).say("Cancel Sandra Meier's appointment on Wednesday")!;
  assert.equal(wrongDay.tone, 'problem');
  assert.match(said(wrongDay), /I found no upcoming appointment for Sandra Meier on Wednesday, 07\.10\.2026\. These appointments exist:/);
  assert.equal(labels(wrongDay).length, 2);
  assert.match(said(conversation(state).say('Cancel the appointment of Mia Keller')!), /I found no upcoming appointment for Mia Keller\./);
  assert.equal(ask({ intent: 'cancel' }).asked, 'customerName');
  // By day and time, without a name.
  assert.equal(conversation(state).say('Cancel the appointment on Friday at 16:00')!.proposal?.rows[2].value, 'Sandra Meier');
});

test('the agenda lists a day in order and "next" follows the same rule as Home', () => {
  const data = salon();
  const friday = ask({ intent: 'agenda', date: FRIDAY }, data);
  assert.deepEqual(friday.text, ['Friday, 09.10.2026: 3 appointments.', '1 request for this day waits for your answer on Home.']);
  assert.deepEqual(friday.list, [
    '09:00–09:30 · Léa Girard · Haircut · Selina Keller',
    '14:00–14:30 · Marco Bianchi · Haircut · Luca Frei',
    '16:00–16:30 · Sandra Meier · Wash & blow-dry · Luca Frei',
  ]);
  assert.deepEqual(friday.calendar, { date: FRIDAY, label: 'Open calendar on Fri 09.10.' });
  assert.deepEqual(ask({ intent: 'agenda', date: FRIDAY, employeeId: LUCA.id }, data).list?.length, 2);

  assert.deepEqual(ask({ intent: 'agenda' }, data).text, ['Today (Monday, 05.10.2026): no appointments.']);
  assert.deepEqual(ask({ intent: 'agenda', date: SATURDAY }, data).text, ['Saturday, 10.10.2026: no appointments.', 'The salon is closed on this day.']);

  // A whole week is one line per day.
  const week = conversation({ data }).say('Appointments this week?')!;
  assert.deepEqual(week.text, ['Monday, 05.10.2026 to Sunday, 11.10.2026: 6 appointments.']);
  assert.deepEqual(week.list, [
    'Mon 05.10. · 0 appointments', 'Tue 06.10. · 1 appointment', 'Wed 07.10. · 0 appointments', 'Thu 08.10. · 2 appointments',
    'Fri 09.10. · 3 appointments', 'Sat 10.10. · 0 appointments · closed', 'Sun 11.10. · 0 appointments · closed',
  ]);
  assert.deepEqual(conversation({ data }).say('Welche Termine haben wir nächste Woche?')!.text, ['Montag, 12.10.2026 bis Sonntag, 18.10.2026: keine Termine.']);

  assert.equal(said(ask({ intent: 'agenda', scope: 'next' }, data)),
    'Next: Lea Brunner, Haircut with Selina Keller, tomorrow (Tuesday, 06.10.2026) at 10:00.');
  // On Tuesday at 10:10 that appointment has started; the next one is Thursday's first.
  const later = { ...data, now: new Date('2026-10-06T08:10:00Z') };
  assert.match(said(ask({ intent: 'agenda', scope: 'next' }, later)), /^Next: Marco Bianchi, Haircut with Selina Keller, on Thursday, 08\.10\.2026 at 15:00\.$/);
  assert.equal(said(ask({ intent: 'agenda', scope: 'next' }, { ...data, events: [] })), 'There is no upcoming appointment.');
});

test('a German request gets a German answer, with the same facts', () => {
  const { state, handlers } = app();
  const chat = conversation(state);
  let reply = chat.say('Hast du am Freitag um 15 Uhr etwas frei?')!;
  assert.equal(reply.language, 'de');
  assert.deepEqual(reply.text, ['Für welche Dienstleistung?']);
  reply = chat.say('Haarschnitt')!;
  assert.equal(said(reply), 'Ja. Freitag, 09.10.2026 um 15:00 Uhr ist frei für Haircut (30 min) bei Selina oder Luca.');
  assert.deepEqual(labels(reply), ['Diese Zeit eintragen']);

  reply = chat.say('Trag Lea Brunner ein')!;
  assert.equal(reply.proposal?.title, 'Termin eintragen');
  assert.deepEqual(reply.proposal?.rows.map(row => row.label), ['Was', 'Wann', 'Wer', 'Bei']);
  assert.equal(reply.proposal?.rows[1].value, 'Freitag, 09.10.2026, 15:00–15:30');
  assert.deepEqual([reply.proposal?.confirmLabel, reply.proposal?.cancelLabel], ['Bestätigen', 'Abbrechen']);
  const done = confirmProposal(reply.proposal!, 'de', state.data, handlers);
  assert.equal(said(done), 'Eingetragen: Haircut für Lea Brunner am Freitag, 09.10.2026, 15:00–15:30 Uhr, bei Selina Keller.');
  assert.equal(done.calendar?.label, 'Kalender am Fr 09.10. öffnen');

  const closed = conversation(state).say('Am Samstag geschlossen')!;
  assert.match(said(closed), /^Am Samstag ist der Salon nach den Öffnungszeiten sowieso geschlossen\./);
  const taken = conversation(state).say('Ist am Donnerstag um 15 Uhr etwas frei für einen Haarschnitt?')!;
  assert.match(said(taken), /^Nein\. Donnerstag, 08\.10\.2026 um 15:00 Uhr ist nicht frei für Haircut \(30 min\)\. Selina ist um 15:00 Uhr nicht frei; Luca ist um 15:00 Uhr nicht frei\./);
});

test('follow-ups add to the request before; a new question does not drag old details along', () => {
  const { state } = app();
  const chat = conversation(state);
  chat.say('Is Thursday at 15:00 free for a haircut?');
  // Same service and time, another day.
  assert.match(said(chat.say('And on Friday?')!), /^Yes\. Friday, 09\.10\.2026 at 15:00 is free for Haircut/);
  // "Book it": day, time and service come from the question before.
  const proposal = chat.say('Book it for Lea Brunner')!;
  assert.deepEqual(proposal.proposal?.rows.map(row => row.value).slice(0, 3),
    ['Haircut (30 min)', 'Friday, 09.10.2026, 15:00–15:30', 'Lea Brunner (in your customer list)']);

  const other = conversation(state);
  other.say('Do you have anything on Friday for a haircut?');
  // The next free time for another service is not searched on the Friday from before.
  assert.match(said(other.say('Next free time for colouring?')!), /^The next free time for Colouring \(90 min\) is today/);
  // A time on its own is about the day that was just discussed.
  other.say('Do you have anything on Friday for a haircut?');
  assert.match(said(other.say('Is 16:00 free?')!), /^Yes\. Friday, 09\.10\.2026 at 16:00 is free for Haircut/);

  // A question about one stylist: "Is Friday free?" is still about her, a question that names the
  // service again is about everybody.
  const stylist = conversation(state);
  stylist.say('Is Selina free on Thursday at 15:00 for a haircut?');
  assert.match(said(stylist.say('Is Friday free?')!), /^Friday, 09\.10\.2026: \d+ free times for Haircut \(30 min\) with Selina, /);
  assert.match(said(stylist.say('Do you have anything on Friday for a haircut?')!), /with Selina or Luca/);

  // A sentence that is only half understood is not taken for "at 10:30 instead": the caller then
  // asks the model or says it did not understand.
  const half = conversation(state);
  half.say('Is Thursday at 15:00 free for a haircut?');
  assert.equal(half.say('Mia Keller would like a haircut at 10:30'), null);
  // The answer to the open question may come with extra words.
  const wordy = conversation(state);
  wordy.say('Book Mia Keller for a haircut on Wednesday');
  assert.equal(wordy.say("let's say 11 if that works for everybody")!.proposal?.rows[1].value, 'Wednesday, 07.10.2026, 11:00–11:30');

  // Without anything before, a detail alone is not a request ...
  assert.equal(conversation(state).say('Friday'), null);
  assert.equal(conversation(state).say('Lea Brunner'), null);
  // ... and a name typed after the agenda adds nothing to it.
  const agenda = conversation(state);
  agenda.say("What's on today?");
  assert.equal(agenda.say('Lea Brunner'), null);
  assert.match(said(agenda.say('and tomorrow?')!), /^Tomorrow \(Tuesday, 06\.10\.2026\): 1 appointment\.$/);
});
