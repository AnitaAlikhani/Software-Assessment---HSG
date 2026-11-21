/** The owner's screens, one per entry of the menu. Their names and order are in src/navigation.ts. */
export type NavigationTab =
  | 'home'
  | 'calendar'
  | 'conversations'
  | 'customers'
  | 'team'
  | 'services'
  | 'analytics'
  | 'ai-assistant'
  | 'settings';

/** The tabs of Team: the people, the shifts of a week, and time off. */
export type TeamSubTab =
  | 'people'
  | 'week'
  | 'absences';

/** The tabs of Settings. */
export type SettingsSubTab =
  | 'salon'
  | 'hours'
  | 'closed-dates'
  | 'online-booking';

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
  /** The same message in German, stored with the message so later renames cannot lose it. */
  translationDe?: string;
  time: string;
  /** When the message was sent (ISO). `time` is the label shown for it. */
  sentAt?: string;
  /** True when the demo could not translate the owner's free-typed reply. */
  untranslated?: boolean;
}

/**
 * A calendar change that a chat message carries. Service and stylist are stored by id; their
 * names are looked up when the booking is made, so a rename never breaks a chat.
 */
export type AppointmentAction =
  | {
      type: 'book';
      appointmentId: string;
      date: string;
      startTime: string;
      serviceId: string;
      employeeId: string;
    }
  | {
      type: 'reschedule';
      appointmentId: string;
      date: string;
      startTime: string;
    };

export interface QuickReply {
  /** What the owner sees and selects (English). */
  en: string;
  /** What the customer receives (their language). */
  local: string;
  /** The same reply in German, for an owner who reads German. */
  de?: string;
  appointmentAction?: AppointmentAction;
}

export interface Conversation {
  id: string;
  customerName: string;
  /** The customer record this chat belongs to, once one exists. */
  customerId?: string;
  initials: string;
  avatarColor: string;
  language: ChatLanguage;
  /**
   * The customer's number where the salon knows it: WhatsApp brings one (shown masked), a sample
   * chat takes it from the customer record. Empty for a new website or Telegram chat.
   */
  phone: string;
  /**
   * Live chats come in as 'WhatsApp', 'Website' or 'Telegram'; the sample chats are 'Website'.
   * 'Instagram' is planned: nothing creates such a chat, only a tab stored earlier can hold one.
   */
  channel: 'WhatsApp' | 'Instagram' | 'Website' | 'Telegram';
  status: ConversationStatus;
  attentionReason?: string;
  takenOver?: boolean;
  appointmentId?: string;
  lastTime: string;
  /** When the newest message was sent (ISO). `lastTime` is the label shown for it. */
  lastMessageAt?: string;
  messages: ChatMessage[];
  /** What the AI sends when the owner chooses "Let AI continue". */
  aiFollowUp?: Pick<ChatMessage, 'original' | 'translation' | 'translationDe'> & {
    appointmentAction?: AppointmentAction;
  };
  quickReplies?: QuickReply[];
  /** A real chat from a tester (WhatsApp test number or website chat), not scripted demo data. */
  live?: boolean;
  /** Language the AI detected in a live chat, e.g. "Spanish". */
  languageLabel?: string;
  /** A booking request the AI collected in a live chat, for the owner to confirm. */
  bookingRequest?: {
    service: string;
    /** Id of that service in the salon's list. Missing on chats stored before ids were sent. */
    serviceId?: string;
    date: string;
    time: string;
    customerName: string;
    status: 'requested' | 'confirmed';
    /** The stylist the customer asked for, where they named one: the id in the salon's list and the name. */
    employeeId?: string;
    staffName?: string;
    /** 'change': the customer wants to move the appointment that was confirmed in this chat (`previous`) to this time. */
    kind?: 'new' | 'change';
    previous?: { date: string; time: string };
  };
  /** The customer asked in the chat to cancel the appointment that was confirmed in it. The owner decides. */
  cancellationRequest?: { service: string; date: string; time: string };
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
}

