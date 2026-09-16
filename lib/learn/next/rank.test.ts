import { describe, expect, it } from 'vitest';
import type { Concept, KnowledgeState } from '@/lib/learn/graph/model';
import type { ReadyConcept } from '@/lib/learn/graph/ready';
import type { SettledConcept } from '@/lib/learn/graph/recheck';
import {
  rankNext,
  rankQueuedReadings,
  readingReason,
  readyReason,
  recheckReason,
  type NextRow,
  type QueuedReading,
} from './rank';

/**
 * What Learn next offers when the frontier is not the only thing it holds.
 *
 * The two orderings underneath are tested in ready.test.ts and
 * recheck.test.ts; what is tested here is the interleave, the reason on each
 * row, and the account that holds nothing.
 */

const NOW = new Date('2026-09-15T12:00:00Z');
const subject = { id: 'subject-1', name: 'Optics' };

function concept(id: string, state: KnowledgeState = 'unknown', testedAt: string | null = null): Concept {
  return {
    id,
    name: id,
    claim: `${id} is the case, for a reason.`,
    claimOriginal: null,
    claimRewrittenAt: null,
    basis: 'Written by hand for this test.',
    kind: null,
    mastery: [],
    state,
    established: testedAt === null ? 'inferred' : 'tested',
    misconception: null,
    testedAt,
  };
}

function ready(id: string, stepsToGoal: number | null): ReadyConcept {
  return { concept: concept(id), subjectId: subject.id, subjectName: subject.name, stepsToGoal };
}

function settled(id: string, testedAt: string): SettledConcept {
  return {
    concept: concept(id, 'known', testedAt),
    subjectId: subject.id,
    subjectName: subject.name,
    testedAt,
  };
}

function queued(id: string, queuedAt: string, conceptName = 'refraction'): QueuedReading {
  return {
    id,
    title: `A paper called ${id}`,
    conceptId: conceptName,
    conceptName,
    subjectId: subject.id,
    subjectName: subject.name,
    queuedAt,
  };
}

const empty = { ready: [], settled: [], readings: [] };
const keys = (rows: NextRow[]) => rows.map((row) => row.key);

describe('one kind at a time', () => {
  it('returns the ready claims when they are all there is', () => {
    const rows = rankNext({ ...empty, ready: [ready('far', 3), ready('near', 1)] }, NOW);
    expect(keys(rows)).toEqual(['ready:near', 'ready:far']);
    expect(rows.every((row) => row.kind === 'ready')).toBe(true);
  });

  it('returns re-checks when no claim is ready', () => {
    const rows = rankNext(
      {
        ...empty,
        settled: [settled('recent', '2026-06-01T12:00:00Z'), settled('ancient', '2025-01-01T12:00:00Z')],
      },
      NOW,
    );
    expect(keys(rows)).toEqual(['recheck:ancient', 'recheck:recent']);
  });

  it('leaves out a claim settled too recently to ask about again', () => {
    const rows = rankNext({ ...empty, settled: [settled('tuesday', '2026-09-10T12:00:00Z')] }, NOW);
    expect(rows).toEqual([]);
  });

  it('returns queued readings when nothing else is waiting', () => {
    const rows = rankNext(
      { ...empty, readings: [queued('new', '2026-09-01T12:00:00Z'), queued('old', '2026-02-01T12:00:00Z')] },
      NOW,
    );
    expect(keys(rows)).toEqual(['reading:old', 'reading:new']);
  });
});

describe('the three kinds together', () => {
  const mixed = {
    ready: [ready('r1', 1), ready('r2', 2), ready('r3', 3)],
    settled: [settled('s1', '2025-01-01T12:00:00Z'), settled('s2', '2025-06-01T12:00:00Z')],
    readings: [queued('q1', '2026-01-01T12:00:00Z')],
  };

  it('takes one of each kind in turn', () => {
    expect(keys(rankNext(mixed, NOW))).toEqual([
      'ready:r1',
      'recheck:s1',
      'reading:q1',
      'ready:r2',
      'recheck:s2',
      'ready:r3',
    ]);
  });

  it('keeps each kind in its own order', () => {
    const rows = rankNext(mixed, NOW);
    expect(rows.filter((row) => row.kind === 'ready').map((row) => row.key)).toEqual([
      'ready:r1',
      'ready:r2',
      'ready:r3',
    ]);
    expect(rows.filter((row) => row.kind === 'recheck').map((row) => row.key)).toEqual([
      'recheck:s1',
      'recheck:s2',
    ]);
  });

  it('cuts to the limit, and the cut keeps the top of each kind', () => {
    const rows = rankNext(mixed, NOW, 3);
    expect(keys(rows)).toEqual(['ready:r1', 'recheck:s1', 'reading:q1']);
  });

  it('puts a kind and a reason on every row', () => {
    for (const row of rankNext(mixed, NOW)) {
      expect(['ready', 'recheck', 'reading']).toContain(row.kind);
      expect(row.reason.length).toBeGreaterThan(0);
      expect(row.href.startsWith('/learn/')).toBe(true);
    }
  });
});

describe('an account with nothing in it', () => {
  it('returns an empty list rather than throwing', () => {
    expect(rankNext(empty, NOW)).toEqual([]);
  });
});

describe('what each row says about itself', () => {
  it('counts the steps to a goal, and says so plainly when there is none', () => {
    expect(readyReason(0)).toBe('A goal you named, and nothing is missing underneath it.');
    expect(readyReason(1)).toBe('One step from a goal you named.');
    expect(readyReason(4)).toBe('4 steps from a goal you named.');
    expect(readyReason(null)).toBe('Nothing is missing underneath it.');
  });

  it('says how long a settled claim has gone unchecked', () => {
    expect(recheckReason('2026-08-01T12:00:00Z', NOW)).toBe(
      'Answered 45 days ago and not asked about since.',
    );
    expect(recheckReason('2026-01-01T12:00:00Z', NOW)).toBe(
      'Answered 8 months ago and not asked about since.',
    );
    expect(recheckReason('2022-09-15T12:00:00Z', NOW)).toBe(
      'Answered 4 years ago and not asked about since.',
    );
  });

  it('names the claim a queued reading was meant to close', () => {
    expect(readingReason('refraction')).toBe('Queued about refraction, and never opened.');
  });
});

describe('the queue order', () => {
  it('breaks a tie on the title and then the id', () => {
    const same = '2026-03-01T12:00:00Z';
    const rows = rankQueuedReadings([queued('b', same), queued('a', same)]);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });
});
