import Link from 'next/link';
import { Card } from '@/components/ui/card';
import type { DashWorkItem } from '@/lib/goals/dash-work';
import { cn } from '@/lib/cn';
import { DashCredit } from '@/components/ui/dash-mark';

/**
 * What Dash is on under this goal, and what it finished in the last day
 * (note 03ce0cce), above the steps. A run started from a step's own button
 * shows here as well as on its row, so it can be seen without unfolding the
 * tree. Running ones pulse in the accent; finished ones carry a green dot.
 */
export function DashWork({ items }: { items: DashWorkItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="dash-work-heading" className="space-y-2">
      <h2 id="dash-work-heading" className="px-1 text-ui font-semibold text-ink">
        <DashCredit className="text-ink-muted" />
        Dash&rsquo;s work
      </h2>
      <Card padding="dense">
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.runId} className="row-pad flex items-baseline gap-2 text-ui">
              <span
                className={cn(
                  'size-2 shrink-0 translate-y-[-1px] rounded-full',
                  item.state === 'running' ? 'animate-pulse bg-accent' : 'bg-positive',
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="sr-only">{item.state === 'running' ? 'Working on: ' : 'Finished: '}</span>
                <a href={`#step-${item.stepId}`} className="font-medium text-ink hover:text-accent">
                  {item.title}
                </a>
                {item.line && <span className="text-ink-muted"> · {item.line}</span>}
              </span>
              <span className={cn('shrink-0 text-small', item.state === 'running' ? 'text-accent' : 'text-positive')}>
                {item.state === 'running' ? 'Working' : 'Done'}
              </span>
              <Link
                href={`/goals/runs/${item.runId}`}
                className="shrink-0 text-small text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                Details
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
