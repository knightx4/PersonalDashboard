import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * An archived subject gets no background work (plan #2355.4): the hourly
 * sweeps and the preparation never choose it, and restoring it makes it
 * eligible again on the next run.
 */

type Row = Record<string, unknown>;

/** Enough of PostgREST's builder to run the reads these sweeps make against rows in memory. */
function memoryLearn(tables: Record<string, Row[]>): LearnSupabaseClient {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let limit = Infinity;
    const result = () => {
      const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      return { data: rows.slice(0, limit), error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      neq: (column: string, value: unknown) => (filters.push((row) => row[column] !== value), builder),
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), builder),
      not: (column: string, op: string, value: unknown) => {
        if (op !== 'is' || value !== null) throw new Error(`not(${column}, ${op}) is not faked`);
        filters.push((row) => (row[column] ?? null) !== null);
        return builder;
      },
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      lt: (column: string, value: number) => (filters.push((row) => (row[column] as number) < value), builder),
      // Only the lease filter uses it here, and no row in these tests holds a lease.
      or: () => builder,
      order: () => builder,
      limit: (n: number) => ((limit = n), builder),
      range: (start: number, end: number) => {
        const { data } = result();
        return Promise.resolve({ data: data.slice(start, end + 1), error: null });
      },
      maybeSingle: () => {
        const { data } = result();
        return Promise.resolve({ data: data[0] ?? null, error: null });
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  };
  return { from } as unknown as LearnSupabaseClient;
}

const USER = 'user-1';
const ARCHIVED_AT = '2026-10-18T09:00:00Z';

let tables: Record<string, Row[]>;

beforeEach(() => {
  tables = {
    subjects: [
      { id: 'live', user_id: USER, name: 'Urban economics', survey: false, archived_at: null, placed_at: null, placement_moved_by_hand: false, placement_attempts: 0 },
      { id: 'shelved', user_id: USER, name: 'Welsh', survey: false, archived_at: ARCHIVED_AT, placed_at: null, placement_moved_by_hand: false, placement_attempts: 0 },
    ],
    subject_preparations: [
      { subject_id: 'live', user_id: USER, branch_key: null, status: 'pending', failures: 0, lease_until: null },
      { subject_id: 'shelved', user_id: USER, branch_key: null, status: 'pending', failures: 0, lease_until: null },
    ],
  };
});

function restore(id: string) {
  const subject = tables.subjects.find((row) => row.id === id)!;
  subject.archived_at = null;
}

const learnClient = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/inngest/learn/supabase-admin', () => ({ createLearnServiceSupabase: () => learnClient.current }));

describe('the hourly placement sweep', () => {
  it('never chooses an archived subject, and chooses it again once restored', async () => {
    const { pendingSubjects } = await import('@/inngest/learn/subject-placement');
    const learn = memoryLearn(tables);
    expect((await pendingSubjects(learn)).map((row) => row.id)).toEqual(['live']);
    restore('shelved');
    expect((await pendingSubjects(learn)).map((row) => row.id)).toEqual(['live', 'shelved']);
  });
});

describe('the daily preparation resume', () => {
  it('leaves an archived subject’s unfinished run where it is until the subject is restored', async () => {
    const { unfinishedPreparations } = await import('@/lib/learn/prepare/store');
    const learn = memoryLearn(tables);
    const ids = async () => (await unfinishedPreparations(learn, USER, new Date(), 5)).map((run) => run.subjectId);
    expect(await ids()).toEqual(['live']);
    restore('shelved');
    expect(await ids()).toEqual(['live', 'shelved']);
  });
});

describe('a preparation slice', () => {
  it('does not start for an archived subject', async () => {
    learnClient.current = memoryLearn(tables);
    const { pumpPreparation } = await import('@/inngest/learn/prepare');
    expect(await pumpPreparation({ subjectId: 'shelved', origin: 'http://localhost' })).toEqual({ outcome: 'archived' });
  });
});

describe('the clip scoring fingerprint', () => {
  it('changes when a subject is archived or restored, as it does when a track is added', async () => {
    const { profileFingerprint, fingerprintOf } = await import('@/lib/learn/clips/score-run');
    tables.items = [];
    const learn = memoryLearn(tables);
    (learn as unknown as { schema: () => LearnSupabaseClient }).schema = () => learn;
    expect(await profileFingerprint(learn, USER)).toBe(fingerprintOf(['live'], []));
    restore('shelved');
    expect(await profileFingerprint(learn, USER)).toBe(fingerprintOf(['live', 'shelved'], []));
  });
});

describe('the channels waiting to be judged', () => {
  it('names the archived subjects among any account’s, so their channels wait', async () => {
    const { archivedAmong } = await import('@/lib/learn/archived-subjects');
    const learn = memoryLearn(tables);
    expect([...(await archivedAmong(learn, ['live', 'shelved', 'shelved']))]).toEqual(['shelved']);
    restore('shelved');
    expect([...(await archivedAmong(learn, ['live', 'shelved']))]).toEqual([]);
  });
});
