import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURE_ROUTINE_ID } from '@/lib/feedback/routine';
import {
  endQuietRuns,
  endRunsOnStep,
  readRunLiveness,
  refreshRunReadings,
  runRowFor,
  startRoutineRun,
} from '@/lib/plan/runs';

/** A fire that succeeded, with whatever body the endpoint answered with. */
function started(body: unknown, runId: string | null) {
  return { ok: true as const, detail: 'The routine is running.', status: 200, body, runId };
}

describe('runRowFor', () => {
  it('records a started run against the step it is about', () => {
    const row = runRowFor({
      userId: 'user-1',
      job: 'step',
      routineId: 'trig_plan',
      planItemId: 'step-1',
      result: started({ run_id: 'run_1' }, 'run_1'),
    });

    expect(row).toEqual({
      user_id: 'user-1',
      plan_item_id: 'step-1',
      job: 'step',
      routine_id: 'trig_plan',
      external_id: 'run_1',
      status: 'started',
      http_status: 200,
      response: { run_id: 'run_1' },
      error: null,
    });
  });

  it('records a run that never started as failed, with the reason', () => {
    const row = runRowFor({
      userId: 'user-1',
      job: 'notes',
      routineId: 'trig_notes',
      result: {
        ok: false,
        error: 'Anthropic answered 401. invalid x-api-key',
        status: 401,
        body: { error: { message: 'invalid x-api-key' } },
      },
    });

    expect(row.status).toBe('failed');
    expect(row.error).toBe('Anthropic answered 401. invalid x-api-key');
    expect(row.http_status).toBe(401);
    expect(row.response).toEqual({ error: { message: 'invalid x-api-key' } });
    expect(row.external_id).toBeNull();
    expect(row.plan_item_id).toBeNull();
  });

  it('names the routine the request went to, not the one nobody set', () => {
    const row = runRowFor({
      userId: 'user-1',
      job: 'shape',
      routineId: null,
      result: started(null, null),
    });

    expect(row.routine_id).toBe(DEFAULT_FEATURE_ROUTINE_ID);
  });

  it('keeps a body that is not an object', () => {
    const row = runRowFor({
      userId: 'user-1',
      job: 'review',
      routineId: 'trig_review',
      result: started('accepted', null),
    });

    expect(row.response).toBe('accepted');
    expect(row.external_id).toBeNull();
  });
});

