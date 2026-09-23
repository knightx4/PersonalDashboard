import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { loadAreas } from '@/lib/learn/areas/load';
import { PLACE_BATCH, PLACE_MODEL, placeThemes, type PlaceItem } from '@/lib/learn/areas/place';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * One call of theme placement (docs/LEARN-AREAS-SPEC.md, "Placement").
 *
 * Finds every vault theme with no row in `learn.theme_fields` and places it,
 * a few batches at a time, until its time is up. Each placement is written as
 * it lands, so a call can stop anywhere and the next one carries on. Once
 * every theme is placed a call costs two reads, which is what makes an hourly
 * schedule cheap: new themes from a vault sweep are placed within the hour.
 *
 * A row is only ever inserted, never updated, so a placement you moved by hand
 * is never overwritten, and a theme the model left unplaced is not asked
 * about again.
 *
 * The service client bypasses RLS, so every write names the theme's owner.
 */

/** Time one call spends. The route's limit is 300 seconds. */
export const PLACEMENT_BUDGET_MS = 230_000;

/** Batches placed at once, as in the areas check. */
const CONCURRENCY = 4;

const OPERATION: LearnOperation = 'place-themes';

/** Rows per read. PostgREST caps a response at 1,000. */
const PAGE = 1000;

export type ThemePlacementSummary = {
  placed: number;
  unplaced: number;
  remaining: number;
  failed: string[];
};

type ThemeRow = { id: string; user_id: string; name: string; about: string };

/**
 * Every theme, and the ids of those already placed.
 *
 * Read whole and compared here, because the two tables are in different
 * schemas and PostgREST cannot join across them. At 685 themes that is one
 * read of each. Past a few tens of thousands it wants a view or an RPC.
 */
async function pendingThemes(learn: LearnSupabaseClient): Promise<ThemeRow[]> {
  const vault = createVaultServiceSupabase();
  const themes: ThemeRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await vault
      .from('themes')
      .select('id, user_id, name, about')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading themes failed: ${error.message}`);
    themes.push(...((data ?? []) as ThemeRow[]));
    if (!data || data.length < PAGE) break;
  }

  const placed = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await learn
      .from('theme_fields')
      .select('theme_id')
      .order('theme_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading placements failed: ${error.message}`);
    for (const row of (data ?? []) as { theme_id: string }[]) placed.add(row.theme_id);
    if (!data || data.length < PAGE) break;
  }

  return themes.filter((theme) => !placed.has(theme.id));
}

export async function runThemePlacementTick(): Promise<ThemePlacementSummary> {
  const started = Date.now();
  const learn = createLearnServiceSupabase();
  const summary: ThemePlacementSummary = { placed: 0, unplaced: 0, remaining: 0, failed: [] };

  const pending = await pendingThemes(learn);
  summary.remaining = pending.length;
  if (pending.length === 0) return summary;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Theme placement needs ANTHROPIC_API_KEY to be set.');

  const core = createCoreServiceSupabase();
  const { fields, domains, fieldIds, domainIds } = await loadAreas(learn);

  // One user's themes per batch, so a title in a reply names exactly one theme:
  // names are unique per account, case-insensitively, and not across accounts.
  const byUser = new Map<string, ThemeRow[]>();
  for (const theme of pending) byUser.set(theme.user_id, [...(byUser.get(theme.user_id) ?? []), theme]);
  const batches: { userId: string; themes: ThemeRow[] }[] = [];
  for (const [userId, themes] of byUser) {
    for (let i = 0; i < themes.length; i += PLACE_BATCH) {
      batches.push({ userId, themes: themes.slice(i, i + PLACE_BATCH) });
    }
  }

  let done = 0;
  while (done < batches.length && Date.now() - started < PLACEMENT_BUDGET_MS) {
    const round = batches.slice(done, done + CONCURRENCY);
    done += round.length;

    const results = await Promise.all(
      round.map(async (batch) => {
        const spend: SpendReport[] = [];
        const items: PlaceItem[] = batch.themes.map((theme) => ({ title: theme.name, context: theme.about }));
        const result = await placeThemes({
          themes: items,
          fields,
          domains,
          anthropicApiKey: apiKey,
          onSpend: (report) => spend.push(report),
        });
        for (const report of spend) {
          await recordSpend(core, batch.userId, {
            module: 'learn',
            operation: OPERATION,
            model: report.model,
            usage: report.usage,
          });
        }
        return { batch, result };
      }),
    );

    let writtenThisRound = 0;
    for (const { batch, result } of results) {
      if (!result.ok) {
        summary.failed.push(result.detail);
        continue;
      }
      const byName = new Map(batch.themes.map((theme) => [theme.name.toLowerCase(), theme]));
      const rows = result.placements.flatMap((placement) => {
        const theme = byName.get(placement.title.toLowerCase());
        if (!theme) return [];
        return [
          {
            user_id: batch.userId,
            theme_id: theme.id,
            field_id: placement.field ? (fieldIds.get(placement.field) ?? null) : null,
            domain_id: placement.domain ? (domainIds.get(placement.domain) ?? null) : null,
            runner_up_id: placement.runnerUp ? (fieldIds.get(placement.runnerUp) ?? null) : null,
            confidence: placement.confidence,
            basis: placement.basis,
            model: PLACE_MODEL,
          },
        ];
      });
      if (rows.length === 0) continue;

      const { error } = await learn
        .from('theme_fields')
        .upsert(rows, { onConflict: 'user_id,theme_id', ignoreDuplicates: true });
      if (error) {
        summary.failed.push(`Writing placements failed: ${error.message}`);
        continue;
      }
      writtenThisRound += rows.length;
      summary.placed += rows.filter((row) => row.field_id || row.domain_id).length;
      summary.unplaced += rows.filter((row) => !row.field_id && !row.domain_id).length;
    }

    // A round that wrote nothing will write nothing next time either. Stop and
    // let the failures say why rather than spend four more calls finding out.
    if (writtenThisRound === 0) break;
  }

  summary.remaining = (await pendingThemes(learn)).length;
  return summary;
}
