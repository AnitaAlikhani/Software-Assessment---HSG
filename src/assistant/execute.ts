import {
  getAvailableSlots,
  isEmployeeAssignedToService,
  validateCalendarEvent,
  type AvailabilityContext,
} from '../availability';
import { nextUpcomingAppointment } from '../dashboard';
import { addDays, addMinutes, dayKeyForDate, formatCalendarDate, getSalonNow, salonTimeZone, startOfWeek } from '../scheduling';
import type { CalendarEvent, ClosedDate, Customer, Employee, ServiceItem } from '../types';
import { formatPhone, formatTimeRange } from '../format';
import { bookingHoursDay, dayLabel, dayPhrase, dayRange, daysBetween, shortDay, weekdayName } from './dates';
import { fold } from './interpret';
import { refusalIn } from './refusals';
import type { AssistantLanguage, AssistantSlot, AssistantTask, PartOfDay } from './types';

/**
 * The executor: answers a request with the salon's current data and prepares every change as a
 * proposal for the owner to confirm.
 *
 * It never decides by itself whether a time is free. Free times come from getAvailableSlots()
 * and every booking is checked with validateCalendarEvent(), the same rules the Calendar page
 * uses. A confirmed change runs through the handlers of the screens (see confirmProposal).
 */
export interface AssistantData extends AvailabilityContext {
  customers: Customer[];
  /** The moment the owner asked. Tests pass a fixed one. */
  now: Date;
}

/** The handlers the Calendar and Settings pages use; the assistant changes nothing in another way. */
export interface AssistantHandlers {
  /** Adds an appointment. Returns the rules' refusal, or null when it was added. */
  addEvent: (event: Omit<CalendarEvent, 'id'>) => string | null;
  deleteEvent: (id: string) => void;
  saveClosedDates: (dates: ClosedDate[]) => void;
}

export interface AssistantChoice { label: string; task: AssistantTask }

export type ProposalAction =
  /** `anyStylist`: the owner named no stylist, the assistant picked one who was free. */
  | { kind: 'book'; event: Omit<CalendarEvent, 'id'>; anyStylist?: boolean }
  | { kind: 'cancel'; appointmentId: string }
  | { kind: 'close'; start: string; end: string }
  | { kind: 'reopen'; start: string; end: string };

/** A change that waits for the owner's Confirm. */
export interface AssistantProposal {
  action: ProposalAction;
  title: string;
  rows: { label: string; value: string }[];
  warnings: string[];
  confirmLabel: string;
  cancelLabel: string;
}

export interface AssistantReply {
  language: AssistantLanguage;
  /** Paragraphs of plain text. */
  text: string[];
  /** A list under the text, for example the appointments of a day. */
  list?: string[];
  tone?: 'success' | 'problem';
  /** Answers to tap instead of typing. */
  choices?: AssistantChoice[];
  /** Example requests to tap; they are sent as if typed. */
  examples?: string[];
  proposal?: AssistantProposal;
  /** Offer to open the calendar on this day. */
  calendar?: { date: string; label: string };
  /** What the assistant keeps in mind for the next message. */
  task?: AssistantTask;
  asked?: AssistantSlot;
}

const CLOSURE_NAME = 'Closed';
/** As far ahead as the booking page looks for a free day. */
const SEARCH_DAYS = 90;
const MAX_CHOICES = 24;

const todayOf = (data: AssistantData): string => getSalonNow(data.timeZone, data.now).date;
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
/** How a stylist is called in a sentence: by first name, or in full when two share a first name. */
const shortNames = (employees: Employee[]) => (employee: Employee): string => {
  const first = employee.firstName.trim();
  return first && employees.filter(other => other.firstName.trim() === first).length === 1 ? first : employee.name;
};
const nameKey = (name: string): string => fold(name).replace(/\s+/g, ' ').trim();
const byStart = (a: CalendarEvent, b: CalendarEvent) =>
  `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`) || a.id.localeCompare(b.id);
