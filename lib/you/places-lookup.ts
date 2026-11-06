import 'server-only';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { addressKey, ensureHomeLocation, geocodeAddress, mapsApiKey } from '@/lib/you/home-location';
import { recordSpend, type SpendClient } from '@/lib/core/spend/record';
import { EMPTY_USAGE, GOOGLE_GEOCODING, GOOGLE_PLACES_TEXT_SEARCH } from '@/lib/core/spend/pricing';

/**
 * The chats' places lookup (plan #2987.2): "a quiet café near me", "is the
 * pharmacy open now", answered from Google Places Text Search (New), biased
 * to home's point (lib/you/home-location.ts) or to another address the chat
 * names.
 *
 * Google is asked as little as it can be:
 *
 * - The same query near the same point, with the same radius and filter, is
 *   answered from you.places_cache for a day (an hour when it asks for places
 *   open now, since that goes stale by the hour). A cache hit is not a call.
 * - Every call writes a row in you.places_calls before it goes out, and the
 *   table's trigger refuses the 51st of a person's UTC day
 *   (supabase/migrations-you/0046_places_lookup.sql), so the cap holds across
 *   every chat at once.
 * - The field mask asks for what a chat reply needs and nothing else: no
 *   reviews, no photos.
 *
 * Every Google call is written to core.model_spend: a Places search as
 * 'find-places', and each geocode (home's address when it changed, or the
 * address searched near) as 'geocode-address'. Geocodes do not count toward
 * the cap of 50, which is for Places.
 *
 * Nothing is sent to Google but the query, the point and the radius (and an
 * address to geocode): nothing about the person or the chat.
 */

export const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_TIMEOUT_MS = 10_000;

/** Calls a person's lookups may make in a UTC day. The trigger holds the same number. */
export const DAILY_PLACES_CAP = 50;
/** How long a search is reused. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a search for places open now is reused. */
export const OPEN_NOW_CACHE_TTL_MS = 60 * 60 * 1000;
/** How long a geocoded address other than home is reused. */
export const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RADIUS_M = 2000;
const MIN_RADIUS_M = 200;
/** Google's own ceiling for a location bias circle. */
const MAX_RADIUS_M = 50_000;
/** Below this many places within the radius, the radius widens. */
export const FEW_RESULTS = 3;
/** The radius widens by doubling, at most this many times (2 km reaches 16 km). */
const MAX_WIDENINGS = 3;
export const MAX_RESULTS = 8;
/** Asked of Google: the most one page holds, so widening needs no second call. */
const PAGE_SIZE = 20;
const MAX_QUERY_LENGTH = 200;

/**
 * The fields asked for. Rating, price level and opening hours make this the
 * Enterprise SKU; reviews and photos are left out.
 */
export const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.currentOpeningHours.openNow',
  'places.currentOpeningHours.weekdayDescriptions',
  'places.utcOffsetMinutes',
  'places.googleMapsUri',
].join(',');

export type PlacesLookupInput = {
  /** What to look for, as the person put it: "ramen", "a hardware store". */
  query: string;
  /** An address or place name to search near instead of home. */
  near?: string | null;
  /** How far to look, in metres; about 2 km when unset, widened when few places fall inside. */
  radiusMeters?: number | null;
  /** Only places open now. */
  openNow?: boolean | null;
};

export type FoundPlace = {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  ratingCount: number | null;
  /** 0 free to 4 very expensive; null when Google has none. */
  priceLevel: 0 | 1 | 2 | 3 | 4 | null;
  /** As of fetchedAt; null when Google has no hours. */
  openNow: boolean | null;
  /** Today's hours at the place, as Google writes them: "9:00 AM – 5:00 PM". */
  todayHours: string | null;
  mapsUrl: string | null;
  /** Straight-line distance from home, in metres; null when home has no point. */
  distanceMeters: number | null;
  /** From the searched point when it was not home, in metres. */
  distanceFromNearMeters: number | null;
};

export type PlacesRefusal =
  /** GOOGLE_MAPS_API_KEY is unset. */
  | 'not_set_up'
  /** No query given. */
  | 'empty_query'
  /** No near address, and home has no point (no address on Details, or Google found none). */
  | 'no_home'
  /** The near address could not be found. */
  | 'near_not_found'
  /** The day's 50 calls are used. */
  | 'cap_reached';

