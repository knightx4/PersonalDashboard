import { describe, expect, it, vi } from 'vitest';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { wakeBroker } from './broker-wake';

const THREAD = '11111111-1111-4111-8111-111111111111';

function fakeCore() {
  const inserted: Record<string, unknown>[] = [];
  const core = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: null };
      },
    }),
  } as unknown as CoreSupabaseClient;
  return { core, inserted };
}

describe('wakeBroker', () => {
  it("fires the broker's own routine with the wake text and writes nothing", async () => {
    const { core, inserted } = fakeCore();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'session_x' }), { status: 200 }));
    const result = await wakeBroker({
      core,
      userId: 'u1',
      threadId: THREAD,
      routine: { id: 'trig_broker', token: 'tok' },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/routines/trig_broker/fire');
    expect(String(init.body)).toContain(THREAD);
    expect(String(init.body)).toContain('session-broker/SKILL.md');
    expect(inserted).toEqual([]);
  });

  it('never fires another routine when the broker id is missing, and says so in the thread', async () => {
    const { core, inserted } = fakeCore();
    const fetch = vi.fn();
    const result = await wakeBroker({
      core,
      userId: 'u1',
      threadId: THREAD,
      routine: { id: null, token: 'tok' },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ user_id: 'u1', thread_id: THREAD, author: 'session', kind: 'status' });
    expect(String(inserted[0].body)).toContain('CLAUDE_BROKER_ROUTINE_ID');
  });

  it('notes a refused fire in the thread', async () => {
    const { core, inserted } = fakeCore();
    const fetch = vi.fn(async () => new Response('{"error":{"message":"nope"}}', { status: 401 }));
    const result = await wakeBroker({
      core,
      userId: 'u1',
      threadId: THREAD,
      routine: { id: 'trig_broker', token: 'tok' },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(result.ok).toBe(false);
    expect(String(inserted[0].body)).toContain('401');
  });
});
