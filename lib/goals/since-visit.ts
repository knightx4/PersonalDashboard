/**
 * What Claude did since your last visit, for the top of the Goals home
 * (plan #1010; docs/GOALS-SPEC.md, "Since your last visit").
 *
 * One line per run that ended after the visit before this sitting
 * (VisitRecord.previousVisitAt in lib/goals/catch-up.ts): the step it worked,
 * the goal it mapped, the facts it filed, or why it failed. Most of these are
 * the night run's (inngest/goals/overnight.ts), but goals.runs does not say
 * who started a run, so a run from a press you made before leaving is listed
 * too. The next sitting starts from this one, so the list is gone once read.
 *
 * What each run did is read from its goals.history rows, which carry its
 * run_id: a step closed is an update of items to status done, a proposed step
 * or question is an insert into items, and a fact filed is an insert into
 * records.
 *
 * Pure. The reads are in lib/goals/since-visit-store.ts.
 */
import { JOB_LABELS, type RunJob, type RunListing } from '@/lib/goals/runs';

/** The most runs the list shows; the rest are on the Runs page. */
export const SINCE_VISIT_SHOWN = 8;

/** One goals.history row of a run, the columns the list counts from. */
export type RunHistoryRow = {
  run_id: string;
  table_name: string;
  action: string;
  new_values: Record<string, unknown> | null;
};

/** What one run's history rows add up to. */
export type RunTally = {
  stepsDone: number;
  stepsAdded: number;
  questionsAdded: number;
  goalsAdded: number;
  facts: number;
};

function emptyTally(): RunTally {
  return { stepsDone: 0, stepsAdded: 0, questionsAdded: 0, goalsAdded: 0, facts: 0 };
}

export function tallyRuns(rows: readonly RunHistoryRow[]): Map<string, RunTally> {
  const tallies = new Map<string, RunTally>();
  for (const row of rows) {
    const tally = tallies.get(row.run_id) ?? emptyTally();
    tallies.set(row.run_id, tally);
    const values = row.new_values ?? {};
    if (row.table_name === 'records' && row.action === 'insert') tally.facts += 1;
    if (row.table_name !== 'items') continue;
    if (row.action === 'update' && values.status === 'done') tally.stepsDone += 1;
    if (row.action === 'insert') {
      if (values.level === 'goal') tally.goalsAdded += 1;
      else if (values.kind === 'decision') tally.questionsAdded += 1;
      else tally.stepsAdded += 1;
    }
  }
  return tallies;
}

/** The goal a run's item sits under: the item itself when it is a goal. */
export type RunGoal = { id: string; title: string };

export type SinceEntry = {
  runId: string;
  job: RunJob;
  failed: boolean;
  /** What the run was on: the step, the goal or the area, or the run's name. */
  title: string;
  /** What it did, and the goal a step sits under. */
  line: string;
  /** Why it failed; null for a run that finished. */
  error: string | null;
  /** The goal it was on, at the step when there was one; the run's page otherwise. */
  href: string;
};

export type SinceVisit = {
  /** ISO instant of the visit before this sitting. */
  since: string;
  /** Newest first, at most SINCE_VISIT_SHOWN. */
  entries: SinceEntry[];
  /** Runs left out by the cap. */
  more: number;
};

/** The verb for a run that finished. */
function doneVerb(run: RunListing, tally: RunTally): string {
  switch (run.job) {
    case 'step':
      return 'Worked this step';
    case 'phase':
      return 'Worked this phase';
    case 'prepare':
      return 'Prepared this step for you';
    case 'goal':
      return tally.stepsAdded + tally.questionsAdded > 0 ? 'Mapped this goal' : 'Worked on this goal';
    case 'reshape':
      return 'Settled after your answers';
    case 'area':
      return 'Planned this area';
    case 'raise':
      return 'Acted on your answer';
    case 'daily':
    case 'weekly':
      return 'Finished';
  }
}

function count(n: number, one: string, many: string): string | null {
  if (n === 0) return null;
  return `${n} ${n === 1 ? one : many}`;
}

function tallyWords(job: RunJob, tally: RunTally): (string | null)[] {
  return [
    // A step run's own close is what "Worked this step" already says.
    job === 'step' || job === 'prepare'
      ? null
      : count(tally.stepsDone, 'step done', 'steps done'),
    count(tally.stepsAdded, 'step proposed', 'steps proposed'),
    count(tally.questionsAdded, 'question', 'questions'),
    count(tally.goalsAdded, 'goal proposed', 'goals proposed'),
    count(tally.facts, 'fact filed', 'facts filed'),
  ];
}

function entryTitle(run: RunListing): string {
  if (run.item) return run.item.title;
  if (run.area) return run.area.name;
  if (run.job === 'daily' || run.job === 'weekly') return JOB_LABELS[run.job];
  return 'Something since deleted';
}

/**
 * The list for the home. `runs` are those that ended after `since`; a run
 * still going is left for the next visit. `goals` maps a run's item to the
 * goal it sits under.
 */
export function sinceVisit(
  since: string,
  runs: readonly RunListing[],
  tallies: ReadonlyMap<string, RunTally>,
  goals: ReadonlyMap<string, RunGoal>,
): SinceVisit {
  const from = Date.parse(since);
  const ended = runs
    .filter(
      (run) =>
        run.status !== 'started' && run.endedAt !== null && Date.parse(run.endedAt) > from,
    )
    .sort((a, b) => Date.parse(b.endedAt as string) - Date.parse(a.endedAt as string));

  const entries = ended.slice(0, SINCE_VISIT_SHOWN).map((run): SinceEntry => {
    const failed = run.status === 'failed';
    const tally = tallies.get(run.id) ?? emptyTally();
    const goal = run.item ? (goals.get(run.item.id) ?? null) : null;
    const onStep = run.item?.level === 'step';
    const words = failed
      ? ['Failed', JOB_LABELS[run.job]]
      : [doneVerb(run, tally), ...tallyWords(run.job, tally)];
    const line = [...words, onStep && goal ? goal.title : null]
      .filter((word): word is string => word !== null)
      .join(' · ');
    const href = goal
      ? onStep && run.item
        ? `/goals/${goal.id}#step-${run.item.id}`
        : `/goals/${goal.id}`
      : `/goals/runs/${run.id}`;
    return {
      runId: run.id,
      job: run.job,
      failed,
      title: entryTitle(run),
      line,
      error: failed ? (run.error ?? 'No reason was recorded.') : null,
      href,
    };
  });

  return { since, entries, more: Math.max(0, ended.length - SINCE_VISIT_SHOWN) };
}