describe('startRoutineRun', () => {
  /** The one call the recorder makes, with the row it made. */
  function db() {
    const insert = vi.fn(async () => ({ error: null }));
    return { insert, supabase: { from: vi.fn(() => ({ insert })) } };
  }

  it('fires the routine and writes the run down', async () => {
    const { insert, supabase } = db();
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ run_id: 'run_9' }), { status: 200 }),
    );

    const result = await startRoutineRun({
      supabase: supabase as never,
      userId: 'user-1',
      job: 'feature',
      routine: { id: 'trig_plan', token: 'oat_plan' },
      planItemId: 'step-2',
      text: 'work the feature',
      fetch: fetchFn as never,
    });

    expect(result.ok).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('plan_runs');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        job: 'feature',
        plan_item_id: 'step-2',
        status: 'started',
        external_id: 'run_9',
      }),
    );
  });

  it('writes a row for a press that failed, and says so to the caller', async () => {
    const { insert, supabase } = db();

    const result = await startRoutineRun({
      supabase: supabase as never,
      userId: 'user-1',
      job: 'notes',
      routine: { id: 'trig_notes', token: null },
      fetch: vi.fn() as never,
    });

    expect(result.ok).toBe(false);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('reports the fire even when the row could not be written', async () => {
    const insert = vi.fn(async () => ({ error: { message: 'insert refused' } }));
    const supabase = { from: vi.fn(() => ({ insert })) };
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await startRoutineRun({
      supabase: supabase as never,
      userId: 'user-1',
      job: 'queue',
      routine: { id: 'trig_plan', token: 'oat_plan' },
      fetch: fetchFn as never,
    });

    expect(result.ok).toBe(true);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

const NOW = Date.parse('2026-09-17T12:00:00Z');

/** An instant, as minutes before `NOW`, in the shape a row carries. */
function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

/** The pushes a caller has already read, in the shape the sweep takes them. */
function pushes(...refs: Array<{ ref: string; minutes: number }>) {
  return refs.map((push) => ({ ref: push.ref, sha: 'abc1234', at: minutesAgo(push.minutes) }));
}

/** GitHub answering the activity listing with these pushes and nothing else. */
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

describe('endQuietRuns', () => {
  /** The runs, the steps they were sent at, and what got written back. */
  function db(
    runs: Array<{ id: string; plan_item_id: string | null; created_at: string }>,
    steps: Array<{ id: string; completed_at: string | null }> = [],
  ) {
    const updates: Array<{ values: Record<string, unknown>; ids: string[] }> = [];
    const supabase = {
      from(table: string) {
        if (table === 'plan_items') {
          return { select: () => ({ in: async () => ({ data: steps, error: null }) }) };
        }
        return {
          select: () => ({ eq: () => ({ eq: async () => ({ data: runs, error: null }) }) }),
          update: (values: Record<string, unknown>) => ({
            in: async (_column: string, ids: string[]) => {
              updates.push({ values, ids });
              return { error: null };
            },
            eq: async (_column: string, id: string) => {
              updates.push({ values, ids: [id] });
              return { error: null };
            },
          }),
        };
      },
    };
    return { supabase, updates };
  }

  it('leaves a run that is still pushing alone, however long it has been going', async () => {
    const { supabase, updates } = db([
      { id: 'run-1', plan_item_id: 'step-1', created_at: minutesAgo(300) },
    ]);

    const result = await endQuietRuns({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
      pushes: pushes({ ref: 'claude/one', minutes: 4 }),
    });

    expect(result).toEqual({ finished: 0, failed: 0, error: null });
    expect(updates).toEqual([]);
  });

  it('ends a run that has pushed nothing for two hours, saying what it last did', async () => {
    const { supabase, updates } = db([
      { id: 'run-1', plan_item_id: 'step-1', created_at: minutesAgo(300) },
    ]);

    const result = await endQuietRuns({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
      pushes: pushes({ ref: 'claude/one', minutes: 125 }),
    });

    expect(result.failed).toBe(1);
    expect(updates).toEqual([
      {
        values: {
          status: 'failed',
          error: 'Nothing has been pushed for 2h 5m. The last was claude/one.',
        },
        ids: ['run-1'],
      },
    ]);
  });

  it('finishes a run whose step closed after it was fired', async () => {
    const { supabase, updates } = db(
      [{ id: 'run-1', plan_item_id: 'step-1', created_at: minutesAgo(300) }],
      [{ id: 'step-1', completed_at: minutesAgo(200) }],
    );

    const result = await endQuietRuns({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
      pushes: [],
    });

    expect(result.finished).toBe(1);
    expect(updates).toEqual([{ values: { status: 'finished' }, ids: ['run-1'] }]);
  });

  it('falls back to the clock when nobody has read what was pushed', async () => {
    const { supabase, updates } = db([
      { id: 'run-1', plan_item_id: 'step-1', created_at: minutesAgo(300) },
    ]);

    const result = await endQuietRuns({ supabase: supabase as never, userId: 'user-1', now: NOW });

    expect(result.failed).toBe(1);
    expect(updates[0].values.error).toBe('Nothing was heard from this run for 5h.');
  });
});

describe('readRunLiveness', () => {
  /** The claimed steps and the runs sent at them. */
  function db(
    steps: Array<{ id: string; status: string; completed_at: string | null }>,
    runs: Array<{ id: string; plan_item_id: string; created_at: string }>,
  ) {
    return {
      from(table: string) {
        if (table === 'plan_items') {
          return {
            select: () => ({ eq: () => ({ eq: async () => ({ data: steps, error: null }) }) }),
          };
        }
        return {
          select: () => ({
            eq: () => ({ in: () => ({ order: async () => ({ data: runs, error: null }) }) }),
          }),
        };
      },
    };
  }

  it('says a claimed step is being worked when its run is pushing', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const supabase = db(
      [{ id: 'step-1', status: 'in_progress', completed_at: null }],
      [{ id: 'run-1', plan_item_id: 'step-1', created_at: minutesAgo(45) }],
    );

    const { steps, error } = await readRunLiveness({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
      fetch: pushed({ ref: 'claude/one', minutes: 6 }) as never,
    });

    expect(error).toBeNull();
    expect(steps['step-1']).toMatchObject({
      runId: 'run-1',
      liveness: 'working',
      abandoned: false,
    });
    expect(steps['step-1'].lastPush?.ref).toBe('claude/one');
    vi.unstubAllEnvs();
  });

  it('names a claim whose run ended without closing the step', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const supabase = db(
      [{ id: 'step-1', status: 'in_progress', completed_at: null }],
      [{ id: 'run-1', plan_item_id: 'step-1', created_at: minutesAgo(300) }],
    );

    const { steps } = await readRunLiveness({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
      fetch: pushed({ ref: 'claude/one', minutes: 200 }) as never,
    });

    expect(steps['step-1']).toMatchObject({ liveness: 'ended', abandoned: true });
    vi.unstubAllEnvs();
  });

  it('reads nothing for a step nobody fired a run at', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const supabase = db([{ id: 'step-1', status: 'in_progress', completed_at: null }], []);

    const { steps, error } = await readRunLiveness({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
      fetch: pushed() as never,
    });

    expect(steps).toEqual({});
    expect(error).toBeNull();
    vi.unstubAllEnvs();
  });

  it('carries back the reason GitHub could not be read, and claims nothing', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', '');
    const supabase = db(
      [{ id: 'step-1', status: 'in_progress', completed_at: null }],
      [{ id: 'run-1', plan_item_id: 'step-1', created_at: minutesAgo(300) }],
    );

    const { steps, error } = await readRunLiveness({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
    });

    expect(error).toBe('No GITHUB_READ_TOKEN is set, so pushes cannot be read.');
    expect(steps['step-1']).toMatchObject({ liveness: 'unknown', abandoned: false });
    vi.unstubAllEnvs();
  });
});

