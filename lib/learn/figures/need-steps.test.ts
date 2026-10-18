import { describe, expect, it } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { sessionOrigin } from '@/lib/plan/origin';
import { fileFigureNeedSteps, needStepRow, needStepSize, shouldFile, type NeedGroup } from './need-steps';

const group = (over: Partial<NeedGroup> = {}): NeedGroup => ({
  key: 'k1',
  need: 'data_source',
  shows: 'The share of Londoners within 30 minutes of the City, 1863 to 2023.',
  why: 'The pace of the change is the point',
  caption: 'How commuting reach grew with the Underground.',
  asked: 2,
  cardIds: ['c1', 'c2'],
  subjectIds: ['s1'],
  ...over,
});

describe('which needs are filed (plan #2321.10)', () => {
  it('files a need two lessons asked for', () => {
    expect(shouldFile(group(), new Set())).toBe(true);
  });

  it('waits on one ask, unless its subject has a goal', () => {
    expect(shouldFile(group({ asked: 1 }), new Set())).toBe(false);
    expect(shouldFile(group({ asked: 1 }), new Set(['s1']))).toBe(true);
  });

  it('sizes a data source or a figure kind s, a model or a map layer m', () => {
    expect(needStepSize('data_source')).toBe('s');
    expect(needStepSize('figure_kind')).toBe('s');
    expect(needStepSize('model')).toBe('m');
    expect(needStepSize('map_layer')).toBe('m');
  });
});

describe('the step Dash writes', () => {
  const lessons = [
    { cardId: 'c1', name: 'Railways made suburbs', subject: 'Urban economics' },
    { cardId: 'c2', name: 'Reach and rents', subject: 'Urban economics' },
  ];

  it('says what will be true, carries the contract and names the lessons waiting', () => {
    const row = needStepRow(group(), lessons);
    expect(row.title).toBe('Lessons can show the share of Londoners within 30 minutes of the City, 1863 to 2023');
    expect(row.detail.split('\n\n')[0]).toMatch(/^2 lessons asked for a figure the app cannot draw yet/);
    expect(row.detail).toContain('DATA_SOURCES in lib/learn/figures/sources.ts');
    expect(row.detail).toContain('app/preview/surfaces.tsx');
    expect(row.detail).toContain('k1');
    expect(row.acceptance).toContain('“Railways made suburbs” in Urban economics and “Reach and rents” in Urban economics');
    expect(row.size).toBe('s');
    expect(row.detail).not.toContain('—');
  });

  it('keeps an acronym at the start and clips a long title', () => {
    expect(needStepRow(group({ shows: 'GDP per head by year' }), []).title).toBe('Lessons can show GDP per head by year');
    expect(needStepRow(group({ shows: 'A '.repeat(200) }), []).title.length).toBeLessThanOrEqual(140);
  });

  it('says why one ask was enough', () => {
    const row = needStepRow(group({ asked: 1, need: 'model' }), lessons.slice(0, 1), ['Urban economics']);
    expect(row.detail).toMatch(/^A lesson in Urban economics, a subject with a goal on it, asked/);
    expect(row.detail).toContain('EXPLORABLE_MODELS');
    expect(row.size).toBe('m');
  });
});

