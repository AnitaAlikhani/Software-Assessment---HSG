/**
 * What the owner can answer to a booking request, a change or a cancellation that waits in a chat.
 * One list for live chats (the server carries the answer out and tells the customer) and for the
 * salon's own chats in the browser, so both offer the same choices.
 */
export type ChatBookingAction =
  /** Confirm the request, with the stylist who takes it where one is chosen. */
  | { type: 'confirm'; employeeId?: string; staffName?: string }
  /** The time asked for does not work: offer another one. The customer answers in the chat. */
  | { type: 'suggest'; date: string; time: string; employeeId?: string; staffName?: string }
  /** The request cannot be met. */
  | { type: 'decline' }
  /** The customer asked to cancel a confirmed appointment, and the owner agrees. */
  | { type: 'cancel' }
  /** The customer asked to cancel, and the appointment stays: the owner writes to the customer herself. */
  | { type: 'keep' };
