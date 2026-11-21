import type { CalendarEvent, Customer, ShiftEntry } from './types.js';
import { addDays, dayKeyForDate, formatCalendarDate, getSalonNow, startOfWeek } from './scheduling.js';
import { demoShiftColors, initialBookingHours, initialEmployees, initialServices } from './mockData.js';

/**
 * The salon's history and bookings as they look "now": weeks of appointments, the customers
 * who had them, and the days somebody works differently from their regular week.
 *
 * Nothing here reads the clock or uses random numbers. Every builder takes the moment "now" as
 * an argument, and every choice (who comes when, to whom, for what) is a fixed formula of the
 * person and the calendar week. So every tab opened on the same day shows the same salon, and
 * tests can build the salon for any date.
 */

// ---------- small helpers ----------

const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};
const toTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The next given weekday (0 = Sunday ... 6 = Saturday), one to seven days after `day`
 * (YYYY-MM-DD). A chat that says "Friday" means the first Friday after the day it was written.
 */
export const upcomingWeekday = (weekday: number, day: string): string =>
  addDays(day, ((weekday - weekdayOf(day) + 6) % 7) + 1);

/** The moment at which the salon's clock shows this date and time. */
export const salonInstant = (date: string, time: string, timeZone?: string): Date => {
  const wanted = Date.parse(`${date}T${time}:00Z`);
  let guess = wanted;
  // The zone's distance to UTC depends on the date (summer time), so correct the guess twice.
  for (let round = 0; round < 2; round++) {
    const shown = getSalonNow(timeZone, new Date(guess));
    guess += wanted - Date.parse(`${shown.date}T${shown.time}:00Z`);
  }
  return new Date(guess);
};

/** A fixed number for a text: the same text always gives the same number. Used instead of random numbers. */
const numberFor = (text: string): number => {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  // Mix once more, so that texts which differ in one character give unrelated numbers.
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
};
const choose = <T>(key: string, options: readonly T[]): T => options[numberFor(key) % options.length];
/** Like choose, but an option with weight 3 is picked three times as often as one with weight 1. */
const chooseWeighted = <T>(key: string, options: readonly (readonly [T, number])[]): T => {
  let point = numberFor(key) % options.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [option, weight] of options) {
    if (point < weight) return option;
    point -= weight;
  }
  return options[options.length - 1][0];
};

const serviceById = (id: string) => initialServices.find((service) => service.id === id)!;
const employeeById = (id: string) => initialEmployees.find((employee) => employee.id === id)!;
const openingOnWeekday = (weekday: number) => {
  const hours = initialBookingHours.find((day) => day.day === WEEKDAY_NAMES[weekday]);
  return hours?.isOpen ? hours : null;
};
const openingOn = (date: string) => openingOnWeekday(weekdayOf(date));
// The stylists' working hours are their regular week (weeklyHours in src/mockData.ts): the one
// place that says when they work. Appointments are placed inside it.
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** A stylist's regular hours on a weekday (0 = Sunday ... 6 = Saturday), or null for a day off. */
const regularHours = (employeeId: string, weekday: number): { start: string; end: string } | null =>
  initialEmployees.find((employee) => employee.id === employeeId)?.weeklyHours?.[WEEKDAY_KEYS[weekday]] ?? null;
/** The weekdays (0 = Sunday ... 6 = Saturday) on which a stylist works. */
const workdaysOf = (employeeId: string): number[] =>
  WEEKDAY_KEYS.map((_, weekday) => weekday).filter((weekday) => regularHours(employeeId, weekday));

const weekdayWindows = new Map<string, { start: number; end: number } | null>();
/** The minutes of a weekday in which a stylist can serve customers: the working hours, cut to the opening hours. */
const windowOnWeekday = (employeeId: string, weekday: number): { start: number; end: number } | null => {
  const key = `${employeeId}|${weekday}`;
  if (weekdayWindows.has(key)) return weekdayWindows.get(key)!;
  const hours = openingOnWeekday(weekday);
  const shift = regularHours(employeeId, weekday);
  let window: { start: number; end: number } | null = null;
  if (hours && shift) {
    // Appointments start on the half hour.
    const start = Math.ceil(Math.max(toMinutes(hours.from), toMinutes(shift.start)) / 30) * 30;
    const end = Math.min(toMinutes(hours.to), toMinutes(shift.end));
    if (end > start) window = { start, end };
  }
  weekdayWindows.set(key, window);
  return window;
};
const workingWindow = (employeeId: string, date: string) => windowOnWeekday(employeeId, weekdayOf(date));

/** How many weeks the salon's history goes back, and how many weeks ahead bookings already exist. */
export const DEMO_WEEKS_BACK = 8;
export const DEMO_WEEKS_AHEAD = 3;

/** First and last day for which appointments are built: whole weeks, Monday to Sunday. */
export const demoWindow = (today: string): { from: string; to: string } => {
  const thisWeek = startOfWeek(today);
  return { from: addDays(thisWeek, -7 * DEMO_WEEKS_BACK), to: addDays(thisWeek, 7 * DEMO_WEEKS_AHEAD + 6) };
};

// ---------- single days that differ from the regular week ----------

