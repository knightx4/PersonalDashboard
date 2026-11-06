import 'server-only';

/**
 * Send a session to land a feature's built steps (`land` runs, plan #2815.2).
 * The turn is `landTurn`, followed by the plan as the app holds it, the same
 * brief a build run gets. A project's feature goes to its own routine, the
 * same way a build of it would.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadVisionBodies } from '@/lib/specs/vision';
import { planBrief } from './brief';
import { builderFor, projectPreamble } from './handover';
import { landTurn } from './land';
import { startRoutineRun } from './runs';
import type { PlanNode, PlanSection } from './tree';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

export async function startLand(input: {
  supabase: Db;
  userId: string;
  sections: readonly PlanSection[];
  feature: PlanNode;
  built: readonly PlanNode[];
}): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId, sections, feature, built } = input;
  const builder = builderFor(sections, feature);
  if (!builder.ok) return { ok: false, error: builder.error };
  const text =
    (builder.project ? projectPreamble(builder.project) : '') +
    `${landTurn(feature, built)}\n\nThe brief is below; it is the plan as the app holds it right ` +
    'now, and the plan is the source of truth.\n\n' +
    planBrief(sections, feature, { thread: true, visions: await loadVisionBodies(supabase, userId) });
  const result = await startRoutineRun({
    supabase,
    userId,
    job: 'land',
    routine: builder.routine,
    planItemId: feature.id,
    text,
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
