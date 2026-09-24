import { describe, expect, it } from 'vitest';
import {
  MAX_TARGETS_PER_ROUND,
  PICK_RESERVE_MS,
  READY_BATCH,
  READY_LOW,
  planTopUp,
  runTopUpFor,
  type TopUpPorts,
} from './top-up';
import type { CardToWrite, WriteResult } from './write-card';

/**
 * Keeping twenty cards ready: the arithmetic, and the loop over fake ports.
 */

describe('planning a top-up', () => {
  it('writes only what the target is short by', () => {
    expect(planTopUp({ ready: 12, picked: 30, target: 20 })).toEqual({ write: 8, draw: 0 });
  });

  it('does nothing at or above the target', () => {
    expect(planTopUp({ ready: 20, picked: 5, target: 20 })).toEqual({ write: 0, draw: 0 });
    expect(planTopUp({ ready: 25, picked: 5, target: 20 })).toEqual({ write: 0, draw: 0 });
  });

  it('draws targets for what the picked rows cannot cover, with room for drops', () => {
    // 20 short, 4 picked: 16 uncovered, 20 with the allowance, 10 targets at two picks each, capped.
    expect(planTopUp({ ready: 0, picked: 4, target: 20 })).toEqual({ write: 4, draw: MAX_TARGETS_PER_ROUND });
    // 3 uncovered: 3.75 with the allowance, two targets.
    expect(planTopUp({ ready: 17, picked: 0, target: 20 })).toEqual({ write: 0, draw: 2 });
    // 1 uncovered still draws one.
    expect(planTopUp({ ready: 19, picked: 0, target: 20 })).toEqual({ write: 0, draw: 1 });
  });
});

function card(id: string): CardToWrite {
  return {
    id,
    reason: 'interest',
    themeName: 'Theme',
    aimName: null,
    field: { name: 'Field', scope: '' },
    gap: null,
    article: `Article ${id}`,
    section: null,
    text: 'Text.',
    depth: 'working',
  };
}

type Fake = {
  ports: TopUpPorts;
  picked: CardToWrite[];
  ready: number;
  writes: string[];
  picks: number[];
};

/**
 * A person with `ready` cards and `picked` rows. `outcome` decides each write;
 * a pick round adds `perPick` rows per target drawn.
 */
function fake(options: {
  ready: number;
  picked: number;
  outcome?: (id: string) => WriteResult['outcome'];
  perPick?: number;
  clock?: () => number;
}): Fake {
  let next = 0;
  const state: Fake = {
    picked: Array.from({ length: options.picked }, () => card(`p${next++}`)),
    ready: options.ready,
    writes: [],
    picks: [],
    ports: undefined as unknown as TopUpPorts,
  };
  state.ports = {
    countReady: async () => state.ready,
    loadPicked: async (_userId, limit) => state.picked.slice(0, limit),
    pick: async (_userId, targets) => {
      state.picks.push(targets);
      const added = targets * (options.perPick ?? 2);
      for (let i = 0; i < added; i += 1) state.picked.push(card(`p${next++}`));
      return added;
    },
    write: async (_userId, written) => {
      state.writes.push(written.id);
      const outcome = options.outcome?.(written.id) ?? 'ready';
      if (outcome !== 'failed') state.picked = state.picked.filter((row) => row.id !== written.id);
      if (outcome === 'ready') {
        state.ready += 1;
        return { outcome, context: 'C.', hook: 'H.', summary: 'S.', example: 'E.', question: null, answer: null, why: 'W.' };
      }
      return outcome === 'dropped' ? { outcome, reason: 'Off topic.' } : { outcome, detail: 'Down.' };
    },
    now: options.clock ?? (() => 0),
  };
  return state;
}

const far = Number.MAX_SAFE_INTEGER;

