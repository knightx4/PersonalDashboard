import type { InboxRow } from '@/components/inbox/inbox-page';
import type { MessageOpen } from '@/components/jobs/review/rows';
import type { ReviewItems } from '@/lib/jobs/review/candidates';
import { inboxReviewHead, reviewRowKey, reviewRowLabel } from '@/lib/jobs/review/bulk';
import { ReviewInboxRow } from './review-row';

/**
 * The Jobs Inbox's To review rows (plan #2502.2): the first five items the
 * mail sync held, each drawn with its own buttons, then one row opening the
 * rest in Review. That row stands for every item it leaves out, so the
 * section's count and the page's total still count them all. Shared by the
 * page and its gallery surfaces.
 */
export function reviewInboxRows(
  items: Pick<ReviewItems, 'rows' | 'counts' | 'companyNames' | 'allRoles'>,
  timezone: string,
  gallery: { open?: Record<string, MessageOpen>; failed?: Record<string, string> } = {},
): InboxRow[] {
  const { shown, rest } = inboxReviewHead(items.rows, items.counts.all);
  const rows: InboxRow[] = shown.map((row) => {
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
  if (rest > 0) {
    rows.push({
      ref: 'queue:jobs-review',
      section: 'review',
      title: `Open all ${items.counts.all} in Review`,
      line: `${rest} more ${rest === 1 ? 'is' : 'are'} waiting after these`,
      href: '/jobs/review',
      move: { state: 'on_you' },
      stands: rest,
    });
  }
  return rows;
}