describe('refreshRunReadings', () => {
  /**
   * The claimed steps, the runs sent at them, and what got written back.
   *
   * One fake for both halves of the call: the reader asks for the claimed steps
   * and the runs against them, and the sweep that follows asks for the runs
   * still reading `started` and for which of those steps have closed.
   */
  function db(
    steps: Array<{ id: string; status: string; completed_at: string | null }>,
    runs: Array<{ id: string; plan_item_id: string; created_at: string }>,
  ) {
    const writes: Array<{ values: Record<string, unknown>; ids: string[] }> = [];
    const answered = <T>(data: T) => Promise.resolve({ data, error: null });

    const supabase = {
      from(table: string) {
        if (table === 'plan_items') {
          return {
            select: () => ({
              eq: () => ({ eq: () => answered(steps) }),
              in: () => answered(steps),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => answered(runs),
              in: () => ({ order: () => answered(runs) }),
            }),
          }),
          update: (values: Record<string, unknown>) => ({
            in: (_column: string, ids: string[]) => {
              writes.push({ values, ids });
              return Object.assign(Promise.resolve({ error: null }), {
                eq: async () => ({ error: null }),
              });
            },
            eq: async (_column: string, id: string) => {
              writes.push({ values, ids: [id] });
              return { error: null };
            },
          }),
        };
      },
    };
    return { supabase, writes };
  }

  /** GitHub answering the activity listing, and the message behind a commit. */
  function github(activity: Array<{ ref: string; minutes: number }>, subject?: string) {
    return vi.fn(async (url: string) => {
      if (String(url).includes('/activity')) {
        return new Response(
          JSON.stringify(
            activity.map((push) => ({
              activity_type: 'push',
              ref: `refs/heads/${push.ref}`,
              after: 'abc1234',
              timestamp: minutesAgo(push.minutes),
            })),
          ),
          { status: 200 },
        );
      }
      if (subject) {
        return new Response(JSON.stringify({ commit: { message: `${subject}\n\nA body.` } }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 404 });
    });
  }

  it('writes what GitHub said onto the run, with the first line of the commit', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, writes } = db(
      [{ id: 'step-1', status: 'in_progress', completed_at: null }],
      [{ id: 'run-1', plan_item_id: 'step-1', created_at: minutesAgo(45) }],
    );

    const result = await refreshRunReadings({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
      fetch: github(
        [{ ref: 'claude/one', minutes: 6 }],
        'Read a step wanting an answer (plan #1)',
      ) as never,
    });

    expect(result.error).toBeNull();
    expect(result.written).toBe(1);
    expect(writes).toEqual([
      {
        values: {
          github_checked_at: new Date(NOW).toISOString(),
          last_push_at: minutesAgo(6),
          last_push_sha: 'abc1234',
          last_push_subject: 'Read a step wanting an answer (plan #1)',
          github_error: null,
        },
        ids: ['run-1'],
      },
    ]);
    expect(result.readings['step-1'].lastPush?.subject).toBe(
      'Read a step wanting an answer (plan #1)',
    );
    vi.unstubAllEnvs();
  });

  it('writes the check with no push when the run had pushed nothing', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, writes } = db(
      [{ id: 'step-1', status: 'in_progress', completed_at: null }],
      [{ id: 'run-1', plan_item_id: 'step-1', created_at: minutesAgo(25) }],
    );

    const result = await refreshRunReadings({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
      fetch: github([]) as never,
    });

    expect(result.error).toBeNull();
    expect(writes[0].values).toEqual({
      github_checked_at: new Date(NOW).toISOString(),
      last_push_at: null,
      last_push_sha: null,
      last_push_subject: null,
      github_error: null,
    });
    expect(result.readings['step-1']).toEqual({
      checkedAt: new Date(NOW).toISOString(),
      lastPush: null,
      refusal: null,
    });
    vi.unstubAllEnvs();
  });

  it('writes why GitHub refused, and no push beside it', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', '');
    const { supabase, writes } = db(
      [{ id: 'step-1', status: 'in_progress', completed_at: null }],
      [{ id: 'run-1', plan_item_id: 'step-1', created_at: minutesAgo(45) }],
    );

    const result = await refreshRunReadings({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
    });

    expect(result.error).toBe('No GITHUB_READ_TOKEN is set, so pushes cannot be read.');
    expect(writes[0]).toEqual({
      values: {
        github_checked_at: new Date(NOW).toISOString(),
        last_push_at: null,
        last_push_sha: null,
        last_push_subject: null,
        github_error: 'No GITHUB_READ_TOKEN is set, so pushes cannot be read.',
      },
      ids: ['run-1'],
    });
    expect(result.readings['step-1'].refusal).toBe(
      'No GITHUB_READ_TOKEN is set, so pushes cannot be read.',
    );
    vi.unstubAllEnvs();
  });

  it('leaves a long run alone while it is still pushing, on the same listing', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, writes } = db(
      [{ id: 'step-1', status: 'in_progress', completed_at: null }],
      [{ id: 'run-1', plan_item_id: 'step-1', created_at: minutesAgo(300) }],
    );

    await refreshRunReadings({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
      fetch: github([{ ref: 'claude/one', minutes: 4 }], 'Still going (plan #2)') as never,
    });

    // The reading, and nothing writing the run off.
    expect(writes).toHaveLength(1);
    expect(writes[0].values.github_checked_at).toBe(new Date(NOW).toISOString());
    vi.unstubAllEnvs();
  });

  it('writes nothing about a claimed step nobody fired a run at', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, writes } = db(
      [{ id: 'step-1', status: 'in_progress', completed_at: null }],
      [],
    );

    const result = await refreshRunReadings({
      supabase: supabase as never,
      userId: 'user-1',
      now: NOW,
      fetch: github([]) as never,
    });

    expect(result).toEqual({ readings: {}, written: 0, error: null });
    expect(writes).toEqual([]);
    vi.unstubAllEnvs();
  });
});

