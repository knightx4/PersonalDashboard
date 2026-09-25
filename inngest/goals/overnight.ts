import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { goalsRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import { readyClaudeSteps } from '@/lib/goals/daily-run';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { sendGoalStep } from '@/lib/goals/handover-store';
import { chooseNightSteps, type NightRun, type NightStep } from '@/lib/goals/overnight-choice';
import { loadGoalActivity } from '@/lib/goals/reviews-store';
import { runOutcome } from '@/lib/goals/runs';
import type { GoalRunStatus } from '@/lib/goals/shaping';
import type { StepNode } from '@/lib/goals/steps';
import { loadLiveTree } from '@/lib/goals/steps-store';
import {
  loadOvernightRun,
  overnightVerdict,
  recordOvernightGoalFire,
  type OvernightRun,
} from '@/lib/plan/overnight';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';

/**
 * The goals half of the overnight tick (plan #1008).
 *
 * Decision #1006 put goal runs into the plan's overnight runner rather than a
 * runner of their own, so this reads the same `plan_overnight_runs` row and
 * the same `overnightVerdict`: the start, pause and stop on /dev/plan hold
 * goal runs exactly as they hold features, and a goal run spends one of the
 * night's budget. It runs after the feature half of each account's tick,
 * which is what ends the night once the budget or the clock is gone; this
 * half only declines to start anything then.
 *
 * One goal at a time. While any goals run is going, whoever started it, the
 * tick starts nothing; once it has finished, the next tick sends the step
 * `chooseNightSteps` puts first. Each is sent through `sendGoalStep`, the same
 * hand-over as Send on the step, so the brief, the run row and the refusals
 * are the ones a press gets. A step the send refuses is passed over and the
 * next one tried; a fire that failed ends the turn, since the next step would
 * go to the same routine.
 */

/** What the goals half of one tick did. */
export type GoalsNightTick =
  | { act: 'idle' }
  | { act: 'paused' }
  /** The budget or the clock is gone; the feature half ends the night. */
  | { act: 'spent' }
  | { act: 'no-routine' }
  /** A goals run is going, and the night starts one at a time. */
  | { act: 'waiting' }
  | { act: 'nothing-ready' }
  | {
      act: 'fired';
      stepId: string;
      title: string;
      goalTitle: string;
      runId: string;
      featuresLeft: number | null;
      /** Steps the send refused on the way here, by title. */
      refused: string[];
    }
  | { act: 'failed'; error: string };

/** What the choice reads, loaded in one go. */
export type GoalsNight = {
  steps: NightStep[];
  runs: NightRun[];
  lastProgressAt: Map<string, string | null>;
};

/** Everything the goals half needs from outside itself, handed in so it tests without a database. */
export type GoalsNightPorts = {
  now: number;
  loadRun: () => Promise<OvernightRun | null>;
  loadNight: () => Promise<GoalsNight>;
  fire: (
    step: NightStep,
  ) => Promise<{ ok: true; runId: string } | { ok: false; error: string; refused: boolean }>;
  /** Take one off the budget, given what the row said was left. */
  recordFire: (featuresLeft: number | null) => Promise<void>;
};

export async function goalsNightTick(ports: GoalsNightPorts): Promise<GoalsNightTick> {
  const run = await ports.loadRun();
  const verdict = overnightVerdict(run, ports.now);
  if (verdict.act === 'idle' || !run) return { act: 'idle' };
  if (verdict.act === 'paused') return { act: 'paused' };
  if (verdict.act === 'end') return { act: 'spent' };

  const night = await ports.loadNight();
  if (night.runs.some((one) => runOutcome(one, ports.now) === 'running')) {
    return { act: 'waiting' };
  }

  const { chosen } = chooseNightSteps({ ...night, now: ports.now });
  const refused: string[] = [];
  for (const step of chosen) {
    const sent = await ports.fire(step);
    if (sent.ok) {
      await ports.recordFire(run.featuresLeft);
      return {
        act: 'fired',
        stepId: step.id,
        title: step.title,
        goalTitle: step.goalTitle,
        runId: sent.runId,
        featuresLeft: run.featuresLeft === null ? null : Math.max(0, run.featuresLeft - 1),
        refused,
      };
    }
    if (!sent.refused) return { act: 'failed', error: sent.error };
    refused.push(step.title);
  }
  return { act: 'nothing-ready' };
}

/** The sentence the runner's note gains from the goals half, or null for nothing worth saying. */
export function goalsNightNote(tick: GoalsNightTick): string | null {
  if (tick.act === 'fired') return `Started the goal step "${tick.title}" on "${tick.goalTitle}".`;
  if (tick.act === 'failed') return `A goal step could not be started: ${tick.error}`;
  return null;
}

/** Enough runs to read each step's last two, and far past what one night starts. */
const RUNS_LIMIT = 500;

/** Each step's goal and due date, from the live tree. */
function indexTree(byGoal: Map<string, StepNode[]>) {
  const goalOf = new Map<string, string>();
  const dueOf = new Map<string, string | null>();
  for (const [goalId, nodes] of byGoal) {
    goalOf.set(goalId, goalId);
    const walk = (list: StepNode[]) => {
      for (const node of list) {
        goalOf.set(node.id, goalId);
        dueOf.set(node.id, node.dueOn);
        walk(node.children);
      }
    };
    walk(nodes);
  }
  return { goalOf, dueOf };
}

/** The ready Claude steps, every run on the account, and each goal's last progress. */
export async function loadGoalsNight(client: GoalsSupabaseClient, userId: string): Promise<GoalsNight> {
  const [{ goals, byGoal }, runs, activity] = await Promise.all([
    loadLiveTree(client, { userId }),
    client
      .from('runs')
      .select('item_id, status, created_at, last_seen_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(RUNS_LIMIT),
    loadGoalActivity(client, userId),
  ]);
  if (runs.error) throw new Error(`Could not read goal runs: ${runs.error.message}`);

  const { goalOf, dueOf } = indexTree(byGoal);
  const steps = readyClaudeSteps(
    goals.map((g) => g.goal),
    byGoal,
  ).map((step) => ({ ...step, dueOn: dueOf.get(step.id) ?? null }));

  // A run on nothing in the live tree (the morning run, a goal since
  // archived) keeps its own item as its goal: it still holds the night while
  // it is going, and matches no ready step.
  const nightRuns: NightRun[] = (
    (runs.data ?? []) as Array<{
      item_id: string | null;
      status: GoalRunStatus;
      created_at: string;
      last_seen_at: string | null;
    }>
  ).map((row) => ({
    goalId: (row.item_id && goalOf.get(row.item_id)) ?? row.item_id ?? '',
    stepId: row.item_id && row.item_id !== goalOf.get(row.item_id) ? row.item_id : null,
    status: row.status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }));

  const lastProgressAt = new Map<string, string | null>();
  for (const [goalId, seen] of activity) lastProgressAt.set(goalId, seen.lastDoneAt);
  return { steps, runs: nightRuns, lastProgressAt };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/**
 * One account's goals half, with the real reads and writes. Starts nothing
 * when the goals routine is not set on the deployment.
 */
export async function runGoalsNight(input: {
  supabase: Db;
  userId: string;
  now: number;
  client?: GoalsSupabaseClient;
  routine?: RoutineTarget;
  fetch?: typeof globalThis.fetch;
}): Promise<GoalsNightTick> {
  const routine = input.routine ?? goalsRoutine();
  if (!routine.id) return { act: 'no-routine' };
  const { supabase, userId, now } = input;
  let client = input.client ?? null;
  const goals = () => (client ??= createGoalsServiceSupabase());

  return goalsNightTick({
    now,
    loadRun: () => loadOvernightRun(supabase, userId),
    loadNight: () => loadGoalsNight(goals(), userId),
    fire: async (step) => {
      const sent = await sendGoalStep({
        client: goals(),
        userId,
        stepId: step.id,
        routine,
        now,
        fetch: input.fetch,
      });
      if (sent.ok) {
        console.log(`overnight: sent goal step "${sent.title}" (run ${sent.runId}).`);
        return { ok: true, runId: sent.runId };
      }
      return { ok: false, error: sent.error, refused: sent.refused === true };
    },
    recordFire: async (featuresLeft) => {
      const { error } = await recordOvernightGoalFire({ supabase, userId, featuresLeft });
      if (error) console.error(`the overnight goal fire could not be recorded: ${error}`);
    },
  });
}
