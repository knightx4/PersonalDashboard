import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { loadCompanies, loadLinkCandidates } from '@/lib/jobs/inbox/link-candidates';
import { scoreCandidate, type LinkCandidate, type LinkInput } from '@/lib/jobs/email/link';
import {
  loadReviewQueue,
  type ReviewCandidate,
  type ReviewCounts,
  type ReviewMessageRow,
  type ReviewRow,
  type SearchableRole,
} from '@/lib/jobs/review/load';

/**
 * The review rows with what each needs to be acted on, for any page that
 * shows them: the Review page and the Jobs Inbox (plan #2502).
 *
 * Candidates are scored fresh on every load rather than stored, so a message
 * held before its application existed becomes linkable the moment it does.
 */
export interface ReviewItems {
  rows: ReviewRow[];
  counts: ReviewCounts;
  /** Every company on file, so starting a new role from a message is a pick. */
  companyNames: string[];
  /** Every pursuit on file, for linking to one the top three did not offer. */
  allRoles: SearchableRole[];
}

export async function loadReviewItems(
  supabase: AppSupabaseClient,
  core: CoreSupabaseClient,
  userId: string,
): Promise<ReviewItems> {
  const [{ rows, counts }, candidates, companies] = await Promise.all([
    loadReviewQueue(supabase, core, userId),
    loadLinkCandidates(supabase, userId),
    loadCompanies(supabase, userId),
  ]);
  return {
    rows: withLinkCandidates(rows, candidates),
    counts,
    companyNames: companies.map((company) => company.name).sort(),
    allRoles: searchableRoles(candidates),
  };
}

/** Each held message with its top three candidates filled in. */
export function withLinkCandidates(
  rows: ReviewRow[],
  candidates: LinkCandidate[],
): ReviewRow[] {
  return rows.map((row) =>
    row.kind === 'message' ? { ...row, candidates: rankLinkCandidates(row, candidates) } : row,
  );
}

/**
 * The three pursuits a held message most likely belongs to, best first.
 * With nothing scored it offers the most recent open pursuits, since the
 * fastest decision is usually "the one I sent on Tuesday".
 */
export function rankLinkCandidates(
  row: ReviewMessageRow,
  candidates: LinkCandidate[],
): ReviewCandidate[] {
  // Everything the held message still has. Bodies are never stored, but the
  // thread id, reply-to and the role title the message named are on the row,
  // and scoring without them offered worse suggestions than the mailbox
  // supports.
  const input: LinkInput = {
    threadId: row.threadId,
    fromAddress: row.fromAddress,
    replyToAddress: row.replyToAddress,
    subject: row.subject,
    bodyPreview: null,
    receivedAt: row.receivedAt ? new Date(row.receivedAt) : null,
    classification: row.classification as LinkInput['classification'],
    extractedCompany: null,
    // The role the message named, kept when it was ingested, so two roles at
    // one company are told apart (note b48d2b61).
    extractedRole: row.roleHint,
    extractedAtsJobId: null,
    companyHint: null,
  };

  const scored = candidates
    .map((candidate) => scoreCandidate(input, candidate))
    .filter((entry) => entry.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  const offered =
    scored.length > 0
      ? scored
      : candidates.slice(0, 3).map((candidate) => ({
          candidate,
          confidence: 0,
          method: 'none' as const,
          reasons: ['No signal matched — offered because it is recent'],
        }));

  return offered.map((entry) => ({
    applicationId: entry.candidate.applicationId,
    label: `${entry.candidate.companyName} · ${entry.candidate.roleTitle}`,
    reason: entry.reasons[0] ?? 'Recent pursuit',
    confidence: entry.confidence || null,
  }));
}

/**
 * Every pursuit on file, for the "some other role" search, by company then
 * title. The same rows the scorer ranks against the message, so a role the
 * top three missed is still one keystroke away rather than a page away.
 */
export function searchableRoles(candidates: LinkCandidate[]): SearchableRole[] {
  return candidates
    .map((candidate) => ({
      applicationId: candidate.applicationId,
      companyName: candidate.companyName,
      roleTitle: candidate.roleTitle,
      status: candidate.status,
      everSubmitted: candidate.submittedAt !== null,
    }))
    .sort(
      (a, b) =>
        a.companyName.localeCompare(b.companyName) || a.roleTitle.localeCompare(b.roleTitle),
    );
}
