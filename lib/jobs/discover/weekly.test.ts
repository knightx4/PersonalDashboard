import { describe, expect, it, vi } from 'vitest';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { planFor, runWeeklyDiscovery, weekStart } from './weekly';

const NOW = new Date('2026-10-12T06:17:00Z'); // a Monday

describe('weekStart', () => {
  it('is the Monday of the week, in UTC', () => {
    expect(weekStart(new Date('2026-10-12T06:17:00Z'))).toBe('2026-10-12');
    expect(weekStart(new Date('2026-10-18T23:59:00Z'))).toBe('2026-10-12');
    expect(weekStart(new Date('2026-10-19T00:00:00Z'))).toBe('2026-10-19');
  });
});

describe('planFor', () => {
  const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
  it('shortlists when there is no row', () => {
    expect(planFor(null, NOW)).toBe('shortlist');
  });
  it('skips a finished week and a run still working', () => {
    expect(planFor({ stage: 'done', started_at: at(5000), shortlisted_at: at(5000) }, NOW)).toBe('skip');
    expect(planFor({ stage: 'shortlisting', started_at: at(2), shortlisted_at: null }, NOW)).toBe('skip');
  });
  it('picks up a cut-off or failed run where it stopped', () => {
    expect(planFor({ stage: 'shortlisting', started_at: at(30), shortlisted_at: null }, NOW)).toBe('shortlist');
    expect(planFor({ stage: 'failed', started_at: at(1), shortlisted_at: null }, NOW)).toBe('shortlist');
    expect(planFor({ stage: 'boards', started_at: at(30), shortlisted_at: at(31) }, NOW)).toBe('boards');
    expect(planFor({ stage: 'failed', started_at: at(1), shortlisted_at: at(2) }, NOW)).toBe('boards');
  });

  it('runs a finished week again when the person asks, but never joins a working run', () => {
    expect(planFor({ stage: 'done', started_at: at(5000), shortlisted_at: at(5000) }, NOW, true)).toBe('shortlist');
    expect(planFor({ stage: 'failed', started_at: at(1), shortlisted_at: at(2) }, NOW, true)).toBe('shortlist');
    expect(planFor({ stage: 'boards', started_at: at(2), shortlisted_at: at(2) }, NOW, true)).toBe('skip');
    expect(planFor(null, NOW, true)).toBe('shortlist');
  });
});

/** A one-table fake: remembers the row, answers the three calls the run makes. */
function fake(existing: Record<string, unknown> | null) {
  let row: Record<string, unknown> | null = existing ? { id: 'r1', ...existing } : null;
  const patches: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      select: () => {
        const chain = { eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
        return chain;
      },
      insert: (values: Record<string, unknown>) => {
        row = { id: 'r1', stage: 'reading', shortlisted_at: null, ...values };
        return { select: () => ({ single: async () => ({ data: { id: 'r1' }, error: null }) }) };
      },
      update: (patch: Record<string, unknown>) => {
        patches.push(patch);
        row = { ...row!, ...patch };
        const chain = { eq: () => chain, then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
        return chain;
      },
    }),
  } as unknown as AppSupabaseClient;
  return { client, patches };
}

const shortlisted = { ok: true, offered: 200, cut: 0, added: 30, refreshed: 5, spend: [], error: null };
const boardsDone = { checked: 20, found: 8, left: 3 };

describe('runWeeklyDiscovery', () => {
  it('shortlists once, finds boards and records the week', async () => {
    const { client, patches } = fake(null);
    const shortlist = vi.fn().mockResolvedValue(shortlisted);
    const boards = vi.fn().mockResolvedValue(boardsDone);
    const out = await runWeeklyDiscovery(client, 'u', { apiKey: 'k', now: NOW, deadline: Date.now() + 1e6, shortlist, boards });
    expect(out).toMatchObject({ state: 'done', added: 30, boardsFound: 8, boardsLeft: 3 });
    expect(patches.at(-1)).toMatchObject({ stage: 'done', boards_left: 3 });
    expect(shortlist).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a week already done', async () => {
    const { client } = fake({ stage: 'done', started_at: '2026-10-12T06:00:00Z', shortlisted_at: '2026-10-12T06:01:00Z' });
    const shortlist = vi.fn();
    const boards = vi.fn();
    const out = await runWeeklyDiscovery(client, 'u', { apiKey: 'k', now: NOW, deadline: Date.now() + 1e6, shortlist, boards });
    expect(out.state).toBe('skipped');
    expect(shortlist).not.toHaveBeenCalled();
    expect(boards).not.toHaveBeenCalled();
  });

  it('does not ask Dash again when only the boards step is left', async () => {
    const { client } = fake({ stage: 'failed', started_at: '2026-10-12T06:00:00Z', shortlisted_at: '2026-10-12T06:01:00Z' });
    const shortlist = vi.fn();
    const boards = vi.fn().mockResolvedValue(boardsDone);
    const out = await runWeeklyDiscovery(client, 'u', { apiKey: 'k', now: NOW, deadline: Date.now() + 1e6, shortlist, boards });
    expect(out.state).toBe('done');
    expect(shortlist).not.toHaveBeenCalled();
  });

  it('records a failed shortlist and goes no further', async () => {
    const { client, patches } = fake(null);
    const shortlist = vi.fn().mockResolvedValue({ ...shortlisted, ok: false, error: 'Dash took too long over the shortlist.' });
    const boards = vi.fn();
    const out = await runWeeklyDiscovery(client, 'u', { apiKey: 'k', now: NOW, deadline: Date.now() + 1e6, shortlist, boards });
    expect(out).toMatchObject({ state: 'failed', error: 'Dash took too long over the shortlist.' });
    expect(patches.at(-1)).toMatchObject({ stage: 'failed' });
    expect(boards).not.toHaveBeenCalled();
  });

  it('records a feed failure as the failure', async () => {
    const { client } = fake(null);
    const shortlist = vi.fn().mockRejectedValue(new Error('YC feed down'));
    const out = await runWeeklyDiscovery(client, 'u', { apiKey: 'k', now: NOW, deadline: Date.now() + 1e6, shortlist, boards: vi.fn() });
    expect(out).toMatchObject({ state: 'failed', error: 'YC feed down' });
  });
});
