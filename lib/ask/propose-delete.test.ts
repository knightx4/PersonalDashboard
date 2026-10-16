import { describe, expect, it } from 'vitest';
import type { DashChange, NewDashChange } from '@/lib/talk/changes';
import type { SchemaClient } from './db';
import { executeProposal, type ProposeContext } from './propose';

/**
 * propose_delete (plan #2232.1): rows of the allowed table, named by refs a
 * lookup returned, read again as the person. A proposal keeps a snapshot and
 * deletes nothing.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const THEM = '00000000-0000-4000-8000-00000000000b';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TABLE = 'job_search.application_answers';

type Row = Record<string, unknown>;

function setup(opts: { enabled?: ProposeContext['enabledModules']; seen?: string[] } = {}) {
  const tables: Record<string, Row[]> = {
    application_answers: [
      { id: id(1), user_id: ME, application_id: id(50), question_id: id(60), answer: 'First', status: 'draft' },
      { id: id(2), user_id: ME, application_id: id(50), question_id: id(61), answer: 'First', status: 'draft' },
      { id: id(3), user_id: THEM, application_id: id(51), question_id: id(62), answer: 'Theirs', status: 'draft' },
    ],
    questions: [
      { id: id(60), user_id: ME, text: 'Why us?' },
      { id: id(61), user_id: ME, text: 'Why this role?' },
    ],
    applications: [{ id: id(50), user_id: ME, role_id: id(70) }],
    roles: [{ id: id(10), user_id: ME, title: 'Not deletable' }],
  };
  const writes: string[] = [];
  const client = {
    from: (table: string) => {
      const filters: ((row: Row) => boolean)[] = [];
      const write = (op: string) => () => (writes.push(`${op} ${table}`), query);
      const query = {
        select: () => query,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), query),
        insert: write('insert'),
        update: write('update'),
        delete: write('delete'),
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }),
      };
      return query;
    },
  } as unknown as SchemaClient;
  const kept: NewDashChange[] = [];
  const seen = new Set((opts.seen ?? []).map((n) => `${TABLE} ${n}`));
  const ctx: ProposeContext = {
    userId: ME,
    today: '2026-10-15',
    enabledModules: opts.enabled ?? ['jobs'],
    db: async () => client,
    searchSources: [],
    seen: (table, ref) => seen.has(`${table} ${ref}`),
    save: async (change) => {
      kept.push(change);
      return { ...change, id: 'c1', status: 'proposed' } as DashChange;
    },
  };
  return { ctx, kept, writes };
}

describe('propose_delete', () => {
  it('keeps a proposal with a snapshot of each row and deletes nothing', async () => {
    const { ctx, kept, writes } = setup({ seen: [id(1), id(2)] });
    const result = await executeProposal('propose_delete', { table: TABLE, refs: [id(1), id(2)] }, ctx);
    expect(result.ok).toBe(true);
    expect(writes).toEqual([]);
    expect(kept).toHaveLength(1);
    const input = kept[0].input as { count: number; titles: string[]; href: string; rows: Row[] };
    expect(kept[0].kind).toBe('delete_rows');
    expect(input.count).toBe(2);
    expect(input.titles).toEqual(['Why us?', 'Why this role?']);
    expect(input.href).toBe(`/jobs/roles/${id(70)}`);
    expect(input.rows.map((r) => r.id)).toEqual([id(1), id(2)]);
    expect(input.rows[0].answer).toBe('First');
  });

  it('refuses a table outside the allowed list', async () => {
    const { ctx, kept } = setup({ seen: [id(10)] });
    const result = await executeProposal('propose_delete', { table: 'job_search.roles', refs: [id(10)] }, ctx);
    expect(result.ok).toBe(false);
    expect(kept).toEqual([]);
  });

  it("refuses a ref no lookup returned, and a row that is not the person's", async () => {
    const unseen = setup({ seen: [id(1)] });
    expect(await executeProposal('propose_delete', { table: TABLE, refs: [id(1), id(2)] }, unseen.ctx)).toMatchObject({ ok: false });
    const theirs = setup({ seen: [id(3)] });
    const result = await executeProposal('propose_delete', { table: TABLE, refs: [id(3)] }, theirs.ctx);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('not one of theirs') });
    expect(unseen.kept).toEqual([]);
    expect(theirs.kept).toEqual([]);
  });

  it('refuses with no refs, too many refs, or the workspace off', async () => {
    const { ctx } = setup();
    expect(await executeProposal('propose_delete', { table: TABLE, refs: [] }, ctx)).toMatchObject({ ok: false });
    const many = Array.from({ length: 26 }, (_, n) => id(100 + n));
    expect(await executeProposal('propose_delete', { table: TABLE, refs: many }, ctx)).toMatchObject({ ok: false });
    const off = setup({ enabled: [], seen: [id(1)] });
    expect(await executeProposal('propose_delete', { table: TABLE, refs: [id(1)] }, off.ctx)).toMatchObject({ ok: false });
  });
});
