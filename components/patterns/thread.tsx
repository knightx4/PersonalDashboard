import Link from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * The thread pattern (docs/UI-QUALITY-SPEC.md, Part 4): a row's comments and
 * Dash's replies, under the row they are about.
 *
 * The turns and the box are `Thread` (components/thread/thread.tsx), which
 * already tells your words from Dash's and keeps the box closed until it is
 * pressed. What this adds is where the thread sits: on one card with the row
 * it is about, the row's name first so the thread is never read without
 * knowing what it is on, then its state, then the turns oldest first and the
 * box last. Pressing the name opens the row. The Thread inside takes
 * `onCard`, so its turns sit on this card's ground and Dash's turns carry the
 * recessed ground instead.
 *
 * The rule is on /dev/ui under "Page patterns" (app/dev/ui/patterns.tsx), and
 * the gallery draws it as `pattern-thread`.
 */
export function ThreadPanel({
  title,
  href,
  meta,
  children,
  className,
}: {
  /** The row's name, as the person knows it. */
  title: string;
  /** Where the row opens. Left out when the thread is already on the row's own page. */
  href?: string;
  /** One line on the row's state: its status, who it waits on. */
  meta?: string;
  /** The `Thread` for the row, with `onCard` set so it does not draw a second panel. */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card padding="dense" className={cn('space-y-2', className)}>
      <div className="min-w-0">
        {href ? (
          <Link
            href={href}
            className="inline-flex min-h-11 items-center text-body font-medium text-ink hover:text-accent"
          >
            {title}
          </Link>
        ) : (
          <p className="text-body font-medium text-ink">{title}</p>
        )}
        {meta && <p className="text-small text-ink-muted">{meta}</p>}
      </div>
      {children}
    </Card>
  );
}
