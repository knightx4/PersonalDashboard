import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fillDays, readSpendPerDay, readViewsPerDay, spendTotal, startOfLocalDay, usageWindow } from '@/lib/usage/per-day';

describe('usageWindow', () => {
  it('starts at midnight in the timezone, not in UTC', () => {
    // 02:30 UTC on the 14th is still the 13th in New York.
    const window = usageWindow('America/New_York', new Date('2026-10-14T02:30:00Z'));
    expect(window.today).toBe('2026-10-13');
    expect(window.span).toBe(30);
    expect(window.since).toBe('2026-09-14T04:00:00.000Z');
    expect(window.since7).toBe('2026-10-07T04:00:00.000Z');
  });

  it('keeps whole days across a clock change', () => {
    // New York goes back an hour on 1 November 2026.
    const window = usageWindow('America/New_York', new Date('2026-11-20T15:00:00Z'));
    expect(window.since).toBe('2026-10-22T04:00:00.000Z');
    expect(startOfLocalDay('2026-11-20', 'America/New_York')).toBe('2026-11-20T05:00:00.000Z');
  });
});

describe('fillDays', () => {
  it('gives every day of the period a value, zero where nothing happened', () => {
    const days = fillDays([{ day: '2026-10-12', value: 4 }], '2026-10-14', 5);
    expect(days).toEqual([
      { day: '2026-10-10', value: 0 },
      { day: '2026-10-11', value: 0 },
      { day: '2026-10-12', value: 4 },
      { day: '2026-10-13', value: 0 },
      { day: '2026-10-14', value: 0 },
    ]);
  });

  it('adds two values on one day and leaves out days outside the period', () => {
    const days = fillDays(
      [
        { day: '2026-10-14', value: 2 },
        { day: '2026-10-14', value: 3 },
        { day: '2026-10-15', value: 9 },
        { day: '2026-09-01', value: 9 },
      ],
      '2026-10-14',
      2,
    );
    expect(days).toEqual([
      { day: '2026-10-13', value: 0 },
      { day: '2026-10-14', value: 5 },
    ]);
  });
});

/** A client whose core RPC answers with `rows`, recording what it was asked. */
function rpcClient(rows: unknown[]) {
  const asked: { name: string; args: unknown }[] = [];
  const client = {
    schema: () => ({
      rpc: async (name: string, args: unknown) => {
        asked.push({ name, args });
        return { data: rows, error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, asked };
}

const window = usageWindow('America/New_York', new Date('2026-10-14T15:00:00Z'));

describe('readViewsPerDay', () => {
  it('asks for the window in the timezone and fills the month', async () => {
    const { client, asked } = rpcClient([{ day: '2026-10-14', views: 7 }]);
    const views = await readViewsPerDay(client, 'America/New_York', window);
    expect(asked).toEqual([
      { name: 'page_views_per_day', args: { p_timezone: 'America/New_York', p_since: window.since } },
    ]);
    expect(views).toHaveLength(30);
    expect(views.at(-1)).toEqual({ day: '2026-10-14', value: 7 });
    expect(views.slice(0, -1).every((day) => day.value === 0)).toBe(true);
  });
});

describe('readSpendPerDay', () => {
  it('sums priced spend into the bars and counts unpriced calls beside them', async () => {
    const { client } = rpcClient([
      { day: '2026-10-13', spend: '1250000', calls: 4, unpriced: 1 },
      { day: '2026-10-14', spend: 0, calls: 2, unpriced: 2 },
    ]);
    const spend = await readSpendPerDay(client, 'America/New_York', window);
    expect(spend.values).toHaveLength(30);
    expect(spend.values.slice(-2)).toEqual([
      { day: '2026-10-13', value: 1_250_000 },
      { day: '2026-10-14', value: 0 },
    ]);
    expect(spend).toMatchObject({ calls: 6, unpriced: 3 });
  });
});

describe('spendTotal', () => {
  it('adds the days of a period, so the Spend page lists what its bars add up to', () => {
    const values = fillDays(
      [
        { day: '2026-10-12', value: 650_000 },
        { day: '2026-10-14', value: 1_200_000 },
      ],
      '2026-10-14',
      30,
    );
    const total = spendTotal({ values, calls: 4, unpriced: 1 });
    expect(values).toHaveLength(30);
    expect(total).toEqual({ calls: 4, micros: 1_850_000, unpriced: 1 });
    expect(total.micros).toBe(values.reduce((sum, day) => sum + day.value, 0));
  });

  it('is nothing for a period with nothing in it', () => {
    expect(spendTotal({ values: fillDays([], '2026-10-14', 30), calls: 0, unpriced: 0 })).toEqual({
      calls: 0,
      micros: 0,
      unpriced: 0,
    });
  });
});
