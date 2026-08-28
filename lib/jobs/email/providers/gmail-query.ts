import { ATS_DOMAINS } from '@/lib/jobs/email/ats-senders';

/**
 * Gmail search for likely recruiting mail within the backfill window.
 *
 * Two queries, not one, and the second is the important one.
 *
 * The first is the obvious pass: ATS sender domains plus application-shaped
 * subjects. It catches nearly all of the automated volume.
 *
 * The second exists because the class this app most wants to catch is the class
 * keyword search handles worst. A recruiter emailing from a company address with
 * the subject "quick question" matches nothing in the first query. Running a
 * second pass over the domains of companies the user already tracks catches
 * those, cheaply, and the review queue accepts a manually forwarded message for
 * everything else. Coverage here is partial and the UI says so rather than
 * implying it is complete.
 *
 * `category:promotions` is deliberately NOT excluded: legitimate recruiting mail
 * lands there routinely, and a missed rejection is invisible.
 */

const SUBJECT_TERMS = [
  'your application',
  'application received',
  'thank you for applying',
  'application to',
  'we received your application',
  'interview',
  'next steps',
  'your candidacy',
  'moving forward',
  'the role',
  'opportunity at',
  'recruiter',
  'phone screen',
  'take-home',
  'assessment',
  'offer',
];

function clampDays(days: number): number {
  return Math.min(730, Math.max(30, Math.round(days)));
}

export function recruitingCandidateQuery(backfillWindowDays: number): string {
  const days = clampDays(backfillWindowDays);
  const from = `from:(${ATS_DOMAINS.join(' OR ')})`;
  const subjects = `subject:(${SUBJECT_TERMS.map((t) => `"${t}"`).join(' OR ')})`;
  return `newer_than:${days}d (${from} OR ${subjects})`;
}

/**
 * The direct-outreach pass. Returns null when the user tracks no companies yet,
 * because `from:()` with an empty list is a syntax error and a query that
 * matches everything is worse than no query.
 */
export function companyDomainQuery(
  domains: readonly string[],
  backfillWindowDays: number,
): string | null {
  const cleaned = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length === 0) return null;
  // Gmail's query length is finite; the most recently added companies matter most.
  const capped = cleaned.slice(0, 60);
  return `newer_than:${clampDays(backfillWindowDays)}d from:(${capped.join(' OR ')})`;
}

/** Bounded catch-up when the Gmail historyId cursor has expired. */
export function incrementalFallbackQuery(lastSyncedAt: string | null, now = new Date()): string {
  const fallbackDays = 7;
  let days = fallbackDays;
  if (lastSyncedAt) {
    const synced = new Date(lastSyncedAt);
    if (Number.isFinite(synced.getTime())) {
      const elapsed = Math.ceil((now.getTime() - synced.getTime()) / (24 * 60 * 60 * 1000));
      days = Math.min(30, Math.max(fallbackDays, elapsed + 1));
    }
  }
  return recruitingCandidateQuery(days);
}