/**
 * A client that records the update it was handed and the filters on it.
 *
 * `endRunsOnStep` is one write with three filters, and the filters are the
 * whole of its correctness -- a missing one would write off another step's run
 * or another person's.
 */
type UpdateChain = Promise<{ error: { message: string } | null }> & {
  eq(column: string, value: string): UpdateChain;
};

function updateDb(error: { message: string } | null = null) {
  const calls: Array<{
    table: string;
    values: Record<string, unknown>;
    filters: Record<string, string>;
  }> = [];

  const supabase = {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        const filters: Record<string, string> = {};
        calls.push({ table, values, filters });
        const chain = Promise.resolve({ error }) as UpdateChain;
        chain.eq = (column: string, value: string) => {
          filters[column] = value;
          return chain;
        };
        return chain;
      },
    }),
  };

  return { supabase, calls };
}

describe('endRunsOnStep', () => {
  it('writes off every run still going against that one step, with the reason', async () => {
    const { supabase, calls } = updateDb();

    await endRunsOnStep({
      supabase: supabase as never,
      userId: 'user-1',
      stepId: 'step-1',
      note: 'The step was handed to a fresh session while this run was quiet.',
    });

    expect(calls).toEqual([
      {
        table: 'plan_runs',
        values: {
          status: 'failed',
          error: 'The step was handed to a fresh session while this run was quiet.',
        },
        filters: { user_id: 'user-1', plan_item_id: 'step-1', status: 'started' },
      },
    ]);
  });

  it('logs a write it could not make rather than failing the send behind it', async () => {
    const { supabase } = updateDb({ message: 'update refused' });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      endRunsOnStep({
        supabase: supabase as never,
        userId: 'user-1',
        stepId: 'step-1',
        note: 'Replaced.',
      }),
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
