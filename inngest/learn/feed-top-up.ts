import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  READY_LOW,
  READY_TARGET,
  runTopUpFor,
  type TopUpPorts,
  type TopUpSummary,
} from '@/lib/learn/feed/top-up';
import type { Depth } from '@/lib/learn/feed/depth';
import { WRITE_CARD_MODEL, writeCard, type CardToWrite } from '@/lib/learn/feed/write-card';
import type { LearnOperation } from '@/lib/learn/spend';
import { createFeedPicker, loadFeedFields, peopleWithThemes } from './feed-picks';

/**
 * The Learn now top-up (plan #807, LEARN-NOW-SPEC "How cards are made").
 *
 * Writes the picked rows in `learn.feed_cards` into cards until each person
 * has about twenty ready, picking more sections from Wikipedia first when the
 * picked rows run out. Called hourly by pg_cron through
 * `/api/cron/feed-top-up` for every account with placed themes, and by the
 * feed page after a response for one person (`topUpFeedAfterResponse`).
 *
 * The service client bypasses RLS, so every read and write names the person.
 */

/** Time one hourly call spends. The route's limit is 300 seconds. */
export const FEED_TOP_UP_BUDGET_MS = 230_000;

/**
 * Time a top-up after a response spends. It runs inside `after()` on the
 * page's request, so it is kept well inside the page's own limit.
 */
export const FEED_TOP_UP_AFTER_RESPONSE_MS = 120_000;

const OPERATION: LearnOperation = 'write-feed-card';

type PickedRow = {
  id: string;
  reason: 'interest' | 'gap' | 'queued';
  theme_name: string | null;
  field_id: string | null;
  named_article: string | null;
  depth: Depth | null;
  item: { title: string } | null;
  segment: { heading: string | null; text: string } | null;
  field: { name: string; scope: string } | null;
};

async function countReady(learn: LearnSupabaseClient, userId: string): Promise<number> {
  const { count, error } = await learn
    .from('feed_cards')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'ready')
    // Cards written before they carried a context paragraph are no longer
    // served as new, so they do not count towards the twenty (LEARN-NOW-SPEC,
    // "Cards after the first week").
    .not('context', 'is', null);
  if (error) throw new Error(`Counting your ready cards failed: ${error.message}`);
  return count ?? 0;
}

/** The fields this person has a theme placed in: a gap there is "untested". */
async function fieldsWrittenIn(learn: LearnSupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await learn
    .from('theme_fields')
    .select('field_id')
    .eq('user_id', userId)
    .not('field_id', 'is', null);
  if (error) throw new Error(`Reading where your themes sit failed: ${error.message}`);
  return new Set(((data ?? []) as { field_id: string }[]).map((row) => row.field_id));
}

