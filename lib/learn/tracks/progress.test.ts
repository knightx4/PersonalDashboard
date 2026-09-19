import { describe, expect, it } from 'vitest';
import { progressOf, type ReadingStatus } from './load';
import { rollUpAll } from './tree';

/**
 * What the bar on /learn means.
 *
 * The only interesting decision is where `abandoned` goes, and it goes in
 * neither half: a bar that fills when you give up is a lie, and one that stays
 * permanently short because of a paper you dropped in March is a nag. Both are
 * reasons to stop looking at the bar.
 */
describe('progressOf', () => {
  const of = (...statuses: ReadingStatus[]) => progressOf(statuses);

  it('is zero for an empty track', () => {
    expect(of()).toEqual({ read: 0, remaining: 0, abandoned: 0, fraction: 0 });
  });

  it('counts queued and reading as work remaining', () => {
    expect(of('queued', 'reading', 'read')).toMatchObject({ read: 1, remaining: 2 });
  });

  it('is complete when everything is read', () => {
    expect(of('read', 'read').fraction).toBe(1);
  });

  it('excludes abandoned from both halves', () => {
    // Four items, one read, one given up, two to go: two thirds remain of the
    // three that count.
    const progress = of('read', 'abandoned', 'queued', 'queued');
    expect(progress).toMatchObject({ read: 1, remaining: 2, abandoned: 1 });
    expect(progress.fraction).toBeCloseTo(1 / 3);
  });

  it('completes a track whose leftovers were all abandoned', () => {
    // Two read, three given up. The track is finished, and a bar stuck at 40%
    // forever would say otherwise.
    expect(of('read', 'read', 'abandoned', 'abandoned', 'abandoned').fraction).toBe(1);
  });

  it('is zero, not NaN, for a track of nothing but abandoned readings', () => {
    const progress = of('abandoned', 'abandoned');
    expect(progress.fraction).toBe(0);
    expect(Number.isNaN(progress.fraction)).toBe(false);
  });
});

describe('rollUp', () => {
  const track = (id: string, branchedFrom: string | null, read: number, remaining: number) => ({
    id,
    title: id,
    question: null,
    status: 'active' as const,
    createdAt: '2026-01-01T00:00:00Z',
    branchedFrom,
    progress: progressOf([
      ...Array.from({ length: read }, () => 'read' as const),
      ...Array.from({ length: remaining }, () => 'queued' as const),
    ]),
    matches: [],
  });

  it('counts the branches under a topic that has none of its own', () => {
    const rolled = rollUpAll([
      track('economics', null, 0, 0),
      track('trade', 'economics', 1, 2),
      track('money', 'economics', 0, 2),
    ]);
    expect(rolled.get('economics')).toMatchObject({ read: 1, remaining: 4 });
    expect(rolled.get('economics')?.fraction).toBeCloseTo(1 / 5);
  });

  it('counts a topic with readings of its own first, then its branches', () => {
    const rolled = rollUpAll([track('economics', null, 2, 1), track('trade', 'economics', 1, 1)]);
    expect(rolled.get('economics')).toMatchObject({ read: 3, remaining: 2 });
  });

  it('leaves a track with nothing under it exactly as it was', () => {
    const alone = track('alone', null, 1, 3);
    expect(rollUpAll([alone]).get('alone')).toEqual(alone.progress);
  });

  it('rolls up through more than one level', () => {
    const rolled = rollUpAll([
      track('economics', null, 0, 0),
      track('trade', 'economics', 0, 0),
      track('tariffs', 'trade', 2, 2),
    ]);
    expect(rolled.get('economics')).toMatchObject({ read: 2, remaining: 2 });
    expect(rolled.get('trade')).toMatchObject({ read: 2, remaining: 2 });
  });
});
