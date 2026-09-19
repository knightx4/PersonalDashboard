import { describe, expect, it } from 'vitest';
import type { Concept, KnowledgeState } from '@/lib/learn/graph/model';
import type { ReadyConcept } from '@/lib/learn/graph/ready';
import type { SettledConcept } from '@/lib/learn/graph/recheck';
import {
  PUSHED_ASIDE_DAYS,
  pushedAsideNote,
  rankNext,
  rankQueuedReadings,
  readingReason,
  readyReason,
  recheckReason,
  RECORD_WINDOW_DAYS,
  type NextRecord,
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
const other = { id: 'subject-2', name: 'Tides' };

/** A date that many days before NOW, for a record written by hand. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function concept(
  id: string,
  state: KnowledgeState = 'unknown',
  testedAt: string | null = null,
  declaredAt: string | null = null,
): Concept {
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
    established: declaredAt !== null ? 'declared' : testedAt === null ? 'inferred' : 'tested',
    misconception: null,
    testedAt,
    declaredAt,
  };
}

function ready(id: string, stepsToGoal: number | null, where = subject): ReadyConcept {
  return { concept: concept(id), subjectId: where.id, subjectName: where.name, stepsToGoal };
}

function settled(id: string, testedAt: string, where = subject): SettledConcept {
  return {
    concept: concept(id, 'known', testedAt),
    subjectId: where.id,
    subjectName: where.name,
    established: 'tested',
    settledAt: testedAt,
  };
}

/** A claim you said you already knew, on the day you said it. */
function waved(id: string, declaredAt: string, where = subject): SettledConcept {
  return {
    concept: concept(id, 'known', null, declaredAt),
    subjectId: where.id,
    subjectName: where.name,
    established: 'declared',
    settledAt: declaredAt,
  };
}

function queued(
  id: string,
  queuedAt: string,
  conceptName = 'refraction',
  where = subject,
): QueuedReading {
  return {
    id,
    title: `A paper called ${id}`,
    conceptId: conceptName,
    conceptName,
    subjectId: where.id,
    subjectName: where.name,
    queuedAt,
  };
}

/** A question answered, which is one of the two ways of finishing something. */
function answered(where: { id: string }, days: number): NextRecord {
  return {
    outcome: 'answered',
    conceptId: `answered-${days}`,
    readingId: null,
    subjectId: where.id,
    happenedAt: daysAgo(days),
  };
}

/** A reading marked read, which is the other. */
function read(where: { id: string }, days: number): NextRecord {
  return {
    outcome: 'read',
    conceptId: `read-about-${days}`,
    readingId: `read-${days}`,
    subjectId: where.id,
    happenedAt: daysAgo(days),
  };
}

function pushedAside(
  target: { conceptId?: string; readingId?: string },
  days: number,
): NextRecord {
  return {
    outcome: 'not_now',
    conceptId: target.conceptId ?? null,
    readingId: target.readingId ?? null,
    subjectId: subject.id,
    happenedAt: daysAgo(days),
  };
}

const empty = { ready: [], settled: [], readings: [], record: [] };
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

  it('mixes a claim you waved through in with the ones you answered about', () => {
    const rows = rankNext(
      {
        ...empty,
        settled: [
          settled('answered', '2026-06-01T12:00:00Z'),
          waved('waved-long-ago', '2025-01-01T12:00:00Z'),
          waved('waved-in-august', '2026-08-01T12:00:00Z'),
        ],
      },
      NOW,
    );
    expect(keys(rows)).toEqual([
      'recheck:waved-long-ago',
      'recheck:answered',
      'recheck:waved-in-august',
    ]);
  });

  it('leaves out a claim you waved through this week', () => {
    const rows = rankNext({ ...empty, settled: [waved('tuesday', '2026-09-10T12:00:00Z')] }, NOW);
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
    record: [],
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

describe('what you have done moves the order', () => {
  // One claim in each of two subjects, the same distance from a goal and in
  // the same state, so with nothing recorded the tie falls to the name and
  // Optics comes first. Everything below changes the record and nothing else.
  const twoSubjects = {
    ...empty,
    ready: [ready('optics-claim', 2), ready('tides-claim', 2, other)],
  };

  it('returns two orders for one graph and two records', () => {
    const quiet = keys(rankNext(twoSubjects, NOW));
    const workingOnTides = keys(
      rankNext({ ...twoSubjects, record: [answered(other, 2), read(other, 5)] }, NOW),
    );

    expect(quiet).toEqual(['ready:optics-claim', 'ready:tides-claim']);
    // tides-claim moved to the top: two things finished in Tides in the last
    // week, and nothing in Optics.
    expect(workingOnTides).toEqual(['ready:tides-claim', 'ready:optics-claim']);
  });

  it('counts a reading read as getting through a subject, like a question answered', () => {
    const rows = rankNext({ ...twoSubjects, record: [read(other, 3)] }, NOW);
    expect(keys(rows)[0]).toBe('ready:tides-claim');
  });

  it('weighs a subject by how much was finished in it, not by which came last', () => {
    const rows = rankNext(
      { ...twoSubjects, record: [answered(other, 30), answered(subject, 1), answered(subject, 2)] },
      NOW,
    );
    expect(keys(rows)[0]).toBe('ready:optics-claim');
  });

  it('forgets what was finished before the window', () => {
    const rows = rankNext(
      { ...twoSubjects, record: [answered(other, RECORD_WINDOW_DAYS + 1)] },
      NOW,
    );
    expect(keys(rows)).toEqual(['ready:optics-claim', 'ready:tides-claim']);
  });
});

describe('a row you pushed aside', () => {
  const twoClaims = { ...empty, ready: [ready('a-claim', 1), ready('b-claim', 2)] };

  it('sinks below the rest of its kind while the few weeks last', () => {
    const rows = rankNext(
      { ...twoClaims, record: [pushedAside({ conceptId: 'a-claim' }, 3)] },
      NOW,
    );
    expect(keys(rows)).toEqual(['ready:b-claim', 'ready:a-claim']);
  });

  it('comes back in its own order once they are up', () => {
    const rows = rankNext(
      { ...twoClaims, record: [pushedAside({ conceptId: 'a-claim' }, PUSHED_ASIDE_DAYS + 1)] },
      NOW,
    );
    expect(keys(rows)).toEqual(['ready:a-claim', 'ready:b-claim']);
  });

  it('says on the row that you pushed it aside', () => {
    const [row] = rankNext(
      { ...empty, ready: [ready('a-claim', 1)], record: [pushedAside({ conceptId: 'a-claim' }, 4)] },
      NOW,
    );
    expect(row.reason).toBe(`${readyReason(1)} ${pushedAsideNote(4)}`);
    expect(pushedAsideNote(4)).toBe('You pushed this aside 4 days ago.');
    expect(pushedAsideNote(0)).toBe('You pushed this aside today.');
  });

  it('holds down the reading it was pressed on and no other', () => {
    const rows = rankNext(
      {
        ...empty,
        readings: [queued('old', '2026-02-01T12:00:00Z'), queued('new', '2026-08-01T12:00:00Z')],
        record: [pushedAside({ readingId: 'old' }, 1)],
      },
      NOW,
    );
    expect(keys(rows)).toEqual(['reading:new', 'reading:old']);
  });

  it('counts the most recent time you pushed it aside', () => {
    const rows = rankNext(
      {
        ...twoClaims,
        record: [
          pushedAside({ conceptId: 'a-claim' }, PUSHED_ASIDE_DAYS + 10),
          pushedAside({ conceptId: 'a-claim' }, 2),
        ],
      },
      NOW,
    );
    expect(keys(rows)).toEqual(['ready:b-claim', 'ready:a-claim']);
  });

  it('holds a settled claim down the same way', () => {
    const rows = rankNext(
      {
        ...empty,
        settled: [
          settled('older', '2025-01-01T12:00:00Z'),
          settled('newer', '2025-06-01T12:00:00Z'),
        ],
        record: [pushedAside({ conceptId: 'older' }, 5)],
      },
      NOW,
    );
    expect(keys(rows)).toEqual(['recheck:newer', 'recheck:older']);
  });
});
