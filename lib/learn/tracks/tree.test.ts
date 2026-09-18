import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, nestTracks } from './tree';
import type { TrackSummary } from './load';

/**
 * The order the Learn page draws its rows in.
 *
 * The case worth the test is the orphan: a branch whose parent is not in the
 * list. Dropping it would lose a track somebody is halfway through, and the
 * list is the only way back to it.
 */

function track(id: string, branchedFrom: string | null = null): TrackSummary {
  return {
    id,
    title: id,
    question: null,
    status: 'active',
    createdAt: '2026-09-12T00:00:00Z',
    branchedFrom,
    progress: { read: 0, remaining: 0, abandoned: 0, fraction: 0 },
  };
}

const shape = (rows: ReturnType<typeof nestTracks>) =>
  rows.map((row) => [row.track.id, row.depth] as const);

describe('nestTracks', () => {
  it('puts a branch under the topic it came from', () => {
    const rows = nestTracks([track('economics'), track('prices', 'economics'), track('rome')]);

    expect(shape(rows)).toEqual([
      ['economics', 0],
      ['prices', 1],
      ['rome', 0],
    ]);
  });

  it('keeps the incoming order within a level', () => {
    const rows = nestTracks([
      track('economics'),
      track('trade', 'economics'),
      track('prices', 'economics'),
    ]);

    expect(shape(rows)).toEqual([
      ['economics', 0],
      ['trade', 1],
      ['prices', 1],
    ]);
  });

  it('follows a branch of a branch', () => {
    const rows = nestTracks([
      track('economics'),
      track('prices', 'economics'),
      track('auctions', 'prices'),
    ]);

    expect(shape(rows)).toEqual([
      ['economics', 0],
      ['prices', 1],
      ['auctions', 2],
    ]);
  });

  it('stops indenting past the deepest inset', () => {
    const chain = ['a', 'b', 'c', 'd', 'e', 'f'];
    const rows = nestTracks(chain.map((id, i) => track(id, i === 0 ? null : chain[i - 1])));

    expect(shape(rows).map(([, depth]) => depth)).toEqual([0, 1, 2, 3, MAX_DEPTH, MAX_DEPTH]);
  });

  it('leaves a branch whose parent is not in the list where it is', () => {
    const rows = nestTracks([track('prices', 'economics'), track('rome')]);

    expect(shape(rows)).toEqual([
      ['prices', 0],
      ['rome', 0],
    ]);
  });

  it('draws every track even if two point at each other', () => {
    const rows = nestTracks([track('one', 'two'), track('two', 'one')]);

    expect(rows.map((row) => row.track.id).sort()).toEqual(['one', 'two']);
  });
});
