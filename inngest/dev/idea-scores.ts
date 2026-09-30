import 'server-only';

import { createServiceSupabase } from '@/inngest/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { jevApiKey } from '@/lib/jev/client';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { scoreUnscoredIdeas, type CatchUpResult } from '@/lib/ideas/score-run';

/**
 * The idea-score catch-up, as a stage of the daily cron (plan #1327).
 *
 * Scores every live idea whose score is null: the ones sessions and the
 * night digest filed without triage, and any Jev failed on before. An idea
 * filed from the header panel is scored as it is filed and is not here.
 * Runs after the digest so the ideas it files overnight are scored the same
 * morning.
 *
 * Only accounts that agreed to send text to Jev (decision #1163). Bounded by
 * a minute, since it shares the cron's five with every other stage; what is
 * left waits for tomorrow.
 */
const BUDGET_MS = 60_000;

export type IdeaScoreCatchUp = { userId: string } & CatchUpResult;

export async function runIdeaScoreCatchUp(): Promise<IdeaScoreCatchUp[]> {
  if (!jevApiKey()) return [];
  const supabase = createServiceSupabase();
  const core = createCoreServiceSupabase();
  const deadline = Date.now() + BUDGET_MS;

  const { data, error } = await supabase
    .from('ideas')
    .select('user_id')
    .is('score', null)
    .is('dismissed_at', null);
  if (error) throw new Error(error.message);
  const userIds = [...new Set((data ?? []).map((row) => row.user_id as string))];

  const results: IdeaScoreCatchUp[] = [];
  for (const userId of userIds) {
    if (Date.now() >= deadline) break;
    if (!(await jevEnabledFor(core, userId))) continue;
    const spend: SpendReport[] = [];
    try {
      results.push({ userId, ...(await scoreUnscoredIdeas(supabase, { userId, spend, deadline })) });
    } finally {
      await recordSpendReports(core, userId, { module: 'core', operation: 'score-idea' }, spend);
    }
  }
  return results;
}
