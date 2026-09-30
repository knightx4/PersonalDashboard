import { describe, expect, it } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { countTowards } from '@/lib/goals/rhythms-store';

type PeriodRow = {
  id: string;
  item_id: string;
  starts_on: string;
  target: number;
  count: number;
  kept: boolean | null;
  closed_at: string | null;
};

/** goals.periods in memory, answering the filters countTowards uses. */
function fakeClient(rows: PeriodRow[]) {
  return {
    from() {
      const filters: ((row: PeriodRow) => boolean)[] = [];
      let patch: Partial<PeriodRow> | null = null;
      const matching = () => rows.filter((row) => filters.every((f) => f(row)));
      const query = {
        select: () => query,
        update(values: Partial<PeriodRow>) {
          patch = values;
          return query;
        },
        eq(column: keyof PeriodRow, value: unknown) {
          filters.push((row) => row[column] === value);
          return query;
        },
        is(column: keyof PeriodRow, value: null) {
          filters.push((row) => row[column] === value);
          return query;
        },
        not(column: keyof PeriodRow) {
          filters.push((row) => row[column] !== null);
          return query;
        },
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        then(resolve: (value: { data: PeriodRow[]; error: null }) => unknown) {
          const hit = matching();
          if (patch) for (const row of hit) Object.assign(row, patch);
          return resolve({ data: hit, error: null });
        },
      };
      return query;
    },
  } as unknown as GoalsSupabaseClient;
}

const lastWeek = (): PeriodRow => ({
  id: 'p1',
  item_id: 'apply',
  starts_on: '2026-09-21',
  target: 5,
  count: 3,
  kept: false,
  closed_at: '2026-09-28T00:00:00Z',
});

describe('countTowards (plan #1279)', () => {
  it('leaves a closed period alone unless told it may count there', async () => {
    const row = lastWeek();
    expect(await countTowards(fakeClient([row]), 'apply', '2026-09-21', 3)).toBe(false);
    expect(row.count).toBe(3);
  });

  it('adds several to a closed period, marks it kept, and takes the same number back', async () => {
    const row = lastWeek();
    const client = fakeClient([row]);
    expect(await countTowards(client, 'apply', '2026-09-21', 3, { closed: true })).toBe(true);
    expect(row).toMatchObject({ count: 6, kept: true });
    expect(await countTowards(client, 'apply', '2026-09-21', -3, { closed: true })).toBe(true);
    expect(row).toMatchObject({ count: 3, kept: false });
  });

  it('counts several towards an open period without touching kept', async () => {
    const row: PeriodRow = { ...lastWeek(), starts_on: '2026-09-28', count: 0, kept: null, closed_at: null };
    expect(await countTowards(fakeClient([row]), 'apply', '2026-09-28', 3)).toBe(true);
    expect(row).toMatchObject({ count: 3, kept: null });
  });

  it('never takes a count below nothing', async () => {
    const row = { ...lastWeek(), count: 1 };
    expect(await countTowards(fakeClient([row]), 'apply', '2026-09-21', -3, { closed: true })).toBe(true);
    expect(row.count).toBe(0);
  });
});
