import { AiAssistantSettings, ChatLanguage, Conversation } from './types';

export const LANGUAGE_NAMES: Record<ChatLanguage, string> = {
  EN: 'English',
  FR: 'French',
  DE: 'German',
  IT: 'Italian',
};

export const initialConversations: Conversation[] = [
  {
    id: 'conv-camille',
    customerName: 'Camille Bernard',
    initials: 'CB',
    avatarColor: 'bg-rose-100 text-rose-700',
    language: 'FR',
    phone: '+41 79 555 01 13',
    channel: 'WhatsApp',
    status: 'needs-attention',
    attentionReason: "The customer asked for a discount. The AI can't decide this.",
    lastTime: '12:18',
    messages: [
      {
        id: 'm1',
        sender: 'customer',
        original: 'Bonjour, je voudrais réserver une coloration pour vendredi.',
        translation: "Hello, I'd like to book a colouring for Friday.",
        time: '12:10',
      },
      {
        id: 'm2',
        sender: 'ai',
        original: 'Bien sûr ! Vendredi à 11h00 est disponible. Souhaitez-vous confirmer ?',
        translation: 'Of course! Friday at 11:00 is available. Would you like to confirm?',
        time: '12:11',
      },
      {
        id: 'm3',
        sender: 'customer',
        original: "Oui, parfait. Est-ce possible d'avoir une réduction ? C'est ma première visite.",
        translation: "Yes, perfect. Is it possible to get a discount? It's my first visit.",
        time: '12:18',
      },
    ],
    aiFollowUp: {
      original:
        'Parfait, votre rendez-vous de vendredi à 11h00 est confirmé au tarif habituel. À bientôt !',
      translation:
        'Perfect, your appointment on Friday at 11:00 is confirmed at the standard price. See you soon!',
    },
    quickReplies: [
      {
        en: 'Yes, as a welcome offer you get 10% off your first visit.',
        local:
          "Oui, en guise d'offre de bienvenue, vous bénéficiez de 10 % de réduction sur votre première visite.",
      },
      {
        en: "Sorry, we can't offer a discount, but I've booked you for Friday at 11:00.",
        local:
          "Désolé, nous ne pouvons pas offrir de réduction, mais je vous ai réservé vendredi à 11h00.",
      },
    ],
  },
  {
    id: 'conv-chloe',
    customerName: 'Chloé Favre',
    initials: 'CF',
    avatarColor: 'bg-amber-100 text-amber-700',
    language: 'DE',
    phone: '+41 77 555 03 45',
    channel: 'Instagram',
    status: 'needs-attention',
    attentionReason: 'The request is outside opening hours (we close at 18:00).',
    lastTime: '11:42',
    messages: [
      {
        id: 'm1',
        sender: 'customer',
        original: 'Hallo, habt ihr am Freitag noch einen Termin nach 18:00 Uhr?',
        translation: 'Hello, do you still have an appointment on Friday after 18:00?',
        time: '11:42',
      },
    ],
    aiFollowUp: {
      original:
        'Unser letzter Termin am Freitag ist um 17:30 Uhr. Möchten Sie diesen buchen?',
      translation: 'Our last appointment on Friday is at 17:30. Would you like to book it?',
    },
    quickReplies: [
      {
        en: "I can stay open until 19:00 on Friday. Shall I book you for 18:30?",
        local:
          'Ich kann am Freitag bis 19:00 Uhr geöffnet bleiben. Soll ich Sie für 18:30 Uhr eintragen?',
      },
    ],
  },
  {
    id: 'conv-giulia',
    customerName: 'Giulia Rossi',
    initials: 'GR',
    avatarColor: 'bg-emerald-100 text-emerald-700',
    language: 'IT',
    phone: '+41 76 555 02 78',
    channel: 'WhatsApp',
    status: 'needs-attention',
    attentionReason: 'The customer wants to change an existing booking.',
    lastTime: '10:55',
    messages: [
      {
        id: 'm1',
        sender: 'customer',
        original: 'Ciao, posso spostare il mio appuntamento a sabato?',
        translation: 'Hi, can I move my appointment to Saturday?',
        time: '10:55',
      },
    ],
    aiFollowUp: {
      original: 'Certo! Posso proporle sabato alle 10:00 o alle 11:30. Quale preferisce?',
      translation: 'Of course! I can offer you Saturday at 10:00 or 11:30. Which do you prefer?',
    },
    quickReplies: [
      {
        en: 'Yes, Saturday at 10:00 works. I have moved your appointment.',
        local: 'Sì, sabato alle 10:00 va bene. Ho spostato il suo appuntamento.',
      },
    ],
  },
  {
    id: 'conv-marie',
    customerName: 'Marie Dupont',
    initials: 'MD',
    avatarColor: 'bg-violet-100 text-violet-700',
    language: 'FR',
    phone: '+41 79 555 01 12',
    channel: 'WhatsApp',
    status: 'booked',
    lastTime: '09:30',
    messages: [
      {
        id: 'm1',
        sender: 'customer',
        original: 'Bonjour, je voudrais un rendez-vous pour une coupe jeudi.',
        translation: "Hello, I'd like an appointment for a haircut on Thursday.",
        time: '09:24',
      },
      {
        id: 'm2',
        sender: 'ai',
        original: "J'ai vérifié notre agenda. Jeudi à 13h30 est disponible. Cela vous convient ?",
        translation: "I checked our calendar. Thursday at 13:30 is available. Does that suit you?",
        time: '09:24',
      },
      {
        id: 'm3',
        sender: 'customer',
        original: "13h30, c'est parfait.",
        translation: '13:30 is perfect.',
        time: '09:29',
      },
      {
        id: 'm4',
        sender: 'ai',
        original: 'Rendez-vous confirmé ✅ Marie Dupont, Coupe, jeudi 13h30. À bientôt !',
        translation: 'Appointment confirmed ✅ Marie Dupont, Haircut, Thursday 13:30. See you soon!',
        time: '09:30',
      },
    ],
  },
  {
    id: 'conv-lea',
    customerName: 'Léa Girard',
    initials: 'LG',
    avatarColor: 'bg-pink-100 text-pink-700',
    language: 'FR',
    phone: '+41 76 555 02 34',
    channel: 'Instagram',
    status: 'ai-handled',
    lastTime: 'Yesterday',
    messages: [
      {
        id: 'm1',
        sender: 'customer',
        original: 'Bonsoir, avez-vous de la place vendredi matin pour une coloration ?',
        translation: 'Good evening, do you have room on Friday morning for a colouring?',
        time: '21:12',
      },
      {
        id: 'm2',
        sender: 'ai',
        original: 'Bonsoir ! Vendredi à 11h00 est disponible. Souhaitez-vous le réserver ?',
        translation: 'Good evening! Friday at 11:00 is available. Would you like to book it?',
        time: '21:12',
      },
      {
        id: 'm3',
        sender: 'customer',
        original: 'Oui, merci.',
        translation: 'Yes, thank you.',
        time: '21:14',
      },
      {
        id: 'm4',
        sender: 'ai',
        original: 'Réservation confirmée : Coloration, vendredi 11h00. À vendredi !',
        translation: 'Booking confirmed: Colouring, Friday 11:00. See you Friday!',
        time: '21:14',
      },
    ],
  },
  {
    id: 'conv-john',
    customerName: 'John Smith',
    initials: 'JS',
    avatarColor: 'bg-sky-100 text-sky-700',
    language: 'EN',
    phone: '+41 78 555 04 90',
    channel: 'WhatsApp',
    status: 'ai-handled',
    lastTime: 'Yesterday',
    messages: [
      {
        id: 'm1',
        sender: 'customer',
        original: 'Hi, can I get a haircut on Wednesday afternoon?',
        translation: 'Hi, can I get a haircut on Wednesday afternoon?',
        time: '17:40',
      },
      {
        id: 'm2',
        sender: 'ai',
        original: 'Hi John! Wednesday at 15:00 is free. Shall I book it for you?',
        translation: 'Hi John! Wednesday at 15:00 is free. Shall I book it for you?',
        time: '17:40',
      },
      {
        id: 'm3',
        sender: 'customer',
        original: 'Thanks, see you on Wednesday!',
        translation: 'Thanks, see you on Wednesday!',
        time: '17:43',
      },
    ],
  },
];

export const initialAiSettings: AiAssistantSettings = {
  askBeforeSending: false,
  translateChats: true,
  ownerLanguage: 'English',
  answerLanguages: { DE: true, FR: true, IT: true, EN: true },
  tone: 'friendly',
  handoverRules: [
    { id: 'rule-discounts', label: 'Discounts and price changes', enabled: true },
    { id: 'rule-complaints', label: 'Complaints', enabled: true },
    { id: 'rule-hours', label: 'Bookings outside opening hours', enabled: true },
    { id: 'rule-cancellations', label: 'Cancellations and refunds', enabled: true },
  ],
  whatsappConnected: true,
  instagramConnected: false,
};
