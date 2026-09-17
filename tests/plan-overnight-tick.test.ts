/**
 * The clock tick that fires one feature a night at a time.
 *
 * The properties that matter are the ones about restraint: a tick with a
 * session still working must change nothing at all, a tick with the runner off
 * must not so much as read the plan, and a tick that does fire must fire once
 * and take exactly one off the budget. The fourth is the guard that stops a
 * feature whose remaining work is stuck being sent a session every few minutes
 * for the rest of the night.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PlanDependency, PlanItem } from '@/lib/plan/load';
import { budgetSpentReason, OVERNIGHT_TIME_UP, type OvernightRun } from '@/lib/plan/overnight';
import { OVERNIGHT_NOTHING_READY } from '@/lib/plan/overnight-choice';
import {
  chooseOvernightFire,
  closedNothingSince,
  overnightTick,
  OVERNIGHT_NO_PROGRESS,
  type OvernightPorts,
} from '@/inngest/dev/overnight';
import { buildPlanTree, findNode, type PlanSection } from '@/lib/plan/tree';

const MIDNIGHT = Date.parse('2026-09-17T23:00:00.000Z');
const SEVEN_AM = '2026-09-18T07:00:00.000Z';
const YESTERDAY = '2026-09-16T12:00:00.000Z';

let counter = 0;

function item(over: Partial<PlanItem> & { id: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'shopping',
    parentId: null,
    title: `Step ${over.id}`,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: null,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: 'claude',
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: null,
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    updatedAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    ...over,
  };
}

function tree(items: PlanItem[], dependencies: PlanDependency[] = []): PlanSection[] {
  return buildPlanTree({ items, dependencies });
}

function night(over: Partial<OvernightRun> = {}): OvernightRun {
  return {
    id: 'run-1',
    running: true,
    paused: false,
    featuresBudget: 6,
    featuresLeft: 6,
    stopBy: SEVEN_AM,
    startedAt: '2026-09-17T23:00:00.000Z',
    lastFiredAt: null,
    endedAt: null,
    endedReason: null,
    createdAt: '2026-09-17T23:00:00.000Z',
    updatedAt: '2026-09-17T23:00:00.000Z',
    ...over,
  };
}

/** One feature with one ready step under it, which is the ordinary case. */
const oneReadyFeature = () => [item({ id: 'feature' }), item({ id: 'step', parentId: 'feature' })];

/** Two features, the first by priority named first. */
const twoFeatures = () => [
  item({ id: 'first', priority: 1 }),
  item({ id: 'first-step', parentId: 'first', priority: 1 }),
  item({ id: 'second', priority: 3 }),
  item({ id: 'second-step', parentId: 'second', priority: 3 }),
];

/**
 * The ports, with every one of them recorded and nothing real behind any.
 *
 * The defaults are an ordinary night: one feature ready, nothing fired yet, so
 * there is no last run to wait for.
 */
function ports(over: Partial<OvernightPorts> = {}) {
  const calls = {
    sections: 0,
    swept: 0,
    /** What the tick asked for, in the order it asked, so sweep-then-tree can be checked. */
    order: [] as string[],
    fired: [] as Array<{ feature: string; step: string }>,
    recorded: [] as number[],
    stopped: [] as string[],
  };
  const sections = tree(oneReadyFeature());

  const base: OvernightPorts = {
    now: MIDNIGHT,
    loadRun: async () => night(),
    loadSections: async () => {
      calls.sections += 1;
      calls.order.push('sections');
      return sections;
    },
    lastFiredAt: async () => ({}),
    lastRunLiveness: async () => null,
    sweepClaims: async () => {
      calls.swept += 1;
      calls.order.push('sweep');
    },
    fire: async (feature, step) => {
      calls.fired.push({ feature: feature.id, step: step.id });
      return { ok: true };
    },
    recordFire: async (featuresLeft) => {
      calls.recorded.push(featuresLeft);
    },
    stop: async (reason) => {
      calls.stopped.push(reason);
    },
    ...over,
  };
  return { ports: base, calls };
}

