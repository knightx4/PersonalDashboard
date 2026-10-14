import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { pageUrl } from '@/lib/learn/essays/research';
import { searchTurn } from '@/lib/learn/essays/research-model';
import { collectSpend } from '@/lib/learn/spend';
import type { Brief } from './model';
import { finalText, readSearchResults } from './research';
import { saveReadings, type RecordSpend } from './research-run';
import { chooseNewSources, quietAfter, readWatchList, WATCH_SEARCHES, WATCH_SYSTEM, watchPrompt } from './watch';

/**
 * One weekly check of one brief (plan #2023.8): search for what has been
 * published since the last check, put each new source on the brief's list
 * with its line on what it changes, and move the brief's watch on.
 *
 * The call is the brief run's search turn (research-model.ts) on the same
 * model, with web search alone and two searches. A source whose link is
 * already on the list is never added again: the prompt names them, and
 * `chooseNewSources` drops any that come back anyway.
 *
 * A check that finds something sets quiet_checks back to none; one that
 * finds nothing adds one, and four in a row make the brief monthly. A check
 * whose call fails leaves the brief as it was, so the next day's run tries
 * again. Spend is recorded under 'research-topic' through `recordSpend`,
 * which the cron gives a service-role recorder.
 */

export const WATCH_MODEL = MODELS.learnBriefSearch;

export type WatchOutcome = { ok: true; added: number; readingIds: string[]; quietChecks: number } | { ok: false; error: string };

async function knownLinks(learn: LearnSupabaseClient, brief: Brief & { userId: string }): Promise<string[]> {
  let query = learn.from('readings').select('open_url').eq('user_id', brief.userId);
  query = brief.trackId ? query.or(`brief_id.eq.${brief.id},track_id.eq.${brief.trackId}`) : query.eq('brief_id', brief.id);
  const { data, error } = await query;
  if (error) throw new Error(`reading the list failed (${error.message})`);
  return ((data ?? []) as { open_url: string | null }[]).flatMap((r) => (r.open_url ? [pageUrl(r.open_url)] : []));
}

export async function checkBrief(
  learn: LearnSupabaseClient,
  brief: Brief & { userId: string },
  options: { client: Anthropic; recordSpend: RecordSpend; now?: number },
): Promise<WatchOutcome> {
  const now = options.now ?? Date.now();
  const spend = collectSpend();
  try {
    const since = brief.watchedAt ?? brief.createdAt;
    const known = await knownLinks(learn, brief);
    const turn = await searchTurn(
      options.client,
      WATCH_SYSTEM,
      [{ type: 'web_search_20250305', name: 'web_search', max_uses: WATCH_SEARCHES }],
      watchPrompt({
        question: brief.question,
        angle: brief.angle,
        subQuestions: brief.subQuestions,
        shortAnswer: brief.shortAnswer,
        since,
        known,
      }),
      spend.sink,
      WATCH_MODEL,
    );
    if (!turn.ok) return { ok: false, error: turn.detail };

    const fresh = chooseNewSources({
      listed: readWatchList(finalText(turn.content)),
      results: readSearchResults(turn.content),
      known,
      since: Date.parse(since),
      now,
    });

    let readingIds: string[] = [];
    if (fresh.length > 0) {
      if (!brief.trackId) return { ok: false, error: 'the brief has no reading list to add to' };
      readingIds = await saveReadings(learn, brief.userId, brief, brief.trackId, fresh);
    }

    const quietChecks = quietAfter(brief.quietChecks, fresh.length);
    const { error } = await learn
      .from('briefs')
      .update({ watched_at: new Date(now).toISOString(), quiet_checks: quietChecks })
      .eq('id', brief.id)
      .eq('user_id', brief.userId);
    if (error) throw new Error(`moving the watch on failed (${error.message})`);
    return { ok: true, added: fresh.length, readingIds, quietChecks };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await options.recordSpend(brief.userId, spend.reports);
  }
}