/**
 * The week plan a new workspace starts with. It holds only the days on which somebody works
 * differently from their regular week (see workingTimeOn in src/workingHours.ts), and the sample
 * salon needs none: every appointment, every waiting request and every time a chat offers lies
 * inside the stylists' regular hours, also the Saturday Giulia's chat moves her appointment to
 * and the appointments of the eight weeks that are over. So each stylist starts with an empty list.
 * The time zone and the moment are taken as in every builder here: a day that the sample story
 * needs one day would be placed from them, and no caller would have to change.
 */
export const createDemoShifts = (_timeZone?: string, _now?: Date): ShiftEntry[] =>
  initialEmployees.map((employee, index) => ({
    employeeId: employee.id,
    employeeName: employee.name,
    initials: employee.initials,
    avatarColor: demoShiftColors[index % demoShiftColors.length],
    shifts: {},
  }));

// ---------- people ----------

export interface DemoPerson {
  id: string;
  name: string;
  language: Customer['language'];
  phone: string;
  email: string;
}

export type ChatPerson = 'camille' | 'chloe' | 'giulia' | 'marie' | 'lea' | 'john';

/**
 * The six people of the sample chats. Their appointments are the ones the chats talk about,
 * so they are placed by hand (see demoTimeline) instead of following a habit.
 */
export const demoChatPeople: Record<ChatPerson, DemoPerson> = {
  camille: { id: 'cust-camille', name: 'Camille Bernard', language: 'FR', phone: '+41785552740', email: '' },
  chloe: { id: 'cust-chloe', name: 'Chloé Favre', language: 'DE', phone: '+41775559345', email: '' },
  giulia: { id: 'cust-giulia', name: 'Giulia Rossi', language: 'IT', phone: '+41765554078', email: '' },
  marie: { id: 'cust-marie', name: 'Marie Dupont', language: 'FR', phone: '+41795556112', email: 'marie.dupont@example.com' },
  lea: { id: 'cust-lea', name: 'Léa Girard', language: 'FR', phone: '+41765558234', email: '' },
  john: { id: 'cust-john', name: 'John Bennett', language: 'EN', phone: '+41785551490', email: '' },
};

/**
 * The channel the sample chats came in on; the customer record remembers it. All of them use the
 * website chat, the assistant's own channel. WhatsApp is not connected and Instagram is only
 * planned (see the Channels list on the AI page), so no sample chat may claim to come from there.
 */
export const DEMO_CHAT_CHANNEL = 'Website' as const;

/**
 * People who have never been to the salon. A request "from somebody new" (the study tool
 * "Simulate incoming booking") comes from one of them. They never get an appointment in the
 * calendar below, so on every day there is somebody who is not a customer yet.
 */
export const demoNewcomers: DemoPerson[] = [
  { id: 'new-1', name: 'Seraina Koller', language: 'DE', phone: '+41795553162', email: '' },
  { id: 'new-2', name: 'Tobias Wenger', language: 'DE', phone: '+41785554715', email: '' },
  { id: 'new-3', name: 'Nadja Brunner', language: 'DE', phone: '+41765555803', email: '' },
  { id: 'new-4', name: 'Ilaria Fontana', language: 'IT', phone: '+41795556641', email: '' },
  { id: 'new-5', name: 'Vanessa Imhof', language: 'DE', phone: '+41775557296', email: '' },
  { id: 'new-6', name: 'Matthias Frick', language: 'DE', phone: '+41785558427', email: '' },
  { id: 'new-7', name: 'Aurélie Dubois', language: 'FR', phone: '+41765559053', email: '' },
  { id: 'new-8', name: 'Tanja Schär', language: 'DE', phone: '+41795551288', email: '' },
];

type Kind = 'woman' | 'man' | 'child';
interface NameGroup {
  language: Customer['language'];
  /** Some families speak German with the salon although their name is not German. */
  germanShare?: number;
  women: string[];
  men: string[];
  children: string[];
  surnames: string[];
  /** How many women, men and children of this group are customers. */
  counts: [number, number, number];
}

