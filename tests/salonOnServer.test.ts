/**
 * "The salon as it is now" (delivery 3B, contract point 4): the record's parts over the built-in
 * salon, read with the chat wherever a customer's message is handled. The AI's instructions, the
 * check of a booking request and the fixed messages follow what the owner saved, from the next
 * message on, and knowing it costs a message no storage command more. The AI and the messengers
 * are stand-ins; the clock stands on Monday 5 October 2026, noon in Zurich.
 */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PUT as putSalon } from '../api/salon';
import { POST as writeChat } from '../api/chat';
import { POST as telegramWebhook } from '../api/telegram/webhook';
import { POST as act } from '../api/whatsapp/action';
import { POST as whatsappWebhook } from '../api/whatsapp/webhook';
import { salonContext } from '../server/ai';
import { checkBookingRequest, type BookingCheck } from '../server/bookingRules';
import { BUILT_IN_SALON, salonFromRecord, type Salon } from '../server/salon';
import { COUNT_SCRIPT } from '../server/store';
import { chatBookingMessage } from '../src/chatTemplates';
import { initialAiSettings } from '../src/conversationData';
import { chatDeletedNotice } from '../src/customerNotice';
import { initialBookingHours, initialCompanySettings, initialEmployees, initialServices } from '../src/mockData';
import { type Command, deployedWith, FakeStore } from './fakeStore';
import {
  bookingAnswer, chatRequest, freezeClock, liveChat, NOW, outsideWorld, ownerAction, putChat, quietly, SESSION, SETTINGS, storedChat,
  telegramUpdate, whatsappMessage, WHATSAPP_NUMBER, type World,
} from './liveChatHarness';

const SALON_KEY = 'slotbee:live:salon';
const WEB = `web-${SESSION}`;
const at = new Date(NOW);

/** The built-in salon with some parts changed, as the owner would save them. */
const changed = (parts: Partial<Salon>): Salon => salonFromRecord({ rev: 1, parts });
const servicesWith = (id: string, change: Partial<Salon['services'][number]>) => initialServices.map(item => item.id === id ? { ...item, ...change } : item);
const hoursWith = (day: string, change: Partial<Salon['bookingHours'][number]>) => initialBookingHours.map(item => item.day === day ? { ...item, ...change } : item);
const peopleWith = (id: string, change: Partial<Salon['employees'][number]> | null) =>
  initialEmployees.flatMap(item => item.id !== id ? [item] : change === null ? [] : [{ ...item, ...change }]);
const rosa = { ...initialCompanySettings, companyName: 'Salon Rosa', street: 'Marktgasse 1', businessPhone: '+41 71 555 00 00' };

/** Puts a record into the storage as a saved change of the owner would leave it. */
const putRecord = (store: FakeStore, parts: Partial<Salon>, rev = 1) =>
  store.run(['SET', SALON_KEY, JSON.stringify({ rev, updatedAt: at.toISOString(), parts })]);

/** Everything the AI is told before the conversation: the system instruction of each call to the model. */
const withInstructions = (world: World) => {
  const instructions: string[] = [];
  const texts = (value: unknown): string[] => typeof value === 'string' ? [value]
    : Array.isArray(value) ? value.flatMap(texts)
    : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => key === 'text' || typeof item === 'object' ? texts(item) : []) : [];
  const outside = async (url: string, body: string) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      const parsed = JSON.parse(body) as { systemInstruction?: unknown; config?: { systemInstruction?: unknown } };
      instructions.push(texts(parsed.systemInstruction ?? parsed.config?.systemInstruction).join('\n'));
    }
    return world.outside(url, body);
  };
  return { instructions, outside };
};

const run = (store: FakeStore, outside: World['outside'], work: () => Promise<unknown>) =>
  quietly(() => deployedWith(SETTINGS, work, { store, outside }));
const post = (text: string) => chatRequest('POST', { body: { session: SESSION, name: 'Eva', text } });
const reasonOf = (check: BookingCheck) => check.ok ? '' : check.reason;
const ask = (salon: Salon, request: Record<string, string>) =>
  checkBookingRequest({ service: 'Haircut', date: '2026-10-06', time: '10:00', customerName: 'Eva', ...request }, at, salon);

