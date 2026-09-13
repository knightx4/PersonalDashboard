import { describe, expect, it } from 'vitest';
import type { FeedbackRow, FeedbackStatus } from '@/lib/feedback/load';
import type { PlanItem, PlanStatus } from '@/lib/plan/load';
import {
  buildChangelog,
  changelogEntries,
  changelogModules,
  filterChangelog,
  filterChangelogByModule,
  groupChangelog,
  isChangelogModuleFilter,
  noteEntries,
  planEntries,
  type ChangelogModuleFilter,
} from '@/lib/changelog/entries';

let counter = 0;

function step(over: Partial<PlanItem> & { id: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'shopping',
    parentId: null,
    title: `Step ${over.id}`,
    detail: null,
    acceptance: null,
    status: 'done',
    kind: 'build',
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: '2026-03-02T09:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function note(over: Partial<FeedbackRow> & { id: string }): FeedbackRow {
  return {
    kind: 'bug',
    body: `Note ${over.id}`,
    pagePath: null,
    status: 'done',
    priority: 2,
    resolutionNote: null,
    commitSha: null,
    createdAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-03-02T09:00:00Z',
    ...over,
  };
}

const closedAt = (id: string, at: string | null, over: Partial<PlanItem> = {}) =>
  step({ id, completedAt: at, ...over });

describe('planEntries', () => {
  it('carries what a line needs from a closed step', () => {
    const [entry] = planEntries([
      step({
        id: 'a',
        number: 42,
        module: 'dev',
        title: 'The changelog reading',
        detail: 'Pure and tested.',
        commitSha: 'abc1234',
        completedAt: '2026-03-02T09:00:00Z',
      }),
    ]);

    expect(entry).toMatchObject({
      source: 'plan',
      id: 'a',
      number: 42,
      at: '2026-03-02T09:00:00Z',
      day: '2026-03-02',
      module: 'dev',
      title: 'The changelog reading',
      detail: 'Pure and tested.',
      commitSha: 'abc1234',
    });
  });

  it('leaves out every step that did not ship', () => {
    const unshipped: PlanStatus[] = [
      'proposed',
      'not_started',
      'in_progress',
      'blocked',
      'dropped',
    ];
    const items = unshipped.map((status, index) => step({ id: `s${index}`, status }));

    expect(planEntries(items)).toEqual([]);
  });

  it('leaves out a dropped step even though it closed', () => {
    const entries = planEntries([
      step({ id: 'kept' }),
      step({ id: 'dropped', status: 'dropped' }),
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(['kept']);
  });

  it('leaves out an answered decision, which changed the plan and shipped nothing', () => {
    const entries = planEntries([
      step({ id: 'built' }),
      step({ id: 'answered', kind: 'decision', resolution: 'Yes, both.' }),
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(['built']);
  });

  it('leaves out a done step with no completion stamp', () => {
    const entries = planEntries([closedAt('stamped', '2026-03-02T09:00:00Z'), closedAt('bare', null)]);

    expect(entries.map((entry) => entry.id)).toEqual(['stamped']);
  });
});

describe('noteEntries', () => {
  it('carries the resolution note and the workspace it was filed from', () => {
    const [entry] = noteEntries([
      note({
        id: 'n1',
        body: 'The spend chart shows last month twice',
        pagePath: '/shopping/dashboard',
        resolutionNote: 'The window was inclusive at both ends.',
        commitSha: 'def5678',
        completedAt: '2026-03-01T17:30:00Z',
      }),
    ]);

    expect(entry).toMatchObject({
      source: 'note',
      id: 'n1',
      number: null,
      day: '2026-03-01',
      module: 'shopping',
      title: 'The spend chart shows last month twice',
      detail: 'The window was inclusive at both ends.',
      commitSha: 'def5678',
    });
  });

  it('leaves out every note that was not fixed', () => {
    const unfixed: FeedbackStatus[] = ['open', 'in_progress', 'blocked', 'planned', 'declined'];
    const rows = unfixed.map((status, index) => note({ id: `n${index}`, status }));

    expect(noteEntries(rows)).toEqual([]);
  });

  it('leaves out a declined note even though it closed', () => {
    const entries = noteEntries([
      note({ id: 'fixed' }),
      note({ id: 'declined', status: 'declined' }),
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(['fixed']);
  });

  it('leaves out a fixed note with no completion stamp', () => {
    const entries = noteEntries([note({ id: 'bare', completedAt: null })]);

    expect(entries).toEqual([]);
  });
});

describe('buildChangelog', () => {
  it('groups both lists into days, newest first', () => {
    const days = buildChangelog({
      plan: [
        step({ id: 'old', completedAt: '2026-03-01T08:00:00Z' }),
        step({ id: 'new', completedAt: '2026-03-03T08:00:00Z' }),
      ],
      notes: [note({ id: 'middle', completedAt: '2026-03-02T08:00:00Z' })],
    });

    expect(days.map((day) => day.day)).toEqual(['2026-03-03', '2026-03-02', '2026-03-01']);
    expect(days[1].entries.map((entry) => entry.id)).toEqual(['middle']);
  });

  it('puts the newest entry first within a day, whichever list it came from', () => {
    const days = buildChangelog({
      plan: [
        step({ id: 'morning', completedAt: '2026-03-02T09:00:00Z' }),
        step({ id: 'evening', completedAt: '2026-03-02T21:00:00Z' }),
      ],
      notes: [note({ id: 'noon', completedAt: '2026-03-02T12:00:00Z' })],
    });

    expect(days).toHaveLength(1);
    expect(days[0].entries.map((entry) => entry.id)).toEqual(['evening', 'noon', 'morning']);
  });

  it('has no day for a date nothing shipped on', () => {
    const days = buildChangelog({
      plan: [
        step({ id: 'a', completedAt: '2026-03-05T08:00:00Z' }),
        step({ id: 'b', completedAt: '2026-03-01T08:00:00Z' }),
      ],
      notes: [],
    });

    expect(days.map((day) => day.day)).toEqual(['2026-03-05', '2026-03-01']);
  });

  it('is empty when nothing has shipped', () => {
    expect(buildChangelog({ plan: [step({ id: 'a', status: 'in_progress' })], notes: [] })).toEqual(
      [],
    );
    expect(buildChangelog({ plan: [], notes: [] })).toEqual([]);
  });

  it('gives every entry a key unique across both lists', () => {
    const shared = 'same-uuid';
    const days = buildChangelog({
      plan: [step({ id: shared })],
      notes: [note({ id: shared })],
    });
    const keys = days.flatMap((day) => day.entries.map((entry) => entry.key));

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the feature a step shipped under', () => {
  const parents = [
    { id: 'feature', number: 10, title: 'The share page', parentId: null },
    { id: 'group', number: 11, title: 'The link', parentId: 'feature' },
  ];

  it('names the feature at the top, not the step just above', () => {
    // "What did this belong to" is answered by the feature. A sub-sub-step's
    // parent is another step, which nobody thinks of as a thing.
    const [entry] = planEntries([step({ id: 'a', parentId: 'group' })], parents);
    expect(entry.issue).toEqual({ id: 'feature', number: 10, title: 'The share page' });
  });

  it('gives a feature itself no issue above it', () => {
    expect(planEntries([step({ id: 'a', parentId: null })], parents)[0].issue).toBeNull();
  });

  it('survives a parent chain that loops', () => {
    // A cycle is data, and data can be wrong in ways that hang a page.
    const looped = [
      { id: 'x', number: 1, title: 'X', parentId: 'y' },
      { id: 'y', number: 2, title: 'Y', parentId: 'x' },
    ];
    expect(() => planEntries([step({ id: 'a', parentId: 'x' })], looped)).not.toThrow();
  });

  it('gives a note no issue: it belongs to no feature', () => {
    expect(noteEntries([note({ id: 'n' })])[0].issue).toBeNull();
  });
});

describe('groupChangelog', () => {
  const parents = [{ id: 'feature', number: 10, title: 'The share page', parentId: null }];

  const entries = changelogEntries({
    plan: [
      step({ id: 's1', parentId: 'feature', completedAt: '2026-03-02T09:00:00Z', commitSha: 'aaa' }),
      step({ id: 's2', parentId: 'feature', completedAt: '2026-03-04T09:00:00Z', commitSha: 'bbb' }),
      step({ id: 'lone', parentId: null, completedAt: '2026-03-03T09:00:00Z', commitSha: 'aaa' }),
    ],
    planParents: parents,
    notes: [],
  });

  it('puts a feature’s steps together however far apart the days are', () => {
    // The whole point: two lines two days apart were one piece of work.
    const groups = groupChangelog(entries, 'issue');
    const feature = groups.find((group) => group.label === 'The share page')!;
    expect(feature.entries.map((entry) => entry.id).sort()).toEqual(['s1', 's2']);
    expect(feature.number).toBe(10);
  });

  it('lets a step with no feature above it head its own group', () => {
    const groups = groupChangelog(entries, 'issue');
    expect(groups.some((group) => group.key === 'issue-lone')).toBe(true);
  });

  it('puts a feature’s own closed row in the same group as its steps', () => {
    // The page used to show a shipped feature twice: once as a line of its
    // own, and again as the heading over its steps, with nothing saying they
    // were the same thing.
    const withFeature = changelogEntries({
      plan: [
        step({ id: 'feature', parentId: null, title: 'The share page', number: 10 }),
        step({ id: 's1', parentId: 'feature' }),
      ],
      planParents: parents,
      notes: [],
    });
    const groups = groupChangelog(withFeature, 'issue');
    const share = groups.filter((group) => group.label === 'The share page');

    expect(share).toHaveLength(1);
    expect(share[0].key).toBe('issue-feature');
    expect(share[0].entries.map((entry) => entry.id).sort()).toEqual(['feature', 's1']);
  });

  it('leaves a note as its own group, since nothing shipped under it', () => {
    const groups = groupChangelog(
      changelogEntries({ plan: [], notes: [note({ id: 'n1' })] }),
      'issue',
    );
    expect(groups[0].key).toBe('note-n1');
  });

  it('puts back together what one commit closed', () => {
    const groups = groupChangelog(entries, 'commit');
    const aaa = groups.find((group) => group.key === 'aaa')!;
    expect(aaa.entries.map((entry) => entry.id).sort()).toEqual(['lone', 's1']);
  });

  it('gives rows closed without a commit a heading rather than dropping them', () => {
    // Law 2: a row that closed with no commit is a real thing that happened.
    const withoutSha = changelogEntries({
      plan: [step({ id: 'x', commitSha: null })],
      notes: [],
    });
    const groups = groupChangelog(withoutSha, 'commit');
    expect(groups[0].key).toBe('no-commit');
    expect(groups[0].entries).toHaveLength(1);
  });

  it('orders groups by their newest entry, not by name', () => {
    const groups = groupChangelog(entries, 'issue');
    // The feature carries s2, closed on the 4th; the lone step closed on the 3rd.
    expect(groups[0].label).toBe('The share page');
  });

  it('still groups by day the way the page always has', () => {
    const groups = groupChangelog(entries, 'day');
    expect(groups.map((group) => group.label)).toEqual(['2026-03-04', '2026-03-03', '2026-03-02']);
    expect(groups.every((group) => group.kind === 'day')).toBe(true);
  });
});

describe('filterChangelog', () => {
  const parents = [{ id: 'feature', number: 10, title: 'The share page', parentId: null }];

  const entries = changelogEntries({
    plan: [
      step({
        id: 's1',
        parentId: 'feature',
        title: 'Anonymous share links',
        detail: 'A token per link, revocable.',
        commitSha: 'abc1234',
      }),
      step({ id: 'other', parentId: null, title: 'Barcode scanning', commitSha: 'def5678' }),
    ],
    planParents: parents,
    notes: [note({ id: 'n1', body: 'The dock scrolls past the bottom' })],
  });

  const idsFor = (query: string) =>
    filterChangelog(entries, query)
      .map((entry) => entry.id)
      .sort();

  it('returns everything when nothing was typed', () => {
    expect(filterChangelog(entries, '')).toHaveLength(entries.length);
    expect(filterChangelog(entries, '   ')).toHaveLength(entries.length);
  });

  it('matches the title, whatever the case', () => {
    expect(idsFor('BARCODE')).toEqual(['other']);
  });

  it('matches what was written about it', () => {
    expect(idsFor('revocable')).toEqual(['s1']);
  });

  it('matches a commit', () => {
    expect(idsFor('def5678')).toEqual(['other']);
  });

  it('matches a step by the feature it shipped under', () => {
    // The reason to search a page grouped by feature: the feature's name is
    // not in the step's own title.
    expect(idsFor('share page')).toEqual(['s1']);
  });

  it('needs every word, in any field and any order', () => {
    expect(idsFor('share anonymous')).toEqual(['s1']);
    expect(idsFor('share barcode')).toEqual([]);
  });

  it('searches notes as well as plan steps', () => {
    expect(idsFor('dock')).toEqual(['n1']);
  });
});

describe('filterChangelogByModule', () => {
  const entries = changelogEntries({
    plan: [
      step({ id: 'shop', module: 'shopping' }),
      step({ id: 'vault', module: 'vault' }),
      step({ id: 'shell', module: null }),
    ],
    // Filed from the home page, so it belongs to no workspace either.
    notes: [note({ id: 'n1', pagePath: '/' }), note({ id: 'n2', pagePath: '/vault/items' })],
  });

  const idsFor = (module: ChangelogModuleFilter | null) =>
    filterChangelogByModule(entries, module)
      .map((entry) => entry.id)
      .sort();

  it('returns everything when nothing is selected', () => {
    expect(idsFor(null)).toHaveLength(entries.length);
  });

  it('keeps only one workspace, from either list', () => {
    expect(idsFor('vault')).toEqual(['n2', 'vault']);
  });

  it('reaches the lines that belong to no workspace', () => {
    // Otherwise a shell refactor and a note filed from the home page are
    // only visible with no filter on at all.
    expect(idsFor('app')).toEqual(['n1', 'shell']);
  });

  it('is empty for a workspace nothing shipped under', () => {
    expect(idsFor('jobs')).toEqual([]);
  });
});

describe('changelogModules', () => {
  it('offers only what something shipped under', () => {
    const entries = changelogEntries({
      plan: [step({ id: 'a', module: 'vault' })],
      notes: [note({ id: 'n1', pagePath: '/todo' })],
    });

    expect(changelogModules(entries)).toEqual(['todo', 'vault']);
  });

  it('lists them in the order the switcher does, with the app last', () => {
    const entries = changelogEntries({
      plan: [
        step({ id: 'a', module: 'dev' }),
        step({ id: 'b', module: null }),
        step({ id: 'c', module: 'shopping' }),
      ],
      notes: [],
    });

    expect(changelogModules(entries)).toEqual(['shopping', 'dev', 'app']);
  });

  it('names a workspace once however much shipped under it', () => {
    const entries = changelogEntries({
      plan: [step({ id: 'a', module: 'vault' }), step({ id: 'b', module: 'vault' })],
      notes: [],
    });

    expect(changelogModules(entries)).toEqual(['vault']);
  });

  it('is empty when nothing has shipped', () => {
    expect(changelogModules([])).toEqual([]);
  });
});

describe('isChangelogModuleFilter', () => {
  it('accepts a workspace and the app', () => {
    expect(isChangelogModuleFilter('vault')).toBe(true);
    expect(isChangelogModuleFilter('app')).toBe(true);
  });

  it('rejects anything else, so a hand-typed URL falls back to everything', () => {
    expect(isChangelogModuleFilter('nonsense')).toBe(false);
    expect(isChangelogModuleFilter('')).toBe(false);
  });
});
