import { describe, expect, it } from 'vitest';
import { PLAN_SEED, planStepKey, seedStepsNotYetOffered } from '@/lib/plan/seed';
import { positionsForNewSteps } from '@/lib/plan/sync';

/**
 * The sync runs on every visit to the plan page, so the two questions worth
 * being sure about are what it would add and where it would put it. Both are
 * pure; the write around them is three inserts and a race the primary key
 * settles.
 */

describe('what has never been offered', () => {
  it('is everything, before anything has', () => {
    expect(seedStepsNotYetOffered([])).toHaveLength(PLAN_SEED.length);
  });

  it('is nothing, once the whole seed has been handed over', () => {
    expect(seedStepsNotYetOffered(PLAN_SEED.map(planStepKey))).toEqual([]);
  });

  it('is only the steps written since the last visit', () => {
    const before = PLAN_SEED.slice(0, PLAN_SEED.length - 2).map(planStepKey);
    expect(seedStepsNotYetOffered(before).map(planStepKey)).toEqual(
      PLAN_SEED.slice(-2).map(planStepKey),
    );
  });

  it('does not confuse two modules that number their steps the same way', () => {
    // Every module starts at 1., so a title on its own is not a key.
    const jobs = PLAN_SEED.filter((step) => step.module === 'jobs');
    expect(jobs.length).toBeGreaterThan(0);
    const rest = seedStepsNotYetOffered(jobs.map(planStepKey));
    expect(rest.some((step) => step.module === 'jobs')).toBe(false);
    expect(rest.some((step) => step.module !== 'jobs')).toBe(true);
  });

  it('does not offer a step back after it has been deleted', () => {
    // The key stays recorded even though the row is gone, which is the whole
    // reason offered and present are separate questions.
    const all = PLAN_SEED.map(planStepKey);
    expect(seedStepsNotYetOffered(all)).toEqual([]);
  });

  it('ignores keys that were never in the seed', () => {
    const mine = [...PLAN_SEED.map(planStepKey), 'app:Something I added myself'];
    expect(seedStepsNotYetOffered(mine)).toEqual([]);
  });
});

describe('where new steps go', () => {
  const step = (module: string | null, title: string) =>
    ({ module, title, detail: null, status: 'not_started' }) as (typeof PLAN_SEED)[number];

  it('numbers an empty plan from ten, within each module', () => {
    const steps = [step('learn', 'a'), step('learn', 'b'), step('jobs', 'c')];
    expect(positionsForNewSteps([], steps)).toEqual([10, 20, 10]);
  });

  it('carries on after what a module already has', () => {
    const existing = [
      { module: 'learn', position: 470 },
      { module: 'jobs', position: 60 },
    ];
    const steps = [step('learn', 'a'), step('learn', 'b'), step('jobs', 'c')];
    expect(positionsForNewSteps(existing, steps)).toEqual([480, 490, 70]);
  });

  it('reads the module maximum rather than the last row it saw', () => {
    const existing = [
      { module: 'learn', position: 300 },
      { module: 'learn', position: 100 },
    ];
    expect(positionsForNewSteps(existing, [step('learn', 'a')])).toEqual([310]);
  });

  it('keeps the app-wide list separate from every module', () => {
    const existing = [{ module: null, position: 50 }, { module: 'learn', position: 200 }];
    const steps = [step(null, 'a'), step('learn', 'b')];
    expect(positionsForNewSteps(existing, steps)).toEqual([60, 210]);
  });

  it('survives a row with no position at all', () => {
    expect(positionsForNewSteps([{ module: 'learn', position: null }], [step('learn', 'a')]))
      .toEqual([10]);
  });
});
