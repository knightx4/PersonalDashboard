import { describe, expect, it, vi } from 'vitest';
import { areaNamesById } from '@/lib/you/areas';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

describe('areaNamesById', () => {
  it('asks nothing when no row has an area', async () => {
    const schema = vi.fn();
    const client = { schema } as unknown as YouSupabaseClient;
    expect((await areaNamesById(client, 'u1', [null, undefined])).size).toBe(0);
    expect(schema).not.toHaveBeenCalled();
  });

  it("reads the person's own areas once for the distinct ids", async () => {
    const calls: unknown[][] = [];
    const chain = {
      select: (...a: unknown[]) => (calls.push(['select', ...a]), chain),
      eq: (...a: unknown[]) => (calls.push(['eq', ...a]), chain),
      in: (...a: unknown[]) => (
        calls.push(['in', ...a]), Promise.resolve({ data: [{ id: 'a1', name: 'Health' }], error: null })
      ),
    };
    const schema = vi.fn(() => ({ from: () => chain }));
    const client = { schema } as unknown as YouSupabaseClient;
    const names = await areaNamesById(client, 'u1', ['a1', 'a1', null]);
    expect(schema).toHaveBeenCalledWith('goals');
    expect(calls).toContainEqual(['eq', 'user_id', 'u1']);
    expect(calls).toContainEqual(['in', 'id', ['a1']]);
    expect(names.get('a1')).toBe('Health');
  });
});
