import 'server-only';

import { createServiceSupabase } from '@/inngest/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { jevApiKey } from '@/lib/jev/client';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { scoreUnscoredIdeas, type CatchUpResult } from '@/lib/ideas/score-run';
import { scoreUnscoredTakeaways } from '@/lib/dev/inspiration/score';

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
 *
 * The Inspiration tab's takeaways are scored here too, after each person's
 * ideas and with the same question (note 790c745a).
 */
const BUDGET_MS = 60_000;

export type IdeaScoreCatchUp = { userId: string } & CatchUpResult & { takeaways?: CatchUpResult };

export async function runIdeaScoreCatchUp(): Promise<IdeaScoreCatchUp[]> {
  if (!jevApiKey()) return [];
  const supabase = createServiceSupabase();
  const core = createCoreServiceSupabase();
  const deadline = Date.now() + BUDGET_MS;

  const [ideas, takeaways] = await Promise.all([
    supabase.from('ideas').select('user_id').is('score', null).is('dismissed_at', null),
    supabase.from('inspiration_takeaways').select('user_id').is('score', null).neq('status', 'dismissed'),
  ]);
  if (ideas.error) throw new Error(ideas.error.message);
  if (takeaways.error) throw new Error(takeaways.error.message);
  const userIds = [
    ...new Set([...(ideas.data ?? []), ...(takeaways.data ?? [])].map((row) => row.user_id as string)),
  ];

  const results: IdeaScoreCatchUp[] = [];
  for (const userId of userIds) {
    if (Date.now() >= deadline) break;
    if (!(await jevEnabledFor(core, userId))) continue;
    const spend: SpendReport[] = [];
    let result: IdeaScoreCatchUp;
    try {
      result = { userId, ...(await scoreUnscoredIdeas(supabase, { userId, spend, deadline })) };
    } finally {
      await recordSpendReports(core, userId, { module: 'core', operation: 'score-idea' }, spend);
    }
    const takeawaySpend: SpendReport[] = [];
    try {
      result.takeaways = await scoreUnscoredTakeaways(supabase, { userId, spend: takeawaySpend, deadline });
    } finally {
      await recordSpendReports(
        core,
        userId,
        { module: 'core', operation: 'score-inspiration-takeaway' },
        takeawaySpend,
      );
    }
    results.push(result);
  }
  return results;
}
