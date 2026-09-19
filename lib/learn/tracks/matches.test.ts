import { describe, expect, it } from 'vitest';
import { mergeTrackMatches, type TrackReadingMatch } from './matches';

/**
 * Unioning the two halves of a search of the tracks list.
 *
 * Every case here is a duplicate of some kind, which is what the merge exists
 * for: the same track reached twice, and the same reading matched twice.
 */

const track = (id: string, createdAt: string) => ({ id, createdAt });

const reading = (id: string, trackId: string, subject: string): TrackReadingMatch => ({
  id,
  trackId,
  subject,
});

describe('mergeTrackMatches', () => {
  it('lists a matching reading under the track holding it', () => {
    const merged = mergeTrackMatches(
      [track('economics', '2026-09-12T00:00:00Z')],
      [reading('r1', 'economics', 'The Use of Knowledge in Society')],
    );

    expect(merged).toEqual([
      {
        id: 'economics',
        createdAt: '2026-09-12T00:00:00Z',
        matches: [{ id: 'r1', subject: 'The Use of Knowledge in Society' }],
      },
    ]);
  });

  it('keeps a track that matched both ways once', () => {
    const merged = mergeTrackMatches(
      [
        // Found by its own title, and again as the track a matching reading
        // sits in.
        track('economics', '2026-09-12T00:00:00Z'),
        track('economics', '2026-09-12T00:00:00Z'),
      ],
      [reading('r1', 'economics', 'Prices'), reading('r2', 'economics', 'Money')],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].matches.map((m) => m.id)).toEqual(['r1', 'r2']);
  });

  it('lists a reading matched by both its own words and its source once', () => {
    const merged = mergeTrackMatches(
      [track('economics', '2026-09-12T00:00:00Z')],
      [reading('r1', 'economics', 'Prices'), reading('r1', 'economics', 'Prices')],
    );

    expect(merged[0].matches).toEqual([{ id: 'r1', subject: 'Prices' }]);
  });

  it('gives a track the search found on its own no readings', () => {
    const merged = mergeTrackMatches([track('rome', '2026-09-12T00:00:00Z')], []);

    expect(merged[0].matches).toEqual([]);
  });

  it('puts the union back in newest-first order', () => {
    const merged = mergeTrackMatches(
      [
        track('older', '2026-01-01T00:00:00Z'),
        track('newest', '2026-09-12T00:00:00Z'),
        track('middle', '2026-05-05T00:00:00Z'),
      ],
      [],
    );

    expect(merged.map((row) => row.id)).toEqual(['newest', 'middle', 'older']);
  });

  it('drops a match whose track is not in the list', () => {
    const merged = mergeTrackMatches(
      [track('economics', '2026-09-12T00:00:00Z')],
      [reading('r9', 'gone', 'A track RLS did not return')],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].matches).toEqual([]);
  });
});
