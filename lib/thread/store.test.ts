import { describe, expect, it } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';
import { THREAD_ROW_NOT_YOURS, acknowledgeThreadTurn, addThreadTurn, loadThread, rowRef } from './store';

const userId = 'user-1';
const ref = rowRef('public.plan_items', 'item-1');

function setup(tables: FakeTables = {}) {
  const client = fakeSchemaDb(tables)('core');
  return client as unknown as Parameters<typeof loadThread>[0];
}

describe('acknowledging a comment', () => {
  it('reads back with the mark, and a comment nothing marked reads back without one', async () => {
    const client = setup();
    const marked = await addThreadTurn(client, { userId, ref, author: 'me', body: 'Pushed the fix @dash' });
    await addThreadTurn(client, { userId, ref, author: 'me', body: 'Another note' });

    const at = await acknowledgeThreadTurn(client, { userId, ref, turnId: marked });
    const thread = await loadThread(client, ref, { userId });

    expect(thread.find((c) => c.id === marked)?.acknowledgedAt).toBe(at);
    expect(thread.filter((c) => c.id !== marked).map((c) => c.acknowledgedAt)).toEqual([null]);
  });

  it("refuses a turn of Dash's, and a comment under a different row", async () => {
    const client = setup();
    const dash = await addThreadTurn(client, { userId, ref, author: 'claude', body: 'Noted.' });
    const mine = await addThreadTurn(client, { userId, ref, author: 'me', body: 'A note @dash' });

    await expect(acknowledgeThreadTurn(client, { userId, ref, turnId: dash })).rejects.toThrow(THREAD_ROW_NOT_YOURS);
    await expect(
      acknowledgeThreadTurn(client, { userId, ref: rowRef('public.plan_items', 'other'), turnId: mine }),
    ).rejects.toThrow(THREAD_ROW_NOT_YOURS);
  });
});

describe('the paid presses a comment queued (plan #2228.2)', () => {
  it('reads them onto the comment that asked, and onto no other', async () => {
    const tables: FakeTables = {};
    const client = setup(tables);
    const asked = await addThreadTurn(client, { userId, ref, author: 'me', body: 'Write 2026 up @dash' });
    const other = await addThreadTurn(client, { userId, ref, author: 'me', body: 'Thanks' });
    const press = (id: string, turnId: string, kind = 'paid_action', surface = 'thread') => ({
      id,
      user_id: userId,
      conversation_id: 'conv',
      turn_id: turnId,
      surface,
      kind,
      status: 'proposed',
      input: { tool: 'write_year_review', line: 'Write the review of 2026.', estimate: null, paths: ['/timeline'] },
      subject_ref: null,
      undo: null,
      created_at: '2026-10-16T09:00:00Z',
      done_at: null,
      declined_at: null,
      undone_at: null,
    });
    tables['core.dash_actions'] = [
      press('p1', asked),
      press('w1', asked, 'add_todo'),
      press('a1', asked, 'paid_action', 'ask'),
    ];

    const thread = await loadThread(client, ref, { userId });

    expect(thread.find((c) => c.id === asked)?.paid?.map((c) => c.id)).toEqual(['p1']);
    expect(thread.find((c) => c.id === other)?.paid).toBeUndefined();
  });
});
