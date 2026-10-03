import { describe, expect, it } from 'vitest';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { loadMadeChanges } from './changes';

/**
 * The Ask page's list of changes (plan #1191), against a client that records
 * what it was asked and answers from fixed rows. What RLS does with the read
 * is tested against the database in tests/dash-actions.test.ts.
 */

type Call = { table: string; op: string; args: unknown[] };

function fakeClient(rows: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      const chain = {
        select: (...args: unknown[]) => (calls.push({ table, op: 'select', args }), chain),
        eq: (...args: unknown[]) => (calls.push({ table, op: 'eq', args }), chain),
        in: (...args: unknown[]) => (calls.push({ table, op: 'in', args }), chain),
        order: (...args: unknown[]) => (calls.push({ table, op: 'order', args }), chain),
        limit: (...args: unknown[]) => (calls.push({ table, op: 'limit', args }), chain),
        then: (resolve: (value: unknown) => void) => resolve({ data: rows[table] ?? [], error: null }),
      };
      return chain;
    },
  } as unknown as CoreSupabaseClient;
  return { client, calls };
}

const row = (id: string, conversation: string, status: string, created: string) => ({
  id,
  conversation_id: conversation,
  turn_id: 't',
  kind: 'add_todo',
  input: { title: id, body: null, dueOn: null, dueTime: null, pinned: false },
  status,
  subject_ref: `todo.tasks:${id}-row`,
  undo: null,
  created_at: created,
  done_at: created,
  declined_at: null,
  undone_at: status === 'undone' ? created : null,
});

describe('loadMadeChanges', () => {
  it('asks for done and undone Ask changes only, newest first', async () => {
    const { client, calls } = fakeClient({});
    expect(await loadMadeChanges(client, 50)).toEqual([]);
    const asked = calls.filter((call) => call.table === 'dash_actions');
    expect(asked).toContainEqual({ table: 'dash_actions', op: 'eq', args: ['surface', 'ask'] });
    expect(asked).toContainEqual({ table: 'dash_actions', op: 'in', args: ['status', ['done', 'undone']] });
    expect(asked).toContainEqual({ table: 'dash_actions', op: 'order', args: ['created_at', { ascending: false }] });
    expect(asked).toContainEqual({ table: 'dash_actions', op: 'limit', args: [50] });
    // No change, so no question is looked up.
    expect(calls.some((call) => call.table === 'conversations')).toBe(false);
  });

  it('keeps the order it was given and names the question each came from', async () => {
    const { client, calls } = fakeClient({
      dash_actions: [
        row('b', 'c2', 'undone', '2026-09-29T11:00:00Z'),
        row('a', 'c1', 'done', '2026-09-29T10:00:00Z'),
        row('z', 'c1', 'done', '2026-09-29T09:00:00Z'),
      ],
      conversations: [
        { id: 'c1', title: 'Add a todo to call the dentist' },
        { id: 'c2', title: null },
      ],
    });
    const made = await loadMadeChanges(client);
    expect(made.map((change) => [change.id, change.status, change.question])).toEqual([
      ['b', 'undone', null],
      ['a', 'done', 'Add a todo to call the dentist'],
      ['z', 'done', 'Add a todo to call the dentist'],
    ]);
    expect(calls).toContainEqual({ table: 'conversations', op: 'in', args: ['id', ['c2', 'c1']] });
  });
});
