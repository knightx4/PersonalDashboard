/**
 * The ATS sender table. The cheapest accuracy in the project.
 *
 * Shopping Manager's Tier A classifier leans on one fact: the sender domain
 * identifies the merchant. Here that fact does not hold. Recruiting mail
 * overwhelmingly arrives from ATS infrastructure, so `no-reply@greenhouse.io`
 * tells you the vendor and nothing whatsoever about the employer. The company
 * name lives in the subject, the body, the reply-to, or a per-customer
 * subdomain, and which one varies by vendor and by configuration.
 *
 * So Tier A splits in two: which ATS sent this (deterministic, and this table
 * is the whole implementation) and which company it concerns (not
 * deterministic, and the linker's problem).
 */

export type AtsVendor =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'icims'
  | 'smartrecruiters'
  | 'workable'
  | 'taleo'
  | 'jobvite'
  | 'bamboohr'
  | 'breezy'
  | 'recruitee'
  | 'rippling'
  | 'wellfound'
  | 'linkedin'
  | 'indeed'
  | 'other'
  | 'unknown';

export interface AtsSender {
  vendor: AtsVendor;
  domains: readonly string[];
  /** Scheduling tools are not an ATS, but they carry the interview invites. */
  scheduling?: boolean;
}

export const ATS_SENDERS: readonly AtsSender[] = [
  { vendor: 'greenhouse', domains: ['greenhouse.io', 'us.greenhouse-mail.io', 'my.greenhouse.io', 'greenhouse-mail.io'] },
  { vendor: 'lever', domains: ['hire.lever.co', 'lever.co'] },
  { vendor: 'ashby', domains: ['ashbyhq.com'] },
  { vendor: 'workday', domains: ['myworkday.com', 'myworkdayjobs.com', 'workday.com'] },
  { vendor: 'icims', domains: ['icims.com'] },
  { vendor: 'smartrecruiters', domains: ['smartrecruiters.com'] },
  { vendor: 'workable', domains: ['workable.com', 'workablemail.com'] },
  { vendor: 'taleo', domains: ['taleo.net', 'oraclecloud.com'] },
  { vendor: 'jobvite', domains: ['jobvite.com'] },
  { vendor: 'bamboohr', domains: ['bamboohr.com'] },
  { vendor: 'breezy', domains: ['breezy.hr'] },
  { vendor: 'recruitee', domains: ['recruitee.com'] },
  // Sourcing and recruiting CRMs. Not an ATS, but the same thing matters: mail
  // sent through them is recruiting mail, and their domain is never the
  // employer's. gem.com was recorded as a company's own domain, which would
  // have pointed every other Gem customer's mail at that one company.
  { vendor: 'other', domains: ['gem.com', 'ashbyhq.com', 'paradox.ai', 'hirevue.com', 'seekout.com', 'teamable.com'] },
  { vendor: 'rippling', domains: ['rippling.com'] },
  { vendor: 'wellfound', domains: ['wellfound.com', 'angel.co'] },
  { vendor: 'linkedin', domains: ['linkedin.com'] },
  // Indeed is deliberately absent -- see IGNORED_SENDER_DOMAINS below.
  // Listed because an interview invite frequently arrives from the scheduler
  // rather than the ATS, and treating those as unknown senders loses the
  // single most time-sensitive class of message in the app.
  { vendor: 'other', domains: ['calendly.com', 'goodtime.io', 'modernloop.com', 'prelude.co', 'hi.rippling.com'], scheduling: true },
];

/**
 * Senders whose mail is never about your own applications.
 *
 * Indeed is the whole list. What it sends is suggested jobs and alerts about
 * roles you have not applied to, and one of them reached the pipeline as
 * though it were a pursuit. Its volume is also large enough that fetching it
 * costs real money in bodies and model calls for nothing.
 *
 * Enforced in two places on purpose: these domains are left out of the Gmail
 * query so the mail is never fetched, and the classifier drops them outright
 * so anything arriving by another route -- the second query over company
 * domains, a forward, a message already stored from an earlier sync -- is
 * still discarded rather than reaching the review queue.
 *
 * The cost of this is Indeed Apply confirmations, which do concern real
 * applications. Those are worth less than the noise is worth avoiding: the
 * employer sends its own acknowledgement in almost every case, and that one
 * comes from a domain worth reading.
 */
