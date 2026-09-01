/**
 * The follow-up, written.
 *
 * Knowing a pursuit has gone quiet is the easy half and the app already did
 * it: 203 ghosted, and a reminders table that had never held a row. The half
 * that decides whether anything happens is the blank compose window, so this
 * fills it in.
 *
 * Deliberately a template rather than a model call. It is instant, free, the
 * same every time, and it can be read here in full and disagreed with -- and
 * the text is going out over your name, which is the wrong place to be
 * surprised. Every line is either a fact from the record or a sentence you
 * would have written anyway.
 */

export interface FollowUpInput {
  companyName: string;
  roleTitle: string | null;
  /** When the application went in, if it is known. */
  appliedAt: string | null;
  /** How the recruiter signed off, when a name was extracted from the mail. */
  recipientName?: string | null;
  /** The applicant's own name, for the sign-off. */
  senderName?: string | null;
  now?: Date;
}

export interface FollowUpDraft {
  subject: string;
  body: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "three weeks", "a month" -- how a person says it, not "23 days". */
export function humanGap(from: Date, to: Date): string {
  const days = Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
  if (days < 10) return `${days} days`;
  if (days < 21) return 'a couple of weeks';
  if (days < 45) return 'a few weeks';
  if (days < 75) return 'a month or so';
  return 'a while';
}

/** The first name in a "Firstname Lastname" or "Lastname, Firstname" string. */
export function firstName(full: string | null | undefined): string | null {
  if (!full) return null;
  const cleaned = full.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.includes('@')) return null;
  const [surnameFirst, given] = cleaned.split(',').map((part) => part.trim());
  const candidate = given || surnameFirst;
  const first = candidate.split(' ')[0];
  return /^[\p{L}'-]{2,}$/u.test(first) ? first : null;
}

export function composeFollowUp(input: FollowUpInput): FollowUpDraft {
  const now = input.now ?? new Date();
  const role = input.roleTitle?.trim() || null;
  const greetingName = firstName(input.recipientName);

  const subject = role
    ? `Following up — ${role} at ${input.companyName}`
    : `Following up on my application to ${input.companyName}`;

  const applied = input.appliedAt ? new Date(input.appliedAt) : null;
  const gap = applied && !Number.isNaN(applied.getTime()) ? humanGap(applied, now) : null;

  const opening = role
    ? `I applied for the ${role} role at ${input.companyName}${gap ? ` about ${gap} ago` : ''} and wanted to check in.`
    : `I applied at ${input.companyName}${gap ? ` about ${gap} ago` : ''} and wanted to check in.`;

  // One question, and one that can be answered in a line. "Any update?" is
  // work for the reader; "where is it in the process, and when should I expect
  // to hear" is a sentence back.
  const lines = [
    greetingName ? `Hi ${greetingName},` : 'Hello,',
    '',
    opening,
    '',
    'Could you let me know where the search stands, and when I might expect to hear either way? Happy to send anything else that would be useful.',
    '',
    'Thanks for your time.',
    '',
    input.senderName?.trim() || '',
  ];

  return { subject, body: lines.join('\n').replace(/\n+$/, '\n') };
}

/**
 * A Gmail compose window, already filled in.
 *
 * A draft written through the API would need `gmail.compose` on top of the
 * read-only grant this app asks for, and a reconnect to get it -- a wider key
 * to the mailbox in exchange for saving one click. This opens the same
 * message in Gmail's own composer instead, with `authuser` so a browser signed
 * into several accounts uses the connected one.
 */
export function gmailComposeUrl(opts: {
  emailAddress: string | null | undefined;
  to: string | null;
  subject: string;
  body: string;
}): string {
  const params = new URLSearchParams();
  if (opts.emailAddress) params.set('authuser', opts.emailAddress);
  params.set('view', 'cm');
  params.set('fs', '1');
  params.set('tf', '1');
  if (opts.to) params.set('to', opts.to);
  params.set('su', opts.subject);
  params.set('body', opts.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/** The bare address out of a `Name <a@b.com>` header. */
export function addressOnly(header: string | null | undefined): string | null {
  if (!header) return null;
  const angled = header.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : header).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

/** The display name out of a `Name <a@b.com>` header, if there is one. */
export function displayName(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^\s*"?([^"<]+?)"?\s*</);
  const name = match?.[1]?.trim();
  if (!name || name.includes('@')) return null;
  return name;
}
