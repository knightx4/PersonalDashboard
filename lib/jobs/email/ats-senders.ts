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
  { vendor: 'rippling', domains: ['rippling.com'] },
  { vendor: 'wellfound', domains: ['wellfound.com', 'angel.co'] },
  { vendor: 'linkedin', domains: ['linkedin.com'] },
  { vendor: 'indeed', domains: ['indeed.com'] },
  // Listed because an interview invite frequently arrives from the scheduler
  // rather than the ATS, and treating those as unknown senders loses the
  // single most time-sensitive class of message in the app.
  { vendor: 'other', domains: ['calendly.com', 'goodtime.io', 'modernloop.com', 'prelude.co', 'hi.rippling.com'], scheduling: true },
];

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
export function companyHintFromSubdomain(domain: string | null): string | null {
  if (!domain) return null;
  for (const sender of ATS_SENDERS) {
    for (const base of sender.domains) {
      if (domain.endsWith(`.${base}`)) {
        const prefix = domain.slice(0, -(base.length + 1));
        const first = prefix.split('.')[0];
        // 'us', 'my', 'hire', 'mail' are the vendor's own infrastructure.
        if (!first || ['us', 'my', 'hire', 'mail', 'email', 'www', 'no-reply'].includes(first)) {
          return null;
        }
        return first;
      }
    }
  }
  return null;
}
