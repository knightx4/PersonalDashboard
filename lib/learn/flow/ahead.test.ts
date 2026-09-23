import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * A flow focused on one track takes only that track's questions off the
 * queue (plan #779). The queue is one table for every track, so this is the
 * rule that keeps a focused flow from asking about something else.
 */

vi.mock('@/lib/learn/graph/load', () => ({
  loadConcept: vi.fn(async (_supabase: unknown, id: string) => ({
    id,
    name: `claim ${id}`,
    state: 'unknown',
  })),
  loadSubjects: vi.fn(async () => [
    { id: TRACK_A, name: 'Economics' },
    { id: TRACK_B, name: 'Music' },
  ]),
  loadReadyAndSettled: vi.fn(),
}));

const TRACK_A = '00000000-0000-4000-8000-00000000000a';
const TRACK_B = '00000000-0000-4000-8000-00000000000b';
/** A hidden survey subject (plan #840), which `loadSubjects` leaves out. */
const SURVEY = '00000000-0000-4000-8000-00000000000c';

const { putBack, takeWaiting } = await import('./ahead');

type Row = {
  id: string;
  concept_id: string;
  question: string;
  options: string[];
  picked_state: string;
  picked_recheck: null;
  shown_at: string | null;
};

function row(id: string, conceptId: string, shownAt: string | null = null): Row {
  return {
    id,
    concept_id: conceptId,
    question: `question ${id}`,
    options: ['a', 'b', 'c', 'd'],
    picked_state: 'unknown',
    picked_recheck: null,
    shown_at: shownAt,
  };
}

/**
 * Just enough of the client for the queue: every chained call returns the
 * same builder, and awaiting it answers by table and by whether it was an
 * update. Updates to `shown_at` are recorded so the test can see what was taken.
 */
function fakeClient(queue: Row[], homes: Record<string, string>) {
  const tables: Record<string, unknown[]> = {
    subjects: [{ id: SURVEY, name: 'Stoicism', theme_id: 'theme-stoicism' }],
    theme_fields: [{ theme_id: 'theme-stoicism', field_id: 'field-phil' }],
    area_fields: [{ id: 'field-phil', name: 'Philosophy' }],
  };
  const taken: string[] = [];
  const client = {
    from(table: string) {
      let update: Record<string, unknown> | null = null;
      let eqId: string | null = null;
      const builder = {
        select: () => builder,
        not: () => builder,
        is: () => builder,
        order: () => builder,
        in: () => builder,
        eq: (_column: string, value: string) => {
          eqId = value;
          return builder;
        },
        update: (values: Record<string, unknown>) => {
          update = values;
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          if (table in tables) {
            resolve({ data: tables[table], error: null });
          } else if (table === 'concepts') {
            resolve({
              data: Object.entries(homes).map(([id, subject_id]) => ({ id, subject_id })),
              error: null,
            });
          } else if (update && 'shown_at' in update) {
            if (eqId) taken.push(eqId);
            resolve({ data: [{ id: eqId }], error: null });
          } else if (update) {
            resolve({ error: null });
          } else {
            resolve({ data: queue, error: null });
          }
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as LearnSupabaseClient, taken };
}

describe('takeWaiting with a track', () => {
  const homes = { c1: TRACK_B, c2: TRACK_A, c3: TRACK_B };

  beforeEach(() => vi.clearAllMocks());

  it('takes the oldest waiting question in any track when mixed', async () => {
    const { client, taken } = fakeClient([row('p1', 'c1'), row('p2', 'c2')], homes);
    const question = await takeWaiting(client, { resume: false, track: null });
    expect(question?.probeId).toBe('p1');
    expect(taken).toEqual(['p1']);
  });

  it('skips questions from other tracks when focused', async () => {
    const { client, taken } = fakeClient([row('p1', 'c1'), row('p2', 'c2')], homes);
    const question = await takeWaiting(client, { resume: false, track: TRACK_A });
    expect(question?.probeId).toBe('p2');
    expect(question?.subjectName).toBe('Economics');
    expect(taken).toEqual(['p2']);
  });

  it('finds nothing when only other tracks have questions waiting', async () => {
    const { client, taken } = fakeClient([row('p1', 'c1'), row('p3', 'c3')], homes);
    expect(await takeWaiting(client, { resume: false, track: TRACK_A })).toBeNull();
    expect(taken).toEqual([]);
  });

  it('does not resume a question on screen from another track', async () => {
    const onScreen = row('p1', 'c1', new Date().toISOString());
    const { client } = fakeClient([onScreen, row('p2', 'c2')], homes);

    expect((await takeWaiting(client, { resume: true, track: null }))?.probeId).toBe('p1');
    expect((await takeWaiting(client, { resume: true, track: TRACK_A }))?.probeId).toBe('p2');
  });
});

/**
 * Plan #842: with no filter the queue's survey questions are asked, named by
 * the vault subject and its field. Tracks only and a focused track leave them
 * waiting.
 */
describe('takeWaiting with survey questions', () => {
  const homes = { c1: SURVEY, c2: TRACK_A };

  it('takes a survey question with no filter, naming its subject and field', async () => {
    const { client, taken } = fakeClient([row('p1', 'c1'), row('p2', 'c2')], homes);
    const question = await takeWaiting(client, { resume: false, track: null });
    expect(taken).toEqual(['p1']);
    expect(question?.subjectName).toBe('Stoicism');
    expect(question?.survey).toEqual({ themeName: 'Stoicism', fieldName: 'Philosophy' });
  });

  it('leaves survey questions waiting for Tracks only', async () => {
    const { client, taken } = fakeClient([row('p1', 'c1'), row('p2', 'c2')], homes);
    const question = await takeWaiting(client, { resume: false, track: null, tracksOnly: true });
    expect(taken).toEqual(['p2']);
    expect(question?.survey).toBeUndefined();
  });

  it('leaves survey questions waiting when focused on a track', async () => {
    const { client, taken } = fakeClient([row('p1', 'c1')], homes);
    expect(await takeWaiting(client, { resume: false, track: TRACK_A })).toBeNull();
    expect(await takeWaiting(client, { resume: false, track: SURVEY })).toBeNull();
    expect(taken).toEqual([]);
  });

  it('does not resume a survey question on screen for Tracks only', async () => {
    const onScreen = row('p1', 'c1', new Date().toISOString());
    const { client } = fakeClient([onScreen, row('p2', 'c2')], homes);
    expect(
      (await takeWaiting(client, { resume: true, track: null, tracksOnly: true }))?.probeId,
    ).toBe('p2');
  });
});

/**
 * Note 7ccc6f99: Not now puts the question back, unshown and at the end of the
 * queue, and only while it is unanswered.
 */
describe('putBack', () => {
  it('unshows the question, dates it now, and leaves an answered one alone', async () => {
    const calls: { update?: Record<string, unknown>; eq?: [string, string]; is: string[] } = {
      is: [],
    };
    const builder = {
      update: (values: Record<string, unknown>) => ((calls.update = values), builder),
      eq: (column: string, value: string) => ((calls.eq = [column, value]), builder),
      not: () => builder,
      is: (column: string) => (calls.is.push(column), builder),
      then: (resolve: (value: unknown) => void) => resolve({ error: null }),
    };
    const client = { from: () => builder } as unknown as LearnSupabaseClient;

    const before = Date.now();
    await putBack(client, 'p1');

    expect(calls.eq).toEqual(['id', 'p1']);
    expect(calls.update?.shown_at).toBeNull();
    expect(new Date(String(calls.update?.created_at)).getTime()).toBeGreaterThanOrEqual(before);
    expect(calls.is).toContain('answered_at');
  });
});