// About three quarters of the customers have Swiss German names, as in St. Gallen; the rest
// mirror the city's larger communities. First names and surnames are common ones, combined by
// formula: no entry describes a real person.
const NAME_GROUPS: NameGroup[] = [
  {
    language: 'DE',
    women: ['Petra', 'Nicole', 'Claudia', 'Monika', 'Daniela', 'Karin', 'Andrea', 'Barbara', 'Ursula', 'Esther', 'Brigitte', 'Silvia',
      'Manuela', 'Corinne', 'Jasmin', 'Laura', 'Sarah', 'Julia', 'Anja', 'Melanie', 'Tamara', 'Nadine', 'Simone', 'Martina',
      'Franziska', 'Regula', 'Ruth', 'Heidi', 'Livia', 'Noemi', 'Alina', 'Jana', 'Michelle', 'Rahel', 'Fabienne', 'Céline',
      'Ramona', 'Sabrina', 'Bettina', 'Susanne', 'Marianne', 'Elisabeth', 'Doris', 'Rita', 'Erika', 'Margrit', 'Verena'],
    men: ['Daniel', 'Thomas', 'Peter', 'Martin', 'Andreas', 'Markus', 'Stefan', 'Christian', 'Michael', 'Marcel', 'Patrick', 'Reto',
      'Urs', 'Beat', 'Roland', 'Simon', 'Lukas', 'Jonas', 'Fabian', 'Pascal', 'Dominik', 'Florian', 'Samuel', 'Jan', 'Kevin',
      'Sandro', 'Roger', 'Bruno', 'Hans', 'Walter', 'Kurt', 'René', 'Remo'],
    children: ['Mia', 'Emma', 'Lina', 'Elin', 'Nora', 'Leon', 'Nico', 'Levin', 'Elia', 'Ben', 'Lio', 'Noah', 'Tim'],
    surnames: ['Meier', 'Müller', 'Schmid', 'Huber', 'Brunner', 'Graf', 'Baumann', 'Zimmermann', 'Fischer', 'Gerber', 'Steiner',
      'Moser', 'Widmer', 'Bühler', 'Kunz', 'Hofer', 'Lehmann', 'Schneider', 'Roth', 'Bachmann', 'Egli', 'Sutter', 'Kaufmann',
      'Wyss', 'Hess', 'Ammann', 'Lüthi', 'Bischof', 'Eugster', 'Rutz', 'Tobler', 'Forster', 'Koller', 'Fässler', 'Rechsteiner',
      'Signer', 'Dörig', 'Sonderegger', 'Hungerbühler', 'Zellweger', 'Stadler', 'Germann', 'Scherrer', 'Künzle', 'Thoma', 'Hug',
      'Nef', 'Looser', 'Oertle', 'Eberle', 'Angehrn', 'Bösch', 'Gmür', 'Schawalder', 'Hutter', 'Lutz', 'Zürcher', 'Wild',
      'Mettler', 'Inauen', 'Manser', 'Fuchs', 'Wagner', 'Vogel', 'Marti', 'Arnold', 'Kälin', 'Hauser', 'Pfister', 'Suter',
      'Stucki', 'Aebi', 'Baumgartner'],
    counts: [95, 29, 11],
  },
  {
    language: 'IT',
    germanShare: 30,
    women: ['Francesca', 'Elena', 'Alessia', 'Valentina', 'Paola', 'Chiara', 'Federica', 'Silvana', 'Roberta', 'Sara'],
    men: ['Matteo', 'Davide', 'Antonio', 'Giuseppe', 'Stefano', 'Luigi'],
    children: ['Aurora', 'Leonardo'],
    surnames: ['Bianchi', 'Russo', 'Ferrari', 'Esposito', 'Colombo', 'Romano', 'Ricci', 'Greco', 'Conti', 'De Luca', 'Marino'],
    counts: [10, 4, 1],
  },
  {
    language: 'FR',
    women: ['Claire', 'Julie', 'Élodie', 'Nathalie', 'Amélie'],
    men: ['Pierre', 'Nicolas', 'Julien'],
    children: [],
    surnames: ['Rochat', 'Blanc', 'Morel', 'Lambert', 'Fournier', 'Chevalier', 'Perrin'],
    counts: [4, 2, 0],
  },
  {
    language: 'DE',
    women: ['Arta', 'Blerta', 'Valbona', 'Drita', 'Liridona'],
    men: ['Arben', 'Besnik', 'Shpend'],
    children: ['Leona', 'Rion'],
    surnames: ['Hoxha', 'Krasniqi', 'Berisha', 'Gashi', 'Shala', 'Morina', 'Bytyqi'],
    counts: [5, 1, 1],
  },
  {
    language: 'DE',
    women: ['Jelena', 'Milica', 'Ivana', 'Dragana', 'Marija'],
    men: ['Marko', 'Nikola', 'Goran'],
    children: [],
    surnames: ['Jovanović', 'Petrović', 'Marković', 'Nikolić', 'Kovačević', 'Babić', 'Ilić'],
    counts: [4, 1, 0],
  },
  {
    language: 'DE',
    women: ['Elif', 'Zeynep', 'Ayşe', 'Fatma'],
    men: ['Emre', 'Murat', 'Can'],
    children: ['Deniz', 'Ela'],
    surnames: ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Arslan', 'Doğan'],
    counts: [4, 1, 1],
  },
  {
    language: 'DE',
    women: ['Inês', 'Carla', 'Beatriz', 'Lucía', 'Marta'],
    men: ['João', 'Pedro', 'Tiago', 'Miguel'],
    children: [],
    surnames: ['Silva', 'Santos', 'Ferreira', 'Pereira', 'Costa', 'García', 'López'],
    counts: [4, 1, 0],
  },
  {
    language: 'EN',
    women: ['Kate', 'Olivia', 'Hannah', 'Grace'],
    men: ['James', 'David', 'Oliver'],
    children: ['Lily', 'Jack'],
    surnames: ['Clarke', 'Taylor', 'Evans', 'Walker', 'Hughes', 'Morgan', 'Turner'],
    counts: [4, 1, 1],
  },
];

/** "Künzle" becomes "kuenzle", "Jovanović" becomes "jovanovic": the form an e-mail address would use. */
const plainLetters = (text: string): string => text
  .toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/ı/g, 'i')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z]/g, '');

interface PoolPerson extends DemoPerson { kind: Kind }

