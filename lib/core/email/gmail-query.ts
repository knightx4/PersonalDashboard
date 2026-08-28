import { ATS_DOMAINS } from '@/lib/jobs/email/ats-senders';
import { ORDER_SUBJECT_TERMS } from '@/lib/email/providers/gmail-query';
import { RECRUITING_SUBJECT_TERMS } from '@/lib/jobs/email/providers/gmail-query';

export { companyDomainQuery } from '@/lib/jobs/email/providers/gmail-query';

/**
 * One Gmail search for both workspaces.
 *
 * The two apps used to run their own searches over the same mailbox, which
 * meant every message either of them wanted was fetched twice and the metadata
 * parsed twice. This asks for the union instead: commerce's order-shaped
 * subjects, plus the ATS sender domains and application-shaped subjects the job
 * side looks for.
 *
 * It stays a union of keywords rather than "everything in the window" on
 * purpose. Fetching every message would have better recall, but it multiplies
 * the volume reaching Tier B, and Tier B is the part that costs money per
 * message. What keyword search misses -- a recruiter mailing from a company
 * address with the subject "quick question" -- is covered by the second pass
 * below, over domains the user already tracks.
 *
 * Both term lists are owned by their own workspace and imported here, so
 * neither has to know this file exists to add a keyword.
 */
function clampDays(days: number): number {
  return Math.min(730, Math.max(30, Math.round(days)));
}

export function candidateQuery(backfillWindowDays: number): string {
  const days = clampDays(backfillWindowDays);
  const orders = ORDER_SUBJECT_TERMS.map((t) => `subject:${t}`).join(' OR ');
  const ats = `from:(${ATS_DOMAINS.join(' OR ')})`;
  const recruiting = `subject:(${RECRUITING_SUBJECT_TERMS.map((t) => `"${t}"`).join(' OR ')})`;
  return `newer_than:${days}d (${orders} OR ${ats} OR ${recruiting})`;
}

/**
 * Bounded catch-up for when the Gmail historyId cursor has expired.
 *
 * The incremental path normally works from historyId, which returns everything
 * new regardless of query -- so the union above only matters for the backfill
 * and for this fallback.
 */
export function incrementalFallbackQuery(lastSyncedAt: string | null, now = new Date()): string {
  const fallbackDays = 7;
  let days = fallbackDays;
  if (lastSyncedAt) {
    const synced = new Date(lastSyncedAt);
    if (Number.isFinite(synced.getTime())) {
      const elapsed = Math.ceil((now.getTime() - synced.getTime()) / (24 * 60 * 60 * 1000));
      // One extra day of cushion; clamp to a sane window.
      days = Math.min(30, Math.max(fallbackDays, elapsed + 1));
    }
  }
  return candidateQuery(days);
}
