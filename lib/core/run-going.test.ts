import { describe, expect, it } from 'vitest';
import { runFollowable, runStatusGoing, runSubjectRefs, runTableParts } from './run-going';

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

describe('runSubjectRefs', () => {
  it('names the plan step, the goals step, its goal, area and the context the goal points at', () => {
    const refs = runSubjectRefs({
      planItemIds: ['p1', null],
      goalsRuns: [{ item_id: 's1', area_id: 'a1' }],
      goalsItems: [{ id: 's1', parent_id: 'g1' }],
      context: [
        { item_id: 'g1', source: 'job_search.roles', ref: 'r1', status: 'kept' },
        { item_id: 'g1', source: 'obsidian.notes', ref: 'Plans/Job.md', status: 'proposed' },
        { item_id: 'g1', source: 'learn.readings', ref: 'x', status: 'dismissed' },
        { item_id: 'other', source: 'news.issues', ref: 'n1', status: 'kept' },
      ],
    });
    expect(refs.sort()).toEqual(
      [
        'public.plan_items:p1',
        'goals.items:s1',
        'goals.areas:a1',
        'goals.items:g1',
        'job_search.roles:r1',
        'obsidian.notes:Plans/Job.md',
      ].sort(),
    );
  });

  it('names nothing when no run is going', () => {
    expect(runSubjectRefs({ planItemIds: [], goalsRuns: [], goalsItems: [], context: [] })).toEqual([]);
  });
});