// ---------- the salon as it is now ----------

test('the salon as it is now: a part from the record, every other part built in', () => {
  const salon = salonFromRecord({ rev: 3, parts: { services: servicesWith('srv-2', { priceCHF: 49 }), companySettings: rosa } });
  assert.equal(salon.services.find(item => item.id === 'srv-2')!.priceCHF, 49);
  assert.equal(salon.companySettings.companyName, 'Salon Rosa');
  assert.equal(salon.employees, initialEmployees);
  assert.equal(salon.bookingHours, initialBookingHours);
  assert.equal(salon.aiSettings, initialAiSettings);
  assert.deepEqual([salon.closedDates, salon.absences, salon.shifts], [[], [], []]);
  // No record: exactly the built-in salon, which nothing can change by accident.
  assert.deepEqual(salonFromRecord(null), BUILT_IN_SALON);
  assert.ok(Object.isFrozen(BUILT_IN_SALON));
  // Without a salon the instructions are those of the built-in one, as before this delivery.
  assert.equal(salonContext(), salonContext(BUILT_IN_SALON));
});

// ---------- the AI's instructions ----------

test('the AI\'s instructions follow a changed price, a renamed service and a service taken off online booking', () => {
  const price = salonContext(changed({ services: servicesWith('srv-2', { priceCHF: 49 }) }), at);
  assert.match(price, /- Haircut: 30 min, CHF 49\.00\./);
  assert.doesNotMatch(price, /CHF 55\.00/);
  const renamed = salonContext(changed({ services: servicesWith('srv-2', { name: 'Ladies\' cut' }) }), at);
  assert.match(renamed, /- Ladies' cut: 30 min, CHF 55\.00\./);
  assert.doesNotMatch(renamed, /- Haircut:/);
  const offline = salonContext(changed({ services: servicesWith('srv-2', { onlineBooking: false }) }), at);
  assert.match(offline, /- Haircut: .* Latest start [^\n]*\. The owner books this one personally: collect the request, then hand over\./);
  // Built in, Haircut is booked online.
  assert.doesNotMatch(salonContext(BUILT_IN_SALON, at), /- Haircut: [^\n]*personally/);
});

test('the AI\'s instructions follow changed opening hours, with the latest start for each service', () => {
  const context = salonContext(changed({ bookingHours: hoursWith('Friday', { to: '17:00' }) }), at);
  assert.match(context, /- Friday: 08:30–17:00/);
  assert.match(context, /- Haircut: .* Latest start 18:00 \(Tuesday to Thursday\), 16:30 \(Friday\), 15:30 \(Saturday\)\./);
  const monday = salonContext(changed({ bookingHours: hoursWith('Monday', { isOpen: true }) }), at);
  assert.match(monday, /- Monday: 08:30–18:30/);
});

test('the AI is told the closed dates that lie ahead, with their names, and none that are over', () => {
  const context = salonContext(changed({ closedDates: [
    { id: 'c1', name: 'Summer break', start: '2026-08-01', end: '2026-08-14' },
    { id: 'c3', name: 'Christmas', start: '2026-12-24', end: '2026-12-26' },
    { id: 'c2', name: 'Training\nday', start: '2026-10-08', end: '2026-10-08' },
  ] }), at);
  assert.match(context, /CLOSED DATES \(the salon is closed all day; no appointments on these days\):\n- Thursday, 08\.10\.2026: Training day\n- Thursday, 24\.12\.2026 to Saturday, 26\.12\.2026: Christmas\n/);
  assert.doesNotMatch(context, /Summer break/);
  // Without closed dates ahead there is no such section, as before.
  assert.doesNotMatch(salonContext(BUILT_IN_SALON, at), /CLOSED DATES/);
  assert.doesNotMatch(salonContext(changed({ closedDates: [{ id: 'c1', name: 'Summer break', start: '2026-08-01', end: '2026-08-14' }] }), at), /CLOSED DATES/);
});

test('the AI is told the team as it is: a person removed or made inactive is gone, and who offers which service', () => {
  assert.match(salonContext(BUILT_IN_SALON, at), /Three stylists work at the salon: Anna, Selina and Luca\./);
  // Colour work is done by the two senior stylists only: the AI must not offer Luca for it.
  assert.match(salonContext(BUILT_IN_SALON, at), /- Colouring: [^\n]* Done by Anna and Selina only\. Latest start/);
  assert.match(salonContext(BUILT_IN_SALON, at), /- Balayage: [^\n]* Done by Anna only\. Latest start/);
  assert.doesNotMatch(salonContext(BUILT_IN_SALON, at), /- Haircut: [^\n]*Done by/);
  const removed = salonContext(changed({ employees: peopleWith('emp-3', null) }), at);
  assert.match(removed, /Two stylists work at the salon: Anna and Selina\./);
  assert.doesNotMatch(removed, /Luca/);
  const inactive = salonContext(changed({ employees: peopleWith('emp-2', { status: 'Inactive' }) }), at);
  assert.match(inactive, /Two stylists work at the salon: Anna and Luca\./);
  assert.match(inactive, /- Colouring: [^\n]* Done by Anna only\./);
  assert.doesNotMatch(inactive, /Selina/);
  const nobody = salonContext(changed({ services: servicesWith('srv-10', { assignedEmployeeIds: [], assignedEmployeesCount: 0 }) }), at);
  assert.match(nobody, /- Updo: [^\n]* No stylist offers it at the moment: collect the request, then hand over\./);
});

test('the AI is told the salon\'s name, street, town and phone as saved, and its tone and handover rules', () => {
  const context = salonContext(changed({
    companySettings: { ...rosa, city: 'Rorschach', postalCode: '9400' },
    aiSettings: { ...initialAiSettings, tone: 'formal', handoverRules: [{ id: 'r1', label: 'Gift vouchers', enabled: true }, { id: 'r2', label: 'Discounts and price changes', enabled: false }] },
  }), at);
  assert.match(context, /\nSALON: Salon Rosa, a small hair salon at Marktgasse 1, 9400 Rorschach\. Salon phone: \+41 71 555 00 00\.\n/);
  // The tone is an instruction, so it stands outside the salon's data.
  assert.match(context, /^You are the booking assistant of the hair salon described in the salon data below\. Your tone is polite and formal/);
  assert.match(context, /- Gift vouchers\n/);
  assert.doesNotMatch(context, /Bella Hair Salon|Discounts and price changes|St\. Gallen/);
  // The built-in salon has no phone line: no phone sentence.
  assert.doesNotMatch(salonContext(BUILT_IN_SALON, at), /Salon phone/);
});

test('a website message: the AI is told the salon as saved, and a change saved meanwhile holds for the next message', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const world = outsideWorld();
  const { instructions, outside } = withInstructions(world);
  await run(store, outside, async () => {
    await writeChat(post('Hello'));
    const saved = await putSalon(new Request('https://site.invalid/api/salon', {
      method: 'PUT', headers: { 'x-live-key': 'right-key' },
      body: JSON.stringify({ baseRev: 0, parts: { companySettings: rosa, services: servicesWith('srv-2', { priceCHF: 49 }) } }),
    }));
    assert.equal(saved.status, 200);
    await writeChat(post('How much is a haircut?'));
  });
  assert.equal(instructions.length, 2);
  assert.match(instructions[0], /SALON: Bella Hair Salon,/);
  assert.match(instructions[0], /- Haircut: 30 min, CHF 55\.00\./);
  assert.match(instructions[1], /SALON: Salon Rosa,/);
  assert.match(instructions[1], /- Haircut: 30 min, CHF 49\.00\./);
});

