import { describe, expect, it } from 'vitest';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { loadNoteThread, saveThought } from './store';
import type { WrittenThought } from './thought';

/**
 * Storing a thought with a fake vault client: the thread and its first
 * message as written, a note that already has a thread, and the thread read
 * back for the note page.
 */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** Just enough of supabase-js for store.ts: insert, select, eq, order, limit. */
function fakeVault(tables: Tables, options: { conflict?: boolean } = {}) {
  const inserts: { table: string; row: Row }[] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let pending: Row | null = null;
    const rows = () => (tables[table] ?? []).filter((row) => filters.every(([k, v]) => row[k] === v));
    const query = {
      insert(row: Row) {
        inserts.push({ table, row });
        if (table === 'maya_threads' && options.conflict) {
          pending = null;
          return Object.assign(query, { conflict: true });
        }
        pending = { id: `${table}-${inserts.length}`, created_at: '2026-09-30T00:00:00Z', ...row };
        (tables[table] ??= []).push(pending);
        return query;
      },
      select: () => query,
      eq(key: string, value: unknown) {
        filters.push([key, value]);
        return query;
      },
      order: () => query,
      limit: () => query,
      async single() {
        if ((query as { conflict?: boolean }).conflict) {
          (query as { conflict?: boolean }).conflict = false;
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        return { data: pending, error: null };
      },
      async maybeSingle() {
        return { data: rows()[0] ?? null, error: null };
      },
      then(resolve: (value: { error: null }) => void) {
        resolve({ error: null });
      },
    };
    return query;
  };
  return { client: { from } as unknown as VaultSupabaseClient, inserts };
}

const written: WrittenThought = {
  ok: true,
  thought: { question: 'Do you find yourself or become yourself?', points: [], synthesis: null },
  question: 'Do you find yourself or become yourself?',
  body: '1. You become yourself by acting.',
  points: [
    {
      kind: 'point',
      rank: 1,
      claim: 'You become yourself by acting.',
      argument: 'Your essay puts action last.',
      notes: [],
      sources: [],
    },
  ] as unknown as WrittenThought['points'],
  noteBlobSha: 'sha-1',
  model: 'claude-opus',
  report: {} as WrittenThought['report'],
};

describe('saveThought', () => {
  it('opens the thread as asked and stores the thought as its first message', async () => {
    const { client, inserts } = fakeVault({});
    const result = await saveThought(client, { userId: 'u1', noteId: 'n1', origin: 'asked', written });

    expect(result).toEqual({ ok: true, threadId: 'maya_threads-1' });
    expect(inserts[0]).toEqual({
      table: 'maya_threads',
      row: { user_id: 'u1', note_id: 'n1', question: written.question, origin: 'asked' },
    });
    expect(inserts[1]).toEqual({
      table: 'maya_messages',
      row: {
        thread_id: 'maya_threads-1',
        user_id: 'u1',
        role: 'maya',
        kind: 'thought',
        body: written.body,
        points: written.points,
        note_blob_sha: 'sha-1',
        model: 'claude-opus',
      },
    });
  });

  it('returns the thread already on the note and stores nothing more', async () => {
    const { client, inserts } = fakeVault(
      { maya_threads: [{ id: 'existing', note_id: 'n1', question: 'Q' }] },
      { conflict: true },
    );
    const result = await saveThought(client, { userId: 'u1', noteId: 'n1', origin: 'asked', written });

    expect(result).toEqual({ ok: true, threadId: 'existing' });
    expect(inserts.map((insert) => insert.table)).toEqual(['maya_threads']);
  });
});

describe('loadNoteThread', () => {
  it('reads the thread with the points of its first thought', async () => {
    const { client } = fakeVault({
      maya_threads: [{ id: 't1', note_id: 'n1', question: 'Q?', created_at: '2026-09-30T00:00:00Z' }],
      maya_messages: [{ thread_id: 't1', kind: 'thought', points: written.points }],
    });
    const thread = await loadNoteThread(client, 'n1');

    expect(thread?.id).toBe('t1');
    expect(thread?.question).toBe('Q?');
    expect(thread?.thought?.points.map((point) => point.claim)).toEqual(['You become yourself by acting.']);
  });

  it('is null for a note with no thread', async () => {
    const { client } = fakeVault({});
    expect(await loadNoteThread(client, 'n1')).toBeNull();
  });
});
