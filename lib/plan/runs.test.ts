import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURE_ROUTINE_ID } from '@/lib/feedback/routine';
import { runRowFor, startRoutineRun } from '@/lib/plan/runs';

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
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ run_id: 'run_9' }), { status: 200 }));

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
