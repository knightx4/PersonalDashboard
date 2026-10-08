import Link from 'next/link';
import type { DashWorkItem } from '@/lib/goals/dash-work';
import { cn } from '@/lib/cn';
import { stepAnchor } from '@/lib/goals/goal-page';

/**
 * What Dash is on under this goal, and what it finished in the last day
 * (note 03ce0cce), as lines in the goal's status (plan #1078). A run started
 * from a step's own button shows here as well as on its row, so it can be
 * seen without unfolding a stage. Running ones pulse in the accent; finished
 * ones carry a green dot.
 */
export function DashWork({ items }: { items: DashWorkItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Dash’s work" className="space-y-1">
      {items.map((item) => (
        <li key={item.runId} className="flex items-baseline gap-2 text-small">
          <span
            className={cn(
              'size-2 shrink-0 translate-y-[-1px] rounded-full',
              item.state === 'running' ? 'animate-pulse bg-accent' : 'bg-positive',
            )}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className={item.state === 'running' ? 'text-accent' : 'text-positive'}>
              {item.state === 'running' ? 'Dash is on ' : 'Dash finished '}
            </span>
            <a href={stepAnchor(item.stepId)} className="font-medium text-ink hover:text-accent">
              {item.title}
            </a>
            {item.line && <span className="text-ink-muted"> · {item.line}</span>}
          </span>
          <Link
            href={`/goals/runs/${item.runId}`}
            className="press-area shrink-0 text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Details
          </Link>
        </li>
      ))}
    </ul>
  );
}
