/**
 * The cron stage that puts back a claim nothing is working.
 *
 * `in_progress` is written when a step is claimed and nothing has ever cleared
 * it, so a session that died at lunchtime left the plan saying its step was
 * underway -- to the page, the CLI, the brief and the next session alike. The
 * two properties covered here are that the sweep only touches claims that have
 * stopped meaning anything, and that it says in the step's own comment why the
 * claim was taken back.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseStaleClaims } from '@/inngest/dev/claims';
import { STALLED_AFTER_MINUTES } from '@/lib/plan/elapsed';

type Row = Record<string, unknown>;

const NOW = new Date('2026-03-02T12:00:00Z');
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

/**
 * Enough of the query builder for the one read and the updates it makes.
 * Filters are ignored except the `status` one on the update, which is the
 * guard against writing over a step that closed while the sweep was running.
 */
function stubClient(rows: Row[]) {
  const updates: Array<{ id: unknown; patch: Row }> = [];

  const builder = () => {
    let patch: Row | null = null;
    let id: unknown = null;
    let requiredStatus: unknown = null;

    const self = {
      select: () => self,
      limit: () => self,
      update: (next: Row) => {
        patch = next;
        return self;
      },
      eq: (column: string, value: unknown) => {
        if (patch && column === 'id') id = value;
        if (patch && column === 'status') requiredStatus = value;
        return self;
      },
      then: (resolve: (value: { data: Row[] | null; error: null }) => unknown) => {
        if (!patch) return resolve({ data: rows, error: null });
        const row = rows.find((candidate) => candidate.id === id);
        if (row && (requiredStatus === null || row.status === requiredStatus)) {
          Object.assign(row, patch);
          updates.push({ id, patch });
        }
        return resolve({ data: null, error: null });
      },
    };
    return self;
  };

  return { supabase: { from: builder } as unknown as SupabaseClient, updates, rows };
}

function claim(over: Row = {}): Row {
  return {
    id: 'a',
    number: 42,
    status: 'in_progress',
    assignee: 'claude',
    started_at: minutesAgo(10),
    comment: null,
    ...over,
  };
}

describe('releaseStaleClaims', () => {
  it('leaves a claim a session could still be working', async () => {
    const { supabase, updates } = stubClient([claim()]);

    await expect(releaseStaleClaims(supabase, NOW)).resolves.toEqual({ released: 0, steps: [] });
    expect(updates).toHaveLength(0);
  });

  it('puts back a claim past the threshold and says why', async () => {
    const { supabase, updates, rows } = stubClient([
      claim({ started_at: minutesAgo(STALLED_AFTER_MINUTES + 40) }),
    ]);

    await expect(releaseStaleClaims(supabase, NOW)).resolves.toEqual({
      released: 1,
      steps: [42],
    });
    expect(updates[0].patch.status).toBe('not_started');
    expect(updates[0].patch.comment).toBe(
      'Claim expired 2026-03-02: nothing had touched it for 2h 40m, so it went back to not started.',
    );
    expect(rows[0].status).toBe('not_started');
  });

  it('keeps what the step already said and adds the line under it', async () => {
    const { supabase, updates } = stubClient([
      claim({ comment: 'Blocked 2026-03-01: waiting on the key.', started_at: minutesAgo(600) }),
    ]);

    await releaseStaleClaims(supabase, NOW);
    expect(updates[0].patch.comment).toBe(
      'Blocked 2026-03-01: waiting on the key.\n\n' +
        'Claim expired 2026-03-02: nothing had touched it for 10h, so it went back to not started.',
    );
  });

  it('puts back a claim nobody holds, however recent', async () => {
    const { supabase, updates } = stubClient([claim({ assignee: null, started_at: minutesAgo(1) })]);

    await expect(releaseStaleClaims(supabase, NOW)).resolves.toEqual({ released: 1, steps: [42] });
    expect(updates[0].patch.comment).toBe(
      'Claim expired 2026-03-02: it was underway with nobody holding it, so it went back to not started.',
    );
  });

  it('takes back the stale claims and leaves the live ones', async () => {
    const { supabase } = stubClient([
      claim({ id: 'a', number: 1, started_at: minutesAgo(5) }),
      claim({ id: 'b', number: 2, started_at: minutesAgo(60 * 30) }),
      claim({ id: 'c', number: 3, started_at: minutesAgo(STALLED_AFTER_MINUTES) }),
    ]);

    await expect(releaseStaleClaims(supabase, NOW)).resolves.toEqual({
      released: 2,
      steps: [2, 3],
    });
  });
});
