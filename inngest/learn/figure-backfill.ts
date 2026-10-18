import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { recordSpend } from '@/lib/core/spend/record';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { backfillFigureNeeds, type BackfillResult } from '@/lib/learn/figures/backfill';
import { writerResolveContext } from '@/lib/learn/figures/resolve';
import type { LearnOperation } from '@/lib/learn/spend';

const OPERATION: LearnOperation = 'write-figure-backfill';

/**
 * Lessons that asked for a figure now built get it, as a stage of the daily
 * cron (plan #2321.11). A few reads, and a model call per block filled, at
 * most ten a day.
 */
export async function runFigureBackfillDaily(): Promise<BackfillResult | { skipped: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { skipped: 'ANTHROPIC_API_KEY is not set' };
  const learn = createLearnServiceSupabase();
  const core = createCoreServiceSupabase();
  const spend: { userId: string; report: SpendReport }[] = [];
  const result = await backfillFigureNeeds({
    learn,
    plan: createServiceSupabase(),
    client: new Anthropic({ apiKey }),
    context: writerResolveContext(learn),
    onSpend: (userId, report) => spend.push({ userId, report }),
  });
  for (const { userId, report } of spend) {
    await recordSpend(core, userId, { module: 'learn', operation: OPERATION, model: report.model, usage: report.usage });
  }
  return result;
}
