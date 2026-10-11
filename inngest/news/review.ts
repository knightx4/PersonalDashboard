import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { NewsOperation } from '@/lib/core/spend/operations';
import { recordSpend } from '@/lib/core/spend/record';
import { normalizeTimeZone } from '@/lib/core/timezone';
import { createNewsServiceClient } from '@/lib/news/auth/service';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import type { NewsSender } from '@/lib/news/issues/list';
import { NEWS_TOPICS, readTopic } from '@/lib/news/issues/topics';
import type { QuickIssue, StoryGroupRow } from '@/lib/news/quick/next';
import { REVIEW_WINDOW_MS } from '@/lib/news/review/choose';
import { runReviewFor, type ReviewPorts, type ReviewResult } from '@/lib/news/review/run';
import { writeReview } from '@/lib/news/review/write';

/**
 * The evening review run (plan #1615), called every hour by pg_cron through
 * /api/cron/news-review (supabase/migrations/0176_news_review_cron.sql).
 *
 * Works every account whose own clock is past 8pm and whose review for the
 * day is not yet written (lib/news/review/run.ts). The service clients
 * bypass RLS, so every read and write here names the person.
 */

/** The name this call has in core.model_spend. Stable: renaming it splits the history. */
export const REVIEW_OPERATION: NewsOperation = 'daily-review';

/** More newsletters than anyone gets in a day; the review lists eleven stories at most. */
const DAY_LIMIT = 200;

/** Issue ids named in one story_groups read, as Quick read chunks them. */
const GROUP_CHUNK = 40;

type IssueRow = {
  id: string;
  sender_id: string;
  subject: string | null;
  received_at: string;
  summary: string | null;
  stories: unknown;
};

async function readInputs(news: NewsSupabaseClient, userId: string, since: Date, until: Date) {
  const issues = await news
    .from('issues')
    .select('id, sender_id, subject, received_at, summary, stories')
    .eq('user_id', userId)
    .not('summary', 'is', null)
    .or('purpose.is.null,purpose.eq.news')
    .gt('received_at', since.toISOString())
    .lte('received_at', until.toISOString())
    .order('received_at', { ascending: false })
    .limit(DAY_LIMIT);
  if (issues.error) throw new Error(`Reading the day's newsletters failed: ${issues.error.message}`);
  const day: QuickIssue[] = ((issues.data ?? []) as IssueRow[]).map((row) => ({
    id: row.id,
    senderId: row.sender_id,
    subject: row.subject,
    receivedAt: row.received_at,
    summary: row.summary,
    stories: row.stories,
  }));
  if (day.length === 0) return { issues: day, senders: [], groups: [], hidden: [] };

  const ids = day.map((issue) => issue.id);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += GROUP_CHUNK) chunks.push(ids.slice(i, i + GROUP_CHUNK));
  const [senders, hidden, ...groupReads] = await Promise.all([
    news.from('senders').select('id, email, name, muted').eq('user_id', userId),
    news.from('hidden_topics').select('topic').eq('user_id', userId),
    ...chunks.map((chunk) =>
      news
        .from('story_groups')
        .select('issue_id, story_index, group_id')
        .eq('user_id', userId)
        .in('issue_id', chunk),
    ),
  ]);
  if (senders.error) throw new Error(`Reading the senders failed: ${senders.error.message}`);
  if (hidden.error) throw new Error(`Reading the hidden topics failed: ${hidden.error.message}`);

  // Grouping folds repeats together; a failed read lists them separately rather than losing the day.
  const groups: StoryGroupRow[] = groupReads.flatMap((read) =>
    read.error
      ? []
      : ((read.data ?? []) as { issue_id: string; story_index: number; group_id: string }[]).map((row) => ({
          issueId: row.issue_id,
          storyIndex: row.story_index,
          groupId: row.group_id,
        })),
  );
  const hiddenNames = new Set(((hidden.data ?? []) as { topic: string }[]).map((row) => readTopic(row.topic)));
  return {
    issues: day,
    senders: (senders.data ?? []) as NewsSender[],
    groups,
    hidden: NEWS_TOPICS.filter((topic) => hiddenNames.has(topic)),
  };
}

export function reviewPorts(news: NewsSupabaseClient, core: CoreSupabaseClient): ReviewPorts {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  return {
    async hasReview(userId, day) {
      const { data, error } = await news
        .from('daily_reviews')
        .select('day')
        .eq('user_id', userId)
        .eq('day', day)
        .not('overview', 'is', null)
        .limit(1);
      if (error) throw new Error(`Reading today's review failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    inputs: (userId, since, until) => readInputs(news, userId, since, until),

    async write(picks, onSpend) {
      if (!apiKey) return null;
      return writeReview(picks, { apiKey, onSpend });
    },

    async ledger(userId, report) {
      await recordSpend(core, userId, {
        module: 'news',
        operation: REVIEW_OPERATION,
        model: report.model,
        usage: report.usage,
      });
    },

    async save(row) {
      const { error } = await news.from('daily_reviews').upsert(row, { onConflict: 'user_id,day' });
      if (error) throw new Error(`Saving today's review failed: ${error.message}`);
    },
  };
}

export type DailyReviewsSummary = {
  people: number;
  results: { userId: string; result: ReviewResult }[];
  failed: string[];
};

export async function runDailyReviews(now: Date = new Date()): Promise<DailyReviewsSummary> {
  const core = createCoreServiceSupabase();
  const { data, error } = await core.from('account_settings').select('user_id, timezone');
  if (error) throw new Error(`Reading the accounts failed: ${error.message}`);
  const people = ((data ?? []) as { user_id: string; timezone: string | null }[]).map((row) => ({
    userId: row.user_id,
    timezone: normalizeTimeZone(row.timezone) ?? 'UTC',
  }));

  const ports = reviewPorts(createNewsServiceClient(), core);
  const summary: DailyReviewsSummary = { people: people.length, results: [], failed: [] };
  for (const person of people) {
    try {
      summary.results.push({
        userId: person.userId,
        result: await runReviewFor(ports, person, now, REVIEW_WINDOW_MS),
      });
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
