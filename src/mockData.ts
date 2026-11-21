import type {
  Employee,
  ServiceItem,
  CompanySettingsData,
  BookingHoursDay,
} from './types.js';

/**
 * The salon a new workspace starts with: team, services, profile and opening hours.
 * Everything here is fixed. Whatever depends on today's date (appointments, customers, chats,
 * requests, single days somebody works differently) is built in src/demoSeed.ts,
 * src/conversationData.ts and src/demoRequests.ts.
 *
 * All people and contact details are invented. Phone numbers stay in the 555 block and e-mail
 * addresses on reserved example domains, so none of them can belong to anyone. Numbers are
 * stored as every number is, in the international form, and shown as "+41 79 555 31 08".
 * The server reads this file too (server/ai.ts, server/bookingRules.ts): keep it free of imports.
 */

type RegularWeek = NonNullable<Employee['weeklyHours']>;
/** A regular week from its working days. A day that is not listed is a day off. */
const regularWeek = (days: Partial<Record<keyof RegularWeek, [start: string, end: string]>>): RegularWeek => {
  const hours = (day: keyof RegularWeek) => (days[day] ? { start: days[day][0], end: days[day][1] } : null);
  return { mon: hours('mon'), tue: hours('tue'), wed: hours('wed'), thu: hours('thu'), fri: hours('fri'), sat: hours('sat'), sun: hours('sun') };
};

// Each stylist's regular week is stored on the stylist (weeklyHours), like the hours of anybody
// the owner adds. Every working day lies inside the opening hours below, and together they cover
// them: an early and a late stylist on weekdays. Anna 40 h, Selina 33.5 h, Luca 24 h.
// Selina works on Saturdays: a sample chat moves an appointment with her to a Saturday.
export const initialEmployees: Employee[] = [
  {
    id: 'emp-1',
    firstName: 'Anna',
    lastName: 'Weber',
    name: 'Anna Weber',
    initials: 'AW',
    email: 'anna.weber@bella-hair.example',
    phone: '+41795553108',
    status: 'Active',
    location: 'Bella Hair Salon',
    canBookOnline: true,
    hidden: false,
    role: 'Owner',
    weeklyHours: regularWeek({ tue: ['08:30', '17:00'], wed: ['08:30', '17:00'], thu: ['10:00', '18:30'], fri: ['10:00', '18:30'], sat: ['08:00', '14:00'] }),
  },
  {
    id: 'emp-2',
    firstName: 'Selina',
    lastName: 'Keller',
    name: 'Selina Keller',
    initials: 'SK',
    email: 'selina.keller@bella-hair.example',
    phone: '+41785556427',
    status: 'Active',
    location: 'Bella Hair Salon',
    canBookOnline: true,
    hidden: false,
    weeklyHours: regularWeek({ wed: ['10:00', '18:30'], thu: ['08:30', '17:00'], fri: ['08:30', '17:00'], sat: ['08:00', '16:00'] }),
  },
  {
    id: 'emp-3',
    firstName: 'Luca',
    lastName: 'Frei',
    name: 'Luca Frei',
    initials: 'LF',
    email: 'luca.frei@bella-hair.example',
    phone: '+41765551952',
    status: 'Active',
    location: 'Bella Hair Salon',
    canBookOnline: true,
    hidden: false,
    weeklyHours: regularWeek({ tue: ['10:00', '18:30'], fri: ['10:00', '18:30'], sat: ['09:00', '16:00'] }),
  },
];

/** The person who runs the salon account: the employee with the role "Owner", else the first one. */
export const accountOwner = (employees: Employee[]): Employee | null =>
  employees.find((employee) => employee.role === 'Owner') ?? employees[0] ?? null;

const everyone = ['emp-1', 'emp-2', 'emp-3'];
// Colour work and updos are done by the two senior stylists.
const seniors = ['emp-1', 'emp-2'];

const service = (
  id: string, name: string, durationMinutes: number, priceCHF: number, onlineBooking: boolean,
  assignedEmployeeIds: string[], category: string, description: string,
): ServiceItem => ({
  id, name, durationMinutes, priceCHF, onlineBooking,
  assignedEmployeesCount: assignedEmployeeIds.length, assignedEmployeeIds, category, description,
});

// The ids srv-1 to srv-3 and the names "Haircut" and "Colouring" are referred to by chats,
// requests and the assistant's rules: keep them. Durations are multiples of the 30-minute step.
// Colour work is not offered online: the assistant collects the request and the owner books it.
export const initialServices: ServiceItem[] = [
  service('srv-1', 'Wash & blow-dry', 30, 45, true, everyone, 'Styling', 'Shampoo, blow-dry and styling.'),
  service('srv-2', 'Haircut', 30, 55, true, everyone, 'Cut', 'Consultation, cut and finish.'),
  service('srv-3', 'Colouring', 90, 120, false, seniors, 'Colour', 'Full colour with a gloss finish, by experienced colourists.'),
  service('srv-4', 'Cut & blow-dry', 60, 89, true, everyone, 'Cut', 'Wash, cut and blow-dry.'),
  service('srv-5', "Men's cut", 30, 45, true, everyone, 'Cut', 'Wash, cut and styling.'),
  service('srv-6', "Children's cut", 30, 32, true, everyone, 'Cut', 'For children up to 12 years.'),
  service('srv-7', 'Root colour', 60, 85, false, seniors, 'Colour', 'Colour for the regrowth, with a gloss finish.'),
  service('srv-8', 'Highlights', 120, 160, false, seniors, 'Colour', 'Foil highlights with toner.'),
  service('srv-9', 'Balayage', 180, 240, false, ['emp-1'], 'Colour', 'Hand-painted highlights with toner and blow-dry.'),
  service('srv-10', 'Updo', 60, 110, true, seniors, 'Styling', 'Pinned-up styling for weddings and events.'),
];

/** Avatar colours of the team in the week plan, in the order of initialEmployees. */
export const demoShiftColors = ['bg-rose-100 text-rose-700', 'bg-amber-100 text-amber-700', 'bg-sky-100 text-sky-700'];

// The salon has no phone line, website or social pages of its own, so those fields stay empty:
// the booking page hides empty links, and nothing leads to a page or a number of a stranger.
export const initialCompanySettings: CompanySettingsData = {
  companyName: 'Bella Hair Salon',
  street: 'Tuchgasse 7',
  postalCode: '9000',
  city: 'St. Gallen',
  canton: 'SG',
  country: 'Switzerland',
  businessPhone: '',
  currency: 'Swiss franc (CHF)',
  timeZone: 'Europe/Zurich',
  description: 'Hair salon in the old town of St. Gallen: cuts, colour and styling for women, men and children. Walk-ins are welcome when a chair is free, but we recommend booking.',
  website: '',
  facebook: '',
  xProfile: '',
  instagram: '',
  legalNote: '',
  customTerms: false,
};

// Closed on Sunday and Monday, shorter on Saturday, as most hair salons in St. Gallen are.
export const initialBookingHours: BookingHoursDay[] = [
  { day: 'Monday', isOpen: false, from: '08:30', to: '18:30' },
  { day: 'Tuesday', isOpen: true, from: '08:30', to: '18:30' },
  { day: 'Wednesday', isOpen: true, from: '08:30', to: '18:30' },
  { day: 'Thursday', isOpen: true, from: '08:30', to: '18:30' },
  { day: 'Friday', isOpen: true, from: '08:30', to: '18:30' },
  { day: 'Saturday', isOpen: true, from: '08:00', to: '16:00' },
  { day: 'Sunday', isOpen: false, from: '08:30', to: '18:30' },
];
