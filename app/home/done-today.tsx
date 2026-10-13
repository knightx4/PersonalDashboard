import Link from '@/components/ui/link';
import { Check, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { LogDone } from '@/components/goals/log-done';
import type { DoneTodayList } from '@/lib/goals/done-today';

/**
 * Home's Done today (plan #1740): the "What did you do?" box, and under it
 * what you finished or got further with since midnight, from Todo and from
 * your goals. A ticked task or a closed step has a tick; progress logged on a
 * step has the rising line. Each line goes where the thing lives.
 *
 * `logging` is false when Goals is switched off, which leaves the list alone.
 * The page leaves the card out when there is neither box nor anything done.
 */
export function DoneTodayCard({
  done,
  logging,
  initial,
  initialMessage,
  initialOpen,
}: {
  done: DoneTodayList;
  logging: boolean;
  /** Lines already filed in the box, for the gallery. */
  initial?: React.ComponentProps<typeof LogDone>['initial'];
  initialMessage?: string;
  /** Drawn open, for the gallery. */
  initialOpen?: boolean;
}) {
  const count = done.lines.length + done.more;
  return (
    <Card padding="standard" className="mt-4">
      <h2 className="text-ui font-semibold text-ink">
        Done today
        {count > 0 && <span className="tabular ml-2 text-small font-normal text-ink-muted">{count}</span>}
      </h2>
      {logging && (
        <LogDone
          placeholder="What did you do today?"
          initial={initial}
          initialMessage={initialMessage}
          initialOpen={initialOpen}
          className="mt-2"
        />
      )}
      {done.lines.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {done.lines.map((line) => {
            const Icon = line.kind === 'progress' ? TrendingUp : Check;
            return (
              <li key={line.key} className="flex items-baseline gap-2 py-1.5">
                <Icon className="size-3.5 shrink-0 translate-y-0.5 text-ink-muted" strokeWidth={1.75} aria-hidden />
                <Link href={line.href} className="press-area group min-w-0 flex-1">
                  <span className="block truncate text-ui text-ink group-hover:text-accent">{line.title}</span>
                  <span className="block truncate text-small text-ink-muted">{line.detail}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {done.more > 0 && <p className="mt-2 text-small text-ink-muted">{done.more} more today</p>}
    </Card>
  );
}
