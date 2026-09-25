import 'server-only';

import { z } from 'zod';
import { goalsRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { liveRhythms } from '@/lib/goals/rhythms';
import { recordAndFire } from '@/lib/goals/shaping-store';
import { loadLiveTree } from '@/lib/goals/steps-store';
import { helpGoals, ignoredBefore, pastSince, ranThisWeek, weeklyRunText } from '@/lib/goals/suggestions';
import { ignoreUnanswered, loadPastSuggestions } from '@/lib/goals/suggestions-store';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';

/**
 * The weekly goals run (docs/GOALS-SPEC.md, "What Claude does, and when";
 * plan #934), a stage of the daily cron. Vercel's Hobby plan allows one cron,
 * so the week is kept by the gap since the last weekly run rather than by a
 * schedule of its own.
 *
 * Every day it closes the week for suggestions nobody reacted to, marking
 * them ignored. Then, once a week, it fires the goals routine for the owner
 * with the run row written first and a brief naming each open goal with the
 * kinds of help it asks for (plan #1028), and every reaction from the last
 * few weeks under its kind. It fires nothing when the routine is not set,
 * when a weekly run started in the last week, or when no open goal asks for
 * any help, because each run spends the owner's routine allowance. A fire that fails throws, so the cron reports the stage
 * as failed.
 */

export type GoalsWeeklyResult =
  | { skipped: string; ignored?: number }
  | { started: true; runId: string; goals: number; past: number; ignored: number };

export type GoalsWeeklyDeps = {
  client: GoalsSupabaseClient;
  routine: RoutineTarget;
  now: number;
  fetch?: typeof globalThis.fetch;
};

const ownerSchema = z.object({ userId: z.string().uuid() });

export async function runGoalsWeekly(deps?: Partial<GoalsWeeklyDeps>): Promise<GoalsWeeklyResult> {
  const routine = deps?.routine ?? goalsRoutine();
  if (!routine.id) return { skipped: 'CLAUDE_GOALS_ROUTINE_ID is not set' };
  const client = deps?.client ?? createGoalsServiceSupabase();
  const now = deps?.now ?? Date.now();

  const owner = await client.schema('public').rpc('app_owner');
  const parsed = ownerSchema.safeParse(owner.data);
  if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to run goals for.');
  const userId = parsed.data.userId;

  const ignored = await ignoreUnanswered(client, userId, ignoredBefore(now));

  const last = await client
    .from('runs')
    .select('created_at')
    .eq('user_id', userId)
    .eq('job', 'weekly')
    .order('created_at', { ascending: false })
    .limit(1);
  if (last.error) throw new Error(`Could not read goals runs: ${last.error.message}`);
  const lastAt = (last.data?.[0]?.created_at as string | undefined) ?? null;
  if (ranThisWeek(lastAt, now)) return { skipped: 'a weekly run already started this week', ignored };

  const { goals, byGoal } = await loadLiveTree(client, { userId });
  const open = goals.map((g) => g.goal);
  const asking = helpGoals(open, liveRhythms(open, byGoal));
  if (asking.length === 0) return { skipped: 'no open goal asks for weekly help', ignored };

  const past = await loadPastSuggestions(client, userId, pastSince(now));

  const result = await recordAndFire({
    client,
    userId,
    job: 'weekly',
    itemId: null,
    routine,
    text: (runId) => weeklyRunText({ userId, runId, goals: asking, past }),
    fetch: deps?.fetch,
  });
  if (!result.ok) {
    throw new Error(`The weekly goals run did not start (run ${result.runId ?? 'not recorded'}): ${result.error}`);
  }
  return { started: true, runId: result.runId, goals: asking.length, past: past.length, ignored };
}