/** Every customer the salon has besides the six chat people: the same list on every day. */
const buildPool = (): PoolPerson[] => {
  const pool: PoolPerson[] = [];
  // Phone numbers are clearly invented (555 block). No two end on neighbouring numbers. They are
  // stored like every number, in the international form, and shown as "+41 79 555 12 34".
  const usedEndings = new Set<number>(
    [...Object.values(demoChatPeople), ...demoNewcomers, ...initialEmployees].map((person) => Number(person.phone.replace(/\D/g, '').slice(-4))),
  );
  for (const group of NAME_GROUPS) {
    (['woman', 'man', 'child'] as const).forEach((kind, kindIndex) => {
      const firstNames = kind === 'woman' ? group.women : kind === 'man' ? group.men : group.children;
      for (let index = 0; index < group.counts[kindIndex]; index++) {
        // Walking through both lists at different speeds pairs each first name with other surnames.
        const firstName = firstNames[index % firstNames.length];
        const surname = group.surnames[(index * 5 + kindIndex * 3) % group.surnames.length];
        const name = `${firstName} ${surname}`;
        const id = `cust-${String(pool.length + 1).padStart(3, '0')}`;
        let ending = 100 + (numberFor(`${id}:phone`) % 9800);
        while (usedEndings.has(ending) || usedEndings.has(ending - 1) || usedEndings.has(ending + 1)) ending = 100 + ((ending + 37) % 9800);
        usedEndings.add(ending);
        const digits = String(ending).padStart(4, '0');
        const prefix = chooseWeighted(`${id}:prefix`, [['79', 8], ['78', 5], ['76', 5], ['77', 2]] as const);
        const speaksGerman = group.germanShare !== undefined && numberFor(`${id}:language`) % 100 < group.germanShare;
        pool.push({
          id,
          name,
          kind,
          language: speaksGerman ? 'DE' : group.language,
          phone: `+41${prefix}555${digits}`,
          // Most customers never gave an e-mail address; children have none.
          email: kind !== 'child' && numberFor(`${id}:email`) % 8 === 0
            ? `${plainLetters(firstName)}.${plainLetters(surname)}@example.com` : '',
        });
      }
    });
  }
  return pool;
};

let cachedPool: PoolPerson[] | null = null;
/** The pool never changes, so it is built once per page load. */
const demoPool = (): PoolPerson[] => (cachedPool ??= buildPool());

/** All invented people the seed can use: the chat people first, the newcomers last. For tests and for picking fresh names. */
export const demoPeople = (): DemoPerson[] => [
  ...Object.values(demoChatPeople),
  ...demoPool().map(({ kind: _kind, ...person }) => person),
  ...demoNewcomers,
];

// ---------- habits: who comes how often, to whom, for what ----------

interface Habit {
  serviceId: string;
  /** Weeks between two visits. */
  intervalWeeks: number;
  /** Which of those weeks: a visit falls in every week whose number plus this is a multiple of the interval. */
  phase: number;
  employeeId: string;
  weekday: number;
  /** Usual start, in minutes of the day. */
  start: number;
  /** A standing appointment (wash and blow-dry every week or two) is booked a month ahead. */
  standing: boolean;
  /** Books through the chat assistant where the service can be booked online. */
  usesChat: boolean;
}

/** The hours of a stylist's regular week, to the full hour: who works more has more customers. Anna 40, Selina 34, Luca 24. */
const weeklyHoursOf = (employeeId: string): number => Math.round(
  workdaysOf(employeeId).reduce((minutes, weekday) => {
    const hours = regularHours(employeeId, weekday)!;
    return minutes + toMinutes(hours.end) - toMinutes(hours.start);
  }, 0) / 60,
);
// How customers spread over a stylist's working days. Friday and Saturday are the busiest days
// all the same, because all three stylists work then.
const DAY_WEIGHT: Record<number, number> = { 2: 22, 3: 19, 4: 20, 5: 20, 6: 21 };

const habitOf = (person: PoolPerson): Omit<Habit, 'phase'> => {
  const key = person.id;
  const [serviceId, intervals] = person.kind === 'child'
    ? ['srv-6', [6, 8, 10]] as const
    : person.kind === 'man'
      ? chooseWeighted(`${key}:service`, [[['srv-5', [3, 3, 4, 4, 5]], 88], [['srv-2', [4, 5, 6]], 12]] as const)
      : chooseWeighted(`${key}:service`, [
          [['srv-1', [1, 2, 2]], 8],
          [['srv-2', [4, 5, 5, 6, 6, 7]], 22],
          [['srv-4', [4, 5, 5, 6, 6, 7]], 34],
          [['srv-7', [4, 5, 6]], 14],
          [['srv-3', [6, 7, 8]], 11],
          [['srv-8', [10, 12]], 6],
          [['srv-9', [12, 16]], 3],
          [['srv-10', [16]], 2],
        ] as const);
  const service = serviceById(serviceId);
  const intervalWeeks = choose(`${key}:interval`, intervals);
  const employeeId = chooseWeighted(`${key}:stylist`, (service.assignedEmployeeIds ?? []).map((id) => [id, weeklyHoursOf(id) || 20] as const));
  const weekday = chooseWeighted(`${key}:weekday`, workdaysOf(employeeId).map((day) => [day, DAY_WEIGHT[day] ?? 10] as const));
  // Any half hour of that stylist's day that leaves room for the whole service.
  // Children come after school, except on Saturdays.
  const usualDay = windowOnWeekday(employeeId, weekday)!;
  const earliest = person.kind === 'child' && weekday !== 6 ? Math.max(usualDay.start, 13 * 60 + 30) : usualDay.start;
  const possibleStarts = Math.max(1, Math.floor((usualDay.end - earliest - service.durationMinutes) / 30) + 1);
  return {
    serviceId, intervalWeeks, employeeId, weekday,
    start: earliest + 30 * (numberFor(`${key}:time`) % possibleStarts),
    standing: serviceId === 'srv-1',
    usesChat: numberFor(`${key}:chat`) % 100 < 38,
  };
};

