/**
 * The morning run (docs/GOALS-SPEC.md, "What Claude does, and when"; plan
 * #933).
 *
 * Each morning the daily cron fires the goals routine once for the owner, if
 * there is a Claude step ready for it. The routine works each one, stores what
 * it produced on the step and closes it, and the home lists the result as
 * waiting on you until you mark it read.
 *
 * The rules that need no database live here: which steps are ready, whether
 * a run already happened today, and the brief the routine is fired with. The
 * reads and writes are in inngest/goals/daily.ts.
 */
import { isStaleStepBlock, waitsOnNothing } from '@/lib/goals/dependencies';
import type { StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

/** More than this many and the rest wait for tomorrow, so one run stays one sitting. */
export const DAILY_STEP_LIMIT = 10;

/**
 * How long after one morning run another is refused. Less than a day, so a
 * cron that fires a little early tomorrow still runs, and more than a retry
 * window, so a retried cron today does not spend a second run.
 */
export const DAILY_GAP_MS = 20 * 60 * 60 * 1000;

export type ReadyStep = { id: string; title: string; goalId: string; goalTitle: string };

/**
 * Every Claude step the morning run should work, in page order: an open
 * `claude` step under an open goal, reached through open steps only, with no
 * open step beneath it and nothing produced yet. A step with open sub-steps
 * waits on them, as on the home, and so does one waiting on other steps
 * (plan #981). A blocked step and what is under it wait on you.
 */
export function readyClaudeSteps(goals: Goal[], stepsByGoal: Map<string, StepNode[]>): ReadyStep[] {
  const ready: ReadyStep[] = [];
  for (const goal of goals) {
    if (goal.status !== 'open') continue;
    const walk = (nodes: StepNode[]) => {
      for (const node of nodes) {
        if (node.status !== 'open' && !isStaleStepBlock(node)) continue;
        if (
          node.kind === 'claude' &&
          node.result === null &&
          node.resultUrl === null &&
          waitsOnNothing(node)
        ) {
          ready.push({ id: node.id, title: node.title, goalId: goal.id, goalTitle: goal.title });
        }
        walk(node.children);
      }
    };
    walk(stepsByGoal.get(goal.id) ?? []);
  }
  return ready;
}

/** Whether a morning run was started recently enough that today's is done. */
export function ranRecently(lastDailyRunAt: string | null, now: number): boolean {
  if (!lastDailyRunAt) return false;
  return now - Date.parse(lastDailyRunAt) < DAILY_GAP_MS;
}

/**
 * The turn appended to the goals routine's standing prompt for the morning
 * run. It names the account, the run row already written and the steps to
 * work, so the session does not have to decide which steps are ready.
 */
export function dailyRunText(input: { userId: string; runId: string; steps: ReadyStep[] }): string {
  const lines = input.steps.map(
    (step) => `- "${step.title}" (goals.items id ${step.id}), under the goal "${step.goalTitle}"`,
  );
  return [
    'The morning run: work the Claude steps that are ready.',
    '',
    ...lines,
    '',
    'Follow .claude/skills/goals/SKILL.md, the section "The morning run". For each step,',
    'produce what its title and done-when ask for, store it in the step\'s result (and',
    'result_url when it lives somewhere with a link), and close the step as done. A step',
    'you cannot finish stays open, with the reason in the run summary.',
    '',
    `The goals belong to user_id ${input.userId}. This run is goals.runs id ${input.runId},`,
    'already written as started. Set goals.run_id to it on every write, and close that row',
    'with a summary (or as failed, with the reason) before you stop.',
  ].join('\n');
}
