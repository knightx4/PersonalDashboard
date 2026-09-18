import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import {
  filterReviewRows,
  loadReviewQueue,
  parseReviewView,
  REVIEW_VIEWS,
  type ReviewView,
} from '@/lib/review/load';
import { ReviewQueue } from './review-list';

export const metadata = { title: 'Review' };

function reviewHref(view: ReviewView): string {
  if (view === 'all') return '/shopping/review';
  return `/shopping/review?view=${view}`;
}

/**
 * Everything that failed a guardrail or was imported with the heuristic
 * fallback. Nothing is discarded automatically — uncertain rows wait here.
 *
 * The queue itself is a client component, because the rows can be selected and
 * the page header becomes the action bar for what is ticked.
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

  const { rows: allRows, counts } = await loadReviewQueue(supabase, core, user.id);
  const rows = filterReviewRows(allRows, view);

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <LeftRail>
        <RailGroup label="Queue">
          {REVIEW_VIEWS.map((entry) => (
            <RailItem
              key={entry.id}
              label={`${entry.label}${counts[entry.id] ? ` (${counts[entry.id]})` : ''}`}
              active={entry.id === view}
              href={reviewHref(entry.id)}
            />
          ))}
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <ReviewQueue
          rows={rows}
          view={view}
          seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:review`}
        />
      </div>
    </div>
  );
}
