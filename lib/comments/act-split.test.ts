/**
 * The Yes on a "Split #N … into N steps?" raise (#1804): the pieces the
 * stalled run left are written as ready steps under the feature, in order,
 * stamped with that session, and the first is sent.
 */
import { describe, expect, it, vi } from 'vitest';
import { carryOut, type ActInput } from './act';
import { handStepToClaude } from '@/lib/plan/handover';
import { sessionOrigin } from '@/lib/plan/origin';
import { fakeDashDeps } from '../../tests/stubs/fake-schema-db';

vi.mock('@/lib/plan/handover', () => ({
  handStepToClaude: vi.fn(async () => ({
    ok: true,
    number: 1900,
    title: 'Read the runs',
    beneath: 0,
    detail: 'The routine is running.',
    changed: true,
  })),
  handFeatureToClaude: vi.fn(),
}));

type Filters = Record<string, unknown>;

/**
 * A client whose reads answer by table and whose inserts are recorded. Every
 * filter chains, and a read ends in `maybeSingle`, `limit` or being awaited.
 */
function db(options: {
  feature?: Record<string, unknown> | null;
  source?: string | null;
  runs?: Record<string, unknown>[];
  /** Steps already under the feature. */
  steps?: Record<string, unknown>[];
  /** Rows of the plan_item_outlines view. */
  outlines?: Record<string, unknown>[];
}) {
  const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
  const answer = (table: string, filters: Filters, single: boolean) => {
    if (table === 'raised_items') return { data: { source: options.source ?? null } };
    if (table === 'plan_runs') return { data: options.runs ?? [] };
    if (table === 'plan_item_outlines') return { data: options.outlines ?? [] };
    if (table === 'plan_items' && single) return { data: options.feature ?? null };
    if (table === 'plan_items' && 'kind' in filters) return { data: options.steps ?? [] };
    return { data: [] };
  };
  const supabase = {
    from(table: string) {
      return {
        select() {
          const filters: Filters = {};
          const chain: Record<string, unknown> = {};
          for (const name of ['eq', 'in', 'neq', 'is']) {
            chain[name] = (column: string, value: unknown) => {
              filters[column] = value;
              return chain;
            };
          }
          chain.order = () => chain;
          chain.limit = () => Promise.resolve(answer(table, filters, false));
          chain.maybeSingle = () => Promise.resolve(answer(table, filters, true));
          chain.then = (resolve: (value: unknown) => unknown) => resolve(answer(table, filters, false));
          return chain;
        },
        insert(rows: Record<string, unknown>[]) {
          inserts.push({ table, rows });
          return {
            select: () =>
              Promise.resolve({
                data: [...rows].reverse().map((row, index) => ({
                  id: `step-${row.position}`,
                  number: 1900 + (rows.length - 1 - index),
                  title: row.title,
                  position: row.position,
                })),
                error: null,
              }),
          };
        },
      };
    },
  };
  return { inserts, supabase: supabase as unknown as ActInput['supabase'] };
}

const FEATURE = { id: 'f1', number: 1172, title: 'Build the vault export', module: 'dev', parent_id: null };
const SOURCE = 'stalled f1 runs r2 r1';
const RUNS = [
  { id: 'r1', stop_pieces: null, external_id: 'cse_old' },
  { id: 'r2', stop_pieces: ['Read the runs', 'Write the raise', 'Hold on No'], external_id: 'cse_abc' },
];

function split(supabase: ActInput['supabase']) {
  return carryOut({
    supabase,
    userId: 'user-1',
    target: 'raise',
    id: 'raise-1',
    action: { name: 'split_feature', text: '#1172', module: null, field: null, detail: null, kind: null },
    dash: fakeDashDeps({}, 'user-1'),
  });
}

describe('splitting a stalled feature', () => {
  it('writes the pieces as ready steps in order, stamped, and sends the first', async () => {
    const { inserts, supabase } = db({ feature: FEATURE, source: SOURCE, runs: RUNS });
    const outcome = await split(supabase);

    const planRows = inserts.filter((one) => one.table === 'plan_items');
    expect(planRows).toHaveLength(1);
    const rows = planRows[0].rows;
    expect(rows.map((row) => row.title)).toEqual(['Read the runs', 'Write the raise', 'Hold on No']);
    expect(rows.map((row) => row.position)).toEqual([10, 20, 30]);
    for (const row of rows) {
      expect(row).toMatchObject({ parent_id: 'f1', module: 'dev', status: 'not_started', kind: 'build' });
      expect(sessionOrigin(row.comment as string)?.session).toBe('cse_abc');
    }
    expect(vi.mocked(handStepToClaude)).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'step-10' }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.said).toContain('Split #1172 Build the vault export into 3 steps');
    expect(outcome.ok && outcome.said).toContain('sent #1900 to be built');
  });

  it('names the new steps by their outlines in what it says', async () => {
    const outlines = [
      { number: 1172, outline: '1172' },
      { number: 1900, outline: '1172.1' },
      { number: 1901, outline: '1172.2' },
      { number: 1902, outline: '1172.3' },
    ];
    const { supabase } = db({ feature: FEATURE, source: SOURCE, runs: RUNS, outlines });
    const outcome = await split(supabase);
    expect(outcome.ok && outcome.said).toContain('sent #1172.1 to be built');
    expect(outcome.ok && outcome.said).toContain('#1172.1 Read the runs\n#1172.2 Write the raise\n#1172.3 Hold on No');
  });

  it('keeps the steps and says so when the first could not be sent', async () => {
    vi.mocked(handStepToClaude).mockResolvedValueOnce({ ok: false, error: 'A session is on #1172.' });
    const { inserts, supabase } = db({ feature: FEATURE, source: SOURCE, runs: RUNS });
    const outcome = await split(supabase);
    expect(inserts.filter((one) => one.table === 'plan_items')).toHaveLength(1);
    expect(outcome.ok && outcome.said).toContain('did not start the first');
  });

  it('does not split a feature that has steps of its own now', async () => {
    const { inserts, supabase } = db({ feature: FEATURE, source: SOURCE, runs: RUNS, steps: [{ id: 's1' }] });
    const outcome = await split(supabase);
    expect(inserts).toHaveLength(0);
    expect(outcome.ok === false && outcome.why).toContain('has steps of its own');
  });

  it('writes nothing when the runs left no pieces', async () => {
    const { inserts, supabase } = db({
      feature: FEATURE,
      source: SOURCE,
      runs: [{ id: 'r2', stop_pieces: null, external_id: null }],
    });
    const outcome = await split(supabase);
    expect(inserts).toHaveLength(0);
    expect(outcome.ok === false && outcome.why).toContain('left no pieces');
  });

  it('writes nothing for a row that is not a feature', async () => {
    const { inserts, supabase } = db({ feature: { ...FEATURE, parent_id: 'p1' }, source: SOURCE, runs: RUNS });
    const outcome = await split(supabase);
    expect(inserts).toHaveLength(0);
    expect(outcome.ok).toBe(false);
  });
});