export type PlacesLookupResult =
  | {
      status: 'ok';
      places: FoundPlace[];
      /** The point searched near: home, or the near address. */
      center: { lat: number; lng: number; label: string; isHome: boolean };
      /** The radius the places were kept within, after any widening. */
      radiusMeters: number;
      widened: boolean;
      /** Answered from the day's cache, with no call to Google. */
      cached: boolean;
      /** When Google answered; openNow is as of then. */
      fetchedAt: string;
    }
  /** Refused before asking Google; message is written for the chat to pass on. */
  | { status: 'refused'; reason: PlacesRefusal; message: string }
  /** Google or the database failed; message is written for the chat to pass on. */
  | { status: 'failed'; message: string; detail: string };

export type PlacesLookupDeps = {
  /** Bound to the you schema: home, the cache and the call count. */
  you: YouSupabaseClient;
  /** A core client for core.model_spend. */
  core: SpendClient;
  userId: string;
  /** Defaults to GOOGLE_MAPS_API_KEY. */
  apiKey?: string | null;
  fetcher?: typeof fetch;
  now?: () => Date;
};

const MESSAGES: Record<PlacesRefusal, string> = {
  not_set_up: "Dash can't look places up yet: the Google Maps key hasn't been set up for this app.",
  empty_query: 'Say what kind of place to look for, such as coffee or a pharmacy.',
  no_home:
    "Dash doesn't know where home is. Add your mailing address on You > Details, or name a place to search near.",
  near_not_found: "Dash couldn't find that place on the map. Try a fuller address or a nearby landmark.",
  cap_reached: "Dash has made today's 50 place lookups, the daily limit. Ask again tomorrow.",
};

function refuse(reason: PlacesRefusal): PlacesLookupResult {
  return { status: 'refused', reason, message: MESSAGES[reason] };
}

function fail(detail: string): PlacesLookupResult {
  return { status: 'failed', message: "Dash couldn't reach Google Places just now. Try again in a minute.", detail };
}

// ---------------------------------------------------------------------------
// Pure parts.
// ---------------------------------------------------------------------------

/** Straight-line (great-circle) distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** The radius asked for, kept between 200 m and Google's 50 km. */
export function clampRadius(radius: number | null | undefined): number {
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) return DEFAULT_RADIUS_M;
  return Math.round(Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, radius)));
}

/** A query as compared for the cache: spaces collapsed, case ignored. */
export function queryKey(query: string): string {
  return query.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The cache key for a search. The point is rounded to about a hundred
 * metres, so home always lands on the same key and a near address geocoded
 * twice still does.
 */
export function searchCacheKey(query: string, center: { lat: number; lng: number }, radius: number, openNow: boolean): string {
  return ['search', queryKey(query), center.lat.toFixed(3), center.lng.toFixed(3), String(radius), openNow ? 'open' : 'any'].join('|');
}

export function geocodeCacheKey(address: string): string {
  return `geocode|${addressKey(address)}`;
}

/** The request body sent: the query, the point and the radius. */
export function placesRequestBody(query: string, center: { lat: number; lng: number }, radius: number, openNow: boolean) {
  return {
    textQuery: query,
    pageSize: PAGE_SIZE,
    locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius } },
    ...(openNow ? { openNow: true } : {}),
  };
}

const PRICE_LEVELS: Record<string, FoundPlace['priceLevel']> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/**
 * Today's line of the week's hours, at the place. Google lists them Monday
 * first; the place's UTC offset says which day it is there.
 */
export function todayHours(weekdayDescriptions: unknown, utcOffsetMinutes: unknown, now: Date): string | null {
  if (!Array.isArray(weekdayDescriptions) || weekdayDescriptions.length !== 7) return null;
  const offset = typeof utcOffsetMinutes === 'number' ? utcOffsetMinutes : 0;
  const local = new Date(now.getTime() + offset * 60_000);
  const mondayFirst = (local.getUTCDay() + 6) % 7;
  const line = weekdayDescriptions[mondayFirst];
  if (typeof line !== 'string') return null;
  const colon = line.indexOf(':');
  return (colon >= 0 ? line.slice(colon + 1) : line).trim() || null;
}

/** A place as kept in the cache: Google's answer, read, before distances. */
export type CachedPlace = Omit<FoundPlace, 'distanceMeters' | 'distanceFromNearMeters'>;

