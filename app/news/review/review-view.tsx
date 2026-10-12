import Link from 'next/link';
import { ChevronLeft, ChevronRight, Newspaper } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashMark } from '@/components/ui/dash-mark';
import { EmptyState } from '@/components/ui/empty-state';
import { LinkPending } from '@/components/ui/link-pending';
import { cn } from '@/lib/cn';
import { ReviewLines, type ReviewLine } from './review-lines';

/** A neighbouring day with a review: where its arrow goes and what it is called. */
export type ReviewDayLink = { href: string; label: string };

export type ReviewViewProps = {
  /** The day shown, or null before the first review is written. */
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
  } | null;
  earlier: ReviewDayLink | null;
  later: ReviewDayLink | null;
  /** "8:00 PM" while today's review is still to come, so the page can say when. */
  todayAt: string | null;
};

/**
 * The Daily review tab (plan #1616, under #1612), split from the page so the
 * preview gallery can draw it from fixtures. Loading the rows and formatting
 * the dates stay in page.tsx.
 *
 * One day at a time: Dash's overview, then the stories one line each. The
 * arrows beside the heading step to the day before and after that has a
 * review, and each day has its own address (`?day=`), so a day can be
 * reopened or linked.
 */
export function ReviewView({ review, earlier, later, todayAt }: ReviewViewProps) {
  if (!review) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Daily review" />
        <EmptyState
          icon={Newspaper}
          title="No review yet"
          description={`Each evening at ${todayAt ?? '8:00 PM'} Dash writes up the day's newsletters here: a few sentences on what happened, then the most important stories one line each.`}
          action={{ label: 'Go to Quick read', href: '/news' }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Daily review"
        description={
          todayAt ? `${review.dayLabel}. Today's is written at ${todayAt}.` : review.dayLabel
        }
        actions={<DayArrows earlier={earlier} later={later} />}
      />
      <Card padding="standard">
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
              Dash could not write this evening&apos;s review.
              {review.retrying && ' It tries again on the hour until midnight.'}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Back to the day before and on to the day after. An end with no further day
 * keeps its arrow, drawn faint and not pressable, so the other one does not
 * move under your thumb.
 */
function DayArrows({
  earlier,
  later,
}: {
  earlier: ReviewDayLink | null;
  later: ReviewDayLink | null;
}) {
  const shape = cn(buttonVariants({ variant: 'secondary', size: 'md' }), 'w-(--control-h) px-0');
  return (
    <nav aria-label="Other days" className="flex items-center gap-2">
      {earlier ? (
        <Link href={earlier.href} className={shape} aria-label={`Review for ${earlier.label}`} title={earlier.label}>
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          <LinkPending />
        </Link>
      ) : (
        <span aria-hidden className={cn(shape, 'opacity-40')}>
          <ChevronLeft className="size-4" strokeWidth={1.75} />
        </span>
      )}
      {later ? (
        <Link href={later.href} className={shape} aria-label={`Review for ${later.label}`} title={later.label}>
          <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
          <LinkPending />
        </Link>
      ) : (
        <span aria-hidden className={cn(shape, 'opacity-40')}>
          <ChevronRight className="size-4" strokeWidth={1.75} />
        </span>
      )}
    </nav>
  );
}
