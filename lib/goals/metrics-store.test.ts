import { describe, expect, it } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { addMetric, archiveMetric, loadMetricCounts, loadMetrics, updateMetric } from '@/lib/goals/metrics-store';

type Call = { table: string; op: string; args: unknown[] };
type Answer = {
  data: unknown;
  error: null | { code?: string; message: string; details?: string };
  /** What single() resolves to, when it differs from the list the query resolves to. */
  single?: Answer;
};

/** A query that records every call made on it and resolves to the answer given for its table. */
function fakeClient(answers: Record<string, Answer>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const result = answers[table] ?? { data: null, error: null };
      const query: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'update', 'eq', 'is', 'in', 'order']) {
        query[op] = (...args: unknown[]) => {
          calls.push({ table, op, args });
          return query;
        };
      }
      query.single = async () => result.single ?? result;
      query.maybeSingle = async () => result;
      query.then = (resolve: (value: Answer) => unknown) => resolve(result);
      return query;
    },
  } as unknown as GoalsSupabaseClient;
  return { client, calls };
}

const row = {
  id: 'm1',
  goal_id: 'g1',
  name: 'Applications',
  source: 'list',
  collection_id: 'c1',
  date_field: 'applied',
  period: 'week',
  target: 5,
  position: 0,
};

const input = { name: ' Applications ', source: 'list' as const, collectionId: 'c1', dateField: 'applied', period: 'week' as const, target: 5 };

describe('loadMetrics', () => {
  it('reads the live metrics on the goal, in order', async () => {
    const { client, calls } = fakeClient({ metrics: { data: [row], error: null } });
    const metrics = await loadMetrics(client, 'g1');
    expect(metrics).toEqual([
      { id: 'm1', goalId: 'g1', name: 'Applications', source: 'list', collectionId: 'c1', dateField: 'applied', period: 'week', target: 5, position: 0 },
    ]);
    expect(calls).toContainEqual({ table: 'metrics', op: 'eq', args: ['goal_id', 'g1'] });
    expect(calls).toContainEqual({ table: 'metrics', op: 'is', args: ['archived_at', null] });
  });
});

describe('addMetric', () => {
  it('writes the metric trimmed, after the goal’s other metrics', async () => {
    const { client, calls } = fakeClient({
      metrics: { data: [row], error: null, single: { data: { id: 'm2' }, error: null } },
    });
    const result = await addMetric(client, 'u1', 'g1', input);
    expect(result).toEqual({ ok: true, value: 'm2' });
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.args[0]).toEqual({
      user_id: 'u1',
      goal_id: 'g1',
      position: 1,
      name: 'Applications',
      source: 'list',
      collection_id: 'c1',
      date_field: 'applied',
      period: 'week',
      target: 5,
    });
  });

  it('writes a steps or files metric with no list and no date', async () => {
    for (const source of ['steps', 'files'] as const) {
      const { client, calls } = fakeClient({
        metrics: { data: [], error: null, single: { data: { id: 'm3' }, error: null } },
      });
      // A list left over from the form is not sent with it.
      const result = await addMetric(client, 'u1', 'g1', { ...input, source, collectionId: 'c1', dateField: 'applied' });
      expect(result).toEqual({ ok: true, value: 'm3' });
      expect(calls.find((c) => c.op === 'insert')?.args[0]).toMatchObject({
        source,
        collection_id: null,
        date_field: null,
      });
    }
  });

  it('refuses a bad metric without sending it', async () => {
    const { client, calls } = fakeClient({});
    const result = await addMetric(client, 'u1', 'g1', { ...input, name: '' });
    expect(result).toMatchObject({ ok: false, field: 'name' });
    expect(calls).toHaveLength(0);
  });

  it('puts the database’s refusal of the date field next to that field', async () => {
    const { client } = fakeClient({
      metrics: {
        data: [],
        error: null,
        single: {
          data: null,
          error: { code: '23514', message: 'metrics: Company is not a date, so records cannot be counted by it', details: 'date_field' },
        },
      },
    });
    const result = await addMetric(client, 'u1', 'g1', input);
    expect(result).toEqual({
      ok: false,
      field: 'dateField',
      error: 'Company is not a date, so records cannot be counted by it',
    });
  });
});

describe('updateMetric and archiveMetric', () => {
  it('changes a live metric and says when it is gone', async () => {
    const live = fakeClient({ metrics: { data: [{ id: 'm1' }], error: null } });
    expect(await updateMetric(live.client, 'm1', input)).toEqual({ ok: true, value: 'm1' });
    const gone = fakeClient({ metrics: { data: [], error: null } });
    expect(await updateMetric(gone.client, 'm1', input)).toMatchObject({ ok: false, error: 'That metric is gone.' });
  });

  it('archives rather than deletes', async () => {
    const { client, calls } = fakeClient({ metrics: { data: [{ id: 'm1' }], error: null } });
    expect(await archiveMetric(client, 'm1')).toBe(true);
    const update = calls.find((c) => c.op === 'update');
    expect(update?.args[0]).toHaveProperty('archived_at');
  });
});

describe('loadMetrics for each kind', () => {
  it('reads back a steps and a files metric with no list', async () => {
    const steps = { ...row, id: 'm2', source: 'steps', collection_id: null, date_field: null, position: 1 };
    const files = { ...row, id: 'm3', source: 'files', collection_id: null, date_field: null, position: 2 };
    const { client } = fakeClient({ metrics: { data: [row, steps, files], error: null } });
    const metrics = await loadMetrics(client, 'g1');
    expect(metrics.map((m) => [m.source, m.collectionId, m.dateField])).toEqual([
      ['list', 'c1', 'applied'],
      ['steps', null, null],
      ['files', null, null],
    ]);
  });

  it('gives a steps or files metric no counts and reads no list for it', async () => {
    const steps = { ...row, id: 'm2', source: 'steps', collection_id: null, date_field: null };
    const { client, calls } = fakeClient({ metrics: { data: [steps], error: null } });
    const [metric] = await loadMetricCounts(client, { id: 'g1', createdAt: null }, 'UTC');
    expect(metric).toMatchObject({ source: 'steps', counts: [] });
    expect(calls.some((c) => c.table === 'records')).toBe(false);
  });
});

describe('loadMetricCounts', () => {
  it('counts each metric from its list’s live records', async () => {
    const { client } = fakeClient({
      metrics: { data: [row], error: null },
      records: {
        data: [
          { id: 'r1', collection_id: 'c1', data: { applied: '2026-10-13' }, draft: false },
          { id: 'r2', collection_id: 'c1', data: { applied: '2026-10-14' }, draft: true },
        ],
        error: null,
      },
    });
    const [metric] = await loadMetricCounts(
      client,
      { id: 'g1', createdAt: '2026-10-06T09:00:00Z' },
      'UTC',
      new Date('2026-10-15T12:00:00Z'),
    );
    expect(metric.counts.map((p) => [p.startsOn, p.count])).toEqual([
      ['2026-10-05', 0],
      ['2026-10-12', 1],
    ]);
  });
});
