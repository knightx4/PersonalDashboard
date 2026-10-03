import { describe, expect, it } from 'vitest';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { loadNoteThread, saveThought, type MayaDb } from './store';
import type { WrittenThought } from './thought';

/**
 * Keeping a thought with a fake core client (plan #1479): the note's thread
 * in core.conversations and the thought as its turn, a note already Maya's,
 * a note with a thread of comments that Maya takes up, and the thread read
 * back for the note page.
 */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** The value a filter key names on a row, `detail->>kind` included. */
function valueAt(row: Row, key: string): unknown {
  const [column, field] = key.split('->>');
  const value = row[column!];
  return field ? (value as Row | null | undefined)?.[field] : value;
}

/** Just enough of supabase-js for store.ts: insert, update, select, eq, in, order, limit. */
function fakeDb(tables: Tables, options: { conflict?: boolean } = {}) {
  const inserts: { table: string; row: Row }[] = [];
  const updates: { table: string; row: Row; filters: [string, unknown][] }[] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let pending: Row | null = null;
    let conflict = false;
    const rows = () => (tables[table] ?? []).filter((row) => filters.every(([k, v]) => valueAt(row, k) === v));
    const query = {
      insert(row: Row) {
        inserts.push({ table, row });
        if (table === 'conversations' && options.conflict) {
          conflict = true;
          return query;
        }
        pending = { id: `${table}-${inserts.length}`, created_at: '2026-09-30T00:00:00Z', ...row };
        (tables[table] ??= []).push(pending);
        return query;
      },
      update(row: Row) {
        updates.push({ table, row, filters });
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
        if (conflict) return { data: null, error: { code: '23505', message: 'duplicate key' } };
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
  const db: MayaDb = {
    core: { from } as unknown as CoreSupabaseClient,
    vault: { from } as unknown as VaultSupabaseClient,
  };
  return { db, inserts, updates };
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
  it("opens the note's thread in Maya's voice and keeps the thought as its turn", async () => {
    const { db, inserts } = fakeDb({});
    const result = await saveThought(db, { userId: 'u1', noteId: 'n1', origin: 'asked', written });

    expect(result).toEqual({ ok: true, threadId: 'conversations-1' });
    expect(inserts[0]).toEqual({
      table: 'conversations',
      row: {
        user_id: 'u1',
        subject_kind: 'row',
        subject_ref: 'obsidian.notes:n1',
        title: written.question,
        voice: 'maya',
        origin: 'asked',
      },
    });
    expect(inserts[1]).toEqual({
      table: 'conversation_turns',
      row: {
        conversation_id: 'conversations-1',
        user_id: 'u1',
        role: 'assistant',
        body: written.body,
        detail: { kind: 'thought', points: written.points, note_blob_sha: 'sha-1', model: 'claude-opus' },
      },
    });
  });

  it("returns the note's thread when it is already Maya's, and keeps nothing more", async () => {
    const { db, inserts } = fakeDb(
      { conversations: [{ id: 'existing', user_id: 'u1', subject_kind: 'row', subject_ref: 'obsidian.notes:n1', voice: 'maya' }] },
      { conflict: true },
    );
    const result = await saveThought(db, { userId: 'u1', noteId: 'n1', origin: 'asked', written });

    expect(result).toEqual({ ok: true, threadId: 'existing' });
    expect(inserts.map((insert) => insert.table)).toEqual(['conversations']);
  });

  it("takes up a note's thread of comments and adds the thought to it", async () => {
    const { db, inserts, updates } = fakeDb(
      { conversations: [{ id: 'comments', user_id: 'u1', subject_kind: 'row', subject_ref: 'obsidian.notes:n1', voice: null }] },
      { conflict: true },
    );
    const result = await saveThought(db, { userId: 'u1', noteId: 'n1', origin: 'automatic', written });

    expect(result).toEqual({ ok: true, threadId: 'comments' });
    expect(updates[0]).toMatchObject({
      table: 'conversations',
      row: { voice: 'maya', origin: 'automatic', title: written.question },
    });
    expect(inserts[1]).toMatchObject({ table: 'conversation_turns', row: { conversation_id: 'comments' } });
  });
});

describe('loadNoteThread', () => {
  it('reads the thread with the points of its thought', async () => {
    const { db } = fakeDb({
      conversations: [
        { id: 't1', subject_kind: 'row', subject_ref: 'obsidian.notes:n1', voice: 'maya', title: 'Q?', created_at: '2026-09-30T00:00:00Z' },
      ],
      conversation_turns: [{ conversation_id: 't1', detail: { kind: 'thought', points: written.points } }],
    });
    const thread = await loadNoteThread(db, 'n1');

    expect(thread?.id).toBe('t1');
    expect(thread?.question).toBe('Q?');
    expect(thread?.thought?.points.map((point) => point.claim)).toEqual(['You become yourself by acting.']);
  });

  it('is null for a note with no thread of Maya\'s', async () => {
    const { db } = fakeDb({
      conversations: [{ id: 'c1', subject_kind: 'row', subject_ref: 'obsidian.notes:n1', voice: null }],
    });
    expect(await loadNoteThread(db, 'n1')).toBeNull();
    expect(await loadNoteThread(fakeDb({}).db, 'n1')).toBeNull();
  });
});
