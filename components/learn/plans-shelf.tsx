import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { progressLine } from '@/lib/learn/lessons/plan-view';
import type { PlanSummary } from '@/lib/learn/lessons/plan-store';

/**
 * Each learning goal's plan with its progress, on Learn now (plan #1143). A
 * goal's lessons left the deck for its plan, so this is the way to them from
 * the page Learn opens on: the plan's name opens the plan, and Next up opens
 * the piece that is next in its suggested order. A plan with its final project
 * and every piece passed says it is finished (plan #1146).
 */
export function PlansShelf({ plans }: { plans: readonly PlanSummary[] }) {
  if (plans.length === 0) return null;
  return (
    <Card padding="none" className="mb-4">
      <h2 className="card-pad-x pt-(--card-p) text-ui font-semibold text-ink">Your plans</h2>
      <ul className="divide-y divide-border">
        {plans.map((plan) => {
          const { progress } = plan;
          return (
            <li key={plan.aimId} className="card-pad-x row-pad">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <Link href={`/learn/s/${plan.subjectId}`} className="text-body font-medium text-ink hover:underline">
                  {plan.name}
                </Link>
                <span className="text-small text-ink-muted tabular-nums">{progressLine(progress, plan.finished)}</span>
              </div>
              <Meter
                value={progress.passed}
                max={progress.total}
                label={`${plan.name}: ${progress.passed} of ${progress.total} pieces passed`}
                className="mt-2"
              />
              {progress.next && (
                <p className="mt-2 text-ui text-ink-muted">
                  Next up:{' '}
                  <Link
                    href={`/learn/s/${plan.subjectId}/p/${progress.next.pieceId}`}
                    className="text-accent hover:underline"
                  >
                    {progress.next.title}
                  </Link>
                </p>
              )}
              {!progress.next && !plan.projectPassed && progress.total > 0 && progress.unitsWritten === progress.units && (
                <p className="mt-2 text-ui text-ink-muted">
                  Next up:{' '}
                  <Link href={`/learn/s/${plan.subjectId}#final-project`} className="text-accent hover:underline">
                    the final project
                  </Link>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
