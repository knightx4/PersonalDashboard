'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FogNote } from '@/components/dev/fog-note';
import {
  approveGoalAction,
  setFogAsideAction,
  workOnGoalAction,
  type ShapingActionState,
} from './shaping-actions';

const initial: ShapingActionState = {};

/**
 * How often the page looks again while a run is going, so the working line
 * turns into what the run changed without a reload. A run takes minutes, so
 * a quarter of one is soon enough.
 */
const RUN_POLL_MS = 15_000;

/**
 * Claude on this goal (plan #932): whether you have approved it, what Claude
 * has proposed and asked, how its last run went, and the two presses. Work on
 * this fires the goals routine for this goal; Approve opens what it proposed
 * and lets it change the steps here without asking from then on. With nothing
 * to approve it is one line rather than a card.
 */
export function GoalShaping({
  goalId,
  approval,
  runLine,
  runFailed,
  changes,
  running: progress,
  canRun,
}: {
  goalId: string;
  approval: { text: string; approve: string | null };
  /** The latest run in a sentence, or null when there has not been one. */
  runLine: string | null;
  /** Whether that run failed, so its line reads as an error. */
  runFailed: boolean;
  /** What the ended run changed, counted from history (plan #961). */
  changes: string | null;
  /**
   * Where the run still going has got to, as "on Draft the letter, 3 minutes
   * ago" (plan #1002), or null when none is going.
   */
  running: string | null;
  /** Whether this account can start a run (the owner's only). */
  canRun: boolean;
}) {
  const router = useRouter();
  const running = progress !== null;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [running, router]);
  const [approveState, approve, approving] = useActionState(approveGoalAction, initial);
  const [workState, work, starting] = useActionState(workOnGoalAction, initial);
  const error = approveState.error ?? workState.error;
  const message = workState.message ?? approveState.message;

  const status = running ? (
    <p role="status" className="flex items-center gap-1.5 text-small text-accent">
      <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
      <span>Claude is working on this · {progress}</span>
    </p>
  ) : (
    runLine && (
      <div className="space-y-0.5">
        <p className={runFailed ? 'text-small text-danger' : 'text-small text-ink-muted'}>{runLine}</p>
        {changes && <p className="text-small text-ink-muted">{changes}</p>}
      </div>
    )
  );
  const workButton = canRun && (
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
  );
  const feedback = error ? (
    <p role="alert" className="text-small text-danger">
      {error}
    </p>
  ) : (
    message && (
      <p role="status" className="text-small text-ink-muted">
        {message}
      </p>
    )
  );

  // Nothing to approve: the run line and Work on this as one line, with no
  // heading or card around them (ui finding 133242ff, plan #1038). The card
  // comes back when Claude proposes something.
  if (!approval.approve) {
    if (!approval.text && !status && !workButton && !feedback) return null;
    return (
      <div className="space-y-1 px-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* A basis, so on a phone the button drops under the lines instead
              of squeezing them into a column beside it. */}
          <div className="min-w-0 flex-[1_1_18rem] space-y-0.5">
            {approval.text && <p className="text-ui text-ink">{approval.text}</p>}
            {status}
          </div>
          {workButton}
        </div>
        {feedback}
      </div>
    );
  }

  return (
    <section aria-labelledby="claude-heading" className="space-y-2">
      <h2 id="claude-heading" className="px-1 text-ui font-semibold text-ink">
        Claude on this goal
      </h2>
      <Card className="space-y-2 p-3">
        <p className="text-ui text-ink">{approval.text}</p>
        {status}
        <div className="flex flex-wrap items-center gap-2">
          <form action={approve}>
            <input type="hidden" name="goalId" value={goalId} />
            <Button type="submit" pending={approving}>
              {approval.approve}
            </Button>
          </form>
          {workButton}
        </div>
        {feedback}
      </Card>
    </section>
  );
}

/**
 * What is not known yet about the goal, under its title (plan #960), drawn
 * as fog is on a dev plan feature, with Not now. Put aside, it folds to one
 * quiet button that brings it back.
 */
export function GoalFog({ goalId, fog, aside }: { goalId: string; fog: string; aside: boolean }) {
  const [state, action, pending] = useActionState(setFogAsideAction, initial);
  if (aside) {
    return (
      <form action={action} className="mb-6">
        <input type="hidden" name="id" value={goalId} />
        <input type="hidden" name="dismissed" value="0" />
        <Button type="submit" size="sm" variant="ghost" pending={pending}>
          Show what is not known yet
        </Button>
        {state.error && (
          <p role="alert" className="text-small text-danger">
            {state.error}
          </p>
        )}
      </form>
    );
  }
  return (
    <div className="mb-6">
      <FogNote
        id={goalId}
        fog={fog}
        aside={false}
        action={action}
        pending={pending}
        error={state.error}
      />
    </div>
  );
}
