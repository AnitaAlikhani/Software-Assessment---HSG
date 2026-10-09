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
  time: string;
  /** True when the demo could not translate the owner's free-typed reply. */
  untranslated?: boolean;
}

export interface QuickReply {
  /** What the owner sees and selects (English). */
  en: string;
  /** What the customer receives (their language). */
  local: string;
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
  lastTime: string;
  messages: ChatMessage[];
  /** What the AI sends when the owner chooses "Let AI continue". */
  aiFollowUp?: Pick<ChatMessage, 'original' | 'translation'>;
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
