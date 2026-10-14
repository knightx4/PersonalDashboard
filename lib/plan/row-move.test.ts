import { describe, expect, it } from 'vitest';
import { loadPlanRowMove } from './row-move';

/**
 * One row's move for a ref link's preview (plan #1931.4), worked out by the
 * plan page's own rules over the row's feature and what its steps wait on.
 * The database is a stand-in that honours `eq` and `in`, and ignores `or`.
 */

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        or: () => builder,
        order: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push((row) => column === 'user_id' || row[column] === value);
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: (tables[table] ?? []).filter((row) => filters.every((keep) => keep(row))), error: null }),
      };
      return builder;
    },
  };
}

const item = (over: Row): Row => ({
  module: 'dev',
  parent_id: null,
  kind: 'build',
  status: 'not_started',
  track: 'feature',
  priority: 2,
  position: 0,
  created_at: '2026-10-01T00:00:00Z',
  dismissed_at: null,
  assignee: null,
  block_kind: null,
  ...over,
});

const tables = {
  plan_item_outlines: [
    { id: 'f', number: 1931, outline: '1931' },
    { id: 'a', number: 1932, outline: '1931.1' },
    { id: 'b', number: 1935, outline: '1931.4' },
    { id: 'q', number: 1940, outline: '1931.5' },
  ],
  plan_items: [
    item({ id: 'f', number: 1931, title: 'One interface', status: 'in_progress' }),
    item({ id: 'a', number: 1932, parent_id: 'f', title: 'Every row has a page', position: 1 }),
    item({ id: 'b', number: 1935, parent_id: 'f', title: 'A search hit opens the row', position: 2 }),
    item({ id: 'q', number: 1940, parent_id: 'f', title: 'Which panel?', kind: 'decision', position: 3 }),
  ],
  plan_dependencies: [{ id: 'd1', item_id: 'b', depends_on_id: 'a' }],
  check_backs: [],
};

describe('loadPlanRowMove', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = fakeDb(tables) as any;

  it('says a step held up by another is waiting, and on which', async () => {
    const said = await loadPlanRowMove(db, 'u', { id: 'b', number: 1935, outline: '1931.4' });
    expect(said.move).toEqual({ state: 'waiting', waitingOn: '#1931.1 Every row has a page' });
  });

  it('reports a feature from beneath it: a question under it is on you', async () => {
    const said = await loadPlanRowMove(db, 'u', { id: 'f', number: 1931, outline: '1931' });
    expect(said.move).toEqual({ state: 'on_you' });
    expect(said.title).toContain('from a step beneath');
  });

  it('says nothing about an approved step waiting its turn', async () => {
    const said = await loadPlanRowMove(db, 'u', { id: 'a', number: 1932, outline: '1931.1' });
    expect(said.move).toBeNull();
  });
});
