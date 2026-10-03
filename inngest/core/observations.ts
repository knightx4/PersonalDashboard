import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { recordSpend } from '@/lib/core/spend/record';
import type { CoreOperation } from '@/lib/core/spend/operations';
import { OBSERVATIONS_MODEL, writeObservations } from '@/lib/timeline/observations-model';
import {
  runObservationsFor,
  type ObservationRunPorts,
  type ObservationRunResult,
} from '@/lib/timeline/observations-run';
import { observationWeek } from '@/lib/timeline/observations';
import { TIMELINE_COLUMNS, withRefs, type TimelineEvent, type TimelineRow } from '@/lib/timeline/timeline';

/**
 * The weekly observations run (plan #1119), called once a week by pg_cron
 * through /api/cron/observations (supabase/migrations/0111).
 *
 * Works every person with events in the twelve weeks read, one after
 * another. The service client bypasses RLS, core.timeline included, so every
 * read and write names the person.
 */

const OPERATION: CoreOperation = 'write-observations';
const PAGE = 1000;

export function observationPorts(core: CoreSupabaseClient): ObservationRunPorts {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;

  return {
    async hasWeek(userId, week) {
      const { data, error } = await core
        .from('observations')
        .select('id')
        .eq('user_id', userId)
        .eq('week', week)
        .limit(1);
      if (error) throw new Error(`Reading this week's observations failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async timeline(userId, from, to) {
      const events: TimelineEvent[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await core
          .from('timeline')
          .select(TIMELINE_COLUMNS)
          .eq('user_id', userId)
          .gte('occurred_at', from)
          .lt('occurred_at', to)
          .order('occurred_at', { ascending: true })
          .order('source_table', { ascending: true })
          .order('source_id', { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(`Reading the timeline failed: ${error.message}`);
        const page = withRefs((data ?? []) as unknown as TimelineRow[]);
        events.push(...page);
        if (page.length < PAGE) return events;
      }
    },

    async notUseful(userId, since) {
      const { data, error } = await core
        .from('observations')
        .select('sentence')
        .eq('user_id', userId)
        .eq('verdict', 'not_useful')
        .gte('verdict_at', since)
        .order('verdict_at', { ascending: false });
      if (error) throw new Error(`Reading the observations marked not useful failed: ${error.message}`);
      return ((data ?? []) as { sentence: string }[]).map((row) => row.sentence);
    },

    async recent(userId, sinceWeek, week) {
      const { data, error } = await core
        .from('observations')
        .select('sentence')
        .eq('user_id', userId)
        .gte('week', sinceWeek)
        .lt('week', week)
        .or('verdict.is.null,verdict.neq.not_useful')
        .order('week', { ascending: false })
        .order('position', { ascending: true });
      if (error) throw new Error(`Reading the recent observations failed: ${error.message}`);
      return ((data ?? []) as { sentence: string }[]).map((row) => row.sentence);
    },

    async observe(input, onSpend) {
      // Without a key there is nothing to write the sentences with.
      if (!apiKey) return null;
      const observations = await writeObservations(input, { apiKey, onSpend });
      return { model: OBSERVATIONS_MODEL, observations };
    },

    async ledger(userId, report) {
      await recordSpend(core, userId, {
        module: 'core',
        operation: OPERATION,
        model: report.model,
        usage: report.usage,
      });
    },

    async write(rows) {
      const { error } = await core
        .from('observations')
        .upsert(rows, { onConflict: 'user_id,week,position', ignoreDuplicates: true });
      if (error) throw new Error(`Saving this week's observations failed: ${error.message}`);
    },
  };
}

export type ObservationsSummary = {
  people: number;
  results: { userId: string; result: ObservationRunResult }[];
  failed: string[];
};

/** Everyone with an event in the window, read a page of user ids at a time. */
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

export async function runObservations(now: Date = new Date()): Promise<ObservationsSummary> {
  const core = createCoreServiceSupabase();
  const { from, to } = observationWeek(now);
  const people = await peopleWithEvents(core, from, to);

  const ports = observationPorts(core);
  const summary: ObservationsSummary = { people: people.length, results: [], failed: [] };
  for (const userId of people) {
    try {
      summary.results.push({ userId, result: await runObservationsFor(ports, userId, now) });
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