// ---------- the check of a booking request ----------

test('the booking check follows a renamed service, by its name and by its id', () => {
  const salon = changed({ services: servicesWith('srv-2', { name: 'Ladies\' cut' }) });
  assert.equal(reasonOf(ask(salon, {})), '"Haircut" is not one of the salon\'s services');
  const check = ask(salon, { service: 'ladies\' cut' });
  assert.ok(check.ok);
  assert.deepEqual([check.request.service, check.request.serviceId], ['Ladies\' cut', 'srv-2']);
  // A request that carries the id still finds the service after the rename.
  const byId = checkBookingRequest({ service: 'Haircut', serviceId: 'srv-2', date: '2026-10-06', time: '10:00', customerName: 'Eva' }, at, salon);
  assert.ok(byId.ok && byId.request.service === 'Ladies\' cut');
  // A service that was removed is no service any more.
  assert.equal(reasonOf(ask(changed({ services: initialServices.filter(item => item.id !== 'srv-2') }), {})), '"Haircut" is not one of the salon\'s services');
});

test('the booking check follows a service taken off online booking, and a changed price changes nothing in it', () => {
  const offline = ask(changed({ services: servicesWith('srv-2', { onlineBooking: false }) }), {});
  assert.ok(offline.ok && offline.ownerOnly);
  const builtIn = ask(BUILT_IN_SALON, {});
  assert.ok(builtIn.ok && !builtIn.ownerOnly);
  assert.deepEqual(ask(changed({ services: servicesWith('srv-2', { priceCHF: 49 }) }), {}), builtIn);
});

