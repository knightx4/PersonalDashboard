import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { FetchLike } from './sources';

/**
 * Where the places a map names are, read through the shared cache in
 * learn.figure_places (plan #2321.6, learn 0185).
 *
 * The geocoder is OpenStreetMap's Nominatim. Its policy asks for at most one
 * request a second, an identifying User-Agent and caching of what it
 * returns, so a place is located once and kept, found or not, and the next
 * lesson that names it, anyone's, reads the row instead. Only the lesson
 * writer (an Inngest run, on the service role) asks Nominatim and keeps the
 * answer; the page reads the cache and nothing else, so a view never adds a
 * request.
 *
 * The lesson writer never supplies coordinates. It names places; this file
 * finds them.
 */

export type GeoPoint = { lat: number; lon: number; displayName: string; url: string | null };

/** What the geocoder said about a query: where it is, or that it has no such place. */
export type Located = { found: true; point: GeoPoint } | { found: false };

/** A place by query, null when it cannot be found or cannot be asked for now. */
export type PlaceLoader = (query: string) => Promise<GeoPoint | null>;

export type PlaceCache = {
  read(query: string): Promise<Located | undefined>;
  /** Absent on a cache the caller may not write, such as the page's. */
  write?(query: string, located: Located): Promise<void>;
};

export const GEOCODER = {
  name: 'OpenStreetMap Nominatim',
  url: 'https://nominatim.openstreetmap.org/',
  /** Nominatim's policy: one request a second at most. */
  minIntervalMs: 1100,
  userAgent: 'PersonalDashboard-Learn/1.0 (lesson maps; caches every answer)',
} as const;

/** The cache key: the words asked, lower-cased, with spaces and commas tidied. */
export function placeQuery(name: string, area: string): string {
  const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
  const said = [tidy(name), tidy(area)].filter(Boolean).join(', ');
  return said.toLowerCase().replace(/\s*,\s*/g, ', ');
}

/** Distance between two points in kilometres, on a sphere. */
export function kilometresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

type NominatimHit = { lat?: string; lon?: string; display_name?: string; osm_type?: string; osm_id?: number };

/** Asks Nominatim for one query. Throws on a network or server failure, which is not kept. */
export async function nominatimLocate(query: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<Located> {
  const url = `${GEOCODER.url}search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, {
    signal,
    headers: { 'User-Agent': GEOCODER.userAgent, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
  const hits = (await response.json()) as NominatimHit[];
  const hit = Array.isArray(hits) ? hits[0] : undefined;
  const lat = Number(hit?.lat);
  const lon = Number(hit?.lon);
  if (!hit || !Number.isFinite(lat) || !Number.isFinite(lon)) return { found: false };
  return {
    found: true,
    point: {
      lat,
      lon,
      displayName: hit.display_name ?? query,
      url: hit.osm_type && hit.osm_id ? `https://www.openstreetmap.org/${hit.osm_type}/${hit.osm_id}` : null,
    },
  };
}

/**
 * Reads the cache, and where `ask` is given (the writer), asks the geocoder
 * on a miss, one request at a time and no faster than its policy allows,
 * and keeps the answer. Without `ask` (the page) a miss is null.
 */
export function placeLoader({
  cache,
  ask,
  timeoutMs = 8000,
  wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
}: {
  cache: PlaceCache;
  ask?: { fetchImpl: FetchLike };
  timeoutMs?: number;
  wait?: (ms: number) => Promise<void>;
}): PlaceLoader {
  let queue: Promise<unknown> = Promise.resolve();
  let lastAsked = -Infinity;
  const askInTurn = (query: string): Promise<Located> => {
    const turn = queue.then(async () => {
      const since = Date.now() - lastAsked;
      if (since < GEOCODER.minIntervalMs) await wait(GEOCODER.minIntervalMs - since);
      lastAsked = Date.now();
      return nominatimLocate(query, ask!.fetchImpl, AbortSignal.timeout(timeoutMs));
    });
    queue = turn.catch(() => undefined);
    return turn;
  };
  return async (query) => {
    const cached = await cache.read(query).catch(() => undefined);
    if (cached) return cached.found ? cached.point : null;
    if (!ask) return null;
    let located: Located;
    try {
      located = await askInTurn(query);
    } catch {
      return null;
    }
    await cache.write?.(query, located).catch(() => undefined);
    return located.found ? located.point : null;
  };
}

type PlaceRow = { found: boolean; lat: number | null; lon: number | null; display_name: string | null; osm_url: string | null };

/** The cache in learn.figure_places. Pass `writable` only with the service-role client. */
export function supabasePlaceCache(learn: LearnSupabaseClient, { writable = false } = {}): PlaceCache {
  return {
    async read(query) {
      const { data, error } = await learn
        .from('figure_places')
        .select('found, lat, lon, display_name, osm_url')
        .eq('query', query)
        .maybeSingle();
      if (error) throw new Error(`Reading the place cache failed: ${error.message}`);
      const row = data as PlaceRow | null;
      if (!row) return undefined;
      if (!row.found || row.lat == null || row.lon == null) return { found: false };
      return { found: true, point: { lat: row.lat, lon: row.lon, displayName: row.display_name ?? query, url: row.osm_url } };
    },
    write: writable
      ? async (query, located) => {
          const row = located.found
            ? {
                query,
                found: true,
                lat: located.point.lat,
                lon: located.point.lon,
                display_name: located.point.displayName,
                osm_url: located.point.url,
              }
            : { query, found: false, lat: null, lon: null, display_name: null, osm_url: null };
          const { error } = await learn
            .from('figure_places')
            .upsert({ ...row, fetched_at: new Date().toISOString() }, { onConflict: 'query' });
          if (error) throw new Error(`Keeping the place failed: ${error.message}`);
        }
      : undefined,
  };
}
