/**
 * Claude shaping a goal, and approving what it proposed (docs/GOALS-SPEC.md,
 * "Fog and refining a goal" and "Approval"; plan #932).
 *
 * "Work on this" on a goal fires the goals routine for that goal. The session
 * follows .claude/skills/goals: on a new or foggy goal it proposes steps and
 * asks one or two questions; once you approve the goal it may add, split and
 * reorder steps beneath it without asking. The database holds it to that
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
};

/**
 * How long a started run is taken to still be working. A session that dies
 * never writes its row back, so past this the page stops saying Claude is on
 * it and lets you press again. The same two hours the dev plan uses.
 */
export const RUN_QUIET_MS = 2 * 60 * 60 * 1000;

/** Whether a run is still taken to be going, so a second press is refused. */
export function runInFlight(run: GoalRun | null, now: number): boolean {
  if (!run || run.status !== 'started') return false;
  return now - Date.parse(run.createdAt) < RUN_QUIET_MS;
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

/** Open questions with no answer yet, anywhere in the tree. */
export function countOpenQuestions(nodes: StepNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === 'decision' && node.status === 'open' && node.resolution === null) count += 1;
    count += countOpenQuestions(node.children);
  }
  return count;
}

/** The first line of a summary, short enough for one line on the page. */
function firstLine(text: string, max = 160): string {
  const line = text.trim().split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * What the page says about the latest run on a goal, or null when there has
 * never been one. `when` formats an instant for the reader's clock.
 */
export function runLine(
  run: GoalRun | null,
  now: number,
  when: (iso: string) => string,
): string | null {
  if (!run) return null;
  if (run.status === 'failed') {
    return `The last run did not start or did not finish: ${firstLine(run.error ?? 'no reason given')}`;
  }
  if (run.status === 'done') {
    const at = when(run.endedAt ?? run.createdAt);
    return run.summary ? `Claude worked on this ${at}: ${firstLine(run.summary)}` : `Claude worked on this ${at}.`;
  }
  if (runInFlight(run, now)) return `Claude is working on this, started ${when(run.createdAt)}.`;
  return `A run started ${when(run.createdAt)} and never reported back.`;
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
    'Follow .claude/skills/goals/SKILL.md. Read it first: it says how to shape a new or',
    'foggy goal, what you may change before and after the goal is approved, and how every',
    'write is labelled.',
    '',
    `The goals belong to user_id ${input.userId}. This run is goals.runs id ${input.runId},`,
    'already written as started. Set goals.run_id to it on every write, and close that row',
    'with a summary (or as failed, with the reason) before you stop.',
  ].join('\n');
}

/**
 * What the goal page says about approval, and what its button is called, or
 * null for no button. Approving opens the goal if Claude proposed it and every
 * proposed step under it, and from then on Claude may add, split and reorder
 * steps beneath it without asking.
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
  return {
    text: `Approved. Claude adds and reorders steps here without asking, and asks before changing the done-when or dropping your steps.${asks}`,
    approve: null,
  };
}
