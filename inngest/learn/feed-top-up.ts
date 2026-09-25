import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  READY_BATCH,
  READY_LOW,
  READY_TARGET,
  runTopUpFor,
  type TopUpPorts,
  type TopUpSummary,
} from '@/lib/learn/feed/top-up';
import type { Depth } from '@/lib/learn/feed/depth';
import { nearbyIdeas, saveIdeas } from '@/lib/learn/feed/ideas-store';
import { WRITE_CARD_MODEL, writeCard, type CardToWrite, type IdeaCard, type WriteResult } from '@/lib/learn/feed/write-card';
import type { LearnOperation } from '@/lib/learn/spend';
import type { LessonTopUpSummary } from '@/lib/learn/lessons/top-up';
import { lessonsWanted, writeLessonsFor } from '@/lib/learn/lessons/top-up';
import { createFeedPicker, loadFeedFields, peopleToPickFor } from './feed-picks';
import { createLessonPorts } from './lesson-top-up';

/**
 * The Learn now top-up (plan #807, LEARN-NOW-SPEC "How cards are made").
 *
 * Tops each person up to about twenty ready cards. About four in five of the
 * cards it is short go to lessons for the concepts in the person's tracks
 * (plan #978, LEARN-LESSONS-SPEC; lesson-top-up.ts). The rest, and any the
 * lessons fall short of, are section cards: the picked rows in
 * `learn.feed_cards` written into cards, picking more sections from Wikipedia
 * first when the picked rows run out. Called hourly by pg_cron through
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
const EMBED_OPERATION: LearnOperation = 'embed-feed-ideas';

/**
 * The columns that say what a card was picked for and from, copied from the
 * picked row onto the row for each further idea in its section.
 */
const PICK_COLUMNS =
  'reason, theme_id, theme_name, field_id, reading_id, item_id, segment_id, named_article, named_section, ' +
  'pick_basis, pick_model, depth, aim_id, aim_name, created_at';

/** What a ready card's row holds for one idea. */
function ideaColumns(idea: IdeaCard, index: number, conceptId: string | null, why: string, written_at: string) {
  return {
    status: 'ready',
    idea_name: idea.name,
    idea_index: index,
    concept_id: conceptId,
    takeaway: idea.takeaway,
    context: idea.context,
    hook: idea.hook,
    summary: idea.summary,
    example: idea.example,
    check_question: idea.question,
    check_answer: idea.answer,
    why,
    write_model: WRITE_CARD_MODEL,
    written_at,
  };
}

