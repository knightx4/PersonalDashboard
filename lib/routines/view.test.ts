import { describe, expect, it } from 'vitest';
import { ROUTINES, routinesFor, type Routine } from './registry';
import { routineView, runKey, type RoutineFacts } from './view';

const NOW = Date.UTC(2026, 9, 10, 3, 45);
const TZ = 'UTC';

const vision = ROUTINES.find((r) => r.key === 'vision-review')!;
const daily = ROUTINES.find((r) => r.key === 'goals-daily')!;
const claims = ROUTINES.find((r) => r.key === 'plan-claims')!;

function facts(over: Partial<RoutineFacts> = {}): RoutineFacts {
  return { schedules: null, runs: new Map(), ...over };
}

describe('routineView', () => {
  it('falls back to the registry expression when the jobs cannot be read', () => {
    const view = routineView(vision, facts(), NOW, TZ);
    expect(view.schedule).toMatch(/^Every week · next Sun 11 Oct/);
    expect(view.warning).toBeNull();
    expect(view.lastRun).toBe('Has not run yet');
    expect(view.question).toMatch(/local misses/);
  });

  it('warns when a job is missing or paused', () => {
    expect(routineView(vision, facts({ schedules: [] }), NOW, TZ).warning).toMatch(/no pg_cron job/);
    const paused = facts({
      schedules: [
        {
          jobname: 'vision-review-weekly',
          schedule: '41 14 * * 0',
          active: false,
          lastStartedAt: null,
          lastStatus: null,
          lastMessage: null,
        },
      ],
    });
    expect(routineView(vision, paused, NOW, TZ).warning).toMatch(/turned off/);
  });

  it('says how the last run went, with its error when it failed', () => {
    const runs = new Map([
      [runKey('goals_runs', 'daily'), { createdAt: '2026-10-09T12:33:00Z', status: 'failed', error: 'No goals client' }],
    ]);
    const view = routineView(daily, facts({ runs }), NOW, TZ);
    expect(view.lastRun).toMatch(/^Last ran Fri 9 Oct.* · failed$/);
    expect(view.failed).toBe(true);
    expect(view.error).toBe('No goals client');
    expect(view.schedule).toMatch(/^Every day · with the morning cron · next Sat 10 Oct/);
  });

  it('shows no last run for a daily stage that records none', () => {
    expect(routineView(claims, facts(), NOW, TZ).lastRun).toBeNull();
  });
});

describe('the registry', () => {
  it('has unique keys', () => {
    const keys = ROUTINES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('lists routines in both workspaces', () => {
    expect(routinesFor('dev').length).toBeGreaterThan(0);
    expect(routinesFor('goals').length).toBeGreaterThan(0);
  });

  it('names only stages the daily cron runs', async () => {
    const { readFileSync } = await import('node:fs');
    const route = readFileSync('app/api/cron/daily/route.ts', 'utf8');
    const stages = ROUTINES.flatMap((r: Routine) => (r.clock.kind === 'daily' ? [r.clock.stage] : []));
    for (const stage of stages) expect(route).toContain(`name: '${stage}'`);
  });
});
