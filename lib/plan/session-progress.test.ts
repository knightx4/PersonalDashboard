import { describe, expect, it } from 'vitest';
import { ACTION_MAX, ProgressInputError, currentSessionId, progressRpcArgs, readProgress } from './session-progress';

const RUN = '7b7f8be3-b391-4fa8-a359-f9194b897f40';

describe('readProgress', () => {
  it('reads a working report with its run, and drops a need sent while working', () => {
    const report = readProgress({ session_id: 'cse_015abc', state: 'working', action: '  Committed  the page ', needs: 'x', run_id: RUN.toUpperCase() });
    expect(report).toEqual({
      sessionId: 'cse_015abc',
      state: 'working',
      action: 'Committed the page',
      needs: null,
      planRunId: RUN,
      planItemId: null,
      threadId: null,
      project: null,
    });
  });

  it('asks a waiting session what it needs', () => {
    expect(() => readProgress({ session_id: 'cse_1', state: 'waiting', action: 'Asked' })).toThrow(/needs is required/);
    expect(readProgress({ session_id: 'cse_1', state: 'waiting', action: 'Asked', needs: 'CSV or JSON?' }).needs).toBe('CSV or JSON?');
  });

  it('refuses a missing session, an unknown state, a blank action and malformed ids', () => {
    expect(() => readProgress({ state: 'working', action: 'x' })).toThrow(ProgressInputError);
    expect(() => readProgress({ session_id: 'cse 1', state: 'working', action: 'x' })).toThrow(/session id/);
    expect(() => readProgress({ session_id: 'cse_1', state: 'busy', action: 'x' })).toThrow(/state must be/);
    expect(() => readProgress({ session_id: 'cse_1', state: 'done', action: ' ' })).toThrow(/action is required/);
    expect(() => readProgress({ session_id: 'cse_1', state: 'done', action: 'x', run_id: 'nope' })).toThrow(/plan run/);
    expect(() => readProgress({ session_id: 'cse_1', state: 'done', action: 'x', project: 'Music Pipeline' })).toThrow(/project/);
    expect(() => readProgress({ session_id: 'cse_1', state: 'done', action: 7 })).toThrow(/must be text/);
  });

  it('cuts a long action to what the table keeps', () => {
    const action = readProgress({ session_id: 'cse_1', state: 'working', action: 'a'.repeat(500) }).action;
    expect(action).toHaveLength(ACTION_MAX);
    expect(action.endsWith('…')).toBe(true);
  });
});

describe('progressRpcArgs', () => {
  it('names the account and every field the function takes', () => {
    const report = readProgress({ session_id: 'cse_1', state: 'stopped', action: 'Ran out of room', project: 'music-pipeline' });
    expect(progressRpcArgs('user-1', report)).toEqual({
      p_user_id: 'user-1',
      p_session_id: 'cse_1',
      p_state: 'stopped',
      p_action: 'Ran out of room',
      p_needs: null,
      p_plan_run_id: null,
      p_plan_item_id: null,
      p_thread_id: null,
      p_project: 'music-pipeline',
    });
  });
});

describe('currentSessionId', () => {
  it('prefers the cloud session id, and gives null for none', () => {
    expect(currentSessionId({ CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_9', CLAUDE_CODE_SESSION_ID: 'local' })).toBe('cse_9');
    expect(currentSessionId({ CLAUDE_CODE_SESSION_ID: 'd3866ac6-4db5' })).toBe('d3866ac6-4db5');
    expect(currentSessionId({})).toBeNull();
  });
});
