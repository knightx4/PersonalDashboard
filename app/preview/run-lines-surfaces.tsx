import { RunLinesView } from '@/components/runs/run-lines';
import { AcknowledgeRun } from '@/components/runs/acknowledge-run';
import { acknowledgeGoalRunAction } from '@/app/goals/runs/[runId]/actions';
import type { RunActivity, RunActivityKind } from '@/lib/core/run-activities';

/**
 * A run's lines (plan #1826), drawn from fixtures in each state the run's
 * page puts them in: a plan run going, with every kind of line; one waiting
 * on your answer; one gone quiet with its Acknowledge press; one just
 * started with nothing written yet; and one whose live connection dropped.
 * The live part (components/runs/live-run-lines.tsx) only feeds these lines
 * from Realtime, so the drawing is the same.
 */

const RUN = '6f0c2a7e-1b7d-4c55-9a0e-2d8f3c1b9a01';

function line(
  id: string,
  kind: RunActivityKind,
  at: string,
  body: string,
  options: string[] | null = null,
): RunActivity {
  return {
    id,
    user_id: 'u',
    run_table: 'plan_runs',
    run_id: RUN,
    kind,
    body,
    options,
    created_at: `2026-10-12T${at}:00.000Z`,
  };
}

export const RUN_LINES: RunActivity[] = [
  line('l1', 'action', '09:02', 'Claimed #1826, "Show a run’s lines live on its page".'),
  line('l2', 'thought', '09:04', 'Reading the goal run page and the three places that poll for runs.'),
  line(
    'l3',
    'action',
    '09:31',
    'Committed 4be1c09: the run page subscribes to its lines and appends each one as it is written.',
  ),
  line(
    'l4',
    'error',
    '09:36',
    'The type check failed on lib/goals/runs.ts: RunOutcome has no label for "stale". Adding one.',
  ),
  line(
    'l5',
    'question',
    '09:40',
    'Should a run that has gone quiet close itself after a day, or stay until you acknowledge it?',
    ['Stay until I acknowledge it', 'Close it after a day'],
  ),
  line('l6', 'response', '09:52', 'Stay until I acknowledge it.'),
  line('l7', 'action', '09:53', 'Kept stale runs open until acknowledged, and committed 7d2e5a1.'),
];

/** Every state of the card, stacked as the gallery shows them. */
export function RunLinesSurface() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <RunLinesView lines={RUN_LINES} state="live" />
      <RunLinesView lines={RUN_LINES.slice(0, 5)} state="waiting" />
      <RunLinesView
        lines={RUN_LINES.slice(0, 3)}
        state="stale"
        acknowledge={<AcknowledgeRun runId={RUN} action={acknowledgeGoalRunAction} />}
      />
      <RunLinesView lines={[]} state="live" />
      <RunLinesView lines={RUN_LINES.slice(0, 2)} state="live" connection="lost" />
    </div>
  );
}
