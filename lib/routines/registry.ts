/**
 * Every recurring run the app makes, for the Routines pages in Dev and Goals.
 *
 * A routine is work that happens again and again on a clock: the weekly vision
 * review, the goals morning run. It is not a plan step. The plan holds what is
 * being built and closes when it is built; the step that schedules a routine
 * closes the day the schedule is live, and from then on the routine lives
 * here. What is still being learned about a routine, such as how its findings
 * should be judged after the first few runs, is its `question`, shown with it,
 * rather than fog on a feature that can then never close (docs/PLAN-SPEC.md,
 * "Routines").
 *
 * Each entry names where its clock lives and where its runs are recorded, so
 * both pages draw the same row from the same facts:
 *
 *   clock  a pg_cron job by name (read through public.routine_schedules()),
 *          or a stage of the one Vercel cron, /api/cron/daily, or a schedule
 *          set on claude.ai that the app cannot read.
 *   runs   the table each fire writes: plan_runs by job for Dev, goals.runs by
 *          job for Goals. Absent when a run writes no row of its own.
 *
 * Pure: lib/routines/store.ts reads the facts, lib/routines/view.ts joins them.
 */

export type RoutineWorkspace = 'dev' | 'goals';

export type RoutineClock =
  /**
   * A pg_cron job, with the expression its migration schedules. The live job
   * wins when it can be read; the expression stands in where it cannot, for an
   * account other than the owner's or a database without pg_cron.
   */
  | { kind: 'pg_cron'; job: string; expression: string }
  /** A stage of /api/cron/daily; the expression is vercel.json's. */
  | { kind: 'daily'; stage: string }
  /** Scheduled on claude.ai, where the app cannot read the schedule. */
  | { kind: 'claude' };

export type RoutineRuns = { table: 'plan_runs' | 'goals_runs'; job: string };

export type Routine = {
  key: string;
  workspace: RoutineWorkspace;
  title: string;
  /** One or two sentences on what a run does. */
  does: string;
  clock: RoutineClock;
  /** How often it does its work, where that differs from how often its clock ticks. */
  cadence?: string;
  runs?: RoutineRuns;
  /** Where its results are read. */
  results?: { label: string; href: string };
  /** What is not settled yet about how it should work, and how it will be. */
  question?: string;
  /** The plan feature that built it. */
  builtBy?: number;
};

/** The one Vercel cron (vercel.json); every `daily` stage runs inside it. */
export const DAILY_CRON = '0 12 * * *';

