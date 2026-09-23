import { describe, expect, it } from 'vitest';
import type { PlanDependency, PlanItem, PlanStatus } from '@/lib/plan/load';
import {
  ancestorsOf,
  applyView,
  blockRefusal,
  buildPlanTree,
  splitFinished,
  searchNodes,
  PLAN_VIEWS,
  PLAN_VIEW_CHIPS,
  PLAN_VIEW_MENU,
  findNode,
  flattenSections,
  isReady,
  isWaitingOnThePerson,
  leavesOf,
  healthOf,
  moveOf,
  needsThePerson,
  planBands,
  planLiveness,
  PLAN_BAND_ORDER,
  tallyHealth,
  planProgress,
  subtreeIds,
  summarize,
  workOrder,
  searchSections,
  countMatches,
} from '@/lib/plan/tree';
import { MODULES } from '@/lib/modules';

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

const at = (status: PlanStatus, id: string, over: Partial<PlanItem> = {}) =>
  item({ id, status, ...over });

function dep(itemId: string, dependsOnId: string): PlanDependency {
  return { id: `${itemId}->${dependsOnId}`, itemId, dependsOnId };
}

function tree(items: PlanItem[], dependencies: PlanDependency[] = []) {
  return buildPlanTree({ items, dependencies });
}

const shopping = (sections: ReturnType<typeof tree>) =>
  sections.find((section) => section.module === 'shopping')!;

