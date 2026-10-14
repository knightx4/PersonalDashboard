/**
 * Carrying places over from one day's clustering to the next (plan #1997.2).
 *
 * The places are worked out again every day, and most of them come back with
 * the same ideas or nearly so. A place that comes back keeps its id and its
 * name, so the map's landmarks do not move or change their names under the
 * person from one day to the next. Its name is written again only once its
 * ideas have changed by more than a third since the name was given.
 *
 * Pure: it takes the places stored and the clustering just made, and says
 * what to keep, what to name, what to add and what to remove.
 */

/** A place as stored. */
export type StoredPlace = {
  id: string;
  name: string | null;
  /** Its ideas when the name was given; empty while it has no name. */
  namedMembers: readonly string[];
  /** Its ideas as of the last run. */
  members: readonly string[];
};

/** How far a place's ideas can drift from those it was named for and keep the name. */
export const RENAME_CHANGE = 1 / 3;

export type PlaceUpdate = {
  id: string;
  members: string[];
  /** True when the name is missing or the ideas have drifted past RENAME_CHANGE. */
  needsName: boolean;
};

export type Reconciled = {
  /** Stored places that came back, with their new ideas. */
  kept: PlaceUpdate[];
  /** New places, each to be added and named. */
  added: string[][];
  /** Stored places with nothing to match, to be removed. */
  removed: string[];
};

/**
 * How much two sets of ideas differ: the ideas in one and not the other, over
 * the ideas in either. 0 is the same ideas, 1 none in common.
 */
export function membershipChange(before: readonly string[], after: readonly string[]): number {
  const a = new Set(before);
  const b = new Set(after);
  let shared = 0;
  for (const id of b) if (a.has(id)) shared++;
  const either = a.size + b.size - shared;
  return either === 0 ? 0 : 1 - shared / either;
}

/**
 * Match each new place to the stored place it shares the most ideas with,
 * largest overlaps first, each stored place matched at most once. A stored
 * place that shares nothing with any new one is removed, and a new place with no
 * match is added.
 */
export function reconcilePlaces(stored: readonly StoredPlace[], fresh: readonly (readonly string[])[]): Reconciled {
  const storedOf = new Map<string, number>();
  stored.forEach((place, s) => {
    for (const id of place.members) storedOf.set(id, s);
  });

  const pairs: { s: number; f: number; overlap: number }[] = [];
  fresh.forEach((members, f) => {
    const counts = new Map<number, number>();
    for (const id of members) {
      const s = storedOf.get(id);
      if (s !== undefined) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    for (const [s, overlap] of counts) pairs.push({ s, f, overlap });
  });
  pairs.sort(
    (p, q) =>
      q.overlap - p.overlap ||
      (stored[p.s]!.id < stored[q.s]!.id ? -1 : stored[p.s]!.id > stored[q.s]!.id ? 1 : 0) ||
      p.f - q.f,
  );

  const matchedStored = new Set<number>();
  const matchOf = new Map<number, number>();
  for (const { s, f } of pairs) {
    if (matchedStored.has(s) || matchOf.has(f)) continue;
    matchedStored.add(s);
    matchOf.set(f, s);
  }

  const kept: PlaceUpdate[] = [];
  const added: string[][] = [];
  fresh.forEach((members, f) => {
    const s = matchOf.get(f);
    if (s === undefined) {
      added.push([...members]);
      return;
    }
    const place = stored[s]!;
    const needsName =
      !place.name || place.namedMembers.length === 0 || membershipChange(place.namedMembers, members) > RENAME_CHANGE;
    kept.push({ id: place.id, members: [...members], needsName });
  });
  const removed = stored.filter((_, s) => !matchedStored.has(s)).map((place) => place.id);
  return { kept, added, removed };
}
