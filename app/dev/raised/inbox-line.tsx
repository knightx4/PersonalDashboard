import Link from 'next/link';
import { ChevronRight, Inbox } from 'lucide-react';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * The one line Home keeps about the inbox: how much is waiting, and the way
 * there. The list itself is its own tab, and drawing it twice would be the
 * same rows in two places, one of which stops being read.
 */
export function InboxLine({ count }: { count: number }) {
  return (
    <Link
      href="/dev/inbox"
      className={cn(cardVariants({ padding: 'dense', interactive: true }), 'flex items-center gap-3')}
    >
      <Inbox aria-hidden strokeWidth={2} className="size-4 shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1 text-body text-ink">
        {count === 0 ? (
          'Nothing waiting on you'
        ) : (
          <>
            <span className="tabular font-semibold">{count}</span>{' '}
            {count === 1 ? 'thing is' : 'things are'} waiting on you
          </>
        )}
      </span>
      <span className="text-small text-ink-muted">Inbox</span>
      <ChevronRight aria-hidden strokeWidth={2} className="size-4 shrink-0 text-ink-ghost" />
    </Link>
  );
}
