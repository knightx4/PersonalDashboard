/**
 * What a delivered message looks like once the service's own shape is off it.
 *
 * Nothing outside lib/news/providers/ knows which service delivers the mail,
 * on the same containment the Gmail code has in lib/email/providers/: the day
 * the inbound service changes, one directory changes with it.
 */
export type InboundMessage = {
  /**
   * The address it was sent to, as the service reported it. Turning that into
   * an account is lib/news/address.ts's job and then the database's.
   */
  recipient: string;
  /** The From header's address, lowercased. Senders are deduped on this. */
  senderEmail: string;
  /** The From header's display name, when it carried one. Not trusted. */
  senderName: string | null;
  subject: string | null;
  /** The Message-ID, which is what makes a retried delivery land once. */
  messageId: string;
  textBody: string | null;
  htmlBody: string | null;
};

/**
 * One inbound mail service.
 *
 * `read` does both halves in one pass because they are one pass: the signature
 * is over fields that arrive in the same form body as the message, so a
 * provider that verified separately would have to parse the request twice.
 */
export type InboundMailProvider = {
  name: string;
  /**
   * The message, or why it was refused.
   *
   * `unsigned` means the request did not prove it came from the service and
   * must be answered with a 4xx. `malformed` means it did, but carried no
   * message worth storing -- a delivery that failed rather than an issue to
   * read -- and is answered 200, because asking the service to retry would
   * only bring the same thing back.
   */
  read(form: FormData): Promise<InboundMessage | 'unsigned' | 'malformed'>;
};
