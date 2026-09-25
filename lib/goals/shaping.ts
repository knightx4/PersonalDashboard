/**
 * Claude shaping a goal, and approving what it proposed (docs/GOALS-SPEC.md,
 * "Fog and refining a goal" and "Approval"; plan #932).
 *
 * "Work on this" on a goal fires the goals routine for that goal. The session
 * follows .claude/skills/goals: it maps the whole path for the goal (phases,
 * Claude steps, information steps pre-filled from Gmail, provisional steps,
 * questions with lettered options), proposed until you approve the goal;
 * after that it may add, split and reorder steps beneath it without asking. The database holds it to that
 * (supabase/migrations-goals/0006).
 *
 * The rules that need no database live here: what a run looks like on the
 * page, how many proposals are waiting, and the brief the routine is fired
 * with. The reads and writes are in lib/goals/shaping-store.ts.
 */
import type { StepNode } from '@/lib/goals/steps';

export type GoalRunStatus = 'started' | 'done' | 'failed';

/** One goals.runs row, as the goal page needs it. */
export type GoalRun = {
  id: string;
  status: GoalRunStatus;
  /** ISO instant. */
  createdAt: string;
  endedAt: string | null;
  summary: string | null;
  error: string | null;
  /** When the session last reported, or null before its first report (plan #1002). */
  lastSeenAt?: string | null;
  /** What the session said it was on at that report, usually a step title. */
  nowOn?: string | null;
};

/**
 * How long a started run may go without reporting before it is taken to have
 * died (plan #1002). The goals skill writes last_seen_at at each step it
 * starts, so a live session is rarely quiet for more than a few minutes. The
 * sweep in the daily and overnight ticks (lib/goals/run-sweep.ts) closes a run
 * quiet this long as failed, and the pages read the same window so they agree
 * with the sweep in the few minutes between ticks.
 */
export const RUN_QUIET_MS = 45 * 60 * 1000;

/** When a run was last heard from: its last report, or its start before the first. */
export function lastHeardAt(run: { createdAt: string; lastSeenAt?: string | null }): number {
  const created = Date.parse(run.createdAt);
  const seen = run.lastSeenAt ? Date.parse(run.lastSeenAt) : Number.NaN;
  return Number.isFinite(seen) ? Math.max(seen, created) : created;
}

/** Whether a started run has gone quiet for longer than RUN_QUIET_MS. */
export function runIsQuiet(run: { createdAt: string; lastSeenAt?: string | null }, now: number): boolean {
  return now - lastHeardAt(run) >= RUN_QUIET_MS;
}

/** Whether a run is still taken to be going, so a second press is refused. */
export function runInFlight(run: GoalRun | null, now: number): boolean {
  if (!run || run.status !== 'started') return false;
  return !runIsQuiet(run, now);
}

/** "3 minutes ago", "1 hour ago" or "just now", for a run's last report. */
export function minutesAgo(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

/**
 * Where a started run has got to: "on Draft the letter, 3 minutes ago" once
 * the session has reported, "started 3 minutes ago" before it has. Null for a
 * run that has ended.
 */
export function runProgress(
  run: { status: GoalRunStatus; createdAt: string; lastSeenAt?: string | null; nowOn?: string | null },
  now: number,
): string | null {
  if (run.status !== 'started') return null;
  const onWhat = run.nowOn?.trim();
  if (run.lastSeenAt && onWhat) return `on ${firstLine(onWhat)}, ${minutesAgo(run.lastSeenAt, now)}`;
  if (run.lastSeenAt) return `last reported ${minutesAgo(run.lastSeenAt, now)}`;
  return `started ${minutesAgo(run.createdAt, now)}`;
}

/**
 * The error a quiet run is closed with. Names what it was last on, so the
 * run's page says where it stopped.
 */
export function quietRunError(run: { nowOn?: string | null }): string {
  const minutes = Math.round(RUN_QUIET_MS / 60_000);
  const onWhat = run.nowOn?.trim();
  return onWhat
    ? `The session stopped reporting while on ${firstLine(onWhat)}, and nothing was heard for ${minutes} minutes.`
    : `The session never reported progress, and nothing was heard for ${minutes} minutes.`;
}

/** Every proposed step anywhere in the tree, which approving opens. */
export function countProposed(nodes: StepNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.status === 'proposed') count += 1;
    count += countProposed(node.children);
  }
  return count;
}

/**
 * Whether a question is waiting on you: open, unanswered and not put aside
 * with Not now (plan #956).
 */
export function awaitsAnswer(node: StepNode): boolean {
  return (
    node.kind === 'decision' &&
    node.status === 'open' &&
    node.resolution === null &&
    !node.dismissedAt
  );
}

/** Open questions with no answer yet and not put aside, anywhere in the tree. */
export function countOpenQuestions(nodes: StepNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (awaitsAnswer(node)) count += 1;
    count += countOpenQuestions(node.children);
  }
  return count;
}

/** Questions put aside with Not now and not answered since, anywhere in the tree. */
export function countAside(nodes: StepNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === 'decision' && node.resolution === null && node.dismissedAt) count += 1;
    count += countAside(node.children);
  }
  return count;
}