let cachedHabits: Map<string, Habit> | null = null;
/**
 * Everybody's habit. People with the same rhythm take turns: of twelve who come every four
 * weeks, three come each week. Within a rhythm they are counted off weekday by weekday, so the
 * Tuesday customers are spread over the weeks as evenly as everybody together. That keeps every
 * week about equally busy and no weekday suddenly empty.
 */
const demoHabits = (): Map<string, Habit> => {
  if (cachedHabits) return cachedHabits;
  const sameRhythm = new Map<number, { person: PoolPerson; habit: Omit<Habit, 'phase'> }[]>();
  for (const person of demoPool()) {
    const habit = habitOf(person);
    const list = sameRhythm.get(habit.intervalWeeks) ?? [];
    list.push({ person, habit });
    sameRhythm.set(habit.intervalWeeks, list);
  }
  const habits = new Map<string, Habit>();
  for (const [intervalWeeks, list] of sameRhythm) {
    // Each rhythm starts counting in another week; otherwise the odd ones out would all meet in the same week.
    const firstWeek = numberFor(`rhythm:${intervalWeeks}`);
    [...list].sort((a, b) => a.habit.weekday - b.habit.weekday || a.person.id.localeCompare(b.person.id))
      .forEach(({ person, habit }, position) => habits.set(person.id, { ...habit, phase: (position + firstWeek) % intervalWeeks }));
  }
  cachedHabits = habits;
  return habits;
};

// ---------- the moments and dates everything else hangs on ----------

/**
 * When the sample chats were written and which appointments they are about, for a given "now".
 *
 * Four chats are from today (minutes or hours ago) and two from last evening; none is ever in
 * the future. A chat that names a weekday means the first such day after the day it was written,
 * so the appointment in the calendar is on the weekday the chat mentions, whatever day it is.
 * All dates depend on today's date only: every tab opened today shows the same calendar.
 */
export const demoTimeline = (timeZone?: string, now = new Date()) => {
  const today = getSalonNow(timeZone, now).date;
  const yesterday = addDays(today, -1);
  // "Three hours ago" would be yesterday when it is one o'clock at night. In the first hours of
  // the day the spans are shortened in proportion, so today's chats stay chats of today.
  const longestSpan = 186;
  const sinceMidnight = Math.max(0, Math.floor((now.getTime() - salonInstant(today, '00:00', timeZone).getTime()) / 60_000));
  const ago = (...minutes: number[]) => minutes.map((value) =>
    new Date(now.getTime() - Math.min(value, Math.floor(value * sinceMidnight / longestSpan)) * 60_000));
  const lastEvening = (...times: string[]) => times.map((time) => salonInstant(yesterday, time, timeZone));
  return {
    today,
    sent: {
      camille: ago(14, 13, 6),
      chloe: ago(42),
      giulia: ago(95),
      marie: ago(longestSpan, longestSpan, 181, 180),
      lea: lastEvening('21:12', '21:12', '21:14', '21:14'),
      john: lastEvening('17:40', '17:40', '17:42', '17:42'),
    },
    /** Appointments that already exist because of a chat (ids cal-2, cal-3, cal-john, cal-giulia). */
    booked: {
      marie: { date: upcomingWeekday(4, today), start: '13:30' },     // "Thursday 13:30", booked this morning
      lea: { date: upcomingWeekday(5, yesterday), start: '11:00' },   // "Friday 11:00", booked last evening
      john: { date: upcomingWeekday(3, yesterday), start: '15:00' },  // "Wednesday at 15:00", booked last evening
      giulia: { date: upcomingWeekday(4, today), start: '15:00' },    // the one she asks to move
    },
    /** Times the chats offer or book later; the calendar keeps them free. */
    open: {
      camille: { date: upcomingWeekday(5, today), start: '11:00' },   // colouring on "Friday"
      giulia: { date: upcomingWeekday(6, today), start: '10:00', alternative: '11:30' }, // move to "Saturday"
      chloe: { date: upcomingWeekday(5, today), start: '18:00' },     // the last time on "Friday"
    },
  };
};

/**
 * The two pending requests on Home: never for today (a request for today would expire while
 * the owner looks at it), on two different days, with two stylists, mid-morning and afternoon.
 * Both come in over the web, like the sample chats: no request claims a channel that is not connected.
 */
export const demoRequestPlan = (today: string) => {
  const nextWorkday = (employeeId: string, after: string) => {
    for (let date = addDays(after, 1), tries = 0; tries < 14; date = addDays(date, 1), tries++) {
      if (workingWindow(employeeId, date)) return date;
    }
    return addDays(after, 1);
  };
  const fit = (employeeId: string, date: string, wanted: string, minutes: number) => {
    const window = workingWindow(employeeId, date);
    if (!window) return wanted;
    return toTime(Math.min(Math.max(toMinutes(wanted), window.start), window.end - minutes));
  };
  const firstDate = nextWorkday('emp-2', today);
  const secondDate = nextWorkday('emp-1', firstDate);
  return [
    { id: 'req-1', serviceId: 'srv-1', employeeId: 'emp-2', date: firstDate, start: fit('emp-2', firstDate, '09:30', 30), minutesAgo: 12, channel: 'Web' as const },
    // On Saturdays the owner works until 14:00, so the afternoon request moves to 13:00.
    { id: 'req-2', serviceId: 'srv-2', employeeId: 'emp-1', date: secondDate, start: fit('emp-1', secondDate, weekdayOf(secondDate) === 6 ? '13:00' : '14:30', 30), minutesAgo: 47, channel: 'Web' as const },
  ];
};

