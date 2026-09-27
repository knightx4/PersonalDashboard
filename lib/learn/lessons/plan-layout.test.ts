import { describe, expect, it } from 'vitest';
import type { LaidOutUnit } from './lay-out-unit';
import { MAX_PLAN_LAYOUTS_PER_RUN, layOutPlans, type PlanLayoutDue, type PlanLayoutPorts } from './plan-layout';
import { LAYOUT_RESERVE_MS, LESSON_HOLD_MS } from './top-up';

/**
 * Laying out a goal's plan ahead (plan #1143): a unit of up to two goal tracks
 * a run, whether or not Learn now is short, and a track whose layout failed is
 * held for a day.
 */

const NOW = 1_000_000;

function ports(due: PlanLayoutDue[], layOut: (subjectId: string) => LaidOutUnit | Promise<LaidOutUnit>) {
  const calls = { limit: 0, layOut: [] as string[], hold: [] as { subjectId: string; until: Date }[] };
  const value: PlanLayoutPorts = {
    due: async (_userId, limit) => {
      calls.limit = limit;
      return due.slice(0, limit);
    },
    layOut: async (_userId, subjectId) => {
      calls.layOut.push(subjectId);
      return layOut(subjectId);
    },
    hold: async (_userId, subjectId, until) => {
      calls.hold.push({ subjectId, until });
    },
    now: () => NOW,
  };
  return { ports: value, calls };
}

const track = (id: string): PlanLayoutDue => ({ subjectId: id, subjectName: id.toUpperCase() });
const laidOut = (id: string): LaidOutUnit => ({ outcome: 'laid-out', unitId: `${id}-u`, goalId: null, conceptIds: [] });

describe('layOutPlans', () => {
  it('lays out the next unit of at most two goal tracks', async () => {
    const { ports: p, calls } = ports([track('a'), track('b'), track('c')], laidOut);
    const summary = await layOutPlans(p, { userId: 'me', deadline: NOW + LAYOUT_RESERVE_MS });
    expect(calls.limit).toBe(MAX_PLAN_LAYOUTS_PER_RUN);
    expect(calls.layOut).toEqual(['a', 'b']);
    expect(summary).toMatchObject({ laidOut: ['a', 'b'], failed: [], held: [], stopped: null });
  });

  it('holds a track for a day when its layout fails or throws, and not when no unit is left', async () => {
    const { ports: p, calls } = ports([track('a'), track('b')], (id) => {
      if (id === 'a') return { outcome: 'failed', detail: 'the model said no' };
      throw new Error('boom');
    });
    const summary = await layOutPlans(p, { userId: 'me', deadline: NOW + LAYOUT_RESERVE_MS });
    expect(summary.failed).toEqual(['A: the model said no', 'B: boom']);
    expect(calls.hold).toEqual([
      { subjectId: 'a', until: new Date(NOW + LESSON_HOLD_MS) },
      { subjectId: 'b', until: new Date(NOW + LESSON_HOLD_MS) },
    ]);

    const none = ports([track('c')], () => ({ outcome: 'no-unit-left' }));
    expect(await layOutPlans(none.ports, { userId: 'me', deadline: NOW + LAYOUT_RESERVE_MS })).toMatchObject({
      laidOut: [],
      failed: [],
      held: [],
    });
    expect(none.calls.hold).toEqual([]);
  });

  it('lays nothing out when too little time is left', async () => {
    const { ports: p, calls } = ports([track('a')], laidOut);
    const summary = await layOutPlans(p, { userId: 'me', deadline: NOW + LAYOUT_RESERVE_MS - 1 });
    expect(calls.layOut).toEqual([]);
    expect(summary.stopped).toBe('deadline');
  });
});