type PickedRow = {
  id: string;
  segment_id: string | null;
  reason: 'interest' | 'gap' | 'goal' | 'queued';
  theme_name: string | null;
  aim_name: string | null;
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
      'id, segment_id, reason, theme_name, aim_name, field_id, named_article, depth, ' +
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
    // A goal card has no field when its goal is not placed in one.
    if (row.reason === 'queued' || !row.segment || (!row.field && row.reason !== 'goal')) return [];
    return [
      {
        id: row.id,
        segmentId: row.segment_id,
        reason: row.reason,
        themeName: row.theme_name,
        aimName: row.aim_name,
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
  options: { threshold: number; target?: number; deadline: number },
): Promise<TopUpSummary> {
  const { learn, core, apiKey, pickFor } = context;
  let written: Set<string> | null = null;

  const readyBefore = await countReady(learn, userId);
  const target = options.target ?? READY_TARGET;
  let lessons: LessonTopUpSummary | undefined;
  if (readyBefore < options.threshold) {
    lessons = await writeLessonsFor(createLessonPorts({ learn, core, apiKey }), {
      userId,
      wanted: lessonsWanted(target - readyBefore),
      deadline: options.deadline,
    }).catch((error: unknown): LessonTopUpSummary => {
      // A failure here leaves the whole shortfall to section cards.
      console.error('[learn feed top-up] lessons', error instanceof Error ? error.message : error);
      return {
        wanted: 0,
        chosen: 0,
        written: 0,
        dropped: [],
        failed: [error instanceof Error ? error.message : 'Writing lessons failed.'],
        floors: [],
        checks: [],
        added: [],
        laidOut: [],
        held: [],
        stopped: null,
      };
    });
  }

  const ports: TopUpPorts = {
    countReady: (id) => countReady(learn, id),
    loadPicked: async (id, limit) => {
      written ??= await fieldsWrittenIn(learn, id);
      return loadPicked(learn, id, limit, written);
    },
    pick: async (id, targets, deadline) => {
      const summary = await pickFor(id, { targets, deadline });
      return summary.picked.interest + summary.picked.gap + summary.picked.goal;
    },
    write: async (id, card) => {
      const spend: SpendReport[] = [];
      const embedSpend: SpendReport[] = [];
      const record = async () => {
        // Awaited, so the rows land before the function is frozen.
        for (const report of spend) {
          await recordSpend(core, id, { module: 'learn', operation: OPERATION, model: report.model, usage: report.usage });
        }
        for (const report of embedSpend) {
          await recordSpend(core, id, { module: 'learn', operation: EMBED_OPERATION, model: report.model, usage: report.usage });
        }
      };

      const known = await nearbyIdeas(
        learn,
        id,
        { segmentId: card.segmentId ?? null, article: card.article, heading: card.section, text: card.text },
        (report) => embedSpend.push(report),
      );
      const result = await writeCard({
        card: { ...card, known },
        anthropicApiKey: apiKey,
        onSpend: (report) => spend.push(report),
      });
      if (result.outcome === 'failed') {
        await record();
        return result;
      }

      const written_at = new Date().toISOString();
      let outcome: WriteResult = result;
      let ideas: { idea: IdeaCard; conceptId: string | null }[] = [];
      if (result.outcome === 'ready') {
        const saved = await saveIdeas(
          learn,
          id,
          { article: card.article, section: card.section },
          result.ideas,
          (report) => embedSpend.push(report),
        );
        ideas = result.ideas.flatMap((idea, index) => {
          const kept = saved[index] ?? { kind: 'unsaved' };
          if (kept.kind === 'duplicate') return [];
          return [{ idea, conceptId: kept.kind === 'new' ? kept.conceptId : null }];
        });
        if (ideas.length === 0) {
          const names = saved.flatMap((kept) => (kept.kind === 'duplicate' ? [kept.name] : []));
          outcome = { outcome: 'dropped', reason: `Every idea was one already held: ${names.join('; ')}.` };
        } else {
          outcome = { ...result, ideas: ideas.map((kept) => kept.idea) };
        }
      }
      await record();

      const [first, ...rest] = ideas;
      const change =
        outcome.outcome === 'ready' && first && result.outcome === 'ready'
          ? ideaColumns(first.idea, 0, first.conceptId, result.why, written_at)
          : {
              status: 'dropped',
              drop_reason: outcome.outcome === 'dropped' ? outcome.reason : 'No idea was kept.',
              write_model: WRITE_CARD_MODEL,
              written_at,
            };
      // Only a row still picked: a second top-up running at the same time
      // may have written it already, and its card stands.
      const { data, error } = await learn
        .from('feed_cards')
        .update(change)
        .eq('id', card.id)
        .eq('user_id', id)
        .eq('status', 'picked')
        .select(PICK_COLUMNS);
      if (error) return { outcome: 'failed', detail: `Saving the card failed: ${error.message}` };
      const picked = (data ?? [])[0] as unknown as Record<string, unknown> | undefined;
      if (!picked) return { outcome: 'failed', detail: 'Written by another run first.' };
      if (outcome.outcome !== 'ready' || result.outcome !== 'ready') return outcome;

      // The section's further ideas, each a card of its own on the same pick.
      let stored = 1;
      for (const [offset, kept] of rest.entries()) {
        const { error: insertError } = await learn.from('feed_cards').insert({
          ...picked,
          user_id: id,
          ...ideaColumns(kept.idea, offset + 1, kept.conceptId, result.why, written_at),
        });
        if (insertError) console.error('[learn feed top-up] saving a further idea', insertError.message);
        else stored += 1;
      }
      return { ...outcome, ideas: outcome.ideas.slice(0, stored) };
    },
    now: Date.now,
  };

  // The threshold was checked above, before the lessons; the section cards
  // top up to the target whatever the lessons came to.
  const sections = await runTopUpFor(ports, {
    userId,
    threshold: lessons ? target : options.threshold,
    target,
    deadline: options.deadline,
  });
  if (!lessons) return sections;
  return { ...sections, readyBefore, skipped: false, lessons };
}

export type FeedTopUpResult = { people: TopUpSummary[] };

/**
 * The hourly call: everyone with placed themes or an active goal, and fewer
 * than twenty ready cards, is topped up, one person after another, inside one
 * budget.
 */
export async function runFeedTopUp(): Promise<FeedTopUpResult> {
  const deadline = Date.now() + FEED_TOP_UP_BUDGET_MS;
  const context = await createContext();
  const people: TopUpSummary[] = [];
  for (const userId of await peopleToPickFor(context.learn)) {
    if (Date.now() >= deadline) break;
    people.push(await topUpWith(context, userId, { threshold: READY_TARGET, deadline }));
  }
  return { people };
}

/**
 * Top up one person after a response on the feed page, when seven or fewer
 * cards are ready, by fifteen more. For the page's server action to call inside `after()`:
 *
 *   after(() => topUpFeedAfterResponse(user.id));
 *
 * Never throws: it runs after the response has gone, where an error has
 * nobody to reach, so a failure is logged and the hourly tick tries again.
 */
export async function topUpFeedAfterResponse(userId: string): Promise<TopUpSummary | null> {
  try {
    // One count first, so a response with plenty of cards ready costs no more.
    const ready = await countReady(createLearnServiceSupabase(), userId);
    if (ready >= READY_LOW) return null;
    const context = await createContext();
    return await topUpWith(context, userId, {
      threshold: READY_LOW,
      target: ready + READY_BATCH,
      deadline: Date.now() + FEED_TOP_UP_AFTER_RESPONSE_MS,
    });
  } catch (error) {
    console.error('[learn feed top-up]', error instanceof Error ? error.message : error);
    return null;
  }
}
