import { describe, expect, it } from 'vitest';
import type { RunActivity, RunActivityKind } from './run-activities';
import { runMoment, runPose } from './run-pose';

const line = (kind: RunActivityKind, body: string, id = 'l1'): RunActivity => ({
  id,
  user_id: 'u',
  run_table: 'plan_runs',
  run_id: 'r',
  kind,
  body,
  options: null,
  created_at: '2026-10-13T10:00:00Z',
});

describe('runPose', () => {
  it('works plainly before the run has written anything', () => {
    expect(runPose(null)).toEqual({ state: 'working' });
  });

  it('asks while a question waits on you', () => {
    expect(runPose(line('question', 'Should the tag point left or right?'))).toEqual({ state: 'asking' });
  });

  it('reads the kind of work from the line', () => {
    expect(runPose(line('thought', "Reading the step's acceptance criteria")).activity).toBe('reading');
    expect(runPose(line('thought', 'Searching for every caller of DashMark')).activity).toBe('searching');
    expect(runPose(line('action', 'Running the gate')).activity).toBe('testing');
    expect(runPose(line('thought', 'Checking the contrast across themes')).activity).toBe('testing');
    expect(runPose(line('action', 'Edited the runner card to pass the pose')).activity).toBe('writing');
    expect(runPose(line('thought', 'Weighing whether the hold should be shorter')).activity).toBe('thinking');
  });

  it('falls back to writing for an action and thinking for a thought', () => {
    expect(runPose(line('action', 'Claimed step #12')).activity).toBe('writing');
    expect(runPose(line('thought', 'Hmm.')).activity).toBe('thinking');
  });
});

describe('runMoment', () => {
  it('winces at an error, once per line', () => {
    expect(runMoment(line('error', 'The build failed', 'e1'))).toEqual({ kind: 'wince', id: 'e1' });
  });

  it('hops when a step closes or a commit lands', () => {
    expect(runMoment(line('action', 'Committed the redraw', 'a1'))).toEqual({ kind: 'hop', id: 'a1' });
    expect(runMoment(line('action', 'Closed step #1907.2', 'a2'))).toEqual({ kind: 'hop', id: 'a2' });
  });

  it('plays nothing for an ordinary line', () => {
    expect(runMoment(line('action', 'Edited the file'))).toBeNull();
    expect(runMoment(line('thought', 'Committed to the plan of reading first'))).toBeNull();
    expect(runMoment(null)).toBeNull();
  });
});
