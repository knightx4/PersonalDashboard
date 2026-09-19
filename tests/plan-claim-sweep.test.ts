/**
 * The cron stage that puts back a claim nothing is working.
 *
 * `in_progress` is written when a step is claimed and nothing has ever cleared
 * it, so a session that died at lunchtime left the plan saying its step was
 * underway -- to the page, the CLI, the brief and the next session alike. The
 * two properties covered here are that the sweep only touches claims that have
 * stopped meaning anything, and that it says in the step's own comment why the
 * claim was taken back.
 *
 * The third is #573's: before it takes a step off a session it asks GitHub
 * what that session has pushed, and a run still pushing keeps its step however
 * long it has been going. Both directions of that are covered below, including
 * every way the ask can come back with nothing, since each of those has to
 * leave the sweep behaving exactly as it did before.
 *
 * The fourth is #679's, and it is the one thing that can undo the third: a
 * block under the step is the session saying it has stopped, so the claim goes
 * back however recently that session pushed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseStaleClaims } from '@/inngest/dev/claims';
import { STALLED_AFTER_MINUTES } from '@/lib/plan/elapsed';
import { QUIET_AFTER_MINUTES } from '@/lib/plan/liveness';

type Row = Record<string, unknown>;

const NOW = new Date('2026-03-02T12:00:00Z');
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

/**
 * Enough of the query builder for the reads and the updates it makes.
 * Filters are ignored except the `status` one on the update, which is the
 * guard against writing over a step that closed while the sweep was running.
 *
 * The runs are a second table and read-only: the sweep asks which run holds
 * each condemned step and writes nothing back to `plan_runs`.
 */
function stubClient(rows: Row[], runs: Row[] = [], blocks: Record<string, string> = {}) {
  const updates: Array<{ id: unknown; patch: Row }> = [];
  const asked: string[] = [];

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

  const runReads = () => ({
    select: () => ({ in: () => ({ order: async () => ({ data: runs, error: null }) }) }),
  });

  const from = (table: string) => (table === 'plan_runs' ? runReads() : builder());

  // `plan_subtree_blocked_at`: the newest block under the step, which the
  // sweep asks about only once a run has saved the claim.
  const rpc = async (_fn: string, args: { root: string }) => {
    asked.push(args.root);
    return { data: blocks[args.root] ?? null, error: null };
  };

  return { supabase: { from, rpc } as unknown as SupabaseClient, updates, rows, asked };
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

/** A run fired at a step this many minutes ago, still going as far as it knows. */
function run(over: Row = {}): Row {
  return {
    id: 'run-1',
    plan_item_id: 'a',
    status: 'started',
    created_at: minutesAgo(STALLED_AFTER_MINUTES + 40),
    ...over,
  };
}

/** GitHub's activity listing, with one entry per branch that moved. */
function pushed(...refs: Array<{ ref: string; minutes: number }>) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify(
          refs.map((push) => ({
            activity_type: 'push',
            ref: `refs/heads/${push.ref}`,
            after: 'abc1234',
            timestamp: minutesAgo(push.minutes),
          })),
        ),
        { status: 200 },
      ),
  );
}

describe('releaseStaleClaims', () => {
  it('leaves a claim a session could still be working', async () => {
    const { supabase, updates } = stubClient([claim()]);

    await expect(releaseStaleClaims(supabase, NOW)).resolves.toEqual({
      released: 0,
      steps: [],
      kept: [],
    });
    expect(updates).toHaveLength(0);
  });

  it('puts back a claim past the threshold and says why', async () => {
    const { supabase, updates, rows } = stubClient([
      claim({ started_at: minutesAgo(STALLED_AFTER_MINUTES + 40) }),
    ]);

    await expect(releaseStaleClaims(supabase, NOW)).resolves.toEqual({
      released: 1,
      steps: [42],
      kept: [],
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

    await expect(releaseStaleClaims(supabase, NOW)).resolves.toEqual({
      released: 1,
      steps: [42],
      kept: [],
    });
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
      kept: [],
    });
  });
});

/**
 * The look at GitHub, in both directions. #573.
 *
 * The sweep is allowed to keep a claim the clock condemned and is not allowed
 * to take one the clock did not, so every case here starts from a claim past
 * the two-hour mark and the only question is whether what the run pushed saves
 * it.
 */
