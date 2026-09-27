import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { normalizeTimeZone } from '@/lib/core/timezone';
import { writeYearReviewFor, type YearReviewResult } from '@/lib/timeline/year-review-run';
import { yearReviewPorts } from '@/lib/timeline/year-review-ports';

/**
 * The yearly year-in-review run (plan #1121), called on 2 January by pg_cron
 * through /api/cron/year-review (supabase/migrations/0112).
 *
 * Writes the year just gone for everyone with an event in it, one person
 * after another. A review already written after the year ended is left as it
 * is, so a retried call pays for nobody twice; one written during the year is
 * replaced by the whole year's. The year and its edges are read on each
 * person's own calendar.
 */

const PAGE = 1000;

export type YearReviewsSummary = {
  year: number;
  people: number;
  results: { userId: string; result: YearReviewResult }[];
  failed: string[];
};

/** Everyone with an event in [from, to), a page of rows at a time. */
async function peopleWithEvents(core: CoreSupabaseClient, from: string, to: string): Promise<string[]> {
  const people = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await core
      .from('timeline')
      .select('user_id')
      .gte('occurred_at', from)
      .lt('occurred_at', to)
      .order('user_id', { ascending: true })
      .order('source_table', { ascending: true })
      .order('source_id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Reading who has a timeline failed: ${error.message}`);
    const page = (data ?? []) as { user_id: string }[];
    for (const row of page) people.add(row.user_id);
    if (page.length < PAGE) return [...people];
  }
}

async function timezoneOf(core: CoreSupabaseClient, userId: string): Promise<string> {
  const { data, error } = await core.from('account_settings').select('timezone').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Reading the account's time zone failed: ${error.message}`);
  return normalizeTimeZone((data as { timezone: string | null } | null)?.timezone) ?? 'UTC';
}

export async function runYearReviews(now: Date = new Date()): Promise<YearReviewsSummary> {
  const core = createCoreServiceSupabase();
  // The year that ended in UTC. Every zone has finished it by 2 January
  // afternoon, when the clock calls.
  const year = now.getUTCFullYear() - 1;
  // A day either side, so a person whose year starts or ends across UTC's
  // midnight is still found; the run itself reads their own edges.
  const from = new Date(Date.UTC(year, 0, 1) - 86_400_000).toISOString();
  const to = new Date(Date.UTC(year + 1, 0, 1) + 86_400_000).toISOString();
  const people = await peopleWithEvents(core, from, to);

  const ports = yearReviewPorts(core);
  const summary: YearReviewsSummary = { year, people: people.length, results: [], failed: [] };
  for (const userId of people) {
    try {
      const timezone = await timezoneOf(core, userId);
      summary.results.push({ userId, result: await writeYearReviewFor(ports, { userId, year, timezone, now }) });
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
