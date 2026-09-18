import { describe, expect, it } from 'vitest';
import type { PlanDependency, PlanItem } from '@/lib/plan/load';
import {
  chooseOvernightFeature,
  OVERNIGHT_NOTHING_READY,
  type OvernightChoice,
} from '@/lib/plan/overnight-choice';
import { budgetSpentReason, OVERNIGHT_TIME_UP, type OvernightRun } from '@/lib/plan/overnight';
import { buildPlanTree, workOrder } from '@/lib/plan/tree';

const MIDNIGHT = Date.parse('2026-09-17T23:00:00.000Z');
const SEVEN_AM = '2026-09-18T07:00:00.000Z';

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

function dep(itemId: string, dependsOnId: string): PlanDependency {
  return { id: `${itemId}->${dependsOnId}`, itemId, dependsOnId };
}

function tree(items: PlanItem[], dependencies: PlanDependency[] = []) {
  return buildPlanTree({ items, dependencies });
}

/** A night that is on, with everything the row half reads set to something sane. */
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

/** The feature named, or the act when nothing was named. */
function named(choice: OvernightChoice): string {
  return choice.act === 'fire' ? choice.feature.id : choice.act;
}

describe('chooseOvernightFeature', () => {
  it('names the feature above the first step in the work order', () => {
    const sections = tree(oneReadyFeature());

    const choice = chooseOvernightFeature(sections, night(), MIDNIGHT);

    expect(choice).toMatchObject({ act: 'fire' });
    expect(named(choice)).toBe('feature');
    expect(choice.act === 'fire' && choice.step.id).toBe('step');
  });

  it('takes the most urgent step, not the first one written', () => {
    // Reading order puts the shopping feature first; priority 1 outranks it,
    // and the answer is the feature above the urgent step rather than the
    // feature that happens to sit at the top of the page.
    const sections = tree([
      item({ id: 'calm' }),
      item({ id: 'calm-step', parentId: 'calm', priority: 3 }),
      item({ id: 'urgent' }),
      item({ id: 'urgent-step', parentId: 'urgent', priority: 1 }),
    ]);

    expect(named(chooseOvernightFeature(sections, night(), MIDNIGHT))).toBe('urgent');
  });

  it('answers a feature with no steps with itself', () => {
    const sections = tree([item({ id: 'lonely' })]);

    const choice = chooseOvernightFeature(sections, night(), MIDNIGHT);

    expect(named(choice)).toBe('lonely');
    expect(choice.act === 'fire' && choice.step.id).toBe('lonely');
  });

  it('never names a feature with no ready step beneath it', () => {
    // Every way a feature can look like work and have nothing pickable under
    // it, in one plan: a step underway, one blocked on the outside world, one
    // waiting on a step that is still open, one that is the person's, one
    // that is a question for the person, and one that is only a proposal. The
    // one feature with a genuinely ready step is the only answer available.
    const sections = tree(
      [
        item({ id: 'underway' }),
        item({ id: 'underway-step', parentId: 'underway', status: 'in_progress' }),
        item({ id: 'stuck' }),
        item({ id: 'stuck-step', parentId: 'stuck', status: 'blocked' }),
        item({ id: 'waiting' }),
        item({ id: 'waiting-step', parentId: 'waiting' }),
        item({ id: 'open-dep', assignee: 'me' }),
        item({ id: 'yours' }),
        item({ id: 'yours-step', parentId: 'yours', assignee: 'me' }),
        item({ id: 'asking' }),
        item({ id: 'asking-step', parentId: 'asking', kind: 'decision' }),
        item({ id: 'unagreed', status: 'proposed' }),
        item({ id: 'unagreed-step', parentId: 'unagreed' }),
        item({ id: 'real' }),
        item({ id: 'real-step', parentId: 'real', priority: 3 }),
      ],
      [dep('waiting-step', 'open-dep')],
    );

    // Lowest priority of the lot, so nothing but the exclusions can be what
    // puts it first.
    expect(named(chooseOvernightFeature(sections, night(), MIDNIGHT))).toBe('real');

    // And the same rule read the other way: every feature the order can reach
    // has a ready step under it, because the order is where features come from.
    const ready = new Set(workOrder(sections, { assignee: 'claude' }).map((node) => node.id));
    expect([...ready]).toEqual(['real-step']);
  });

  it('stops when nothing assigned to Claude is ready', () => {
    const sections = tree([
      item({ id: 'yours' }),
      item({ id: 'yours-step', parentId: 'yours', assignee: 'me' }),
    ]);

    expect(chooseOvernightFeature(sections, night(), MIDNIGHT)).toEqual({
      act: 'end',
      reason: OVERNIGHT_NOTHING_READY,
    });
  });

  it('stops on an empty plan', () => {
    expect(chooseOvernightFeature(tree([]), night(), MIDNIGHT)).toEqual({
      act: 'end',
      reason: OVERNIGHT_NOTHING_READY,
    });
  });

  it('stops when the budget is spent, with work still waiting', () => {
    const run = night({ featuresLeft: 0, featuresBudget: 6 });

    expect(chooseOvernightFeature(tree(oneReadyFeature()), run, MIDNIGHT)).toEqual({
      act: 'end',
      reason: budgetSpentReason(run),
    });
  });

  it('stops when the stop time has passed', () => {
    const past = Date.parse(SEVEN_AM) + 1;

    expect(chooseOvernightFeature(tree(oneReadyFeature()), night(), past)).toEqual({
      act: 'end',
      reason: OVERNIGHT_TIME_UP,
    });
  });

  it('holds when the night is paused', () => {
    expect(
      chooseOvernightFeature(tree(oneReadyFeature()), night({ paused: true }), MIDNIGHT),
    ).toEqual({
      act: 'paused',
    });
  });

  it('is idle when there is no night, and when the last one is over', () => {
    const sections = tree(oneReadyFeature());

    expect(chooseOvernightFeature(sections, null, MIDNIGHT)).toEqual({ act: 'idle' });
    expect(chooseOvernightFeature(sections, night({ running: false }), MIDNIGHT)).toEqual({
      act: 'idle',
    });
  });

  it('reads the row before the plan, so an ended night keeps its own reason', () => {
    // A night with nothing left to build and no budget left ends on the budget.
    // The other way round, the report would read back "nothing was ready" for a
    // night that in fact fired everything it was given.
    const run = night({ featuresLeft: 0 });

    expect(chooseOvernightFeature(tree([]), run, MIDNIGHT)).toEqual({
      act: 'end',
      reason: budgetSpentReason(run),
    });
  });

  it('ends its reasons with a full stop, since the report prints them whole', () => {
    expect(OVERNIGHT_NOTHING_READY.endsWith('.')).toBe(true);
    expect(OVERNIGHT_NOTHING_READY.length).toBeLessThanOrEqual(500);
  });
});
