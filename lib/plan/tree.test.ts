import { describe, expect, it } from 'vitest';
import type { PlanDependency, PlanItem, PlanStatus } from '@/lib/plan/load';
import {
  ancestorsOf,
  applyView,
  buildPlanTree,
  findNode,
  flattenSections,
  isReady,
  isWaitingOnThePerson,
  leavesOf,
  healthOf,
  planProgress,
  subtreeIds,
  handedToClaude,
  summarize,
  workOrder,
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
    comment: null,
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: null,
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
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
      planProgress([at('done', 'a'), at('done', 'b'), at('not_started', 'c'), at('in_progress', 'd')]),
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
      live: 2,
      fraction: 0.5,
    });
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
  const bare = { waitingOn: [], children: [], dependsOn: [] };

  it('is a step not yet started, waiting on nothing, with nothing open beneath it', () => {
    expect(isReady({ status: 'not_started', ...bare }, [])).toBe(true);
  });

  it('is not a step underway, blocked, done, dropped or merely proposed', () => {
    for (const status of ['proposed', 'in_progress', 'blocked', 'done', 'dropped'] as const) {
      expect(isReady({ status, ...bare }, [])).toBe(false);
    }
  });

  it('is a blocked step whose every named dependency has since closed', () => {
    // #20 sat blocked on #127 for a day after #127 shipped. A block that
    // records dependencies has told the plan what it was waiting for, and once
    // those are closed there is nothing on record holding it.
    const sections = tree([at('done', 'a'), at('blocked', 'b')], [dep('b', 'a')]);
    expect(findNode(sections, 'b')!.ready).toBe(true);
  });

  it('is not a blocked step with a dependency still open', () => {
    const sections = tree([item({ id: 'a' }), at('blocked', 'b')], [dep('b', 'a')]);
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
});

