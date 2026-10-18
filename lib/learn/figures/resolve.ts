import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { placeLoader, supabasePlaceCache } from './places';
import { parseFigure } from './registry';
import { seriesLoader, supabaseSeriesCache } from './series-store';
import type { FigureBlock, FigureResolveContext } from './types';

/**
 * The step between a stored figure and its Render, for the kinds whose
 * content is fetched (plan #2321.3): a `series` chart's numbers now, a
 * `source` figure's stored image next (plan #2321.4).
 *
 * Runs on the server. Each block whose kind has a `resolve` gets
 * `resolved`: what it fetched, or null when nothing could be found, which
 * draws the caption with a line saying so. Nothing here fails the lesson; a
 * resolve that throws is the same as one that found nothing.
 */
export async function resolveFigures(
  blocks: readonly FigureBlock[],
  context: FigureResolveContext,
): Promise<FigureBlock[]> {
  return Promise.all(
    blocks.map(async (block) => {
      const drawn = parseFigure(block);
      if (!drawn?.kind.resolve) return block;
      const resolved = await drawn.kind.resolve(drawn.spec, context).catch(() => null);
      return { ...block, resolved: resolved ?? null };
    }),
  );
}

/** Whether any of these blocks has something to fetch, so a page with none skips the work. */
export function needsResolving(blocks: readonly FigureBlock[]): boolean {
  return blocks.some((block) => parseFigure(block)?.kind.resolve !== undefined);
}

/**
 * The page's context: reads the shared cache on the signed-in client, and on
 * a series the cache has never seen fetches it for this view without
 * keeping it (only the writer's service-role client can write the cache),
 * on a short timeout so a slow source cannot hold the page.
 */
export function pageResolveContext(learn: LearnSupabaseClient): FigureResolveContext {
  return {
    series: seriesLoader({ cache: supabaseSeriesCache(learn), timeoutMs: 4000 }),
    // The page reads located places and never asks the geocoder: its policy
    // wants each answer kept, and only the writer can keep one.
    places: placeLoader({ cache: supabasePlaceCache(learn) }),
  };
}

/**
 * The lesson writer's context: the service-role client, so each series and
 * each place the writer named is fetched once and kept, found or not, before
 * the lesson is stored.
 */
export function writerResolveContext(serviceLearn: LearnSupabaseClient): FigureResolveContext {
  return {
    series: seriesLoader({ cache: supabaseSeriesCache(serviceLearn, { writable: true }) }),
    places: placeLoader({ cache: supabasePlaceCache(serviceLearn, { writable: true }), ask: { fetchImpl: fetch } }),
  };
}
