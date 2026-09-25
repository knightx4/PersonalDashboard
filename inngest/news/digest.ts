import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createNewsServiceClient } from '@/lib/news/auth/service';
import { scorePending, type ScoreTally } from '@/lib/news/issues/importance';
import { digestPending, type PendingTally } from '@/lib/news/issues/summarise';

/**
 * The hourly newsletter catch-up (plan #787).
 *
 * Summarises issues with no `digested_at`, across every account: the ones
 * stored before summaries existed, and any arrival whose summary did not run,
 * for example because ANTHROPIC_API_KEY was missing then. After those it
 * redoes the issues summarised before the one-line summary existed, so they
 * get their line (plan #824), and the issues whose stories have no topic, so
 * they get one (plan #859). Called by pg_cron
 * through `/api/cron/news-digest`
 * (supabase/migrations/0100_news_digest_tick_cron.sql).
 *
 * With time left it rates the stories of newsletters summarised before
 * stories were rated (lib/news/issues/importance.ts), newest first, so Quick
 * read can rank them by importance. Once every stored newsletter is rated this
 * is one query and no model call.
 */

/** Most issues one run takes on. One Haiku call each, of up to about forty seconds. */
export const NEWS_DIGEST_PER_RUN = 10;

/** Time after which a run starts no new issue. The route's limit is 300 seconds. */
export const NEWS_DIGEST_BUDGET_MS = 200_000;

/** Most newsletters one run rates. One short Haiku call each, a few seconds long. */
export const NEWS_SCORE_PER_RUN = 40;

export async function runNewsDigestTick(): Promise<PendingTally & { rated: ScoreTally }> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const news = createNewsServiceClient();
  const spend = createCoreServiceSupabase();
  const deadline = Date.now() + NEWS_DIGEST_BUDGET_MS;
  const digested = await digestPending({
    news,
    spend,
    anthropicApiKey,
    limit: NEWS_DIGEST_PER_RUN,
    deadline,
  });
  const rated = await scorePending({
    news,
    spend,
    anthropicApiKey,
    limit: NEWS_SCORE_PER_RUN,
    deadline,
  });
  return { ...digested, rated };
}
