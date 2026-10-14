import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { attachTopicParents, IDEA_STRONG_MATCH } from './parents';

function client(rows: { topics_attached: number; ideas_attached: number }[]) {
  const calls: unknown[] = [];
  const learn = {
    rpc: (name: string, args: unknown) => {
      calls.push([name, args]);
      const row = rows[calls.length - 1] ?? { topics_attached: 0, ideas_attached: 0 };
      return { single: async () => ({ data: row, error: null }) };
    },
  } as unknown as LearnSupabaseClient;
  return { learn, calls };
}

describe('attachTopicParents', () => {
  it('calls until a short slice and adds the counts up', async () => {
    const { learn, calls } = client([
      { topics_attached: 10, ideas_attached: 3 },
      { topics_attached: 10, ideas_attached: 0 },
      { topics_attached: 4, ideas_attached: 0 },
    ]);
    const result = await attachTopicParents(learn, { perCall: 10 });
    expect(result).toEqual({ topics: 24, ideas: 3, calls: 3, stoppedEarly: false });
    expect(calls[0]).toEqual(['attach_topic_parents', { p_threshold: IDEA_STRONG_MATCH, p_topic_limit: 10 }]);
  });

  it('stops on the deadline and says so', async () => {
    const { learn } = client([{ topics_attached: 10, ideas_attached: 0 }]);
    const result = await attachTopicParents(learn, { perCall: 10, deadline: Date.now() - 1 });
    expect(result.stoppedEarly).toBe(true);
    expect(result.calls).toBe(1);
  });

  it('raises the database error', async () => {
    const learn = {
      rpc: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }),
    } as unknown as LearnSupabaseClient;
    await expect(attachTopicParents(learn)).rejects.toThrow('boom');
  });
});