export const ROUTINES: readonly Routine[] = [
  // Dev
  {
    key: 'vision-review',
    workspace: 'dev',
    title: 'Vision review',
    does:
      'Reads what you filed and did in each workspace since the last review, and either says its vision still holds or proposes an edit with the notes and likes behind it. Also dismisses session-filed ideas that serve no part of a vision.',
    clock: { kind: 'pg_cron', job: 'vision-review-weekly', expression: '41 14 * * 0' },
    runs: { table: 'plan_runs', job: 'vision' },
    results: { label: 'Specs', href: '/dev/specs' },
    question:
      'How to tell a finding about the vision from a run of local misses is not written down yet. The first two or three reviews, read against which edits you accept and dismiss, should show the rule.',
    builtBy: 1104,
  },
  {
    key: 'spec-audit',
    workspace: 'dev',
    title: 'Spec audit',
    does:
      'Compares the code with every spec and records what holds, what has drifted and what is not built yet, drafting spec changes for the findings that call for one.',
    clock: { kind: 'pg_cron', job: 'spec-audit-weekly', expression: '47 14 * * 1' },
    runs: { table: 'plan_runs', job: 'audit' },
    results: { label: 'Specs', href: '/dev/specs' },
    builtBy: 1524,
  },
  {
    key: 'overnight',
    workspace: 'dev',
    title: 'Overnight runner',
    does:
      'While it is started on the Plan page, notices when a session finishes and starts the next ready step, all night.',
    clock: { kind: 'pg_cron', job: 'overnight-tick', expression: '*/4 * * * *' },
    cadence: 'Every 4 minutes while started',
    runs: { table: 'plan_runs', job: 'feature' },
    results: { label: 'Plan', href: '/dev/plan' },
  },
  {
    key: 'notes',
    workspace: 'dev',
    title: 'Morning notes review',
    does: 'Works the queue of bug reports and requests: fixes them group by group and closes each with a reason.',
    clock: { kind: 'claude' },
    runs: { table: 'plan_runs', job: 'notes' },
    results: { label: 'Bugs and requests', href: '/dev/bugs' },
  },
  {
    key: 'inspiration',
    workspace: 'dev',
    title: 'Inspiration check',
    does: 'Reads the new videos on the inspiration playlists and merges their takeaways with the ones already found.',
    clock: { kind: 'pg_cron', job: 'inspiration-daily', expression: '35 14 * * *' },
    results: { label: 'Inspiration', href: '/dev/inspiration' },
    builtBy: 1411,
  },
  {
    key: 'plan-claims',
    workspace: 'dev',
    title: 'Claim sweep',
    does: 'Puts back steps whose session died, so they can be picked up again.',
    clock: { kind: 'daily', stage: 'plan-claims' },
    results: { label: 'Plan', href: '/dev/plan' },
  },
  {
    key: 'dev-digest',
    workspace: 'dev',
    title: 'Daily summary',
    does: 'Writes the summary of the last 24 hours on Home, and files the ideas it noticed.',
    clock: { kind: 'daily', stage: 'dev-digest' },
    results: { label: 'Home', href: '/dev/raised' },
  },
  {
    key: 'idea-scores',
    workspace: 'dev',
    title: 'Idea scores',
    does: 'Scores every idea that has no score yet, including the ones the summary just filed.',
    clock: { kind: 'daily', stage: 'idea-scores' },
    results: { label: 'Ideas', href: '/dev/ideas' },
    builtBy: 1327,
  },

  // Goals
  {
    key: 'goals-daily',
    workspace: 'goals',
    title: 'Morning run',
    does:
      'Gives each open goal its status for the day with the next move, gives your untouched steps a move, and works up to ten ready Dash steps.',
    clock: { kind: 'daily', stage: 'goals-daily' },
    runs: { table: 'goals_runs', job: 'daily' },
    results: { label: 'Runs', href: '/goals/runs' },
    builtBy: 933,
  },
  {
    key: 'goals-weekly',
    workspace: 'goals',
    title: 'Weekly run',
    does:
      'Researches events, reading, courses and job leads for each goal that asks for them, reading how you reacted to last week’s.',
    clock: { kind: 'daily', stage: 'goals-weekly' },
    cadence: 'Every week, checked by the morning cron',
    runs: { table: 'goals_runs', job: 'weekly' },
    results: { label: 'Runs', href: '/goals/runs' },
    builtBy: 934,
  },
  {
    key: 'goals-reshape',
    workspace: 'goals',
    title: 'After your answers',
    does:
      'Ten minutes after you stop answering a goal’s questions, settles the steps those answers held up and adds anything new.',
    clock: { kind: 'pg_cron', job: 'goals-reshape-tick', expression: '3-59/10 * * * *' },
    runs: { table: 'goals_runs', job: 'reshape' },
    results: { label: 'Runs', href: '/goals/runs' },
    builtBy: 1017,
  },
  {
    key: 'goals-rhythms',
    workspace: 'goals',
    title: 'Rhythm counts',
    does: 'Closes yesterday’s ended rhythm periods and writes the counts a rhythm reads from Jobs or the calendar.',
    clock: { kind: 'daily', stage: 'goals-rhythms' },
    results: { label: 'All goals', href: '/goals/all' },
    builtBy: 928,
  },
  {
    key: 'goals-quiet-runs',
    workspace: 'goals',
    title: 'Quiet-run sweep',
    does: 'Closes goal runs that stopped reporting, so a run that died is not shown as still going.',
    clock: { kind: 'daily', stage: 'goals-quiet-runs' },
    results: { label: 'Runs', href: '/goals/runs' },
    builtBy: 1002,
  },
];

export function routinesFor(workspace: RoutineWorkspace): Routine[] {
  return ROUTINES.filter((routine) => routine.workspace === workspace);
}
