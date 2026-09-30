import { describe, expect, it } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  addProgressEntry,
  loadProgressEntries,
  setProgressEstimate,
  undoProgressEntry,
} from '@/lib/goals/progress-store';

type Call = { table: string; op: string; args: unknown[] };

/**
 * A query that records every call made on it and resolves to the answer
 * given for its table, which is all the progress store asks of the client.
 */
function fakeClient(answers: Record<string, { data: unknown; error: null | { message: string } }>) {
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
      query.single = async () => result;
      query.maybeSingle = async () => result;
      query.then = (resolve: (value: typeof result) => unknown) => resolve(result);
      return query;
    },
  } as unknown as GoalsSupabaseClient;
  return { client, calls };
}

describe('addProgressEntry', () => {
  it('writes the entry on a live item, trimmed, and returns its id', async () => {
    const { client, calls } = fakeClient({
      items: { data: { id: 'step-1' }, error: null },
      progress_entries: { data: { id: 'entry-1' }, error: null },
    });
    const id = await addProgressEntry(client, 'user-1', {
      itemId: 'step-1',
      text: ' moved two bags ',
      quantity: 2,
      unit: 'bags',
      captureId: 'cap-1',
    });
    expect(id).toBe('entry-1');
    expect(calls).toContainEqual({ table: 'items', op: 'is', args: ['archived_at', null] });
    const insert = calls.find((c) => c.table === 'progress_entries' && c.op === 'insert');
    expect(insert?.args[0]).toEqual({
      user_id: 'user-1',
      item_id: 'step-1',
      text: 'moved two bags',
      quantity: 2,
      unit: 'bags',
      estimate: null,
      capture_id: 'cap-1',
    });
  });

  it('passes the day through when one is given', async () => {
    const { client, calls } = fakeClient({
      items: { data: { id: 'step-1' }, error: null },
      progress_entries: { data: { id: 'entry-1' }, error: null },
    });
    await addProgressEntry(client, 'user-1', {
      itemId: 'step-1',
      text: 'half done',
      estimate: 'half',
      happenedOn: '2026-09-29',
    });
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.args[0]).toMatchObject({ happened_on: '2026-09-29', estimate: 'half' });
  });

  it('writes nothing when the item is gone', async () => {
    const { client, calls } = fakeClient({ items: { data: null, error: null } });
    expect(await addProgressEntry(client, 'user-1', { itemId: 'gone', text: 'x' })).toBeNull();
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('refuses an entry that breaks a rule before touching the database', async () => {
    const { client, calls } = fakeClient({});
    await expect(
      addProgressEntry(client, 'user-1', { itemId: 's', text: 'x', unit: 'bags' }),
    ).rejects.toThrow(/amount/);
    expect(calls).toHaveLength(0);
  });
});

describe('loadProgressEntries', () => {
  it('reads the entries not undone on the items asked for, newest first', async () => {
    const { client, calls } = fakeClient({
      progress_entries: {
        data: [
          {
            id: 'e1',
            item_id: 'step-1',
            capture_id: null,
            happened_on: '2026-09-30',
            text: 'moved two bags',
            quantity: '2',
            unit: 'bags',
            estimate: null,
            created_at: '2026-09-30T10:00:00Z',
          },
          {
            id: 'e2',
            item_id: 'step-2',
            capture_id: 'cap-1',
            happened_on: '2026-09-29',
            text: 'about halfway',
            quantity: null,
            unit: null,
            estimate: 'half',
            created_at: '2026-09-29T10:00:00Z',
          },
        ],
        error: null,
      },
    });
    const entries = await loadProgressEntries(client, ['step-1', 'step-2']);
    expect(entries).toEqual([
      {
        id: 'e1',
        itemId: 'step-1',
        captureId: null,
        happenedOn: '2026-09-30',
        text: 'moved two bags',
        quantity: 2,
        unit: 'bags',
        estimate: null,
        createdAt: '2026-09-30T10:00:00Z',
      },
      {
        id: 'e2',
        itemId: 'step-2',
        captureId: 'cap-1',
        happenedOn: '2026-09-29',
        text: 'about halfway',
        quantity: null,
        unit: null,
        estimate: 'half',
        createdAt: '2026-09-29T10:00:00Z',
      },
    ]);
    expect(calls).toContainEqual({ table: 'progress_entries', op: 'in', args: ['item_id', ['step-1', 'step-2']] });
    expect(calls).toContainEqual({ table: 'progress_entries', op: 'is', args: ['undone_at', null] });
    expect(calls).toContainEqual({
      table: 'progress_entries',
      op: 'order',
      args: ['happened_on', { ascending: false }],
    });
  });

  it('asks nothing for no items', async () => {
    const { client, calls } = fakeClient({});
    expect(await loadProgressEntries(client, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('undoProgressEntry', () => {
  it('marks a live entry undone', async () => {
    const { client, calls } = fakeClient({ progress_entries: { data: [{ id: 'e1' }], error: null } });
    expect(await undoProgressEntry(client, 'e1')).toBe(true);
    const update = calls.find((c) => c.op === 'update');
    expect(update?.args[0]).toMatchObject({ undone_at: expect.any(String) });
    expect(calls).toContainEqual({ table: 'progress_entries', op: 'is', args: ['undone_at', null] });
  });

  it('says so when there was nothing left to undo', async () => {
    const { client } = fakeClient({ progress_entries: { data: [], error: null } });
    expect(await undoProgressEntry(client, 'e1')).toBe(false);
  });
});

describe('setProgressEstimate (plan #1280)', () => {
  it('keeps the answer on a live entry', async () => {
    const { client, calls } = fakeClient({ progress_entries: { data: [{ id: 'e1' }], error: null } });
    expect(await setProgressEstimate(client, 'e1', 'half')).toBe(true);
    expect(calls).toContainEqual({ table: 'progress_entries', op: 'update', args: [{ estimate: 'half' }] });
    expect(calls).toContainEqual({ table: 'progress_entries', op: 'is', args: ['undone_at', null] });
  });

  it('says so when the entry was undone, and refuses an answer that is not one', async () => {
    const { client } = fakeClient({ progress_entries: { data: [], error: null } });
    expect(await setProgressEstimate(client, 'e1', 'nearly')).toBe(false);
    await expect(setProgressEstimate(client, 'e1', 'most' as never)).rejects.toThrow();
  });
});