/** The first line of a summary, short enough for one line on the page. */
function firstLine(text: string, max = 160): string {
  const line = text.trim().split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The turn appended to the goals routine's standing prompt when "Work on
 * this" is pressed. It names the goal, the account and the run row the app
 * already wrote, so the session labels every change with that run and closes
 * the row when it stops.
 */
export function goalRunText(input: {
  goalId: string;
  goalTitle: string;
  userId: string;
  runId: string;
}): string {
  return [
    `Work on one goal: "${input.goalTitle}" (goals.items id ${input.goalId}).`,
    '',
    'Follow .claude/skills/goals/SKILL.md. Read it first: it says how to map the whole path',
    'for a goal (phases, Claude steps, information steps pre-filled from Gmail, provisional',
    'steps, questions with lettered options, and the kinds of weekly help to propose), what',
    'you may change before and after the goal is approved, and how every write is labelled.',
    '',
    'Before you map, look in the other modules for what they already hold about this goal,',
    'as "Pulling in from the other modules" says, starting from the catalogue in',
    '.claude/skills/goals/reference/sources.md.',
    '',
    `The goals belong to user_id ${input.userId}. This run is goals.runs id ${input.runId},`,
    'already written as started. Set goals.run_id to it on every write, and close that row',
    'with a summary (or as failed, with the reason) before you stop.',
  ].join('\n');
}

/**
 * The turn appended to the goals routine's standing prompt when "Plan this
 * area" is pressed: the area, what you wrote you want from it, the goals
 * already under it, and the run row. The session proposes the goals the area
 * needs (.claude/skills/goals, "Planning an area"), each as a proposal you
 * approve or turn down on its own.
 */
export function areaRunText(input: {
  areaId: string;
  areaName: string;
  note: string | null;
  goals: { title: string; status: string }[];
  userId: string;
  runId: string;
}): string {
  const note = input.note?.trim();
  const goals =
    input.goals.length === 0
      ? ['It has no goals yet.']
      : ['The goals already under it:', ...input.goals.map((g) => `- ${g.title} (${g.status})`)];
  return [
    `Plan one area: "${input.areaName}" (goals.areas id ${input.areaId}).`,
    '',
    note ? `What the person wants from it, in their words:\n${note}` : 'The person has not written what they want from it.',
    '',
    ...goals,
    '',
    'Follow .claude/skills/goals/SKILL.md, "Planning an area". Read it first: it says how to',
    'propose the goals the area needs, each with a done-when and a first move, and how every',
    'write is labelled. Look in the other modules first, as "Pulling in from the other modules"',
    'says, for what the person has already written about this area.',
    '',
    `The goals belong to user_id ${input.userId}. This run is goals.runs id ${input.runId},`,
    'already written as started. Set goals.run_id to it on every write, and close that row',
    'with a summary (or as failed, with the reason) before you stop.',
  ].join('\n');
}

/** An area's latest run, as the line beside Plan this area shows it. */
export type AreaRunView = {
  runId: string;
  /** Where a run still going has got to, or null when none is going. */
  running: string | null;
  /** Why the latest run failed, or null when it did not. */
  error: string | null;
  /** The first line of the latest finished run's summary, or null. */
  summary: string | null;
};

/**
 * The line for an area's latest run. A started run gone quiet reads as
 * failed, with the reason the sweep will close it with, so the button comes
 * back without waiting for the sweep.
 */
export function areaRunView(run: GoalRun, now: number): AreaRunView {
  if (run.status === 'started' && !runIsQuiet(run, now)) {
    return { runId: run.id, running: runProgress(run, now), error: null, summary: null };
  }
  if (run.status === 'failed' || run.status === 'started') {
    const error = run.status === 'failed' ? (run.error ?? 'No reason was recorded.') : quietRunError(run);
    return { runId: run.id, running: null, error: firstLine(error), summary: null };
  }
  return { runId: run.id, running: null, error: null, summary: run.summary ? firstLine(run.summary) : null };
}

/**
 * A sent or prepared step's latest run, as its row on the goal page shows it
 * (plan #1044): where it has got to while going, then its summary or why it
 * failed. The same three lines as an area's.
 */
export type StepRunView = AreaRunView;

/** Each step's run line, keyed by step id. `now` is read once, outside render. */
export function stepRunViews(runs: Record<string, GoalRun>, now: number): Record<string, StepRunView> {
  return Object.fromEntries(Object.entries(runs).map(([id, run]) => [id, areaRunView(run, now)]));
}

/**
 * What the goal page says about approval, and what its button is called, or
 * null for no button. Approving opens the goal if Claude proposed it and every
 * proposed step under it, and from then on Claude may add, split and reorder
 * steps beneath it without asking.
 *
 * An approved goal with nothing proposed says only what questions are waiting,
 * or nothing: what approval allows was said when it was asked for, and saying
 * it on every visit after is furniture (ui finding 133242ff, plan #1038).
 */
export function approvalLine(input: {
  goalStatus: 'proposed' | 'open' | 'done' | 'dropped';
  approvedAt: string | null;
  proposed: number;
  questions: number;
}): { text: string; approve: string | null } {
  const steps = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;
  const asks =
    input.questions === 0
      ? ''
      : ` ${input.questions === 1 ? 'One question' : `${input.questions} questions`} for you ${input.questions === 1 ? 'is' : 'are'} in the steps below.`;

  if (input.goalStatus === 'proposed') {
    return {
      text: `Claude proposed this goal${input.proposed > 0 ? ` and ${steps(input.proposed)} under it` : ''}. Approving adds it to your goals.${asks}`,
      approve: 'Approve goal',
    };
  }
  if (input.approvedAt === null) {
    return {
      text:
        (input.proposed > 0
          ? `Claude proposed ${steps(input.proposed)}. Approving makes them live and lets Claude add and reorder steps here without asking.`
          : 'Not approved yet, so anything Claude adds here waits for you. Approving lets it add and reorder steps without asking.') +
        asks,
      approve: input.proposed > 0 ? 'Approve breakdown' : 'Approve goal',
    };
  }
  if (input.proposed > 0) {
    return {
      text: `${steps(input.proposed)} proposed since you approved this goal.${asks}`,
      approve: input.proposed === 1 ? 'Approve it' : 'Approve them',
    };
  }
  return { text: asks.trim(), approve: null };
}