// ---------- appointments ----------

interface Slot { employeeId: string; date: string; start: number; end: number }

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && a.end > b.start;

// The same dates come up hundreds of times: each is written out ("Thu 19.11.") once.
const dateLabels = new Map<string, string>();
const dateLabel = (date: string): string => {
  let label = dateLabels.get(date);
  if (label === undefined) {
    label = formatCalendarDate(date);
    dateLabels.set(date, label);
  }
  return label;
};

const buildEvent = (
  id: string, person: DemoPerson, serviceId: string, employeeId: string, date: string, start: number,
  createdAt: Date, extra: Partial<CalendarEvent> = {},
): CalendarEvent => {
  const service = serviceById(serviceId);
  const employee = employeeById(employeeId);
  return {
    id,
    serviceId,
    employeeId,
    customerId: person.id,
    customerName: person.name,
    customerPhone: person.phone || undefined,
    serviceName: service.name,
    staffName: employee.name,
    date,
    day: dayKeyForDate(date),
    dateDisplay: dateLabel(date),
    startTime: toTime(start),
    endTime: toTime(start + service.durationMinutes),
    // One colour per stylist, so a glance at the week shows who works when.
    colorTheme: employeeId === 'emp-1' ? 'purple' : employeeId === 'emp-2' ? 'green' : 'blue',
    isAiBooked: false,
    prepMinutes: service.prepMinutes ?? 0,
    postMinutes: service.postMinutes ?? 0,
    createdAt: createdAt.toISOString(),
    ...extra,
  };
};

/**
 * All appointments from eight weeks back to three weeks ahead, about forty in a full week.
 *
 * Each customer follows a habit (for example a men's cut every four weeks, Fridays with Luca).
 * Bookings are made some days before the visit, so the weeks ahead are only partly filled yet.
 * Appointments never overlap for a stylist, lie inside their working hours and the opening hours, and on
 * days with two or more stylists on duty one of them always stays free, so a new request for
 * tomorrow can be accepted. The times that the sample chats and pending requests are about stay free.
 * Sorted with the newest booking first, as the app adds new bookings to the top of the list.
 */
