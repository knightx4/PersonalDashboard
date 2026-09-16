import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FEATURE_ROUTINE_ID,
  fireFeatureRoutine,
  notesRoutine,
  planRoutine,
  resolveRoutineId,
  runIdFrom,
} from '@/lib/feedback/routine';

describe('fireFeatureRoutine', () => {
  it('says what is missing rather than calling with no key', async () => {
    const fetchFn = vi.fn();
    const result = await fireFeatureRoutine({ apiKey: null, fetch: fetchFn as never });
    expect(result).toMatchObject({ ok: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('posts to the routine with the documented headers', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const result = await fireFeatureRoutine({
      apiKey: 'sk-test',
      text: '  work the queue  ',
      fetch: fetchFn as never,
    });

    expect(result.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.anthropic.com/v1/claude_code/routines/${DEFAULT_FEATURE_ROUTINE_ID}/fire`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk-test',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
    });
    expect(JSON.parse(String(init.body))).toEqual({ text: 'work the queue' });
  });

  it('omits the text when there is nothing to add', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    await fireFeatureRoutine({ apiKey: 'sk-test', text: '   ', fetch: fetchFn as never });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it('uses an overridden routine id', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    await fireFeatureRoutine({ apiKey: 'sk-test', routineId: 'trig_other', fetch: fetchFn as never });
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toContain('/routines/trig_other/fire');
  });

  it('reports the API error rather than a generic failure', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), {
          status: 401,
        }),
    );
    const result = await fireFeatureRoutine({ apiKey: 'sk-bad', fetch: fetchFn as never });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain('401');
      expect(result.error).toContain('invalid x-api-key');
    }
  });

  it('survives the request never leaving the box', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    const result = await fireFeatureRoutine({ apiKey: 'sk-test', fetch: fetchFn as never });
    expect(result).toMatchObject({ ok: false, error: 'getaddrinfo ENOTFOUND', status: null, body: null });
  });

  it('keeps the response body and the identifier in it', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ run_id: 'run_123', status: 'queued' }), { status: 200 }),
    );
    const result = await fireFeatureRoutine({ apiKey: 'sk-test', fetch: fetchFn as never });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ run_id: 'run_123', status: 'queued' });
      expect(result.runId).toBe('run_123');
    }
  });

  it('keeps a body that is not JSON, rather than losing it', async () => {
    const fetchFn = vi.fn(async () => new Response('accepted', { status: 202 }));
    const result = await fireFeatureRoutine({ apiKey: 'sk-test', fetch: fetchFn as never });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe('accepted');
      expect(result.runId).toBeNull();
    }
  });

  it('keeps the body of a refusal too, with the status it came with', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }),
    );
    const result = await fireFeatureRoutine({ apiKey: 'sk-bad', fetch: fetchFn as never });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: { message: 'invalid x-api-key' } });
    }
  });
});

/**
 * Nobody has seen what the fire endpoint returns, so this reads the shapes such
 * a body would plausibly take and answers null rather than guessing when none
 * of them fits. The body is stored whole beside it, which is what makes a miss
 * recoverable by looking.
 */
describe('runIdFrom', () => {
  it('reads the run\'s own id ahead of a bare id', () => {
    expect(runIdFrom({ id: 'trig_1', run_id: 'run_1' })).toBe('run_1');
  });

  it('reads an identifier the body wrapped', () => {
    expect(runIdFrom({ run: { id: 'run_2' } })).toBe('run_2');
    expect(runIdFrom({ data: { session_id: 'sess_3' } })).toBe('sess_3');
  });

  it('answers null for a body that names nothing', () => {
    expect(runIdFrom({ status: 'queued' })).toBeNull();
    expect(runIdFrom('accepted')).toBeNull();
    expect(runIdFrom(null)).toBeNull();
    expect(runIdFrom([{ id: 'run_4' }])).toBeNull();
  });

  it('ignores a blank identifier', () => {
    expect(runIdFrom({ run_id: '   ' })).toBeNull();
  });
});

describe('resolveRoutineId', () => {
  it('answers the routine the request actually goes to', () => {
    expect(resolveRoutineId('trig_plan')).toBe('trig_plan');
    expect(resolveRoutineId('  trig_plan  ')).toBe('trig_plan');
    expect(resolveRoutineId(null)).toBe(DEFAULT_FEATURE_ROUTINE_ID);
    expect(resolveRoutineId('   ')).toBe(DEFAULT_FEATURE_ROUTINE_ID);
  });
});

/**
 * Two queues, two routines, and a token scoped to each. The bugs button sends
 * no text of its own, so a button pointed at the wrong routine works the other
 * queue in silence; a token left behind by a repointed id answers 401. These
 * say neither can happen.
 */
describe('which routine each button fires', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends each queue to its own routine, with its own token', () => {
    vi.stubEnv('CLAUDE_NOTES_ROUTINE_ID', 'trig_notes');
    vi.stubEnv('CLAUDE_NOTES_ROUTINE_TOKEN', 'oat_notes');
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_ID', 'trig_plan');
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_TOKEN', 'oat_plan');
    expect(notesRoutine()).toEqual({ id: 'trig_notes', token: 'oat_notes' });
    expect(planRoutine()).toEqual({ id: 'trig_plan', token: 'oat_plan' });
  });

  it('falls back to what a single shared routine used', () => {
    vi.stubEnv('CLAUDE_NOTES_ROUTINE_ID', '');
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_ID', '');
    vi.stubEnv('CLAUDE_NOTES_ROUTINE_TOKEN', '');
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_TOKEN', '');
    vi.stubEnv('CLAUDE_FEATURE_ROUTINE_ID', 'trig_shared');
    vi.stubEnv('CLAUDE_API_KEY', 'oat_shared');
    expect(notesRoutine()).toEqual({ id: 'trig_shared', token: 'oat_shared' });
    expect(planRoutine()).toEqual({ id: 'trig_shared', token: 'oat_shared' });
  });

  it('answers null when nothing is set, which fireFeatureRoutine reads as the default', async () => {
    vi.stubEnv('CLAUDE_NOTES_ROUTINE_ID', '');
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_ID', '');
    vi.stubEnv('CLAUDE_FEATURE_ROUTINE_ID', '');
    expect(notesRoutine().id).toBeNull();

    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    await fireFeatureRoutine({ apiKey: 'sk-test', routineId: null, fetch: fetchFn as never });
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toContain(`/routines/${DEFAULT_FEATURE_ROUTINE_ID}/fire`);
  });

  it('ignores a variable set to blank rather than treating it as an answer', () => {
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_ID', '   ');
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_TOKEN', '   ');
    vi.stubEnv('CLAUDE_FEATURE_ROUTINE_ID', 'trig_shared');
    vi.stubEnv('CLAUDE_API_KEY', 'oat_shared');
    expect(planRoutine()).toEqual({ id: 'trig_shared', token: 'oat_shared' });
  });

  it('does not lend one routine the other\'s token', () => {
    vi.stubEnv('CLAUDE_NOTES_ROUTINE_TOKEN', 'oat_notes');
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_TOKEN', '');
    vi.stubEnv('CLAUDE_API_KEY', '');
    expect(notesRoutine().token).toBe('oat_notes');
    expect(planRoutine().token).toBeNull();
  });
});