describe('topping up one person', () => {
  it('does nothing when enough are ready', async () => {
    const run = fake({ ready: 12, picked: 10 });
    const summary = await runTopUpFor(run.ports, { userId: 'u', threshold: 10, deadline: far });
    expect(summary).toMatchObject({ skipped: true, written: 0 });
    expect(run.writes).toHaveLength(0);
  });

  it('writes picked rows until twenty are ready, and no more', async () => {
    const run = fake({ ready: 5, picked: 30 });
    const summary = await runTopUpFor(run.ports, { userId: 'u', threshold: 20, deadline: far });
    expect(summary).toMatchObject({ readyBefore: 5, readyAfter: 20, written: 15, pickRounds: 0, stopped: null });
    expect(run.writes).toHaveLength(15);
  });

  it('after a response, starts at seven ready and writes fifteen (note 832dd774)', async () => {
    const eight = fake({ ready: 8, picked: 30 });
    expect(await runTopUpFor(eight.ports, { userId: 'u', threshold: READY_LOW, deadline: far })).toMatchObject({
      skipped: true,
    });

    const run = fake({ ready: 7, picked: 30 });
    const summary = await runTopUpFor(run.ports, {
      userId: 'u',
      threshold: READY_LOW,
      target: 7 + READY_BATCH,
      deadline: far,
    });
    expect(summary).toMatchObject({ readyBefore: 7, readyAfter: 22, written: 15 });
  });

  it('makes up drops from the next picked rows', async () => {
    const run = fake({ ready: 18, picked: 6, outcome: (id) => (id === 'p0' ? 'dropped' : 'ready') });
    const summary = await runTopUpFor(run.ports, { userId: 'u', threshold: 20, deadline: far });
    expect(summary.readyAfter).toBe(20);
    expect(summary.dropped).toEqual([{ article: 'Article p0', section: null, reason: 'Off topic.' }]);
    expect(run.writes).toEqual(['p0', 'p1', 'p2']);
  });

  it('picks more when the picked rows run out, then writes them', async () => {
    const run = fake({ ready: 0, picked: 3 });
    const summary = await runTopUpFor(run.ports, { userId: 'u', threshold: 10, deadline: far });
    expect(summary.readyAfter).toBe(20);
    expect(summary.pickRounds).toBe(2);
    expect(run.picks).toEqual([MAX_TARGETS_PER_ROUND, 4]);
    expect(summary.picked).toBe(20);
  });

  it('stops when picking finds nothing', async () => {
    const run = fake({ ready: 0, picked: 2, perPick: 0 });
    const summary = await runTopUpFor(run.ports, { userId: 'u', threshold: 10, deadline: far });
    expect(summary).toMatchObject({ readyAfter: 2, stopped: 'nothing-to-pick', pickRounds: 1 });
  });

  it('does not loop on writes that keep failing', async () => {
    const run = fake({ ready: 0, picked: 3, outcome: () => 'failed', perPick: 0 });
    const summary = await runTopUpFor(run.ports, { userId: 'u', threshold: 10, deadline: far });
    expect(summary.failed).toHaveLength(3);
    expect(run.writes).toHaveLength(3);
    expect(summary.readyAfter).toBe(0);
    expect(summary.stopped).toBe('no-progress');
  });

  it('starts nothing once the deadline has passed', async () => {
    const run = fake({ ready: 0, picked: 10, clock: () => 100 });
    const summary = await runTopUpFor(run.ports, { userId: 'u', threshold: 10, deadline: 50 });
    expect(summary).toMatchObject({ written: 0, stopped: 'deadline' });
  });

  it('does not start picking without time left to write the picks', async () => {
    const run = fake({ ready: 0, picked: 0, clock: () => 0 });
    const summary = await runTopUpFor(run.ports, { userId: 'u', threshold: 10, deadline: PICK_RESERVE_MS - 1 });
    expect(summary).toMatchObject({ pickRounds: 0, stopped: 'deadline' });
    expect(run.picks).toHaveLength(0);
  });
});
