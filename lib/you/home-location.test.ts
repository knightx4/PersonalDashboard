import { describe, expect, it, vi } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  ensureHomeLocation,
  geocodeRequestUrl,
  mapsApiKey,
  needsGeocode,
  readGeocodeReply,
  type HomeRow,
} from './home-location';

const ADDRESS = '12 Elm Street, Springfield, IL 62701';

function row(over: Partial<HomeRow> = {}): HomeRow {
  return { mailing_address: ADDRESS, home_lat: null, home_lng: null, home_geocoded_address: null, ...over };
}

/** A stand-in for the you-schema client: one details row, and the updates sent to it. */
function fakeClient(stored: HomeRow | null) {
  const updates: { values: Record<string, unknown>; filters: [string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe('details');
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored, error: null }) }) }),
        update(values: Record<string, unknown>) {
          const entry = { values, filters: [] as [string, unknown][] };
          updates.push(entry);
          const chain = {
            eq(column: string, value: unknown) {
              entry.filters.push([column, value]);
              return chain;
            },
            then(resolve: (v: { error: null }) => void) {
              resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };
  return { client: client as unknown as YouSupabaseClient, updates };
}

function googleReplying(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch & {
    mock: { calls: [string][] };
  };
}

const FOUND = { status: 'OK', results: [{ geometry: { location: { lat: 39.78, lng: -89.65 } } }] };

describe('needsGeocode', () => {
  it('asks when there is an address and no point made from it', () => {
    expect(needsGeocode(row())).toBe(true);
  });

  it('does not ask again for the address the point was made from', () => {
    expect(needsGeocode(row({ home_lat: 39.78, home_lng: -89.65, home_geocoded_address: ADDRESS }))).toBe(false);
  });

  it('treats spacing and capitals as the same address', () => {
    expect(needsGeocode(row({ home_geocoded_address: '12 elm street,  Springfield, IL 62701 ' }))).toBe(false);
  });

  it('asks again once the address changes', () => {
    expect(needsGeocode(row({ mailing_address: '40 Oak Lane, Springfield', home_geocoded_address: ADDRESS }))).toBe(true);
  });

  it('never asks without an address', () => {
    expect(needsGeocode(row({ mailing_address: null }))).toBe(false);
    expect(needsGeocode(row({ mailing_address: '   ' }))).toBe(false);
    expect(needsGeocode(null)).toBe(false);
  });

  it('counts an address Google found nothing for as asked', () => {
    expect(needsGeocode(row({ home_geocoded_address: ADDRESS }))).toBe(false);
  });
});

describe('the request sent to Google', () => {
  it('carries the address and the key and nothing else', () => {
    const url = new URL(geocodeRequestUrl(ADDRESS, 'k'));
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/geocode/json');
    expect([...url.searchParams.keys()].sort()).toEqual(['address', 'key']);
    expect(url.searchParams.get('address')).toBe(ADDRESS);
  });
});

describe('readGeocodeReply', () => {
  it('reads the first result', () => {
    expect(readGeocodeReply(FOUND)).toEqual({ status: 'ok', lat: 39.78, lng: -89.65 });
  });

  it('reads no results as not found and a refusal as failed', () => {
    expect(readGeocodeReply({ status: 'ZERO_RESULTS', results: [] })).toEqual({ status: 'not_found' });
    expect(readGeocodeReply({ status: 'REQUEST_DENIED', error_message: 'bad key' })).toEqual({
      status: 'failed',
      reason: 'Google Geocoding said REQUEST_DENIED: bad key',
    });
  });
});

describe('mapsApiKey', () => {
  it('is null when GOOGLE_API_KEY is unset or blank', () => {
    expect(mapsApiKey({})).toBeNull();
    expect(mapsApiKey({ GOOGLE_API_KEY: '  ' })).toBeNull();
    expect(mapsApiKey({ GOOGLE_API_KEY: 'abc' })).toBe('abc');
  });

  it('falls back to GOOGLE_MAPS_API_KEY only when GOOGLE_API_KEY is unset', () => {
    expect(mapsApiKey({ GOOGLE_API_KEY: 'new', GOOGLE_MAPS_API_KEY: 'old' })).toBe('new');
    expect(mapsApiKey({ GOOGLE_MAPS_API_KEY: 'old' })).toBe('old');
  });
});

describe('ensureHomeLocation', () => {
  it('says not set up, and sends and writes nothing, when the key is unset', async () => {
    const { client, updates } = fakeClient(row());
    const fetcher = googleReplying(FOUND);
    expect(await ensureHomeLocation(client, 'u1', { apiKey: null, fetcher })).toEqual({ status: 'not_set_up' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('still returns a point already made when the key is unset', async () => {
    const { client } = fakeClient(row({ home_lat: 39.78, home_lng: -89.65, home_geocoded_address: ADDRESS }));
    expect(await ensureHomeLocation(client, 'u1', { apiKey: null })).toEqual({
      status: 'ok',
      lat: 39.78,
      lng: -89.65,
      address: ADDRESS,
      geocoded: false,
    });
  });

  it('geocodes a new address once and stores the point with the address', async () => {
    const { client, updates } = fakeClient(row());
    const fetcher = googleReplying(FOUND);
    const now = () => new Date('2026-11-05T12:00:00Z');
    const result = await ensureHomeLocation(client, 'u1', { apiKey: 'k', fetcher, now });
    expect(result).toEqual({ status: 'ok', lat: 39.78, lng: -89.65, address: ADDRESS, geocoded: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([
      {
        values: { home_lat: 39.78, home_lng: -89.65, home_geocoded_address: ADDRESS, home_geocoded_at: '2026-11-05T12:00:00.000Z' },
        filters: [
          ['user_id', 'u1'],
          ['mailing_address', ADDRESS],
        ],
      },
    ]);
  });

  it('does not call Google when the address is unchanged', async () => {
    const { client, updates } = fakeClient(row({ home_lat: 1, home_lng: 2, home_geocoded_address: ADDRESS }));
    const fetcher = googleReplying(FOUND);
    const result = await ensureHomeLocation(client, 'u1', { apiKey: 'k', fetcher });
    expect(result).toMatchObject({ status: 'ok', lat: 1, lng: 2, geocoded: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('geocodes again after the address changes', async () => {
    const moved = '40 Oak Lane, Springfield, IL 62702';
    const { client, updates } = fakeClient(row({ mailing_address: moved, home_lat: 1, home_lng: 2, home_geocoded_address: ADDRESS }));
    const fetcher = googleReplying(FOUND);
    const result = await ensureHomeLocation(client, 'u1', { apiKey: 'k', fetcher });
    expect(result).toMatchObject({ status: 'ok', address: moved, geocoded: true });
    expect(updates[0].values.home_geocoded_address).toBe(moved);
  });

  it('records an address Google found nothing for, with no point', async () => {
    const { client, updates } = fakeClient(row());
    const result = await ensureHomeLocation(client, 'u1', { apiKey: 'k', fetcher: googleReplying({ status: 'ZERO_RESULTS', results: [] }) });
    expect(result).toEqual({ status: 'not_found', address: ADDRESS });
    expect(updates[0].values).toMatchObject({ home_lat: null, home_lng: null, home_geocoded_address: ADDRESS });
  });

  it('writes nothing when Google refuses', async () => {
    const { client, updates } = fakeClient(row());
    const result = await ensureHomeLocation(client, 'u1', { apiKey: 'k', fetcher: googleReplying({ status: 'OVER_QUERY_LIMIT' }) });
    expect(result.status).toBe('failed');
    expect(updates).toEqual([]);
  });

  it('says there is no address when Details has none', async () => {
    const { client } = fakeClient(null);
    expect(await ensureHomeLocation(client, 'u1', { apiKey: 'k' })).toEqual({ status: 'no_address' });
  });
});