test('the booking check follows a changed closing time, the latest start for the service\'s length, and a day that opened', () => {
  const salon = changed({ bookingHours: hoursWith('Tuesday', { to: '17:00' }) });
  assert.equal(reasonOf(ask(salon, { time: '17:00' })), 'Haircut at 17:00 does not fit into the opening hours on Tuesdays (08:30–17:00)');
  assert.ok(ask(salon, { time: '16:30' }).ok);
  assert.equal(reasonOf(ask(salon, { service: 'Cut & blow-dry', time: '16:30' })), 'Cut & blow-dry at 16:30 does not fit into the opening hours on Tuesdays (08:30–17:00)');
  // Built in, Tuesday closes at 18:30.
  assert.ok(ask(BUILT_IN_SALON, { time: '17:00' }).ok);
  // Monday is closed built in; opened, it can be booked.
  assert.equal(reasonOf(ask(BUILT_IN_SALON, { date: '2026-10-12' })), 'the salon is closed on Mondays');
  assert.ok(ask(changed({ bookingHours: hoursWith('Monday', { isOpen: true }) }), { date: '2026-10-12' }).ok);
});

test('the booking check refuses a closed date, with its name', () => {
  const salon = changed({ closedDates: [{ id: 'c1', name: 'Training day', start: '2026-10-08', end: '2026-10-09' }] });
  assert.equal(reasonOf(ask(salon, { date: '2026-10-08' })), 'the salon is closed on Thursday, 08.10.2026 (Training day)');
  assert.equal(reasonOf(ask(salon, { date: '2026-10-09' })), 'the salon is closed on Friday, 09.10.2026 (Training day)');
  assert.ok(ask(salon, { date: '2026-10-07' }).ok);
  assert.ok(ask(salon, { date: '2026-10-10' }).ok);
  assert.equal(reasonOf(ask(changed({ closedDates: [{ id: 'c1', name: '', start: '2026-10-08', end: '2026-10-08' }] }), { date: '2026-10-08' })), 'the salon is closed on Thursday, 08.10.2026');
});

test('the booking check takes a stylist who is active and offers the service, and says so when not', () => {
  const luca = (salon: Salon, service = 'Haircut') => ask(salon, { service, staffName: 'Luca' });
  const builtIn = luca(BUILT_IN_SALON);
  assert.ok(builtIn.ok && builtIn.request.employeeId === 'emp-3' && builtIn.request.staffName === 'Luca Frei');
  // Removed or made inactive: not on the team any more.
  for (const salon of [changed({ employees: peopleWith('emp-3', null) }), changed({ employees: peopleWith('emp-3', { status: 'Inactive' }) })]) {
    const check = luca(salon);
    assert.ok(check.ok && check.unknownStylist === 'Luca' && !check.request.employeeId);
  }
  // On the team, but he does not do colour work: the request is passed on without him, and the owner is told.
  const colour = luca(BUILT_IN_SALON, 'Colouring');
  assert.ok(colour.ok && colour.stylistNotOffering === 'Luca Frei' && !colour.request.employeeId && !colour.unknownStylist);
  // Once the owner gives him colour work, he can be asked for it.
  const trained = luca(changed({ services: servicesWith('srv-3', { assignedEmployeeIds: ['emp-1', 'emp-2', 'emp-3'], assignedEmployeesCount: 3 }) }), 'Colouring');
  assert.ok(trained.ok && trained.request.employeeId === 'emp-3');
  // A renamed person is found by the new name.
  const renamed = ask(changed({ employees: peopleWith('emp-3', { firstName: 'Lukas', name: 'Lukas Frei' }) }), { staffName: 'Lukas' });
  assert.ok(renamed.ok && renamed.request.employeeId === 'emp-3');
});

