import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * The step counts saved for a goal or feature, one point per day (plan #1836).
 * `ref` is 'goals.items:<id>' for a goal or 'public.plan_items:<id>' for a
 * plan feature; `total` is the steps under it by the end of that day and
 * `done` how many were finished. Written by the daily cron
 * (inngest/goals/scope-days.ts); this reads them for charts and pace.
 */
export type ScopeDay = { day: string; total: number; done: number };

export function goalScopeRef(id: string): string {
  return `goals.items:${id}`;
}

export function planScopeRef(id: string): string {
  return `public.plan_items:${id}`;
}

/** The days saved for one scope, oldest first, optionally from a date (YYYY-MM-DD). */
export async function loadScopeDays(
  client: CoreSupabaseClient,
  ref: string,
  since?: string,
): Promise<ScopeDay[]> {
  let query = client.from('scope_days').select('day, total, done').eq('ref', ref);
  if (since) query = query.gte('day', since);
  const { data, error } = await query.order('day', { ascending: true });
  if (error) throw new Error(`Could not read step counts for ${ref}: ${error.message}`);
  return (data ?? []) as ScopeDay[];
}
