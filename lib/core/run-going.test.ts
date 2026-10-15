import { describe, expect, it } from 'vitest';
import { runFollowable, runStatusGoing, runTableParts } from './run-going';

describe('runStatusGoing', () => {
  it('counts only a started run as going', () => {
    expect(runStatusGoing('started')).toBe(true);
    for (const status of ['awaiting_input', 'stale', 'finished', 'done', 'failed', null, undefined]) {
      expect(runStatusGoing(status)).toBe(false);
    }
  });
});

describe('runTableParts', () => {
  it('names the schema and table of each runs table', () => {
    expect(runTableParts('goals.runs')).toEqual({ schema: 'goals', table: 'runs' });
    expect(runTableParts('plan_runs')).toEqual({ schema: 'public', table: 'plan_runs' });
  });
});

describe('runFollowable', () => {
  it('follows a run with a real row id and not a fixture', () => {
    expect(runFollowable({ table: 'plan_runs', id: '0b6c7f8e-3a1d-4c2b-9e8f-1a2b3c4d5e6f' })).toBe(true);
    expect(runFollowable({ table: 'plan_runs', id: 'preview-run', going: true })).toBe(false);
    expect(runFollowable(null)).toBe(false);
  });
});
