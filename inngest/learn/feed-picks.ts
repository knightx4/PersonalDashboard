import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { AIM_COLUMNS, cardDepthForAim, toAim, type AimRow } from '@/lib/learn/aims';
import { loadAimAreaNames } from '@/lib/learn/aims-store';
import { loadAreas } from '@/lib/learn/areas/load';
import { storeArticleOverRest } from '@/lib/learn/catalogue/store-rest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { cardTitle, isCardDifficulty } from '@/lib/learn/feed/card';
import { progressFrom } from '@/lib/learn/feed/depth';
import { NAME_MATERIAL_MODEL, nameMaterial } from '@/lib/learn/feed/name-material';
import {
  runFeedPicksFor,
  type FeedPickPorts,
  type FeedPickSummary,
  type PersonInputs,
} from '@/lib/learn/feed/pass';
import { preferencesFrom } from '@/lib/learn/feed/preference';
import {
  RECENT_GOAL_DAYS,
  RECENT_TARGET_DAYS,
  type FeedField,
  type FeedGoal,
  type FeedTheme,
  type FieldTests,
} from '@/lib/learn/feed/targets';
import type { LearnOperation } from '@/lib/learn/spend';
import { fetchWikipediaArticle } from '@/lib/learn/providers/wikipedia';

/**
 * One call of the Learn now picking pass (plan #806).
 *
 * For every account with placed themes or an active goal, draws a few targets and leaves
 * `picked` rows in `learn.feed_cards`, each pointing at a Wikipedia section
 * stored in the catalogue. The Learn now top-up (plan #807,
 * `inngest/learn/feed-top-up.ts`) calls the same pass per person when it runs
 * out of picked rows to write; this whole-account run stays for a manual call.
 *
 * The service client bypasses RLS, so every read and write names the person.
 */

/** Time one call spends. The route's limit is 300 seconds. */
export const FEED_PICKS_BUDGET_MS = 230_000;

const OPERATION: LearnOperation = 'name-feed-material';

/** PostgREST returns at most this many rows per request, so longer reads page. */
const PAGE = 1000;

async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Reading ${what} failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

/**
 * Every account with at least one theme placed in a field, or an active
 * open-subject goal (plan #900), which is enough to draw cards for.
 */
export async function peopleToPickFor(learn: LearnSupabaseClient): Promise<string[]> {
  const [themed, aiming] = await Promise.all([
    readAll<{ user_id: string }>(
      (from, to) =>
        learn.from('theme_fields').select('user_id').not('field_id', 'is', null).order('user_id').range(from, to),
      'placed themes',
    ),
    readAll<{ user_id: string }>(
      (from, to) =>
        learn
          .from('aims')
          .select('user_id')
          .is('archived_at', null)
          .is('list_source', null)
          .order('user_id')
          .range(from, to),
      'goals',
    ),
  ]);
  return [...new Set([...themed, ...aiming].map((row) => row.user_id))];
}

/**
 * This person's active open-subject goals, as the draw needs them, oldest
 * first. The Level 3 goal is left out: its cards come from its list (plan
 * #910). A goal not placed yet is drawn from its wording, since nothing
 * retries a placement that failed.
 */
