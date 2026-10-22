import { domainFromAddress, isKnownAtsSender } from '@/lib/jobs/email/ats-senders';
import { usableCompanyName } from '@/lib/jobs/email/link';

/**
 * The company and role the "new role" form under a held message starts
 * with. Both stay editable; a guess offered for correction is faster than an
 * empty pair of boxes.
 *
 * Mail from an applicant tracking system names the tracker in its sender
 * ("no-reply@greenhouse.io"), so the sender is never the employer there.
 * The subject usually carries both instead ("Your application to Tallow —
 * Backend Engineer, Payments"). When nothing names the employer, Company is
 * left blank rather than filled with the tracker's name.
 */
export type NewRoleGuess = { company: string; title: string };

const REPLY_PREFIX = /^\s*((re|fwd|fw)\s*:\s*)+/i;

/** Phrases ATS mail puts in front of the employer's name. */
const LEADS = [
  /^your application (?:to|for|with|at)\s+/i,
  /^thank you for (?:applying|your application|your interest) (?:to|at|in|with)\s+/i,
  /^thanks for (?:applying|your application|your interest) (?:to|at|in|with)\s+/i,
  /^application (?:received|submitted|confirmation)\s*(?:[:\-–—]|for|at)\s*/i,
  /^we(?:'ve| have) received your application (?:to|for|at)\s+/i,
];

/** Separators between employer and role in a subject. */
const SPLIT = /\s+[—–-]\s+|\s*:\s+|\s*\|\s*/;

export function guessNewRole(input: {
  fromAddress: string | null;
  subject: string | null;
}): NewRoleGuess {
  const subject = (input.subject ?? '').replace(REPLY_PREFIX, '').trim();
  const domain = domainFromAddress(input.fromAddress);

  if (!isKnownAtsSender(domain)) {
    const display = input.fromAddress?.match(/^\s*"?([^"<]+?)"?\s*</)?.[1];
    return {
      company: usableCompanyName(display) ?? usableCompanyName(domain) ?? '',
      title: subject.slice(0, 200),
    };
  }

  const fromSubject = splitAtsSubject(subject);
  return {
    company: fromSubject?.company ?? '',
    title: (fromSubject?.title ?? subject).slice(0, 200),
  };
}

/** "Your application to Tallow — Backend Engineer" → Tallow / Backend Engineer. */
function splitAtsSubject(subject: string): NewRoleGuess | null {
  let rest = subject;
  let led = false;
  for (const lead of LEADS) {
    if (lead.test(rest)) {
      rest = rest.replace(lead, '');
      led = true;
      break;
    }
  }

  // "Backend Engineer at Tallow"
  const at = rest.match(/^(.+?)\s+at\s+(.+)$/i);
  if (at && !SPLIT.test(rest)) {
    const company = usableCompanyName(at[2]!.replace(/[.!]+$/, ''));
    if (company) return { company, title: at[1]!.trim() };
  }

  const parts = rest.split(SPLIT).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const company = usableCompanyName(parts[0]);
    if (company) return { company, title: parts.slice(1).join(' - ') };
  }
  if (led && parts.length === 1) {
    const company = usableCompanyName(parts[0]!.replace(/[.!]+$/, ''));
    if (company) return { company, title: '' };
  }
  return null;
}