describe('releaseStaleClaims against what the run pushed', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** A claim the clock has condemned: two hours and forty minutes old. */
  const condemned = () => claim({ started_at: minutesAgo(STALLED_AFTER_MINUTES + 40) });

  it('keeps the step of a run that pushed a few minutes ago', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, updates, rows } = stubClient([condemned()], [run()]);

    await expect(
      releaseStaleClaims(supabase, NOW, { fetch: pushed({ ref: 'claude/one', minutes: 6 }) as never }),
    ).resolves.toEqual({ released: 0, steps: [], kept: [42] });
    expect(updates).toHaveLength(0);
    expect(rows[0].status).toBe('in_progress');
  });

  it('keeps the step of a run that has gone quiet but not ended', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, updates } = stubClient([condemned()], [run()]);

    const fetchFn = pushed({ ref: 'claude/one', minutes: QUIET_AFTER_MINUTES + 5 });
    await expect(releaseStaleClaims(supabase, NOW, { fetch: fetchFn as never })).resolves.toEqual({
      released: 0,
      steps: [],
      kept: [42],
    });
    expect(updates).toHaveLength(0);
  });

  it('takes the step back when nothing was pushed past the ended mark', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, updates } = stubClient([condemned()], [run()]);

    await expect(
      releaseStaleClaims(supabase, NOW, { fetch: pushed({ ref: 'claude/one', minutes: 180 }) as never }),
    ).resolves.toEqual({ released: 1, steps: [42], kept: [] });
    expect(updates[0].patch.comment).toBe(
      'Claim expired 2026-03-02: nothing had touched it for 2h 40m, so it went back to not started.',
    );
  });

  it('takes the step back when the run pushed nothing at all', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase } = stubClient([condemned()], [run()]);

    await expect(releaseStaleClaims(supabase, NOW, { fetch: pushed() as never })).resolves.toEqual({
      released: 1,
      steps: [42],
      kept: [],
    });
  });

  it('falls back to the clock when GitHub refuses to say', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', '');
    const { supabase, updates } = stubClient([condemned()], [run()]);
    const fetchFn = pushed({ ref: 'claude/one', minutes: 6 });

    await expect(releaseStaleClaims(supabase, NOW, { fetch: fetchFn as never })).resolves.toEqual({
      released: 1,
      steps: [42],
      kept: [],
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(updates[0].patch.status).toBe('not_started');
  });

  it('falls back to the clock for a step with no run recorded', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase } = stubClient([condemned()], []);
    const fetchFn = pushed({ ref: 'claude/one', minutes: 6 });

    await expect(releaseStaleClaims(supabase, NOW, { fetch: fetchFn as never })).resolves.toEqual({
      released: 1,
      steps: [42],
      kept: [],
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('takes the step back when its run was already written off', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase } = stubClient([condemned()], [run({ status: 'failed' })]);

    await expect(
      releaseStaleClaims(supabase, NOW, { fetch: pushed({ ref: 'claude/one', minutes: 6 }) as never }),
    ).resolves.toEqual({ released: 1, steps: [42], kept: [] });
  });

  it('takes the step back when a block under it is newer than its run', async () => {
    // The run pushed a few minutes ago, so what it did says it was working.
    // The block says the session behind it has stopped: it wrote down what it
    // needs, and nothing more is coming from it. #679.
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, updates } = stubClient([condemned()], [run()], { a: minutesAgo(20) });

    await expect(
      releaseStaleClaims(supabase, NOW, { fetch: pushed({ ref: 'claude/one', minutes: 6 }) as never }),
    ).resolves.toEqual({ released: 1, steps: [42], kept: [] });
    expect(updates[0].patch.status).toBe('not_started');
  });

  it('keeps the step when the only block under it is older than its run', async () => {
    // A step that was already blocked when this session was sent at it. The
    // question it asks is the one the session is there to answer.
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, updates } = stubClient([condemned()], [run()], {
      a: minutesAgo(STALLED_AFTER_MINUTES + 90),
    });

    await expect(
      releaseStaleClaims(supabase, NOW, { fetch: pushed({ ref: 'claude/one', minutes: 6 }) as never }),
    ).resolves.toEqual({ released: 0, steps: [], kept: [42] });
    expect(updates).toHaveLength(0);
  });

  it('asks for a block only about the claims its run saved', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, asked } = stubClient([condemned()], [run()]);

    await releaseStaleClaims(supabase, NOW, {
      fetch: pushed({ ref: 'claude/one', minutes: 180 }) as never,
    });
    expect(asked).toEqual([]);
  });

  it('asks nothing when no claim is up for being taken back', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase } = stubClient([claim()], [run()]);
    const fetchFn = pushed({ ref: 'claude/one', minutes: 6 });

    await releaseStaleClaims(supabase, NOW, { fetch: fetchFn as never });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
