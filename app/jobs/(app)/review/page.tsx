import { CheckCheck } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { PageHeader } from '@/components/jobs/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { LeftRail, RailGroup, RailItem } from '@/components/jobs/shell/left-rail';
import { loadReviewQueue, parseReviewView, REVIEW_VIEWS } from '@/lib/jobs/review/load';
import { loadCompanies, loadLinkCandidates } from '@/lib/jobs/inbox/link-candidates';
import { scoreCandidate, type LinkInput } from '@/lib/jobs/email/link';
import { ReviewList } from './list';

export const metadata = { title: 'Review' };

/**
 * The one screen worth designing carefully.
 *
 * This is the app's maintenance cost. Target: subject line, extracted summary,
 * the top three candidate applications with the match reason shown, one click
 * each, fully keyboard navigable.
 *
 * Candidates are scored fresh on every page load rather than stored, so a
 * message held before its application existed becomes linkable the moment it
 * does.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const params = await searchParams;
  const view = parseReviewView(params.view);

  const [{ rows, counts }, candidates, companies, { data: profile }] = await Promise.all([
    loadReviewQueue(supabase, core, user.id),
    loadLinkCandidates(supabase, user.id),
    loadCompanies(supabase, user.id),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  const withCandidates = rows.map((row) => {
    if (row.kind !== 'message') return row;

    const input: LinkInput = {
      threadId: null,
      fromAddress: row.fromAddress,
      replyToAddress: null,
      subject: row.subject,
      bodyPreview: null,
      receivedAt: row.receivedAt ? new Date(row.receivedAt) : null,
      classification: row.classification as LinkInput['classification'],
      extractedCompany: null,
      extractedRole: null,
      extractedAtsJobId: null,
      companyHint: null,
    };

    const scored = candidates
      .map((candidate) => scoreCandidate(input, candidate))
      .filter((entry) => entry.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    // Nothing scored: offer the most recent open pursuits, since the fastest
    // decision is usually "the one I sent on Tuesday".
    const fallback =
      scored.length > 0
        ? scored
        : candidates.slice(0, 3).map((candidate) => ({
            candidate,
            confidence: 0,
            method: 'none' as const,
            reasons: ['No signal matched — offered because it is recent'],
          }));

    return {
      ...row,
      candidates: fallback.map((entry) => ({
        applicationId: entry.candidate.applicationId,
        label: `${entry.candidate.companyName} · ${entry.candidate.roleTitle}`,
        reason: entry.reasons[0] ?? 'Recent pursuit',
        confidence: entry.confidence || null,
      })),
    };
  });

  const filtered =
    view === 'all'
      ? withCandidates
      : withCandidates.filter((row) =>
          view === 'messages'
            ? row.kind === 'message'
            : view === 'applications'
              ? row.kind === 'application'
              : row.kind === 'event',
        );

  if (rows.length === 0) {
    return (
      <>
        <PageHeader
          title="Review"
          description="Everything the inbox could not decide on its own."
        />
        <EmptyState
          icon={CheckCheck}
          title="Nothing to review"
          description="When a message cannot be matched confidently, it is held here rather than guessed at. An empty queue means the pipeline is current."
          action={{ label: 'Back to the pipeline', href: '/jobs/pipeline' }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Review"
        description={`${counts.all} waiting. Holding rather than guessing is what keeps the funnel worth reading.`}
      />

      <div className="flex gap-6">
        <LeftRail>
          <RailGroup label="Kind">
            {REVIEW_VIEWS.map((entry) => (
              <RailItem
                key={entry.id}
                label={entry.label}
                href={entry.id === 'all' ? '/jobs/review' : `/jobs/review?view=${entry.id}`}
                active={view === entry.id}
                count={counts[entry.id]}
              />
            ))}
          </RailGroup>
          <p className="px-1 text-[11px] leading-relaxed text-ink-faint">
            Bodies are never stored, so each row links out to Gmail for the full message.
          </p>
        </LeftRail>

        <div className="min-w-0 flex-1">
          <ReviewList
            rows={filtered}
            timezone={(profile?.timezone as string) ?? 'UTC'}
            companyCount={companies.length}
          />
        </div>
      </div>
    </>
  );
}
