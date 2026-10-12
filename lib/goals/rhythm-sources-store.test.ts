import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { readSourceCounts } from '@/lib/goals/rhythm-sources-store';
import { countKey, type LiveRhythm } from '@/lib/goals/rhythms';

vi.mock('server-only', () => ({}));

/** Answers each table from a fixture and records which tables were read. */
function fakeClient(tables: Record<string, unknown[]>) {
  const read: string[] = [];
  const query = (table: string) => {
    read.push(table);
    const builder: Record<string, unknown> = {
      maybeSingle: async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve),
    };
    for (const name of ['select', 'eq', 'gte', 'lt', 'or', 'limit']) builder[name] = () => builder;
    return builder;
  };
  const client = { schema: () => ({ from: query }) } as unknown as GoalsSupabaseClient;
  return { client, read };
}

const rhythm = (extra: Partial<LiveRhythm>): LiveRhythm => ({
  id: 'r',
  title: 'Rhythm',
  target: 1,
  period: 'week',
  goalId: 'g',
  goalTitle: 'Goal',
  ...extra,
});

const WEEK = { startsOn: '2026-09-28', endsOn: '2026-10-05' };

describe('readSourceCounts', () => {
  it('counts applications by the day they were sent in the account zone', async () => {
    const { client, read } = fakeClient({
      account_settings: [{ timezone: 'America/New_York' }],
      // 03:00 UTC on the 28th is still the 27th in New York: last week.
      applications: [
        { submitted_at: '2026-09-28T03:00:00Z' },
        { submitted_at: '2026-09-29T15:00:00Z' },
        { submitted_at: '2026-10-01T15:00:00Z' },
      ],
    });
    const jobs = rhythm({ id: 'jobs', target: 5, source: { kind: 'applications', match: null } });
    const counts = await readSourceCounts(client, 'u', [jobs], new Map([['jobs', [WEEK]]]), '2026-10-04');
    expect(counts.get(countKey('jobs', WEEK.startsOn))).toBe(2);
    expect(read.filter((t) => t === 'applications')).toHaveLength(1);
  });

  it('counts matching calendar events whose day has come, typed or from a feed', async () => {
    const { client } = fakeClient({
      account_settings: [{ timezone: 'UTC' }],
      events: [{ title: 'Urbanism walk', starts_on: '2026-09-29', starts_at: null }],
      feed_events: [
        { title: 'Community Board 6', starts_on: null, starts_at: '2026-10-01T23:00:00Z' },
        { title: 'Urbanism talk', starts_on: '2026-10-06', starts_at: null },
        { title: 'Dinner', starts_on: '2026-09-30', starts_at: null },
      ],
    });
    const events = rhythm({ source: { kind: 'calendar', match: 'urbanism|community board' } });
    const counts = await readSourceCounts(client, 'u', [events], new Map([['r', [WEEK]]]), '2026-10-04');
    expect(counts.get(countKey('r', WEEK.startsOn))).toBe(2);
  });

  it('reads nothing when no rhythm counts itself', async () => {
    const { client, read } = fakeClient({});
    const counts = await readSourceCounts(client, 'u', [rhythm({})], new Map(), '2026-10-04');
    expect(counts.size).toBe(0);
    expect(read).toEqual([]);
  });
});
