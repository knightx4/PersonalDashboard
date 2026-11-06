import { describe, expect, it } from 'vitest';
import { loadSpeechUsage, speechResetDay, speechUsageFrom } from '@/lib/talk/speech/usage';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

describe('speechUsageFrom', () => {
  it('reads a month nobody has spoken in as nothing used', () => {
    const usage = speechUsageFrom('2026-11-01', null);
    expect(usage).toMatchObject({ used: 0, left: 330_000, replies: 0, costMicros: 0, paused: false });
    expect(usage.capMicros).toBe(4_950_000);
  });

  it('prices the bytes at $15 a million', () => {
    const usage = speechUsageFrom('2026-11-01', { bytes: 48_212, replies: 97 });
    expect(usage.costMicros).toBe(723_180);
    expect(usage.left).toBe(281_788);
  });

  it('says the month is paused at the cap', () => {
    expect(speechUsageFrom('2026-11-01', { bytes: 330_000, replies: 641 })).toMatchObject({
      left: 0,
      paused: true,
      costMicros: 4_950_000,
    });
  });
});

describe('speechResetDay', () => {
  it('is the first of the next month, across the year end', () => {
    expect(speechResetDay('2026-11-01')).toBe('2026-12-01');
    expect(speechResetDay('2026-12-01')).toBe('2027-01-01');
  });
});

describe('loadSpeechUsage', () => {
  function client(result: { data: unknown; error: unknown }, seen: Record<string, unknown>) {
    const chain = {
      from: (table: string) => ((seen.table = table), chain),
      select: () => chain,
      eq: (column: string, value: unknown) => ((seen[column] = value), chain),
      maybeSingle: async () => result,
    };
    return chain as unknown as CoreSupabaseClient;
  }

  it("reads the month in the account's own timezone", async () => {
    const seen: Record<string, unknown> = {};
    // 23:30 on 31 October in New York is already 1 November in UTC.
    const now = new Date('2026-11-01T03:30:00Z');
    const usage = await loadSpeechUsage(client({ data: null, error: null }, seen), 'u1', 'America/New_York', now);
    expect(seen).toMatchObject({ table: 'speech_usage', user_id: 'u1', month: '2026-10-01' });
    expect(usage?.month).toBe('2026-10-01');
  });

  it('is null when the read fails', async () => {
    const usage = await loadSpeechUsage(client({ data: null, error: { message: 'no' } }, {}), 'u1', 'UTC');
    expect(usage).toBeNull();
  });
});
