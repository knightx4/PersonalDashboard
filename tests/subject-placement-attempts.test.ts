import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  MAX_PLACEMENT_ATTEMPTS,
  pendingSubjects,
  recordFailedPlacement,
} from '@/inngest/learn/subject-placement';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/** A failed placement is recorded and not retried hourly (plan #2297.1). */

function fake() {
  const calls: unknown[][] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'update', 'is', 'eq', 'lt', 'order']) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.range = () => Promise.resolve({ data: [], error: null });
  chain.then = (resolve: (value: unknown) => void) => resolve({ error: null });
  const client = { from: () => chain } as unknown as LearnSupabaseClient;
  return { client, calls };
}

describe('pendingSubjects', () => {
  it('leaves out survey subjects and subjects with three failed attempts', async () => {
    const { client, calls } = fake();
    await pendingSubjects(client);
    expect(calls).toContainEqual(['eq', 'survey', false]);
    expect(calls).toContainEqual(['lt', 'placement_attempts', MAX_PLACEMENT_ATTEMPTS]);
    expect(MAX_PLACEMENT_ATTEMPTS).toBe(3);
  });
});

describe('recordFailedPlacement', () => {
  it('counts the attempt and keeps what it said on the row', async () => {
    const { client, calls } = fake();
    await recordFailedPlacement(client, { id: 's1', user_id: 'u1', placement_attempts: 1 }, 'no reply');
    expect(calls).toContainEqual(['update', { placement_attempts: 2, last_placement_error: 'no reply' }]);
    expect(calls).toContainEqual(['eq', 'user_id', 'u1']);
  });
});