export const createDemoEvents = (timeZone?: string, now = new Date()): CalendarEvent[] => {
  const timeline = demoTimeline(timeZone, now);
  const { today } = timeline;
  const window = demoWindow(today);
  const people = demoChatPeople;
  // Turning a salon date and time into a moment asks the time zone database, which is slow.
  // The zone's distance to UTC is the same all day here (nothing is booked in the small hours
  // of a clock change), so it is looked up once per date.
  const utcDistance = new Map<string, number>();
  const at = (date: string, time: string): Date => {
    let distance = utcDistance.get(date);
    if (distance === undefined) {
      distance = salonInstant(date, '12:00', timeZone).getTime() - Date.parse(`${date}T12:00:00Z`);
      utcDistance.set(date, distance);
    }
    return new Date(Date.parse(`${date}T${time}:00Z`) + distance);
  };

  // 1. Appointments placed by hand: the ones the chats are about, and earlier visits of the same people.
  const weeksAgo = (weeks: number, weekday: number) => addDays(startOfWeek(today), -7 * weeks + weekday - 1);
  const fixed: CalendarEvent[] = [
    buildEvent('cal-2', people.marie, 'srv-2', 'emp-1', timeline.booked.marie.date, toMinutes(timeline.booked.marie.start),
      timeline.sent.marie[3], { isAiBooked: true, conversationId: 'conv-marie' }),
    buildEvent('cal-3', people.lea, 'srv-3', 'emp-2', timeline.booked.lea.date, toMinutes(timeline.booked.lea.start),
      timeline.sent.lea[3], { isAiBooked: true, conversationId: 'conv-lea' }),
    buildEvent('cal-john', people.john, 'srv-2', 'emp-1', timeline.booked.john.date, toMinutes(timeline.booked.john.start),
      timeline.sent.john[3], { isAiBooked: true, conversationId: 'conv-john' }),
    buildEvent('cal-giulia', people.giulia, 'srv-2', 'emp-2', timeline.booked.giulia.date, toMinutes(timeline.booked.giulia.start),
      at(addDays(today, -9), '16:20'), { conversationId: 'conv-giulia' }),
    buildEvent('cal-marie-earlier', people.marie, 'srv-2', 'emp-1', weeksAgo(6, 4), toMinutes('14:00'), at(weeksAgo(8, 4), '10:40')),
    buildEvent('cal-lea-earlier', people.lea, 'srv-3', 'emp-2', weeksAgo(7, 5), toMinutes('09:30'), at(weeksAgo(8, 3), '14:05')),
    buildEvent('cal-chloe-earlier', people.chloe, 'srv-4', 'emp-1', weeksAgo(4, 5), toMinutes('17:00'), at(weeksAgo(5, 5), '11:30')),
    buildEvent('cal-giulia-earlier', people.giulia, 'srv-2', 'emp-2', weeksAgo(5, 4), toMinutes('15:00'), at(weeksAgo(6, 6), '09:15')),
    buildEvent('cal-john-earlier', people.john, 'srv-2', 'emp-1', weeksAgo(5, 3), toMinutes('16:00'), at(weeksAgo(6, 3), '12:20')),
  ];

  // 2. Times that must stay free: the chats and the pending requests book or offer them.
  // A pending request already holds its stylist; a time a chat only offers does not yet.
  const requested: Slot[] = demoRequestPlan(today).map((request) => ({
    employeeId: request.employeeId, date: request.date, start: toMinutes(request.start),
    end: toMinutes(request.start) + serviceById(request.serviceId).durationMinutes,
  }));
  const keepFree: Slot[] = [
    { employeeId: 'emp-1', date: timeline.open.camille.date, start: toMinutes(timeline.open.camille.start), end: toMinutes(timeline.open.camille.start) + 90 },
    { employeeId: 'emp-2', date: timeline.open.giulia.date, start: toMinutes(timeline.open.giulia.start), end: toMinutes(timeline.open.giulia.start) + 30 },
    { employeeId: 'emp-2', date: timeline.open.giulia.date, start: toMinutes(timeline.open.giulia.alternative), end: toMinutes(timeline.open.giulia.alternative) + 30 },
    { employeeId: 'emp-1', date: timeline.open.chloe.date, start: toMinutes(timeline.open.chloe.start), end: toMinutes(timeline.open.chloe.start) + 30 },
    ...requested,
  ];

  // Taken minutes per stylist and day.
  const taken = new Map<string, { start: number; end: number }[]>();
  const takenOn = (employeeId: string, date: string) => {
    const key = `${employeeId}|${date}`;
    let list = taken.get(key);
    if (!list) { list = []; taken.set(key, list); }
    return list;
  };
  for (const event of fixed) takenOn(event.employeeId!, event.date).push({ start: toMinutes(event.startTime), end: toMinutes(event.endTime) });

  const isFree = (employeeId: string, date: string, slot: { start: number; end: number }) =>
    !takenOn(employeeId, date).some((other) => overlaps(slot, other)) &&
    !requested.some((request) => request.employeeId === employeeId && request.date === date && overlaps(slot, request));

  /** True if this stylist can take the appointment and the salon still has somebody free meanwhile. */
  const canPlace = (employeeId: string, date: string, slot: { start: number; end: number }) => {
    const working = workingWindow(employeeId, date);
    if (!working || slot.start < working.start || slot.end > working.end) return false;
    if (!isFree(employeeId, date, slot)) return false;
    if (keepFree.some((reserved) => reserved.employeeId === employeeId && reserved.date === date && overlaps(slot, reserved))) return false;
    for (let minute = slot.start; minute < slot.end; minute += 30) {
      const half = { start: minute, end: minute + 30 };
      const onDuty = initialEmployees.filter((other) => {
        const otherWindow = workingWindow(other.id, date);
        return otherWindow !== null && otherWindow.start <= half.start && otherWindow.end >= half.end;
      });
      if (onDuty.length >= 2 && !onDuty.some((other) => other.id !== employeeId && isFree(other.id, date, half))) return false;
    }
    return true;
  };

  // 3. Everybody else, week by week, from their habits.
  const visits: { person: PoolPerson; habit: Habit; date: string; start: number; week: number }[] = [];
  for (let weekStart = window.from; weekStart <= window.to; weekStart = addDays(weekStart, 7)) {
    const week = Math.round(daysBetween('1970-01-05', weekStart) / 7);
    for (const person of demoPool()) {
      const habit = demoHabits().get(person.id)!;
      if ((week + habit.phase) % habit.intervalWeeks !== 0) continue;
      const visitKey = `${person.id}:${week}`;
      // Usually the same weekday and about the same time; now and then another of the stylist's days.
      const weekday = !habit.standing && numberFor(`${visitKey}:day`) % 8 === 0
        ? choose(`${visitKey}:otherday`, workdaysOf(habit.employeeId)) : habit.weekday;
      const shift = habit.standing ? 0 : 30 * ((numberFor(`${visitKey}:shift`) % 5) - 2);
      visits.push({ person, habit, date: addDays(weekStart, weekday - 1), start: habit.start + shift, week });
    }
  }
  visits.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.person.id.localeCompare(b.person.id));

  const generated: CalendarEvent[] = [];
  for (const visit of visits) {
    const { person, habit, date } = visit;
    const service = serviceById(habit.serviceId);
    const visitKey = `${person.id}:${visit.week}`;
    // A booking is made some days before the visit; one that nobody has made yet does not exist.
    const leadDays = habit.standing ? 28 : chooseWeighted(`${visitKey}:lead`,
      [[1, 4], [2, 4], [3, 5], [5, 8], [7, 11], [10, 12], [14, 14], [21, 14], [28, 14], [35, 14]] as const);
    let bookedOn = addDays(date, -leadDays);
    if (bookedOn >= today) continue;
    const viaChat = habit.usesChat && service.onlineBooking && !habit.standing;
    // The owner enters bookings while the salon is open; the chat assistant also books in the evening and on closed days.
    if (!viaChat) while (!openingOn(bookedOn)) bookedOn = addDays(bookedOn, -1);
    const bookedAt = viaChat
      ? toTime(7 * 60 + (numberFor(`${visitKey}:bookedat`) % 930))
      : toTime(8 * 60 + 45 + (numberFor(`${visitKey}:bookedat`) % 420));

    // The usual stylist first, then a colleague who offers the service and works that day.
    const stylists = [habit.employeeId, ...(service.assignedEmployeeIds ?? []).filter((id) => id !== habit.employeeId)];
    let placed: { employeeId: string; start: number } | null = null;
    for (const employeeId of stylists) {
      const dayWindow = workingWindow(employeeId, date);
      if (!dayWindow) continue;
      const wanted = Math.min(Math.max(visit.start, dayWindow.start), dayWindow.end - service.durationMinutes);
      // Nearest free start to the wanted one, in half-hour steps.
      for (let step = 0; step <= 20 && !placed; step++) {
        for (const start of step === 0 ? [wanted] : [wanted + 30 * step, wanted - 30 * step]) {
          if (canPlace(employeeId, date, { start, end: start + service.durationMinutes })) { placed = { employeeId, start }; break; }
        }
      }
      if (placed) break;
    }
    if (!placed) continue; // a full day: this customer comes next time
    takenOn(placed.employeeId, date).push({ start: placed.start, end: placed.start + service.durationMinutes });
    const compactDate = date.replace(/-/g, '');
    generated.push(buildEvent(
      `cal-${compactDate}-${placed.employeeId.replace('emp-', 'e')}-${toTime(placed.start).replace(':', '')}`,
      person, service.id, placed.employeeId, date, placed.start, at(bookedOn, bookedAt), { isAiBooked: viaChat },
    ));
  }

  return [...fixed, ...generated].sort((a, b) => b.createdAt!.localeCompare(a.createdAt!) || a.id.localeCompare(b.id));
};