describe('closedNothingSince', () => {
  const feature = () => {
    const sections = tree([
      item({ id: 'feature' }),
      item({ id: 'closed', parentId: 'feature', status: 'done', completedAt: MIDNIGHT_ISO(-30) }),
    ]);
    return findNode(sections, 'feature')!;
  };

  function MIDNIGHT_ISO(minutes: number): string {
    return new Date(MIDNIGHT + minutes * 60_000).toISOString();
  }

  it('is false when there was no run to judge', () => {
    expect(closedNothingSince(feature(), null)).toBe(false);
  });

  it('is false when a step closed after the run started', () => {
    expect(closedNothingSince(feature(), MIDNIGHT_ISO(-60))).toBe(false);
  });

  it('is true when everything under it closed before the run started', () => {
    expect(closedNothingSince(feature(), MIDNIGHT_ISO(-10))).toBe(true);
  });
});

describe('chooseOvernightFire', () => {
  it('fires the feature the chooser names when it has never been run', () => {
    const choice = chooseOvernightFire(tree(oneReadyFeature()), night(), MIDNIGHT, {});

    expect(choice).toMatchObject({ act: 'fire' });
    expect(choice.act === 'fire' && choice.feature.id).toBe('feature');
  });

  it('fires it again when its last run did close a step', () => {
    const sections = tree([
      item({ id: 'feature' }),
      item({ id: 'done-step', parentId: 'feature', status: 'done', completedAt: SEVEN_AM }),
      item({ id: 'step', parentId: 'feature' }),
    ]);

    const choice = chooseOvernightFire(sections, night(), MIDNIGHT, { feature: YESTERDAY });

    expect(choice.act === 'fire' && choice.feature.id).toBe('feature');
  });

  it('passes over a feature whose last run closed no steps and takes the next', () => {
    const choice = chooseOvernightFire(tree(twoFeatures()), night(), MIDNIGHT, {
      first: YESTERDAY,
    });

    expect(choice.act === 'fire' && choice.feature.id).toBe('second');
  });

  it('ends the night saying so when every ready feature is passed over', () => {
    const choice = chooseOvernightFire(tree(twoFeatures()), night(), MIDNIGHT, {
      first: YESTERDAY,
      second: YESTERDAY,
    });

    expect(choice).toEqual({ act: 'end', reason: OVERNIGHT_NO_PROGRESS });
  });

  it('still says nothing was ready when nothing was passed over', () => {
    const choice = chooseOvernightFire(tree([item({ id: 'mine', assignee: 'me' })]), night(), MIDNIGHT, {});

    expect(choice).toEqual({ act: 'end', reason: OVERNIGHT_NOTHING_READY });
  });
});

