/**
 * Re-shaping a goal once a question on it is answered (plan #1017).
 *
 * A pg_cron tick every ten minutes (goals 0018) calls the route, which reads
 * the answers given lately and fires the goals routine once per goal that
 * has one it has not been run on since. The run follows the skill's
 * "Re-shaping after answers" section: it settles the provisional steps the
 * answers held up and writes anything new, as a live step unless working it
 * would act outside the plan (goals migration 0042).
 *
 * The rules that need no database live here: which goals are due, and the
 * brief. The reads and writes are in inngest/goals/reshape.ts.
 */
import { runIsQuiet } from '@/lib/goals/shaping';
import type { StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

/**
 * How long after the latest answer on a goal the run waits, so that several
 * answers given in one sitting start one run rather than one each.
 */
export const RESHAPE_QUIET_MS = 10 * 60 * 1000;

/**
 * How far back answers are read. Two days, so a tick that failed for a day
 * still catches up, while an answer older than every run on its goal is
 * already covered and costs nothing.
 */
export const RESHAPE_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

/** At most this many goals are fired per tick; the rest go on the next one. */
export const RESHAPE_GOAL_LIMIT = 3;

/** One answer as goals.history recorded it: which question, and when. */
export type Answer = { questionId: string; answeredAt: string };

/** One goals.runs row on a goal, as the tick reads it. */
export type GoalRunStamp = { itemId: string; status: string; createdAt: string; lastSeenAt?: string | null };

export type AnsweredQuestion = { id: string; title: string; resolution: string };

export type ProvisionalStep = { id: string; title: string; status: string };

export type ReshapeGoal = {
  goalId: string;
  goalTitle: string;
  questions: AnsweredQuestion[];
  /** The steps whose detail says they depend on one of those questions. */
  provisional: ProvisionalStep[];
  /** The latest answer on the goal, as an ISO instant. */
  latestAnswer: string;
};

const PROVISIONAL_PREFIX = /^\s*Provisional:\s*depends on\s*"([^"]*)"/i;

/** The question a provisional step names in its first line, or null for an ordinary step. */
export function provisionalOn(detail: string | null): string | null {
  if (!detail) return null;
  const match = PROVISIONAL_PREFIX.exec(detail);
  return match ? match[1].trim() : null;
}

function walk(nodes: StepNode[], visit: (node: StepNode) => void) {
  for (const node of nodes) {
    visit(node);
    walk(node.children, visit);
  }
}

/**
 * The goals due a re-shape run, oldest answer first. A goal is due when:
 *
 * - it is open or proposed, and one of its questions has an answer that is
 *   still there (a question answered and then withdrawn or archived is not
 *   in the tree);
 * - it has an answer newer than the latest `goal` or `reshape` run on it,
 *   since either run reads every answer on the goal. Only those answers go
 *   in the brief;
 * - its latest answer is at least RESHAPE_QUIET_MS old, so answers given
 *   together wait for each other;
 * - no run on it is still going, which would be a second session on the
 *   same steps. The answer is still newer than that run, so the next tick
 *   after it ends picks the goal up.
 */
export function goalsToReshape(input: {
  goals: Goal[];
  stepsByGoal: Map<string, StepNode[]>;
  answers: Answer[];
  runs: GoalRunStamp[];
  now: number;
}): ReshapeGoal[] {
  const answeredAt = new Map<string, number>();
  for (const answer of input.answers) {
    const at = Date.parse(answer.answeredAt);
    if (!Number.isFinite(at)) continue;
    answeredAt.set(answer.questionId, Math.max(at, answeredAt.get(answer.questionId) ?? 0));
  }

  const lastRun = new Map<string, number>();
  const busy = new Set<string>();
  for (const run of input.runs) {
    const at = Date.parse(run.createdAt);
    if (!Number.isFinite(at)) continue;
    lastRun.set(run.itemId, Math.max(at, lastRun.get(run.itemId) ?? 0));
    if (run.status === 'started' && !runIsQuiet(run, input.now)) busy.add(run.itemId);
  }

  const due: ReshapeGoal[] = [];
  for (const goal of input.goals) {
    if (goal.status !== 'open' && goal.status !== 'proposed') continue;
    const steps = input.stepsByGoal.get(goal.id) ?? [];

    const since = lastRun.get(goal.id) ?? 0;
    const questions: AnsweredQuestion[] = [];
    let latest = 0;
    walk(steps, (node) => {
      const at = answeredAt.get(node.id);
      if (at === undefined || at <= since) return;
      if (node.kind !== 'decision' || node.resolution === null) return;
      questions.push({ id: node.id, title: node.title, resolution: node.resolution });
      latest = Math.max(latest, at);
    });
    if (questions.length === 0) continue;
    if (input.now - latest < RESHAPE_QUIET_MS) continue;
    if (busy.has(goal.id)) continue;

    const titles = new Set(questions.map((q) => q.title.trim().toLowerCase()));
    const provisional: ProvisionalStep[] = [];
    walk(steps, (node) => {
      const on = provisionalOn(node.detail);
      if (on !== null && titles.has(on.toLowerCase()) && node.status !== 'dropped' && node.status !== 'done') {
        provisional.push({ id: node.id, title: node.title, status: node.status });
      }
    });

    due.push({
      goalId: goal.id,
      goalTitle: goal.title,
      questions,
      provisional,
      latestAnswer: new Date(latest).toISOString(),
    });
  }
  return due.sort((a, b) => Date.parse(a.latestAnswer) - Date.parse(b.latestAnswer));
}

/**
 * The turn appended to the goals routine's standing prompt for a re-shape
 * run. It names the goal, the answers and the provisional steps they held
 * up, so the session settles those rather than mapping the goal again.
 */
export function reshapeRunText(input: { userId: string; runId: string; goal: ReshapeGoal }): string {
  const { goal } = input;
  const answers = goal.questions.map(
    (q) => `- "${q.title}" (goals.items id ${q.id}), answered: ${q.resolution.replace(/\s+/g, ' ').trim()}`,
  );
  const provisional =
    goal.provisional.length > 0
      ? goal.provisional.map((s) => `- "${s.title}" (goals.items id ${s.id}), ${s.status}`)
      : ['- none found by their Provisional line; read the tree for any that hang on these answers'];
  return [
    `Re-shape one goal after answers: "${goal.goalTitle}" (goals.items id ${goal.goalId}).`,
    '',
    'Questions answered since the last run on it:',
    ...answers,
    '',
    'Provisional steps that name those questions:',
    ...provisional,
    '',
    'Follow .claude/skills/goals/SKILL.md, the sections "Re-shaping after answers" and',
    '"The re-shape run". Settle each provisional step the answers bear on, and write',
    'anything new as a live step, or as a proposal if working it would act outside the plan.',
    'Do not map the goal again, and do not work Claude steps.',
    '',
    `The goals belong to user_id ${input.userId}. This run is goals.runs id ${input.runId},`,
    'already written as started. Set goals.run_id to it on every write, and close that row',
    'with a summary (or as failed, with the reason) before you stop.',
  ].join('\n');
}