export interface AppointmentRequest {
  id: string;
  serviceId?: string;
  employeeId?: string;
  customerName: string;
  customerId?: string;
  /** In the international form, "+41791234567". Shown through formatPhone. */
  customerPhone?: string;
  serviceName: string;
  date: string; // YYYY-MM-DD, shared by requests and calendar entries
  dateStr: string; // "Thu, 01.10.2026". Kept for stored requests; screens write the date from `date` (src/format.ts)
  timeStr: string; // start and end as data, always "10:00 - 10:30": the slot rules read it. Screens show "10:00–10:30"
  timeAgo: string; // e.g. "10 minutes ago"; only shown when createdAt is missing
  /** When the request came in (ISO). */
  createdAt?: string;
  staffName?: string;
  /** Requests come in over the web ('Web'). The other values only occur in a tab stored earlier. */
  channel?: 'WhatsApp' | 'Instagram' | 'Web';
  /** Whether AI performed the booking, independently of the contact channel. */
  isAiBooked?: boolean;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  /**
   * The time the customer asked for, while the request stands at another time because the salon
   * moved it. The customer's page then shows the new time as the salon's suggestion, not as
   * something the customer asked for. Gone again when the customer changes the request.
   */
  movedFrom?: { date: string; timeStr: string };
  /** On the customer's own page only: the salon took the confirmed appointment out of its calendar. */
  cancelledBy?: 'salon';
}

export interface CalendarEvent {
  id: string;
  serviceId?: string;
  employeeId?: string;
  customerName: string;
  customerId?: string;
  customerPhone?: string;
  /** The chat this appointment was booked in, if any. */
  conversationId?: string;
  /** When the appointment was booked (ISO). */
  createdAt?: string;
  serviceName: string;
  staffName: string;
  date: string; // YYYY-MM-DD, never inferred from the visible calendar week
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  dateDisplay: string; // "Wed 07.10.". Kept for stored appointments; screens write the date from `date`
  startTime: string; // "10:00"
  endTime: string; // "10:30"
  colorTheme: 'yellow' | 'green' | 'purple' | 'blue';
  isAiBooked?: boolean;
  outsideHoursApproved?: boolean;
  /**
   * How a booking that the owner entered by hand came in. Only the appointment form sets it, and
   * only to what the owner chose there: an appointment from a chat or the booking page has none.
   */
  source?: 'phone' | 'walk-in' | 'other';
  /** Preserve the time reserved when booked, even after service changes. */
  prepMinutes?: number;
  postMinutes?: number;
}

/**
 * The days on which one person does not work their regular hours (Employee.weeklyHours).
 * Who works when is asked from workingTimeOn (src/workingHours.ts), never read from here directly.
 */
export interface ShiftEntry {
  employeeId: string;
  employeeName: string;
  initials: string;
  avatarColor: string;
  shifts: {
    // Exceptions by date (YYYY-MM-DD): an entry means other hours on that date, null means off
    // that day, and a date that is missing means the regular hours of that weekday apply.
    [dayKey: string]: {
      start: string;
      end: string;
      label?: string;
      type?: 'shift' | 'service';
    } | null;
  };
}

/**
 * A person in the customer list. Visits and appointments are not stored here: they are counted
 * from the calendar (src/customerStats.ts), so the list can never disagree with it.
 */
export interface Customer {
  id: string;
  name: string;
  initials: string;
  email: string;
  /**
   * Stored once, in the international form ("+41791234567"), and shown everywhere through
   * formatPhone ("+41 79 123 45 67"). Empty when the salon has no number, for example for
   * someone who booked in the website chat.
   */
  phone: string;
  language: 'EN' | 'FR' | 'DE' | 'IT';
  /** How this person reached the salon when they came in through a chat. */
  channel?: Conversation['channel'];
  /** Their chat, so "Open conversation" finds it without comparing names. */
  conversationId?: string;
  /** The owner's one free-text note on this person, for example an allergy or a preference. */
  note?: string;
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
  /** 'Owner' for the person who runs the salon account. */
  role?: string;
  /**
   * The person's regular working hours per weekday; null for a weekday they do not work.
   * Stored on the person: somebody without them has no regular hours, and nothing falls back to
   * the opening hours. Single days that differ are in ShiftEntry.shifts.
   */
  weeklyHours?: Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { start: string; end: string } | null>;
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
  /** Two-letter code of the Swiss canton ("SG"). Empty or missing for a salon in Liechtenstein. */
  canton?: string;
  /** The launch market: "Switzerland" or "Liechtenstein". */
  country: string;
  businessPhone: string;
  currency: string;
  /** The id of the time zone, without an offset: "Europe/Zurich". Settings saved earlier may carry a suffix. */
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

/**
 * Time the owner keeps free for one stylist on one day: a break, lunch, something private.
 * Nothing can be booked in it (src/availability.ts); the rules for making one are in src/timeBlocks.ts.
 */
export interface TimeBlock {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // "12:00"
  endTime: string; // "13:00", on the same day
  reason: 'Break' | 'Lunch' | 'Private' | 'Other';
  note?: string;
}

export interface StaffAbsence {
  id: string;
  employeeId: string;
  /** Inclusive date-only bounds, YYYY-MM-DD. */
  start: string;
  end: string;
  reason?: string;
}