async function loadPicked(
  learn: LearnSupabaseClient,
  userId: string,
  limit: number,
  written: Set<string>,
): Promise<CardToWrite[]> {
  const { data, error } = await learn
    .from('feed_cards')
    .select(
      'id, reason, theme_name, field_id, named_article, depth, ' +
        'item:catalogue_items!feed_cards_item_id_fkey(title), ' +
        'segment:catalogue_segments!feed_cards_segment_id_fkey(heading, text), ' +
        'field:area_fields!feed_cards_field_id_fkey(name, scope)',
    )
    .eq('user_id', userId)
    .eq('status', 'picked')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Reading your picked cards failed: ${error.message}`);

  return ((data ?? []) as unknown as PickedRow[]).flatMap((row): CardToWrite[] => {
    if (row.reason === 'queued' || !row.field || !row.segment) return [];
    return [
      {
        id: row.id,
        reason: row.reason,
        themeName: row.theme_name,
        field: row.field,
        gap: row.reason === 'gap' ? (row.field_id && written.has(row.field_id) ? 'untested' : 'untouched') : null,
        article: row.item?.title ?? row.named_article ?? 'Wikipedia',
        section: row.segment.heading,
        text: row.segment.text,
        depth: row.depth,
      },
    ];
  });
}

type Context = {
  learn: LearnSupabaseClient;
  core: ReturnType<typeof createCoreServiceSupabase>;
  apiKey: string;
  pickFor: ReturnType<typeof createFeedPicker>;
};

async function createContext(): Promise<Context> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('The Learn now top-up needs ANTHROPIC_API_KEY to be set.');
  const learn = createLearnServiceSupabase();
  const core = createCoreServiceSupabase();
  const pickFor = createFeedPicker({ learn, core, apiKey, fields: await loadFeedFields(learn) });
  return { learn, core, apiKey, pickFor };
}

async function topUpWith(
  context: Context,
  userId: string,
  options: { threshold: number; deadline: number },
): Promise<TopUpSummary> {
  const { learn, core, apiKey, pickFor } = context;
  let written: Set<string> | null = null;

  const ports: TopUpPorts = {
    countReady: (id) => countReady(learn, id),
    loadPicked: async (id, limit) => {
      written ??= await fieldsWrittenIn(learn, id);
      return loadPicked(learn, id, limit, written);
    },
    pick: async (id, targets, deadline) => {
      const summary = await pickFor(id, { targets, deadline });
      return summary.picked.interest + summary.picked.gap;
    },
    write: async (id, card) => {
      const spend: SpendReport[] = [];
      const result = await writeCard({ card, anthropicApiKey: apiKey, onSpend: (report) => spend.push(report) });
      // Awaited, so the row lands before the function is frozen.
      for (const report of spend) {
        await recordSpend(core, id, { module: 'learn', operation: OPERATION, model: report.model, usage: report.usage });
      }
      if (result.outcome === 'failed') return result;

      const written_at = new Date().toISOString();
      const change =
        result.outcome === 'ready'
          ? {
              status: 'ready',
              context: result.context,
              hook: result.hook,
              summary: result.summary,
              example: result.example,
              check_question: result.question,
              check_answer: result.answer,
              why: result.why,
              write_model: WRITE_CARD_MODEL,
              written_at,
            }
          : { status: 'dropped', drop_reason: result.reason, write_model: WRITE_CARD_MODEL, written_at };
      // Only a row still picked: a second top-up running at the same time
      // may have written it already, and its card stands.
      const { data, error } = await learn
        .from('feed_cards')
        .update(change)
        .eq('id', card.id)
        .eq('user_id', id)
        .eq('status', 'picked')
        .select('id');
      if (error) return { outcome: 'failed', detail: `Saving the card failed: ${error.message}` };
      if ((data ?? []).length === 0) return { outcome: 'failed', detail: 'Written by another run first.' };
      return result;
    },
    now: Date.now,
  };

  return runTopUpFor(ports, { userId, threshold: options.threshold, target: READY_TARGET, deadline: options.deadline });
}

export type FeedTopUpResult = { people: TopUpSummary[] };

/**
 * The hourly call: everyone with placed themes and fewer than twenty ready
 * cards is topped up, one person after another, inside one budget.
 */
export async function runFeedTopUp(): Promise<FeedTopUpResult> {
  const deadline = Date.now() + FEED_TOP_UP_BUDGET_MS;
  const context = await createContext();
  const people: TopUpSummary[] = [];
  for (const userId of await peopleWithThemes(context.learn)) {
    if (Date.now() >= deadline) break;
    people.push(await topUpWith(context, userId, { threshold: READY_TARGET, deadline }));
  }
  return { people };
}

/**
 * Top up one person after a response on the feed page, when fewer than ten
 * cards are ready. For the page's server action to call inside `after()`:
 *
 *   after(() => topUpFeedAfterResponse(user.id));
 *
 * Never throws: it runs after the response has gone, where an error has
 * nobody to reach, so a failure is logged and the hourly tick tries again.
 */
export async function topUpFeedAfterResponse(userId: string): Promise<TopUpSummary | null> {
  try {
    // One count first, so a response with plenty of cards ready costs no more.
    if ((await countReady(createLearnServiceSupabase(), userId)) >= READY_LOW) return null;
    const context = await createContext();
    return await topUpWith(context, userId, {
      threshold: READY_LOW,
      deadline: Date.now() + FEED_TOP_UP_AFTER_RESPONSE_MS,
    });
  } catch (error) {
    console.error('[learn feed top-up]', error instanceof Error ? error.message : error);
    return null;
  }
}
