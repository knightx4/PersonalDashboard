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

/** The Gmail id an "Open in Gmail" link names, from its `#all/<id>` fragment. */
export function gmailIdFromHref(webHref: string): string | null {
  const match = /#all\/([0-9a-f]+)$/i.exec(webHref);
  return match ? match[1] : null;
}

/**
 * A phone or tablet browser. iPadOS reports itself as a Mac, so a Mac with a
 * touch screen counts too.
 */
export function isMobileBrowser(userAgent: string, maxTouchPoints = 0): boolean {
  if (/Android|iPhone|iPad|iPod|Mobi/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** Just the address from a header like `Jane Doe <jane@example.com>`. */
export function bareAddress(header: string | null): string | null {
  if (!header) return null;
  const angled = /<([^>]+)>/.exec(header);
  const address = (angled ? angled[1] : header).trim();
  return address.includes('@') ? address : null;
}

/**
 * A `mailto:` reply to a message. On a phone this opens the default mail app,
 * which is Gmail when the phone is set up that way.
 */
export function replyMailto(message: {
  fromAddress: string | null;
  replyToAddress: string | null;
  subject: string | null;
}): string | null {
  const to = bareAddress(message.replyToAddress) ?? bareAddress(message.fromAddress);
  if (!to) return null;
  const subject = message.subject?.trim() ?? '';
  const reply = /^re:/i.test(subject) ? subject : `Re: ${subject}`.trim();
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(reply)}`;
}
