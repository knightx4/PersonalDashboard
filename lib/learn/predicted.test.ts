import { describe, expect, it } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { predictedStrength } from './predicted';

function clientReturning(result: { data: unknown; error: { message: string } | null }) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result,
  };
  return { from: () => query } as unknown as LearnSupabaseClient;
}

const AT = new Date('2026-10-15T12:00:00Z');

describe('predictedStrength', () => {
  it('is the strength score on the day the question is asked', async () => {
    const client = clientReturning({
      data: {
        state: 'known',
        established: 'tested',
        tested_at: '2026-09-15T12:00:00Z',
        declared_at: null,
        review_interval_days: null,
      },
      error: null,
    });
    // 0.8 times 1 times 2^(-30/30) is 0.4.
    expect(await predictedStrength(client, 'c', AT)).toBe(0.4);
  });

  it('is 0 for an idea nothing has been judged about', async () => {
    expect(await predictedStrength(clientReturning({ data: null, error: null }), 'c', AT)).toBe(0);
  });

  it('is null, not a throw, when the state cannot be read', async () => {
    const client = clientReturning({ data: null, error: { message: 'down' } });
    expect(await predictedStrength(client, 'c', AT)).toBeNull();
  });
});
