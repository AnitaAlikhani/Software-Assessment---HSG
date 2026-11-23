import type { ChatLanguage, ChatMessage } from '../src/types.js';

/**
 * Fixed sentences the server sends in place of the AI's reply when the AI's words cannot be
 * trusted: the AI said it passed a booking on that the rule check refused, or it answered a
 * request that is already waiting or confirmed. And in place of the AI itself when the day's AI
 * answers are used up (teamWillAnswer): the chat is then with the owner, so the team does answer.
 * They promise nothing the server has not done.
 *
 * Polite address (Sie, vous, Lei) and Swiss German spelling, like the booking messages in
 * src/customerTexts.ts. A chat in a language these do not have gets the English one.
 */
export type FixedReply = 'passedOn' | 'alreadyRequested' | 'alreadyConfirmed' | 'cancelPassedOn' | 'teamWillAnswer';

// In French a thin gap stands before "!" and "?", written as a no-break space.
const GAP = ' ';

const TEXTS: Record<ChatLanguage, Record<FixedReply, string>> = {
  EN: {
    passedOn: 'Thank you for your message. I have passed it on to the salon team, and they will reply here shortly.',
    alreadyRequested: 'Your request is already with the salon team. They will confirm it here.',
    alreadyConfirmed: 'This appointment is already confirmed. We look forward to seeing you!',
    cancelPassedOn: 'I have passed your cancellation request on to the salon team. They will confirm it here.',
    teamWillAnswer: 'Thank you for your message. The salon team will reply to you here.',
  },
  DE: {
    passedOn: 'Vielen Dank für Ihre Nachricht. Ich habe sie an das Salon-Team weitergegeben. Es meldet sich hier in Kürze.',
    alreadyRequested: 'Ihre Anfrage liegt dem Salon-Team bereits vor. Sie erhalten die Bestätigung hier.',
    alreadyConfirmed: 'Dieser Termin ist bereits bestätigt. Wir freuen uns auf Sie!',
    cancelPassedOn: 'Ich habe Ihren Wunsch, den Termin abzusagen, an das Salon-Team weitergegeben. Sie erhalten die Bestätigung hier.',
    teamWillAnswer: 'Vielen Dank für Ihre Nachricht. Das Salon-Team antwortet Ihnen hier.',
  },
  FR: {
    passedOn: "Merci pour votre message. Je l'ai transmis à l'équipe du salon, qui vous répondra ici sous peu.",
    alreadyRequested: "Votre demande est déjà entre les mains de l'équipe du salon. Vous recevrez la confirmation ici.",
    alreadyConfirmed: `Ce rendez-vous est déjà confirmé. Au plaisir de vous voir${GAP}!`,
    cancelPassedOn: "J'ai transmis votre demande d'annulation à l'équipe du salon. Vous recevrez la confirmation ici.",
    teamWillAnswer: "Merci pour votre message. L'équipe du salon vous répondra ici.",
  },
  IT: {
    passedOn: "Grazie per il Suo messaggio. L'ho inoltrato al team del salone, che Le risponderà qui a breve.",
    alreadyRequested: 'La Sua richiesta è già presso il team del salone. Riceverà la conferma qui.',
    alreadyConfirmed: 'Questo appuntamento è già confermato. A presto!',
    cancelPassedOn: 'Ho inoltrato la Sua richiesta di annullamento al team del salone. Riceverà la conferma qui.',
    teamWillAnswer: 'Grazie per il Suo messaggio. Il team del salone Le risponderà qui.',
  },
};

/**
 * The sentence in German and English in one message, German first: for a chat whose language
 * nobody has named yet (the AI did not read it), where one language would be a guess.
 */
export function fixedReplyGermanEnglish(kind: FixedReply): Pick<ChatMessage, 'original' | 'translation' | 'translationDe'> {
  return { original: `${TEXTS.DE[kind]}\n\n${TEXTS.EN[kind]}`, translation: TEXTS.EN[kind], translationDe: TEXTS.DE[kind] };
}

/** The sentence in the chat's language, with the English and German text for the owner's screen. */
export function fixedReply(kind: FixedReply, language: ChatLanguage): Pick<ChatMessage, 'original' | 'translation' | 'translationDe'> {
  const texts = TEXTS[language] ?? TEXTS.EN;
  return { original: texts[kind], translation: TEXTS.EN[kind], translationDe: TEXTS.DE[kind] };
}
