import { describe, expect, it, vi } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import type { SpendClient } from '@/lib/core/spend/record';
import { costMicrosFor, EMPTY_USAGE, GOOGLE_GEOCODING, GOOGLE_PLACES_TEXT_SEARCH } from '@/lib/core/spend/pricing';
import type { HomeRow } from './home-location';
import {
  CACHE_TTL_MS,
  DAILY_PLACES_CAP,
  OPEN_NOW_CACHE_TTL_MS,
  PLACES_FIELD_MASK,
  PLACES_SEARCH_URL,
  clampRadius,
  distanceMeters,
  lookUpPlaces,
  readPlacesReply,
  searchCacheKey,
  todayHours,
  withinRadius,
  type CachedPlace,
} from './places-lookup';

const HOME = { lat: 51.5007, lng: -0.1246 };
const ADDRESS = '1 Parliament Square, London';
const NOW = new Date('2026-11-06T12:00:00Z'); // a Friday

/**
 * A stand-in for the you-schema client: the details row, the cache and the
 * call log, with the cap trigger's refusal past 50 rows.
 */
function fakeYou(details: HomeRow | null) {
  const cache = new Map<string, { body: unknown; fetched_at: string }>();
  const calls: string[] = [];
  const client = {
    from(table: string) {
      if (table === 'details') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: details, error: null }) }) }),
          update: (values: Partial<HomeRow>) => {
            const chain = {
              eq: () => chain,
              then: (resolve: (v: { error: null }) => void) => {
                if (details) Object.assign(details, values);
                resolve({ error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === 'places_cache') {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            let since = '';
            const chain = {
              eq: (column: string, value: unknown) => {
                filters[column] = value;
                return chain;
              },
              gt: (_column: string, value: string) => {
                since = value;
                return chain;
              },
              maybeSingle: async () => {
                const row = cache.get(String(filters.cache_key));
                return { data: row && row.fetched_at > since ? row : null, error: null };
              },
            };
            return chain;
          },
          upsert: async (row: { cache_key: string; body: unknown; fetched_at: string }) => {
            cache.set(row.cache_key, { body: row.body, fetched_at: row.fetched_at });
            return { error: null };
          },
        };
      }
      if (table === 'places_calls') {
        return {
          insert: async (row: { user_id: string }) => {
            if (calls.length >= DAILY_PLACES_CAP) {
              return { error: { code: '23514', message: 'The places lookup has made its 50 calls today.' } };
            }
            calls.push(row.user_id);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { you: client as unknown as YouSupabaseClient, cache, calls };
}

function fakeCore() {
  const spend: Record<string, unknown>[] = [];
  const core = {
    from(table: string) {
      expect(table).toBe('model_spend');
      return {
        insert: async (row: Record<string, unknown>) => {
          spend.push(row);
          return { error: null };
        },
      };
    },
  };
  return { core: core as unknown as SpendClient, spend };
}

function place(name: string, lat: number, lng: number, extra: Record<string, unknown> = {}) {
  return { displayName: { text: name }, location: { latitude: lat, longitude: lng }, ...extra };
}

/** Google, answering Places searches with `places` and geocodes with `geocode`. */
function google(places: unknown[], geocode: unknown = { status: 'OK', results: [{ geometry: { location: { lat: 51.53, lng: -0.12 } } }] }) {
  return vi.fn(async (url: string) => {
    const body = url.startsWith(PLACES_SEARCH_URL) ? { places } : geocode;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch & { mock: { calls: [string, RequestInit | undefined][] } };
}

function homeRow(): HomeRow {
  return { mailing_address: ADDRESS, home_lat: HOME.lat, home_lng: HOME.lng, home_geocoded_address: ADDRESS };
}

function setup(details: HomeRow | null = homeRow(), places: unknown[] = [place('Café A', 51.501, -0.125)]) {
  const you = fakeYou(details);
  const core = fakeCore();
  const fetcher = google(places);
  let now = NOW;
  const deps = { you: you.you, core: core.core, userId: 'user-1', apiKey: 'test-key', fetcher, now: () => now };
  return { ...you, ...core, fetcher, deps, setNow: (d: Date) => (now = d) };
}

describe('distanceMeters', () => {
  it('measures the straight line between two points', () => {
    // Westminster to St Paul's is about 2.4 km.
    const d = distanceMeters({ lat: 51.5007, lng: -0.1246 }, { lat: 51.5138, lng: -0.0984 });
    expect(d).toBeGreaterThan(2_300);
    expect(d).toBeLessThan(2_500);
    expect(distanceMeters(HOME, HOME)).toBe(0);
  });
});

describe('clampRadius', () => {
  it('defaults to about 2 km and keeps within Google’s bounds', () => {
    expect(clampRadius(undefined)).toBe(2000);
    expect(clampRadius(-5)).toBe(2000);
    expect(clampRadius(50)).toBe(200);
    expect(clampRadius(1e9)).toBe(50_000);
  });
});

describe('readPlacesReply', () => {
  it('reads name, address, rating, price, open now and today’s hours', () => {
    const [p] = readPlacesReply(
      {
        places: [
          place('Café A', 51.5, -0.12, {
            formattedAddress: '2 High St',
            rating: 4.6,
            userRatingCount: 210,
            priceLevel: 'PRICE_LEVEL_MODERATE',
            currentOpeningHours: {
              openNow: true,
              weekdayDescriptions: [
                'Monday: 8:00 AM – 6:00 PM',
                'Tuesday: 8:00 AM – 6:00 PM',
                'Wednesday: 8:00 AM – 6:00 PM',
                'Thursday: 8:00 AM – 6:00 PM',
                'Friday: 9:00 AM – 9:00 PM',
                'Saturday: Closed',
                'Sunday: Closed',
              ],
            },
            utcOffsetMinutes: 0,
            googleMapsUri: 'https://maps.google.com/?cid=1',
          }),
        ],
      },
      NOW,
    );
    expect(p).toEqual({
      name: 'Café A',
      address: '2 High St',
      lat: 51.5,
      lng: -0.12,
      rating: 4.6,
      ratingCount: 210,
      priceLevel: 2,
      openNow: true,
      todayHours: '9:00 AM – 9:00 PM',
      mapsUrl: 'https://maps.google.com/?cid=1',
    });
  });

  it('drops a place with no name or point', () => {
    expect(readPlacesReply({ places: [{ displayName: { text: 'X' } }, place('', 1, 1)] }, NOW)).toEqual([]);
    expect(readPlacesReply({}, NOW)).toEqual([]);
  });

  it('takes today at the place, by its UTC offset', () => {
    const week = ['Monday: a', 'Tuesday: b', 'Wednesday: c', 'Thursday: d', 'Friday: e', 'Saturday: f', 'Sunday: g'];
    // 23:30 UTC Friday is already Saturday at UTC+1.
    expect(todayHours(week, 60, new Date('2026-11-06T23:30:00Z'))).toBe('f');
    expect(todayHours(week, 0, new Date('2026-11-06T23:30:00Z'))).toBe('e');
    expect(todayHours(['x'], 0, NOW)).toBeNull();
  });
});

describe('withinRadius', () => {
  const near = (name: string, metresNorth: number): CachedPlace => ({
    name,
    address: null,
    lat: HOME.lat + metresNorth / 111_195,
    lng: HOME.lng,
    rating: null,
    ratingCount: null,
    priceLevel: null,
    openNow: null,
    todayHours: null,
    mapsUrl: null,
  });

  it('keeps places within the radius, with their distance from home', () => {
    const out = withinRadius([near('a', 500), near('b', 1000), near('c', 1500), near('far', 9000)], HOME, HOME, 2000, true);
    expect(out.places.map((p) => p.name)).toEqual(['a', 'b', 'c']);
    expect(out.places[0].distanceMeters).toBeCloseTo(500, -1);
    expect(out.places[0].distanceFromNearMeters).toBeNull();
    expect(out.widened).toBe(false);
    expect(out.radiusMeters).toBe(2000);
  });

  it('widens the radius when fewer than three places fall inside', () => {
    const out = withinRadius([near('a', 500), near('b', 3500), near('c', 7000), near('far', 40_000)], HOME, HOME, 2000, true);
    expect(out.places.map((p) => p.name)).toEqual(['a', 'b', 'c']);
    expect(out.widened).toBe(true);
    expect(out.radiusMeters).toBe(8000);
  });

  it('returns at most eight', () => {
    const many = Array.from({ length: 15 }, (_, i) => near(`p${i}`, 100 + i * 10));
    expect(withinRadius(many, HOME, HOME, 2000, true).places).toHaveLength(8);
  });
});

describe('lookUpPlaces', () => {
  it('refuses politely when GOOGLE_MAPS_API_KEY is unset, asking nobody', async () => {
    const t = setup();
    const result = await lookUpPlaces({ ...t.deps, apiKey: null }, { query: 'coffee' });
    expect(result).toMatchObject({ status: 'refused', reason: 'not_set_up' });
    expect(result.status === 'refused' && result.message).toMatch(/Dash can't look places up yet/);
    expect(t.fetcher).not.toHaveBeenCalled();
    expect(t.calls).toHaveLength(0);
    expect(t.spend).toHaveLength(0);
  });

  it('searches near home with the field mask and bias, and counts the call and its spend', async () => {
    const t = setup();
    const result = await lookUpPlaces(t.deps, { query: '  Coffee ' });
    expect(result).toMatchObject({ status: 'ok', cached: false, center: { label: 'home', isHome: true } });
    expect(result.status === 'ok' && result.places[0]).toMatchObject({ name: 'Café A' });

    const [url, init] = t.fetcher.mock.calls[0];
    expect(url).toBe(PLACES_SEARCH_URL);
    const headers = init!.headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toBe(PLACES_FIELD_MASK);
    expect(PLACES_FIELD_MASK).not.toMatch(/reviews|photos/);
    expect(JSON.parse(String(init!.body))).toEqual({
      textQuery: 'Coffee',
      pageSize: 20,
      locationBias: { circle: { center: { latitude: HOME.lat, longitude: HOME.lng }, radius: 2000 } },
    });

    expect(t.calls).toHaveLength(1);
    expect(t.spend).toEqual([expect.objectContaining({ module: 'you', operation: 'find-places', model: GOOGLE_PLACES_TEXT_SEARCH, cost_micros: 35_000 })]);
  });

  it('answers the same query near the same point from the cache for a day, uncounted', async () => {
    const t = setup();
    await lookUpPlaces(t.deps, { query: 'coffee' });
    const again = await lookUpPlaces(t.deps, { query: 'COFFEE' });
    expect(again).toMatchObject({ status: 'ok', cached: true });
    expect(t.fetcher).toHaveBeenCalledTimes(1);
    expect(t.calls).toHaveLength(1);
    expect(t.spend).toHaveLength(1);

    // A different radius is a different search.
    await lookUpPlaces(t.deps, { query: 'coffee', radiusMeters: 5000 });
    expect(t.fetcher).toHaveBeenCalledTimes(2);

    // A day later the cache has gone stale.
    t.setNow(new Date(NOW.getTime() + CACHE_TTL_MS + 1000));
    const later = await lookUpPlaces(t.deps, { query: 'coffee' });
    expect(later).toMatchObject({ status: 'ok', cached: false });
    expect(t.calls).toHaveLength(3);
  });

  it('keeps an open-now search for an hour only', async () => {
    const t = setup();
    await lookUpPlaces(t.deps, { query: 'pharmacy', openNow: true });
    expect(JSON.parse(String(t.fetcher.mock.calls[0][1]!.body)).openNow).toBe(true);
    t.setNow(new Date(NOW.getTime() + OPEN_NOW_CACHE_TTL_MS / 2));
    expect(await lookUpPlaces(t.deps, { query: 'pharmacy', openNow: true })).toMatchObject({ cached: true });
    t.setNow(new Date(NOW.getTime() + OPEN_NOW_CACHE_TTL_MS + 1000));
    expect(await lookUpPlaces(t.deps, { query: 'pharmacy', openNow: true })).toMatchObject({ cached: false });
  });

  it('refuses politely past 50 calls in a day, while a cached search still answers', async () => {
    const t = setup();
    await lookUpPlaces(t.deps, { query: 'cached one' });
    for (let i = 1; i < DAILY_PLACES_CAP; i += 1) await lookUpPlaces(t.deps, { query: `query ${i}` });
    expect(t.calls).toHaveLength(DAILY_PLACES_CAP);

    const over = await lookUpPlaces(t.deps, { query: 'one more' });
    expect(over).toMatchObject({ status: 'refused', reason: 'cap_reached' });
    expect(over.status === 'refused' && over.message).toMatch(/50 place lookups/);
    expect(t.fetcher).toHaveBeenCalledTimes(DAILY_PLACES_CAP);
    expect(t.spend).toHaveLength(DAILY_PLACES_CAP);

    expect(await lookUpPlaces(t.deps, { query: 'cached one' })).toMatchObject({ status: 'ok', cached: true });
  });

  it('searches near another address, geocoded once a day and counted as spend', async () => {
    const t = setup();
    const result = await lookUpPlaces(t.deps, { query: 'ramen', near: "King's Cross" });
    expect(result).toMatchObject({ status: 'ok', center: { label: "King's Cross", isHome: false, lat: 51.53 } });
    expect(result.status === 'ok' && result.places[0].distanceMeters).toBeGreaterThan(0);
    await lookUpPlaces(t.deps, { query: 'sushi', near: "king's  cross" });
    const geocodes = t.spend.filter((row) => row.operation === 'geocode-address');
    expect(geocodes).toEqual([expect.objectContaining({ model: GOOGLE_GEOCODING, cost_micros: 5_000 })]);
    expect(t.calls).toHaveLength(2);
  });

  it('counts the geocode that makes home’s point', async () => {
    const t = setup({ mailing_address: ADDRESS, home_lat: null, home_lng: null, home_geocoded_address: null });
    expect(await lookUpPlaces(t.deps, { query: 'coffee' })).toMatchObject({ status: 'ok' });
    expect(t.spend.map((row) => row.operation)).toEqual(['geocode-address', 'find-places']);
  });

  it('refuses without a home point or a place to search near', async () => {
    const t = setup({ mailing_address: null, home_lat: null, home_lng: null, home_geocoded_address: null });
    expect(await lookUpPlaces(t.deps, { query: 'coffee' })).toMatchObject({ status: 'refused', reason: 'no_home' });
    expect(await lookUpPlaces(t.deps, { query: '  ' })).toMatchObject({ status: 'refused', reason: 'empty_query' });
    expect(t.fetcher).not.toHaveBeenCalled();
  });

  it('fails politely when Google refuses, without caching', async () => {
    const t = setup();
    const fetcher = vi.fn(async () => new Response('denied', { status: 403 })) as unknown as typeof fetch;
    const result = await lookUpPlaces({ ...t.deps, fetcher }, { query: 'coffee' });
    expect(result).toMatchObject({ status: 'failed', message: expect.stringMatching(/Dash couldn't reach Google Places/) });
    expect(t.cache.size).toBe(0);
    expect(t.spend).toHaveLength(0);
  });
});

describe('the price table', () => {
  it('charges each Google call its per-request price', () => {
    expect(costMicrosFor(GOOGLE_PLACES_TEXT_SEARCH, EMPTY_USAGE)).toBe(35_000);
    expect(costMicrosFor(GOOGLE_GEOCODING, EMPTY_USAGE)).toBe(5_000);
  });

  it('keys a search by query, rounded point, radius and filter', () => {
    expect(searchCacheKey(' Coffee  Shop', { lat: 51.50071, lng: -0.12462 }, 2000, false)).toBe(
      'search|coffee shop|51.501|-0.125|2000|any',
    );
  });
});
