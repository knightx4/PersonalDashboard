import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { positionForSave } from './place-position';
import { PLACE_COLUMNS, placeFromRow, sortPlaces, type Place, type PlaceRow, type PlaceWrite } from './places';

/**
 * Reading and writing you.places (plan #1991.5). Every call names the person
 * as well as relying on row level security, so the same functions serve a
 * service-role client. Adding a place, or changing its city, region or
 * country, also writes its map position from the bundled city list
 * (plan #2091.3, lib/you/place-position.ts).
 */

/** Their places, newest first, with the homes they live in now at the top. */
export async function listPlaces(client: YouSupabaseClient, userId: string): Promise<Place[]> {
  const { data, error } = await client.from('places').select(PLACE_COLUMNS).eq('user_id', userId);
  if (error) throw new Error(`Reading your places failed: ${error.message}`);
  return sortPlaces(((data ?? []) as PlaceRow[]).map(placeFromRow));
}

export async function getPlace(client: YouSupabaseClient, userId: string, id: string): Promise<Place | null> {
  const { data, error } = await client
    .from('places')
    .select(PLACE_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the place failed: ${error.message}`);
  return data ? placeFromRow(data as PlaceRow) : null;
}

export async function insertPlace(
  client: YouSupabaseClient,
  userId: string,
  row: PlaceWrite,
): Promise<Record<string, unknown>> {
  const { data, error } = await client
    .from('places')
    .insert({ ...row, ...positionForSave(null, row), user_id: userId })
    .select('*')
    .single();
  if (error || !data) throw new Error(`Adding the place failed: ${error?.message ?? 'no row'}`);
  return data as Record<string, unknown>;
}

export async function updatePlace(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  patch: Partial<PlaceWrite>,
): Promise<Record<string, unknown> | null> {
  let position = {};
  if ('city' in patch || 'region' in patch || 'country' in patch) {
    // The map position follows the city (plan #2091.3), so read what it was.
    const { data: before, error: readError } = await client
      .from('places')
      .select('city, region, country, latitude, longitude')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (readError) throw new Error(`Reading the place failed: ${readError.message}`);
    if (!before) return null;
    const was = before as Pick<PlaceRow, 'city' | 'region' | 'country' | 'latitude' | 'longitude'>;
    position = positionForSave(was, { ...was, ...patch });
  }
  const { data, error } = await client
    .from('places')
    .update({ ...patch, ...position })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Changing the place failed: ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
}

/** Removes one of their places. False when there was none of theirs with that id. */
export async function deletePlace(client: YouSupabaseClient, userId: string, id: string): Promise<boolean> {
  const { data, error } = await client
    .from('places')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');
  if (error) throw new Error(`Removing the place failed: ${error.message}`);
  return (data ?? []).length > 0;
}
