import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  dataSource,
  placeKey,
  seriesIdKey,
  type FetchLike,
  type FetchedSeries,
  type Series,
  type SeriesPoint,
  type SeriesRef,
} from './sources';

/**
 * The series a chart draws, read through the shared cache in
 * learn.figure_series (plan #2321.3, learn 0182).
 *
 * A series is fetched from its source once and kept, found or not, so the
 * next lesson that names it, anyone's, reads the row instead. Everyone signed
 * in can read the cache; only the service role writes it, which is why the
 * lesson writer (an Inngest run) fetches and stores, and the page reads.
 */

/** What the cache holds for a series: the series, a remembered miss, or nothing yet. */
export type CachedSeries = FetchedSeries | undefined;

export type SeriesCache = {
  read(ref: SeriesRef): Promise<CachedSeries>;
  /** Absent on a cache the caller may not write, such as the page's. */
  write?(ref: SeriesRef, fetched: FetchedSeries): Promise<void>;
};

/** A series by reference, null when the source has no such series. */
export type SeriesLoader = (ref: SeriesRef) => Promise<Series | null>;

/**
 * Reads the cache, and on a miss fetches from the source and, where the
 * cache can be written, keeps what it found. A fetch that fails (network,
 * a server error, the timeout) answers null and is not kept.
 */
export function seriesLoader({
  cache,
  fetchImpl = fetch,
  timeoutMs = 8000,
}: {
  cache: SeriesCache;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): SeriesLoader {
  return async (ref) => {
    const cached = await cache.read(ref).catch(() => undefined);
    if (cached) return cached.found ? cached.series : null;
    let fetched: FetchedSeries;
    try {
      fetched = await dataSource(ref.source).fetch(ref, fetchImpl, AbortSignal.timeout(timeoutMs));
    } catch {
      return null;
    }
    await cache.write?.(ref, fetched).catch(() => undefined);
    return fetched.found ? fetched.series : null;
  };
}

type SeriesRow = {
  source: string;
  series_id: string;
  place: string;
  found: boolean;
  title: string | null;
  unit: string | null;
  place_name: string | null;
  url: string | null;
  points: unknown;
};

function readPoints(value: unknown): SeriesPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point) =>
    point && typeof point === 'object' && Number.isFinite((point as SeriesPoint).year) && Number.isFinite((point as SeriesPoint).value)
      ? [{ year: (point as SeriesPoint).year, value: (point as SeriesPoint).value }]
      : [],
  );
}

/** The cache in learn.figure_series. Pass `writable` only with the service-role client. */
export function supabaseSeriesCache(learn: LearnSupabaseClient, { writable = false } = {}): SeriesCache {
  const key = (ref: SeriesRef) => ({ source: ref.source, series_id: seriesIdKey(ref), place: placeKey(ref) });
  return {
    async read(ref) {
      const { source, series_id, place } = key(ref);
      const { data, error } = await learn
        .from('figure_series')
        .select('source, series_id, place, found, title, unit, place_name, url, points')
        .eq('source', source)
        .eq('series_id', series_id)
        .eq('place', place)
        .maybeSingle();
      if (error) throw new Error(`Reading the series cache failed: ${error.message}`);
      const row = data as SeriesRow | null;
      if (!row) return undefined;
      const points = readPoints(row.points);
      if (!row.found || points.length === 0) return { found: false };
      return {
        found: true,
        series: {
          source: ref.source,
          id: row.series_id,
          place: row.place,
          title: row.title ?? row.series_id,
          unit: row.unit,
          placeName: row.place_name,
          url: row.url ?? '',
          points,
        },
      };
    },
    write: writable
      ? async (ref, fetched) => {
          const row = fetched.found
            ? {
                ...key(ref),
                found: true,
                title: fetched.series.title,
                unit: fetched.series.unit,
                place_name: fetched.series.placeName,
                url: fetched.series.url,
                points: fetched.series.points,
              }
            : { ...key(ref), found: false, points: [] };
          const { error } = await learn
            .from('figure_series')
            .upsert({ ...row, fetched_at: new Date().toISOString() }, { onConflict: 'source,series_id,place' });
          if (error) throw new Error(`Keeping the series failed: ${error.message}`);
        }
      : undefined,
  };
}
