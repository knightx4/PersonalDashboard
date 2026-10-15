import { describe, expect, it } from 'vitest';
import { goingRunCutoff, GOING_RUN_MAX_AGE_MS, newestGoingRun, runHref } from './run-link';

describe('run links', () => {
  it('sends a goal run to its goals page and a plan run to the plan', () => {
    expect(runHref('goals.runs', 'a')).toBe('/goals/runs/a');
    expect(runHref('plan_runs', 'b')).toBe('/dev/plan/runs/b');
  });

  it('follows the newest going run of either table', () => {
    const older = { table: 'plan_runs', id: 'a', created_at: '2026-10-15T10:00:00Z' } as const;
    const newer = { table: 'goals.runs', id: 'b', created_at: '2026-10-15T10:05:00Z' } as const;
    expect(newestGoingRun([older, null, newer])).toBe(newer);
    expect(newestGoingRun([null, undefined])).toBeNull();
  });

  it('leaves out runs older than the cutoff', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    expect(Date.parse(goingRunCutoff(now))).toBe(now - GOING_RUN_MAX_AGE_MS);
  });
});
