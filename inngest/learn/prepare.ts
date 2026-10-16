import 'server-only';

import { z } from 'zod';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createServiceSupabase as createJobsServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { liveHandlers } from '@/lib/learn/prepare/handlers';
import { kickPreparation } from '@/lib/learn/prepare/kick';
import { PREPARE_BUDGET_MS, runPreparation, type PreparationResult } from '@/lib/learn/prepare/run';
import { ensurePreparation, preparationStore, unfinishedPreparations } from '@/lib/learn/prepare/store';

/**
 * Working a subject's preparation run outside any request (plan #2276.1).
 *
 * pumpPreparation is what /api/cron/learn-prepare runs after it has answered: one
 * budgeted call of the runner for the subject's own account, then, if the
 * budget ran out first, a call to the same route so the next function carries
 * on at the same step. runPreparationsDaily is the daily cron's stage: it
 * starts each unfinished run in a function of its own, so none of them spends
 * the cron's five minutes.
 */

/** Unfinished runs the cron starts in one morning. */
const DAILY_RESUMES = 5;
const ownerSchema = z.object({ userId: z.string() });

export async function pumpPreparation(input: { subjectId: string; origin: string }): Promise<PreparationResult | { outcome: 'missing' }> {
  const learn = createLearnServiceSupabase();
  // The subject names its account; everything after this is scoped to it.
  const { data, error } = await learn
    .from('subjects')
    .select('user_id, survey')
    .eq('id', input.subjectId)
    .maybeSingle();
  if (error) throw new Error(`Reading the subject failed: ${error.message}`);
  const subject = data as { user_id: string; survey: boolean } | null;
  if (!subject || subject.survey) return { outcome: 'missing' };

  const userId = subject.user_id;
  // A subject made before the trigger in 0167 has no run until it is asked for one.
  await ensurePreparation(learn, userId, input.subjectId);
  const result = await runPreparation(
    {
      ...preparationStore(learn, userId),
      handlers: liveHandlers({
        learn,
        userId,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        jobs: createJobsServiceSupabase(),
      }),
      now: () => Date.now(),
    },
    input.subjectId,
    { budgetMs: PREPARE_BUDGET_MS },
  );
  if (result.outcome === 'paused') await kickPreparation(input.origin, input.subjectId);
  return result;
}

export async function runPreparationsDaily(origin: string) {
  const { data } = await createServiceSupabase().rpc('app_owner');
  const owner = ownerSchema.safeParse(data);
  if (!owner.success) return { skipped: 'no owner account' };
  const learn = createLearnServiceSupabase();
  const subjects = await unfinishedPreparations(learn, owner.data.userId, new Date(), DAILY_RESUMES);
  let started = 0;
  for (const subjectId of subjects) {
    if (await kickPreparation(origin, subjectId)) started += 1;
  }
  return { unfinished: subjects.length, started };
}
