import { describe, expect, it } from 'vitest';
import {
  isPlanStatus,
  planProgress,
  planSections,
  type PlanItem,
  type PlanStatus,
} from '@/lib/plan/load';
import { PLAN_SEED, planStepKey, seedStepsMissingFrom } from '@/lib/plan/seed';
import { MODULES } from '@/lib/modules';

function item(over: Partial<PlanItem> & { id: string }): PlanItem {
  return {
    module: 'shopping',
    title: 'A step',
    detail: null,
    status: 'not_started',
    comment: null,
    position: 0,
    ...over,
  };
}

const at = (status: PlanStatus, id: string) => item({ id, status });

describe('planProgress', () => {
  it('counts what is done against what is still live', () => {
    expect(
      planProgress([at('done', 'a'), at('done', 'b'), at('not_started', 'c'), at('in_progress', 'd')]),
    ).toEqual({ done: 2, inProgress: 1, live: 4, fraction: 0.5 });
  });

  it('leaves a dropped step out of the denominator', () => {
    // Otherwise a module you finished sits at 90% forever because of one step
    // you decided against.
    expect(planProgress([at('done', 'a'), at('dropped', 'b')])).toEqual({
      done: 1,
      inProgress: 0,
      live: 1,
      fraction: 1,
    });
  });

  it('gives no fraction at all rather than dividing by zero', () => {
    expect(planProgress([]).fraction).toBeNull();
    expect(planProgress([at('dropped', 'a')]).fraction).toBeNull();
  });

  it('does not count in progress as part done', () => {
    // Half credit would move the bar when nothing shipped.
    expect(planProgress([at('in_progress', 'a'), at('not_started', 'b')]).fraction).toBe(0);
  });
});

describe('planSections', () => {
  it('gives every module a section, even one with no steps yet', () => {
    const sections = planSections([item({ id: 'a', module: 'jobs' })]);
    expect(sections.map((section) => section.module)).toEqual(MODULES.map((m) => m.id));
    expect(sections.find((section) => section.module === 'vault')?.items).toEqual([]);
  });

  it('orders the steps within a module by position', () => {
    const sections = planSections([
      item({ id: 'third', position: 30 }),
      item({ id: 'first', position: 10 }),
      item({ id: 'second', position: 20 }),
    ]);
    const shopping = sections.find((section) => section.module === 'shopping');
    expect(shopping?.items.map((step) => step.id)).toEqual(['first', 'second', 'third']);
  });

  it('shows the app-wide section only once something is in it', () => {
    expect(planSections([item({ id: 'a' })]).some((s) => s.module === null)).toBe(false);
    expect(
      planSections([item({ id: 'a', module: null })]).some((s) => s.module === null),
    ).toBe(true);
  });

  it('puts every step in exactly one section', () => {
    const items = [
      item({ id: 'a', module: 'jobs' }),
      item({ id: 'b', module: 'shopping' }),
      item({ id: 'c', module: null }),
    ];
    const seen = planSections(items).flatMap((section) => section.items.map((step) => step.id));
    expect(seen.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('the seed', () => {
  it('names only modules that exist', () => {
    const ids = new Set<string>(MODULES.map((module) => module.id));
    for (const step of PLAN_SEED) {
      if (step.module === null) continue;
      expect(ids.has(step.module), `${step.title} names ${step.module}`).toBe(true);
    }
  });

  it('carries only real statuses', () => {
    for (const step of PLAN_SEED) {
      expect(isPlanStatus(step.status), `${step.title} is ${step.status}`).toBe(true);
    }
  });

  it('has a title on every step, within what the column accepts', () => {
    for (const step of PLAN_SEED) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.title.length).toBeLessThanOrEqual(200);
      expect((step.detail ?? '').length).toBeLessThanOrEqual(4000);
    }
  });

  it('does not name the same step twice within one module', () => {
    const seen = new Set<string>();
    for (const step of PLAN_SEED) {
      const key = `${step.module ?? 'app'}:${step.title}`;
      expect(seen.has(key), `${key} appears twice`).toBe(false);
      seen.add(key);
    }
  });
});

/**
 * Importing twice is the normal case, not the edge case: a slice gets planned
 * in the seed after the first import and has to reach the page somehow.
 */
describe('bringing in what is missing', () => {
  it('takes everything when the plan is empty', () => {
    expect(seedStepsMissingFrom([])).toHaveLength(PLAN_SEED.length);
  });

  it('takes nothing when the plan already holds the whole seed', () => {
    expect(seedStepsMissingFrom(PLAN_SEED)).toEqual([]);
  });

  it('takes only the steps that are not there', () => {
    const held = PLAN_SEED.slice(0, PLAN_SEED.length - 2);
    const missing = seedStepsMissingFrom(held);
    expect(missing.map(planStepKey)).toEqual(PLAN_SEED.slice(-2).map(planStepKey));
  });

  it('does not confuse two modules that number their steps the same way', () => {
    // Every module starts at 1., so the title alone is not a key.
    const oneModule = PLAN_SEED.filter((step) => step.module === 'jobs');
    expect(oneModule.length).toBeGreaterThan(0);
    const missing = seedStepsMissingFrom(oneModule);
    expect(missing.some((step) => step.module === 'jobs')).toBe(false);
    expect(missing.some((step) => step.module !== 'jobs')).toBe(true);
  });

  it('ignores steps of your own that the seed never had', () => {
    const mine = [{ module: null, title: 'Something I added myself' }];
    expect(seedStepsMissingFrom([...PLAN_SEED, ...mine])).toEqual([]);
  });
});
