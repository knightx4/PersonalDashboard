import 'server-only';

import { z } from 'zod';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { catalogueSql } from '@/lib/learn/catalogue/connection';
import { runLitTopicPulls } from '@/lib/learn/catalogue/lit-topic-pull-run';
import { PULLS_PER_DAY } from '@/lib/learn/catalogue/lit-topic-pull';

/**
 * A stage of the daily cron (plan #2247.11): one structure document pulled for
 * each topic that has just lit, at most PULLS_PER_DAY topics. Skipped without
 * the model key or the catalogue connection, and bounded in time so it shares
 * the cron's five minutes.
 */
const BUDGET_MS = 90_000;
const ownerSchema = z.object({ userId: z.string() });

export async function runLitTopicPullsDaily() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { skipped: 'ANTHROPIC_API_KEY is not set' };
  let catalogue;
  try {
    catalogue = catalogueSql();
  } catch {
    return { skipped: 'no catalogue connection' };
  }
  const { data } = await createServiceSupabase().rpc('app_owner');
  const owner = ownerSchema.safeParse(data);
  if (!owner.success) return { skipped: 'no owner account' };
  const summary = await runLitTopicPulls({
    learn: createLearnServiceSupabase(),
    catalogue,
    userId: owner.data.userId,
    anthropicApiKey: apiKey,
    budgetMs: BUDGET_MS,
  });
  return { budget: PULLS_PER_DAY, lit: summary.lit, allowance: summary.allowance, pulled: summary.lines.map((l) => `${l.title}: ${l.outcome}`) };
}