describe('applyView', () => {
  const fixture = () =>
    tree(
      [
        item({ id: 'feature' }),
        at('done', 'done-step', { parentId: 'feature' }),
        at('not_started', 'open-step', { parentId: 'feature', assignee: 'claude' }),
        at('blocked', 'stuck', { parentId: 'feature' }),
        at('done', 'finished-feature', { module: 'jobs' }),
        item({ id: 'waits', module: 'jobs' }),
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

  it('keeps every module under "open", because that is where a plan gets written', () => {
    expect(applyView(fixture(), 'open').map((s) => s.module)).toEqual(
      fixture().map((s) => s.module),
    );
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

  it('can be narrowed to what Claude holds', () => {
    const sections = tree([
      item({ id: 'mine', assignee: 'me' }),
      item({ id: 'theirs', assignee: 'claude' }),
      item({ id: 'nobody' }),
    ]);
    expect(workOrder(sections, { assignee: 'claude' }).map((n) => n.id)).toEqual(['theirs']);
  });
});

describe('handedToClaude', () => {
  const mine = (id: string, over: Partial<PlanItem> = {}) =>
    item({ id, assignee: 'claude', ...over });

  it('takes every open step handed over, most urgent first', () => {
    const sections = tree([
      mine('normal', { position: 10 }),
      mine('someday', { priority: 3, position: 20 }),
      mine('urgent', { priority: 1, position: 30 }),
      item({ id: 'not-handed-over', position: 40 }),
      item({ id: 'mine-to-do', assignee: 'me', position: 50 }),
    ]);
    expect(handedToClaude(sections).map((n) => n.id)).toEqual(['urgent', 'normal', 'someday']);
  });

  it('keeps a step that is only waiting on another, unlike workOrder', () => {
    const sections = tree(
      [mine('first'), mine('second')],
      [dep('second', 'first')],
    );
    expect(workOrder(sections, { assignee: 'claude' }).map((n) => n.id)).toEqual(['first']);
    expect(handedToClaude(sections).map((n) => n.id)).toEqual(['first', 'second']);
  });

  it('leaves out what is finished, only proposed, or waiting on the person', () => {
    const sections = tree([
      mine('open'),
      mine('done', { status: 'done' }),
      mine('dropped', { status: 'dropped' }),
      mine('proposal', { status: 'proposed' }),
      mine('question', { kind: 'decision' }),
      // A block names something outside the repo, so a session sent at it
      // meets the same wall -- and it sat in the Claude's view saying so.
      mine('stuck', { status: 'blocked' }),
    ]);
    expect(handedToClaude(sections).map((n) => n.id)).toEqual(['open']);
  });

  it('takes an answered decision back, since nothing is waiting on the person now', () => {
    const sections = tree([mine('settled', { kind: 'decision', status: 'done' })]);
    // Closed, so still not work -- but for being closed, not for being a
    // question.
    expect(handedToClaude(sections)).toEqual([]);
    expect(isWaitingOnThePerson({ kind: 'decision', status: 'done' })).toBe(false);
  });

  it('is empty when nothing has been handed over', () => {
    expect(handedToClaude(tree([item({ id: 'a' }), item({ id: 'b', assignee: 'me' })]))).toEqual([]);
  });

  it('never hands Claude a decision, however it is assigned', () => {
    // The one thing a routine must not do is answer its own question.
    const sections = tree([
      item({ id: 'work', assignee: 'claude' }),
      item({ id: 'question', assignee: 'claude', kind: 'decision' }),
    ]);
    expect(workOrder(sections, { assignee: 'claude' }).map((n) => n.id)).toEqual(['work']);
  });

  it('still lists a decision unfiltered, so the person sees it', () => {
    const sections = tree([item({ id: 'question', assignee: 'claude', kind: 'decision' })]);
    expect(workOrder(sections).map((n) => n.id)).toEqual(['question']);
    expect(workOrder(sections, { assignee: 'me' }).map((n) => n.id)).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts the plan the way the strip at the top reads it', () => {
    const sections = tree(
      [
        item({ id: 'feature' }),
        at('done', 'a', { parentId: 'feature' }),
        at('in_progress', 'b', { parentId: 'feature', assignee: 'claude' }),
        at('blocked', 'c', { parentId: 'feature' }),
        item({ id: 'd', parentId: 'feature', assignee: 'claude' }),
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
      claude: 2,
      fog: 0,
    });
  });
});

describe('a block whose dependencies have all closed', () => {
  // The note from /dev/plan: "still says blocked. But it looks like everything
  // it waits on is done." The badge already read Ready -- healthOf had been
  // taught this -- while the strip went on counting it under "waiting" and the
  // Waiting view went on listing it, with nothing left to name as the thing it
  // waits for. Every place the page speaks about blocked work has to agree.
  const fixture = () =>
    tree(
      [
        item({ id: 'feature' }),
        at('blocked', 'stale', { parentId: 'feature' }),
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
      [at('blocked', 'stuck'), item({ id: 'pending' })],
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

  it('stops saying blocked once every dependency the block named is closed', () => {
    const sections = tree([at('done', 'a'), at('blocked', 'b')], [dep('b', 'a')]);
    const byId = new Map(flattenSections(sections).map((node) => [node.id, node]));

    expect(healthOf(byId.get('b')!)).toBe('ready');
  });

  it('goes on saying blocked while a dependency is open, or when none was named', () => {
    const sections = tree([at('not_started', 'a'), at('blocked', 'b'), at('blocked', 'c')], [
      dep('b', 'a'),
    ]);
    const byId = new Map(flattenSections(sections).map((node) => [node.id, node]));

    expect(healthOf(byId.get('b')!)).toBe('blocked');
    expect(healthOf(byId.get('c')!)).toBe('blocked');
  });
});

describe('tallyHealth', () => {
  it('counts the leaves by state and leaves the rest at zero', () => {
    const section = shopping(
      tree([
        at('done', 'a'),
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
      tree([at('not_started', 'f'), at('done', 's1', { parentId: 'f' }), at('done', 's2', { parentId: 'f' })]),
    );
    const total = Object.values(section.tally).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(2);
    expect(section.tally.done).toBe(2);
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

describe('isWaitingOnThePerson', () => {
  it('is an unanswered question, whatever state it is otherwise in', () => {
    for (const status of ['not_started', 'in_progress', 'blocked', 'proposed'] as const) {
      expect(isWaitingOnThePerson({ kind: 'decision', status })).toBe(true);
    }
  });

  it('is a blocked step, which needs something outside the repo', () => {
    expect(isWaitingOnThePerson({ kind: 'build', status: 'blocked' })).toBe(true);
  });

  it('is not a block whose every named dependency has since closed', () => {
    // It is the plan's own record that says nothing is holding it, so handing
    // it to Claude sends a session at a wall that is no longer there.
    const sections = tree([at('blocked', 'stale'), at('done', 'dep')], [dep('stale', 'dep')]);
    expect(isWaitingOnThePerson(findNode(sections, 'stale')!)).toBe(false);
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
