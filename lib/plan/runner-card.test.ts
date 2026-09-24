/**
 * What the runner's card is handed, on both pages that draw it.
 *
 * The plan page and Dash used to build these props separately and came to
 * different answers: one named every session running and the other only the
 * last fire, one gave progress and the other did not. These check the one
 * reading both now share.
 */
import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import type { OvernightRun } from '@/lib/plan/overnight';
import { runnerCard } from '@/lib/plan/runner-card';
import { buildPlanTree } from '@/lib/plan/tree';

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
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: null,
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    updatedAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    ...over,
  };
}

function run(over: Partial<OvernightRun> = {}): OvernightRun {
  return {
    id: 'run-1',
    running: true,
    paused: false,
    featuresBudget: 6,
    featuresLeft: 5,
    stopBy: null,
    startedAt: '2026-09-17T23:00:00.000Z',
    lastFiredAt: '2026-09-17T23:05:00.000Z',
    endedAt: null,
    endedReason: null,
    lastTickAt: null,
    lastTickNote: null,
    createdAt: '2026-09-17T23:00:00.000Z',
    updatedAt: '2026-09-17T23:05:00.000Z',
    ...over,
  };
}

// Two features: one a session is on, half done; one waiting with a ready step.
const busy = item({ id: 'busy', title: 'Busy feature' });
const items = [
  busy,
  item({ id: 'b1', parentId: 'busy', status: 'done' }),
  item({ id: 'b2', parentId: 'busy', status: 'in_progress' }),
  item({ id: 'waiting', title: 'Waiting feature' }),
  item({ id: 'w1', parentId: 'waiting' }),
];
const sections = buildPlanTree({ items, dependencies: [] });
const started = [{ planItemId: 'busy', at: '2026-09-17T23:05:00.000Z' }];

function read(over: Partial<Parameters<typeof runnerCard>[0]> = {}) {
  return runnerCard({
    run: run(),
    fires: [{ planItemId: 'busy', at: '2026-09-17T23:05:00.000Z' }],
    items,
    sections,
    started,
    lastRuns: [],
    ...over,
  });
}

describe('runnerCard', () => {
  it('names every session going, each with its progress through its feature', () => {
    const card = read();
    expect(card.on.map((line) => line.ref)).toEqual([`#${busy.number}`]);
    expect(card.on[0].progress).toEqual({ done: 1, total: 2 });
  });

  it('names what would be fired next, leaving out what a session is already on', () => {
    const card = read();
    expect(card.next.map((feature) => feature.title)).toEqual(['Waiting feature']);
  });

  it('still reads a night once it has stopped, but names no session on it', () => {
    const card = read({
      run: run({ running: false, endedAt: '2026-09-18T01:00:00.000Z', endedReason: 'Done.' }),
    });
    expect(card.night?.standing).toBe('stopped');
    expect(card.on).toEqual([]);
    expect(card.push).toBeNull();
  });

  it('has no night when the runner has never been started', () => {
    expect(read({ run: null }).night).toBeNull();
  });
});
