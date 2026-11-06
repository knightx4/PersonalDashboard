import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HomeFold } from '@/app/home/home-fold';
import { InboxPage, type InboxRow } from '@/components/inbox/inbox-page';
import { WORKSPACE_INBOX_EMPTY } from '@/components/inbox/workspace-inbox';
import { DashMark } from '@/components/ui/dash-mark';
import Link from '@/components/ui/link';
import { LinkPending } from '@/components/ui/link-pending';
import { Tooltip } from '@/components/ui/tooltip';
import { ReviewLines, type ReviewLine } from './review-lines';

/**
 * The two folds News's Now draws (plan #1496.10), as plain views with no
 * reads, so the gallery can draw them from fixtures. now-folds.tsx loads the
 * rows and places them.
 */

export type ReviewDayLink = { href: string; label: string };

export type NewsReviewFoldProps = {
  review: {
    /** "Tuesday 6 October". */
    dayLabel: string;
    /** "8:04 PM", when Dash wrote it. */
    writtenAt: string;
    /** Null when that evening's run failed. */
    overview: string | null;
    lines: ReviewLine[];
    /** A failed run on this evening that will be tried again before midnight. */
    retrying?: boolean;
  };
  earlier: ReviewDayLink | null;
  later: ReviewDayLink | null;
  /** "8:00 PM" while today's review is still to come. */
  todayAt: string | null;
};

/** The evening review: Dash's overview, then the stories one line each. */
export function NewsReviewFold({ review, earlier, later, todayAt }: NewsReviewFoldProps) {
  const count = review.lines.length === 1 ? '1 story' : `${review.lines.length} stories`;
  return (
    <HomeFold
      id="daily-review"
      title="Daily review"
      count={review.overview ? count : review.retrying ? 'not written, trying again' : 'not written'}
    >
      <div className="-mt-1 mb-2 flex items-center justify-between gap-2">
        <span className="text-ui font-semibold text-ink">{review.dayLabel}</span>
        <DayArrows earlier={earlier} later={later} />
      </div>
      {review.overview ? (
        <>
          <div className="flex items-center gap-2">
            <DashMark size="sm" tone="brand" decorative />
            <span className="text-ui font-semibold text-ink">Dash</span>
            <span className="text-small text-ink-muted">written {review.writtenAt}</span>
          </div>
          <p className="mt-2 max-w-prose break-words text-body leading-relaxed text-ink">
            {review.overview}
          </p>
          {todayAt && (
            <p className="mt-2 text-small text-ink-muted">Today&apos;s is written at {todayAt}.</p>
          )}
          {review.lines.length > 0 && (
            <div className="mt-3 border-t border-border">
              <ReviewLines lines={review.lines} />
            </div>
          )}
        </>
      ) : (
        <div className="flex items-start gap-3">
          <DashMark state="failed" size="sm" decorative className="mt-0.5 text-danger" />
          <p className="text-body text-ink">
            Dash could not write this review.
            {review.retrying && ' It tries again on the hour until midnight.'}
          </p>
        </div>
      )}
    </HomeFold>
  );
}

/** The day before and after that has a review; an end with none keeps a faint, dead arrow. */
function DayArrows({ earlier, later }: { earlier: ReviewDayLink | null; later: ReviewDayLink | null }) {
  const shape = 'press-area inline-flex size-8 items-center justify-center rounded-control text-ink-muted';
  const arrow = (link: ReviewDayLink | null, dir: 'earlier' | 'later') => {
    const Icon = dir === 'earlier' ? ChevronLeft : ChevronRight;
    if (!link) {
      return (
        <span aria-hidden className={`${shape} opacity-40`}>
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
      );
    }
    return (
      <Tooltip label={`Review for ${link.label}`} align={dir === 'later' ? 'end' : undefined}>
        <Link href={link.href} className={`${shape} hover:text-ink`} aria-label={`Review for ${link.label}`}>
          <Icon className="size-4" strokeWidth={1.75} aria-hidden />
          <LinkPending />
        </Link>
      </Tooltip>
    );
  };
  return (
    <nav aria-label="Other days" className="flex items-center">
      {arrow(earlier, 'earlier')}
      {arrow(later, 'later')}
    </nav>
  );
}

/** What in News is on you. Left out on a day with nothing, as the Dash fold is. */
export function NewsInboxFold({ rows }: { rows: readonly InboxRow[] }) {
  return (
    <HomeFold id="news-inbox" title="Inbox" count={`${rows.reduce((sum, row) => sum + (row.stands ?? 1), 0)} on you`}>
      <InboxPage rows={rows} empty={WORKSPACE_INBOX_EMPTY.news} inFold />
    </HomeFold>
  );
}