export const IGNORED_SENDER_DOMAINS: readonly string[] = [
  'indeed.com',
  'indeedemail.com',
  'match.indeed.com',
  'alerts.indeed.com',
];

export function isIgnoredSender(domain: string | null): boolean {
  if (!domain) return false;
  const needle = domain.toLowerCase();
  return IGNORED_SENDER_DOMAINS.some(
    (entry) => needle === entry || needle.endsWith(`.${entry}`),
  );
}

/** Every ATS domain, for the Gmail candidate query. */
export const ATS_DOMAINS: readonly string[] = ATS_SENDERS.flatMap((s) => s.domains);

const SCHEDULING_DOMAINS = new Set(
  ATS_SENDERS.filter((s) => s.scheduling).flatMap((s) => s.domains),
);

export function domainFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const match = address.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  return match?.[1] ?? null;
}

function domainMatches(domain: string, needle: string): boolean {
  return domain === needle || domain.endsWith(`.${needle}`);
}

/** Which ATS sent this. Deterministic, and the easy half of Tier A. */
export function atsVendorForDomain(domain: string | null): AtsVendor {
  if (!domain) return 'unknown';
  for (const sender of ATS_SENDERS) {
    if (sender.scheduling) continue;
    if (sender.domains.some((d) => domainMatches(domain, d))) return sender.vendor;
  }
  return 'unknown';
}

export function isSchedulingSender(domain: string | null): boolean {
  if (!domain) return false;
  for (const needle of SCHEDULING_DOMAINS) {
    if (domainMatches(domain, needle)) return true;
  }
  return false;
}

export function isKnownAtsSender(domain: string | null): boolean {
  return atsVendorForDomain(domain) !== 'unknown' || isSchedulingSender(domain);
}

/**
 * Some vendors put the employer in a per-customer subdomain
 * (`acme.greenhouse.io`, `acme.myworkdayjobs.com`). When they do, that is a far
 * better company signal than anything in the body, so it is worth extracting
 * before falling back to string matching.
 */
const VENDOR_SUBDOMAINS = new Set([
  'us',
  'my',
  'hire',
  'mail',
  'email',
  'em',
  'www',
  'no-reply',
  'noreply',
  'donotreply',
  'do-not-reply',
  'reply',
  'bounce',
  'bounces',
  'candidates',
  'candidate',
  'notifications',
  'notification',
  'notify',
  'jobs',
  'job',
  'careers',
  'career',
  'apply',
  'application',
  'applications',
  'recruiting',
  'recruit',
  'recruitment',
  'talent',
  'hiring',
  'people',
  'info',
  'support',
  'help',
  'smtp',
  'mailer',
  'send',
  'track',
  'link',
  'links',
  'app',
  'apps',
  'go',
  'gh-mail',
]);

export function companyHintFromSubdomain(domain: string | null): string | null {
  if (!domain) return null;
  for (const sender of ATS_SENDERS) {
    for (const base of sender.domains) {
      if (domain.endsWith(`.${base}`)) {
        const prefix = domain.slice(0, -(base.length + 1));
        const first = prefix.split('.')[0];
        // The vendor's own infrastructure, not a customer.
        //
        // This list is the difference between reading `ramp.greenhouse.io` as
        // Ramp and reading `candidates.workablemail.com` as a company called
        // Candidates -- which then goes on to collect every other employer's
        // mail that fails to resolve, because it looks like a real record.
        if (!first || VENDOR_SUBDOMAINS.has(first)) return null;
        return first;
      }
    }
  }
  return null;
}
