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

/**
 * The Gmail iOS app's link for the same conversation.
 *
 * Mobile Gmail drops the `#all/<id>` fragment the web link relies on, so on a
 * phone that link lands on the message list. The iOS app registers the
 * `googlegmail://` scheme, and `cv=<thread id>` opens a conversation. Google
 * does not document the scheme, so the caller falls back to the web link when
 * the app does not open.
 */
export function gmailAppUrl(webHref: string): string | null {
  const match = /#all\/([^/?#]+)$/.exec(webHref);
  if (!match) return null;
  return `googlegmail:///cv=${match[1]}/accountId=0`;
}

/** iPhone, or an iPad (which reports itself as a Mac but has a touch screen). */
export function isIOS(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}