const list = (names: string[], language: AssistantLanguage): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${language === 'de' ? 'oder' : 'or'} ${names.at(-1)}`;
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const serviceLabel = (service: ServiceItem): string => `${service.name} (${service.durationMinutes} min)`;
const serviceOf = (data: AssistantData, event: Pick<CalendarEvent, 'serviceId' | 'serviceName'>): ServiceItem | undefined =>
  event.serviceId !== undefined
    ? data.services.find(service => service.id === event.serviceId)
    : data.services.find(service => service.name === event.serviceName);

/** "on Tuesday, 06.10.2026" / "am Dienstag, 06.10.2026", but "today (...)" without a preposition. */
function onDay(date: string, language: AssistantLanguage, today: string): string {
  const phrase = dayPhrase(date, language, today);
  if (date === today || date === addDays(today, 1)) return phrase;
  return language === 'de' ? `am ${phrase}` : `on ${phrase}`;
}

const inPartOfDay = (time: string, part: PartOfDay | undefined): boolean =>
  part === 'morning' ? time < '12:00' : part === 'afternoon' ? time >= '12:00' : part === 'evening' ? time >= '17:00' : true;

// ---------- asking the booking rules ----------

interface StylistDay { employee: Employee; slots: string[] }

/** Free start times per stylist, straight from the booking rules (owner entry, like the Calendar page). */
const dayView = (data: AssistantData, date: string, service: ServiceItem, staff: Employee[]): StylistDay[] =>
  staff.map(employee => ({
    employee,
    slots: getAvailableSlots(data, { date, serviceId: service.id, employeeId: employee.id, mode: 'owner' }),
  }));

const freeTimes = (view: StylistDay[], part?: PartOfDay): string[] =>
  [...new Set(view.flatMap(item => item.slots))].filter(time => inPartOfDay(time, part)).sort();

const freeAt = (view: StylistDay[], time: string): Employee[] =>
  view.filter(item => item.slots.includes(time)).map(item => item.employee);

/** The appointment as the Calendar page's own form would build it. */
function draftEvent(service: ServiceItem, employee: Employee, date: string, time: string, customerName: string, customerId?: string): Omit<CalendarEvent, 'id'> {
  return {
    customerName,
    ...(customerId ? { customerId } : {}),
    serviceId: service.id,
    serviceName: service.name,
    employeeId: employee.id,
    staffName: employee.name,
    date,
    day: dayKeyForDate(date),
    dateDisplay: formatCalendarDate(date),
    startTime: time,
    endTime: addMinutes(time, service.durationMinutes),
    colorTheme: 'blue',
    isAiBooked: false,
    outsideHoursApproved: false,
  };
}

type Obstacle = 'past' | 'closedDate' | 'closedWeekday' | 'away' | 'noShift' | 'taken' | 'other';

/** Sorts the rules' own refusal texts into the few reasons the assistant words itself. */
const obstacleOf = (refusal: string): Obstacle =>
  /today or a future/.test(refusal) ? 'past'
    : /closed on this date\. Please/.test(refusal) ? 'closedDate'
    : /closed on this date/.test(refusal) ? 'closedWeekday'
    : /is away/.test(refusal) ? 'away'
    : /no shift|no working time/.test(refusal) ? 'noShift'
    : /This time is not available/.test(refusal) ? 'taken'
    : 'other';

/** Why nobody can take the time (or any time that day): asked from the rules, one stylist at a time. */
function explain(data: AssistantData, date: string, service: ServiceItem, staff: Employee[], time: string | undefined, language: AssistantLanguage): string {
  const de = language === 'de';
  const short = shortNames(data.employees);
  const reasons = staff.map(employee => {
    const refusal = validateCalendarEvent(data, draftEvent(service, employee, date, time ?? '12:00', '-')) ?? '';
    return { employee, refusal, obstacle: obstacleOf(refusal) };
  }).filter(item => item.refusal);
  if (reasons.length === 0) return '';
  const all = (obstacle: Obstacle) => reasons.every(item => item.obstacle === obstacle);
  if (all('past')) return de ? 'Dieser Tag ist schon vorbei.' : 'That day is already over.';
  if (all('closedDate')) return de ? 'An dem Tag ist der Salon geschlossen (Schliesstag).' : 'The salon is closed on that day (closed date).';
  if (all('closedWeekday')) {
    return de ? `Am ${weekdayName(date, 'de')} ist der Salon geschlossen.` : `The salon is closed on ${weekdayName(date, 'en')}s.`;
  }
  // The rules have already refused the time; this only names the plain reason when it is the clock.
  const salonNow = getSalonNow(data.timeZone, data.now);
  if (time && date === salonNow.date && time < salonNow.time) {
    return de ? 'Diese Uhrzeit ist heute schon vorbei.' : 'That time has already passed today.';
  }
  const parts = reasons.map(({ employee, refusal, obstacle }) => {
    const name = short(employee);
    if (obstacle === 'away') return de ? `${name} ist abwesend` : `${name} is away`;
    if (obstacle === 'noShift') return de ? `${name} arbeitet an dem Tag nicht` : `${name} is not working that day`;
    // The rules do not say why a time is not offered (taken, outside the shift, already past),
    // so the assistant does not claim more than "not free".
    if (obstacle === 'taken') {
      if (time) return de ? `${name} ist um ${time} Uhr nicht frei` : `${name} is not free at ${time}`;
      return de ? `${name} hat an dem Tag keine freie Zeit mehr` : `${name} has no free time left that day`;
    }
    // A reason the assistant has no own words for: pass on the rules' text, in the owner's language.
    return `${name}: ${refusalIn(refusal, language)}`;
  });
  return `${parts.join('; ')}.`;
}

// ---------- shared steps ----------

const question = (task: AssistantTask, asked: AssistantSlot, text: string[], choices?: AssistantChoice[]): AssistantReply =>
  ({ language: task.language, text, choices, task, asked });

function pickService(task: AssistantTask, data: AssistantData): { service: ServiceItem } | { reply: AssistantReply } {
  const de = task.language === 'de';
  const chosen = data.services.find(service => service.id === task.serviceId);
  if (chosen) return { service: chosen };
  if (data.services.length === 0) {
    return { reply: { language: task.language, tone: 'problem', text: [de ? 'Es gibt noch keine Dienstleistung. Lege zuerst eine unter Services an.' : 'There is no service yet. Add one under Services first.'] } };
  }
  if (data.services.length === 1) return { service: data.services[0] };
  const options = task.serviceOptions?.map(id => data.services.find(service => service.id === id)).filter((service): service is ServiceItem => Boolean(service));
  const offered = (options?.length ? options : data.services).slice(0, MAX_CHOICES);
  const { serviceOptions: _serviceOptions, ...rest } = task;
  return {
    reply: question(task, 'service', [de ? 'Für welche Dienstleistung?' : 'For which service?'],
      offered.map(service => ({ label: serviceLabel(service), task: { ...rest, serviceId: service.id } }))),
  };
}

function pickStaff(task: AssistantTask, service: ServiceItem, data: AssistantData): { staff: Employee[] } | { reply: AssistantReply } {
  const de = task.language === 'de';
  const able = data.employees.filter(employee => employee.status === 'Active' && isEmployeeAssignedToService(service, employee));
  if (able.length === 0) {
    return { reply: { language: task.language, tone: 'problem', task, text: [de
      ? `Niemand im Team ist für ${service.name} eingeteilt. Weise die Dienstleistung unter Services jemandem zu.`
      : `Nobody in the team is set up for ${service.name}. Assign it to an employee under Services.`] } };
  }
  if (!task.employeeId) return { staff: able };
  const asked = able.find(employee => employee.id === task.employeeId);
  if (asked) return { staff: [asked] };
  const other = data.employees.find(employee => employee.id === task.employeeId);
  const { employeeId: _employeeId, ...rest } = task;
  return {
    reply: {
      language: task.language, tone: 'problem', task: rest,
      text: [de
        ? `${other?.name ?? 'Diese Person'} bietet ${service.name} nicht an. Bei wem soll es sein?`
        : `${other?.name ?? 'This person'} does not do ${service.name}. Who should it be with?`],
      choices: able.slice(0, MAX_CHOICES).map(employee => ({ label: employee.name, task: { ...rest, employeeId: employee.id } })),
    },
  };
}

const dayChoices = (task: AssistantTask, today: string): AssistantChoice[] => [
  { label: task.language === 'de' ? 'Heute' : 'Today', task: { ...task, date: today } },
  { label: task.language === 'de' ? 'Morgen' : 'Tomorrow', task: { ...task, date: addDays(today, 1) } },
];

/** Tapping a free time goes on to book it; the booking still needs a name and a Confirm. */
const timeChoices = (task: AssistantTask, date: string, times: string[]): AssistantChoice[] =>
  times.slice(0, MAX_CHOICES).map(time => {
    const { partOfDay: _partOfDay, fromDate: _fromDate, scope: _scope, ...rest } = task;
    return { label: time, task: { ...rest, intent: 'book', date, time } };
  });

const moreTimes = (times: string[], language: AssistantLanguage): string[] =>
  times.length > MAX_CHOICES
    ? [language === 'de' ? `… und ${times.length - MAX_CHOICES} weitere bis ${times.at(-1)} Uhr.` : `… and ${times.length - MAX_CHOICES} more until ${times.at(-1)}.`]
    : [];

// ---------- free times ----------

function availability(task: AssistantTask, data: AssistantData): AssistantReply {
  const language = task.language;
  const de = language === 'de';
  const today = todayOf(data);
  const short = shortNames(data.employees);
  const picked = pickService(task, data);
  if ('reply' in picked) return picked.reply;
  const { service } = picked;
  const staffing = pickStaff(task, service, data);
  if ('reply' in staffing) return staffing.reply;
  const { staff } = staffing;
  const withStaff = task.employeeId ? (de ? ` bei ${short(staff[0])}` : ` with ${short(staff[0])}`) : '';
  const nextFreeChoice: AssistantChoice = {
    label: de ? 'Nächste freie Zeit' : 'Next free time',
    task: { intent: 'availability', language, serviceId: service.id, ...(task.employeeId ? { employeeId: task.employeeId } : {}), fromDate: task.date && task.date >= today ? addDays(task.date, 1) : today },
  };

  if (!task.date) {
    if (task.time) {
      return question({ ...task, serviceId: service.id }, 'date', [de ? `An welchem Tag um ${task.time} Uhr?` : `On which day at ${task.time}?`],
        dayChoices({ ...task, serviceId: service.id }, today));
    }
    // No day asked: look for the first day with a free time, like the booking page does.
    const from = task.fromDate && task.fromDate > today ? task.fromDate : today;
    for (let offset = 0; offset < SEARCH_DAYS; offset += 1) {
      const date = addDays(from, offset);
      const view = dayView(data, date, service, staff);
      const times = freeTimes(view, task.partOfDay);
      if (times.length === 0) continue;
      const who = freeAt(view, times[0]).map(short);
      return {
        language,
        text: [
          de
            ? `Die nächste freie Zeit für ${serviceLabel(service)} ist ${onDay(date, language, today)} um ${times[0]} Uhr bei ${list(who, language)}.`
            : `The next free time for ${serviceLabel(service)} is ${onDay(date, language, today)} at ${times[0]} with ${list(who, language)}.`,
          ...(times.length > 1 ? [de ? 'An dem Tag frei (antippen zum Eintragen):' : 'Free that day (tap a time to book it):'] : []),
          ...moreTimes(times, language),
        ],
        choices: timeChoices({ ...task, serviceId: service.id }, date, times),
        task: { ...task, serviceId: service.id },
      };
    }
    return {
      language, tone: 'problem', task: { ...task, serviceId: service.id },
      text: [de
        ? `In den nächsten ${SEARCH_DAYS} Tagen ist für ${service.name}${withStaff} nichts frei.`
        : `There is no free time for ${service.name}${withStaff} in the next ${SEARCH_DAYS} days.`],
    };
  }

  const date = task.date;
  const view = dayView(data, date, service, staff);
  const allTimes = freeTimes(view);
  const times = freeTimes(view, task.partOfDay);
  const memory: AssistantTask = { ...task, serviceId: service.id };

  if (task.time) {
    const free = freeAt(view, task.time);
    if (free.length > 0) {
      return {
        language,
        text: [de
          ? `Ja. ${capital(dayPhrase(date, language, today))} um ${task.time} Uhr ist frei für ${serviceLabel(service)} bei ${list(free.map(short), language)}.`
          : `Yes. ${capital(dayPhrase(date, language, today))} at ${task.time} is free for ${serviceLabel(service)} with ${list(free.map(short), language)}.`],
        choices: [{ label: de ? 'Diese Zeit eintragen' : 'Book this time', task: timeChoices(memory, date, [task.time])[0].task }],
        task: memory,
      };
    }
    const reason = explain(data, date, service, staff, task.time, language);
    return {
      language, tone: 'problem',
      text: [
        de
          ? `Nein. ${capital(dayPhrase(date, language, today))} um ${task.time} Uhr ist nicht frei für ${serviceLabel(service)}${withStaff}.`
          : `No. ${capital(dayPhrase(date, language, today))} at ${task.time} is not free for ${serviceLabel(service)}${withStaff}.`,
        ...(reason ? [reason] : []),
        ...(allTimes.length > 0 ? [de ? 'An dem Tag frei (antippen zum Eintragen):' : 'Free that day (tap a time to book it):'] : []),
        ...moreTimes(allTimes, language),
      ],
      choices: allTimes.length > 0 ? timeChoices(memory, date, allTimes) : [nextFreeChoice],
      task: memory,
    };
  }

  if (times.length === 0) {
    const reason = explain(data, date, service, staff, undefined, language);
    return {
      language, tone: 'problem',
      text: [
        de
          ? `${capital(onDay(date, language, today))} gibt es keine freie Zeit für ${serviceLabel(service)}${withStaff}.`
          : `There is no free time for ${serviceLabel(service)}${withStaff} ${onDay(date, language, today)}.`,
        ...(allTimes.length > 0 ? [de ? `Zu anderen Tageszeiten ist an dem Tag noch etwas frei, von ${allTimes[0]} bis ${allTimes.at(-1)} Uhr.` : `Other times that day are free, from ${allTimes[0]} to ${allTimes.at(-1)}.`] : reason ? [reason] : []),
      ],
      choices: allTimes.length > 0 ? timeChoices(memory, date, allTimes) : [nextFreeChoice],
      task: memory,
    };
  }
  const who = view.filter(item => item.slots.some(time => inPartOfDay(time, task.partOfDay))).map(item => short(item.employee));
  return {
    language,
    text: [
      de
        ? `${capital(dayPhrase(date, language, today))}: ${count(times.length, 'freie Zeit', 'freie Zeiten')} für ${serviceLabel(service)} bei ${list(who, language)}${times.length > 1 ? `, von ${times[0]} bis ${times.at(-1)} Uhr` : ''}. Zeit antippen, um sie einzutragen.`
        : `${capital(dayPhrase(date, language, today))}: ${count(times.length, 'free time', 'free times')} for ${serviceLabel(service)} with ${list(who, language)}${times.length > 1 ? `, from ${times[0]} to ${times.at(-1)}` : ''}. Tap a time to book it.`,
      ...moreTimes(times, language),
    ],
    choices: timeChoices(memory, date, times),
    task: memory,
  };
}

// ---------- booking ----------

type Who = { name: string; id?: string; known: boolean };

function findCustomer(task: AssistantTask, customers: Customer[]): Who | { options: Customer[]; sameName: boolean } {
  const typed = task.customerName ?? '';
  const record = customers.find(customer => customer.id === task.customerId);
  if (record) return { name: record.name, id: record.id, known: true };
  if (task.newCustomer) return { name: typed, known: false };
  const key = nameKey(typed);
  const exact = customers.filter(customer => nameKey(customer.name) === key);
  if (exact.length === 1) return { name: exact[0].name, id: exact[0].id, known: true };
  if (exact.length > 1) return { options: exact.slice(0, 6), sameName: true };
  // "Lea" or "Frau Meier": part of a name that is already in the customer list.
  const words = key.split(' ');
  const partial = customers.filter(customer => {
    const theirs = nameKey(customer.name).split(/[\s-]+/);
    return words.every(word => theirs.includes(word));
  });
  if (partial.length === 1) return { name: partial[0].name, id: partial[0].id, known: true };
  if (partial.length > 1) return { options: partial.slice(0, 6), sameName: false };
  return { name: typed, known: false };
}

function book(task: AssistantTask, data: AssistantData): AssistantReply {
  const language = task.language;
  const de = language === 'de';
  const today = todayOf(data);
  const short = shortNames(data.employees);
  const picked = pickService(task, data);
  if ('reply' in picked) return picked.reply;
  const { service } = picked;
  const staffing = pickStaff(task, service, data);
  if ('reply' in staffing) return staffing.reply;
  const { staff } = staffing;
  const known: AssistantTask = { ...task, serviceId: service.id };
  const withStaff = task.employeeId ? (de ? ` bei ${short(staff[0])}` : ` with ${short(staff[0])}`) : '';

  if (!task.date) {
    return question(known, 'date', [de ? `An welchem Tag soll ${service.name} sein?` : `On which day should the ${service.name} be?`], dayChoices(known, today));
  }
  const date = task.date;
  const view = dayView(data, date, service, staff);
  const times = freeTimes(view);
  const { date: _date, time: _time, ...withoutDay } = known;
  const { time: _oldTime, ...withoutTime } = known;

  if (times.length === 0) {
    const reason = explain(data, date, service, staff, undefined, language);
    return {
      language, tone: 'problem', asked: 'date', task: withoutDay,
      text: [
        de
          ? `${capital(onDay(date, language, today))} gibt es keine freie Zeit für ${serviceLabel(service)}${withStaff}.`
          : `There is no free time for ${serviceLabel(service)}${withStaff} ${onDay(date, language, today)}.`,
        ...(reason ? [reason] : []),
        de ? 'Welcher andere Tag passt?' : 'Which other day works?',
      ],
      choices: [{
        label: de ? 'Nächste freie Zeit' : 'Next free time',
        task: { intent: 'availability', language, serviceId: service.id, ...(task.employeeId ? { employeeId: task.employeeId } : {}), fromDate: date >= today ? addDays(date, 1) : today },
      }],
    };
  }
  if (!task.time) {
    return question(withoutTime, 'time', [
      de
        ? `Um welche Zeit ${onDay(date, language, today)}? Frei für ${serviceLabel(service)}${withStaff}:`
        : `What time ${onDay(date, language, today)}? Free for ${serviceLabel(service)}${withStaff}:`,
      ...moreTimes(times, language),
    ], timeChoices(known, date, times));
  }

  const time = task.time;
  const free = freeAt(view, time);
  if (free.length === 0) {
    const reason = explain(data, date, service, staff, time, language);
    return {
      language, tone: 'problem', asked: 'time', task: withoutTime,
      text: [
        de
          ? `${capital(dayPhrase(date, language, today))} um ${time} Uhr ist nicht frei für ${serviceLabel(service)}${withStaff}.`
          : `${capital(dayPhrase(date, language, today))} at ${time} is not free for ${serviceLabel(service)}${withStaff}.`,
        ...(reason ? [reason] : []),
        de ? 'An dem Tag frei:' : 'Free that day:',
        ...moreTimes(times, language),
      ],
      choices: timeChoices(known, date, times),
    };
  }

  if (!task.customerName && !task.customerId) {
    return question(known, 'customerName', [
      de
        ? `${capital(dayPhrase(date, language, today))} um ${time} Uhr ist frei für ${serviceLabel(service)} bei ${list(free.map(short), language)}.`
        : `${capital(dayPhrase(date, language, today))} at ${time} is free for ${serviceLabel(service)} with ${list(free.map(short), language)}.`,
      de ? 'Für wen ist der Termin? Bitte den Namen eingeben.' : "Who is the appointment for? Type the customer's name.",
    ]);
  }

  const who = findCustomer(task, data.customers);
  if ('options' in who) {
    const typed = task.customerName ?? '';
    return question(known, 'customerName', [de
      ? `Es gibt mehrere Einträge in der Kundenliste, die zu «${typed}» passen. Wen meinst du?`
      : `Several customers in your list match “${typed}”. Which one?`], [
      ...who.options.map(customer => ({
        label: who.sameName && customer.phone ? `${customer.name} · ${formatPhone(customer.phone)}` : customer.name,
        task: { ...known, customerName: customer.name, customerId: customer.id },
      })),
      ...(who.sameName ? [] : [{ label: de ? `Neu: «${typed}»` : `New customer “${typed}”`, task: { ...known, newCustomer: true } }]),
    ]);
  }

  const employee = free[0];
  const event = draftEvent(service, employee, date, time, who.name, who.id);
  // The same check the Calendar page runs when its form is saved.
  const refusal = validateCalendarEvent(data, event);
  if (refusal) {
    return { language, tone: 'problem', task: known, text: [de ? 'Das geht so nicht:' : 'That does not work:', refusalIn(refusal, language)] };
  }

  const sameDay = data.events.filter(other => other.date === date &&
    (who.id ? other.customerId === who.id : nameKey(other.customerName) === nameKey(who.name))).sort(byStart);
  const warnings = sameDay.map(other => de
    ? `${who.name} hat an dem Tag schon einen Termin: ${other.startTime} Uhr, ${other.serviceName}.`
    : `${who.name} already has an appointment that day: ${other.startTime}, ${other.serviceName}.`);
  const { employeeId: _employeeId, ...anyStylist } = known;
  return {
    language,
    text: [de ? 'Soll ich das so eintragen?' : 'Shall I book this?'],
    proposal: {
      action: { kind: 'book', event, ...(task.employeeId ? {} : { anyStylist: true }) },
      title: de ? 'Termin eintragen' : 'Book appointment',
      rows: [
        { label: de ? 'Was' : 'What', value: serviceLabel(service) },
        { label: de ? 'Wann' : 'When', value: `${capital(dayPhrase(date, language, today))}, ${formatTimeRange(event.startTime, event.endTime)}` },
        { label: de ? 'Wer' : 'Who', value: `${who.name} (${who.known ? (de ? 'in der Kundenliste' : 'in your customer list') : (de ? 'neu' : 'new customer')})` },
        { label: de ? 'Bei' : 'With', value: employee.name },
      ],
      warnings,
      confirmLabel: de ? 'Bestätigen' : 'Confirm',
      cancelLabel: de ? 'Abbrechen' : 'Cancel',
    },
    // Another stylist is free at the same time: one tap changes the proposal.
    choices: free.slice(1, 4).map(other => ({
      label: de ? `Lieber bei ${short(other)}` : `With ${short(other)} instead`,
      task: { ...anyStylist, employeeId: other.id },
    })),
    task: known,
  };
}

// ---------- cancelling ----------

const appointmentLine = (event: CalendarEvent, language: AssistantLanguage): string =>
  `${shortDay(event.date, language)}, ${event.startTime} · ${event.customerName} · ${event.serviceName}`;

function cancelProposal(task: AssistantTask, event: CalendarEvent, data: AssistantData): AssistantReply {
  const language = task.language;
  const de = language === 'de';
  const today = todayOf(data);
  return {
    language,
    text: [de ? 'Soll ich diesen Termin absagen?' : 'Shall I cancel this appointment?'],
    proposal: {
      action: { kind: 'cancel', appointmentId: event.id },
      title: de ? 'Termin absagen' : 'Cancel appointment',
      rows: [
        { label: de ? 'Was' : 'What', value: event.serviceName },
        { label: de ? 'Wann' : 'When', value: `${capital(dayPhrase(event.date, language, today))}, ${formatTimeRange(event.startTime, event.endTime)}` },
        { label: de ? 'Wer' : 'Who', value: event.customerName },
        { label: de ? 'Bei' : 'With', value: event.staffName },
      ],
      warnings: [de
        ? 'Der Termin wird aus dem Kalender entfernt. Es geht keine Nachricht an die Kundin oder den Kunden.'
        : 'The appointment is removed from the calendar. No message is sent to the customer.'],
      confirmLabel: de ? 'Bestätigen' : 'Confirm',
      cancelLabel: de ? 'Termin behalten' : 'Keep appointment',
    },
    task: { ...task, appointmentId: event.id },
  };
}

function cancel(task: AssistantTask, data: AssistantData): AssistantReply {
  const language = task.language;
  const de = language === 'de';
  const today = todayOf(data);
  if (task.appointmentId) {
    const chosen = data.events.find(event => event.id === task.appointmentId);
    if (chosen) return cancelProposal(task, chosen, data);
    return { language, tone: 'problem', text: [de ? 'Dieser Termin ist nicht mehr im Kalender.' : 'This appointment is no longer in the calendar.'] };
  }
  if (!task.customerName && !task.date) {
    return question(task, 'customerName', [de
      ? 'Wessen Termin soll ich absagen? Gib den Namen oder den Tag ein.'
      : 'Whose appointment should I cancel? Type the name or the day.']);
  }
  const typed = task.customerName ? nameKey(task.customerName).split(' ') : [];
  const namesMatch = (event: CalendarEvent) => {
    const theirs = nameKey(event.customerName).split(/[\s-]+/);
    return typed.every(word => theirs.includes(word));
  };
  const upcoming = data.events.filter(event => event.date >= today).sort(byStart);
  const ofCustomer = upcoming.filter(namesMatch);
  const matches = ofCustomer.filter(event =>
    (!task.date || event.date === task.date) &&
    (!task.time || event.startTime === task.time) &&
    (!task.employeeId || event.employeeId === task.employeeId) &&
    (!task.serviceId || serviceOf(data, event)?.id === task.serviceId));

  if (matches.length === 1) return cancelProposal(task, matches[0], data);
  const pick = (events: CalendarEvent[]): AssistantChoice[] =>
    events.slice(0, 8).map(event => ({ label: appointmentLine(event, language), task: { ...task, appointmentId: event.id } }));
  if (matches.length > 1) {
    return {
      language, task,
      text: [de ? `Ich finde ${matches.length} passende Termine. Welchen meinst du?` : `I found ${matches.length} matching appointments. Which one?`,
        ...(matches.length > 8 ? [de ? 'Das sind die ersten acht. Nenne den Tag oder die Zeit, um die anderen zu finden.' : 'These are the first eight. Name the day or the time to find the others.'] : [])],
      choices: pick(matches),
    };
  }
  const forWhom = task.customerName ? (de ? ` für ${task.customerName}` : ` for ${task.customerName}`) : '';
  const when = task.date ? ` ${onDay(task.date, language, today)}${task.time ? (de ? ` um ${task.time} Uhr` : ` at ${task.time}`) : ''}` : '';
  // The name is right but the day is not: show what that customer does have.
  const others = task.customerName && (task.date || task.time) ? ofCustomer : [];
  return {
    language, tone: 'problem', task,
    text: [
      de ? `Ich finde keinen kommenden Termin${forWhom}${when}.` : `I found no upcoming appointment${forWhom}${when}.`,
      ...(others.length > 0 ? [de ? 'Diese Termine gibt es:' : 'These appointments exist:'] : []),
    ],
    choices: others.length > 0 ? pick(others) : undefined,
  };
}

// ---------- closing a day and opening it again ----------

const isOpenWeekday = (data: AssistantData, date: string): boolean =>
  data.bookingHours.some(day => day.day === bookingHoursDay(date) && day.isOpen);
const closuresOn = (data: AssistantData, date: string): ClosedDate[] =>
  (data.closedDates ?? []).filter(closure => date >= closure.start && date <= closure.end);

function period(start: string, end: string, language: AssistantLanguage, today: string): string {
  if (start === end) return capital(dayPhrase(start, language, today));
  const days = daysBetween(start, end).length;
  return language === 'de'
    ? `${dayLabel(start, language)} bis ${dayLabel(end, language)} (${days} Tage)`
    : `${dayLabel(start, language)} to ${dayLabel(end, language)} (${days} days)`;
}

/** The same period inside a sentence: "on Friday, 09.10.2026", "from ... to ... (3 days)". */
function inPeriod(start: string, end: string, language: AssistantLanguage, today: string): string {
  if (start === end) return onDay(start, language, today);
  const days = daysBetween(start, end).length;
  return language === 'de'
    ? `von ${dayLabel(start, language)} bis ${dayLabel(end, language)} (${days} Tage)`
    : `from ${dayLabel(start, language)} to ${dayLabel(end, language)} (${days} days)`;
}

function close(task: AssistantTask, data: AssistantData): AssistantReply {
  const language = task.language;
  const de = language === 'de';
  const today = todayOf(data);
  if (!task.date) return question(task, 'date', [de ? 'Welcher Tag soll geschlossen sein?' : 'Which day should be closed?'], dayChoices(task, today));
  const start = task.date;
  const end = task.endDate && task.endDate > start ? task.endDate : start;
  if (end < today) return { language, tone: 'problem', task, asked: 'date', text: [de ? 'Dieser Tag ist schon vorbei. Welcher Tag soll geschlossen sein?' : 'That day is already over. Which day should be closed?'] };
  const days = daysBetween(start, end);
  if (days.length > 366) return { language, tone: 'problem', task, text: [de ? 'Das ist mehr als ein Jahr. Bitte schliesse höchstens ein Jahr auf einmal.' : 'That is more than a year. Please close at most one year at a time.'] };
  const covering = closuresOn(data, start)[0];
  if (covering && days.every(day => closuresOn(data, day).length > 0)) {
    return { language, text: [de
      ? `${period(start, end, language, today)} ist schon geschlossen («${covering.name}»).`
      : `${period(start, end, language, today)} is already closed (“${covering.name}”).`] };
  }
  if (start === end && !isOpenWeekday(data, start)) {
    return { language, text: [de
      ? `Am ${weekdayName(start, 'de')} ist der Salon nach den Öffnungszeiten sowieso geschlossen. Es gibt nichts zu ändern.`
      : `The salon is closed on ${weekdayName(start, 'en')}s anyway (booking hours). There is nothing to change.`] };
  }
  const inPeriod = (date: string) => date >= start && date <= end;
  const appointments = data.events.filter(event => inPeriod(event.date)).length;
  const requests = data.requests.filter(request => request.status === 'pending' && inPeriod(request.date)).length;
  const one = start === end;
  const warnings = [
    // "Closed on Friday afternoon": the app only knows whole closed days, and says so before Confirm.
    ...(task.partOfDay || task.time ? [de
      ? 'Der Salon kann nur für ganze Tage geschlossen werden, nicht für einen Teil des Tages.'
      : 'The salon can only be closed for whole days, not for part of a day.'] : []),
    ...(appointments > 0 ? [de
      ? `${count(appointments, 'Termin ist', 'Termine sind')} ${one ? 'an dem Tag' : 'in dieser Zeit'} eingetragen. ${appointments === 1 ? 'Er bleibt im Kalender: Verschiebe ihn oder sage ihn selbst ab.' : 'Sie bleiben im Kalender: Verschiebe sie oder sage sie selbst ab.'}`
      : `${count(appointments, 'appointment is', 'appointments are')} booked ${one ? 'on that day' : 'in that period'}. ${appointments === 1 ? 'It stays in the calendar: move or cancel it yourself.' : 'They stay in the calendar: move or cancel them yourself.'}`] : []),
    ...(requests > 0 ? [de
      ? `${count(requests, 'Anfrage wartet', 'Anfragen warten')} für ${one ? 'diesen Tag' : 'diese Zeit'} noch auf deine Antwort.`
      : `${count(requests, 'request for', 'requests for')} ${one ? 'that day' : 'that period'} still ${requests === 1 ? 'waits' : 'wait'} for your answer.`] : []),
  ];
  return {
    language,
    text: [de ? 'Soll ich den Salon schliessen?' : 'Shall I close the salon?'],
    proposal: {
      action: { kind: 'close', start, end },
      title: de ? 'Salon schliessen' : 'Close the salon',
      rows: [
        { label: de ? 'Wann' : 'When', value: one ? `${period(start, end, language, today)}, ${de ? 'ganzer Tag' : 'all day'}` : period(start, end, language, today) },
        { label: de ? 'Wirkung' : 'Effect', value: de ? 'Es können keine neuen Termine gebucht werden.' : 'No new appointments can be booked.' },
      ],
      warnings,
      confirmLabel: de ? 'Bestätigen' : 'Confirm',
      cancelLabel: de ? 'Abbrechen' : 'Cancel',
    },
    task,
  };
}

function reopen(task: AssistantTask, data: AssistantData): AssistantReply {
  const language = task.language;
  const de = language === 'de';
  const today = todayOf(data);
  if (!task.date) return question(task, 'date', [de ? 'Welcher Tag soll wieder offen sein?' : 'Which day should be open again?']);
  const start = task.date;
  const end = task.endDate && task.endDate > start ? task.endDate : start;
  const closures = (data.closedDates ?? []).filter(closure => closure.start <= end && closure.end >= start);
  if (closures.length === 0) {
    if (start === end && !isOpenWeekday(data, start)) {
      return { language, text: [de
        ? `Am ${weekdayName(start, 'de')} ist der Salon nach den Öffnungszeiten geschlossen. Das änderst du in den Company Settings unter Booking Hours.`
        : `The salon is closed on ${weekdayName(start, 'en')}s in the booking hours. You change that in Company Settings under Booking Hours.`] };
    }
    return { language, text: [de
      ? `${period(start, end, language, today)} ist nicht geschlossen.`
      : `${period(start, end, language, today)} is not closed.`] };
  }
  const changes = closures.map(closure => {
    const whole = closure.start >= start && closure.end <= end;
    // With the year: a closure can lie in the next one.
    const range = dayRange(closure.start, closure.end, language);
    if (whole) return de ? `Entfernt den Schliesstag «${closure.name}» (${range}).` : `Removes the closed date “${closure.name}” (${range}).`;
    return de
      ? `Kürzt «${closure.name}» (${range}). Die anderen Tage bleiben geschlossen.`
      : `Shortens “${closure.name}” (${range}). The other days stay closed.`;
  });
  const stillClosed = daysBetween(start, end).filter(day => !isOpenWeekday(data, day));
  return {
    language,
    text: [de ? 'Soll ich den Salon wieder öffnen?' : 'Shall I open the salon again?'],
    proposal: {
      action: { kind: 'reopen', start, end },
      title: de ? 'Salon wieder öffnen' : 'Open the salon again',
      rows: [
        { label: de ? 'Wann' : 'When', value: period(start, end, language, today) },
        { label: de ? 'Änderung' : 'Change', value: changes.join(' ') },
      ],
      warnings: stillClosed.length > 0 ? [de
        ? `${stillClosed.map(day => weekdayName(day, 'de')).filter((name, index, all) => all.indexOf(name) === index).join(', ')}: nach den Öffnungszeiten weiterhin geschlossen.`
        : `${stillClosed.map(day => weekdayName(day, 'en')).filter((name, index, all) => all.indexOf(name) === index).join(', ')}: still closed in the booking hours.`] : [],
      confirmLabel: de ? 'Bestätigen' : 'Confirm',
      cancelLabel: de ? 'Abbrechen' : 'Cancel',
    },
    task,
  };
}

// ---------- agenda ----------

function agenda(task: AssistantTask, data: AssistantData): AssistantReply {
  const language = task.language;
  const de = language === 'de';
  const today = todayOf(data);
  const short = shortNames(data.employees);
  const stylist = data.employees.find(employee => employee.id === task.employeeId);
  const ofStylist = (event: CalendarEvent) => !stylist || (event.employeeId !== undefined ? event.employeeId === stylist.id : event.staffName === stylist.name);
  const openCalendar = (date: string) => ({ date, label: de ? `Kalender am ${shortDay(date, language)} öffnen` : `Open calendar on ${shortDay(date, language)}` });

  if (task.scope === 'next' && !task.date) {
    // The same rule as the "Next appointment" card on Home.
    const next = nextUpcomingAppointment(data.events.filter(ofStylist), data.now, salonTimeZone(data.timeZone));
    if (!next) return { language, task, text: [de ? 'Es steht kein Termin mehr an.' : 'There is no upcoming appointment.'] };
    return {
      language, task,
      text: [de
        ? `Als Nächstes: ${next.customerName}, ${next.serviceName} bei ${next.staffName}, ${onDay(next.date, language, today)} um ${next.startTime} Uhr.`
        : `Next: ${next.customerName}, ${next.serviceName} with ${next.staffName}, ${onDay(next.date, language, today)} at ${next.startTime}.`],
      calendar: openCalendar(next.date),
    };
  }

  const forStylist = stylist ? (de ? ` bei ${short(stylist)}` : ` for ${short(stylist)}`) : '';
  const isClosed = (day: string) => closuresOn(data, day).length > 0 || !isOpenWeekday(data, day);

  // "Appointments this week?" / "next week?": one line per day instead of every appointment.
  const weekStart = !task.date && task.fromDate ? (task.fromDate < today ? today : task.fromDate) : null;
  const weekEnd = weekStart && addDays(startOfWeek(weekStart), 6);
  if (weekStart && weekEnd && weekEnd > weekStart) {
    const days = daysBetween(weekStart, weekEnd).map(day => ({
      day, closed: isClosed(day), appointments: data.events.filter(event => event.date === day && ofStylist(event)).length,
    }));
    const total = days.reduce((sum, day) => sum + day.appointments, 0);
    return {
      language, task,
      text: [de
        ? `${dayLabel(weekStart, language)} bis ${dayLabel(weekEnd, language)}: ${total === 0 ? 'keine Termine' : count(total, 'Termin', 'Termine')}${forStylist}.`
        : `${dayLabel(weekStart, language)} to ${dayLabel(weekEnd, language)}: ${total === 0 ? 'no appointments' : count(total, 'appointment', 'appointments')}${forStylist}.`],
      list: days.map(({ day, closed, appointments }) => {
        const amount = de ? count(appointments, 'Termin', 'Termine') : count(appointments, 'appointment', 'appointments');
        return `${shortDay(day, language)} · ${amount}${closed ? (de ? ' · geschlossen' : ' · closed') : ''}`;
      }),
      calendar: openCalendar(weekStart),
    };
  }

  const date = task.date ?? today;
  const events = data.events.filter(event => event.date === date && ofStylist(event)).sort(byStart);
  const requests = data.requests.filter(request => request.status === 'pending' && request.date === date).length;
  const closed = isClosed(date);
  return {
    language, task,
    text: [
      events.length === 0
        ? (de ? `${capital(dayPhrase(date, language, today))}: keine Termine${forStylist}.` : `${capital(dayPhrase(date, language, today))}: no appointments${forStylist}.`)
        : (de ? `${capital(dayPhrase(date, language, today))}: ${count(events.length, 'Termin', 'Termine')}${forStylist}.` : `${capital(dayPhrase(date, language, today))}: ${count(events.length, 'appointment', 'appointments')}${forStylist}.`),
      ...(closed ? [de ? 'An diesem Tag ist der Salon geschlossen.' : 'The salon is closed on this day.'] : []),
      ...(requests > 0 ? [de
        ? `${count(requests, 'Anfrage', 'Anfragen')} für diesen Tag ${requests === 1 ? 'wartet' : 'warten'} auf Home auf deine Antwort.`
        : `${count(requests, 'request', 'requests')} for this day ${requests === 1 ? 'waits' : 'wait'} for your answer on Home.`] : []),
    ],
    list: events.map(event => `${formatTimeRange(event.startTime, event.endTime)} · ${event.customerName} · ${event.serviceName} · ${event.staffName}`),
    calendar: openCalendar(date),
  };
}

// ---------- one customer's appointments ----------

const MAX_LISTED = 8;

/**
 * "Is Lea Brunner booked on Tuesday?", "Has Sandra Meier cancelled?": what the calendar holds
 * for one customer. It only reads. Cancelling is a separate request the owner has to make.
 */
function appointments(task: AssistantTask, data: AssistantData): AssistantReply {
  const language = task.language;
  const de = language === 'de';
  const today = todayOf(data);
  const openCalendar = (date: string) => ({ date, label: de ? `Kalender am ${shortDay(date, language)} öffnen` : `Open calendar on ${shortDay(date, language)}` });
  // A cancelled appointment leaves no trace in the calendar, so the assistant cannot report one.
  const notKept = task.cancellations ? [de
    ? 'Ob etwas abgesagt wurde, sehe ich nicht: Ein abgesagter Termin steht einfach nicht mehr im Kalender.'
    : 'I cannot see whether something was cancelled: a cancelled appointment is simply no longer in the calendar.'] : [];
  const name = task.customerName;
  if (!name) {
    if (notKept.length === 0) return helpReply(language, data, false);
    return { language, task, text: notKept, ...(task.date ? { calendar: openCalendar(task.date) } : {}) };
  }

  const typed = nameKey(name).split(' ');
  const named = (other: string) => {
    const theirs = nameKey(other).split(/[\s-]+/);
    return typed.every(word => theirs.includes(word));
  };
  // One day, several days ("this week"), or everything still to come.
  const weekStart = !task.date && task.fromDate ? (task.fromDate < today ? today : task.fromDate) : undefined;
  const start = task.date ?? weekStart ?? today;
  const end = task.date ? (task.endDate && task.endDate > task.date ? task.endDate : task.date) : weekStart ? addDays(startOfWeek(weekStart), 6) : undefined;
  const upcoming = !end;
  const oneDay = end === start;
  const inRange = (date: string) => date >= start && (end === undefined || date <= end);
  const theirs = data.events.filter(event => named(event.customerName)).sort(byStart);
  const found = theirs.filter(event => inRange(event.date));
  const waiting = data.requests.filter(request => request.status === 'pending' && named(request.customerName) && inRange(request.date)).length;
  const line = (event: CalendarEvent) => oneDay
    ? `${event.startTime}–${event.endTime} · ${event.customerName} · ${event.serviceName} · ${event.staffName}`
    : `${shortDay(event.date, language)}, ${event.startTime}–${event.endTime} · ${event.customerName} · ${event.serviceName} · ${event.staffName}`;
  const when = upcoming ? '' : inPeriod(start, end ?? start, language, today);
  const over = !upcoming && (end ?? start) < today;

  // Nothing in the days asked about: show what that customer does have, as a cancellation would.
  const others = found.length === 0 && !upcoming ? theirs.filter(event => event.date >= today) : [];
  const listed = found.length > 0 ? found : others;
  const requests = waiting > 0 ? [de
    ? `${count(waiting, 'Anfrage', 'Anfragen')} von ${name} ${waiting === 1 ? 'wartet' : 'warten'} auf Home auf deine Antwort.`
    : `${count(waiting, 'request', 'requests')} from ${name} ${waiting === 1 ? 'waits' : 'wait'} for your answer on Home.`] : [];
  const more = listed.length > MAX_LISTED ? [de ? `… und ${listed.length - MAX_LISTED} weitere.` : `… and ${listed.length - MAX_LISTED} more.`] : [];
  const first = found.length > 0
    ? (upcoming
      ? (de ? `${name} hat ${count(found.length, 'kommenden Termin', 'kommende Termine')}:` : `${name} has ${count(found.length, 'upcoming appointment', 'upcoming appointments')}:`)
      : (de
        ? `${name} ${over ? 'hatte' : 'hat'} ${when} ${count(found.length, 'Termin', 'Termine')}:`
        : `${name} ${over ? 'had' : 'has'} ${count(found.length, 'appointment', 'appointments')} ${when}:`))
    : (upcoming
      ? (de ? `Ich finde keinen kommenden Termin für ${name}.` : `I found no upcoming appointment for ${name}.`)
      : (de ? `Ich finde keinen Termin für ${name} ${when}.` : `I found no appointment for ${name} ${when}.`));
  const calendarDay = task.date ?? found[0]?.date;
  return {
    language, task,
    text: [
      first,
      ...requests,
      ...notKept,
      ...(others.length > 0 ? [de ? 'Diese kommenden Termine gibt es:' : 'These upcoming appointments exist:'] : []),
      ...more,
    ],
    // The lines of other days carry their date, also under a question about one day.
    list: (found.length > 0 ? found.map(line) : others.map(event =>
      `${shortDay(event.date, language)}, ${event.startTime}–${event.endTime} · ${event.customerName} · ${event.serviceName} · ${event.staffName}`)).slice(0, MAX_LISTED),
    ...(calendarDay ? { calendar: openCalendar(calendarDay) } : {}),
  };
}

// ---------- open or closed ----------

/**
 * "Are we closed on Friday?", "What time do we close on Saturday?": read from the booking hours
 * and the closed dates, the same two things the booking rules look at. It changes nothing.
 */
function hours(task: AssistantTask, data: AssistantData): AssistantReply {
  const language = task.language;
  const de = language === 'de';
  const today = todayOf(data);
  const openCalendar = (date: string) => ({ date, label: de ? `Kalender am ${shortDay(date, language)} öffnen` : `Open calendar on ${shortDay(date, language)}` });
  const weekly = (date: string) => data.bookingHours.find(day => day.day === bookingHoursDay(date) && day.isOpen);
  const named = (closure: ClosedDate) => closure.name.trim() ? (de ? ` «${closure.name.trim()}»` : ` “${closure.name.trim()}”`) : '';
  /** One day in a list: its hours, or that it is closed and why. */
  const state = (date: string): string => {
    const closure = closuresOn(data, date)[0];
    const open = weekly(date);
    if (closure) return de ? `geschlossen (Schliesstag${named(closure)})` : `closed (closed date${named(closure)})`;
    if (!open) return de ? 'geschlossen' : 'closed';
    return de ? `offen ${open.from}–${open.to} Uhr` : `open ${open.from}–${open.to}`;
  };

  const weekStart = !task.date && task.fromDate ? (task.fromDate < today ? today : task.fromDate) : undefined;
  const start = task.date ?? weekStart;
  if (!start) {
    // No day asked: the week as it is set in the booking hours, and the closed dates still to come.
    const week = daysBetween(startOfWeek(today), addDays(startOfWeek(today), 6));
    const closures = (data.closedDates ?? []).filter(closure => closure.end >= today).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3);
    return {
      language, task,
      text: [de ? 'Die Öffnungszeiten des Salons (Booking Hours in den Company Settings):' : 'The salon’s booking hours (set in Company Settings under Booking Hours):'],
      list: [
        ...week.map(date => {
          const open = weekly(date);
          return `${weekdayName(date, language)} · ${open ? (de ? `${open.from}–${open.to} Uhr` : `${open.from}–${open.to}`) : (de ? 'geschlossen' : 'closed')}`;
        }),
        ...closures.map(closure => {
          // With the year, in the one range format: a closure can run into the next year.
          const range = dayRange(closure.start, closure.end, language);
          return de ? `Schliesstag${named(closure)} · ${range}` : `Closed date${named(closure)} · ${range}`;
        }),
      ],
    };
  }

  const end = task.date ? (task.endDate && task.endDate > task.date ? task.endDate : task.date) : addDays(startOfWeek(start), 6);
  if (end > start) {
    const days = daysBetween(start, end);
    const shown = days.slice(0, 14);
    return {
      language, task,
      text: [
        `${period(start, end, language, today)}:`,
        ...(days.length > shown.length ? [de ? `… und ${days.length - shown.length} weitere Tage.` : `… and ${days.length - shown.length} more days.`] : []),
      ],
      list: shown.map(date => `${shortDay(date, language)} · ${state(date)}`),
      calendar: openCalendar(start < today ? today : start),
    };
  }

  const closure = closuresOn(data, start)[0];
  const open = weekly(start);
  const day = capital(dayPhrase(start, language, today));
  // A day that is over is told in the past tense, from the hours and closed dates as they are set now.
  const is = start < today ? (de ? 'war' : 'was') : (de ? 'ist' : 'is');
  const text = closure
    ? (de ? `${day}: Der Salon ${is} geschlossen (Schliesstag${named(closure)}).` : `${day}: the salon ${is} closed (closed date${named(closure)}).`)
    : !open
      ? (de
        ? `${day}: Der Salon ${is} geschlossen. Am ${weekdayName(start, 'de')} ist er nach den Öffnungszeiten immer geschlossen.`
        : `${day}: the salon ${is} closed. It is closed on ${weekdayName(start, 'en')}s in the booking hours.`)
      : (de ? `${day}: Der Salon ${is} von ${open.from} bis ${open.to} Uhr geöffnet.` : `${day}: the salon ${is} open from ${open.from} to ${open.to}.`);
  return { language, task, text: [text], calendar: openCalendar(start) };
}

// ---------- one person's time off ----------

/**
 * "Selina is taking Friday off": the assistant can only close the whole salon, and one person's
 * day off must never do that. It says where absences are entered, with the screens' own names,
 * and what the Shift Plan and the calendar hold for that person on that day.
 */
function absence(task: AssistantTask, data: AssistantData): AssistantReply {
  const language = task.language;
  const de = language === 'de';
  const today = todayOf(data);
  const person = data.employees.find(employee => employee.id === task.employeeId);
  const name = person ? shortNames(data.employees)(person) : undefined;
  const facts: string[] = [];
  if (person && name && task.date) {
    const date = task.date;
    const on = onDay(date, language, today);
    const away = (data.absences ?? []).some(entry => entry.employeeId === person.id && date >= entry.start && date <= entry.end);
    const shift = data.shiftOverview.find(entry => entry.employeeId === person.id)?.shifts[date];
    if (away) facts.push(de ? `Für ${name} ist ${on} schon eine Abwesenheit eingetragen.` : `An absence is already entered for ${name} ${on}.`);
    else if (shift) facts.push(de ? `Im Shift Plan arbeitet ${name} ${on} von ${shift.start} bis ${shift.end} Uhr.` : `In the Shift Plan ${name} works from ${shift.start} to ${shift.end} ${on}.`);
    else facts.push(de ? `Im Shift Plan hat ${name} ${on} keine Schicht.` : `In the Shift Plan ${name} has no shift ${on}.`);
    const booked = data.events.filter(event => event.date === date &&
      (event.employeeId !== undefined ? event.employeeId === person.id : event.staffName === person.name)).length;
    if (booked > 0) {
      facts.push(de
        ? `${count(booked, 'Termin ist', 'Termine sind')} an dem Tag bei ${name} eingetragen. ${booked === 1 ? 'Er bleibt' : 'Sie bleiben'} im Kalender, auch wenn du eine Abwesenheit einträgst.`
        : `${count(booked, 'appointment is', 'appointments are')} booked with ${name} that day. ${booked === 1 ? 'It stays' : 'They stay'} in the calendar when you enter an absence.`);
    }
  }
  return {
    language,
    text: [
      de
        ? `Eine Abwesenheit für ${name ?? 'eine einzelne Person'} kann ich nicht eintragen. Es wurde nichts geändert, und der Salon wurde nicht geschlossen.`
        : `I cannot enter time off for ${name ?? 'one person'}. Nothing was changed, and the salon was not closed.`,
      de
        ? 'Du trägst sie in den Company Settings unter Closed Dates and Absences ein (Reiter Absences). Für einen einzelnen Tag kannst du auch die Schicht im Shift Plan ändern.'
        : 'You enter it in Company Settings under Closed Dates and Absences (tab Absences). For a single day you can also change the shift in the Shift Plan.',
      ...facts,
      de
        ? 'Wenn der ganze Salon geschlossen sein soll, schreibe zum Beispiel «Am Freitag geschlossen».'
        : 'If the whole salon should be closed, write for example “Close Friday”.',
    ],
  };
}

// ---------- help ----------

/** Example requests built from the salon's own service, so tapping one really works. */
export function assistantExamples(language: AssistantLanguage, services: Pick<ServiceItem, 'name'>[]): string[] {
  const service = services.find(item => /cut|schnitt/.test(fold(item.name))) ?? services[0];
  const oneWord = service && !/\s/.test(service.name.trim());
  if (language === 'de') {
    const forService = service ? ` für ${service.name}` : '';
    return [
      `Hast du am Donnerstag um 15 Uhr etwas frei${forService}?`,
      `Trag Lea Brunner am Dienstag um 10 Uhr${forService} ein`,
      'Am Freitag geschlossen',
      'Was steht heute an?',
    ];
  }
  const forService = service ? (oneWord ? ` for a ${service.name.toLowerCase()}` : ` for ${service.name}`) : '';
  return [
    `Is Thursday at 15:00 free${forService}?`,
    `Book Lea Brunner${forService} on Tuesday at 10`,
    'Close Friday',
    "What's on today?",
  ];
}

export function helpReply(language: AssistantLanguage, data: Pick<AssistantData, 'services'>, understood = true): AssistantReply {
  const de = language === 'de';
  return {
    language,
    text: [understood
      ? (de
        ? 'Ich sage dir, wann etwas frei ist, wer eingetragen ist und wann der Salon offen hat. Ich trage Termine ein oder sage sie ab und schliesse einen Tag. Geändert wird erst, wenn du bestätigst. Zum Beispiel:'
        : 'I can tell you when a time is free, who is booked and when the salon is open. I can book or cancel an appointment and close a day. Nothing changes until you confirm. For example:')
      : (de ? 'Das habe ich nicht verstanden. Versuch es zum Beispiel so:' : 'I did not understand that. Try one of these:')],
    examples: assistantExamples(language, data.services),
  };
}

/** Short fixed answers that need no data. */
export const smallTalk = (language: AssistantLanguage, kind: 'thanks' | 'nothingOpen' | 'dismissed'): AssistantReply => ({
  language,
  text: [language === 'de'
    ? { thanks: 'Gern geschehen.', nothingOpen: 'Es wartet gerade nichts auf eine Bestätigung.', dismissed: 'In Ordnung, es wurde nichts geändert.' }[kind]
    : { thanks: "You're welcome.", nothingOpen: 'Nothing is waiting for a confirmation.', dismissed: 'Okay, nothing was changed.' }[kind]],
});

// ---------- the two entry points ----------

/** Answers a request or prepares a proposal. It never changes anything. */
export function answer(task: AssistantTask, data: AssistantData): AssistantReply {
  switch (task.intent) {
    case 'availability': return availability(task, data);
    case 'book': return book(task, data);
    case 'cancel': return cancel(task, data);
    case 'close': return close(task, data);
    case 'reopen': return reopen(task, data);
    case 'agenda': return agenda(task, data);
    case 'appointments': return appointments(task, data);
    case 'hours': return hours(task, data);
    case 'absence': return absence(task, data);
    default: return helpReply(task.language, data);
  }
}

/** The open question once more, after an answer that could not be read. */
export function askAgain(task: AssistantTask, language: AssistantLanguage, data: AssistantData): AssistantReply {
  const reply = answer({ ...task, language }, data);
  return { ...reply, text: [language === 'de' ? 'Das habe ich nicht verstanden.' : 'I did not understand that.', ...reply.text] };
}

/**
 * Runs a proposal the owner confirmed, through the same handlers the screens use, and reports
 * what happened. `data` is the salon's data at this moment, not at the time of the proposal.
 */
export function confirmProposal(proposal: AssistantProposal, language: AssistantLanguage, data: AssistantData, handlers: AssistantHandlers): AssistantReply {
  const de = language === 'de';
  const today = todayOf(data);
  const action = proposal.action;
  const openCalendar = (date: string) => ({ date, label: de ? `Kalender am ${shortDay(date, language)} öffnen` : `Open calendar on ${shortDay(date, language)}` });

  if (action.kind === 'book') {
    const { event } = action;
    // handleAddCalendarEvent validates again with the calendar as it is now.
    const refusal = handlers.addEvent(event);
    if (refusal) {
      const service = serviceOf(data, event);
      const employee = data.employees.find(item => item.id === event.employeeId);
      // Who else may take it: the owner asked for this stylist, or the assistant picked one itself.
      // Then anybody who offers the service counts, as when the booking was first worked out.
      const staff = !service ? [] : action.anyStylist
        ? data.employees.filter(item => item.status === 'Active' && isEmployeeAssignedToService(service, item))
        : employee ? [employee] : [];
      const view = service ? dayView(data, event.date, service, staff) : [];
      const times = freeTimes(view);
      const others = freeAt(view, event.startTime);
      const short = shortNames(data.employees);
      const again: AssistantTask = { intent: 'book', language, serviceId: event.serviceId, ...(action.anyStylist ? {} : { employeeId: event.employeeId }), date: event.date, customerName: event.customerName, ...(event.customerId ? { customerId: event.customerId } : {}) };
      const choices: AssistantChoice[] = [
        ...others.slice(0, 3).map(other => ({
          label: de ? `Lieber bei ${short(other)}` : `With ${short(other)} instead`,
          task: { ...again, employeeId: other.id, time: event.startTime },
        })),
        ...timeChoices(again, event.date, times),
      ];
      return {
        language, tone: 'problem', task: again, asked: 'time',
        text: [de ? 'Der Termin wurde nicht eingetragen:' : 'The appointment was not booked:', refusalIn(refusal, language),
          ...(others.length > 0 ? [de
            ? `Um ${event.startTime} Uhr ist ${list(others.map(short), language)} frei.`
            : `${list(others.map(short), language)} is free at ${event.startTime}.`] : []),
          ...(times.length > 0 ? [de ? 'An dem Tag frei:' : 'Free that day:'] : [])],
        choices: choices.length > 0 ? choices : undefined,
      };
    }
    return {
      language, tone: 'success',
      text: [de
        ? `Eingetragen: ${event.serviceName} für ${event.customerName} ${onDay(event.date, language, today)}, ${formatTimeRange(event.startTime, event.endTime)} Uhr, bei ${event.staffName}.`
        : `Booked: ${event.serviceName} for ${event.customerName} ${onDay(event.date, language, today)}, ${formatTimeRange(event.startTime, event.endTime)}, with ${event.staffName}.`],
      calendar: openCalendar(event.date),
    };
  }

  if (action.kind === 'cancel') {
    const event = data.events.find(item => item.id === action.appointmentId);
    if (!event) return { language, tone: 'problem', text: [de ? 'Dieser Termin ist nicht mehr im Kalender.' : 'This appointment is no longer in the calendar.'] };
    handlers.deleteEvent(event.id);
    return {
      language, tone: 'success',
      text: [de
        ? `Abgesagt: ${event.serviceName} für ${event.customerName} ${onDay(event.date, language, today)} um ${event.startTime} Uhr. Die Zeit ist wieder frei.`
        : `Cancelled: ${event.serviceName} for ${event.customerName} ${onDay(event.date, language, today)} at ${event.startTime}. The time is free again.`],
      calendar: openCalendar(event.date),
    };
  }

  const closedDates = data.closedDates ?? [];
  const sorted = (dates: ClosedDate[]) => [...dates].sort((a, b) => a.start.localeCompare(b.start));
  if (action.kind === 'close') {
    const { start, end } = action;
    // Company Settings refuses a second closure for exactly the same days; so does the assistant.
    if (closedDates.some(closure => closure.start === start && closure.end === end)) {
      return { language, text: [de ? 'Das ist schon geschlossen.' : 'That is already closed.'] };
    }
    handlers.saveClosedDates(sorted([...closedDates, { id: `closed-${crypto.randomUUID()}`, name: CLOSURE_NAME, start, end }]));
    return {
      language, tone: 'success',
      text: [de
        ? `Erledigt. Der Salon ist ${inPeriod(start, end, language, today)} geschlossen. Der Eintrag steht in den Company Settings unter Closed Dates and Absences.`
        : `Done. The salon is closed ${inPeriod(start, end, language, today)}. The entry is listed in Company Settings under Closed Dates and Absences.`],
      calendar: openCalendar(start < today ? today : start),
    };
  }

  const { start, end } = action;
  const next = closedDates.flatMap((closure): ClosedDate[] => {
    if (closure.start > end || closure.end < start) return [closure];
    const before = closure.start < start ? [{ ...closure, end: addDays(start, -1) }] : [];
    const after = closure.end > end ? [{ ...closure, id: before.length ? `closed-${crypto.randomUUID()}` : closure.id, start: addDays(end, 1) }] : [];
    return [...before, ...after];
  });
  if (next.length === closedDates.length && next.every((closure, index) => closure === closedDates[index])) {
    return { language, text: [de ? 'Dieser Tag ist nicht mehr geschlossen.' : 'That day is no longer closed.'] };
  }
  handlers.saveClosedDates(sorted(next));
  return {
    language, tone: 'success',
    text: [de
      ? `Erledigt. Der Salon ist ${inPeriod(start, end, language, today)} wieder geöffnet.`
      : `Done. The salon is open again ${inPeriod(start, end, language, today)}.`],
    calendar: openCalendar(start < today ? today : start),
  };
}
