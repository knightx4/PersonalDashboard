import { describe, expect, it } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '@/tests/stubs/fake-schema-db';
import { THREAD_ROW_NOT_YOURS, acknowledgeThreadTurn, addThreadTurn, loadThread, rowRef } from './store';

const userId = 'user-1';
const ref = rowRef('public.plan_items', 'item-1');

function setup() {
  const tables: FakeTables = {};
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
