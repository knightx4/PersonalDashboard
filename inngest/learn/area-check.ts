import 'server-only';

import { z } from 'zod';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import {
  level3RequestUrl,
  MIN_ARTICLES,
  parseLevel3,
  wikitextFrom,
  type Level3Article,
} from '@/lib/learn/areas/level3';
import { PLACE_BATCH, PLACE_MODEL, placeArticles, type AreaField } from '@/lib/learn/areas/place';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { fetchDocument } from '@/lib/learn/providers/fetch';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * One call of the areas check (docs/LEARN-AREAS-SPEC.md, "Checking the list is
 * exclusive and complete").
 *
 * The first call loads Wikipedia's Level 3 vital articles into
 * `learn.area_check_articles`. Every call then places whatever is still
 * unplaced, a few batches at a time, until its time is up, and writes each
 * placement as it lands. So the run can be stopped anywhere and picked up by
 * calling again, and a call once everything is placed costs one count.
 *
 * The findings are read straight off the table afterwards; nothing here
 * summarises them.
 */

/** Time one call spends. The route's limit is 300 seconds. */
export const CHECK_BUDGET_MS = 230_000;

/** Batches placed at once. Four keeps a round near a minute without crowding the rate limit. */
const CONCURRENCY = 4;

const OPERATION: LearnOperation = 'check-areas';

export type AreaCheckSummary = {
  loaded: number;
  placed: number;
  remaining: number;
  failed: string[];
};

const ownerSchema = z.object({ userId: z.string() });

async function loadList(learn: LearnSupabaseClient): Promise<number> {
  const fetched = await fetchDocument(level3RequestUrl());
  if (!fetched.ok) throw new Error(`Fetching the Level 3 page failed: ${fetched.detail}`);

  const wikitext = wikitextFrom(fetched.text);
  if (!wikitext) throw new Error('The Level 3 page came back without its wikitext.');

  const articles = parseLevel3(wikitext);
  if (articles.length < MIN_ARTICLES) {
    throw new Error(
      `The Level 3 page parsed to ${articles.length} articles, fewer than ${MIN_ARTICLES}. ` +
        'The page format has probably changed; nothing was loaded.',
    );
  }

  const { error } = await learn
    .from('area_check_articles')
    .upsert(articles, { onConflict: 'title', ignoreDuplicates: true });
  if (error) throw new Error(`Loading the article list failed: ${error.message}`);
  return articles.length;
}

async function loadFields(learn: LearnSupabaseClient): Promise<{ fields: AreaField[]; ids: Map<string, string> }> {
  const { data, error } = await learn
    .from('area_fields')
    .select('id, slug, name, scope, position, domain:area_domains(name, position)');
  if (error) throw new Error(`Reading the areas failed: ${error.message}`);

  type Row = {
    id: string;
    slug: string;
    name: string;
    scope: string;
    position: number;
    domain: { name: string; position: number } | null;
  };
  const rows = ((data ?? []) as unknown as Row[]).sort(
    (a, b) => (a.domain?.position ?? 0) - (b.domain?.position ?? 0) || a.position - b.position,
  );
  if (rows.length === 0) throw new Error('There are no areas to place into. Is 0027_areas applied?');

  return {
    fields: rows.map((row) => ({ slug: row.slug, name: row.name, scope: row.scope, domain: row.domain?.name ?? '' })),
    ids: new Map(rows.map((row) => [row.slug, row.id])),
  };
}

async function countUnplaced(learn: LearnSupabaseClient): Promise<number> {
  const { count, error } = await learn
    .from('area_check_articles')
    .select('id', { count: 'exact', head: true })
    .is('placed_at', null);
  if (error) throw new Error(`Counting unplaced articles failed: ${error.message}`);
  return count ?? 0;
}

export async function runAreaCheckTick(): Promise<AreaCheckSummary> {
  const started = Date.now();
  const learn = createLearnServiceSupabase();
  const summary: AreaCheckSummary = { loaded: 0, placed: 0, remaining: 0, failed: [] };

  const { count: total, error: totalError } = await learn
    .from('area_check_articles')
    .select('id', { count: 'exact', head: true });
  if (totalError) throw new Error(`Reading the check failed: ${totalError.message}`);
  if ((total ?? 0) === 0) summary.loaded = await loadList(learn);

  summary.remaining = await countUnplaced(learn);
  if (summary.remaining === 0) return summary;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('The check needs ANTHROPIC_API_KEY to be set.');

  // Spend belongs to the owner, the account the dev tooling runs as.
  const { data: ownerData, error: ownerError } = await createServiceSupabase().rpc('app_owner');
  const owner = ownerSchema.safeParse(ownerData);
  if (ownerError || !owner.success) throw new Error('Could not resolve the owner to record spend against.');
  const core = createCoreServiceSupabase();

  const { fields, ids } = await loadFields(learn);

  while (Date.now() - started < CHECK_BUDGET_MS) {
    const { data, error } = await learn
      .from('area_check_articles')
      .select('title, section')
      .is('placed_at', null)
      .order('title')
      .limit(PLACE_BATCH * CONCURRENCY);
    if (error) throw new Error(`Reading unplaced articles failed: ${error.message}`);
    const pending = (data ?? []) as Level3Article[];
    if (pending.length === 0) break;

    const batches: Level3Article[][] = [];
    for (let i = 0; i < pending.length; i += PLACE_BATCH) batches.push(pending.slice(i, i + PLACE_BATCH));

    const spend: SpendReport[] = [];
    const results = await Promise.all(
      batches.map((batch) =>
        placeArticles({ batch, fields, anthropicApiKey: apiKey, onSpend: (report) => spend.push(report) }),
      ),
    );

    for (const report of spend) {
      await recordSpend(core, owner.data.userId, {
        module: 'learn',
        operation: OPERATION,
        model: report.model,
        usage: report.usage,
      });
    }

    let placedThisRound = 0;
    const placedAt = new Date().toISOString();
    for (const result of results) {
      if (!result.ok) {
        summary.failed.push(result.detail);
        continue;
      }
      for (const placement of result.placements) {
        const { error: writeError } = await learn
          .from('area_check_articles')
          .update({
            kind: placement.kind,
            field_id: ids.get(placement.field),
            runner_up_id: placement.runnerUp ? ids.get(placement.runnerUp) : null,
            confidence: placement.confidence,
            basis: placement.basis,
            model: PLACE_MODEL,
            placed_at: placedAt,
          })
          .eq('title', placement.title)
          .is('placed_at', null);
        if (writeError) summary.failed.push(`${placement.title}: ${writeError.message}`);
        else placedThisRound += 1;
      }
    }

    summary.placed += placedThisRound;
    // A round that placed nothing will place nothing next time either, and
    // each one costs four calls. Stop and let the failures say why.
    if (placedThisRound === 0) break;
  }

  summary.remaining = await countUnplaced(learn);
  return summary;
}
