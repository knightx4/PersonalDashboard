import type { IdeaMapView } from './load';
import { ideaGraph, type Opened } from './place-graph';

/**
 * The scripted tour of Idea Space (plan #1997.9): replay the map's growth up
 * to today, fly into the place you know best, hop next door, pull back out.
 * The route is worked out from the view alone, with ties broken by id, so the
 * same ideas give the same tour on every run.
 */

type TourView = Pick<IdeaMapView, 'ideas' | 'places'>;

export type TourScript = {
  /** Where the camera goes after the replay, in order; empty when the map has nothing to open. */
  stops: Opened[];
};

/**
 * The place whose ideas have the highest mean strength, the one with more
 * ideas winning a tie. With no named place, the strongest idea's
 * neighbourhood stands in for it.
 */
export function brightestStop(view: TourView): Opened | null {
  const sum = new Map<string, { total: number; count: number }>();
  for (const idea of view.ideas) {
    if (!idea.placeId) continue;
    const entry = sum.get(idea.placeId) ?? { total: 0, count: 0 };
    entry.total += idea.strength;
    entry.count += 1;
    sum.set(idea.placeId, entry);
  }
  let best: { id: string; mean: number; count: number } | null = null;
  for (const place of view.places) {
    const entry = sum.get(place.id);
    if (!entry) continue;
    const mean = entry.total / entry.count;
    if (
      !best ||
      mean > best.mean ||
      (mean === best.mean &&
        (entry.count > best.count || (entry.count === best.count && place.id < best.id)))
    )
      best = { id: place.id, mean, count: entry.count };
  }
  if (best) return { kind: 'place', id: best.id };

  let idea: { id: string; strength: number } | null = null;
  for (const other of view.ideas) {
    if (
      !idea ||
      other.strength > idea.strength ||
      (other.strength === idea.strength && other.id < idea.id)
    )
      idea = other;
  }
  return idea ? { kind: 'around', id: idea.id } : null;
}

/** The place or neighbourhood next door to `from` that the most links lead into. */
export function nextDoorStop(view: TourView, from: Opened): Opened | null {
  const graph = ideaGraph(view.ideas, view.places, from);
  if (!graph) return null;
  const doors = new Map<string, { to: Opened; count: number }>();
  for (const id of graph.next) {
    const door = graph.doors.get(id);
    if (!door) continue;
    if (door.opened.kind === from.kind && door.opened.id === from.id) continue;
    const key = `${door.opened.kind}:${door.opened.id}`;
    const entry = doors.get(key) ?? { to: door.opened, count: 0 };
    entry.count += 1;
    doors.set(key, entry);
  }
  const ordered = [...doors.entries()].sort(
    (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]),
  );
  return ordered[0]?.[1].to ?? null;
}

export function tourScript(view: TourView): TourScript {
  const first = brightestStop(view);
  if (!first) return { stops: [] };
  const second = nextDoorStop(view, first);
  return { stops: second ? [first, second] : [first] };
}

/** How long each part of the tour stays, in milliseconds. */
export const TOUR_DWELL_MS = { afterReplay: 900, perStop: 5500, afterPullOut: 400 } as const;