describe('overnightTick', () => {
  it('fires exactly one feature and takes one off the budget', async () => {
    const { ports: p, calls } = ports();

    await expect(overnightTick(p)).resolves.toMatchObject({ act: 'fired', featuresLeft: 5 });

    expect(calls.fired).toEqual([{ feature: 'feature', step: 'step' }]);
    // The count the row said was left, not the one after it.
    expect(calls.recorded).toEqual([6]);
    expect(calls.stopped).toEqual([]);
  });

  it('changes nothing when the runner is off, and does not read the plan', async () => {
    for (const run of [null, night({ running: false })]) {
      const { ports: p, calls } = ports({ loadRun: async () => run });

      await expect(overnightTick(p)).resolves.toEqual({ act: 'idle' });
      expect(calls).toMatchObject({ sections: 0, swept: 0, fired: [], recorded: [], stopped: [] });
    }
  });

  it('changes nothing while it is paused', async () => {
    const { ports: p, calls } = ports({ loadRun: async () => night({ paused: true }) });

    await expect(overnightTick(p)).resolves.toEqual({ act: 'paused' });
    expect(calls).toMatchObject({ sections: 0, swept: 0, fired: [], recorded: [], stopped: [] });
  });

  it('changes nothing while the last run is still going', async () => {
    for (const liveness of ['working', 'quiet'] as const) {
      const { ports: p, calls } = ports({
        loadRun: async () => night({ lastFiredAt: '2026-09-17T23:30:00.000Z' }),
        lastRunLiveness: async () => liveness,
      });

      await expect(overnightTick(p)).resolves.toEqual({ act: 'waiting', liveness });
      // Not even the tree, and not the claims either: a tick that cannot fire
      // has nothing to choose from and nothing to clear the way for.
      expect(calls).toMatchObject({ sections: 0, swept: 0, fired: [], recorded: [], stopped: [] });
    }
  });

  it('will not fire on a reading it could not take', async () => {
    const { ports: p, calls } = ports({
      loadRun: async () => night({ lastFiredAt: '2026-09-17T23:30:00.000Z' }),
      lastRunLiveness: async () => 'unknown',
    });

    await expect(overnightTick(p)).resolves.toEqual({ act: 'waiting', liveness: 'unknown' });
    expect(calls.fired).toEqual([]);
  });

  it('fires the next one once the last run is over', async () => {
    for (const liveness of ['ended', 'finished'] as const) {
      const { ports: p, calls } = ports({
        loadRun: async () => night({ lastFiredAt: '2026-09-17T23:30:00.000Z' }),
        lastRunLiveness: async () => liveness,
      });

      await expect(overnightTick(p)).resolves.toMatchObject({ act: 'fired' });
      expect(calls.fired).toHaveLength(1);
    }
  });

  it('ends the night when the budget is spent, without asking anything else', async () => {
    const run = night({ featuresLeft: 0 });
    const liveness = vi.fn(async () => 'working' as const);
    const { ports: p, calls } = ports({ loadRun: async () => run, lastRunLiveness: liveness });

    await expect(overnightTick(p)).resolves.toEqual({
      act: 'ended',
      reason: budgetSpentReason(run),
    });
    expect(calls.stopped).toEqual([budgetSpentReason(run)]);
    expect(liveness).not.toHaveBeenCalled();
  });

  it('ends the night when the stop time has passed', async () => {
    const { ports: p, calls } = ports({ now: Date.parse(SEVEN_AM) });

    await expect(overnightTick(p)).resolves.toEqual({ act: 'ended', reason: OVERNIGHT_TIME_UP });
    expect(calls.stopped).toEqual([OVERNIGHT_TIME_UP]);
    expect(calls.fired).toEqual([]);
  });

  it('ends the night with the chooser reason when nothing is ready', async () => {
    const { ports: p, calls } = ports({
      loadSections: async () => tree([item({ id: 'mine', assignee: 'me' })]),
    });

    await expect(overnightTick(p)).resolves.toEqual({
      act: 'ended',
      reason: OVERNIGHT_NOTHING_READY,
    });
    expect(calls.stopped).toEqual([OVERNIGHT_NOTHING_READY]);
  });

  it('puts back stale claims before it reads the plan', async () => {
    const { ports: p, calls } = ports();

    await expect(overnightTick(p)).resolves.toMatchObject({ act: 'fired' });
    // The order is the whole point: a tree read before the sweep still shows
    // the dead session's step as underway, and the feature above it is refused.
    expect(calls.order).toEqual(['sweep', 'sections']);
    expect(calls.swept).toBe(1);
  });

  it('still fires when the sweep itself failed', async () => {
    const { ports: p, calls } = ports({
      sweepClaims: async () => {
        throw new Error('plan_items could not be read.');
      },
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Tidying, not a precondition: a night that gave up here would lose every
    // feature it could still have fired over a table it could not write.
    await expect(overnightTick(p)).resolves.toMatchObject({ act: 'fired' });
    expect(calls.fired).toHaveLength(1);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('leaves the budget alone when the send itself failed', async () => {
    const { ports: p, calls } = ports({
      fire: async () => ({ ok: false, error: 'The routine refused.' }),
    });

    await expect(overnightTick(p)).resolves.toEqual({
      act: 'failed',
      error: 'The routine refused.',
    });
    expect(calls.recorded).toEqual([]);
    expect(calls.stopped).toEqual([]);
  });
});
