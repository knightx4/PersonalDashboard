import { CheckCheck } from 'lucide-react';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { parseReviewView } from '@/lib/jobs/review/load';
import { loadReviewItems } from '@/lib/jobs/review/candidates';
import { ReviewQueue } from './list';
import { PageWide } from '@/components/shell/page-width';

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
 * does (lib/jobs/review/candidates.ts).
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

  // Candidates are scored in the loader, which the Jobs Inbox shares.
  const [{ rows, counts, companyNames, allRoles }, { data: profile }] = await Promise.all([
    loadReviewItems(supabase, core, user.id),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  const filtered =
    view === 'all'
      ? rows
      : rows.filter((row) =>
          view === 'messages'
            ? row.kind === 'message'
            : view === 'applications'
              ? row.kind === 'application'
              : row.kind === 'event',
        );

  if (rows.length === 0) {
    return (
      <PageWide>
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
      </PageWide>
    );
  }

  return (
    <PageWide>
      <ReviewQueue
        rows={filtered}
        counts={counts}
        view={view}
        timezone={(profile?.timezone as string) ?? 'UTC'}
        companyNames={companyNames}
        allRoles={allRoles}
      />
    </PageWide>
  );
}
