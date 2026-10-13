import 'server-only';

import { readAll } from '@/lib/learn/db/read-all';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Reading the places on Idea Space (plan #1997.2), for the map and the place
 * view to draw.
 *
 * Through the person's session RLS narrows both reads to their own rows;
 * `userId` names the person on every read for a caller using the service
 * role. A place whose name has not been given yet (the naming call failed or
 * had no key) comes back with `name` null and is named on a later run.
 */

export type Place = {
  id: string;
  name: string | null;
  /** Its ideas, by concept id, sorted. */
  memberIds: string[];
};

export type Places = {
  /** Biggest first, then by name. */
  places: Place[];
  /** The place each grouped idea is in. An idea missing here is in none. */
  placeOf: Map<string, string>;
};

type PlaceRow = { id: string; name: string | null };
type MemberRow = { concept_id: string; place_id: string };

export async function loadPlaces(learn: LearnSupabaseClient, userId?: string): Promise<Places> {
  const own = (table: 'idea_places' | 'idea_place_members', columns: string, order: string) =>
    (from: number, to: number) => {
      let query = learn.from(table).select(columns);
      if (userId) query = query.eq('user_id', userId);
      return query.order(order).range(from, to);
    };
  const [rows, members] = await Promise.all([
    readAll<PlaceRow>(own('idea_places', 'id, name', 'id')),
    readAll<MemberRow>(own('idea_place_members', 'concept_id, place_id', 'concept_id')),
  ]);

  const memberIds = new Map<string, string[]>(rows.map((row) => [row.id, []]));
  const placeOf = new Map<string, string>();
  for (const member of members) {
    const list = memberIds.get(member.place_id);
    if (!list) continue;
    list.push(member.concept_id);
    placeOf.set(member.concept_id, member.place_id);
  }

  const places = rows
    .map((row) => ({ id: row.id, name: row.name, memberIds: (memberIds.get(row.id) ?? []).sort() }))
    .filter((place) => place.memberIds.length > 0)
    .sort((a, b) => b.memberIds.length - a.memberIds.length || (a.name ?? '').localeCompare(b.name ?? ''));
  return { places, placeOf };
}