// ---------- customers ----------

/**
 * The two customers behind the pending requests on Home: regulars who have been to the salon
 * and have nothing booked at the moment.
 */
export const demoRequesters = (events: CalendarEvent[], today: string): [DemoPerson, DemoPerson] => {
  const recent = addDays(today, -10);
  const candidates = demoPool().filter((person) => {
    const own = events.filter((event) => event.customerId === person.id);
    return person.kind !== 'child' && own.length > 0 && own.every((event) => event.date < recent);
  });
  const first = candidates.find((person) => person.kind === 'woman') ?? demoPool()[0];
  const second = candidates.find((person) => person.id !== first.id) ?? demoPool()[1];
  const plain = ({ kind: _kind, ...person }: PoolPerson): DemoPerson => person;
  return [plain(first), plain(second)];
};

const customerFrom = (person: DemoPerson, extra: Partial<Customer> = {}): Customer => ({
  id: person.id,
  name: person.name,
  initials: person.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
  email: person.email,
  phone: person.phone,
  language: person.language,
  ...extra,
});

/**
 * The customer list: everybody who has an appointment in the calendar, the people of the sample
 * chats and the two who sent a request. Ordered with the most recent contact first.
 * Visit counts are not part of the record; the customer list counts them from the calendar.
 */
export const createDemoCustomers = (
  timeZone?: string, now = new Date(), events: CalendarEvent[] = createDemoEvents(timeZone, now),
): Customer[] => {
  const timeline = demoTimeline(timeZone, now);
  const lastContact = new Map<string, string>();
  const note = (id: string, moment: string) => {
    if (!lastContact.has(id) || lastContact.get(id)! < moment) lastContact.set(id, moment);
  };
  for (const event of events) if (event.customerId && event.createdAt) note(event.customerId, event.createdAt);

  const customers = (Object.keys(demoChatPeople) as ChatPerson[]).map((key) =>
    customerFrom(demoChatPeople[key], { channel: DEMO_CHAT_CHANNEL, conversationId: `conv-${key}` }));
  note(demoChatPeople.lea.id, timeline.sent.lea[3].toISOString());
  note(demoChatPeople.john.id, timeline.sent.john[3].toISOString());
  // Whoever wrote or sent a request today comes first, in a fixed order: the list must not
  // depend on the minute at which the tab was opened.
  const requesters = demoRequesters(events, timeline.today);
  const todaysContacts = [demoChatPeople.camille, requesters[0], demoChatPeople.chloe, requesters[1], demoChatPeople.giulia, demoChatPeople.marie];
  todaysContacts.forEach((person, index) => lastContact.set(person.id, `${timeline.today}T99:${String(59 - index).padStart(2, '0')}`));
  for (const person of demoPool()) {
    if (lastContact.has(person.id)) customers.push(customerFrom(person));
  }
  return customers.sort((a, b) => lastContact.get(b.id)!.localeCompare(lastContact.get(a.id)!) || a.id.localeCompare(b.id));
};

/**
 * An invented person who is not in the given list yet, for a request from somebody new: the
 * next newcomer, then anybody else who has no appointment at the moment. Returns null when
 * everybody is already a customer.
 */
export const unusedDemoPerson = (customers: Pick<Customer, 'id' | 'name'>[]): DemoPerson | null => {
  const isNew = (person: DemoPerson) => !customers.some((customer) => customer.id === person.id || customer.name === person.name);
  return demoNewcomers.find(isNew) ?? demoPeople().find(isNew) ?? null;
};
