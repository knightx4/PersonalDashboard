import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FEATURE_ROUTINE_ID,
  fireFeatureRoutine,
  notesRoutineId,
  planRoutineId,
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
    expect(result).toMatchObject({ ok: false, error: 'getaddrinfo ENOTFOUND' });
  });
});

/**
 * Two queues, two routines. The bugs button sends no text of its own, so a
 * button pointed at the wrong routine works the other queue in silence --
 * which is what these say cannot happen.
 */
describe('which routine each button fires', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends each queue to its own routine', () => {
    vi.stubEnv('CLAUDE_NOTES_ROUTINE_ID', 'trig_notes');
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_ID', 'trig_plan');
    expect(notesRoutineId()).toBe('trig_notes');
    expect(planRoutineId()).toBe('trig_plan');
  });

  it('falls back to the shared id both queues used to share', () => {
    vi.stubEnv('CLAUDE_NOTES_ROUTINE_ID', '');
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_ID', '');
    vi.stubEnv('CLAUDE_FEATURE_ROUTINE_ID', 'trig_shared');
    expect(notesRoutineId()).toBe('trig_shared');
    expect(planRoutineId()).toBe('trig_shared');
  });

  it('answers null when nothing is set, which fireFeatureRoutine reads as the default', async () => {
    vi.stubEnv('CLAUDE_NOTES_ROUTINE_ID', '');
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_ID', '');
    vi.stubEnv('CLAUDE_FEATURE_ROUTINE_ID', '');
    expect(notesRoutineId()).toBeNull();

    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    await fireFeatureRoutine({ apiKey: 'sk-test', routineId: null, fetch: fetchFn as never });
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toContain(`/routines/${DEFAULT_FEATURE_ROUTINE_ID}/fire`);
  });

  it('ignores a variable set to blank rather than treating it as an answer', () => {
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_ID', '   ');
    vi.stubEnv('CLAUDE_FEATURE_ROUTINE_ID', 'trig_shared');
    expect(planRoutineId()).toBe('trig_shared');
  });
});
