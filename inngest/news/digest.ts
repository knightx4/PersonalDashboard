import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createNewsServiceClient } from '@/lib/news/auth/service';
import { digestPending, type PendingTally } from '@/lib/news/issues/summarise';

/**
 * The hourly newsletter catch-up (plan #787).
 *
 * Summarises issues with no `digested_at`, across every account: the ones
 * stored before summaries existed, and any arrival whose summary did not run,
 * for example because ANTHROPIC_API_KEY was missing then. Called by pg_cron
 * through `/api/cron/news-digest`
 * (supabase/migrations/0100_news_digest_tick_cron.sql).
 */

/** Most issues one run takes on. One Haiku call each, of up to about forty seconds. */
export const NEWS_DIGEST_PER_RUN = 10;

/** Time after which a run starts no new issue. The route's limit is 300 seconds. */
export const NEWS_DIGEST_BUDGET_MS = 200_000;

export async function runNewsDigestTick(): Promise<PendingTally> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  return digestPending({
    news: createNewsServiceClient(),
    spend: createCoreServiceSupabase(),
    anthropicApiKey,
    limit: NEWS_DIGEST_PER_RUN,
    deadline: Date.now() + NEWS_DIGEST_BUDGET_MS,
  });
}
