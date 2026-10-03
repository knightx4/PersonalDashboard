import 'server-only';

import { z } from 'zod';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { goalsRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import { outOfDateSteps } from '@/lib/goals/answers';
import { loadOutOfDateAnswers } from '@/lib/goals/answers-store';
import { DAILY_STEP_LIMIT, dailyRunText, ranRecently, readyClaudeSteps } from '@/lib/goals/daily-run';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { evidenceLines, evidenceSteps, filterEvidence } from '@/lib/goals/evidence';
import { evidenceSince, loadEvidenceItems } from '@/lib/goals/evidence-store';
import type { StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';
import { holdActingSteps } from '@/lib/goals/hold-acts-store';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { reviewGoals } from '@/lib/goals/reviews';
import { loadGoalActivity, loadLatestReviews } from '@/lib/goals/reviews-store';
import { prepCandidates } from '@/lib/goals/prep-candidates';
import { summariseProgress } from '@/lib/goals/progress';
import { progressNudges } from '@/lib/goals/progress-nudges';
import { loadProgressEntries } from '@/lib/goals/progress-store';
import { recordAndFire } from '@/lib/goals/shaping-store';
import { STALE_STEP_LIMIT, staleSteps } from '@/lib/goals/stale-steps';
import { statementLines, type StatementSource } from '@/lib/goals/statements';
import { loadStatementSources } from '@/lib/goals/statements-store';
import { loadStepTouches } from '@/lib/goals/stale-steps-store';
import { accountToday, loadLiveTree } from '@/lib/goals/steps-store';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';

/**
 * The morning goals run (docs/GOALS-SPEC.md, "What Claude does, and when";
 * plan #933), a stage of the daily cron.
 *
 * Fires the goals routine once for the owner each morning while there is an
 * open goal, with the run row written first. The brief lists every open goal
 * to give its status for the day (plan #1074), the steps of the owner's that
 * have sat untouched for a week and need a move (plan #1083), those not yet
 * judged for a Dash prep step (plan #1217), then the Claude
 * steps that are ready and the information steps with an answer out of date
 * (plan #989). Before the brief is written, Jev reads everything that arrived
 * since the last run against the person's open steps, and the brief lists
 * only what bears on one (plan #1176). Collections with a learned sender are
 * listed first, with the Gmail search that finds their new statements (plan
 * #1023). Before the tree is read, a Claude step that acts outside the plan
 * is held as a proposal (plan #1183). A status is never more than a day old because this run writes
 * one every day, so it no longer waits for a ready step. It starts nothing when the routine
 * is not set on the deployment, when a morning run already started in the
 * last twenty hours, or when there is no open goal and nothing to work,
 * because each run spends the owner's routine allowance. A fire that fails
 * throws, so the cron reports the stage as failed.
 *
 * The owner only: goals are personal, and the allowance the run spends is
 * the owner's.
 */

export type GoalsDailyResult =
  | { skipped: string }
  | {
      started: true;
      runId: string;
      /** Open goals given a status. */
      reviewed: number;
      steps: number;
      held: number;
      answers: number;
      /** Steps of the person's that have sat for a week, listed for a move. */
      stale: number;
      /** Steps of the person's not judged yet for a Dash prep step (plan #1217). */
      unjudged: number;
      /** Steps under way with nothing logged for a week, to nudge (plan #1281). */
      stalled: number;
      /** Steps under way whose tally reached its total, to offer closing (plan #1281). */
      finished: number;
      /**
       * Steps with evidence Jev kept, or null when Jev did not filter and the
       * session searched for itself.
       */
      evidence: number | null;
      /** Collections whose new Gmail statements the run was asked to read (plan #1023). */
      statements: number;
    };

export type GoalsDailyDeps = {
  client: GoalsSupabaseClient;
  routine: RoutineTarget;
  now: number;
  fetch?: typeof globalThis.fetch;
  /** Stands in for readEvidence, so a test need not answer every schema's reads. */
  evidence?: (input: EvidenceInput) => Promise<EvidenceBrief | null>;
  /** Stands in for holdActingSteps (plan #1183). */
  holdActs?: (input: { client: GoalsSupabaseClient; userId: string; scheduled?: boolean }) => Promise<unknown>;
  /** Stands in for loadStatementSources, for the same reason. */
  statements?: (
    client: GoalsSupabaseClient,
    userId: string,
    today: string,
  ) => Promise<StatementSource[]>;
};

type EvidenceInput = {
  client: GoalsSupabaseClient;
  userId: string;
  lastRunAt: string | null;
  today: string;
  now: number;
  goals: Goal[];
  byGoal: Map<string, StepNode[]>;
};

type EvidenceBrief = { lines: string[]; steps: number };

/**
 * The evidence for the brief, filtered by Jev (plan #1176), or null to leave
 * the session searching for itself as before: when the owner has not agreed
 * to send text to TypeSafe, when a read fails, and when Jev fails. Never
 * throws, because the run is still worth firing without it.
 */
async function readEvidence(input: EvidenceInput): Promise<EvidenceBrief | null> {
  const core = input.client.schema('core') as unknown as CoreSupabaseClient;
  try {
    if (!(await jevEnabledFor(core, input.userId))) return null;
    const steps = evidenceSteps(input.goals, input.byGoal);
    const items = await loadEvidenceItems(input.client, {
      userId: input.userId,
      since: evidenceSince(input.lastRunAt, input.now),
      today: input.today,
    });
    const spend: SpendReport[] = [];
    const filtered = await filterEvidence({ steps, items, onSpend: (report) => spend.push(report) });
    await recordSpendReports(core, input.userId, { module: 'goals', operation: 'filter-evidence' }, spend);
    if (!filtered.ok) {
      if (filtered.failure.reason !== 'no-key') {
        console.warn(`[goals] evidence filter fell back: ${filtered.failure.reason}`);
      }
      return null;
    }
    return { lines: evidenceLines(filtered.matches, filtered.items), steps: filtered.matches.length };
  } catch (error) {
    console.warn(`[goals] evidence filter fell back: ${error instanceof Error ? error.message : 'failed'}`);
    return null;
  }
}

const ownerSchema = z.object({ userId: z.string().uuid() });

export async function runGoalsDaily(deps?: Partial<GoalsDailyDeps>): Promise<GoalsDailyResult> {
  const routine = deps?.routine ?? goalsRoutine();
  if (!routine.id) return { skipped: 'CLAUDE_GOALS_ROUTINE_ID is not set' };
  const client = deps?.client ?? createGoalsServiceSupabase();
  const now = deps?.now ?? Date.now();

  const owner = await client.schema('public').rpc('app_owner');
  const parsed = ownerSchema.safeParse(owner.data);
  if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to run goals for.');
  const userId = parsed.data.userId;

  const last = await client
    .from('runs')
    .select('created_at')
    .eq('user_id', userId)
    .eq('job', 'daily')
    .order('created_at', { ascending: false })
    .limit(1);
  if (last.error) throw new Error(`Could not read goals runs: ${last.error.message}`);
  const lastAt = (last.data?.[0]?.created_at as string | undefined) ?? null;
  if (ranRecently(lastAt, now)) return { skipped: 'a morning run already started today' };

  // A Claude step that acts outside the plan becomes a proposal before the
  // tree is read, so it is not in the brief's ready steps (plan #1183).
  await (deps?.holdActs ?? holdActingSteps)({ client, userId, scheduled: true });

  // A step whose start date has not come is left for a later morning.
  const today = await accountToday(client, userId, now);
  const [{ goals, byGoal }, stale, activity, latest, touched] = await Promise.all([
    loadLiveTree(client, { userId, today }),
    loadOutOfDateAnswers(client, userId),
    loadGoalActivity(client, userId),
    loadLatestReviews(client, { userId, now }),
    loadStepTouches(client, userId),
  ]);
  const review = reviewGoals(
    goals.map((g) => g.goal),
    activity,
    latest,
    now,
  );
  const ready = readyClaudeSteps(
    goals.map((g) => g.goal),
    byGoal,
  );
  const answers = outOfDateSteps(
    goals.map((g) => g.goal),
    byGoal,
    stale,
  );
  if (review.length === 0 && ready.length === 0 && answers.length === 0) {
    return { skipped: 'no open goal, no Claude step ready and no answer out of date' };
  }
  const steps = ready.slice(0, DAILY_STEP_LIMIT);
  // A step under way is nudged when nothing has been logged on it for a
  // week, and offered for closing when its tally reaches its total (plan
  // #1281). Either way it is read from its entries, so it is not also given
  // a move below as a step untouched for a week.
  const stepIds: string[] = [];
  const collect = (nodes: StepNode[]) => {
    for (const node of nodes) {
      if (node.status === 'open') stepIds.push(node.id);
      collect(node.children);
    }
  };
  for (const nodes of byGoal.values()) collect(nodes);
  const progress = summariseProgress(await loadProgressEntries(client, stepIds));
  const underWay = progressNudges(
    goals.map((g) => g.goal),
    byGoal,
    progress,
    today,
  );
  // A step of the person's untouched for a week gets a move (plan #1083).
  // Only an open goal has one, so the review above already starts the run.
  const sitting = staleSteps(
    goals.map((g) => g.goal),
    byGoal,
    touched,
    now,
  )
    .filter((step) => !progress[step.id])
    .slice(0, STALE_STEP_LIMIT);
  // A step of the person's not judged yet for a Dash prep step, ten a morning,
  // newest first (plan #1217). One listed above as stale gets only that move,
  // since preparing it is one of those moves.
  const unjudged = prepCandidates(
    goals.map((g) => g.goal),
    byGoal,
    new Set(sitting.map((s) => s.id)),
  );

  // Only the review closes steps from evidence, so only a run with one reads it.
  const evidence =
    review.length > 0
      ? await (deps?.evidence ?? readEvidence)({
          client,
          userId,
          lastRunAt: lastAt,
          today,
          now,
          goals: goals.map((g) => g.goal),
          byGoal,
        })
      : null;

  // New statements are read first, so the review sees current figures. A
  // failed read leaves them for tomorrow rather than holding up the run.
  let statements: StatementSource[] = [];
  try {
    statements = await (deps?.statements ?? loadStatementSources)(client, userId, today);
  } catch (error) {
    console.warn(
      `[goals] statement sources not read: ${error instanceof Error ? error.message : 'failed'}`,
    );
  }

  const result = await recordAndFire({
    client,
    userId,
    job: 'daily',
    itemId: null,
    routine,
    text: (runId) => dailyRunText({
        userId,
        runId,
        steps,
        answers,
        review,
        stale: sitting,
        underWay,
        unjudged,
        evidence: evidence?.lines ?? null,
        statements: statementLines(statements),
      }),
    fetch: deps?.fetch,
  });
  // Thrown so the cron reports the stage as failed. The run row, when there
  // is one, already says failed with the reason.
  if (!result.ok) {
    throw new Error(`The morning goals run did not start (run ${result.runId ?? 'not recorded'}): ${result.error}`);
  }
  return {
    started: true,
    runId: result.runId,
    reviewed: review.length,
    steps: steps.length,
    held: ready.length - steps.length,
    answers: answers.length,
    stale: sitting.length,
    unjudged: unjudged.length,
    stalled: underWay.stalled.length,
    finished: underWay.finished.length,
    evidence: evidence?.steps ?? null,
    statements: statements.length,
  };
}
