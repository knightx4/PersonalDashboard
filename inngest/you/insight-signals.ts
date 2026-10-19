import 'server-only';

import { z } from 'zod';
import { createServiceSchemaSupabase, createServiceSupabase } from '@/inngest/supabase-admin';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { ruleWords } from '@/lib/you/insight-signals';

/**
 * The insight numbers stage of the daily cron (plan #2413.7). It reads the
 * owner's excluded industries, so each rule carries the words that name it,
 * and calls you.compute_insight_signals, which writes today's numbers and
 * checks every tripwire. No model is called. Owner only.
 */
export type InsightSignalsResult = { tripwiresChecked: number; tripwiresFired: number };

export async function runInsightSignals(deps?: {
  you?: YouSupabaseClient;
  userId?: string;
  excludedIndustries?: readonly string[];
}): Promise<InsightSignalsResult> {
  let userId = deps?.userId;
  if (!userId) {
    const owner = await createServiceSupabase().rpc('app_owner');
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(owner.data);
    if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to count insight numbers for.');
    userId = parsed.data.userId;
  }

  let excluded = deps?.excludedIndustries;
  if (!excluded) {
    const profile = await createServiceSchemaSupabase('job_search')
      .from('profiles')
      .select('excluded_industries')
      .eq('id', userId)
      .maybeSingle();
    if (profile.error) throw new Error(`Could not read the job profile: ${profile.error.message}`);
    excluded = (profile.data?.excluded_industries as string[] | null) ?? [];
  }

  const you = deps?.you ?? (createServiceSchemaSupabase('you') as unknown as YouSupabaseClient);
  const { data, error } = await you.rpc('compute_insight_signals', {
    p_user_id: userId,
    p_rule_words: ruleWords(excluded),
  });
  if (error) throw new Error(`Could not count the insight numbers: ${error.message}`);

  const tripwires = z
    .object({ checked: z.number(), fired: z.array(z.unknown()) })
    .safeParse((data as { tripwires?: unknown } | null)?.tripwires);
  return {
    tripwiresChecked: tripwires.success ? tripwires.data.checked : 0,
    tripwiresFired: tripwires.success ? tripwires.data.fired.length : 0,
  };
}
