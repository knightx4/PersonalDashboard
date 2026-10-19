import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import { kindAndCeiling } from '@/lib/learn/evidence/kinds';

vi.mock('server-only', () => ({}));

const { loadIdeaMap, parseVector } = await import('./load');

type Row = Record<string, unknown>;

/**
 * A client that answers each table with the rows given, narrowed by the
 * filters the code puts on it (eq, neq, in, is) wherever a row has the column.
 */
function fakeClient(rows: Record<string, Row[]>): LearnSupabaseClient {
  const builder = (table: string) => {
    let kept = rows[table] ?? [];
    const narrow = (keep: (row: Row) => boolean) => {
      kept = kept.filter(keep);
    };
    const target: Record<string, unknown> = {
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: kept, error: null }),
      eq: (col: string, value: unknown) => (narrow((r) => r[col] === value), proxy),
      neq: (col: string, value: unknown) => (narrow((r) => r[col] !== value), proxy),
      in: (col: string, values: unknown[]) => (narrow((r) => values.includes(r[col])), proxy),
      is: (col: string, value: unknown) => (narrow((r) => (r[col] ?? null) === value), proxy),
      // Only `col.eq.true` and `col.not.is.null`, joined by commas, as listLenses writes them.
      or: (filter: string) => {
        const any = filter.split(',').map((part) => {
          const [col, ...rest] = part.split('.');
          const op = rest.join('.');
          if (op === 'eq.true') return (r: Row) => r[col] === true;
          if (op === 'not.is.null') return (r: Row) => (r[col] ?? null) !== null;
          throw new Error(`or(${part}) is not faked`);
        });
        narrow((r) => any.some((keep) => keep(r)));
        return proxy;
      },
      range: (from: number, to: number) => {
        kept = kept.slice(from, to + 1);
        return proxy;
      },
    };
    const proxy: object = new Proxy(target, {
      get(own, method: string) {
        if (method in own) return own[method];
        return () => proxy;
      },
    });
    return proxy;
  };
  return { from: (table: string) => builder(table) } as unknown as LearnSupabaseClient;
}

/** A unit vector of the stored width along one axis, leaning a little onto the next. */
function stored(axis: number, lean = 0): string {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[axis] = 1;
  vector[axis + 1] = lean;
  return JSON.stringify(vector);
}

const AT = '2026-10-01T00:00:00Z';
const topic = (id: string, name: string, embedding: string | null, article: string | null) => ({
  id,
  name,
  scope: `What ${name} covers.`,
  ceiling: 10,
  status: 'approved',
  refines_article_id: article,
  created_at: AT,
  scope_embedding: embedding,
});

const ROWS: Record<string, Row[]> = {
  lenses: [
    { id: 'L1', name: 'SaaS metrics', origin: 'subject', subject_id: 's1', aim_id: null, created_at: AT },
    { id: 'L2', name: 'Excel modelling', origin: 'subject', subject_id: 's2', aim_id: null, created_at: AT },
  ],
  lens_targets: [
    { lens_id: 'L1', topic_id: 't1', target_level: 5, created_at: AT },
    { lens_id: 'L1', topic_id: 't2', target_level: 3, created_at: AT },
    { lens_id: 'L2', topic_id: 't3', target_level: 4, created_at: AT },
    { lens_id: 'L2', topic_id: 't4', target_level: 4, created_at: AT },
  ],
  subjects: [
    { id: 's1', name: 'SaaS metrics', field_id: 'f1', domain_id: null, survey: false },
    { id: 's2', name: 'Excel modelling', field_id: null, domain_id: 'd2', survey: false },
  ],
  topics: [
    topic('t1', 'Churn maths', stored(0), 'a1'),
    topic('t2', 'Net retention', stored(0, 0.2), 'a2'),
    topic('t3', 'Named ranges', stored(10), null),
    topic('t4', 'Not yet embedded', null, null),
  ],
  topic_cells: [
    { id: 'c1-1', topic_id: 't1', level: 1 },
    { id: 'c1-2', topic_id: 't1', level: 2 },
    { id: 'c2-1', topic_id: 't2', level: 1 },
  ],
  cell_evidence: [{ cell_id: 'c1-2', verdict: 'met', observed_at: '2026-10-10T00:00:00Z', quote: 'Churn compounds monthly.' }],
  area_fields: [
    { id: 'f1', name: 'Finance', domain_id: 'd1', embedding: stored(0, 0.1) },
    { id: 'f2', name: 'Unembedded', domain_id: 'd2', embedding: null },
  ],
  area_domains: [
    { id: 'd1', name: 'Business' },
    { id: 'd2', name: 'Tools' },
  ],
  concepts: [
    { id: 'i1', name: 'Churn compounds' },
    { id: 'i2', name: 'Expansion offsets churn' },
  ],
  idea_topic_parents: [
    { concept_id: 'i1', topic_id: 'a1' },
    { concept_id: 'i2', topic_id: 'a9' },
  ],
};