async function loadGoals(
  learn: LearnSupabaseClient,
  fields: FeedField[],
  userId: string,
): Promise<{ goals: FeedGoal[]; since: string | null }> {
  const { data, error } = await learn
    .from('aims')
    .select(AIM_COLUMNS)
    .eq('user_id', userId)
    .is('archived_at', null)
    .is('list_source', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading your goals failed: ${error.message}`);
  const aims = ((data ?? []) as AimRow[]).map(toAim);
  const names = aims.some((aim) => aim.domainId) ? await loadAimAreaNames(learn, aims) : new Map<string, string>();
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  return {
    goals: aims.map((aim) => ({
      id: aim.id,
      name: aim.name,
      about: aim.about,
      depth: cardDepthForAim(aim.depth),
      field: aim.fieldId ? (fieldById.get(aim.fieldId) ?? null) : null,
      domain: aim.domainId ? (names.get(aim.domainId) ?? null) : null,
    })),
    since: aims[0]?.createdAt ?? null,
  };
}

async function loadPerson(learn: LearnSupabaseClient, fields: FeedField[], userId: string): Promise<PersonInputs> {
  const vault = createVaultServiceSupabase();

  type Placement = { theme_id: string; field_id: string };
  type Theme = { id: string; name: string; about: string; strength: number | string | null };
  type Card = {
    reason: 'interest' | 'gap' | 'goal' | 'queued';
    theme_id: string | null;
    aim_id: string | null;
    field_id: string | null;
    named_article: string | null;
    created_at: string;
    status: string;
    difficulty: string | null;
    saved_reading_id: string | null;
    acted_at: string | null;
    item: { title: string } | null;
    segment: { heading: string | null } | null;
  };

  const [placements, themes, cards, tests, { goals, since: goalsSince }] = await Promise.all([
    readAll<Placement>(
      (from, to) =>
        learn
          .from('theme_fields')
          .select('theme_id, field_id')
          .eq('user_id', userId)
          .not('field_id', 'is', null)
          .order('theme_id')
          .range(from, to),
      'where your themes sit',
    ),
    readAll<Theme>(
      (from, to) =>
        vault.from('themes').select('id, name, about, strength').eq('user_id', userId).order('id').range(from, to),
      'your themes',
    ),
    readAll<Card>(
      (from, to) =>
        learn
          .from('feed_cards')
          .select(
            'reason, theme_id, aim_id, field_id, named_article, created_at, status, difficulty, saved_reading_id, acted_at, ' +
              'item:catalogue_items!feed_cards_item_id_fkey(title), ' +
              'segment:catalogue_segments!feed_cards_segment_id_fkey(heading)',
          )
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .range(from, to),
      'your cards',
    ),
    learn.rpc('feed_field_tests', { p_user_id: userId }),
    loadGoals(learn, fields, userId),
  ]);
  if (tests.error) throw new Error(`Reading what you have been tested on failed: ${tests.error.message}`);

  const fieldOf = new Map(placements.map((row) => [row.theme_id, row.field_id]));
  const feedThemes: FeedTheme[] = themes.flatMap((theme) => {
    const fieldId = fieldOf.get(theme.id);
    if (!fieldId) return [];
    // numeric comes back from PostgREST as a string.
    return [{ id: theme.id, name: theme.name, about: theme.about, strength: Number(theme.strength ?? 0), fieldId }];
  });

  const fieldTests = new Map<string, FieldTests>(
    ((tests.data ?? []) as { field_id: string; tracks: number; answered: number }[]).map((row) => [
      row.field_id,
      { tracks: row.tracks, answered: row.answered },
    ]),
  );

  const since = Date.now() - RECENT_TARGET_DAYS * 24 * 60 * 60 * 1000;
  const recentThemeIds = new Set<string>();
  const recentFieldIds = new Set<string>();
  const recentAimIds = new Set<string>();
  const goalSince = Date.now() - RECENT_GOAL_DAYS * 24 * 60 * 60 * 1000;
  const picked = { interest: 0, gap: 0, goal: 0 };
  // The one-in-three share for goals is kept over the cards picked since the
  // oldest goal still active was set (targets.ts, wantsGoal).
  const windowFrom = goalsSince ? Date.parse(goalsSince) : Infinity;
  const goalWindow = { goal: 0, total: 0 };
  // A theme or field with a card swiped "I need to work on this" is drawn
  // again without waiting out RECENT_TARGET_DAYS: the person asked for more.
  const wantMoreThemes = new Set<string>();
  const wantMoreFields = new Set<string>();
  const wantMoreAims = new Set<string>();
  for (const card of cards) {
    if (card.status !== 'review') continue;
    if (card.aim_id) wantMoreAims.add(card.aim_id);
    if (card.theme_id) wantMoreThemes.add(card.theme_id);
    if (card.reason === 'gap' && card.field_id) wantMoreFields.add(card.field_id);
  }
  for (const card of cards) {
    if (card.reason === 'queued') continue;
    picked[card.reason] += 1;
    const created = Date.parse(card.created_at);
    if (created >= windowFrom) {
      goalWindow.total += 1;
      if (card.reason === 'goal') goalWindow.goal += 1;
    }
    if (card.reason === 'goal' && card.aim_id && created >= goalSince && !wantMoreAims.has(card.aim_id)) {
      recentAimIds.add(card.aim_id);
    }
    if (created < since) continue;
    if (card.reason === 'interest' && card.theme_id && !wantMoreThemes.has(card.theme_id)) {
      recentThemeIds.add(card.theme_id);
    }
    if (card.reason === 'gap' && card.field_id && !wantMoreFields.has(card.field_id)) {
      recentFieldIds.add(card.field_id);
    }
  }

  // Newest action first, so the titles passed to the naming call are the
  // latest swipes. A card rated Too hard or Too easy counts even when it has
  // not been swiped (plan #894).
  const swiped = cards
    .filter((card) => card.status === 'known' || card.status === 'review' || isCardDifficulty(card.difficulty))
    .sort((a, b) => Date.parse(b.acted_at ?? b.created_at) - Date.parse(a.acted_at ?? a.created_at))
    .map((card) => ({
      status: card.status,
      theme_id: card.theme_id,
      field_id: card.field_id,
      aim_id: card.aim_id,
      reason: card.reason,
      difficulty: isCardDifficulty(card.difficulty) ? card.difficulty : null,
      title: card.item ? cardTitle(card.item.title, card.segment?.heading ?? null) : card.named_article,
    }));

  return {
    themes: feedThemes,
    fields,
    tests: fieldTests,
    recentThemeIds,
    recentFieldIds,
    goals,
    recentAimIds,
    goalWindow,
    // Saves and Not interested on every earlier card lean the draw (plan #809).
    preferences: preferencesFrom(cards),
    // Known and review swipes, and the difficulty ratings, set how deep the
    // next picks go (depth.ts).
    progress: progressFrom(swiped),
    picked,
    articlesHeld: [...new Set(cards.flatMap((card) => (card.named_article ? [card.named_article] : [])))],
  };
}

export type FeedPicksResult = { people: FeedPickSummary[] };

/** The fields in the areas, as the draw needs them. */
export async function loadFeedFields(learn: LearnSupabaseClient): Promise<FeedField[]> {
  const areas = await loadAreas(learn);
  const domainOf = new Map(areas.fields.map((field) => [field.slug, field.domain]));
  return areas.fields.map((field) => ({
    id: areas.fieldIds.get(field.slug)!,
    slug: field.slug,
    name: field.name,
    scope: field.scope,
    domain: domainOf.get(field.slug) ?? '',
  }));
}

/**
 * The picking pass for one person, with the real ports.
 *
 * Exported for the Learn now top-up (plan #807), which picks for one person
 * when their picked rows run out, inside its own deadline.
 */
export function createFeedPicker(context: {
  learn: LearnSupabaseClient;
  core: ReturnType<typeof createCoreServiceSupabase>;
  apiKey: string;
  fields: FeedField[];
}): (userId: string, options: { targets?: number; deadline: number }) => Promise<FeedPickSummary> {
  const { learn, core, apiKey, fields } = context;
  return (userId, options) => {
    const ports: FeedPickPorts = {
      loadPerson: (id) => loadPerson(learn, fields, id),
      name: async (target, avoid, depth) => {
        const spend: SpendReport[] = [];
        const result = await nameMaterial({
          target,
          depth,
          avoid,
          anthropicApiKey: apiKey,
          onSpend: (report) => spend.push(report),
        });
        // Awaited, so the row lands before the function is frozen.
        for (const report of spend) {
          await recordSpend(core, userId, {
            module: 'learn',
            operation: OPERATION,
            model: report.model,
            usage: report.usage,
          });
        }
        return result;
      },
      fetchArticle: fetchWikipediaArticle,
      storeArticle: (article) => storeArticleOverRest(learn, article),
      insertCard: async (row) => {
        const { data, error } = await learn
          .from('feed_cards')
          .upsert(row, { onConflict: 'user_id,segment_id', ignoreDuplicates: true })
          .select('id');
        if (error) throw new Error(`Writing the pick failed: ${error.message}`);
        return (data ?? []).length > 0 ? 'inserted' : 'duplicate';
      },
      now: Date.now,
    };
    return runFeedPicksFor(ports, {
      userId,
      targets: options.targets,
      deadline: options.deadline,
      model: NAME_MATERIAL_MODEL,
    });
  };
}

export async function runFeedPicks(options: { targets?: number } = {}): Promise<FeedPicksResult> {
  const started = Date.now();
  const deadline = started + FEED_PICKS_BUDGET_MS;
  const learn = createLearnServiceSupabase();
  const core = createCoreServiceSupabase();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('The Learn now pass needs ANTHROPIC_API_KEY to be set.');

  const pickFor = createFeedPicker({ learn, core, apiKey, fields: await loadFeedFields(learn) });

  const people: FeedPickSummary[] = [];
  for (const userId of await peopleToPickFor(learn)) {
    if (Date.now() >= deadline) break;
    people.push(await pickFor(userId, { targets: options.targets, deadline }));
  }

  return { people };
}
