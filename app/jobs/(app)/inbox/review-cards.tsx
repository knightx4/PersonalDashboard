import type { InboxRow } from '@/components/inbox/inbox-page';
import type { MessageOpen } from '@/components/jobs/review/rows';
import { toggleChipClass } from '@/components/ui/chip';
import Link from '@/components/ui/link';
import type { ReviewItems } from '@/lib/jobs/review/candidates';
import type { ReviewView } from '@/lib/jobs/review/load';
import {
  reviewRowKey,
  reviewRowLabel,
  reviewRowsInView,
  reviewViewIn,
  reviewViewsShown,
} from '@/lib/jobs/review/bulk';
import { ReviewInboxRow } from './review-row';

/** Where the Jobs Inbox lists one kind of import, or every kind. */
export function jobsInboxViewHref(view: ReviewView): string {
  return view === 'all' ? '/jobs/inbox' : `/jobs/inbox?view=${view}`;
}

/**
 * The Jobs Inbox's To review rows: every item the mail sync held, each drawn
 * with its own buttons (plan #2502.2). Since plan #1496.7.3 the Inbox lists
 * them all, narrowed by kind as the Review page was, and Review is gone.
 * Shared by the page and its gallery surfaces.
 */
export function reviewInboxRows(
  items: Pick<ReviewItems, 'rows' | 'counts' | 'companyNames' | 'allRoles'>,
  timezone: string,
  view: ReviewView = 'all',
  gallery: { open?: Record<string, MessageOpen>; failed?: Record<string, string> } = {},
): InboxRow[] {
  return reviewRowsInView(items.rows, reviewViewIn(view, items.counts)).map((row) => {
    const key = reviewRowKey(row);
    return {
      ref: `review:${key}`,
      section: 'review',
      title: reviewRowLabel(row),
      move: { state: 'on_you' },
      card: (
        <ReviewInboxRow
          key={key}
          row={row}
          timezone={timezone}
          companyNames={items.companyNames}
          allRoles={items.allRoles}
          startOpen={gallery.open?.[key]}
          failed={gallery.failed?.[key]}
        />
      ),
    };
  });
}

/**
 * The kinds the To review rows are narrowed by, as chips that are addresses,
 * under the section's heading. Nothing when every item is one kind.
 */
export function ReviewViewChips({ counts, view }: { counts: ReviewItems['counts']; view: ReviewView }) {
  const views = reviewViewsShown(counts);
  if (views.length === 0) return null;
  const current = reviewViewIn(view, counts);
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Narrow by kind">
      {views.map((entry) => (
        <Link
          key={entry.id}
          href={jobsInboxViewHref(entry.id)}
          scroll={false}
          aria-current={entry.id === current ? 'page' : undefined}
          className={toggleChipClass(entry.id === current)}
        >
          {entry.label}
          <span className="tabular font-normal">{entry.count}</span>
        </Link>
      ))}
    </nav>
  );
}
