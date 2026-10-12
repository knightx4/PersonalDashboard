import Link from 'next/link';
import { Inbox } from 'lucide-react';
import type { ReviewPeek } from '@/lib/jobs/today/review-peek';
import { buttonVariants } from '@/components/ui/button';

/** The queue's own page, which has left the tab bar but kept its address. */
export const REVIEW_HREF = '/jobs/review';

/**
 * The review queue as a strip at the top of Today (decision #1586).
 *
 * Imports the inbox could not place on its own: how many, the first few, and
 * one press to the queue. Nothing at all when the queue is empty, since a
 * strip saying "0 to check" is a tab badge reading zero (law 1).
 */
export function ReviewStrip({ review }: { review: ReviewPeek }) {
  if (review.count === 0) return null;
  const rest = review.count - review.items.length;

  return (
    <section
      aria-labelledby="review-heading"
      className="flex flex-col gap-x-4 gap-y-2 rounded-card bg-caution-tint px-4 py-3 sm:flex-row sm:items-start"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <h2 id="review-heading" className="flex items-center gap-1.5 text-ui font-semibold text-ink">
          <Inbox className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {review.count === 1
            ? '1 import is waiting to be checked'
            : `${review.count} imports are waiting to be checked`}
        </h2>
        <ul className="space-y-0.5">
          {review.items.map((item) => (
            <li key={item.id} className="flex min-w-0 items-baseline gap-x-2 text-small">
              <span className="min-w-0 truncate text-ink">{item.title}</span>
              {/* On a phone the kind took the width the subject needed, and
                  the subject is what says which email it is. */}
              <span className="shrink-0 text-ink-muted max-sm:hidden">{item.kind}</span>
            </li>
          ))}
          {rest > 0 && <li className="text-small text-ink-muted">and {rest} more</li>}
        </ul>
      </div>
      <Link
        href={REVIEW_HREF}
        className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'self-start' })}
      >
        Check them
      </Link>
    </section>
  );
}
