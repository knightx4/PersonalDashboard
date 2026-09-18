import type { TrackProgress, TrackSummary } from './load';

/**
 * The tracks in reading order, with branches under what they came from.
 *
 * Keeping an area of a broad topic, or going deeper on one step of a route,
 * makes a track that remembers the one it came out of. Drawn as a flat list
 * those read as unrelated topics: ten rows where there are three subjects and
 * seven parts of them.
 *
 * The incoming order is kept for the top-level rows and for each set of
 * children, so "newest first" still holds within a level. A track whose parent
 * is not in the list -- filtered out, or deleted between the two queries --
 * stays where it is rather than disappearing, which is the failure that would
 * matter here.
 */

export type NestedTrack = {
  track: TrackSummary;
  depth: number;
  /**
   * Progress over this track and everything branched out of it.
   *
   * A broad topic usually has no readings of its own: you keep two areas out
   * of it and read those, and the topic sits at 0/0 looking untouched while
   * you work through it. The roll-up is what the list draws, so economics
   * reads as a fifth done rather than as empty. Identical to the track's own
   * progress when nothing is under it.
   */
  rolled: TrackProgress;
};

/** Add one track's readings to a running total. */
function add(into: TrackProgress, more: TrackProgress): TrackProgress {
  const read = into.read + more.read;
  const remaining = into.remaining + more.remaining;
  const counted = read + remaining;
  return {
    read,
    remaining,
    abandoned: into.abandoned + more.abandoned,
    fraction: counted === 0 ? 0 : read / counted,
  };
}

/** As deep as the indent goes. Below this a branch is drawn at the same inset. */
export const MAX_DEPTH = 3;

export function nestTracks(tracks: TrackSummary[]): NestedTrack[] {
  const byId = new Map(tracks.map((track) => [track.id, track]));

  const children = new Map<string, TrackSummary[]>();
  const roots: TrackSummary[] = [];

  for (const track of tracks) {
    const parentId = track.branchedFrom;
    if (parentId && byId.has(parentId)) {
      const siblings = children.get(parentId);
      if (siblings) siblings.push(track);
      else children.set(parentId, [track]);
    } else {
      roots.push(track);
    }
  }

  const nested: NestedTrack[] = [];
  // A track cannot be its own parent -- the database says so -- but a longer
  // cycle would still be a page that never renders, so the walk refuses to
  // visit a row twice.
  const seen = new Set<string>();

  const walk = (track: TrackSummary, depth: number) => {
    if (seen.has(track.id)) return;
    seen.add(track.id);
    nested.push({ track, depth: Math.min(depth, MAX_DEPTH), rolled: rollUp(track, children) });
    for (const child of children.get(track.id) ?? []) walk(child, depth + 1);
  };

  for (const root of roots) walk(root, 0);

  // Anything a cycle kept out of the walk still belongs on the page.
  for (const track of tracks) {
    if (!seen.has(track.id)) {
      nested.push({ track, depth: 0, rolled: rollUp(track, children) });
    }
  }

  return nested;
}

/**
 * One track's readings plus every branch beneath it.
 *
 * Its own readings are counted first, so a topic you are reading yourself and
 * have also branched shows both. The walk refuses to visit a track twice, for
 * the same reason the nesting does.
 */
export function rollUp(
  track: TrackSummary,
  children: ReadonlyMap<string, TrackSummary[]>,
  seen: Set<string> = new Set(),
): TrackProgress {
  if (seen.has(track.id)) {
    return { read: 0, remaining: 0, abandoned: 0, fraction: 0 };
  }
  seen.add(track.id);

  let total = track.progress;
  for (const child of children.get(track.id) ?? []) {
    total = add(total, rollUp(child, children, seen));
  }
  return total;
}

/** The roll-up for every track, keyed by id. For a page holding one track. */
export function rollUpAll(tracks: TrackSummary[]): Map<string, TrackProgress> {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const children = new Map<string, TrackSummary[]>();
  for (const track of tracks) {
    const parentId = track.branchedFrom;
    if (!parentId || !byId.has(parentId)) continue;
    const siblings = children.get(parentId);
    if (siblings) siblings.push(track);
    else children.set(parentId, [track]);
  }
  return new Map(tracks.map((track) => [track.id, rollUp(track, children)]));
}
