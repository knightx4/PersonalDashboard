/**
 * The union behind a search of the tracks list.
 *
 * A search finds tracks by their own title or question, and it finds readings
 * inside them by the words written down when they were queued or by the title
 * of the source they were resolved to. Both sets are tracks to draw, and the
 * readings that matched are listed under the track holding them.
 *
 * De-duplication is the whole reason this is a function rather than a few
 * lines in the loader. A track matched by its own title and by two of its
 * readings has to appear once, and a reading matched both by its own words and
 * by its source's title has to be listed once under it.
 */

export type MatchedReading = {
  id: string;
  /** What the reading is called: its source's title, or the words you typed. */
  subject: string;
};

/** A matched reading before it has been filed under its track. */
export type TrackReadingMatch = MatchedReading & { trackId: string };

export type WithMatches<T> = T & { matches: MatchedReading[] };

/**
 * Tracks, once each, newest first, each carrying the readings it matched on.
 *
 * `tracks` is every track either half of the search found, in any order and
 * with repeats; the first copy of a track is the one kept. A match whose track
 * is not in the list is dropped rather than drawn on its own, since a reading
 * outside every track on the page has nothing to sit under.
 */
export function mergeTrackMatches<T extends { id: string; createdAt: string }>(
  tracks: T[],
  matches: TrackReadingMatch[],
): WithMatches<T>[] {
  const byTrack = new Map<string, MatchedReading[]>();
  const seenReading = new Set<string>();

  for (const match of matches) {
    if (seenReading.has(match.id)) continue;
    seenReading.add(match.id);

    const reading: MatchedReading = { id: match.id, subject: match.subject };
    const listed = byTrack.get(match.trackId);
    if (listed) listed.push(reading);
    else byTrack.set(match.trackId, [reading]);
  }

  const seenTrack = new Set<string>();
  const merged: WithMatches<T>[] = [];

  for (const track of tracks) {
    if (seenTrack.has(track.id)) continue;
    seenTrack.add(track.id);
    merged.push({ ...track, matches: byTrack.get(track.id) ?? [] });
  }

  // Newest first is what the tracks query asks for, and it has to be put back
  // over the union: the tracks reached through a reading are a second query
  // with its own ordering.
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return merged;
}