/** A PostgREST stand-in over in-memory tables, enough for the filer's reads and writes. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  let nextNumber = 9000;
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let mode: 'select' | 'insert' | 'update' = 'select';
      let payload: Record<string, unknown> | null = null;
      let limit: number | null = null;
      let desc: string | null = null;
      const run = () => {
        if (mode === 'insert') {
          const row: Record<string, unknown> = { id: `id-${nextNumber}`, number: nextNumber++, ...payload };
          if (table === 'figure_need_steps' && rows.some((r) => r.key === row.key && r.user_id === row.user_id)) {
            return { data: null, error: { message: 'duplicate key' } };
          }
          rows.push(row);
          return { data: [row], error: null };
        }
        let found = rows.filter((row) => filters.every((f) => f(row)));
        if (mode === 'update') {
          found.forEach((row) => Object.assign(row, payload));
          return { data: found, error: null };
        }
        if (desc) found = [...found].sort((a, b) => Number(b[desc as string]) - Number(a[desc as string]));
        if (limit !== null) found = found.slice(0, limit);
        return { data: found, error: null };
      };
      const query = {
        select: () => query,
        insert: (value: Record<string, unknown>) => ((mode = 'insert'), (payload = value), query),
        update: (value: Record<string, unknown>) => ((mode = 'update'), (payload = value), query),
        eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), query),
        neq: (col: string, v: unknown) => (filters.push((r) => r[col] !== v), query),
        is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), query),
        not: (col: string) => (filters.push((r) => r[col] != null), query),
        in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), query),
        order: (col: string, opts?: { ascending?: boolean }) => ((desc = opts?.ascending === false ? col : null), query),
        limit: (n: number) => ((limit = n), query),
        single: async () => {
          const { data, error } = run();
          return { data: data?.[0] ?? null, error };
        },
        maybeSingle: async () => {
          const { data, error } = run();
          return { data: data?.[0] ?? null, error };
        },
        then: (resolve: (value: unknown) => void) => resolve(run()),
      };
      return query;
    },
  };
  return client;
}

describe('filing from the daily cron', () => {
  const user = 'u1';

  function world(asked: number) {
    const plan = {
      plan_items: [{ id: 'f', user_id: user, number: 2321, module: 'learn', status: 'not_started', parent_id: null, dismissed_at: null, position: 10 }],
    };
    const learn = {
      figure_need_groups: [
        {
          user_id: user,
          key: 'k1',
          need: 'data_source',
          shows: 'Reach by year',
          why: 'Pace',
          caption: 'Reach.',
          asked,
          card_ids: ['c1', 'c2'].slice(0, asked),
          subject_ids: ['s1'],
          plan_item_id: null,
          first_asked_at: '2026-10-17',
        },
      ],
      feed_cards: [
        { id: 'c1', user_id: user, idea_name: 'Railways made suburbs', track_name: 'Urban economics', subject_id: 's1' },
        { id: 'c2', user_id: user, idea_name: 'Reach and rents', track_name: 'Urban economics', subject_id: 's1' },
      ],
      aims: [] as Record<string, unknown>[],
      figure_need_steps: [] as Record<string, unknown>[],
    };
    return { plan, learn, planDb: fakeDb(plan), learnDb: fakeDb(learn) };
  }

  it('writes one ready step under the feature, stamped as Dash, and links it', async () => {
    const w = world(2);
    const result = await fileFigureNeedSteps({
      learn: w.learnDb as unknown as LearnSupabaseClient,
      plan: w.planDb as never,
      now: new Date('2026-10-18T06:00:00Z'),
    });
    expect(result.users[0].filed).toHaveLength(1);
    const step = w.plan.plan_items[1] as Record<string, unknown>;
    expect(step).toMatchObject({ parent_id: 'f', status: 'not_started', kind: 'build', size: 's', position: 10 });
    expect(sessionOrigin(step.comment as string)).toEqual({ session: null, date: '2026-10-18' });
    expect(step.acceptance).toContain('Railways made suburbs');
    expect(w.learn.figure_need_steps).toEqual([expect.objectContaining({ key: 'k1', plan_item_id: step.id, asked: 2 })]);
  });

  it('files nothing for a need asked once, in a subject with no goal', async () => {
    const w = world(1);
    const result = await fileFigureNeedSteps({ learn: w.learnDb as unknown as LearnSupabaseClient, plan: w.planDb as never });
    expect(result.users[0]).toMatchObject({ filed: [], waiting: 1 });
    expect(w.plan.plan_items).toHaveLength(1);
  });

  it('files a single ask in a subject with a goal on it', async () => {
    const w = world(1);
    w.learn.aims.push({ user_id: user, subject_id: 's1', archived_at: null, list_source: null });
    const result = await fileFigureNeedSteps({ learn: w.learnDb as unknown as LearnSupabaseClient, plan: w.planDb as never });
    expect(result.users[0].filed).toHaveLength(1);
  });

  it('writes a proposal under a feature still proposed', async () => {
    const w = world(2);
    (w.plan.plan_items[0] as Record<string, unknown>).status = 'proposed';
    await fileFigureNeedSteps({ learn: w.learnDb as unknown as LearnSupabaseClient, plan: w.planDb as never });
    expect((w.plan.plan_items[1] as Record<string, unknown>).status).toBe('proposed');
  });

  it('drops its own step when the need was linked first, so there is never a second', async () => {
    const w = world(2);
    w.learn.figure_need_steps.push({ user_id: user, key: 'k1', plan_item_id: 'other', asked: 2 });
    const result = await fileFigureNeedSteps({ learn: w.learnDb as unknown as LearnSupabaseClient, plan: w.planDb as never });
    expect(result.users[0].error).toMatch(/Linking/);
    expect((w.plan.plan_items[1] as Record<string, unknown>).status).toBe('dropped');
  });
});
