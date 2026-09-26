import { describe, expect, it } from 'vitest';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { appendTurns, loadConversation, loadConversations } from './store';

/**
 * The loader and the append, against a client that records what it was asked
 * and answers from fixed rows. What RLS and the constraints do with those
 * writes is tested against the database in tests/talk-conversations.test.ts.
 */

type Call = { table: string; op: string; args: unknown[] };

function fakeClient(rows: { conversations?: unknown[]; conversation?: unknown; inserted?: unknown[] }) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      let inserting = false;
      const chain = {
        select: (...args: unknown[]) => (calls.push({ table, op: 'select', args }), chain),
        eq: (...args: unknown[]) => (calls.push({ table, op: 'eq', args }), chain),
        in: (...args: unknown[]) => (calls.push({ table, op: 'in', args }), chain),
        upsert: async (...args: unknown[]) => {
          calls.push({ table, op: 'upsert', args });
          return { error: null };
        },
        insert: (...args: unknown[]) => {
          calls.push({ table, op: 'insert', args });
          inserting = true;
          return chain;
        },
        maybeSingle: async () => ({ data: rows.conversation ?? null, error: null }),
        then: (resolve: (value: unknown) => void) =>
          resolve({
            data: inserting ? (rows.inserted ?? []) : (rows.conversations ?? []),
            error: null,
          }),
      };
      return chain;
    },
  } as unknown as CoreSupabaseClient;
  return { client, calls };
}

describe('loadConversations', () => {
  it('maps each card to its turns, oldest first, and leaves out a conversation with none', async () => {
    const { client, calls } = fakeClient({
      conversations: [
        {
          subject_ref: 'card-1',
          conversation_turns: [
            { id: 't2', role: 'assistant', body: 'Because.', created_at: '2026-09-26T10:00:02.000001+00:00' },
            { id: 't1', role: 'user', body: 'Why?', created_at: '2026-09-26T10:00:01.000001+00:00' },
          ],
        },
        { subject_ref: 'card-2', conversation_turns: [] },
      ],
    });

    const byCard = await loadConversations(client, 'feed_card', ['card-1', 'card-2', 'card-1']);

    expect(byCard.get('card-1')?.map((turn) => turn.id)).toEqual(['t1', 't2']);
    expect(byCard.has('card-2')).toBe(false);
    expect(calls).toContainEqual({ table: 'conversations', op: 'eq', args: ['subject_kind', 'feed_card'] });
    expect(calls).toContainEqual({ table: 'conversations', op: 'in', args: ['subject_ref', ['card-1', 'card-2']] });
  });

  it('reads nothing for no cards', async () => {
    const { client, calls } = fakeClient({});
    expect((await loadConversations(client, 'feed_card', [])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('gives an empty thread for a subject never talked about', async () => {
    const { client } = fakeClient({ conversations: [] });
    expect(await loadConversation(client, { kind: 'feed_card', ref: 'card-9' })).toEqual([]);
  });
});

describe('appendTurns', () => {
  it('starts the conversation without replacing one already there, then adds the turns in order', async () => {
    const { client, calls } = fakeClient({
      conversation: { id: 'conv-1' },
      inserted: [
        { id: 't2', role: 'assistant', body: 'Because.', created_at: '2026-09-26T10:00:02+00:00' },
        { id: 't1', role: 'user', body: 'Why?', created_at: '2026-09-26T10:00:01+00:00' },
      ],
    });

    const turns = await appendTurns(
      client,
      'user-1',
      { kind: 'feed_card', ref: 'card-1', title: ' AlphaGo ' },
      [
        { role: 'user', body: 'Why?' },
        { role: 'assistant', body: 'Because.' },
      ],
    );

    expect(turns.map((turn) => turn.id)).toEqual(['t1', 't2']);
    const upsert = calls.find((call) => call.op === 'upsert');
    expect(upsert?.args).toEqual([
      { user_id: 'user-1', subject_kind: 'feed_card', subject_ref: 'card-1', title: 'AlphaGo' },
      { onConflict: 'user_id,subject_kind,subject_ref', ignoreDuplicates: true },
    ]);
    const insert = calls.find((call) => call.op === 'insert');
    expect(insert?.table).toBe('conversation_turns');
    expect(insert?.args[0]).toEqual([
      { conversation_id: 'conv-1', user_id: 'user-1', role: 'user', body: 'Why?' },
      { conversation_id: 'conv-1', user_id: 'user-1', role: 'assistant', body: 'Because.' },
    ]);
  });

  it('writes nothing when there is nothing to add', async () => {
    const { client, calls } = fakeClient({});
    expect(await appendTurns(client, 'user-1', { kind: 'feed_card', ref: 'card-1' }, [])).toEqual([]);
    expect(calls).toEqual([]);
  });
});
