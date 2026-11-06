import 'server-only';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * Where home is, as a point (plan #2987.1). The chats' places lookup
 * (#2987.2) searches near it. Home is the mailing address on You > Details,
 * geocoded with the Google Geocoding API and kept on the same row
 * (supabase/migrations-you/0045_home_coordinates.sql) beside the address it
 * was made from, so Google is asked again only when that address changes.
 *
 * Only the address goes to Google: the request carries the address and the
 * key, nothing about the person or the chat that asked.
 *
 * With GOOGLE_API_KEY unset, a home that still needs geocoding comes
 * back as { status: 'not_set_up' } and nothing is sent or written.
 */

export const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const GEOCODE_TIMEOUT_MS = 8000;

/** The columns of you.details this reads. */
export const HOME_COLUMNS = 'mailing_address, home_lat, home_lng, home_geocoded_address';

export type HomeRow = {
  mailing_address: string | null;
  home_lat: number | null;
  home_lng: number | null;
  home_geocoded_address: string | null;
};

export type HomeLocation =
  /** The point; geocoded is true when this call asked Google for it. */
  | { status: 'ok'; lat: number; lng: number; address: string; geocoded: boolean }
  /** No mailing address on Details. */
  | { status: 'no_address' }
  /** GOOGLE_API_KEY is not set, and the point needs making. */
  | { status: 'not_set_up' }
  /** Google found nothing for this address; asked once, not again until it changes. */
  | { status: 'not_found'; address: string }
  /** The request failed (refused, over quota, network); nothing was written. */
  | { status: 'failed'; reason: string };

/** An address as compared: spaces collapsed and case ignored, so a retyped comma's space is no change. */
export function addressKey(address: string | null | undefined): string {
  return (address ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Whether the row's point has to be made again: there is a mailing address,
 * and it is not the one last sent to Google. An address Google found nothing
 * for is recorded with no point, and counts as asked.
 */
export function needsGeocode(row: HomeRow | null | undefined): boolean {
  const address = addressKey(row?.mailing_address);
  if (!address) return false;
  return addressKey(row?.home_geocoded_address) !== address;
}

/** What the row already says, without asking Google; null when it needs geocoding. */
export function storedHome(row: HomeRow | null | undefined): HomeLocation | null {
  const address = row?.mailing_address?.trim();
  if (!address) return { status: 'no_address' };
  if (needsGeocode(row)) return null;
  if (typeof row?.home_lat === 'number' && typeof row?.home_lng === 'number') {
    return { status: 'ok', lat: row.home_lat, lng: row.home_lng, address, geocoded: false };
  }
  return { status: 'not_found', address };
}

/** GOOGLE_API_KEY, or the older GOOGLE_MAPS_API_KEY when that is unset; null when neither is set. */
export function mapsApiKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.GOOGLE_API_KEY?.trim() || env.GOOGLE_MAPS_API_KEY?.trim() || null;
}

type GeocodeOutcome =
  | { status: 'ok'; lat: number; lng: number }
  | { status: 'not_found' }
  | { status: 'failed'; reason: string };

/** The request sent: the address and the key, and nothing else. */
export function geocodeRequestUrl(address: string, apiKey: string): string {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);
  return url.toString();
}

/** Reads a Geocoding API reply. */
export function readGeocodeReply(body: unknown): GeocodeOutcome {
  const reply = (body ?? {}) as {
    status?: string;
    error_message?: string;
    results?: { geometry?: { location?: { lat?: unknown; lng?: unknown } } }[];
  };
  if (reply.status === 'ZERO_RESULTS') return { status: 'not_found' };
  if (reply.status !== 'OK') {
    const why = reply.error_message ? `: ${reply.error_message}` : '';
    return { status: 'failed', reason: `Google Geocoding said ${reply.status ?? 'nothing'}${why}` };
  }
  const location = reply.results?.[0]?.geometry?.location;
  const lat = location?.lat;
  const lng = location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { status: 'not_found' };
  }
  return { status: 'ok', lat, lng };
}

/** Asks Google for one address's point. */
export async function geocodeAddress(
  address: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<GeocodeOutcome> {
  try {
    const response = await fetcher(geocodeRequestUrl(address, apiKey), {
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
    if (!response.ok) return { status: 'failed', reason: `Google Geocoding answered ${response.status}` };
    return readGeocodeReply(await response.json());
  } catch (error) {
    return { status: 'failed', reason: `Google Geocoding could not be reached (${error instanceof Error ? error.message : String(error)})` };
  }
}

export type EnsureHomeOptions = {
  /** Defaults to GOOGLE_API_KEY. */
  apiKey?: string | null;
  fetcher?: typeof fetch;
  now?: () => Date;
};

/**
 * Home's point for the person, geocoding the mailing address only when the
 * row has no point for it yet (none made, or the address changed since).
 * The client may be the person's own or a service-role one: every call names
 * the person. The write is guarded on the address it geocoded, so a save that
 * changed the address meanwhile is not overwritten with the old point.
 */
export async function ensureHomeLocation(
  client: YouSupabaseClient,
  userId: string,
  options: EnsureHomeOptions = {},
): Promise<HomeLocation> {
  const { data, error } = await client.from('details').select(HOME_COLUMNS).eq('user_id', userId).maybeSingle();
  if (error) return { status: 'failed', reason: `Reading your details failed: ${error.message}` };
  const row = data as HomeRow | null;
  const stored = storedHome(row);
  if (stored) return stored;

  const apiKey = options.apiKey === undefined ? mapsApiKey() : options.apiKey;
  if (!apiKey) return { status: 'not_set_up' };

  const address = row!.mailing_address!.trim();
  const outcome = await geocodeAddress(address, apiKey, options.fetcher);
  if (outcome.status === 'failed') return outcome;

  const point = outcome.status === 'ok' ? { home_lat: outcome.lat, home_lng: outcome.lng } : { home_lat: null, home_lng: null };
  const { error: writeError } = await client
    .from('details')
    .update({
      ...point,
      home_geocoded_address: address,
      home_geocoded_at: (options.now?.() ?? new Date()).toISOString(),
    })
    .eq('user_id', userId)
    .eq('mailing_address', row!.mailing_address!);
  if (writeError) return { status: 'failed', reason: `Saving home's point failed: ${writeError.message}` };

  return outcome.status === 'ok'
    ? { status: 'ok', lat: outcome.lat, lng: outcome.lng, address, geocoded: true }
    : { status: 'not_found', address };
}
