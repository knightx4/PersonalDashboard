'use client';

import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { AreaRunView } from '@/lib/goals/shaping';
import { planAreaAction, type GoalsActionState } from './actions';

const initial: GoalsActionState = {};

/** How often the page looks again while a run is going, as on a goal's page. */
const RUN_POLL_MS = 15_000;

/**
 * Plan this area: Claude proposes the goals an area needs, from what you
 * wrote you want from it (docs/GOALS-SPEC.md, "Planning an area"). Each goal
 * it proposes lands in the area as a proposal you approve or archive, and
 * Work on this on a kept goal maps its steps.
 *
 * An area with no goals gets a sentence saying so and the button as the one
 * thing to press. An area with goals gets the button smaller, for asking what
 * is missing.
 */
export function AreaPlanner({
  areaId,
  hasGoals,
  run,
  canRun,
}: {
  areaId: string;
  hasGoals: boolean;
  run: AreaRunView | null;
  /** Whether this account can start a run (the owner's only). */
  canRun: boolean;
}) {
  const router = useRouter();
  const running = run?.running ?? null;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [running, router]);
  const [state, plan, starting] = useActionState(planAreaAction, initial);

  if (!canRun && !run) return null;

  const line = running ? (
    <p role="status" className="flex items-center gap-1.5 text-small text-accent">
      <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
      <span>Claude is planning this area · {running}</span>
    </p>
  ) : run?.error ? (
    <p className="text-small text-danger">
      The last plan did not finish: {run.error}{' '}
      <Link href={`/goals/runs/${run.runId}`} className="underline underline-offset-2">
        Details
      </Link>
    </p>
  ) : run?.summary ? (
    <p className="text-small text-ink-muted">
      <Link href={`/goals/runs/${run.runId}`} className="underline-offset-2 hover:underline">
        Last plan
      </Link>
      : {run.summary}
    </p>
  ) : !hasGoals ? (
    <p className="text-small text-ink-muted">
      No goals yet. Claude can propose the goals this area needs, from what you wrote above.
    </p>
  ) : null;

  return (
    <div className="space-y-1 px-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-[1_1_18rem]">{line}</div>
        {canRun && (
          <form action={plan}>
            <input type="hidden" name="id" value={areaId} />
            <Button
              type="submit"
              size="sm"
              variant={hasGoals ? 'ghost' : 'secondary'}
              pending={starting}
              disabled={running !== null}
            >
              {hasGoals ? 'Plan what is missing' : 'Plan this area'}
            </Button>
          </form>
        )}
      </div>
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}
