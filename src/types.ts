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
  | 'conversations'
  | 'ai-assistant'
  | 'settings';

export type SettingsSubTab =
  | 'basic'
  | 'hours'
  | 'closed-dates'
  | 'profile';

export type ChatLanguage = 'EN' | 'FR' | 'DE' | 'IT';

export type ConversationStatus =
  | 'needs-attention'
  | 'booked'
  | 'ai-handled'
  | 'owner-handled';

export interface ChatMessage {
  id: string;
  sender: 'customer' | 'ai' | 'owner';
  /** Text exactly as it was sent, in the customer's language. */
  original: string;
  /** The same message in the owner's language (English). */
  translation: string;
  /** Optional reviewed German translation for scripted demo messages. */
  translationDe?: string;
  time: string;
  /** True when the demo could not translate the owner's free-typed reply. */
  untranslated?: boolean;
}

export type AppointmentAction =
  | {
      type: 'book';
      appointmentId: string;
      date: string;
      startTime: string;
      serviceName: string;
      staffName: string;
    }
  | {
      type: 'reschedule';
      appointmentId: string;
      date: string;
      startTime: string;
      outsideHoursApproved?: boolean;
    };

export interface QuickReply {
  /** What the owner sees and selects (English). */
  en: string;
  /** What the customer receives (their language). */
  local: string;
  appointmentAction?: AppointmentAction;
}

export interface Conversation {
  id: string;
  customerName: string;
  initials: string;
  avatarColor: string;
  language: ChatLanguage;
  phone: string;
  channel: 'WhatsApp' | 'Instagram';
  status: ConversationStatus;
  attentionReason?: string;
  takenOver?: boolean;
  appointmentId?: string;
  lastTime: string;
  messages: ChatMessage[];
  /** What the AI sends when the owner chooses "Let AI continue". */
  aiFollowUp?: Pick<ChatMessage, 'original' | 'translation'> & {
    appointmentAction?: AppointmentAction;
  };
  quickReplies?: QuickReply[];
}

export interface HandoverRule {
  id: string;
  label: string;
  enabled: boolean;
}

export interface AiAssistantSettings {
  askBeforeSending: boolean;
  translateChats: boolean;
  ownerLanguage: string;
  answerLanguages: Record<ChatLanguage, boolean>;
  tone: 'friendly' | 'formal';
  handoverRules: HandoverRule[];
  whatsappConnected: boolean;
  instagramConnected: boolean;
}

export interface AppointmentRequest {
  id: string;
  serviceId?: string;
  employeeId?: string;
  customerName: string;
  customerId?: string;
  customerPhone?: string;
  serviceName: string;
  date: string; // YYYY-MM-DD, shared by requests and calendar entries
  dateStr: string; // e.g. "1 October 2026"
  timeStr: string; // e.g. "10:00 - 10:30"
  timeAgo: string; // e.g. "10 minutes ago"
  staffName?: string;
  channel?: 'WhatsApp' | 'Instagram' | 'Web';
  /** Whether AI performed the booking, independently of the contact channel. */
  isAiBooked?: boolean;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
}

export interface CalendarEvent {
  id: string;
  serviceId?: string;
  employeeId?: string;
  customerName: string;
  customerId?: string;
  customerPhone?: string;
  serviceName: string;
  staffName: string;
  date: string; // YYYY-MM-DD, never inferred from the visible calendar week
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  dateDisplay: string; // "Wed 07/10"
  startTime: string; // "10:00"
  endTime: string; // "10:30"
  colorTheme: 'yellow' | 'green' | 'purple' | 'blue';
  isAiBooked?: boolean;
  outsideHoursApproved?: boolean;
  /** Preserve the time reserved when booked, even after service changes. */
  prepMinutes?: number;
  postMinutes?: number;
}

export interface ShiftEntry {
  employeeId: string;
  employeeName: string;
  initials: string;
  avatarColor: string;
  shifts: {
    // Explicit date-only keys (YYYY-MM-DD); missing dates are not scheduled.
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
  /** Explicit eligibility; a display count alone never grants booking access. */
  assignedEmployeeIds?: string[];
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
  termsText?: string;
  logoDataUrl?: string;
}

export interface BookingHoursDay {
  day: string;
  isOpen: boolean;
  from: string;
  to: string;
}

export interface ClosedDate {
  id: string;
  name: string;
  /** Inclusive date-only bounds, YYYY-MM-DD. */
  start: string;
  end: string;
}

export interface StaffAbsence {
  id: string;
  employeeId: string;
  /** Inclusive date-only bounds, YYYY-MM-DD. */
  start: string;
  end: string;
  reason?: string;
}
