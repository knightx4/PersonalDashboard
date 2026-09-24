'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  approveGoalAction,
  workOnGoalAction,
  type ShapingActionState,
} from './shaping-actions';

const initial: ShapingActionState = {};

/**
 * Claude on this goal (plan #932): whether you have approved it, what Claude
 * has proposed and asked, how its last run went, and the two presses. Work on
 * this fires the goals routine for this goal; Approve opens what it proposed
 * and lets it change the steps here without asking from then on.
 */
export function GoalShaping({
  goalId,
  approval,
  runLine,
  canRun,
  running,
}: {
  goalId: string;
  approval: { text: string; approve: string | null };
  /** The latest run in a sentence, or null when there has not been one. */
  runLine: string | null;
  /** Whether this account can start a run (the owner's only). */
  canRun: boolean;
  /** Whether a run is still taken to be going. */
  running: boolean;
}) {
  const [approveState, approve, approving] = useActionState(approveGoalAction, initial);
  const [workState, work, starting] = useActionState(workOnGoalAction, initial);
  const error = approveState.error ?? workState.error;
  const message = workState.message ?? approveState.message;

  return (
    <section aria-labelledby="claude-heading" className="space-y-2">
      <h2 id="claude-heading" className="px-1 text-ui font-semibold text-ink">
        Claude on this goal
      </h2>
      <Card className="space-y-2 p-3">
        <p className="text-ui text-ink">{approval.text}</p>
        {runLine && <p className="text-small text-ink-muted">{runLine}</p>}
        {(approval.approve || canRun) && (
          <div className="flex flex-wrap items-center gap-2">
            {approval.approve && (
              <form action={approve}>
                <input type="hidden" name="goalId" value={goalId} />
                <Button type="submit" pending={approving}>
                  {approval.approve}
                </Button>
              </form>
            )}
            {canRun && (
              <form action={work}>
                <input type="hidden" name="goalId" value={goalId} />
                <Button
                  type="submit"
                  variant={approval.approve ? 'secondary' : 'primary'}
                  pending={starting}
                  disabled={running}
                >
                  Work on this
                </Button>
              </form>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        {!error && message && (
          <p role="status" className="text-small text-ink-muted">
            {message}
          </p>
        )}
      </Card>
    </section>
  );
}
