import { describe, expect, it } from 'vitest';
import type { IdeaRow } from '@/lib/ideas/load';
import {
  groupIdeas,
  parseIdeaGrouping,
  parseIdeaSort,
  sortIdeas,
} from '@/lib/ideas/view';

function idea(over: Partial<IdeaRow> & { id: string }): IdeaRow {
  return {
    body: `Idea ${over.id}`,
    module: null,
    createdAt: '2026-01-01T00:00:00Z',
    planItem: null,
    source: 'me',
    from: null,
    dismissedAt: null,
    thread: [],
    ...over,
  };
}

describe('parseIdeaGrouping', () => {
  it('defaults to workspace', () => {
    expect(parseIdeaGrouping(undefined)).toBe('workspace');
    expect(parseIdeaGrouping('nonsense')).toBe('workspace');
    expect(parseIdeaGrouping('')).toBe('workspace');
  });

  it('accepts the ones it knows', () => {
    expect(parseIdeaGrouping('none')).toBe('none');
    expect(parseIdeaGrouping('workspace')).toBe('workspace');
  });

  // A query parameter given twice arrives as an array.
  it('takes the first of a repeated parameter', () => {
    expect(parseIdeaGrouping(['none', 'workspace'])).toBe('none');
  });
});

describe('parseIdeaSort', () => {
  it('defaults to highest score first', () => {
    expect(parseIdeaSort(undefined)).toBe('score');
    expect(parseIdeaSort('sideways')).toBe('score');
  });

  it('accepts the ones it knows', () => {
    expect(parseIdeaSort('score')).toBe('score');
    expect(parseIdeaSort('oldest')).toBe('oldest');
    expect(parseIdeaSort('newest')).toBe('newest');
  });
});

describe('sortIdeas', () => {
  const rows = [
    idea({ id: 'middle', createdAt: '2026-02-01T00:00:00Z' }),
    idea({ id: 'oldest', createdAt: '2026-01-01T00:00:00Z' }),
    idea({ id: 'newest', createdAt: '2026-03-01T00:00:00Z' }),
  ];

  it('puts the newest first when asked', () => {
    expect(sortIdeas(rows, 'newest').map((row) => row.id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  it('turns round for oldest', () => {
    expect(sortIdeas(rows, 'oldest').map((row) => row.id)).toEqual([
      'oldest',
      'middle',
      'newest',
    ]);
  });

  // The same array backs several sections on the page; sorting it in place
  // would reorder all of them.
  it('does not reorder the array it was given', () => {
    const before = rows.map((row) => row.id);
    sortIdeas(rows, 'oldest');
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

describe('sortIdeas by score', () => {
  const scored = (value: number, confidence = 0.6) => ({ value, confidence, at: '2026-09-30T00:00:00Z' });

  it('puts the highest score first, whatever the confidence', () => {
    const rows = [
      idea({ id: 'low-sure', score: scored(30, 0.95) }),
      idea({ id: 'high-unsure', score: scored(88, 0.4) }),
      idea({ id: 'middle', score: scored(56) }),
    ];
    expect(sortIdeas(rows, 'score').map((row) => row.id)).toEqual([
      'high-unsure',
      'middle',
      'low-sure',
    ]);
  });

  it('breaks a tie newest first', () => {
    const rows = [
      idea({ id: 'older', createdAt: '2026-01-01T00:00:00Z', score: scored(50) }),
      idea({ id: 'newer', createdAt: '2026-03-01T00:00:00Z', score: scored(50) }),
    ];
    expect(sortIdeas(rows, 'score').map((row) => row.id)).toEqual(['newer', 'older']);
  });

  // An idea filed since the last scoring run has no score yet: it goes after
  // every scored idea, however low, and the unscored ones go newest first.
  it('puts unscored ideas last, newest first among them', () => {
    const rows = [
      idea({ id: 'unscored-old', createdAt: '2026-01-01T00:00:00Z', score: null }),
      idea({ id: 'zero', createdAt: '2026-01-01T00:00:00Z', score: scored(0) }),
      idea({ id: 'unscored-new', createdAt: '2026-03-01T00:00:00Z' }),
      idea({ id: 'top', createdAt: '2026-01-01T00:00:00Z', score: scored(72) }),
    ];
    expect(sortIdeas(rows, 'score').map((row) => row.id)).toEqual([
      'top',
      'zero',
      'unscored-new',
      'unscored-old',
    ]);
  });
});

describe('groupIdeas', () => {
  const rows = [
    idea({ id: 'a', module: 'jobs' }),
    idea({ id: 'b', module: null }),
    idea({ id: 'c', module: 'jobs' }),
  ];

  it('makes one unlabelled section when grouping is off', () => {
    const groups = groupIdeas(rows, 'none');

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('');
    expect(groups[0].rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('has nothing to show for an empty list', () => {
    expect(groupIdeas([], 'none')).toEqual([]);
    expect(groupIdeas([], 'workspace')).toEqual([]);
  });

  it('groups by workspace, app-wide first', () => {
    const groups = groupIdeas(rows, 'workspace');

    expect(groups.map((group) => group.label)).toEqual(['Everything', 'Job search']);
    expect(groups[0].rows.map((row) => row.id)).toEqual(['b']);
    expect(groups[1].rows.map((row) => row.id)).toEqual(['a', 'c']);
  });

  // Law 1: a workspace with nothing in it is not a heading over nothing.
  it('leaves out a workspace with nothing in it', () => {
    const groups = groupIdeas([idea({ id: 'only', module: 'vault' })], 'workspace');

    expect(groups.map((group) => group.label)).toEqual(['Vault']);
  });

  // The order within a group is the order it was handed, which is what lets
  // the caller sort once and group after.
  it('keeps the order it was given inside a group', () => {
    const sorted = sortIdeas(
      [
        idea({ id: 'late', module: 'jobs', createdAt: '2026-03-01T00:00:00Z' }),
        idea({ id: 'early', module: 'jobs', createdAt: '2026-01-01T00:00:00Z' }),
      ],
      'oldest',
    );

    expect(groupIdeas(sorted, 'workspace')[0].rows.map((row) => row.id)).toEqual([
      'early',
      'late',
    ]);
  });
});
