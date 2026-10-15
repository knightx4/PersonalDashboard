import { RunLinesView } from '@/components/runs/run-lines';
import { RunLinesArriving } from './run-lines-demo';
import { AcknowledgeRun } from '@/components/runs/acknowledge-run';
import { acknowledgeGoalRunAction, answerGoalRunAction } from '@/app/goals/runs/[runId]/actions';
import type { RunActivity, RunActivityKind } from '@/lib/core/run-activities';
import type { RunQuestion } from '@/lib/core/run-questions';
import { PageColumn } from '@/components/shell/page-width';

/**
 * A run's lines (plan #1826), drawn from fixtures in each state the run's
 * page puts them in: a plan run going, with every kind of line; one waiting
 * on your answer, its choices as presses (plan #1824); one waiting on a
 * question asked without choices, answered in your own words; one gone quiet with its Acknowledge press; one just
 * started with nothing written yet; one whose live connection dropped; and a
 * feature session's, folded under the feature's steps.
 * The live part (components/runs/live-run-lines.tsx) only feeds these lines
 * from Realtime, so the drawing is the same. The first card is a going run
 * whose next line arrives on a press (run-lines-demo.tsx), for the strip.
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

/** A run that asked without choices, so the answer is in your own words. */
const OPEN_QUESTION_LINES: RunActivity[] = [
  line('o1', 'action', '07:00', 'Started the morning run.'),
  line(
    'o2',
    'question',
    '07:12',
    'Two statements from the same bank arrived this week, one for the joint account. Which goal should the joint one count towards?',
  ),
];

/** The question above as the Dev inbox lists it, on a plan run (plan #1824). */
export const PLAN_RUN_QUESTION: RunQuestion = {
  runTable: 'plan_runs',
  runId: RUN,
  about: '#1826 Show a run’s lines live on its page',
  href: '/dev/plan/1826',
  body: 'Should a run that has gone quiet close itself after a day, or stay until you acknowledge it?',
  options: ['Stay until I acknowledge it', 'Close it after a day'],
  askedAt: '2026-10-12T09:40:00.000Z',
};

/** A goal run's question as the Goals inbox lists it. */
export const GOAL_RUN_QUESTION: RunQuestion = {
  runTable: 'goals.runs',
  runId: '9b1d4e2f-7a3c-4e8b-b6d1-3f2a8c9e0d14',
  about: 'Morning run',
  href: '/goals/runs/9b1d4e2f-7a3c-4e8b-b6d1-3f2a8c9e0d14',
  body: OPEN_QUESTION_LINES[1].body,
  options: ['Our first home', 'The holiday fund'],
  askedAt: '2026-10-12T07:12:00.000Z',
};

/** Every state of the card, stacked as the gallery shows them. */
/**
 * A feature session's lines as the runner card's open slot draws them: one
 * fold for each step of the feature, the step being built open, the lines
 * about another feature left out and counted, a repeat drawn once with a
 * count and a run of file changes as one line naming the files.
 */
const FEATURE_LINES: RunActivity[] = [
  line('f1', 'thought', '14:53', 'Checking the due check-backs before sending step #2124.1 to a builder.'),
  line('f2', 'thought', '14:53', 'Woke the session on #1980 for its check-back.'),
  line('f3', 'action', '14:53', 'Claimed #2124.1'),
  line('f4', 'action', '14:53', 'Claimed #2124.1'),
  line('f5', 'action', '14:54', 'Writing supabase/migrations-you/0007_details.sql'),
  line('f6', 'action', '14:54', 'Writing lib/you/details-store.test.ts'),
  line('f7', 'action', '14:55', 'Editing tests/rls-you.test.ts'),
  line('f8', 'action', '14:59', 'Finished #2124.1, committed'),
  line('f9', 'thought', '15:06', '#2124.2 is ready and touches different files from the rest, so it goes to a builder now.'),
  line('f10', 'action', '15:06', 'Claimed #2124.2'),
  line('f11', 'thought', '15:14', 'The #2124.2 builder has edits to the You layout and the nav icons, but no commit yet.'),
  line('f12', 'thought', '15:15', 'Still waiting on the #2124.2 builder: 8 changed files in its worktree, no commit yet.'),
  line('f13', 'thought', '15:16', 'The untracked files are the builder worktrees, which stay uncommitted.'),
  line('f14', 'thought', '15:17', 'The #2124.2 builder committed. Merging its branch and running the fast checks.'),
  line('f15', 'thought', '15:18', 'Type check and lint pass on the merged branch.'),
  line('f16', 'thought', '15:19', 'Marking #2124.2 built and pushing.'),
];

const FEATURE_STEPS = [
  { ref: '#2124.1', title: 'Store the details: table, store and tests', status: 'done' as const },
  { ref: '#2124.2', title: 'A Details tab on the You page', status: 'in_progress' as const },
  { ref: '#2124.3', title: 'Edit a detail in place', status: 'not_started' as const },
  { ref: '#2124.4', title: 'Fill the details from the note you wrote', status: 'not_started' as const },
];

export function RunLinesSurface() {
  return (
    <PageColumn className="space-y-6">
      <RunLinesArriving lines={RUN_LINES} />
      <RunLinesView lines={RUN_LINES.slice(0, 5)} state="waiting" answer={answerGoalRunAction} />
      <RunLinesView lines={OPEN_QUESTION_LINES} state="waiting" answer={answerGoalRunAction} />
      <RunLinesView
        lines={RUN_LINES.slice(0, 3)}
        state="stale"
        acknowledge={<AcknowledgeRun runId={RUN} action={acknowledgeGoalRunAction} />}
      />
      <RunLinesView lines={[]} state="live" />
      <RunLinesView lines={RUN_LINES.slice(0, 2)} state="live" connection="lost" />
      <RunLinesView lines={FEATURE_LINES} state="live" feature={{ ref: '#2124', steps: FEATURE_STEPS }} />
    </PageColumn>
  );
}