describe('planProgress', () => {
  it('counts what is done against what is still live', () => {
    expect(
      planProgress([
        at('done', 'a'),
        at('done', 'b'),
        at('not_started', 'c'),
        at('in_progress', 'd'),
      ]),
    ).toMatchObject({ done: 2, inProgress: 1, live: 4, fraction: 0.5 });
  });

  it('leaves a dropped step out of the denominator', () => {
    // Otherwise a module you finished sits at 90% forever because of one step
    // you decided against.
    expect(planProgress([at('done', 'a'), at('dropped', 'b')])).toMatchObject({
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

  it('leaves a proposed step out of the denominator, because nobody has said yes to it', () => {
    expect(planProgress([at('done', 'a'), at('proposed', 'b')]).fraction).toBe(1);
    expect(planProgress([at('proposed', 'a')]).fraction).toBeNull();
  });

  it('counts a blocked step as live, not done, and on its own', () => {
    expect(planProgress([at('blocked', 'a'), at('done', 'b')])).toEqual({
      done: 1,
      inProgress: 0,
      blocked: 1,
      ready: 0,
      live: 2,
      fraction: 0.5,
    });
  });

  // Note c12fe73a: the Steps column shows what is ready apart from the rest.
  it('counts a ready step once, and never one that is blocked', () => {
    expect(
      planProgress([
        { ...at('not_started', 'a'), ready: true },
        { ...at('not_started', 'b'), ready: false },
        { ...at('blocked', 'c'), ready: true },
      ]),
    ).toMatchObject({ ready: 1, blocked: 1, live: 3 });
  });
});

describe('buildPlanTree', () => {
  it('gives every module a section, even one with no steps yet', () => {
    const sections = tree([item({ id: 'a', module: 'jobs' })]);
    expect(sections.map((section) => section.module)).toEqual(MODULES.map((m) => m.id));
    expect(sections.find((section) => section.module === 'vault')?.nodes).toEqual([]);
  });

  it('shows the app-wide section only once something is in it', () => {
    expect(tree([item({ id: 'a' })]).some((s) => s.module === null)).toBe(false);
    expect(tree([item({ id: 'a', module: null })]).some((s) => s.module === null)).toBe(true);
  });

  it('numbers a step as its place under its feature, and keeps its handle', () => {
    // Note 4ff04135: #125's steps should read 125.1, 125.2, 125.3.
    const sections = tree([
      item({ id: 'feature', number: 125 }),
      item({ id: 'one', number: 131, parentId: 'feature', position: 10 }),
      item({ id: 'two', number: 128, parentId: 'feature', position: 20 }),
      item({ id: 'under', number: 140, parentId: 'two', position: 10 }),
    ]);
    const [feature] = shopping(sections).nodes;

    expect(feature.outline).toBe('125');
    expect(feature.children.map((n) => n.outline)).toEqual(['125.1', '125.2']);
    expect(feature.children[1].children[0].outline).toBe('125.2.1');
    // The number is the identity and does not move.
    expect(feature.children.map((n) => n.number)).toEqual([131, 128]);
  });

  it('does not renumber the steps a view or a search hid', () => {
    const items = [
      item({ id: 'feature', number: 200 }),
      item({ id: 'one', number: 201, parentId: 'feature', position: 10, status: 'done' }),
      item({ id: 'two', number: 202, parentId: 'feature', position: 20 }),
    ];
    const open = applyView(tree(items), 'open');
    const [feature] = shopping(open).nodes;

    expect(feature.children.map((n) => n.outline)).toEqual(['200.2']);
  });

  it('finds a step by the outline it is read by as well as by its number', () => {
    const sections = tree([
      item({ id: 'feature', number: 300, title: 'The feature' }),
      item({ id: 'step', number: 307, title: 'The step', parentId: 'feature' }),
    ]);

    expect(countMatches(searchSections(sections, '300.1'))).toBe(1);
    expect(countMatches(searchSections(sections, '#307'))).toBe(1);
  });

  it('nests steps under their parent, to any depth', () => {
    const sections = tree([
      item({ id: 'feature' }),
      item({ id: 'step', parentId: 'feature' }),
      item({ id: 'substep', parentId: 'step' }),
      item({ id: 'leaf', parentId: 'substep' }),
    ]);
    const [feature] = shopping(sections).nodes;
    expect(feature.id).toBe('feature');
    expect(feature.depth).toBe(0);
    expect(feature.children.map((n) => n.id)).toEqual(['step']);
    expect(feature.children[0].children[0].children[0].id).toBe('leaf');
    expect(feature.children[0].children[0].children[0].depth).toBe(3);
  });

  it('orders siblings by position, then by age', () => {
    const sections = tree([
      item({ id: 'third', position: 30 }),
      item({ id: 'first', position: 10 }),
      item({ id: 'second', position: 20 }),
      item({ id: 'older-tie', position: 20, createdAt: '2025-01-01T00:00:00Z' }),
    ]);
    expect(shopping(sections).nodes.map((n) => n.id)).toEqual([
      'first',
      'older-tie',
      'second',
      'third',
    ]);
  });

  it('puts every step in exactly one place', () => {
    const sections = tree([
      item({ id: 'a', module: 'jobs' }),
      item({ id: 'b' }),
      item({ id: 'c', parentId: 'b' }),
      item({ id: 'd', module: null }),
    ]);
    expect(
      flattenSections(sections)
        .map((node) => node.id)
        .sort(),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('shows a step whose parent is missing at the top rather than losing it', () => {
    const sections = tree([item({ id: 'orphan', parentId: 'gone' })]);
    expect(shopping(sections).nodes.map((n) => n.id)).toEqual(['orphan']);
    expect(shopping(sections).nodes[0].depth).toBe(0);
  });

  it('rolls a feature up over its leaf steps, not its intermediate ones', () => {
    const sections = tree([
      item({ id: 'feature' }),
      at('done', 'group', { parentId: 'feature' }),
      at('done', 'g1', { parentId: 'group' }),
      at('not_started', 'g2', { parentId: 'group' }),
      at('in_progress', 'direct', { parentId: 'feature' }),
    ]);
    const [feature] = shopping(sections).nodes;
    // g1, g2 and direct are the leaves; "group" is a container and does not
    // count, even though it is marked done.
    expect(feature.rollup).toMatchObject({ done: 1, inProgress: 1, live: 3, fraction: 1 / 3 });
    expect(feature.children[1].rollup.live).toBe(0);
  });

  it('measures a module over its leaves, so a feature with steps is not double counted', () => {
    const sections = tree([
      item({ id: 'feature' }),
      at('done', 's1', { parentId: 'feature' }),
      at('done', 's2', { parentId: 'feature' }),
      at('not_started', 'alone'),
    ]);
    expect(shopping(sections).progress).toMatchObject({
      done: 2,
      inProgress: 0,
      live: 3,
      fraction: 2 / 3,
    });
    expect(leavesOf(shopping(sections).nodes).map((n) => n.id)).toEqual(['s1', 's2', 'alone']);
  });
});

describe('dependencies', () => {
  it('resolves what a step waits on and what it unblocks', () => {
    const sections = tree(
      [item({ id: 'schema' }), item({ id: 'page' }), at('done', 'rpc')],
      [dep('page', 'schema'), dep('page', 'rpc')],
    );
    const page = findNode(sections, 'page')!;
    expect(page.dependsOn.map((link) => link.item.id)).toEqual(['schema', 'rpc']);
    // Only the unfinished one still holds it up.
    expect(page.waitingOn.map((ref) => ref.id)).toEqual(['schema']);
    expect(findNode(sections, 'schema')!.blocks.map((ref) => ref.id)).toEqual(['page']);
  });

  it('passes a feature’s wait down to every step under it', () => {
    const sections = tree(
      [
        item({ id: 'auth' }),
        item({ id: 'feature' }),
        item({ id: 'step', parentId: 'feature' }),
        item({ id: 'substep', parentId: 'step' }),
      ],
      [dep('feature', 'auth')],
    );
    expect(findNode(sections, 'substep')!.waitingOn.map((ref) => ref.id)).toEqual(['auth']);
    // Declared on the feature, not on the substep: the two lists differ.
    expect(findNode(sections, 'substep')!.dependsOn).toEqual([]);
  });

  it('names an inherited and an own wait on the same step once', () => {
    const sections = tree(
      [item({ id: 'auth' }), item({ id: 'feature' }), item({ id: 'step', parentId: 'feature' })],
      [dep('feature', 'auth'), dep('step', 'auth')],
    );
    expect(findNode(sections, 'step')!.waitingOn.map((ref) => ref.id)).toEqual(['auth']);
  });

  it('ignores a dependency pointing at a step that no longer exists', () => {
    const sections = tree([item({ id: 'a' })], [dep('a', 'gone'), dep('gone', 'a')]);
    expect(findNode(sections, 'a')!.dependsOn).toEqual([]);
    expect(findNode(sections, 'a')!.blocks).toEqual([]);
  });
});

describe('isReady', () => {
  const bare = { waitingOn: [], children: [], dependsOn: [], blockKind: null };

  it('is a step not yet started, waiting on nothing, with nothing open beneath it', () => {
    expect(isReady({ status: 'not_started', ...bare }, [])).toBe(true);
  });

  it('is not a step underway, blocked, done, dropped or merely proposed', () => {
    for (const status of ['proposed', 'in_progress', 'blocked', 'done', 'dropped'] as const) {
      expect(isReady({ status, ...bare }, [])).toBe(false);
    }
  });

  it('is a step blocked on steps whose every named dependency has since closed', () => {
    // #20 sat blocked on #127 for a day after #127 shipped. A block that
    // records dependencies has told the plan what it was waiting for, and once
    // those are closed there is nothing on record holding it.
    const sections = tree(
      [at('done', 'a'), at('blocked', 'b', { blockKind: 'steps' })],
      [dep('b', 'a')],
    );
    expect(findNode(sections, 'b')!.ready).toBe(true);
  });

  it('is not a step blocked on something outside the plan, whatever has closed', () => {
    // #499's three dependencies all closed and its block was about a GitHub
    // token. Nothing on the plan produces the token, so nothing on the plan
    // makes the step ready.
    const sections = tree(
      [at('done', 'a'), at('blocked', 'b', { blockKind: 'outside' })],
      [dep('b', 'a')],
    );
    expect(findNode(sections, 'b')!.ready).toBe(false);
  });

  it('is not a blocked step with no kind recorded, which reads as outside', () => {
    const sections = tree([at('done', 'a'), at('blocked', 'b')], [dep('b', 'a')]);
    expect(findNode(sections, 'b')!.ready).toBe(false);
  });

  it('is not a blocked step with a dependency still open', () => {
    const sections = tree(
      [item({ id: 'a' }), at('blocked', 'b', { blockKind: 'steps' })],
      [dep('b', 'a')],
    );
    expect(findNode(sections, 'b')!.ready).toBe(false);
  });

  it('is not a blocked step that named no dependency at all', () => {
    // The honest use of the status: it needs a credential, or an answer, and
    // no amount of other work produces one.
    const sections = tree([at('blocked', 'b')]);
    expect(findNode(sections, 'b')!.ready).toBe(false);
  });

  it('is not a step still waiting on another', () => {
    const sections = tree([item({ id: 'a' }), item({ id: 'b' })], [dep('b', 'a')]);
    expect(findNode(sections, 'a')!.ready).toBe(true);
    expect(findNode(sections, 'b')!.ready).toBe(false);
  });

  it('becomes ready the moment what it waited on is done', () => {
    const sections = tree([at('done', 'a'), item({ id: 'b' })], [dep('b', 'a')]);
    expect(findNode(sections, 'b')!.ready).toBe(true);
  });

  it('treats a dropped dependency as out of the way', () => {
    // Freezing a step forever behind a decision not to do something else is
    // worse than letting it through; the page shows the dropped one plainly.
    const sections = tree([at('dropped', 'a'), item({ id: 'b' })], [dep('b', 'a')]);
    expect(findNode(sections, 'b')!.ready).toBe(true);
  });

  it('is not a feature whose steps are still open — its steps are', () => {
    const sections = tree([item({ id: 'feature' }), item({ id: 'step', parentId: 'feature' })]);
    expect(findNode(sections, 'feature')!.ready).toBe(false);
    expect(findNode(sections, 'step')!.ready).toBe(true);
  });

  it('is a feature whose steps are all closed, because closing it is what is left', () => {
    const sections = tree([
      item({ id: 'feature' }),
      at('done', 's1', { parentId: 'feature' }),
      at('dropped', 's2', { parentId: 'feature' }),
    ]);
    expect(findNode(sections, 'feature')!.ready).toBe(true);
  });

  it('is not a step under a blocked, dropped or proposed feature', () => {
    const sections = tree([
      at('blocked', 'stuck'),
      item({ id: 'under-stuck', parentId: 'stuck' }),
      at('dropped', 'gone'),
      item({ id: 'under-gone', parentId: 'gone' }),
      at('proposed', 'maybe'),
      item({ id: 'under-maybe', parentId: 'maybe' }),
      at('in_progress', 'live'),
      item({ id: 'under-live', parentId: 'live' }),
    ]);
    expect(findNode(sections, 'under-stuck')!.ready).toBe(false);
    expect(findNode(sections, 'under-gone')!.ready).toBe(false);
    expect(findNode(sections, 'under-maybe')!.ready).toBe(false);
    expect(findNode(sections, 'under-live')!.ready).toBe(true);
  });

  it('is a step under a feature blocked on its own steps', () => {
    // #494 and #578 were each marked blocked over a question on one step, and
    // between them took five priority-one features out of the runner's reach.
    // A feature waiting on the rows beneath it cannot also be what hides them.
    const sections = tree([
      at('blocked', 'feature', { blockKind: 'steps' }),
      at('blocked', 'stuck', { parentId: 'feature', blockKind: 'outside' }),
      item({ id: 'free', parentId: 'feature' }),
    ]);
    expect(findNode(sections, 'free')!.ready).toBe(true);
    expect(findNode(sections, 'stuck')!.ready).toBe(false);
  });

  it('is not a step under a feature blocked on something outside the plan', () => {
    // The feature is waiting on a credential, and so is everything under it.
    const sections = tree([
      at('blocked', 'feature', { blockKind: 'outside' }),
      item({ id: 'step', parentId: 'feature' }),
    ]);
    expect(findNode(sections, 'step')!.ready).toBe(false);
  });

  it('keeps a step ready under a feature whose own dependencies are all open', () => {
    // The feature's wait is inherited as a dependency, so a step under it is
    // held by that and not by the parent's status column.
    const sections = tree(
      [
        item({ id: 'other' }),
        at('blocked', 'feature', { blockKind: 'steps' }),
        item({ id: 'step', parentId: 'feature' }),
      ],
      [dep('feature', 'other')],
    );
    expect(findNode(sections, 'step')!.ready).toBe(false);
  });
});

describe('applyView', () => {
  const fixture = () =>
    tree(
      [
        // Kept for yourself, both of them, because the Dash view needs a row
        // that does not match and a module with nothing to show for the two
        // tests below to have a subject. Approving is the hand-over now, so a
        // step with nobody on it is Dash's.
        item({ id: 'feature', assignee: 'me' }),
        at('done', 'done-step', { parentId: 'feature' }),
        at('not_started', 'open-step', { parentId: 'feature' }),
        at('blocked', 'stuck', { parentId: 'feature' }),
        at('done', 'finished-feature', { module: 'jobs' }),
        item({ id: 'waits', module: 'jobs', assignee: 'me' }),
      ],
      [dep('waits', 'feature')],
    );

  it('returns everything untouched for "all"', () => {
    const sections = fixture();
    expect(applyView(sections, 'all')).toEqual(sections);
  });

  it('keeps a step that does not match when one beneath it does, and says so', () => {
    const [section] = applyView(fixture(), 'claude');
    expect(section.module).toBe('shopping');
    const [feature] = section.nodes;
    expect(feature.matches).toBe(false);
    expect(feature.children.map((n) => n.id)).toEqual(['open-step']);
    expect(feature.children[0].matches).toBe(true);
  });

  it('drops closed steps under "open" and modules with nothing left', () => {
    const sections = applyView(fixture(), 'open');
    const ids = flattenSections(sections).map((n) => n.id);
    expect(ids).not.toContain('done-step');
    expect(ids).not.toContain('finished-feature');
    expect(ids).toContain('waits');
  });

  it('shows the by-hand blocked and the waiting-on-another together under "blocked"', () => {
    const ids = flattenSections(applyView(fixture(), 'blocked'))
      .filter((n) => n.matches)
      .map((n) => n.id);
    expect(ids.sort()).toEqual(['stuck', 'waits']);
  });

  it('shows only the proposals under "proposed", in their place', () => {
    const sections = tree([
      item({ id: 'feature' }),
      at('proposed', 'maybe', { parentId: 'feature' }),
      at('proposed', 'maybe-too', { parentId: 'maybe' }),
      item({ id: 'decided', parentId: 'feature' }),
    ]);
    const shown = flattenSections(applyView(sections, 'proposed'));
    expect(shown.map((n) => n.id)).toEqual(['feature', 'maybe', 'maybe-too']);
    expect(shown.map((n) => n.matches)).toEqual([false, true, true]);
  });

  it('leaves the module’s progress over the whole plan', () => {
    const before = shopping(fixture()).progress;
    const [after] = applyView(fixture(), 'ready');
    expect(after.progress).toEqual(before);
  });

  it('leaves out modules that have nothing to show, so a narrowed page is short', () => {
    expect(applyView(fixture(), 'claude').map((s) => s.module)).toEqual(['shopping']);
  });

  it('shows a step nobody was assigned under "claude", and no proposal', () => {
    const sections = tree([
      item({ id: 'nobody' }),
      item({ id: 'kept', assignee: 'me' }),
      at('proposed', 'suggested'),
    ]);
    expect(flattenSections(applyView(sections, 'claude')).map((n) => n.id)).toEqual(['nobody']);
    expect(summarize(sections).claude).toBe(1);
  });

  it('drops a module with nothing open from "open" as well', () => {
    // 'jobs' holds one finished feature and one step waiting on another, so it
    // stays; the modules with nothing at all in them go. The two that stay
    // keep the fixed module order they came in.
    expect(applyView(fixture(), 'open').map((s) => s.module)).toEqual(['shopping', 'jobs']);
  });

  it('keeps every module under "all", because that is where a plan gets written', () => {
    expect(applyView(fixture(), 'all').map((s) => s.module)).toEqual(
      fixture().map((s) => s.module),
    );
  });
});

describe('the chip row', () => {
  it('draws five views and keeps every other one in the menu', () => {
    expect([...PLAN_VIEW_CHIPS]).toEqual(['open', 'ready', 'you', 'claude', 'all']);
    expect([...PLAN_VIEW_CHIPS, ...PLAN_VIEW_MENU].sort()).toEqual([...PLAN_VIEWS].sort());
    expect(
      PLAN_VIEW_MENU.some((view) => (PLAN_VIEW_CHIPS as readonly string[]).includes(view)),
    ).toBe(false);
  });
});

describe('ordering the features inside a section', () => {
  const fixture = () =>
    tree([
      item({ id: 'first', position: 10, updatedAt: '2026-01-01T00:00:00Z' }),
      item({
        id: 'first-step',
        parentId: 'first',
        position: 10,
        updatedAt: '2026-01-01T00:00:00Z',
      }),
      item({ id: 'second', position: 20, updatedAt: '2026-02-01T00:00:00Z' }),
      item({ id: 'third', position: 30, updatedAt: '2026-01-15T00:00:00Z' }),
      // Closed this morning. It used to lift its feature to the top of the
      // section; nothing moves for it now.
      at('done', 'third-step', {
        parentId: 'third',
        position: 10,
        updatedAt: '2026-03-01T00:00:00Z',
      }),
      item({
        id: 'third-next',
        parentId: 'third',
        position: 20,
        updatedAt: '2026-01-15T00:00:00Z',
      }),
    ]);

  it('keeps the plan’s own order in a working view, whatever was touched last', () => {
    expect(shopping(applyView(fixture(), 'open')).nodes.map((node) => node.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('leaves the steps under a feature in the order they are built in', () => {
    const third = shopping(applyView(fixture(), 'open')).nodes[2];
    expect(third.children.map((node) => node.id)).toEqual(['third-next']);
    expect(shopping(applyView(fixture(), 'all')).nodes[2].children.map((n) => n.id)).toEqual([
      'third-step',
      'third-next',
    ]);
  });

  it('keeps "all" in that same order', () => {
    expect(shopping(applyView(fixture(), 'all')).nodes.map((node) => node.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});

describe('ordering the module sections', () => {
  // The app-wide section is fixed last and stays last, whatever was worked in
  // it this morning.
  const fixture = () =>
    tree([
      item({ id: 'shop', module: 'shopping', updatedAt: '2026-01-01T00:00:00Z' }),
      item({
        id: 'shop-step',
        parentId: 'shop',
        module: 'shopping',
        updatedAt: '2026-01-01T00:00:00Z',
      }),
      item({ id: 'job', module: 'jobs', updatedAt: '2026-01-10T00:00:00Z' }),
      item({ id: 'job-step', parentId: 'job', module: 'jobs', updatedAt: '2026-01-10T00:00:00Z' }),
      item({ id: 'wide', module: null, updatedAt: '2026-02-01T00:00:00Z' }),
      item({ id: 'wide-step', parentId: 'wide', module: null, updatedAt: '2026-02-01T00:00:00Z' }),
    ]);

  it('draws the modules in their fixed order, newest work or not', () => {
    // 'wide' is the newest row in the fixture and the app-wide section is
    // still last, which is the whole of what #517 used to undo.
    expect(applyView(fixture(), 'open').map((section) => section.module)).toEqual([
      'shopping',
      'jobs',
      null,
    ]);
  });

  it('does not move a module for a step the view has dropped either', () => {
    const sections = tree([
      item({ id: 'shop', module: 'shopping', updatedAt: '2026-01-01T00:00:00Z' }),
      at('done', 'shop-step', {
        parentId: 'shop',
        module: 'shopping',
        updatedAt: '2026-03-01T00:00:00Z',
      }),
      item({ id: 'job', module: 'jobs', updatedAt: '2026-02-01T00:00:00Z' }),
    ]);
    expect(applyView(sections, 'open').map((section) => section.module)).toEqual([
      'shopping',
      'jobs',
    ]);
  });

  it('leaves the features and steps inside a section as they were', () => {
    const wide = applyView(fixture(), 'open').find((section) => section.module === null)!;
    expect(wide.nodes.map((node) => node.id)).toEqual(['wide']);
    expect(wide.nodes[0].children.map((node) => node.id)).toEqual(['wide-step']);
  });

  it('leaves "Everything" in the fixed module order', () => {
    expect(applyView(fixture(), 'all').map((section) => section.module)).toEqual(
      fixture().map((section) => section.module),
    );
  });
});

describe('splitFinished', () => {
  const fixture = () =>
    tree([
      at('done', 'shipped', { position: 10, completedAt: '2026-02-01T00:00:00Z' }),
      at('done', 'shipped-step', { parentId: 'shipped' }),
      at('done', 'older', { position: 20, completedAt: '2026-01-01T00:00:00Z' }),
      at('dropped', 'abandoned', { position: 30, completedAt: '2026-03-01T00:00:00Z' }),
      at('done', 'half', { position: 40, completedAt: '2026-02-15T00:00:00Z' }),
      at('not_started', 'half-step', { parentId: 'half' }),
      item({ id: 'live', position: 50 }),
    ]);

  it('lifts the features with nothing left in them, newest first', () => {
    const { finished } = splitFinished(applyView(fixture(), 'all'));
    expect(finished.map((node) => node.id)).toEqual(['abandoned', 'shipped', 'older']);
  });

  it('leaves the modules holding what is still being worked', () => {
    const { sections } = splitFinished(applyView(fixture(), 'all'));
    expect(sections.flatMap((section) => section.nodes).map((node) => node.id)).toEqual([
      'half',
      'live',
    ]);
  });

  it('leaves a module its progress, which is over the whole module either way', () => {
    const before = shopping(fixture()).progress;
    const { sections } = splitFinished(applyView(fixture(), 'all'));
    expect(sections.find((section) => section.module === 'shopping')!.progress).toEqual(before);
  });

  it('finds a folded feature by number, title or detail', () => {
    const { finished } = splitFinished(applyView(fixture(), 'all'));
    const shipped = finished.find((node) => node.id === 'shipped')!;
    expect(searchNodes(finished, `#${shipped.number}`).map((node) => node.id)).toEqual(['shipped']);
    // Every term has to match the same row, as it does in a module section.
    expect(searchNodes(finished, 'shipped older').map((node) => node.id)).toEqual([]);
    expect(searchNodes(finished, '').map((node) => node.id)).toEqual(finished.map((n) => n.id));
  });
});

describe('workOrder', () => {
  it('lists ready steps most urgent first, then in reading order', () => {
    const sections = tree([
      item({ id: 'normal-first', position: 10 }),
      item({ id: 'someday', priority: 3, position: 20 }),
      item({ id: 'urgent', priority: 1, position: 30 }),
      item({ id: 'normal-second', position: 40 }),
      item({ id: 'jobs-urgent', module: 'jobs', priority: 1 }),
      at('in_progress', 'underway', { priority: 1 }),
    ]);
    expect(workOrder(sections).map((n) => n.id)).toEqual([
      'urgent',
      'jobs-urgent',
      'normal-first',
      'normal-second',
      'someday',
    ]);
  });

  it('can be narrowed to every approved step but the ones you kept', () => {
    // The two halves of one question: `me` is what you held back, and
    // everything else approved is the runner's, whether or not anybody ever
    // pressed Send on it.
    const sections = tree([
      item({ id: 'mine', assignee: 'me' }),
      item({ id: 'theirs' }),
      item({ id: 'nobody' }),
    ]);
    expect(workOrder(sections, { only: 'runner' }).map((n) => n.id)).toEqual(['theirs', 'nobody']);
    expect(workOrder(sections, { only: 'mine' }).map((n) => n.id)).toEqual(['mine']);
  });

  it('still offers the steps of a feature blocked over one question beneath it', () => {
    // What the overnight runner reaches for. A question on one step stops that
    // step; the two beside it are work, and the feature being marked blocked
    // over the question used to take them out of this list entirely.
    const sections = tree([
      at('blocked', 'feature', { blockKind: 'steps' }),
      at('blocked', 'asked', { parentId: 'feature', blockKind: 'outside' }),
      item({ id: 'next', parentId: 'feature', position: 20 }),
      item({ id: 'after', parentId: 'feature', position: 30 }),
    ]);
    expect(workOrder(sections, { only: 'runner' }).map((n) => n.id)).toEqual(['next', 'after']);
  });

  it("never leaves a decision in the runner's list", () => {
    // The one thing a routine must not do is answer its own question.
    const sections = tree([item({ id: 'work' }), item({ id: 'question', kind: 'decision' })]);
    expect(workOrder(sections, { only: 'runner' }).map((n) => n.id)).toEqual(['work']);
  });

  it('still lists a decision unfiltered, so the person sees it', () => {
    const sections = tree([item({ id: 'question', kind: 'decision' })]);
    expect(workOrder(sections).map((n) => n.id)).toEqual(['question']);
    expect(workOrder(sections, { only: 'mine' }).map((n) => n.id)).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts the plan the way the strip at the top reads it', () => {
    const sections = tree(
      [
        item({ id: 'feature' }),
        at('done', 'a', { parentId: 'feature' }),
        at('in_progress', 'b', { parentId: 'feature' }),
        at('blocked', 'c', { parentId: 'feature' }),
        item({ id: 'd', parentId: 'feature' }),
        at('dropped', 'e'),
        item({ id: 'f' }),
        at('proposed', 'g'),
      ],
      [dep('f', 'feature')],
    );
    expect(summarize(sections)).toEqual({
      total: 8,
      // Everything not done and not dropped, the proposal included: it is the
      // count of what the Open view lists.
      open: 6,
      // c is blocked and g is a proposal nobody has decided on.
      onYou: 2,
      proposed: 1,
      inProgress: 1,
      // c by hand, f through its dependency.
      waiting: 2,
      // d alone: the feature has open steps and f is waiting.
      ready: 1,
      done: 1,
      // Everything open that you did not keep: the feature itself, b, d and
      // f. c is blocked, so it is on you; g is a proposal.
      claude: 4,
      fog: 0,
      dismissed: 0,
    });
  });
});

describe('a block on steps whose dependencies have all closed', () => {
  // The note from /dev/plan: "still says blocked. But it looks like everything
  // it waits on is done." The badge already read Ready -- healthOf had been
  // taught this -- while the strip went on counting it under "waiting" and the
  // Waiting view went on listing it, with nothing left to name as the thing it
  // waits for. Every place the page speaks about blocked work has to agree.
  const fixture = () =>
    tree(
      [
        item({ id: 'feature' }),
        at('blocked', 'stale', { parentId: 'feature', blockKind: 'steps' }),
        at('done', 'shipped'),
      ],
      [dep('stale', 'shipped')],
    );

  it('is not counted among the steps waiting', () => {
    expect(summarize(fixture()).waiting).toBe(0);
    expect(summarize(fixture()).ready).toBe(1);
  });

  it('is not listed under the Waiting view', () => {
    expect(flattenSections(applyView(fixture(), 'blocked')).map((n) => n.id)).toEqual([]);
  });

  it('is not a blocked dot on the feature above it', () => {
    expect(findNode(fixture(), 'feature')!.rollup).toMatchObject({ blocked: 0, live: 1 });
  });

  it('still counts a block that is waiting on something open', () => {
    const sections = tree(
      [at('blocked', 'stuck', { blockKind: 'steps' }), item({ id: 'pending' })],
      [dep('stuck', 'pending')],
    );
    expect(summarize(sections).waiting).toBe(1);
    expect(flattenSections(applyView(sections, 'blocked')).map((n) => n.id)).toContain('stuck');
  });

  it('still counts a block that named nothing at all', () => {
    // The honest use of the status: nothing about it can be worked out from
    // the tree, so the page leaves it exactly as the person wrote it.
    const sections = tree([at('blocked', 'stuck')]);
    expect(summarize(sections).waiting).toBe(1);
    expect(flattenSections(applyView(sections, 'blocked')).map((n) => n.id)).toEqual(['stuck']);
  });

  // The other kind, on the same surfaces. #499 named three steps, all three
  // closed, and the token it was actually blocked on was never on the plan to
  // close -- so every one of these readings has to stay where it was.
  it('reads as blocked everywhere when the block was on something outside the plan', () => {
    const sections = tree(
      [
        item({ id: 'feature' }),
        at('blocked', 'stuck', { parentId: 'feature', blockKind: 'outside' }),
        at('done', 'shipped'),
      ],
      [dep('stuck', 'shipped')],
    );

    expect(summarize(sections).waiting).toBe(1);
    expect(summarize(sections).ready).toBe(0);
    // Two: the step, and the feature above it, which has nothing left beneath
    // it that anybody can pick up and so reads blocked itself. `waiting`
    // counts the status column and stays at the one row that carries it.
    expect(summarize(sections).onYou).toBe(2);
    // The feature is in the Waiting view as the container it is shown in; the
    // step itself is what the view matched.
    expect(
      flattenSections(applyView(sections, 'blocked'))
        .filter((n) => n.matches)
        .map((n) => n.id),
    ).toEqual(['stuck']);
    expect(flattenSections(applyView(sections, 'ready')).map((n) => n.id)).toEqual([]);
    expect(findNode(sections, 'stuck')!.ready).toBe(false);
    expect(healthOf(findNode(sections, 'stuck')!)).toBe('blocked');
    expect(findNode(sections, 'feature')!.rollup).toMatchObject({ blocked: 1, live: 1 });
    expect(moveOf(findNode(sections, 'stuck')!)).toBe('on_you');
  });
});

describe('walking the tree', () => {
  const sections = tree([
    item({ id: 'root' }),
    item({ id: 'mid', parentId: 'root' }),
    item({ id: 'leaf', parentId: 'mid' }),
    item({ id: 'other' }),
  ]);

  it('finds the steps above one, top first', () => {
    expect(ancestorsOf(sections, 'leaf').map((n) => n.id)).toEqual(['root', 'mid']);
    expect(ancestorsOf(sections, 'root')).toEqual([]);
  });

  it('names a step and everything beneath it', () => {
    expect([...subtreeIds(findNode(sections, 'root')!)].sort()).toEqual(['leaf', 'mid', 'root']);
    expect([...subtreeIds(findNode(sections, 'other')!)]).toEqual(['other']);
  });
});

describe('healthOf', () => {
  it('calls an unsettled question unanswered rather than not started', () => {
    // A question does not get built, so nothing about a step's readiness
    // applies to it: it closes on an answer.
    expect(healthOf(shopping(tree([at('not_started', 'q', { kind: 'decision' })])).nodes[0])).toBe(
      'unanswered',
    );
  });

  it('does not call a done step done while something under it is open', () => {
    // #152 shipped, then acquired a question. The row's own status column
    // still says done, and the health has to say what is actually true.
    const sections = tree([
      at('done', 'shipped'),
      at('proposed', 'later', { parentId: 'shipped', kind: 'decision' }),
    ]);
    const byId = new Map(flattenSections(sections).map((node) => [node.id, node]));

    expect(healthOf(byId.get('shipped')!)).toBe('unanswered');
  });

  it('reports the most pressing of several open rows beneath a closed one', () => {
    const sections = tree([
      at('done', 'shipped'),
      at('not_started', 'todo', { parentId: 'shipped' }),
      at('blocked', 'stuck', { parentId: 'shipped' }),
    ]);
    const byId = new Map(flattenSections(sections).map((node) => [node.id, node]));

    expect(healthOf(byId.get('shipped')!)).toBe('blocked');
  });

  it('still calls a done step done when everything beneath it is closed', () => {
    const sections = tree([
      at('done', 'shipped'),
      at('done', 'step', { parentId: 'shipped' }),
      at('dropped', 'cut', { parentId: 'shipped' }),
    ]);
    const byId = new Map(flattenSections(sections).map((node) => [node.id, node]));

    expect(healthOf(byId.get('shipped')!)).toBe('done');
  });

  it('separates ready, waiting and not started among not_started steps', () => {
    const sections = tree(
      [at('not_started', 'a'), at('not_started', 'b'), at('not_started', 'c', { parentId: 'a' })],
      [dep('b', 'a')],
    );
    const byId = new Map(flattenSections(sections).map((node) => [node.id, node]));
    // 'a' has an open step beneath it, so it is not ready; 'b' waits on 'a';
    // 'c' has nothing above or beneath it in the way.
    expect(healthOf(byId.get('c')!)).toBe('ready');
    expect(healthOf(byId.get('b')!)).toBe('waiting');
    expect(healthOf(byId.get('a')!)).toBe('not_started');
  });

  it('stops saying blocked once every step a block on steps named is closed', () => {
    const sections = tree(
      [at('done', 'a'), at('blocked', 'b', { blockKind: 'steps' })],
      [dep('b', 'a')],
    );
    const byId = new Map(flattenSections(sections).map((node) => [node.id, node]));

    expect(healthOf(byId.get('b')!)).toBe('ready');
  });

  it('goes on saying blocked while a dependency is open, or when none was named', () => {
    const sections = tree(
      [
        at('not_started', 'a'),
        at('blocked', 'b', { blockKind: 'steps' }),
        at('blocked', 'c', { blockKind: 'steps' }),
      ],
      [dep('b', 'a')],
    );
    const byId = new Map(flattenSections(sections).map((node) => [node.id, node]));

    expect(healthOf(byId.get('b')!)).toBe('blocked');
    expect(healthOf(byId.get('c')!)).toBe('blocked');
  });

  it('goes on saying blocked for a block on something outside the plan', () => {
    const sections = tree(
      [at('done', 'a'), at('blocked', 'b', { blockKind: 'outside' }), at('blocked', 'c')],
      [dep('b', 'a'), dep('c', 'a')],
    );
    const byId = new Map(flattenSections(sections).map((node) => [node.id, node]));

    // 'c' records no kind, which reads as outside for the same reason.
    expect(healthOf(byId.get('b')!)).toBe('blocked');
    expect(healthOf(byId.get('c')!)).toBe('blocked');
  });
});

describe('a setup step', () => {
  // The whole point of the kind: a job that is yours reads as a job on your
  // list, not as a build somebody got stuck on. Everything below is one line
  // of #597's done-when.
  const setup = (id: string, over: Partial<PlanItem> = {}) => item({ id, kind: 'setup', ...over });

  const only = (sections: ReturnType<typeof tree>, id: string) => findNode(sections, id)!;

  it('reports setup while it is open, whatever the status column says', () => {
    const sections = tree([
      setup('fresh'),
      setup('claimed', { status: 'in_progress' }),
      setup('offered', { status: 'proposed' }),
    ]);

    expect(healthOf(only(sections, 'fresh'))).toBe('setup');
    // A claim on a setup job is somebody saying they will do it, not a session
    // building it, so it is still the job it was.
    expect(healthOf(only(sections, 'claimed'))).toBe('setup');
    expect(healthOf(only(sections, 'offered'))).toBe('setup');
  });

  it('stops reporting setup once it is closed', () => {
    const sections = tree([setup('done', { status: 'done' }), setup('cut', { status: 'dropped' })]);

    expect(healthOf(only(sections, 'done'))).toBe('done');
    expect(healthOf(only(sections, 'cut'))).toBe('dropped');
    expect(needsThePerson(only(sections, 'done'))).toBe(false);
    expect(needsThePerson(only(sections, 'cut'))).toBe(false);
  });

  it('says blocked while it is blocked, because the ask is more specific', () => {
    // Same exception a decision makes: the block carries the one sentence
    // saying what the step needs right now.
    const sections = tree([setup('stuck', { status: 'blocked', blockKind: 'outside' })]);
    expect(healthOf(only(sections, 'stuck'))).toBe('blocked');
  });

  it('goes back to setup once a block on steps has gone stale', () => {
    const sections = tree(
      [at('done', 'first'), setup('after', { status: 'blocked', blockKind: 'steps' })],
      [dep('after', 'first')],
    );
    // Without the setup rule this reads 'ready', which is the one thing it is
    // not -- no session can pick it up.
    expect(healthOf(only(sections, 'after'))).toBe('setup');
  });

  it('is on the person, and shows in the On you view', () => {
    const sections = tree([setup('job'), item({ id: 'build' })]);

    expect(needsThePerson(only(sections, 'job'))).toBe(true);
    expect(isWaitingOnThePerson(only(sections, 'job'))).toBe(true);
    const ids = flattenSections(applyView(sections, 'you')).map((node) => node.id);
    expect(ids).toEqual(['job']);
  });

  it("is never in the runner's list, however it is assigned", () => {
    // A routine that claimed one would sit in front of an account nobody has
    // made and block itself to say so.
    const sections = tree([item({ id: 'work' }), setup('job', { assignee: 'me' })]);

    expect(workOrder(sections, { only: 'runner' }).map((n) => n.id)).toEqual(['work']);
    // Still ready, and still listed unfiltered, so the page shows it.
    expect(only(sections, 'job').ready).toBe(true);
    expect(workOrder(sections).map((n) => n.id)).toEqual(['work', 'job']);
  });

  it('is withheld from the runner even when nobody was assigned it', () => {
    const sections = tree([setup('job', { assignee: null })]);
    expect(workOrder(sections, { only: 'runner' })).toEqual([]);
  });

  it('is a band and a tally entry like any other live step', () => {
    // Not `proposed`: an agreed setup job is in the denominator, so the bands
    // have to be able to draw it or they stop summing to the count beside them.
    expect(PLAN_BAND_ORDER).toContain('setup');
    const section = shopping(tree([setup('job'), at('done', 'built')]));
    expect(tallyHealth(section.nodes)).toMatchObject({ setup: 1, done: 1 });
    expect(planBands(section.nodes)).toContainEqual({ health: 'setup', count: 1 });
  });
});

describe('tallyHealth', () => {
  it('counts the leaves by state and leaves the rest at zero', () => {
    const section = shopping(
      tree([
        at('in_progress', 'f'),
        at('done', 'a', { parentId: 'f' }),
        at('blocked', 'b'),
        at('proposed', 'c'),
        at('not_started', 'q', { kind: 'decision' }),
      ]),
    );
    expect(section.tally).toMatchObject({
      done: 1,
      blocked: 1,
      proposed: 1,
      unanswered: 1,
      dropped: 0,
      in_progress: 0,
    });
  });

  it('counts a feature once, through its steps, not twice', () => {
    // The same reason planProgress measures leaves: counting a feature and the
    // steps under it says "three things" about a module that has two.
    const section = shopping(
      tree([
        at('not_started', 'f'),
        at('done', 's1', { parentId: 'f' }),
        at('done', 's2', { parentId: 'f' }),
      ]),
    );
    const total = Object.values(section.tally).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(2);
    expect(section.tally.done).toBe(2);
  });

  it('leaves out a plan that is closed top to bottom', () => {
    // What the heading counts is work still in hand. 101 of this plan's 110
    // features are finished, and counting their steps held every module at
    // nine tenths forever -- a fact about the archive rather than about the
    // work. The filter is at the plan, not at the step: a done step inside a
    // plan still being worked is exactly what the bar is for.
    const section = shopping(
      tree([
        at('done', 'shipped'),
        at('done', 'shipped-step', { parentId: 'shipped' }),
        at('in_progress', 'live'),
        at('done', 'live-step', { parentId: 'live' }),
        at('not_started', 'live-step-2', { parentId: 'live' }),
      ]),
    );

    expect(section.tally.done).toBe(1);
    expect(section.bands).toEqual([
      { health: 'done', count: 1 },
      { health: 'ready', count: 1 },
    ]);
    expect(section.progress).toMatchObject({ done: 1, live: 2 });
    // The rows themselves are untouched -- the finished plan is still listed
    // and still foldable; it is the counting it left.
    expect(section.nodes.map((node) => node.id)).toEqual(['shipped', 'live']);
  });

  it('is over the whole module, not the view', () => {
    // A filter narrows what is listed; it does not change what is true of the
    // module, and the dots survive the section being folded shut.
    const whole = tree([at('done', 'a'), at('not_started', 'b')]);
    const narrowed = applyView(whole, 'ready');
    expect(shopping(narrowed).tally).toEqual(shopping(whole).tally);
  });
});

describe('the On you view', () => {
  const sections = tree([
    at('not_started', 'q', { kind: 'decision' }),
    at('proposed', 'p'),
    at('blocked', 'b'),
    at('not_started', 'r'),
    at('in_progress', 'w'),
    at('done', 'q2', { kind: 'decision' }),
  ]);

  it('keeps what cannot move until the person acts', () => {
    const ids = flattenSections(applyView(sections, 'you')).map((node) => node.id);
    expect(ids.sort()).toEqual(['b', 'p', 'q']);
  });

  it('leaves out work they could simply do', () => {
    // A ready step assigned to them is not a question being asked of them, and
    // mixing it in makes "waiting on you" a list that cannot be cleared.
    const ids = flattenSections(applyView(sections, 'you')).map((node) => node.id);
    expect(ids).not.toContain('r');
    expect(ids).not.toContain('w');
  });

  it('leaves out a question already answered', () => {
    const ids = flattenSections(applyView(sections, 'you')).map((node) => node.id);
    expect(ids).not.toContain('q2');
  });
});

describe('fog on the frontier', () => {
  it('counts every step carrying fog, closed ones included', () => {
    const sections = buildPlanTree({
      items: [
        item({ id: 'shipped', number: 1, status: 'done', fog: 'the reviewing is not settled' }),
        item({ id: 'live', number: 2, status: 'not_started', fog: 'unclear where it lands' }),
        item({ id: 'clear', number: 3, status: 'not_started' }),
      ],
      dependencies: [],
    });
    expect(summarize(sections).fog).toBe(2);
  });

  it('the fog view keeps a finished step that never had its gap filled', () => {
    const sections = buildPlanTree({
      items: [
        item({ id: 'shipped', number: 1, status: 'done', fog: 'still open' }),
        item({ id: 'clear', number: 2, status: 'done' }),
      ],
      dependencies: [],
    });
    const shown = flattenSections(applyView(sections, 'fog'));
    expect(shown.map((node) => node.number)).toEqual([1]);
  });
});

describe('put aside as not right now', () => {
  const fixture = () =>
    buildPlanTree({
      items: [
        item({ id: 'feature', number: 1, status: 'not_started' }),
        item({
          id: 'question',
          number: 2,
          parentId: 'feature',
          kind: 'decision',
          dismissedAt: '2026-09-13T00:00:00Z',
        }),
        item({ id: 'step', number: 3, parentId: 'feature', status: 'not_started' }),
        item({
          id: 'foggy',
          number: 4,
          status: 'not_started',
          fog: 'nobody can see the second half yet',
          fogDismissedAt: '2026-09-13T00:00:00Z',
        }),
      ],
      dependencies: [],
    });

  it('leaves every view but the one that looks for it', () => {
    for (const view of ['all', 'open', 'you', 'ready', 'blocked', 'claude', 'proposed'] as const) {
      const shown = flattenSections(applyView(fixture(), view)).map((node) => node.number);
      expect(shown).not.toContain(2);
    }
  });

  it('is listed under Dismissed, with the row whose fog was put aside', () => {
    const shown = flattenSections(applyView(fixture(), 'dismissed')).map((node) => node.number);
    expect(shown).toContain(2);
    expect(shown).toContain(4);
  });

  it('is out of the counts, except the one that says how many there are', () => {
    const summary = summarize(fixture());
    expect(summary.onYou).toBe(0);
    expect(summary.fog).toBe(0);
    expect(summary.dismissed).toBe(2);
  });

  it('stops holding its feature open', () => {
    const sections = buildPlanTree({
      items: [
        item({ id: 'feature', number: 1, status: 'not_started' }),
        item({
          id: 'question',
          number: 2,
          parentId: 'feature',
          kind: 'decision',
          dismissedAt: '2026-09-13T00:00:00Z',
        }),
        item({ id: 'step', number: 3, parentId: 'feature', status: 'done' }),
      ],
      dependencies: [],
    });
    expect(findNode(sections, 'feature')!.ready).toBe(true);
    expect(shopping(sections).progress.fraction).toBe(1);
  });

  it('is never picked up by a session', () => {
    const sections = buildPlanTree({
      items: [
        item({
          id: 'handed',
          number: 1,
          status: 'not_started',
          dismissedAt: '2026-09-13T00:00:00Z',
        }),
      ],
      dependencies: [],
    });
    expect(workOrder(sections)).toEqual([]);
  });
});

describe('isWaitingOnThePerson', () => {
  it('is an unanswered question, whatever state it is otherwise in', () => {
    for (const status of ['not_started', 'in_progress', 'blocked', 'proposed'] as const) {
      expect(isWaitingOnThePerson({ kind: 'decision', status })).toBe(true);
    }
  });

  it('is a blocked step, which needs something outside the repo', () => {
    expect(isWaitingOnThePerson({ kind: 'build', status: 'blocked' })).toBe(true);
  });

  it('is not a block on steps whose every named step has since closed', () => {
    // It is the plan's own record that says nothing is holding it, so handing
    // it to Claude sends a session at a wall that is no longer there.
    const sections = tree(
      [at('blocked', 'stale', { blockKind: 'steps' }), at('done', 'dep')],
      [dep('stale', 'dep')],
    );
    expect(isWaitingOnThePerson(findNode(sections, 'stale')!)).toBe(false);
  });

  it('is a block on something outside the plan whose named steps have closed', () => {
    // The other half, and the one the Send button reads: #499's dependencies
    // were all closed and the token it was blocked on still did not exist.
    // Three sessions were sent at it and came back having found the same wall.
    const sections = tree(
      [at('blocked', 'stuck', { blockKind: 'outside' }), at('done', 'dep')],
      [dep('stuck', 'dep')],
    );
    expect(isWaitingOnThePerson(findNode(sections, 'stuck')!)).toBe(true);
  });

  it('is not ordinary work, and not a settled question', () => {
    expect(isWaitingOnThePerson({ kind: 'build', status: 'not_started' })).toBe(false);
    expect(isWaitingOnThePerson({ kind: 'build', status: 'in_progress' })).toBe(false);
    expect(isWaitingOnThePerson({ kind: 'decision', status: 'done' })).toBe(false);
    expect(isWaitingOnThePerson({ kind: 'decision', status: 'dropped' })).toBe(false);
  });

  it('is not a proposal, which waits on approval rather than on an answer', () => {
    // needsThePerson counts one; this does not. A proposal is excluded from a
    // hand-over on its own grounds.
    expect(isWaitingOnThePerson({ kind: 'build', status: 'proposed' })).toBe(false);
  });
});

describe('blockRefusal', () => {
  it('names the steps a block on steps is still waiting for', () => {
    const sections = tree(
      [
        at('blocked', 'held', { number: 634, blockKind: 'steps' }),
        at('not_started', 'first', { number: 601 }),
        at('done', 'shipped', { number: 602 }),
        at('in_progress', 'second', { number: 603 }),
      ],
      [dep('held', 'first'), dep('held', 'shipped'), dep('held', 'second')],
    );
    expect(blockRefusal(findNode(sections, 'held')!)).toBe(
      '#634 is blocked on #601 and #603, which are still open. It clears itself when they close.',
    );
  });

  it('reads as one step when only one is left open', () => {
    const sections = tree(
      [
        at('blocked', 'held', { number: 634, blockKind: 'steps' }),
        at('not_started', 'first', { number: 601 }),
        at('done', 'shipped', { number: 602 }),
      ],
      [dep('held', 'first'), dep('held', 'shipped')],
    );
    expect(blockRefusal(findNode(sections, 'held')!)).toBe(
      '#634 is blocked on #601, which is still open. It clears itself when that step closes.',
    );
  });

  it('keeps the sentence it had for a block on something outside the plan', () => {
    // The refusal #499 got every time, and the one direction this must not
    // change: a token nobody has made is not a step that can close.
    const sections = tree(
      [
        at('blocked', 'stuck', { number: 499, blockKind: 'outside' }),
        at('done', 'shipped', { number: 498 }),
      ],
      [dep('stuck', 'shipped')],
    );
    expect(blockRefusal(findNode(sections, 'stuck')!)).toBe(
      '#499 is blocked on something outside the repo. ' +
        'Clear what it is waiting on first -- its note says what.',
    );
  });

  it('reads a block with no kind recorded as one outside the plan', () => {
    expect(blockRefusal({ number: 12, blockKind: null })).toBe(
      '#12 is blocked on something outside the repo. ' +
        'Clear what it is waiting on first -- its note says what.',
    );
  });

  it('says so when a block on steps names no steps at all', () => {
    expect(blockRefusal({ number: 12, blockKind: 'steps' })).toBe(
      '#12 is blocked on other steps, and none are recorded against it. ' +
        'Say what it is waiting for, or put it back to not started.',
    );
  });
});

describe('planBands', () => {
  it('splits the live leaves by state', () => {
    const section = shopping(
      tree([
        at('not_started', 'f'),
        at('done', 'a', { parentId: 'f' }),
        at('done', 'b', { parentId: 'f' }),
        at('in_progress', 'c'),
        at('blocked', 'd'),
      ]),
    );

    expect(section.bands).toEqual([
      { health: 'done', count: 2 },
      { health: 'in_progress', count: 1 },
      { health: 'blocked', count: 1 },
    ]);
  });

  it('sums to the number printed beside the bar', () => {
    // The whole reason this is computed here: a bar drawn over one set of
    // steps beside "8 of 12" counted over another is two claims on one row.
    const section = shopping(
      tree([
        at('done', 'a'),
        at('in_progress', 'b'),
        at('not_started', 'c'),
        at('blocked', 'd'),
        at('dropped', 'e'),
        at('proposed', 'f'),
        at('not_started', 'q', { kind: 'decision' }),
      ]),
    );

    const total = section.bands.reduce((sum, band) => sum + band.count, 0);
    expect(total).toBe(section.progress.live);
  });

  it('leaves out what the fraction leaves out', () => {
    const section = shopping(
      tree([
        at('not_started', 'f'),
        at('done', 'a', { parentId: 'f' }),
        at('dropped', 'b'),
        at('proposed', 'c'),
      ]),
    );

    expect(section.bands).toEqual([{ health: 'done', count: 1 }]);
  });

  it('draws no band for a state nothing is in', () => {
    const section = shopping(tree([at('not_started', 'f'), at('done', 'a', { parentId: 'f' })]));

    expect(section.bands).toHaveLength(1);
  });

  it('keeps the drawing order however the steps are arranged', () => {
    // Fixed, never sorted by size: a bar whose bands moved around as the
    // counts changed would be a different picture every week.
    const section = shopping(
      tree([
        at('not_started', 'a'),
        at('not_started', 'f'),
        at('done', 'b', { parentId: 'f' }),
        at('in_progress', 'c'),
      ]),
    );

    // 'a' waits on nothing, so it reads as ready rather than not started --
    // the health column's rule, which the bar follows rather than re-deciding.
    expect(section.bands.map((band) => band.health)).toEqual(['done', 'in_progress', 'ready']);
  });

  it('gives an unanswered question its own band, not the not-started one', () => {
    // The complaint the banded bar exists for: a module held up by questions
    // and a module nobody has reached drew the same bar.
    const section = shopping(
      tree([at('not_started', 'q', { kind: 'decision' }), at('not_started', 's')]),
    );

    expect(section.bands).toEqual([
      { health: 'ready', count: 1 },
      { health: 'unanswered', count: 1 },
    ]);
  });

  it('counts a feature through its steps, not twice', () => {
    const section = shopping(
      tree([
        at('in_progress', 'f'),
        at('done', 's1', { parentId: 'f' }),
        at('not_started', 's2', { parentId: 'f' }),
      ]),
    );

    expect(section.bands.reduce((sum, band) => sum + band.count, 0)).toBe(2);
  });

  it('is empty for a module with nothing live in it', () => {
    const section = shopping(tree([at('dropped', 'a'), at('proposed', 'b')]));

    expect(section.bands).toEqual([]);
    expect(section.progress.fraction).toBeNull();
  });
});

describe('searchSections', () => {
  const plan = () =>
    tree([
      at('not_started', 'feature', { title: 'The shelf photo picker', number: 342 }),
      at('not_started', 'pick', {
        parentId: 'feature',
        title: 'Pick a photo',
        detail: 'Reads the camera roll',
        number: 343,
      }),
      at('not_started', 'crop', { parentId: 'feature', title: 'Crop it', number: 344 }),
      at('not_started', 'other', { title: 'Send the weekly digest', number: 400 }),
    ]);

  const titles = (sections: ReturnType<typeof plan>) =>
    flattenSections(sections).map((node) => node.title);

  it('gives every section back untouched for a blank query', () => {
    expect(titles(searchSections(plan(), '   '))).toEqual(titles(plan()));
  });

  it('finds a step by a word in its title', () => {
    expect(titles(searchSections(plan(), 'digest'))).toEqual(['Send the weekly digest']);
  });

  it('finds a step by a word in its detail', () => {
    const found = searchSections(plan(), 'camera roll');
    expect(
      flattenSections(found)
        .filter((node) => node.matches)
        .map((n) => n.title),
    ).toEqual(['Pick a photo']);
  });

  it('finds a step by its number, with or without the hash', () => {
    expect(countMatches(searchSections(plan(), '400'))).toBe(1);
    expect(countMatches(searchSections(plan(), '#400'))).toBe(1);
  });

  // Note 843f7506: a link to one step arrives filtered to that step alone.
  it('takes a hashed number as that step exactly, not as text', () => {
    const sections = tree([
      item({ id: 'a', number: 81, title: 'The one' }),
      item({ id: 'b', number: 812, title: 'Not this', detail: 'Mentions #81 in passing' }),
    ]);

    expect(titles(searchSections(sections, '#81'))).toEqual(['The one']);
    expect(countMatches(searchSections(sections, '81'))).toBe(2);
  });

  it('requires every term, across any of the fields', () => {
    expect(countMatches(searchSections(plan(), '343 photo'))).toBe(1);
    expect(countMatches(searchSections(plan(), '343 digest'))).toBe(0);
  });

  // The parent is kept so a hit is read in its place rather than as a bare
  // sub-step, and it is not itself a hit.
  it('keeps the feature over a matching step, as context', () => {
    const found = searchSections(plan(), 'crop');
    const nodes = flattenSections(found);

    expect(nodes.map((node) => node.title)).toEqual(['The shelf photo picker', 'Crop it']);
    expect(nodes.map((node) => node.matches)).toEqual([false, true]);
    expect(countMatches(found)).toBe(1);
  });

  // And the other way round: a feature that matches brings its steps, so
  // finding it does not mean losing what is under it.
  it('keeps the steps beneath a matching feature, as context', () => {
    const found = searchSections(plan(), 'shelf');
    const nodes = flattenSections(found);

    expect(nodes.map((node) => node.title)).toEqual([
      'The shelf photo picker',
      'Pick a photo',
      'Crop it',
    ]);
    // One hit, not three: the steps came along, they were not found.
    expect(countMatches(found)).toBe(1);
  });

  it('drops a module with nothing in it', () => {
    expect(searchSections(plan(), 'nothing matches this')).toEqual([]);
  });

  it('ignores case', () => {
    expect(countMatches(searchSections(plan(), 'SHELF'))).toBe(1);
  });
});

/**
 * Health says how far along; the move says whose it is. The two were one word
 * until #fa32dfaa, and these are the cases that separate them.
 */
describe('healthOf, over a subtree that has started', () => {
  const feature = (children: PlanItem[]) => shopping(tree([at('not_started', 'f'), ...children]));

  it('calls a feature in progress once a step beneath it is done', () => {
    const sections = feature([
      at('done', 's1', { parentId: 'f' }),
      at('not_started', 's2', { parentId: 'f' }),
    ]);
    expect(healthOf(sections.nodes[0])).toBe('in_progress');
  });

  it('calls it in progress while a step beneath it is being worked', () => {
    const sections = feature([at('in_progress', 's1', { parentId: 'f' })]);
    expect(healthOf(sections.nodes[0])).toBe('in_progress');
  });

  it('leaves a feature nobody has touched not started', () => {
    const sections = feature([
      at('not_started', 's1', { parentId: 'f' }),
      at('not_started', 's2', { parentId: 'f' }),
    ]);
    expect(healthOf(sections.nodes[0])).toBe('not_started');
  });

  // Answering the opening question is not building the thing.
  it('does not count an answered question as work started', () => {
    const sections = feature([
      at('done', 'q', { parentId: 'f', kind: 'decision' }),
      at('not_started', 's1', { parentId: 'f' }),
    ]);
    expect(healthOf(sections.nodes[0])).toBe('not_started');
  });

  // 'ready' rather than 'not_started' because a feature with no live work
  // beneath it is startable; what matters here is that it is not in_progress.
  it('does not count a step that was put aside', () => {
    const sections = feature([
      at('done', 's1', { parentId: 'f', dismissedAt: '2026-01-02T00:00:00Z' }),
    ]);
    expect(healthOf(sections.nodes[0])).toBe('ready');
  });

  it('leaves a leaf step alone', () => {
    expect(healthOf(shopping(tree([at('not_started', 'a')])).nodes[0])).toBe('ready');
  });

  it('calls a feature blocked when every open step beneath it is', () => {
    const sections = feature([
      at('done', 's1', { parentId: 'f' }),
      at('blocked', 's2', { parentId: 'f', blockKind: 'outside' }),
      at('blocked', 's3', { parentId: 'f', blockKind: 'outside' }),
    ]);
    expect(healthOf(sections.nodes[0])).toBe('blocked');
  });

  it('leaves it open while one step beneath it can still be worked', () => {
    const sections = feature([
      at('blocked', 's1', { parentId: 'f', blockKind: 'outside' }),
      at('not_started', 's2', { parentId: 'f' }),
    ]);
    expect(healthOf(sections.nodes[0])).toBe('not_started');
  });

  it('does not call it blocked over a step whose named steps have all closed', () => {
    // `isStaleBlock`: nothing on record is holding s2, so the feature has a
    // step to offer and is not stopped.
    const sections = shopping(
      tree(
        [
          at('not_started', 'f'),
          at('done', 's1', { parentId: 'f' }),
          at('blocked', 's2', { parentId: 'f', blockKind: 'steps' }),
        ],
        [dep('s2', 's1')],
      ),
    );
    expect(healthOf(sections.nodes[0])).toBe('in_progress');
  });
});

describe('moveOf', () => {
  const only = (items: PlanItem[]) => shopping(tree(items)).nodes[0];

  // #694: the column says a word only when something is happening to the row,
  // and an approved step in the queue is the ordinary case on this page.
  it('says nothing about an approved step waiting its turn', () => {
    expect(moveOf(only([at('not_started', 'a')]))).toBe('none');
  });

  it('is with Dash while a session is on it', () => {
    expect(moveOf(only([at('in_progress', 'a')]))).toBe('with_dash');
  });

  it('is yours once you mark it, before anything has started', () => {
    expect(moveOf(only([at('not_started', 'a', { assignee: 'me' })]))).toBe('yours');
  });

  it('is still yours once a step you marked is underway', () => {
    expect(moveOf(only([at('in_progress', 'a', { assignee: 'me' })]))).toBe('yours');
  });

  it('needs you for a question nobody has answered', () => {
    expect(moveOf(only([at('not_started', 'a', { kind: 'decision' })]))).toBe('on_you');
  });

  it('needs you for a proposal nobody has approved', () => {
    expect(moveOf(only([at('proposed', 'a')]))).toBe('on_you');
  });

  // Blocked is yours whoever is on it: a session sent there would sit in front
  // of the same wall. Same rule `isWaitingOnThePerson` enforces.
  it('needs you for a blocked step nobody is marked on', () => {
    expect(moveOf(only([at('blocked', 'a')]))).toBe('on_you');
  });

  it('is held up when another step is in the way', () => {
    const sections = shopping(
      tree([at('not_started', 'a'), at('not_started', 'b')], [dep('a', 'b')]),
    );
    expect(moveOf(findNode([sections], 'a')!)).toBe('waiting');
  });

  it('is settled once it closes', () => {
    expect(moveOf(only([at('done', 'a')]))).toBe('settled');
    expect(moveOf(only([at('dropped', 'a')]))).toBe('settled');
  });

  describe('over a subtree', () => {
    const feature = (children: PlanItem[]) =>
      shopping(tree([at('not_started', 'f'), ...children])).nodes[0];

    it('reports a session working beneath it', () => {
      expect(moveOf(feature([at('in_progress', 's1', { parentId: 'f' })]))).toBe('with_dash');
    });

    it('reports a step you marked yours beneath it', () => {
      expect(moveOf(feature([at('not_started', 's1', { parentId: 'f', assignee: 'me' })]))).toBe(
        'yours',
      );
    });

    // The other half of #694: a feature is the rollup of its steps, so one
    // whose steps are all waiting their turn has nothing to say either.
    it('says nothing when every step beneath it is waiting its turn', () => {
      expect(
        moveOf(
          feature([
            at('not_started', 's1', { parentId: 'f' }),
            at('not_started', 's2', { parentId: 'f' }),
          ]),
        ),
      ).toBe('none');
    });

    it('reports the most pressing of several', () => {
      expect(
        moveOf(
          feature([
            at('in_progress', 's1', { parentId: 'f' }),
            at('not_started', 'q', { parentId: 'f', kind: 'decision' }),
          ]),
        ),
      ).toBe('on_you');
    });

    // The same rule healthOf keeps: closed on top of something open is not
    // closed, and a question added under a shipped feature is still a question.
    it('reports a question added under a finished feature', () => {
      const sections = shopping(
        tree([
          at('done', 'f'),
          at('done', 's1', { parentId: 'f' }),
          at('not_started', 'q', { parentId: 'f', kind: 'decision' }),
        ]),
      );
      expect(moveOf(sections.nodes[0])).toBe('on_you');
    });

    it('is settled when everything beneath it is', () => {
      const sections = shopping(tree([at('done', 'f'), at('done', 's1', { parentId: 'f' })]));
      expect(moveOf(sections.nodes[0])).toBe('settled');
    });

    it('ignores a step that was put aside', () => {
      expect(
        moveOf(
          feature([
            at('not_started', 'q', {
              parentId: 'f',
              kind: 'decision',
              dismissedAt: '2026-01-02T00:00:00Z',
            }),
          ]),
        ),
      ).toBe('none');
    });
  });

  describe('resolving', () => {
    const feature = (children: PlanItem[] = []) =>
      shopping(tree([at('not_started', 'f'), ...children])).nodes[0];
    const whileResolving = { resolving: new Set(['f']) };

    it('says so while a re-shape is re-reading the feature', () => {
      expect(moveOf(feature(), whileResolving)).toBe('resolving');
    });

    // The run writes proposed rows as it goes, and each one is something to
    // approve. Ranked under "on you", the feature would flip to "Needs you"
    // halfway through a run that is still rewriting it.
    it('outranks a proposal the run itself has just written', () => {
      expect(moveOf(feature([at('proposed', 's1', { parentId: 'f' })]), whileResolving)).toBe(
        'resolving',
      );
    });

    it('outranks a question left open beneath it', () => {
      expect(
        moveOf(
          feature([at('not_started', 'q', { parentId: 'f', kind: 'decision' })]),
          whileResolving,
        ),
      ).toBe('resolving');
    });

    // A re-shape can be asked for on a feature that already shipped.
    it('outranks settled', () => {
      const sections = shopping(tree([at('done', 'f'), at('done', 's1', { parentId: 'f' })]));
      expect(moveOf(sections.nodes[0], whileResolving)).toBe('resolving');
    });

    it('is not claimed of a feature no re-shape is running against', () => {
      expect(moveOf(feature(), { resolving: new Set(['somebody-else']) })).toBe('none');
      expect(moveOf(feature())).toBe('none');
    });

    // The set holds the feature the run was fired at. A step beneath it is not
    // itself being re-read, and it is the feature's buttons that shut.
    it('does not spread down to the steps beneath it', () => {
      const sections = shopping(
        tree([at('not_started', 'f'), at('not_started', 's1', { parentId: 'f' })]),
      );
      const step = findNode([sections], 's1')!;
      expect(moveOf(step, whileResolving)).toBe('none');
    });
  });
});

describe('healthOf, on a claim read against its run', () => {
  const NOW = Date.parse('2026-09-17T12:00:00Z');
  const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

  /** A step marked underway, claimed `minutes` ago. */
  const claimed = (id: string, minutes = 10) =>
    at('in_progress', id, { startedAt: minutesAgo(minutes) });

  const run = (minutes: number, pushed: number | null) => ({
    status: 'started',
    createdAt: minutesAgo(minutes),
    reading: {
      checkedAt: minutesAgo(1),
      lastPush: pushed === null ? null : { at: minutesAgo(pushed), sha: 'abc', subject: 'A push' },
      refusal: null,
    },
  });

  it('says in progress and no more when no run is recorded against it', () => {
    const section = shopping(tree([claimed('a')]));
    expect(healthOf(section.nodes[0], planLiveness([claimed('a')], {}, NOW))).toBe('in_progress');
  });

  it('says working, quiet or abandoned from what the run pushed', () => {
    const section = shopping(tree([claimed('a')]));
    const node = section.nodes[0];
    const liveness = (pushed: number | null, fired = 30) =>
      planLiveness(
        [{ id: node.id, status: 'in_progress', startedAt: node.startedAt }],
        { [node.id]: run(fired, pushed) },
        NOW,
      );

    expect(healthOf(node, liveness(2))).toBe('working');
    expect(healthOf(node, liveness(25))).toBe('quiet');
    expect(healthOf(node, liveness(150, 200))).toBe('abandoned');
  });

  it('reads the claim as abandoned on the clock alone once it is two hours old', () => {
    const step = claimed('a', 130);
    const section = shopping(tree([step]));
    expect(healthOf(section.nodes[0], planLiveness([step], {}, NOW))).toBe('abandoned');
  });

  it('counts the module by the same reading, so the tally cannot disagree', () => {
    const step = claimed('a', 130);
    const liveness = planLiveness([step], {}, NOW);
    const section = shopping(buildPlanTree({ items: [step], dependencies: [] }, liveness));
    expect(section.tally.abandoned).toBe(1);
    expect(section.tally.in_progress).toBe(0);
    expect(section.bands).toEqual([{ health: 'abandoned', count: 1 }]);
    // And without the reading it counts what the column says, as it always did.
    expect(tallyHealth(section.nodes).in_progress).toBe(1);
  });

  it('reports an abandoned step from the feature closed above it', () => {
    // The closed-over-open rule, with the new reading in it: a feature marked
    // done over a claim nothing is working reports the claim, and reports it
    // as stopped rather than as underway.
    const step = claimed('s', 200);
    const items = [at('done', 'f'), { ...step, parentId: 'f' }];
    const liveness = planLiveness(items, {}, NOW);
    const section = shopping(buildPlanTree({ items, dependencies: [] }, liveness));
    expect(healthOf(section.nodes[0], liveness)).toBe('abandoned');
  });
});
