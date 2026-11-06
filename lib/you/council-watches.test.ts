import { describe, expect, it } from 'vitest';
import { cadenceWords } from './advisor-watch-words';
import { stopWatch, watchOf } from './council';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

describe('watchOf', () => {
  const row = { id: 'w1', about: 'Notes about my sister', sends_when: 'A new one', every_days: 7, status: 'active', last_run_at: null, last_error: '' };

  it('reads a running watch', () => {
    expect(watchOf(row)).toEqual({
      id: 'w1',
      about: 'Notes about my sister',
      sendsWhen: 'A new one',
      everyDays: 7,
      status: 'active',
      lastRunAt: null,
      lastError: null,
    });
  });

  it('does not list a proposed or declined watch', () => {
    expect(watchOf({ ...row, status: 'proposed' })).toBeNull();
    expect(watchOf({ ...row, status: 'declined' })).toBeNull();
  });

  it('says the cadence in words', () => {
    expect(cadenceWords(7)).toBe('every week');
    expect(cadenceWords(3)).toBe('every 3 days');
  });
});

function fakeClient(result: { data: unknown[] | null; error: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['update', 'eq', 'in']) chain[m] = (...a: unknown[]) => (calls.push([m, ...a]), chain);
  chain.select = () => Promise.resolve(result);
  return { client: { from: (t: string) => (calls.push(['from', t]), chain) } as unknown as YouSupabaseClient, calls };
}

describe('stopWatch', () => {
  it('sets a running or paused watch of the owner to stopped', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 'w1' }], error: null });
    await stopWatch(client, 'u1', 'w1', Date.parse('2026-11-06T10:00:00Z'));
    expect(calls).toContainEqual(['update', { status: 'stopped', decided_at: '2026-11-06T10:00:00.000Z' }]);
    expect(calls).toContainEqual(['eq', 'user_id', 'u1']);
    expect(calls).toContainEqual(['in', 'status', ['active', 'paused']]);
  });

  it('refuses a watch that is not running', async () => {
    const { client } = fakeClient({ data: [], error: null });
    await expect(stopWatch(client, 'u1', 'w1')).rejects.toThrow('not running');
  });
});
