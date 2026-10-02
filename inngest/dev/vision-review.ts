import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { visionRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import { startRoutineRun } from '@/lib/plan/runs';
import {
  loadVisionRunFacts,
  loadWindowOpens,
  visionReviewDue,
  visionRunText,
  type WindowOpens,
} from '@/lib/specs/vision-review-run';
import { createServiceSupabase } from '@/inngest/supabase-admin';

/**
 * The weekly vision review tick (plan #1108), called on Sundays by pg_cron
 * (supabase/migrations/0110_vision_review_weekly.sql).
 *
 * Fires the vision review routine once for the owner, which follows
 * .claude/skills/vision-review, and records the fire in `plan_runs` with job
 * `vision`. Refuses when a review was written or started in the last six
 * days, so a second call in the same week fires nothing.
 *
 * The owner only: the visions are the app's, and the allowance each run
 * spends is the owner's.
 */

export type VisionReviewTickResult =
  | { skipped: string }
  | { started: string | null }
  | { failed: string };

export type VisionReviewTickDeps = {
  client: SupabaseClient;
  routine: RoutineTarget;
  now: number;
  fetch?: typeof globalThis.fetch;
};

const ownerSchema = z.object({ userId: z.string().uuid() });

export async function runVisionReviewTick(
  deps?: Partial<VisionReviewTickDeps>,
): Promise<VisionReviewTickResult> {
  const routine = deps?.routine ?? visionRoutine();
  if (!routine.id) return { skipped: 'CLAUDE_VISION_ROUTINE_ID is not set' };
  const client = deps?.client ?? createServiceSupabase();
  const now = deps?.now ?? Date.now();

  const owner = await client.rpc('app_owner');
  const parsed = ownerSchema.safeParse(owner.data);
  if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to review for.');
  const userId = parsed.data.userId;

  const facts = await loadVisionRunFacts(client, userId);
  const due = visionReviewDue({ ...facts, now });
  if (!due.due) return { skipped: due.reason };

  // The opens since the last review go in the turn (plan #1483). A failed
  // read does not stop the review: the turn says so and the skill reads them.
  let opens: WindowOpens | null = null;
  try {
    opens = await loadWindowOpens(client, userId, facts.lastReviewAt);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }

  const result = await startRoutineRun({
    supabase: client,
    userId,
    job: 'vision',
    routine,
    text: visionRunText(userId, opens),
    fetch: deps?.fetch,
  });
  return result.ok ? { started: result.runId } : { failed: result.error };
}