const ON = new Date('2026-10-14T00:00:00Z');

describe('loadIdeaMap (plan #2317.2)', () => {
  it('draws each prepared topic as a star and no claims-graph idea', async () => {
    const view = await loadIdeaMap(fakeClient(ROWS), ON);
    expect(view.ideas.map((i) => i.id)).toEqual(['t1', 't2', 't3']);
    expect(view.missing).toBe(1);
    const [churn, , ranges] = view.ideas;
    expect(churn).toMatchObject({
      name: 'Churn maths',
      claim: 'What Churn maths covers.',
      track: { id: 's1', name: 'SaaS metrics' },
      field: { id: 'f1', name: 'Finance' },
      domain: { id: 'd1', name: 'Business' },
      placeId: 'L1',
      createdAt: AT,
    });
    expect(ranges).toMatchObject({ track: { id: 's2', name: 'Excel modelling' }, field: null, domain: { id: 'd2', name: 'Tools' } });
    expect(churn!.neighbours[0]!.id).toBe('t2');
    expect(view.areas.fields[0]).toMatchObject({ id: 'f1', ideaCount: 2 });
  });

  it('lights a topic from your answers, with the levels tested and held', async () => {
    const view = await loadIdeaMap(fakeClient(ROWS), ON);
    const churn = view.ideas.find((i) => i.id === 't1')!;
    expect(churn.levels).toEqual({ tested: 2, held: 2, ceiling: 10 });
    expect(churn.stateRow).toMatchObject({ established: 'tested', tested_at: '2026-10-10T00:00:00Z' });
    expect(churn.strength).toBeGreaterThan(0);
    const retention = view.ideas.find((i) => i.id === 't2')!;
    expect(retention.levels).toEqual({ tested: 0, held: 0, ceiling: 10 });
    expect(retention.strength).toBe(0);
  });

  it('rings a topic from the evidence on the Wikipedia topic it refines, never brightening it', async () => {
    const link = (id: string, weight: number) => ({
      id,
      target_kind: 'topic',
      target_id: 'a2',
      source_kind: 'note',
      source_id: id,
      similarity: 0.7,
      ...kindAndCeiling({ source_kind: 'note', weight }),
      basis: `you wrote about this in ${id}`,
      found_at: '2026-10-01T00:00:00Z',
      matched_by: 'similarity',
    });
    const view = await loadIdeaMap(fakeClient({ ...ROWS, evidence_links: [link('own', 1)] }), ON);
    const retention = view.ideas.find((i) => i.id === 't2')!;
    expect(retention.strength).toBe(0);
    expect(retention.exposure).toBeGreaterThan(0);
    expect(retention.evidence.map((e) => e.id)).toEqual(['own']);
    expect(view.ideas.find((i) => i.id === 't3')!.evidence).toEqual([]);
  });

  it('lists the ideas under the topic each attaches to', async () => {
    const view = await loadIdeaMap(fakeClient(ROWS), ON);
    expect(view.ideas.find((i) => i.id === 't1')!.ideasUnder).toEqual([{ id: 'i1', name: 'Churn compounds' }]);
    expect(view.ideas.find((i) => i.id === 't3')!.ideasUnder).toEqual([]);
  });

  it('makes each subject a place and a territory of its topics, with nothing next door', async () => {
    const view = await loadIdeaMap(fakeClient(ROWS), ON);
    expect(view.places.map((p) => [p.id, p.name, p.ideaCount])).toEqual([
      ['L1', 'SaaS metrics', 2],
      ['L2', 'Excel modelling', 1],
    ]);
    expect(view.dust).toEqual([]);
    const saas = view.territories!.find((t) => t.id === 'L1')!;
    expect(saas.topics.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect(saas.topics.every((t) => t.ideaIds.length === 0)).toBe(true);
    const churn = view.ideas.find((i) => i.id === 't1')!;
    expect(saas.topics.find((t) => t.id === 't1')!.neighbourMap).toEqual(churn.neighbourMap);
    expect(view.goals!.map((g) => g.id).sort()).toEqual(['L1', 'L2']);
  });

  it('draws an empty map when no subject is prepared', async () => {
    const view = await loadIdeaMap(fakeClient({}), ON);
    expect(view.ideas).toEqual([]);
    expect(view.places).toEqual([]);
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