test('a website message for a closed date or a stylist who does not offer the service: the owner reads why', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putRecord(store, { closedDates: [{ id: 'c1', name: 'Training day', start: '2026-10-06', end: '2026-10-06' }], services: servicesWith('srv-2', { onlineBooking: false }) });
  await run(store, outsideWorld({ ai: bookingAnswer() }).outside, async () => { await writeChat(post('Haircut on Tuesday at 10, I am Eva')); });
  let chat = storedChat(store, WEB)!;
  assert.equal(chat.bookingRequest, undefined);
  assert.match(chat.attentionReason!, /^Booking request not passed on: the salon is closed on Tuesday, 06\.10\.2026 \(Training day\)\./);
  // Another day: the request waits, and the owner reads that the service is not booked online any more.
  const next = new FakeStore(NOW);
  putRecord(next, { services: servicesWith('srv-3', { onlineBooking: false }) });
  await run(next, outsideWorld({ ai: bookingAnswer({ service: 'Colouring', staffName: 'Luca' }) }).outside, async () => { await writeChat(post('Colouring with Luca')); });
  chat = storedChat(next, WEB)!;
  assert.equal(chat.bookingRequest?.status, 'requested');
  assert.equal(chat.bookingRequest?.employeeId, undefined);
  assert.match(chat.attentionReason!, /The customer asked for Luca Frei, who does not offer Colouring\. Colouring is not booked online: you book it personally\./);
});

// ---------- the fixed messages ----------

