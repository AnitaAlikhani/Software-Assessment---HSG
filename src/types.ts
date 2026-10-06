export type NavigationTab =
  | 'home'
  | 'calendar'
  | 'booking-page'
  | 'shift-plan'
  | 'customers'
  | 'resources'
  | 'employees'
  | 'services'
  | 'analytics'
  | 'settings';

export type SettingsSubTab =
  | 'basic'
  | 'hours'
  | 'closed-dates'
  | 'profile';

export interface AppointmentRequest {
  id: string;
  customerName: string;
  serviceName: string;
  dateStr: string; // e.g. "1 October 2026"
  timeStr: string; // e.g. "10:00 - 10:30"
  timeAgo: string; // e.g. "10 minutes ago"
  staffName?: string;
  channel?: 'WhatsApp' | 'Instagram' | 'Web';
  status: 'pending' | 'accepted' | 'rejected';
}

export interface CalendarEvent {
  id: string;
  customerName: string;
  serviceName: string;
  staffName: string;
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  dateDisplay: string; // "Wed 07/10"
  startTime: string; // "10:00"
  endTime: string; // "10:30"
  colorTheme: 'yellow' | 'green' | 'purple' | 'blue';
  isAiBooked?: boolean;
}

export interface ShiftEntry {
  employeeId: string;
  employeeName: string;
  initials: string;
  avatarColor: string;
  shifts: {
    [dayKey: string]: {
      start: string;
      end: string;
      label?: string;
      type?: 'shift' | 'service';
    } | null;
  };
}

export interface Customer {
  id: string;
  name: string;
  initials: string;
  email: string;
  phone: string;
  language: 'EN' | 'FR' | 'DE' | 'IT';
  lastBooking: string;
  bookingsCount: number;
}

export interface Resource {
  id: string;
  name: string;
  type: 'Room' | 'Table' | 'Chair' | 'Rental' | 'Equipment';
  capacity: number;
  color: string;
  reserveEntireRoom: boolean;
  visibleOnline: boolean;
  allServices: boolean;
  generalHours: boolean;
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  initials: string;
  email: string;
  phone: string;
  status: 'Active' | 'Inactive';
  location: string;
  canBookOnline: boolean;
  hidden: boolean;
}

export interface ServiceItem {
  id: string;
  name: string;
  durationMinutes: number;
  priceCHF: number;
  onlineBooking: boolean;
  assignedEmployeesCount: number;
  category?: string;
  description?: string;
  prepMinutes?: number;
  postMinutes?: number;
}

export interface CompanySettingsData {
  companyName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  state: string;
  industry: string;
  businessPhone: string;
  currency: string;
  branchLanguage: string;
  timeZone: string;
  description: string;
  website: string;
  facebook: string;
  xProfile: string;
  instagram: string;
  legalNote: string;
  customTerms: boolean;
}

export interface BookingHoursDay {
  day: string;
  isOpen: boolean;
  from: string;
  to: string;
}
