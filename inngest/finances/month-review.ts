import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { recordSpend } from '@/lib/core/spend/record';
import { FINANCES_SCHEMA } from '@/lib/finances/db/schema-name';
import { reviewMonthFor } from '@/lib/finances/review/facts';
import { loadMonthFacts } from '@/lib/finances/review/load';
import { MONEY_REVIEW_MODEL, wordMoneyReview } from '@/lib/finances/review/model';
import {
  runMonthReviewFor,
  type ExistingReview,
  type MonthReviewPorts,
  type MonthReviewResult,
} from '@/lib/finances/review/run';
import { todayInTimezone } from '@/lib/money';

/**
 * The monthly money review's runner (plan #2593.8.2), from the daily cron's
 * finances-review stage, for everyone with Finances on and at least one
 * account. The rules are in lib/finances/review/run.ts: the month before is
 * written once, on the first day the stage runs in it, and a check of the
 * stored row is all the other days cost.
 *
 * retryMonthReview is Try again on a failed review: the same run for one
 * person and month, whatever its attempts.
 *
 * The service client bypasses row level security, so every read and write
 * names the person.
 */

export function monthReviewPorts(): MonthReviewPorts {
  const db = createServiceSupabase();
  const core = createCoreServiceSupabase();
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  const reviews = () => db.schema(FINANCES_SCHEMA).from('month_reviews');

  return {
    async existing(userId, month) {
      const { data, error } = await reviews()
        .select('status, source, attempts, lines')
        .eq('user_id', userId)
        .eq('month', month)
        .maybeSingle();
      if (error) throw new Error(`Reading the month's review failed: ${error.message}`);
      if (!data) return null;
      const row = data as { status: ExistingReview['status']; source: ExistingReview['source']; attempts: number; lines: unknown };
      return {
        status: row.status,
        source: row.source,
        attempts: row.attempts,
        lineCount: Array.isArray(row.lines) ? row.lines.length : 0,
      };
    },

    facts(userId, month, today) {
      return loadMonthFacts(db, userId, month, today);
    },

    async word(facts, onSpend) {
      // Without a key the code's own sentences are stored.
      if (!apiKey) return null;
      return { model: MONEY_REVIEW_MODEL, wording: await wordMoneyReview(facts, { apiKey, onSpend }) };
    },

    async ledger(userId, report) {
      await recordSpend(core, userId, {
        module: 'finances',
        operation: 'write-money-review',
        model: report.model,
        usage: report.usage,
      });
    },

    async save(row) {
      const { error } = await reviews().upsert(row, { onConflict: 'user_id,month' });
      if (error) throw new Error(`Saving the month's review failed: ${error.message}`);
    },
  };
}

/** Each person's own day, from their profile. */
async function todays(userIds: readonly string[], now: Date): Promise<Map<string, string>> {
  const days = new Map<string, string>();
  if (userIds.length === 0) return days;
  const { data, error } = await createServiceSupabase().from('profiles').select('id, timezone').in('id', [...userIds]);
  if (error) throw new Error(`Reading timezones failed: ${error.message}`);
  for (const p of (data ?? []) as { id: string; timezone: string | null }[]) {
    days.set(p.id, todayInTimezone(p.timezone || 'UTC', now));
  }
  return days;
}

/** Everyone with Finances on and an account in it. */
async function reviewers(): Promise<string[]> {
  const { data: holders, error } = await createServiceSupabase()
    .schema(FINANCES_SCHEMA)
    .from('accounts')
    .select('user_id')
    .limit(10_000);
  if (error) throw new Error(`Reading who holds accounts failed: ${error.message}`);
  const ids = [...new Set(((holders ?? []) as { user_id: string }[]).map((r) => r.user_id))];
  if (ids.length === 0) return [];
  const { data: settings, error: settingsError } = await createCoreServiceSupabase()
    .from('account_settings')
    .select('user_id')
    .in('user_id', ids)
    .contains('enabled_modules', ['finances']);
  if (settingsError) throw new Error(`Reading who has Finances on failed: ${settingsError.message}`);
  return ((settings ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

export type MonthReviewsSummary = Record<string, MonthReviewResult | { error: string }>;

/** The daily stage: the month before, for everyone it is due for. */
export async function runMonthReviews(now: Date = new Date()): Promise<MonthReviewsSummary> {
  const people = await reviewers();
  if (people.length === 0) return {};
  const days = await todays(people, now);
  const ports = monthReviewPorts();
  const summary: MonthReviewsSummary = {};
  for (const userId of people) {
    const today = days.get(userId) ?? todayInTimezone('UTC', now);
    try {
      summary[userId.slice(0, 8)] = await runMonthReviewFor(ports, userId, { month: reviewMonthFor(today), today, now });
    } catch (err) {
      summary[userId.slice(0, 8)] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return summary;
}

/** Try again on one month's review, for its owner. `month` is YYYY-MM. */
export async function retryMonthReview(userId: string, month: string, now: Date = new Date()): Promise<MonthReviewResult> {
  const today = (await todays([userId], now)).get(userId) ?? todayInTimezone('UTC', now);
  return runMonthReviewFor(monthReviewPorts(), userId, { month, today, now, force: true });
}