test('the owner\'s answer names the salon as saved', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putRecord(store, { companySettings: rosa });
  putChat(store, liveChat({ status: 'needs-attention', bookingRequest: { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-06', time: '10:00', customerName: 'Eva', status: 'requested', kind: 'new' } }));
  await run(store, outsideWorld().outside, async () => {
    assert.equal((await act(ownerAction({ type: 'confirm-booking', conversationId: `live-${WEB}` }))).status, 200);
  });
  const sent = storedChat(store, WEB)!.messages.at(-1)!;
  const expected = chatBookingMessage('confirmed', { language: 'EN', salonName: 'Salon Rosa', customerName: 'Eva', serviceName: 'Haircut', date: '2026-10-06', time: '10:00' });
  assert.equal(sent.original, expected.original);
  assert.ok(sent.original.includes('Salon Rosa') || sent.translation.includes('Salon Rosa'), sent.original);
  assert.doesNotMatch(`${sent.original} ${sent.translation}`, /Bella Hair Salon/);
});

test('WhatsApp\'s first notice and the answers to /delete and /start name the salon as saved', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putRecord(store, { companySettings: rosa });
  const world = outsideWorld();
  await run(store, world.outside, async () => {
    await whatsappWebhook(whatsappMessage('Hello'));
    await whatsappWebhook(whatsappMessage('/delete'));
    await telegramWebhook(telegramUpdate('/start'));
    await telegramWebhook(telegramUpdate('/delete'));
  });
  const texts = world.sent.map(message => `${message.channel}: ${message.text}`);
  assert.equal(texts.length, 5, texts.join('\n'));
  // The first notice, the AI's answer, the confirmation of /delete; the welcome, the confirmation of /delete.
  assert.ok(texts[0].startsWith('WhatsApp: ') && texts[0].includes('Salon Rosa'), texts[0]);
  assert.equal(world.sent[2].text, chatDeletedNotice('EN', 'Salon Rosa'));
  assert.equal(world.sent[2].to, WHATSAPP_NUMBER);
  assert.ok(texts[3].startsWith('Telegram: ') && texts[3].includes('Salon Rosa'), texts[3]);
  assert.equal(world.sent[4].text, chatDeletedNotice('EN', 'Salon Rosa'));
  for (const text of texts) assert.doesNotMatch(text, /Bella Hair Salon/);
});

test('a website chat that has become long offers the salon\'s phone as saved', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  putRecord(store, { companySettings: rosa });
  putChat(store, liveChat({ messages: Array.from({ length: 200 }, (_, index) => ({ id: `m${index}`, sender: 'customer' as const, original: 'Hi', translation: 'Hi', time: '11:00' })) }));
  await run(store, outsideWorld().outside, async () => {
    const response = await writeChat(post('One more'));
    assert.equal(response.status, 429);
    assert.equal(((await response.json()) as { error: string }).error, 'This conversation has become long. Please start a new chat or call +41 71 555 00 00.');
  });
});

// ---------- what it costs ----------

/** The storage commands of one website message and one Telegram message, as names. */
const messageCosts = async (t: TestContext, record: boolean) => {
  const store = new FakeStore(NOW);
  if (record) putRecord(store, { companySettings: rosa, closedDates: [{ id: 'c1', name: 'Training day', start: '2026-10-08', end: '2026-10-08' }] });
  const world = outsideWorld({ ai: bookingAnswer() });
  const web: Command[] = await deployedWith(SETTINGS, async () => { await writeChat(chatRequest('POST', { body: { session: SESSION, name: 'Eva', text: 'Hello' }, address: '203.0.113.7' })); }, { store, outside: world.outside });
  const telegram: Command[] = await deployedWith(SETTINGS, async () => { await telegramWebhook(telegramUpdate('Hello')); }, { store, outside: world.outside });
  putChat(store, liveChat({ waId: 'web-otherchat000001', status: 'needs-attention', bookingRequest: { service: 'Haircut', serviceId: 'srv-2', date: '2026-10-06', time: '10:00', customerName: 'Eva', status: 'requested', kind: 'new' } }));
  const owner: Command[] = await deployedWith(SETTINGS, async () => { await act(ownerAction({ type: 'confirm-booking', conversationId: 'live-web-otherchat000001' })); }, { store, outside: world.outside });
  return { web, telegram, owner };
};

test('storage commands: a customer\'s message and an owner\'s answer cost no command more with a saved salon; the salon comes with the chat', async (t) => {
  freezeClock(t);
  const without = await messageCosts(t, false);
  const withRecord = await messageCosts(t, true);
  const names = (commands: Command[]) => commands.map(command => command[0] === 'EVAL' && command[1] === COUNT_SCRIPT ? 'COUNT' : command[0]);
  assert.deepEqual(names(withRecord.web), ['MGET', 'COUNT', 'EVAL', 'SMEMBERS', 'EVAL']);
  assert.deepEqual(names(withRecord.web), names(without.web));
  assert.deepEqual(names(withRecord.telegram), names(without.telegram));
  assert.deepEqual(names(withRecord.owner), names(without.owner));
  // The one read of the chat also reads the salon.
  for (const commands of [withRecord.web, withRecord.telegram, withRecord.owner]) {
    const read = commands.find(command => command[0] === 'MGET')!;
    assert.equal(read.at(-1), SALON_KEY);
  }
});

test('storage commands: Telegram\'s /start, which read nothing before, reads the salon in one command', async (t) => {
  freezeClock(t);
  const store = new FakeStore(NOW);
  const commands = await quietly(async () => {
    const list = await deployedWith(SETTINGS, async () => { await telegramWebhook(telegramUpdate('/start')); }, { store, outside: outsideWorld().outside });
    assert.deepEqual(list.map(command => command[0]), ['SET', 'MGET']);
    assert.deepEqual(list[1], ['MGET', SALON_KEY]);
  });
  assert.deepEqual(commands, []);
});
