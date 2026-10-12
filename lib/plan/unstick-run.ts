import 'server-only';

/**
 * Send a stall diagnosis at a feature (`unstick` runs, `stallMove` in
 * ./stall.ts). The turn is `unstickTurn`, followed by the plan as the app holds
 * it, the same brief a build run gets.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { planRoutine } from '@/lib/feedback/routine';
import { loadVisionBodies } from '@/lib/specs/vision';
import { planBrief } from './brief';
import { startRoutineRun } from './runs';
import { unstickTurn, type StallRun } from './stall';
import type { PlanNode, PlanSection } from './tree';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

export async function startUnstick(input: {
  supabase: Db;
  userId: string;
  sections: readonly PlanSection[];
  feature: PlanNode;
  runs: readonly StallRun[];
}): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId, sections, feature, runs } = input;
  const text =
    `${unstickTurn(feature, runs)}\n\nThe brief is below; it is the plan as the app holds it right ` +
    'now, and the plan is the source of truth.\n\n' +
    planBrief(sections, feature, { thread: true, visions: await loadVisionBodies(supabase, userId) });
  const result = await startRoutineRun({
    supabase,
    userId,
    job: 'unstick',
    routine: planRoutine(),
    planItemId: feature.id,
    text,
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
