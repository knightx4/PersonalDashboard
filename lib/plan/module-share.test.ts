import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree, findNode, type PlanSection } from '@/lib/plan/tree';
import { besideRunning, footprintOf, footprintsMeet } from './module-share';

let counter = 0;

function item(over: Partial<PlanItem> & { id: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'learn',
    parentId: null,
    title: `Step ${over.id}`,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    track: 'feature',
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
    ...over,
  } as PlanItem;
}

function tree(items: PlanItem[]): PlanSection[] {
  return buildPlanTree({ items, dependencies: [] });
}

function ids(sections: PlanSection[]): string[] {
  return sections.flatMap((section) => section.nodes.map((node) => node.id));
}

describe('footprintOf', () => {
  it('places files at their folder and reads the module page addresses', () => {
    const sections = tree([
      item({ id: 'f', detail: 'The map on /learn/space, not /dev/plan.' }),
      item({
        id: 's',
        parentId: 'f',
        detail: 'Edit `app/learn/space/idea-plot.tsx` and lib/learn/map/view.ts.',
      }),
    ]);
    expect(footprintOf(findNode(sections, 'f')!)).toEqual({
      places: ['app/learn/space', 'lib/learn/map'],
      migration: false,
    });
  });

  it('reads only open steps, and notes a migration in one', () => {
    const sections = tree([
      item({ id: 'f' }),
      item({ id: 'done', parentId: 'f', status: 'done', detail: 'lib/learn/old/thing.ts' }),
      item({
        id: 'open',
        parentId: 'f',
        detail: 'A migration adds a column; lib/learn/map/load.ts reads it.',
      }),
    ]);
    expect(footprintOf(findNode(sections, 'f')!)).toEqual({
      places: ['lib/learn/map'],
      migration: true,
    });
  });
});

describe('footprintsMeet', () => {
  it('counts a feature that names nothing as meeting everything', () => {
    expect(
      footprintsMeet({ places: [], migration: false }, { places: ['app/x'], migration: false }),
    ).toBe(true);
  });

  it('counts two migrations as meeting, since they would take one number', () => {
    expect(
      footprintsMeet(
        { places: ['app/a'], migration: true },
        { places: ['app/b'], migration: true },
      ),
    ).toBe(true);
  });

  it('meets when one place sits inside the other, and not for neighbours', () => {
    expect(
      footprintsMeet(
        { places: ['lib/learn'], migration: false },
        { places: ['lib/learn/map'], migration: false },
      ),
    ).toBe(true);
    expect(
      footprintsMeet(
        { places: ['lib/learn/map'], migration: false },
        { places: ['lib/learn/maps'], migration: false },
      ),
    ).toBe(false);
  });
});

describe('besideRunning', () => {
  it('keeps a feature in a busy module whose work does not meet the running one', () => {
    const sections = tree([
      item({ id: 'run', detail: 'app/learn/now/page.tsx' }),
      item({ id: 'clear', detail: 'app/learn/space/page.tsx' }),
      item({ id: 'clash', detail: 'app/learn/now/reader.tsx' }),
      item({ id: 'silent' }),
      item({ id: 'todo', module: 'todo' }),
    ]);
    expect(ids(besideRunning(sections, ['run'])).sort()).toEqual(['clear', 'todo']);
  });

  it('never shares among features with no module', () => {
    const sections = tree([
      item({ id: 'a', module: null, detail: 'app/a/page.tsx' }),
      item({ id: 'b', module: null, detail: 'app/b/page.tsx' }),
    ]);
    expect(ids(besideRunning(sections, ['a']))).toEqual([]);
  });
});
