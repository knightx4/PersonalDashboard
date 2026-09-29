import type { MessageEnvelope } from '@/lib/core/inbox/envelopes';

/**
 * The mailroom's one question: which pile an email belongs in (plan #1173).
 *
 * Each linker in lib/core/inbox claims its own mail with sender and subject
 * rules. Feature #1172 replaces those with this question, asked of every
 * email. For now it runs beside the rules and its answer is only stored
 * (core.mail_piles), so the two can be compared before any rule is retired.
 *
 * Four piles belong to a linker and match its verdict in
 * core.mail_pile_comparison: job (jobs), order (commerce), bill (recurring)
 * and appointment (appointments). The other four are mail no linker claims
 * today.
 *
 * Jev reads what the rules read: the sender, the reply-to address and the
 * subject. The body is not fetched for this; a linker fetches bodies only for
 * the mail it claims.
 */

export type MailPile =
  | 'job'
  | 'order'
  | 'bill'
  | 'appointment'
  | 'newsletter'
  | 'needs_reply'
  | 'personal'
  | 'other';

export const MAIL_PILE_OPTIONS: Readonly<Record<MailPile, string>> = {
  job: 'About their job search: an application, a recruiter, an interview, an assessment, an offer, a rejection or a job alert.',
  order: 'About something they bought: an order confirmation, shipping, delivery, a return, a refund or a cancelled order.',
  bill: 'About something they pay for regularly: a subscription, a membership, a bill or statement, a renewal, a price change or a trial ending.',
  appointment:
    'A booking at a set time: an appointment, a reservation, a ticket, a flight or a hotel stay, or a change to one.',
  newsletter: 'A newsletter, digest or marketing email sent to many people.',
  needs_reply: 'A person wrote to them directly and is waiting for an answer.',
  personal: 'From a person they know, and not waiting for an answer.',
  other: 'Anything else: a notification, a security code, an account or service message.',
};

export const MAIL_PILES = Object.keys(MAIL_PILE_OPTIONS) as MailPile[];

export const MAIL_PILE_QUESTION = {
  type: 'choice',
  question: 'An email has just arrived in the person\'s inbox. Which pile does it belong in?',
  options: MAIL_PILE_OPTIONS,
} as const;

/** The pile each linker's rules put mail in. */
export const LINKER_PILES: Readonly<Record<string, MailPile>> = {
  jobs: 'job',
  commerce: 'order',
  recurring: 'bill',
  appointments: 'appointment',
};

export function isMailPile(value: unknown): value is MailPile {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MAIL_PILE_OPTIONS, value);
}

/**
 * What Jev reads, or null when there is nothing to read: a scrubbed envelope
 * has lost both its sender and its subject.
 */
export function mailState(
  envelope: Pick<MessageEnvelope, 'fromAddress' | 'replyToAddress' | 'subject'>,
): Record<string, string> | null {
  const from = envelope.fromAddress?.trim() || null;
  const subject = envelope.subject?.trim() || null;
  if (!from && !subject) return null;
  const state: Record<string, string> = {
    from: from ?? 'unknown',
    subject: subject ?? '(no subject)',
  };
  const replyTo = envelope.replyToAddress?.trim();
  if (replyTo && replyTo.toLowerCase() !== from?.toLowerCase()) state.reply_to = replyTo;
  return state;
}