/** Reads a Text Search reply into places, dropping any without a name or point. */
export function readPlacesReply(body: unknown, now: Date): CachedPlace[] {
  const places = ((body ?? {}) as { places?: unknown }).places;
  if (!Array.isArray(places)) return [];
  const out: CachedPlace[] = [];
  for (const raw of places) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const name = (p.displayName as { text?: unknown } | undefined)?.text;
    const location = p.location as { latitude?: unknown; longitude?: unknown } | undefined;
    const lat = location?.latitude;
    const lng = location?.longitude;
    if (typeof name !== 'string' || !name.trim() || typeof lat !== 'number' || typeof lng !== 'number') continue;
    const hours = p.currentOpeningHours as { openNow?: unknown; weekdayDescriptions?: unknown } | undefined;
    out.push({
      name: name.trim(),
      address: typeof p.formattedAddress === 'string' ? p.formattedAddress : null,
      lat,
      lng,
      rating: typeof p.rating === 'number' ? p.rating : null,
      ratingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
      priceLevel: typeof p.priceLevel === 'string' ? (PRICE_LEVELS[p.priceLevel] ?? null) : null,
      openNow: typeof hours?.openNow === 'boolean' ? hours.openNow : null,
      todayHours: todayHours(hours?.weekdayDescriptions, p.utcOffsetMinutes, now),
      mapsUrl: typeof p.googleMapsUri === 'string' ? p.googleMapsUri : null,
    });
  }
  return out;
}

/**
 * Up to eight places within the radius, in Google's order. When fewer than
 * three fall inside it, the radius doubles (up to three times) over the same
 * answer, so widening costs no second call.
 */
export function withinRadius(
  places: CachedPlace[],
  center: { lat: number; lng: number },
  home: { lat: number; lng: number } | null,
  radius: number,
  isHome: boolean,
): { places: FoundPlace[]; radiusMeters: number; widened: boolean } {
  const measured = places.map((place) => {
    const fromCenter = distanceMeters(center, place);
    return {
      ...place,
      distanceMeters: home ? distanceMeters(home, place) : null,
      distanceFromNearMeters: isHome ? null : fromCenter,
      fromCenter,
    };
  });
  let kept = radius;
  let inside = measured.filter((p) => p.fromCenter <= kept);
  let widenings = 0;
  while (inside.length < FEW_RESULTS && widenings < MAX_WIDENINGS && inside.length < measured.length) {
    kept = Math.min(MAX_RADIUS_M, kept * 2);
    widenings += 1;
    inside = measured.filter((p) => p.fromCenter <= kept);
  }
  return {
    places: inside.slice(0, MAX_RESULTS).map((p) => {
      const place: FoundPlace & { fromCenter?: number } = { ...p };
      delete place.fromCenter;
      return place;
    }),
    radiusMeters: kept,
    widened: kept !== radius,
  };
}

// ---------------------------------------------------------------------------
// The database and Google.
// ---------------------------------------------------------------------------

type CacheRow = { body: unknown; fetched_at: string };

async function readCache(deps: PlacesLookupDeps, key: string, ttlMs: number, now: Date): Promise<CacheRow | null> {
  const { data, error } = await deps.you
    .from('places_cache')
    .select('body, fetched_at')
    .eq('user_id', deps.userId)
    .eq('cache_key', key)
    .gt('fetched_at', new Date(now.getTime() - ttlMs).toISOString())
    .maybeSingle();
  if (error) {
    console.error('[you.places_cache] read', error.message);
    return null;
  }
  return (data as CacheRow | null) ?? null;
}

/** Best effort: a cache that failed to save only means the next lookup asks Google. */
async function writeCache(deps: PlacesLookupDeps, key: string, body: object, now: Date): Promise<void> {
  const { error } = await deps.you
    .from('places_cache')
    .upsert({ user_id: deps.userId, cache_key: key, body, fetched_at: now.toISOString() }, { onConflict: 'user_id,cache_key' });
  if (error) console.error('[you.places_cache] write', error.message);
}

/** Writes the day's call row; false when the cap trigger refused it. */
async function claimCall(deps: PlacesLookupDeps): Promise<{ ok: true } | { ok: false; capped: boolean; detail: string }> {
  const { error } = await deps.you.from('places_calls').insert({ user_id: deps.userId });
  if (!error) return { ok: true };
  const capped = error.code === '23514' || /50 calls today/.test(error.message ?? '');
  return { ok: false, capped, detail: error.message };
}

function recordGoogleSpend(deps: PlacesLookupDeps, operation: 'find-places' | 'geocode-address') {
  return recordSpend(deps.core, deps.userId, {
    module: 'you',
    operation,
    model: operation === 'find-places' ? GOOGLE_PLACES_TEXT_SEARCH : GOOGLE_GEOCODING,
    usage: EMPTY_USAGE,
  });
}

