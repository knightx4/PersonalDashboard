import { RunLinesView } from '@/components/runs/run-lines';
import { PlanRunView } from '@/app/dev/plan/runs/[runId]/plan-run-view';
import type { RunActivity, RunActivityKind } from '@/lib/core/run-activities';
import { runTouched, type TouchStep } from '@/lib/plan/run-touched';

/**
 * One plan run's page in the gallery (plan #1964.2.4): a step run that has
 * finished, with the lines it wrote, the rows it touched (the step it was
 * sent at, two sub-steps it closed, one it named, a file it linked) and its
 * two commits. The page reads and then draws, so the drawing is the page's
 * own PlanRunView with fixtures, the lines in their ended state.
 */

const RUN_ID = '3a9e1c47-5b2d-4f60-8e1a-7c4b2d9f0e11';

function line(id: string, kind: RunActivityKind, at: string, body: string): RunActivity {
  return {
    id,
    user_id: 'u',
    run_table: 'plan_runs',
    run_id: RUN_ID,
    kind,
    body,
    options: null,
    created_at: `2026-10-15T${at}:00.000Z`,
  };
}

const LINES: RunActivity[] = [
  line('l1', 'action', '09:02', 'Claimed #1964.2.4, "Give each plan run a page listing what it touched".'),
  line('l2', 'thought', '09:05', 'Reading the goal run page and how #1964.2.1 marks a run as going.'),
  line('l3', 'action', '09:41', 'Committed 5c81d2e: read what a run touched from its lines and commits'),
  line('l4', 'action', '10:12', 'Committed 9f04ab7: Give each plan run a page listing what it touched (plan #1964.2.4)'),
  line('l5', 'action', '10:15', 'Wrote the critic’s notes to [the round 1 verdict](/dev/ui/review). Finished #1964.2.4.'),
];

function step(over: Partial<TouchStep> & Pick<TouchStep, 'id' | 'number' | 'title'>): TouchStep {
  return { outline: null, parentId: null, status: 'not_started', completedAt: null, ...over };
}

const STEPS: TouchStep[] = [
  step({ id: 'f', number: 1964, outline: '1964', title: 'Dash is one presence in every workspace' }),
  step({ id: 's', number: 1970, outline: '1964.2', parentId: 'f', title: 'One working state wherever Dash is on something', status: 'in_progress' }),
  step({
    id: 'a',
    number: 1971,
    outline: '1964.2.1',
    parentId: 's',
    title: 'Keep a Dash button’s mark working until its run ends',
    status: 'done',
    completedAt: '2026-10-15T09:20:00Z',
  }),
  step({
    id: 'd',
    number: 1974,
    outline: '1964.2.4',
    parentId: 's',
    title: 'Give each plan run a page listing what it touched',
    status: 'done',
    completedAt: '2026-10-15T10:14:00Z',
  }),
];

const TOUCHED = runTouched({
  run: {
    planItemId: 's',
    createdAt: '2026-10-15T09:00:00Z',
    endedAt: '2026-10-15T10:16:00Z',
    lastPush: { sha: '9f04ab7e21c3', subject: 'Give each plan run a page listing what it touched (plan #1964.2.4)' },
  },
  lines: LINES,
  steps: STEPS,
});

/** The markup of app/dev/plan/runs/[runId]/page.tsx after its reads. */
export function PlanRunSurface() {
  return (
    <PlanRunView
      subject={{
        ref: null,
        path: [
          { label: 'Dev', href: '/dev' },
          { label: 'Plan', href: '/dev/plan' },
          { label: '#1964.2 One working state wherever Dash is on something', href: '/dev/plan/1964.2' },
          { label: 'Feature batch', href: `/dev/plan/runs/${RUN_ID}` },
        ],
      }}
      job="feature"
      step={{ href: '/dev/plan/1964.2', label: '#1964.2', title: 'One working state wherever Dash is on something' }}
      facts={{ status: 'Finished', started: 'Today, 9:00 AM', ended: 'Today, 10:16 AM' }}
      push={{ sha: '9f04ab7e21c3', at: 'Today, 10:13 AM' }}
      problem={null}
      going={false}
      touched={TOUCHED}
      lines={<RunLinesView lines={LINES} state="ended" />}
    />
  );
}
