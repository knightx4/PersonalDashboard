import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';

vi.mock('server-only', () => ({}));

const { loadIdeaMap, parseVector } = await import('./load');

type Call = { table: string; method: string; args: unknown[] };

/** A client that answers each table with the rows given and keeps each call made on it. */
function fakeClient(rows: Record<string, unknown[]>): { client: LearnSupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const result = { data: rows[table] ?? [], error: null };
    const target: Record<string, unknown> = {
      then: (resolve: (value: typeof result) => unknown) => resolve(result),
    };
    const proxy: object = new Proxy(target, {
      get(own, method: string) {
        if (method in own) return own[method];
        return (...args: unknown[]) => {
          calls.push({ table, method, args });
          return proxy;
        };
      },
    });
    return proxy;
  };
  const client = { from: (table: string) => builder(table) } as unknown as LearnSupabaseClient;
  return { client, calls };
}

/** A unit vector of the stored width along one axis, leaning a little onto the next. */
function stored(axis: number, lean = 0): string {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[axis] = 1;
  vector[axis + 1] = lean;
  return JSON.stringify(vector);
}

const USER = '00000000-0000-4000-8000-000000000001';

const ROWS = {
  concepts: [
    { id: 'i1', name: 'Churn', claim: 'Churn compounds.', subject_id: 's1', embedding: stored(0) },
    { id: 'i2', name: 'Net retention', claim: 'Expansion offsets churn.', subject_id: 's1', embedding: stored(0, 0.2) },
    { id: 'i3', name: 'Named ranges', claim: 'Names make formulas readable.', subject_id: 's2', embedding: stored(10) },
    { id: 'i4', name: 'Not yet embedded', claim: 'Waiting for the fill.', subject_id: 's2', embedding: null },
    { id: 'i5', name: 'Wrong width', claim: 'An old vector.', subject_id: null, embedding: '[1,2,3]' },
  ],
  concept_state: [{ concept_id: 'i1', state: 'known' }],
  subjects: [
    { id: 's1', name: 'SaaS metrics', field_id: 'f1', domain_id: null },
    { id: 's2', name: 'Excel modelling', field_id: null, domain_id: 'd2' },
  ],
  area_fields: [
    { id: 'f1', name: 'Finance', domain_id: 'd1', embedding: stored(0, 0.1) },
    { id: 'f2', name: 'Unembedded', domain_id: 'd2', embedding: null },
  ],
  area_domains: [
    { id: 'd1', name: 'Business' },
    { id: 'd2', name: 'Tools' },
  ],
};

describe('loadIdeaMap', () => {
  it('maps every embedded idea with its state, track, field and domain', async () => {
    const { client } = fakeClient(ROWS);
    const view = await loadIdeaMap(client);

    expect(view.ideas.map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    expect(view.missing).toBe(2);
    expect(view.areas.fields.map((f) => f.id)).toEqual(['f1']);
    expect(view.areas.fieldsMissing).toBe(1);
    expect(view.areas.fields[0]).toMatchObject({ name: 'Finance', ideaCount: 2 });
    expect(view.areas.domains.map((d) => d.id)).toEqual(['d1']);

    const [churn, retention, ranges] = view.ideas;
    expect(churn).toMatchObject({
      name: 'Churn',
      claim: 'Churn compounds.',
      state: 'known',
      track: { id: 's1', name: 'SaaS metrics' },
      field: { id: 'f1', name: 'Finance' },
      domain: { id: 'd1', name: 'Business' },
    });
    expect(retention!.state).toBe('unknown');
    expect(ranges).toMatchObject({ track: { id: 's2', name: 'Excel modelling' }, field: null, domain: { id: 'd2', name: 'Tools' } });

    expect(churn!.neighbours[0]!.id).toBe('i2');
    expect(churn!.neighbours[0]!.similarity).toBeCloseTo(1 / Math.sqrt(1.04), 9);
    expect(typeof view.variance.first).toBe('number');
  });

  it("names the person on every read of their own rows when given a user id", async () => {
    const { client, calls } = fakeClient(ROWS);
    await loadIdeaMap(client, USER);
    const narrowed = new Set(
      calls.filter((c) => c.method === 'eq' && c.args[0] === 'user_id' && c.args[1] === USER).map((c) => c.table),
    );
    expect(narrowed).toEqual(new Set(['concepts', 'concept_state', 'subjects']));
  });

  it('draws an empty map when nothing is embedded', async () => {
    const { client } = fakeClient({});
    const view = await loadIdeaMap(client);
    expect(view.ideas).toEqual([]);
    expect(view.missing).toBe(0);
  });
});

describe('parseVector', () => {
  it('reads the text PostgREST returns and refuses anything not the stored width', () => {
    expect(parseVector(stored(3))).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(parseVector(null)).toBeNull();
    expect(parseVector('[1,2,3]')).toBeNull();
    expect(parseVector('not a vector')).toBeNull();
    expect(parseVector(JSON.parse(stored(1)) as number[])).toHaveLength(EMBEDDING_DIMENSIONS);
  });
});
