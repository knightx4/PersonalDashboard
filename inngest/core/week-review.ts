import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { CoreOperation } from '@/lib/core/spend/operations';
import { recordSpend } from '@/lib/core/spend/record';
import { addDays } from '@/lib/todo/tasks/model';
import { loadWeekFacts } from '@/lib/week-review/load';
import { WEEK_REVIEW_MODEL, writeWeekReview } from '@/lib/week-review/model';
import { reviewWeekDue } from '@/lib/week-review/review';
import {
  runWeekReviewFor,
  type WeekReviewPorts,
  type WeekReviewResult,
} from '@/lib/week-review/run';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The weekly review run (plan #1232), called every hour on Sundays by
 * pg_cron through /api/cron/week-review
 * (supabase/migrations/0127_week_review_cron.sql). It writes only from 9am
 * New York time (lib/week-review/review.ts, reviewWeekDue), once per person
 * and week.
 *
 * The service clients bypass RLS, so every read and write names the person.
 * `written` in the ports is where the stored review leaves the database; the
 * phone notification (plan #1234) goes there, with its own tag, and sets
 * notified_at.
 */

const OPERATION: CoreOperation = 'write-week-review';

export function weekReviewPorts(core: CoreSupabaseClient, db: SupabaseClient): WeekReviewPorts {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;

  return {
    async hasReview(userId, week) {
      const { data, error } = await core
        .from('week_reviews')
        .select('id')
        .eq('user_id', userId)
        .eq('week', week)
        .limit(1);
      if (error) throw new Error(`Reading this week's review failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    facts(userId, week) {
      return loadWeekFacts(db, userId, week);
    },

    async previous(userId, week) {
      const { data, error } = await core
        .from('week_reviews')
        .select('change, observations')
        .eq('user_id', userId)
        .eq('week', week)
        .maybeSingle();
      if (error) throw new Error(`Reading last week's review failed: ${error.message}`);
      if (!data) return null;
      const row = data as { change: string | null; observations: unknown };
      const observations = Array.isArray(row.observations)
        ? row.observations
            .map((item) => (item as { text?: unknown } | null)?.text)
            .filter((text): text is string => typeof text === 'string')
        : [];
      return { change: row.change, observations };
    },

    async homeSaid(userId, week) {
      // core.observations are keyed by Monday: the one after the review
      // week's Sunday is the home page's week as the review is written.
      const { data, error } = await core
        .from('observations')
        .select('sentence')
        .eq('user_id', userId)
        .gt('week', week)
        .lte('week', addDays(week, 7))
        .or('verdict.is.null,verdict.neq.not_useful')
        .order('position', { ascending: true });
      if (error) throw new Error(`Reading this week's observations failed: ${error.message}`);
      return ((data ?? []) as { sentence: string }[]).map((row) => row.sentence);
    },

    async write(input, onSpend) {
      // Without a key the plain version is stored instead.
      if (!apiKey) return null;
      return { model: WEEK_REVIEW_MODEL, review: await writeWeekReview(input, { apiKey, onSpend }) };
    },

    async ledger(userId, report) {
      await recordSpend(core, userId, {
        module: 'core',
        operation: OPERATION,
        model: report.model,
        usage: report.usage,
      });
    },

    async save(row) {
      const { data, error } = await core
        .from('week_reviews')
        .upsert(row, { onConflict: 'user_id,week', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(`Saving this week's review failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    // No `written` yet: plan #1234 adds it here, sending the phone
    // notification and setting notified_at on the stored row.
  };
}

export type WeekReviewsSummary = {
  week: string | null;
  people: number;
  results: { userId: string; result: WeekReviewResult }[];
  failed: string[];
};

export async function runWeekReviews(now: Date = new Date()): Promise<WeekReviewsSummary> {
  const week = reviewWeekDue(now);
  // Outside Sunday from 9am the call reads nothing.
  if (!week) return { week: null, people: 0, results: [], failed: [] };

  const core = createCoreServiceSupabase();
  const { data, error } = await core.from('account_settings').select('user_id');
  if (error) throw new Error(`Reading the accounts failed: ${error.message}`);
  const people = ((data ?? []) as { user_id: string }[]).map((row) => row.user_id);

  const ports = weekReviewPorts(core, createServiceSupabase());
  const summary: WeekReviewsSummary = { week, people: people.length, results: [], failed: [] };
  for (const userId of people) {
    try {
      summary.results.push({ userId, result: await runWeekReviewFor(ports, userId, now) });
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