/** The near address's point, from the cache or Google. */
async function nearPoint(
  deps: PlacesLookupDeps,
  near: string,
  apiKey: string,
  now: Date,
): Promise<{ status: 'ok'; lat: number; lng: number } | { status: 'not_found' } | { status: 'failed'; reason: string }> {
  const key = geocodeCacheKey(near);
  const cached = await readCache(deps, key, GEOCODE_CACHE_TTL_MS, now);
  const body = cached?.body as { lat?: unknown; lng?: unknown } | undefined;
  if (typeof body?.lat === 'number' && typeof body?.lng === 'number') return { status: 'ok', lat: body.lat, lng: body.lng };

  const outcome = await geocodeAddress(near, apiKey, deps.fetcher);
  if (outcome.status === 'failed') return outcome;
  await recordGoogleSpend(deps, 'geocode-address');
  if (outcome.status === 'ok') await writeCache(deps, key, { lat: outcome.lat, lng: outcome.lng }, now);
  return outcome;
}

async function searchGoogle(
  query: string,
  center: { lat: number; lng: number },
  radius: number,
  openNow: boolean,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<{ ok: true; body: unknown } | { ok: false; detail: string }> {
  try {
    const response = await fetcher(PLACES_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
      },
      body: JSON.stringify(placesRequestBody(query, center, radius, openNow)),
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, detail: `Google Places answered ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}` };
    }
    return { ok: true, body: await response.json() };
  } catch (error) {
    return { ok: false, detail: `Google Places could not be reached (${error instanceof Error ? error.message : String(error)})` };
  }
}

/**
 * Look places up near home, or near another address. Never throws: a refusal
 * or a failure comes back with a message the chat can pass on as it is.
 *
 * The you client may be the person's own or a service-role one; every read
 * and write names the person.
 */
export async function lookUpPlaces(deps: PlacesLookupDeps, input: PlacesLookupInput): Promise<PlacesLookupResult> {
  try {
    return await lookUp(deps, input);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function lookUp(deps: PlacesLookupDeps, input: PlacesLookupInput): Promise<PlacesLookupResult> {
  const apiKey = deps.apiKey === undefined ? mapsApiKey() : deps.apiKey;
  if (!apiKey) return refuse('not_set_up');

  const query = (input.query ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) return refuse('empty_query');

  const now = deps.now?.() ?? new Date();
  const fetcher = deps.fetcher ?? fetch;
  const near = input.near?.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH) || null;

  const home = await ensureHomeLocation(deps.you, deps.userId, { apiKey, fetcher: deps.fetcher, now: deps.now });
  if (home.status === 'ok' && home.geocoded) await recordGoogleSpend(deps, 'geocode-address');
  const homePoint = home.status === 'ok' ? { lat: home.lat, lng: home.lng } : null;

  let center: { lat: number; lng: number; label: string; isHome: boolean };
  if (near) {
    const point = await nearPoint(deps, near, apiKey, now);
    if (point.status === 'not_found') return refuse('near_not_found');
    if (point.status === 'failed') return fail(point.reason);
    center = { lat: point.lat, lng: point.lng, label: near, isHome: false };
  } else if (homePoint) {
    center = { ...homePoint, label: 'home', isHome: true };
  } else if (home.status === 'failed') {
    return fail(home.reason);
  } else {
    return refuse('no_home');
  }

  const radius = clampRadius(input.radiusMeters);
  const openNow = input.openNow === true;
  const key = searchCacheKey(query, center, radius, openNow);
  const answer = (places: CachedPlace[], cached: boolean, fetchedAt: string): PlacesLookupResult => ({
    status: 'ok',
    ...withinRadius(places, center, homePoint, radius, center.isHome),
    center,
    cached,
    fetchedAt,
  });

  const hit = await readCache(deps, key, openNow ? OPEN_NOW_CACHE_TTL_MS : CACHE_TTL_MS, now);
  const hitPlaces = (hit?.body as { places?: unknown } | undefined)?.places;
  if (hit && Array.isArray(hitPlaces)) return answer(hitPlaces as CachedPlace[], true, hit.fetched_at);

  const claim = await claimCall(deps);
  if (!claim.ok) return claim.capped ? refuse('cap_reached') : fail(`Counting the call failed: ${claim.detail}`);

  const reply = await searchGoogle(query, center, radius, openNow, apiKey, fetcher);
  if (!reply.ok) return fail(reply.detail);
  await recordGoogleSpend(deps, 'find-places');

  const places = readPlacesReply(reply.body, now);
  await writeCache(deps, key, { places }, now);
  return answer(places, false, now.toISOString());
}
