/**
 * Deep-link into the user's Gmail for a synced thread/message.
 * Uses authuser so multi-account browsers open the connected inbox,
 * not whichever Google account happens to be /u/0.
 */
export function gmailOpenUrl(opts: {
  emailAddress: string | null | undefined;
  threadId?: string | null;
  messageId?: string | null;
}): string | null {
  const target = opts.threadId || opts.messageId;
  if (!target) return null;

  const params = new URLSearchParams();
  if (opts.emailAddress) params.set('authuser', opts.emailAddress);
  const qs = params.toString();
  const base = qs ? `https://mail.google.com/mail/?${qs}` : 'https://mail.google.com/mail/';
  return `${base}#all/${encodeURIComponent(target)}`;
}
