import { describe, expect, it } from 'vitest';
import type { NightGoal, NightRun, NightStep } from '@/lib/goals/overnight-choice';
import { goalsReadyLine, goalsStatus } from '@/lib/goals/runner-status';
import type { RunListing } from '@/lib/goals/runs';

const NOW = Date.parse('2026-09-26T12:00:00Z');
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

function step(id: string, goalId = 'g1'): NightStep {
  return { id, title: `Step ${id}`, goalId, goalTitle: 'A goal', dueOn: null };
}

function listing(over: Partial<RunListing> = {}): RunListing {
  return {
    id: 'r1',
    job: 'step',
    status: 'started',
    createdAt: minutesAgo(12),
    endedAt: null,
    summary: null,
    error: null,
    lastSeenAt: minutesAgo(2),
    nowOn: 'Reading the course pages',
    item: { id: 's1', title: 'Find three courses', level: 'step' },
    area: null,
    ...over,
  };
}

const MAPPED: NightGoal = {
  id: 'g1',
  title: 'A goal',
  status: 'open',
  approvedAt: minutesAgo(1000),
  createdAt: minutesAgo(2000),
  fogChangedAt: null,
};

function status(input: {
  started?: RunListing[];
  steps?: NightStep[];
  runs?: NightRun[];
  goals?: NightGoal[];
}) {
  return goalsStatus({
    started: input.started ?? [],
    night: { goals: input.goals ?? [MAPPED], steps: input.steps ?? [], runs: input.runs ?? [] },
    nightStartedAt: null,
    now: NOW,
  });
}

describe('what the goals half is on', () => {
  it('names a run going, with what it last said it was on', () => {
    const [on] = status({ started: [listing()] }).on;
    expect(on).toMatchObject({
      doing: 'Working the goal step',
      title: 'Find three courses',
      nowOn: 'Reading the course pages',
    });
  });

  it('leaves out a started run that has gone quiet', () => {
    const quiet = listing({ createdAt: minutesAgo(120), lastSeenAt: minutesAgo(90) });
    expect(status({ started: [quiet] }).on).toEqual([]);
  });
});

describe('what the goals half could pick up', () => {
  it('counts ready steps, less the ones a run is on', () => {
    const runs: NightRun[] = [
      { goalId: 'g1', stepId: 's1', status: 'started', createdAt: minutesAgo(5), job: 'step' },
    ];
    expect(status({ steps: [step('s1'), step('s2'), step('s3', 'g2')], runs }).readySteps).toBe(2);
  });

  it('counts a goal never mapped as one to map', () => {
    const fresh: NightGoal = { ...MAPPED, id: 'g2', approvedAt: null };
    expect(status({ goals: [MAPPED, fresh] }).toMap).toBe(1);
  });

  it('says it in words, and nothing when there is nothing', () => {
    expect(goalsReadyLine({ readySteps: 2, toMap: 1 })).toBe('2 goal steps ready · 1 goal to map');
    expect(goalsReadyLine({ readySteps: 1, toMap: 0 })).toBe('1 goal step ready');
    expect(goalsReadyLine({ readySteps: 0, toMap: 0 })).toBeNull();
  });
});
