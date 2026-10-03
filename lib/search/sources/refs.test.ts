import { describe, expect, it, vi } from 'vitest';
import { parseRef } from '@/lib/core/refs';

/**
 * The search sources that build their hits inline, with no map file of their
 * own to test, name each hit's row by a ref (plan #1451). The database is a
 * stand-in handing back one row per table whatever the query; the kinds with
 * a map file are checked beside their other tests.
 */

const ROWS: Record<string, Record<string, unknown>[]> = {
  readings: [{ id: 'rd1', title: 'Prices', status: 'queued', sources: null }],
  tracks: [{ id: 'tr1', title: 'Economics', question: null }],
  tasks: [{ id: 't1', title: 'Call the bank', status: 'open', due_on: null }],
};

function client() {
  return {
    from(table: string) {
      const result = { data: ROWS[table] ?? [], error: null };
      const builder: object = new Proxy(
        {},
        {
          get(_target, key) {
            if (key === 'then') return (resolve: (value: unknown) => void) => resolve(result);
            return () => builder;
          },
        },
      );
      return builder;
    },
  };
}

vi.mock('server-only', () => ({}));
vi.mock('@/lib/learn/auth/server', () => ({ createLearnClient: async () => client() }));
vi.mock('@/lib/todo/auth/server', () => ({ createTodoClient: async () => client() }));

const { learnSearchSource } = await import('./learn');
const { todoSearchSource } = await import('./todo');

describe('search hit refs', () => {
  it('names a reading, a reading list and a task by their rows', async () => {
    const hits = [
      ...(await learnSearchSource.list({ userId: 'u', limit: 10 })),
      ...(await todoSearchSource.list({ userId: 'u', limit: 10 })),
    ];
    expect(hits.map((hit) => [hit.kind, hit.ref])).toEqual([
      ['reading', 'learn.readings:rd1'],
      ['track', 'learn.tracks:tr1'],
      ['task', 'todo.tasks:t1'],
    ]);
    for (const hit of hits) expect(parseRef(hit.ref!)).toMatchObject({ id: hit.id });
  });
});
